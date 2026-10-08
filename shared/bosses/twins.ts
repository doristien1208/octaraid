import type { BossScript, Entry } from '../sim/boss';

/**
 * 發條城塞 2F：雙子機神 (section 七 of the design doc): the last raid floor, two bosses at once.
 * 熾核 (red) follows the tank; 凍核 (blue) takes no enmity and leaps from one point on the edge to the
 * next on its timeline, so the tank keeps dragging 熾核 to the far side: closer than 15 m, both power up
 * (共鳴). Their HP must stay within 15% (Hard 10%) of each other or a raid-wide comes every 5 s (失衡).
 * The first to fall to 30% stops taking damage; both there, they merge into 雙極機神 for the last part.
 * Hard: the halves without telegraphs (the first boss's weapon glows), three charges in a row, colours
 * that flip during 雙色分攤, the twins trading places before 冰刃迴旋, a protean after the knockback and
 * towers between the fans.
 *
 * Times are when casts start, in seconds from the start of the phase. Damage is for 10,000 HP (healers,
 * DPS) and 14,000 (tanks).
 */
export function twins(hard: boolean): BossScript {
  const H = <T>(normal: T, hardValue: T): T => (hard ? hardValue : normal);
  const edge = 17;
  const spots: [number, number][] = [
    [0, -edge],
    [edge, 0],
    [0, edge],
    [-edge, 0],
  ];

  const busters = (at: number): Entry => ({
    at,
    name: '雙死刑',
    cast: 4,
    by: 'both',
    mechs: [
      { k: 'buster', dmg: H(7000, 11000) },
      { k: 'buster', dmg: H(5000, 8000), rank: 2, src: 'twin' },
    ],
  });
  const halves = (at: number): Entry => ({ at, name: '炎冰交錯', cast: 5, by: 'both', mechs: [{ k: 'halves', gap: 3, dmg: H(5000, 8000) }] });
  const leap = (at: number, k: number): Entry => ({
    at,
    name: '凍核躍遷',
    cast: 3,
    by: 'twin',
    mechs: [{ k: 'jump', to: spots[k % 4]!, land: { r: 6, dmg: H(4000, 7000) }, src: 'twin' }],
  });
  const charge = (at: number): Entry => ({
    at,
    name: '熔核衝撞',
    cast: 4,
    mechs: [{ k: 'charge', count: H(1, 3), w: 6, dmg: H(5000, 4500), gap: 2.5 }],
  });
  const colours = (at: number): Entry => ({
    at,
    name: '雙色分攤',
    cast: 5,
    by: 'both',
    mechs: [{ k: 'colorStack', r: 4, dmg: 3000, swap: hard ? 2 : undefined }],
  });
  const blades = (at: number): Entry => ({
    at,
    name: '冰刃迴旋',
    cast: 5,
    by: 'both',
    mechs: [{ k: 'twinCircles', r: 10, r0: 8, dmg: H(5000, 8000), swap: hard }],
  });
  // merged
  const cannon = (at: number): Entry => ({
    at,
    name: '雙極光砲',
    cast: 5,
    mechs: hard
      ? [
          { k: 'raidwide', dmg: 4500 },
          { k: 'knockback', dist: 12 },
          { k: 'protean', deg: 40, dmg: 3000, delay: 3.5 },
        ]
      : [
          { k: 'raidwide', dmg: 4000 },
          { k: 'knockback', dist: 12 },
        ],
  });
  const fans = (at: number): Entry => ({
    at,
    name: '炎冰八方',
    cast: 5,
    mechs: [{ k: 'fans8', dmg: H(5000, 8000), gap: 3, towers: hard ? { need: 2, r: 3, dmg: 3000, fail: 8000 } : undefined }],
  });
  const smash = (at: number): Entry => ({
    at,
    name: '雙極重擊',
    cast: 4,
    mechs: [hard ? { k: 'buster', dmg: 10000, hits: 2, gap: 4 } : { k: 'buster', dmg: 7500 }],
  });

  return {
    kind: 'ember',
    auto: H(500, 900),
    tele: H(3.5, 2.5),
    hidden: hard ? ['halves'] : [],
    edge: 'wall',
    enrage: { name: '終焉砲', cast: 10 },
    twin: {
      kind: 'frost',
      at: spots[0]!,
      resonance: { dist: 15, every: 5 },
      imbalance: { gap: H(0.15, 0.1), every: 5, dmg: H(2000, 3500) },
      fuse: { at: 0.3, kind: 'bipolar' },
    },
    phases: [
      {
        name: '熾核與凍核',
        untilFused: true,
        entries: hard
          ? [busters(6), halves(16), leap(30, 1), charge(40), colours(56), blades(68), leap(80, 2), busters(90), halves(100), leap(114, 3), charge(124), colours(140), blades(152), leap(164, 0)]
          : [busters(6), halves(16), leap(30, 1), charge(40), colours(52), blades(64), leap(76, 2), busters(86), halves(96), leap(110, 3), charge(120), colours(132), blades(144), leap(156, 0)],
        loop: hard ? { at: 174, to: 6 } : { at: 166, to: 6 },
      },
      {
        name: '雙極機神',
        entries: hard ? [cannon(5), fans(20), smash(34), cannon(46), fans(60)] : [cannon(5), fans(18), smash(32), cannon(44), fans(56)],
        loop: hard ? { at: 74, to: 20 } : { at: 70, to: 18 },
      },
    ],
  };
}
