import type { JobId, Role } from '../../shared/jobs';
import type { BaseModel, Recolor } from './assets';

/**
 * How each job looks and moves on a KayKit character (section 八 of the design doc): which base model,
 * the colours swapped in its texture, the weapons in its hands, the code-built extras and the animation
 * clips its skills play. Colours follow the job table: guardian blue and silver, berserker crimson and
 * black, priest white and gold, warden deep blue and violet, brawler orange and white, lancer teal and
 * silver, ranger green and brown, sorcerer crimson and black.
 */
export type Extra = 'plume' | 'wings' | 'spear' | 'halo' | 'sunDisc' | 'crown' | 'orbs' | 'runes' | 'headband' | 'fists' | 'cap';

export interface Prop {
  name: string;
  /** the hand bone it is held in */
  bone: 'handslotr' | 'handslotl';
  /** recolour its texture with the job's rules (it shares the body's texture) or with its own */
  rules?: readonly Recolor[] | 'job';
  /** held the other way up (the idle pose points weapons at the ground; a staff looks better head up) */
  flip?: boolean;
}

export interface Look {
  base: BaseModel;
  /** meshes of the base model left out, e.g. the knight's visor */
  hide: readonly string[];
  rules: readonly Recolor[];
  props: readonly Prop[];
  extras: readonly Extra[];
  idle: string;
  run: string;
  /** the clip each skill plays; the basic skill has one per combo step */
  skills: readonly [readonly [string, string, string], string, string, string, string];
  /** played while casting */
  cast: string;
}

// hue ranges measured on the KayKit atlases (scripts/pack-models.mjs keeps them as they ship)
const RED: [number, number] = [340, 12];
const NAVY: [number, number] = [232, 256];
const MAGENTA: [number, number] = [318, 345];
const GREEN: [number, number] = [140, 188];
const LIME: [number, number] = [72, 100];
const SKY: [number, number] = [192, 226];
const STEEL_BLUE: [number, number] = [196, 214];

export const LOOKS: Readonly<Record<JobId, Look>> = {
  guardian: {
    base: 'knight',
    hide: [],
    rules: [{ h: RED, s: 0.5, to: '#3d6fd8', ref: 0.5 }],
    props: [
      { name: 'sword_1handed', bone: 'handslotr', rules: 'job' },
      { name: 'shield_square_color', bone: 'handslotl', rules: 'job' },
    ],
    extras: ['plume'],
    idle: 'Idle_A',
    run: 'Running_A',
    skills: [['Melee_1H_Attack_Chop', 'Melee_1H_Attack_Slice_Diagonal', 'Melee_1H_Attack_Slice_Horizontal'], 'Use_Item', 'Melee_Block', 'Melee_Block', 'Use_Item'],
    cast: 'Ranged_Magic_Spellcasting',
  },
  berserker: {
    base: 'barbarian',
    hide: [],
    rules: [{ h: STEEL_BLUE, s: 0.2, to: '#a3262f', ref: 0.41 }],
    props: [{ name: 'axe_2handed', bone: 'handslotr', rules: 'job' }],
    extras: [],
    idle: 'Melee_2H_Idle',
    run: 'Running_A',
    skills: [['Melee_2H_Attack_Chop', 'Melee_2H_Attack_Slice', 'Melee_2H_Attack_Chop'], 'Use_Item', 'Melee_Block', 'Melee_Block', 'Melee_2H_Attack_Spin'],
    cast: 'Ranged_Magic_Spellcasting',
  },
  priest: {
    base: 'rogue_hooded',
    hide: ['RogueHooded_Mask'],
    rules: [
      { h: GREEN, s: 0.4, to: '#f4f1e8', ref: 0.26 },
      { h: LIME, s: 0.4, to: '#e0b23a', ref: 0.58 },
    ],
    props: [{ name: 'staff', bone: 'handslotr', rules: [{ h: LIME, s: 0.3, to: '#ffd34d', ref: 0.58 }], flip: true }],
    extras: ['halo', 'sunDisc'],
    idle: 'Idle_A',
    run: 'Running_A',
    skills: [['Ranged_Magic_Shoot', 'Ranged_Magic_Shoot', 'Ranged_Magic_Shoot'], 'Ranged_Magic_Raise', 'Ranged_Magic_Raise', 'Ranged_Magic_Raise', 'Ranged_Magic_Raise'],
    cast: 'Ranged_Magic_Spellcasting',
  },
  warden: {
    base: 'mage',
    hide: ['Mage_Hat'],
    rules: [
      { h: NAVY, s: 0.15, to: '#2c3d8f', ref: 0.3 },
      { h: MAGENTA, s: 0.5, to: '#8e6bd1', ref: 0.37 },
    ],
    props: [{ name: 'spellbook_open', bone: 'handslotl', rules: [{ h: MAGENTA, s: 0.5, to: '#5b3f99', ref: 0.37 }] }],
    extras: ['crown', 'orbs'],
    idle: 'Idle_A',
    run: 'Running_A',
    skills: [['Ranged_Magic_Shoot', 'Ranged_Magic_Shoot', 'Ranged_Magic_Shoot'], 'Ranged_Magic_Raise', 'Ranged_Magic_Raise', 'Ranged_Magic_Summon', 'Ranged_Magic_Raise'],
    cast: 'Ranged_Magic_Spellcasting',
  },
  brawler: {
    base: 'rogue',
    hide: [],
    rules: [
      { h: GREEN, s: 0.4, to: '#f08a2c', ref: 0.26 },
      { h: LIME, s: 0.4, to: '#fff5e8', ref: 0.58 },
    ],
    props: [],
    extras: ['headband', 'fists'],
    idle: 'Melee_Unarmed_Idle',
    run: 'Running_A',
    skills: [
      ['Melee_Unarmed_Attack_Punch_A', 'Melee_Unarmed_Attack_Punch_A', 'Melee_Unarmed_Attack_Kick'],
      'Melee_Unarmed_Attack_Kick',
      'Melee_Unarmed_Attack_Punch_A',
      'Cheering',
      'Dodge_Forward',
    ],
    cast: 'Ranged_Magic_Spellcasting',
  },
  lancer: {
    base: 'knight',
    hide: ['Knight_HelmetVisor'],
    rules: [{ h: RED, s: 0.5, to: '#1f9a9a', ref: 0.5 }],
    props: [],
    extras: ['wings', 'spear'],
    idle: 'Melee_2H_Idle',
    run: 'Running_A',
    skills: [['Melee_2H_Attack_Stab', 'Melee_1H_Attack_Stab', 'Melee_2H_Attack_Stab'], 'Melee_1H_Attack_Stab', 'Melee_1H_Attack_Jump_Chop', 'Cheering', 'Dodge_Backward'],
    cast: 'Ranged_Magic_Spellcasting',
  },
  ranger: {
    base: 'ranger',
    hide: [],
    rules: [{ h: SKY, s: 0.5, to: '#3f8f3a', ref: 0.43 }],
    props: [{ name: 'bow_withString', bone: 'handslotl' }],
    extras: ['cap'],
    idle: 'Ranged_Bow_Idle',
    run: 'Running_HoldingBow',
    skills: [['Ranged_Bow_Release', 'Ranged_Bow_Release', 'Ranged_Bow_Release'], 'Ranged_Bow_Release', 'Ranged_Bow_Release', 'Use_Item', 'Dodge_Backward'],
    cast: 'Ranged_Bow_Idle',
  },
  sorcerer: {
    base: 'mage',
    hide: [],
    rules: [
      { h: NAVY, s: 0.15, to: '#2a1f2b', ref: 0.3 },
      { h: MAGENTA, s: 0.5, to: '#d63a3a', ref: 0.37 },
    ],
    props: [{ name: 'wand', bone: 'handslotr', rules: [{ h: GREEN, s: 0.3, to: '#ff7a2c', ref: 0.4 }] }],
    extras: ['runes'],
    idle: 'Idle_A',
    run: 'Running_A',
    skills: [['Ranged_Magic_Shoot', 'Ranged_Magic_Shoot', 'Ranged_Magic_Shoot'], 'Ranged_Magic_Shoot', 'Use_Item', 'Ranged_Magic_Summon', 'Ranged_Magic_Raise'],
    cast: 'Ranged_Magic_Spellcasting',
  },
};

/** The clip the Limit Break plays, by the user's role. */
export const LB_CLIP: Readonly<Record<Role, string>> = { tank: 'Melee_Block', healer: 'Ranged_Magic_Summon', dps: 'Melee_2H_Attack_Spin' };

/** Clips that only make sense standing (they move the legs); the rest can play on the upper body while running. */
export const FULL_BODY = new Set(['Dodge_Forward', 'Dodge_Backward', 'Melee_1H_Attack_Jump_Chop', 'Melee_2H_Attack_Spin', 'Melee_Unarmed_Attack_Kick', 'Cheering', 'Ranged_Magic_Summon']);
