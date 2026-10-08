import { RULES, TICK_MS, TICK_RATE, sec } from '../constants';
import type { JobId } from '../jobs';
import { STATUS } from '../status';
import { clampToArena, reach, sideOf } from './arena';
import type { Tele } from './boss';
import type { Fight, Fighter, Foe } from './fight';
import { inside } from './mech';

/** How far ahead (ticks) the computer players plan around boss attacks. */
const HORIZON = Math.round(5 * TICK_RATE);
/** Attacks closer than this (ticks) are dodged at all costs; later ones count less. */
const URGENT = Math.round(2.5 * TICK_RATE);
/** Keep this far (metres) from the edge of a shape: a bot stops a little short of where it heads. */
const MARGIN = 0.9;

function near(shape: Tele['shape'], x: number, z: number): boolean {
  return (
    inside(shape, x, z) ||
    inside(shape, x + MARGIN, z) ||
    inside(shape, x - MARGIN, z) ||
    inside(shape, x, z + MARGIN) ||
    inside(shape, x, z - MARGIN)
  );
}

/**
 * Computer party members for offline practice and the tests (the "dev bots" of section 九). They stand
 * where their role belongs, keep a plain rotation, mitigate tank busters, heal and raise, and handle boss
 * mechanics the way an experienced player would: they read every pending attack (even the ones Hard
 * hides), step out of shapes, spread to fixed slots, gather on stacks, stay close before a knockback,
 * swap tanks, kill adds and break prisons. They send the same requests a client would (move, use).
 */
export class Bot {
  private now = 0;
  private lastFlank = -999;

  constructor(
    private readonly fight: Fight,
    readonly id: string,
    /** where to stand: [angle, metres outside the boss's ring, measured from the boss's facing (true) or from the south] */
    private readonly spot: Spot = spotFor(fight.players.get(id)!.job.id, 0),
  ) {}

  /** Call once per tick, before fight.step(); `nowMs` is the server clock the moves are stamped with. */
  think(nowMs?: number): void {
    this.now = nowMs ?? this.now + TICK_MS;
    const f = this.fight;
    const me = f.players.get(this.id);
    if (!me || me.dead || f.phase === 'over') return;
    if (me.statuses.some((s) => STATUS[s.id].stun)) return;
    const focus = this.focus(me);
    const goal = this.goal(me, focus);
    // something lands soon and I am not where I should be: move now, even out of a cast
    const urgent = this.urgent(me, goal);
    const still = f.phase === 'fight' && focus && !urgent ? this.act(me, focus, goal) : false;
    if (!me.dash && (urgent || (!me.cast && !still))) this.walk(me, goal);
  }

  /** An attack lands before I could get where I should be unless I go now (out of a cast if need be). */
  private urgent(me: Fighter, goal: [number, number]): boolean {
    const brain = this.fight.brain;
    if (!brain) return false;
    const t = this.fight.tick;
    const away = Math.hypot(goal[0] - me.x, goal[1] - me.z);
    if (away <= 1) return false;
    const travel = (away / RULES.moveSpeed) * TICK_RATE;
    return brain.hazards().some((h) => h.end >= t && (h.end - t <= URGENT || h.end - t <= travel + TICK_RATE));
  }

  // ------------------------------------------------------------------ what to hit

  /** The enemy to fight: a prison first (not tanks), the boss when it can be hit, else the adds. */
  private focus(me: Fighter): Foe | null {
    const f = this.fight;
    const live = f.foes.filter((e) => f.hittable(e));
    if (!live.length) return null;
    const prison = live.find((e) => e.kind === 'prison');
    // everyone free breaks a prison; tanks only when nobody else can
    const helpers = f.living().filter((q) => q.role !== 'tank' && q.id !== prison?.owner).length;
    if (prison && (me.role !== 'tank' || !helpers)) return prison;
    const boss = live.find((e) => e.boss);
    if (boss) return boss;
    const adds = live.filter((e) => e.kind !== 'prison');
    if (!adds.length) return prison ?? null;
    if (me.role === 'tank') {
      // a tank goes for an add that is hitting someone else
      const loose = adds.find((a) => f.topOf(a)?.role !== 'tank');
      if (loose) return loose;
      const tanks = [...f.players.values()].filter((q) => q.role === 'tank' && !q.dead).sort((a, b) => a.id.localeCompare(b.id));
      return adds[Math.max(0, tanks.findIndex((q) => q.id === me.id)) % adds.length]!;
    }
    // Hard adds must fall together: hit the healthier one; otherwise finish the weaker one
    const together = this.fight.hard;
    return adds.reduce((a, b) => (together ? (b.hp > a.hp ? b : a) : b.hp < a.hp ? b : a));
  }

  // ------------------------------------------------------------------ where to stand

  private goal(me: Fighter, focus: Foe | null): [number, number] {
    const base = focus ? this.base(me, focus) : ([me.x, me.z] as [number, number]);
    return this.fight.brain ? this.plan(me, base) : base;
  }

  /**
   * The role's spot around what it fights. Around adds and prisons the tanks and the ranged keep their
   * usual spots (the adds walk to the tanks, so they end up side by side), melee stand behind the target.
   */
  private base(me: Fighter, focus: Foe): [number, number] {
    const f = this.fight;
    const boss = f.brain?.foe ?? f.foes.find((e) => e.boss) ?? focus;
    const around = (anchor: Foe): [number, number] => {
      const [ang, dist, rel] = this.where(me);
      const a = (rel ? anchor.f : 0) + ang;
      return clampToArena(f.enc.arena, anchor.x + Math.sin(a) * (anchor.r + dist), anchor.z + Math.cos(a) * (anchor.r + dist));
    };
    if (focus.boss) return around(focus);
    if (me.job.id === 'brawler' || me.job.id === 'lancer') {
      const a = focus.f + Math.PI;
      return clampToArena(f.enc.arena, focus.x + Math.sin(a) * (focus.r + 1), focus.z + Math.cos(a) * (focus.r + 1));
    }
    return around(boss);
  }

  /** The brawler steps to the flank for 旋風踢 and to the rear otherwise. */
  private where(me: Fighter): Spot {
    if (me.job.id === 'brawler' && this.readyIn(me, 1) < 30 && this.fight.tick - this.lastFlank > 60) return [Math.PI / 2, 1, true];
    return this.spot;
  }

  /**
   * Around boss attacks: picks the spot that keeps out of every shape about to hit, keeps spreads apart,
   * gathers stacks, stays close before a knockback off a cliff, and is as near as possible to where the
   * role (or the spread / stack slot) wants to be.
   */
  private plan(me: Fighter, base: [number, number]): [number, number] {
    const f = this.fight;
    const brain = f.brain!;
    const t = f.tick;
    const hz = brain.hazards().filter((h) => h.end >= t && h.end - t <= HORIZON);
    if (!hz.length) return base;
    const boss = brain.foe;
    const holders = (color: Tele['color']) =>
      hz
        .filter((h) => h.color === color)
        .map((h) => ({ h, q: brain.holder(h) }))
        .filter((x): x is { h: Tele; q: Fighter } => !!x.q && !x.q.dead)
        .sort((a, b) => a.q.id.localeCompare(b.q.id));
    const spreads = holders('p');
    const stacks = holders('y');
    const areas = hz.filter((h) => h.color === 'o');
    const donut = areas.find((h) => h.shape.k === 'donut');
    const knock = hz.find((h) => h.shape.k === 'push');
    const size = f.enc.arena.size;
    const at = (a: number, r: number): [number, number] => clampToArena(f.enc.arena, boss.x + Math.sin(a) * r, boss.z + Math.cos(a) * r);

    // where I would like to be
    let pref = base;
    const mine = spreads.findIndex((s) => s.q.id === me.id);
    if (mine >= 0) {
      const n = spreads.length;
      pref = at(Math.PI / 2 + (mine * 2 * Math.PI) / n, donut ? Math.max(3, (donut.shape.k === 'donut' ? donut.shape.r0 : 8) - 2) : 14);
    }
    let stackOn: Fighter | null = null;
    if (stacks.length) {
      const k = stacks.findIndex((s) => s.q.id === me.id);
      const n = stacks.length;
      const slot = (j: number): [number, number] =>
        n === 1 ? (donut ? at(0, 4) : base) : at(Math.PI / 2 + (j * 2 * Math.PI) / n, donut ? 5 : 9);
      if (k >= 0) pref = slot(k);
      else {
        // the others split between the stacks, nearest first, as evenly as the stacks want
        const want = Number(stacks[0]!.h.text ?? '1');
        const others = f
          .living()
          .filter((q) => !stacks.some((s) => s.q.id === q.id))
          .sort((a, b) => a.id.localeCompare(b.id));
        const load = stacks.map(() => 1);
        let mineAt = 0;
        for (const q of others) {
          const order = stacks.map((_, j) => j).sort((a, b) => Math.hypot(q.x - stacks[a]!.q.x, q.z - stacks[a]!.q.z) - Math.hypot(q.x - stacks[b]!.q.x, q.z - stacks[b]!.q.z));
          const j = order.find((x) => load[x]! < want) ?? order[0]!;
          load[j]!++;
          if (q.id === me.id) mineAt = j;
        }
        stackOn = stacks[mineAt]!.q;
        pref = [stackOn.x, stackOn.z];
      }
    }

    const cands: [number, number][] = [pref, [me.x, me.z], base];
    for (let r = 1.5; r < size; r += 1.5) for (let k = 0; k < 24; k++) cands.push(at((k / 24) * Math.PI * 2 + r * 0.1, r));
    for (const r of [1, 2, 3]) for (let k = 0; k < 8; k++) cands.push(clampToArena(f.enc.arena, pref[0] + Math.sin((k * Math.PI) / 4) * r, pref[1] + Math.cos((k * Math.PI) / 4) * r));
    const soon = Math.min(...hz.map((h) => h.end - t)) / TICK_RATE;
    const others = f.living().filter((q) => q.id !== me.id);
    let best = pref;
    let bestCost = Infinity;
    for (const c of cands) {
      const [x, z] = clampToArena(f.enc.arena, c[0], c[1]);
      let cost = 0;
      for (const h of areas) if (near(h.shape, x, z)) cost += h.end - t <= URGENT ? 1000 : 250;
      if (knock && knock.shape.k === 'push' && brain.script.edge === 'cliff') {
        const max = size - RULES.playerRadius - knock.shape.dist - 1;
        if (Math.hypot(x - knock.shape.x, z - knock.shape.z) > max) cost += 1000;
      }
      for (const s of spreads) {
        if (s.q.id === me.id) continue;
        const r = s.h.shape.k === 'circle' ? s.h.shape.r : 5;
        if (Math.hypot(x - s.q.x, z - s.q.z) <= r + 1.2) cost += 800;
      }
      if (mine >= 0) {
        const r = spreads[mine]!.h.shape.k === 'circle' ? (spreads[mine]!.h.shape as { r: number }).r : 5;
        for (const q of others) if (Math.hypot(x - q.x, z - q.z) <= r + 1.2) cost += 300;
      }
      for (const s of stacks) {
        if (s.q.id === me.id || s.q === stackOn) continue;
        const r = s.h.shape.k === 'circle' ? s.h.shape.r : 4;
        if (Math.hypot(x - s.q.x, z - s.q.z) <= r + 1) cost += 600; // the other stack
      }
      cost += Math.hypot(x - pref[0], z - pref[1]) * (stackOn ? 12 : 6);
      cost += Math.hypot(x - me.x, z - me.z) * 0.5;
      if (Math.hypot(x - me.x, z - me.z) / RULES.moveSpeed > soon + 0.2) cost += 150;
      if (cost < bestCost) {
        bestCost = cost;
        best = [x, z];
      }
    }
    return best;
  }

  private walk(me: Fighter, [gx, gz]: [number, number]): void {
    const dx = gx - me.x;
    const dz = gz - me.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) return;
    const step = Math.min(d, (RULES.moveSpeed * 0.95 * TICK_MS) / 1000);
    this.fight.move(this.id, me.x + (dx / d) * step, me.z + (dz / d) * step, Math.atan2(dx, dz), this.now);
  }

  // ------------------------------------------------------------------ skills

  /** Uses a skill if it is time; true while it wants to stand still for a cast. */
  private act(me: Fighter, focus: Foe, goal: [number, number]): boolean {
    const f = this.fight;
    const t = f.tick;
    if (me.cast || me.dash || me.lockUntil > t) return !!me.cast;
    const gcdLeft = me.gcdAt + me.gcdLen - t;
    const weave = gcdLeft >= RULES.lock + 3;
    const use = (slot: number, target: string | null = focus.id) => f.use(this.id, slot, { target }) === 'ok';
    const ready = (slot: number) => this.readyIn(me, slot) <= 0;
    const inMelee = reach(me.x, me.z, focus) <= 3;
    // casts only when standing where it means to stay
    const settled = Math.hypot(goal[0] - me.x, goal[1] - me.z) < 1.2;
    const boss = f.brain?.foe ?? f.foes.find((e) => e.boss) ?? focus;
    const sec3 = 3 * TICK_RATE;

    if (me.role === 'tank') {
      const busterOnMe = boss.cast?.m === 'buster' && boss.cast.target === me.id;
      const top = f.topOf(focus);
      const cracked = (q: Fighter) => q.statuses.some((s) => s.id === 'crack');
      // take the enemy back from a non-tank; on a tank buster with a crack, the other tank takes over
      const swap = top && top.id !== me.id && top.role === 'tank' && cracked(top) && !cracked(me) && focus === boss;
      if (top && (top.role !== 'tank' || swap) && ready(1) && use(1)) return false;
      // slot 2 is the short mitigation, slot 3 the big one (both tanks): the short one for a buster, the big
      // one for the second hit of a double buster that lands on me again (a lone tank)
      const has = (...ids: string[]) => me.statuses.some((s) => ids.includes(s.id));
      // a buster marker on me (the second hit follows whoever is top: after a swap, that is me)
      const marked = !!f.brain?.hazards().some((h) => h.color === 'r' && h.end - t <= sec3 && f.brain!.holder(h)?.id === me.id);
      const second = (cracked(me) && f.topOf(boss)?.id === me.id) || (marked && !busterOnMe);
      const low = me.hp / f.maxHp(me) < 0.85;
      // the big one just before the hit lands, so it still covers a second hit 4 s later
      const soon = busterOnMe && boss.cast!.end - t <= sec(1.2);
      if ((second || (soon && low)) && !has('fortress', 'holmgang') && ready(3) && use(3, null)) return false;
      if ((busterOnMe || second) && !has('rampart', 'bloodlust', 'fortress', 'holmgang')) for (const s of [2, 3]) if (ready(s) && use(s, null)) return false;
      if (me.job.id === 'guardian' && boss.cast?.m === 'raidwide' && ready(4) && use(4, null)) return false;
      if (gcdLeft > 0) return false;
      if (me.job.id === 'berserker' && ready(4) && inMelee && use(4, null)) return false;
      if (inMelee) use(0);
      return false;
    }

    if (me.role === 'healer') {
      const allies = [...f.players.values()];
      const fallen = allies.find((q) => q.dead && reach(me.x, me.z, { x: q.x, z: q.z, r: RULES.playerRadius }) <= 30);
      const alive = allies.filter((q) => !q.dead);
      const pct = (q: Fighter) => q.hp / f.maxHp(q);
      const lowest = alive.reduce((a, b) => (pct(b) < pct(a) ? b : a), me);
      const avg = alive.reduce((n, q) => n + pct(q), 0) / Math.max(1, alive.length);
      const busted = boss.cast?.m === 'buster' ? alive.find((q) => q.id === boss.cast!.target) : undefined;
      const priest = me.job.id === 'priest';
      if (pct(lowest) < 0.35 && priest && ready(3) && use(3, lowest.id)) return false;
      if (busted && pct(busted) < 0.7 && priest && ready(3) && use(3, busted.id)) return false;
      if (!priest && avg < 0.8 && weave && ready(3) && use(3, null)) return false;
      if (gcdLeft > 0 || !settled) return false;
      if (fallen && ready(4)) return use(4, fallen.id);
      if (busted && pct(busted) < 0.98) return use(1, busted.id);
      if (!priest && boss.cast?.m === 'raidwide' && ready(2)) return use(2, null);
      if (avg < 0.8 && ready(2)) return use(2, null);
      if (pct(lowest) < 0.8) return use(1, lowest.id);
      return use(0);
    }

    // DPS
    switch (me.job.id as JobId) {
      case 'brawler': {
        if (weave && ready(3) && use(3, null)) return false;
        if (weave && ready(2) && inMelee && sideOf(focus, me.x, me.z) === 'rear' && use(2)) return false;
        if (gcdLeft > 0 || !inMelee) return false;
        if (ready(1) && (sideOf(focus, me.x, me.z) === 'flank' || !focus.boss)) {
          if (use(1)) this.lastFlank = t;
          return false;
        }
        use(0);
        return false;
      }
      case 'lancer': {
        if (weave && ready(3) && use(3, null)) return false;
        // the jump moves me: not while something is about to land
        if (weave && ready(2) && settled && !f.brain?.hazards().length && use(2)) return false;
        if (gcdLeft > 0 || !inMelee) return false;
        if (ready(1) && use(1)) return false;
        use(0);
        return false;
      }
      case 'ranger': {
        if (weave && ready(3) && boss.cast?.m === 'raidwide' && use(3, null)) return false;
        if (weave && ready(2) && use(2)) return false;
        // the backflip lands about 10 m further out, still in range; not while dodging
        if (weave && ready(4) && settled && !f.brain?.hazards().length && use(4)) return false;
        if (gcdLeft > 0) return false;
        if (ready(1) && use(1)) return false;
        use(0);
        return false;
      }
      case 'sorcerer': {
        const swift = me.statuses.some((s) => s.id === 'swift');
        if (weave && settled && ready(3) && !f.brain?.hazards().length && use(3, null)) return false;
        if (weave && ready(2) && this.readyIn(me, 4) < 45 && !swift && use(2, null)) return false;
        if (gcdLeft > 0) return false;
        if (!settled && !swift) return false;
        if (ready(4)) return use(4);
        if (ready(1)) return use(1);
        return use(0);
      }
      default:
        return false;
    }
  }

  private readyIn(me: Fighter, slot: number): number {
    return me.ready[slot]! - this.fight.tick;
  }
}

/** [angle, metres outside the boss's ring, true: the angle turns with the boss (positionals)] */
export type Spot = [number, number, boolean];

/**
 * Where a job stands. The tank holds the boss facing south (where the party starts), melee stand
 * behind the boss whichever way it turns, ranged and healers spread out south of it, close enough for
 * 15 m party heals to reach everyone. `k` spreads a second player of the same job.
 */
export function spotFor(job: JobId, k: number): Spot {
  switch (job) {
    case 'guardian':
    case 'berserker':
      return [k ? 0.35 : 0, 1.2, false];
    case 'brawler':
      return [Math.PI, 1, true];
    case 'lancer':
      return [Math.PI - 0.6 - k * 0.3, 1.2, true];
    case 'ranger':
      return [0.9 + k * 0.35, 8, false];
    case 'sorcerer':
      return [-0.9 - k * 0.35, 8, false];
    case 'priest':
      return [0.45 + k * 0.3, 7, false];
    case 'warden':
      return [-0.45 - k * 0.3, 7, false];
  }
}
