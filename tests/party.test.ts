import { describe, expect, it } from 'vitest';
import { JOBS, LB_SLOT, ROLE_HP, SKILL_COUNT, SPRINT_SLOT, jobById, skillAt } from '../shared/jobs';
import { BASE_WEIGHT, ROLE_CAPS, hpScale, partyNotes, practiceParty, roleCounts, roleHasRoom } from '../shared/party';

describe('jobs', () => {
  it('are 2 tanks, 2 healers and 4 DPS with 10 skills each, plus 疾走', () => {
    expect(roleCounts(JOBS.map((j) => j.id))).toEqual({ tank: 2, healer: 2, dps: 4 });
    for (const j of JOBS) expect(j.skills).toHaveLength(SKILL_COUNT);
    for (const j of JOBS) expect(skillAt(j, SPRINT_SLOT)?.name).toBe('疾走');
    for (const j of JOBS) expect(skillAt(j, LB_SLOT)).toBeNull();
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
    expect(solo.some((n) => n.startsWith('只有 1 人'))).toBe(true);
    expect(partyNotes(['guardian', 'berserker', 'warden', 'ranger'])).toEqual([]);
    expect(partyNotes(['guardian', 'berserker', 'warden'])).toEqual(['沒有 DPS：雙子機神要平均打兩隻王，只有坦克與補師很難不失衡']);
  });

  it('fills the offline practice party around my job, one of each role first, within the caps', () => {
    expect(practiceParty('sorcerer', 1)).toEqual(['sorcerer']);
    expect(roleCounts(practiceParty('priest', 4))).toEqual({ tank: 1, healer: 1, dps: 2 });
    expect(practiceParty('priest', 4)[0]).toBe('priest');
    for (const j of JOBS) {
      for (let n = 1; n <= 8; n++) {
        const jobs = practiceParty(j.id, n);
        expect(jobs).toHaveLength(n);
        expect(jobs[0]).toBe(j.id);
        const c = roleCounts(jobs);
        expect(c.tank <= ROLE_CAPS.tank && c.healer <= ROLE_CAPS.healer && c.dps <= ROLE_CAPS.dps).toBe(true);
      }
    }
  });
});
