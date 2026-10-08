import { RULES, TICK_MS } from '../shared/constants';
import { ENCOUNTERS } from '../shared/encounters';
import { DEFAULT_JOB_ORDER, isJobId, type JobId } from '../shared/jobs';
import { hpScale } from '../shared/party';
import type { C2S, GameStartInfo } from '../shared/protocol';
import { Rng } from '../shared/rng';
import { clampToArena } from '../shared/sim/arena';
import { Fight } from '../shared/sim/fight';
import type { Audio } from './audio';
import { clear, store } from './dom';
import { GameView } from './game/view';

/**
 * Offline practice, no room needed: ?sandbox&boss=0..3&hard&n=1..8&job=guardian
 * The fight runs in this browser with the same rules as the server; the other characters wander around.
 */
export function startSandbox(app: HTMLElement, audio: Audio): void {
  const q = new URLSearchParams(location.search);
  const int = (key: string, lo: number, hi: number, fallback: number) => {
    const raw = q.get(key);
    const v = Number(raw);
    return raw !== null && raw !== '' && Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  };
  const enc = ENCOUNTERS[int('boss', 0, ENCOUNTERS.length - 1, 0)]!;
  const hard = q.has('hard');
  const n = int('n', 1, 8, 4);
  const jobParam = q.get('job');
  const myJob: JobId = isJobId(jobParam) ? jobParam : 'guardian';
  const others = DEFAULT_JOB_ORDER.filter((j) => j !== myJob);
  const roster = [
    { id: 'me', name: store.get('octaraid.name') || '你', job: myJob },
    ...Array.from({ length: n - 1 }, (_, k) => ({ id: `bot${k + 1}`, name: `電腦${k + 1}`, job: others[k % others.length]! })),
  ];
  const seed = Math.floor(Math.random() * 2 ** 31);
  const fight = new Fight(enc, hard, roster, seed);
  const info: GameStartInfo = { enc: enc.id, hard, seed, hpScale: hpScale(roster.map((r) => r.job)), players: roster };

  let timer = 0;
  let view: GameView | null = null;
  const link = {
    send(m: C2S) {
      if (m.t === 'mv') {
        const fix = fight.move('me', m.x, m.z, m.f, performance.now());
        if (fix) view?.onCorrection(fix[0], fix[1]);
      } else if (m.t === 'chat') view?.addChat(roster[0]!.name, m.text);
      else if (m.t === 'endtest') fight.end('test');
    },
    leave() {
      window.clearInterval(timer);
      location.href = location.pathname;
    },
  };
  const game = new GameView(info, 'me', link, audio);
  view = game;
  game.setHost(true);
  clear(app);
  app.append(game.root);
  game.addChat('', `離線練習：${enc.name}，${n} 人；其他角色會隨意走動。按「結束測試」或時間到就結束。`);

  const rng = new Rng(seed);
  const goals = new Map<string, [number, number]>();
  timer = window.setInterval(() => {
    const now = performance.now();
    for (const p of roster.slice(1)) {
      const s = fight.players.get(p.id);
      if (!s) continue;
      let goal = goals.get(p.id);
      if (!goal || Math.hypot(goal[0] - s.x, goal[1] - s.z) < 0.3) {
        const ang = rng.next() * Math.PI * 2;
        const r = rng.next() * enc.arena.size * 0.85;
        goal = clampToArena(enc.arena, Math.sin(ang) * r, Math.cos(ang) * r);
        goals.set(p.id, goal);
      }
      const dx = goal[0] - s.x;
      const dz = goal[1] - s.z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, (RULES.moveSpeed * 0.8 * TICK_MS) / 1000);
      if (d > 0.001) fight.move(p.id, s.x + (dx / d) * step, s.z + (dz / d) * step, Math.atan2(dx, dz), now);
    }
    fight.step();
    game.onSnap(fight.snapshot());
    if (fight.phase === 'over' && fight.result) {
      window.clearInterval(timer);
      game.onEnd(fight.result);
      window.setTimeout(() => location.reload(), 6000); // start another round
    }
  }, TICK_MS);
}
