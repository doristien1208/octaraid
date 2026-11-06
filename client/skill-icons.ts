/// <reference types="vite/client" />

/**
 * Skill icons. The pictures are silhouettes from game-icons.net (CC BY 3.0; who drew which is in
 * CREDITS.md), kept unchanged in client/icons/<author>/<name>.svg. The game draws each one white on a
 * square tile whose colour says what the skill is for, so a bar reads at a glance: heals green,
 * mitigation and shields blue, movement teal, damage buffs pink, what weakens the enemy grey-purple,
 * raises and invulnerability gold; attacks take their job's colour. Every skill, 疾走 and each limit
 * break has one, and no job uses a picture twice (tests/icons.test.ts).
 */

/** Tile colours, light (top left) to dark (bottom right). */
export const TINTS = {
  steel: ['#b4c3de', '#2c3a5a'], // 鐵壁衛士's attacks
  crimson: ['#ff7a66', '#5c0d12'], // 裂地狂斧's attacks, enmity, bleeding
  fire: ['#ffbe5c', '#8a1c06'], // 焰咒法師's and 疾風拳士's attacks
  sun: ['#ffe9a0', '#a0600c'], // 晨曦祭司's attacks, raises, invulnerability
  star: ['#c2b6ff', '#2a1f86'], // 星盾術士's attacks and buffs
  dragon: ['#ec9cff', '#4a1170'], // 天槍騎兵's attacks
  hunt: ['#ecdc8a', '#5c4a12'], // 鷹眼射手's attacks
  heal: ['#9ff5b0', '#12663a'],
  shield: ['#9cd6ff', '#123f8a'],
  wind: ['#8ff5e2', '#0b5a5a'],
  rose: ['#ff9cbc', '#7a1240'],
  hex: ['#cdb4e6', '#3a2450'],
  arcane: ['#b8c4ff', '#3a2a9a'], // 迅唱, 魔力湧泉
  limit: ['#fff2b0', '#c0500a'],
} as const satisfies Record<string, readonly [string, string]>;
export type Tint = keyof typeof TINTS;

/** Skill name: its picture (game-icons.net author/name) and tile colour. */
export const SKILL_ICONS: Readonly<Record<string, readonly [file: string, tint: Tint]>> = {
  // 鐵壁衛士
  三連斬: ['lorc/sword-slice', 'steel'],
  挑釁: ['lorc/shouting', 'crimson'],
  堅盾: ['lorc/checked-shield', 'shield'],
  不動要塞: ['lorc/locked-fortress', 'sun'],
  守護結界: ['lorc/shield-echoes', 'shield'],
  聖盾迴旋: ['lorc/sword-spin', 'steel'],
  盾衝: ['delapouite/shield-bash', 'steel'],
  守護之誓: ['lorc/shield-reflect', 'shield'],
  誓約之刃: ['lorc/shining-sword', 'rose'],
  破邪之光: ['lorc/cross-flare', 'sun'],
  // 裂地狂斧
  劈砍連擊: ['lorc/axe-swing', 'crimson'],
  戰吼: ['lorc/sonic-shout', 'crimson'],
  嗜血: ['lorc/bleeding-heart', 'shield'],
  死戰: ['lorc/skull-shield', 'sun'],
  裂地斬: ['lorc/earth-crack', 'crimson'],
  擲斧: ['lorc/battle-axe', 'crimson'],
  猛衝: ['delapouite/charging-bull', 'crimson'],
  熱血庇護: ['delapouite/heart-shield', 'shield'],
  戰嚎: ['lorc/wolf-howl', 'rose'],
  狂血: ['zeromancer/heart-plus', 'heal'],
  // 晨曦祭司
  聖光彈: ['lorc/sun', 'sun'],
  治癒術: ['delapouite/healing', 'heal'],
  光環禱言: ['lorc/beams-aura', 'heal'],
  神恩: ['lorc/angel-wings', 'heal'],
  復甦之光: ['lorc/ankh', 'sun'],
  迅唱: ['delapouite/bolt-spell-cast', 'arcane'],
  烈日灼燒: ['lorc/barbed-sun', 'sun'],
  晨光恩典: ['lorc/sunrise', 'sun'],
  群體治癒: ['skoll/hearts', 'heal'],
  祈福: ['lorc/prayer', 'heal'],
  // 星盾術士
  星屑彈: ['lorc/comet-spark', 'star'],
  星盾術: ['delapouite/healing-shield', 'heal'],
  群星庇護: ['delapouite/star-formation', 'heal'],
  星界領域: ['delapouite/star-altar', 'shield'],
  星還術: ['delapouite/heart-wings', 'sun'],
  星蝕: ['lorc/eclipse', 'star'],
  星輝: ['delapouite/sparkles', 'star'],
  星辰守護: ['skoll/allied-star', 'shield'],
  星環結界: ['lorc/ringed-planet', 'shield'],
  // 疾風拳士
  疾風連拳: ['lorc/punch', 'fire'],
  旋風踢: ['delapouite/high-kick', 'fire'],
  崩山拳: ['lorc/punch-blast', 'fire'],
  疾風之心: ['lorc/whirlwind', 'rose'],
  縮地: ['lorc/wingfoot', 'wind'],
  裂空拳: ['lorc/wind-slap', 'fire'],
  鐵身: ['lorc/muscle-up', 'shield'],
  卸力: ['skoll/drop-weapon', 'hex'],
  八方步: ['lorc/compass', 'wind'],
  回氣: ['lorc/meditation', 'heal'],
  // 天槍騎兵
  穿雲連槍: ['lorc/spear-hook', 'dragon'],
  裂鱗刺: ['lorc/bleeding-wound', 'crimson'],
  天降擊: ['delapouite/jump-across', 'dragon'],
  戰意昂揚: ['lorc/rally-the-troops', 'rose'],
  後躍: ['lorc/dodging', 'wind'],
  天槍墜擊: ['lorc/blade-fall', 'dragon'],
  龍鱗: ['delapouite/dragon-shield', 'shield'],
  // 鷹眼射手
  速射: ['lorc/fast-arrow', 'hunt'],
  穿透箭: ['lorc/supersonic-arrow', 'hunt'],
  箭雨: ['lorc/striking-arrows', 'hunt'],
  守護之歌: ['lorc/lyre', 'shield'],
  後空翻射擊: ['darkzaitzev/acrobatic', 'wind'],
  戰歌: ['lorc/hunting-horn', 'rose'],
  毒牙箭: ['lorc/snake-bite', 'hex'],
  連珠箭: ['lorc/double-shot', 'hunt'],
  鷹眼凝神: ['lorc/hawk-emblem', 'rose'],
  // 焰咒法師
  火球術: ['lorc/fireball', 'fire'],
  爆炎術: ['lorc/fire-ring', 'fire'],
  魔力湧泉: ['lorc/vortex', 'arcane'],
  隕星: ['lorc/meteor-impact', 'fire'],
  焰影步: ['lorc/teleport', 'wind'],
  歸泉: ['lorc/magic-portal', 'wind'],
  灼燒咒: ['lorc/burning-dot', 'fire'],
  焰幕: ['lorc/fire-shield', 'shield'],
  蝕力咒: ['lorc/cursed-star', 'hex'],
  // everyone
  疾走: ['lorc/sprint', 'wind'],
  // limit breaks
  鋼鐵誓約: ['lorc/surrounded-shield', 'limit'],
  黎明讚歌: ['lorc/holy-grail', 'limit'],
  破軍一擊: ['lorc/zeus-sword', 'limit'],
};

const FILES = import.meta.glob<string>('./icons/*/*.svg', { query: '?raw', import: 'default', eager: true });

/** The icon files bundled with the game, as author/name. */
export const ICON_FILES: readonly string[] = Object.keys(FILES).map((k) => k.slice('./icons/'.length, -'.svg'.length));

/** The outline in an icon file: its paths without the black square game-icons.net puts behind them. */
export function svgPath(svg: string): string {
  return [...svg.matchAll(/<path\b[^>]*?\sd="([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((d) => d !== 'M0 0h512v512H0z')
    .join(' ');
}

export interface SkillIcon {
  /** game-icons.net author/name */
  file: string;
  /** SVG path data in a 512 × 512 box */
  path: string;
  /** tile colour, light to dark */
  tint: readonly [string, string];
}

const cache = new Map<string, SkillIcon | null>();

/** The icon of a skill or limit break by name; null for a name without one. */
export function iconOf(name: string): SkillIcon | null {
  let icon = cache.get(name);
  if (icon === undefined) {
    const entry = SKILL_ICONS[name];
    const svg = entry ? FILES[`./icons/${entry[0]}.svg`] : undefined;
    icon = entry && svg ? { file: entry[0], path: svgPath(svg), tint: TINTS[entry[1]] } : null;
    cache.set(name, icon);
  }
  return icon;
}
