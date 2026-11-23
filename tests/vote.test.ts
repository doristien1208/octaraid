import { describe, expect, it } from 'vitest';
import { VOTE_OPTIONS, optionLabel, voteOption } from '../shared/encounters';
import type { JobId } from '../shared/jobs';
import { meetsUltimate, optionOpen } from '../shared/party';
import { Rng } from '../shared/rng';
import { tally } from '../shared/vote';

describe('departure vote', () => {
  it('offers 9 options: 4 encounters × Normal / Hard, and the ultimate (絕 only)', () => {
    expect(VOTE_OPTIONS).toHaveLength(9);
    expect(optionLabel(0)).toBe('崩岩巨像 Normal');
    expect(optionLabel(1)).toBe('崩岩巨像 Hard');
    expect(optionLabel(7)).toBe('發條城塞 2F：雙子機神 Hard');
    expect(optionLabel(8)).toBe('時律機神殿 絕');
    expect(voteOption('twins', false).index).toBe(6);
    // the ultimate has one option whatever is asked for
    expect(voteOption('ultimate', false).index).toBe(8);
    expect(VOTE_OPTIONS[8]).toEqual({ index: 8, enc: 'ultimate', hard: true });
  });

  it('plays the option with the most votes', () => {
    const r = tally([0, 0, 1, 3], Math.random);
    expect(r.winner).toBe(0);
    expect(r.counts).toEqual([2, 1, 0, 1, 0, 0, 0, 0, 0]);
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

  it('picks any of the 9 when nobody voted', () => {
    const rng = new Rng(3);
    const seen = new Set<number>();
    for (let k = 0; k < 400; k++) seen.add(tally([null, null], () => rng.next()).winner);
    expect(seen.size).toBe(9);
  });

  it('never returns an option past the end, even when random() is at its top', () => {
    expect(tally([2, 4], () => 0.9999999999).winner).toBe(4);
  });
});

describe('the ultimate needs 4 players with 1 tank, 1 healer and 2 DPS', () => {
  const full: JobId[] = ['guardian', 'priest', 'brawler', 'ranger'];
  it('opens only to such a party', () => {
    expect(meetsUltimate(full)).toBe(true);
    expect(meetsUltimate(['guardian', 'priest', 'brawler'])).toBe(false);
    expect(meetsUltimate(['guardian', 'berserker', 'priest', 'brawler'])).toBe(false);
    expect(meetsUltimate(['brawler', 'lancer', 'ranger', 'sorcerer'])).toBe(false);
    expect(meetsUltimate(['guardian', 'priest', 'warden', 'brawler', 'lancer'])).toBe(true);
    expect(optionOpen(8, ['guardian', 'priest', 'brawler'])).toBe(false);
    expect(optionOpen(1, ['guardian', 'priest', 'brawler'])).toBe(true);
  });

  it('does not count votes for it from a party that does not qualify, nor draws it when nobody voted', () => {
    const three: JobId[] = ['guardian', 'priest', 'brawler'];
    const r = tally([8, 8, 2], Math.random, (k) => optionOpen(k, three));
    expect(r.winner).toBe(2);
    expect(r.counts[8]).toBe(0);
    const rng = new Rng(5);
    for (let k = 0; k < 300; k++) expect(tally([null], () => rng.next(), (j) => optionOpen(j, three)).winner).not.toBe(8);
    expect(tally([8, 8, 2, 3], Math.random, (k) => optionOpen(k, full)).winner).toBe(8);
  });
});
