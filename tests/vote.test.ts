import { describe, expect, it } from 'vitest';
import { VOTE_OPTIONS, optionLabel } from '../shared/encounters';
import { Rng } from '../shared/rng';
import { tally } from '../shared/vote';

describe('departure vote', () => {
  it('offers 8 options: 4 encounters × Normal / Hard', () => {
    expect(VOTE_OPTIONS).toHaveLength(8);
    expect(optionLabel(0)).toBe('崩岩巨像 Normal');
    expect(optionLabel(1)).toBe('崩岩巨像 Hard');
    expect(optionLabel(7)).toBe('發條城塞 2F：雙子機神 Hard');
  });

  it('plays the option with the most votes', () => {
    const r = tally([0, 0, 1, 3], Math.random);
    expect(r.winner).toBe(0);
    expect(r.counts).toEqual([2, 1, 0, 1, 0, 0, 0, 0]);
    expect(r.tied).toEqual([]);
  });

  it('ignores players who did not vote', () => {
    expect(tally([null, 5, null], Math.random).winner).toBe(5);
  });

  it('breaks a tie at random among the tied options only', () => {
    const rng = new Rng(7);
    const seen = new Set<number>();
    for (let k = 0; k < 200; k++) {
      const r = tally([0, 0, 6, 6, 3], () => rng.next());
      expect(r.tied).toEqual([0, 6]);
      seen.add(r.winner);
    }
    expect([...seen].sort()).toEqual([0, 6]);
  });

  it('picks any of the 8 when nobody voted', () => {
    const rng = new Rng(3);
    const seen = new Set<number>();
    for (let k = 0; k < 400; k++) seen.add(tally([null, null], () => rng.next()).winner);
    expect(seen.size).toBe(8);
  });

  it('never returns an option past the end, even when random() is at its top', () => {
    expect(tally([2, 4], () => 0.9999999999).winner).toBe(4);
  });
});
