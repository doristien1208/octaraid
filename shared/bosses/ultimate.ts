import type { BossScript, Entry } from '../sim/boss';

/**
 * 時律機神殿 (the ultimate, v0.7; section 四 of the planning tab "v0.6 起規劃"): one difficulty, 絕. Its
 * stages come one after another, each with its own bosses, timeline and enrage; a wipe starts again from P1
 * (offline practice can start from any stage). v0.7 has P1, the 數字裁斷 intermission and P2; v0.8 adds
 * 時間停止, P3 and P4 (and re-divides the HP).
 *
 * P1 水銀核心: the core shares its HP with 水銀之手 (keep them within 5%: 痛苦之手), the tank drags the core to
 * its hand or away from it (合掌 / 握拳), 流體揮擊 leaves 水抗降低 (swap, or an invulnerability), two dolls
 * walk after the players they marked (bring them below 25%, then into a boss), orbs drift to where the core
 * stood (栓塞), two players must be healed to full (窒息).
 * 數字裁斷: 凍核 cannot be hurt; it charges through everyone in the order of the numbers over their heads
 * while two opposite blasts go round the edge (鷹爆): take your number from your own side, inside the blasts.
 * P2 熾核與凍核: marks passed by touch (判決傳遞) that must end on the right people (宣判), stacks passed on
 * (壓縮水 3 or more, 壓縮雷 exactly 2), an ice block to hide behind (螺旋槳風), rings for exactly 2 (點數環),
 * 凍核's shield that only breaks from the front (電漿護盾); both must fall within 15 s of each other.
 * 時間停止 (v0.8): 時律機神 stops time; a tied pair must end within 5 m (拘束), one player must not be hit
 * (加重), then images of 熾核 and 凍核 strike the 2 and 3 nearest to them.
 * P3 時律機神: four magic busters in a row (懲戒與聖槍), 起源陣 (電漿球 floors that must not overlap,
 * 審判晶石 dropped where 時之鳥 will fly: all of them touched gives 時之鑰 for P4's 未來視), 起源 (it leaps
 * where the bird set off: a cross and a stack), 時隙陣 (numbered steps into two rifts in turn), and at the
 * end 召喚機神: 凍核 then 熾核 come back with a damage check each while it cannot be hurt.
 * P4 時律機神・終式: 終焉之言 (pulled to the light or pushed from the dark, into the safe ring), 靜止命令 and
 * 行動命令, 處刑命令, 全能審判 (squares seen now, striking later in the same order), 命運校準 α and β
 * (seen now by a party holding 時之鑰, happening later unmarked), 輝耀聖禮 and the cages of 時間牢獄.
 *
 * Times are when casts start, in seconds from the start of the stage. Damage is for 10,000 HP (healers,
 * DPS) and 14,000 (tanks); what should have been dodged takes all of a player's HP (`lethal`).
 */
export function ultimate(): BossScript {
  // ------------------------------------------------------------ P1 水銀核心
  const HAND: [number, number] = [0, -12];
  const swing = (at: number): Entry => ({ at, name: '流體揮擊', cast: 3, mechs: [{ k: 'buster', dmg: 8000, soak: 30 }] });
  const cascade = (at: number): Entry => ({
    at,
    name: '漩渦',
    cast: 4,
    mechs: [
      { k: 'raidwide', dmg: 3000 },
      { k: 'quadrants', dmg: 4000, time: 8 },
    ],
  });
  const wave = (at: number): Entry => ({ at, name: '擴散波', cast: 4, mechs: [{ k: 'protean', deg: 30, dmg: 3500, again: 2 }] });
  const hand = (at: number): Entry => ({
    at,
    name: '水銀之手',
    cast: 6,
    by: 'twin',
    mechs: [
      {
        k: 'either',
        names: ['合掌', '握拳'],
        of: [
          { k: 'pose', near: true, dist: 8, dmg: 999_999 },
          { k: 'pose', near: false, dist: 15, dmg: 999_999 },
        ],
      },
    ],
  });
  const pain = (at: number): Entry => ({ at, name: '痛苦之手', cast: 3, by: 'twin', mechs: [{ k: 'balance', gap: 0.05, dmg: 999_999 }] });
  const dolls = (at: number): Entry => ({
    at,
    name: '獵殺人偶',
    cast: 3,
    mechs: [
      {
        k: 'adds',
        kind: 'doll',
        at: [
          [-17, 10],
          [17, 10],
        ],
        hp: 26_000,
        auto: 500,
        time: 45,
        boom: 999_999,
        onPlayers: true,
        floor: true,
        feed: { pct: 0.25, dmg: 1500, fail: 999_999 },
        attack: { k: 'exhaust', r: 4, dmg: 2500, every: 9, first: 6 },
      },
    ],
  });
  const embolus = (at: number): Entry => ({ at, name: '栓塞', cast: 3, mechs: [{ k: 'embolus', count: 2, r: 2.5, step: 2, gap: 1.2, dmg: 6000 }] });
  const throttle = (at: number): Entry => ({ at, name: '窒息', cast: 3, mechs: [{ k: 'throttle', count: 1, time: 15 }] });

  const p1: BossScript = {
    kind: 'liquid',
    auto: 900,
    tele: 2.5,
    edge: 'wall',
    lethal: true,
    enrage: { name: '終焉漩渦', cast: 10 },
    twin: { kind: 'hand', at: HAND, share: 0.5 },
    phases: [
      {
        name: 'P1：水銀核心',
        home: [0, -1],
        // 窒息 gets a window with nothing else to heal (only the tank's buster): the healer's to win or lose
        entries: [
          swing(2),
          cascade(7),
          wave(14),
          hand(21),
          pain(27),
          swing(28), // 26 s after the first: inside its 水抗降低
          dolls(36),
          embolus(46),
          pain(57),
          throttle(62),
          swing(66),
          hand(72),
          wave(82),
          pain(87),
          cascade(92),
          swing(104),
          embolus(110),
          pain(117),
          throttle(120),
          hand(126),
          wave(140),
          swing(143),
          pain(147),
        ],
      },
    ],
  };

  // ------------------------------------------------------------ 數字裁斷
  const cut: BossScript = {
    kind: 'frost',
    auto: 0,
    tele: 2.5,
    edge: 'wall',
    lethal: true,
    enrage: { name: '絕對零度', cast: 10 },
    phases: [
      {
        name: '數字裁斷',
        untargetable: true,
        entries: [
          { at: 1, name: '數字裁斷', cast: 4, mechs: [{ k: 'charge', count: 8, w: 6, dmg: 5000, gap: 2.6 }] },
          { at: 3, name: '鷹爆', cast: 3, mechs: [{ k: 'rotor', r: 8, dist: 18, steps: 12, gap: 2, turn: 45, dmg: 7000, tele: 1.5 }] },
        ],
      },
    ],
  };

  // ------------------------------------------------------------ P2 熾核與凍核
  const FROST: [number, number] = [0, -14];
  const kick = (at: number): Entry => ({ at, name: '凍核踢擊', cast: 4, by: 'twin', mechs: [{ k: 'raidwide', dmg: 3000, hits: 2, gap: 1.5, src: 'twin' }] });
  const busters = (at: number): Entry => ({
    at,
    name: '雙死刑',
    cast: 4,
    by: 'both',
    mechs: [
      { k: 'buster', dmg: 9000 },
      { k: 'buster', dmg: 6000, rank: 2, src: 'twin' },
    ],
  });
  const sight = (at: number): Entry => ({ at, name: '光學瞄準', cast: 4, by: 'twin', mechs: [{ k: 'drop', r: 3, dmg: 6000, delay: 1, src: 'twin' }] });
  const jump = (at: number): Entry => ({ at, name: '超級跳躍', cast: 5, mechs: [{ k: 'superjump', r: 5, dmg: 6000, beam: { w: 8, time: 5 } }] });
  const ice = (at: number): Entry => ({ at, name: '冰導彈', cast: 3, by: 'twin', mechs: [{ k: 'iceblock', time: 22, src: 'twin' }] });
  const wind = (at: number): Entry => ({ at, name: '螺旋槳風', cast: 6, mechs: [{ k: 'los', dmg: 999_999, kill: true }] });
  const rings = (at: number): Entry => ({
    at,
    name: '點數環',
    cast: 5,
    mechs: [
      { k: 'drill', n: 2, r: 3, dmg: 5000, far: true },
      { k: 'later', after: 3, mech: { k: 'tower', count: 2, need: 2, r: 3, dmg: 1000, fail: 999_999, exact: true } },
    ],
  });
  const plasma = (at: number): Entry => ({
    at,
    name: '電漿護盾',
    cast: 3,
    by: 'both',
    mechs: [
      { k: 'plasma', hp: 10_000, time: 8, dmg: 999_999, src: 'twin' },
      { k: 'later', after: 2, mech: { k: 'cone', deg: 60, dmg: 6000, top: true } },
    ],
  });

  const p2: BossScript = {
    kind: 'ember',
    auto: 700,
    tele: 2.5,
    hidden: ['drop'],
    edge: 'wall',
    lethal: true,
    enrage: { name: '雙核終焉', cast: 10 },
    twin: { kind: 'frost', at: FROST, share: 0.5, together: 15 },
    phases: [
      {
        name: 'P2：熾核與凍核',
        home: [0, -3],
        entries: [
          kick(8),
          { at: 13, name: '判決傳遞', cast: 3, by: 'twin', mechs: [{ k: 'nisi', check: 42, dot: 100, src: 'twin' }] },
          { at: 18, name: '壓縮水雷', cast: 3, mechs: [{ k: 'compressed', rounds: 2, gap: 5, dmg: 3600 }] },
          sight(40),
          busters(46),
          jump(56),
          ice(66),
          wind(71),
          rings(82),
          plasma(94),
          kick(104),
          busters(112),
          sight(120),
          jump(128),
          rings(140),
          ice(150),
          wind(155),
          plasma(166),
          kick(176),
        ],
      },
    ],
  };

  // ------------------------------------------------------------ 時間停止 (v0.8)
  const stop: BossScript = {
    kind: 'prime',
    auto: 0,
    tele: 2.5,
    edge: 'wall',
    lethal: true,
    enrage: { name: '時間停止', cast: 10 },
    phases: [
      {
        name: '時間停止',
        untargetable: true,
        entries: [
          {
            at: 1,
            name: '時間停止',
            cast: 8,
            mechs: [
              {
                k: 'stasis',
                bind: 5,
                apart: 25,
                near: [2, 3],
                dmg: 4000,
                freeze: 3,
                at: [
                  [-10, -6],
                  [10, -6],
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  // ------------------------------------------------------------ P3 時律機神 (v0.8)
  const holy = (at: number, hits = 1): Entry => ({ at, name: '大聖光', cast: 4, mechs: [{ k: 'raidwide', dmg: hits > 1 ? 3800 : 5200, hits, gap: 1.5 }] });
  const spear = (at: number): Entry => ({ at, name: '懲戒與聖槍', cast: 4, mechs: [{ k: 'buster', dmg: 4200, hits: 4, gap: 1.2, noCrack: true }] });
  const inception = (at: number): Entry => ({
    at,
    name: '起源陣',
    cast: 4,
    mechs: [
      {
        k: 'inception',
        spheres: 2,
        sphere: { r: 5, dmg: 4000, after: 9, pool: { r: 5, dmg: 3000, time: 12 } },
        crystal: { r: 1.2, after: 3 },
        bird: 2.5,
      },
    ],
  });
  const origin = (at: number): Entry => ({
    at,
    name: '起源',
    cast: 5,
    mechs: [
      { k: 'jump', to: 'mark' },
      { k: 'cross', w: 7, dmg: 7000 },
      { k: 'stack', r: 4, dmg: 4000, groups: 1 },
    ],
  });
  const wormhole = (at: number): Entry => ({ at, name: '時隙陣', cast: 4, mechs: [{ k: 'wormhole', steps: 4, gap: 4, first: 5, r: 4, dist: 9 }] });
  const sacrament = (at: number): Entry => ({ at, name: '十字聖禮', cast: 4, mechs: [{ k: 'cross', w: 7, dmg: 7000 }] });
  const summon = (kind: 'frost' | 'ember'): Entry => ({
    at: 1,
    name: '召喚機神',
    cast: 3,
    mechs: [{ k: 'adds', kind, at: [[0, -9]], hp: 70_000, auto: 0, time: 28, boom: 999_999, bar: `${kind === 'frost' ? '凍核' : '熾核'}過載` }],
  });

  const p3: BossScript = {
    kind: 'prime',
    auto: 900,
    tele: 2.5,
    edge: 'wall',
    lethal: true,
    enrage: { name: '時律裁決', cast: 10 },
    phases: [
      {
        name: 'P3：時律機神',
        hpBelow: 0.22,
        home: [0, 2],
        entries: [
          holy(4),
          spear(12),
          inception(20),
          origin(40),
          holy(50),
          spear(58),
          wormhole(66),
          sacrament(88),
          holy(94, 2),
          spear(98),
          sacrament(106),
          holy(114),
        ],
        loop: { at: 122, to: 50 },
      },
      { name: '召喚機神：凍核', untargetable: true, untilAddsGone: true, entries: [summon('frost')] },
      { name: '召喚機神：熾核', untargetable: true, untilAddsGone: true, entries: [summon('ember')] },
      { name: 'P3：時律機神（終盤）', home: [0, 2], entries: [holy(2), spear(10), sacrament(18), holy(26, 2), spear(34)], loop: { at: 42, to: 2 } },
    ],
  };

  // ------------------------------------------------------------ P4 時律機神・終式 (v0.8)
  const word = (at: number): Entry => ({
    at,
    name: '終焉之言',
    cast: 4,
    mechs: [
      { k: 'beacons', dist: 10, delay: 6, at: 12 },
      { k: 'later', after: 6.6, mech: { k: 'donut', r0: 6, dmg: 7000 } },
    ],
  });
  const orders = (at: number): Entry => ({
    at,
    name: '命令',
    cast: 4,
    mechs: [
      {
        k: 'either',
        names: ['靜止命令', '行動命令'],
        of: [
          { k: 'order', move: false, dmg: 8000, then: 4 },
          { k: 'order', move: true, dmg: 8000, then: 4 },
        ],
      },
    ],
  });
  const sight2 = (at: number): Entry => ({
    at,
    name: '光學瞄準',
    cast: 4,
    mechs: [
      {
        k: 'either',
        names: ['光學瞄準：分散', '光學瞄準：分攤'],
        of: [
          { k: 'spread', r: 5, dmg: 4000, count: 'all' },
          { k: 'stack', r: 4, dmg: 4000, groups: 2 },
        ],
      },
    ],
  });
  const punish = (at: number): Entry => ({
    at,
    name: '處刑命令',
    cast: 4,
    mechs: [
      { k: 'buster', dmg: 5000, hits: 3, gap: 1.5 },
      { k: 'drill', n: 1, r: 4, dmg: 4500, far: true },
    ],
  });
  const judgment = (at: number): Entry => ({
    at,
    name: '全能審判',
    cast: 5,
    mechs: [
      { k: 'judgment', rounds: 3, per: 3, gap: 1.6, delay: 12, cell: 12, dmg: 7000 },
      { k: 'later', after: 12, mech: { k: 'stack', r: 4, dmg: 4000, groups: 1 } },
    ],
  });
  const fateA = (at: number): Entry => ({
    at,
    name: '命運校準 α',
    cast: 5,
    mechs: [
      {
        k: 'foresee',
        delay: 14,
        mechs: [
          { k: 'lasers', count: 3, of: 4, w: 11, dmg: 7000 },
          { k: 'stack', r: 4, dmg: 4000, groups: 1 },
        ],
      },
    ],
  });
  const fateB = (at: number): Entry => ({
    at,
    name: '命運校準 β',
    cast: 5,
    mechs: [
      {
        k: 'foresee',
        delay: 14,
        mechs: [
          {
            k: 'either',
            of: [
              { k: 'order', move: false, dmg: 8000 },
              { k: 'order', move: true, dmg: 8000 },
            ],
          },
          { k: 'tether', pairs: 1, dist: 14, dmg: 6000 },
          { k: 'chariot', r: 9, dmg: 7000 },
        ],
      },
    ],
  });
  const radiant = (at: number): Entry => ({ at, name: '輝耀聖禮', cast: 4, mechs: [{ k: 'donut', r0: 5, dmg: 8000 }] });
  const prison = (at: number): Entry => ({ at, name: '時間牢獄', cast: 4, mechs: [{ k: 'cages', count: 4, gap: 2.5, r: 3, dist: 12 }] });

  const p4: BossScript = {
    kind: 'perfect',
    auto: 900,
    tele: 2.5,
    edge: 'wall',
    lethal: true,
    enrage: { name: '時間牢獄・終焉', cast: 10 },
    phases: [
      {
        name: 'P4：時律機神・終式',
        home: [0, 0],
        entries: [
          holy(4),
          word(12),
          orders(28),
          sight2(40),
          punish(48),
          judgment(58),
          holy(84, 2),
          fateA(92),
          punish(115),
          fateB(124),
          radiant(148),
          holy(156),
          word(164),
          judgment(178),
          radiant(200),
          prison(206),
        ],
      },
    ],
  };

  return {
    kind: 'liquid',
    auto: 0,
    tele: 2.5,
    edge: 'wall',
    lethal: true,
    enrage: { name: '終焉漩渦', cast: 10 },
    phases: [],
    // the duty's HP shared out: P1 and P2 as in v0.7, then P3 and P4
    stages: [
      { script: p1, hp: 0.2045, enrageAt: 165 },
      { script: cut, hp: 0, time: 32 },
      { script: p2, hp: 0.25, enrageAt: 195 },
      { script: stop, hp: 0, time: 14 },
      { script: p3, hp: 0.2135, enrageAt: 200 },
      { script: p4, hp: 0.332, enrageAt: 230 },
    ],
  };
}
