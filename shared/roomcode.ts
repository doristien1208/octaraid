import { ROOM_CODE_ALPHABET, ROOM_CODE_LEN } from './constants';

/** What a player typed, as a code: upper case, without spaces or dashes. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

export function isRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LEN && [...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
}

/** A fresh invite code that `taken` does not know yet; `random` returns [0, 1). */
export function makeCode(random: () => number, taken: (code: string) => boolean): string {
  for (;;) {
    let code = '';
    for (let k = 0; k < ROOM_CODE_LEN; k++) code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
    if (!taken(code)) return code;
  }
}
