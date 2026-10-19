import { describe, expect, it } from 'vitest';
import { BAR_SIZE, BAR_SKILLS, clearAt, defaultLayout, parseLayout, place, swap } from '../client/hotbar';
import { SPRINT_SLOT } from '../shared/jobs';

describe('hotbar layout (技能配置)', () => {
  it('starts with skills 1–10 on keys 1–0, slot 11 free and 疾走 on slot 12', () => {
    const l = defaultLayout();
    expect(l).toHaveLength(BAR_SIZE);
    expect(l.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(l[10]).toBeNull();
    expect(l[11]).toBe(SPRINT_SLOT);
    expect(BAR_SKILLS).toHaveLength(11);
  });

  it('places a skill, swapping when it already sits elsewhere; swaps slots; empties one', () => {
    let l = defaultLayout();
    l = place(l, 10, 9); // skill 10 onto the free slot 11: its old slot empties
    expect(l[10]).toBe(9);
    expect(l[9]).toBeNull();
    l = place(l, 0, 4); // skill 5 onto slot 1: slot 5 gets skill 1
    expect(l[0]).toBe(4);
    expect(l[4]).toBe(0);
    l = swap(l, 0, 11);
    expect(l[0]).toBe(SPRINT_SLOT);
    expect(l[11]).toBe(4);
    l = clearAt(l, 0);
    expect(l[0]).toBeNull();
    expect(new Set(l.filter((x) => x !== null)).size).toBe(l.filter((x) => x !== null).length); // nothing twice
  });

  it('reads back a saved layout and refuses a broken one', () => {
    const l = place(defaultLayout(), 10, 9);
    expect(parseLayout(JSON.stringify(l))).toEqual(l);
    expect(parseLayout(null)).toEqual(defaultLayout());
    expect(parseLayout('[1,2,3]')).toEqual(defaultLayout()); // wrong length
    expect(parseLayout(JSON.stringify([0, 0, 2, 3, 4, 5, 6, 7, 8, 9, null, 11]))).toEqual(defaultLayout()); // twice
    expect(parseLayout(JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, null, 10]))).toEqual(defaultLayout()); // the LB slot
    expect(parseLayout('nope')).toEqual(defaultLayout());
  });
});
