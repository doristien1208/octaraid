import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../shared/constants';
import { hasBoss } from '../shared/bosses';
import { ENCOUNTERS, encounterById, type EncounterId } from '../shared/encounters';
import { JOBS, jobById, type JobId } from '../shared/jobs';
import { hpScale } from '../shared/party';
import { Bot } from '../shared/sim/bot';
import { Fight } from '../shared/sim/fight';

/**
 * The M2 gate (每個職業都能打木人，量到各職平均輸出): computer players run each job's rotation on the
 * training dummy, and bot parties fight the attacking dummy with each duty's boss HP. Bots play close to
 * perfectly, so their clear times should sit well under each duty's target time: people are slower and
 * the boss mechanics (M3) take time away from attacking.
 */

/** Damage per second of each player over `secs` of hitting a dummy that does not fight back. */
function measure(jobs: JobId[], secs = 180): number[] {
  const roster = jobs.map((job, k) => ({ id: `p${k}`, name: job, job }));
  const f = new Fight(encounterById('colossus'), false, roster, 7, { calm: true, hpScale: 10, practice: true });
  const bots = roster.map((r) => new Bot(f, r.id));
  for (let k = 0; k < (secs + 10) * TICK_RATE; k++) {
    for (const b of bots) b.think();
    f.step();
  }
  return roster.map((r) => f.players.get(r.id)!.stats.dmg / secs);
}

function party(jobs: JobId[], enc: EncounterId, hard: boolean) {
  const roster = jobs.map((job, k) => ({ id: `p${k}`, name: job, job }));
  const f = new Fight(encounterById(enc), hard, roster, 11, { hpScale: hpScale(jobs) });
  const bots = roster.map((r) => new Bot(f, r.id));
  while (f.phase !== 'over') {
    for (const b of bots) b.think();
    f.step();
  }
  return f.result!;
}

describe('job damage (a tank holds the dummy so positionals work)', () => {
  const dps = new Map<JobId, number>();
  for (const j of JOBS) dps.set(j.id, j.role === 'tank' ? measure([j.id])[0]! : measure(['guardian', j.id])[1]!);

  it('keeps every job in its band', () => {
    const table = JOBS.map((j) => `${j.name} ${Math.round(dps.get(j.id)!)}`).join('、');
    console.log(`平均輸出（每秒傷害）：${table}`);
    for (const j of JOBS) {
      const v = dps.get(j.id)!;
      if (j.role === 'tank') expect(v, j.name).toBeGreaterThan(800);
      if (j.role === 'tank') expect(v, j.name).toBeLessThan(1200);
      if (j.role === 'healer') expect(v, j.name).toBeGreaterThan(650);
      if (j.role === 'healer') expect(v, j.name).toBeLessThan(1000);
      if (j.role === 'dps') expect(v, j.name).toBeGreaterThan(1300);
      if (j.role === 'dps') expect(v, j.name).toBeLessThan(2000);
    }
  });

  it('gives the caster the most damage, as the doc says, and the berserker more than the guardian', () => {
    const top = Math.max(...JOBS.filter((j) => j.role === 'dps').map((j) => dps.get(j.id)!));
    expect(dps.get('sorcerer')).toBe(top);
    expect(dps.get('berserker')!).toBeGreaterThan(dps.get('guardian')!);
  });
});

describe('bot parties against the training dummy (duties whose boss is still to come)', () => {
  const comps: JobId[][] = [
    ['guardian', 'priest', 'brawler', 'sorcerer'],
    ['berserker', 'warden', 'lancer', 'ranger'],
  ];
  for (const e of ENCOUNTERS.filter((x) => !hasBoss(x.id))) {
    for (const hard of [false, true]) {
      it(`clears ${e.name} ${hard ? 'Hard' : 'Normal'} with 4 players, well inside the target time`, () => {
        const target = (hard ? e.times.hard : e.times.normal).target;
        for (const jobs of comps) {
          const r = party(jobs, e.id, hard);
          expect(r.reason, jobs.join(',')).toBe('clear');
          expect(r.stats.every((s) => s.deaths === 0), jobs.join(',')).toBe(true);
          expect(r.time).toBeLessThan(target * (hard ? 0.85 : 0.7));
          expect(r.time).toBeGreaterThan(target * 0.4);
        }
      });
    }
  }

  it('scales with the party: 3, 3 without a healer, 1 and 8 players all clear Normal', () => {
    const target = encounterById('frostwitch').times.normal.target;
    for (const jobs of [
      ['guardian', 'priest', 'ranger'],
      ['guardian', 'brawler', 'sorcerer'],
      ['sorcerer'],
      ['guardian', 'berserker', 'priest', 'warden', 'brawler', 'lancer', 'ranger', 'sorcerer'],
    ] as JobId[][]) {
      const r = party(jobs, 'frostwitch', false);
      expect(r.reason, jobs.join(',')).toBe('clear');
      expect(r.time, jobs.join(',')).toBeLessThan(target * 0.75);
      expect(r.time, jobs.join(',')).toBeGreaterThan(target * 0.4);
    }
  });

  it('wipes a party that does nothing, at the latest by the enrage', () => {
    const roster = (['guardian', 'priest', 'brawler', 'sorcerer'] as JobId[]).map((job, k) => ({ id: `p${k}`, name: job, job }));
    const f = new Fight(encounterById('frostwitch'), true, roster, 3, { hpScale: hpScale(roster.map((r) => r.job)) });
    while (f.phase !== 'over') f.step();
    expect(['wipe', 'enrage']).toContain(f.result!.reason);
    expect(f.result!.time).toBeLessThanOrEqual(encounterById('frostwitch').times.hard.enrage);
    expect(jobById('guardian').role).toBe('tank');
  });
});
