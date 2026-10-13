import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDINGS,
  KEY_ACTIONS,
  actionOf,
  keyLabel,
  keyProblem,
  parseBindings,
  withKey,
  withoutKey,
} from '../client/keys';

describe('key settings', () => {
  it('defaults: skills on 1–9 and 0, 疾走 on Shift, LB on R, chat on Enter, top-down view on V', () => {
    const b = parseBindings(null);
    expect(b).toEqual(DEFAULT_BINDINGS);
    expect(actionOf(b, 'Digit3')).toBe('skill3');
    expect(actionOf(b, 'Digit0')).toBe('skill10');
    expect(actionOf(b, 'ShiftRight')).toBe('sprint');
    expect(actionOf(b, 'KeyR')).toBe('lb');
    expect(actionOf(b, 'Enter')).toBe('chat');
    expect(actionOf(b, 'KeyV')).toBe('view');
    expect(actionOf(b, 'KeyW')).toBeNull(); // movement is fixed, not an action
  });

  it('round-trips saved settings and rejects broken or tampered ones', () => {
    let b = parseBindings(null);
    b = withKey(b, 'skill1', 1, 'KeyQ');
    expect(parseBindings(JSON.stringify(b)).skill1).toEqual(['Digit1', 'KeyQ']);
    expect(parseBindings('not json')).toEqual(DEFAULT_BINDINGS);
    expect(parseBindings(JSON.stringify({ ...b, lb: ['KeyW'] }))).toEqual(DEFAULT_BINDINGS); // a movement key
    expect(parseBindings(JSON.stringify({ ...b, chat: [] }))).toEqual(DEFAULT_BINDINGS);
  });

  it('keeps a save from before skills 6–10 and 疾走, giving them their keys unless those are taken', () => {
    const old: Record<string, string[]> = { ...DEFAULT_BINDINGS, skill1: ['Digit1', 'ShiftLeft'] };
    for (const a of ['skill6', 'skill7', 'skill8', 'skill9', 'skill10', 'sprint']) delete old[a];
    const b = parseBindings(JSON.stringify(old));
    expect(b.skill1).toEqual(['Digit1', 'ShiftLeft']); // the player's own change stays
    expect(b.skill6).toEqual(['Digit6']);
    expect(b.skill10).toEqual(['Digit0']);
    expect(b.sprint).toEqual([]); // Shift was already taken: 疾走 waits for a key
  });

  it('refuses movement keys, keys the browser takes and keys already in use', () => {
    const b = parseBindings(null);
    expect(keyProblem(b, 'skill1', 0, 'KeyA')?.kind).toBe('move');
    expect(keyProblem(b, 'skill1', 0, 'Tab')?.kind).toBe('reserved');
    expect(keyProblem(b, 'skill1', 0, 'F1')?.kind).toBe('reserved');
    expect(keyProblem(b, 'skill1', 0, 'KeyR')).toMatchObject({ kind: 'taken', action: 'lb' });
    expect(keyProblem(b, 'skill1', 0, 'KeyQ')).toBeNull();
  });

  it('keeps at least one key per action', () => {
    const b = parseBindings(null);
    expect(withoutKey(b, 'lb', 0)).toBeNull();
    for (const { action } of KEY_ACTIONS) expect(b[action].length).toBeGreaterThan(0);
  });

  it('names keys the way they are printed on the keyboard', () => {
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('KeyR')).toBe('R');
    expect(keyLabel('ShiftRight')).toBe('Shift');
  });
});
