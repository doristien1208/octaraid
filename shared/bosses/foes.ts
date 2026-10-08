/** Every kind of enemy: the training dummy, the bosses and what they summon. */
export type FoeKind = 'dummy' | 'colossus' | 'golem' | 'prison' | 'frostwitch' | 'mirror' | 'gatekeeper' | 'drone' | 'ember' | 'frost' | 'bipolar';

export interface FoeInfo {
  name: string;
  /** radius of the target ring, metres; ranges are measured from it */
  ring: number;
  /** the fight's boss: its death clears the fight, and the DPS Limit Break does 5% to it instead of 30% */
  boss: boolean;
  /** moves towards whoever it attacks, metres per second (0: stays put or only moves when its script says) */
  speed: number;
}

export const FOES: Readonly<Record<FoeKind, FoeInfo>> = {
  dummy: { name: '訓練木人', ring: 2.4, boss: true, speed: 0 },
  colossus: { name: '崩岩巨像', ring: 4, boss: true, speed: 0 },
  golem: { name: '岩巨兵', ring: 1.6, boss: false, speed: 3.5 },
  prison: { name: '岩牢', ring: 1, boss: false, speed: 0 },
  // M4: these bosses follow the tank, so it can drag them where the party wants them
  frostwitch: { name: '霜冠魔女', ring: 3, boss: true, speed: 5 },
  mirror: { name: '冰鏡', ring: 1.6, boss: false, speed: 0 },
  gatekeeper: { name: '守門機兵', ring: 3.5, boss: true, speed: 5 },
  drone: { name: '僚機', ring: 1.3, boss: false, speed: 0 },
  // 雙子機神: 熾核 follows the tank, 凍核 takes no enmity and only jumps where its script says
  ember: { name: '熾核', ring: 2.6, boss: true, speed: 5 },
  frost: { name: '凍核', ring: 2.6, boss: true, speed: 0 },
  bipolar: { name: '雙極機神', ring: 4, boss: true, speed: 4.5 },
};

export const FOE_KINDS = Object.keys(FOES) as FoeKind[];

export function isFoeKind(v: unknown): v is FoeKind {
  return typeof v === 'string' && v in FOES;
}
