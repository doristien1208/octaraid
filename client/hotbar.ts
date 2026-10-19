import { SKILL_COUNT, SPRINT_SLOT, type JobId } from '../shared/jobs';

/**
 * Which skill sits in which of the 12 hotbar slots, per job, as each player likes it (FF14 lets you drag
 * actions onto your bars). A slot holds a skill slot of the job (0–9, SPRINT_SLOT for 疾走) or nothing.
 * The keys belong to the slots (client/keys.ts), so moving a skill moves it to another key. Saved in this
 * browser, one layout per job.
 */
export const BAR_SIZE = 12;
export type Layout = (number | null)[];

/** Everything a job can put on its bar: its 10 skills and 疾走. */
export const BAR_SKILLS: readonly number[] = [...Array.from({ length: SKILL_COUNT }, (_, k) => k), SPRINT_SLOT];

/** Skills 1–10 on keys 1–0, slot 11 free, 疾走 on slot 12 (Shift). */
export function defaultLayout(): Layout {
  return [...Array.from({ length: SKILL_COUNT }, (_, k) => k), null, SPRINT_SLOT];
}

/** A saved layout, checked again: anything broken (a skill twice, an unknown slot) is the default. */
export function parseLayout(raw: string | null): Layout {
  if (!raw) return defaultLayout();
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v) || v.length !== BAR_SIZE) return defaultLayout();
    const seen = new Set<number>();
    for (const x of v) {
      if (x === null) continue;
      if (typeof x !== 'number' || !BAR_SKILLS.includes(x) || seen.has(x)) return defaultLayout();
      seen.add(x);
    }
    return v as Layout;
  } catch {
    return defaultLayout();
  }
}

const key = (job: JobId) => `octaraid.bar.${job}`;

// storage straight from the browser, as client/keys.ts does (no DOM helpers: the tests run in Node)
export function loadLayout(job: JobId): Layout {
  try {
    return parseLayout(localStorage.getItem(key(job)));
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(job: JobId, layout: Layout): void {
  try {
    localStorage.setItem(key(job), JSON.stringify(layout));
  } catch {
    /* private mode: the layout just doesn't persist */
  }
}

/** Puts a skill into a slot; when it already sits in another slot, the two slots swap. */
export function place(layout: Layout, pos: number, skill: number): Layout {
  const out = [...layout];
  const from = out.indexOf(skill);
  if (from >= 0) out[from] = out[pos] ?? null;
  out[pos] = skill;
  return out;
}

export function swap(layout: Layout, a: number, b: number): Layout {
  const out = [...layout];
  [out[a], out[b]] = [out[b] ?? null, out[a] ?? null];
  return out;
}

export function clearAt(layout: Layout, pos: number): Layout {
  const out = [...layout];
  out[pos] = null;
  return out;
}
