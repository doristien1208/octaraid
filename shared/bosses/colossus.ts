import type { BossScript, Entry } from '../sim/boss';

/**
 * 崩岩巨像 (section 七 of the design doc): the first trial, teaching shapes, cast names, tank busters,
 * stacks and spreads. Normal shows every attack on the ground at least 3 s ahead and asks for one thing at
 * a time; Hard shows them for 2.5 s (the sweep not at all: read the raised arm), swaps tanks on the double
 * buster, and since v0.6 lays them on top of each other: 岩牢震擊 (falling rocks, a knockback off the cliff,
 * and only the prison rock to hide behind: break it after the push, not before), 雙重預告 (strips, the
 * sweep and a stack or a spread, shown for 3 s and then only remembered) and 碎岩連鎖 (spread, move off
 * where you stood, out of the chariot, into the donut). What should have been dodged takes all of a
 * player's HP (`lethal`); the earthquake hits twice.
 *
 * Phases: the opening loop until 60% HP, the boss leaps to the centre and summons two 岩巨兵 (it cannot
 * be hit until they are gone), then the second-half loop until the enrage. Times are when casts start,
 * in seconds from the start of the phase. Damage is for 10,000 HP (healers, DPS) and 14,000 (tanks).
 */
export function colossus(hard: boolean): BossScript {
  const H = <T>(normal: T, hardValue: T): T => (hard ? hardValue : normal);

  // the same cast name is always the same attack (Hard players go by it)
  const quake = (at: number): Entry => ({ at, name: '大地震', cast: 4, mechs: [hard ? { k: 'raidwide', dmg: 4200, hits: 2, gap: 1.5 } : { k: 'raidwide', dmg: 3500 }] });
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
  // Hard (v0.6): the compound casts
  /** a prison, three waves of rocks, then a knockback off the cliff 8 s later: only the rock stops it */
  const prisonPush = (at: number): Entry => ({
    at,
    name: '岩牢震擊',
    cast: 4,
    mechs: [
      // the rock has to stay up for the push, so it is softer than a plain prison
      { k: 'prison', hp: 4500, time: 16 },
      { k: 'rocks', r: 5, dmg: 6000, count: 3, waves: 3, gap: 2 },
      { k: 'knockback', dist: 12, delay: 8 },
    ],
  });
  /** strips, then the sweep, then a stack or a spread: all shown for the first 3 s of the cast only */
  const omen = (at: number): Entry => ({
    at,
    name: '雙重預告',
    cast: 5,
    memo: 3,
    mechs: [
      { k: 'lines', w: 6, dmg: 8000, gap: 2.5, waves: [[-12, 0, 12]] },
      { k: 'later', after: 2.5, mech: { k: 'cone', deg: 120, dmg: 8000 } },
      {
        k: 'later',
        after: 5,
        mech: {
          k: 'either',
          of: [
            { k: 'spread', r: 5, dmg: 4000, count: 'all' },
            { k: 'stack', r: 4, dmg: 4000, groups: 2 },
          ],
        },
      },
    ],
  });
  /** a spread, a rock under everyone 2 s later, out of the chariot, then into the donut */
  const chain = (at: number): Entry => ({
    at,
    name: '碎岩連鎖',
    cast: 4,
    mechs: [
      { k: 'spread', r: 5, dmg: 4000, count: 'all' },
      { k: 'drop', r: 4, dmg: 6000, delay: 2 },
      { k: 'chariot', r: 10, dmg: 9000, delay: 3 },
      { k: 'donut', r0: 8, dmg: 9000, delay: 6 },
    ],
  });

  return {
    kind: 'colossus',
    auto: H(500, 900),
    tele: H(3.5, 2.5),
    hidden: hard ? ['cone'] : [],
    edge: hard ? 'cliff' : 'wall',
    lethal: hard,
    enrage: { name: '天崩地裂', cast: 10 },
    phases: [
      {
        name: '崩岩巨像',
        hpBelow: 0.6,
        entries: hard
          ? [quake(8), fist(18), prisonPush(28), sweep(46), omen(56), chain(70), share(86), outIn(98), quake(110)]
          : [quake(8), fist(18), rocks(28), sweep(42), shards(52), chariot(65), share(74), lines(85), donut(98), quake(110)],
        loop: hard ? { at: 122, to: 18 } : { at: 120, to: 18 },
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
          ? [quake(5), chain(15), sweep(29), fist(39), prisonPush(49), omen(67), share(81), outIn(93), quake(105)]
          : [quake(5), rocks(14), fist(28), donut(38), share(48), lines(59), chariot(70), shards(80), sweep(92), quake(102)],
        loop: hard ? { at: 117, to: 15 } : { at: 112, to: 14 },
      },
    ],
  };
}
