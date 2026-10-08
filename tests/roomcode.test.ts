import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET } from '../shared/constants';
import { Rng } from '../shared/rng';
import { isRoomCode, makeCode, normalizeCode } from '../shared/roomcode';

describe('invite codes', () => {
  it('leave out characters that are easy to misread', () => {
    for (const ch of '01OI') expect(ROOM_CODE_ALPHABET).not.toContain(ch);
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
  });

  it('accept what people type: lower case, spaces, dashes', () => {
    expect(normalizeCode(' k7q-x ')).toBe('K7QX');
    expect(isRoomCode(normalizeCode('k7qx'))).toBe(true);
    expect(isRoomCode('K7Q')).toBe(false);
    expect(isRoomCode('K0QX')).toBe(false); // zero is not in the alphabet
  });

  it('never hand out a code that is in use', () => {
    const rng = new Rng(11);
    const taken = new Set<string>();
    for (let k = 0; k < 2000; k++) {
      const code = makeCode(() => rng.next(), (c) => taken.has(c));
      expect(isRoomCode(code)).toBe(true);
      expect(taken.has(code)).toBe(false);
      taken.add(code);
    }
  });
});
