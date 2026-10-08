import { describe, expect, it } from 'vitest';
import { RULES, sec } from '../shared/constants';
import { encounterById } from '../shared/encounters';
import type { JobId } from '../shared/jobs';
import type { FightEvent } from '../shared/protocol';
import type { BossScript, Entry, MechDef, Phase } from '../shared/sim/boss';
import { Fight } from '../shared/sim/fight';
import { inside } from '../shared/sim/mech';

/** A fight against a boss running `entries` (or `phases`), past the countdown; players p0, p1, … */
function fight(
  entries: Entry[],
  opts: { hard?: boolean; jobs?: JobId[]; edge?: 'wall' | 'cliff'; phases?: Phase[]; hidden?: MechDef['k'][]; hpScale?: number } = {},
): Fight {
  const script: BossScript = {
    kind: 'colossus',
    auto: 0,
    tele: 3,
    hidden: opts.hidden,
    edge: opts.edge ?? 'wall',
    enrage: { name: '天崩地裂', cast: 10 },
    phases: opts.phases ?? [{ name: '測試', entries }],
  };
  const jobs = opts.jobs ?? ['guardian', 'priest', 'brawler', 'sorcerer'];
  const f = new Fight(
    encounterById('colossus'),
    !!opts.hard,
    jobs.map((job, k) => ({ id: `p${k}`, name: `P${k}`, job })),
    42,
    { script, hpScale: opts.hpScale ?? 1 },
  );
  for (let k = 0; k < RULES.countdown; k++) f.step();
  return f;
}

function run(f: Fight, ticks: number): FightEvent[] {
  const out: FightEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    f.step();
    out.push(...(f.snapshot().ev ?? []));
  }
  return out;
}

const put = (f: Fight, id: string, x: number, z: number) => {
  const p = f.players.get(id)!;
  p.x = x;
  p.z = z;
};
const hurt = (ev: FightEvent[], id: string) =>
  ev.filter((e): e is Extract<FightEvent, { k: 'dmg' }> => e.k === 'dmg' && e.t === id && !e.s?.startsWith('p')).reduce((n, e) => n + e.a + (e.ab ?? 0), 0);
const fails = (ev: FightEvent[]) => ev.filter((e): e is Extract<FightEvent, { k: 'fail' }> => e.k === 'fail').map((e) => e.i);
const one = (m: MechDef, cast = 4): Entry[] => [{ at: 1, name: '測試招', cast, mechs: [m] }];
/** ticks until a mechanic cast at second 1 has gone off */
const after = (cast: number, extra = 0) => sec(1 + cast + extra) + 2;

describe('shapes', () => {
  it('tells inside from outside', () => {
    expect(inside({ k: 'circle', x: 0, z: 0, r: 5 }, 3, 4)).toBe(true);
    expect(inside({ k: 'circle', x: 0, z: 0, r: 5 }, 3.1, 4)).toBe(false);
    expect(inside({ k: 'donut', x: 0, z: 0, r0: 8, r1: 30 }, 0, 7)).toBe(false);
    expect(inside({ k: 'donut', x: 0, z: 0, r0: 8, r1: 30 }, 0, 9)).toBe(true);
    // a 120° fan facing south: 59° off is in, 61° off is out
    const cone = { k: 'cone' as const, x: 0, z: 0, f: 0, r: 40, deg: 120 };
    expect(inside(cone, Math.sin((59 * Math.PI) / 180) * 10, Math.cos((59 * Math.PI) / 180) * 10)).toBe(true);
    expect(inside(cone, Math.sin((61 * Math.PI) / 180) * 10, Math.cos((61 * Math.PI) / 180) * 10)).toBe(false);
    // a strip 6 m wide running east from (-10, 0)
    const strip = { k: 'rect' as const, x: -10, z: 0, f: Math.PI / 2, len: 20, w: 6 };
    expect(inside(strip, 5, 2.9)).toBe(true);
    expect(inside(strip, 5, 3.1)).toBe(false);
    expect(inside(strip, 11, 0)).toBe(false);
  });
});

describe('ground attacks', () => {
  it('hits whoever stands in a chariot, gives the Normal penalty, and only a clean one feeds the Limit Break', () => {
    const f = fight(one({ k: 'chariot', r: 10, dmg: 5000 }));
    put(f, 'p0', 0, 6);
    put(f, 'p1', 0, 12);
    put(f, 'p2', 0, -12);
    put(f, 'p3', 12, 0);
    const lb0 = f.lb;
    const ev = run(f, after(4));
    expect(hurt(ev, 'p0')).toBe(5000);
    expect(hurt(ev, 'p1')).toBe(0);
    expect(fails(ev)).toEqual(['p0']);
    expect(f.players.get('p0')!.statuses.some((s) => s.id === 'dmgDown')).toBe(true);
    expect(f.lb - lb0).toBeLessThan(RULES.lbClean); // a mistake: only the time-based gain
    const g = fight(one({ k: 'chariot', r: 10, dmg: 5000 }));
    for (const id of ['p0', 'p1', 'p2', 'p3']) put(g, id, 0, 14);
    const before = g.lb;
    const ev2 = run(g, after(4));
    expect(ev2.some((e) => e.k === 'clean')).toBe(true);
    expect(g.lb - before).toBeGreaterThanOrEqual(RULES.lbClean);
  });

  it('keeps the middle of a donut safe', () => {
    const f = fight(one({ k: 'donut', r0: 8, dmg: 5000 }));
    put(f, 'p0', 0, 5);
    put(f, 'p1', 0, 12);
    const ev = run(f, after(4));
    expect(hurt(ev, 'p0')).toBe(0);
    expect(hurt(ev, 'p1')).toBe(5000);
  });

  it('aims a sweep where the boss faced when the cast began', () => {
    const f = fight(one({ k: 'cone', deg: 120, dmg: 4000 }));
    put(f, 'p0', 0, 5); // the tank, south: the boss faces it
    put(f, 'p1', 0, -8);
    put(f, 'p2', 0, 8);
    put(f, 'p3', -8, 0);
    run(f, 40); // the boss turns to the tank, then starts the cast
    put(f, 'p0', 0, -5); // the tank walks behind it: the fan does not follow
    const ev = run(f, after(4) - 40);
    expect(hurt(ev, 'p2')).toBe(4000);
    expect(hurt(ev, 'p0')).toBe(0);
    expect(hurt(ev, 'p1')).toBe(0);
  });

  it('hides a Hard telegraph from players but not from the engine', () => {
    const f = fight(one({ k: 'cone', deg: 120, dmg: 4000 }), { hard: true, hidden: ['cone'] });
    run(f, sec(2));
    expect(f.snapshot().tg).toBeUndefined();
    expect(f.brain!.hazards().length).toBe(1);
  });
});

describe('spreads and stacks', () => {
  it('lets spread players take their own circle, and punishes overlapping', () => {
    const f = fight(one({ k: 'spread', r: 5, dmg: 3000, count: 'all' }, 5));
    const spots: [string, number, number][] = [
      ['p0', 0, 14],
      ['p1', 14, 0],
      ['p2', 0, -14],
      ['p3', -14, 0],
    ];
    for (const [id, x, z] of spots) put(f, id, x, z);
    const ev = run(f, after(5));
    for (const [id] of spots) expect(hurt(ev, id)).toBe(3000);
    expect(fails(ev)).toEqual([]);
    const g = fight(one({ k: 'spread', r: 5, dmg: 3000, count: 'all' }, 5));
    put(g, 'p0', 0, 14);
    put(g, 'p1', 2, 14); // too close to p0
    put(g, 'p2', 0, -14);
    put(g, 'p3', -14, 0);
    const ev2 = run(g, after(5));
    expect(hurt(ev2, 'p0')).toBe(6000);
    expect(new Set(fails(ev2))).toEqual(new Set(['p0', 'p1']));
  });

  it('splits a stack among everyone in it, and hurts more when too few come', () => {
    const f = fight(one({ k: 'stack', r: 4, dmg: 2500, groups: 1 }, 5));
    for (const id of ['p0', 'p1', 'p2', 'p3']) put(f, id, 1, 8);
    const ev = run(f, after(5));
    for (const id of ['p0', 'p1', 'p2', 'p3']) expect(hurt(ev, id)).toBe(2500);
    const g = fight(one({ k: 'stack', r: 4, dmg: 2500, groups: 1 }, 5));
    for (const id of ['p0', 'p1', 'p2', 'p3']) put(g, id, 1, 8);
    put(g, 'p3', -15, 0); // one stays away: whoever the stack is on, two or three share 10,000
    const ev2 = run(g, after(5));
    expect(fails(ev2).length).toBeGreaterThan(0);
    expect(hurt(ev2, 'p0') + hurt(ev2, 'p1') + hurt(ev2, 'p2') + hurt(ev2, 'p3')).toBeGreaterThanOrEqual(10_000);
  });
});

describe('knockbacks', () => {
  it('stops at a wall and drops players off a cliff', () => {
    const f = fight(one({ k: 'knockback', dist: 12 }), { edge: 'wall' });
    put(f, 'p1', 0, 12);
    run(f, after(4, 1));
    expect(f.players.get('p1')!.dead).toBe(false);
    expect(Math.hypot(f.players.get('p1')!.x, f.players.get('p1')!.z)).toBeCloseTo(20 - RULES.playerRadius, 3);
    const g = fight(one({ k: 'knockback', dist: 12 }), { edge: 'cliff' });
    put(g, 'p1', 0, 12);
    put(g, 'p2', 0, 5); // close enough: lands on the edge, alive
    const ev = run(g, after(4, 1));
    expect(g.players.get('p1')!.dead).toBe(true);
    expect(ev.some((e) => e.k === 'fell' && e.i === 'p1')).toBe(true);
    // the body lies at the edge it went over, where a healer can reach it
    expect(Math.hypot(g.players.get('p1')!.x, g.players.get('p1')!.z)).toBeLessThanOrEqual(20 - RULES.playerRadius + 1e-6);
    expect(g.players.get('p2')!.dead).toBe(false);
  });
});

describe('tank busters', () => {
  it('cracks the first tank: with two tanks the second hit must go to the other one', () => {
    const f = fight(one({ k: 'buster', dmg: 6000, hits: 2, gap: 4 }), { jobs: ['guardian', 'berserker', 'priest', 'brawler'] });
    const boss = f.foes[0]!;
    boss.enmity.set('p0', 1e6);
    const ev = run(f, after(4));
    expect(hurt(ev, 'p0')).toBe(6000);
    expect(f.players.get('p0')!.statuses.find((s) => s.id === 'crack')!.until - f.tick).toBeGreaterThan(sec(10));
    // the second tank provokes in time
    boss.enmity.set('p1', 2e6);
    const ev2 = run(f, sec(4));
    expect(hurt(ev2, 'p1')).toBe(6000);
    expect(hurt(ev2, 'p0')).toBe(0);
  });

  it('lets a lone tank take both hits without the crack', () => {
    const f = fight(one({ k: 'buster', dmg: 6000, hits: 2, gap: 4 }), { jobs: ['guardian', 'priest', 'brawler', 'sorcerer'] });
    f.foes[0]!.enmity.set('p0', 1e6);
    const ev = run(f, after(4, 4));
    expect(hurt(ev, 'p0')).toBe(12_000);
  });

  it('hits only once without a tank, at half damage', () => {
    const f = fight(one({ k: 'buster', dmg: 6000, hits: 2, gap: 4 }), { jobs: ['priest', 'brawler', 'sorcerer'] });
    f.foes[0]!.enmity.set('p1', 1e6);
    const ev = run(f, after(4, 4));
    expect(hurt(ev, 'p1')).toBe(3000);
  });
});

describe('Hard penalties', () => {
  it('stacks 易傷: each stack adds 50% damage taken', () => {
    const f = fight(
      [
        { at: 1, name: 'A', cast: 2, mechs: [{ k: 'chariot', r: 10, dmg: 1000 }] },
        { at: 4, name: 'B', cast: 2, mechs: [{ k: 'chariot', r: 10, dmg: 1000 }] },
      ],
      { hard: true },
    );
    put(f, 'p0', 0, 5);
    for (const id of ['p1', 'p2', 'p3']) put(f, id, 0, 15);
    const ev = run(f, sec(7) + 2);
    const hits = ev.filter((e): e is Extract<FightEvent, { k: 'dmg' }> => e.k === 'dmg' && e.t === 'p0' && e.s === 'boss').map((e) => e.a);
    expect(hits).toEqual([1000, 1500]);
    expect(f.players.get('p0')!.statuses.find((s) => s.id === 'vuln')!.v).toBe(2);
  });
});

describe('the rock prison', () => {
  it('holds a player safe and still until broken, and crushes them when time runs out', () => {
    const f = fight(one({ k: 'prison', hp: 1000, time: 15 }, 3));
    run(f, after(3));
    const rock = f.foes.find((e) => e.kind === 'prison')!;
    const held = f.players.get(rock.owner!)!;
    expect(held.statuses.some((s) => s.id === 'stun')).toBe(true);
    expect(f.use(held.id, 0)).toBe('busy');
    expect(f.move(held.id, held.x + 1, held.z, 0, 99_999)).not.toBeNull();
    rock.hp = 0;
    run(f, 2);
    expect(held.statuses.some((s) => s.id === 'stun')).toBe(false);

    const g = fight(one({ k: 'prison', hp: 1000, time: 15 }, 3));
    run(g, after(3));
    const owner = g.foes.find((e) => e.kind === 'prison')!.owner!;
    const ev = run(g, sec(15) + 2);
    expect(g.players.get(owner)!.dead).toBe(true);
    expect(fails(ev)).toContain(owner);
  });
});

describe('phases and adds', () => {
  const phases: Phase[] = [
    { name: '一', hpBelow: 0.6, entries: [{ at: 100, name: '大地震', cast: 4, mechs: [{ k: 'raidwide', dmg: 100 }] }] },
    {
      name: '二',
      untargetable: true,
      untilAddsGone: true,
      entries: [
        {
          at: 0,
          name: '召喚',
          cast: 2,
          mechs: [
            {
              k: 'adds',
              kind: 'golem',
              at: [
                [-5, 0],
                [5, 0],
              ],
              hp: 1000,
              auto: 0,
              time: 20,
              boom: 3000,
              together: true,
            },
          ],
        },
      ],
    },
    { name: '三', entries: [] },
  ];

  it('moves on below 60% HP, hides the boss while the adds live, and goes on when they are gone', () => {
    const f = fight([], { phases });
    const boss = f.foes[0]!;
    boss.hp = Math.floor(boss.maxHp * 0.59);
    run(f, 2);
    expect(f.brain!.phase).toBe(1);
    expect(boss.untargetable).toBe(true);
    expect(f.use('p3', 0, { target: 'boss' })).not.toBe('ok');
    run(f, sec(2) + 2);
    const adds = f.foes.filter((e) => e.kind === 'golem');
    expect(adds).toHaveLength(2);
    for (const a of adds) a.hp = 0;
    run(f, 2);
    expect(f.brain!.phase).toBe(2);
    expect(boss.untargetable).toBe(false);
  });

  it('stands the first add back up unless the other falls within 10 s, and blows up what is left in time', () => {
    const f = fight([], { phases });
    f.foes[0]!.hp = Math.floor(f.foes[0]!.maxHp * 0.5);
    run(f, sec(2) + 4);
    const [a, b] = f.foes.filter((e) => e.kind === 'golem');
    a!.hp = 0;
    const ev = run(f, sec(10) + 2);
    expect(a!.hp).toBe(500);
    expect(ev.some((e) => e.k === 'boss' && e.m === 'revive')).toBe(true);
    const ev2 = run(f, sec(10));
    expect(ev2.filter((e) => e.k === 'boss' && e.n === '自爆')).toHaveLength(2);
    expect(hurt(ev2, 'p1')).toBe(6000);
    expect(b!.gone).toBe(true);
  });
});
