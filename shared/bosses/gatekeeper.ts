import type { BossScript, Entry } from '../sim/boss';

/**
 * 發條城塞 1F：守門機兵 (section 七 of the design doc): the first raid floor, teaching tank swaps,
 * timed bombs, protean fans and the live floor. A 6 × 6 floor of 6 m tiles that light up in a
 * checkerboard; the guard walks after the tank. At 50% it overheats, backs off to the north wall and
 * sends two drones that shoot down a line at someone; break them and it comes back. Hard: the armour-
 * piercing shot hits twice (swap tanks), the floor gives 1.5 s and switches pattern, bombs on everyone
 * with the floor at the same time, a chariot right after the protean, two sweeping beams, numbered
 * shots, and the drones leave pools where they hit.
 *
 * Times are when casts start, in seconds from the start of the phase. Damage is for 10,000 HP (healers,
 * DPS) and 14,000 (tanks).
 */
export function gatekeeper(hard: boolean): BossScript {
  const H = <T>(normal: T, hardValue: T): T => (hard ? hardValue : normal);

  const pulse = (at: number): Entry => ({ at, name: '過載脈衝', cast: 4, mechs: [{ k: 'raidwide', dmg: H(3500, 6500) }] });
  const pierce = (at: number): Entry => ({
    at,
    name: '穿甲彈',
    cast: 4,
    mechs: [hard ? { k: 'buster', dmg: 14000, hits: 2, gap: 4 } : { k: 'buster', dmg: 6500 }],
  });
  const drill = (at: number): Entry => ({ at, name: '雙重鑽擊', cast: 4, mechs: [{ k: 'drill', n: 2, r: 3, dmg: H(5000, 8000), apart: hard }] });
  const lasers = (at: number): Entry => ({
    at,
    name: '八方雷射',
    cast: 5,
    mechs: hard
      ? [
          { k: 'protean', deg: 40, dmg: 5000 },
          { k: 'chariot', r: 9, dmg: 8000, delay: 1.5 },
        ]
      : [{ k: 'protean', deg: 40, dmg: 4000 }],
  });
  const floor = (at: number, first: 0 | 1): Entry => ({
    at,
    name: '地板通電',
    cast: 3,
    mechs: [hard ? { k: 'tiles', patterns: [first, first === 0 ? 1 : 0], gap: 3, dmg: 8000, tele: 1.5 } : { k: 'tiles', patterns: [first], gap: 3, dmg: 5000, tele: 3 }],
  });
  const bombs = (at: number): Entry => ({
    at,
    name: '定時炸彈',
    cast: 4,
    mechs: hard
      ? [
          { k: 'bombs', at: [10, 20, 30], count: 'all', r: 8, dmg: 7000, self: 3000 },
          { k: 'tiles', patterns: [0, 1], gap: 3, dmg: 8000, tele: 1.5 },
        ]
      : [{ k: 'bombs', at: [10, 20], count: 2, r: 8, dmg: 5000, self: 2000 }],
  });
  const sweep = (at: number): Entry => ({
    at,
    name: '掃描光束',
    cast: 4,
    mechs: [hard ? { k: 'sweep', beams: 2, deg: 22, turn: 180, time: 6, dmg: 8000 } : { k: 'sweep', beams: 1, deg: 22, turn: 360, time: 9, dmg: 5000 }],
  });
  const sequence = (at: number): Entry => ({ at, name: '序列點名', cast: 4, mechs: [{ k: 'sequence', count: 'all', w: 4, gap: 1.5, dmg: 4000 }] });

  return {
    kind: 'gatekeeper',
    auto: H(500, 900),
    tele: H(3.5, 2.5),
    hidden: hard ? ['protean'] : [],
    edge: 'wall',
    enrage: { name: '全開火', cast: 10 },
    phases: [
      {
        name: '守門機兵',
        hpBelow: 0.5,
        entries: hard
          ? [pulse(8), pierce(18), floor(32, 0), lasers(44), sequence(56), drill(70), bombs(80), sweep(118), pulse(132)]
          : [pulse(8), pierce(18), floor(28, 0), lasers(40), drill(52), bombs(62), sweep(90), pulse(104), pierce(114)],
        loop: hard ? { at: 142, to: 18 } : { at: 124, to: 28 },
      },
      {
        name: '過熱',
        untargetable: true,
        untilAddsGone: true,
        home: [0, -14],
        entries: [
          {
            at: 0,
            name: '緊急散熱',
            cast: 3,
            mechs: [
              { k: 'jump', to: [0, -15] },
              {
                k: 'adds',
                kind: 'drone',
                at: [
                  [-10, 4],
                  [10, 4],
                ],
                hp: H(45000, 35000),
                auto: 0,
                time: H(60, 45),
                boom: H(6000, 99999),
                attack: hard
                  ? { k: 'shot', w: 4, dmg: 3500, every: 8, first: 3, puddle: { r: 4, dmg: 1500, time: 20 } }
                  : { k: 'shot', w: 4, dmg: 2500, every: 7, first: 3 },
              },
            ],
          },
          // overheated, it only vents once (Normal): on Hard the drones are trouble enough
          ...(hard ? [] : [pulse(25)]),
        ],
      },
      {
        name: '守門機兵（後半）',
        entries: [
          { at: 0, name: '重新啟動', cast: 2, mechs: [{ k: 'jump', to: [0, 0] }] },
          ...(hard
            ? [pulse(5), sequence(15), pierce(30), sweep(44), bombs(60), lasers(98), drill(110), pulse(120)]
            : [pulse(5), sweep(15), pierce(32), bombs(42), floor(68, 1), lasers(80), drill(92), pulse(102)]),
        ],
        loop: hard ? { at: 130, to: 15 } : { at: 112, to: 15 },
      },
    ],
  };
}
