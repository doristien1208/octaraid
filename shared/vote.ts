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
 * Departure vote: the "encounter + difficulty" options are counted together and the most votes win.
 * A tie is broken at random among the tied options; with no votes at all, any open option can come up.
 * `votes` holds one entry per player (null = did not vote); `random` returns [0, 1); `open` says which
 * options this party may play (the ultimate needs 4 players with 1 tank, 1 healer and 2 DPS): votes for
 * the others do not count.
 */
export function tally(votes: readonly (number | null)[], random: () => number, open: (k: number) => boolean = () => true): Tally {
  const counts = VOTE_OPTIONS.map(() => 0);
  for (const v of votes) if (v !== null && v >= 0 && v < counts.length && open(v)) counts[v]!++;
  const playable = counts.flatMap((_, k) => (open(k) ? [k] : []));
  const top = Math.max(...playable.map((k) => counts[k]!));
  const best = playable.filter((k) => counts[k] === top);
  const winner = best[Math.min(best.length - 1, Math.floor(random() * best.length))]!;
  return { winner, counts, tied: best.length > 1 ? best : [] };
}
