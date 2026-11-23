import { describe, expect, it } from 'vitest';
import { RULES, sec } from '../shared/constants';
import { encounterById } from '../shared/encounters';
import type { JobId } from '../shared/jobs';
import type { FightEvent } from '../shared/protocol';
import type { BossScript, Entry, MechDef, Twin } from '../shared/sim/boss';
import { Fight } from '../shared/sim/fight';

/**
 * What v0.7 added to the boss engine for the ultimate (時律機神殿): stages fought one after another with their
 * own HP shares and enrages, a pair whose HP must stay even, the core dragged to (or away from) its hand,
 * a buster that comes back inside its own 水抗降低, 窒息, marks passed by touch and checked by 宣判, stacks
 * passed on, dolls fed to the boss, 排氣 and 以太, a shield that only breaks from in front, rings for
 * exactly 2, an ice block to hide behind, two bosses that must fall together, orbs drifting to where the
 * boss stood. Players p0 (tank), p1 (healer), p2, p3 (DPS) unless a test says otherwise.
 */
function fight(entries: Entry[], opts: { twin?: Twin; kind?: BossScript['kind']; jobs?: JobId[]; lethal?: boolean } = {}): Fight {
  const script: BossScript = {
    kind: opts.kind ?? 'liquid',
    auto: 0,
    tele: 3,
    edge: 'wall',
    enrage: { name: '測試狂暴', cast: 10 },
    phases: [{ name: '測試', entries }],
    twin: opts.twin,
    lethal: opts.lethal,
  };
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
const spreadOut = (f: Fight, r = 14) => {
  put(f, 'p0', 0, r);
  put(f, 'p1', r, 0);
  put(f, 'p2', 0, -r);
  put(f, 'p3', -r, 0);
};
const one = (m: MechDef, cast = 2, extra: Partial<Entry> = {}): Entry[] => [{ at: 1, name: '測試招', cast, mechs: [m], ...extra }];
const after = (cast: number, extra = 0) => sec(1 + cast + extra) + 2;
const has = (f: Fight, id: string, s: string) => f.players.get(id)!.statuses.some((x) => x.id === s);
const dead = (f: Fight, id: string) => f.players.get(id)!.dead;
const HAND: Twin = { kind: 'hand', at: [0, -12], share: 0.5 };

describe('stages (the ultimate)', () => {
  const stage = (kind: BossScript['kind'], extra: Partial<BossScript> = {}): BossScript => ({
    kind,
    auto: 0,
    tele: 3,
    edge: 'wall',
    enrage: { name: `${kind}狂暴`, cast: 5 },
    phases: [{ name: kind, entries: [] }],
    ...extra,
  });
  const staged = (start = 0) => {
    const script: BossScript = {
      ...stage('liquid'),
      phases: [],
      stages: [
        { script: stage('liquid'), hp: 0.4, enrageAt: 60 },
        { script: stage('frost', { phases: [{ name: '轉場', untargetable: true, entries: [] }] }), hp: 0, time: 5 },
        { script: stage('ember'), hp: 0.6, enrageAt: 30 },
      ],
    };
    const jobs: JobId[] = ['guardian', 'priest', 'brawler', 'sorcerer'];
    const f = new Fight(encounterById('ultimate'), true, jobs.map((job, k) => ({ id: `p${k}`, name: `P${k}`, job })), 1, { script, hpScale: 1, stage: start });
    for (let k = 0; k < RULES.countdown; k++) f.step();
    return f;
  };
  const total = encounterById('ultimate').hp.hard;

  it('fights them one after another, each boss with its share of the HP; an intermission cannot be hurt and moves on by itself', () => {
    const f = staged();
    f.step();
    const b = f.brain!;
    expect(b.foe.kind).toBe('liquid');
    expect(b.foe.maxHp).toBe(Math.round(total * 0.4));
    expect(f.snapshot().sg?.slice(0, 1)).toEqual([0]);
    b.foe.hp = 0;
    run(f, 2);
    expect(f.phase).toBe('fight');
    expect(b.foe.kind).toBe('frost');
    expect(f.hittable(b.foe)).toBe(false);
    run(f, sec(5) + 2);
    expect(b.foe.kind).toBe('ember');
    expect(b.foe.maxHp).toBe(Math.round(total * 0.6));
    expect(f.foes.filter((e) => !e.gone).map((e) => e.kind)).toEqual(['ember']);
    b.foe.hp = 0;
    run(f, 2);
    expect(f.result?.reason).toBe('clear');
    expect(f.result?.stage).toBe(2);
  });

  it('each stage has its own enrage; offline practice can start from a later one', () => {
    const f = staged(2);
    f.step();
    expect(f.brain!.foe.kind).toBe('ember');
    run(f, sec(29));
    expect(f.phase).toBe('fight');
    run(f, sec(2));
    expect(f.result?.reason).toBe('enrage');
    expect(f.result?.stage).toBe(2);
  });
});

describe('P1 水銀核心', () => {
  it('痛苦之手: the core and its hand more than 5% apart takes everyone down', () => {
    const f = fight(one({ k: 'balance', gap: 0.05, dmg: 999_999 }), { twin: HAND });
    const [core, hand] = [f.brain!.foe, f.brain!.twin!];
    expect(hand.maxHp).toBe(core.maxHp);
    core.hp = Math.round(core.maxHp * 0.5);
    hand.hp = Math.round(hand.maxHp * 0.53);
    run(f, after(2));
    expect([...f.players.values()].every((p) => !p.dead)).toBe(true);
    const g = fight(one({ k: 'balance', gap: 0.05, dmg: 999_999 }), { twin: HAND });
    g.brain!.foe.hp = Math.round(g.brain!.foe.maxHp * 0.5);
    g.brain!.twin!.hp = Math.round(g.brain!.twin!.maxHp * 0.56);
    run(g, after(2));
    expect([...g.players.values()].every((p) => p.dead)).toBe(true);
  });

  it('合掌 wants the core by its hand, 握拳 well away from it', () => {
    for (const [near, x, z, ok] of [
      [true, 0, -2, true],
      [true, 0, 8, false],
      [false, 0, 12, true],
      [false, 0, 0, false],
    ] as const) {
      const f = fight(one({ k: 'pose', near, dist: near ? 8 : 15, dmg: 999_999 }, 3), { twin: HAND });
      put(f, 'p0', x, z + 4);
      run(f, sec(2));
      const core = f.brain!.foe;
      core.x = x;
      core.z = z;
      run(f, after(3) - sec(2));
      expect(dead(f, 'p1'), `${near} ${z}`).toBe(!ok);
    }
  });

  it('流體揮擊 again inside its 水抗降低 takes all of the HP; the invulnerability keeps the tank up', () => {
    const entries: Entry[] = [
      { at: 1, name: '流體揮擊', cast: 2, mechs: [{ k: 'buster', dmg: 3000, soak: 30 }] },
      { at: 6, name: '流體揮擊', cast: 2, mechs: [{ k: 'buster', dmg: 3000, soak: 30 }] },
    ];
    const f = fight(entries);
    run(f, after(2));
    expect(has(f, 'p0', 'waterDown')).toBe(true);
    expect(dead(f, 'p0')).toBe(false);
    run(f, sec(6));
    expect(dead(f, 'p0')).toBe(true);
    const g = fight(entries);
    run(g, after(2) + sec(2));
    expect(g.use('p0', 3)).toBe('ok'); // 不動要塞
    run(g, sec(5));
    expect(dead(g, 'p0')).toBe(false);
  });

  it('窒息: a DPS drops to half and must be healed to full in time', () => {
    const f = fight(one({ k: 'throttle', count: 1, time: 5 }));
    run(f, after(2));
    const choked = [...f.players.values()].find((p) => has(f, p.id, 'throttle'))!;
    expect(choked.role).toBe('dps');
    expect(choked.hp).toBe(Math.round(f.maxHp(choked) * 0.5));
    run(f, sec(5));
    expect(choked.dead).toBe(true);
    const g = fight(one({ k: 'throttle', count: 1, time: 5 }));
    run(g, after(2));
    const h = [...g.players.values()].find((p) => has(g, p.id, 'throttle'))!;
    h.hp = g.maxHp(h);
    run(g, 2);
    expect(has(g, h.id, 'throttle')).toBe(false); // healed to full: it goes at once
    run(g, sec(5));
    expect(h.dead).toBe(false);
  });

  it('獵殺人偶: walked into the boss below 25% it is absorbed for a little damage on everyone; healthier, it overloads', () => {
    const dolls = (): Entry[] =>
      one(
        {
          k: 'adds',
          kind: 'doll',
          at: [[15, 0]],
          hp: 10_000,
          auto: 0,
          time: 60,
          boom: 999_999,
          onPlayers: true,
          floor: true,
          feed: { pct: 0.25, dmg: 1500, fail: 999_999 },
        },
        1,
      );
    const f = fight(dolls(), { twin: HAND });
    spreadOut(f);
    run(f, after(1));
    const doll = f.foes.find((e) => e.kind === 'doll')!;
    expect(f.topOf(doll)?.role).not.toBe('tank');
    // it cannot be killed
    doll.hp = doll.minHp!;
    expect(doll.minHp).toBe(1);
    doll.hp = 2000;
    const core = f.brain!.foe;
    doll.x = core.x + core.r;
    doll.z = core.z;
    const ev = run(f, 2);
    expect(ev.some((e) => e.k === 'boss' && e.n === '回收')).toBe(true);
    expect(doll.gone).toBe(true);
    expect([...f.players.values()].every((p) => !p.dead && p.hp === f.maxHp(p) - 1500)).toBe(true);
    const g = fight(dolls(), { twin: HAND });
    spreadOut(g);
    run(g, after(1));
    const d2 = g.foes.find((e) => e.kind === 'doll')!;
    const hand = g.brain!.twin!;
    d2.x = hand.x;
    d2.z = hand.z + hand.r;
    expect(run(g, 2).some((e) => e.k === 'boss' && e.n === '過載')).toBe(true);
    expect([...g.players.values()].every((p) => p.dead)).toBe(true);
  });

  it('排氣: hit a second time while 以太 lasts is down', () => {
    const f = fight(
      one(
        { k: 'adds', kind: 'doll', at: [[0, 10]], hp: 999_999, auto: 0, time: 60, boom: 0, attack: { k: 'exhaust', r: 4, dmg: 1000, every: 5, first: 1 } },
        1,
      ),
    );
    spreadOut(f, 15);
    run(f, after(1));
    const doll = f.foes.find((e) => e.kind === 'doll')!;
    doll.speed = 0;
    put(f, 'p2', doll.x + 1, doll.z);
    run(f, sec(4.5));
    expect(has(f, 'p2', 'aether')).toBe(true);
    expect(dead(f, 'p2')).toBe(false);
    put(f, 'p2', doll.x + 1, doll.z);
    run(f, sec(5.5));
    expect(dead(f, 'p2')).toBe(true);
  });

  it('栓塞: an orb reaching where the boss stood takes everyone down; dragged away, it only hurts whoever it touches', () => {
    const orbs = one({ k: 'embolus', count: 1, r: 2.5, step: 4, gap: 0.5, dmg: 3000 }, 1);
    const f = fight(orbs);
    spreadOut(f, 18);
    put(f, 'p0', 0, 4.5);
    run(f, sec(10));
    expect([...f.players.values()].every((p) => p.dead)).toBe(true);
    const g = fight(orbs);
    spreadOut(g, 18);
    run(g, after(1));
    const core = g.brain!.foe;
    core.speed = 0;
    core.x = 0;
    core.z = 12;
    put(g, 'p0', 0, 16);
    run(g, sec(10));
    expect([...g.players.values()].some((p) => !p.dead)).toBe(true);
    expect(core.hp).toBeGreaterThan(0);
  });
});

describe('P2 熾核與凍核', () => {
  const NISI = one({ k: 'nisi', check: 6, dot: 0 }, 1);
  const holders = (f: Fight) => {
    const of = (id: string) => [...f.players.values()].find((p) => has(f, p.id, id))!;
    return { a: of('nisiA'), b: of('nisiB'), da: of('decreeA'), db: of('decreeB') };
  };

  it('判決傳遞: marks pass by touch to whoever must hold them at 宣判, and all is well', () => {
    const f = fight(NISI);
    spreadOut(f, 15);
    run(f, after(1));
    const { a, b, da, db } = holders(f);
    expect([a.role, b.role]).toEqual(['dps', 'dps']);
    put(f, a.id, da.x + 0.5, da.z);
    run(f, 2);
    expect(has(f, da.id, 'nisiA')).toBe(true);
    expect(has(f, a.id, 'nisiCd')).toBe(true);
    put(f, a.id, 0, 0);
    put(f, b.id, db.x + 0.5, db.z);
    run(f, 2);
    put(f, b.id, 0, -8);
    run(f, sec(6));
    expect([...f.players.values()].every((p) => !p.dead)).toBe(true);
    expect([...f.players.values()].some((p) => has(f, p.id, 'nisiA') || has(f, p.id, 'decreeA'))).toBe(false);
  });

  it('α touching β takes both down; marks on the wrong people at 宣判 take everyone down', () => {
    const f = fight(NISI);
    spreadOut(f, 15);
    run(f, after(1));
    const { a, b } = holders(f);
    put(f, a.id, 3, 3);
    put(f, b.id, 3.5, 3);
    run(f, 2);
    expect(a.dead && b.dead).toBe(true);
    const g = fight(NISI);
    spreadOut(g, 15);
    run(g, after(1) + sec(6));
    expect([...g.players.values()].every((p) => p.dead)).toBe(true);
  });

  it('壓縮水 wants 3 or more and 壓縮雷 exactly 2, each passed on to someone in it who has not held it', () => {
    const f = fight(one({ k: 'compressed', rounds: 2, gap: 2, dmg: 3000 }, 1));
    spreadOut(f, 15);
    run(f, after(1));
    const water = [...f.players.values()].find((p) => has(f, p.id, 'water'))!;
    const bolt = [...f.players.values()].find((p) => has(f, p.id, 'bolt'))!;
    expect(water.role).toBe('healer');
    expect(bolt.role).toBe('dps');
    // 水: three in it, the 雷 holder among them (it cannot take 水)
    const third = [...f.players.values()].find((p) => p !== water && p !== bolt && p.role !== 'tank')!;
    put(f, bolt.id, water.x + 1, water.z);
    put(f, third.id, water.x, water.z + 1);
    run(f, sec(2));
    expect(has(f, water.id, 'waterDown')).toBe(true);
    expect(has(f, third.id, 'water')).toBe(true);
    expect(water.hp).toBe(f.maxHp(water) - 3000);
    // 雷 alone: twice the damage on its holder
    put(f, bolt.id, -15, 0);
    run(f, sec(2));
    expect(bolt.hp).toBe(f.maxHp(bolt) - 3000 - 6000);
  });

  it('電漿護盾: only hits from in front wear it down, nothing gets through while it holds; still up at the end, everyone pays', () => {
    const shield = (hp: number) =>
      fight(one({ k: 'plasma', hp, time: 6, dmg: 999_999, src: 'twin' }, 1), {
        kind: 'ember',
        twin: { kind: 'frost', at: [0, -14], share: 0.5, together: 15 },
        jobs: ['guardian', 'priest', 'ranger', 'sorcerer'],
      });
    const f = shield(100_000);
    spreadOut(f, 15);
    run(f, after(1));
    const frost = f.brain!.twin!;
    const s = () => frost.statuses.find((x) => x.id === 'plasma');
    expect(s()?.v).toBe(100_000);
    const hp = frost.hp;
    put(f, 'p2', 0, -20); // behind it (it faces the middle)
    expect(f.use('p2', 0, { target: frost.id })).toBe('ok');
    run(f, sec(1));
    expect(s()?.v).toBe(100_000);
    put(f, 'p2', 0, -6); // in front
    run(f, sec(2));
    expect(f.use('p2', 0, { target: frost.id })).toBe('ok');
    run(f, sec(1));
    expect(s()!.v).toBeLessThan(100_000);
    expect(frost.hp).toBe(hp);
    run(f, sec(5));
    expect([...f.players.values()].every((p) => p.dead)).toBe(true);
    // broken in time: nothing happens
    const g = shield(1);
    spreadOut(g, 15);
    run(g, after(1));
    put(g, 'p2', 0, -6);
    expect(g.use('p2', 0, { target: g.brain!.twin!.id })).toBe('ok');
    run(g, sec(7));
    expect([...g.players.values()].every((p) => !p.dead)).toBe(true);
  });

  it('點數環: one too many in a ring for exactly 2 takes everyone in it down', () => {
    const f = fight(one({ k: 'tower', count: 1, need: 2, r: 3, dmg: 1000, fail: 999_999, exact: true }, 2));
    spreadOut(f, 15);
    run(f, sec(1) + 2);
    const ring = f.brain!.hazards().find((h) => h.shape.k === 'tower')!.shape as { x: number; z: number };
    for (const id of ['p1', 'p2', 'p3']) put(f, id, ring.x, ring.z);
    run(f, after(2));
    expect(['p1', 'p2', 'p3'].every((id) => dead(f, id))).toBe(true);
    expect(dead(f, 'p0')).toBe(false);
    const g = fight(one({ k: 'tower', count: 1, need: 2, r: 3, dmg: 1000, fail: 999_999, exact: true }, 2));
    spreadOut(g, 15);
    run(g, sec(1) + 2);
    const r2 = g.brain!.hazards().find((h) => h.shape.k === 'tower')!.shape as { x: number; z: number };
    for (const id of ['p1', 'p2']) put(g, id, r2.x, r2.z);
    run(g, after(2));
    expect([...g.players.values()].every((p) => !p.dead)).toBe(true);
  });

  it('冰塊 hides players from 螺旋槳風 like a pillar', () => {
    const f = fight(
      [
        { at: 1, name: '冰導彈', cast: 1, mechs: [{ k: 'iceblock', time: 20 }] },
        { at: 4, name: '螺旋槳風', cast: 3, mechs: [{ k: 'los', dmg: 999_999, kill: true }] },
      ],
      { kind: 'ember' },
    );
    spreadOut(f, 15);
    run(f, sec(4.5));
    const boss = f.brain!.foe;
    boss.speed = 0;
    const block = f.foes.find((e) => e.kind === 'iceblock')!;
    const d = Math.hypot(block.x - boss.x, block.z - boss.z);
    const behind = (k: number): [number, number] => [boss.x + ((block.x - boss.x) / d) * (d + block.r + k), boss.z + ((block.z - boss.z) / d) * (d + block.r + k)];
    put(f, 'p2', ...behind(1));
    put(f, 'p3', ...behind(2.5));
    const tele = f.snapshot().tg?.find((t) => t.s[0] === 's');
    expect(tele?.s.length).toBe(7); // the ice block goes to the clients as a pillar: x, z, r after the bits
    run(f, sec(4));
    expect(dead(f, 'p2') || dead(f, 'p3')).toBe(false);
    expect(dead(f, 'p1')).toBe(true);
  });

  it('the two must fall together: the one left standing too long takes everyone down', () => {
    const tw: Twin = { kind: 'frost', at: [0, -14], share: 0.5, together: 3 };
    const f = fight([], { kind: 'ember', twin: tw });
    run(f, 2);
    f.brain!.foe.hp = 0;
    run(f, sec(2));
    expect(f.phase).toBe('fight');
    run(f, sec(1.5));
    expect([...f.players.values()].every((p) => p.dead)).toBe(true);
    const g = fight([], { kind: 'ember', twin: tw });
    run(g, 2);
    g.brain!.foe.hp = 0;
    run(g, sec(2));
    g.brain!.twin!.hp = 0;
    run(g, 2);
    expect(g.result?.reason).toBe('clear');
  });
});
