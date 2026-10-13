import { FOES } from '../../shared/bosses/foes';
import { RULES, TICK_RATE } from '../../shared/constants';
import { clock, difficultyName, encounterById } from '../../shared/encounters';
import { LB_SLOT, LIMIT_BREAKS, jobById, type Job, type SkillInfo } from '../../shared/jobs';
import { END_NAMES, type FightEvent, type GameResult, type GameStartInfo, type SnapStatus, type Snapshot } from '../../shared/protocol';
import { STATUS, STATUS_IDS } from '../../shared/status';
import { h, isSubmitKey } from '../dom';
import { SKILL_ACTIONS, keysText, type Bindings } from '../keys';
import { jobBadge } from '../ui/common';

export interface HudActions {
  chat(text: string): void;
  leave(): void;
  endTest(): void;
  settings(): void;
  /** a click on a party member */
  target(id: string): void;
}

/** What the view knows about each hotbar slot that the snapshot does not: is there a target in range? */
export type SlotState = 'ok' | 'range' | 'target';

const pct = (v: number) => `${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%`;

/** Rebuilds an element's children only when `key` changed: the HUD updates 30 times a second. */
function paint(el: HTMLElement, key: string, build: () => HTMLElement[]): void {
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.replaceChildren(...build());
}

/** What the icons show: a status changes, or its seconds tick down to the tenth (the big ones). */
const stKey = (list: SnapStatus[] | undefined, big: boolean) =>
  (list ?? []).map(([k, left, v]) => `${k}:${big && left >= 0 ? Math.ceil(left / 3) : left >= 0 ? 1 : 0}:${big ? v : 0}`).join(',');
const secs = (ticks: number) => (ticks >= TICK_RATE * 10 ? String(Math.ceil(ticks / TICK_RATE)) : (ticks / TICK_RATE).toFixed(1));

/** Status icons, buffs first; zone statuses and 超越之力 have no timer. */
function statusIcons(list: SnapStatus[] | undefined, max: number, big = false): HTMLElement[] {
  if (!list) return [];
  return list
    .map(([k, left, v]) => ({ info: STATUS[STATUS_IDS[k]!], left, v }))
    .sort((a, b) => Number(b.info.good) - Number(a.info.good))
    .slice(0, max)
    .map(({ info, left, v }) =>
      h(
        'span',
        { class: `st ${info.good ? 'good' : 'bad'} ${big ? 'big' : ''}`, title: `${info.name}：${info.desc}` },
        h('b', null, info.icon),
        big && left >= 0 ? h('small', null, secs(left)) : info.shield && big ? h('small', null, String(v)) : null,
        // stacks (易傷, the twins' 共鳴)
        (info.taken === 0.5 || info.name === '共鳴') && v > 1 ? h('em', null, `×${v}`) : null,
      ),
    );
}

/** A button on the results card. */
export interface ResultAction {
  label: string;
  primary?: boolean;
  /** only the room's host may press it (直接重來, 返回待機室) */
  hostOnly?: boolean;
  onClick(): void;
}

/** What a combat log line is about, for its colour. */
export type LogKind = 'taken' | 'dealt' | 'heal' | 'cast' | 'death' | 'fail' | 'info';

/** The hover card for a skill: what kind, cast, cooldown, reach, then the description. */
function skillTip(s: SkillInfo): HTMLElement[] {
  const meta = [s.spell ? '魔法' : '', s.cast ? `詠唱 ${s.cast} 秒` : '瞬發', s.cd ? `冷卻 ${s.cd} 秒` : '', s.range ? `射程 ${s.range} m` : ''].filter(Boolean);
  return [
    h('div', { class: 'tip-head' }, h('strong', null, s.name), h('span', { class: `tip-kind ${s.kind}` }, s.kind === 'gcd' ? 'GCD' : '能力技')),
    h('div', { class: 'tip-meta' }, meta.join(' · ')),
    h('p', null, s.desc),
  ];
}

/**
 * The fight HUD, laid out as in the design doc: my statuses and the party list on the left, the boss bar
 * with its cast bar on top, my target top right, chat on the right, my HP, cast bar, hotbar and the LB
 * gauge along the bottom. Plain DOM over the 3D canvas.
 */
export class Hud {
  readonly el: HTMLElement;
  readonly chatInput: HTMLInputElement;
  private readonly job: Job | null;
  private readonly timer = h('div', { class: 'hud-timer' });
  private readonly center = h('div', { class: 'hud-center' });
  private readonly banner = h('div', { class: 'hud-banner' });
  private readonly log = h('div', { class: 'hud-log' });
  /** the other channel: who hit whom with what, for how much */
  private readonly combatLog = h('div', { class: 'hud-log combat' });
  private readonly chatTab: HTMLButtonElement;
  private readonly combatTab: HTMLButtonElement;
  private channel: 'chat' | 'combat' = 'chat';
  private readonly chatBox: HTMLElement;
  /** the skill card shown bottom right while the mouse is over a hotbar slot */
  private readonly tip = h('div', { class: 'hud-tip' });
  private resultActs: { btn: HTMLButtonElement; hostOnly: boolean }[] = [];
  private resultNote: HTMLElement | null = null;
  private host = false;
  private readonly hotbar = h('div', { class: 'hud-hotbar' });
  private readonly slots: { el: HTMLElement; sweep: HTMLElement; num: HTMLElement }[] = [];
  private readonly lbBox: HTMLElement;
  private readonly lbBar = h('i');
  private readonly lbPct = h('span');
  private readonly lbKey = h('span', { class: 'key' });
  private readonly help = h('span');
  private readonly fps = h('span', { class: 'fps' });
  private readonly endBtn: HTMLButtonElement;
  private readonly bossBox: HTMLElement;
  /** one bar per boss on screen (two for the twins until they merge) */
  private readonly bossList = h('div', { class: 'boss-list' });
  private readonly bossBars = new Map<string, { el: HTMLElement; hp: HTMLElement; text: HTMLElement; cast: HTMLElement; st: HTMLElement }>();
  private readonly freezeWarn = h('div', { class: 'hud-freeze' });
  /** what kind of move each enemy is casting (from the cast events): the cast bar's colour */
  private readonly castKinds = new Map<string, Extract<FightEvent, { k: 'bcast' }>['m']>();
  private readonly lbFlash = h('div', { class: 'lb-flash' });
  private lbFlashTimer = 0;
  private readonly target = h('div', { class: 'hud-target' });
  private readonly myStatus = h('div', { class: 'hud-status' });
  private readonly myHp = h('i');
  private readonly myShield = h('i', { class: 'shield' });
  private readonly myHpText = h('span');
  private readonly myCast = h('div', { class: 'cast-bar mine' });
  private readonly denyText = h('div', { class: 'hud-deny' });
  private readonly meter = h('ol', { class: 'meter' });
  private readonly rows = new Map<string, { li: HTMLElement; hp: HTMLElement; shield: HTMLElement; text: HTMLElement; st: HTMLElement; rank: HTMLElement }>();
  private readonly dealt = new Map<string, number>();
  /** party members in list order, for F1–F8 */
  readonly partyOrder: string[];
  private results: HTMLElement | null = null;
  private shownCount = -1;
  private fadeTimer = 0;
  private denyTimer = 0;
  private bannerTimer = 0;

  constructor(
    private readonly info: GameStartInfo,
    private readonly meId: string,
    private readonly act: HudActions,
  ) {
    const enc = encounterById(info.enc);
    const me = info.players.find((p) => p.id === meId);
    this.job = me ? jobById(me.job) : null;

    // the party list: me first, then in the order of the room; F1–F8 pick them
    const order = [...info.players].sort((a, b) => Number(b.id === meId) - Number(a.id === meId));
    const party = h('ul', { class: 'party-list' });
    order.forEach((p, k) => {
      const hp = h('i');
      const shield = h('i', { class: 'shield' });
      const text = h('span');
      const st = h('div', { class: 'pm-st' });
      const rank = h('span', { class: 'rank' });
      const li = h(
        'li',
        { class: p.id === meId ? 'mine' : '', onclick: () => this.act.target(p.id), title: `點一下或按 F${k + 1} 選取` },
        h('span', { class: 'fkey' }, `F${k + 1}`),
        jobBadge(p.job, 'sm'),
        h('div', { class: 'pm' }, h('span', { class: 'pm-name' }, p.name, rank), h('div', { class: 'bar hp' }, hp, shield, text), st),
      );
      this.rows.set(p.id, { li, hp, shield, text, st, rank });
      party.append(li);
    });
    this.partyOrder = order.map((p) => p.id);

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
    this.chatTab = h('button', { class: 'on', onclick: () => this.setChannel('chat') }, '聊天');
    this.combatTab = h('button', { onclick: () => this.setChannel('combat') }, '戰鬥紀錄');
    this.combatLog.hidden = true;
    this.chatBox = h('div', { class: 'hud-chat' }, h('div', { class: 'log-tabs' }, this.chatTab, this.combatTab), this.log, this.combatLog, this.chatInput);

    this.endBtn = h('button', { class: 'btn small', onclick: () => this.act.endTest() }, '結束測試');
    const lb = this.job ? LIMIT_BREAKS[this.job.role] : null;
    this.lbBox = h(
      'div',
      { class: 'hud-lb', title: lb ? `${lb.name}：${lb.desc}` : '' },
      h('strong', null, 'LB'),
      h('div', { class: 'bar lb' }, this.lbBar, this.lbPct),
      lb ? h('span', { class: 'lb-name' }, lb.name) : null,
      this.lbKey,
      this.lbFlash,
    );
    const boss = info.foes.find((f) => FOES[f.kind].boss) ?? info.foes[0];
    const note = info.echo
      ? `超越之力 +${info.echo * 10}%`
      : boss?.kind === 'dummy'
        ? '練習用木人：會普攻、死刑與全場 AoE'
        : '';
    this.bossBox = h(
      'div',
      { class: 'hud-boss' },
      h('div', { class: 'boss-title' }, h('span', { class: `diff ${info.hard ? 'hard' : ''}` }, `${enc.name} ${difficultyName(info.hard)}`)),
      this.bossList,
      note ? h('div', { class: 'boss-note' }, note) : null,
    );

    this.el = h(
      'div',
      { class: 'hud' },
      this.bossBox,
      h('div', { class: 'hud-left' }, this.myStatus, h('div', { class: 'hud-party' }, h('h4', null, `隊伍 ${info.players.length} 人`), party)),
      h(
        'div',
        { class: 'hud-top-right' },
        this.target,
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
      this.freezeWarn,
      this.banner,
      h('div', { class: 'hud-right' }, this.chatBox, h('details', { class: 'hud-meter', open: true }, h('summary', null, '每秒傷害'), this.meter)),
      h(
        'div',
        { class: 'hud-bottom' },
        this.myCast,
        this.denyText,
        h('div', { class: 'hud-self' }, h('div', { class: 'bar hp big' }, this.myHp, this.myShield, this.myHpText)),
        this.hotbar,
      ),
      this.lbBox,
      this.tip,
      h('div', { class: 'hud-help' }, this.help, this.fps),
    );
    this.tip.hidden = true;
    if (lb) this.hoverTip(this.lbBox, () => [h('div', { class: 'tip-head' }, h('strong', null, lb.name), h('span', { class: 'tip-kind lb' }, '極限技')), h('div', { class: 'tip-meta' }, `全隊共用一條量表，滿了才能用${lb.cast ? ` · 詠唱 ${lb.cast} 秒` : ' · 瞬發'}`), h('p', null, lb.desc)]);
    this.setHost(false);
  }

  /** Shows the card bottom right while the mouse is over `el`. */
  private hoverTip(el: HTMLElement, build: () => HTMLElement[]): void {
    el.removeAttribute('title');
    el.addEventListener('mouseenter', () => {
      this.tip.replaceChildren(...build());
      this.tip.hidden = false;
    });
    el.addEventListener('mouseleave', () => (this.tip.hidden = true));
  }

  /** 聊天 or 戰鬥紀錄; the one not shown marks new lines with a dot. */
  private setChannel(c: 'chat' | 'combat'): void {
    this.channel = c;
    this.chatTab.classList.toggle('on', c === 'chat');
    this.combatTab.classList.toggle('on', c === 'combat');
    (c === 'chat' ? this.chatTab : this.combatTab).classList.remove('new');
    this.log.hidden = c !== 'chat';
    this.combatLog.hidden = c !== 'combat';
    const box = c === 'chat' ? this.log : this.combatLog;
    box.scrollTop = box.scrollHeight;
    this.showLog();
  }


  /** Key labels on the hotbar and in the help line follow the key settings. */
  setBindings(b: Bindings): void {
    const job = this.job;
    this.slots.length = 0;
    this.hotbar.replaceChildren(
      ...SKILL_ACTIONS.map((action, k) => {
        const s = job?.skills[k];
        const sweep = h('i', { class: 'sweep' });
        const num = h('em');
        const el = h(
          'div',
          { class: `slot ${s?.kind ?? ''}` },
          sweep,
          h('span', { class: 'key' }, keysText(b, action)),
          h('span', { class: 'name' }, s?.name ?? ''),
          h('span', { class: 'meta' }, s ? (s.kind === 'gcd' ? (s.cast ? `詠唱 ${s.cast}s` : 'GCD') : '能力技') : ''),
          num,
        );
        if (s) this.hoverTip(el, () => skillTip(s));
        this.slots.push({ el, sweep, num });
        return el;
      }),
    );
    this.lbKey.textContent = keysText(b, 'lb');
    this.help.textContent = `W A S D 移動 · 拖曳轉鏡頭 · 滾輪縮放 · Tab 選敵人 · F1–F8 選隊友 · Esc 取消目標 · ${keysText(b, 'view')} 俯視 · ${keysText(b, 'chat')} 聊天 · `;
  }

  setHost(host: boolean): void {
    this.host = host;
    this.endBtn.hidden = !host;
    for (const a of this.resultActs) if (a.hostOnly) a.btn.disabled = !host;
    if (this.resultNote) this.resultNote.textContent = host ? '你是房主：選擇直接重來或返回待機室（60 秒內沒選就回待機室）' : '等房主選擇：直接重來或返回待機室';
  }

  /** Flashes a hotbar slot (or the LB box) when its key is pressed. */
  pressSlot(k: number): void {
    const el = k === LB_SLOT ? this.lbBox : this.slots[k]?.el;
    if (!el) return;
    el.classList.remove('press');
    void el.offsetWidth; // restart the animation
    el.classList.add('press');
  }

  /** Why a skill did not go off, above the hotbar for a moment. */
  deny(text: string): void {
    this.denyText.textContent = text;
    this.denyText.classList.add('show');
    window.clearTimeout(this.denyTimer);
    this.denyTimer = window.setTimeout(() => this.denyText.classList.remove('show'), 1200);
  }

  /** An enemy started a cast: tank busters show red, raid-wides purple, the enrage dark red. */
  castKind(id: string, m: Extract<FightEvent, { k: 'bcast' }>['m']): void {
    this.castKinds.set(id, m);
  }

  /** The freeze check (深度凍結): a warning in the middle of the screen until it ends (ms left, or null). */
  freeze(left: number | null): void {
    this.freezeWarn.classList.toggle('show', left !== null);
    if (left !== null) this.freezeWarn.textContent = left > 1500 ? `讀條結束時不要移動 ${(left / 1000).toFixed(1)}` : `停！ ${(left / 1000).toFixed(1)}`;
  }

  /** A line over the LB gauge for a moment (a mechanic done without a mistake). */
  flashLb(text: string): void {
    this.lbFlash.textContent = text;
    this.lbFlash.classList.remove('show');
    void this.lbFlash.offsetWidth;
    this.lbFlash.classList.add('show');
    window.clearTimeout(this.lbFlashTimer);
    this.lbFlashTimer = window.setTimeout(() => this.lbFlash.classList.remove('show'), 2400);
  }

  /** A big line in the middle of the screen (a Limit Break going off). */
  announce(text: string, cls = ''): void {
    this.banner.replaceChildren(h('span', { class: cls }, text));
    this.banner.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), 2200);
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
    this.append(this.log, name ? h('div', null, h('strong', null, `${name}：`), text) : h('div', { class: 'system' }, text), 60);
    if (this.channel !== 'chat') this.chatTab.classList.add('new');
    this.showLog();
  }

  /** A line in the 戰鬥紀錄 channel; `mine`: it happened to me (stands out). */
  logCombat(kind: LogKind, text: string, mine = false): void {
    this.append(this.combatLog, h('div', { class: `cl ${kind}${mine ? ' mine' : ''}` }, text), 300);
    if (this.channel !== 'combat') this.combatTab.classList.add('new');
  }

  /** Adds a line and keeps the box at the bottom, unless someone scrolled up to read. */
  private append(box: HTMLElement, line: HTMLElement, max: number): void {
    const atBottom = box.hidden || box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    box.append(line);
    while (box.childElementCount > max) box.firstElementChild?.remove();
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  /** The log fades 10 seconds after the last line (it stays while typing). */
  private showLog(): void {
    this.log.classList.remove('faded');
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      if (!this.chatting) this.log.classList.add('faded');
    }, 10_000);
  }

  /** Damage dealt, for the live meter. */
  addDealt(src: string, amount: number): void {
    this.dealt.set(src, (this.dealt.get(src) ?? 0) + amount);
  }

  /**
   * Everything that changes with the fight. `target` is my current target; `slots` whether each skill
   * has something in range. Returns the seconds left in the countdown (0 when fighting).
   */
  onSnap(s: Snapshot, target: string | null, slots: SlotState[]): number {
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

    // the bosses: one bar each (the twins side by side), with what they cast and their own statuses
    const bosses = s.e.filter((e) => FOES[e.kd].boss && !(e.g && e.hp > 0));
    const boss = bosses[0] ?? s.e[0];
    for (const e of bosses) {
      let bar = this.bossBars.get(e.i);
      if (!bar) {
        const hp = h('i');
        const text = h('span');
        const cast = h('div', { class: 'cast-bar boss' });
        const st = h('div', { class: 'boss-st' });
        const el = h('div', { class: `boss-row ${e.kd}` }, h('div', { class: 'boss-name' }, FOES[e.kd].name, st), h('div', { class: 'bar boss-hp' }, hp, text), cast);
        bar = { el, hp, text, cast, st };
        this.bossBars.set(e.i, bar);
        this.bossList.append(el);
      }
      bar.hp.style.width = pct(e.hp / e.mh);
      bar.text.textContent = e.u ? `${pct(e.hp / e.mh)}（無法選取）` : pct(e.hp / e.mh);
      bar.el.classList.toggle('dim', e.u === 1);
      this.castBar(bar.cast, e.c ? { name: e.c[0], left: e.c[1], total: e.c[2] } : null);
      bar.cast.dataset.m = e.c ? (this.castKinds.get(e.i) ?? 'mech') : '';
      paint(bar.st, stKey(e.st, false), () => statusIcons(e.st, 4));
    }
    for (const [id, bar] of this.bossBars) {
      if (bosses.some((e) => e.i === id)) continue;
      bar.el.remove();
      this.bossBars.delete(id);
    }
    this.bossList.classList.toggle('two', this.bossBars.size > 1);

    // the party; the enmity rank follows my target (or the boss)
    const ranks = (s.e.find((e) => e.i === target) ?? boss)?.ag ?? [];
    for (const p of s.p) {
      const row = this.rows.get(p.i);
      if (!row) continue;
      row.li.classList.toggle('offline', p.dc === 1);
      row.li.classList.toggle('dead', p.d === 1);
      row.li.classList.toggle('picked', p.i === target);
      row.hp.style.width = pct(p.hp / p.mh);
      row.shield.style.width = pct(Math.min(1, p.sh / p.mh));
      row.text.textContent = p.d ? '倒地' : p.hp.toLocaleString();
      paint(row.st, stKey(p.st, false), () => statusIcons(p.st, 5));
      const r = ranks.indexOf(p.i);
      row.rank.textContent = r === 0 ? '仇恨 1' : '';
    }

    // me
    const me = s.p.find((p) => p.i === this.meId);
    if (me) {
      this.myHp.style.width = pct(me.hp / me.mh);
      this.myShield.style.width = pct(Math.min(1, me.sh / me.mh));
      this.myHpText.textContent = me.d ? '倒地：等待補師復活' : `HP ${me.hp.toLocaleString()} / ${me.mh.toLocaleString()}${me.sh ? `（護盾 ${me.sh.toLocaleString()}）` : ''}`;
      paint(this.myStatus, stKey(me.st, true), () => statusIcons(me.st, 10, true));
      const cast = me.c;
      const castName = cast ? (cast[0] === LB_SLOT && this.job ? LIMIT_BREAKS[this.job.role].name : (this.job?.skills[cast[0]]?.name ?? '')) : '';
      this.castBar(this.myCast, cast ? { name: castName, left: cast[1], total: cast[2] } : null);
      this.paintSlots(me.g, me.cd, me.cb, me.d === 1 || s.ph !== 1, slots);
    }
    this.paintLb(s.lb, me?.d === 1);
    this.paintTarget(s, target);
    this.paintMeter(s);
    return count;
  }

  private castBar(el: HTMLElement, c: { name: string; left: number; total: number } | null): void {
    el.classList.toggle('show', !!c);
    if (!c) return;
    const done = 1 - c.left / Math.max(1, c.total);
    const fill = el.firstElementChild as HTMLElement | null;
    const label = el.lastElementChild as HTMLElement | null;
    if (!fill || !label || fill === label) el.replaceChildren(h('i'), h('span'));
    (el.firstElementChild as HTMLElement).style.width = pct(done);
    (el.lastElementChild as HTMLElement).textContent = `${c.name}  ${(c.left / TICK_RATE).toFixed(1)}`;
  }

  private paintSlots(g: [number, number], cd: number[], combo: number, off: boolean, states: SlotState[]): void {
    const job = this.job;
    if (!job) return;
    this.slots.forEach(({ el, sweep, num }, k) => {
      const s = job.skills[k]!;
      const own = cd[k] ?? 0;
      const gcd = s.kind === 'gcd' ? g[0] : 0;
      const left = Math.max(own, gcd);
      const frac = own >= gcd ? own / Math.max(1, s.cd * TICK_RATE) : gcd / Math.max(1, g[1]);
      sweep.style.background = left > 0 ? `conic-gradient(rgba(8, 6, 20, 0.72) ${(frac * 360).toFixed(1)}deg, transparent 0)` : '';
      num.textContent = own > 0 ? secs(own) : '';
      el.classList.toggle('combo', !!s.combo);
      if (s.combo) el.dataset.step = String(combo + 1);
      el.classList.toggle('off', off || states[k] === 'target');
      el.classList.toggle('far', !off && states[k] === 'range');
    });
  }

  private paintLb(lb: number, dead: boolean): void {
    const full = lb >= 1000;
    this.lbBar.style.width = `${lb / 10}%`;
    this.lbPct.textContent = full ? '可發動' : `${Math.floor(lb / 10)}%`;
    this.lbBox.classList.toggle('full', full && !dead);
  }

  private paintTarget(s: Snapshot, id: string | null): void {
    if (!id) {
      this.target.classList.remove('show');
      return;
    }
    const foe = s.e.find((e) => e.i === id);
    const p = s.p.find((x) => x.i === id);
    const name = foe ? FOES[foe.kd].name : (this.info.players.find((x) => x.id === id)?.name ?? '');
    if (!foe && !p) {
      this.target.classList.remove('show');
      return;
    }
    const frac = foe ? foe.hp / foe.mh : p!.hp / p!.mh;
    const cast = foe?.c;
    this.target.classList.add('show');
    this.target.classList.toggle('ally', !foe);
    const st = foe ? foe.st : p!.st;
    paint(this.target, `${id}|${Math.round(frac * 1000)}|${cast?.[0] ?? ''}|${stKey(st, false)}|${p?.d ?? ''}`, () => {
      const parts = [
        h('div', { class: 'tg-name' }, foe ? '目標' : '隊友', h('strong', null, name)),
        h(
          'div',
          { class: `bar ${foe ? 'boss-hp' : 'hp'}` },
          h('i', { style: { width: pct(frac) } }),
          h('span', null, foe ? pct(frac) : p!.d ? '倒地' : `${p!.hp.toLocaleString()} / ${p!.mh.toLocaleString()}`),
        ),
      ];
      if (cast) parts.push(h('div', { class: 'tg-cast' }, `讀條：${cast[0]}`));
      parts.push(h('div', { class: 'tg-st' }, ...statusIcons(st, 6)));
      return parts;
    });
  }

  private paintMeter(s: Snapshot): void {
    if (s.k % 15 !== 0) return; // twice a second is plenty
    const secsIn = Math.max(1, s.el / TICK_RATE);
    const rows = this.info.players
      .map((p) => ({ p, dps: (this.dealt.get(p.id) ?? 0) / secsIn }))
      .sort((a, b) => b.dps - a.dps);
    const top = Math.max(1, rows[0]?.dps ?? 1);
    this.meter.replaceChildren(
      ...rows.map(({ p, dps }) =>
        h(
          'li',
          { class: p.id === this.meId ? 'mine' : '' },
          h('i', { style: { width: pct(dps / top) } }),
          jobBadge(p.job, 'sm'),
          h('span', { class: 'who' }, p.name),
          h('b', null, Math.round(dps).toLocaleString()),
        ),
      ),
    );
  }

  setFps(fps: number): void {
    this.fps.textContent = `${fps} fps`;
  }

  /**
   * The results card. `actions`: 再打一次 / 換關卡 in offline practice; in a room 直接重來 / 返回待機室,
   * which only the host can press (the others see who decides).
   */
  showResults(result: GameResult, actions?: readonly ResultAction[]): void {
    this.results?.remove();
    const secsIn = Math.max(1, result.time);
    const rows = [...result.stats].sort((a, b) => b.dmg - a.dmg);
    this.results = h(
      'div',
      { class: 'hud-results' },
      h(
        'div',
        { class: 'results-card' },
        h('h2', { class: result.reason === 'clear' ? 'win' : 'lose' }, END_NAMES[result.reason]),
        h('p', null, `戰鬥時間 ${clock(result.time)}${result.reason === 'clear' ? '' : `，Boss 剩 ${Math.round(result.bossHp * 100)}%`}`),
        h(
          'table',
          { class: 'stats' },
          h('thead', null, h('tr', null, h('th', null, ''), h('th', null, '玩家'), h('th', null, '每秒傷害'), h('th', null, '每秒治療'), h('th', null, '承受傷害'), h('th', null, '倒地'), h('th', null, '失誤'))),
          h(
            'tbody',
            null,
            ...rows.map((st) => {
              const p = this.info.players.find((x) => x.id === st.id);
              return h(
                'tr',
                { class: st.id === this.meId ? 'mine' : '' },
                h('td', null, p ? jobBadge(p.job, 'sm') : null),
                h('td', null, p?.name ?? ''),
                h('td', null, Math.round(st.dmg / secsIn).toLocaleString()),
                h('td', null, Math.round(st.heal / secsIn).toLocaleString()),
                h('td', null, st.taken.toLocaleString()),
                h('td', null, String(st.deaths)),
                h('td', null, String(st.mistakes)),
              );
            }),
          ),
        ),
        actions ? h('div', { class: 'results-actions' }, ...this.resultButtons(actions)) : h('p', { class: 'muted small' }, '稍後自動回到待機室'),
        (this.resultNote = actions?.some((x) => x.hostOnly) ? h('p', { class: 'muted small' }) : null),
      ),
    );
    this.el.append(this.results);
    this.setHost(this.host);
  }

  private resultButtons(actions: readonly ResultAction[]): HTMLButtonElement[] {
    this.resultActs = actions.map((x) => ({
      btn: h('button', { class: `btn${x.primary ? ' primary' : ''}`, onclick: x.onClick }, x.label),
      hostOnly: !!x.hostOnly,
    }));
    return this.resultActs.map((a) => a.btn);
  }
}
