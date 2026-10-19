import { jobById, skillAt, type JobId } from '../../shared/jobs';
import { clear, h, toast } from '../dom';
import { loadLayout } from '../hotbar';
import {
  BAR_ACTIONS,
  KEY_ACTIONS,
  assignKey,
  isModifier,
  keyLabel,
  keyProblem,
  loadBindings,
  normalizeCode,
  parseBindings,
  problemText,
  saveBindings,
  withoutKey,
  type Bindings,
  type KeyAction,
} from '../keys';

/**
 * Key settings table (from 水球大亂鬥): click a slot, then press one key. A key that another action
 * already has swaps over (a notice says which); a movement key, a key held together with Ctrl / Shift /
 * Alt, or a mouse button gets a warning and the slot keeps waiting; Esc cancels, Backspace or × empties
 * the slot. With `job`, the 12 hotbar keys show which of its skills each slot holds now. Saved at once.
 */
export function keyEditor(job?: JobId): HTMLElement {
  let b: Bindings = loadBindings();
  const layout = job ? loadLayout(job) : null;
  const labelOf = (action: KeyAction, label: string) => {
    const pos = BAR_ACTIONS.indexOf(action);
    if (!job || !layout || pos < 0) return label;
    const skill = layout[pos];
    const s = skill === null || skill === undefined ? null : skillAt(jobById(job), skill);
    return `${label}　${s ? s.name : '（空）'}`;
  };
  let capture: { action: KeyAction; slot: number } | null = null;
  /** a lone Ctrl / Shift / Alt counts once it is released without another key in between */
  let held: string | null = null;
  const table = h('table', { class: 'keys key-table' });
  const notice = h('div', { class: 'key-notice', role: 'alert' });

  const say = (text: string, bad = false) => {
    notice.textContent = text;
    notice.classList.toggle('bad', bad);
  };
  const warn = (text: string) => {
    say(text, true);
    toast(text, 'error');
  };

  const render = () => {
    clear(table);
    const fixed = (label: string, keys: string[]) =>
      h('tr', null, h('td', null, label), h('td', null, ...keys.map((k) => h('span', { class: 'key-slot fixed' }, k))));
    const rows = KEY_ACTIONS.map(({ action, label, slots }) => {
      const list = b[action];
      const shown = Math.min(slots, list.length + 1); // the keys, plus one empty slot while there is room
      const cells = Array.from({ length: shown }, (_, slot) => {
        const waiting = capture?.action === action && capture.slot === slot;
        const code = list[slot];
        const btn = h(
          'button',
          {
            class: `key-slot ${waiting ? 'capturing' : ''} ${code ? '' : 'empty'}`,
            title: code ? '點一下換鍵' : '點一下加一個鍵',
            onclick: () => start(action, slot),
          },
          waiting ? '請按鍵…' : code ? keyLabel(code) : '＋',
        );
        if (!code || waiting) return btn;
        const x = h('button', { class: 'key-clear', title: '清空這個鍵', onclick: () => clearKey(action, slot) }, '×');
        return h('span', { class: 'key-pair' }, btn, x);
      });
      return h('tr', null, h('td', null, labelOf(action, label)), h('td', null, ...cells));
    });
    table.append(
      h(
        'tbody',
        null,
        fixed('移動', ['W A S D', '方向鍵']),
        fixed('轉鏡頭 / 縮放', ['滑鼠拖曳', '滾輪']),
        fixed('選敵人', ['Tab', '點選']),
        fixed('選隊友', ['F1–F8', '點隊伍清單']),
        fixed('取消目標', ['Esc']),
        ...rows,
      ),
    );
  };

  const start = (action: KeyAction, slot: number) => {
    stop();
    capture = { action, slot };
    held = null;
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    for (const ev of ['mousedown', 'click', 'auxclick', 'contextmenu'] as const) window.addEventListener(ev, onMouse, true);
    say('按下要設定的鍵（只能一個鍵）；Esc 取消，Backspace 清空這一格');
    render();
  };

  const stop = () => {
    window.removeEventListener('keydown', onDown, true);
    window.removeEventListener('keyup', onUp, true);
    for (const ev of ['mousedown', 'click', 'auxclick', 'contextmenu'] as const) window.removeEventListener(ev, onMouse, true);
    capture = null;
    held = null;
    render();
  };

  const nameOf = (action: KeyAction) => labelOf(action, KEY_ACTIONS.find((x) => x.action === action)?.label ?? action);

  const apply = (code: string) => {
    if (!capture) return;
    const problem = keyProblem(b, capture.action, capture.slot, code);
    // a key in use swaps over; movement and reserved keys still cannot be taken
    if (problem && problem.kind !== 'taken') return warn(problemText(problem));
    const before = b[capture.action][capture.slot];
    const { b: next, swapped } = assignKey(b, capture.action, capture.slot, code);
    b = next;
    saveBindings(b);
    if (swapped) {
      const text = before
        ? `${keyLabel(code)} 原本在「${nameOf(swapped)}」，已互換：它改用 ${keyLabel(before)}`
        : `${keyLabel(code)} 原本在「${nameOf(swapped)}」，已移過來（那一格現在少了這個鍵）`;
      say(text, true);
      toast(text);
    } else say(`已設定為 ${keyLabel(code)}`);
    stop();
  };

  const clearKey = (action: KeyAction, slot: number) => {
    b = withoutKey(b, action, slot);
    saveBindings(b);
    say(`已清空「${nameOf(action)}」的一個鍵`);
    render();
  };

  const onDown = (e: KeyboardEvent) => {
    if (!capture) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      say('');
      return stop();
    }
    if (e.code === 'Backspace') {
      b = withoutKey(b, capture.action, capture.slot);
      saveBindings(b);
      say('已清空這一格');
      return stop();
    }
    const combo = () => {
      held = null;
      warn('不支援組合鍵，請只按一個鍵');
    };
    if (!e.code || e.code === 'Unidentified') return warn(problemText({ kind: 'unknown' }));
    if (isModifier(e.code)) {
      // its own flag is set on its own keydown; any other modifier being down makes it a combination
      const self = normalizeCode(e.code);
      const others =
        (e.ctrlKey && self !== 'ControlLeft') || (e.shiftKey && self !== 'ShiftLeft') || (e.altKey && self !== 'AltLeft') || e.metaKey;
      if (others || (held !== null && held !== self)) return combo();
      held = self; // decided on release
      return;
    }
    if (held !== null || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return combo();
    apply(e.code);
  };

  const onUp = (e: KeyboardEvent) => {
    if (!capture || held === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (normalizeCode(e.code) !== held) return;
    const code = held;
    held = null;
    apply(code);
  };

  const onMouse = (e: MouseEvent) => {
    if (!capture) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'mousedown') warn('只能用鍵盤按鍵，不能設定滑鼠；按 Esc 取消');
  };

  const reset = h(
    'button',
    {
      class: 'btn small',
      onclick: () => {
        b = parseBindings(null);
        saveBindings(b);
        say('已恢復預設按鍵');
        render();
      },
    },
    '恢復預設',
  );
  render();
  return h(
    'div',
    { class: 'key-editor' },
    table,
    notice,
    h('div', { class: 'row' }, reset, h('span', { class: 'muted small' }, '設定存在這個瀏覽器，改完馬上生效。')),
  );
}
