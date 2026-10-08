/**
 * What the training dummy (木人) does until the real bosses arrive in M3: auto attacks on whoever is top
 * of its enmity list, a tank buster and a raid-wide on a loop, so tanks, healers, mitigation, deaths,
 * raises and the Limit Break all get used. Damage follows the Normal / Hard table in section 四.
 * Seconds of fighting; `first` is when the cast starts.
 */
export interface PracticeMove {
  name: string;
  m: 'buster' | 'raidwide';
  first: number;
  every: number;
  cast: number;
  dmg: { normal: number; hard: number };
}

export const PRACTICE = {
  name: '訓練木人',
  /** radius of its target ring, metres */
  ring: 2.4,
  autoEvery: 3,
  auto: { normal: 500, hard: 900 },
  moves: [
    { name: '重擊', m: 'buster', first: 20, every: 60, cast: 3, dmg: { normal: 7000, hard: 16000 } },
    { name: '震盪波', m: 'raidwide', first: 50, every: 60, cast: 3, dmg: { normal: 3500, hard: 6500 } },
  ] satisfies PracticeMove[],
};
