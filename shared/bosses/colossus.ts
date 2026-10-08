import type { BossScript, Entry } from '../sim/boss';

/**
 * 崩岩巨像 (section 七 of the design doc): the first trial, teaching shapes, cast names, tank busters,
 * stacks and spreads. Normal shows every attack on the ground at least 3 s ahead and asks for one thing at
 * a time; Hard shows them for 2.5 s (the sweep not at all: read the raised arm), pairs them up, swaps
 * tanks on the double buster, adds knockbacks off the cliff and the rock prison.
 *
 * Phases: the opening loop until 60% HP, the boss leaps to the centre and summons two 岩巨兵 (it cannot
 * be hit until they are gone), then the second-half loop until the enrage. Times are when casts start,
 * in seconds from the start of the phase. Damage is for 10,000 HP (healers, DPS) and 14,000 (tanks).
 */
export function colossus(hard: boolean): BossScript {
  const H = <T>(normal: T, hardValue: T): T => (hard ? hardValue : normal);

  // the same cast name is always the same attack (Hard players go by it)
  const quake = (at: number): Entry => ({ at, name: '大地震', cast: 4, mechs: [{ k: 'raidwide', dmg: H(3500, 6500) }] });
  const fist = (at: number): Entry => ({
    at,
    name: '粉碎重拳',
    cast: 4,
    mechs: [hard ? { k: 'buster', dmg: 15000, hits: 2, gap: 4 } : { k: 'buster', dmg: 7000 }],
  });
  const rocks = (at: number): Entry => ({
    at,
    name: hard ? '落石震地' : '落石',
    cast: H(3, 4),
    mechs: hard
      ? [
          { k: 'rocks', r: 5, dmg: 6000, count: 4, waves: 3, gap: 2, nearBoss: 1 },
          { k: 'knockback', dist: 12 },
        ]
      : [{ k: 'rocks', r: 6, dmg: 3000, count: 3, waves: 3, gap: 2 }],
  });
  const sweep = (at: number): Entry => ({ at, name: '岩拳橫掃', cast: H(4, 3), mechs: [{ k: 'cone', deg: 120, dmg: H(4000, 8000) }] });
  const shards = (at: number): Entry =>
    hard
      ? {
          at,
          name: '碎岩崩落',
          cast: 4,
          mechs: [
            { k: 'spread', r: 5, dmg: 4000, count: 'all' },
            { k: 'chariot', r: 10, dmg: 9000 },
          ],
        }
      : { at, name: '碎岩彈', cast: 5, mechs: [{ k: 'spread', r: 5, dmg: 3000, count: 2 }] };
  const chariot = (at: number): Entry => ({ at, name: '岩山崩落', cast: 5, mechs: [{ k: 'chariot', r: 10, dmg: 5000 }] });
  const share = (at: number): Entry =>
    hard
      ? {
          at,
          name: '共擔環震',
          cast: 4,
          mechs: [
            { k: 'stack', r: 4, dmg: 4000, groups: 2 },
            { k: 'donut', r0: 10, dmg: 9000 },
          ],
        }
      : { at, name: '共擔落岩', cast: 5, mechs: [{ k: 'stack', r: 4, dmg: 2500, groups: 1 }] };
  const lines = (at: number): Entry => ({
    at,
    name: '地裂線',
    cast: H(4, 3),
    mechs: [
      hard
        ? { k: 'lines', w: 6, dmg: 8000, gap: 2.5, waves: [[-12, 0, 12], [-6, 6]] }
        : { k: 'lines', w: 6, dmg: 4000, gap: 2.5, waves: [[-12, 0, 12]] },
    ],
  });
  const donut = (at: number): Entry => ({ at, name: '岩環震', cast: 5, mechs: [{ k: 'donut', r0: 8, dmg: 5000 }] });
  // Hard: out, then in
  const outIn = (at: number): Entry => ({
    at,
    name: '崩落環震',
    cast: 4,
    mechs: [
      { k: 'chariot', r: 10, dmg: 9000 },
      { k: 'donut', r0: 8, dmg: 9000, delay: 3 },
    ],
  });
  const prison = (at: number): Entry => ({ at, name: '岩牢', cast: 3, mechs: [{ k: 'prison', hp: 8000, time: 15 }] });

  return {
    kind: 'colossus',
    auto: H(500, 900),
    tele: H(3.5, 2.5),
    hidden: hard ? ['cone'] : [],
    edge: hard ? 'cliff' : 'wall',
    enrage: { name: '天崩地裂', cast: 10 },
    phases: [
      {
        name: '崩岩巨像',
        hpBelow: 0.6,
        entries: hard
          ? [quake(8), fist(18), rocks(32), sweep(48), shards(58), share(74), lines(88), outIn(102), prison(116), quake(128)]
          : [quake(8), fist(18), rocks(28), sweep(42), shards(52), chariot(65), share(74), lines(85), donut(98), quake(110)],
        loop: hard ? { at: 140, to: 18 } : { at: 120, to: 18 },
      },
      {
        name: '岩巨兵',
        untargetable: true,
        untilAddsGone: true,
        entries: [
          {
            at: 0,
            name: '岩崩召喚',
            cast: 3,
            mechs: [
              { k: 'jump' },
              {
                k: 'adds',
                kind: 'golem',
                at: [
                  [-9, 2],
                  [9, 2],
                ],
                hp: H(40000, 45000),
                auto: H(400, 800),
                time: H(40, 35),
                boom: H(5000, 99999),
                together: hard,
              },
            ],
          },
        ],
      },
      {
        name: '崩岩巨像（後半）',
        entries: hard
          ? [quake(5), shards(15), fist(30), rocks(44), share(60), lines(74), outIn(88), prison(102), sweep(114), quake(124)]
          : [quake(5), rocks(14), fist(28), donut(38), share(48), lines(59), chariot(70), shards(80), sweep(92), quake(102)],
        loop: hard ? { at: 136, to: 15 } : { at: 112, to: 14 },
      },
    ],
  };
}
