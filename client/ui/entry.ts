import { ROOM_CODE_LEN, RULES, VERSION } from '../../shared/constants';
import { JOBS } from '../../shared/jobs';
import { isRoomCode, normalizeCode } from '../../shared/roomcode';
import type { Audio } from '../audio';
import { h, isSubmitKey, store, toast } from '../dom';
import { jobBadge, settingsModal } from './common';

export interface EntryScreen {
  el: HTMLElement;
  setBusy(busy: boolean): void;
}

/**
 * Nickname, then create a room or join one with an invite code (there is no lobby). An invite link
 * (?room=CODE) fills the code in, so a colleague only types a nickname.
 */
export function entryScreen(opts: {
  audio: Audio;
  code?: string;
  onCreate(name: string): void;
  onJoin(name: string, code: string): void;
}): EntryScreen {
  const name = h('input', {
    class: 'input big',
    maxLength: RULES.nameMax,
    placeholder: `輸入暱稱（最多 ${RULES.nameMax} 字）`,
    value: store.get('octaraid.name') ?? '',
  });
  const code = h('input', {
    class: 'input code',
    maxLength: 8,
    placeholder: '邀請碼',
    value: opts.code ?? '',
    autocomplete: 'off',
    spellcheck: false,
  });
  code.addEventListener('input', () => {
    code.value = code.value.toUpperCase();
  });
  const createBtn = h('button', { class: 'btn big', onclick: () => go('create') }, '建立房間');
  const joinBtn = h('button', { class: 'btn big', onclick: () => go('join') }, '加入房間');
  (opts.code ? joinBtn : createBtn).classList.add('primary');

  const nickname = (): string | null => {
    const n = name.value.trim();
    if (!n) {
      toast('請先輸入暱稱', 'error');
      name.focus();
      return null;
    }
    store.set('octaraid.name', n);
    return n;
  };
  const go = (kind: 'create' | 'join') => {
    opts.audio.unlock();
    const n = nickname();
    if (!n) return;
    if (kind === 'create') return opts.onCreate(n);
    const c = normalizeCode(code.value);
    if (!isRoomCode(c)) {
      toast(`邀請碼是 ${ROOM_CODE_LEN} 個英文字母或數字`, 'error');
      code.focus();
      return;
    }
    opts.onJoin(n, c);
  };
  name.addEventListener('keydown', (e) => isSubmitKey(e) && go(opts.code ? 'join' : 'create'));
  code.addEventListener('keydown', (e) => isSubmitKey(e) && go('join'));

  const el = h(
    'div',
    { class: 'screen entry' },
    h(
      'div',
      { class: 'entry-card' },
      h('h1', { class: 'logo' }, '八方討伐'),
      h('p', { class: 'muted' }, '團隊討伐戰 · 1–8 人連線 · 選好職業，合力把王打倒'),
      h('div', { class: 'parade' }, ...JOBS.map((j) => jobBadge(j.id, 'lg'))),
      name,
      h('div', { class: 'entry-actions' }, createBtn),
      h('div', { class: 'divider' }, h('span', null, '或用同事給的邀請碼')),
      h('div', { class: 'entry-actions' }, code, joinBtn),
      h('p', { class: 'hint' }, 'W A S D 移動 · 拖曳滑鼠轉鏡頭 · 滾輪縮放 · 1–5 技能'),
      h(
        'div',
        { class: 'entry-tools' },
        h('button', { class: 'btn ghost small', onclick: () => settingsModal(opts.audio) }, '設定與按鍵'),
        h('a', { class: 'btn ghost small', href: '?sandbox' }, '離線練習'),
      ),
      h('p', { class: 'hint small' }, `v${VERSION}`),
    ),
  );
  requestAnimationFrame(() => (opts.code && name.value ? code : name).focus());
  return {
    el,
    setBusy(busy: boolean) {
      createBtn.disabled = busy;
      joinBtn.disabled = busy;
    },
  };
}
