import { RULES, TICK_RATE } from '../constants';
import type { Encounter } from '../encounters';
import type { JobId } from '../jobs';
import type { EndReason, GameResult, Snapshot } from '../protocol';
import { clampToArena, spawnPoints } from './arena';

export interface FightPlayer {
  id: string;
  name: string;
  job: JobId;
  x: number;
  z: number;
  f: number;
  connected: boolean;
  /** tick of the last accepted step that actually moved */
  movedAt: number;
  /** server time (ms) of the last position report, -1 before the first */
  reportedAt: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The authoritative fight, stepped TICK_RATE times a second on the server (and in the browser for the
 * offline practice mode). Movement is reported by each client and checked here against the speed limit
 * and the arena. M1 has the countdown, movement and the end; combat (M2) and the boss timelines (M3)
 * build on this.
 */
export class Fight {
  tick = 0;
  phase: 'countdown' | 'fight' | 'over' = 'countdown';
  countdown: number = RULES.countdown;
  fightTicks = 0;
  result: GameResult | null = null;
  readonly players = new Map<string, FightPlayer>();

  constructor(
    readonly enc: Encounter,
    readonly hard: boolean,
    roster: readonly { id: string; name: string; job: JobId }[],
    readonly seed: number,
  ) {
    const spots = spawnPoints(enc.arena, roster.length);
    roster.forEach((p, k) => {
      const [x, z] = spots[k]!;
      this.players.set(p.id, { id: p.id, name: p.name, job: p.job, x, z, f: Math.PI, connected: true, movedAt: -999, reportedAt: -1 });
    });
  }

  get enrageTicks(): number {
    return Math.round((this.hard ? this.enc.times.hard : this.enc.times.normal).enrage * TICK_RATE);
  }

  /**
   * A client reported where its character is. Steps longer than the speed allows are cut short and
   * positions outside the arena pulled back in; then the corrected position is returned so the client
   * can snap to it. Returns null when the report was accepted as is.
   */
  move(id: string, x: number, z: number, f: number, nowMs: number): [number, number] | null {
    const p = this.players.get(id);
    if (!p || this.phase === 'over') return null;
    const gap = p.reportedAt < 0 ? RULES.moveGap : Math.min(RULES.moveGap, Math.max(0, (nowMs - p.reportedAt) / 1000));
    p.reportedAt = nowMs;
    const allowed = RULES.moveSpeed * gap * RULES.moveSlack + RULES.moveSlackM;
    let dx = x - p.x;
    let dz = z - p.z;
    const d = Math.hypot(dx, dz);
    let corrected = false;
    if (d > allowed) {
      dx *= allowed / d;
      dz *= allowed / d;
      corrected = true;
    }
    const [nx, nz] = clampToArena(this.enc.arena, p.x + dx, p.z + dz);
    if (Math.hypot(nx - p.x - dx, nz - p.z - dz) > 0.05) corrected = true;
    if (Math.hypot(nx - p.x, nz - p.z) > 0.001) p.movedAt = this.tick;
    p.x = nx;
    p.z = nz;
    if (Number.isFinite(f)) p.f = f;
    return corrected ? [p.x, p.z] : null;
  }

  setConnected(id: string, on: boolean): void {
    const p = this.players.get(id);
    if (p) p.connected = on;
  }

  remove(id: string): void {
    this.players.delete(id);
  }

  step(): void {
    if (this.phase === 'over') return;
    this.tick++;
    if (this.phase === 'countdown') {
      if (--this.countdown <= 0) this.phase = 'fight';
      return;
    }
    this.fightTicks++;
    if (this.fightTicks >= this.enrageTicks) this.end('enrage');
  }

  end(reason: EndReason): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.result = { reason, time: Math.round(this.fightTicks / TICK_RATE) };
  }

  snapshot(): Snapshot {
    return {
      k: this.tick,
      ph: this.phase === 'countdown' ? 0 : this.phase === 'fight' ? 1 : 2,
      cd: this.countdown,
      el: this.fightTicks,
      p: [...this.players.values()].map((p) => ({
        i: p.id,
        x: r2(p.x),
        z: r2(p.z),
        f: r2(p.f),
        m: this.tick - p.movedAt <= 4 ? 1 : 0,
        dc: p.connected ? 0 : 1,
      })),
    };
  }
}
