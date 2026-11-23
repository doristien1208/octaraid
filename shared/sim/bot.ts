import { RULES, TICK_MS, TICK_RATE, sec } from '../constants';
import { SPRINT_SLOT, type JobId } from '../jobs';
import { STATUS } from '../status';
import { angleDiff, clampToArena, reach, sideOf } from './arena';
import { sheltered, type Tele } from './boss';
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
  /** numbered charges at everyone (數字裁斷): each number's angle round the middle */
  lanes: Map<number, Map<string, number>>;
}
const SHARED = new WeakMap<Fight, Shared>();
function shared(f: Fight): Shared {
  let s = SHARED.get(f);
  if (!s) {
    s = { towers: new Map(), pillars: new Map(), lanes: new Map() };
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

/** 判決傳遞: the marks, and who must hold which one at 宣判. */
const markOf = (q: Fighter) => q.statuses.find((s) => s.id === 'nisiA' || s.id === 'nisiB')?.id ?? null;
const decreeOf = (q: Fighter) => (q.statuses.some((s) => s.id === 'decreeA') ? 'nisiA' : q.statuses.some((s) => s.id === 'decreeB') ? 'nisiB' : null);
const isMelee = (q: Fighter) => q.job.id === 'brawler' || q.job.id === 'lancer';

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

  /** Something is about to land, or something lingers on the floor: no jumping around for now. */
  private busy(): boolean {
    const t = this.fight.tick;
    return !!this.fight.brain?.hazards().some((h) => h.zone || (h.end >= t && h.end - t <= HORIZON));
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
    // everyone free breaks a prison; tanks only when nobody else can. With a knockback coming the rock
    // stays up until it is over: the party hides behind it (崩岩巨像 Hard)
    const helpers = f.living().filter((q) => q.role !== 'tank' && q.id !== prison?.owner).length;
    const pushing = !!prison && !!f.brain?.hazards().some((h) => h.shape.k === 'push' && h.end >= f.tick);
    if (prison && !pushing && (me.role !== 'tank' || !helpers)) return prison;
    // 電漿護盾: everyone but the tanks on the shielded one (from in front of it)
    const shielded = live.find((e) => e.statuses.some((s) => s.id === 'plasma'));
    if (shielded && me.role !== 'tank') return shielded;
    // 獵殺人偶: the dolls down below the line first (not the tanks: the boss is theirs)
    const feed = f.brain?.feed;
    if (feed && me.role !== 'tank') {
      const high = live.filter((e) => !e.boss && e.kind !== 'prison' && e.hp / e.maxHp > feed.pct - 0.03);
      if (high.length) return high.reduce((a, b) => (b.hp / b.maxHp > a.hp / a.maxHp ? b : a));
    }
    // a boss standing in a pool is out of a melee player's reach for now
    const reachable = (e: Foe) =>
      !isMelee(me) ||
      Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4).some((a) => {
        const [x, z] = [e.x + Math.sin(a) * (e.r + 1.5), e.z + Math.cos(a) * (e.r + 1.5)];
        return !f.brain?.hazards().some((h) => h.zone && near(h.shape, x, z));
      });
    const all = live.filter((e) => e.boss);
    const bosses = all.length > 1 && all.some(reachable) ? all.filter(reachable) : all;
    if (bosses.length) {
      const main = bosses.find((e) => e === f.brain?.foe) ?? bosses[0]!;
      if (me.role === 'tank' && f.brain?.staged && bosses.length > 1) {
        // the ultimate's pairs that must stay even (痛苦之手): the tank evens them out from where it holds its boss
        const other = bosses.find((e) => e !== main);
        if (other && main.hp / main.maxHp < other.hp / other.maxHp - 0.01 && reach(me.x, me.z, other) <= 20) return other;
      }
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
    // a doll walking after me (獵殺人偶): keep it away from the bosses until it is low enough, then walk it in
    const feed = f.brain?.feed;
    const doll = feed ? f.foes.find((e) => !e.boss && !e.gone && e.hp > 0 && f.topOf(e)?.id === me.id) : undefined;
    if (doll && feed) {
      const bosses = f.foes.filter((e) => e.boss && !e.gone && e.hp > 0);
      const nearest = bosses.reduce<Foe | null>((a, b) => (!a || Math.hypot(b.x - doll.x, b.z - doll.z) < Math.hypot(a.x - doll.x, a.z - doll.z) ? b : a), null);
      if (doll.hp / doll.maxHp <= feed.pct - 0.01 && nearest) return [nearest.x, nearest.z];
      if (nearest) {
        // the doll between me and the boss, so it walks away from it
        const d = Math.hypot(doll.x - nearest.x, doll.z - nearest.z) || 1;
        return clampToArena(f.enc.arena, doll.x + ((doll.x - nearest.x) / d) * 5, doll.z + ((doll.z - nearest.z) / d) * 5);
      }
    }
    if (main && main.speed > 0 && f.hittable(main) && (me.role === 'tank' ? focus === main || (!!f.brain?.staged && focus.boss) : f.topOf(main)?.id === me.id)) {
      const [hx, hz] = f.brain!.home(main);
      // the ultimate wants the boss on the spot (合掌, 栓塞): stand past it, so the boss stops right there
      const off = Math.hypot(hx - main.x, hz - main.z);
      if (f.brain?.staged && off > 1.5) {
        const reachTo = main.r + RULES.bossReach - 0.4;
        return clampToArena(f.enc.arena, hx + ((hx - main.x) / off) * reachTo, hz + ((hz - main.z) / off) * reachTo);
      }
      return around(hx, hz, main.r, main.f);
    }
    // 電漿護盾: hit it from in front (melee close, the rest a little further out)
    if (focus.statuses.some((s) => s.id === 'plasma')) {
      const [ang, dist] = this.spot;
      const a = focus.f + Math.max(-0.9, Math.min(0.9, ang * 0.4));
      const r = focus.r + (isMelee(me) ? 1 : Math.min(6, dist));
      return clampToArena(f.enc.arena, focus.x + Math.sin(a) * r, focus.z + Math.cos(a) * r);
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
    const boss = brain.foe;
    // 超級跳躍 shows nothing on the ground: the cast is the cue; 判決傳遞 has nothing on the ground either
    const jumping = boss.cast?.name === '超級跳躍';
    if (!hz.length && !jumping && !f.living().some((q) => markOf(q))) return base;
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
    // prison rocks still standing stop a knockback for whoever is right behind them
    const rocks = knock ? f.foes.filter((e) => e.kind === 'prison' && e.hp > 0 && !e.gone) : [];
    const shelter = (x: number, z: number) => !!knock && knock.shape.k === 'push' && rocks.some((r) => sheltered(knock.shape as { x: number; z: number }, r, x, z));
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
      // every number of the set, however far off (the plan looks past the usual horizon)
      const all = brain
        .hazards()
        .filter((h) => h.shape.k === 'num' && h.color === 'r' && h.end >= t)
        .map((h) => ({ h, q: brain.holder(h) }))
        .filter((x): x is { h: Tele; q: Fighter } => !!x.q && !x.q.dead);
      const everyone = all.length >= living.length - 1 && all.length >= 3;
      if (myNum.h.color === 'r' && everyone && brain.staged) {
        // a charge at everyone in turn (數字裁斷): round the middle in number order, evenly apart, so each charge
        // runs from where the last one ended to the next number with nobody in between
        const plans = shared(f).lanes;
        // the set is known by its numbers' ids: the plan made for the first of them holds until the last goes
        const ids = new Set(all.map((n) => n.h.id));
        let key = [...plans.keys()].find((k) => [...ids].some((id) => id >= k && id < k + 64));
        if (key === undefined) key = Math.min(...ids);
        let plan = plans.get(key);
        if (!plan) {
          plan = new Map<string, number>();
          const order = [...all].sort((a, b) => (a.h.shape.k === 'num' && b.h.shape.k === 'num' ? a.h.shape.n - b.h.shape.n : 0));
          const first = order[0]!.q;
          const a0 = Math.atan2(first.x, first.z);
          order.forEach((n, k) => plan!.set(n.q.id, a0 + (k * 2 * Math.PI) / order.length));
          for (const id of plans.keys()) if (id < key) plans.delete(id);
          plans.set(key, plan);
        }
        // 9 m out: far enough apart that no charge's strip crosses another number, inside the blasts going round
        // the edge (鷹爆)
        const a = plan.get(me.id) ?? Math.atan2(me.x, me.z);
        const r = Math.min(9, size * 0.42);
        want(clampToArena(f.enc.arena, Math.sin(a) * r, Math.cos(a) * r), 14);
      } else if (myNum.h.color === 'r') {
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
        // strips from the boss through each number: whoever the walking boss follows stays put (moving would
        // drag the boss and swing every strip), the rest spread round it at even angles from that player
        const n = nums.length;
        const holder = boss.speed > 0 ? f.topOf(boss) : null;
        if (holder?.id === me.id) want(base, 10);
        else {
          const from = holder ? Math.atan2(holder.x - ax, holder.z - az) : 0;
          const rest = nums.filter((x) => x.q.id !== holder?.id).sort((a, b) => (a.h.shape.k === 'num' && b.h.shape.k === 'num' ? a.h.shape.n - b.h.shape.n : 0));
          const j = rest.findIndex((x) => x.q.id === me.id) + (holder && nums.some((x) => x.q.id === holder.id) ? 1 : 0);
          want(atHome(from + (j * 2 * Math.PI) / Math.max(1, n), Math.min(9, size * 0.5)), 10);
        }
      }
    }
    let stackOn: Fighter | null = null;
    // 壓縮水 (3 or more) / 壓縮雷 (exactly 2): 水 east of the boss, 雷 west, at fixed spots the holder and the
    // others go to; not the tanks (the boss is theirs) unless they are needed, and for 雷 someone who can take
    // it next (no 水, not held 雷 before) first
    const passing = stacks.find((s) => s.h.pass);
    if (passing) {
      // a tank holding it keeps the boss where it is: the others come to the tank
      const spot: [number, number] = passing.q.role === 'tank' ? [passing.q.x, passing.q.z] : atHome(passing.h.exact ? -Math.PI / 2 : Math.PI / 2, boss.r + 2.5);
      const n = Number(passing.h.text ?? '2') - 1;
      const holds = (q: Fighter, ...ids: string[]) => q.statuses.some((s) => ids.includes(s.id));
      const d = (q: Fighter) => Math.hypot(q.x - passing.q.x, q.z - passing.q.z);
      // 雷: someone who can take it next, DPS before the tank before a healer (the healer already carries 水)
      const order = (q: Fighter) => (passing.h.exact ? (holds(q, 'water', 'boltDown') ? 10 : 0) + (q.role === 'dps' ? 0 : q.role === 'tank' ? 1 : 2) : q.role === 'tank' ? 1 : 0);
      const pool = living.filter((q) => q.id !== passing.q.id).sort((a, b) => order(a) - order(b) || d(a) - d(b) || a.id.localeCompare(b.id));
      const join = passing.h.exact ? pool.slice(0, n) : pool.filter((q, k) => k < n || q.role !== 'tank');
      if (passing.q.id === me.id) want(me.role === 'tank' ? base : spot, 12);
      else if (join.some((q) => q.id === me.id)) {
        stackOn = passing.q;
        want(spot, 12);
      }
    }
    const exact = stacks.find((s) => s.h.exact && !s.h.pass);
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
    const plain = stacks.filter((s) => s.h.color === 'y' && !s.h.exact && !s.h.pass);
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
    // 超級跳躍: the tank takes it to the edge square to 凍核's line, so the beam runs across the middle and
    // past 凍核; the rest wait on 凍核's side of it (melee still on 凍核)
    if (jumping) {
      const tw = brain.twin;
      const d = tw ? Math.hypot(tw.x, tw.z) || 1 : 1;
      const [fx, fz] = tw ? [tw.x / d, tw.z / d] : [0, -1];
      const [px, pz] = [-fz, fx];
      if (f.topOf(boss)?.id === me.id) want([px * (size - 1.2), pz * (size - 1.2)], 16);
      else {
        const side = (rank % 2 ? 1 : -1) * (1 + (rank >> 1));
        want(clampToArena(f.enc.arena, fx * 8.5 + px * side * 2.5, fz * 8.5 + pz * side * 2.5), 14);
      }
    }
    // 判決傳遞: my mark to whoever must hold it at 宣判; nobody else touches anyone holding one
    const { marking, mine, passTo, passFrom } = this.marks(me);
    if (passTo) want([passTo.x, passTo.z], 20);
    if (los && los.shape.k === 'los') {
      const spot = this.pillarSpot(me, los, living);
      if (spot) want(spot, 16);
    }
    if (knock && knock.shape.k === 'push' && rocks.length && brain.script.edge === 'cliff') {
      // a knockback off the cliff with a prison rock up: in a line right behind the rock, away from the boss
      const rock = rocks.reduce((a, b) => (Math.hypot(b.x - me.x, b.z - me.z) < Math.hypot(a.x - me.x, a.z - me.z) ? b : a));
      const d = Math.hypot(rock.x - knock.shape.x, rock.z - knock.shape.z) || 1;
      const order = living.filter((q) => !q.statuses.some((x) => x.id === 'stun')).map((q) => q.id).sort();
      const dist = rock.r + 1 + Math.max(0, order.indexOf(me.id)) * 0.9;
      want(clampToArena(f.enc.arena, rock.x + ((rock.x - knock.shape.x) / d) * dist, rock.z + ((rock.z - knock.shape.z) / d) * dist), 15);
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
    // in something that goes off later: fine if there is still time to walk out of it from there (the
    // second half of 炎冰交錯 needs the middle, not the far edge)
    const escapable = (h: Tele, x: number, z: number): boolean => {
      const reach = RULES.moveSpeed * Math.max(0, (h.end - t) / TICK_RATE - 0.6);
      for (const r of [reach * 0.5, reach]) {
        for (let k = 0; k < 8; k++) {
          const [ex, ez] = clampToArena(f.enc.arena, x + Math.sin((k * Math.PI) / 4) * r, z + Math.cos((k * Math.PI) / 4) * r);
          if (!near(h.shape, ex, ez)) return true;
        }
      }
      return false;
    };
    // the way there: a spot that is safe but past something going off just as I would walk through it
    // (not something I already stand in: any way out crosses that one)
    const crossing = [...areas, ...aimed.filter((h) => h.aim !== me.id)].filter((h) => !h.zone && h.end >= t && !inside(h.shape, me.x, me.z));
    const pools = areas.filter((h) => h.zone && !inside(h.shape, me.x, me.z));
    const pathCost = (x: number, z: number): number => {
      const d = Math.hypot(x - me.x, z - me.z);
      if (d < 1.5 || (!crossing.length && !pools.length)) return 0;
      for (let k = 1; k <= 4; k++) {
        const px = me.x + ((x - me.x) * k) / 5;
        const pz = me.z + ((z - me.z) * k) / 5;
        const arrive = t + (((d * k) / 5) / RULES.moveSpeed) * TICK_RATE;
        if (crossing.some((h) => Math.abs(h.end - arrive) < TICK_RATE * 0.8 && inside(h.shape, px, pz))) return 700;
        // through a pool I am not standing in
        if (pools.some((h) => inside(h.shape, px, pz))) return 400;
      }
      return 0;
    };
    // standing in something about to go off: the way to a spot must leave it in time (walking straight there)
    const standing = [...areas, ...aimed.filter((h) => h.aim !== me.id)].filter((h) => !h.zone && h.end >= t && h.end - t <= URGENT + TICK_RATE && inside(h.shape, me.x, me.z));
    const exitCost = (x: number, z: number): number => {
      const d = Math.hypot(x - me.x, z - me.z);
      for (const h of standing) {
        const walked = Math.min(d, RULES.moveSpeed * Math.max(0, (h.end - t) / TICK_RATE - 0.2));
        const k = d > 0.01 ? walked / d : 0;
        if (inside(h.shape, me.x + (x - me.x) * k, me.z + (z - me.z) * k)) return 900;
      }
      return 0;
    };
    // standing in something: the quickest way out first, where the role wants to be second
    const travel = this.inDanger(me) ? 10 : 0.5;
    // when the stack I joined goes off, and how big it is
    const joined = stacks.find((x) => x.q === stackOn);
    const stackHit = joined ? joined.h.end : null;
    const stackR = joined && joined.h.shape.k === 'circle' ? joined.h.shape.r : 4;
    let best = pref;
    let bestCost = Infinity;
    for (const c of cands) {
      const [x, z] = clampToArena(f.enc.arena, c[0], c[1]);
      let cost = Math.hypot(x - pref[0], z - pref[1]) * (stackOn ? 12 : weight);
      cost += Math.hypot(x - me.x, z - me.z) * travel;
      if (cost < bestCost) cost += pathCost(x, z) + exitCost(x, z);
      if (Math.hypot(x - me.x, z - me.z) / RULES.moveSpeed > soon + 0.2) cost += 150;
      for (const h of areas) {
        if (cost >= bestCost) break;
        if (near(h.shape, x, z)) cost += h.zone ? 600 : h.end - t <= URGENT ? 1000 : escapable(h, x, z) ? 150 : 900;
      }
      for (const h of aimed) {
        if (h.aim === me.id || cost >= bestCost) continue;
        if (near(h.shape, x, z)) cost += h.end - t <= URGENT ? 1000 : 400;
      }
      if (los && los.shape.k === 'los' && !hiddenWell(los.shape, x, z)) cost += los.end - t <= URGENT + TICK_RATE ? 1200 : 300;
      if (knock && knock.shape.k === 'push' && brain.script.edge === 'cliff') {
        const max = size - RULES.playerRadius - knock.shape.dist - 1;
        const out = Math.hypot(x - knock.shape.x, z - knock.shape.z) - max;
        // too far out to come back in time: a must; with time to spare, other things come first (falling rocks)
        if (out > 0 && !shelter(x, z)) cost += (out / RULES.moveSpeed + 1.5) * TICK_RATE >= knock.end - t ? 1000 : 80;
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
      if (marking) {
        // touching passes a mark on (and α touching β takes both down): only the planned pass
        for (const q of others) {
          if (q === passTo || q === passFrom || (!mine && !markOf(q))) continue;
          const d = Math.hypot(x - q.x, z - q.z);
          if (d < 1.8) cost += 900;
          else if (d < 2.6) cost += 120;
          // walking past them on the way there
          const sx = x - me.x;
          const sz = z - me.z;
          const len2 = sx * sx + sz * sz;
          if (len2 > 0.01) {
            const u = Math.max(0, Math.min(1, ((q.x - me.x) * sx + (q.z - me.z) * sz) / len2));
            if (Math.hypot(me.x + sx * u - q.x, me.z + sz * u - q.z) < 1.6) cost += 600;
          }
        }
      }
      // my tower about to go off: being in it is a must (an empty tower hurts everyone)
      if (myTower && myTower.end - t <= URGENT && !inside(myTower.shape, x, z)) cost += 900;
      // the same for the stack I am meant to share: a stack short of people hurts whoever holds it
      if (stackOn && stackHit !== null && stackHit - t <= URGENT && Math.hypot(x - stackOn.x, z - stackOn.z) > stackR - 0.5) cost += 900;
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

  /**
   * 判決傳遞: whether marks are out, mine, who I am taking mine to (whoever must hold it at 宣判, free to take
   * it), and who is bringing me one.
   */
  private marks(me: Fighter): { marking: boolean; mine: string | null; passTo: Fighter | null; passFrom: Fighter | null } {
    const living = this.fight.living();
    const marking = living.some((q) => markOf(q));
    const mine = markOf(me);
    if (!marking) return { marking, mine, passTo: null, passFrom: null };
    const others = living.filter((q) => q.id !== me.id);
    const free = (q: Fighter) => !markOf(q) && !q.statuses.some((s) => s.id === 'nisiCd' || s.id === 'risen');
    const passTo = mine && decreeOf(me) !== mine ? (others.find((q) => decreeOf(q) === mine && free(q)) ?? null) : null;
    const passFrom = decreeOf(me) && free(me) ? (others.find((q) => markOf(q) === decreeOf(me) && decreeOf(q) !== markOf(q)) ?? null) : null;
    return { marking, mine, passTo, passFrom };
  }

  /** Players I must not touch right now (判決傳遞): anyone, while I hold a mark; anyone holding one, otherwise. */
  private untouchable(me: Fighter): Fighter[] {
    const { marking, mine, passTo, passFrom } = this.marks(me);
    if (!marking) return [];
    return this.fight.living().filter((q) => q.id !== me.id && q !== passTo && q !== passFrom && (!!mine || !!markOf(q)));
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
      // a bomb going off near the time of a tower: its holder would blow up the people in it (冰封印記)
      const bombAt = new Map<string, number>();
      for (const h of this.fight.brain!.hazards()) {
        const q = h.shape.k === 'bomb' ? this.fight.brain!.holder(h) : undefined;
        if (q) bombAt.set(q.id, h.end);
      }
      const bomb = (q: Fighter, j: number) => {
        const at = bombAt.get(q.id);
        return at !== undefined && Math.abs(at - towers[j]!.end) < sec(4) ? 60 : 0;
      };
      const cost = (q: Fighter, j: number) => Math.hypot(pos(towers[j]!).x - q.x, pos(towers[j]!).z - q.z) + (q.role === 'tank' ? 15 : 0) + bomb(q, j);
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
      // tethers ending as it hits (零度連鎖): the two ends behind pillars far apart
      const ties = f.brain!.hazards().filter((h) => h.shape.k === 'tether' && Math.abs(h.end - tele.end) <= sec(3));
      const use = f.hard ? Math.max(ties.length ? 2 : 1, Math.min(pillars.length, Math.ceil(n / 4))) : pillars.length;
      const cap = Math.ceil(n / use);
      const cx = living.reduce((sum, q) => sum + q.x, 0) / Math.max(1, n);
      const cz = living.reduce((sum, q) => sum + q.z, 0) / Math.max(1, n);
      let chosen = [...pillars].sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz)).slice(0, use);
      const load = chosen.map(() => 0);
      const slots = new Map<string, [number, number]>();
      if (ties.length && pillars.length >= 2) {
        // the two pillars furthest apart; each tether's ends one behind each
        let pair: [Pillar, Pillar] = [pillars[0]!, pillars[1]!];
        for (const a of pillars) for (const b of pillars) if (Math.hypot(a.x - b.x, a.z - b.z) > Math.hypot(pair[0].x - pair[1].x, pair[0].z - pair[1].z)) pair = [a, b];
        chosen = [pair[0], pair[1], ...chosen.filter((p) => p !== pair[0] && p !== pair[1])].slice(0, Math.max(2, use));
        load.length = 0;
        for (let k = 0; k < chosen.length; k++) load.push(0);
        const byId = new Map(living.map((q) => [q.id, q]));
        const d = (id: string, j: number) => {
          const q = byId.get(id);
          return q ? Math.hypot(chosen[j]!.x - q.x, chosen[j]!.z - q.z) : 0;
        };
        for (const h of ties) {
          if (h.shape.k !== 'tether') continue;
          // whichever way round means less walking, as long as both pillars have room
          const { a, b } = h.shape;
          let flip = d(a, 1) + d(b, 0) < d(a, 0) + d(b, 1);
          if (load[flip ? 1 : 0]! >= cap || load[flip ? 0 : 1]! >= cap) flip = !flip;
          for (const [id, j] of [[a, flip ? 1 : 0], [b, flip ? 0 : 1]] as const) {
            if (slots.has(id) || !byId.has(id)) continue;
            slots.set(id, [j, load[j]!]);
            load[j]!++;
          }
        }
      }
      // the closest player–pillar pairs first, while the pillar has room
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
    const step = Math.min(d, (this.fight.speed(me) * 0.95 * TICK_MS) / 1000);
    let [ux, uz] = [dx / d, dz / d];
    const t = this.fight.tick;
    const bad = (this.fight.brain?.hazards() ?? []).filter(
      (h) => !h.on && h.aim !== me.id && AREA.has(h.shape.k) && (h.zone || (h.end >= t && h.end - t <= URGENT)) && !inside(h.shape, me.x, me.z),
    );
    // 判決傳遞: round anyone I must not touch
    const keep = this.untouchable(me);
    if (bad.length || keep.length) {
      const look = Math.min(d, 1.5);
      // a few points along the way (the thin end of a beam lies between them); a lingering one with room to spare
      const clear = (ax: number, az: number) =>
        ![0.35, 0.7, 1].some((k) => bad.some((h) => (h.zone ? near : inside)(h.shape, me.x + ax * look * k, me.z + az * look * k))) &&
        ![0.35, 0.7, 1].some((k) =>
          keep.some((q) => {
            const d = Math.hypot(me.x + ax * look * k - q.x, me.z + az * look * k - q.z);
            return d < 1.8 && d < Math.hypot(me.x - q.x, me.z - q.z);
          }),
        );
      if (!clear(ux, uz)) {
        let found = false;
        for (const turn of [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2]) {
          const c = Math.cos(turn);
          const sn = Math.sin(turn);
          const [vx, vz] = [ux * c - uz * sn, ux * sn + uz * c];
          if (clear(vx, vz)) {
            [ux, uz] = [vx, vz];
            found = true;
            break;
          }
        }
        // hemmed in by people I must not touch: wait rather than walk into one (unless standing in something)
        if (!found && keep.length && !this.inDanger(me)) return;
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
    // casts only when standing where it means to stay (close to it while something is coming: within a metre
    // it does not hurry, so the cast is not cut short)
    const settled = Math.hypot(goal[0] - me.x, goal[1] - me.z) < (this.busy() ? 0.9 : 1.2);
    const boss = f.brain?.foe ?? f.foes.find((e) => e.boss) ?? focus;
    const sec3 = 3 * TICK_RATE;
    const low = me.hp / f.maxHp(me) < 0.5;
    const raidwide = boss.cast?.m === 'raidwide';
    // my damage-over-time on what I attack: missing or about to run out
    const dotLow = (id: string) => {
      const s = focus.statuses.find((x) => x.id === id && x.src === me.id);
      return !s || s.until - t < sec3;
    };
    const near = (r: number) => f.foes.filter((e) => f.hittable(e) && reach(me.x, me.z, e) <= r).length;

    // 疾走 when the place I mean to be is far
    if (ready(SPRINT_SLOT) && Math.hypot(goal[0] - me.x, goal[1] - me.z) > 8 && use(SPRINT_SLOT, null)) return false;

    if (me.role === 'tank') {
      const busterOnMe = boss.cast?.m === 'buster' && boss.cast.target === me.id;
      // a fan aimed at me about to go off (噴焰): mitigate it like a buster
      const fanOnMe = !!f.brain?.hazards().some((h) => h.aim === me.id && h.shape.k === 'cone' && h.end >= t && h.end - t <= sec(2.5));
      // the boss I hold, even while my attacks go to its pair (the ultimate)
      const held = focus.boss && f.brain?.staged ? boss : focus;
      const top = f.topOf(held);
      // 裂盾, or 水抗降低 (流體揮擊): the next buster goes to the other tank
      const cracked = (q: Fighter) => q.statuses.some((s) => s.id === 'crack' || s.id === 'waterDown');
      // take the enemy back from a non-tank; on a tank buster with a crack, the other tank takes over
      const swap = top && top.id !== me.id && top.role === 'tank' && cracked(top) && !cracked(me) && focus === boss;
      if (top && (top.role !== 'tank' || swap) && ready(1) && use(1, held.id)) return false;
      // slot 2 is the short mitigation, slot 3 the big one (both tanks): the short one for a buster, the big
      // one for the second hit of a double buster that lands on me again (a lone tank)
      const has = (...ids: string[]) => me.statuses.some((s) => ids.includes(s.id));
      // 流體揮擊 on me inside my 水抗降低 (no other tank took it): only the invulnerability keeps me up
      const soaked = me.statuses.find((s) => s.id === 'waterDown');
      if (busterOnMe && soaked && soaked.until > boss.cast!.end && boss.cast!.end - t <= sec(2) && !has('fortress', 'holmgang') && ready(3) && use(3, null)) return false;
      // a buster marker on me (the second hit follows whoever is top: after a swap, that is me)
      const marked = !!f.brain?.hazards().some((h) => h.color === 'r' && h.end - t <= sec3 && f.brain!.holder(h)?.id === me.id);
      const second = (me.statuses.some((s) => s.id === 'crack') && f.topOf(boss)?.id === me.id) || (marked && !busterOnMe);
      const hurt = me.hp / f.maxHp(me) < 0.85;
      // the big one just before the hit lands, so it still covers a second hit 4 s later; where 流體揮擊 comes
      // back inside its 水抗降低, the big one (an invulnerability) waits for that
      const soon = busterOnMe && boss.cast!.end - t <= sec(1.2);
      const keepBig = this.soakFight();
      if (!keepBig && (second || (soon && hurt)) && !has('fortress', 'holmgang') && ready(3) && use(3, null)) return false;
      if ((busterOnMe || fanOnMe || second) && !has('rampart', 'bloodlust', 'fortress', 'holmgang')) for (const s of keepBig ? [2] : [2, 3]) if (ready(s) && use(s, null)) return false;
      // 守護之誓 / 熱血庇護 on whoever the buster is for: me on top of the other mitigation, or the other tank
      const busted = boss.cast?.m === 'buster' ? f.players.get(boss.cast.target ?? '') : undefined;
      if (busted && !busted.dead && ready(7) && !busted.statuses.some((s) => s.id === 'oath' || s.id === 'nascent') && use(7, busted.id)) return false;
      if (me.job.id === 'guardian' && raidwide && ready(4) && use(4, null)) return false;
      if (me.job.id === 'berserker' && low && ready(9) && use(9, null)) return false;
      if (weave && inMelee && ready(8) && use(8, null)) return false;
      // back to the boss after being thrown out (not while dodging)
      if (!inMelee && held === focus && reach(me.x, me.z, focus) > 5 && !this.busy() && ready(6) && use(6)) return false;
      if (gcdLeft > 0) return false;
      if (me.job.id === 'berserker' && ready(4) && inMelee && use(4, null)) return false;
      // pick up adds: the guardian's circle when two are close, the berserker's axe at one that is on someone else
      if (me.job.id === 'guardian' && near(5) >= 2 && use(5, null)) return false;
      if (me.job.id === 'berserker') {
        const loose = f.foes.find((e) => !e.boss && f.hittable(e) && f.topOf(e)?.role !== 'tank' && reach(me.x, me.z, e) <= 20);
        if (loose && use(5, loose.id)) return false;
      }
      if (inMelee) use(0);
      else if (me.job.id === 'guardian' && settled && reach(me.x, me.z, focus) <= 25) use(9);
      else if (me.job.id === 'berserker' && reach(me.x, me.z, focus) <= 20) use(5, focus.id);
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
      // 窒息: healed to full before it runs out, or down they go
      const choked = alive.filter((q) => q.statuses.some((s) => s.id === 'throttle')).sort((a, b) => pct(a) - pct(b))[0];
      if (choked && priest && ready(3) && use(3, choked.id)) return false;
      if (busted && pct(busted) < 0.7 && priest && ready(3) && use(3, busted.id)) return false;
      if (!priest && avg < 0.8 && weave && ready(3) && use(3, null)) return false;
      // 晨光恩典 / 星輝 when the whole party is low
      if (avg < 0.65 && weave && ready(7) && use(7, null)) return false;
      if (priest && pct(lowest) < 0.55 && ready(9) && use(9, lowest.id)) return false;
      if (!priest && busted && ready(8) && use(8, busted.id)) return false;
      if (!priest && raidwide && weave && ready(9) && use(9, null)) return false;
      // 迅唱 first, so the raise does not stand still for 6 seconds
      if (fallen && ready(4) && ready(5) && weave && use(5, null)) return false;
      if (gcdLeft > 0) return false;
      const swift = me.statuses.some((s) => s.id === 'swift');
      // 窒息 does not wait for a quiet moment
      if (choked && (settled || !this.busy())) return use(1, choked.id);
      if (!settled && !swift) {
        // moving: the instant damage-over-time is the one thing worth doing
        if (dotLow(priest ? 'sunBurn' : 'starRot') && reach(me.x, me.z, focus) <= 25) use(6);
        return false;
      }
      if (fallen && ready(4)) return use(4, fallen.id);
      // a raid-wide on its way (on Hard it hits twice): everyone full first
      if (raidwide && pct(lowest) < 0.97) {
        if (priest && alive.filter((q) => pct(q) < 0.97).length >= 2) return use(8, null);
        return use(1, lowest.id);
      }
      if (busted && pct(busted) < 0.98) return use(1, busted.id);
      if (!priest && raidwide && ready(2)) return use(2, null);
      if (avg < 0.8 && ready(2)) return use(2, null);
      if (priest && avg < 0.75) return use(8, null);
      if (pct(lowest) < 0.8) return use(1, lowest.id);
      if (dotLow(priest ? 'sunBurn' : 'starRot') && use(6)) return false;
      return use(0);
    }

    // DPS
    switch (me.job.id as JobId) {
      case 'brawler': {
        if (this.dpsDefence(me, boss, weave, low, raidwide, ready, use)) return false;
        if (weave && ready(3) && use(3, null)) return false;
        // 八方步 when the boss turned and 崩山拳 is waiting for its back
        if (weave && ready(2) && ready(8) && inMelee && sideOf(focus, me.x, me.z) !== 'rear' && use(8, null)) return false;
        const north = me.statuses.some((s) => s.id === 'trueNorth');
        if (weave && ready(2) && inMelee && (north || sideOf(focus, me.x, me.z) === 'rear') && use(2)) return false;
        if (gcdLeft > 0 || !inMelee) return false;
        if (near(5) >= 3 && use(5, null)) return false;
        if (ready(1) && (sideOf(focus, me.x, me.z) === 'flank' || !focus.boss)) {
          if (use(1)) this.lastFlank = t;
          return false;
        }
        use(0);
        return false;
      }
      case 'lancer': {
        if (this.dpsDefence(me, boss, weave, low, raidwide, ready, use)) return false;
        if (weave && ready(3) && use(3, null)) return false;
        if (weave && ready(5) && settled && !this.busy() && use(5)) return false;
        // the jump moves me: not while something is about to land
        if (weave && ready(2) && settled && !this.busy() && use(2)) return false;
        if (gcdLeft > 0 || !inMelee) return false;
        if (ready(1) && use(1)) return false;
        use(0);
        return false;
      }
      case 'ranger': {
        if (low && ready(9) && use(9, null)) return false;
        if (weave && ready(3) && raidwide && use(3, null)) return false;
        if (weave && ready(5) && use(5, null)) return false;
        if (weave && ready(8) && use(8, null)) return false;
        if (weave && ready(7) && use(7)) return false;
        if (weave && ready(2) && use(2)) return false;
        // the backflip lands about 10 m further out, still in range; not while dodging
        if (weave && ready(4) && settled && !this.busy() && use(4)) return false;
        if (gcdLeft > 0) return false;
        if (ready(1) && use(1)) return false;
        if (dotLow('venom') && use(6)) return false;
        use(0);
        return false;
      }
      case 'sorcerer': {
        const swift = me.statuses.some((s) => s.id === 'swift');
        if ((raidwide || low) && weave && ready(8) && use(8, null)) return false;
        if (raidwide && weave && ready(9) && !boss.statuses.some((s) => s.id === 'addle' || s.id === 'feint') && reach(me.x, me.z, boss) <= 25 && use(9, boss.id)) return false;
        if (weave && settled && ready(3) && !this.busy() && use(3, null)) return false;
        if (weave && ready(2) && this.readyIn(me, 4) < 45 && !swift && use(2, null)) return false;
        if (gcdLeft > 0) return false;
        // moving: the instant 灼燒咒 keeps the damage going
        if (!settled && !swift) return dotLow('scorch') ? use(7) : false;
        if (dotLow('scorch') && use(7)) return false;
        if (ready(4)) return use(4);
        if (ready(1)) return use(1);
        return use(0);
      }
      case 'summoner': {
        // 0 靈光彈, 1 靈光爆, 2 岩靈召喚, 3 炎靈召喚, 4 星龍降臨, 5 靈光閃耀, 6 喚魂術, 7 靈盾, 8 迅唱, 9 蝕力咒
        const quick = me.statuses.some((s) => s.id === 'swift' || s.id === 'stoneSpirit');
        // raise someone the healers cannot get to (none alive, or none free)
        const healers = [...f.players.values()].filter((q) => q.role === 'healer' && !q.dead);
        const fallen = [...f.players.values()].find((q) => q.dead && reach(me.x, me.z, { x: q.x, z: q.z, r: RULES.playerRadius }) <= 30);
        const mustRaise = !!fallen && (!healers.length || healers.every((q) => q.cast !== null));
        if ((raidwide || low) && weave && ready(7) && use(7, null)) return false;
        if (raidwide && weave && ready(9) && !boss.statuses.some((s) => s.id === 'addle' || s.id === 'feint') && reach(me.x, me.z, boss) <= 25 && use(9, boss.id)) return false;
        if (mustRaise && ready(6) && !quick && weave && ready(8) && use(8, null)) return false;
        if (weave && ready(4) && use(4)) return false;
        if (weave && ready(5) && use(5, null)) return false;
        if (weave && ready(3) && use(3, null)) return false;
        // 岩靈 whenever it is up (its shield helps); its instants carry me through the moving
        if (weave && ready(2) && use(2, null)) return false;
        if (gcdLeft > 0) return false;
        if (mustRaise && ready(6) && (quick || settled)) return use(6, fallen!.id);
        if (!settled && !quick) return false;
        if (near(5) >= 3) return use(1);
        return use(0);
      }
      default:
        return false;
    }
  }

  /** A melee DPS's own defence: 鐵身 / 龍鱗 when it hurts, 卸力 on the boss for a raid-wide, 回氣 when low. */
  private dpsDefence(
    me: Fighter,
    boss: Foe,
    weave: boolean,
    low: boolean,
    raidwide: boolean,
    ready: (slot: number) => boolean,
    use: (slot: number, target?: string | null) => boolean,
  ): boolean {
    if (low && ready(9) && use(9, null)) return true;
    if (!weave) return false;
    if ((raidwide || low) && ready(6) && use(6, null)) return true;
    const soft = boss.statuses.some((s) => s.id === 'feint' || s.id === 'addle');
    return raidwide && !soft && ready(7) && reach(me.x, me.z, boss) <= 10 && use(7, boss.id);
  }

  private soak: boolean | null = null;
  /** The boss has busters that come back inside their own 水抗降低 (流體揮擊): the invulnerability is for those. */
  private soakFight(): boolean {
    const brain = this.fight.brain;
    if (!brain) return false;
    // the script changes with the stage: look again whenever it does
    const s = brain.script;
    if (this.soak === null || this.soakOf !== s) {
      this.soakOf = s;
      this.soak = s.phases.some((ph) => ph.entries.some((e) => e.mechs.some((m) => m.k === 'buster' && !!m.soak)));
    }
    return this.soak;
  }
  private soakOf: unknown = null;

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
    case 'summoner':
      return [-1.35 - k * 0.35, 8, false];
    case 'priest':
      return [0.45 + k * 0.3, 7, false];
    case 'warden':
      return [-0.45 - k * 0.3, 7, false];
  }
}
