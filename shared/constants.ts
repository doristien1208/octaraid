/** Shown on the entry screen and in /healthz, so a deployment can be checked at a glance. */
export const VERSION = '0.1.0';

/** The test machine gives this game port 3100; the Game Hub passes it in PORT as well. */
export const DEFAULT_PORT = 3100;

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const MAX_PLAYERS = 8;

export const sec = (s: number) => Math.round(s * TICK_RATE);

/** Invite codes: 4 characters, without 0, O, 1 and I, which are easy to misread. */
export const ROOM_CODE_LEN = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Tunables. Values marked 暫定 in the design doc live here and are adjusted after play-testing.
 * Distances are in metres, speeds in metres per second.
 */
export const RULES = {
  moveSpeed: 6,
  playerRadius: 0.5,
  // The client reports its own position; the server accepts a step up to this much longer than the
  // speed allows (network jitter bunches reports together), and counts at most `moveGap` of idle time.
  moveSlack: 1.5,
  moveSlackM: 0.75,
  moveGap: 0.5,
  countdown: sec(10),
  tallyMs: 3000,
  resultsMs: 15_000,
  chatMax: 100,
  chatGapMs: 500, // at most 2 messages per second
  nameMax: 12,
} as const;
