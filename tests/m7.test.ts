import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../shared/constants';
import { encounterById } from '../shared/encounters';
import type { JobId } from '../shared/jobs';
import { hpScale, practiceParty } from '../shared/party';
import { scriptFor } from '../shared/bosses';
import { Bot, spotFor } from '../shared/sim/bot';
import { Fight } from '../shared/sim/fight';

/**
 * 時律機神殿 (v0.8: P1, 數字裁斷, P2, 時間停止, P3, P4) end to end with the dev bots (section 九): a 4-player
 * party with a tank, a healer and two DPS clears it most of the time, each stage well inside its own enrage,
 * and earns 時之鑰 on the way; nobody standing still gets past P1.
 */
function party(jobs: JobId[], seed: number) {
  const roster = jobs.map((job, k) => ({ id: `p${k}`, name: job, job }));
  const f = new Fight(encounterById('ultimate'), true, roster, seed, { hpScale: hpScale(jobs) });
  const bots = roster.map((r) => new Bot(f, r.id, spotFor(r.job, roster.filter((x) => x.job === r.job).indexOf(r))));
  // when each stage began, in seconds of fighting
  const starts: number[] = [];
  let stage = -1;
  while (f.phase !== 'over') {
    for (const b of bots) b.think();
    f.step();
    if (f.phase === 'fight' && f.brain!.stageIndex !== stage) {
      stage = f.brain!.stageIndex;
      starts[stage] = (f.fightTicks - 1) / TICK_RATE;
    }
  }
  return { r: f.result!, starts, key: f.brain!.timeKey };
}

describe('時律機神殿', () => {
  const stages = scriptFor('ultimate', true)!.stages!;

  it('has one stage for each name the menus show, each fighting stage with its own enrage', () => {
    expect(stages.map((s) => s.script.phases[0]!.name)).toEqual(encounterById('ultimate').stages);
    expect(stages.map((s) => s.enrageAt)).toEqual([165, undefined, 195, undefined, 200, 230]);
    expect(stages.reduce((n, s) => n + s.hp, 0)).toBeCloseTo(1);
  });

  it('is cleared by computer parties of 1 tank, 1 healer and 2 DPS, each stage with time to spare', () => {
    const parties: JobId[][] = [
      ['guardian', 'priest', 'brawler', 'ranger'],
      ['berserker', 'warden', 'lancer', 'sorcerer'],
      ['guardian', 'warden', 'summoner', 'lancer'],
    ];
    let clears = 0;
    let keys = 0;
    for (const jobs of parties) {
      for (const seed of [1, 2]) {
        const { r, starts, key } = party(jobs, seed);
        if (key) keys++;
        if (r.reason !== 'clear') continue;
        clears++;
        expect(starts, jobs.join(',')).toHaveLength(6);
        const took = [starts[1]! - starts[0]!, starts[3]! - starts[2]!, starts[5]! - starts[4]!, r.time - starts[5]!];
        const [p1, p2, p3, p4] = took;
        expect(p1, `${jobs.join(',')} P1`).toBeLessThan(165 - 15);
        expect(p2, `${jobs.join(',')} P2`).toBeLessThan(195 - 10);
        expect(p3, `${jobs.join(',')} P3`).toBeLessThan(200 - 10);
        expect(p4, `${jobs.join(',')} P4`).toBeLessThan(230 - 10);
        // and not trivially fast either
        expect(Math.min(p1!, p2!, p3!, p4!)).toBeGreaterThan(90);
      }
    }
    expect(clears).toBeGreaterThanOrEqual(5);
    expect(keys).toBeGreaterThanOrEqual(5);
  }, 600_000);

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
