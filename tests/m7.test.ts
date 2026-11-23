import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../shared/constants';
import { encounterById } from '../shared/encounters';
import type { JobId } from '../shared/jobs';
import { hpScale, practiceParty } from '../shared/party';
import { scriptFor } from '../shared/bosses';
import { Bot, spotFor } from '../shared/sim/bot';
import { Fight } from '../shared/sim/fight';

/**
 * 時律機神殿 (v0.7: P1, 數字裁斷, P2) end to end with the dev bots (section 九): a 4-player party with a tank,
 * a healer and two DPS clears it most of the time, each stage well inside its own enrage; nobody standing
 * still gets past P1.
 */
function party(jobs: JobId[], seed: number) {
  const roster = jobs.map((job, k) => ({ id: `p${k}`, name: job, job }));
  const f = new Fight(encounterById('ultimate'), true, roster, seed, { hpScale: hpScale(jobs) });
  const bots = roster.map((r) => new Bot(f, r.id, spotFor(r.job, roster.filter((x) => x.job === r.job).indexOf(r))));
  const starts: number[] = [];
  while (f.phase !== 'over') {
    for (const b of bots) b.think();
    f.step();
    for (const e of f.snapshot().ev ?? []) if (e.k === 'phase') starts.push(f.fightTicks / TICK_RATE);
  }
  return { r: f.result!, starts };
}

describe('時律機神殿', () => {
  const stages = scriptFor('ultimate', true)!.stages!;

  it('has one stage for each name the menus show, P1 and P2 with their own enrage', () => {
    expect(stages.map((s) => s.script.phases[0]!.name)).toEqual(encounterById('ultimate').stages);
    expect(stages.map((s) => s.enrageAt)).toEqual([165, undefined, 195]);
    expect(stages.reduce((n, s) => n + s.hp, 0)).toBeCloseTo(1);
  });

  it('is cleared by computer parties of 1 tank, 1 healer and 2 DPS, each stage with time to spare', () => {
    const parties: JobId[][] = [
      ['guardian', 'priest', 'brawler', 'ranger'],
      ['berserker', 'warden', 'lancer', 'sorcerer'],
      ['guardian', 'warden', 'summoner', 'lancer'],
    ];
    let clears = 0;
    for (const jobs of parties) {
      for (const seed of [1, 2]) {
        const { r, starts } = party(jobs, seed);
        if (r.reason !== 'clear') continue;
        clears++;
        // [P1, 數字裁斷, P2] begin at these times; the fight ends with P2
        expect(starts, jobs.join(',')).toHaveLength(3);
        const p1 = starts[1]!;
        const p2 = r.time - starts[2]!;
        expect(p1, `${jobs.join(',')} P1`).toBeLessThan(165 - 15);
        expect(p2, `${jobs.join(',')} P2`).toBeLessThan(195 - 10);
        // and not trivially fast either
        expect(p1).toBeGreaterThan(90);
        expect(p2).toBeGreaterThan(100);
      }
    }
    expect(clears).toBeGreaterThanOrEqual(5);
  }, 300_000);

  it('the practice party for it always has a tank, a healer and two DPS', () => {
    for (const job of ['guardian', 'priest', 'brawler', 'summoner'] as JobId[]) {
      const jobs = practiceParty(job, 1, true);
      expect(jobs.length).toBe(4);
      expect(jobs[0]).toBe(job);
    }
  });

  it('a party that stands still never gets past P1', () => {
    const jobs: JobId[] = ['guardian', 'priest', 'brawler', 'ranger'];
    const f = new Fight(encounterById('ultimate'), true, jobs.map((job, k) => ({ id: `p${k}`, name: job, job })), 3, { hpScale: 1 });
    while (f.phase !== 'over') f.step();
    expect(f.result!.reason).not.toBe('clear');
    expect(f.result!.stage).toBe(0);
  });
});
