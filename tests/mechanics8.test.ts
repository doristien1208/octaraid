import { describe, expect, it } from 'vitest';
import { RULES, sec } from '../shared/constants';
import { encounterById } from '../shared/encounters';
import type { JobId } from '../shared/jobs';
import type { FightEvent } from '../shared/protocol';
import { beaconMove, type BossScript, type Entry, type MechDef } from '../shared/sim/boss';
import { Fight } from '../shared/sim/fight';

/**
 * What v0.8 added to the boss engine for the ultimate's 時間停止, P3 and P4: time stopping with tied pairs
 * and 加重, 時之鳥 and the judgement crystals (時之鑰, kept through a death), 電漿球 floors, the cross, the
 * rifts taken in turn, beacons that pull and push, the two orders, the floor seen now and struck later, the
 * same for a party with 時之鑰 (未來視), cages taken one each, and busters without 裂盾.
 * Players p0 (tank), p1 (healer), p2, p3 (DPS).
 */
function fight(entries: Entry[], opts: { kind?: BossScript['kind']; jobs?: JobId[]; lethal?: boolean } = {}): Fight {
  const script: BossScript = { kind: opts.kind ?? 'prime', auto: 0, tele: 3, edge: 'wall', enrage: { name: '測試狂暴', cast: 10 }, phases: [{ name: '測試', entries }], lethal: opts.lethal };
  const jobs = opts.jobs ?? ['guardian', 'priest', 'brawler', 'sorcerer'];
  const f = new Fight(encounterById('ultimate'), true, jobs.map((job, k) => ({ id: `p${k}`, name: `P${k}`, job })), 42, { script, hpScale: 1 });
  for (let k = 0; k < RULES.countdown; k++) f.step();
  return f;
}

function run(f: Fight, ticks: number): FightEvent[] {
  const out: FightEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    f.step();
    out.push(...(f.snapshot().ev ?? []));
  }
  return out;
}

const put = (f: Fight, id: string, x: number, z: number) => {
  const p = f.players.get(id)!;
  p.x = x;
  p.z = z;
};
const one = (m: MechDef, cast = 2): Entry[] => [{ at: 1, name: '測試招', cast, mechs: [m] }];
const after = (cast: number, extra = 0) => sec(1 + cast + extra) + 2;
const has = (f: Fight, id: string, s: string) => f.players.get(id)!.statuses.some((x) => x.id === s);
const holder = (f: Fight, s: string) => [...f.players.values()].find((p) => has(f, p.id, s));
const allDead = (f: Fight) => [...f.players.values()].every((p) => p.dead);
const noneDead = (f: Fight) => [...f.players.values()].every((p) => !p.dead);

describe('時間停止', () => {
  const STASIS: MechDef = { k: 'stasis', bind: 5, apart: 25, near: [2, 3], dmg: 1000, freeze: 3, at: [[-10, -6], [10, -6]] };

  it('freezes everyone; a tied pair apart is down, 加重 struck is down, the nearest are struck', () => {
    const f = fight(one(STASIS, 4));
    run(f, sec(1) + 2);
    const heavy = holder(f, 'heavy')!;
    expect(heavy.role).not.toBe('tank');
    const bound = [...f.players.values()].filter((p) => has(f, p.id, 'bound'));
    expect(bound).toHaveLength(2);
    expect(bound).not.toContain(heavy);
    expect(f.foes.filter((e) => (e.kind === 'ember' || e.kind === 'frost') && e.untargetable)).toHaveLength(2);
    // the pair apart; 加重 right by 熾核's image; the fourth far from both
    const [a, b] = bound;
    const fourth = [...f.players.values()].find((p) => p !== heavy && !bound.includes(p))!;
    put(f, a!.id, 0, 15);
    put(f, b!.id, 0, -15);
    put(f, heavy.id, -9, -6);
    put(f, fourth.id, 15, 10);
    // the cast ends 5 s in: frozen then, struck 0.8 s later
    run(f, sec(5));
    expect(has(f, fourth.id, 'frozen') || fourth.dead).toBe(true);
    expect(a!.dead && b!.dead).toBe(true);
    expect(heavy.dead).toBe(true);
    expect(fourth.dead).toBe(false);
  });

  it('is cleared with the pair together and 加重 nearest to neither', () => {
    const f = fight(one(STASIS, 4));
    run(f, sec(1) + 2);
    const heavy = holder(f, 'heavy')!;
    const bound = [...f.players.values()].filter((p) => has(f, p.id, 'bound'));
    const fourth = [...f.players.values()].find((p) => p !== heavy && !bound.includes(p))!;
    put(f, bound[0]!.id, -7, -6);
    put(f, bound[1]!.id, -7, -4);
    put(f, fourth.id, 6, 0);
    put(f, heavy.id, -18, 2);
    run(f, sec(7.5));
    expect(noneDead(f)).toBe(true);
    expect(f.foes.filter((e) => !e.gone && (e.kind === 'ember' || e.kind === 'frost'))).toHaveLength(0);
  });
});

describe('起源陣', () => {
  const INCEPTION: MechDef = { k: 'inception', spheres: 2, sphere: { r: 4, dmg: 1000, after: 6, pool: { r: 4, dmg: 1000, time: 6 } }, crystal: { r: 1.2, after: 2 }, bird: 6 };

  it('crystals on 時之鳥 way give 時之鑰, which a death does not take away', () => {
    const f = fight(one(INCEPTION));
    run(f, sec(1) + 2);
    const bird = f.foes.find((e) => e.kind === 'bird')!;
    const path = f.brain!.hazards().find((h) => h.shape.k === 'path')!.shape as { x0: number; z0: number; x1: number; z1: number };
    const carriers = [...f.players.values()].filter((p) => has(f, p.id, 'sphere'));
    expect(carriers.map((p) => p.role)).toContain('tank');
    const droppers = [...f.players.values()].filter((p) => !carriers.includes(p));
    droppers.forEach((p, k) => put(f, p.id, path.x0 + (path.x1 - path.x0) * (0.25 + 0.3 * k), path.z0 + (path.z1 - path.z0) * (0.25 + 0.3 * k)));
    // the carriers far apart, away from everyone
    put(f, carriers[0]!.id, 18, 0);
    put(f, carriers[1]!.id, -18, 0);
    f.brain!.foe.speed = 0;
    const ev = run(f, sec(12));
    expect(bird.gone).toBe(true);
    expect(ev.some((e) => e.k === 'boss' && e.m === 'key' && e.n === '時之鑰')).toBe(true);
    expect(f.brain!.timeKey).toBe(true);
    const p = f.players.get('p3')!;
    f.kill(p);
    expect(p.statuses.some((s) => s.id === 'timeKey')).toBe(true);
  });

  it('two gravity floors touching take everyone down', () => {
    const f = fight(one(INCEPTION));
    run(f, sec(1) + 2);
    const carriers = [...f.players.values()].filter((p) => has(f, p.id, 'sphere'));
    for (const p of f.players.values()) put(f, p.id, 15, 0);
    put(f, carriers[0]!.id, 0, 10);
    put(f, carriers[1]!.id, 0, 4);
    f.brain!.foe.speed = 0;
    const ev = run(f, sec(8));
    expect(ev.some((e) => e.k === 'boss' && e.n === '重力崩塌')).toBe(true);
    expect(allDead(f)).toBe(true);
  });
});

describe('P3', () => {
  it('時隙陣: an empty rift takes everyone down (懺悔); a second step inside 時隙 is that player\'s end', () => {
    const f = fight(one({ k: 'wormhole', steps: 4, gap: 3, first: 2, r: 3, dist: 9 }));
    for (const p of f.players.values()) put(f, p.id, 0, 18);
    run(f, after(2, 2.2));
    expect(allDead(f)).toBe(true);
    const g = fight(one({ k: 'wormhole', steps: 4, gap: 3, first: 2, r: 3, dist: 9 }));
    run(g, sec(1) + 2);
    const rifts = g.brain!.hazards().filter((h) => h.shape.k === 'circle' && h.soak !== undefined).sort((a, b) => a.end - b.end);
    const at = (k: number) => rifts[k]!.shape as { x: number; z: number };
    for (const p of g.players.values()) put(g, p.id, 0, 18);
    put(g, 'p2', at(0).x, at(0).z);
    run(g, sec(2 + 2) + 4);
    expect(has(g, 'p2', 'warp')).toBe(true);
    put(g, 'p2', at(1).x, at(1).z);
    run(g, sec(3));
    expect(g.players.get('p2')!.dead).toBe(true);
  });

  it('十字聖禮: two strips crossing at the boss', () => {
    const f = fight(one({ k: 'cross', w: 6, dmg: 3000 }));
    const boss = f.brain!.foe;
    boss.speed = 0;
    put(f, 'p0', boss.x, boss.z + 10);
    put(f, 'p1', boss.x + 10, boss.z);
    put(f, 'p2', boss.x + 8, boss.z + 8);
    put(f, 'p3', boss.x - 8, boss.z - 8);
    const ev = run(f, after(2));
    const hit = (id: string) => ev.some((e) => e.k === 'dmg' && e.t === id && !e.s?.startsWith('p'));
    expect(hit('p0') && hit('p1')).toBe(true);
    expect(hit('p2') || hit('p3')).toBe(false);
  });

  it('懲戒與聖槍: four hits on whoever is top, no 裂盾', () => {
    const f = fight(one({ k: 'buster', dmg: 1000, hits: 4, gap: 1, noCrack: true }));
    const ev = run(f, after(2, 4));
    expect(ev.filter((e) => e.k === 'dmg' && e.t === 'p0' && !e.s?.startsWith('p')).length).toBe(4);
    expect(has(f, 'p0', 'crack')).toBe(false);
  });
});

describe('P4', () => {
  it('終焉之言: pulled to the light or pushed from the dark, 10 m', () => {
    expect(beaconMove(0, 0, true, [0, 12], [0, -12], 10)).toEqual([0, 10]);
    expect(beaconMove(0, 10, true, [0, 12], [0, -12], 10)).toEqual([0, 12]);
    const [x, z] = beaconMove(0, -6, false, [0, 12], [0, -12], 10);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(4);
    const f = fight(one({ k: 'beacons', dist: 10, delay: 3, at: 12 }));
    run(f, sec(1) + 2);
    const light = f.foes.find((e) => e.kind === 'lightBeacon')!;
    const pulled = holder(f, 'lightPull')!;
    put(f, pulled.id, 0, 0);
    run(f, after(2, 3.5) - sec(1));
    expect(Math.hypot(pulled.x - light.x * (10 / 12), pulled.z - light.z * (10 / 12))).toBeLessThan(0.3);
  });

  it('靜止命令 then 行動命令: the still ones are struck by the second', () => {
    const f = fight(one({ k: 'order', move: false, dmg: 3000, then: 2 }));
    const ev = run(f, after(2, 2.5));
    const hits = ev.filter((e) => e.k === 'dmg' && !e.s?.startsWith('p') && e.n === '測試招').length;
    // nobody moved: the stillness check passes, the move check strikes all four
    expect(hits).toBe(4);
  });

  it('全能審判: the squares are seen now (not as hazards) and strike later, unmarked, in the same places', () => {
    const f = fight(one({ k: 'judgment', rounds: 1, per: 3, gap: 1, delay: 4, cell: 12, dmg: 3000 }, 3));
    run(f, sec(1) + 2);
    const seen = f.brain!.visible().filter((t) => t.preview);
    expect(seen).toHaveLength(3);
    expect(f.brain!.hazards().some((h) => h.preview)).toBe(false);
    const real = f.brain!.hazards().filter((h) => h.shape.k === 'rect');
    expect(real).toHaveLength(3);
    expect(real.every((h) => !h.shown)).toBe(true);
    expect(real.map((h) => JSON.stringify(h.shape)).sort()).toEqual(seen.map((t) => JSON.stringify(t.shape)).sort());
  });

  it('未來視: a party holding 時之鑰 sees what is coming; without it nothing shows; it happens the same either way', () => {
    const FATE: MechDef = { k: 'foresee', delay: 6, mechs: [{ k: 'lasers', count: 3, of: 4, w: 11, dmg: 3000 }] };
    const lanes = (key: boolean) => {
      const f = fight(one(FATE, 3));
      f.brain!.timeKey = key;
      run(f, sec(1) + 2);
      const shown = f.brain!.visible().filter((t) => t.preview).length;
      const real = f.brain!.hazards().filter((h) => h.shape.k === 'rect' && !h.shown).map((h) => (h.shape as { x: number }).x);
      return { shown, real };
    };
    const a = lanes(true);
    const b = lanes(false);
    expect(a.shown).toBe(3);
    expect(b.shown).toBe(0);
    expect(a.real).toHaveLength(3);
    expect(a.real.sort()).toEqual(b.real.sort());
  });

  it('時間牢獄: each cage needs one player who has not taken one', () => {
    const f = fight(one({ k: 'cages', count: 4, gap: 1.5, r: 3, dist: 12 }));
    run(f, sec(1) + 2);
    const cages = f.brain!.hazards().filter((h) => h.cage).sort((a, b) => a.end - b.end).map((h) => h.shape as { x: number; z: number });
    expect(cages).toHaveLength(4);
    // one each, in turn
    ['p1', 'p0', 'p2', 'p3'].forEach((id, k) => put(f, id, cages[k]!.x, cages[k]!.z));
    run(f, after(2, 5));
    expect(noneDead(f)).toBe(true);
    const g = fight(one({ k: 'cages', count: 4, gap: 1.5, r: 3, dist: 12 }));
    run(g, sec(1) + 2);
    // the same player in the first two: the second has nobody fresh
    const c2 = g.brain!.hazards().filter((h) => h.cage).sort((a, b) => a.end - b.end).map((h) => h.shape as { x: number; z: number });
    put(g, 'p1', c2[0]!.x, c2[0]!.z);
    run(g, after(2) - sec(1) - 2 + 2);
    put(g, 'p1', c2[1]!.x, c2[1]!.z);
    run(g, sec(2));
    expect(allDead(g)).toBe(true);
  });
});
