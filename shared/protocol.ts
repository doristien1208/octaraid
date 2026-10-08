import type { EncounterId } from './encounters';
import type { JobId, Role } from './jobs';
import type { Tally } from './vote';

/** waiting: picking jobs and voting; tally: the vote result is on screen; then the fight and its results. */
export type RoomPhase = 'waiting' | 'tally' | 'playing' | 'results';

export interface RoomMember {
  id: string;
  name: string;
  job: JobId;
  /** index into VOTE_OPTIONS, null = has not voted */
  vote: number | null;
  ready: boolean;
  host: boolean;
  connected: boolean;
  ping: number;
}

export interface RoomView {
  /** the invite code */
  code: string;
  phase: RoomPhase;
  members: RoomMember[];
}

export interface GamePlayerInfo {
  id: string;
  name: string;
  job: JobId;
}

export interface GameStartInfo {
  enc: EncounterId;
  hard: boolean;
  seed: number;
  /** boss HP against the 4-player baseline, locked at departure */
  hpScale: number;
  /** 超越之力 stacks (Normal only: +10% each, from wipes on this duty in this room) */
  echo: number;
  players: GamePlayerInfo[];
  /** the enemies: id, name and the radius of their target ring */
  foes: { id: string; name: string; r: number }[];
}

/** Statuses in a snapshot: [index into STATUS_IDS, ticks left (−1 while it comes from a zone), value]. */
export type SnapStatus = [number, number, number];

/** Player state in a snapshot. Short keys keep the 30 Hz stream small. */
export interface SnapPlayer {
  i: string; // id
  x: number;
  z: number;
  f: number; // facing: direction (sin f, cos f)
  m: 0 | 1; // moving
  dc: 0 | 1; // disconnected
  hp: number;
  mh: number; // max HP
  sh: number; // shields left
  d: 0 | 1; // down (dead)
  /** casting: [slot (5 = LB), ticks left, total ticks] */
  c?: [number, number, number];
  st?: SnapStatus[];
  /** in a dash or jump: the server moves this character, the client follows */
  fm?: 1;
  /** GCD [ticks left, total ticks] */
  g: [number, number];
  /** cooldown ticks left per skill */
  cd: number[];
  /** the next step of the basic combo (0–2) */
  cb: number;
}

export interface SnapFoe {
  i: string;
  x: number;
  z: number;
  f: number;
  hp: number;
  mh: number;
  /** who it is attacking: the top of its enmity list */
  t: string | null;
  /** casting: [move name, ticks left, total ticks] */
  c?: [string, number, number];
  st?: SnapStatus[];
  /** living players by enmity, highest first */
  ag: string[];
}

/** A circle on the ground from a skill (星界領域, 魔力湧泉). */
export interface SnapZone {
  s: number; // index into STATUS_IDS
  o: string; // owner
  x: number;
  z: number;
  r: number;
  l: number; // ticks left
}

/** Something that happened this tick, for animations, numbers and sounds. */
export type FightEvent =
  /** a skill went off (an instant one, or a cast that finished); st: the combo step */
  | { k: 'use'; i: string; s: number; t?: string; st?: number }
  /** a cast started */
  | { k: 'cast'; i: string; s: number; t?: string; n: number }
  /** a cast was cut short by moving */
  | { k: 'intr'; i: string }
  /** damage: s = source (null: the boss or the fight), a = HP lost, ab = absorbed by shields, iv = invulnerable, c = critical,
   * sk = the skill slot it came from, pos = 1 positional hit / 0 missed */
  | { k: 'dmg'; s: string | null; t: string; a: number; ab?: number; iv?: 1; c?: 1; sk?: number; pos?: 0 | 1; dot?: 1 }
  | { k: 'heal'; s: string | null; t: string; a: number; c?: 1; hot?: 1 }
  | { k: 'die'; i: string }
  | { k: 'raise'; i: string; by: string | null }
  /** a Limit Break went off */
  | { k: 'lb'; i: string; r: Role }
  /** a boss move went off: auto attack, tank buster, raid-wide */
  | { k: 'boss'; i: string; n: string; m: 'auto' | 'buster' | 'raidwide'; t?: string }
  /** a boss started casting a named move that takes d ticks */
  | { k: 'bcast'; i: string; n: string; m: 'buster' | 'raidwide'; t?: string; d: number };

export interface Snapshot {
  k: number; // tick
  ph: 0 | 1 | 2; // countdown, fight, over
  cd: number; // countdown ticks left
  el: number; // fight ticks since the countdown ended
  lb: number; // Limit Break gauge, 0–1000 (tenths of a percent)
  p: SnapPlayer[];
  e: SnapFoe[];
  zn?: SnapZone[];
  ev?: FightEvent[];
}

/** test: the host ended a test fight (before bosses exist) */
export type EndReason = 'test' | 'clear' | 'wipe' | 'enrage';
export const END_NAMES: Readonly<Record<EndReason, string>> = { test: '測試結束', clear: '通關', wipe: '滅團', enrage: '狂暴' };

export interface PlayerStats {
  id: string;
  /** damage dealt, healing done (without overheal), damage taken */
  dmg: number;
  heal: number;
  taken: number;
  deaths: number;
}

export interface GameResult {
  reason: EndReason;
  /** seconds of fighting */
  time: number;
  /** boss HP left, 0–1 */
  bossHp: number;
  stats: PlayerStats[];
}

/** Why a skill did not go off. */
export type DenyReason = 'phase' | 'dead' | 'busy' | 'casting' | 'cd' | 'gcd' | 'target' | 'range' | 'lb';
export const DENY_TEXT: Readonly<Record<DenyReason, string>> = {
  phase: '戰鬥還沒開始',
  dead: '倒地中無法行動',
  busy: '動作中',
  casting: '正在詠唱',
  cd: '技能冷卻中',
  gcd: '還在 GCD 中',
  target: '沒有可用的目標',
  range: '距離太遠',
  lb: '極限技量表未滿',
};

export type C2S =
  | { t: 'hello'; name: string; token?: string }
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'leave' }
  | { t: 'job'; job: JobId }
  | { t: 'vote'; opt: number | null }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'chat'; text: string }
  /** where my character is; the client moves itself and the server checks it */
  | { t: 'mv'; x: number; z: number; f: number }
  /** a skill (0–4) or the Limit Break (5); tg: the chosen target; dx, dz: the direction I am moving */
  | { t: 'use'; s: number; tg?: string | null; dx?: number; dz?: number }
  | { t: 'endtest' }
  | { t: 'ping'; c: number; r?: number };

export type S2C =
  | { t: 'welcome'; id: string; token: string; name: string }
  /** not in a room (any more): show the entry screen */
  | { t: 'entry' }
  | { t: 'room'; room: RoomView }
  | { t: 'chat'; from: string | null; name: string; text: string }
  | { t: 'tally'; result: Tally }
  | { t: 'start'; game: GameStartInfo }
  | { t: 'snap'; s: Snapshot }
  /** the server put my character somewhere else (a step it did not accept) */
  | { t: 'pos'; x: number; z: number }
  /** my skill did not go off */
  | { t: 'deny'; s: number; why: DenyReason }
  | { t: 'end'; result: GameResult }
  | { t: 'pong'; c: number }
  | { t: 'error'; code: string; msg: string };
