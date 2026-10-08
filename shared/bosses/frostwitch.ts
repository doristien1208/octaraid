import type { BossScript, Entry } from '../sim/boss';

/**
 * 霜冠魔女 (section 七 of the design doc): the second trial, teaching tethers, towers, exaflares and
 * line of sight. She floats after the tank, who drags her where the party wants her. At 65% she leaves
 * her ice mirrors to fight (they fire fans in front of them) and cannot be hit until they break; below
 * 35% she pairs her attacks up. Hard: a shared tank buster, two tethers with a spread, the freeze check,
 * 6 exaflare lanes with a spread, two people per tower, and line of sight that kills and shatters every
 * pillar someone hid behind (use as few as will hold the party: there are only 4).
 *
 * Times are when casts start, in seconds from the start of the phase. Damage is for 10,000 HP (healers,
 * DPS) and 14,000 (tanks).
 */
export function frostwitch(hard: boolean): BossScript {
  const H = <T>(normal: T, hardValue: T): T => (hard ? hardValue : normal);

  const storm = (at: number): Entry => ({ at, name: '冰晶風暴', cast: 4, mechs: [{ k: 'raidwide', dmg: H(3500, 6500) }] });
  const lance = (at: number): Entry => ({
    at,
    name: '冰槍',
    cast: 4,
    mechs: [hard ? { k: 'stack', on: 'top', want: 2, r: 3, dmg: 6000, groups: 1 } : { k: 'buster', dmg: 7000 }],
  });
  const chains = (at: number): Entry => ({
    at,
    name: '寒冰鎖鏈',
    cast: H(5, 4),
    mechs: hard
      ? [
          { k: 'tether', pairs: 2, dist: 15, dmg: 9000 },
          { k: 'spread', r: 4, dmg: 3000, count: 'all' },
        ]
      : [{ k: 'tether', pairs: 1, dist: 15, dmg: 6000 }],
  });
  const towers = (at: number): Entry => ({
    at,
    name: '冰柱塔',
    cast: 5,
    mechs: [{ k: 'tower', count: 2, need: H(1, 2), r: 3, dmg: H(2000, 3000), fail: H(6000, 9000), ring: 11 }],
  });
  const flares = (at: number): Entry => ({
    at,
    name: '冰晶地火',
    cast: 4,
    mechs: hard
      ? [
          { k: 'exaflare', lanes: 6, r: 3.5, step: 4, gap: 1.2, dmg: 6000 },
          { k: 'spread', r: 4, dmg: 3000, count: 'all' },
        ]
      : [{ k: 'exaflare', lanes: 4, r: 5, step: 5, gap: 1.5, dmg: 4000 }],
  });
  // she glides to the middle first, so every pillar casts a shadow straight out from it
  const zero = (at: number): Entry => ({
    at,
    name: '絕對零度',
    cast: H(6, 5),
    mechs: [
      { k: 'jump', to: [0, 0] },
      hard ? { k: 'los', dmg: 0, kill: true, shatter: true } : { k: 'los', dmg: 9000 },
    ],
  });
  const freeze = (at: number): Entry => ({
    at,
    name: '深度凍結',
    cast: 4,
    mechs: [{ k: 'freeze', time: 4, drop: { r: 4, dmg: 6000, delay: 2.5 } }],
  });
  // 35% and below: two attacks at once
  const frostFlares = (at: number): Entry => ({
    at,
    name: '霜華地火',
    cast: 4,
    mechs: hard
      ? [
          { k: 'exaflare', lanes: 6, r: 3.5, step: 4, gap: 1.2, dmg: 6000 },
          { k: 'spread', r: 4, dmg: 3000, count: 'all' },
        ]
      : [
          { k: 'exaflare', lanes: 4, r: 5, step: 5, gap: 1.5, dmg: 4000 },
          { k: 'spread', r: 4, dmg: 2500, count: 2 },
        ],
  });
  const chainedTowers = (at: number): Entry => ({
    at,
    name: '冰封連鎖',
    cast: 5,
    mechs: [
      { k: 'tether', pairs: 1, dist: 15, dmg: H(6000, 9000) },
      { k: 'tower', count: 2, need: H(1, 2), r: 3, dmg: H(2000, 3000), fail: H(6000, 9000), ring: 11 },
    ],
  });

  return {
    kind: 'frostwitch',
    auto: H(500, 900),
    tele: H(3.5, 2.5),
    hidden: hard ? ['los'] : [],
    edge: 'wall',
    enrage: { name: '永凍之冬', cast: 10 },
    phases: [
      {
        name: '霜冠魔女',
        hpBelow: 0.65,
        entries: hard
          ? [storm(8), lance(18), chains(30), freeze(44), flares(56), towers(74), zero(86), storm(100), lance(110)]
          : [storm(8), lance(18), chains(28), flares(42), towers(60), zero(72), storm(86), lance(96)],
        loop: hard ? { at: 120, to: 30 } : { at: 106, to: 28 },
      },
      {
        name: '冰鏡分身',
        untargetable: true,
        untilAddsGone: true,
        entries: [
          {
            at: 0,
            name: '冰鏡分身',
            cast: 3,
            mechs: [
              { k: 'jump', to: [0, 0] },
              {
                k: 'adds',
                kind: 'mirror',
                at: hard
                  ? [
                      [0, -12],
                      [10.4, 6],
                      [-10.4, 6],
                    ]
                  : [
                      [-12, 0],
                      [12, 0],
                    ],
                hp: H(50000, 32000),
                auto: 0,
                time: H(60, 50),
                boom: H(6000, 99999),
                attack: { k: 'cone', deg: 70, r: 32, dmg: H(5000, 8000), every: 9, first: 5 },
              },
            ],
          },
          storm(25),
        ],
      },
      {
        name: '霜冠魔女（後半）',
        hpBelow: 0.35,
        entries: hard
          ? [storm(5), chains(15), towers(30), lance(44), freeze(54), zero(68), flares(82), storm(100)]
          : [storm(5), towers(15), flares(28), lance(46), chains(56), zero(68), storm(82)],
        loop: hard ? { at: 110, to: 15 } : { at: 92, to: 15 },
      },
      {
        name: '霜冠魔女（終盤）',
        entries: hard
          ? [storm(5), chainedTowers(15), freeze(30), lance(44), frostFlares(54), storm(72)]
          : [storm(5), frostFlares(15), lance(32), chainedTowers(42), zero(58), storm(72)],
        loop: { at: 82, to: 15 },
      },
    ],
  };
}
