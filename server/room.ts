import { MAX_PLAYERS, RULES, TICK_MS } from '../shared/constants';
import { VOTE_OPTIONS, clock, encounterById, optionLabel } from '../shared/encounters';
import { DEFAULT_JOB_ORDER, ROLE_NAMES, jobById, type JobId } from '../shared/jobs';
import { ROLE_CAPS, hpScale, roleHasRoom } from '../shared/party';
import {
  END_NAMES,
  type C2S,
  type GameStartInfo,
  type RoomPhase,
  type RoomView,
  type S2C,
  type Snapshot,
} from '../shared/protocol';
import { Fight } from '../shared/sim/fight';
import { tally, type Tally } from '../shared/vote';
import { errorMsg, type Hub, type Session } from './hub';
import { log } from './log';
import { cleanText } from './validate';

interface Member {
  s: Session;
  job: JobId;
  vote: number | null;
  ready: boolean;
}

/** A waiting room found by its invite code, and the fight it runs. */
export class Room {
  readonly members: Member[] = [];
  phase: RoomPhase = 'waiting';
  private fight: Fight | null = null;
  private info: GameStartInfo | null = null;
  private lastSnap: Snapshot | null = null;
  private lastTally: Tally | null = null;
  private nextTickAt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    readonly code: string,
    private readonly hub: Hub,
  ) {}

  get full(): boolean {
    return this.members.length >= MAX_PLAYERS;
  }

  /** The creator, then whoever has been in the room longest. */
  get host(): Member | undefined {
    return this.members[0];
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.fight = null;
  }

  // ---------------------------------------------------------------- membership

  add(s: Session): void {
    const jobs = this.members.map((m) => m.job);
    const job =
      DEFAULT_JOB_ORDER.find((j) => !jobs.includes(j) && roleHasRoom(jobs, j)) ??
      DEFAULT_JOB_ORDER.find((j) => roleHasRoom(jobs, j)) ??
      'brawler';
    this.members.push({ s, job, vote: null, ready: false });
    s.room = this;
    this.broadcastRoom(); // the newcomer needs the room screen before the chat line arrives
    this.system(`${s.name} 進入房間`);
  }

  remove(s: Session): void {
    const k = this.members.findIndex((m) => m.s === s);
    if (k < 0) return;
    this.members.splice(k, 1);
    s.room = null;
    this.fight?.remove(s.id);
    if (!this.members.length) {
      this.dispose();
      this.hub.removeRoom(this);
      return;
    }
    this.system(`${s.name} 離開房間`);
    if (k === 0) this.system(`${this.members[0]!.s.name} 成為房主`);
    this.broadcastRoom();
  }

  memberOffline(s: Session): void {
    this.fight?.setConnected(s.id, false);
    this.broadcastRoom();
  }

  /** A player reconnected: bring them back to where the room is. */
  resume(s: Session): void {
    s.send({ t: 'room', room: this.view() });
    if (this.phase === 'tally' && this.lastTally) s.send({ t: 'tally', result: this.lastTally });
    if (this.fight && this.info) {
      this.fight.setConnected(s.id, true);
      s.send({ t: 'start', game: this.info });
      if (this.lastSnap) s.send({ t: 'snap', s: this.lastSnap });
      if (this.phase === 'results' && this.fight.result) s.send({ t: 'end', result: this.fight.result });
    }
    this.broadcastRoom();
  }

  // ---------------------------------------------------------------- messages

  handle(s: Session, msg: C2S): void {
    const m = this.members.find((x) => x.s === s);
    if (!m) return;
    switch (msg.t) {
      case 'mv':
        if (this.phase === 'playing' && this.fight) {
          const fix = this.fight.move(s.id, msg.x, msg.z, msg.f, performance.now());
          if (fix) s.send({ t: 'pos', x: fix[0], z: fix[1] });
        }
        return;
      case 'chat':
        return this.chat(m, msg.text);
      case 'job':
        return this.pickJob(m, msg.job);
      case 'vote':
        if (this.phase === 'waiting' && m.vote !== msg.opt) {
          m.vote = msg.opt;
          this.broadcastRoom();
        }
        return;
      case 'ready':
        if (this.phase === 'waiting' && m !== this.host && m.ready !== msg.ready) {
          m.ready = msg.ready;
          this.broadcastRoom();
        }
        return;
      case 'start':
        return this.start(m);
      case 'endtest':
        if (m === this.host && this.phase === 'playing') this.fight?.end('test');
        return;
    }
  }

  private chat(m: Member, raw: string): void {
    const text = cleanText(raw, RULES.chatMax);
    const now = Date.now();
    if (!text || now - m.s.lastChat < RULES.chatGapMs) return;
    m.s.lastChat = now;
    this.broadcast({ t: 'chat', from: m.s.id, name: m.s.name, text });
  }

  private pickJob(m: Member, job: JobId): void {
    if (this.phase !== 'waiting' || m.job === job) return;
    const others = this.members.filter((x) => x !== m).map((x) => x.job);
    if (!roleHasRoom(others, job)) {
      const role = jobById(job).role;
      m.s.send(errorMsg('job', `${ROLE_NAMES[role]}已經有 ${ROLE_CAPS[role]} 人了`));
      return;
    }
    m.job = job;
    this.broadcastRoom();
  }

  // ---------------------------------------------------------------- fight

  private start(m: Member): void {
    if (m !== this.host || this.phase !== 'waiting') return;
    const fail = (msg: string) => m.s.send(errorMsg('start', msg));
    if (this.members.some((x) => x !== m && !x.ready)) return fail('還有人沒按準備');
    if (this.members.some((x) => !x.s.online)) return fail('有玩家斷線中');
    const result = tally(
      this.members.map((x) => x.vote),
      Math.random,
    );
    this.lastTally = result;
    this.phase = 'tally';
    this.broadcast({ t: 'tally', result });
    this.system(`開票結果：${optionLabel(result.winner)}${result.tied.length ? '（平手，隨機選出）' : ''}`);
    this.broadcastRoom();
    this.timer = setTimeout(() => this.begin(), this.hub.timing.tallyMs);
  }

  private begin(): void {
    this.timer = null;
    if (this.phase !== 'tally' || !this.lastTally) return;
    const opt = VOTE_OPTIONS[this.lastTally.winner]!;
    const jobs = this.members.map((x) => x.job);
    const info: GameStartInfo = {
      enc: opt.enc,
      hard: opt.hard,
      seed: Math.floor(Math.random() * 2 ** 31),
      hpScale: Math.round(hpScale(jobs) * 1000) / 1000,
      players: this.members.map((x) => ({ id: x.s.id, name: x.s.name, job: x.job })),
    };
    this.info = info;
    const fight = new Fight(encounterById(opt.enc), opt.hard, info.players, info.seed);
    for (const x of this.members) if (!x.s.online) fight.setConnected(x.s.id, false);
    this.fight = fight;
    this.phase = 'playing';
    this.lastSnap = null;
    this.nextTickAt = performance.now();
    this.broadcast({ t: 'start', game: info });
    const roster = this.members.map((x) => `${x.s.name}（${jobById(x.job).name}）`).join('、');
    log(
      `房間 ${this.code} 出發：${optionLabel(this.lastTally.winner)}，${this.members.length} 人：${roster}；Boss 血量 ${Math.round(info.hpScale * 100)}%，種子 ${info.seed}`,
    );
    this.broadcastRoom();
  }

  /** Called every few ms by the hub; runs the simulation at TICK_RATE and streams snapshots. */
  update(now: number): void {
    const f = this.fight;
    if (!f || this.phase !== 'playing') return;
    if (now - this.nextTickAt > 250) this.nextTickAt = now; // fell far behind: skip rather than fast-forward
    let steps = 0;
    while (now >= this.nextTickAt && steps < 4) {
      f.step();
      const snap = f.snapshot();
      this.lastSnap = snap;
      const raw = JSON.stringify({ t: 'snap', s: snap } satisfies S2C);
      for (const x of this.members) x.s.sendRaw(raw);
      this.nextTickAt += TICK_MS;
      steps++;
      if (f.phase === 'over') {
        this.finish();
        return;
      }
    }
  }

  private finish(): void {
    this.phase = 'results';
    const result = this.fight?.result;
    if (result) {
      this.broadcast({ t: 'end', result });
      log(`房間 ${this.code} 結束：${END_NAMES[result.reason]}，戰鬥 ${clock(result.time)}`);
    }
    this.broadcastRoom();
    this.timer = setTimeout(() => this.backToWaiting(), this.hub.timing.resultsMs);
  }

  private backToWaiting(): void {
    this.timer = null;
    this.fight = null;
    this.info = null;
    this.lastSnap = null;
    this.phase = 'waiting';
    for (const x of this.members) x.ready = false; // votes stay: a retry is one click for the host
    this.broadcastRoom();
  }

  // ---------------------------------------------------------------- views

  view(): RoomView {
    const host = this.host;
    return {
      code: this.code,
      phase: this.phase,
      members: this.members.map((x) => ({
        id: x.s.id,
        name: x.s.name,
        job: x.job,
        vote: x.vote,
        ready: x.ready,
        host: x === host,
        connected: x.s.online,
        ping: x.s.rtt,
      })),
    };
  }

  broadcastRoom(): void {
    this.broadcast({ t: 'room', room: this.view() });
  }

  private broadcast(msg: S2C): void {
    const raw = JSON.stringify(msg);
    for (const x of this.members) x.s.sendRaw(raw);
  }

  private system(text: string): void {
    this.broadcast({ t: 'chat', from: null, name: '', text });
  }
}
