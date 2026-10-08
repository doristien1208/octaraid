import { RULES, TICK_MS, TICK_RATE, sec } from '../constants';
import type { JobId } from '../jobs';
import { STATUS } from '../status';
import { angleDiff, clampToArena, reach, sideOf } from './arena';
import type { Tele } from './boss';
import type { Fight, Fighter, Foe } from './fight';
import { hidden, inside, type Pillar, type Shape } from './mech';

/** How far ahead (ticks) the computer players plan around boss attacks. */
const HORIZON = Math.round(5 * TICK_RATE);
/** Attacks closer than this (ticks) are dodged at all costs; later ones count less. */
const URGENT = Math.round(2.5 * TICK_RATE);
/** Some things take a long walk to get right (a pillar, a tower, a tether): look this far ahead for them. */
const AHEAD = Math.round(8 * TICK_RATE);
/** A bomb holder leaves the group this long before it goes off. */
const BOMB_AHEAD = Math.round(4.5 * TICK_RATE);
/** Keep this far (metres) from the edge of a shape: a bot stops a little short of where it heads. */
const MARGIN = 0.9;
/** Plan again every this many ticks (planning is the expensive part of a simulated fight). */
const REPLAN = 3;

function near(shape: Shape, x: number, z: number): boolean {
  return (
    inside(shape, x, z) ||
    inside(shape, x + MARGIN, z) ||
    inside(shape, x - MARGIN, z) ||
    inside(shape, x, z + MARGIN) ||
    inside(shape, x, z - MARGIN)
  );
}

/**
 * Plans the whole party must agree on (who takes which tower or pillar), shared by the bots of a fight:
 * the first bot to see a mechanic works it out from where everyone stands, the rest follow it.
 */
interface Shared {
  towers: Map<number, Map<string, number>>;
  pillars: Map<number, { chosen: Pillar[]; slots: Map<string, [number, number]> }>;
}
const SHARED = new WeakMap<Fight, Shared>();
function shared(f: Fight): Shared {
  let s = SHARED.get(f);
  if (!s) {
    s = { towers: new Map(), pillars: new Map() };
    SHARED.set(f, s);
  }
  return s;
}

/** Shapes that hurt wherever they lie, whoever stands there. */
const AREA = new Set<Shape['k']>(['circle', 'donut', 'cone', 'rect', 'half', 'tiles']);

/** Safely behind a pillar: still hidden a step to either side. */
function hiddenWell(los: Extract<Shape, { k: 'los' }>, x: number, z: number): boolean {
  const ok = (px: number, pz: number) => hidden(los.x, los.z, los.pillars, px, pz);
  return ok(x, z) && ok(x + 0.4, z) && ok(x - 0.4, z) && ok(x, z + 0.4) && ok(x, z - 0.4);
}

/** Who joins a shared tank buster first: another tank, then melee, then other DPS, then healers. */
function joinOrder(q: Fighter): number {
  return q.role === 'tank' ? 0 : q.job.id === 'brawler' || q.job.id === 'lancer' ? 1 : q.role === 'dps' ? 2 : 3;
}

/**
 * Computer party members for offline practice and the tests (the "dev bots" of section 九). They stand
 * where their role belongs, keep a plain rotation, mitigate tank busters, heal and raise, and handle boss
 * mechanics the way an experienced player would: they read every pending attack (even the ones Hard
 * hides), step out of shapes, spread to fixed slots, gather on stacks, take their towers and pillars, pull
 * tethers apart, carry bombs away, stand still for a freeze, swap tanks, drag walking bosses to where the
 * party wants them, kill adds and break prisons. They send the same requests a client would (move, use).
 */
export class Bot {
  private now = 0;
  private lastFlank = -999;
  private lastFocus: string | null = null;

  private cache: { at: number; base: [number, number]; goal: [number, number] } | null = null;

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
    // a freeze check about to end: stand still, whatever else is going on
    const freeze = !!f.brain?.hazards().some((h) => h.shape.k === 'stop' && h.end >= f.tick && h.end - f.tick <= sec(0.5));
    // something lands soon and I am not where I should be: move now, even out of a cast
    const urgent = !freeze && this.urgent(me, goal);
    const still = f.phase === 'fight' && focus && !urgent ? this.act(me, focus, goal) : false;
    if (!freeze && !me.dash && (urgent || (!me.cast && !still))) this.walk(me, goal);
  }

  /** An attack lands before I could get where I should be unless I go now (out of a cast if need be). */
  private urgent(me: Fighter, goal: [number, number]): boolean {
    const brain = this.fight.brain;
    if (!brain) return false;
    const t = this.fight.tick;
    const away = Math.hypot(goal[0] - me.x, goal[1] - me.z);
    // standing in something about to go off: always get out, however close the goal looks
    if (away > 0.2 && this.inDanger(me)) return true;
    if (away <= 1) return false;
    const travel = (away / RULES.moveSpeed) * TICK_RATE;
    return brain.hazards().some((h) => !h.zone && h.end >= t && (h.end - t <= URGENT || h.end - t <= travel + TICK_RATE));
  }

  /** Inside a shape (not aimed at me) that goes off soon, or a pool. */
  private inDanger(me: Fighter): boolean {
    const t = this.fight.tick;
    return !!this.fight.brain?.hazards().some((h) => {
      if (!h.zone && (h.end < t || h.end - t > URGENT)) return false;
      if (h.on || h.aim === me.id || !AREA.has(h.shape.k)) return false;
      return inside(h.shape, me.x, me.z);
    });
  }

  /** Something is about to land: no jumping around for now. */
  private busy(): boolean {
    const t = this.fight.tick;
    return !!this.fight.brain?.hazards().some((h) => !h.zone && h.end >= t && h.end - t <= HORIZON);
  }

  // ------------------------------------------------------------------ what to hit

  /**
   * The enemy to fight: a prison first (not tanks), the boss when it can be hit (with two, the healthier
   * one, to keep them even; the tanks stay on theirs), else the adds.
   */
  private focus(me: Fighter): Foe | null {
    const f = this.fight;
    const live = f.foes.filter((e) => f.hittable(e) && !(e.minHp !== undefined && e.hp <= e.minHp));
    if (!live.length) return null;
    const prison = live.find((e) => e.kind === 'prison');
    // everyone free breaks a prison; tanks only when nobody else can
    const helpers = f.living().filter((q) => q.role !== 'tank' && q.id !== prison?.owner).length;
    if (prison && (me.role !== 'tank' || !helpers)) return prison;
    const bosses = live.filter((e) => e.boss);
    if (bosses.length) {
      const main = bosses.find((e) => e === f.brain?.foe) ?? bosses[0]!;
      if (bosses.length === 1 || me.role === 'tank') return main;
      const share = (e: Foe) => e.hp / e.maxHp;
      const last = bosses.find((e) => e.id === this.lastFocus);
      const best = bosses.reduce((a, b) => (share(b) > share(a) ? b : a));
      const pick = last && share(best) - share(last) < 0.02 ? last : best;
      this.lastFocus = pick.id;
      return pick;
    }
    const adds = live.filter((e) => e.kind !== 'prison');
    if (!adds.length) return prison ?? null;
    if (me.role === 'tank') {
      // a tank goes for an add that is hitting someone else
      const loose = adds.find((a) => !a.aloof && a.auto > 0 && f.topOf(a)?.role !== 'tank');
      if (loose) return loose;
      const tanks = [...f.players.values()].filter((q) => q.role === 'tank' && !q.dead).sort((a, b) => a.id.localeCompare(b.id));
      return adds[Math.max(0, tanks.findIndex((q) => q.id === me.id)) % adds.length]!;
    }
    // adds that must fall together: hit the healthier one; otherwise finish the weaker one
    const together = !!f.brain?.addsTogether;
    return adds.reduce((a, b) => (together ? (b.hp > a.hp ? b : a) : b.hp < a.hp ? b : a));
  }

  // ------------------------------------------------------------------ where to stand

  private goal(me: Fighter, focus: Foe | null): [number, number] {
    const base = focus ? this.base(me, focus) : ([me.x, me.z] as [number, number]);
    if (!this.fight.brain) return base;
    const c = this.cache;
    if (c && this.fight.tick - c.at < REPLAN && Math.hypot(c.base[0] - base[0], c.base[1] - base[1]) < 0.5) return c.goal;
    const goal = this.plan(me, base);
    this.cache = { at: this.fight.tick, base, goal };
    return goal;
  }

  /**
   * The role's spot around what it fights. A tank holds a walking boss where the party wants it (the
   * script's home for the phase): it stands there and the boss follows. Around adds and prisons the tanks
   * and the ranged keep their usual spots (the adds walk to the tanks, so they end up side by side), melee
   * stand behind the target.
   */
  private base(me: Fighter, focus: Foe): [number, number] {
    const f = this.fight;
    const boss = f.brain?.foe ?? f.foes.find((e) => e.boss) ?? focus;
    const around = (x: number, z: number, r: number, facing: number): [number, number] => {
      const [ang, dist, rel] = this.where(me);
      const a = (rel ? facing : 0) + ang;
      return clampToArena(f.enc.arena, x + Math.sin(a) * (r + dist), z + Math.cos(a) * (r + dist));
    };
    // whoever a walking boss follows (the tank, or anyone when there is none) holds it where the party
    // wants it: they stand still there and the boss comes to them, instead of being chased round the room
    const main = f.brain?.foe;
    if (main && main.speed > 0 && f.hittable(main) && (me.role === 'tank' ? focus === main : f.topOf(main)?.id === me.id)) {
      const [hx, hz] = f.brain!.home(main);
      return around(hx, hz, main.r, main.f);
    }
    if (focus.boss) return around(focus.x, focus.z, focus.r, focus.f);
    if (me.job.id === 'brawler' || me.job.id === 'lancer') {
      const a = focus.f + Math.PI;
      return clampToArena(f.enc.arena, focus.x + Math.sin(a) * (focus.r + 1), focus.z + Math.cos(a) * (focus.r + 1));
    }
    return around(boss.x, boss.z, boss.r, boss.f);
  }

  /** The brawler steps to the flank for 旋風踢 and to the rear otherwise. */
  private where(me: Fighter): Spot {
    if (me.job.id === 'brawler' && this.readyIn(me, 1) < 30 && this.fight.tick - this.lastFlank > 60) return [Math.PI / 2, 1, true];
    return this.spot;
  }

  /**
   * Around boss attacks: picks the spot that keeps out of every shape about to hit, keeps spreads, bombs
   * and marked circles apart, gathers stacks (by colour, exactly the count a shared buster wants), takes
   * this bot's tower or pillar, pulls its tether apart, keeps out of strips and fans aimed at others, stays
   * close before a knockback off a cliff, and is as near as possible to where the role (or the mechanic)
   * wants it.
   */
  private plan(me: Fighter, base: [number, number]): [number, number] {
    const f = this.fight;
    const brain = f.brain!;
    const t = f.tick;
    const ahead = (h: Tele) => (['los', 'tower', 'tether'].includes(h.shape.k) ? AHEAD : HORIZON);
    const hz = brain.hazards().filter((h) => h.zone || (h.end >= t && h.end - t <= ahead(h)));
    if (!hz.length) return base;
    const boss = brain.foe;
    const size = f.enc.arena.size;
    const at = (a: number, r: number): [number, number] => clampToArena(f.enc.arena, boss.x + Math.sin(a) * r, boss.z + Math.cos(a) * r);
    // slots for spreads, stacks and tethers are kept round where the boss is meant to be, not where it is
    // this moment: a walking boss follows its tank, and slots that moved with it would keep everyone moving
    const [ax, az] = boss.speed > 0 ? brain.home(boss) : [boss.x, boss.z];
    const atHome = (a: number, r: number): [number, number] => clampToArena(f.enc.arena, ax + Math.sin(a) * r, az + Math.cos(a) * r);
    const living = f.living();
    const others = living.filter((q) => q.id !== me.id);
    const ids = living.map((q) => q.id).sort();
    const rank = Math.max(0, ids.indexOf(me.id));
    const held = (pred: (h: Tele) => boolean) =>
      hz
        .filter(pred)
        .map((h) => ({ h, q: brain.holder(h) }))
        .filter((x): x is { h: Tele; q: Fighter } => !!x.q && !x.q.dead)
        .sort((a, b) => a.q.id.localeCompare(b.q.id) || a.h.id - b.h.id);
    const spreads = held((h) => h.color === 'p' && h.shape.k === 'circle' && !h.zone);
    const drills = held((h) => h.color === 'r' && h.shape.k === 'circle');
    const stacks = held((h) => (h.color === 'y' || h.color === 'e' || h.color === 'i') && h.shape.k === 'circle');
    const bombs = held((h) => h.shape.k === 'bomb' && h.end - t <= BOMB_AHEAD);
    const nums = held((h) => h.shape.k === 'num');
    const tethers = hz.filter((h) => h.shape.k === 'tether').sort((a, b) => a.id - b.id);
    const towers = hz.filter((h) => h.shape.k === 'tower').sort((a, b) => a.id - b.id);
    const los = hz.find((h) => h.shape.k === 'los');
    const knock = hz.find((h) => h.shape.k === 'push');
    const aimed = hz.filter((h) => !!h.aim && (h.shape.k === 'cone' || h.shape.k === 'rect'));
    const areas = hz.filter((h) => !h.aim && !h.on && AREA.has(h.shape.k));
    const donut = areas.find((h) => h.shape.k === 'donut');
    const away = this.awayAngle(me, others);

    // where I would like to be, the most pressing mechanic first
    let pref = base;
    let weight = 6;
    const want = (p: [number, number], w: number) => {
      pref = p;
      weight = w;
    };
    const mineSpread = spreads.findIndex((s) => s.q.id === me.id);
    if (mineSpread >= 0) {
      const n = spreads.length;
      want(atHome(Math.PI / 2 + (mineSpread * 2 * Math.PI) / n, donut ? Math.max(3, (donut.shape.k === 'donut' ? donut.shape.r0 : 8) - 2) : Math.min(14, size * 0.7)), 6);
    }
    const proteans = aimed.filter((h) => h.shape.k === 'cone' && h.from === boss.id);
    if (proteans.some((h) => h.aim === me.id)) {
      // a slot of my own round the boss, at about the distance I already am (after a knockback, far out)
      const r = Math.max(boss.r + 3, Math.min(size - 2, Math.hypot(me.x - boss.x, me.z - boss.z)));
      want(at((rank * 2 * Math.PI) / living.length, r), 10);
    }
    const myNum = nums.find((n) => n.q.id === me.id);
    if (myNum && myNum.h.shape.k === 'num') {
      if (myNum.h.color === 'r') {
        // a charge comes at me: out to the edge along a line from the boss that nobody else stands on,
        // as close to the way I already am from it as that allows
        const mine = Math.atan2(me.x - boss.x, me.z - boss.z);
        let bestA = mine;
        let bestC = Infinity;
        for (let k = 0; k < 24; k++) {
          const a = (k * Math.PI) / 12;
          const lane: Shape = { k: 'rect', x: boss.x, z: boss.z, f: a, len: size * 2.6, w: 9 };
          const c = others.filter((q) => inside(lane, q.x, q.z)).length * 100 + Math.abs(angleDiff(a, mine)) * 15;
          if (c < bestC) {
            bestC = c;
            bestA = a;
          }
        }
        want(at(bestA, size), 12);
      } else {
        const n = nums.length;
        want(at(((myNum.h.shape.n - 1) * 2 * Math.PI) / Math.max(1, n), Math.min(9, size * 0.5)), 10);
      }
    }
    let stackOn: Fighter | null = null;
    const exact = stacks.find((s) => s.h.exact);
    if (exact) {
      // 分攤死刑: the other tanks first, then melee, then the rest; exactly as many as it wants
      const n = Number(exact.h.text ?? '2') - 1;
      const order = living
        .filter((q) => q.id !== exact.q.id)
        .sort((a, b) => joinOrder(a) - joinOrder(b) || a.id.localeCompare(b.id))
        .slice(0, n);
      if (order.some((q) => q.id === me.id)) {
        stackOn = exact.q;
        want([exact.q.x, exact.q.z], 12);
      }
    }
    const coloured = stacks.filter((s) => s.h.color === 'e' || s.h.color === 'i');
    const myColour = coloured.find((s) => s.q.id === me.id);
    // the colour stacks gather either side of the boss, close enough to cross when the colours flip
    if (myColour) want(atHome(myColour.h.color === 'e' ? Math.PI / 2 : -Math.PI / 2, Math.max(boss.r + 1.5, 5.5)), 8);
    if (coloured.length && !myColour) {
      const mine = me.statuses.some((s) => s.id === 'red') ? 'e' : me.statuses.some((s) => s.id === 'blue') ? 'i' : null;
      const target = coloured.find((s) => s.h.color === mine);
      if (target) {
        stackOn = target.q;
        want([target.q.x, target.q.z], 12);
      }
    }
    const plain = stacks.filter((s) => s.h.color === 'y' && !s.h.exact);
    if (plain.length && !stackOn) {
      const k = plain.findIndex((s) => s.q.id === me.id);
      const n = plain.length;
      const slot = (j: number): [number, number] => (n === 1 ? (donut ? at(0, 4) : base) : atHome(Math.PI / 2 + (j * 2 * Math.PI) / n, donut ? 5 : 9));
      if (k >= 0) want(slot(k), 6);
      else {
        // the others split between the stacks, nearest first, as evenly as the stacks want
        const cap = Number(plain[0]!.h.text ?? '1');
        const rest = living.filter((q) => !plain.some((s) => s.q.id === q.id)).sort((a, b) => a.id.localeCompare(b.id));
        const load = plain.map(() => 1);
        let mineAt = 0;
        for (const q of rest) {
          const order = plain.map((_, j) => j).sort((a, b) => Math.hypot(q.x - plain[a]!.q.x, q.z - plain[a]!.q.z) - Math.hypot(q.x - plain[b]!.q.x, q.z - plain[b]!.q.z));
          const j = order.find((x) => load[x]! < cap) ?? order[0]!;
          load[j]!++;
          if (q.id === me.id) mineAt = j;
        }
        stackOn = plain[mineAt]!.q;
        want([stackOn.x, stackOn.z], 12);
      }
    }
    const myTether = tethers.find((h) => h.shape.k === 'tether' && (h.shape.a === me.id || h.shape.b === me.id));
    if (myTether && myTether.shape.k === 'tether') {
      const k = tethers.indexOf(myTether);
      const a = (k * Math.PI) / 2 + (myTether.shape.a === me.id ? Math.PI : 0);
      want(atHome(a, Math.min(size - 1, myTether.shape.dist / 2 + 2)), 12);
    }
    const myBomb = bombs.find((b) => b.q.id === me.id);
    if (myBomb) {
      const batch = bombs.filter((b) => b.h.end === myBomb.h.end);
      const j = batch.indexOf(myBomb);
      want(at(away + (j - (batch.length - 1) / 2) * 0.9, size), 14);
    }
    const myTower = this.towerFor(me, towers, living);
    if (myTower && myTower.shape.k === 'tower') want([myTower.shape.x, myTower.shape.z], 14);
    if (los && los.shape.k === 'los') {
      const spot = this.pillarSpot(me, los, living);
      if (spot) want(spot, 16);
    }

    const cands: [number, number][] = [pref, [me.x, me.z], base];
    for (let r = 2; r < size + 3; r += 2) for (let k = 0; k < 16; k++) cands.push(at((k / 16) * Math.PI * 2 + r * 0.13, r));
    for (const r of [1, 2.5]) for (let k = 0; k < 8; k++) cands.push(clampToArena(f.enc.arena, pref[0] + Math.sin((k * Math.PI) / 4) * r, pref[1] + Math.cos((k * Math.PI) / 4) * r));
    for (const r of [2.5, 5]) for (let k = 0; k < 8; k++) cands.push(clampToArena(f.enc.arena, me.x + Math.sin((k * Math.PI) / 4) * r, me.z + Math.cos((k * Math.PI) / 4) * r));
    // fans from the boss (sweeps, proteans, fixed fans): finer steps round it, where I am and a little out
    if (areas.some((h) => h.shape.k === 'cone') || aimed.length) {
      const mine = Math.max(boss.r + 2, Math.hypot(me.x - boss.x, me.z - boss.z));
      for (const r of [mine, Math.min(size - 1, mine + 4)]) for (let k = 0; k < 48; k++) cands.push(at((k / 48) * Math.PI * 2, r));
    }
    const grid = f.enc.arena.grid;
    if (grid && areas.some((h) => h.shape.k === 'tiles')) {
      const cell = (size * 2) / grid;
      for (let row = 0; row < grid; row++) for (let col = 0; col < grid; col++) cands.push([-size + cell * (col + 0.5), -size + cell * (row + 0.5)]);
    }
    const soon = Math.min(...hz.filter((h) => !h.zone).map((h) => h.end - t), 99 * TICK_RATE) / TICK_RATE;
    // standing in something: the quickest way out first, where the role wants to be second
    const travel = this.inDanger(me) ? 10 : 0.5;
    let best = pref;
    let bestCost = Infinity;
    for (const c of cands) {
      const [x, z] = clampToArena(f.enc.arena, c[0], c[1]);
      let cost = Math.hypot(x - pref[0], z - pref[1]) * (stackOn ? 12 : weight);
      cost += Math.hypot(x - me.x, z - me.z) * travel;
      if (Math.hypot(x - me.x, z - me.z) / RULES.moveSpeed > soon + 0.2) cost += 150;
      for (const h of areas) {
        if (cost >= bestCost) break;
        if (near(h.shape, x, z)) cost += h.zone ? 600 : h.end - t <= URGENT ? 1000 : 250;
      }
      for (const h of aimed) {
        if (h.aim === me.id || cost >= bestCost) continue;
        if (near(h.shape, x, z)) cost += h.end - t <= URGENT ? 1000 : 400;
      }
      if (los && los.shape.k === 'los' && !hiddenWell(los.shape, x, z)) cost += los.end - t <= URGENT + TICK_RATE ? 1200 : 300;
      if (knock && knock.shape.k === 'push' && brain.script.edge === 'cliff') {
        const max = size - RULES.playerRadius - knock.shape.dist - 1;
        if (Math.hypot(x - knock.shape.x, z - knock.shape.z) > max) cost += 1000;
      }
      for (const s of [...spreads, ...drills]) {
        const r = s.h.shape.k === 'circle' ? s.h.shape.r : 5;
        if (s.q.id === me.id) {
          // my own circle: keep everyone else out of it (another marked circle most of all)
          for (const q of others) if (Math.hypot(x - q.x, z - q.z) <= r + 1.2) cost += drills.some((d) => d.q.id === q.id) || spreads.some((d) => d.q.id === q.id) ? 500 : 300;
        } else if (Math.hypot(x - s.q.x, z - s.q.z) <= r + 1.2) cost += 800;
      }
      for (const b of bombs) {
        const r = b.h.shape.k === 'bomb' ? b.h.shape.r : 8;
        if (b.q.id === me.id) {
          for (const q of others) if (Math.hypot(x - q.x, z - q.z) <= r + 1.5) cost += 400;
        } else if (Math.hypot(x - b.q.x, z - b.q.z) <= r + 1.5) cost += 900;
      }
      for (const s of stacks) {
        if (s.q.id === me.id || s.q === stackOn) continue;
        const r = s.h.shape.k === 'circle' ? s.h.shape.r : 4;
        if (Math.hypot(x - s.q.x, z - s.q.z) <= r + 1) cost += 600; // a stack that is not mine
      }
      for (const h of towers) if (h !== myTower && inside(h.shape, x, z)) cost += 150;
      if (myTether && myTether.shape.k === 'tether') {
        const other = f.players.get(myTether.shape.a === me.id ? myTether.shape.b : myTether.shape.a);
        if (other && Math.hypot(x - other.x, z - other.z) < myTether.shape.dist + 1.5) cost += 600;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = [x, z];
      }
    }
    return best;
  }

  /** The way from the rest of the party through the boss and beyond: where to take something nasty. */
  private awayAngle(me: Fighter, others: Fighter[]): number {
    const boss = this.fight.brain!.foe;
    if (!others.length) return Math.PI;
    const cx = others.reduce((n, q) => n + q.x, 0) / others.length;
    const cz = others.reduce((n, q) => n + q.z, 0) / others.length;
    if (Math.hypot(boss.x - cx, boss.z - cz) < 0.5) return Math.atan2(me.x - boss.x, me.z - boss.z);
    return Math.atan2(boss.x - cx, boss.z - cz);
  }

  /**
   * Which tower is mine, worked out once per set of towers from where everyone stood when they appeared
   * (every bot comes to the same answer): the closest player–tower pairs first while the tower needs
   * people, tanks counted as further away (they would drag the boss along), and the two ends of a tether
   * never in the same tower.
   */
  private towerFor(me: Fighter, towers: Tele[], living: Fighter[]): Tele | null {
    if (!towers.length) return null;
    const key = towers[0]!.id;
    const plans = shared(this.fight).towers;
    let plan = plans.get(key);
    if (!plan) {
      plan = new Map<string, number>();
      const partner = new Map<string, string>();
      for (const h of this.fight.brain!.hazards()) {
        if (h.shape.k !== 'tether') continue;
        partner.set(h.shape.a, h.shape.b);
        partner.set(h.shape.b, h.shape.a);
      }
      const left = towers.map((tw) => (tw.shape.k === 'tower' ? tw.shape.need : 1));
      const pos = (tw: Tele) => (tw.shape.k === 'tower' ? tw.shape : { x: 0, z: 0 });
      const cost = (q: Fighter, j: number) => Math.hypot(pos(towers[j]!).x - q.x, pos(towers[j]!).z - q.z) + (q.role === 'tank' ? 15 : 0);
      const take = (q: Fighter, not = -1): void => {
        const order = towers.map((_, j) => j).filter((j) => j !== not && left[j]! > 0);
        if (!order.length) return;
        const j = order.reduce((a, b) => (cost(q, b) < cost(q, a) ? b : a));
        plan!.set(q.id, j);
        left[j]!--;
      };
      // the two ends of each tether first, into different towers
      const byId = new Map(living.map((q) => [q.id, q]));
      for (const h of this.fight.brain!.hazards()) {
        if (h.shape.k !== 'tether' || towers.length < 2) continue;
        const a = byId.get(h.shape.a);
        const b = byId.get(h.shape.b);
        if (!a || !b || plan.has(a.id) || plan.has(b.id)) continue;
        take(a);
        if (plan.has(a.id)) take(b, plan.get(a.id));
      }
      // then everyone else, the closest player–tower pairs first
      const pairs = living.flatMap((q) => towers.map((_, j) => ({ q, j, d: cost(q, j) })));
      pairs.sort((a, b) => a.d - b.d || a.q.id.localeCompare(b.q.id) || a.j - b.j);
      for (const { q, j } of pairs) {
        if (plan.has(q.id) || left[j]! <= 0) continue;
        const other = partner.get(q.id);
        if (other !== undefined && plan.get(other) === j) continue;
        plan.set(q.id, j);
        left[j]!--;
      }
      for (const id of plans.keys()) if (id < key) plans.delete(id);
      plans.set(key, plan);
    }
    const j = plan.get(me.id);
    return j === undefined ? null : (towers[j] ?? null);
  }

  /**
   * My place behind a pillar, worked out once per line of sight from where everyone stood when it began
   * (so every bot comes to the same answer): the pillars nearest the party, each player to the nearest one
   * with room, in a row behind it. On Hard, where a pillar someone hid behind shatters, as few pillars as
   * will hold the party (4 to a pillar); on Normal they spread over all of them.
   */
  private pillarSpot(me: Fighter, tele: Tele, living: Fighter[]): [number, number] | null {
    const f = this.fight;
    if (tele.shape.k !== 'los') return null;
    const los = tele.shape;
    const pillars: Pillar[] = los.pillars;
    if (!pillars.length) return null;
    const plans = shared(f).pillars;
    let plan = plans.get(tele.id);
    if (!plan) {
      const n = living.length;
      const use = f.hard ? Math.max(1, Math.min(pillars.length, Math.ceil(n / 4))) : pillars.length;
      const cap = Math.ceil(n / use);
      const cx = living.reduce((sum, q) => sum + q.x, 0) / Math.max(1, n);
      const cz = living.reduce((sum, q) => sum + q.z, 0) / Math.max(1, n);
      const chosen = [...pillars].sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz)).slice(0, use);
      // the closest player–pillar pairs first, while the pillar has room
      const load = chosen.map(() => 0);
      const slots = new Map<string, [number, number]>();
      const pairs = living.flatMap((q) => chosen.map((p, j) => ({ q, j, d: Math.hypot(p.x - q.x, p.z - q.z) })));
      pairs.sort((a, b) => a.d - b.d || a.q.id.localeCompare(b.q.id) || a.j - b.j);
      for (const { q, j } of pairs) {
        if (slots.has(q.id) || load[j]! >= cap) continue;
        slots.set(q.id, [j, load[j]!]);
        load[j]!++;
      }
      // older plans are no use any more
      for (const id of plans.keys()) if (id < tele.id) plans.delete(id);
      plan = { chosen, slots };
      plans.set(tele.id, plan);
    }
    const slot = plan.slots.get(me.id);
    if (!slot) return null;
    const p = plan.chosen[slot[0]]!;
    const depth = slot[1];
    const dx = p.x - los.x;
    const dz = p.z - los.z;
    const d = Math.hypot(dx, dz) || 1;
    const dist = Math.min(d + p.r + 1 + depth * 1.1, f.enc.arena.size - 0.8);
    return [los.x + (dx / d) * dist, los.z + (dz / d) * dist];
  }

  /**
   * A step towards the goal. Walking straight into a pool or something about to go off (when not already
   * in it), it goes round instead: the nearest heading either side that stays clear.
   */
  private walk(me: Fighter, [gx, gz]: [number, number]): void {
    const dx = gx - me.x;
    const dz = gz - me.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) return;
    const step = Math.min(d, (RULES.moveSpeed * 0.95 * TICK_MS) / 1000);
    let [ux, uz] = [dx / d, dz / d];
    const t = this.fight.tick;
    const bad = (this.fight.brain?.hazards() ?? []).filter(
      (h) => !h.on && h.aim !== me.id && AREA.has(h.shape.k) && (h.zone || (h.end >= t && h.end - t <= URGENT)) && !inside(h.shape, me.x, me.z),
    );
    if (bad.length) {
      const look = Math.min(d, 1.5);
      const clear = (ax: number, az: number) => !bad.some((h) => inside(h.shape, me.x + ax * look, me.z + az * look));
      if (!clear(ux, uz)) {
        for (const turn of [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6]) {
          const c = Math.cos(turn);
          const sn = Math.sin(turn);
          const [vx, vz] = [ux * c - uz * sn, ux * sn + uz * c];
          if (clear(vx, vz)) {
            [ux, uz] = [vx, vz];
            break;
          }
        }
      }
    }
    this.fight.move(this.id, me.x + ux * step, me.z + uz * step, Math.atan2(ux, uz), this.now);
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
    // casts only when standing where it means to stay (right on it while something is coming)
    const settled = Math.hypot(goal[0] - me.x, goal[1] - me.z) < (this.busy() ? 0.4 : 1.2);
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
        if (weave && ready(2) && settled && !this.busy() && use(2)) return false;
        if (gcdLeft > 0 || !inMelee) return false;
        if (ready(1) && use(1)) return false;
        use(0);
        return false;
      }
      case 'ranger': {
        if (weave && ready(3) && boss.cast?.m === 'raidwide' && use(3, null)) return false;
        if (weave && ready(2) && use(2)) return false;
        // the backflip lands about 10 m further out, still in range; not while dodging
        if (weave && ready(4) && settled && !this.busy() && use(4)) return false;
        if (gcdLeft > 0) return false;
        if (ready(1) && use(1)) return false;
        use(0);
        return false;
      }
      case 'sorcerer': {
        const swift = me.statuses.some((s) => s.id === 'swift');
        if (weave && settled && ready(3) && !this.busy() && use(3, null)) return false;
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
