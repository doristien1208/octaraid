import { describe, expect, it } from 'vitest';
import { RULES, TICK_RATE } from '../shared/constants';
import { ENCOUNTERS, encounterById } from '../shared/encounters';
import { angleDiff, clampToArena, spawnPoints } from '../shared/sim/arena';
import { Fight } from '../shared/sim/fight';

const roster = [
  { id: 'a', name: 'A', job: 'guardian' as const },
  { id: 'b', name: 'B', job: 'priest' as const },
];

describe('arena', () => {
  it('keeps players inside a round arena', () => {
    const a = encounterById('colossus').arena;
    const [x, z] = clampToArena(a, 30, 0);
    expect(x).toBeCloseTo(a.size - RULES.playerRadius);
    expect(z).toBe(0);
    expect(clampToArena(a, 3, 4)).toEqual([3, 4]);
  });

  it('keeps players inside a square arena', () => {
    const a = encounterById('gatekeeper').arena;
    expect(clampToArena(a, 50, -50)).toEqual([a.size - RULES.playerRadius, -(a.size - RULES.playerRadius)]);
  });

  it('spawns everyone inside every arena, south of the boss', () => {
    for (const e of ENCOUNTERS) {
      for (const [x, z] of spawnPoints(e.arena, 8)) {
        expect(clampToArena(e.arena, x, z)).toEqual([x, z]);
        expect(z).toBeGreaterThan(0);
      }
    }
  });

  it('measures the short way round between two angles', () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDiff(3, -3)).toBeCloseTo(2 * Math.PI - 6);
  });
});

describe('fight', () => {
  it('counts down 10 seconds, then fights until the enrage', () => {
    const f = new Fight(encounterById('colossus'), false, roster, 1, { calm: true, practice: true });
    expect(f.snapshot().ph).toBe(0);
    for (let k = 0; k < RULES.countdown; k++) f.step();
    expect(f.phase).toBe('fight');
    const enrage = encounterById('colossus').times.normal.enrage;
    for (let k = 0; k < enrage * TICK_RATE; k++) f.step();
    expect(f.phase).toBe('over');
    expect(f.result).toMatchObject({ reason: 'enrage', time: enrage, bossHp: 1 });
    expect(f.result!.stats.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('accepts ordinary steps and moves the player', () => {
    const f = new Fight(encounterById('colossus'), false, roster, 1);
    const p = f.players.get('a')!;
    const x0 = p.x;
    let now = 1000;
    for (let k = 0; k < 30; k++) {
      now += 1000 / 30;
      expect(f.move('a', p.x + RULES.moveSpeed / 30, p.z, Math.PI / 2, now)).toBeNull();
      f.step();
    }
    expect(p.x - x0).toBeCloseTo(RULES.moveSpeed, 1);
    expect(f.snapshot().p.find((s) => s.i === 'a')!.m).toBe(1);
  });

  it('cuts a teleport short and tells the client where it really is', () => {
    const f = new Fight(encounterById('colossus'), false, roster, 1);
    const p = f.players.get('a')!;
    f.move('a', p.x, p.z, 0, 1000);
    const before = { x: p.x, z: p.z };
    const fix = f.move('a', p.x, p.z - 15, 0, 1033);
    expect(fix).not.toBeNull();
    const step = Math.hypot(p.x - before.x, p.z - before.z);
    expect(step).toBeLessThan(1.2);
    expect(fix).toEqual([p.x, p.z]);
  });

  it('pulls a player back from the edge', () => {
    const f = new Fight(encounterById('colossus'), false, roster, 1);
    const p = f.players.get('b')!;
    let now = 0;
    // walk south for 5 seconds: the wall at 19.5 m stops the player
    for (let k = 0; k < 150; k++) {
      now += 1000 / 30;
      f.move('b', p.x, p.z + RULES.moveSpeed / 30, 0, now);
    }
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(20 - RULES.playerRadius, 3);
  });
});
