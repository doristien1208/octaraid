import { describe, expect, it } from 'vitest';
import { RULES, TICK_RATE, sec } from '../shared/constants';
import { encounterById } from '../shared/encounters';
import { LB_SLOT, type JobId } from '../shared/jobs';
import type { FightEvent } from '../shared/protocol';
import { reach, sideOf } from '../shared/sim/arena';
import { Fight, type FightOptions } from '../shared/sim/fight';
import { PRACTICE } from '../shared/sim/practice';

/** A fight with these jobs (ids p0, p1, …), past the countdown. */
function fight(jobs: JobId[], opts: FightOptions & { hard?: boolean } = {}): Fight {
  const f = new Fight(
    encounterById('colossus'),
    !!opts.hard,
    jobs.map((job, k) => ({ id: `p${k}`, name: `P${k}`, job })),
    42,
    { hpScale: 10, ...opts },
  );
  for (let k = 0; k < RULES.countdown; k++) f.step();
  expect(f.phase).toBe('fight');
  return f;
}

/** Steps the fight and collects its events. */
function run(f: Fight, ticks: number): FightEvent[] {
  const out: FightEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    f.step();
    out.push(...(f.snapshot().ev ?? []));
  }
  return out;
}

/** Puts a player somewhere (as if their client walked there), with the clock far enough on. */
let clock = 0;
function place(f: Fight, id: string, x: number, z: number): void {
  const p = f.players.get(id)!;
  p.x = x;
  p.z = z;
  p.reportedAt = -1;
  clock += 1000;
  f.move(id, x, z, p.f, clock);
}

const boss = (f: Fight) => f.foes[0]!;
const damage = (ev: FightEvent[], src: string) =>
  ev.filter((e): e is Extract<FightEvent, { k: 'dmg' }> => e.k === 'dmg' && e.s === src).reduce((n, e) => n + e.a, 0);

describe('combat timing', () => {
  it('shares the 2.5 s GCD, queues a press in its last half second and lets two abilities weave in between', () => {
    const f = fight(['brawler'], { calm: true });
    place(f, 'p0', 0, -3.4); // behind the dummy, in melee range
    expect(f.use('p0', 0)).toBe('ok');
    expect(f.use('p0', 0)).toBe('gcd'); // too early to queue
    run(f, RULES.lock);
    expect(f.use('p0', 3)).toBe('ok'); // 疾風之心 right after the GCD skill's animation lock
    expect(f.use('p0', 2)).toBe('queued'); // 崩山拳 waits out the second lock
    const ev = run(f, RULES.lock + 1);
    expect(ev.some((e) => e.k === 'use' && e.s === 2)).toBe(true);
    // the first GCD (2.5 s, from before 疾風之心) ends at tick 75: a press 0.4 s before goes off on time
    run(f, RULES.gcd - 2 * RULES.lock - 1 - sec(0.4));
    expect(f.use('p0', 0)).toBe('queued');
    const later = run(f, sec(0.4) + 1);
    expect(later.filter((e) => e.k === 'use' && e.s === 0)).toHaveLength(1);
  });

  it('keeps cooldowns', () => {
    const f = fight(['guardian'], { calm: true });
    expect(f.use('p0', 2)).toBe('ok'); // 堅盾, 40 s
    run(f, sec(10));
    expect(f.use('p0', 2)).toBe('cd');
    run(f, sec(30));
    expect(f.use('p0', 2)).toBe('ok');
  });

  it('casts standing still, cuts the cast when moving, but not in its last half second', () => {
    const f = fight(['priest'], { calm: true });
    const p = f.players.get('p0')!;
    expect(f.use('p0', 0)).toBe('ok'); // 聖光彈, 1.5 s
    expect(p.cast).not.toBeNull();
    run(f, sec(0.5));
    clock += 33;
    f.move('p0', p.x + 0.3, p.z, p.f, clock);
    expect(p.cast).toBeNull();
    expect(f.use('p0', 0)).toBe('ok'); // the GCD came back
    const ev1 = run(f, sec(1.5) - sec(0.4));
    clock += 33;
    f.move('p0', p.x + 0.3, p.z, p.f, clock); // slidecast
    const ev2 = [...ev1, ...run(f, sec(0.5))];
    expect(ev2.some((e) => e.k === 'use' && e.i === 'p0' && e.s === 0)).toBe(true);
    expect(damage(ev2, 'p0')).toBeGreaterThan(0);
  });

  it('makes the next spell instant with 迅唱 and shortens casts in 魔力湧泉', () => {
    const f = fight(['sorcerer'], { calm: true });
    const p = f.players.get('p0')!;
    expect(f.use('p0', 2)).toBe('ok'); // 迅唱
    run(f, RULES.lock);
    expect(f.use('p0', 4)).toBe('ok'); // 隕星 at once
    expect(p.cast).toBeNull();
    expect(p.statuses.some((s) => s.id === 'swift')).toBe(false);
    run(f, RULES.lock);
    expect(f.use('p0', 3)).toBe('ok'); // 魔力湧泉 under my feet
    run(f, sec(3.5));
    expect(f.use('p0', 0)).toBe('ok');
    expect(p.cast!.end - p.cast!.start).toBe(sec(2 * 0.7));
  });

  it('checks range from the edge of the target ring', () => {
    const f = fight(['brawler', 'ranger'], { calm: true });
    place(f, 'p0', 0, PRACTICE.ring + 3.5);
    expect(f.use('p0', 0)).toBe('range');
    place(f, 'p0', 0, PRACTICE.ring + 2.9);
    expect(f.use('p0', 0)).toBe('ok');
    // 25 m is more than this arena allows: stand the ranger there by hand
    const r = f.players.get('p1')!;
    r.z = PRACTICE.ring + 25.5;
    expect(f.use('p1', 0)).toBe('range');
    r.z = PRACTICE.ring + 24.9;
    expect(f.use('p1', 0)).toBe('ok');
  });
});

describe('damage', () => {
  it('runs the 3-step combo and rewards the rear positional', () => {
    const f = fight(['brawler', 'guardian'], { calm: true });
    place(f, 'p1', 0, 4); // the tank in front holds the dummy facing south
    boss(f).enmity.set('p1', 1e9);
    run(f, 10);
    place(f, 'p0', 0, -3.4);
    expect(sideOf(boss(f), -0, -3.4)).toBe('rear');
    const steps: number[] = [];
    const hits: Extract<FightEvent, { k: 'dmg' }>[] = [];
    for (let k = 0; k < 3; k++) {
      f.use('p0', 0);
      const ev = run(f, RULES.gcd);
      for (const e of ev) {
        if (e.k === 'use' && e.i === 'p0') steps.push(e.st!);
        if (e.k === 'dmg' && e.s === 'p0') hits.push(e);
      }
    }
    expect(steps).toEqual([0, 1, 2]);
    expect(hits[2]!.pos).toBe(1);
    // from the front the third step misses its bonus
    place(f, 'p0', 0, 3.5);
    for (let k = 0; k < 3; k++) {
      f.use('p0', 0);
      const ev = run(f, RULES.gcd);
      const hit = ev.find((e): e is Extract<FightEvent, { k: 'dmg' }> => e.k === 'dmg' && e.s === 'p0');
      if (k === 2) expect(hit!.pos).toBe(0);
    }
  });

  it('turns potency into damage: ×10, ±5%, crits ×1.5', () => {
    const f = fight(['ranger'], { calm: true });
    place(f, 'p0', 0, 12);
    const amounts: number[] = [];
    for (let k = 0; k < 40; k++) {
      f.use('p0', 0); // 速射, 220
      for (const e of run(f, RULES.gcd)) if (e.k === 'dmg' && e.s === 'p0') amounts.push(e.a);
    }
    for (const a of amounts) expect(a >= 2090 && a <= 2310 * 1.5 + 1).toBe(true);
    expect(amounts.some((a) => a > 2310)).toBe(true); // at least one crit in 40
  });

  it('multiplies mitigation and lets shields absorb first', () => {
    const f = fight(['guardian', 'warden'], { calm: false });
    const tank = f.players.get('p0')!;
    place(f, 'p0', 0, 4);
    boss(f).enmity.set('p0', 1e9); // the warden's healing must not pull the dummy
    f.use('p0', 2); // 堅盾 −30%
    run(f, RULES.lock);
    f.use('p0', 4); // 守護結界 −10%
    // the dummy's first auto attack: 500 × 0.7 × 0.9
    const ev = run(f, sec(PRACTICE.autoEvery));
    const hit = ev.find((e): e is Extract<FightEvent, { k: 'dmg' }> => e.k === 'dmg' && e.t === 'p0');
    expect(hit!.a).toBe(Math.round(500 * 0.7 * 0.9));
    // a 2,000 shield takes the next hit whole
    place(f, 'p1', 0, 12);
    f.use('p1', 1, { target: 'p0' }); // 星盾術
    const ev2 = run(f, sec(PRACTICE.autoEvery));
    const hit2 = ev2.find((e): e is Extract<FightEvent, { k: 'dmg' }> => e.k === 'dmg' && e.t === 'p0');
    expect(hit2!.a).toBe(0);
    expect(hit2!.ab).toBe(Math.round(500 * 0.7 * 0.9));
    expect(tank.statuses.find((s) => s.id === 'starShield')!.v).toBe(2000 - Math.round(500 * 0.7 * 0.9));
  });
});

describe('enmity', () => {
  it('weights tank damage ×3 and puts a provoker on top with a lead', () => {
    const f = fight(['guardian', 'sorcerer'], { calm: true });
    place(f, 'p0', 0, 4);
    place(f, 'p1', 0, 14);
    for (let k = 0; k < 6; k++) {
      f.use('p1', 0);
      run(f, RULES.gcd);
    }
    expect(f.topOf(boss(f))!.id).toBe('p1');
    expect(f.use('p0', 1)).toBe('ok'); // 挑釁
    const en = boss(f).enmity;
    expect(f.topOf(boss(f))!.id).toBe('p0');
    expect(en.get('p0')!).toBeGreaterThanOrEqual(en.get('p1')! * (1 + RULES.provokeLead));
    // equal damage would make three times the enmity for the tank
    const before0 = en.get('p0')!;
    run(f, RULES.lock);
    f.use('p0', 0);
    const ev = run(f, 1);
    expect(en.get('p0')! - before0).toBe(damage(ev, 'p0') * RULES.enmityTank);
  });
});

describe('death, raise and the Limit Break', () => {
  it('raises at 25% HP with 衰弱, and with 瀕死 after falling again while weakened', () => {
    const f = fight(['priest', 'sorcerer'], { calm: true });
    const dps = f.players.get('p1')!;
    place(f, 'p0', 0, 10);
    place(f, 'p1', 2, 10);
    // an auto attack finishes p1 off: the dummy attacks for a moment
    dps.hp = 1;
    f.calm = false;
    boss(f).enmity.set('p1', 1e9);
    run(f, sec(PRACTICE.autoEvery) + 1);
    f.calm = true;
    expect(dps.dead).toBe(true);
    expect(f.use('p0', 4)).toBe('ok'); // 復甦之光, 6 s
    run(f, sec(6) + 1);
    expect(dps.dead).toBe(false);
    expect(f.maxHp(dps)).toBe(7500);
    expect(dps.hp).toBe(Math.round(7500 * RULES.raiseHp));
    expect(dps.statuses.some((s) => s.id === 'risen')).toBe(true);
    run(f, RULES.lock);
    expect(f.use('p1', 0)).toBe('ok'); // any action ends 復活庇護
    expect(dps.statuses.some((s) => s.id === 'risen')).toBe(false);
    // down again while weakened
    dps.hp = 1;
    f.calm = false;
    boss(f).enmity.set('p1', 1e9);
    run(f, sec(PRACTICE.autoEvery) + 1);
    f.calm = true;
    expect(dps.dead).toBe(true);
    run(f, sec(20)); // the raise is on cooldown for 20 s
    expect(f.use('p0', 4)).toBe('ok');
    run(f, sec(6) + 1);
    expect(f.maxHp(dps)).toBe(5000);
    expect(dps.statuses.some((s) => s.id === 'brink')).toBe(true);
  });

  it('fills the gauge 0.5% a second; a move cuts its cast without spending it', () => {
    const f = fight(['sorcerer', 'guardian'], { calm: true });
    expect(f.use('p0', LB_SLOT)).toBe('lb');
    run(f, sec(200));
    expect(f.lb).toBeCloseTo(100, 5);
    const p = f.players.get('p0')!;
    expect(f.use('p0', LB_SLOT)).toBe('ok'); // 破軍一擊: 2 s cast
    run(f, 10);
    clock += 33;
    f.move('p0', p.x + 1, p.z, p.f, clock);
    expect(p.cast).toBeNull();
    expect(f.lb).toBe(100);
    run(f, RULES.castLock);
    const hpBefore = boss(f).hp;
    expect(f.use('p0', LB_SLOT)).toBe('ok');
    const ev = run(f, sec(2) + 1);
    expect(ev.some((e) => e.k === 'lb' && e.i === 'p0' && e.r === 'dps')).toBe(true);
    expect(hpBefore - boss(f).hp).toBe(Math.round(boss(f).maxHp * RULES.lbDpsBoss));
    expect(f.lb).toBeLessThan(1);
  });

  it('gives each role its own Limit Break', () => {
    const f = fight(['guardian', 'priest', 'brawler'], { calm: true });
    run(f, sec(200));
    expect(f.use('p0', LB_SLOT)).toBe('ok'); // 鋼鐵誓約: instant
    for (const p of f.players.values()) expect(p.statuses.some((s) => s.id === 'ironVow')).toBe(true);
    const f2 = fight(['priest', 'brawler'], { calm: true });
    const dps = f2.players.get('p1')!;
    dps.hp = 0;
    dps.dead = true;
    run(f2, sec(200));
    expect(f2.use('p0', LB_SLOT)).toBe('ok'); // 黎明讚歌: everyone up, no weakness
    run(f2, sec(2) + 1);
    expect(dps.dead).toBe(false);
    expect(dps.hp).toBe(10_000);
    expect(dps.statuses.some((s) => s.id === 'weak')).toBe(false);
  });
});

describe('missing roles and 超越之力', () => {
  it('without a healer the party regenerates and the fallen get up after 20 s', () => {
    const f = fight(['guardian', 'brawler'], { calm: true });
    const p = f.players.get('p1')!;
    p.hp = 5000;
    run(f, RULES.dotTick);
    expect(p.hp).toBe(5000 + Math.round(10_000 * RULES.noHealerRegen * 3));
    p.hp = 0;
    p.dead = true;
    p.diedAt = f.tick;
    run(f, RULES.autoRaise + 1);
    expect(p.dead).toBe(false);
    p.hp = 0;
    p.dead = true;
    p.diedAt = f.tick;
    run(f, RULES.autoRaise + 1);
    expect(p.dead).toBe(true); // once per fight
  });

  it('without a tank the dummy hits for half', () => {
    const f = fight(['brawler', 'ranger'], { calm: false });
    const ev = run(f, sec(PRACTICE.autoEvery));
    const hit = ev.find((e): e is Extract<FightEvent, { k: 'dmg' }> => e.k === 'dmg' && e.s === 'boss');
    expect(hit!.a).toBe(PRACTICE.auto.normal * RULES.noTankDamage);
  });

  it('adds 10% HP and damage per wipe on Normal, never on Hard', () => {
    const f = fight(['brawler'], { calm: true, echo: 2 });
    expect(f.maxHp(f.players.get('p0')!)).toBe(12_000);
    const h = fight(['brawler'], { calm: true, echo: 2, hard: true });
    expect(h.maxHp(h.players.get('p0')!)).toBe(10_000);
  });
});

describe('movement skills', () => {
  it('dashes where the player is moving and ignores their reports meanwhile', () => {
    const f = fight(['brawler'], { calm: true });
    const p = f.players.get('p0')!;
    place(f, 'p0', 0, 8);
    expect(f.use('p0', 4, { dx: 1, dz: 0 })).toBe('ok'); // 縮地 east
    clock += 33;
    expect(f.move('p0', 0, 8, 0, clock)).toBeNull();
    run(f, sec(0.25) + 1);
    expect(p.x).toBeCloseTo(10, 5);
    expect(p.z).toBeCloseTo(8, 5);
  });

  it('jumps onto the target with 天降擊 and lands the hit after 0.8 s', () => {
    const f = fight(['lancer'], { calm: true });
    const p = f.players.get('p0')!;
    place(f, 'p0', 0, 15);
    expect(f.use('p0', 2)).toBe('ok');
    expect(p.statuses.some((s) => s.id === 'airborne')).toBe(true);
    const early = run(f, sec(0.8) - 1);
    expect(damage(early, 'p0')).toBe(0);
    const ev = run(f, 2);
    expect(damage(ev, 'p0')).toBeGreaterThan(6000);
    expect(reach(p.x, p.z, boss(f))).toBeLessThan(0.5);
  });
});

describe('the training dummy', () => {
  it('casts a tank buster on the top of its list at 0:20 and a raid-wide at 0:50', () => {
    const f = fight(['guardian', 'priest', 'brawler'], { calm: false });
    place(f, 'p0', 0, 4);
    // the tank would not survive 50 s of autos without a healer at work: make it untouchable
    f.players.get('p0')!.statuses.push({ id: 'fortress', src: 'p0', until: -1, v: 0 });
    const ev = run(f, sec(54));
    const casts = ev.filter((e): e is Extract<FightEvent, { k: 'bcast' }> => e.k === 'bcast');
    expect(casts.map((c) => [c.n, c.m])).toEqual([
      ['重擊', 'buster'],
      ['震盪波', 'raidwide'],
    ]);
    expect(casts[0]!.t).toBe('p0');
    const raid = ev.filter((e) => e.k === 'dmg' && e.s === 'boss' && e.a === 3500);
    expect(raid).toHaveLength(2); // the priest and the brawler; the tank was invulnerable
    expect(f.fightTicks).toBe(sec(54));
    expect(TICK_RATE).toBe(30);
  });
});
