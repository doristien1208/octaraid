import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDINGS,
  actionOf,
  assignKey,
  keyLabel,
  keyProblem,
  parseBindings,
  withKey,
  withoutKey,
} from '../client/keys';

describe('key settings', () => {
  it('defaults: hotbar slots on 1–9, 0, - and Shift, LB on R, chat on Enter, top-down view on V', () => {
    const b = parseBindings(null);
    expect(b).toEqual(DEFAULT_BINDINGS);
    expect(actionOf(b, 'Digit3')).toBe('bar3');
    expect(actionOf(b, 'Digit0')).toBe('bar10');
    expect(actionOf(b, 'Minus')).toBe('bar11');
    expect(actionOf(b, 'ShiftRight')).toBe('bar12');
    expect(actionOf(b, 'KeyR')).toBe('lb');
    expect(actionOf(b, 'Enter')).toBe('chat');
    expect(actionOf(b, 'KeyV')).toBe('view');
    expect(actionOf(b, 'KeyW')).toBeNull(); // movement is fixed, not an action
  });

  it('round-trips saved settings, keeps an emptied slot, and rejects broken or tampered ones', () => {
    let b = parseBindings(null);
    b = withKey(b, 'bar1', 1, 'KeyQ');
    expect(parseBindings(JSON.stringify(b)).bar1).toEqual(['Digit1', 'KeyQ']);
    expect(parseBindings(JSON.stringify({ ...b, chat: [] })).chat).toEqual([]); // the player cleared it
    expect(parseBindings('not json')).toEqual(DEFAULT_BINDINGS);
    expect(parseBindings(JSON.stringify({ ...b, lb: ['KeyW'] }))).toEqual(DEFAULT_BINDINGS); // a movement key
  });

  it('turns a save from when keys belonged to skills into hotbar slots', () => {
    // v0.5.0: skill1–skill10 and sprint; the player had put Shift on skill 1 as well
    const old: Record<string, string[]> = { skill1: ['Digit1', 'ShiftLeft'], lb: ['KeyR'], chat: ['Enter'], view: ['KeyV'], mute: ['KeyM'] };
    for (let k = 2; k <= 10; k++) old[`skill${k}`] = [k === 10 ? 'Digit0' : `Digit${k}`];
    old.sprint = ['KeyF'];
    const b = parseBindings(JSON.stringify(old));
    expect(b.bar1).toEqual(['Digit1', 'ShiftLeft']);
    expect(b.bar10).toEqual(['Digit0']);
    expect(b.bar12).toEqual(['KeyF']); // 疾走's key stays with its slot
    expect(b.bar11).toEqual(['Minus']); // new: its default
  });

  it('swaps a key that is in use instead of refusing it, and can clear any key', () => {
    let b = parseBindings(null);
    // Q on slot 1, which had 1: slot 2 had nothing to do with it
    let r = assignKey(b, 'bar1', 0, 'KeyQ');
    expect(r.b.bar1).toEqual(['KeyQ']);
    expect(r.swapped).toBeNull();
    // 2 onto slot 1: slot 2 gets slot 1's Q back
    r = assignKey(r.b, 'bar1', 0, 'Digit2');
    expect(r.b.bar1).toEqual(['Digit2']);
    expect(r.b.bar2).toEqual(['KeyQ']);
    expect(r.swapped).toBe('bar2');
    // a key from another action into an empty second place: it moves over
    r = assignKey(r.b, 'bar1', 1, 'KeyR');
    expect(r.b.bar1).toEqual(['Digit2', 'KeyR']);
    expect(r.b.lb).toEqual([]);
    expect(r.swapped).toBe('lb');
    b = withoutKey(r.b, 'bar1', 0);
    b = withoutKey(b, 'bar1', 0);
    expect(b.bar1).toEqual([]);
    expect(actionOf(b, 'Digit2')).toBeNull();
  });

  it('refuses movement keys and keys the browser takes, and says which action has a key', () => {
    const b = parseBindings(null);
    expect(keyProblem(b, 'bar1', 0, 'KeyA')?.kind).toBe('move');
    expect(keyProblem(b, 'bar1', 0, 'Tab')?.kind).toBe('reserved');
    expect(keyProblem(b, 'bar1', 0, 'F1')?.kind).toBe('reserved');
    expect(keyProblem(b, 'bar1', 0, 'KeyR')).toMatchObject({ kind: 'taken', action: 'lb' });
    expect(keyProblem(b, 'bar1', 0, 'KeyQ')).toBeNull();
  });

  it('names keys the way they are printed on the keyboard', () => {
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('KeyR')).toBe('R');
    expect(keyLabel('ShiftRight')).toBe('Shift');
  });
});
