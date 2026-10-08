import { RULES, sec } from '../constants';
import type { FoeKind } from '../bosses/foes';
import type { FightEvent } from '../protocol';
import { clampToArena, faceTowards } from './arena';
import type { Fight, Fighter, Foe } from './fight';
import { checker, hidden, inside, type Pillar, type Shape, type TeleColor } from './mech';

/** Where a mechanic comes from: the main boss (default) or its twin (雙子機神). */
type Src = { src?: 'twin' };

/**
 * One attack in a boss script (the mechanic library, section 六 of the design doc). Damage numbers are
 * for the difficulty the script was built for. Seconds; `delay` moves the hit after the end of the cast.
 */
export type MechDef = Src &
  (
    | /** everyone takes it: top up and mitigate */ { k: 'raidwide'; dmg: number }
    /**
     * the top of the enmity list takes it (rank 2: the second, e.g. 凍核's half of 雙死刑); with 2 hits the
     * second goes to whoever is top then (tank swap)
     */
    | { k: 'buster'; dmg: number; hits?: number; gap?: number; rank?: number }
    /** a circle around the boss (鋼鐵): get out */
    | { k: 'chariot'; r: number; dmg: number; delay?: number }
    /** everything but a circle around the boss (月環): get in */
    | { k: 'donut'; r0: number; dmg: number; delay?: number }
    /** a fan in front of the boss, aimed when the cast starts */
    | { k: 'cone'; deg: number; dmg: number }
    /** random circles in waves; nearBoss puts that many of the first wave next to the boss and the rest of that wave out of the middle */
    | { k: 'rocks'; r: number; dmg: number; count: number; waves: number; gap: number; nearBoss?: number }
    /** parallel strips across the arena at these offsets from the centre, one wave after another */
    | { k: 'lines'; w: number; dmg: number; waves: number[][]; gap: number }
    /** a circle on each marked player: keep away from each other */
    | { k: 'spread'; r: number; dmg: number; count: number | 'all' }
    /**
     * a circle on each marked player that splits `dmg` × the expected number of people: gather in.
     * on 'top': one stack on the tank for exactly `want` people (分攤死刑): more than that, the extra get hurt too
     */
    | { k: 'stack'; r: number; dmg: number; groups: number; on?: 'top'; want?: number }
    /** pushes everyone away from the boss; where the arena edge is a cliff, off it means down */
    | { k: 'knockback'; dist: number }
    /** one player is shut in rock: break it within `time` or they go down; `hp` per player free to help */
    | { k: 'prison'; hp: number; time: number }
    /**
     * adds: kill them within `time` or each one left explodes for `boom`; together: the first to fall gets up
     * again unless the rest follow within 10 s; attack: what each one does meanwhile
     */
    | { k: 'adds'; kind: FoeKind; at: [number, number][]; hp: number; auto: number; time: number; boom: number; together?: boolean; attack?: AddAttack }
    /** the boss leaps (to a point, during the last second of the cast); land: a circle where it comes down */
    | { k: 'jump'; to?: [number, number]; land?: { r: number; dmg: number } }
    /** pairs of players tied together: be at least `dist` apart when it ends (寒冰鎖鏈) */
    | { k: 'tether'; pairs: number; dist: number; dmg: number }
    /** towers (`count` for 4 players, scaled): `need` people in each when they go off, or they blow up on everyone */
    | { k: 'tower'; count: number; need: number; r: number; dmg: number; fail: number; ring?: number }
    /** exaflares: circles rolling across the arena in lanes, one step every `gap` seconds, every other lane the other way */
    | { k: 'exaflare'; lanes: number; r: number; step: number; gap: number; dmg: number }
    /** line of sight (視線遮蔽): hide behind a pillar; kill: down instead of damage; shatter: a pillar hidden behind breaks */
    | { k: 'los'; dmg: number; kill?: boolean; shatter?: boolean }
    /** freeze check (深度凍結): whoever moves when it ends is frozen for `time`; then circles drop on everyone */
    | { k: 'freeze'; time: number; drop?: { r: number; dmg: number; delay: number } }
    /** protean (八方扇形): a fan from the boss at every player; anyone in someone else's fan is hit twice */
    | { k: 'protean'; deg: number; dmg: number; delay?: number }
    /** timed bombs: batches going off these many seconds after the cast; each blows up `r` around its holder */
    | { k: 'bombs'; at: number[]; count: number | 'all'; r: number; dmg: number; self: number }
    /** the floor's tiles live in a checkerboard: these patterns one after the other, `gap` apart; tele: warning, s */
    | { k: 'tiles'; patterns: (0 | 1)[]; gap: number; dmg: number; tele: number }
    /** beams from the boss sweeping round `turn` degrees in `time` seconds; 2 beams start on opposite sides */
    | { k: 'sweep'; beams: 1 | 2; deg: number; turn: number; time: number; dmg: number }
    /** numbered marks (序列點名): in order, a strip from the boss through each marked player */
    | { k: 'sequence'; count: number | 'all'; w: number; gap: number; dmg: number }
    /** a circle on each of the top `n` of the enmity list (雙重鑽擊); apart: they must not overlap */
    | { k: 'drill'; n: number; r: number; dmg: number; apart?: boolean }
    /** the boss charges at marked players in turn (熔核衝撞): a strip from it to the arena edge through each */
    | { k: 'charge'; count: number; w: number; dmg: number; gap: number }
    /** half of the arena each (炎冰交錯): west by the boss, east by its twin, the first chosen at random */
    | { k: 'halves'; gap: number; dmg: number }
    /** colour stacks (雙色分攤): half the party red, half blue, a stack for each; swap: colours flip after that many seconds */
    | { k: 'colorStack'; r: number; dmg: number; swap?: number }
    /**
     * 8 fixed fans from the boss: the 4 cardinal ones and the 4 intercardinal ones going off `gap` apart;
     * towers: two of them in the first set's directions, going off with the second set (step in after the first)
     */
    | { k: 'fans8'; dmg: number; gap: number; towers?: { need: number; r: number; dmg: number; fail: number } }
    /** the twins at once (冰刃迴旋): a circle around the boss, a donut around its twin; swap: they trade places first */
    | { k: 'twinCircles'; r: number; r0: number; dmg: number; swap?: boolean }
  );

/** What adds do while they live. */
export type AddAttack =
  /** a fan in front of each add every `every` seconds (the adds take turns) */
  | { k: 'cone'; deg: number; r: number; dmg: number; every: number; first: number }
  /** a strip from the add through a random player; puddle: it leaves a pool on that spot */
  | { k: 'shot'; w: number; dmg: number; every: number; first: number; puddle?: { r: number; dmg: number; time: number } };

export interface Entry {
  /** seconds into the phase when the cast starts */
  at: number;
  /** name on the cast bar: the same name always means the same attack (Hard players read it) */
  name: string;
  /** cast time, seconds */
  cast: number;
  mechs: MechDef[];
  /** whose cast bar shows it: the boss (default), its twin, or both */
  by?: 'twin' | 'both';
}

export interface Phase {
  name: string;
  /** ends when the boss falls below this share of its HP */
  hpBelow?: number;
  /** ends when the adds it summoned are gone */
  untilAddsGone?: boolean;
  /** ends when the twins merge */
  untilFused?: boolean;
  /** the boss cannot be targeted, hurt or attack during this phase */
  untargetable?: boolean;
  entries: Entry[];
  /** after `at` seconds, carry on from `to`, and keep looping */
  loop?: { at: number; to: number };
  /** where a tank should drag the boss in this phase (computer players); the centre by default */
  home?: [number, number];
}

export interface Twin {
  kind: FoeKind;
  /** where it starts; the boss starts in the middle */
  at: [number, number];
  /** 共鳴: closer than `dist` when checked (every `every` s), both power up 10% a stack */
  resonance: { dist: number; every: number };
  /** 失衡: HP shares further apart than `gap`, a raid-wide every `every` s */
  imbalance: { gap: number; every: number; dmg: number };
  /** 合體: both down to `at` of their HP, they merge into `kind`; the first one there takes no more damage */
  fuse: { at: number; kind: FoeKind };
}

export interface BossScript {
  kind: FoeKind;
  /** auto attack on the top of the enmity list, every 3 s */
  auto: number;
  /** seconds a ground telegraph shows before it hits */
  tele: number;
  /** attacks drawn without a ground telegraph: the cast name and the boss's pose tell them apart (Hard) */
  hidden?: readonly MechDef['k'][];
  /** where the arena edge is: walls stop a knockback, a cliff lets players fall */
  edge: 'wall' | 'cliff';
  phases: Phase[];
  /** the long cast before the enrage: the fight ends at the enrage time (section 七) */
  enrage: { name: string; cast: number };
  /** a second boss fought alongside (雙子機神): the fight's HP is split between them */
  twin?: Twin;
}

/** A shape on the ground (or a marker over a head) that players can see, until it hits. */
export interface Tele {
  id: number;
  shape: Shape;
  color: TeleColor;
  /** follows this player, or whoever is top of the boss's enmity list */
  on?: string;
  /** a fan or strip that turns to point at this player until it goes off */
  aim?: string;
  /** its origin moves with this enemy until it goes off (a charge from wherever the boss stands) */
  from?: string;
  start: number;
  end: number;
  /** text on it, e.g. how many people a stack wants */
  text?: string;
  shown: boolean;
  /** a lingering floor: it hurts all the time it lasts, not only at the end */
  zone?: boolean;
  /** a stack for exactly its count (分攤死刑): nobody else should join */
  exact?: boolean;
}

/** One cast's mechanics: when all of them are done without a mistake, the Limit Break gauge gains 5%. */
interface Group {
  name: string;
  left: number;
  failed: boolean;
  /** has something to get wrong (a raid-wide does not) */
  scored: boolean;
}

interface Pending {
  at: number;
  group: Group;
  run: () => void;
  tele?: Tele;
}

/** A pool left on the floor: it hurts whoever stands in it, once a second (from a second after it lands). */
interface Puddle {
  tele: Tele;
  /** it starts hurting from this tick: whoever it landed under has a moment to step out */
  armed: number;
  group: Group;
  dmg: number;
  /** who it hit last and when (ticks) */
  hit: Map<string, number>;
  /** who it already counted a mistake for */
  missed: Set<string>;
}

const TOP = '@top';
const DEG = Math.PI / 180;

/**
 * Runs a boss script on a Fight: phases (by HP, by adds, until the twins merge), the timeline of casts
 * and their mechanics, telegraphs, penalties, the Limit Break bonus for clean mechanics, adds and what they
 * do, lingering pools, the twins' rules, the enrage cast. Random choices (who is marked, where rocks fall)
 * come from the fight's seeded generator, so a fight can be replayed.
 */
export class BossBrain {
  phase = -1;
  /** the boss whose death ends the fight (it changes when the twins merge) */
  foe: Foe;
  /** the other twin (雙子機神) while there are two */
  twin: Foe | null = null;
  private phaseStart = 0;
  private next = 0;
  /** ticks the timeline has been pushed back by its loops */
  private shift = 0;
  private pending: Pending[] = [];
  private puddles: Puddle[] = [];
  private seq = 0;
  private enraging = false;
  /** adds summoned in the current phase */
  private adds: Foe[] = [];
  private addsSummoned = false;
  private addsDeadline = 0;
  private addsBoom = 0;
  private together = false;
  private reviveAt = 0;
  private addAttack: AddAttack | null = null;
  private addNext = new Map<string, number>();
  private addTurn = 0;
  /** players a sweeping beam hit last (they are not hit again by it for a second) */
  private swept = new Map<string, number>();
  /** where the cast being scheduled leaps the boss to (its other mechanics happen from there) */
  private landTo: [number, number] | null = null;

  constructor(
    private readonly fight: Fight,
    foe: Foe,
    readonly script: BossScript,
  ) {
    this.foe = foe;
    const tw = script.twin;
    if (tw) {
      // the duty's HP is for both together
      const half = Math.round(foe.maxHp / 2);
      foe.maxHp = foe.hp = half;
      foe.minHp = Math.round(half * tw.fuse.at);
      this.twin = fight.spawnFoe(tw.kind, tw.at[0], tw.at[1], half, { id: 'twin' });
      this.twin.aloof = true;
      this.twin.minHp = Math.round(half * tw.fuse.at);
      this.twin.f = faceTowards(tw.at[0], tw.at[1], 0, 0);
    }
  }

  get current(): Phase | undefined {
    return this.script.phases[this.phase];
  }

  /** The current adds must fall together (Hard 岩巨兵): computer players keep them even. */
  get addsTogether(): boolean {
    return this.together;
  }

  /** Telegraphs players can see now. */
  visible(): Tele[] {
    const t = this.fight.tick;
    const out: Tele[] = [];
    for (const p of this.pending) if (p.tele?.shown && p.tele.start <= t && p.tele.end >= t) out.push(p.tele);
    for (const p of this.puddles) out.push(p.tele);
    return out;
  }

  /** All pending hazards, the hidden ones too, and the pools on the floor (for the computer players and the tests). */
  hazards(): readonly Tele[] {
    return [...this.pending.flatMap((p) => (p.tele ? [p.tele] : [])), ...this.puddles.map((p) => p.tele)];
  }

  /** Who a following telegraph sits on right now. */
  holder(t: Tele): Fighter | undefined {
    if (!t.on) return undefined;
    if (t.on === TOP) return this.fight.topOf(this.foe) ?? undefined;
    return this.fight.players.get(t.on);
  }

  /**
   * Where a tank should drag a walking boss (computer players): the phase's home, or for the twins'
   * 熾核 the point across the arena from 凍核, far enough that they do not resonate.
   */
  home(foe: Foe): [number, number] {
    const size = this.fight.enc.arena.size;
    if (this.twin && foe === this.foe) {
      const d = Math.hypot(this.twin.x, this.twin.z);
      if (d > 1) return [(-this.twin.x / d) * size * 0.4, (-this.twin.z / d) * size * 0.4];
      return [0, size * 0.4];
    }
    return this.current?.home ?? [0, 0];
  }

  // ------------------------------------------------------------------ the clock

  step(): void {
    const f = this.fight;
    if (this.phase < 0) this.enter(0);
    if (this.foe.hp <= 0) return;
    // the enrage cast runs over whatever else is going on
    const enrageStart = f.enrageTicks - sec(this.script.enrage.cast);
    if (!this.enraging && f.fightTicks >= enrageStart) {
      this.enraging = true;
      this.cancel();
      this.castBar(this.foe, this.script.enrage.name, sec(this.script.enrage.cast), 'enrage');
    }
    if (!this.enraging) {
      this.twinRules();
      this.checkPhase();
      this.timeline();
    }
    this.track();
    this.resolve();
    this.pools();
    this.addsStep();
  }

  private enter(k: number): void {
    const f = this.fight;
    this.cancel();
    // the pools of the phase before dry up with it
    this.puddles = [];
    this.phase = k;
    this.phaseStart = f.tick;
    this.next = 0;
    this.shift = 0;
    this.adds = [];
    this.addsSummoned = false;
    this.reviveAt = 0;
    this.addAttack = null;
    const ph = this.current;
    this.foe.untargetable = !!ph?.untargetable;
    if (ph) f.emit({ k: 'phase', i: this.foe.id, n: ph.name, u: ph.untargetable ? 1 : undefined });
  }

  private checkPhase(): void {
    const ph = this.current;
    if (!ph || this.phase >= this.script.phases.length - 1) return;
    const low = ph.hpBelow !== undefined && this.foe.hp / this.foe.maxHp < ph.hpBelow;
    const addsGone = !!ph.untilAddsGone && this.addsSummoned && this.adds.every((a) => a.hp <= 0 || a.gone);
    if (low || addsGone) this.enter(this.phase + 1);
  }

  private timeline(): void {
    const ph = this.current;
    if (!ph) return;
    const t = this.fight.tick - this.phaseStart;
    for (;;) {
      if (this.next < ph.entries.length) {
        const e = ph.entries[this.next]!;
        if (sec(e.at) + this.shift > t) break;
        this.next++;
        this.begin(e);
        continue;
      }
      if (ph.loop && sec(ph.loop.at) + this.shift <= t) {
        this.shift += sec(ph.loop.at) - sec(ph.loop.to);
        this.next = ph.entries.findIndex((e) => e.at >= ph.loop!.to);
        if (this.next < 0) break;
        continue;
      }
      break;
    }
  }

  /** Aimed shapes turn to their player, moving origins follow their enemy. */
  private track(): void {
    const f = this.fight;
    for (const p of this.pending) {
      const tele = p.tele;
      if (!tele || (!tele.aim && !tele.from)) continue;
      const s = tele.shape;
      if (s.k !== 'cone' && s.k !== 'rect') continue;
      if (tele.from) {
        const src = f.foes.find((e) => e.id === tele.from);
        if (src) {
          s.x = src.x;
          s.z = src.z;
        }
      }
      const q = tele.aim ? f.players.get(tele.aim) : undefined;
      if (q && !q.dead && Math.hypot(q.x - s.x, q.z - s.z) > 0.05) s.f = faceTowards(s.x, s.z, q.x, q.z);
    }
  }

  private resolve(): void {
    const t = this.fight.tick;
    const due = this.pending.filter((p) => p.at <= t);
    if (!due.length) return;
    this.pending = this.pending.filter((p) => p.at > t);
    for (const p of due) {
      p.run();
      p.group.left--;
      if (p.group.left === 0 && p.group.scored && !p.group.failed) {
        this.fight.lb = Math.min(100, this.fight.lb + RULES.lbClean);
        this.fight.emit({ k: 'clean', n: p.group.name });
      }
    }
  }

  /** Drops whatever was still coming (a phase change or the enrage cuts it short). */
  private cancel(): void {
    this.pending = [];
    for (const e of [this.foe, this.twin]) {
      if (!e) continue;
      e.cast = null;
      e.lockUntil = 0;
    }
  }

  // ------------------------------------------------------------------ casts and mechanics

  private castBar(foe: Foe, name: string, ticks: number, m: NonNullable<Foe['cast']>['m'], target: string | null = null): void {
    const t = this.fight.tick;
    foe.cast = { name, m, start: t, end: t + ticks, target };
    this.fight.emit({ k: 'bcast', i: foe.id, n: name, m, t: target ?? undefined, d: ticks });
  }

  private begin(e: Entry): void {
    const f = this.fight;
    const t0 = f.tick;
    const t1 = t0 + sec(e.cast);
    const kinds = e.mechs.map((m) => m.k);
    const m: NonNullable<Foe['cast']>['m'] = kinds.includes('raidwide') ? 'raidwide' : kinds.includes('buster') ? 'buster' : 'mech';
    const buster = e.mechs.find((x) => x.k === 'buster');
    const top = buster ? f.topOf(this.foe) : null;
    if (e.cast > 0) {
      const casters = e.by === 'both' ? [this.foe, this.twin] : e.by === 'twin' ? [this.twin] : [this.foe];
      for (const c of casters) if (c && !c.gone) this.castBar(c, e.name, t1 - t0, m, c === this.foe ? (top?.id ?? null) : null);
    }
    const group: Group = { name: e.name, left: 0, failed: false, scored: false };
    const jump = e.mechs.find((x) => x.k === 'jump' && x.to && x.src !== 'twin');
    this.landTo = jump && jump.k === 'jump' && jump.to ? clampToArena(f.enc.arena, jump.to[0], jump.to[1], this.foe.r) : null;
    for (const mech of e.mechs) this.schedule(mech, t0, t1, group, top);
    this.landTo = null;
  }

  private add(at: number, group: Group, run: () => void, tele?: Omit<Tele, 'id' | 'end' | 'shown'> & { shown?: boolean }): void {
    group.left++;
    const p: Pending = { at, group, run };
    if (tele) p.tele = { ...tele, id: ++this.seq, end: at, shown: tele.shown ?? true };
    this.pending.push(p);
  }

  private teleStart(at: number, t0: number): number {
    return Math.max(t0, at - sec(this.script.tele));
  }

  private shown(k: MechDef['k']): boolean {
    return !this.script.hidden?.includes(k);
  }

  /** The mechanic's source: the boss, or its twin. */
  private srcOf(m: MechDef): Foe {
    return m.src === 'twin' && this.twin ? this.twin : this.foe;
  }

  /** The living players by the boss's enmity, highest first. */
  private ranked(): Fighter[] {
    const f = this.fight;
    const v = (q: Fighter) => this.foe.enmity.get(q.id) ?? 0;
    return f.living().sort((a, b) => v(b) - v(a));
  }

  /** How far a strip from (x, z) along f runs before it leaves the arena. */
  private reachEdge(x: number, z: number, fa: number): number {
    const size = this.fight.enc.arena.size;
    const ux = Math.sin(fa);
    const uz = Math.cos(fa);
    if (this.fight.enc.arena.shape === 'square') {
      const tx = ux > 1e-6 ? (size - x) / ux : ux < -1e-6 ? (-size - x) / ux : Infinity;
      const tz = uz > 1e-6 ? (size - z) / uz : uz < -1e-6 ? (-size - z) / uz : Infinity;
      return Math.max(0, Math.min(tx, tz));
    }
    // circle: solve |p + t u| = size
    const b = x * ux + z * uz;
    const c = x * x + z * z - size * size;
    return Math.max(0, -b + Math.sqrt(Math.max(0, b * b - c)));
  }

  private schedule(m: MechDef, t0: number, t1: number, g: Group, top: Fighter | null): void {
    const f = this.fight;
    const boss = this.srcOf(m);
    const size = f.enc.arena.size;
    switch (m.k) {
      case 'raidwide':
        this.add(t1, g, () => {
          this.bossEvent('raidwide', g.name, undefined, boss);
          for (const q of f.living()) f.hurt(q, m.dmg, boss);
        });
        return;
      case 'buster': {
        const gap = sec(m.gap ?? 4);
        // without a tank the double buster hits once (缺角補正): nobody could take it twice
        const hits = f.roles.tank ? (m.hits ?? 1) : 1;
        const target = m.rank && m.rank > 1 ? this.ranked()[m.rank - 1]?.id : top?.id;
        if (m.rank && m.rank > 1 && !target) return;
        this.add(t1, g, () => this.busterHit(target, m.dmg, hits > 1, gap, g.name, boss), { shape: { k: 'mark' }, color: 'r', on: target, start: t0 });
        for (let k = 1; k < hits; k++) {
          // the next hit goes to whoever is top then: the other tank should have taken the boss
          this.add(t1 + gap * k, g, () => this.busterHit(undefined, m.dmg, k < hits - 1, gap, g.name, boss), {
            shape: { k: 'mark' },
            color: 'r',
            on: TOP,
            start: t1 + gap * (k - 1) + 1,
          });
        }
        return;
      }
      case 'chariot': {
        const at = t1 + sec(m.delay ?? 0);
        g.scored = true;
        const shape: Shape = { k: 'circle', x: boss.x, z: boss.z, r: m.r };
        this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), { shape, color: 'o', start: this.teleStart(at, t0), shown: this.shown('chariot') });
        return;
      }
      case 'donut': {
        const at = t1 + sec(m.delay ?? 0);
        g.scored = true;
        const shape: Shape = { k: 'donut', x: boss.x, z: boss.z, r0: m.r0, r1: size * 2.2 };
        // a donut after a chariot shows only once the chariot has gone off
        const start = m.delay ? Math.max(t1, this.teleStart(at, t0)) : this.teleStart(at, t0);
        this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), { shape, color: 'o', start, shown: this.shown('donut') });
        return;
      }
      case 'cone': {
        g.scored = true;
        boss.lockUntil = t1; // it stops turning: the fan points where it faced when the cast began
        const shape: Shape = { k: 'cone', x: boss.x, z: boss.z, f: boss.f, r: size * 2, deg: m.deg };
        this.add(t1, g, () => this.areaHit(shape, m.dmg, g, boss), { shape, color: 'o', start: this.teleStart(t1, t0), shown: this.shown('cone') });
        return;
      }
      case 'rocks': {
        g.scored = true;
        for (let w = 0; w < m.waves; w++) {
          const at = t1 + sec(m.gap) * w;
          for (let k = 0; k < m.count; k++) {
            let x: number;
            let z: number;
            if (w === 0 && k < (m.nearBoss ?? 0)) {
              // right next to the boss: one side of it is no longer safe to wait on
              const a = f.random() * Math.PI * 2;
              const d = boss.r + f.random() * 1.5;
              [x, z] = [boss.x + Math.sin(a) * d, boss.z + Math.cos(a) * d];
            } else {
              const a = f.random() * Math.PI * 2;
              // with a rock next to the boss, the rest of the first wave keeps off the middle: there must be room to wait there
              const min = w === 0 && m.nearBoss ? Math.min(size - 1, boss.r + 6 + m.r) : 0;
              const d = min + Math.sqrt(f.random()) * Math.max(0, size - m.r * 0.5 - min);
              [x, z] = clampToArena(f.enc.arena, Math.sin(a) * d, Math.cos(a) * d, 0);
            }
            const shape: Shape = { k: 'circle', x, z, r: m.r };
            this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), { shape, color: 'o', start: Math.max(t0, at - sec(this.script.tele)), shown: this.shown('rocks') });
          }
        }
        return;
      }
      case 'lines': {
        g.scored = true;
        const th = f.random() * Math.PI;
        const [ux, uz] = [Math.sin(th), Math.cos(th)];
        const [nx, nz] = [uz, -ux];
        const len = size * 2.4;
        m.waves.forEach((offsets, w) => {
          const at = t1 + sec(m.gap) * w;
          for (const off of offsets) {
            const shape: Shape = { k: 'rect', x: nx * off - ux * (len / 2), z: nz * off - uz * (len / 2), f: th, len, w: m.w };
            this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), {
              shape,
              color: 'o',
              start: w === 0 ? this.teleStart(at, t0) : Math.max(t1 + sec(m.gap) * (w - 1), at - sec(this.script.tele)),
              shown: this.shown('lines'),
            });
          }
        });
        return;
      }
      case 'spread': {
        g.scored = true;
        const pool = this.shuffle(f.living());
        const n = m.count === 'all' ? pool.length : Math.min(m.count, pool.length);
        const marked = pool.slice(0, n).map((q) => q.id);
        for (const id of marked) {
          this.add(t1, g, () => this.spreadHit(id, m.r, m.dmg, g, boss), { shape: { k: 'circle', x: 0, z: 0, r: m.r }, color: 'p', on: id, start: t0 });
        }
        return;
      }
      case 'stack': {
        g.scored = true;
        const living = f.living();
        if (m.on === 'top') {
          // 分攤死刑: the tank and exactly want − 1 more
          const holder = top ?? f.topOf(this.foe);
          if (!holder) return;
          const want = Math.min(m.want ?? 2, living.length);
          this.add(t1, g, () => this.stackHit(holder.id, m.r, m.dmg, want, g, boss, true), {
            shape: { k: 'circle', x: 0, z: 0, r: m.r },
            color: 'y',
            on: holder.id,
            start: t0,
            text: String(want),
            exact: true,
          });
          return;
        }
        // healers and DPS first: a stack on a tank drags the boss around
        const pool = [...this.shuffle(living.filter((q) => q.role !== 'tank')), ...this.shuffle(living.filter((q) => q.role === 'tank'))];
        const groups = Math.max(1, Math.min(m.groups, Math.floor(living.length / 2) || 1));
        const want = Math.max(1, Math.ceil(living.length / groups));
        const marked = pool.slice(0, groups).map((q) => q.id);
        for (const id of marked) {
          this.add(t1, g, () => this.stackHit(id, m.r, m.dmg, want, g, boss), {
            shape: { k: 'circle', x: 0, z: 0, r: m.r },
            color: 'y',
            on: id,
            start: t0,
            text: String(want),
          });
        }
        return;
      }
      case 'knockback': {
        g.scored = true;
        const shape: Shape = { k: 'push', x: boss.x, z: boss.z, dist: m.dist };
        this.add(t1, g, () => this.knockAll(m.dist, g, boss), { shape, color: 'w', start: this.teleStart(t1, t0) });
        return;
      }
      case 'prison':
        g.scored = true;
        this.add(t1, g, () => this.prison(m.hp, m.time, g));
        return;
      case 'adds':
        this.add(t1, g, () => this.summon(m));
        return;
      case 'jump': {
        const to = m.to;
        if (!to) {
          this.add(t0, g, () => this.bossEvent('jump', g.name, undefined, boss));
          return;
        }
        // the leap takes the last second of the cast (all of it when there is no cast)
        const leap = Math.min(sec(1), Math.max(1, t1 - t0));
        const [x, z] = clampToArena(f.enc.arena, to[0], to[1], boss.r);
        this.add(Math.max(t0, t1 - leap), g, () => {
          f.leapFoe(boss, x, z, leap);
          this.bossEvent('jump', g.name, undefined, boss);
        });
        if (m.land) {
          g.scored = true;
          const shape: Shape = { k: 'circle', x, z, r: m.land.r };
          const at = Math.max(t1, t0 + leap);
          this.add(at, g, () => this.areaHit(shape, m.land!.dmg, g, boss), { shape, color: 'o', start: t0 });
        }
        return;
      }
      case 'tether': {
        g.scored = true;
        const pool = this.shuffle(f.living());
        for (let k = 0; k < m.pairs && pool.length >= 2; k++) {
          const a = pool.shift()!;
          const b = pool.shift()!;
          this.add(
            t1,
            g,
            () => {
              const qa = f.players.get(a.id);
              const qb = f.players.get(b.id);
              if (!qa || !qb || qa.dead || qb.dead) return;
              if (Math.hypot(qa.x - qb.x, qa.z - qb.z) >= m.dist) return;
              for (const q of [qa, qb]) {
                f.hurt(q, m.dmg, boss);
                this.miss(q, g);
              }
            },
            { shape: { k: 'tether', a: a.id, b: b.id, dist: m.dist }, color: 'b', on: a.id, start: t0, text: `拉開 ${m.dist} m` },
          );
        }
        return;
      }
      case 'tower': {
        g.scored = true;
        const living = f.living().length;
        const need = Math.max(1, Math.min(m.need, living));
        const count = Math.max(1, Math.min(Math.round((m.count * living) / 4), Math.floor(living / need)));
        const ring = m.ring ?? size * 0.55;
        const a0 = f.random() * Math.PI * 2;
        for (let k = 0; k < count; k++) {
          const a = a0 + (k * Math.PI * 2) / count;
          const [x, z] = clampToArena(f.enc.arena, Math.sin(a) * ring, Math.cos(a) * ring, m.r);
          const shape: Shape = { k: 'tower', x, z, r: m.r, need };
          this.add(
            t1,
            g,
            () => {
              const ins = f.living().filter((q) => inside(shape, q.x, q.z));
              for (const q of ins) f.hurt(q, m.dmg, boss);
              if (ins.length >= need) return;
              // a short tower blows up on everyone
              g.failed = true;
              this.bossEvent('raidwide', g.name, undefined, boss);
              for (const q of f.living()) f.hurt(q, m.fail, boss);
            },
            { shape, color: 'y', start: t0, text: String(need) },
          );
        }
        return;
      }
      case 'exaflare': {
        g.scored = true;
        // lanes across the arena along a random axis, every other one rolling the other way
        const axis = f.random() < 0.5 ? 0 : Math.PI / 2;
        const flip = f.random() < 0.5 ? 1 : -1;
        const [ux, uz] = [Math.sin(axis), Math.cos(axis)];
        const [nx, nz] = [uz, -ux];
        for (let lane = 0; lane < m.lanes; lane++) {
          const off = m.lanes === 1 ? 0 : -size + m.r + ((size - m.r) * 2 * lane) / (m.lanes - 1);
          const dir = (lane % 2 ? -1 : 1) * flip;
          // the lane's length inside the arena
          const half = f.enc.arena.shape === 'square' ? size : Math.sqrt(Math.max(0, size * size - off * off));
          const steps = Math.max(1, Math.ceil((half * 2) / m.step));
          for (let k = 0; k <= steps; k++) {
            const along = -dir * half + dir * k * m.step;
            const shape: Shape = { k: 'circle', x: nx * off + ux * along, z: nz * off + uz * along, r: m.r };
            const at = t1 + sec(m.gap) * k;
            this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), {
              shape,
              color: 'o',
              // the next circle of each lane shows when the one before it goes off
              start: k === 0 ? this.teleStart(at, t0) : t1 + sec(m.gap) * (k - 1),
              shown: this.shown('exaflare'),
            });
          }
        }
        return;
      }
      case 'los': {
        g.scored = true;
        const pillars = this.standing();
        // drawn from where the boss will be when it goes off (it leaps to the middle first)
        const [x, z] = this.landing(boss);
        const shape: Shape = { k: 'los', x, z, pillars: pillars.map((p) => p.p) };
        this.add(
          t1,
          g,
          () => {
            const sx = boss.x;
            const sz = boss.z;
            const live = this.standing();
            const used = new Set<number>();
            for (const q of f.living()) {
              const by = live.find((p) => hidden(sx, sz, [p.p], q.x, q.z));
              if (by) {
                used.add(by.k);
                continue;
              }
              this.miss(q, g);
              if (m.kill) f.kill(q);
              else f.hurt(q, m.dmg, boss);
            }
            this.bossEvent('raidwide', g.name, undefined, boss);
            if (m.shatter) for (const k of used) f.pillarsBroken[k] = true;
          },
          { shape, color: 's', start: this.teleStart(t1, t0), shown: this.shown('los') },
        );
        return;
      }
      case 'freeze': {
        g.scored = true;
        this.add(
          t1,
          g,
          () => {
            const recent = f.tick - sec(0.3);
            for (const q of f.living()) {
              if (q.movedAt < recent || q.dash) continue;
              f.addStatus(q, { id: 'frozen', src: boss.id, until: f.tick + sec(m.time), v: 0 }, false);
              this.miss(q, g);
            }
            // then something drops on everyone: the frozen cannot step out
            if (m.drop) {
              const drop = m.drop;
              for (const q of f.living()) {
                const shape: Shape = { k: 'circle', x: q.x, z: q.z, r: drop.r };
                this.add(f.tick + sec(drop.delay), g, () => this.areaHit(shape, drop.dmg, g, boss), { shape, color: 'o', start: f.tick });
              }
            }
          },
          { shape: { k: 'stop' }, color: 'c', start: t0 },
        );
        return;
      }
      case 'protean': {
        g.scored = true;
        const at = t1 + sec(m.delay ?? 0);
        for (const q of f.living()) {
          const shape: Shape = { k: 'cone', x: boss.x, z: boss.z, f: faceTowards(boss.x, boss.z, q.x, q.z), r: size * 2.2, deg: m.deg };
          this.add(at, g, () => this.aimedHit(shape, q.id, m.dmg, g, boss), {
            shape,
            color: 'o',
            aim: q.id,
            from: boss.id,
            start: m.delay ? Math.max(t1, this.teleStart(at, t0)) : this.teleStart(at, t0),
            shown: this.shown('protean'),
          });
        }
        return;
      }
      case 'bombs': {
        g.scored = true;
        const pool = this.shuffle(f.living());
        const n = m.count === 'all' ? pool.length : Math.min(m.count, pool.length);
        for (let k = 0; k < n; k++) {
          const q = pool[k]!;
          const at = t1 + sec(m.at[k % m.at.length]!);
          f.addStatus(q, { id: 'bomb', src: boss.id, until: at, v: 0 }, false);
          this.add(
            at,
            g,
            () => {
              const h = f.players.get(q.id);
              if (!h || h.dead) return;
              this.bossEvent('bomb', g.name, h.id, boss);
              for (const o of f.living()) {
                if (o.id === h.id) f.hurt(o, m.self, boss);
                else if (Math.hypot(o.x - h.x, o.z - h.z) <= m.r) {
                  f.hurt(o, m.dmg, boss);
                  this.miss(o, g);
                }
              }
            },
            { shape: { k: 'bomb', r: m.r }, color: 'p', on: q.id, start: t0 },
          );
        }
        return;
      }
      case 'tiles': {
        g.scored = true;
        const n = f.enc.arena.grid ?? 6;
        m.patterns.forEach((p, k) => {
          const at = t1 + sec(m.gap) * k;
          const shape: Shape = { k: 'tiles', size, n, cells: checker(n, p) };
          this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), {
            shape,
            color: 'o',
            start: Math.max(k === 0 ? t0 : t1 + sec(m.gap) * (k - 1), at - sec(m.tele)),
            shown: this.shown('tiles'),
          });
        });
        return;
      }
      case 'sweep': {
        g.scored = true;
        const step = sec(0.4);
        const n = Math.max(2, Math.round(sec(m.time) / step));
        const a0 = f.random() * Math.PI * 2;
        const turn = m.turn * DEG;
        // each step's fan overlaps the next a little, so nothing slips between them
        const deg = Math.max(m.deg, (m.turn / n) * 1.6);
        const [x, z] = [boss.x, boss.z];
        // 2 beams start on opposite sides and turn the same way, each through its own half: follow one round
        const dir = f.random() < 0.5 ? 1 : -1;
        for (let b = 0; b < m.beams; b++) {
          const from = a0 + b * Math.PI;
          for (let k = 0; k <= n; k++) {
            const at = t1 + step * k;
            const shape: Shape = { k: 'cone', x, z, f: from + (dir * turn * k) / n, r: size * 2.2, deg };
            const key = `${g.name}/${b}`;
            this.add(at, g, () => this.sweepHit(shape, key, m.dmg, g, boss), {
              shape,
              color: 'o',
              start: k === 0 ? this.teleStart(at, t0) : Math.max(t0, at - sec(1.2)),
              shown: this.shown('sweep'),
            });
          }
        }
        return;
      }
      case 'sequence': {
        g.scored = true;
        const pool = this.shuffle(f.living());
        const n = m.count === 'all' ? pool.length : Math.min(m.count, pool.length);
        for (let k = 0; k < n; k++) {
          const q = pool[k]!;
          const at = t1 + sec(m.gap) * k;
          this.add(at, g, () => undefined, { shape: { k: 'num', n: k + 1 }, color: 'o', on: q.id, start: t0 });
          const shape: Shape = { k: 'rect', x: boss.x, z: boss.z, f: faceTowards(boss.x, boss.z, q.x, q.z), len: size * 2.6, w: m.w };
          this.add(at, g, () => this.aimedHit(shape, q.id, m.dmg, g, boss), {
            shape,
            color: 'o',
            aim: q.id,
            from: boss.id,
            start: Math.max(t0, at - sec(2)),
            shown: this.shown('sequence'),
          });
        }
        return;
      }
      case 'drill': {
        g.scored = true;
        const marked = this.ranked().slice(0, m.n);
        for (const q of marked) {
          this.add(
            t1,
            g,
            () => {
              const h = f.players.get(q.id);
              if (!h || h.dead) return;
              for (const o of f.living()) {
                if (Math.hypot(o.x - h.x, o.z - h.z) > m.r) continue;
                // aimed at the top of the list like a tank buster: half on anyone who is not a tank
                f.hurt(o, m.dmg * (o.role === 'tank' ? 1 : RULES.noTankDamage), boss);
                // the other marked player's circle on top of this one: both got it wrong
                if (o.id !== h.id && (m.apart || !marked.some((x) => x.id === o.id))) this.miss(o, g);
              }
            },
            { shape: { k: 'circle', x: 0, z: 0, r: m.r }, color: 'r', on: q.id, start: t0 },
          );
        }
        return;
      }
      case 'charge': {
        g.scored = true;
        // marked: the others before the tanks
        const living = f.living();
        const pool = [...this.shuffle(living.filter((q) => q.role !== 'tank')), ...this.shuffle(living.filter((q) => q.role === 'tank'))];
        const n = Math.min(m.count, pool.length);
        for (let k = 0; k < n; k++) {
          const q = pool[k]!;
          const at = t1 + sec(m.gap) * k;
          this.add(at, g, () => undefined, { shape: { k: 'num', n: k + 1 }, color: 'r', on: q.id, start: t0 });
          const shape: Shape = { k: 'rect', x: boss.x, z: boss.z, f: faceTowards(boss.x, boss.z, q.x, q.z), len: size * 2.6, w: m.w };
          this.add(
            at,
            g,
            () => {
              // the strip runs from where the boss stands through the player to the edge; the boss charges along it
              shape.x = boss.x;
              shape.z = boss.z;
              const h = f.players.get(q.id);
              if (h && !h.dead && Math.hypot(h.x - boss.x, h.z - boss.z) > 0.05) shape.f = faceTowards(boss.x, boss.z, h.x, h.z);
              const len = Math.max(0, this.reachEdge(boss.x, boss.z, shape.f) - boss.r);
              shape.len = len + boss.r;
              this.aimedHit(shape, q.id, m.dmg, g, boss);
              this.bossEvent('charge', g.name, q.id, boss);
              f.leapFoe(boss, boss.x + Math.sin(shape.f) * len, boss.z + Math.cos(shape.f) * len, sec(0.6));
            },
            { shape, color: 'o', aim: q.id, from: boss.id, start: k === 0 ? t0 : t1 + sec(m.gap) * (k - 1), shown: this.shown('charge') },
          );
        }
        return;
      }
      case 'halves': {
        g.scored = true;
        // the boss burns the west half, the twin freezes the east half; who goes first is random
        const west = { k: 'half', x: 0, z: 0, f: -Math.PI / 2 } as const;
        const east = { k: 'half', x: 0, z: 0, f: Math.PI / 2 } as const;
        const fireFirst = f.random() < 0.5;
        const order: [Shape, TeleColor, Foe][] = [
          [{ ...west }, 'e', this.foe],
          [{ ...east }, 'i', this.twin ?? this.foe],
        ];
        if (!fireFirst) order.reverse();
        this.bossEvent('glow', g.name, undefined, order[0]![2]);
        order.forEach(([shape, color, src], k) => {
          const at = t1 + sec(m.gap) * k;
          this.add(at, g, () => this.areaHit(shape, m.dmg, g, src), {
            shape,
            color,
            start: k === 0 ? this.teleStart(at, t0) : t1,
            shown: this.shown('halves'),
          });
        });
        return;
      }
      case 'colorStack': {
        g.scored = true;
        const pool = this.shuffle(f.living());
        const reds = pool.filter((_, k) => k % 2 === 0);
        const blues = pool.filter((_, k) => k % 2 === 1);
        const until = t1 + sec(1);
        for (const q of reds) f.addStatus(q, { id: 'red', src: boss.id, until, v: 0 }, false);
        for (const q of blues) f.addStatus(q, { id: 'blue', src: boss.id, until, v: 0 }, false);
        if (m.swap) {
          // Hard: every colour flips once during the cast
          this.add(t0 + sec(m.swap), g, () => {
            for (const q of f.living()) {
              const was = q.statuses.find((s) => s.id === 'red' || s.id === 'blue');
              if (!was) continue;
              was.id = was.id === 'red' ? 'blue' : 'red';
            }
            this.bossEvent('swap', g.name, undefined, boss);
          });
        }
        const holders: [Fighter | undefined, 'red' | 'blue', TeleColor][] = [
          [reds.find((q) => q.role !== 'tank') ?? reds[0], 'red', 'e'],
          [blues.find((q) => q.role !== 'tank') ?? blues[0], 'blue', 'i'],
        ];
        const held = holders.flatMap(([h]) => (h ? [h.id] : []));
        for (const [h, colour, tc] of holders) {
          if (!h) continue;
          this.add(t1, g, () => this.colourHit(h.id, colour, held, m.r, m.dmg, g, boss), {
            shape: { k: 'circle', x: 0, z: 0, r: m.r },
            color: tc,
            on: h.id,
            start: t0,
            text: colour === 'red' ? '紅' : '藍',
          });
        }
        return;
      }
      case 'fans8': {
        g.scored = true;
        const [x, z] = [boss.x, boss.z];
        const cardFirst = f.random() < 0.5;
        if (m.towers) {
          // two towers in the first set's directions: wait out the first fans, then step in before the second
          const tw = m.towers;
          const living = f.living().length;
          const need = Math.max(1, Math.min(tw.need, Math.floor(living / 2) || 1));
          const a0 = (cardFirst ? 0 : Math.PI / 4) + (f.random() < 0.5 ? 0 : Math.PI / 2);
          for (let k = 0; k < (living >= 2 ? 2 : 1); k++) {
            const a = a0 + k * Math.PI;
            const [tx, tz] = clampToArena(f.enc.arena, x + Math.sin(a) * 10, z + Math.cos(a) * 10, tw.r);
            const shape: Shape = { k: 'tower', x: tx, z: tz, r: tw.r, need };
            this.add(
              t1 + sec(m.gap),
              g,
              () => {
                const ins = f.living().filter((q) => inside(shape, q.x, q.z));
                for (const q of ins) f.hurt(q, tw.dmg, boss);
                if (ins.length >= need) return;
                g.failed = true;
                this.bossEvent('raidwide', g.name, undefined, boss);
                for (const q of f.living()) f.hurt(q, tw.fail, boss);
              },
              { shape, color: 'y', start: t0, text: String(need) },
            );
          }
        }
        for (let set = 0; set < 2; set++) {
          const cardinal = set === 0 ? cardFirst : !cardFirst;
          const at = t1 + sec(m.gap) * set;
          for (let k = 0; k < 4; k++) {
            const fa = (k * Math.PI) / 2 + (cardinal ? 0 : Math.PI / 4);
            const shape: Shape = { k: 'cone', x, z, f: fa, r: size * 2.2, deg: 45 };
            this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), {
              shape,
              color: cardinal ? 'e' : 'i',
              start: set === 0 ? this.teleStart(at, t0) : t1,
              shown: this.shown('fans8'),
            });
          }
        }
        return;
      }
      case 'twinCircles': {
        g.scored = true;
        const tw = this.twin;
        if (!tw) return;
        let [cx, cz] = [this.foe.x, this.foe.z];
        let [dx, dz] = [tw.x, tw.z];
        let start = this.teleStart(t1, t0);
        if (m.swap) {
          // they trade places first; the circles show once they have landed
          [cx, cz, dx, dz] = [dx, dz, cx, cz];
          const leap = sec(1.2);
          this.add(t0 + sec(0.5), g, () => {
            f.leapFoe(this.foe, cx, cz, leap);
            f.leapFoe(tw, dx, dz, leap);
            this.bossEvent('jump', g.name, undefined, this.foe);
            this.bossEvent('jump', g.name, undefined, tw);
          });
          start = Math.max(start, t0 + sec(0.5) + leap);
        }
        const out: Shape = { k: 'circle', x: cx, z: cz, r: m.r };
        const ring: Shape = { k: 'donut', x: dx, z: dz, r0: m.r0, r1: size * 2.4 };
        this.add(t1, g, () => this.areaHit(out, m.dmg, g, this.foe), { shape: out, color: 'e', start, shown: this.shown('twinCircles') });
        this.add(t1, g, () => this.areaHit(ring, m.dmg, g, tw), { shape: ring, color: 'i', start, shown: this.shown('twinCircles') });
        return;
      }
    }
  }

  /** Where a boss will stand once a leap of this cast has landed (or where it is). */
  private landing(boss: Foe): [number, number] {
    if (this.landTo && boss === this.foe) return this.landTo;
    const d = boss.dash;
    return d ? [d.x1, d.z1] : [boss.x, boss.z];
  }

  /** The arena's pillars still standing, with their index. */
  private standing(): { k: number; p: Pillar }[] {
    const f = this.fight;
    return (f.enc.arena.pillars ?? []).map((p, k) => ({ k, p })).filter(({ k }) => !f.pillarsBroken[k]);
  }

  private bossEvent(m: Extract<FightEvent, { k: 'boss' }>['m'], n: string, t?: string, src: Foe = this.foe): void {
    this.fight.emit({ k: 'boss', i: src.id, n, m, t });
  }

  private shuffle<T>(list: T[]): T[] {
    const f = this.fight;
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(f.random() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    return list;
  }

  // ------------------------------------------------------------------ resolving

  private busterHit(target: string | undefined, dmg: number, crack: boolean, gap: number, name: string, src: Foe): void {
    const f = this.fight;
    const q = target ? f.players.get(target) : (f.topOf(this.foe) ?? undefined);
    if (!q || q.dead) return;
    this.bossEvent('buster', name, q.id, src);
    // a tank buster on someone who is not a tank (no tank in the party, or the second of the list) hits half
    f.hurt(q, dmg * (q.role === 'tank' ? 1 : RULES.noTankDamage), src);
    if (crack && !q.dead) {
      // with two tanks the crack outlasts the next hit (swap!); with one it ends just before it
      const dur = f.roles.tank >= 2 ? sec(20) : Math.max(1, gap - sec(0.5));
      f.addStatus(q, { id: 'crack', src: src.id, until: f.tick + dur, v: 0 }, false);
    }
  }

  /** Everyone inside takes the hit and counts a mistake. */
  private areaHit(shape: Shape, dmg: number, g: Group, src: Foe): void {
    const f = this.fight;
    for (const q of f.living()) {
      if (!inside(shape, q.x, q.z) || q.statuses.some((s) => s.id === 'airborne')) continue;
      f.hurt(q, dmg, src);
      this.miss(q, g);
    }
  }

  /** A fan or strip aimed at one player: they take it as planned, anyone else in it got it wrong. */
  private aimedHit(shape: Shape, target: string, dmg: number, g: Group, src: Foe): void {
    const f = this.fight;
    for (const q of f.living()) {
      if (!inside(shape, q.x, q.z) || q.statuses.some((s) => s.id === 'airborne')) continue;
      f.hurt(q, dmg, src);
      if (q.id !== target) this.miss(q, g);
    }
  }

  /** A step of a sweeping beam: a player it already caught a moment ago is not caught again. */
  private sweepHit(shape: Shape, key: string, dmg: number, g: Group, src: Foe): void {
    const f = this.fight;
    for (const q of f.living()) {
      if (!inside(shape, q.x, q.z)) continue;
      const k = `${key}/${q.id}`;
      if (f.tick - (this.swept.get(k) ?? -999) < sec(1)) continue;
      this.swept.set(k, f.tick);
      f.hurt(q, dmg, src);
      this.miss(q, g);
    }
  }

  private spreadHit(id: string, r: number, dmg: number, g: Group, src: Foe): void {
    const f = this.fight;
    const holder = f.players.get(id);
    if (!holder || holder.dead) return;
    for (const q of f.living()) {
      if (Math.hypot(q.x - holder.x, q.z - holder.z) > r) continue;
      f.hurt(q, dmg, src);
      // the marked player's own circle is expected; anyone else in it (marked or not) got it wrong
      if (q.id !== id) this.miss(q, g);
    }
  }

  /** exact: a stack for exactly `want` (分攤死刑): the extra people in it get hurt and count a mistake too. */
  private stackHit(id: string, r: number, dmg: number, want: number, g: Group, src: Foe, exact = false): void {
    const f = this.fight;
    const holder = f.players.get(id);
    if (!holder || holder.dead) return;
    const ins = f.living().filter((q) => Math.hypot(q.x - holder.x, q.z - holder.z) <= r);
    const each = (dmg * want) / Math.max(1, ins.length);
    for (const q of ins) f.hurt(q, each, src);
    if (ins.length < want) for (const q of ins) this.miss(q, g);
    if (exact && ins.length > want) for (const q of ins) if (q.id !== id && q.role !== 'tank') this.miss(q, g);
  }

  /**
   * A colour stack: its own colour shares it (the holders stay with their own stack, whatever their colour
   * turned into); the other colour in it takes double and got it wrong.
   */
  private colourHit(id: string, colour: 'red' | 'blue', holders: string[], r: number, dmg: number, g: Group, src: Foe): void {
    const f = this.fight;
    const holder = f.players.get(id);
    if (!holder || holder.dead) return;
    const has = (q: Fighter) => q.id === id || (!holders.includes(q.id) && q.statuses.some((s) => s.id === colour));
    const want = Math.max(1, f.living().filter(has).length);
    const ins = f.living().filter((q) => Math.hypot(q.x - holder.x, q.z - holder.z) <= r);
    const same = ins.filter(has);
    const each = (dmg * want) / Math.max(1, same.length);
    for (const q of same) f.hurt(q, each, src);
    if (same.length < want) for (const q of same) this.miss(q, g);
    for (const q of ins) {
      if (same.includes(q)) continue;
      f.hurt(q, dmg * 2, src);
      this.miss(q, g);
    }
  }

  private knockAll(dist: number, g: Group, boss: Foe): void {
    const f = this.fight;
    const lim = f.enc.arena.size - RULES.playerRadius;
    for (const q of f.living()) {
      if (q.statuses.some((s) => s.id === 'airborne')) continue;
      let dx = q.x - boss.x;
      let dz = q.z - boss.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) [dx, dz] = [Math.sin(boss.f), Math.cos(boss.f)];
      else [dx, dz] = [dx / d, dz / d];
      const x1 = q.x + dx * dist;
      const z1 = q.z + dz * dist;
      const out = f.enc.arena.shape === 'square' ? Math.max(Math.abs(x1), Math.abs(z1)) > lim : Math.hypot(x1, z1) > lim;
      if (out && this.script.edge === 'cliff') {
        f.knock(q, x1, z1, sec(0.5), true);
        this.miss(q, g);
      } else {
        const [cx, cz] = clampToArena(f.enc.arena, x1, z1);
        f.knock(q, cx, cz, sec(0.5), false);
      }
    }
  }

  private prison(hp: number, time: number, g: Group): void {
    const f = this.fight;
    const pool = f.living();
    const pick = this.shuffle(pool.filter((q) => q.role !== 'tank'))[0] ?? this.shuffle(pool)[0];
    if (!pick) return;
    // as hard as the help it can get: the others who are not tanks (or the tank, when nobody else is left)
    const helpers = Math.max(1, pool.filter((q) => q.id !== pick.id && q.role !== 'tank').length);
    const rock = f.spawnFoe('prison', pick.x, pick.z, Math.round(hp * helpers), { owner: pick.id });
    f.addStatus(pick, { id: 'stun', src: rock.id, until: f.tick + sec(time), v: 0 }, false);
    this.bossEvent('prison', g.name, pick.id);
    // checked when time is up: the rock still standing crushes the player inside
    const at = f.tick + sec(time);
    this.pending.push({
      at,
      group: g,
      run: () => {
        if (rock.hp > 0 && !rock.gone) {
          f.despawn(rock);
          const q = f.players.get(pick.id);
          if (q && !q.dead) {
            this.miss(q, g);
            f.kill(q);
          }
        }
      },
    });
    g.left++;
  }

  private summon(m: Extract<MechDef, { k: 'adds' }>): void {
    const f = this.fight;
    this.addsSummoned = true;
    this.adds = m.at.map(([x, z]) => {
      const a = f.spawnFoe(m.kind, x, z, Math.round(m.hp * f.hpScale), { auto: m.auto });
      a.f = faceTowards(x, z, 0, 0);
      return a;
    });
    this.addsDeadline = f.tick + sec(m.time);
    this.addsBoom = m.boom;
    this.together = !!m.together;
    this.addAttack = m.attack ?? null;
    this.addNext.clear();
    this.addTurn = 0;
    if (m.attack) {
      // the adds take turns: spread their first attacks over one period
      this.adds.forEach((a, k) => this.addNext.set(a.id, f.tick + sec(m.attack!.first + (m.attack!.every * k) / this.adds.length)));
    }
    this.bossEvent('adds', '');
  }

  /** The adds' timer, what they do, and the Hard rule that they fall together. */
  private addsStep(): void {
    const f = this.fight;
    if (!this.adds.length) return;
    const alive = this.adds.filter((a) => a.hp > 0 && !a.gone);
    if (!alive.length) return;
    if (f.tick >= this.addsDeadline) {
      for (const a of alive) {
        this.fight.emit({ k: 'boss', i: a.id, n: '自爆', m: 'raidwide' });
        for (const q of f.living()) f.hurt(q, this.addsBoom, a);
        a.hp = 0;
        f.despawn(a);
      }
      return;
    }
    if (this.addAttack) for (const a of alive) this.addStrike(a, this.addAttack);
    if (this.together) {
      const dead = this.adds.filter((a) => a.hp <= 0);
      if (dead.length && !this.reviveAt) this.reviveAt = f.tick + sec(10);
      if (this.reviveAt && f.tick >= this.reviveAt) {
        this.reviveAt = 0;
        for (const a of dead) {
          if (a.gone) continue;
          a.hp = Math.round(a.maxHp * 0.5);
          f.emit({ k: 'boss', i: a.id, n: '再起', m: 'revive' });
        }
      }
    }
  }

  /** An add's own attack when its turn comes: a fan in front of it, or a shot at someone. */
  private addStrike(a: Foe, atk: AddAttack): void {
    const f = this.fight;
    const due = this.addNext.get(a.id);
    if (due === undefined || f.tick < due) return;
    // a small party is not shot at more often each than a party of 4 (點名數不超過人數)
    this.addNext.set(a.id, f.tick + sec(atk.every * Math.max(1, 4 / Math.max(1, f.living().length))));
    const size = f.enc.arena.size;
    const hit = f.tick + sec(atk.k === 'cone' ? this.script.tele : 3);
    if (atk.k === 'cone') {
      const g: Group = { name: `${a.name}光束`, left: 0, failed: false, scored: true };
      const shape: Shape = { k: 'cone', x: a.x, z: a.z, f: a.f, r: atk.r, deg: atk.deg };
      this.add(hit, g, () => (a.hp > 0 && !a.gone ? this.areaHit(shape, atk.dmg, g, a) : undefined), { shape, color: 'o', start: f.tick });
      return;
    }
    const living = f.living();
    if (!living.length) return;
    const q = living[(this.addTurn++ * 7 + Math.floor(f.random() * living.length)) % living.length]!;
    const g: Group = { name: `${a.name}射擊`, left: 0, failed: false, scored: true };
    const shape: Shape = { k: 'rect', x: a.x, z: a.z, f: faceTowards(a.x, a.z, q.x, q.z), len: size * 2.6, w: atk.w };
    this.add(
      hit,
      g,
      () => {
        if (a.hp <= 0 || a.gone) return;
        this.aimedHit(shape, q.id, atk.dmg, g, a);
        const h = f.players.get(q.id);
        if (atk.puddle && h && !h.dead) this.puddle(h.x, h.z, atk.puddle, g.name, a);
      },
      { shape, color: 'o', aim: q.id, from: a.id, start: f.tick },
    );
  }

  /** Leaves a pool that hurts whoever stands in it, once a second, for `time` seconds. */
  private puddle(x: number, z: number, p: { r: number; dmg: number; time: number }, name: string, src: Foe): void {
    const f = this.fight;
    const tele: Tele = { id: ++this.seq, shape: { k: 'circle', x, z, r: p.r }, color: 'p', start: f.tick, end: f.tick + sec(p.time), shown: true, zone: true };
    this.puddles.push({ tele, armed: f.tick + sec(1), group: { name, left: 0, failed: false, scored: true }, dmg: p.dmg, hit: new Map(), missed: new Set() });
    void src;
  }

  private pools(): void {
    const f = this.fight;
    if (!this.puddles.length) return;
    this.puddles = this.puddles.filter((p) => p.tele.end > f.tick);
    for (const p of this.puddles) {
      if (f.tick < p.armed) continue;
      for (const q of f.living()) {
        if (!inside(p.tele.shape, q.x, q.z)) continue;
        if (f.tick - (p.hit.get(q.id) ?? -999) < sec(1)) continue;
        p.hit.set(q.id, f.tick);
        f.hurt(q, p.dmg, null);
        if (!p.missed.has(q.id)) {
          p.missed.add(q.id);
          f.fail(q, p.group.name);
        }
      }
    }
  }

  // ------------------------------------------------------------------ 雙子機神

  /** 共鳴, 失衡 and 合體: the rules of fighting two bosses at once. */
  private twinRules(): void {
    const f = this.fight;
    const tw = this.twin;
    const rules = this.script.twin;
    if (!tw || !rules) return;
    const a = this.foe;
    const since = f.tick - this.phaseStart;
    // 共鳴: too close when checked, both power up
    if (since > 0 && since % sec(rules.resonance.every) === 0 && Math.hypot(a.x - tw.x, a.z - tw.z) < rules.resonance.dist) {
      for (const e of [a, tw]) {
        const old = e.statuses.find((s) => s.id === 'resonance');
        if (old) old.v++;
        else e.statuses.push({ id: 'resonance', src: e.id, until: -1, v: 1 });
      }
      f.emit({ k: 'boss', i: a.id, n: '共鳴', m: 'resonance' });
    }
    // 失衡: one much healthier than the other
    const gap = Math.abs(a.hp / a.maxHp - tw.hp / tw.maxHp);
    if (since > 0 && since % sec(rules.imbalance.every) === 0 && gap > rules.imbalance.gap) {
      const src = a.hp / a.maxHp > tw.hp / tw.maxHp ? a : tw;
      f.emit({ k: 'boss', i: src.id, n: '失衡', m: 'raidwide' });
      for (const q of f.living()) f.hurt(q, rules.imbalance.dmg, src);
    }
    // the first one down to the threshold waits, unhurt; both there: they merge
    for (const e of [a, tw]) {
      if (e.minHp !== undefined && e.hp <= e.minHp && !e.statuses.some((s) => s.id === 'sealed')) e.statuses.push({ id: 'sealed', src: e.id, until: -1, v: 0 });
    }
    if (a.minHp !== undefined && tw.minHp !== undefined && a.hp <= a.minHp && tw.hp <= tw.minHp) this.fuse(rules);
  }

  private fuse(rules: Twin): void {
    const f = this.fight;
    const a = this.foe;
    const tw = this.twin!;
    const hp = a.hp + tw.hp;
    const [x, z] = [(a.x + tw.x) / 2, (a.z + tw.z) / 2];
    a.minHp = undefined;
    tw.minHp = undefined;
    f.despawn(a);
    f.despawn(tw);
    const merged = f.spawnFoe(rules.fuse.kind, x, z, hp, { id: 'fused', auto: this.script.auto });
    for (const [id, v] of a.enmity) merged.enmity.set(id, v);
    this.foe = merged;
    this.twin = null;
    f.emit({ k: 'boss', i: merged.id, n: '合體', m: 'fuse' });
    const next = this.script.phases.findIndex((p, k) => k > this.phase && !p.untilFused);
    this.enter(next < 0 ? this.phase : next);
  }

  /** A mistake: the penalty, the count, and no Limit Break bonus for this mechanic. */
  private miss(q: Fighter, g: Group): void {
    g.failed = true;
    this.fight.fail(q, g.name);
  }
}
