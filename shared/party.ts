import { VOTE_OPTIONS, encounterById } from './encounters';
import { DEFAULT_JOB_ORDER, jobById, type JobId, type Role } from './jobs';

/** At most 2 tanks, 2 healers and 4 DPS; the same job may be taken twice within those limits. */
export const ROLE_CAPS: Readonly<Record<Role, number>> = { tank: 2, healer: 2, dps: 4 };

/**
 * Boss HP follows the party's expected damage, not just its head count: tanks and healers deal less.
 * The numbers are tuned for the usual 3–4 players, with 1 tank, 1 healer and 2 DPS (weight 3.2) as 100%.
 */
export const ROLE_WEIGHT: Readonly<Record<Role, number>> = { tank: 0.65, healer: 0.55, dps: 1 };
export const BASE_WEIGHT = ROLE_WEIGHT.tank + ROLE_WEIGHT.healer + 2 * ROLE_WEIGHT.dps;
/**
 * A second healer counts for more than its damage: two healers doubled the healing and the raises at no
 * cost in time, which made 1 tank, 2 healers, 2 DPS the easy way through Hard (play-test, v0.6).
 */
export const SECOND_HEALER_WEIGHT = 0.8;

export function roleCounts(jobs: readonly JobId[]): Record<Role, number> {
  const out: Record<Role, number> = { tank: 0, healer: 0, dps: 0 };
  for (const j of jobs) out[jobById(j).role]++;
  return out;
}

/** Boss HP as a share of the 4-player baseline (1 = 100%). */
export function hpScale(jobs: readonly JobId[]): number {
  let w = 0;
  let healers = 0;
  for (const j of jobs) {
    const role = jobById(j).role;
    w += role === 'healer' && healers++ > 0 ? SECOND_HEALER_WEIGHT : ROLE_WEIGHT[role];
  }
  return w / BASE_WEIGHT;
}

/** Can someone take `job` when the others hold `others`? */
export function roleHasRoom(others: readonly JobId[], job: JobId): boolean {
  const role = jobById(job).role;
  return roleCounts(others)[role] < ROLE_CAPS[role];
}

/**
 * The offline practice party: my job, then computer players the way a room hands out jobs (one of each
 * role first, then the next free job), within the role caps.
 */
export function practiceParty(myJob: JobId, n: number, ultimate = false): JobId[] {
  const jobs: JobId[] = [myJob];
  if (ultimate) {
    // the ultimate: at least 4, the missing tank, healer and DPS first
    n = Math.max(4, n);
    const want: [Role, number][] = [
      ['tank', 1],
      ['healer', 1],
      ['dps', 2],
    ];
    for (const [role, k] of want) {
      while (roleCounts(jobs)[role] < k) {
        const next = DEFAULT_JOB_ORDER.find((j) => jobById(j).role === role && !jobs.includes(j)) ?? DEFAULT_JOB_ORDER.find((j) => jobById(j).role === role);
        jobs.push(next!);
      }
    }
  }
  while (jobs.length < n) {
    const next = DEFAULT_JOB_ORDER.find((j) => !jobs.includes(j) && roleHasRoom(jobs, j)) ?? DEFAULT_JOB_ORDER.find((j) => roleHasRoom(jobs, j));
    if (!next) break;
    jobs.push(next);
  }
  return jobs;
}

/** The ultimate (時律機神殿) needs at least 4 players with at least 1 tank, 1 healer and 2 DPS. */
export const ULTIMATE_NEEDS = '至少 4 人，而且要有 1 坦 1 補 2 DPS';

export function meetsUltimate(jobs: readonly JobId[]): boolean {
  const n = roleCounts(jobs);
  return jobs.length >= 4 && n.tank >= 1 && n.healer >= 1 && n.dps >= 2;
}

/** May this party play vote option k? (the ultimate's requirement; every other option is always open) */
export function optionOpen(k: number, jobs: readonly JobId[]): boolean {
  const o = VOTE_OPTIONS[k];
  return !!o && (encounterById(o.enc).kind !== 'ultimate' || meetsUltimate(jobs));
}

/** What the missing-role rules (缺角補正) will do for this party, for the waiting room. */
export function partyNotes(jobs: readonly JobId[]): string[] {
  if (!jobs.length) return [];
  const n = roleCounts(jobs);
  const notes: string[] = [];
  if (!n.tank) notes.push('沒有坦克：仇恨第一的人承受普攻與死刑，傷害只打 50%，連續死刑只打一下（王會追著他跑）');
  if (!n.healer) notes.push('沒有補師：全隊每秒回復 1.5% HP，倒地 20 秒後自動復活（每人每場 1 次）');
  if (n.tank === 1) notes.push('只有 1 個坦克：換坦機制的易傷會在下一次死刑前結束');
  if (!n.tank || !n.healer) notes.push('Hard 以 1 坦 1 補為前提：少了坦克或補師很難通關');
  if (jobs.length === 1) notes.push('只有 1 人：崩岩巨像打得完，其他副本的機制是給 2 人以上設計的，很難通關');
  else if (!n.dps) notes.push('沒有 DPS：雙子機神要平均打兩隻王，只有坦克與補師很難不失衡');
  return notes;
}
