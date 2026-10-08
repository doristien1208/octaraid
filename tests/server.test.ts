import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { VERSION } from '../shared/constants';
import type { C2S, S2C } from '../shared/protocol';
import { createApp } from '../server/app';

let base = '';
// the vote result, the countdown and the results screen are shortened so the test does not wait 28 seconds
const app = createApp(null, { tallyMs: 60, resultsMs: 300, countdownMs: 300 });

beforeAll(async () => {
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
});

/** Minimal client that records every message it receives. */
class Client {
  ws: WebSocket;
  inbox: S2C[] = [];
  constructor(origin?: string) {
    this.ws = new WebSocket(`ws://${base}/ws`, origin ? { headers: { origin } } : undefined);
    this.ws.on('message', (d) => this.inbox.push(JSON.parse(d.toString()) as S2C));
  }
  open() {
    return new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }
  send(msg: C2S) {
    this.ws.send(JSON.stringify(msg));
  }
  async wait<T extends S2C['t']>(t: T, pred: (m: Extract<S2C, { t: T }>) => boolean = () => true, ms = 6000) {
    const until = Date.now() + ms;
    for (;;) {
      const hit = this.inbox.find((m) => m.t === t && pred(m as Extract<S2C, { t: T }>));
      if (hit) return hit as Extract<S2C, { t: T }>;
      if (Date.now() > until) throw new Error(`timed out waiting for ${t}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  latest<T extends S2C['t']>(t: T): Extract<S2C, { t: T }> | undefined {
    return this.inbox.filter((m) => m.t === t).at(-1) as Extract<S2C, { t: T }> | undefined;
  }
  close() {
    this.ws.close();
  }
}

async function connect(name: string, token?: string) {
  const c = new Client();
  await c.open();
  c.send({ t: 'hello', name, token });
  const welcome = await c.wait('welcome');
  return { c, welcome };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('server', () => {
  it('rejects sockets from another origin', async () => {
    const c = new Client('http://evil.example');
    await expect(c.open()).rejects.toThrow();
  });

  it('reports its version and load on /healthz for the Game Hub', async () => {
    const res = await fetch(`http://${base}/healthz`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, version: VERSION, playing: 0 });
    expect(typeof body.online).toBe('number');
  });

  it('runs invite codes, jobs, the 8-option vote, chat and a fight', async () => {
    const { c: alice, welcome: aw } = await connect('  Alice  ');
    expect(aw.name).toBe('Alice');
    await alice.wait('entry');
    alice.send({ t: 'create', name: 'Alice' });
    const created = await alice.wait('room');
    const code = created.room.code;
    expect(code).toMatch(/^[A-Z2-9]{4}$/);
    expect(created.room.members[0]).toMatchObject({ name: 'Alice', host: true, job: 'guardian' });

    // a code that does not exist, and one that is not a code at all
    const { c: bob } = await connect('Bob');
    let missing = 'ZZZZ';
    while (app.hub.rooms.has(missing)) missing = missing === 'ZZZZ' ? 'YYYY' : 'XXXX';
    bob.send({ t: 'join', code: missing, name: 'Bob' });
    await bob.wait('error', (m) => m.code === 'no_room');
    bob.send({ t: 'join', code: 'AB', name: 'Bob' });
    await bob.wait('error', (m) => m.code === 'bad_code');

    // people type codes in lower case and with dashes; the second member gets a healer by default
    bob.send({ t: 'join', code: `${code.slice(0, 2).toLowerCase()}-${code.slice(2)}`, name: 'Bob' });
    const joined = await bob.wait('room', (m) => m.room.members.length === 2);
    expect(joined.room.members[1]).toMatchObject({ name: 'Bob', job: 'priest', host: false });

    // at most 2 tanks
    const { c: carol, welcome: cw } = await connect('Carol');
    carol.send({ t: 'join', code, name: 'Carol' });
    await carol.wait('room', (m) => m.room.members.length === 3);
    bob.send({ t: 'job', job: 'berserker' });
    await alice.wait('room', (m) => m.room.members.some((x) => x.name === 'Bob' && x.job === 'berserker'));
    carol.send({ t: 'job', job: 'guardian' });
    await carol.wait('error', (m) => m.code === 'job');

    // chat reaches everyone; a second line within half a second is dropped
    carol.send({ t: 'chat', text: '  大家好  ' });
    carol.send({ t: 'chat', text: '洗頻' });
    await alice.wait('chat', (m) => m.text === '大家好');
    await sleep(200);
    expect(alice.inbox.some((m) => m.t === 'chat' && m.text === '洗頻')).toBe(false);

    // a dropped connection keeps the seat and comes back with the token
    carol.close();
    await alice.wait('room', (m) => m.room.members.some((x) => x.name === 'Carol' && !x.connected));
    const { c: carol2 } = await connect('Carol', cw.token);
    const back = await carol2.wait('room');
    expect(back.room.code).toBe(code);

    // votes: 2 for 雙子機神 Hard, 1 for 崩岩巨像 Normal
    alice.send({ t: 'vote', opt: 7 });
    bob.send({ t: 'vote', opt: 7 });
    carol2.send({ t: 'vote', opt: 0 });
    await alice.wait('room', (m) => m.room.members.filter((x) => x.vote === 7).length === 2 && m.room.members.some((x) => x.vote === 0));

    alice.send({ t: 'start' });
    await alice.wait('error', (m) => m.code === 'start'); // nobody is ready yet
    bob.send({ t: 'ready', ready: true });
    carol2.send({ t: 'ready', ready: true });
    await alice.wait('room', (m) => m.room.members.filter((x) => x.ready).length === 2);
    alice.send({ t: 'start' });

    const tallied = await bob.wait('tally');
    expect(tallied.result).toMatchObject({ winner: 7, tied: [] });
    expect(tallied.result.counts[7]).toBe(2);
    const start = await bob.wait('start');
    expect(start.game).toMatchObject({ enc: 'twins', hard: true });
    expect(start.game.players).toHaveLength(3);
    expect(start.game.hpScale).toBeCloseTo((0.65 + 0.65 + 1) / 3.2, 2); // guardian, berserker, brawler

    // joining a room in a fight is refused
    const { c: dave } = await connect('Dave');
    dave.send({ t: 'join', code, name: 'Dave' });
    await dave.wait('error', (m) => m.code === 'playing');

    // moving: an ordinary step is accepted, a teleport is cut short and corrected
    const first = await alice.wait('snap');
    const me = first.s.p.find((p) => p.i === aw.id)!;
    alice.send({ t: 'mv', x: me.x + 0.3, z: me.z, f: Math.PI / 2 });
    await alice.wait('snap', (m) => Math.abs(m.s.p.find((p) => p.i === aw.id)!.x - (me.x + 0.3)) < 0.02);
    await sleep(40);
    alice.send({ t: 'mv', x: me.x + 0.3, z: me.z - 30, f: 0 });
    const fix = await alice.wait('pos');
    expect(Math.hypot(fix.x - me.x - 0.3, fix.z - me.z)).toBeLessThan(1.5);

    // skills: one that goes off shows up in the snapshots; one that cannot gets a reason back
    await alice.wait('snap', (m) => m.s.ph === 1);
    alice.send({ t: 'use', s: 1 }); // the guardian's 挑釁, at the nearest enemy
    const used = await bob.wait('snap', (m) => !!m.s.ev?.some((e) => e.k === 'use' && e.i === aw.id && e.s === 1));
    expect(used.s.e[0]!.t).toBe(aw.id); // the dummy turns on whoever provoked it
    alice.send({ t: 'use', s: 5 }); // the Limit Break with an empty gauge
    expect(await alice.wait('deny')).toMatchObject({ s: 5, why: 'lb' });

    // only the host can end a test fight; results, then everyone is back in the waiting room
    bob.send({ t: 'endtest' });
    await sleep(100);
    expect(bob.inbox.some((m) => m.t === 'end')).toBe(false);
    alice.inbox.length = 0;
    alice.send({ t: 'endtest' });
    const end = await bob.wait('end');
    expect(end.result.reason).toBe('test');
    const waiting = await alice.wait('room', (m) => m.room.phase === 'waiting');
    expect(waiting.room.members.every((x) => !x.ready)).toBe(true);
    expect(waiting.room.members.filter((x) => x.vote === 7)).toHaveLength(2); // votes stay for a retry

    // the host leaves: the next person becomes host; the last one out closes the room
    alice.send({ t: 'leave' });
    await alice.wait('entry');
    await bob.wait('room', (m) => m.room.members.length === 2 && m.room.members[0]!.name === 'Bob' && m.room.members[0]!.host);
    bob.send({ t: 'leave' });
    carol2.send({ t: 'leave' });
    await sleep(100);
    expect(app.hub.rooms.has(code)).toBe(false);

    for (const c of [alice, bob, carol2, dave]) c.close();
  }, 20_000);
});
