/**
 * The first 4 duties (section 七 of the design doc). Each has a Normal and a Hard version; the 8
 * combinations are what players vote on in the waiting room. Times are in seconds.
 */
export type EncounterId = 'colossus' | 'frostwitch' | 'gatekeeper' | 'twins';

/** circle: `size` is the radius; square: `size` is half the side. Metres. */
export interface Arena {
  shape: 'circle' | 'square';
  size: number;
}

export interface DifficultyTimes {
  /** the fight should usually end around here */
  target: number;
  /** the boss wipes the party at this time; never later than 8 minutes */
  enrage: number;
}

export interface Encounter {
  id: EncounterId;
  name: string;
  kind: 'trial' | 'raid';
  boss: string;
  arena: Arena;
  learn: string;
  desc: string;
  times: { normal: DifficultyTimes; hard: DifficultyTimes };
  /** boss HP for the 4-player baseline (1 tank, 1 healer, 2 DPS); scaled by the party (shared/party.ts). 暫定 */
  hp: { normal: number; hard: number };
  theme: { sky: string; floor: string; floorLine: string; edge: string; outside: string };
}

export const KIND_NAMES = { trial: '討滅戰', raid: 'Raid' } as const;

export const ENCOUNTERS: readonly Encounter[] = [
  {
    id: 'colossus',
    name: '崩岩巨像',
    kind: 'trial',
    boss: '崩岩巨像',
    arena: { shape: 'circle', size: 20 },
    learn: '形狀、讀條、死刑、分攤與分散',
    desc: '峽谷平台上的岩石巨人。入門關：先學會看地面預兆與讀條名稱。',
    times: { normal: { target: 240, enrage: 360 }, hard: { target: 360, enrage: 420 } },
    hp: { normal: 700_000, hard: 1_200_000 },
    theme: { sky: '#e9b98a', floor: '#c9925c', floorLine: '#9e6b3e', edge: '#7a4f2e', outside: '#5c3d27' },
  },
  {
    id: 'frostwitch',
    name: '霜冠魔女',
    kind: 'trial',
    boss: '霜冠魔女',
    arena: { shape: 'circle', size: 20 },
    learn: '連線、踩塔、地火、躲柱子',
    desc: '冰湖上的浮空魔女，四個斜角各有一根可以遮蔽的冰柱。',
    times: { normal: { target: 300, enrage: 420 }, hard: { target: 390, enrage: 450 } },
    hp: { normal: 880_000, hard: 1_300_000 },
    theme: { sky: '#b9dcf2', floor: '#d6ecf7', floorLine: '#8fbcd8', edge: '#6aa3c8', outside: '#e8f4fb' },
  },
  {
    id: 'gatekeeper',
    name: '發條城塞 1F：守門機兵',
    kind: 'raid',
    boss: '守門機兵',
    arena: { shape: 'square', size: 18 },
    learn: '換坦、計時炸彈、八方站位、地板',
    desc: '6 × 6 格的機械地板，格子會通電；四足機械守衛把守城門。',
    times: { normal: { target: 300, enrage: 420 }, hard: { target: 390, enrage: 450 } },
    hp: { normal: 880_000, hard: 1_300_000 },
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
    times: { normal: { target: 330, enrage: 450 }, hard: { target: 420, enrage: 480 } },
    hp: { normal: 980_000, hard: 1_400_000 },
    theme: { sky: '#2b2440', floor: '#4b4466', floorLine: '#8e83b8', edge: '#2a2338', outside: '#1c1828' },
  },
];

export function encounterById(id: EncounterId): Encounter {
  return ENCOUNTERS.find((e) => e.id === id)!;
}

/** What players vote on: one of 8 options, encounter × difficulty. Index = encounter * 2 + (hard ? 1 : 0). */
export interface VoteOption {
  index: number;
  enc: EncounterId;
  hard: boolean;
}

export const VOTE_OPTIONS: readonly VoteOption[] = ENCOUNTERS.flatMap((e, k) => [
  { index: k * 2, enc: e.id, hard: false },
  { index: k * 2 + 1, enc: e.id, hard: true },
]);

export const difficultyName = (hard: boolean) => (hard ? 'Hard' : 'Normal');

export function optionLabel(index: number): string {
  const o = VOTE_OPTIONS[index];
  return o ? `${encounterById(o.enc).name} ${difficultyName(o.hard)}` : '';
}

/** "4:00" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
