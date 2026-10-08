import { RULES, TICK_RATE } from '../../shared/constants';
import { clock, difficultyName, encounterById } from '../../shared/encounters';
import { LIMIT_BREAKS, ROLE_HP, jobById } from '../../shared/jobs';
import { END_NAMES, type GameResult, type GameStartInfo, type Snapshot } from '../../shared/protocol';
import { h, isSubmitKey } from '../dom';
import { SKILL_ACTIONS, keysText, type Bindings } from '../keys';
import { jobBadge } from '../ui/common';

export interface HudActions {
  chat(text: string): void;
  leave(): void;
  endTest(): void;
  settings(): void;
}

/**
 * The fight HUD, laid out as in the design doc: boss bar on top, party list on the left, chat on the
 * right, own HP, hotbar and the LB gauge along the bottom. Plain DOM over the 3D canvas.
 */
export class Hud {
  readonly el: HTMLElement;
  readonly chatInput: HTMLInputElement;
  private readonly timer = h('div', { class: 'hud-timer' });
  private readonly center = h('div', { class: 'hud-center' });
  private readonly log = h('div', { class: 'hud-log' });
  private readonly chatBox: HTMLElement;
  private readonly hotbar = h('div', { class: 'hud-hotbar' });
  private readonly lbKey = h('span', { class: 'key' });
  private readonly help = h('span');
  private readonly fps = h('span', { class: 'fps' });
  private readonly endBtn: HTMLButtonElement;
  private readonly rows = new Map<string, HTMLElement>();
  private results: HTMLElement | null = null;
  private shownCount = -1;
  private fadeTimer = 0;

  constructor(
    private readonly info: GameStartInfo,
    private readonly meId: string,
    private readonly act: HudActions,
  ) {
    const enc = encounterById(info.enc);
    const me = info.players.find((p) => p.id === meId);
    const myJob = me ? jobById(me.job) : null;

    const party = h('ul', { class: 'party-list' });
    for (const p of info.players) {
      const job = jobById(p.job);
      const hp = ROLE_HP[job.role];
      const row = h(
        'li',
        { class: p.id === meId ? 'mine' : '' },
        jobBadge(p.job, 'sm'),
        h(
          'div',
          { class: 'pm' },
          h('span', { class: 'pm-name' }, p.name),
          h('div', { class: 'bar hp' }, h('i', { style: { width: '100%' } }), h('span', null, `${hp.toLocaleString()}`)),
        ),
      );
      this.rows.set(p.id, row);
      party.append(row);
    }

    this.chatInput = h('input', { class: 'input', maxLength: RULES.chatMax, placeholder: 'Enter 送出、Esc 取消' });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must not move the character or fire skills
      if (isSubmitKey(e)) {
        const text = this.chatInput.value.trim();
        if (text) this.act.chat(text);
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
    this.chatInput.addEventListener('blur', () => this.closeChat());
    this.chatBox = h('div', { class: 'hud-chat' }, this.log, this.chatInput);

    this.endBtn = h('button', { class: 'btn small', onclick: () => this.act.endTest() }, '結束測試');
    const hpMax = myJob ? ROLE_HP[myJob.role] : 0;

    this.el = h(
      'div',
      { class: 'hud' },
      h(
        'div',
        { class: 'hud-boss' },
        h('div', { class: 'boss-name' }, enc.boss, h('span', { class: `diff ${info.hard ? 'hard' : ''}` }, difficultyName(info.hard))),
        h('div', { class: 'bar boss-hp' }, h('i', { style: { width: '100%' } }), h('span', null, `血量 ${Math.round(info.hpScale * 100)}%`)),
        h('div', { class: 'boss-note' }, '這一版由木人代打，Boss 招式在 M3 加入'),
      ),
      h('div', { class: 'hud-party' }, h('h4', null, `隊伍 ${info.players.length} 人`), party),
      h(
        'div',
        { class: 'hud-top-right' },
        this.timer,
        h(
          'div',
          { class: 'hud-menu' },
          h('button', { class: 'btn small', onclick: () => this.act.settings() }, '設定'),
          this.endBtn,
          h('button', { class: 'btn small', onclick: () => this.act.leave() }, '離開'),
        ),
      ),
      this.center,
      this.chatBox,
      h(
        'div',
        { class: 'hud-bottom' },
        h(
          'div',
          { class: 'hud-self' },
          h('div', { class: 'bar hp big' }, h('i', { style: { width: '100%' } }), h('span', null, `HP ${hpMax.toLocaleString()} / ${hpMax.toLocaleString()}`)),
        ),
        this.hotbar,
      ),
      h(
        'div',
        { class: 'hud-lb' },
        h('strong', null, 'LB'),
        h('div', { class: 'bar lb' }, h('i', { style: { width: '0%' } })),
        myJob ? h('span', { class: 'muted small' }, LIMIT_BREAKS[myJob.role].name) : null,
        this.lbKey,
      ),
      h('div', { class: 'hud-help' }, this.help, this.fps),
    );
    this.setHost(false);
  }

  /** Key labels on the hotbar and in the help line follow the key settings. */
  setBindings(b: Bindings): void {
    const me = this.info.players.find((p) => p.id === this.meId);
    const job = me ? jobById(me.job) : null;
    this.hotbar.replaceChildren(
      ...SKILL_ACTIONS.map((action, k) => {
        const s = job?.skills[k];
        return h(
          'div',
          { class: `slot ${s?.kind ?? ''}`, title: s ? `${s.name}：${s.desc}` : '' },
          h('span', { class: 'key' }, keysText(b, action)),
          h('span', { class: 'name' }, s?.name ?? ''),
          s?.cd ? h('span', { class: 'cd' }, `${s.cd}s`) : null,
        );
      }),
    );
    this.lbKey.textContent = keysText(b, 'lb');
    this.help.textContent = `W A S D 移動 · 拖曳滑鼠轉鏡頭 · 滾輪縮放 · ${keysText(b, 'view')} 俯視 · ${keysText(b, 'chat')} 聊天 · `;
  }

  setHost(host: boolean): void {
    this.endBtn.hidden = !host;
  }

  /** Flashes a hotbar slot when its key is pressed. */
  pressSlot(k: number): void {
    const el = this.hotbar.children[k] as HTMLElement | undefined;
    if (!el) return;
    el.classList.remove('press');
    void el.offsetWidth; // restart the animation
    el.classList.add('press');
  }

  get chatting(): boolean {
    return document.activeElement === this.chatInput;
  }

  openChat(): void {
    this.chatBox.classList.add('open');
    this.chatInput.focus();
    this.showLog();
  }

  private closeChat(): void {
    this.chatInput.value = '';
    this.chatBox.classList.remove('open');
    if (document.activeElement === this.chatInput) this.chatInput.blur();
  }

  addChat(name: string, text: string): void {
    this.log.append(name ? h('div', null, h('strong', null, `${name}：`), text) : h('div', { class: 'system' }, text));
    while (this.log.childElementCount > 40) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    this.showLog();
  }

  /** The log fades 10 seconds after the last line (it stays while typing). */
  private showLog(): void {
    this.log.classList.remove('faded');
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      if (!this.chatting) this.log.classList.add('faded');
    }, 10_000);
  }

  /** Timer, countdown and who is disconnected. Returns the seconds left in the countdown (0 when fighting). */
  onSnap(s: Snapshot): number {
    const enc = encounterById(this.info.enc);
    const enrage = (this.info.hard ? enc.times.hard : enc.times.normal).enrage;
    this.timer.textContent = `${clock(s.el / TICK_RATE)} / 狂暴 ${clock(enrage)}`;
    const count = s.ph === 0 ? Math.ceil(s.cd / TICK_RATE) : 0;
    if (count !== this.shownCount) {
      this.shownCount = count;
      if (count > 0) this.center.replaceChildren(h('span', { class: 'count' }, String(count)), h('small', null, '戰鬥開始倒數，可以先走位'));
      else if (s.ph === 1) {
        this.center.replaceChildren(h('span', { class: 'go' }, '開戰！'));
        window.setTimeout(() => this.center.replaceChildren(), 1500);
      }
    }
    for (const p of s.p) this.rows.get(p.i)?.classList.toggle('offline', p.dc === 1);
    return count;
  }

  setFps(fps: number): void {
    this.fps.textContent = `${fps} fps`;
  }

  showResults(result: GameResult): void {
    this.results?.remove();
    this.results = h(
      'div',
      { class: 'hud-results' },
      h(
        'div',
        { class: 'results-card' },
        h('h2', { class: result.reason === 'clear' ? 'win' : 'lose' }, END_NAMES[result.reason]),
        h('p', null, `戰鬥時間 ${clock(result.time)}`),
        result.reason === 'test' ? h('p', { class: 'muted small' }, '這一版只有移動與連線；技能與戰鬥在下一版（M2）加入。') : null,
        h('p', { class: 'muted small' }, '稍後自動回到待機室'),
      ),
    );
    this.el.append(this.results);
  }
}
