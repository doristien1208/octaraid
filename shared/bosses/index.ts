import type { EncounterId } from '../encounters';
import type { BossScript } from '../sim/boss';
import { colossus } from './colossus';
import { frostwitch } from './frostwitch';
import { gatekeeper } from './gatekeeper';
import { twins } from './twins';

/** The boss script of each duty (the training dummy, shared/sim/practice.ts, stands in where there is none). */
const SCRIPTS: Partial<Record<EncounterId, (hard: boolean) => BossScript>> = {
  colossus,
  frostwitch,
  gatekeeper,
  twins,
};

export function scriptFor(enc: EncounterId, hard: boolean): BossScript | null {
  return SCRIPTS[enc]?.(hard) ?? null;
}

export function hasBoss(enc: EncounterId): boolean {
  return enc in SCRIPTS;
}
