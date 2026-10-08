import { RULES, TICK_MS } from '../constants';
import type { JobId } from '../jobs';
import { clampToArena, reach, sideOf } from './arena';
import type { Fight, Fighter, Foe } from './fight';

/**
 * Simple computer party members for offline practice and the balance tests. They walk to a spot around
 * the boss for their role, keep a plain rotation, mitigate tank busters, heal and raise. They read the
 * fight and send the same requests a client would (move, use). They know nothing about mechanics yet:
 * the mechanic-aware dev bots come with the boss timelines (M3).
 */
export class Bot {
  private now = 0;

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
    const boss = f.foes.find((e) => e.hp > 0);
    if (!me || me.dead || !boss || f.phase === 'over') return;
    const wantCast = f.phase === 'fight' ? this.act(me, boss) : false;
    if (!me.cast && !me.dash && !wantCast) this.walk(me, boss);
  }

  // ------------------------------------------------------------------ moving

  private walk(me: Fighter, boss: Foe): void {
    const [gx, gz] = this.goal(boss, this.where(me));
    const dx = gx - me.x;
    const dz = gz - me.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) return;
    const step = Math.min(d, (RULES.moveSpeed * 0.95 * TICK_MS) / 1000);
    this.fight.move(this.id, me.x + (dx / d) * step, me.z + (dz / d) * step, Math.atan2(dx, dz), this.now);
  }

  /** The brawler steps to the flank for 旋風踢 and to the rear otherwise. */
  private where(me: Fighter): Spot {
    if (me.job.id === 'brawler' && this.readyIn(me, 1) < 30 && this.fight.tick - this.lastFlank > 60) return [Math.PI / 2, 1, true];
    return this.spot;
  }

  private goal(boss: Foe, [ang, dist, rel]: Spot): [number, number] {
    const a = (rel ? boss.f : 0) + ang;
    return clampToArena(this.fight.enc.arena, boss.x + Math.sin(a) * (boss.r + dist), boss.z + Math.cos(a) * (boss.r + dist));
  }

  private lastFlank = -999;

  // ------------------------------------------------------------------ skills

  /** Uses a skill if it is time; true while it wants to stand still for a cast. */
  private act(me: Fighter, boss: Foe): boolean {
    const f = this.fight;
    const t = f.tick;
    if (me.cast || me.dash || me.lockUntil > t) return !!me.cast;
    const gcdLeft = me.gcdAt + me.gcdLen - t;
    const weave = gcdLeft >= RULES.lock + 3;
    const use = (slot: number, target: string | null = boss.id) => f.use(this.id, slot, { target }) === 'ok';
    const ready = (slot: number) => this.readyIn(me, slot) <= 0;
    const inMelee = reach(me.x, me.z, boss) <= 3;
    const atSpot = this.atSpot(me, boss);

    if (me.role === 'tank') {
      const busterOnMe = boss.cast?.m === 'buster' && boss.cast.target === me.id;
      // take the boss back from a non-tank (two tanks do not fight over it)
      const top = f.topOf(boss);
      if (top && top.role !== 'tank' && ready(1) && use(1)) return false;
      // slot 2 is the short mitigation, slot 3 the big one (both tanks)
      if (busterOnMe && !me.statuses.some((s) => s.id === 'rampart' || s.id === 'bloodlust' || s.id === 'fortress' || s.id === 'holmgang'))
        for (const s of [2, 3]) if (ready(s) && use(s, null)) return false;
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
      if (!priest && avg < 0.8 && weave && ready(3) && use(3, null)) return false;
      if (gcdLeft > 0 || !atSpot) return false; // casts wait until it stands at its spot
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
        if (weave && ready(2) && inMelee && sideOf(boss, me.x, me.z) === 'rear' && use(2)) return false;
        if (gcdLeft > 0 || !inMelee) return false;
        if (ready(1) && sideOf(boss, me.x, me.z) === 'flank') {
          if (use(1)) this.lastFlank = t;
          return false;
        }
        use(0);
        return false;
      }
      case 'lancer': {
        if (weave && ready(3) && use(3, null)) return false;
        if (weave && ready(2) && use(2)) return false;
        if (gcdLeft > 0 || !inMelee) return false;
        if (ready(1) && use(1)) return false;
        use(0);
        return false;
      }
      case 'ranger': {
        if (weave && ready(3) && boss.cast?.m === 'raidwide' && use(3, null)) return false;
        if (weave && ready(2) && use(2)) return false;
        // the backflip lands about 10 m further out, still in range; the bot walks back afterwards
        if (weave && ready(4) && atSpot && use(4)) return false;
        if (gcdLeft > 0) return false;
        if (ready(1) && use(1)) return false;
        use(0);
        return false;
      }
      case 'sorcerer': {
        const swift = me.statuses.some((s) => s.id === 'swift');
        if (weave && atSpot && ready(3) && use(3, null)) return false;
        if (weave && ready(2) && this.readyIn(me, 4) < 45 && !swift && use(2, null)) return false;
        if (gcdLeft > 0) return false;
        if (!atSpot && !swift) return false;
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

  private atSpot(me: Fighter, boss: Foe): boolean {
    const [gx, gz] = this.goal(boss, this.where(me));
    return Math.hypot(gx - me.x, gz - me.z) < 1.2;
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
