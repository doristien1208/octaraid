import { TICK_MS } from '../shared/constants';
import { ENCOUNTERS } from '../shared/encounters';
import { DEFAULT_JOB_ORDER, isJobId, jobById, type JobId } from '../shared/jobs';
import { hpScale, roleHasRoom } from '../shared/party';
import type { C2S, GameStartInfo } from '../shared/protocol';
import { Bot, spotFor } from '../shared/sim/bot';
import { Fight } from '../shared/sim/fight';
import { PRACTICE } from '../shared/sim/practice';
import type { Audio } from './audio';
import { clear, store } from './dom';
import { GameView } from './game/view';

/**
 * Offline practice, no room needed: ?sandbox&boss=0..3&hard&n=1..8&job=guardian&calm&lb
 * The fight runs in this browser with the same rules as the server. Computer players fill the rest of
 * the party (role caps apply) and fight with simple rotations; calm: the dummy does not attack, for
 * measuring damage; lb: the Limit Break gauge starts full. ?sandbox&gallery lines all 8 jobs up facing
 * the camera, to compare their looks (&shot: without the HUD, for a group picture such as the hub thumbnail).
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
  const calm = q.has('calm');
  const gallery = q.has('gallery');
  const n = gallery ? 8 : int('n', 1, 8, 4);
  const jobParam = q.get('job');
  const myJob: JobId = isJobId(jobParam) ? jobParam : 'guardian';
  // fill the party the way a room hands out jobs: one of each role first, within the role caps
  const jobs: JobId[] = gallery ? [myJob, ...DEFAULT_JOB_ORDER.filter((j) => j !== myJob)] : [myJob];
  while (jobs.length < n) {
    const next = DEFAULT_JOB_ORDER.find((j) => !jobs.includes(j) && roleHasRoom(jobs, j)) ?? DEFAULT_JOB_ORDER.find((j) => roleHasRoom(jobs, j));
    if (!next) break;
    jobs.push(next);
  }
  const roster = jobs.map((job, k) => (k === 0 ? { id: 'me', name: store.get('octaraid.name') || '你', job } : { id: `bot${k}`, name: `電腦${k}`, job }));
  const seed = Math.floor(Math.random() * 2 ** 31);
  const scale = hpScale(jobs);
  const fight = new Fight(enc, hard, roster, seed, { hpScale: scale, calm: calm || gallery });
  if (gallery) {
    // two rows of four south of the dummy, everyone facing the camera: tanks and healers behind, DPS in front
    roster.forEach((r) => {
      const p = fight.players.get(r.id)!;
      const back = jobById(r.job).role !== 'dps';
      const row = roster.filter((x) => (jobById(x.job).role !== 'dps') === back);
      const i = row.indexOf(r);
      p.x = (i - 1.5) * 2.1 + (back ? 0.6 : 0);
      p.z = back ? 5.4 : 7.6;
      p.f = 0;
    });
  }
  const info: GameStartInfo = {
    enc: enc.id,
    hard,
    seed,
    hpScale: scale,
    echo: 0,
    players: roster,
    foes: [{ id: 'boss', name: PRACTICE.name, r: PRACTICE.ring }],
  };
  const bots = gallery ? [] : roster.slice(1).map((r) => new Bot(fight, r.id, spotFor(r.job, roster.filter((x) => x.job === r.job).indexOf(r))));

  let timer = 0;
  let view: GameView | null = null;
  const link = {
    send(m: C2S) {
      if (m.t === 'mv') {
        const fix = fight.move('me', m.x, m.z, m.f, performance.now());
        if (fix) view?.onCorrection(fix[0], fix[1]);
      } else if (m.t === 'use') {
        const r = fight.use('me', m.s, { target: m.tg, dx: m.dx, dz: m.dz });
        if (r !== 'ok' && r !== 'queued') view?.onDeny(m.s, r);
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
  if (gallery && q.has('shot')) game.showcase(0.3, 6.6);
  game.addChat(
    '',
    `離線練習：${enc.name}${hard ? ' Hard' : ''}，${roster.length} 人${calm ? '，木人不攻擊' : ''}；電腦隊友會自己走位與出招。按「結束測試」或時間到就結束。`,
  );

  let lbFill = q.has('lb');
  timer = window.setInterval(() => {
    const now = performance.now();
    for (const b of bots) b.think(now);
    fight.step();
    if (lbFill && fight.phase === 'fight') {
      fight.lb = 100;
      lbFill = false;
    }
    game.onSnap(fight.snapshot());
    if (fight.phase === 'over' && fight.result) {
      window.clearInterval(timer);
      game.onEnd(fight.result);
      window.setTimeout(() => location.reload(), 8000); // start another round
    }
  }, TICK_MS);
}
