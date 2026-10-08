import { hasBoss } from '../../shared/bosses';
import { MAX_PLAYERS, RULES } from '../../shared/constants';
import { ENCOUNTERS, KIND_NAMES, VOTE_OPTIONS, clock, difficultyName, optionLabel } from '../../shared/encounters';
import { JOBS, LIMIT_BREAKS, ROLE_COLORS, ROLE_NAMES, jobById, type JobId, type Role } from '../../shared/jobs';
import { ROLE_CAPS, hpScale, partyNotes, roleCounts, roleHasRoom } from '../../shared/party';
import type { C2S, RoomMember, RoomView } from '../../shared/protocol';
import type { Tally } from '../../shared/vote';
import type { Audio } from '../audio';
import { clear, copyText, h, isSubmitKey, toast } from '../dom';
import { jobBadge, settingsModal } from './common';

const ROLES: readonly Role[] = ['tank', 'healer', 'dps'];

/** The waiting room: invite code, party, job pick, the 8-option vote, chat and the ready / depart button. */
export class RoomScreen {
  readonly el: HTMLElement;
  private view: RoomView | null = null;
  private readonly keys = new Map<string, string>();
  private readonly pingEls = new Map<string, HTMLElement>();
  private readonly codeEl = h('strong', { class: 'room-code' });
  private readonly membersTitle = h('h3');
  private readonly members = h('div', { class: 'members' });
  private readonly partyBox = h('div', { class: 'party-box' });
  private readonly jobCards = new Map<JobId, { card: HTMLButtonElement; taken: HTMLElement }>();
  private readonly jobDetail = h('div', { class: 'job-detail' });
  private readonly voteBox = h('div', { class: 'votes' });
  private readonly action = h('div', { class: 'action' });
  private readonly log = h('div', { class: 'chat-log' });
  private readonly chatInput: HTMLInputElement;
  private tallyEl: HTMLElement | null = null;

  constructor(
    private readonly meId: string,
    private readonly send: (m: C2S) => void,
    private readonly audio: Audio,
    onLeave: () => void,
  ) {
    const groups = ROLES.map((role) =>
      h(
        'div',
        { class: 'job-group' },
        h('h4', { style: { color: ROLE_COLORS[role] } }, `${ROLE_NAMES[role]}（最多 ${ROLE_CAPS[role]} 人）`),
        h(
          'div',
          { class: `job-cards ${role}` },
          ...JOBS.filter((j) => j.role === role).map((j) => {
            const taken = h('span', { class: 'taken' });
            const card = h(
              'button',
              { class: 'job-card', onclick: () => this.send({ t: 'job', job: j.id }) },
              jobBadge(j.id, 'md'),
              h('span', { class: 'job-text' }, h('strong', null, j.name), h('span', { class: 'muted small' }, `${j.sub} · ${j.desc}`)),
              taken,
            );
            this.jobCards.set(j.id, { card, taken });
            return card;
          }),
        ),
      ),
    );

    this.chatInput = h('input', { class: 'input', maxLength: RULES.chatMax, placeholder: '說點什麼…（Enter 送出）' });
    const sendChat = () => {
      const text = this.chatInput.value.trim();
      if (text) this.send({ t: 'chat', text });
      this.chatInput.value = '';
    };
    // with a Chinese IME, the first Enter only confirms the composition
    this.chatInput.addEventListener('keydown', (e) => isSubmitKey(e) && sendChat());

    this.el = h(
      'div',
      { class: 'screen room' },
      h(
        'header',
        { class: 'topbar' },
        h('span', { class: 'logo small' }, '八方討伐'),
        h(
          'div',
          { class: 'code-box' },
          h('span', { class: 'muted small' }, '邀請碼'),
          this.codeEl,
          h('button', { class: 'btn small', onclick: () => void this.copy(false) }, '複製邀請碼'),
          h('button', { class: 'btn small', onclick: () => void this.copy(true) }, '複製邀請連結'),
        ),
        h('span', { class: 'grow' }),
        this.action,
        h('button', { class: 'btn ghost', onclick: () => settingsModal(this.audio) }, '設定'),
        h('button', { class: 'btn ghost', onclick: onLeave }, '離開房間'),
      ),
      h(
        'div',
        { class: 'room-body' },
        h(
          'div',
          { class: 'side' },
          h('section', { class: 'panel players' }, this.membersTitle, this.members, this.partyBox),
          h(
            'section',
            { class: 'panel chat' },
            h('h3', null, '聊天'),
            this.log,
            h('div', { class: 'row' }, this.chatInput, h('button', { class: 'btn', onclick: sendChat }, '送出')),
          ),
        ),
        h('section', { class: 'panel pick' }, h('h3', null, '選擇職業'), ...groups, this.jobDetail),
        h(
          'section',
          { class: 'panel vote' },
          h('h3', null, '投票：要打哪一關'),
          h('p', { class: 'muted small' }, '出發時 8 個選項一起開票，票最多的就打；平手隨機，沒人投票也隨機。再點一次取消。'),
          this.voteBox,
        ),
      ),
    );
  }

  private get me(): RoomMember | undefined {
    return this.view?.members.find((m) => m.id === this.meId);
  }

  update(view: RoomView): void {
    const prev = this.view;
    this.view = view;
    const me = this.me;
    this.codeEl.textContent = view.code;
    if (prev && view.members.length > prev.members.length) this.audio.play('join');
    if (view.phase === 'waiting') this.hideTally();

    const shape = view.members.map((m) => ({ ...m, ping: 0 }));
    if (this.changed('members', shape)) this.renderMembers(view);
    for (const m of view.members) {
      const el = this.pingEls.get(m.id);
      if (el) el.textContent = m.connected ? `${m.ping} ms` : '斷線中';
    }

    const jobs = view.members.map((m) => m.job);
    const others = view.members.filter((m) => m.id !== this.meId).map((m) => m.job);
    for (const [id, { card, taken }] of this.jobCards) {
      card.classList.toggle('on', me?.job === id);
      card.disabled = view.phase !== 'waiting' || (me?.job !== id && !roleHasRoom(others, id));
      const names = view.members.filter((m) => m.job === id).map((m) => m.name);
      taken.textContent = names.join('、');
    }
    if (me && this.changed('detail', me.job)) this.renderJobDetail(me.job);
    if (this.changed('party', jobs)) this.renderParty(jobs);
    if (this.changed('votes', [view.members.map((m) => [m.name, m.vote, m.id === this.meId]), view.phase])) this.renderVotes(view);
    const waitingOthers = view.members.filter((m) => !m.host);
    const ready = waitingOthers.filter((m) => m.ready).length;
    if (this.changed('action', [me?.host, me?.ready, ready, waitingOthers.length, view.phase])) {
      this.renderAction(view, ready, waitingOthers.length);
    }
  }

  private changed(part: string, data: unknown): boolean {
    const key = JSON.stringify(data);
    if (this.keys.get(part) === key) return false;
    this.keys.set(part, key);
    return true;
  }

  private async copy(link: boolean): Promise<void> {
    const code = this.view?.code;
    if (!code) return;
    const text = link ? `${location.origin}${location.pathname}?room=${code}` : code;
    if (await copyText(text)) toast(link ? '已複製邀請連結，貼給同事就能加入' : `已複製邀請碼 ${code}`);
    else toast(`無法自動複製，請手動告訴同事：${text}`, 'error');
  }

  private renderMembers(view: RoomView): void {
    this.membersTitle.textContent = `隊伍（${view.members.length}/${MAX_PLAYERS}）`;
    clear(this.members);
    this.pingEls.clear();
    for (const m of view.members) {
      const job = jobById(m.job);
      const ping = h('span', { class: 'muted small' });
      this.pingEls.set(m.id, ping);
      this.members.append(
        h(
          'div',
          { class: `member ${m.id === this.meId ? 'mine' : ''} ${m.connected ? '' : 'offline'}` },
          jobBadge(m.job, 'md'),
          h(
            'div',
            { class: 'member-info' },
            h('strong', null, m.name, m.id === this.meId ? '（你）' : ''),
            h('span', { class: 'muted small' }, `${job.name} · ${m.vote === null ? '還沒投票' : `投 ${optionLabel(m.vote)}`}`),
            h(
              'div',
              { class: 'row' },
              m.host
                ? h('span', { class: 'badge host' }, '房主')
                : h('span', { class: `badge ${m.ready ? 'ready' : 'wait'}` }, m.ready ? '準備好了' : '準備中…'),
              ping,
            ),
          ),
        ),
      );
    }
  }

  private renderParty(jobs: JobId[]): void {
    clear(this.partyBox);
    const n = roleCounts(jobs);
    this.partyBox.append(
      h(
        'div',
        { class: 'role-chips' },
        ...ROLES.map((r) => h('span', { class: 'role-chip', style: { borderColor: ROLE_COLORS[r] } }, `${ROLE_NAMES[r]} ${n[r]}/${ROLE_CAPS[r]}`)),
      ),
      h('p', { class: 'small' }, `Boss 血量 ${Math.round(hpScale(jobs) * 100)}%`, h('span', { class: 'muted' }, '（1 坦 1 補 2 DPS 為 100%）')),
      ...partyNotes(jobs).map((t) => h('p', { class: 'note small' }, t)),
    );
  }

  private renderJobDetail(id: JobId): void {
    const job = jobById(id);
    const lb = LIMIT_BREAKS[job.role];
    clear(this.jobDetail);
    this.jobDetail.append(
      h('h4', null, jobBadge(id, 'sm'), ` ${job.name}的技能`),
      h(
        'table',
        { class: 'skills' },
        h(
          'tbody',
          null,
          ...job.skills.map((s, k) =>
            h(
              'tr',
              null,
              h('td', { class: 'key' }, String(k + 1)),
              h('td', null, h('strong', null, s.name), h('span', { class: 'muted small' }, ` ${s.kind === 'gcd' ? 'GCD' : '能力技'} · ${s.cast ? `詠唱 ${s.cast} 秒` : '瞬發'} · ${s.cd ? `CD ${s.cd} 秒` : '無 CD'}`)),
              h('td', { class: 'small' }, s.desc),
            ),
          ),
          h(
            'tr',
            { class: 'lb' },
            h('td', { class: 'key' }, 'R'),
            h('td', null, h('strong', null, lb.name), h('span', { class: 'muted small' }, ' 全隊共用的極限技')),
            h('td', { class: 'small' }, lb.desc),
          ),
        ),
      ),
      h('p', { class: 'muted small' }, `已完成的 Boss：${ENCOUNTERS.filter((e) => hasBoss(e.id)).map((e) => e.boss).join('、')}；其他副本這一版還是訓練木人（會普攻、死刑與全場 AoE），之後陸續加入。`),
    );
  }

  private renderVotes(view: RoomView): void {
    clear(this.voteBox);
    const myVote = this.me?.vote ?? null;
    const open = view.phase === 'waiting';
    for (const [k, enc] of ENCOUNTERS.entries()) {
      const buttons = [false, true].map((hard) => {
        const opt = VOTE_OPTIONS[k * 2 + (hard ? 1 : 0)]!;
        const voters = view.members.filter((m) => m.vote === opt.index);
        const t = hard ? enc.times.hard : enc.times.normal;
        return h(
          'button',
          {
            class: `vote-btn ${hard ? 'hard' : 'normal'} ${myVote === opt.index ? 'on' : ''}`,
            disabled: !open,
            onclick: () => this.send({ t: 'vote', opt: myVote === opt.index ? null : opt.index }),
          },
          h('span', { class: 'diff' }, difficultyName(hard)),
          h('span', { class: 'muted small' }, `約 ${clock(t.target)}，狂暴 ${clock(t.enrage)}`),
          h('span', { class: 'count' }, voters.length ? `${voters.length} 票` : ''),
          h('span', { class: 'voters small' }, voters.map((m) => m.name).join('、')),
        );
      });
      this.voteBox.append(
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
          ...buttons,
        ),
      );
    }
  }

  private renderAction(view: RoomView, ready: number, others: number): void {
    const me = this.me;
    clear(this.action);
    if (view.phase === 'tally') {
      this.action.append(h('span', { class: 'big-note' }, '開票中…'));
      return;
    }
    if (view.phase !== 'waiting') {
      this.action.append(h('span', { class: 'big-note' }, view.phase === 'playing' ? '戰鬥中' : '結算中'));
      return;
    }
    if (me?.host) {
      this.action.append(
        h('span', { class: 'muted small' }, others ? `已準備 ${ready}/${others}` : '一個人也能出發（單人練習）'),
        h('button', { class: 'btn primary go-btn', onclick: () => this.send({ t: 'start' }) }, '出發'),
      );
    } else {
      this.action.append(
        h('span', { class: 'muted small' }, '全員準備後由房主出發'),
        h(
          'button',
          { class: `btn go-btn ${me?.ready ? '' : 'primary'}`, onclick: () => this.send({ t: 'ready', ready: !me?.ready }) },
          me?.ready ? '取消準備' : '準備',
        ),
      );
    }
  }

  /** The vote result, shown for a few seconds before the fight loads. */
  showTally(result: Tally): void {
    this.hideTally();
    const shown = result.counts.flatMap((c, k) => (c ? [{ k, c }] : [])).sort((a, b) => b.c - a.c);
    this.tallyEl = h(
      'div',
      { class: 'tally-back' },
      h(
        'div',
        { class: 'tally' },
        h('p', { class: 'muted' }, '開票結果'),
        h('h2', null, optionLabel(result.winner)),
        h(
          'p',
          { class: 'small' },
          shown.length ? shown.map(({ k, c }) => `${optionLabel(k)} ${c} 票`).join('　') : '沒有人投票，隨機選出',
        ),
        result.tied.length && shown.length ? h('p', { class: 'note small' }, `${result.tied.length} 個選項平手，隨機選出`) : null,
        h('p', { class: 'muted small' }, '準備出發…'),
      ),
    );
    this.el.append(this.tallyEl);
    this.audio.play('chime');
  }

  private hideTally(): void {
    this.tallyEl?.remove();
    this.tallyEl = null;
  }

  addChat(name: string, text: string): void {
    this.log.append(
      name ? h('div', null, h('strong', null, `${name}：`), text) : h('div', { class: 'system' }, text),
    );
    while (this.log.childElementCount > 80) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}
