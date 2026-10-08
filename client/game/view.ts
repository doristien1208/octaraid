import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RULES, TICK_MS } from '../../shared/constants';
import { encounterById, type Encounter } from '../../shared/encounters';
import { jobById } from '../../shared/jobs';
import type { C2S, GameResult, GameStartInfo, Snapshot } from '../../shared/protocol';
import { angleDiff, clampToArena } from '../../shared/sim/arena';
import type { Audio } from '../audio';
import { h, toast } from '../dom';
import { MOVE_KEYS, SKILL_ACTIONS, actionOf, loadBindings, type Bindings, type MoveKey } from '../keys';
import { loadQuality, pixelRatioFor, settingsModal } from '../ui/common';
import { buildArena, type ArenaView } from './arena';
import { CameraRig } from './camera';
import { Hud } from './hud';
import { Avatar, makeDummy } from './models';
import { Playback } from './playback';

/** Where the view sends its messages: the server, or the in-browser fight of the practice mode. */
export interface GameLink {
  send(m: C2S): void;
  leave(): void;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The 3D fight screen. My character moves locally at once (and reports its position); everyone else
 * is drawn from the server snapshots, a little in the past, smoothed by the playback clock.
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
  private readonly dummy: ReturnType<typeof makeDummy>;
  private readonly enc: Encounter;
  private readonly avatars = new Map<string, Avatar>();
  private readonly snaps: Snapshot[] = [];
  private readonly playback = new Playback();
  private readonly held = new Set<MoveKey>();
  private readonly resize: ResizeObserver;
  private bindings: Bindings = loadBindings();
  private me: { x: number; z: number; f: number; moving: boolean } | null = null;
  private sent = { x: NaN, z: NaN, f: NaN, at: 0 };
  private over = false;
  private raf = 0;
  private lastFrame = 0;
  private frames = 0;
  private fpsFrom = 0;
  private lastCount = -1;
  private skillHint = false;

  constructor(
    readonly info: GameStartInfo,
    private readonly meId: string,
    private readonly link: GameLink,
    private readonly audio: Audio,
  ) {
    this.enc = encounterById(info.enc);
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
    this.scene.add(this.arena.group);
    this.dummy = makeDummy(`木人（${this.enc.boss}）`);
    this.scene.add(this.dummy.root);
    for (const p of info.players) {
      const a = new Avatar(jobById(p.job), p.name, p.id === meId);
      a.root.visible = false; // until the first snapshot says where everyone is
      this.avatars.set(p.id, a);
      this.scene.add(a.root);
    }

    this.rig = new CameraRig(this.camera, canvas);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('octaraid:quality', this.onQuality);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(this.root);
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------- from the server

  onSnap(s: Snapshot): void {
    this.snaps.push(s);
    if (this.snaps.length > 90) this.snaps.shift();
    this.playback.observe(s.k, performance.now());
    if (!this.me) {
      const p = s.p.find((x) => x.i === this.meId);
      if (p) this.me = { x: p.x, z: p.z, f: p.f, moving: false };
    }
    const count = this.hud.onSnap(s);
    if (count !== this.lastCount) {
      if (count > 0 && count <= 5) this.audio.play('beep');
      if (count === 0 && this.lastCount > 0) this.audio.play('go');
      this.lastCount = count;
    }
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

  onEnd(result: GameResult): void {
    this.over = true;
    this.held.clear();
    this.hud.showResults(result);
    this.audio.play(result.reason === 'clear' ? 'win' : result.reason === 'test' ? 'chime' : 'lose');
  }

  addChat(name: string, text: string): void {
    this.hud.addChat(name, text);
  }

  setHost(host: boolean): void {
    this.hud.setHost(host);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('octaraid:quality', this.onQuality);
    this.resize.disconnect();
    this.rig.dispose();
    this.arena.dispose();
    this.dummy.dispose();
    for (const a of this.avatars.values()) a.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // browsers allow only a few WebGL contexts per page
    this.root.remove();
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
      e.preventDefault(); // kept for choosing targets (M2)
      return;
    }
    const action = actionOf(this.bindings, e.code);
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return;
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
      default: {
        const slot = SKILL_ACTIONS.indexOf(action);
        if (slot >= 0) this.hud.pressSlot(slot);
        if (!this.skillHint) {
          this.skillHint = true;
          toast('技能與極限技在下一版（M2）開放，這一版先測試移動與連線');
        }
      }
    }
  };

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
      if (id === this.meId && this.me) {
        av.root.visible = true;
        av.update(this.me.x, this.me.z, this.me.f, this.me.moving, dt, time);
        continue;
      }
      const pa = a?.p.find((p) => p.i === id);
      const pb = b?.p.find((p) => p.i === id);
      const p0 = pa ?? pb;
      const p1 = pb ?? pa;
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
      );
      av.setOffline(p1.dc === 1);
    }

    const focus = this.me ?? { x: 0, z: this.enc.arena.size * 0.55 };
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

  /** WASD relative to the camera; the character turns towards where it walks. Reports go out at the tick rate. */
  private moveMe(dt: number, now: number): void {
    const me = this.me;
    if (!me) return;
    let ix = 0;
    let iz = 0;
    if (!this.over && !this.hud.chatting) {
      const [fx, fz] = this.rig.forward();
      const [rx, rz] = this.rig.right();
      if (this.held.has('f')) [ix, iz] = [ix + fx, iz + fz];
      if (this.held.has('b')) [ix, iz] = [ix - fx, iz - fz];
      if (this.held.has('r')) [ix, iz] = [ix + rx, iz + rz];
      if (this.held.has('l')) [ix, iz] = [ix - rx, iz - rz];
    }
    const len = Math.hypot(ix, iz);
    me.moving = len > 0.001;
    if (me.moving) {
      const step = RULES.moveSpeed * dt;
      [me.x, me.z] = clampToArena(this.enc.arena, me.x + (ix / len) * step, me.z + (iz / len) * step);
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
