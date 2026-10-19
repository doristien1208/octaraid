/**
 * Key settings. Moving always uses W A S D and the arrow keys; every other action can be rebound, each to
 * a few single keys (no combinations, no mouse). Keys belong to the 12 hotbar slots, not to skills: which
 * skill sits in which slot is the player's own layout per job (client/hotbar.ts). Keys are stored by their
 * position on the keyboard (KeyboardEvent.code), so a Chinese IME being on does not matter, and saved in
 * this browser.
 */
export type KeyAction =
  | 'bar1'
  | 'bar2'
  | 'bar3'
  | 'bar4'
  | 'bar5'
  | 'bar6'
  | 'bar7'
  | 'bar8'
  | 'bar9'
  | 'bar10'
  | 'bar11'
  | 'bar12'
  | 'lb'
  | 'chat'
  | 'view'
  | 'mute';
export type Bindings = Record<KeyAction, string[]>;

export const KEY_ACTIONS: readonly { action: KeyAction; label: string; slots: number }[] = [
  { action: 'bar1', label: '熱鍵 1', slots: 2 },
  { action: 'bar2', label: '熱鍵 2', slots: 2 },
  { action: 'bar3', label: '熱鍵 3', slots: 2 },
  { action: 'bar4', label: '熱鍵 4', slots: 2 },
  { action: 'bar5', label: '熱鍵 5', slots: 2 },
  { action: 'bar6', label: '熱鍵 6', slots: 2 },
  { action: 'bar7', label: '熱鍵 7', slots: 2 },
  { action: 'bar8', label: '熱鍵 8', slots: 2 },
  { action: 'bar9', label: '熱鍵 9', slots: 2 },
  { action: 'bar10', label: '熱鍵 10', slots: 2 },
  { action: 'bar11', label: '熱鍵 11', slots: 2 },
  { action: 'bar12', label: '熱鍵 12', slots: 2 },
  { action: 'lb', label: '極限技（LB）', slots: 1 },
  { action: 'chat', label: '聊天', slots: 1 },
  { action: 'view', label: '切換俯視鏡頭', slots: 1 },
  { action: 'mute', label: '靜音', slots: 1 },
];

/** The 12 hotbar slots in order (bottom row 1–6, top row 7–12). */
export const BAR_ACTIONS: readonly KeyAction[] = ['bar1', 'bar2', 'bar3', 'bar4', 'bar5', 'bar6', 'bar7', 'bar8', 'bar9', 'bar10', 'bar11', 'bar12'];

export const DEFAULT_BINDINGS: Readonly<Bindings> = {
  bar1: ['Digit1'],
  bar2: ['Digit2'],
  bar3: ['Digit3'],
  bar4: ['Digit4'],
  bar5: ['Digit5'],
  bar6: ['Digit6'],
  bar7: ['Digit7'],
  bar8: ['Digit8'],
  bar9: ['Digit9'],
  bar10: ['Digit0'],
  bar11: ['Minus'],
  bar12: ['ShiftLeft'],
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
 * Tab, F1–F8 and Esc choose targets.
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

/** Empties a slot (an action may be left without any key: the player chose so). */
export function withoutKey(b: Bindings, action: KeyAction, slot: number): Bindings {
  if (slot >= b[action].length) return b;
  return { ...b, [action]: b[action].filter((_, k) => k !== slot) };
}

/**
 * Puts `code` into the slot. When another action (or another slot of this one) has that key, the two
 * swap: it gets the key this slot had, or simply loses the key when this slot was empty. Returns the
 * action it was swapped with, for the notice. The caller checks for movement and reserved keys first.
 */
export function assignKey(b: Bindings, action: KeyAction, slot: number, code: string): { b: Bindings; swapped: KeyAction | null } {
  const c = normalizeCode(code);
  const before = b[action][slot];
  let swapped: KeyAction | null = null;
  const out = { ...b } as Bindings;
  for (const { action: a } of KEY_ACTIONS) {
    const at = out[a].indexOf(c);
    if (at < 0 || (a === action && at === slot)) continue;
    swapped = a === action ? null : a;
    const list = [...out[a]];
    if (before && before !== c) list[at] = before;
    else list.splice(at, 1);
    out[a] = list;
  }
  return { b: withKey(out, action, Math.min(slot, out[action].length), c), swapped };
}

const fresh = (): Bindings => {
  const out = {} as Bindings;
  for (const { action } of KEY_ACTIONS) out[action] = [...DEFAULT_BINDINGS[action]];
  return out;
};

/** Saves from before v0.5.1 bound keys to skills: skill N becomes hotbar slot N, 疾走 slot 12. */
const LEGACY: Readonly<Record<string, KeyAction>> = {
  skill1: 'bar1',
  skill2: 'bar2',
  skill3: 'bar3',
  skill4: 'bar4',
  skill5: 'bar5',
  skill6: 'bar6',
  skill7: 'bar7',
  skill8: 'bar8',
  skill9: 'bar9',
  skill10: 'bar10',
  sprint: 'bar12',
};

/**
 * Saved settings, checked again: anything broken (or tampered with) falls back to the defaults. An
 * action the save does not know yet gets its default key, unless the player already put that key on
 * something else; then it waits for one in the key settings. An action may have no key at all.
 */
export function parseBindings(raw: string | null): Bindings {
  if (!raw) return fresh();
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    for (const [old, now] of Object.entries(LEGACY)) if (v[old] !== undefined && v[now] === undefined) v[now] = v[old];
    let out = {} as Bindings;
    for (const { action } of KEY_ACTIONS) out[action] = [];
    const missing: KeyAction[] = [];
    for (const { action, slots } of KEY_ACTIONS) {
      const list = v[action];
      if (list === undefined) {
        missing.push(action);
        continue;
      }
      if (!Array.isArray(list) || list.length > slots) return fresh();
      for (const code of list) {
        if (typeof code !== 'string' || keyProblem(out, action, out[action].length, code)) return fresh();
        out = withKey(out, action, out[action].length, code);
      }
    }
    if (missing.length === KEY_ACTIONS.length) return fresh();
    for (const action of missing) {
      for (const code of DEFAULT_BINDINGS[action]) if (!keyProblem(out, action, out[action].length, code)) out = withKey(out, action, out[action].length, code);
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
