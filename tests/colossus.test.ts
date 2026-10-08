import { describe, expect, it } from 'vitest';
import { RULES, TICK_RATE } from '../shared/constants';
import { encounterById } from '../shared/encounters';
import type { JobId } from '../shared/jobs';
import { hpScale } from '../shared/party';
import type { FightEvent } from '../shared/protocol';
import { Bot, spotFor } from '../shared/sim/bot';
import { Fight } from '../shared/sim/fight';

/**
 * 崩岩巨像 end to end (section 九: whole-fight simulation with dev bots). The bots read every attack and
 * play cleanly, so they should clear well inside the target time; a party that stands still must not.
 */
const enc = encounterById('colossus');

function party(jobs: JobId[], hard: boolean, seed: number) {
  const roster = jobs.map((job, k) => ({ id: `p${k}`, name: job, job }));
  const f = new Fight(enc, hard, roster, seed, { hpScale: hpScale(jobs) });
  const bots = roster.map((r) => new Bot(f, r.id, spotFor(r.job, roster.filter((x) => x.job === r.job).indexOf(r))));
  const casts: [number, string][] = [];
  while (f.phase !== 'over') {
    for (const b of bots) b.think();
    f.step();
    for (const e of f.snapshot().ev ?? []) if (e.k === 'bcast') casts.push([Math.round(f.fightTicks / TICK_RATE), e.n]);
  }
  const r = f.result!;
  return { r, casts, deaths: r.stats.reduce((n, s) => n + s.deaths, 0), mistakes: r.stats.reduce((n, s) => n + s.mistakes, 0) };
}

describe('崩岩巨像', () => {
  it('opens with the planned Normal timeline', () => {
    // an untouchable party that does not attack: the first two minutes play out as written
    const roster = (['guardian', 'priest', 'brawler', 'sorcerer'] as JobId[]).map((job, k) => ({ id: `p${k}`, name: job, job }));
    const f = new Fight(enc, false, roster, 3, {});
    for (const p of f.players.values()) p.statuses.push({ id: 'fortress', src: p.id, until: -1, v: 0 });
    const casts: [number, string][] = [];
    while (f.fightTicks < 135 * TICK_RATE) {
      f.step();
      for (const e of f.snapshot().ev ?? []) if (e.k === 'bcast') casts.push([Math.round(f.fightTicks / TICK_RATE), e.n]);
    }
    expect(casts).toEqual([
      [8, '大地震'],
      [18, '粉碎重拳'],
      [28, '落石'],
      [42, '岩拳橫掃'],
      [52, '碎岩彈'],
      [65, '岩山崩落'],
      [74, '共擔落岩'],
      [85, '地裂線'],
      [98, '岩環震'],
      [110, '大地震'],
      [120, '粉碎重拳'], // at 2:00 the loop carries on from 0:18
      [130, '落石'],
    ]);
  });

  it('clears Normal with any party from 1 to 8, nobody going down', () => {
    const target = enc.times.normal.target;
    for (const jobs of [
      ['guardian', 'priest', 'brawler', 'sorcerer'],
      ['berserker', 'warden', 'lancer', 'ranger'],
      ['guardian', 'priest', 'ranger'],
      ['guardian', 'brawler', 'sorcerer'],
      ['priest', 'brawler', 'sorcerer'],
      ['sorcerer'],
      ['guardian', 'berserker', 'priest', 'warden', 'brawler', 'lancer', 'ranger', 'sorcerer'],
    ] as JobId[][]) {
      const { r, deaths, mistakes } = party(jobs, false, 7);
      expect(r.reason, jobs.join(',')).toBe('clear');
      expect(deaths, jobs.join(',')).toBe(0);
      expect(mistakes, jobs.join(',')).toBeLessThanOrEqual(2);
      expect(r.time, jobs.join(',')).toBeLessThan(target * 0.8);
      expect(r.time, jobs.join(',')).toBeGreaterThan(target * 0.5);
    }
  }, 120_000);

  it('goes through all three phases', () => {
    const { casts } = party(['guardian', 'priest', 'brawler', 'sorcerer'], false, 7);
    const names = casts.map(([, n]) => n);
    expect(names).toContain('岩崩召喚');
    expect(names.indexOf('岩崩召喚')).toBeGreaterThan(names.indexOf('大地震'));
  }, 60_000);

  it('is clearable on Hard by a 4-player party with a tank and a healer', () => {
    const target = enc.times.hard.target;
    let clears = 0;
    for (const jobs of [
      ['guardian', 'priest', 'brawler', 'sorcerer'],
      ['berserker', 'warden', 'lancer', 'ranger'],
    ] as JobId[][]) {
      for (const seed of [1, 2]) {
        const { r } = party(jobs, true, seed);
        if (r.reason === 'clear') {
          clears++;
          expect(r.time).toBeLessThan(target * 0.9);
        }
      }
    }
    expect(clears).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it('a lone tank lives through the Hard double 粉碎重拳 (the big cooldown goes up just before the first hit)', () => {
    // the parties the offline practice makes for a ranger and a sorcerer (the tank is not first)
    for (const jobs of [
      ['ranger', 'guardian', 'priest', 'brawler'],
      ['sorcerer', 'berserker', 'warden', 'lancer'],
    ] as JobId[][]) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const roster = jobs.map((job, k) => ({ id: `p${k}`, name: job, job }));
        const f = new Fight(enc, true, roster, seed, { hpScale: hpScale(jobs) });
        const bots = roster.map((r) => new Bot(f, r.id, spotFor(r.job, 0)));
        const deaths: string[] = [];
        while (f.fightTicks < 30 * TICK_RATE) {
          for (const b of bots) b.think();
          f.step();
          for (const e of f.snapshot().ev ?? []) if (e.k === 'die') deaths.push(e.i);
        }
        expect(deaths, `${jobs[1]} seed ${seed}`).not.toContain('p1');
      }
    }
  }, 60_000);

  it('beats a party that stands still', () => {
    const roster = (['guardian', 'priest', 'brawler', 'sorcerer'] as JobId[]).map((job, k) => ({ id: `p${k}`, name: job, job }));
    for (const hard of [false, true]) {
      const f = new Fight(enc, hard, roster, 5, { hpScale: 1 });
      while (f.phase !== 'over') f.step();
      expect(['wipe', 'enrage']).toContain(f.result!.reason);
      expect(f.result!.time).toBeLessThanOrEqual((hard ? enc.times.hard : enc.times.normal).enrage);
    }
    expect(RULES.lbClean).toBe(5);
  }, 60_000);

  it('marks every attack it can be hit by: Normal shows each one at least 3 s ahead', () => {
    const roster = (['guardian', 'priest', 'brawler', 'sorcerer'] as JobId[]).map((job, k) => ({ id: `p${k}`, name: job, job }));
    const f = new Fight(enc, false, roster, 9, {});
    for (const p of f.players.values()) p.statuses.push({ id: 'fortress', src: p.id, until: -1, v: 0 });
    const shortest = new Map<number, number>();
    while (f.fightTicks < 125 * TICK_RATE) {
      f.step();
      for (const t of f.snapshot().tg ?? []) if (t.c === 'o') shortest.set(t.i, Math.max(shortest.get(t.i) ?? 0, t.n));
      void ([] as FightEvent[]);
    }
    expect(shortest.size).toBeGreaterThan(10);
    for (const n of shortest.values()) expect(n).toBeGreaterThanOrEqual(3 * TICK_RATE);
  });
});
