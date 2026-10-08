/** Shown on the entry screen and in /healthz, so a deployment can be checked at a glance. */
export const VERSION = '0.4.0';

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

  // combat (section 四). Times in ticks unless named otherwise.
  gcd: sec(2.5),
  /** after an ability or an instant skill nothing else can be used for this long: 2 abilities fit between GCDs */
  lock: sec(0.6),
  /** the same after a cast finishes */
  castLock: sec(0.1),
  /** pressing a skill this close to it being ready queues it */
  queue: sec(0.5),
  /** moving in the last part of a cast does not cut it */
  slidecast: sec(0.5),
  /** a cast is cut when the caster moves further than this (metres) */
  castMove: 0.1,
  comboWindow: sec(15),
  /** 1 potency = 10 damage, ±5% */
  potency: 10,
  variance: 0.05,
  critRate: 0.1,
  critMul: 1.5,
  /** tank stance: a tank's damage makes this much more enmity (×3 in v0.3.0 was too easy to lose) */
  enmityTank: 6,
  /** what tanks start with on every enemy's list, so DPS openers do not pull the boss off them */
  enmityTankStart: 2000,
  /** healing makes this much enmity, split across all enemies */
  enmityHeal: 0.5,
  /** provoke: top of the list, this far ahead of the next one */
  provokeLead: 0.1,
  /** damage and healing over time pay out every 3 seconds, for everyone at once */
  dotTick: sec(3),
  raiseHp: 0.25,
  risen: sec(5),
  weakness: sec(90),
  /** Limit Break gauge, percent per second of fighting */
  lbPerSec: 0.5,
  lbTank: sec(8),
  lbDpsRadius: 8,
  lbDpsBoss: 0.05,
  lbDpsAdd: 0.3,
  /** a mechanic nobody got wrong adds this much (percent) */
  lbClean: 5,
  // mistakes: Normal 傷害降低, Hard 易傷 stacks
  dmgDownTime: sec(15),
  vulnTime: sec(30),
  vulnMax: 4,
  // missing roles (缺角補正)
  noTankDamage: 0.5,
  noHealerRegen: 0.015, // of max HP per second
  autoRaise: sec(20),
  // 超越之力 (Normal only): per wipe on the same duty in the same room
  echoStep: 0.1,
  echoMax: 3,
  // enemies that walk (M4): they follow the top of their enmity list, so a tank can drag them around
  /** an enemy's auto attack reaches this far beyond its ring; when its target is further it walks after it */
  bossReach: 2,
  /** and stops this close */
  bossStop: 1.5,
} as const;
