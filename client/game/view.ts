import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RULES, TICK_MS, TICK_RATE } from '../../shared/constants';
import { encounterById, type Encounter } from '../../shared/encounters';
import { LB_SLOT, LIMIT_BREAKS, jobById, type Fx, type Job, type SkillInfo } from '../../shared/jobs';
import { FOES } from '../../shared/bosses/foes';
import { DENY_TEXT, type C2S, type DenyReason, type FightEvent, type GameResult, type GameStartInfo, type SnapFoe, type SnapPlayer, type Snapshot } from '../../shared/protocol';
import { angleDiff, clampToArena, faceTowards, reach } from '../../shared/sim/arena';
import { STATUS, STATUS_IDS } from '../../shared/status';
import type { Audio } from '../audio';
import { h, store, toast } from '../dom';
import { MOVE_KEYS, SKILL_ACTIONS, actionOf, loadBindings, type Bindings, type MoveKey } from '../keys';
import { AUTO_HEAL_KEY, loadQuality, pixelRatioFor, settingsModal } from '../ui/common';
import { buildArena, type ArenaView } from './arena';
import { loadModels, loadedModels } from './assets';
import { Avatar } from './avatar';
import { makeFoe, type FoeView } from './bosses';
import { CameraRig } from './camera';
import { Effects } from './effects';
import { Hud, type SlotState } from './hud';
import { Playback } from './playback';
import { Telegraphs } from './telegraphs';

/** Where the view sends its messages: the server, or the in-browser fight of the practice mode. */
export interface GameLink {
  send(m: C2S): void;
  leave(): void;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const hittable = (e: SnapFoe) => e.hp > 0 && !e.u && !e.g;

/** Effect colours per job: projectiles, slashes, rings. */
const JOB_FX: Readonly<Record<string, { color: string; shot?: 'orb' | 'arrow' }>> = {
  guardian: { color: '#9cc3ff' },
  berserker: { color: '#ff6a5a' },
  priest: { color: '#ffe08a', shot: 'orb' },
  warden: { color: '#b9a4ff', shot: 'orb' },
  brawler: { color: '#ffb05a' },
  lancer: { color: '#7fe6e6' },
  ranger: { color: '#d8f5a2', shot: 'arrow' },
  sorcerer: { color: '#ff7a2c', shot: 'orb' },
};


/**
 * The 3D fight screen. My character moves locally at once (and reports its position); everyone else is
 * drawn from the server snapshots, a little in the past, smoothed by the playback clock. Skills are
 * requests the server checks; their animations, effects and numbers follow the events in the snapshots.
 */
export class GameView {
  readonly root: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labels = new CSS2DRenderer();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  private readonly rig: CameraRig;
  private readonly hud: Hud;
  private readonly arena: ArenaView;
  /** every enemy on screen by id: the boss, its adds, a prison */
  private readonly foes = new Map<string, { view: FoeView; kind: SnapFoe['kd'] }>();
  private readonly teles: Telegraphs;
  private readonly effects = new Effects();
  private readonly enc: Encounter;
  private readonly myJob: Job;
  private readonly avatars = new Map<string, Avatar>();
  private readonly names = new Map<string, string>();
  private readonly snaps: Snapshot[] = [];
  private readonly playback = new Playback();
  private readonly held = new Set<MoveKey>();
  private readonly resize: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private bindings: Bindings = loadBindings();
  private me: { x: number; z: number; f: number; moving: boolean } | null = null;
  private sent = { x: NaN, z: NaN, f: NaN, at: 0 };
  /** the server is moving me (a dash or a jump) */
  private carried = false;
  private dead = false;
  private target: string | null = null;
  private last: Snapshot | null = null;
  private over = false;
  private raf = 0;
  private lastFrame = 0;
  private frames = 0;
  private fpsFrom = 0;
  private lastCount = -1;
  private lbFull = false;
  /** a fixed point for the camera instead of my character (the gallery) */
  private focusAt: { x: number; z: number } | null = null;

  constructor(
    readonly info: GameStartInfo,
    private readonly meId: string,
    private readonly link: GameLink,
    private readonly audio: Audio,
  ) {
    this.enc = encounterById(info.enc);
    const mine = info.players.find((p) => p.id === meId);
    this.myJob = jobById(mine?.job ?? 'guardian');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(pixelRatioFor(loadQuality()));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = this.renderer.domElement;
    canvas.className = 'game-canvas';
    this.labels.domElement.className = 'game-labels';

    this.hud = new Hud(info, meId, {
      chat: (text) => link.send({ t: 'chat', text }),
      leave: () => link.leave(),
      endTest: () => link.send({ t: 'endtest' }),
      settings: () => settingsModal(audio, () => this.reloadKeys()),
      target: (id) => this.pick(id),
    });
    this.hud.setBindings(this.bindings);
    this.root = h('div', { class: 'game' }, canvas, this.labels.domElement, this.hud.el);

    const theme = this.enc.theme;
    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.Fog(theme.sky, 70, 170);
    this.scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(theme.outside), 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(-12, 30, 14);
    this.scene.add(sun);

    this.arena = buildArena(this.enc);
    this.teles = new Telegraphs(this.enc.arena);
    this.scene.add(this.arena.group);
    for (const f of info.foes) this.addFoe(f.id, f.kind);
    this.scene.add(this.teles.group);
    this.scene.add(this.effects.group);
    for (const p of info.players) this.names.set(p.id, p.name);
    this.buildAvatars();
    // the KayKit models normally arrive while the room is waiting; if not, swap them in when they do
    if (!loadedModels())
      void loadModels().then((m) => {
        if (m && this.raf) this.buildAvatars();
      });

    this.rig = new CameraRig(this.camera, canvas);
    this.rig.onClick = (x, y) => this.clickPick(x, y);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('octaraid:quality', this.onQuality);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(this.root);
    this.raf = requestAnimationFrame(this.frame);
  }

  private buildAvatars(): void {
    const models = loadedModels();
    for (const p of this.info.players) {
      const old = this.avatars.get(p.id);
      if (old) {
        this.scene.remove(old.root);
        old.dispose();
      }
      const a = new Avatar(jobById(p.job), p.name, p.id === this.meId, models);
      a.root.visible = !!old?.root.visible;
      this.avatars.set(p.id, a);
      this.scene.add(a.root);
    }
    if (this.target) this.pick(this.target);
    if (this.focusAt) this.avatars.get(this.meId)?.hideMarker();
  }

  private addFoe(id: string, kind: SnapFoe['kd']): void {
    if (this.foes.has(id)) return;
    const view = makeFoe(kind);
    this.foes.set(id, { view, kind });
    this.names.set(id, FOES[kind].name);
    this.scene.add(view.root);
  }

  /** Enemies come (adds, a prison) and go (gone from the snapshot after they sank away). */
  private syncFoes(s: Snapshot): void {
    for (const e of s.e) {
      if (!this.foes.has(e.i)) {
        this.addFoe(e.i, e.kd);
        if (s.ph === 1) this.effects.burst(e.x, 0.6, e.z, FOES[e.kd].ring + 0.6, e.kd === 'prison' ? '#e8c48a' : '#c8b49a', 0.5);
      }
      const f = this.foes.get(e.i)!;
      f.view.setState(e.u === 1, e.g === 1);
      f.view.setCasting(e.c ? e.c[0] : null);
    }
    for (const [id, f] of this.foes) {
      if (s.e.some((e) => e.i === id)) continue;
      this.scene.remove(f.view.root);
      f.view.dispose();
      this.foes.delete(id);
    }
  }

  // ------------------------------------------------------------- from the server

  onSnap(s: Snapshot): void {
    this.snaps.push(s);
    if (this.snaps.length > 90) this.snaps.shift();
    this.playback.observe(s.k, performance.now());
    this.last = s;
    const mine = s.p.find((x) => x.i === this.meId);
    if (mine) {
      if (!this.me) this.me = { x: mine.x, z: mine.z, f: mine.f, moving: false };
      // a dash or a jump: follow the server; when it ends, carry on from where it put me
      if (mine.fm || this.carried) {
        this.me.x = mine.x;
        this.me.z = mine.z;
        this.me.f = mine.f;
        this.sent = { x: mine.x, z: mine.z, f: mine.f, at: performance.now() };
      }
      this.carried = mine.fm === 1;
      if (mine.d !== (this.dead ? 1 : 0)) {
        this.dead = mine.d === 1;
        if (this.dead) this.held.clear();
      }
    }
    this.syncFoes(s);
    this.teles.update(s.tg, (id) => this.drawnAt(id), performance.now());
    this.hud.freeze(this.teles.freezeLeft(s.tg));
    this.arena.setBroken(s.pb ?? []);
    for (const e of s.ev ?? []) this.onEvent(e, s);
    const count = this.hud.onSnap(s, this.target, this.slotStates(s));
    if (count !== this.lastCount) {
      if (count > 0 && count <= 5) this.audio.play('beep');
      if (count === 0 && this.lastCount > 0) this.audio.play('go');
      this.lastCount = count;
    }
    const full = s.lb >= 1000;
    if (full && !this.lbFull) this.audio.play('lbReady');
    this.lbFull = full;
    this.effects.setZones(
      (s.zn ?? []).map((z) => ({ key: `${z.o}/${z.s}`, x: z.x, z: z.z, r: z.r, color: STATUS_IDS[z.s] === 'ley' ? '#ff5ad2' : '#8affc0' })),
    );
    // a target that is gone (a dead enemy, a boss between phases) is dropped
    if (this.isFoe(this.target) && !s.e.some((e) => e.i === this.target && hittable(e))) this.pick(null);
    if (s.ph === 2) this.over = true;
  }

  /** The server did not accept a step: go where it says. */
  onCorrection(x: number, z: number): void {
    if (!this.me) return;
    this.me.x = x;
    this.me.z = z;
    this.sent.x = x;
    this.sent.z = z;
  }

  onDeny(slot: number, why: DenyReason): void {
    if (why === 'gcd') return; // pressing early is normal: the hotbar's sweep already says when
    this.hud.deny(slot === LB_SLOT && why === 'lb' ? '極限技量表未滿' : DENY_TEXT[why]);
    this.audio.play('deny');
  }

  onEnd(result: GameResult): void {
    this.over = true;
    this.held.clear();
    this.hud.showResults(result);
    this.audio.play(result.reason === 'clear' ? 'win' : result.reason === 'test' ? 'chime' : 'lose');
    if (result.reason === 'clear') for (const [id, a] of this.avatars) if (!this.last?.p.find((p) => p.i === id)?.d) a.cheer();
  }

  addChat(name: string, text: string): void {
    this.hud.addChat(name, text);
  }

  setHost(host: boolean): void {
    this.hud.setHost(host);
  }

  /** A group picture: no HUD, no name plates, no marker under me, the camera on (x, z). */
  showcase(x: number, z: number): void {
    this.focusAt = { x, z };
    this.hud.el.style.display = 'none';
    this.labels.domElement.style.display = 'none';
    this.avatars.get(this.meId)?.hideMarker();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('octaraid:quality', this.onQuality);
    this.resize.disconnect();
    this.rig.dispose();
    this.arena.dispose();
    for (const f of this.foes.values()) f.view.dispose();
    this.teles.dispose();
    this.effects.dispose();
    for (const a of this.avatars.values()) a.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // browsers allow only a few WebGL contexts per page
    this.root.remove();
  }

  // ------------------------------------------------------------- events: animations, effects, numbers

  private where(id: string): { x: number; y: number; z: number } {
    if (id === this.meId && this.me) return { x: this.me.x, y: 1.1, z: this.me.z };
    const a = this.avatars.get(id);
    if (a) return { x: a.root.position.x, y: 1.1, z: a.root.position.z };
    const f = this.foes.get(id);
    if (f) return { x: f.view.root.position.x, y: FOES[f.kind].boss ? 2.6 : 1.4, z: f.view.root.position.z };
    return { x: 0, y: 1, z: 0 };
  }

  /** Where a player is drawn this frame (null when they are not on screen). */
  private drawnAt(id: string): { x: number; z: number } | null {
    if (id === this.meId && this.me) return this.me;
    const a = this.avatars.get(id);
    return a?.root.visible ? { x: a.root.position.x, z: a.root.position.z } : null;
  }

  private isFoe(id: string | null | undefined): boolean {
    return !!id && (this.foes.has(id) || this.info.foes.some((f) => f.id === id));
  }

  /** My character cannot move: shut in a 岩牢, or frozen by 深度凍結. */
  private stunned(): boolean {
    const mine = this.last?.p.find((p) => p.i === this.meId);
    return !!mine?.st?.some((x) => STATUS[STATUS_IDS[x[0]]!]?.stun);
  }

  private jobOf(id: string): Job | null {
    const p = this.info.players.find((x) => x.id === id);
    return p ? jobById(p.job) : null;
  }

  private onEvent(e: FightEvent, s: Snapshot): void {
    switch (e.k) {
      case 'cast': {
        this.avatars.get(e.i)?.setCasting(true);
        if (e.i === this.meId) this.audio.play('cast');
        return;
      }
      case 'intr':
        this.avatars.get(e.i)?.setCasting(false);
        if (e.i === this.meId) this.hud.deny('詠唱中斷');
        return;
      case 'use':
        return this.onUse(e.i, e.s, e.st ?? 0, e.t);
      case 'dmg':
        return this.onDamage(e);
      case 'heal': {
        const at = this.where(e.t);
        if (!e.hot) this.effects.sparkle(at.x, at.z, '#7dff9a', 7);
        if (e.t === this.meId || e.s === this.meId) this.effects.text(at.x, 2.1, at.z, `+${e.a.toLocaleString()}${e.c ? '!' : ''}`, `heal ${e.c ? 'crit' : ''} ${e.hot ? 'small' : ''}`);
        if (e.s === this.meId && !e.hot) this.audio.play('heal');
        return;
      }
      case 'die': {
        this.avatars.get(e.i)?.setDead(true);
        if (e.i === this.meId) {
          this.audio.play('die');
          // falling has its own line (the fell event comes first)
          if (!s.ev?.some((x) => x.k === 'fell' && x.i === e.i)) this.hud.announce('你倒下了：等待補師復活', 'bad');
        }
        const name = this.names.get(e.i);
        if (name) this.hud.addChat('', `${name} 倒地`);
        return;
      }
      case 'raise': {
        this.avatars.get(e.i)?.setDead(false);
        const at = this.where(e.i);
        this.effects.pillar(at.x, at.z, '#fff3b0');
        if (e.i === this.meId) this.audio.play('raise');
        const name = this.names.get(e.i);
        if (name) this.hud.addChat('', e.by ? `${name} 被 ${this.names.get(e.by) ?? ''} 復活` : `${name} 自己站了起來`);
        return;
      }
      case 'lb':
        return this.onLimitBreak(e.i, e.r, s);
      case 'bcast': {
        this.hud.castKind(e.i, e.m);
        this.audio.play('warn');
        // the boss scripts mark their busters with a telegraph; the training dummy has none
        if (e.m === 'buster' && e.t && this.foes.get(e.i)?.kind === 'dummy') {
          const t = e.t;
          this.effects.mark(() => this.where(t), '#ff3b3b', e.d / TICK_RATE);
        }
        if (e.m === 'enrage') this.hud.announce(`${e.n}：快打倒它！`, 'bad');
        return;
      }
      case 'boss':
        return this.onBossMove(e);
      case 'phase': {
        // the first phase starts with the fight: no banner for it
        if (s.el > TICK_RATE) this.hud.announce(e.u ? `${e.n}：先打倒小怪` : e.n, 'phase');
        if (e.u) this.audio.play('warn');
        return;
      }
      case 'fail': {
        const at = this.where(e.i);
        this.effects.text(at.x, 2.9, at.z, `失誤：${e.n}`, 'fail');
        if (e.i === this.meId) this.audio.play('deny');
        return;
      }
      case 'clean':
        this.hud.flashLb(`${e.n} 零失誤：極限技 +${RULES.lbClean}%`);
        return;
      case 'kb': {
        const at = this.where(e.i);
        this.effects.burst(at.x, 0.4, at.z, 1.2, '#ffffff', 0.3);
        return;
      }
      case 'fell': {
        const name = this.names.get(e.i);
        if (name) this.hud.addChat('', `${name} 掉下懸崖`);
        if (e.i === this.meId) this.hud.announce('掉下懸崖了：等待補師復活', 'bad');
        return;
      }
      case 'spawn':
        return;
    }
  }

  /** An enemy move went off. */
  private onBossMove(e: Extract<FightEvent, { k: 'boss' }>): void {
    const f = this.foes.get(e.i);
    const b = f?.view.root.position ?? new THREE.Vector3();
    switch (e.m) {
      case 'auto':
        if (e.t) {
          const at = this.where(e.t);
          this.effects.slash(at.x, 1.2, at.z, faceTowards(b.x, b.z, at.x, at.z), '#ff8a6a');
        }
        break;
      case 'buster':
        if (e.t) {
          const at = this.where(e.t);
          this.effects.burst(at.x, 1.2, at.z, 1.6, '#ff3b3b', 0.45);
          this.avatars.get(e.t)?.hurt();
        }
        break;
      case 'raidwide':
        this.effects.wave(b.x, b.z, f && !FOES[f.kind].boss ? this.enc.arena.size * 2 : this.enc.arena.size * 1.3, f && !FOES[f.kind].boss ? '#ff5a3a' : '#ffb03b', 0.9);
        break;
      case 'jump':
        f?.view.act('jump');
        this.effects.wave(b.x, b.z, 14, '#c8b49a', 1.2);
        break;
      case 'prison':
        if (e.t) {
          const at = this.where(e.t);
          this.effects.burst(at.x, 0.8, at.z, 1.8, '#e8c48a', 0.5);
          const name = this.names.get(e.t);
          if (e.t === this.meId) this.hud.announce('被困在岩牢裡：等隊友打破', 'bad');
          else if (name) this.hud.addChat('', `${name} 被困在岩牢裡：快打破它`);
        }
        break;
      case 'adds':
        this.hud.addChat('', '小怪出現了：坦克接住，其他人集火');
        break;
      case 'revive':
        this.effects.pillar(b.x, b.z, '#ff7a2c', 1.2, 0.8);
        this.hud.addChat('', `${this.names.get(e.i) ?? '小怪'}又站起來了：要一起打倒`);
        break;
      case 'bomb':
        if (e.t) {
          const at = this.where(e.t);
          this.effects.wave(at.x, at.z, 8, '#c86bff', 0.6);
          this.effects.burst(at.x, 1, at.z, 2, '#c86bff', 0.5);
        }
        break;
      case 'charge':
        f?.view.act('charge');
        if (e.t) {
          const at = this.where(e.t);
          this.effects.line(b.x, b.z, faceTowards(b.x, b.z, at.x, at.z), this.enc.arena.size * 2, 6, '#ff6a3a');
        }
        break;
      case 'glow':
        // Hard 炎冰交錯 has no telegraph: the weapon of the one that strikes first lights up
        f?.view.act('glow');
        break;
      case 'swap':
        this.hud.announce('顏色互換！', 'bad');
        this.audio.play('warn');
        break;
      case 'resonance':
        this.hud.addChat('', '兩王靠得太近：共鳴，傷害提高');
        for (const v of this.foes.values()) if (FOES[v.kind].boss) this.effects.wave(v.view.root.position.x, v.view.root.position.z, 6, '#ffffff', 0.5);
        break;
      case 'fuse':
        this.hud.announce('合體：雙極機神', 'phase');
        this.effects.pillar(b.x, b.z, '#ffffff', 2.5, 1.2);
        this.effects.wave(b.x, b.z, 20, '#c86bff', 1);
        break;
    }
    if (e.m === 'raidwide' && e.n === '失衡') this.hud.addChat('', '兩王血量差太多：失衡，要平均打');
    if (['buster', 'raidwide', 'prison', 'bomb', 'charge'].includes(e.m) && (e.t === this.meId || e.m === 'raidwide')) this.audio.play('hurt');
  }

  /** A skill went off: the caster's animation and the shape of what it did. */
  private onUse(id: string, slot: number, step: number, tid: string | undefined): void {
    const a = this.avatars.get(id);
    a?.setCasting(false);
    a?.playSkill(slot, step);
    const job = this.jobOf(id);
    const skill = job?.skills[slot];
    if (!job || !skill) return;
    const fxs: readonly Fx[] = skill.combo ? skill.combo[step % 3]! : skill.fx;
    const from = this.where(id);
    const color = JOB_FX[job.id]!.color;
    const to = tid ? this.where(tid) : null;
    const facing = to ? faceTowards(from.x, from.z, to.x, to.z) : (a?.facing ?? 0);
    if (id === this.meId) this.audio.play(skill.cast ? 'spell' : skill.target === 'enemy' ? (JOB_FX[job.id]!.shot ? 'shot' : 'hit') : 'buff');
    for (const fx of fxs) {
      switch (fx.k) {
        case 'hit':
          if (to && tid) {
            const shot = JOB_FX[job.id]!.shot;
            if (shot && skill.range > 5) this.effects.projectile(from, () => this.where(tid), color, shot, shot === 'arrow' ? 0.22 : 0.32);
            else this.effects.slash(to.x, 1.4, to.z, facing, color);
          }
          break;
        case 'circle':
          if (fx.at === 'me') this.effects.ring(from.x, from.z, fx.r, color);
          else if (to) {
            if (fx.p >= 1000) this.effects.meteor(to.x, to.z, fx.r);
            else this.effects.ring(to.x, to.z, fx.r, color);
          }
          break;
        case 'cone':
          this.effects.fan(from.x, from.z, facing, fx.r, fx.deg, color);
          break;
        case 'line':
          this.effects.line(from.x, from.z, facing, fx.len, fx.w, color);
          break;
        case 'buff':
          if (fx.who === 'party') this.effects.wave(from.x, from.z, fx.r ?? 20, color, 0.7);
          else this.effects.sparkle(from.x, from.z, color, 6, 0.7);
          break;
        case 'provoke':
          if (to) this.effects.burst(to.x, 3.4, to.z, 0.8, '#ff3b3b', 0.4);
          break;
        case 'partyHeal':
        case 'partyShield':
          this.effects.wave(from.x, from.z, fx.r, '#7dff9a', 0.6);
          break;
        default:
          break;
      }
    }
  }

  private onDamage(e: Extract<FightEvent, { k: 'dmg' }>): void {
    const at = this.where(e.t);
    if (this.isFoe(e.t)) {
      if (e.s) this.hud.addDealt(e.s, e.a);
      if (!e.dot) this.foes.get(e.t)?.view.hit();
      if (e.iv) {
        // a twin waiting at 30% for the other: hit the other one
        if (e.s === this.meId) this.effects.text(at.x, 3.2, at.z, '無敵：先打另一隻', 'dealt small');
        return;
      }
      if (e.s === this.meId) {
        this.effects.text(at.x, 3.2, at.z, `${e.a.toLocaleString()}${e.c ? '!' : ''}`, `dealt ${e.c ? 'crit' : ''} ${e.dot ? 'small' : ''}`);
        if (e.pos !== undefined) this.effects.text(at.x, 3.9, at.z, e.pos ? '身位成功' : '身位失敗', e.pos ? 'pos' : 'pos miss');
      }
      if (e.sk === LB_SLOT) this.effects.ring(at.x, at.z, RULES.lbDpsRadius, '#ff4d6d', 1);
      return;
    }
    if (e.t === this.meId || this.isFoe(e.s)) {
      const text = e.iv ? '無敵' : e.a === 0 && e.ab ? `吸收 ${e.ab.toLocaleString()}` : `-${e.a.toLocaleString()}`;
      if (e.t === this.meId) this.effects.text(at.x, 2.2, at.z, text, 'taken');
    }
    if (e.a >= 3000) this.avatars.get(e.t)?.hurt();
  }

  private onLimitBreak(id: string, role: 'tank' | 'healer' | 'dps', s: Snapshot): void {
    this.avatars.get(id)?.playLimitBreak(role);
    const name = this.names.get(id) ?? '';
    this.hud.announce(`${name}：${LIMIT_BREAKS[role].name}`, `lb ${role}`);
    this.audio.play('lb');
    const from = this.where(id);
    if (role === 'tank') this.effects.dome(from.x, from.z, 16, '#ffd34d');
    else if (role === 'healer') for (const p of s.p) this.effects.pillar(p.x, p.z, '#fff3b0', 1.4, 1);
  }

  // ------------------------------------------------------------- targets

  /** Selects an enemy or a party member (null clears it). */
  private pick(id: string | null): void {
    this.target = id;
    for (const [fid, f] of this.foes) f.view.setTargeted(fid === id);
    for (const [pid, a] of this.avatars) a.setPicked(pid === id ? 'ally' : null);
  }

  private clickPick(x: number, y: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const boxes: [THREE.Object3D, string][] = [];
    for (const e of this.last?.e ?? []) {
      const f = this.foes.get(e.i);
      if (f && hittable(e)) boxes.push([f.view.hitbox, e.i]);
    }
    for (const [id, a] of this.avatars) if (a.root.visible) boxes.push([a.hitbox, id]);
    const hits = this.raycaster.intersectObjects(boxes.map((b) => b[0]), false);
    const first = hits[0];
    if (!first) return;
    const id = boxes.find((b) => b[0] === first.object)?.[1];
    if (id) this.pick(id);
  }

  /** The enemies that can be attacked, nearest first. */
  private foesByDistance(s: Snapshot): SnapFoe[] {
    const me = this.me;
    const d = (e: SnapFoe) => (me ? Math.hypot(e.x - me.x, e.z - me.z) - FOES[e.kd].ring : 0);
    return s.e.filter(hittable).sort((a, b) => d(a) - d(b));
  }

  private nearestFoe(s: Snapshot): string | null {
    return this.foesByDistance(s)[0]?.i ?? null;
  }

  /** Tab: the next enemy, nearest first, round again after the last. */
  private cycleFoe(s: Snapshot): string | null {
    const list = this.foesByDistance(s);
    if (!list.length) return null;
    const k = list.findIndex((e) => e.i === this.target);
    return list[(k + 1) % list.length]!.i;
  }

  /** For the hotbar: is there something in range for each skill. */
  private slotStates(s: Snapshot): SlotState[] {
    const me = this.me;
    return this.myJob.skills.map((sk) => {
      if (!me) return 'ok';
      if (sk.target === 'self') return 'ok';
      if (sk.target === 'enemy') {
        const id = this.isFoe(this.target) ? this.target : this.nearestFoe(s);
        const e = s.e.find((x) => x.i === id);
        if (!e) return 'target';
        return reach(me.x, me.z, { x: e.x, z: e.z, r: FOES[e.kd].ring }) > sk.range ? 'range' : 'ok';
      }
      if (sk.target === 'dead') {
        const any = s.p.some((p) => p.d === 1 && reach(me.x, me.z, { x: p.x, z: p.z, r: RULES.playerRadius }) <= sk.range);
        return any ? 'ok' : 'target';
      }
      const t = s.p.find((p) => p.i === this.target);
      if (t && t.i !== this.meId && reach(me.x, me.z, { x: t.x, z: t.z, r: RULES.playerRadius }) > sk.range) return 'range';
      return 'ok';
    });
  }

  // ------------------------------------------------------------- input

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.hud.chatting || document.querySelector('.modal-back')) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const mv = MOVE_KEYS[e.code];
    if (mv) {
      e.preventDefault();
      this.held.add(mv);
      return;
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      if (this.last) this.pick(this.cycleFoe(this.last));
      return;
    }
    const fkey = /^F([1-8])$/.exec(e.code);
    if (fkey) {
      e.preventDefault();
      const id = this.hud.partyOrder[Number(fkey[1]) - 1];
      if (id) this.pick(id);
      return;
    }
    if (e.code === 'Escape') {
      this.pick(null);
      return;
    }
    const action = actionOf(this.bindings, e.code);
    if (!action) return;
    e.preventDefault();
    if (e.repeat && action !== 'skill1') return; // holding the basic skill keeps it going (see useSkill)
    switch (action) {
      case 'chat':
        this.held.clear();
        this.hud.openChat();
        return;
      case 'view':
        this.rig.toggleTop();
        return;
      case 'mute':
        toast(this.audio.toggleSfx() ? '音效：開' : '音效：關');
        return;
      case 'lb':
        this.useSkill(LB_SLOT);
        return;
      default: {
        const slot = SKILL_ACTIONS.indexOf(action);
        if (slot >= 0) this.useSkill(slot, e.repeat);
      }
    }
  };

  /** Sends a skill to the server with the target it should go to; the server has the last word. */
  private useSkill(slot: number, repeat = false): void {
    const s = this.last;
    if (!s || this.over) return;
    if (repeat) {
      // a held key repeats ~30 times a second: only ask once the GCD is about to come back
      const mine = s.p.find((p) => p.i === this.meId);
      if (!mine || mine.g[0] > RULES.queue || mine.c) return;
    }
    this.hud.pressSlot(slot);
    if (s.ph !== 1) return this.onDeny(slot, 'phase');
    if (this.dead) return this.onDeny(slot, 'dead');
    const sk: SkillInfo | null = slot === LB_SLOT ? null : this.myJob.skills[slot]!;
    const kind = sk ? sk.target : this.myJob.role === 'dps' ? 'enemy' : 'self';
    let tg: string | null = this.target;
    const targetIsAlly = !!this.target && !this.isFoe(this.target);
    const targetSnap: SnapPlayer | undefined = s.p.find((p) => p.i === this.target);
    if (kind === 'enemy') {
      if (!this.isFoe(this.target)) {
        tg = this.nearestFoe(s);
        if (tg) this.pick(tg); // attacking without a target picks the nearest enemy
      }
    } else if (kind === 'ally') {
      if (!targetIsAlly || targetSnap?.d) tg = store.get(AUTO_HEAL_KEY) === 'off' ? this.meId : null;
    } else if (kind === 'dead') {
      if (!targetIsAlly || !targetSnap?.d) tg = null;
    }
    // face what I attack or heal, as the server does
    const me = this.me;
    if (me && tg && tg !== this.meId && kind !== 'self') {
      const at = this.where(tg);
      me.f = faceTowards(me.x, me.z, at.x, at.z);
    }
    const [dx, dz] = this.inputDir();
    this.link.send({ t: 'use', s: slot, tg, dx: round2(dx), dz: round2(dz) });
  }

  private onKeyUp = (e: KeyboardEvent) => {
    const mv = MOVE_KEYS[e.code];
    if (mv) this.held.delete(mv);
  };

  private onBlur = () => this.held.clear();

  private onQuality = () => {
    this.renderer.setPixelRatio(pixelRatioFor(loadQuality()));
    this.fit();
  };

  private reloadKeys(): void {
    this.bindings = loadBindings();
    this.hud.setBindings(this.bindings);
  }

  private fit(): void {
    const w = this.root.clientWidth || window.innerWidth;
    const hgt = this.root.clientHeight || window.innerHeight;
    this.renderer.setSize(w, hgt);
    this.labels.setSize(w, hgt);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------- per frame

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    const time = now / 1000;
    this.moveMe(dt, now);

    // everyone else, one tick behind my own character (their snapshots are the newest only for the server)
    const t = this.snaps.length ? this.playback.at(now) - 1 : 0;
    const [a, b, k] = this.bracket(t);
    for (const [id, av] of this.avatars) {
      const pa = a?.p.find((p) => p.i === id);
      const pb = b?.p.find((p) => p.i === id);
      const p0 = pa ?? pb;
      const p1 = pb ?? pa;
      const latest = this.last?.p.find((p) => p.i === id);
      if (latest) {
        av.setDead(latest.d === 1);
        av.setShield(latest.sh > 0);
        av.setCasting(!!latest.c);
      }
      if (id === this.meId && this.me) {
        av.root.visible = true;
        av.update(this.me.x, this.me.z, this.me.f, this.me.moving || this.carried, dt, time, this.lift(latest));
        continue;
      }
      if (!p0 || !p1) {
        av.root.visible = false;
        continue;
      }
      av.root.visible = true;
      av.update(
        p0.x + (p1.x - p0.x) * k,
        p0.z + (p1.z - p0.z) * k,
        p0.f + angleDiff(p0.f, p1.f) * k,
        p0.m === 1 || p1.m === 1,
        dt,
        time,
        this.lift(p1),
      );
      av.setOffline(p1.dc === 1);
    }
    for (const [id, f] of this.foes) {
      const ea = a?.e.find((e) => e.i === id);
      const eb = b?.e.find((e) => e.i === id);
      const e0 = ea ?? eb ?? this.last?.e.find((e) => e.i === id);
      const e1 = eb ?? e0;
      if (e0 && e1) f.view.update(e0.x + (e1.x - e0.x) * k, e0.z + (e1.z - e0.z) * k, e0.f + angleDiff(e0.f, e1.f) * k, dt, time);
    }
    this.teles.update(null, (id) => this.drawnAt(id), now);
    this.effects.update(dt, time);

    const focus = this.focusAt ?? this.me ?? { x: 0, z: this.enc.arena.size * 0.55 };
    this.rig.update(focus.x, focus.z);
    for (const m of this.arena.waymarks) m.rotation.z = this.rig.yaw;
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);

    this.frames++;
    if (now - this.fpsFrom >= 1000) {
      this.hud.setFps(Math.round((this.frames * 1000) / (now - this.fpsFrom)));
      this.frames = 0;
      this.fpsFrom = now;
    }
  };

  /** Height of a jump (天降擊): an arc while the 滯空 status runs. */
  private lift(p: SnapPlayer | undefined): number {
    const st = p?.st?.find((x) => STATUS_IDS[x[0]] === 'airborne');
    if (!st) return 0;
    const total = Math.round(0.8 * TICK_RATE);
    const k = 1 - Math.max(0, st[1]) / total;
    return Math.sin(Math.PI * Math.min(1, Math.max(0, k))) * 3;
  }

  /** The camera-relative direction the movement keys point to (zero when none are held). */
  private inputDir(): [number, number] {
    if (this.over || this.hud.chatting || this.dead) return [0, 0];
    let ix = 0;
    let iz = 0;
    const [fx, fz] = this.rig.forward();
    const [rx, rz] = this.rig.right();
    if (this.held.has('f')) [ix, iz] = [ix + fx, iz + fz];
    if (this.held.has('b')) [ix, iz] = [ix - fx, iz - fz];
    if (this.held.has('r')) [ix, iz] = [ix + rx, iz + rz];
    if (this.held.has('l')) [ix, iz] = [ix - rx, iz - rz];
    const len = Math.hypot(ix, iz);
    return len > 0.001 ? [ix / len, iz / len] : [0, 0];
  }

  /** WASD relative to the camera; the character turns towards where it walks. Reports go out at the tick rate. */
  private moveMe(dt: number, now: number): void {
    const me = this.me;
    if (!me) return;
    if (this.carried || this.dead || this.stunned()) {
      me.moving = false;
      return;
    }
    const [ix, iz] = this.inputDir();
    me.moving = ix !== 0 || iz !== 0;
    if (me.moving) {
      const step = RULES.moveSpeed * dt;
      [me.x, me.z] = clampToArena(this.enc.arena, me.x + ix * step, me.z + iz * step);
      me.f += angleDiff(me.f, Math.atan2(ix, iz)) * Math.min(1, dt * 14);
    }
    if (this.over || now - this.sent.at < TICK_MS) return;
    const same =
      Math.abs(me.x - this.sent.x) <= 0.005 && Math.abs(me.z - this.sent.z) <= 0.005 && Math.abs(angleDiff(this.sent.f, me.f)) <= 0.02;
    if (same) return;
    this.sent = { x: me.x, z: me.z, f: me.f, at: now };
    this.link.send({ t: 'mv', x: round2(me.x), z: round2(me.z), f: round2(me.f) });
  }

  /** The two snapshots around tick `t`, and how far between them `t` is. */
  private bracket(t: number): [Snapshot | undefined, Snapshot | undefined, number] {
    const s = this.snaps;
    if (!s.length) return [undefined, undefined, 0];
    for (let i = s.length - 1; i >= 0; i--) {
      const a = s[i]!;
      if (a.k <= t) {
        const b = s[i + 1] ?? a;
        const span = b.k - a.k;
        return [a, b, span > 0 ? Math.min(1, (t - a.k) / span) : 0];
      }
    }
    return [s[0], s[0], 0];
  }
}
