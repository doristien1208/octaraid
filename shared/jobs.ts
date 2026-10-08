/**
 * The 8 jobs (2 tanks, 2 healers, 4 DPS) and their 5 skills, as in section 五 of the design doc.
 * Names are original. Skill numbers are 暫定; only the descriptions are used until combat lands (M2).
 */
export type Role = 'tank' | 'healer' | 'dps';
export type JobId = 'guardian' | 'berserker' | 'priest' | 'warden' | 'brawler' | 'lancer' | 'ranger' | 'sorcerer';

export interface SkillInfo {
  name: string;
  /** gcd: shares the 2.5 s global cooldown; ogcd: an ability with its own cooldown */
  kind: 'gcd' | 'ogcd';
  /** cast time in seconds, 0 = instant */
  cast: number;
  /** cooldown in seconds, 0 = none */
  cd: number;
  desc: string;
}

export interface Job {
  id: JobId;
  name: string;
  role: Role;
  /** finer role label shown on cards, e.g. 近戰 */
  sub: string;
  /** one glyph used as the job icon */
  icon: string;
  weapon: string;
  /** outfit colours: main and trim */
  colors: { main: string; trim: string };
  /** CC0 base character (KayKit Adventurers) once the models are in */
  model: string;
  desc: string;
  skills: [SkillInfo, SkillInfo, SkillInfo, SkillInfo, SkillInfo];
}

export const ROLE_NAMES: Readonly<Record<Role, string>> = { tank: '坦克', healer: '補師', dps: 'DPS' };
/** Role colours used everywhere (FF14-style: tanks blue, healers green, DPS red). */
export const ROLE_COLORS: Readonly<Record<Role, string>> = { tank: '#3d7be0', healer: '#2e9e5b', dps: '#d84343' };
export const ROLE_HP: Readonly<Record<Role, number>> = { tank: 14_000, healer: 10_000, dps: 10_000 };

const gcd = (name: string, cast: number, cd: number, desc: string): SkillInfo => ({ name, kind: 'gcd', cast, cd, desc });
const ogcd = (name: string, cd: number, desc: string): SkillInfo => ({ name, kind: 'ogcd', cast: 0, cd, desc });

export const JOBS: readonly Job[] = [
  {
    id: 'guardian',
    name: '鐵壁衛士',
    role: 'tank',
    sub: '坦克',
    icon: '盾',
    weapon: '單手劍加塔盾',
    colors: { main: '#3d6fd8', trim: '#c9d3e0' },
    model: 'Knight',
    desc: '唯一有全隊減傷的坦克',
    skills: [
      gcd('三連斬', 0, 0, '連擊 3 段，威力 160 / 200 / 280；第 3 段打前方 5 m 扇形'),
      ogcd('挑釁', 30, '25 m 內目標：立刻成為仇恨第一'),
      ogcd('堅盾', 40, '自身受傷 −30%，10 秒'),
      ogcd('不動要塞', 120, '自身無敵 8 秒'),
      ogcd('守護結界', 90, '15 m 內隊友受傷 −10%，15 秒'),
    ],
  },
  {
    id: 'berserker',
    name: '裂地狂斧',
    role: 'tank',
    sub: '坦克',
    icon: '斧',
    weapon: '雙手巨斧',
    colors: { main: '#a3262f', trim: '#2b2226' },
    model: 'Barbarian',
    desc: '自我回復，輸出較高',
    skills: [
      gcd('劈砍連擊', 0, 0, '連擊 3 段，威力 160 / 200 / 280；第 3 段回復自身 4% 最大 HP'),
      ogcd('戰吼', 30, '同挑釁：立刻成為仇恨第一'),
      ogcd('嗜血', 60, '10 秒內受傷 −20%，造成傷害的 60% 回復自身'),
      ogcd('死戰', 120, '8 秒內 HP 不會低於 1'),
      gcd('裂地斬', 0, 20, '自身周圍 8 m，威力 450，仇恨 ×2'),
    ],
  },
  {
    id: 'priest',
    name: '晨曦祭司',
    role: 'healer',
    sub: '補師',
    icon: '曦',
    weapon: '日輪長杖',
    colors: { main: '#f4f1e8', trim: '#e0b23a' },
    model: 'Rogue_Hooded',
    desc: '大量回復與持續回復',
    skills: [
      gcd('聖光彈', 1.5, 0, '25 m，威力 200'),
      gcd('治癒術', 1.5, 0, '30 m 單體回復 3,000'),
      gcd('光環禱言', 2, 15, '15 m 內隊友回復 1,500，之後 10 秒每秒 150'),
      ogcd('神恩', 60, '單體回復至滿'),
      gcd('復甦之光', 6, 20, '復活 1 名倒地隊友'),
    ],
  },
  {
    id: 'warden',
    name: '星盾術士',
    role: 'healer',
    sub: '補師',
    icon: '星',
    weapon: '浮游星球加書',
    colors: { main: '#2c3d8f', trim: '#8e6bd1' },
    model: 'Mage',
    desc: '預先護盾與減傷',
    skills: [
      gcd('星屑彈', 1.5, 0, '25 m，威力 200'),
      gcd('星盾術', 1.5, 0, '30 m 單體回復 1,500，加 2,000 護盾 20 秒'),
      gcd('群星庇護', 2, 15, '15 m 內隊友回復 1,000，加 1,500 護盾 20 秒'),
      ogcd('星界領域', 90, '腳下 8 m 圓形領域 15 秒：內部受傷 −10%、每秒回復 150'),
      gcd('星還術', 6, 20, '復活 1 名倒地隊友'),
    ],
  },
  {
    id: 'brawler',
    name: '疾風拳士',
    role: 'dps',
    sub: '近戰',
    icon: '拳',
    weapon: '拳套',
    colors: { main: '#f08a2c', trim: '#fff5e8' },
    model: 'Rogue',
    desc: '身位與速度',
    skills: [
      gcd('疾風連拳', 0, 0, '連擊 3 段，威力 180 / 220 / 320；第 3 段從背面 +100'),
      gcd('旋風踢', 0, 12, '威力 400，從側面 +100'),
      ogcd('崩山拳', 40, '威力 600，從背面 +150'),
      ogcd('疾風之心', 60, '15 秒內傷害 +15%，GCD 變 2.0 秒'),
      ogcd('縮地', 20, '往移動方向衝刺 10 m'),
    ],
  },
  {
    id: 'lancer',
    name: '天槍騎兵',
    role: 'dps',
    sub: '近戰',
    icon: '槍',
    weapon: '長槍',
    colors: { main: '#1f9a9a', trim: '#c9d3e0' },
    model: 'Knight',
    desc: '跳躍與全隊增傷',
    skills: [
      gcd('穿雲連槍', 0, 0, '連擊 3 段，威力 180 / 220 / 320；第 3 段貫穿前方 10 m 直線'),
      gcd('裂鱗刺', 0, 15, '威力 250，加出血 15 秒、每秒威力 25'),
      ogcd('天降擊', 30, '躍起 0.8 秒後落在目標身上，威力 700；滯空時不受地面攻擊'),
      ogcd('戰意昂揚', 120, '全隊傷害 +10%，15 秒'),
      ogcd('後躍', 20, '向後躍 12 m'),
    ],
  },
  {
    id: 'ranger',
    name: '鷹眼射手',
    role: 'dps',
    sub: '遠程',
    icon: '弓',
    weapon: '長弓',
    colors: { main: '#3f8f3a', trim: '#8a5a33' },
    model: 'Ranger',
    desc: '全瞬發、全隊減傷',
    skills: [
      gcd('速射', 0, 0, '25 m，威力 220'),
      gcd('穿透箭', 0, 10, '25 m 直線（寬 2 m），每個目標威力 450'),
      ogcd('箭雨', 30, '目標處 6 m 圓形，威力 500'),
      ogcd('守護之歌', 90, '全隊受傷 −10%，15 秒'),
      ogcd('後空翻射擊', 20, '向後翻 10 m，同時威力 150'),
    ],
  },
  {
    id: 'sorcerer',
    name: '焰咒法師',
    role: 'dps',
    sub: '法系',
    icon: '焰',
    weapon: '短杖',
    colors: { main: '#d63a3a', trim: '#2a1f2b' },
    model: 'Mage',
    desc: '輸出最高，幾乎都要詠唱',
    skills: [
      gcd('火球術', 2, 0, '25 m，威力 300'),
      gcd('爆炎術', 2.5, 12, '目標處 5 m 圓形，威力 550'),
      ogcd('迅唱', 40, '下一個魔法免詠唱'),
      ogcd('魔力湧泉', 90, '腳下 4 m 圓形 20 秒：站在裡面詠唱 −30%、傷害 +10%'),
      gcd('隕星', 3.5, 60, '目標處 8 m 圓形，威力 1,500'),
    ],
  },
];

/** The shared Limit Break: one gauge, the effect depends on who fires it (section 五). */
export const LIMIT_BREAKS: Readonly<Record<Role, SkillInfo>> = {
  tank: { name: '鋼鐵誓約', kind: 'ogcd', cast: 0, cd: 0, desc: '全隊受傷 −60%，8 秒' },
  healer: { name: '黎明讚歌', kind: 'gcd', cast: 2, cd: 0, desc: '全隊 HP 回滿，倒地的隊友全部復活，且不會衰弱' },
  dps: { name: '破軍一擊', kind: 'gcd', cast: 2, cd: 0, desc: '目標處 8 m 範圍，對 Boss 造成其最大 HP 5% 的傷害，對小怪 30%' },
};

const BY_ID = new Map<JobId, Job>(JOBS.map((j) => [j.id, j]));

export function isJobId(v: unknown): v is JobId {
  return typeof v === 'string' && BY_ID.has(v as JobId);
}

export function jobById(id: JobId): Job {
  return BY_ID.get(id)!;
}

/** A newcomer gets the first free job in this order: one of each role first, so small parties are playable. */
export const DEFAULT_JOB_ORDER: readonly JobId[] = [
  'guardian',
  'priest',
  'brawler',
  'ranger',
  'berserker',
  'warden',
  'lancer',
  'sorcerer',
];
