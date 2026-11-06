import { describe, expect, it } from 'vitest';
import { ICON_FILES, SKILL_ICONS, iconOf, svgPath } from '../client/skill-icons';
import { JOBS, LIMIT_BREAKS, SPRINT } from '../shared/jobs';

const names = [...new Set([...JOBS.flatMap((j) => j.skills.map((s) => s.name)), SPRINT.name, ...Object.values(LIMIT_BREAKS).map((lb) => lb.name)])];

describe('skill icons', () => {
  it('every skill, 疾走 and limit break has a picture', () => {
    for (const name of names) {
      const icon = iconOf(name);
      expect(icon, name).not.toBeNull();
      expect(icon!.path, name).toMatch(/^M[\d.]/);
      expect(icon!.path, name).not.toContain('M0 0h512v512H0z');
    }
    expect(iconOf('沒有這個技能')).toBeNull();
  });

  it('nothing is left over: no entry without a skill, no file without an entry', () => {
    expect(Object.keys(SKILL_ICONS).sort()).toEqual([...names].sort());
    expect([...ICON_FILES].sort()).toEqual([...new Set(Object.values(SKILL_ICONS).map(([file]) => file))].sort());
  });

  it('no job uses the same picture twice, and different skills have different pictures', () => {
    const files = Object.values(SKILL_ICONS).map(([file]) => file);
    expect(new Set(files).size).toBe(files.length);
    for (const j of JOBS) {
      const own = [...j.skills, SPRINT, LIMIT_BREAKS[j.role]].map((s) => iconOf(s.name)!.file);
      expect(new Set(own).size, j.name).toBe(own.length);
    }
  });

  it('keeps only the outline of an icon file', () => {
    expect(svgPath('<svg viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/><path fill="#fff" d="M10 20h5z"/></svg>')).toBe('M10 20h5z');
  });
});
