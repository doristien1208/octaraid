/**
 * Buffs and debuffs (section 四 of the design doc). The numbers here are what the simulation applies;
 * the HUD shows the name, the glyph and the seconds left.
 */
export type StatusId =
  | 'rampart'
  | 'fortress'
  | 'shelter'
  | 'bloodlust'
  | 'holmgang'
  | 'regen'
  | 'starShield'
  | 'starVeil'
  | 'sanctuary'
  | 'fury'
  | 'battleCry'
  | 'bleed'
  | 'swift'
  | 'ley'
  | 'song'
  | 'ironVow'
  | 'weak'
  | 'brink'
  | 'risen'
  | 'airborne'
  | 'echo'
  | 'dmgDown'
  | 'vuln'
  | 'crack'
  | 'stun';

export interface StatusInfo {
  name: string;
  /** one glyph for the HUD icon */
  icon: string;
  /** a buff (true) or a debuff */
  good: boolean;
  desc: string;
  /** damage taken × (1 − mit); several multiply */
  mit?: number;
  /** damage dealt × (1 + dmg); negative for weakness */
  dmg?: number;
  /** max HP × (1 + maxHp) */
  maxHp?: number;
  /** takes no damage at all */
  invuln?: boolean;
  /** HP cannot drop below 1 */
  floor?: boolean;
  /** this share of the damage dealt heals the owner */
  lifesteal?: number;
  /** the GCD becomes this many seconds */
  gcd?: number;
  /** cast times × (1 − castCut) */
  castCut?: number;
  /** the next spell is instant (consumed by it) */
  swift?: boolean;
  /** absorbs damage: the instance's value is what is left */
  shield?: boolean;
  /** heals (or with `dot`, damages) its value every second, paid out in 3-second ticks */
  hot?: boolean;
  dot?: boolean;
  /** jumping: ground attacks miss */
  airborne?: boolean;
  /** damage taken × (1 + taken × stacks): 易傷 stacks, 裂盾 counts once */
  taken?: number;
  /** cannot move or use skills (岩牢) */
  stun?: boolean;
  /** given by a ground zone while standing in it (not shown with seconds) */
  zone?: boolean;
  /** goes away when the owner uses any action */
  breakOnAction?: boolean;
}

export const STATUS: Readonly<Record<StatusId, StatusInfo>> = {
  rampart: { name: '堅盾', icon: '盾', good: true, desc: '受到的傷害 −30%', mit: 0.3 },
  fortress: { name: '不動要塞', icon: '城', good: true, desc: '不受任何傷害', invuln: true },
  shelter: { name: '守護結界', icon: '界', good: true, desc: '受到的傷害 −10%', mit: 0.1 },
  bloodlust: { name: '嗜血', icon: '血', good: true, desc: '受到的傷害 −20%，造成傷害的 60% 回復自身', mit: 0.2, lifesteal: 0.6 },
  holmgang: { name: '死戰', icon: '戰', good: true, desc: 'HP 不會低於 1', floor: true },
  regen: { name: '光環禱言', icon: '環', good: true, desc: '每秒回復 HP', hot: true },
  starShield: { name: '星盾', icon: '星', good: true, desc: '吸收傷害的護盾', shield: true },
  starVeil: { name: '群星庇護', icon: '庇', good: true, desc: '吸收傷害的護盾', shield: true },
  sanctuary: { name: '星界領域', icon: '域', good: true, desc: '站在領域內：受到的傷害 −10%，每秒回復 150', mit: 0.1, zone: true },
  fury: { name: '疾風之心', icon: '風', good: true, desc: '傷害 +15%，GCD 變 2.0 秒', dmg: 0.15, gcd: 2 },
  battleCry: { name: '戰意昂揚', icon: '昂', good: true, desc: '傷害 +10%', dmg: 0.1 },
  bleed: { name: '裂鱗刺', icon: '刺', good: false, desc: '每秒受到持續傷害', dot: true },
  swift: { name: '迅唱', icon: '迅', good: true, desc: '下一個魔法免詠唱', swift: true },
  ley: { name: '魔力湧泉', icon: '泉', good: true, desc: '站在湧泉內：詠唱 −30%，傷害 +10%', castCut: 0.3, dmg: 0.1, zone: true },
  song: { name: '守護之歌', icon: '歌', good: true, desc: '受到的傷害 −10%', mit: 0.1 },
  ironVow: { name: '鋼鐵誓約', icon: '誓', good: true, desc: '受到的傷害 −60%', mit: 0.6 },
  weak: { name: '衰弱', icon: '衰', good: false, desc: '最大 HP 與傷害 −25%', maxHp: -0.25, dmg: -0.25 },
  brink: { name: '瀕死', icon: '瀕', good: false, desc: '衰弱中再倒地：最大 HP 與傷害 −50%', maxHp: -0.5, dmg: -0.5 },
  risen: { name: '復活庇護', icon: '護', good: true, desc: '剛復活：不受傷害，使用任何技能就解除', invuln: true, breakOnAction: true },
  airborne: { name: '滯空', icon: '躍', good: true, desc: '在空中：地面攻擊打不到', airborne: true },
  echo: { name: '超越之力', icon: '超', good: true, desc: '滅團後變強：傷害、回復與最大 HP 提高' },
  // penalties and boss effects (section 四 and 六)
  dmgDown: { name: '傷害降低', icon: '弱', good: false, desc: '機制失誤（Normal）：造成的傷害 −25%', dmg: -0.25 },
  vuln: { name: '易傷', icon: '易', good: false, desc: '機制失誤（Hard）：受到的傷害每層 +50%，可疊', taken: 0.5 },
  crack: { name: '裂盾', icon: '裂', good: false, desc: '吃過死刑：受到的傷害 +100%，下一發換另一個坦克接', taken: 1 },
  stun: { name: '岩牢', icon: '牢', good: false, desc: '被岩石包住：不受傷害，但不能移動與行動；隊友要在時間內打破岩牢', stun: true, invuln: true },
};

export const STATUS_IDS = Object.keys(STATUS) as StatusId[];

export function isStatusId(v: unknown): v is StatusId {
  return typeof v === 'string' && v in STATUS;
}
