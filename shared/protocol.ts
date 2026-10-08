import type { EncounterId } from './encounters';
import type { JobId } from './jobs';
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
  players: GamePlayerInfo[];
}

/** Player state in a snapshot. Short keys keep the 30 Hz stream small. */
export interface SnapPlayer {
  i: string; // id
  x: number;
  z: number;
  f: number; // facing: direction (sin f, cos f)
  m: 0 | 1; // moving
  dc: 0 | 1; // disconnected
}

export interface Snapshot {
  k: number; // tick
  ph: 0 | 1 | 2; // countdown, fight, over
  cd: number; // countdown ticks left
  el: number; // fight ticks since the countdown ended
  p: SnapPlayer[];
}

/** test: the host ended a test fight (M1, before bosses exist) */
export type EndReason = 'test' | 'clear' | 'wipe' | 'enrage';
export const END_NAMES: Readonly<Record<EndReason, string>> = { test: '測試結束', clear: '通關', wipe: '滅團', enrage: '狂暴' };

export interface GameResult {
  reason: EndReason;
  /** seconds of fighting */
  time: number;
}

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
  | { t: 'end'; result: GameResult }
  | { t: 'pong'; c: number }
  | { t: 'error'; code: string; msg: string };
