/**
 * The duties (section 七 of the design doc): the first 4 have a Normal and a Hard version, the ultimate
 * (v0.7) only its own 絕; these 9 options are what players vote on in the waiting room. Times are in seconds.
 */
export type EncounterId = 'colossus' | 'frostwitch' | 'gatekeeper' | 'twins' | 'ultimate';

/** circle: `size` is the radius; square: `size` is half the side. Metres. */
export interface Arena {
  shape: 'circle' | 'square';
  size: number;
  /** pillars nobody can walk through; a boss cannot see past them (視線遮蔽) */
  pillars?: readonly { x: number; z: number; r: number }[];
  /** a square floor of `grid` × `grid` tiles that can be electrified */
  grid?: number;
}

const DIAG = 13 * Math.SQRT1_2;

export interface DifficultyTimes {
  /** the fight should usually end around here */
  target: number;
  /** the boss wipes the party at this time; never later than 8 minutes */
  enrage: number;
}

export interface Encounter {
  id: EncounterId;
  name: string;
  /** ultimate: one difficulty (絕), stages one after another, at least 4 players with 1 tank, 1 healer and 2 DPS */
  kind: 'trial' | 'raid' | 'ultimate';
  boss: string;
  arena: Arena;
  learn: string;
  desc: string;
  times: { normal: DifficultyTimes; hard: DifficultyTimes };
  /** boss HP for the 4-player baseline (1 tank, 1 healer, 2 DPS); scaled by the party (shared/party.ts). 暫定 */
  hp: { normal: number; hard: number };
  theme: { sky: string; floor: string; floorLine: string; edge: string; outside: string };
  /** the ultimate's stages, in order (the boss script has one for each) */
  stages?: readonly string[];
}

export const KIND_NAMES = { trial: '討滅戰', raid: 'Raid', ultimate: '絕本' } as const;

export const ENCOUNTERS: readonly Encounter[] = [
  {
    id: 'colossus',
    name: '崩岩巨像',
    kind: 'trial',
    boss: '崩岩巨像',
    arena: { shape: 'circle', size: 20 },
    learn: '形狀、讀條、死刑、分攤與分散',
    desc: '峽谷平台上的岩石巨人。入門關：先學會看地面預兆與讀條名稱。',
    // Hard was 6:00 / 7:00 until play-testers cleared it at 4:25 with 2:35 to spare (v0.4.1)
    times: { normal: { target: 240, enrage: 360 }, hard: { target: 285, enrage: 330 } },
    hp: { normal: 700_000, hard: 990_000 },
    theme: { sky: '#e9b98a', floor: '#c9925c', floorLine: '#9e6b3e', edge: '#7a4f2e', outside: '#5c3d27' },
  },
  {
    id: 'frostwitch',
    name: '霜冠魔女',
    kind: 'trial',
    boss: '霜冠魔女',
    // the 4 ice pillars stand on the intercardinal waymarks 1–4
    arena: {
      shape: 'circle',
      size: 20,
      pillars: [
        { x: DIAG, z: -DIAG, r: 1.3 },
        { x: DIAG, z: DIAG, r: 1.3 },
        { x: -DIAG, z: DIAG, r: 1.3 },
        { x: -DIAG, z: -DIAG, r: 1.3 },
      ],
    },
    learn: '連線、踩塔、地火、躲柱子',
    desc: '冰湖上的浮空魔女，四個斜角各有一根可以遮蔽的冰柱。',
    // Hard was 6:30 / 7:30; computer parties cleared with 2 minutes or more to spare (v0.4.2)
    times: { normal: { target: 300, enrage: 420 }, hard: { target: 315, enrage: 360 } },
    hp: { normal: 900_000, hard: 1_070_000 },
    theme: { sky: '#b9dcf2', floor: '#d6ecf7', floorLine: '#8fbcd8', edge: '#6aa3c8', outside: '#e8f4fb' },
  },
  {
    id: 'gatekeeper',
    name: '發條城塞 1F：守門機兵',
    kind: 'raid',
    boss: '守門機兵',
    arena: { shape: 'square', size: 18, grid: 6 },
    learn: '換坦、計時炸彈、八方站位、地板',
    desc: '6 × 6 格的機械地板，格子會通電；四足機械守衛把守城門。',
    // Hard was 6:30 / 7:30; computer parties cleared with 2 minutes or more to spare (v0.4.2)
    times: { normal: { target: 300, enrage: 420 }, hard: { target: 315, enrage: 360 } },
    hp: { normal: 920_000, hard: 1_100_000 },
    theme: { sky: '#3b4255', floor: '#6c7486', floorLine: '#a8b0c2', edge: '#3a3f4d', outside: '#2a2e38' },
  },
  {
    id: 'twins',
    name: '發條城塞 2F：雙子機神',
    kind: 'raid',
    boss: '熾核與凍核',
    arena: { shape: 'circle', size: 22 },
    learn: '雙王、血量分配、顏色機制、合體',
    desc: '紅色的熾核與藍色的凍核，兩王太靠近會共鳴；最後合體成雙極機神。',
    // Hard was 7:00 / 8:00 (v0.4.2 tightened it with the others)
    times: { normal: { target: 330, enrage: 450 }, hard: { target: 345, enrage: 390 } },
    hp: { normal: 1_050_000, hard: 1_220_000 },
    theme: { sky: '#2b2440', floor: '#4b4466', floorLine: '#8e83b8', edge: '#2a2338', outside: '#1c1828' },
  },
  {
    id: 'ultimate',
    name: '時律機神殿',
    kind: 'ultimate',
    boss: '水銀核心、熾核與凍核',
    arena: { shape: 'circle', size: 22 },
    learn: '多王接力、血量平衡、碰觸傳遞、數字點名',
    desc: '發條城塞的頂層。王一組接一組上場，每個階段有自己的狂暴；滅團就從頭來。四個階段加兩段轉場，約 13 分鐘。',
    // each stage has its own enrage (P1 2:45, P2 3:15, P3 3:20, P4 3:50, with 數字裁斷 32 s and 時間停止 14 s
    // between): the most a fight can last
    times: { normal: { target: 780, enrage: 836 }, hard: { target: 780, enrage: 836 } },
    hp: { normal: 2_530_000, hard: 2_530_000 },
    theme: { sky: '#1f1b2e', floor: '#5d5246', floorLine: '#c9a45c', edge: '#2f2820', outside: '#14111c' },
    stages: ['P1：水銀核心', '數字裁斷', 'P2：熾核與凍核', '時間停止', 'P3：時律機神', 'P4：時律機神・終式'],
  },
];

export function encounterById(id: EncounterId): Encounter {
  return ENCOUNTERS.find((e) => e.id === id)!;
}

/** What players vote on: encounter × difficulty (the ultimate has only its 絕, which counts as Hard). */
export interface VoteOption {
  index: number;
  enc: EncounterId;
  hard: boolean;
}

export const VOTE_OPTIONS: readonly VoteOption[] = ENCOUNTERS.flatMap((e) => (e.kind === 'ultimate' ? [true] : [false, true]).map((hard) => ({ enc: e.id, hard }))).map(
  (o, index) => ({ index, ...o }),
);

/** The vote option for a duty and difficulty (the ultimate's one whatever `hard` says). */
export function voteOption(enc: EncounterId, hard: boolean): VoteOption {
  const ult = encounterById(enc).kind === 'ultimate';
  return VOTE_OPTIONS.find((o) => o.enc === enc && (ult || o.hard === hard))!;
}

export const difficultyName = (hard: boolean, enc?: EncounterId) => (enc && encounterById(enc).kind === 'ultimate' ? '絕' : hard ? 'Hard' : 'Normal');

export function optionLabel(index: number): string {
  const o = VOTE_OPTIONS[index];
  return o ? `${encounterById(o.enc).name} ${difficultyName(o.hard, o.enc)}` : '';
}

/** "4:00" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
