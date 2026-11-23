import { MAX_PLAYERS } from '../../shared/constants';
import { ENCOUNTERS, KIND_NAMES, clock, difficultyName } from '../../shared/encounters';
import { JOBS, ROLE_COLORS, ROLE_NAMES, isJobId, jobById, type JobId, type Role } from '../../shared/jobs';
import { ULTIMATE_NEEDS, hpScale, partyNotes, practiceParty, roleCounts } from '../../shared/party';
import type { Audio } from '../audio';
import { clear, h, store } from '../dom';
import { jobBadge, settingsModal } from './common';
import { hotbarEditor } from './hotbar-editor';

const ROLES: readonly Role[] = ['tank', 'healer', 'dps'];
const KEY = 'octaraid.practice';

/** 'boss': the duty's boss; 'dummy': the training dummy that attacks; 'calm': one that does not, to measure damage. */
type Foe = 'boss' | 'dummy' | 'calm';
const FOE_NAMES: Readonly<Record<Foe, string>> = { boss: '副本的王', dummy: '訓練木人', calm: '不還手的木人' };

interface Choice {
  boss: number;
  hard: boolean;
  job: JobId;
  n: number;
  foe: Foe;
  /** the ultimate: the stage to start from */
  stage: number;
}

const isUltimate = (c: Choice) => ENCOUNTERS[c.boss]?.kind === 'ultimate';

/** The last choice on this computer, or the defaults (崩岩巨像 Normal, 鐵壁衛士, 4 people). */
function load(): Choice {
  const c: Choice = { boss: 0, hard: false, job: 'guardian', n: 4, foe: 'boss', stage: 0 };
  try {
    const v = JSON.parse(store.get(KEY) ?? '{}') as Partial<Record<keyof Choice, unknown>>;
    if (Number.isInteger(v.boss) && (v.boss as number) >= 0 && (v.boss as number) < ENCOUNTERS.length) c.boss = v.boss as number;
    if (typeof v.hard === 'boolean') c.hard = v.hard;
    if (typeof v.job === 'string' && isJobId(v.job)) c.job = v.job;
    if (Number.isInteger(v.n) && (v.n as number) >= 1 && (v.n as number) <= MAX_PLAYERS) c.n = v.n as number;
    if (v.foe === 'dummy' || v.foe === 'calm') c.foe = v.foe;
    if (Number.isInteger(v.stage) && (v.stage as number) >= 0 && (v.stage as number) < (ENCOUNTERS[c.boss]?.stages?.length ?? 0)) c.stage = v.stage as number;
  } catch {
    /* a broken entry: the defaults */
  }
  return c;
}

/** The address of the offline practice (client/sandbox.ts) for a choice. */
function practiceUrl(c: Choice): string {
  const ult = isUltimate(c);
  const q = [
    `boss=${c.boss}`,
    c.hard || ult ? 'hard' : '',
    `job=${c.job}`,
    `n=${ult ? Math.max(4, c.n) : c.n}`,
    c.foe === 'boss' ? '' : c.foe,
    ult && c.stage ? `stage=${c.stage}` : '',
  ].filter(Boolean);
  return `${location.pathname}?sandbox&${q.join('&')}`;
}

/**
 * The offline practice menu (離線練習 on the entry screen): which duty and difficulty, my job, how many
 * people (computer players fill the rest, as in a room), and whether to fight the boss or a training dummy.
 * It runs in this browser only; nothing goes to the server.
 */
export function practiceScreen(opts: { audio: Audio; /** my nickname, or '' */ name: string; onBack(): void }): HTMLElement {
  const c = load();
  const duties = h('div', { class: 'votes' });
  const jobCards = new Map<JobId, HTMLButtonElement>();
  const sizes = h('div', { class: 'seg fill' });
  const foes = h('div', { class: 'seg fill' });
  const party = h('div', { class: 'practice-party' });
  const stages = h('div', { class: 'seg fill' });
  const stageBox = h('div', { class: 'practice-stages' }, h('span', { class: 'muted small' }, '從哪個階段開始（前面的階段跳過）'), stages);
  const summary = h('p', { class: 'practice-summary' });

  const start = () => {
    store.set(KEY, JSON.stringify(c));
    location.href = practiceUrl(c);
  };

  const paint = () => {
    clear(duties);
    for (const [k, enc] of ENCOUNTERS.entries()) {
      duties.append(
        h(
          'div',
          { class: 'vote-row' },
          h(
            'div',
            { class: 'vote-info' },
            h('strong', null, enc.name),
            h('span', { class: `kind ${enc.kind}` }, KIND_NAMES[enc.kind]),
            h('span', { class: 'muted small' }, `學：${enc.learn}`),
          ),
          ...(enc.kind === 'ultimate' ? [true] : [false, true]).map((hard) => {
            const t = hard ? enc.times.hard : enc.times.normal;
            const ult = enc.kind === 'ultimate';
            return h(
              'button',
              {
                class: `vote-btn ${ult ? 'ultimate' : hard ? 'hard' : 'normal'} ${c.boss === k && (ult || c.hard === hard) ? 'on' : ''}`,
                onclick: () => {
                  c.boss = k;
                  c.hard = hard;
                  if (ult) c.n = Math.max(4, c.n);
                  else c.stage = 0;
                  paint();
                },
              },
              h('span', { class: 'diff' }, difficultyName(hard, enc.id)),
              h('span', { class: 'muted small' }, ult ? `約 ${clock(t.target)}，每階段各自狂暴` : `約 ${clock(t.target)}，狂暴 ${clock(t.enrage)}`),
            );
          }),
        ),
      );
    }
    for (const [id, card] of jobCards) card.classList.toggle('on', c.job === id);

    const ult = isUltimate(c);
    sizes.replaceChildren(
      ...Array.from({ length: MAX_PLAYERS }, (_, k) =>
        h(
          'button',
          {
            class: c.n === k + 1 ? 'on' : '',
            disabled: ult && k + 1 < 4,
            onclick: () => {
              c.n = k + 1;
              paint();
            },
          },
          String(k + 1),
        ),
      ),
    );
    const stageList = ENCOUNTERS[c.boss]?.stages ?? [];
    stages.replaceChildren(
      ...stageList.map((name, k) =>
        h(
          'button',
          {
            class: c.stage === k ? 'on' : '',
            onclick: () => {
              c.stage = k;
              paint();
            },
          },
          name,
        ),
      ),
    );
    stageBox.hidden = !ult;
    foes.replaceChildren(
      ...(['boss', 'dummy', 'calm'] as const).map((f) =>
        h(
          'button',
          {
            class: c.foe === f ? 'on' : '',
            onclick: () => {
              c.foe = f;
              paint();
            },
          },
          FOE_NAMES[f],
        ),
      ),
    );

    const jobs = practiceParty(c.job, c.n, ult);
    const n = roleCounts(jobs);
    clear(party);
    party.append(
      ...jobs.map((j, k) =>
        h(
          'div',
          { class: `member ${k === 0 ? 'mine' : ''}` },
          jobBadge(j, 'sm'),
          h('strong', null, k === 0 ? (opts.name ? `${opts.name}（你）` : '你') : `電腦${k}`),
          h('span', { class: 'muted small' }, jobById(j).name),
        ),
      ),
      h(
        'div',
        { class: 'role-chips' },
        ...ROLES.map((r) => h('span', { class: 'role-chip', style: { borderColor: ROLE_COLORS[r] } }, `${ROLE_NAMES[r]} ${n[r]}`)),
      ),
      h('p', { class: 'small' }, `Boss 血量 ${Math.round(hpScale(jobs) * 100)}%`, h('span', { class: 'muted' }, '（1 坦 1 補 2 DPS 為 100%）')),
      ...(ult ? [h('p', { class: 'note small' }, `絕本需要${ULTIMATE_NEEDS}：電腦隊友會補齊`)] : partyNotes(jobs).map((t) => h('p', { class: 'note small' }, t))),
    );
    const enc = ENCOUNTERS[c.boss]!;
    summary.textContent = `${enc.name} ${difficultyName(c.hard, enc.id)}${ult ? ` · 從${stageList[c.stage] ?? stageList[0]}開始` : ''} · ${jobById(c.job).name} · ${jobs.length} 人${c.foe === 'boss' ? '' : ` · 對手換成${FOE_NAMES[c.foe]}`}`;
  };

  const groups = ROLES.map((role) =>
    h(
      'div',
      { class: 'job-group' },
      h('h4', { style: { color: ROLE_COLORS[role] } }, ROLE_NAMES[role]),
      h(
        'div',
        { class: `job-cards ${role}` },
        ...JOBS.filter((j) => j.role === role).map((j) => {
          const card = h(
            'button',
            {
              class: 'job-card',
              onclick: () => {
                c.job = j.id;
                paint();
              },
            },
            jobBadge(j.id, 'md'),
            h('span', { class: 'job-text' }, h('strong', null, j.name), h('span', { class: 'muted small' }, `${j.sub} · ${j.desc}`)),
          );
          jobCards.set(j.id, card);
          return card;
        }),
      ),
    ),
  );

  paint();
  return h(
    'div',
    { class: 'screen practice' },
    h(
      'header',
      { class: 'topbar' },
      h('span', { class: 'logo small' }, '八方討伐'),
      h('strong', { class: 'practice-title' }, '離線練習'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost', onclick: () => settingsModal(opts.audio, undefined, c.job) }, '設定'),
      h('button', { class: 'btn ghost', onclick: opts.onBack }, '返回'),
    ),
    h(
      'div',
      { class: 'practice-body' },
      h(
        'section',
        { class: 'panel' },
        h('h3', null, '選擇副本'),
        h('p', { class: 'muted small' }, '在這台電腦上跑，不用開房；其他隊員由電腦擔任，會自己走位、出招、補血與復活。'),
        duties,
        stageBox,
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'row' }, h('h3', null, '選擇職業'), h('span', { class: 'grow' }), h('button', { class: 'btn small', onclick: () => hotbarEditor(c.job) }, '技能配置')),
        ...groups,
      ),
      h(
        'section',
        { class: 'panel' },
        h('h3', null, '隊伍'),
        h('span', { class: 'muted small' }, '人數（你以外由電腦擔任）'),
        sizes,
        party,
        h('h3', null, '對手'),
        foes,
        h('p', { class: 'muted small' }, '訓練木人會普攻、死刑與全場 AoE；不還手的木人用來量輸出。'),
        summary,
        h('button', { class: 'btn primary big', onclick: start }, '開始練習'),
      ),
    ),
  );
}
