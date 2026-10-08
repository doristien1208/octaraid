import { describe, expect, it } from 'vitest';
import { encounterById, type EncounterId } from '../shared/encounters';
import type { JobId } from '../shared/jobs';
import { hpScale } from '../shared/party';
import { Bot, spotFor } from '../shared/sim/bot';
import { Fight } from '../shared/sim/fight';

/**
 * 霜冠魔女 and both floors of 發條城塞 end to end (section 九: whole-fight simulation with dev bots). The
 * bots read every attack and play cleanly, so Normal clears well inside the target time with any party of
 * 3 to 8, and Hard with 4 players that have a tank and a healer most of the time; a party that stands
 * still never clears.
 */
function party(enc: EncounterId, jobs: JobId[], hard: boolean, seed: number) {
  const roster = jobs.map((job, k) => ({ id: `p${k}`, name: job, job }));
  const f = new Fight(encounterById(enc), hard, roster, seed, { hpScale: hpScale(jobs) });
  const bots = roster.map((r) => new Bot(f, r.id, spotFor(r.job, roster.filter((x) => x.job === r.job).indexOf(r))));
  const phases: string[] = [];
  while (f.phase !== 'over') {
    for (const b of bots) b.think();
    f.step();
    for (const e of f.snapshot().ev ?? []) if (e.k === 'phase') phases.push(e.n);
  }
  const r = f.result!;
  return { r, phases, deaths: r.stats.reduce((n, s) => n + s.deaths, 0) };
}

const NORMAL: JobId[][] = [
  ['guardian', 'priest', 'brawler', 'sorcerer'],
  ['berserker', 'warden', 'lancer', 'ranger'],
  ['guardian', 'priest', 'ranger'],
  ['guardian', 'berserker', 'priest', 'warden', 'brawler', 'lancer', 'ranger', 'sorcerer'],
];
const HARD: JobId[][] = [
  ['guardian', 'priest', 'brawler', 'sorcerer'],
  ['berserker', 'warden', 'lancer', 'ranger'],
];
const PHASES: Record<'frostwitch' | 'gatekeeper' | 'twins', string[]> = {
  frostwitch: ['霜冠魔女', '冰鏡分身', '霜冠魔女（後半）', '霜冠魔女（終盤）'],
  gatekeeper: ['守門機兵', '過熱', '守門機兵（後半）'],
  twins: ['熾核與凍核', '雙極機神'],
};

for (const id of ['frostwitch', 'gatekeeper', 'twins'] as const) {
  const enc = encounterById(id);
  describe(enc.name, () => {
    it('clears Normal with parties of 3, 4 and 8, nobody (or hardly anybody) going down', () => {
      const target = enc.times.normal.target;
      for (const jobs of NORMAL) {
        const { r, deaths, phases } = party(id, jobs, false, 7);
        expect(r.reason, jobs.join(',')).toBe('clear');
        expect(deaths, jobs.join(',')).toBeLessThanOrEqual(1);
        expect(r.time, jobs.join(',')).toBeLessThan(target * 0.85);
        expect(r.time, jobs.join(',')).toBeGreaterThan(target * 0.5);
        expect(phases, jobs.join(',')).toEqual(PHASES[id]);
      }
    }, 120_000);

    it('is clearable on Hard by a 4-player party with a tank and a healer', () => {
      // the raid floors are meant to be harder than the first trial: the bots clear them about 2 times in 3
      let clears = 0;
      for (const jobs of HARD) for (const seed of [1, 2, 3]) if (party(id, jobs, true, seed).r.reason === 'clear') clears++;
      expect(clears).toBeGreaterThanOrEqual(id === 'frostwitch' ? 5 : 4);
    }, 180_000);

    it('beats a party that stands still, by the enrage at the latest', () => {
      const roster = (['guardian', 'priest', 'brawler', 'sorcerer'] as JobId[]).map((job, k) => ({ id: `p${k}`, name: job, job }));
      for (const hard of [false, true]) {
        const f = new Fight(enc, hard, roster, 5, { hpScale: 1 });
        while (f.phase !== 'over') f.step();
        expect(['wipe', 'enrage']).toContain(f.result!.reason);
        expect(f.result!.time).toBeLessThanOrEqual((hard ? enc.times.hard : enc.times.normal).enrage);
      }
    }, 60_000);
  });
}
