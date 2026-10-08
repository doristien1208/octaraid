import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { MAX_PLAYERS, ROOM_CODE_LEN, RULES, VERSION } from '../shared/constants';
import type { C2S, S2C } from '../shared/protocol';
import { isRoomCode, makeCode, normalizeCode } from '../shared/roomcode';
import { log } from './log';
import { Room } from './room';
import { cleanText, parseC2S } from './validate';

const RATE_LIMIT = 120; // messages per second per connection
const RESUME_MS = 30_000; // how long a dropped player keeps their seat

export const errorMsg = (code: string, msg: string): S2C => ({ t: 'error', code, msg });

/** How long the vote result and the results screen stay up; the tests shorten them. */
export interface Timing {
  tallyMs: number;
  resultsMs: number;
}

export class Session {
  readonly id = randomBytes(4).toString('hex');
  readonly token = randomBytes(16).toString('hex');
  ws: WebSocket | null = null;
  room: Room | null = null;
  rtt = 0;
  dropTimer: NodeJS.Timeout | null = null;
  lastChat = 0;
  private windowStart = 0;
  private count = 0;

  constructor(public name: string) {}

  get online(): boolean {
    return this.ws !== null;
  }

  send(msg: S2C): void {
    this.sendRaw(JSON.stringify(msg));
  }

  sendRaw(data: string): void {
    const ws = this.ws;
    // a client that stops reading should not make the server buffer forever
    if (ws && ws.readyState === ws.OPEN && ws.bufferedAmount < 1 << 20) ws.send(data);
  }

  allow(now: number): boolean {
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.count = 0;
    }
    return ++this.count <= RATE_LIMIT;
  }
}

/**
 * Sessions and rooms. There is no lobby: a player creates a room (and gets its invite code) or joins
 * one with a code, straight from the entry screen.
 */
export class Hub {
  readonly rooms = new Map<string, Room>(); // by invite code
  private sessions = new Map<string, Session>(); // by token
  private readonly started = Date.now();
  private readonly timers: NodeJS.Timeout[];

  constructor(readonly timing: Timing = { tallyMs: RULES.tallyMs, resultsMs: RULES.resultsMs }) {
    this.timers = [
      setInterval(() => this.tickRooms(), 4),
      setInterval(() => {
        for (const r of this.rooms.values()) if (r.phase === 'waiting') r.broadcastRoom(); // refresh pings
      }, 2000),
    ];
  }

  close(): void {
    for (const t of this.timers) clearInterval(t);
    for (const s of this.sessions.values()) if (s.dropTimer) clearTimeout(s.dropTimer);
    for (const r of this.rooms.values()) r.dispose();
  }

  connect(ws: WebSocket): void {
    let session: Session | null = null;
    const helloTimer = setTimeout(() => ws.close(4000, 'hello timeout'), 10_000);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = parseC2S(data.toString());
      if (!session) {
        if (msg?.t !== 'hello') return;
        clearTimeout(helloTimer);
        session = this.hello(ws, msg.name, msg.token);
        return;
      }
      if (!session.allow(Date.now())) {
        ws.close(4008, 'too many messages');
        return;
      }
      if (msg && session.ws === ws) this.handle(session, msg);
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (session && session.ws === ws) this.offline(session);
    });
    ws.on('error', () => ws.terminate());
  }

  removeRoom(room: Room): void {
    this.rooms.delete(room.code);
    log(`房間 ${room.code} 已關閉`);
  }

  health() {
    return {
      ok: true,
      version: VERSION,
      rooms: this.rooms.size,
      playing: [...this.rooms.values()].filter((r) => r.phase !== 'waiting').length,
      online: this.onlineCount(),
      uptime: Math.round((Date.now() - this.started) / 1000),
    };
  }

  private hello(ws: WebSocket, rawName: string, token?: string): Session {
    let s = token ? this.sessions.get(token) : undefined;
    if (s) {
      if (s.ws && s.ws !== ws) s.ws.close(4001, 'replaced');
      if (s.dropTimer) clearTimeout(s.dropTimer);
      s.dropTimer = null;
    } else {
      s = new Session(cleanText(rawName, RULES.nameMax) || '玩家');
      this.sessions.set(s.token, s);
    }
    s.ws = ws;
    s.send({ t: 'welcome', id: s.id, token: s.token, name: s.name });
    if (s.room) s.room.resume(s);
    else s.send({ t: 'entry' });
    return s;
  }

  private offline(s: Session): void {
    s.ws = null;
    s.room?.memberOffline(s);
    s.dropTimer = setTimeout(() => this.drop(s), RESUME_MS);
  }

  private drop(s: Session): void {
    s.room?.remove(s);
    this.sessions.delete(s.token);
  }

  private handle(s: Session, msg: C2S): void {
    switch (msg.t) {
      case 'ping':
        if (msg.r !== undefined) s.rtt = msg.r;
        s.send({ t: 'pong', c: msg.c });
        return;
      case 'hello':
        return;
      case 'create':
        return this.create(s, msg.name);
      case 'join':
        return this.join(s, msg.code, msg.name);
      case 'leave':
        s.room?.remove(s);
        s.send({ t: 'entry' });
        return;
      default:
        s.room?.handle(s, msg);
    }
  }

  /** The entry screen sends the nickname again with every create / join: it may have changed. */
  private rename(s: Session, raw: string): void {
    const name = cleanText(raw, RULES.nameMax);
    if (name) s.name = name;
  }

  private create(s: Session, name: string): void {
    if (s.room) return;
    this.rename(s, name);
    const code = makeCode(Math.random, (c) => this.rooms.has(c));
    const room = new Room(code, this);
    this.rooms.set(code, room);
    log(`房間 ${code} 由 ${s.name} 建立`);
    room.add(s);
  }

  private join(s: Session, raw: string, name: string): void {
    if (s.room) return;
    const code = normalizeCode(raw);
    if (!isRoomCode(code)) return s.send(errorMsg('bad_code', `邀請碼是 ${ROOM_CODE_LEN} 個英文字母或數字`));
    const room = this.rooms.get(code);
    if (!room) return s.send(errorMsg('no_room', '找不到這個邀請碼的房間'));
    if (room.full) return s.send(errorMsg('full', `房間已滿 ${MAX_PLAYERS} 人`));
    if (room.phase !== 'waiting') return s.send(errorMsg('playing', '房間正在戰鬥，這場結束後才能加入'));
    this.rename(s, name);
    room.add(s);
  }

  private onlineCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.online) n++;
    return n;
  }

  private tickRooms(): void {
    const now = performance.now();
    for (const r of this.rooms.values()) r.update(now);
  }
}
