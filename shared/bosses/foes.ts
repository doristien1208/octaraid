/** Every kind of enemy: the training dummy, the bosses and what they summon. */
export type FoeKind = 'dummy' | 'colossus' | 'golem' | 'prison';

export interface FoeInfo {
  name: string;
  /** radius of the target ring, metres; ranges are measured from it */
  ring: number;
  /** the fight's boss: its death clears the fight, and the DPS Limit Break does 5% to it instead of 30% */
  boss: boolean;
  /** moves towards whoever it attacks, metres per second (0: stays put) */
  speed: number;
}

export const FOES: Readonly<Record<FoeKind, FoeInfo>> = {
  dummy: { name: '訓練木人', ring: 2.4, boss: true, speed: 0 },
  colossus: { name: '崩岩巨像', ring: 4, boss: true, speed: 0 },
  golem: { name: '岩巨兵', ring: 1.6, boss: false, speed: 3.5 },
  prison: { name: '岩牢', ring: 1, boss: false, speed: 0 },
};

export const FOE_KINDS = Object.keys(FOES) as FoeKind[];

export function isFoeKind(v: unknown): v is FoeKind {
  return typeof v === 'string' && v in FOES;
}
