import { RULES, TICK_RATE, sec } from '../constants';
import type { Encounter } from '../encounters';
import { LB_SLOT, LIMIT_BREAKS, ROLE_HP, jobById, type Fx, type Job, type JobId, type Role, type SkillInfo } from '../jobs';
import type { DenyReason, EndReason, FightEvent, GameResult, PlayerStats, SnapStatus, Snapshot } from '../protocol';
import { Rng } from '../rng';
import { STATUS, STATUS_IDS, type StatusId } from '../status';
import { angleDiff, clampToArena, faceTowards, reach, sideOf, spawnPoints } from './arena';
import { PRACTICE } from './practice';

export interface StatusInst {
  id: StatusId;
  /** who put it there */
  src: string;
  /** the tick it ends; -1: lasts the whole fight (超越之力) or while standing in a zone */
  until: number;
  /** shield left, heal or potency per second, or stacks */
  v: number;
  zone?: boolean;
}

interface Cast {
  slot: number;
  start: number;
  end: number;
  target: string | null;
  /** where the caster stood: moving away cuts the cast */
  x: number;
  z: number;
}

interface Queued {
  slot: number;
  target: string | null;
  dx: number;
  dz: number;
  at: number;
}

/** A dash or a jump: the server moves the character, its client follows. */
interface Dash {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  t0: number;
  t1: number;
  /** the effects after a jump, carried out on landing */
  then?: { slot: number; fx: Fx[]; target: string };
}

export interface Fighter {
  id: string;
  name: string;
  job: Job;
  role: Role;
  x: number;
  z: number;
  f: number;
  hp: number;
  dead: boolean;
  statuses: StatusInst[];
  connected: boolean;
  /** tick of the last accepted step that actually moved */
  movedAt: number;
  /** server time (ms) of the last position report, -1 before the first */
  reportedAt: number;
  gcdAt: number;
  gcdLen: number;
  /** the tick each skill is ready again */
  ready: number[];
  combo: number;
  comboUntil: number;
  /** no skill can be used before this tick (animation lock) */
  lockUntil: number;
  cast: Cast | null;
  queued: Queued | null;
  dash: Dash | null;
  diedAt: number;
  /** weakness when last downed: 0 none, 1 衰弱, 2 瀕死 */
  diedWeak: number;
  autoRaised: boolean;
  stats: PlayerStats;
}

export interface FoeCast {
  name: string;
  m: 'buster' | 'raidwide';
  start: number;
  end: number;
  target: string | null;
}

export interface Foe {
  id: string;
  name: string;
  boss: boolean;
  x: number;
  z: number;
  f: number;
  r: number;
  hp: number;
  maxHp: number;
  statuses: StatusInst[];
  enmity: Map<string, number>;
  target: string | null;
  cast: FoeCast | null;
  autoAt: number;
}

export interface Zone {
  s: StatusId;
  owner: string;
  x: number;
  z: number;
  r: number;
  until: number;
}

export interface FightOptions {
  /** boss HP against the 4-player baseline */
  hpScale?: number;
  /** 超越之力 stacks */
  echo?: number;
  /** the dummy does not attack (offline practice with ?calm) */
  calm?: boolean;
  /** countdown before the pull, in ticks (the tests shorten it) */
  countdown?: number;
}

export type UseResult = 'ok' | 'queued' | DenyReason;

const r2 = (v: number) => Math.round(v * 100) / 100;
const STATUS_INDEX = new Map<StatusId, number>(STATUS_IDS.map((id, k) => [id, k]));
const TIMING: ReadonlySet<UseResult> = new Set(['casting', 'busy', 'cd', 'gcd']);

/**
 * The authoritative fight, stepped TICK_RATE times a second on the server (and in the browser for the
 * offline practice mode). Movement is reported by each client and checked here against the speed limit
 * and the arena; skills arrive as requests and are checked against cooldowns, range and targets.
 * Combat rules: section 四 of the design doc. The enemy is the training dummy until the bosses (M3).
 */
export class Fight {
  tick = 0;
  phase: 'countdown' | 'fight' | 'over' = 'countdown';
  countdown: number = RULES.countdown;
  fightTicks = 0;
  result: GameResult | null = null;
  /** Limit Break gauge, 0–100 */
  lb = 0;
  readonly players = new Map<string, Fighter>();
  readonly foes: Foe[] = [];
  readonly zones: Zone[] = [];
  readonly echo: number;
  /** the dummy does not attack (offline practice with ?calm); the tests switch it */
  calm: boolean;
  /** the party at the start, for the missing-role rules */
  readonly roles: Readonly<Record<Role, number>>;
  private readonly rng: Rng;
  private events: FightEvent[] = [];
  /** who is casting the Limit Break */
  private lbBy: string | null = null;

  constructor(
    readonly enc: Encounter,
    readonly hard: boolean,
    roster: readonly { id: string; name: string; job: JobId }[],
    readonly seed: number,
    opts: FightOptions = {},
  ) {
    this.rng = new Rng(seed);
    if (opts.countdown !== undefined) this.countdown = Math.max(1, Math.round(opts.countdown));
    this.echo = hard ? 0 : Math.max(0, Math.min(RULES.echoMax, Math.floor(opts.echo ?? 0)));
    this.calm = !!opts.calm;
    const roles: Record<Role, number> = { tank: 0, healer: 0, dps: 0 };
    const spots = spawnPoints(enc.arena, roster.length);
    roster.forEach((p, k) => {
      const job = jobById(p.job);
      roles[job.role]++;
      const [x, z] = spots[k]!;
      const fighter: Fighter = {
        id: p.id,
        name: p.name,
        job,
        role: job.role,
        x,
        z,
        f: Math.PI,
        hp: 0,
        dead: false,
        statuses: [],
        connected: true,
        movedAt: -999,
        reportedAt: -1,
        gcdAt: -999,
        gcdLen: RULES.gcd,
        ready: [0, 0, 0, 0, 0],
        combo: 0,
        comboUntil: -1,
        lockUntil: 0,
        cast: null,
        queued: null,
        dash: null,
        diedAt: -1,
        diedWeak: 0,
        autoRaised: false,
        stats: { id: p.id, dmg: 0, heal: 0, taken: 0, deaths: 0 },
      };
      if (this.echo) fighter.statuses.push({ id: 'echo', src: p.id, until: -1, v: this.echo });
      fighter.hp = this.maxHp(fighter);
      this.players.set(p.id, fighter);
    });
    this.roles = roles;
    const hp = Math.round((hard ? enc.hp.hard : enc.hp.normal) * (opts.hpScale ?? 1));
    this.foes.push({
      id: 'boss',
      name: PRACTICE.name,
      boss: true,
      x: 0,
      z: 0,
      f: 0, // facing south, towards the party
      r: PRACTICE.ring,
      hp,
      maxHp: hp,
      statuses: [],
      enmity: new Map(),
      target: null,
      cast: null,
      autoAt: 0,
    });
  }

  get enrageTicks(): number {
    return Math.round((this.hard ? this.enc.times.hard : this.enc.times.normal).enrage * TICK_RATE);
  }

  // ================================================================ input

  /**
   * A client reported where its character is. Steps longer than the speed allows are cut short and
   * positions outside the arena pulled back in; then the corrected position is returned so the client
   * can snap to it. Returns null when the report was accepted as is. Moving cuts a cast short.
   */
  move(id: string, x: number, z: number, f: number, nowMs: number): [number, number] | null {
    const p = this.players.get(id);
    if (!p || this.phase === 'over') return null;
    if (p.dash) return null; // the server moves it for now; the client follows the snapshots
    const gap = p.reportedAt < 0 ? RULES.moveGap : Math.min(RULES.moveGap, Math.max(0, (nowMs - p.reportedAt) / 1000));
    p.reportedAt = nowMs;
    if (p.dead) return Math.hypot(x - p.x, z - p.z) > 0.05 ? [p.x, p.z] : null;
    const allowed = RULES.moveSpeed * gap * RULES.moveSlack + RULES.moveSlackM;
    let dx = x - p.x;
    let dz = z - p.z;
    const d = Math.hypot(dx, dz);
    let corrected = false;
    if (d > allowed) {
      dx *= allowed / d;
      dz *= allowed / d;
      corrected = true;
    }
    const [nx, nz] = clampToArena(this.enc.arena, p.x + dx, p.z + dz);
    if (Math.hypot(nx - p.x - dx, nz - p.z - dz) > 0.05) corrected = true;
    if (Math.hypot(nx - p.x, nz - p.z) > 0.001) p.movedAt = this.tick;
    p.x = nx;
    p.z = nz;
    if (Number.isFinite(f)) p.f = f;
    const c = p.cast;
    if (c && Math.hypot(p.x - c.x, p.z - c.z) > RULES.castMove && c.end - this.tick > RULES.slidecast) this.interrupt(p);
    return corrected ? [p.x, p.z] : null;
  }

  /**
   * A skill (slot 0–4) or the Limit Break (slot 5). `target` is what the player has selected; when it does
   * not fit the skill, one is picked (the nearest enemy, the lowest ally in range, the nearest fallen ally).
   * (dx, dz): where the player is moving, for the dash. Pressing a skill just before it is ready queues it.
   */
  use(id: string, slot: number, req: { target?: string | null; dx?: number; dz?: number } = {}): UseResult {
    const p = this.players.get(id);
    if (!p || !Number.isInteger(slot) || slot < 0 || slot > LB_SLOT) return 'target';
    if (this.phase !== 'fight') return 'phase';
    if (p.dead) return 'dead';
    return this.tryUse(p, slot, req.target ?? null, req.dx ?? 0, req.dz ?? 0, true);
  }

  setConnected(id: string, on: boolean): void {
    const p = this.players.get(id);
    if (p) p.connected = on;
  }

  remove(id: string): void {
    const p = this.players.get(id);
    if (p && this.lbBy === id) this.lbBy = null;
    this.players.delete(id);
    for (const foe of this.foes) foe.enmity.delete(id);
  }

  end(reason: EndReason): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    const boss = this.foes.find((f) => f.boss);
    this.result = {
      reason,
      time: Math.round(this.fightTicks / TICK_RATE),
      bossHp: boss ? Math.round((boss.hp / boss.maxHp) * 1000) / 1000 : 0,
      stats: [...this.players.values()].map((p) => ({ ...p.stats, dmg: Math.round(p.stats.dmg), heal: Math.round(p.stats.heal), taken: Math.round(p.stats.taken) })),
    };
  }

  // ================================================================ the clock

  step(): void {
    if (this.phase === 'over') return;
    this.tick++;
    if (this.phase === 'countdown') {
      if (--this.countdown <= 0) this.pull();
      return;
    }
    this.fightTicks++;
    this.lb += RULES.lbPerSec / TICK_RATE;
    if (this.lb > 100 - 1e-6) this.lb = 100; // sums of 1/60 drift: snap to exactly full

    for (const p of this.players.values()) {
      if (p.dash) this.dashStep(p);
      if (p.cast && this.tick >= p.cast.end) this.finishCast(p);
    }
    for (const p of this.players.values()) this.runQueue(p);
    this.expire();
    if (this.fightTicks % RULES.dotTick === 0) this.overTime();
    this.autoRaise();
    for (const foe of this.foes) this.foeStep(foe);

    const boss = this.foes.find((f) => f.boss);
    if (boss && boss.hp <= 0) this.end('clear');
    else if (this.players.size && [...this.players.values()].every((p) => p.dead)) this.end('wipe');
    else if (this.fightTicks >= this.enrageTicks) this.end('enrage');
  }

  /** The countdown is over: enemies start with the tanks on top of their lists. */
  private pull(): void {
    this.phase = 'fight';
    for (const foe of this.foes) {
      for (const p of this.players.values()) foe.enmity.set(p.id, p.role === 'tank' ? 10 : 0);
      foe.autoAt = this.tick + sec(PRACTICE.autoEvery);
    }
  }

  // ================================================================ skills

  private tryUse(p: Fighter, slot: number, want: string | null, dx: number, dz: number, mayQueue: boolean): UseResult {
    const lb = slot === LB_SLOT;
    const skill = lb ? null : p.job.skills[slot]!;
    const t = this.tick;
    // what can never work right now is refused at once, so the player hears why
    if (lb && (this.lb < 100 || (this.lbBy !== null && this.lbBy !== p.id))) return 'lb';
    const kind = lb ? (p.role === 'dps' ? 'enemy' : 'self') : skill!.target;
    const range = lb ? Infinity : skill!.range;
    const target = this.pickTarget(p, kind, want, range);
    if (typeof target === 'string') return target;
    if (target && target !== p && reach(p.x, p.z, this.body(target)) > range + 1e-6) return 'range';
    // what still blocks it, and for how long: close enough to ready, it waits in the queue
    const waits: [DenyReason, number][] = [
      ['casting', p.cast ? p.cast.end - t : 0],
      ['busy', p.dash ? p.dash.t1 - t : 0],
      ['gcd', skill?.kind === 'gcd' ? p.gcdAt + p.gcdLen - t : 0],
      ['cd', skill?.cd ? p.ready[slot]! - t : 0],
    ];
    const lock = p.lockUntil - t;
    const blocked = waits.filter(([, w]) => w > 0);
    if (blocked.length || lock > 0) {
      const longest = Math.max(0, ...blocked.map(([, w]) => w));
      if (mayQueue && longest <= RULES.queue && lock <= RULES.lock) {
        p.queued = { slot, target: want, dx, dz, at: t };
        return 'queued';
      }
      return blocked.sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'casting';
    }
    this.begin(p, slot, skill, target, dx, dz);
    return 'ok';
  }

  /** Finds who a skill is aimed at, or why there is nobody. */
  private pickTarget(p: Fighter, kind: SkillInfo['target'], want: string | null, range: number): Fighter | Foe | null | DenyReason {
    if (kind === 'self') return null;
    const wanted = want ? (this.players.get(want) ?? this.foes.find((f) => f.id === want)) : undefined;
    if (kind === 'enemy') {
      if (wanted && 'enmity' in wanted && wanted.hp > 0) return wanted;
      let best: Foe | null = null;
      for (const foe of this.foes) if (foe.hp > 0 && (!best || reach(p.x, p.z, foe) < reach(p.x, p.z, best))) best = foe;
      return best ?? 'target';
    }
    if (kind === 'ally') {
      if (wanted && 'job' in wanted) return wanted.dead ? 'target' : wanted;
      // nobody chosen: the lowest share of HP in range, myself included
      let best: Fighter = p;
      for (const q of this.players.values()) {
        if (q.dead || reach(p.x, p.z, this.body(q)) > range) continue;
        if (q.hp / this.maxHp(q) < best.hp / this.maxHp(best)) best = q;
      }
      return best;
    }
    // a fallen ally
    if (wanted && 'job' in wanted) return wanted.dead ? wanted : 'target';
    let best: Fighter | null = null;
    for (const q of this.players.values())
      if (q.dead && (!best || reach(p.x, p.z, this.body(q)) < reach(p.x, p.z, this.body(best)))) best = q;
    return best ?? 'target';
  }

  /** Starts a skill: a cast, or at once. */
  private begin(p: Fighter, slot: number, skill: SkillInfo | null, target: Fighter | Foe | null, dx: number, dz: number): void {
    p.statuses = p.statuses.filter((s) => !STATUS[s.id].breakOnAction);
    if (target && target !== p) p.f = faceTowards(p.x, p.z, target.x, target.z);
    let castTicks: number;
    if (!skill) {
      castTicks = sec(LIMIT_BREAKS[p.role].cast);
      this.lbBy = p.id;
    } else castTicks = this.castTicks(p, skill);
    if (skill?.kind === 'gcd') {
      p.gcdAt = this.tick;
      p.gcdLen = Math.max(this.gcdTicks(p), castTicks);
    }
    if (castTicks > 0) {
      p.cast = { slot, start: this.tick, end: this.tick + castTicks, target: target?.id ?? null, x: p.x, z: p.z };
      this.emit({ k: 'cast', i: p.id, s: slot, t: target?.id, n: castTicks });
      return;
    }
    this.execute(p, slot, target, dx, dz, false);
  }

  private castTicks(p: Fighter, skill: SkillInfo): number {
    if (!skill.cast) return 0;
    if (skill.spell) {
      const swift = p.statuses.findIndex((s) => STATUS[s.id].swift);
      if (swift >= 0) {
        p.statuses.splice(swift, 1);
        return 0;
      }
    }
    let cut = 0;
    if (skill.spell) for (const s of p.statuses) cut = Math.max(cut, STATUS[s.id].castCut ?? 0);
    return sec(skill.cast * (1 - cut));
  }

  private gcdTicks(p: Fighter): number {
    let g = RULES.gcd;
    for (const s of p.statuses) {
      const v = STATUS[s.id].gcd;
      if (v) g = Math.min(g, sec(v));
    }
    return g;
  }

  private finishCast(p: Fighter): void {
    const c = p.cast!;
    p.cast = null;
    const lb = c.slot === LB_SLOT;
    const skill = lb ? null : p.job.skills[c.slot]!;
    const target = c.target ? (this.players.get(c.target) ?? this.foes.find((f) => f.id === c.target) ?? null) : null;
    // the target may have changed while the cast ran: a dead enemy or ally, or a raised one
    const kind = lb ? (p.role === 'dps' ? 'enemy' : 'self') : skill!.target;
    const ok =
      kind === 'self' ||
      (target !== null &&
        (kind === 'enemy' ? 'enmity' in target && target.hp > 0 : kind === 'ally' ? 'job' in target && !target.dead : 'job' in target && target.dead));
    if (!ok) {
      if (lb) this.lbBy = null;
      this.emit({ k: 'intr', i: p.id });
      p.lockUntil = this.tick + RULES.castLock;
      return;
    }
    this.execute(p, c.slot, target, 0, 0, true);
  }

  /** Moving cut a cast short: nothing happens, the GCD comes back, a Limit Break keeps its gauge. */
  private interrupt(p: Fighter): void {
    const c = p.cast;
    if (!c) return;
    p.cast = null;
    if (c.slot === LB_SLOT) this.lbBy = null;
    else if (p.job.skills[c.slot]!.kind === 'gcd') p.gcdAt = -999;
    this.emit({ k: 'intr', i: p.id });
  }

  private execute(p: Fighter, slot: number, target: Fighter | Foe | null, dx: number, dz: number, afterCast: boolean): void {
    p.lockUntil = this.tick + (afterCast ? RULES.castLock : RULES.lock);
    if (slot === LB_SLOT) {
      this.limitBreak(p, target);
      return;
    }
    const skill = p.job.skills[slot]!;
    let fx = skill.fx;
    let step: number | undefined;
    if (skill.combo) {
      if (this.tick > p.comboUntil) p.combo = 0;
      step = p.combo;
      fx = skill.combo[step]!;
      p.combo = (p.combo + 1) % 3;
      p.comboUntil = this.tick + RULES.comboWindow;
    }
    if (skill.cd) p.ready[slot] = this.tick + sec(skill.cd);
    this.emit({ k: 'use', i: p.id, s: slot, t: target?.id, st: step });
    this.runFx(p, slot, fx, target, dx, dz);
  }

  private runFx(p: Fighter, slot: number, list: readonly Fx[], target: Fighter | Foe | null, dx: number, dz: number): void {
    const foe = target && 'enmity' in target ? target : null;
    const ally = target && 'job' in target ? target : null;
    for (let i = 0; i < list.length; i++) {
      const fx = list[i]!;
      switch (fx.k) {
        case 'hit': {
          if (!foe || foe.hp <= 0) break;
          let p0 = fx.p;
          let pos: 0 | 1 | undefined;
          if (fx.rear || fx.flank) {
            const side = sideOf(foe, p.x, p.z);
            const bonus = side === 'rear' ? fx.rear : side === 'flank' ? fx.flank : undefined;
            pos = bonus ? 1 : 0;
            p0 += bonus ?? 0;
          }
          this.damageFoe(p, foe, p0, slot, { pos });
          break;
        }
        case 'circle': {
          const cx = fx.at === 'me' ? p.x : foe?.x;
          const cz = fx.at === 'me' ? p.z : foe?.z;
          if (cx === undefined || cz === undefined) break;
          for (const e of this.foes) if (e.hp > 0 && reach(cx, cz, e) <= fx.r) this.damageFoe(p, e, fx.p, slot, { enmity: fx.enmity });
          break;
        }
        case 'cone': {
          for (const e of this.foes) {
            if (e.hp <= 0 || reach(p.x, p.z, e) > fx.r) continue;
            const off = Math.abs(angleDiff(p.f, faceTowards(p.x, p.z, e.x, e.z)));
            const d = Math.hypot(e.x - p.x, e.z - p.z);
            // the ring counts: an enemy whose ring reaches into the fan is hit
            if (d <= e.r || off <= (fx.deg * Math.PI) / 360 + Math.asin(Math.min(1, e.r / d))) this.damageFoe(p, e, fx.p, slot, {});
          }
          break;
        }
        case 'line': {
          const ux = Math.sin(p.f);
          const uz = Math.cos(p.f);
          for (const e of this.foes) {
            if (e.hp <= 0) continue;
            const vx = e.x - p.x;
            const vz = e.z - p.z;
            const along = vx * ux + vz * uz;
            const across = Math.abs(vx * uz - vz * ux);
            if (along >= -e.r && along <= fx.len + e.r && across <= fx.w / 2 + e.r) this.damageFoe(p, e, fx.p, slot, {});
          }
          break;
        }
        case 'dot':
          if (foe && foe.hp > 0) this.addStatus(foe, { id: fx.s, src: p.id, until: this.tick + sec(fx.dur), v: fx.p }, true);
          break;
        case 'heal':
          if (ally) this.heal(p, ally, fx.amount, true);
          break;
        case 'healFull':
          if (ally) this.heal(p, ally, this.maxHp(ally), false);
          break;
        case 'healSelf':
          this.heal(p, p, this.maxHp(p) * fx.pct, false);
          break;
        case 'partyHeal':
          for (const q of this.near(p, fx.r)) this.heal(p, q, fx.amount, true);
          break;
        case 'shield':
          if (ally) this.addShield(p, ally, fx.s, fx.amount, fx.dur);
          break;
        case 'partyShield':
          for (const q of this.near(p, fx.r)) this.addShield(p, q, fx.s, fx.amount, fx.dur);
          break;
        case 'buff': {
          const who = fx.who === 'me' ? [p] : fx.who === 'target' ? (ally ? [ally] : []) : fx.r ? this.near(p, fx.r) : this.living();
          for (const q of who) this.addStatus(q, { id: fx.s, src: p.id, until: this.tick + sec(fx.dur), v: fx.v ?? 0 }, false);
          break;
        }
        case 'zone': {
          const old = this.zones.findIndex((z) => z.owner === p.id && z.s === fx.s);
          if (old >= 0) this.zones.splice(old, 1);
          this.zones.push({ s: fx.s, owner: p.id, x: p.x, z: p.z, r: fx.r, until: this.tick + sec(fx.dur) });
          this.applyZones();
          break;
        }
        case 'provoke':
          if (foe) this.provoke(p, foe);
          break;
        case 'raise':
          if (ally) this.raise(ally, p.id, 'skill');
          break;
        case 'dash': {
          let ux: number;
          let uz: number;
          if (fx.dir === 'move') {
            const len = Math.hypot(dx, dz);
            [ux, uz] = len > 0.01 ? [dx / len, dz / len] : [Math.sin(p.f), Math.cos(p.f)];
          } else {
            const from = foe ?? this.nearestFoe(p);
            if (from) {
              const d = Math.hypot(p.x - from.x, p.z - from.z) || 1;
              [ux, uz] = [(p.x - from.x) / d, (p.z - from.z) / d];
            } else [ux, uz] = [-Math.sin(p.f), -Math.cos(p.f)];
          }
          const [x1, z1] = clampToArena(this.enc.arena, p.x + ux * fx.dist, p.z + uz * fx.dist);
          this.startDash(p, x1, z1, fx.dur);
          if (fx.dir === 'move') p.f = Math.atan2(ux, uz);
          break;
        }
        case 'leap': {
          if (!foe) return;
          // land at the edge of the target's ring, on my side of it
          const d = Math.hypot(p.x - foe.x, p.z - foe.z) || 1;
          const edge = Math.max(0, foe.r - 0.2);
          const [x1, z1] = clampToArena(this.enc.arena, foe.x + ((p.x - foe.x) / d) * edge, foe.z + ((p.z - foe.z) / d) * edge);
          this.startDash(p, x1, z1, fx.dur);
          p.dash!.then = { slot, fx: list.slice(i + 1), target: foe.id };
          this.addStatus(p, { id: 'airborne', src: p.id, until: this.tick + sec(fx.dur), v: 0 }, false);
          return;
        }
      }
    }
  }

  private startDash(p: Fighter, x1: number, z1: number, dur: number): void {
    p.cast = null;
    p.dash = { x0: p.x, z0: p.z, x1, z1, t0: this.tick, t1: this.tick + Math.max(1, sec(dur)) };
    p.movedAt = this.tick;
  }

  private dashStep(p: Fighter): void {
    const d = p.dash!;
    const k = Math.min(1, (this.tick - d.t0) / (d.t1 - d.t0));
    p.x = d.x0 + (d.x1 - d.x0) * k;
    p.z = d.z0 + (d.z1 - d.z0) * k;
    p.movedAt = this.tick;
    if (k < 1) return;
    p.dash = null;
    p.reportedAt = -1; // the client restarts its reports from here
    if (d.then) {
      const foe = this.foes.find((f) => f.id === d.then!.target);
      if (foe && foe.hp > 0) {
        p.f = faceTowards(p.x, p.z, foe.x, foe.z);
        this.runFx(p, d.then.slot, d.then.fx, foe, 0, 0);
      }
    }
  }

  private runQueue(p: Fighter): void {
    const q = p.queued;
    if (!q) return;
    if (p.dead || this.tick - q.at > RULES.queue + RULES.lock) {
      p.queued = null;
      return;
    }
    const r = this.tryUse(p, q.slot, q.target, q.dx, q.dz, false);
    if (r === 'ok' || !TIMING.has(r)) p.queued = null;
  }

  // ================================================================ the Limit Break

  private limitBreak(p: Fighter, target: Fighter | Foe | null): void {
    this.lb = 0;
    this.lbBy = null;
    this.emit({ k: 'lb', i: p.id, r: p.role });
    if (p.role === 'tank') {
      for (const q of this.living()) this.addStatus(q, { id: 'ironVow', src: p.id, until: this.tick + RULES.lbTank, v: 0 }, false);
    } else if (p.role === 'healer') {
      for (const q of this.players.values()) {
        if (q.dead) this.raise(q, p.id, 'lb');
        else this.heal(p, q, this.maxHp(q), false);
      }
    } else {
      const at = target && 'enmity' in target ? target : this.nearestFoe(p);
      if (!at) return;
      for (const e of this.foes) {
        if (e.hp <= 0 || reach(at.x, at.z, e) > RULES.lbDpsRadius) continue;
        const dmg = Math.round(e.maxHp * (e.boss ? RULES.lbDpsBoss : RULES.lbDpsAdd));
        this.dealFoe(p, e, dmg, LB_SLOT, {});
      }
    }
  }

  // ================================================================ damage, healing, statuses

  private damageFoe(p: Fighter, e: Foe, potency: number, slot: number, opts: { enmity?: number; pos?: 0 | 1; dot?: boolean }): void {
    let amount = potency * RULES.potency * (1 + (this.rng.next() * 2 - 1) * RULES.variance);
    const crit = this.rng.next() < RULES.critRate;
    if (crit) amount *= RULES.critMul;
    amount *= this.damageMul(p);
    this.dealFoe(p, e, Math.max(1, Math.round(amount)), slot, { ...opts, crit });
  }

  private dealFoe(p: Fighter, e: Foe, amount: number, slot: number, opts: { enmity?: number; pos?: 0 | 1; dot?: boolean; crit?: boolean }): void {
    if (e.hp <= 0) return;
    const dealt = Math.min(e.hp, amount);
    e.hp -= dealt;
    p.stats.dmg += dealt;
    if (!p.dead) e.enmity.set(p.id, (e.enmity.get(p.id) ?? 0) + dealt * (p.role === 'tank' ? RULES.enmityTank : 1) * (opts.enmity ?? 1));
    this.emit({ k: 'dmg', s: p.id, t: e.id, a: amount, c: opts.crit ? 1 : undefined, sk: slot, pos: opts.pos, dot: opts.dot ? 1 : undefined });
    const steal = this.statusSum(p, 'lifesteal');
    if (steal > 0 && !p.dead) this.heal(p, p, dealt * steal, false);
  }

  /** An enemy (or the fight itself, src null) hurts a player. */
  private damagePlayer(q: Fighter, raw: number, src: Foe | null): void {
    if (q.dead) return;
    if (q.statuses.some((s) => STATUS[s.id].invuln)) {
      this.emit({ k: 'dmg', s: src?.id ?? null, t: q.id, a: 0, iv: 1 });
      return;
    }
    let amount = raw;
    for (const s of q.statuses) {
      const mit = STATUS[s.id].mit;
      if (mit) amount *= 1 - mit;
    }
    amount = Math.round(amount);
    let absorbed = 0;
    for (const s of q.statuses) {
      if (!STATUS[s.id].shield || amount <= 0) continue;
      const take = Math.min(s.v, amount);
      s.v -= take;
      amount -= take;
      absorbed += take;
    }
    q.statuses = q.statuses.filter((s) => !STATUS[s.id].shield || s.v > 0);
    if (q.statuses.some((s) => STATUS[s.id].floor) && q.hp - amount < 1) amount = Math.max(0, q.hp - 1);
    q.hp -= amount;
    q.stats.taken += amount + absorbed;
    this.emit({ k: 'dmg', s: src?.id ?? null, t: q.id, a: amount, ab: absorbed || undefined });
    if (q.hp <= 0) this.die(q);
  }

  /** Heals a player; returns the HP actually restored. Healing makes enmity on every enemy. */
  private heal(src: Fighter | null, q: Fighter, raw: number, varies: boolean, hot = false): number {
    if (q.dead) return 0;
    let amount = raw * (src ? this.echoMul(src) : 1);
    let crit = false;
    if (varies) {
      amount *= 1 + (this.rng.next() * 2 - 1) * RULES.variance;
      crit = this.rng.next() < RULES.critRate;
      if (crit) amount *= RULES.critMul;
    }
    amount = Math.round(amount);
    const eff = Math.max(0, Math.min(amount, this.maxHp(q) - q.hp));
    q.hp += eff;
    if (src) {
      src.stats.heal += eff;
      const foes = this.foes.filter((f) => f.hp > 0);
      if (!src.dead) for (const f of foes) f.enmity.set(src.id, (f.enmity.get(src.id) ?? 0) + (eff * RULES.enmityHeal) / foes.length);
    }
    if (amount > 0) this.emit({ k: 'heal', s: src?.id ?? null, t: q.id, a: amount, c: crit ? 1 : undefined, hot: hot ? 1 : undefined });
    return eff;
  }

  private addShield(src: Fighter, q: Fighter, id: StatusId, amount: number, dur: number): void {
    if (q.dead) return;
    this.addStatus(q, { id, src: src.id, until: this.tick + sec(dur), v: Math.round(amount * this.echoMul(src)) }, false);
  }

  /**
   * Puts a status on a player or an enemy. The same status refreshes rather than stacks; damage over time
   * is kept per source, so two lancers both bleed the boss.
   */
  private addStatus(on: Fighter | Foe, s: StatusInst, perSource: boolean): void {
    const k = on.statuses.findIndex((x) => x.id === s.id && (!perSource || x.src === s.src));
    if (k >= 0) on.statuses.splice(k, 1);
    on.statuses.push(s);
    if ('job' in on && STATUS[s.id].maxHp) on.hp = Math.min(on.hp, this.maxHp(on));
  }

  private provoke(p: Fighter, foe: Foe): void {
    let top = 0;
    for (const [id, v] of foe.enmity) if (id !== p.id) top = Math.max(top, v);
    foe.enmity.set(p.id, top * (1 + RULES.provokeLead) + 10);
  }

  private die(q: Fighter): void {
    q.hp = 0;
    q.dead = true;
    q.diedAt = this.tick;
    q.stats.deaths++;
    q.diedWeak = q.statuses.some((s) => s.id === 'weak' || s.id === 'brink') ? 1 : 0;
    q.statuses = q.statuses.filter((s) => s.id === 'echo');
    if (this.lbBy === q.id) this.lbBy = null;
    q.cast = null;
    q.queued = null;
    q.dash = null;
    for (const foe of this.foes) foe.enmity.delete(q.id);
    this.emit({ k: 'die', i: q.id });
  }

  /** skill: 25% HP and weakness; lb: full HP, no weakness; auto: the no-healer rule, like a skill. */
  private raise(q: Fighter, by: string | null, how: 'skill' | 'lb' | 'auto'): void {
    if (!q.dead) return;
    q.dead = false;
    q.statuses = q.statuses.filter((s) => s.id === 'echo');
    if (how !== 'lb') q.statuses.push({ id: q.diedWeak ? 'brink' : 'weak', src: by ?? q.id, until: this.tick + RULES.weakness, v: 0 });
    q.statuses.push({ id: 'risen', src: by ?? q.id, until: this.tick + RULES.risen, v: 0 });
    q.hp = how === 'lb' ? this.maxHp(q) : Math.round(this.maxHp(q) * RULES.raiseHp);
    q.lockUntil = this.tick + RULES.lock;
    q.reportedAt = -1;
    for (const foe of this.foes) foe.enmity.set(q.id, 0);
    this.emit({ k: 'raise', i: q.id, by });
  }

  /** Statuses and zones that ran out; zone statuses follow who stands where. */
  private expire(): void {
    const t = this.tick;
    for (let k = this.zones.length - 1; k >= 0; k--) if (this.zones[k]!.until <= t) this.zones.splice(k, 1);
    for (const p of this.players.values()) {
      const before = p.statuses.length;
      p.statuses = p.statuses.filter((s) => s.until < 0 || s.until > t);
      if (p.statuses.length !== before) p.hp = Math.min(p.hp, this.maxHp(p));
    }
    for (const foe of this.foes) foe.statuses = foe.statuses.filter((s) => s.until < 0 || s.until > t);
    this.applyZones();
  }

  private applyZones(): void {
    for (const p of this.players.values()) {
      p.statuses = p.statuses.filter((s) => !s.zone);
      if (p.dead) continue;
      for (const z of this.zones) {
        if (z.s === 'ley' && z.owner !== p.id) continue; // 魔力湧泉 only helps its caster
        if (Math.hypot(p.x - z.x, p.z - z.z) > z.r || p.statuses.some((s) => s.id === z.s)) continue;
        p.statuses.push({ id: z.s, src: z.owner, until: -1, v: 0, zone: true });
      }
    }
  }

  /** Every 3 seconds: damage and healing over time, and the no-healer regeneration. */
  private overTime(): void {
    const n = RULES.dotTick / TICK_RATE;
    for (const foe of this.foes) {
      for (const s of foe.statuses) {
        if (!STATUS[s.id].dot) continue;
        const src = this.players.get(s.src);
        if (src && foe.hp > 0) this.damageFoe(src, foe, s.v * n, 1, { dot: true });
      }
    }
    for (const p of this.players.values()) {
      if (p.dead) continue;
      for (const s of [...p.statuses]) {
        if (STATUS[s.id].hot) this.heal(this.players.get(s.src) ?? null, p, s.v * n, false, true);
      }
      for (const z of this.zones) {
        if (z.s === 'sanctuary' && Math.hypot(p.x - z.x, p.z - z.z) <= z.r) this.heal(this.players.get(z.owner) ?? null, p, 150 * n, false, true);
      }
      if (!this.roles.healer) this.heal(null, p, this.maxHp(p) * RULES.noHealerRegen * n, false, true);
    }
  }

  /** Without a healer, a fallen player gets up by themselves after 20 seconds, once per fight. */
  private autoRaise(): void {
    if (this.roles.healer) return;
    for (const p of this.players.values()) {
      if (p.dead && !p.autoRaised && this.tick - p.diedAt >= RULES.autoRaise) {
        p.autoRaised = true;
        this.raise(p, null, 'auto');
      }
    }
  }

  // ================================================================ the enemy

  private foeStep(foe: Foe): void {
    if (foe.hp <= 0) return;
    const top = this.topOf(foe);
    foe.target = top?.id ?? null;
    if (top) {
      const turn = angleDiff(foe.f, faceTowards(foe.x, foe.z, top.x, top.z));
      const max = 6 / TICK_RATE;
      foe.f += Math.max(-max, Math.min(max, turn));
    }
    if (this.calm) return;
    const diff = this.hard ? 'hard' : 'normal';
    const scale = this.roles.tank ? 1 : RULES.noTankDamage;
    if (foe.cast) {
      if (this.tick < foe.cast.end) return;
      const c = foe.cast;
      foe.cast = null;
      foe.autoAt = this.tick + sec(PRACTICE.autoEvery);
      const move = PRACTICE.moves.find((m) => m.name === c.name)!;
      this.emit({ k: 'boss', i: foe.id, n: c.name, m: c.m, t: c.target ?? undefined });
      if (c.m === 'buster') {
        const victim = c.target ? this.players.get(c.target) : undefined;
        if (victim) this.damagePlayer(victim, move.dmg[diff] * scale, foe);
      } else for (const q of this.living()) this.damagePlayer(q, move.dmg[diff], foe);
      return;
    }
    for (const m of PRACTICE.moves) {
      const first = sec(m.first);
      if (this.fightTicks >= first && (this.fightTicks - first) % sec(m.every) === 0) {
        const n = sec(m.cast);
        foe.cast = { name: m.name, m: m.m, start: this.tick, end: this.tick + n, target: m.m === 'buster' ? (top?.id ?? null) : null };
        this.emit({ k: 'bcast', i: foe.id, n: m.name, m: m.m, t: foe.cast.target ?? undefined, d: n });
        return;
      }
    }
    if (top && this.tick >= foe.autoAt) {
      foe.autoAt = this.tick + sec(PRACTICE.autoEvery);
      this.emit({ k: 'boss', i: foe.id, n: '攻擊', m: 'auto', t: top.id });
      this.damagePlayer(top, PRACTICE.auto[diff] * scale, foe);
    }
  }

  /** Top of an enemy's enmity list among the living; with nobody on it, the nearest player. */
  topOf(foe: Foe): Fighter | null {
    let best: Fighter | null = null;
    let bestV = -1;
    for (const [id, v] of foe.enmity) {
      const p = this.players.get(id);
      if (p && !p.dead && v > bestV) {
        best = p;
        bestV = v;
      }
    }
    if (best) return best;
    for (const p of this.players.values())
      if (!p.dead && (!best || Math.hypot(p.x - foe.x, p.z - foe.z) < Math.hypot(best.x - foe.x, best.z - foe.z))) best = p;
    return best;
  }

  // ================================================================ helpers

  maxHp(p: Fighter): number {
    let mul = 1 + this.echo * RULES.echoStep;
    for (const s of p.statuses) mul += STATUS[s.id].maxHp ?? 0;
    return Math.round(ROLE_HP[p.role] * mul);
  }

  private damageMul(p: Fighter): number {
    let mul = this.echoMul(p);
    for (const s of p.statuses) {
      const d = STATUS[s.id].dmg;
      if (d) mul *= 1 + d;
    }
    return mul;
  }

  private echoMul(p: Fighter): number {
    return p.statuses.some((s) => s.id === 'echo') ? 1 + this.echo * RULES.echoStep : 1;
  }

  private statusSum(p: Fighter, key: 'lifesteal'): number {
    let v = 0;
    for (const s of p.statuses) v += STATUS[s.id][key] ?? 0;
    return v;
  }

  private body(t: Fighter | Foe): { x: number; z: number; r: number } {
    return 'enmity' in t ? t : { x: t.x, z: t.z, r: RULES.playerRadius };
  }

  private living(): Fighter[] {
    return [...this.players.values()].filter((p) => !p.dead);
  }

  private near(p: Fighter, r: number): Fighter[] {
    return this.living().filter((q) => Math.hypot(q.x - p.x, q.z - p.z) <= r);
  }

  private nearestFoe(p: Fighter): Foe | null {
    let best: Foe | null = null;
    for (const f of this.foes) if (f.hp > 0 && (!best || reach(p.x, p.z, f) < reach(p.x, p.z, best))) best = f;
    return best;
  }

  private emit(e: FightEvent): void {
    this.events.push(e);
  }

  // ================================================================ snapshot

  snapshot(): Snapshot {
    const t = this.tick;
    const st = (list: StatusInst[]): SnapStatus[] | undefined =>
      list.length ? list.map((s) => [STATUS_INDEX.get(s.id)!, s.until < 0 ? -1 : s.until - t, Math.round(s.v)]) : undefined;
    const ev = this.events;
    this.events = [];
    return {
      k: t,
      ph: this.phase === 'countdown' ? 0 : this.phase === 'fight' ? 1 : 2,
      cd: this.countdown,
      el: this.fightTicks,
      lb: Math.floor(this.lb * 10),
      p: [...this.players.values()].map((p) => ({
        i: p.id,
        x: r2(p.x),
        z: r2(p.z),
        f: r2(p.f),
        m: t - p.movedAt <= 4 ? 1 : 0,
        dc: p.connected ? 0 : 1,
        hp: Math.round(p.hp),
        mh: this.maxHp(p),
        sh: p.statuses.reduce((n, s) => n + (STATUS[s.id].shield ? s.v : 0), 0),
        d: p.dead ? 1 : 0,
        c: p.cast ? [p.cast.slot, p.cast.end - t, p.cast.end - p.cast.start] : undefined,
        st: st(p.statuses),
        fm: p.dash ? 1 : undefined,
        g: [Math.max(0, p.gcdAt + p.gcdLen - t), p.gcdLen],
        cd: p.ready.map((r) => Math.max(0, r - t)),
        cb: t > p.comboUntil ? 0 : p.combo,
      })),
      e: this.foes.map((f) => ({
        i: f.id,
        x: r2(f.x),
        z: r2(f.z),
        f: r2(f.f),
        hp: Math.round(f.hp),
        mh: f.maxHp,
        t: f.target,
        c: f.cast ? [f.cast.name, f.cast.end - t, f.cast.end - f.cast.start] : undefined,
        st: st(f.statuses),
        ag: [...f.enmity.entries()]
          .filter(([id]) => this.players.get(id)?.dead === false)
          .sort((a, b) => b[1] - a[1])
          .map(([id]) => id),
      })),
      zn: this.zones.length
        ? this.zones.map((z) => ({ s: STATUS_INDEX.get(z.s)!, o: z.owner, x: r2(z.x), z: r2(z.z), r: z.r, l: z.until - t }))
        : undefined,
      ev: ev.length ? ev : undefined,
    };
  }
}
