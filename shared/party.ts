import { jobById, type JobId, type Role } from './jobs';

/** At most 2 tanks, 2 healers and 4 DPS; the same job may be taken twice within those limits. */
export const ROLE_CAPS: Readonly<Record<Role, number>> = { tank: 2, healer: 2, dps: 4 };

/**
 * Boss HP follows the party's expected damage, not just its head count: tanks and healers deal less.
 * The numbers are tuned for the usual 3–4 players, with 1 tank, 1 healer and 2 DPS (weight 3.2) as 100%.
 */
export const ROLE_WEIGHT: Readonly<Record<Role, number>> = { tank: 0.65, healer: 0.55, dps: 1 };
export const BASE_WEIGHT = ROLE_WEIGHT.tank + ROLE_WEIGHT.healer + 2 * ROLE_WEIGHT.dps;

export function roleCounts(jobs: readonly JobId[]): Record<Role, number> {
  const out: Record<Role, number> = { tank: 0, healer: 0, dps: 0 };
  for (const j of jobs) out[jobById(j).role]++;
  return out;
}

/** Boss HP as a share of the 4-player baseline (1 = 100%). */
export function hpScale(jobs: readonly JobId[]): number {
  let w = 0;
  for (const j of jobs) w += ROLE_WEIGHT[jobById(j).role];
  return w / BASE_WEIGHT;
}

/** Can someone take `job` when the others hold `others`? */
export function roleHasRoom(others: readonly JobId[], job: JobId): boolean {
  const role = jobById(job).role;
  return roleCounts(others)[role] < ROLE_CAPS[role];
}

/** What the missing-role rules (缺角補正) will do for this party, for the waiting room. */
export function partyNotes(jobs: readonly JobId[]): string[] {
  if (!jobs.length) return [];
  const n = roleCounts(jobs);
  const notes: string[] = [];
  if (!n.tank) notes.push('沒有坦克：仇恨第一的人承受普攻與死刑，傷害只打 50%');
  if (!n.healer) notes.push('沒有補師：全隊每秒回復 1.5% HP，倒地 20 秒後自動復活（每人每場 1 次）');
  if (n.tank === 1) notes.push('只有 1 個坦克：換坦機制的易傷會在下一次死刑前結束');
  return notes;
}
