/**
 * Key settings. Moving always uses W A S D and the arrow keys; every other action can be rebound, each to
 * a few single keys (no combinations, no mouse). Keys are stored by their position on the keyboard
 * (KeyboardEvent.code), so a Chinese IME being on does not matter, and saved in this browser.
 */
export type KeyAction = 'skill1' | 'skill2' | 'skill3' | 'skill4' | 'skill5' | 'lb' | 'chat' | 'view' | 'mute';
export type Bindings = Record<KeyAction, string[]>;

export const KEY_ACTIONS: readonly { action: KeyAction; label: string; slots: number }[] = [
  { action: 'skill1', label: '技能 1（基礎）', slots: 2 },
  { action: 'skill2', label: '技能 2', slots: 2 },
  { action: 'skill3', label: '技能 3', slots: 2 },
  { action: 'skill4', label: '技能 4', slots: 2 },
  { action: 'skill5', label: '技能 5', slots: 2 },
  { action: 'lb', label: '極限技（LB）', slots: 1 },
  { action: 'chat', label: '聊天', slots: 1 },
  { action: 'view', label: '切換俯視鏡頭', slots: 1 },
  { action: 'mute', label: '靜音', slots: 1 },
];

export const SKILL_ACTIONS: readonly KeyAction[] = ['skill1', 'skill2', 'skill3', 'skill4', 'skill5'];

export const DEFAULT_BINDINGS: Readonly<Bindings> = {
  skill1: ['Digit1'],
  skill2: ['Digit2'],
  skill3: ['Digit3'],
  skill4: ['Digit4'],
  skill5: ['Digit5'],
  lb: ['KeyR'],
  chat: ['Enter'],
  view: ['KeyV'],
  mute: ['KeyM'],
};

/** Movement keys: forward, back, left and right relative to the camera. */
export type MoveKey = 'f' | 'b' | 'l' | 'r';
export const MOVE_KEYS: Readonly<Record<string, MoveKey>> = {
  KeyW: 'f',
  KeyS: 'b',
  KeyA: 'l',
  KeyD: 'r',
  ArrowUp: 'f',
  ArrowDown: 'b',
  ArrowLeft: 'l',
  ArrowRight: 'r',
};

const MODIFIERS = new Set(['ControlLeft', 'ShiftLeft', 'AltLeft']);
/**
 * Keys the browser or the system takes first, plus Esc (cancel) and Backspace (clear) of the editor.
 * Tab and F1–F8 are kept for choosing targets (M2).
 */
const RESERVED = /^(Escape|Tab|Backspace|F\d{1,2}|Meta(Left|Right)|OS(Left|Right)|ContextMenu|CapsLock|NumLock|ScrollLock|PrintScreen|Pause|Fn|FnLock)$/;

/** Left and right Ctrl, Shift or Alt count as the same key. */
export function normalizeCode(code: string): string {
  return /^(Control|Shift|Alt)Right$/.test(code) ? code.replace(/Right$/, 'Left') : code;
}

export const isModifier = (code: string) => MODIFIERS.has(normalizeCode(code));

const NAMES: Readonly<Record<string, string>> = {
  Space: 'Space',
  ControlLeft: 'Ctrl',
  ShiftLeft: 'Shift',
  AltLeft: 'Alt',
  Enter: 'Enter',
  NumpadEnter: '數字鍵 Enter',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

export function keyLabel(code: string): string {
  const c = normalizeCode(code);
  if (NAMES[c]) return NAMES[c];
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (c.startsWith('Numpad')) return `數字鍵 ${c.slice(6)}`;
  return c;
}

/** The keys of an action as shown in hints, e.g. "1 / Q". */
export function keysText(b: Bindings, action: KeyAction): string {
  return b[action].map(keyLabel).join(' / ');
}

export type KeyProblem =
  | { kind: 'unknown' }
  | { kind: 'move' }
  | { kind: 'reserved' }
  | { kind: 'taken'; action: KeyAction; label: string };

/** Why `code` cannot go into slot `slot` of `action`, or null when it can. */
export function keyProblem(b: Bindings, action: KeyAction, slot: number, code: string): KeyProblem | null {
  const c = normalizeCode(code);
  if (!c || c === 'Unidentified') return { kind: 'unknown' }; // some keys report no position at all
  if (MOVE_KEYS[c] !== undefined) return { kind: 'move' };
  if (RESERVED.test(c)) return { kind: 'reserved' };
  for (const { action: a, label } of KEY_ACTIONS) {
    const at = b[a].indexOf(c);
    if (at >= 0 && !(a === action && at === slot)) return { kind: 'taken', action: a, label };
  }
  return null;
}

export function problemText(p: KeyProblem): string {
  if (p.kind === 'unknown') return '無法辨識這個鍵，請換一個鍵';
  if (p.kind === 'move') return 'W A S D 與方向鍵固定用來移動，請換一個鍵';
  if (p.kind === 'reserved') return '這個鍵會被瀏覽器、系統或選取目標先用掉，請換一個鍵';
  return `這個鍵已經用在「${p.label}」，請重新選一個`;
}

/** Puts `code` into the slot (appending when the slot is past the end); the caller checks keyProblem first. */
export function withKey(b: Bindings, action: KeyAction, slot: number, code: string): Bindings {
  const list = [...b[action]];
  if (slot < list.length) list[slot] = normalizeCode(code);
  else list.push(normalizeCode(code));
  return { ...b, [action]: list };
}

/** Empties a slot; null when that would leave the action without a key. */
export function withoutKey(b: Bindings, action: KeyAction, slot: number): Bindings | null {
  if (slot >= b[action].length) return b;
  if (b[action].length <= 1) return null;
  return { ...b, [action]: b[action].filter((_, k) => k !== slot) };
}

const fresh = (): Bindings => {
  const out = {} as Bindings;
  for (const { action } of KEY_ACTIONS) out[action] = [...DEFAULT_BINDINGS[action]];
  return out;
};

/** Saved settings, checked again: anything broken (or tampered with) falls back to the defaults. */
export function parseBindings(raw: string | null): Bindings {
  if (!raw) return fresh();
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    let out = {} as Bindings;
    for (const { action } of KEY_ACTIONS) out[action] = [];
    for (const { action, slots } of KEY_ACTIONS) {
      const list = v[action];
      if (!Array.isArray(list) || !list.length || list.length > slots) return fresh();
      for (const code of list) {
        if (typeof code !== 'string' || keyProblem(out, action, out[action].length, code)) return fresh();
        out = withKey(out, action, out[action].length, code);
      }
    }
    return out;
  } catch {
    return fresh();
  }
}

const STORE_KEY = 'octaraid.keys';

export function loadBindings(): Bindings {
  try {
    return parseBindings(localStorage.getItem(STORE_KEY));
  } catch {
    return parseBindings(null);
  }
}

export function saveBindings(b: Bindings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(b));
  } catch {
    /* private mode: the keys just don't persist */
  }
}

/** Which action (if any) this key press belongs to. */
export function actionOf(b: Bindings, code: string): KeyAction | null {
  const c = normalizeCode(code);
  for (const { action } of KEY_ACTIONS) if (b[action].includes(c)) return action;
  return null;
}
