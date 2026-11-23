import { describe, expect, it } from 'vitest';
import type { FoeKind } from '../shared/bosses/foes';
import { RULES, sec } from '../shared/constants';
import { encounterById, type EncounterId } from '../shared/encounters';
import type { JobId } from '../shared/jobs';
import type { FightEvent } from '../shared/protocol';
import { sheltered, type BossScript, type Entry, type MechDef } from '../shared/sim/boss';
import { Fight } from '../shared/sim/fight';

/**
 * What v0.6 added to the boss engine for the Hard rework (section 六): attacks that should have been
 * dodged taking all of a player's HP, mechanics going off later or chosen at random, telegraphs that only
 * show for a moment, rocks under everyone's feet, a knockback the prison rock stops, bombs that leave
 * ice, fans fired again from memory, drills on the furthest, adds that must fall within a few seconds of
 * each other, and raid-wides that hit twice. Players p0 (tank), p1 (healer), p2, p3 (DPS).
 */
function fight(entries: Entry[], opts: { enc?: EncounterId; hard?: boolean; lethal?: boolean; kind?: FoeKind; edge?: 'wall' | 'cliff'; jobs?: JobId[] } = {}): Fight {
  const script: BossScript = {
    kind: opts.kind ?? 'colossus',
    auto: 0,
    tele: 3,
    edge: opts.edge ?? 'wall',
    enrage: { name: '測試狂暴', cast: 10 },
    phases: [{ name: '測試', entries }],
    lethal: opts.lethal,
  };
  const jobs = opts.jobs ?? ['guardian', 'priest', 'brawler', 'sorcerer'];
  const f = new Fight(encounterById(opts.enc ?? 'colossus'), !!opts.hard, jobs.map((job, k) => ({ id: `p${k}`, name: `P${k}`, job })), 42, { script, hpScale: 1 });
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
const one = (m: MechDef, cast = 4, extra: Partial<Entry> = {}): Entry[] => [{ at: 1, name: '測試招', cast, mechs: [m], ...extra }];
const after = (cast: number, extra = 0) => sec(1 + cast + extra) + 2;
const spreadOut = (f: Fight, r = 14) => {
  put(f, 'p0', 0, r);
  put(f, 'p1', r, 0);
  put(f, 'p2', 0, -r);
  put(f, 'p3', -r, 0);
};

describe('Hard: what should have been dodged takes all of the HP', () => {
  it('a chariot hit takes the whole max HP, so only mitigation keeps a player up', () => {
    const f = fight(one({ k: 'chariot', r: 10, dmg: 3000 }), { lethal: true });
    spreadOut(f, 15);
    put(f, 'p2', 0, -5);
    put(f, 'p0', 0, 5);
    run(f, sec(1));
    expect(f.use('p0', 2)).toBe('ok'); // 堅盾: −30%
    const ev = run(f, after(4));
    expect(f.players.get('p2')!.dead).toBe(true);
    expect(f.players.get('p0')!.dead).toBe(false);
    expect(hurt(ev, 'p0')).toBe(Math.round(14_000 * 0.7));
    // without `lethal` (Normal, or the scripts before v0.6) it is just its damage
    const g = fight(one({ k: 'chariot', r: 10, dmg: 3000 }));
    put(g, 'p2', 0, -5);
    expect(hurt(run(g, after(4)), 'p2')).toBe(3000);
  });
});

describe('mechanics in time', () => {
  it('`later` moves a mechanic after the cast, `either` picks one of two, `memo` hides the telegraphs after a while', () => {
    const f = fight(
      one(
        {
          k: 'later',
          after: 3,
          mech: {
            k: 'either',
            of: [
              { k: 'spread', r: 4, dmg: 1000, count: 'all' },
              { k: 'stack', r: 4, dmg: 1000, groups: 1 },
            ],
          },
        },
        4,
        { memo: 2 },
      ),
    );
    spreadOut(f);
    run(f, sec(1) + 2);
    expect(f.brain!.visible().length).toBeGreaterThan(0); // shown at first
    run(f, sec(2.5));
    expect(f.brain!.visible()).toEqual([]); // then only remembered
    expect(f.brain!.hazards().length).toBeGreaterThan(0);
    const ev = run(f, sec(5));
    // a spread hits all four; a stack hits its holder short of people
    const hitNow = ['p0', 'p1', 'p2', 'p3'].filter((id) => hits(ev, id) > 0).length;
    expect([1, 4]).toContain(hitNow);
  });

  it('drops a circle under everyone; whoever stays put is hit', () => {
    const f = fight(one({ k: 'drop', r: 4, dmg: 5000, delay: 2 }));
    spreadOut(f);
    run(f, after(4) - 1);
    put(f, 'p1', 7, 0); // steps off; the others stay
    const ev = run(f, sec(2.5));
    expect(hurt(ev, 'p1')).toBe(0);
    for (const id of ['p0', 'p2', 'p3']) expect(hurt(ev, id), id).toBe(5000);
  });

  it('hits twice for a two-hit raid-wide', () => {
    const f = fight(one({ k: 'raidwide', dmg: 1000, hits: 2, gap: 1.5 }));
    const ev = run(f, after(4, 2));
    expect(hits(ev, 'p1')).toBe(2);
  });
});

describe('the prison rock and the knockback (岩牢震擊)', () => {
  it('pushes whoever is not right behind the rock; the one in it and the one behind it stay', () => {
    const f = fight([{ at: 1, name: '岩牢震擊', cast: 2, mechs: [{ k: 'prison', hp: 99999, time: 30 }, { k: 'knockback', dist: 6, delay: 3 }] }]);
    spreadOut(f, 6);
    run(f, sec(3) + 2);
    const rock = f.foes.find((e) => e.kind === 'prison')!;
    const owner = f.players.get(rock.owner!)!;
    const others = [...f.players.values()].filter((q) => q !== owner);
    // one of the others behind the rock, on the line from the boss
    const d = Math.hypot(rock.x, rock.z);
    const hide = others[0]!;
    put(f, hide.id, (rock.x / d) * (d + 2), (rock.z / d) * (d + 2));
    expect(sheltered(f.brain!.foe, rock, hide.x, hide.z)).toBe(true);
    const before = new Map(others.map((q) => [q.id, [q.x, q.z]]));
    const ownerAt = [owner.x, owner.z];
    run(f, sec(3) + 20);
    expect([owner.x, owner.z]).toEqual(ownerAt);
    expect(Math.hypot(hide.x - before.get(hide.id)![0]!, hide.z - before.get(hide.id)![1]!)).toBeLessThan(0.01);
    for (const q of others.slice(1)) expect(Math.hypot(q.x - before.get(q.id)![0]!, q.z - before.get(q.id)![1]!), q.id).toBeGreaterThan(3);
  });
});

describe('bombs, drills, fans from memory and adds that fall together', () => {
  it('a bomb with `pool` leaves ice where it went off', () => {
    const f = fight(one({ k: 'bombs', at: [2], count: 1, r: 4, dmg: 1000, self: 500, pool: { r: 3, dmg: 800, time: 6 } }));
    spreadOut(f);
    run(f, after(4, 2.5));
    const pools = f.brain!.hazards().filter((h) => h.zone);
    expect(pools.length).toBe(1);
  });

  it('`far` drills mark the two furthest from the boss', () => {
    const f = fight(one({ k: 'drill', n: 2, r: 3, dmg: 2000, far: true }));
    put(f, 'p0', 0, 4);
    put(f, 'p1', 6, 0);
    put(f, 'p2', 0, -15);
    put(f, 'p3', -16, 0);
    const ev = run(f, after(4));
    expect(hits(ev, 'p2')).toBe(1);
    expect(hits(ev, 'p3')).toBe(1);
    expect(hits(ev, 'p0') + hits(ev, 'p1')).toBe(0);
  });

  it('fires the adds\' fans again from where they stood, in the order they first fired (鏡中預言)', () => {
    const f = fight(
      [
        {
          at: 1,
          name: '冰鏡',
          cast: 1,
          mechs: [
            { k: 'adds', kind: 'mirror', at: [[0, -12], [12, 0]], hp: 999_999, auto: 0, time: 30, boom: 0, attack: { k: 'cone', deg: 40, r: 30, dmg: 1000, every: 4, first: 1 } },
          ],
        },
        { at: 12, name: '鏡中預言', cast: 2, mechs: [{ k: 'replay', gap: 2, dmg: 3000 }] },
      ],
      { enc: 'frostwitch', kind: 'frostwitch' },
    );
    spreadOut(f, 18);
    run(f, sec(12) + 2);
    const echoes = f.brain!.hazards().filter((h) => h.shape.k === 'cone' && !h.shown);
    expect(echoes.length).toBe(2);
    expect(echoes[0]!.end).toBeLessThan(echoes[1]!.end);
  });

  it('adds that must fall together: a number is the seconds the rest have', () => {
    const f = fight(one({ k: 'adds', kind: 'drone', at: [[-5, 0], [5, 0]], hp: 1000, auto: 0, time: 60, boom: 0, together: 3 }, 2));
    run(f, after(2));
    const [a, b] = f.foes.filter((e) => e.kind === 'drone');
    a!.hp = 0;
    run(f, sec(3) + 2);
    expect(a!.hp).toBeGreaterThan(0); // back up: the other did not follow in 3 s
    expect(b!.hp).toBeGreaterThan(0);
  });
});
