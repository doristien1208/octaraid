import { VOTE_OPTIONS } from './encounters';

export interface Tally {
  /** the option that will be played */
  winner: number;
  /** votes per option */
  counts: number[];
  /** the options that shared the top count, when there was a tie (a random one of them won) */
  tied: number[];
}

/**
 * Departure vote: the 8 "encounter + difficulty" options are counted together and the most votes win.
 * A tie is broken at random among the tied options; with no votes at all, any of the 8 can come up.
 * `votes` holds one entry per player (null = did not vote); `random` returns [0, 1).
 */
export function tally(votes: readonly (number | null)[], random: () => number): Tally {
  const counts = VOTE_OPTIONS.map(() => 0);
  for (const v of votes) if (v !== null && v >= 0 && v < counts.length) counts[v]!++;
  const top = Math.max(...counts);
  const best = counts.flatMap((c, k) => (c === top ? [k] : []));
  const winner = best[Math.min(best.length - 1, Math.floor(random() * best.length))]!;
  return { winner, counts, tied: best.length > 1 ? best : [] };
}
