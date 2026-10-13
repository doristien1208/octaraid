import type { StatusId } from './status';

/**
 * The 8 jobs (2 tanks, 2 healers, 4 DPS) and their 10 skills, plus 疾走 for everyone, as in section 五 of
 * the design doc. Skills 1–5 are the original kits (computer players count on those slots), 6–10 came
 * with v0.5 (FF14's job and role actions as the model; the names are original). `fx` is what the
 * simulation (shared/sim/fight.ts) carries out; `desc` says the same thing in words for the waiting room
 * and the hotbar, so change both together.
 */
export type Role = 'tank' | 'healer' | 'dps';
export type JobId = 'guardian' | 'berserker' | 'priest' | 'warden' | 'brawler' | 'lancer' | 'ranger' | 'sorcerer';

/**
 * One step of a skill. Distances are metres, durations seconds, potency × 10 is the damage.
 * Effects that hit "the target" use the skill's target; areas only hit enemies.
 */
export type Fx =
  /** damage to the target; rear / flank: extra potency when hitting from that side of the boss; enmity multiplies the enmity it makes */
  | { k: 'hit'; p: number; rear?: number; flank?: number; enmity?: number }
  /** damage to every enemy in a circle around me or around the target; enmity multiplies the enmity it makes */
  | { k: 'circle'; at: 'me' | 'target'; r: number; p: number; enmity?: number }
  /** damage in a fan in front of me (I face the target) */
  | { k: 'cone'; r: number; deg: number; p: number }
  /** damage to every enemy on a straight line from me through the target */
  | { k: 'line'; len: number; w: number; p: number }
  /** a damage-over-time debuff on the target: p potency per second */
  | { k: 'dot'; s: StatusId; p: number; dur: number }
  | { k: 'heal'; amount: number }
  | { k: 'healFull' }
  /** heals me by this share of my max HP */
  | { k: 'healSelf'; pct: number }
  /** heals every living party member within r metres of me (me included) */
  | { k: 'partyHeal'; r: number; amount: number }
  /** a shield on the target that absorbs `amount` damage */
  | { k: 'shield'; s: StatusId; amount: number; dur: number }
  | { k: 'partyShield'; s: StatusId; r: number; amount: number; dur: number }
  /** a status on me, on the target, or on the party (within r metres of me; no r = everyone); v: its value (heal per second) */
  | { k: 'buff'; s: StatusId; dur: number; who: 'me' | 'target' | 'party'; r?: number; v?: number }
  /** a circle on the ground at my feet; its status applies to whoever stands in it (ley: only to me) */
  | { k: 'zone'; s: StatusId; r: number; dur: number }
  | { k: 'provoke' }
  | { k: 'raise' }
  /** a quick dash: where I am moving (or facing), or straight back from the target */
  | { k: 'dash'; dist: number; dir: 'move' | 'back'; dur: number }
  /** a jump onto the target; the effects after it happen on landing (ground: a rush along the floor, not in the air) */
  | { k: 'leap'; dur: number; ground?: boolean }
  /** a status on the enemy target: 卸力, 蝕力咒 (the damage it deals goes down) */
  | { k: 'debuff'; s: StatusId; dur: number }
  /** a shield on me worth this share of my max HP */
  | { k: 'selfShield'; s: StatusId; pct: number; dur: number }
  /** a blink to the ally target (焰影步) */
  | { k: 'toAlly'; dur: number }
  /** a blink back to the middle of my own zone of this kind (歸泉) */
  | { k: 'toZone'; s: StatusId; dur: number };

/** enemy: attacks; ally: heals (myself included); other: an ally that is not me; dead: raises; self: needs no target */
export type SkillTarget = 'enemy' | 'ally' | 'other' | 'dead' | 'self';

export interface SkillInfo {
  name: string;
  /** gcd: shares the 2.5 s global cooldown; ogcd: an ability with its own cooldown */
  kind: 'gcd' | 'ogcd';
  /** cast time in seconds, 0 = instant */
  cast: number;
  /** cooldown in seconds, 0 = none */
  cd: number;
  desc: string;
  target: SkillTarget;
  /** reach in metres from the target's edge (the boss's ring); 0 when the skill needs no target */
  range: number;
  /** a spell: 迅唱 makes it instant and 魔力湧泉 shortens its cast */
  spell?: boolean;
  fx: Fx[];
  /** the basic skill: each press does the next of three steps */
  combo?: [Fx[], Fx[], Fx[]];
  /** only while my own zone of this kind is on the floor (歸泉) */
  needsZone?: StatusId;
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
  /** CC0 base character (KayKit Adventurers), recoloured and dressed in client/game/look.ts */
  model: string;
  desc: string;
  /** SKILL_COUNT of them, on keys 1–9 and 0 */
  skills: readonly SkillInfo[];
}

export const ROLE_NAMES: Readonly<Record<Role, string>> = { tank: '坦克', healer: '補師', dps: 'DPS' };
/** Role colours used everywhere (FF14-style: tanks blue, healers green, DPS red). */
export const ROLE_COLORS: Readonly<Record<Role, string>> = { tank: '#3d7be0', healer: '#2e9e5b', dps: '#d84343' };
export const ROLE_HP: Readonly<Record<Role, number>> = { tank: 14_000, healer: 10_000, dps: 10_000 };

/** Reach of melee skills: 3 m outside the boss's ring. */
export const MELEE = 3;
const RANGED = 25;
const HEAL = 30;

type Extra = Pick<SkillInfo, 'target' | 'range' | 'fx'> & Partial<Pick<SkillInfo, 'spell' | 'combo' | 'needsZone'>>;

const gcd = (name: string, cast: number, cd: number, desc: string, x: Extra): SkillInfo => ({ name, kind: 'gcd', cast, cd, desc, ...x });
const ogcd = (name: string, cd: number, desc: string, x: Extra): SkillInfo => ({ name, kind: 'ogcd', cast: 0, cd, desc, ...x });
const hit = (p: number, side?: { rear?: number; flank?: number }): Fx => ({ k: 'hit', p, ...side });
const combo = (a: Fx[], b: Fx[], c: Fx[]): Extra => ({ target: 'enemy', range: MELEE, fx: [], combo: [a, b, c] });
const self = (fx: Fx[]): Extra => ({ target: 'self', range: 0, fx });

// shared by a role, as FF14's role actions
const SWIFTCAST = ogcd('迅唱', 40, '下一個魔法免詠唱', self([{ k: 'buff', s: 'swift', dur: 15, who: 'me' }]));
const FEINT = ogcd('卸力', 90, '10 m 內目標：造成的傷害 −10%，10 秒', { target: 'enemy', range: 10, fx: [{ k: 'debuff', s: 'feint', dur: 10 }] });
const TRUE_NORTH = ogcd('八方步', 45, '10 秒內不必站背面或側面也有身位加成', self([{ k: 'buff', s: 'trueNorth', dur: 10, who: 'me' }]));
const SECOND_WIND = ogcd('回氣', 120, '回復自身 20% 最大 HP', self([{ k: 'healSelf', pct: 0.2 }]));

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
      gcd('三連斬', 0, 0, '連擊 3 段，威力 160 / 200 / 280；第 3 段打前方 5 m 扇形', combo([hit(160)], [hit(200)], [{ k: 'cone', r: 5, deg: 90, p: 280 }])),
      ogcd('挑釁', 30, '25 m 內目標：立刻成為仇恨第一', { target: 'enemy', range: RANGED, fx: [{ k: 'provoke' }] }),
      ogcd('堅盾', 40, '自身受傷 −30%，10 秒', { target: 'self', range: 0, fx: [{ k: 'buff', s: 'rampart', dur: 10, who: 'me' }] }),
      ogcd('不動要塞', 120, '自身無敵 8 秒', { target: 'self', range: 0, fx: [{ k: 'buff', s: 'fortress', dur: 8, who: 'me' }] }),
      ogcd('守護結界', 90, '15 m 內隊友受傷 −10%，15 秒', { target: 'self', range: 0, fx: [{ k: 'buff', s: 'shelter', dur: 15, who: 'party', r: 15 }] }),
      gcd('聖盾迴旋', 0, 0, '自身周圍 5 m，威力 120，仇恨 ×3（接小怪）', self([{ k: 'circle', at: 'me', r: 5, p: 120, enmity: 3 }])),
      ogcd('盾衝', 30, '衝到 20 m 內的目標身邊，威力 150', { target: 'enemy', range: 20, fx: [{ k: 'leap', dur: 0.3, ground: true }, hit(150)] }),
      ogcd('守護之誓', 25, '自己或 1 名隊友（30 m）受傷 −20%，8 秒', { target: 'ally', range: HEAL, fx: [{ k: 'buff', s: 'oath', dur: 8, who: 'target' }] }),
      ogcd('誓約之刃', 60, '自身傷害 +20%，15 秒', self([{ k: 'buff', s: 'oathBlade', dur: 15, who: 'me' }])),
      gcd('破邪之光', 1.5, 0, '25 m，威力 180（暫時離開王身邊時用）', { target: 'enemy', range: RANGED, spell: true, fx: [hit(180)] }),
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
      gcd('劈砍連擊', 0, 0, '連擊 3 段，威力 160 / 200 / 280；第 3 段回復自身 4% 最大 HP', combo([hit(160)], [hit(200)], [hit(280), { k: 'healSelf', pct: 0.04 }])),
      ogcd('戰吼', 30, '同挑釁：立刻成為仇恨第一', { target: 'enemy', range: RANGED, fx: [{ k: 'provoke' }] }),
      ogcd('嗜血', 60, '10 秒內受傷 −20%，造成傷害的 60% 回復自身', { target: 'self', range: 0, fx: [{ k: 'buff', s: 'bloodlust', dur: 10, who: 'me' }] }),
      ogcd('死戰', 120, '8 秒內 HP 不會低於 1', { target: 'self', range: 0, fx: [{ k: 'buff', s: 'holmgang', dur: 8, who: 'me' }] }),
      gcd('裂地斬', 0, 20, '自身周圍 8 m，威力 450，仇恨 ×2', { target: 'self', range: 0, fx: [{ k: 'circle', at: 'me', r: 8, p: 450, enmity: 2 }] }),
      gcd('擲斧', 0, 0, '20 m，威力 150，仇恨 ×3（遠距離接怪）', { target: 'enemy', range: 20, fx: [{ k: 'hit', p: 150, enmity: 3 }] }),
      ogcd('猛衝', 30, '衝到 20 m 內的目標身邊，威力 150', { target: 'enemy', range: 20, fx: [{ k: 'leap', dur: 0.3, ground: true }, hit(150)] }),
      ogcd('熱血庇護', 25, '自己或 1 名隊友（30 m）受傷 −20%，8 秒；這段時間我造成傷害的 30% 回復他', {
        target: 'ally',
        range: HEAL,
        fx: [{ k: 'buff', s: 'nascent', dur: 8, who: 'target' }],
      }),
      ogcd('戰嚎', 60, '6 秒內的攻擊必定暴擊且直擊', self([{ k: 'buff', s: 'warCry', dur: 6, who: 'me' }])),
      ogcd('狂血', 90, '最大 HP +20% 並回復 20%，10 秒', self([{ k: 'buff', s: 'thrill', dur: 10, who: 'me' }, { k: 'healSelf', pct: 0.2 }])),
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
      gcd('聖光彈', 1.5, 0, '25 m，威力 200', { target: 'enemy', range: RANGED, spell: true, fx: [hit(200)] }),
      gcd('治癒術', 1.5, 0, '30 m 單體回復 3,000', { target: 'ally', range: HEAL, spell: true, fx: [{ k: 'heal', amount: 3000 }] }),
      gcd('光環禱言', 2, 15, '15 m 內隊友回復 1,500，之後 10 秒每秒 150', {
        target: 'self',
        range: 0,
        spell: true,
        fx: [
          { k: 'partyHeal', r: 15, amount: 1500 },
          { k: 'buff', s: 'regen', dur: 10, who: 'party', r: 15, v: 150 },
        ],
      }),
      ogcd('神恩', 60, '單體回復至滿', { target: 'ally', range: HEAL, fx: [{ k: 'healFull' }] }),
      gcd('復甦之光', 6, 20, '復活 1 名倒地隊友', { target: 'dead', range: HEAL, spell: true, fx: [{ k: 'raise' }] }),
      SWIFTCAST,
      gcd('烈日灼燒', 0, 0, '25 m，威力 100，加 30 秒持續傷害、每秒威力 8', { target: 'enemy', range: RANGED, spell: true, fx: [hit(100), { k: 'dot', s: 'sunBurn', p: 8, dur: 30 }] }),
      ogcd('晨光恩典', 120, '20 秒內我的治療量 +25%', self([{ k: 'buff', s: 'dawnGrace', dur: 20, who: 'me' }])),
      gcd('群體治癒', 2, 0, '15 m 內隊友回復 1,200（沒有 CD，連續全場傷害時用）', { target: 'self', range: 0, spell: true, fx: [{ k: 'partyHeal', r: 15, amount: 1200 }] }),
      ogcd('祈福', 30, '30 m 單體回復 2,500（移動中也能補）', { target: 'ally', range: HEAL, fx: [{ k: 'heal', amount: 2500 }] }),
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
      gcd('星屑彈', 1.5, 0, '25 m，威力 200', { target: 'enemy', range: RANGED, spell: true, fx: [hit(200)] }),
      gcd('星盾術', 1.5, 0, '30 m 單體回復 2,000，加 2,500 護盾 20 秒', {
        target: 'ally',
        range: HEAL,
        spell: true,
        fx: [
          { k: 'heal', amount: 2000 },
          { k: 'shield', s: 'starShield', amount: 2500, dur: 20 },
        ],
      }),
      gcd('群星庇護', 2, 15, '15 m 內隊友回復 1,500，加 2,000 護盾 20 秒', {
        target: 'self',
        range: 0,
        spell: true,
        fx: [
          { k: 'partyHeal', r: 15, amount: 1500 },
          { k: 'partyShield', s: 'starVeil', r: 15, amount: 2000, dur: 20 },
        ],
      }),
      ogcd('星界領域', 90, '腳下 8 m 圓形領域 15 秒：內部受傷 −15%、每秒回復 250', { target: 'self', range: 0, fx: [{ k: 'zone', s: 'sanctuary', r: 8, dur: 15 }] }),
      gcd('星還術', 6, 20, '復活 1 名倒地隊友', { target: 'dead', range: HEAL, spell: true, fx: [{ k: 'raise' }] }),
      SWIFTCAST,
      gcd('星蝕', 0, 0, '25 m，威力 100，加 30 秒持續傷害、每秒威力 8', { target: 'enemy', range: RANGED, spell: true, fx: [hit(100), { k: 'dot', s: 'starRot', p: 8, dur: 30 }] }),
      ogcd('星輝', 120, '20 秒內我的治療量與護盾量 +25%', self([{ k: 'buff', s: 'starGlow', dur: 20, who: 'me' }])),
      ogcd('星辰守護', 30, '1 名隊友（30 m）受傷 −15%，10 秒，加 3,000 護盾', {
        target: 'ally',
        range: HEAL,
        fx: [
          { k: 'buff', s: 'starGuard', dur: 10, who: 'target' },
          { k: 'shield', s: 'starGuardShield', amount: 3000, dur: 10 },
        ],
      }),
      ogcd('星環結界', 120, '15 m 內隊友受傷 −10%，加 1,000 護盾，15 秒', self([
        { k: 'buff', s: 'starRing', dur: 15, who: 'party', r: 15 },
        { k: 'partyShield', s: 'starRingShield', r: 15, amount: 1000, dur: 15 },
      ])),
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
      gcd('疾風連拳', 0, 0, '連擊 3 段，威力 170 / 210 / 310；第 3 段從背面 +100', combo([hit(170)], [hit(210)], [hit(310, { rear: 100 })])),
      gcd('旋風踢', 0, 12, '威力 400，從側面 +100', { target: 'enemy', range: MELEE, fx: [hit(400, { flank: 100 })] }),
      ogcd('崩山拳', 40, '威力 600，從背面 +150', { target: 'enemy', range: MELEE, fx: [hit(600, { rear: 150 })] }),
      ogcd('疾風之心', 60, '15 秒內傷害 +15%，GCD 變 2.0 秒', { target: 'self', range: 0, fx: [{ k: 'buff', s: 'fury', dur: 15, who: 'me' }] }),
      ogcd('縮地', 20, '往移動方向衝刺 10 m', { target: 'self', range: 0, fx: [{ k: 'dash', dist: 10, dir: 'move', dur: 0.25 }] }),
      gcd('裂空拳', 0, 0, '自身周圍 5 m，威力 140（打小怪）', self([{ k: 'circle', at: 'me', r: 5, p: 140 }])),
      ogcd('鐵身', 90, '自身受傷 −20%，10 秒', self([{ k: 'buff', s: 'ironBody', dur: 10, who: 'me' }])),
      FEINT,
      TRUE_NORTH,
      SECOND_WIND,
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
      gcd('穿雲連槍', 0, 0, '連擊 3 段，威力 180 / 220 / 320；第 3 段貫穿前方 10 m 直線', combo([hit(180)], [hit(220)], [{ k: 'line', len: 10, w: 2, p: 320 }])),
      gcd('裂鱗刺', 0, 15, '威力 250，加出血 15 秒、每秒威力 25', { target: 'enemy', range: MELEE, fx: [hit(250), { k: 'dot', s: 'bleed', p: 25, dur: 15 }] }),
      ogcd('天降擊', 30, '躍起 0.8 秒後落在目標身上，威力 700；滯空時不受地面攻擊', { target: 'enemy', range: 20, fx: [{ k: 'leap', dur: 0.8 }, hit(700)] }),
      ogcd('戰意昂揚', 120, '全隊傷害 +10%，15 秒', { target: 'self', range: 0, fx: [{ k: 'buff', s: 'battleCry', dur: 15, who: 'party' }] }),
      ogcd('後躍', 20, '向後躍 12 m', { target: 'self', range: 0, fx: [{ k: 'dash', dist: 12, dir: 'back', dur: 0.45 }] }),
      ogcd('天槍墜擊', 60, '跳到 20 m 內的目標身上，周圍 5 m 威力 500；滯空時不受地面攻擊', {
        target: 'enemy',
        range: 20,
        fx: [{ k: 'leap', dur: 0.8 }, { k: 'circle', at: 'target', r: 5, p: 500 }],
      }),
      ogcd('龍鱗', 90, '自身護盾（最大 HP 20%），10 秒', self([{ k: 'selfShield', s: 'dragonScale', pct: 0.2, dur: 10 }])),
      FEINT,
      TRUE_NORTH,
      SECOND_WIND,
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
      gcd('速射', 0, 0, '25 m，威力 220', { target: 'enemy', range: RANGED, fx: [hit(220)] }),
      gcd('穿透箭', 0, 10, '25 m 直線（寬 2 m），每個目標威力 450', { target: 'enemy', range: RANGED, fx: [{ k: 'line', len: 25, w: 2, p: 450 }] }),
      ogcd('箭雨', 30, '目標處 6 m 圓形，威力 500', { target: 'enemy', range: RANGED, fx: [{ k: 'circle', at: 'target', r: 6, p: 500 }] }),
      ogcd('守護之歌', 90, '全隊受傷 −10%，15 秒', { target: 'self', range: 0, fx: [{ k: 'buff', s: 'song', dur: 15, who: 'party' }] }),
      ogcd('後空翻射擊', 20, '向後翻 10 m，同時威力 150', { target: 'enemy', range: RANGED, fx: [hit(150), { k: 'dash', dist: 10, dir: 'back', dur: 0.4 }] }),
      ogcd('戰歌', 120, '全隊傷害 +5%，15 秒', self([{ k: 'buff', s: 'warSong', dur: 15, who: 'party' }])),
      gcd('毒牙箭', 0, 0, '25 m，威力 100，加 30 秒持續傷害、每秒威力 5', { target: 'enemy', range: RANGED, fx: [hit(100), { k: 'dot', s: 'venom', p: 5, dur: 30 }] }),
      ogcd('連珠箭', 15, '25 m，威力 100', { target: 'enemy', range: RANGED, fx: [hit(100)] }),
      ogcd('鷹眼凝神', 120, '自身傷害 +10%，20 秒', self([{ k: 'buff', s: 'hawkEye', dur: 20, who: 'me' }])),
      SECOND_WIND,
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
      gcd('火球術', 2, 0, '25 m，威力 320', { target: 'enemy', range: RANGED, spell: true, fx: [hit(320)] }),
      gcd('爆炎術', 2.5, 12, '目標處 5 m 圓形，威力 550', { target: 'enemy', range: RANGED, spell: true, fx: [{ k: 'circle', at: 'target', r: 5, p: 550 }] }),
      ogcd('迅唱', 40, '下一個魔法免詠唱', { target: 'self', range: 0, fx: [{ k: 'buff', s: 'swift', dur: 15, who: 'me' }] }),
      ogcd('魔力湧泉', 90, '腳下 4 m 圓形 20 秒：站在裡面詠唱 −30%、傷害 +10%', { target: 'self', range: 0, fx: [{ k: 'zone', s: 'ley', r: 4, dur: 20 }] }),
      gcd('隕星', 3.5, 60, '目標處 8 m 圓形，威力 1,500', { target: 'enemy', range: RANGED, spell: true, fx: [{ k: 'circle', at: 'target', r: 8, p: 1500 }] }),
      ogcd('焰影步', 10, '瞬移到 25 m 內 1 名隊友身邊', { target: 'other', range: RANGED, fx: [{ k: 'toAlly', dur: 0.25 }] }),
      ogcd('歸泉', 5, '瞬移回自己的魔力湧泉中心（湧泉還在時才能用）', { target: 'self', range: 0, needsZone: 'ley', fx: [{ k: 'toZone', s: 'ley', dur: 0.25 }] }),
      gcd('灼燒咒', 0, 0, '25 m，威力 100，加 24 秒持續傷害、每秒威力 15（移動時的瞬發技）', { target: 'enemy', range: RANGED, spell: true, fx: [hit(100), { k: 'dot', s: 'scorch', p: 15, dur: 24 }] }),
      ogcd('焰幕', 120, '自身護盾（最大 HP 30%），20 秒', self([{ k: 'selfShield', s: 'flameVeil', pct: 0.3, dur: 20 }])),
      ogcd('蝕力咒', 90, '25 m 內目標：造成的傷害 −10%，10 秒', { target: 'enemy', range: RANGED, fx: [{ k: 'debuff', s: 'addle', dur: 10 }] }),
    ],
  },
];

export interface LimitBreak {
  name: string;
  /** seconds, 0 = instant */
  cast: number;
  desc: string;
}

/** The shared Limit Break: one gauge, the effect depends on who fires it (section 五). */
export const LIMIT_BREAKS: Readonly<Record<Role, LimitBreak>> = {
  tank: { name: '鋼鐵誓約', cast: 0, desc: '全隊受傷 −60%，8 秒' },
  healer: { name: '黎明讚歌', cast: 2, desc: '全隊 HP 回滿，倒地的隊友全部復活，且不會衰弱' },
  dps: { name: '破軍一擊', cast: 2, desc: '目標處 8 m 範圍，對 Boss 造成其最大 HP 5% 的傷害，對小怪 30%' },
};

/** Skills per job (keys 1–9 and 0), the Limit Break's slot after them, then 疾走's. */
export const SKILL_COUNT = 10;
export const LB_SLOT = 10;
export const SPRINT_SLOT = 11;

/** 疾走: every job has it, on its own key (Shift). */
export const SPRINT: SkillInfo = ogcd('疾走', 60, '10 秒內移動速度 +30%', self([{ k: 'buff', s: 'sprint', dur: 10, who: 'me' }]));

/** The skill in a slot: 0–9 the job's, SPRINT_SLOT 疾走, the Limit Break (or anything else) null. */
export function skillAt(job: Job, slot: number): SkillInfo | null {
  if (slot === SPRINT_SLOT) return SPRINT;
  return slot >= 0 && slot < SKILL_COUNT ? (job.skills[slot] ?? null) : null;
}

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
