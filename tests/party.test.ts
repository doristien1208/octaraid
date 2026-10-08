import { describe, expect, it } from 'vitest';
import { JOBS, ROLE_HP, jobById } from '../shared/jobs';
import { BASE_WEIGHT, hpScale, partyNotes, roleCounts, roleHasRoom } from '../shared/party';

describe('jobs', () => {
  it('are 2 tanks, 2 healers and 4 DPS with 5 skills each', () => {
    expect(roleCounts(JOBS.map((j) => j.id))).toEqual({ tank: 2, healer: 2, dps: 4 });
    for (const j of JOBS) expect(j.skills).toHaveLength(5);
  });

  it('keep the basic skill (key 1) free of cooldowns', () => {
    for (const j of JOBS) expect(j.skills[0].cd).toBe(0);
  });

  it('give tanks more HP', () => {
    expect(ROLE_HP.tank).toBeGreaterThan(ROLE_HP.dps);
    expect(jobById('guardian').role).toBe('tank');
  });
});

describe('party', () => {
  it('scales boss HP from the 4-player baseline (1 tank, 1 healer, 2 DPS)', () => {
    expect(BASE_WEIGHT).toBeCloseTo(3.2);
    expect(hpScale(['guardian', 'priest', 'brawler', 'ranger'])).toBeCloseTo(1);
    expect(hpScale(['guardian', 'priest', 'brawler'])).toBeCloseTo(2.2 / 3.2);
    expect(hpScale(['guardian', 'brawler', 'ranger'])).toBeCloseTo(2.65 / 3.2);
    expect(hpScale(['guardian', 'berserker', 'priest', 'warden', 'brawler', 'lancer', 'ranger', 'sorcerer'])).toBeCloseTo(2);
    expect(hpScale(['sorcerer'])).toBeCloseTo(1 / 3.2);
  });

  it('allows at most 2 tanks, 2 healers and 4 DPS, the same job twice included', () => {
    expect(roleHasRoom(['guardian'], 'guardian')).toBe(true);
    expect(roleHasRoom(['guardian', 'guardian'], 'berserker')).toBe(false);
    expect(roleHasRoom(['brawler', 'brawler', 'ranger', 'lancer'], 'sorcerer')).toBe(false);
    expect(roleHasRoom(['brawler', 'brawler', 'ranger', 'lancer'], 'priest')).toBe(true);
  });

  it('explains the missing-role rules', () => {
    expect(partyNotes(['guardian', 'priest', 'brawler'])).toEqual(['只有 1 個坦克：換坦機制的易傷會在下一次死刑前結束']);
    const solo = partyNotes(['sorcerer']);
    expect(solo.some((n) => n.startsWith('沒有坦克'))).toBe(true);
    expect(solo.some((n) => n.startsWith('沒有補師'))).toBe(true);
    expect(partyNotes(['guardian', 'berserker', 'warden'])).toEqual([]);
  });
});
