import type { EncounterId } from '../encounters';
import type { BossScript } from '../sim/boss';
import { colossus } from './colossus';

/**
 * The boss script of each duty. Duties without one yet fight the training dummy (shared/sim/practice.ts):
 * 霜冠魔女 and both floors of 發條城塞 arrive in M4.
 */
const SCRIPTS: Partial<Record<EncounterId, (hard: boolean) => BossScript>> = {
  colossus,
};

export function scriptFor(enc: EncounterId, hard: boolean): BossScript | null {
  return SCRIPTS[enc]?.(hard) ?? null;
}

export function hasBoss(enc: EncounterId): boolean {
  return enc in SCRIPTS;
}
