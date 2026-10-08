import { describe, expect, it } from 'vitest';
import type { FoeKind } from '../shared/bosses/foes';
import { RULES, sec } from '../shared/constants';
import { encounterById, type EncounterId } from '../shared/encounters';
import type { JobId } from '../shared/jobs';
import type { FightEvent } from '../shared/protocol';
import { clampToArena } from '../shared/sim/arena';
import type { BossScript, Entry, MechDef, Phase, Twin } from '../shared/sim/boss';
import { Fight } from '../shared/sim/fight';
import { checker, hidden, inside, tileOf } from '../shared/sim/mech';

/**
 * The mechanics M4 adds (section 六): one script per test against the frost witch's arena (pillars) or
 * the gatekeeper's (tiles); players p0 (tank), p1 (healer), p2, p3 (DPS) are put where the test wants.
 */
function fight(
  entries: Entry[],
  opts: { enc?: EncounterId; hard?: boolean; jobs?: JobId[]; kind?: FoeKind; phases?: Phase[]; twin?: Twin; hp?: number } = {},
): Fight {
  const script: BossScript = {
    kind: opts.kind ?? 'colossus',
    auto: 0,
    tele: 3,
    edge: 'wall',
    enrage: { name: '測試狂暴', cast: 10 },
    phases: opts.phases ?? [{ name: '測試', entries }],
    twin: opts.twin,
  };
  const jobs = opts.jobs ?? ['guardian', 'priest', 'brawler', 'sorcerer'];
  const f = new Fight(encounterById(opts.enc ?? 'frostwitch'), !!opts.hard, jobs.map((job, k) => ({ id: `p${k}`, name: `P${k}`, job })), 42, {
    script,
    hpScale: opts.hp ?? 1,
  });
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
const hurt = (ev: FightEvent[], id: string) =>
  ev.filter((e): e is Extract<FightEvent, { k: 'dmg' }> => e.k === 'dmg' && e.t === id && !e.s?.startsWith('p')).reduce((n, e) => n + e.a + (e.ab ?? 0), 0);
const hits = (ev: FightEvent[], id: string) => ev.filter((e) => e.k === 'dmg' && e.t === id && !e.s?.startsWith('p')).length;
const fails = (ev: FightEvent[]) => ev.filter((e): e is Extract<FightEvent, { k: 'fail' }> => e.k === 'fail').map((e) => e.i);
const one = (m: MechDef, cast = 4): Entry[] => [{ at: 1, name: '測試招', cast, mechs: [m] }];
const after = (cast: number, extra = 0) => sec(1 + cast + extra) + 2;
/** everyone well apart on the four cardinal points */
const spreadOut = (f: Fight, r = 14) => {
  put(f, 'p0', 0, r);
  put(f, 'p1', r, 0);
  put(f, 'p2', 0, -r);
  put(f, 'p3', -r, 0);
};

describe('walking bosses', () => {
  it('follows its target until within reach, stands still while casting, and leaps where its script says', () => {
    const f = fight([{ at: 6, name: '跳', cast: 4, mechs: [{ k: 'jump', to: [5, -5] }] }], { kind: 'frostwitch' });
    spreadOut(f, 15);
    const boss = f.brain!.foe;
    run(f, sec(4));
    // the tank (p0) is top of the list from the pull: the witch walked south after it
    expect(boss.z).toBeGreaterThan(5);
    expect(Math.hypot(boss.x - 0, boss.z - 15) - boss.r).toBeLessThanOrEqual(RULES.bossReach + 0.01);
    run(f, sec(3.5)); // the cast has begun: it holds still, wherever the tank goes
    const [x, z] = [boss.x, boss.z];
    put(f, 'p0', 5, -1.5);
    run(f, sec(1));
    expect(Math.hypot(boss.x - x, boss.z - z)).toBeLessThan(0.01);
    run(f, sec(2));
    expect(Math.hypot(boss.x - 5, boss.z + 5)).toBeLessThan(0.01);
  });
});

describe('pillars and line of sight', () => {
  const arena = encounterById('frostwitch').arena;
  const p = arena.pillars![1]!;

  it('keeps players out of a pillar and hides them behind it', () => {
    const [x, z] = clampToArena(arena, p.x, p.z);
    expect(Math.hypot(x - p.x, z - p.z)).toBeGreaterThanOrEqual(p.r + RULES.playerRadius - 1e-6);
    const d = Math.hypot(p.x, p.z);
    expect(hidden(0, 0, arena.pillars!, (p.x / d) * 17, (p.z / d) * 17)).toBe(true);
    expect(hidden(0, 0, arena.pillars!, (p.x / d) * 10, (p.z / d) * 10)).toBe(false); // in front of it
    expect(hidden(0, 0, arena.pillars!, 0, 17)).toBe(false);
  });

  it('hurts whoever the caster can see; on Hard it kills them and shatters the pillars used', () => {
    const behind = (k: number, r = 17): [number, number] => {
      const q = arena.pillars![k]!;
      const d = Math.hypot(q.x, q.z);
      return [(q.x / d) * r, (q.z / d) * r];
    };
    const f = fight(one({ k: 'los', dmg: 9000 }));
    put(f, 'p0', ...behind(0));
    put(f, 'p1', ...behind(1));
    put(f, 'p2', ...behind(1, 18.5));
    put(f, 'p3', 0, 15);
    const ev = run(f, after(4));
    expect(hurt(ev, 'p0') + hurt(ev, 'p1') + hurt(ev, 'p2')).toBe(0);
    expect(hurt(ev, 'p3')).toBe(9000);
    expect(fails(ev)).toEqual(['p3']);
    expect(f.pillarsBroken.some((x) => x)).toBe(false);
    const g = fight(one({ k: 'los', dmg: 0, kill: true, shatter: true }), { hard: true });
    put(g, 'p0', ...behind(0));
    put(g, 'p1', ...behind(0, 18.5));
    put(g, 'p2', ...behind(2));
    put(g, 'p3', 0, 15);
    run(g, after(4));
    expect(g.players.get('p3')!.dead).toBe(true);
    expect(g.players.get('p0')!.dead).toBe(false);
    expect(g.pillarsBroken).toEqual([true, false, true, false]);
    expect(g.snapshot().pb).toEqual([0, 2]);
  });
});

describe('tethers and towers', () => {
  it('hurts a tethered pair that stays close, and nobody when they pull it apart', () => {
    const f = fight(one({ k: 'tether', pairs: 2, dist: 15, dmg: 6000 }));
    put(f, 'p0', 0, 2);
    put(f, 'p1', 0, 4);
    put(f, 'p2', 1, 2);
    put(f, 'p3', 1, 4);
    const ev = run(f, after(4));
    expect(fails(ev).length).toBe(4);
    const g = fight(one({ k: 'tether', pairs: 2, dist: 15, dmg: 6000 }));
    run(g, sec(1.2));
    const pairs = g.brain!.hazards().flatMap((h) => (h.shape.k === 'tether' ? [[h.shape.a, h.shape.b]] : []));
    expect(pairs.length).toBe(2);
    pairs.forEach(([a, b], k) => {
      put(g, a!, k ? 18 : 0, k ? 0 : 18);
      put(g, b!, k ? -18 : 0, k ? 0 : -18);
    });
    const ev2 = run(g, after(4) - sec(1.2));
    expect(fails(ev2)).toEqual([]);
  });

  it('hurts tower soakers a little, and everyone a lot when a tower is short', () => {
    const f = fight(one({ k: 'tower', count: 2, need: 1, r: 3, dmg: 2000, fail: 6000, ring: 11 }));
    run(f, sec(1.2));
    const towers = f.brain!.hazards().flatMap((h) => (h.shape.k === 'tower' ? [h.shape] : []));
    expect(towers.length).toBe(2);
    put(f, 'p2', towers[0]!.x, towers[0]!.z);
    put(f, 'p3', towers[1]!.x, towers[1]!.z);
    put(f, 'p0', 0, 0);
    put(f, 'p1', 0, 2);
    const ev = run(f, after(4) - sec(1.2));
    expect(hurt(ev, 'p2')).toBe(2000);
    expect(hurt(ev, 'p0')).toBe(0);
    const g = fight(one({ k: 'tower', count: 2, need: 1, r: 3, dmg: 2000, fail: 6000, ring: 11 }));
    for (const id of ['p0', 'p1', 'p2', 'p3']) put(g, id, 0, 0);
    const ev2 = run(g, after(4));
    // two short towers: 6000 each on everyone
    expect(hurt(ev2, 'p0')).toBe(12000);
    expect(hurt(ev2, 'p1')).toBe(12000);
    expect(ev2.some((e) => e.k === 'clean')).toBe(false);
  });
});

describe('rolling, sweeping and freezing', () => {
  it('rolls an exaflare along its lane, one step at a time', () => {
    const f = fight(one({ k: 'exaflare', lanes: 1, r: 4, step: 4, gap: 1, dmg: 4000 }));
    put(f, 'p0', 0, 0); // in the middle of the only lane: hit once, as the circles pass
    put(f, 'p1', 19, 19); // nowhere near it
    put(f, 'p2', -19, 19);
    put(f, 'p3', 19, -19);
    const ev = run(f, after(4, 12));
    // the circles overlap a little along the lane: standing still, two or three of them catch you
    expect(hits(ev, 'p0')).toBeGreaterThanOrEqual(1);
    expect(hits(ev, 'p0')).toBeLessThanOrEqual(3);
    expect(hurt(ev, 'p1')).toBe(0);
  });

  it('catches someone standing still once with a sweeping beam', () => {
    const f = fight(one({ k: 'sweep', beams: 1, deg: 22, turn: 360, time: 8, dmg: 5000 }), { enc: 'gatekeeper' });
    spreadOut(f, 10);
    const ev = run(f, after(4, 9));
    for (const id of ['p0', 'p1', 'p2', 'p3']) expect(hits(ev, id), id).toBe(1);
  });

  it('freezes whoever moves as the freeze check ends, and then drops circles on everyone', () => {
    const f = fight(one({ k: 'freeze', time: 4, drop: { r: 4, dmg: 6000, delay: 2.5 } }));
    spreadOut(f);
    run(f, sec(5) - 1);
    // p3 is walking when it ends; the others stand still
    f.move('p3', -13.8, 0, 0, 1000);
    run(f, 3);
    expect(f.players.get('p3')!.statuses.some((s) => s.id === 'frozen')).toBe(true);
    expect(f.players.get('p1')!.statuses.some((s) => s.id === 'frozen')).toBe(false);
    for (const id of ['p0', 'p1', 'p2']) put(f, id, f.players.get(id)!.x * 0.5, f.players.get(id)!.z * 0.5); // the others step out
    const ev = run(f, sec(3));
    expect(hurt(ev, 'p3')).toBe(6000);
    expect(hurt(ev, 'p1')).toBe(0);
  });
});

describe('aimed attacks', () => {
  it('fans a protean at everyone: their own fan is expected, a second one is a mistake', () => {
    const f = fight(one({ k: 'protean', deg: 40, dmg: 4000 }));
    spreadOut(f, 8);
    const ev = run(f, after(4));
    for (const id of ['p0', 'p1', 'p2', 'p3']) expect(hurt(ev, id)).toBe(4000);
    expect(fails(ev)).toEqual([]);
    const g = fight(one({ k: 'protean', deg: 40, dmg: 4000 }));
    spreadOut(g, 8);
    put(g, 'p3', 0.5, 12); // right behind p0
    const ev2 = run(g, after(4));
    expect(hurt(ev2, 'p3')).toBe(8000);
    expect(hurt(ev2, 'p0')).toBe(8000);
    expect(new Set(fails(ev2))).toEqual(new Set(['p0', 'p3']));
  });

  it('fires numbered strips in order at each marked player', () => {
    const f = fight(one({ k: 'sequence', count: 'all', w: 4, gap: 1.5, dmg: 4000 }));
    spreadOut(f, 10);
    run(f, sec(1.2));
    const order = f.brain!.hazards().flatMap((h) => (h.shape.k === 'num' ? [[h.shape.n, h.on!] as const] : []));
    expect(order.map(([n]) => n).sort()).toEqual([1, 2, 3, 4]);
    const ev = run(f, after(4, 5) - sec(1.2));
    for (const id of ['p0', 'p1', 'p2', 'p3']) expect(hurt(ev, id)).toBe(4000);
    expect(fails(ev)).toEqual([]);
  });

  it('charges through marked players to the edge, hurting whoever is in the way', () => {
    const f = fight(one({ k: 'charge', count: 1, w: 6, dmg: 5000, gap: 2.5 }), { enc: 'twins' });
    run(f, sec(1.2));
    const marked = f.brain!.hazards().find((h) => h.shape.k === 'num')!.on!;
    for (const id of ['p0', 'p1', 'p2', 'p3']) put(f, id, id === marked ? 10 : -10, id === marked ? 0 : 5);
    const bystander = ['p0', 'p1', 'p2', 'p3'].find((id) => id !== marked)!;
    put(f, bystander, 5, 0); // between the boss and the marked player
    const ev = run(f, after(4, 1) - sec(1.2));
    expect(hurt(ev, marked)).toBe(5000);
    expect(hurt(ev, bystander)).toBe(5000);
    expect(fails(ev)).toEqual([bystander]);
    const boss = f.brain!.foe;
    expect(Math.hypot(boss.x, boss.z)).toBeGreaterThan(17); // it ran on to the far edge
  });

  it('drills the top two of the list; on Hard the two must keep apart', () => {
    const f = fight(one({ k: 'drill', n: 2, r: 3, dmg: 6000, apart: true }), { hard: true, jobs: ['guardian', 'berserker', 'priest', 'sorcerer'] });
    put(f, 'p0', 0, 4);
    put(f, 'p1', 1, 4); // the second tank right next to the first: both circles land on both
    put(f, 'p2', 0, 14);
    put(f, 'p3', 14, 0);
    const ev = run(f, after(4));
    expect(hurt(ev, 'p0')).toBe(12000);
    expect(new Set(fails(ev))).toEqual(new Set(['p0', 'p1']));
  });
});

describe('bombs and the floor', () => {
  it('blows a bomb up around its holder: alone it only hurts them', () => {
    const f = fight(one({ k: 'bombs', at: [5], count: 1, r: 8, dmg: 5000, self: 2000 }));
    run(f, sec(1.2));
    const holder = f.players.get(f.brain!.hazards().find((h) => h.shape.k === 'bomb')!.on!)!;
    expect(holder.statuses.some((s) => s.id === 'bomb')).toBe(true);
    for (const id of ['p0', 'p1', 'p2', 'p3']) put(f, id, 0, 0);
    put(f, holder.id, 15, 0);
    const ev = run(f, after(4, 5) - sec(1.2));
    expect(hurt(ev, holder.id)).toBe(2000);
    expect(fails(ev)).toEqual([]);
    const g = fight(one({ k: 'bombs', at: [5], count: 1, r: 8, dmg: 5000, self: 2000 }));
    for (const id of ['p0', 'p1', 'p2', 'p3']) put(g, id, 0, 0);
    const ev2 = run(g, after(4, 5));
    expect(fails(ev2).length).toBe(3);
  });

  it('lights the tiles of a checkerboard: standing on a live one hurts', () => {
    const f = fight(one({ k: 'tiles', patterns: [0], gap: 3, dmg: 5000, tele: 3 }), { enc: 'gatekeeper' });
    const live = checker(6, 0);
    const shape = { size: 18, n: 6 };
    // tile 0 (north-west corner) is live in pattern 0, tile 1 next to it is not
    expect(live[tileOf(shape, -15, -15)]).toBe('1');
    expect(live[tileOf(shape, -9, -15)]).toBe('0');
    put(f, 'p0', -15, -15);
    put(f, 'p1', -9, -15);
    put(f, 'p2', -9, -15);
    put(f, 'p3', -9, -15);
    const ev = run(f, after(4));
    expect(hurt(ev, 'p0')).toBe(5000);
    expect(hurt(ev, 'p1')).toBe(0);
    expect(inside({ k: 'tiles', size: 18, n: 6, cells: live }, -15, -15)).toBe(true);
  });
});

describe('雙子機神', () => {
  const twin: Twin = { kind: 'frost', at: [0, -17], resonance: { dist: 15, every: 5 }, imbalance: { gap: 0.15, every: 5, dmg: 2000 }, fuse: { at: 0.3, kind: 'bipolar' } };
  const phases = (entries: Entry[]): Phase[] => [
    { name: '雙王', untilFused: true, entries },
    { name: '合體', entries: [] },
  ];

  it('splits the HP, resonates when the two stand close, and raid-wides when one is much healthier', () => {
    const f = fight([], { enc: 'twins', kind: 'ember', twin, phases: phases([]) });
    const [a, b] = [f.brain!.foe, f.brain!.twin!];
    expect(a.maxHp + b.maxHp).toBe(encounterById('twins').hp.normal);
    spreadOut(f, 20);
    a.x = 0;
    a.z = -10; // 7 m from the twin
    a.speed = 0;
    run(f, sec(5.5));
    expect(a.statuses.find((s) => s.id === 'resonance')?.v).toBe(1);
    expect(b.statuses.find((s) => s.id === 'resonance')?.v).toBe(1);
    a.hp = Math.round(a.maxHp * 0.6);
    const ev = run(f, sec(5));
    expect(ev.some((e) => e.k === 'boss' && e.n === '失衡')).toBe(true);
  });

  it('stops the first twin at 30% and merges them when both are down to it', () => {
    const f = fight([], { enc: 'twins', kind: 'ember', twin, phases: phases([]) });
    const [a, b] = [f.brain!.foe, f.brain!.twin!];
    a.hp = a.minHp!;
    run(f, 2);
    expect(a.statuses.some((s) => s.id === 'sealed')).toBe(true);
    expect(f.brain!.foe).toBe(a);
    b.hp = b.minHp!;
    const merged = a.minHp! + b.minHp!;
    const ev = run(f, 2);
    expect(ev.some((e) => e.k === 'boss' && e.m === 'fuse')).toBe(true);
    expect(f.brain!.foe.kind).toBe('bipolar');
    expect(f.brain!.foe.hp).toBe(merged);
    expect(f.brain!.current!.name).toBe('合體');
  });

  it('burns one half and then freezes the other', () => {
    const f = fight([{ at: 1, name: '炎冰交錯', cast: 4, mechs: [{ k: 'halves', gap: 3, dmg: 5000 }] }], { enc: 'twins', kind: 'ember', twin, phases: phases([{ at: 1, name: '炎冰交錯', cast: 4, mechs: [{ k: 'halves', gap: 3, dmg: 5000 }] }]) });
    put(f, 'p0', -10, 0);
    put(f, 'p1', 10, 0);
    put(f, 'p2', -10, 5);
    put(f, 'p3', 10, 5);
    const ev = run(f, after(4, 3.5));
    // each side is hit once: the order is random, the result the same
    for (const id of ['p0', 'p1', 'p2', 'p3']) expect(hurt(ev, id)).toBe(5000);
  });

  it('lets each colour share its own stack, and punishes the wrong colour', () => {
    const entries: Entry[] = [{ at: 1, name: '雙色分攤', cast: 4, mechs: [{ k: 'colorStack', r: 4, dmg: 3000 }] }];
    const f = fight([], { enc: 'twins', kind: 'ember', twin, phases: phases(entries) });
    run(f, sec(1.5));
    const stacks = f.brain!.hazards().filter((h) => h.shape.k === 'circle' && (h.color === 'e' || h.color === 'i'));
    expect(stacks.length).toBe(2);
    const red = stacks.find((h) => h.color === 'e')!;
    const blue = stacks.find((h) => h.color === 'i')!;
    put(f, red.on!, 8, 0);
    put(f, blue.on!, -8, 0);
    for (const q of f.players.values()) {
      if (q.id === red.on || q.id === blue.on) continue;
      const isRed = q.statuses.some((s) => s.id === 'red');
      put(f, q.id, isRed ? 8 : -8, 1);
    }
    const ev = run(f, sec(4));
    expect(fails(ev)).toEqual([]);
  });

  it('halves a tank buster that lands on someone who is not a tank', () => {
    const f = fight(one({ k: 'buster', dmg: 8000, rank: 2 }), { jobs: ['guardian', 'priest', 'brawler', 'sorcerer'] });
    spreadOut(f);
    // the brawler second on the list
    f.brain!.foe.enmity.set('p2', 5000);
    f.brain!.foe.enmity.set('p0', 9000);
    const ev = run(f, after(4));
    expect(hurt(ev, 'p2')).toBe(4000);
  });
});
