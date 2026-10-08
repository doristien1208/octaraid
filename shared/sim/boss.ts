import { RULES, sec } from '../constants';
import type { FoeKind } from '../bosses/foes';
import type { FightEvent } from '../protocol';
import { clampToArena } from './arena';
import type { Fight, Fighter, Foe } from './fight';
import { inside, type Shape, type TeleColor } from './mech';

/**
 * One attack in a boss script (the mechanic library, section 六 of the design doc). Damage numbers are
 * for the difficulty the script was built for. Seconds; `delay` moves the hit after the end of the cast.
 */
export type MechDef =
  /** everyone takes it: top up and mitigate */
  | { k: 'raidwide'; dmg: number }
  /** the top of the enmity list takes it; with 2 hits the second goes to whoever is top then (tank swap) */
  | { k: 'buster'; dmg: number; hits?: number; gap?: number }
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
  /** a circle on each marked player that splits `dmg` × the expected number of people: gather in */
  | { k: 'stack'; r: number; dmg: number; groups: number }
  /** pushes everyone away from the boss; where the arena edge is a cliff, off it means down */
  | { k: 'knockback'; dist: number }
  /** one player is shut in rock: break it within `time` or they go down; `hp` per player free to help */
  | { k: 'prison'; hp: number; time: number }
  /** adds: kill them within `time` or each one left explodes for `boom`; together: the first to fall gets up again unless the rest follow within 10 s */
  | { k: 'adds'; kind: FoeKind; at: [number, number][]; hp: number; auto: number; time: number; boom: number; together?: boolean }
  /** the boss leaps to the centre (looks only) */
  | { k: 'jump' };

export interface Entry {
  /** seconds into the phase when the cast starts */
  at: number;
  /** name on the cast bar: the same name always means the same attack (Hard players read it) */
  name: string;
  /** cast time, seconds */
  cast: number;
  mechs: MechDef[];
}

export interface Phase {
  name: string;
  /** ends when the boss falls below this share of its HP */
  hpBelow?: number;
  /** ends when the adds it summoned are gone */
  untilAddsGone?: boolean;
  /** the boss cannot be targeted, hurt or attack during this phase */
  untargetable?: boolean;
  entries: Entry[];
  /** after `at` seconds, carry on from `to`, and keep looping */
  loop?: { at: number; to: number };
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
}

/** A shape on the ground (or a marker over a head) that players can see, until it hits. */
export interface Tele {
  id: number;
  shape: Shape;
  color: TeleColor;
  /** follows this player, or whoever is top of the boss's enmity list */
  on?: string;
  start: number;
  end: number;
  /** text on it, e.g. how many people a stack wants */
  text?: string;
  shown: boolean;
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

const TOP = '@top';

/**
 * Runs a boss script on a Fight: phases (by HP or by adds), the timeline of casts and their mechanics,
 * telegraphs, penalties, the Limit Break bonus for clean mechanics, adds, the enrage cast. Random choices
 * (who is marked, where rocks fall) come from the fight's seeded generator, so a fight can be replayed.
 */
export class BossBrain {
  phase = -1;
  private phaseStart = 0;
  private next = 0;
  /** ticks the timeline has been pushed back by its loops */
  private shift = 0;
  private pending: Pending[] = [];
  private seq = 0;
  private enraging = false;
  /** adds summoned in the current phase */
  private adds: Foe[] = [];
  private addsSummoned = false;
  private addsDeadline = 0;
  private addsBoom = 0;
  private together = false;
  private reviveAt = 0;

  constructor(
    private readonly fight: Fight,
    readonly foe: Foe,
    readonly script: BossScript,
  ) {}

  get current(): Phase | undefined {
    return this.script.phases[this.phase];
  }

  /** Telegraphs players can see now. */
  visible(): Tele[] {
    const t = this.fight.tick;
    const out: Tele[] = [];
    for (const p of this.pending) if (p.tele?.shown && p.tele.start <= t && p.tele.end >= t) out.push(p.tele);
    return out;
  }

  /** All pending hazards, the hidden ones too (for the computer players and the tests). */
  hazards(): readonly Tele[] {
    return this.pending.flatMap((p) => (p.tele ? [p.tele] : []));
  }

  /** Who a following telegraph sits on right now. */
  holder(t: Tele): Fighter | undefined {
    if (!t.on) return undefined;
    if (t.on === TOP) return this.fight.topOf(this.foe) ?? undefined;
    return this.fight.players.get(t.on);
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
      this.castBar(this.script.enrage.name, sec(this.script.enrage.cast), 'enrage');
    }
    if (!this.enraging) {
      this.checkPhase();
      this.timeline();
    }
    this.resolve();
    this.addsStep();
  }

  private enter(k: number): void {
    const f = this.fight;
    this.cancel();
    this.phase = k;
    this.phaseStart = f.tick;
    this.next = 0;
    this.shift = 0;
    this.adds = [];
    this.addsSummoned = false;
    this.reviveAt = 0;
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
    this.foe.cast = null;
    this.foe.lockUntil = 0;
  }

  // ------------------------------------------------------------------ casts and mechanics

  private castBar(name: string, ticks: number, m: NonNullable<Foe['cast']>['m'], target: string | null = null): void {
    const t = this.fight.tick;
    this.foe.cast = { name, m, start: t, end: t + ticks, target };
    this.fight.emit({ k: 'bcast', i: this.foe.id, n: name, m, t: target ?? undefined, d: ticks });
  }

  private begin(e: Entry): void {
    const f = this.fight;
    const t0 = f.tick;
    const t1 = t0 + sec(e.cast);
    const kinds = e.mechs.map((m) => m.k);
    const m: NonNullable<Foe['cast']>['m'] = kinds.includes('raidwide') ? 'raidwide' : kinds.includes('buster') ? 'buster' : 'mech';
    const buster = e.mechs.find((x) => x.k === 'buster');
    const top = buster ? f.topOf(this.foe) : null;
    if (e.cast > 0) this.castBar(e.name, t1 - t0, m, top?.id ?? null);
    const group: Group = { name: e.name, left: 0, failed: false, scored: false };
    for (const mech of e.mechs) this.schedule(mech, t0, t1, group, top);
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

  private schedule(m: MechDef, t0: number, t1: number, g: Group, top: Fighter | null): void {
    const f = this.fight;
    const boss = this.foe;
    const size = f.enc.arena.size;
    switch (m.k) {
      case 'raidwide':
        this.add(t1, g, () => {
          this.bossEvent('raidwide', g.name);
          for (const q of f.living()) f.hurt(q, m.dmg, boss);
        });
        return;
      case 'buster': {
        const gap = sec(m.gap ?? 4);
        // without a tank the double buster hits once (缺角補正): nobody could take it twice
        const hits = f.roles.tank ? (m.hits ?? 1) : 1;
        const target = top?.id;
        this.add(t1, g, () => this.busterHit(target, m.dmg, hits > 1, gap, g.name), { shape: { k: 'mark' }, color: 'r', on: target, start: t0 });
        for (let k = 1; k < hits; k++) {
          // the next hit goes to whoever is top then: the other tank should have taken the boss
          this.add(t1 + gap * k, g, () => this.busterHit(undefined, m.dmg, k < hits - 1, gap, g.name), {
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
        this.add(at, g, () => this.areaHit(shape, m.dmg, g), { shape, color: 'o', start: this.teleStart(at, t0), shown: this.shown('chariot') });
        return;
      }
      case 'donut': {
        const at = t1 + sec(m.delay ?? 0);
        g.scored = true;
        const shape: Shape = { k: 'donut', x: boss.x, z: boss.z, r0: m.r0, r1: size * 1.5 };
        // a donut after a chariot shows only once the chariot has gone off
        const start = m.delay ? Math.max(t1, this.teleStart(at, t0)) : this.teleStart(at, t0);
        this.add(at, g, () => this.areaHit(shape, m.dmg, g), { shape, color: 'o', start, shown: this.shown('donut') });
        return;
      }
      case 'cone': {
        g.scored = true;
        boss.lockUntil = t1; // it stops turning: the fan points where it faced when the cast began
        const shape: Shape = { k: 'cone', x: boss.x, z: boss.z, f: boss.f, r: size * 2, deg: m.deg };
        this.add(t1, g, () => this.areaHit(shape, m.dmg, g), { shape, color: 'o', start: this.teleStart(t1, t0), shown: this.shown('cone') });
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
            this.add(at, g, () => this.areaHit(shape, m.dmg, g), { shape, color: 'o', start: Math.max(t0, at - sec(this.script.tele)), shown: this.shown('rocks') });
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
            this.add(at, g, () => this.areaHit(shape, m.dmg, g), {
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
          this.add(t1, g, () => this.spreadHit(id, m.r, m.dmg, g), { shape: { k: 'circle', x: 0, z: 0, r: m.r }, color: 'p', on: id, start: t0 });
        }
        return;
      }
      case 'stack': {
        g.scored = true;
        // healers and DPS first: a stack on a tank drags the boss around
        const living = f.living();
        const pool = [...this.shuffle(living.filter((q) => q.role !== 'tank')), ...this.shuffle(living.filter((q) => q.role === 'tank'))];
        const groups = Math.max(1, Math.min(m.groups, Math.floor(living.length / 2) || 1));
        const want = Math.max(1, Math.ceil(living.length / groups));
        const marked = pool.slice(0, groups).map((q) => q.id);
        for (const id of marked) {
          this.add(t1, g, () => this.stackHit(id, m.r, m.dmg, want, g), {
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
        this.add(t1, g, () => this.knockAll(m.dist, g), { shape, color: 'w', start: this.teleStart(t1, t0) });
        return;
      }
      case 'prison':
        g.scored = true;
        this.add(t1, g, () => this.prison(m.hp, m.time, g));
        return;
      case 'adds':
        this.add(t1, g, () => this.summon(m));
        return;
      case 'jump':
        this.add(t0, g, () => this.bossEvent('jump', g.name));
        return;
    }
  }

  private bossEvent(m: Extract<FightEvent, { k: 'boss' }>['m'], n: string, t?: string): void {
    this.fight.emit({ k: 'boss', i: this.foe.id, n, m, t });
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

  private busterHit(target: string | undefined, dmg: number, crack: boolean, gap: number, name: string): void {
    const f = this.fight;
    const q = target ? f.players.get(target) : (f.topOf(this.foe) ?? undefined);
    if (!q || q.dead) return;
    this.bossEvent('buster', name, q.id);
    f.hurt(q, dmg * (f.roles.tank ? 1 : RULES.noTankDamage), this.foe);
    if (crack && !q.dead) {
      // with two tanks the crack outlasts the next hit (swap!); with one it ends just before it
      const dur = f.roles.tank >= 2 ? sec(20) : Math.max(1, gap - sec(0.5));
      f.addStatus(q, { id: 'crack', src: this.foe.id, until: f.tick + dur, v: 0 }, false);
    }
  }

  /** Everyone inside takes the hit and counts a mistake. */
  private areaHit(shape: Shape, dmg: number, g: Group): void {
    const f = this.fight;
    for (const q of f.living()) {
      if (!inside(shape, q.x, q.z) || q.statuses.some((s) => s.id === 'airborne')) continue;
      f.hurt(q, dmg, this.foe);
      this.miss(q, g);
    }
  }

  private spreadHit(id: string, r: number, dmg: number, g: Group): void {
    const f = this.fight;
    const src = f.players.get(id);
    if (!src || src.dead) return;
    for (const q of f.living()) {
      if (Math.hypot(q.x - src.x, q.z - src.z) > r) continue;
      f.hurt(q, dmg, this.foe);
      // the marked player's own circle is expected; anyone else in it (marked or not) got it wrong
      if (q.id !== id) this.miss(q, g);
    }
  }

  private stackHit(id: string, r: number, dmg: number, want: number, g: Group): void {
    const f = this.fight;
    const src = f.players.get(id);
    if (!src || src.dead) return;
    const ins = f.living().filter((q) => Math.hypot(q.x - src.x, q.z - src.z) <= r);
    const each = (dmg * want) / Math.max(1, ins.length);
    for (const q of ins) f.hurt(q, each, this.foe);
    if (ins.length < want) for (const q of ins) this.miss(q, g);
  }

  private knockAll(dist: number, g: Group): void {
    const f = this.fight;
    const boss = this.foe;
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
    this.adds = m.at.map(([x, z]) => f.spawnFoe(m.kind, x, z, Math.round(m.hp * f.hpScale), { auto: m.auto }));
    this.addsDeadline = f.tick + sec(m.time);
    this.addsBoom = m.boom;
    this.together = !!m.together;
    this.bossEvent('adds', '');
  }

  /** The adds' timer, and the Hard rule that they fall together. */
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

  /** A mistake: the penalty, the count, and no Limit Break bonus for this mechanic. */
  private miss(q: Fighter, g: Group): void {
    g.failed = true;
    this.fight.fail(q, g.name);
  }
}
