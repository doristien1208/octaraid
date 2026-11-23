import { RULES, TICK_RATE as TICK_RATE_HZ, sec } from '../constants';
import type { FoeKind } from '../bosses/foes';
import type { FightEvent } from '../protocol';
import { clampToArena, faceTowards } from './arena';
import type { Fight, Fighter, Foe } from './fight';
import { checker, hidden, inside, type Pillar, type Shape, type TeleColor } from './mech';

/** Where a mechanic comes from: the main boss (default) or its twin (雙子機神). */
type Src = { src?: 'twin' };

/**
 * One attack in a boss script (the mechanic library, section 六 of the design doc). Damage numbers are
 * for the difficulty the script was built for. Seconds; `delay` moves the hit after the end of the cast.
 */
export type MechDef = Src &
  (
    | /** everyone takes it: top up and mitigate; hits: that many, `gap` seconds apart (no time to top up in between) */ {
        k: 'raidwide';
        dmg: number;
        hits?: number;
        gap?: number;
      }
    /**
     * the top of the enmity list takes it (rank 2: the second, e.g. 凍核's half of 雙死刑); with 2 hits the
     * second goes to whoever is top then (tank swap)
     */
    | {
        k: 'buster';
        dmg: number;
        hits?: number;
        gap?: number;
        rank?: number;
        /** 流體揮擊: it leaves 水抗降低 for this many seconds; hit again while it lasts, all of the HP goes (swap, or 不動要塞 / 死戰) */
        soak?: number;
        /** every hit on whoever is top then, without 裂盾 (懲戒與聖槍: mitigate, swap or go invulnerable) */
        noCrack?: boolean;
      }
    /** a circle around the boss (鋼鐵): get out */
    | { k: 'chariot'; r: number; dmg: number; delay?: number }
    /** everything but a circle around the boss (月環): get in */
    | { k: 'donut'; r0: number; dmg: number; delay?: number }
    /** a fan in front of the boss, aimed when the cast starts; top: at the top of the enmity list (the tank), theirs to take, turning after them (噴焰) */
    | { k: 'cone'; deg: number; dmg: number; top?: boolean }
    /** random circles in waves; nearBoss puts that many of the first wave next to the boss and the rest of that wave out of the middle */
    | { k: 'rocks'; r: number; dmg: number; count: number; waves: number; gap: number; nearBoss?: number }
    /** parallel strips across the arena at these offsets from the centre, one wave after another */
    | { k: 'lines'; w: number; dmg: number; waves: number[][]; gap: number }
    /** a circle on each marked player: keep away from each other */
    | { k: 'spread'; r: number; dmg: number; count: number | 'all' }
    /**
     * a circle on each marked player that splits `dmg` × the expected number of people: gather in.
     * on 'top': one stack on the tank for exactly `want` people (分攤死刑): more than that, the extra get hurt too
     */
    | { k: 'stack'; r: number; dmg: number; groups: number; on?: 'top'; want?: number }
    /**
     * pushes everyone away from the boss; where the arena edge is a cliff, off it means down. A prison rock
     * still standing between the boss and a player stops it (崩岩巨像 Hard: hide behind it before breaking it)
     */
    | { k: 'knockback'; dist: number; delay?: number }
    /** one player is shut in rock: break it within `time` or they go down; `hp` per player free to help */
    | { k: 'prison'; hp: number; time: number }
    /**
     * adds: kill them within `time` or each one left explodes for `boom`; together: the first to fall gets up
     * again unless the rest follow within 10 s; attack: what each one does meanwhile
     */
    | {
        k: 'adds';
        kind: FoeKind;
        at: [number, number][];
        hp: number;
        auto: number;
        time: number;
        boom: number;
        together?: boolean | number;
        attack?: AddAttack;
        /** each one starts on a different marked player (not a tank) and stays on them (獵殺人偶) */
        onPlayers?: boolean;
        /** they cannot be killed: their HP stops at 1 */
        floor?: boolean;
        /** walked into the boss's (or its twin's) ring at `pct` of their HP or less, they are absorbed for `dmg` on everyone; above that, `fail` */
        feed?: { pct: number; dmg: number; fail: number };
        /** a cast bar of this name on each for its whole time (召喚機神: a damage check) */
        bar?: string;
      }
    /** the boss leaps (to a point, or 'mark': where 時之鳥 set off, during the last second of the cast); land: a circle where it comes down */
    | { k: 'jump'; to?: [number, number] | 'mark'; land?: { r: number; dmg: number } }
    /** pairs of players tied together: be at least `dist` apart when it ends (寒冰鎖鏈) */
    | { k: 'tether'; pairs: number; dist: number; dmg: number }
    /** towers (`count` for 4 players, scaled): `need` people in each when they go off, or they blow up on everyone */
    | { k: 'tower'; count: number; need: number; r: number; dmg: number; fail: number; ring?: number; exact?: boolean }
    /** exaflares: circles rolling across the arena in lanes, one step every `gap` seconds, every other lane the other way */
    | { k: 'exaflare'; lanes: number; r: number; step: number; gap: number; dmg: number }
    /** line of sight (視線遮蔽): hide behind a pillar; kill: down instead of damage; shatter: a pillar hidden behind breaks */
    | { k: 'los'; dmg: number; kill?: boolean; shatter?: boolean }
    /** freeze check (深度凍結): whoever moves when it ends is frozen for `time`; then circles drop on everyone */
    | { k: 'freeze'; time: number; drop?: { r: number; dmg: number; delay: number } }
    /** protean (八方扇形): a fan from the boss at every player; anyone in someone else's fan is hit twice; again: the same fans once more that many seconds later, unmarked (擴散波) */
    | { k: 'protean'; deg: number; dmg: number; delay?: number; again?: number }
    /** timed bombs: batches going off these many seconds after the cast; each blows up `r` around its holder; pool: and leaves one where it went off */
    | { k: 'bombs'; at: number[]; count: number | 'all'; r: number; dmg: number; self: number; pool?: { r: number; dmg: number; time: number } }
    /** the floor's tiles live in a checkerboard: these patterns one after the other, `gap` apart; tele: warning, s */
    | { k: 'tiles'; patterns: (0 | 1)[]; gap: number; dmg: number; tele: number }
    /** beams from the boss sweeping round `turn` degrees in `time` seconds; 2 beams start on opposite sides */
    | { k: 'sweep'; beams: 1 | 2; deg: number; turn: number; time: number; dmg: number }
    /** numbered marks (序列點名): in order, a strip from the boss through each marked player */
    | { k: 'sequence'; count: number | 'all'; w: number; gap: number; dmg: number }
    /** a circle on each of the top `n` of the enmity list (雙重鑽擊), or the `n` furthest from the boss (far); apart: they must not overlap */
    | { k: 'drill'; n: number; r: number; dmg: number; apart?: boolean; far?: boolean }
    /** the boss charges at marked players in turn (熔核衝撞): a strip from it to the arena edge through each */
    | { k: 'charge'; count: number; w: number; dmg: number; gap: number }
    /** half of the arena each (炎冰交錯): west by the boss, east by its twin, the first chosen at random */
    | { k: 'halves'; gap: number; dmg: number }
    /** colour stacks (雙色分攤): half the party red, half blue, a stack for each; swap: colours flip after that many seconds */
    | { k: 'colorStack'; r: number; dmg: number; swap?: number }
    /**
     * 8 fixed fans from the boss: the 4 cardinal ones and the 4 intercardinal ones going off `gap` apart;
     * towers: two of them in the first set's directions, going off with the second set (step in after the first)
     */
    | { k: 'fans8'; dmg: number; gap: number; towers?: { need: number; r: number; dmg: number; fail: number } }
    /** the twins at once (冰刃迴旋): a circle around the boss, a donut around its twin; swap: they trade places first */
    | { k: 'twinCircles'; r: number; r0: number; dmg: number; swap?: boolean }
    /** a circle under every player `after` seconds after the cast, going off `delay` seconds later: move off your spot */
    | { k: 'drop'; r: number; dmg: number; delay: number; after?: number }
    /** the fans the adds of this fight fired, again from where they stood, in the order they first fired, `gap` apart (鏡中預言) */
    | { k: 'replay'; gap: number; dmg: number }
    /** the boss and its twin (水銀之手) must have HP shares within `gap` of each other when it goes off, or `dmg` hits everyone (痛苦之手) */
    | { k: 'balance'; gap: number; dmg: number }
    /** the boss must end up within `dist` m of its twin's ring (near: 合掌) or at least that far (握拳), or `dmg` hits everyone */
    | { k: 'pose'; near: boolean; dist: number; dmg: number }
    /** pools in three quadrants (cardinal or intercardinal, one left dry at random) for `time` s, `dmg` a second to whoever stands in one (漩渦) */
    | { k: 'quadrants'; dmg: number; time: number }
    /** `count` players (for 4; DPS first, never tanks) drop to half their HP and must be healed to full within `time` s, or they go down (窒息) */
    | { k: 'throttle'; count: number; time: number }
    /** orbs drifting from the edge to where the boss stands as it is cast, a step of `step` m every `gap` s; a step on a player hits them, the last one on the boss hits everyone (栓塞) */
    | { k: 'embolus'; count: number; r: number; step: number; gap: number; dmg: number }
    /** two opposite circles of `r` at `dist` m from the middle (by the edge), going round `turn` degrees clockwise every `gap` s, `steps` times, each shown `tele` s ahead (鷹爆) */
    | { k: 'rotor'; r: number; dist: number; steps: number; gap: number; turn: number; dmg: number; tele: number }
    /** 判決傳遞: two players hold α and β (a mark passes on to whoever its holder touches; α touching β takes both down); two others must hold α and β when `check` s are up (宣判) */
    | { k: 'nisi'; check: number; dot: number }
    /** 壓縮水 on a healer (3 or more share it) and 壓縮雷 on a DPS (exactly 2), going off in turn `gap` s apart, `rounds` each; each passes on to someone else in its stack who has not held it */
    | { k: 'compressed'; rounds: number; gap: number; dmg: number }
    /** the boss leaps onto the furthest player (a circle of r: theirs to take), then a beam `beam.w` m wide from there through the middle lingers `beam.time` s (超級跳躍、啟示光線) */
    | { k: 'superjump'; r: number; dmg: number; beam: { w: number; time: number } }
    /** an ice block rises somewhere for `time` s: a pillar to hide behind (冰塊) */
    | { k: 'iceblock'; time: number }
    /** the caster shields itself: only hits from in front of it wear the shield (`hp`) down; still up after `time` s, `dmg` on everyone (電漿護盾) */
    | { k: 'plasma'; hp: number; time: number; dmg: number }
    /**
     * 時間停止: tied pairs (拘束: end within `bind` m; with 6 or more players also 隔離: at least `apart` m) and
     * one 加重 (any hit downs them); when the cast ends everyone is frozen `freeze` s, then 熾核 (at `at[0]`)
     * strikes the `near[0]` nearest to it and 凍核 (at `at[1]`) the `near[1]` nearest, `dmg` each
     */
    | { k: 'stasis'; bind: number; apart: number; near: [number, number]; dmg: number; freeze: number; at: [[number, number], [number, number]] }
    /**
     * 起源陣: `spheres` players carry 電漿球 (it blows up `sphere.r` round them `sphere.after` s after the
     * cast and leaves a gravity floor; two floors overlapping takes everyone down); the others drop 審判晶石
     * at their feet `crystal.after` s after it (too close to another crystal or to the boss, it shatters);
     * then 時之鳥 flies from the edge to where the boss stood at `bird` m/s: touching every crystal gives the
     * party 時之鑰 (P4's 未來視)
     */
    | {
        k: 'inception';
        spheres: number;
        sphere: { r: number; dmg: number; after: number; pool: { r: number; dmg: number; time: number } };
        crystal: { r: number; after: number };
        bird: number;
      }
    /** 十字聖禮: two strips `w` wide crossing at the boss, one of them along the line to the middle */
    | { k: 'cross'; w: number; dmg: number }
    /**
     * 時隙陣: numbers 1–`steps` over heads; two rifts `dist` m either side of the middle; from `first` s after
     * the cast, every `gap` s the next number steps into the next rift (they take turns, each smaller): an
     * empty one takes everyone down (懺悔); a second step inside 時隙 is that player's end
     */
    | { k: 'wormhole'; steps: number; gap: number; first: number; r: number; dist: number }
    /** 終焉之言: 光之信標 and 暗之信標 `at` m out on opposite sides; `delay` s after the cast half the party is pulled `dist` m towards the light, the rest pushed `dist` m away from the dark */
    | { k: 'beacons'; dist: number; delay: number; at: number }
    /** 靜止命令 (move: false): whoever moves as the cast ends takes `dmg`; 行動命令 (move: true): whoever stands still; then: the opposite that many seconds later */
    | { k: 'order'; move: boolean; dmg: number; then?: number }
    /** 全能審判: the floor in 3 × 3 squares of `cell` m; `rounds` rounds of `per` squares light up now, `gap` s apart, and strike in the same order `delay` s after the cast, unmarked */
    | { k: 'judgment'; rounds: number; per: number; gap: number; delay: number; cell: number; dmg: number }
    /** lasers from `of` points along the north edge, `count` of them at random: each a strip `w` wide straight down the arena */
    | { k: 'lasers'; count: number; of: number; w: number; dmg: number }
    /** 未來視: these are seen now (only by a party holding 時之鑰) and happen `delay` s later, unmarked */
    | { k: 'foresee'; delay: number; mechs: MechDef[] }
    /** 時間牢獄: `count` cages (for 4 players) from the north, clockwise, `dist` m out, `gap` s apart: each needs one player who has not taken a cage yet, or everyone goes down */
    | { k: 'cages'; count: number; gap: number; r: number; dist: number }
    /** another mechanic going off `after` seconds later than the cast ends (its telegraph still shows ahead as usual) */
    | { k: 'later'; after: number; mech: MechDef }
    /** one of these, chosen at random when the cast begins; names: the cast bar's name for each (合掌 / 握拳) */
    | { k: 'either'; of: MechDef[]; names?: string[] }
  );

/** What adds do while they live. */
export type AddAttack =
  /** a fan in front of each add every `every` seconds (the adds take turns) */
  | { k: 'cone'; deg: number; r: number; dmg: number; every: number; first: number }
  /** a strip from the add through a random player; puddle: it leaves a pool on that spot */
  | { k: 'shot'; w: number; dmg: number; every: number; first: number; puddle?: { r: number; dmg: number; time: number } }
  /** a burst of r around the add, which stops to charge it; hit twice within 20 s (以太) is down (排氣) */
  | { k: 'exhaust'; r: number; dmg: number; every: number; first: number };

export interface Entry {
  /** seconds into the phase when the cast starts */
  at: number;
  /** name on the cast bar: the same name always means the same attack (Hard players read it) */
  name: string;
  /** cast time, seconds */
  cast: number;
  mechs: MechDef[];
  /** whose cast bar shows it: the boss (default), its twin, or both */
  by?: 'twin' | 'both';
  /** its telegraphs show only for this many seconds from the start of the cast, then go on hidden: remember them (Hard) */
  memo?: number;
}

export interface Phase {
  name: string;
  /** ends when the boss falls below this share of its HP */
  hpBelow?: number;
  /** ends when the adds it summoned are gone */
  untilAddsGone?: boolean;
  /** ends when the twins merge */
  untilFused?: boolean;
  /** the boss cannot be targeted, hurt or attack during this phase */
  untargetable?: boolean;
  entries: Entry[];
  /** after `at` seconds, carry on from `to`, and keep looping */
  loop?: { at: number; to: number };
  /** where a tank should drag the boss in this phase (computer players); the centre by default */
  home?: [number, number];
}

export interface Twin {
  kind: FoeKind;
  /** where it starts; the boss starts in the middle */
  at: [number, number];
  /** 共鳴: closer than `dist` when checked (every `every` s), both power up 10% a stack */
  resonance?: { dist: number; every: number };
  /** 失衡: HP shares further apart than `gap`, a raid-wide every `every` s */
  imbalance?: { gap: number; every: number; dmg: number };
  /** 合體: both down to `at` of their HP, they merge into `kind`; the first one there takes no more damage */
  fuse?: { at: number; kind: FoeKind };
  /** both must fall: the one left standing this many seconds after the other wipes the party */
  together?: number;
  /** its share of the HP (the rest is the boss's); half by default */
  share?: number;
}

/** One part of a duty fought in turn (the ultimate): its own bosses, timeline and enrage. */
export interface Stage {
  script: BossScript;
  /** this stage's share of the duty's HP; 0 for an intermission */
  hp: number;
  /** an intermission: its boss cannot be hurt, and it moves on after this many seconds */
  time?: number;
  /** its enrage cast ends the fight this many seconds into the stage */
  enrageAt?: number;
}

export interface BossScript {
  kind: FoeKind;
  /** auto attack on the top of the enmity list, every 3 s */
  auto: number;
  /** seconds a ground telegraph shows before it hits */
  tele: number;
  /** attacks drawn without a ground telegraph: the cast name and the boss's pose tell them apart (Hard) */
  hidden?: readonly MechDef['k'][];
  /** where the arena edge is: walls stop a knockback, a cliff lets players fall */
  edge: 'wall' | 'cliff';
  phases: Phase[];
  /** the long cast before the enrage: the fight ends at the enrage time (section 七) */
  enrage: { name: string; cast: number };
  /** a second boss fought alongside (雙子機神): the fight's HP is split between them */
  twin?: Twin;
  /**
   * Hard: an attack that should have been dodged (circles, fans, strips, floors, beams, someone else's
   * aimed attack) takes all of the player's max HP, so only mitigation keeps them up (v0.6: 8,000–9,000
   * was healed through, and two healers never lost anyone to a mechanic)
   */
  lethal?: boolean;
  /** the ultimate (v0.7): stages fought one after another; the fight is won when the last one's bosses fall */
  stages?: Stage[];
  /** where the boss starts (a stage's boss); the middle by default */
  at?: [number, number];
}

/** A shape on the ground (or a marker over a head) that players can see, until it hits. */
export interface Tele {
  id: number;
  shape: Shape;
  color: TeleColor;
  /** follows this player, or whoever is top of the boss's enmity list */
  on?: string;
  /** a fan or strip that turns to point at this player until it goes off */
  aim?: string;
  /** its origin moves with this enemy until it goes off (a charge from wherever the boss stands) */
  from?: string;
  start: number;
  end: number;
  /** text on it, e.g. how many people a stack wants */
  text?: string;
  shown: boolean;
  /** a lingering floor: it hurts all the time it lasts, not only at the end */
  zone?: boolean;
  /** a stack for exactly its count (分攤死刑): nobody else should join */
  exact?: boolean;
  /** a stack that moves on to someone in it afterwards (壓縮水、壓縮雷) */
  pass?: boolean;
  /** only a preview of what is coming (全能審判, 未來視): nothing happens when it ends */
  preview?: boolean;
  /** 時隙陣: the number whose turn this is (on the rift and on the number over the head) */
  soak?: number;
  /** 時間牢獄: a cage, for one player who has not taken one */
  cage?: boolean;
  /** players see it only until this tick, though it still goes off at `end` (an attack to remember) */
  hideAt?: number;
}

/** One cast's mechanics: when all of them are done without a mistake, the Limit Break gauge gains 5%. */
interface Group {
  name: string;
  left: number;
  failed: boolean;
  /** has something to get wrong (a raid-wide does not) */
  scored: boolean;
}

interface Pending {
  at: number;
  group: Group;
  run: () => void;
  tele?: Tele;
}

/** A pool left on the floor: it hurts whoever stands in it, once a second (from a second after it lands). */
interface Puddle {
  tele: Tele;
  /** it starts hurting from this tick: whoever it landed under has a moment to step out */
  armed: number;
  group: Group;
  dmg: number;
  /** who it hit last and when (ticks) */
  hit: Map<string, number>;
  /** who it already counted a mistake for */
  missed: Set<string>;
}

const TOP = '@top';
const DEG = Math.PI / 180;

/**
 * Runs a boss script on a Fight: phases (by HP, by adds, until the twins merge), the timeline of casts
 * and their mechanics, telegraphs, penalties, the Limit Break bonus for clean mechanics, adds and what they
 * do, lingering pools, the twins' rules, the enrage cast. Random choices (who is marked, where rocks fall)
 * come from the fight's seeded generator, so a fight can be replayed.
 */
export class BossBrain {
  phase = -1;
  /** the boss whose death ends the fight (it changes when the twins merge) */
  foe: Foe;
  /** the other twin (雙子機神) while there are two */
  twin: Foe | null = null;
  private phaseStart = 0;
  private next = 0;
  /** ticks the timeline has been pushed back by its loops */
  private shift = 0;
  private pending: Pending[] = [];
  private puddles: Puddle[] = [];
  private seq = 0;
  private enraging = false;
  /** adds summoned in the current phase */
  private adds: Foe[] = [];
  private addsSummoned = false;
  private addsDeadline = 0;
  private addsBoom = 0;
  private together = false;
  private reviveAt = 0;
  private addAttack: AddAttack | null = null;
  /** the current adds are fed to the boss (獵殺人偶) */
  feed: { pct: number; dmg: number; fail: number } | null = null;
  private addNext = new Map<string, number>();
  private addTurn = 0;
  /** players a sweeping beam hit last (they are not hit again by it for a second) */
  private swept = new Map<string, number>();
  /** where the cast being scheduled leaps the boss to (its other mechanics happen from there) */
  private landTo: [number, number] | null = null;
  /** the cast being scheduled hides its telegraphs from this tick on (Entry.memo) */
  private memoAt: number | null = null;
  /** adds that must fall together: how long the rest have once the first falls (ticks) */
  private togetherTicks = sec(10);
  /** each add's first fan, in the order they fired (鏡中預言 fires them again) */
  private echoes: { id: string; shape: Shape }[] = [];
  /** the script being played: the duty's, or the current stage's (the ultimate) */
  script: BossScript;
  /** the ultimate's stages (null for a single boss) */
  private readonly stages: Stage[] | null;
  /** which stage is on (−1 before the first) */
  stageIndex = -1;
  private stageStart = 0;
  /** the duty's HP, shared out between the stages */
  private readonly totalHp: number;
  private won = false;
  /** a twin that must fall with the other one went down at this tick (0: both up) */
  private oneDownAt = 0;
  /** the tick this brain last stepped (the fight steps it itself once its boss is down) */
  stepped = -1;
  /** 判決傳遞 runs until this tick */
  private nisiUntil = 0;
  /** ice blocks standing (冰塊): pillars for line of sight */
  private blocks: Foe[] = [];
  /** 合掌 / 握拳 to come: where the core must be when it goes off (computer tanks drag it there) */
  pose: { near: boolean; dist: number; at: number } | null = null;
  /** 栓塞: where the orbs are heading, until the last of them gets there (keep the boss away) */
  avoid: { x: number; z: number; r: number; until: number } | null = null;
  /** 時之鑰: 時之鳥 touched every crystal (P3): P4's 未來視 shows. Kept from stage to stage */
  timeKey = false;
  /** where 時之鳥 set off from (起源 leaps there) */
  mark: [number, number] | null = null;
  /** 起源陣 under way: the bird, the crystals it has to touch, how many it touched, when it lands */
  bird: { foe: Foe; crystals: Foe[]; total: number; touched: number; from: number; landAt: number } | null = null;
  /** the beacons standing (終焉之言) */
  beacons: Foe[] = [];
  /** 時間停止's images of 熾核 and 凍核 */
  images: Foe[] = [];
  /** scheduling a preview (未來視): its effects do nothing; it shows only when `shown` */
  private previewing: { shown: boolean } | null = null;
  /** scheduling what was foreseen: unmarked */
  private hiding = false;

  constructor(
    private readonly fight: Fight,
    foe: Foe,
    script: BossScript,
    /** the ultimate: start from this stage (offline practice) */
    startStage = 0,
  ) {
    this.foe = foe;
    this.script = script;
    this.totalHp = foe.maxHp;
    this.stages = script.stages?.length ? script.stages : null;
    if (this.stages) {
      this.enterStage(Math.max(0, Math.min(startStage, this.stages.length - 1)), foe);
      return;
    }
    if (script.twin) this.spawnTwin(script.twin, 'twin');
  }

  /** The second boss: its share of the duty's HP comes off the boss's. */
  private spawnTwin(tw: Twin, id: string): void {
    const foe = this.foe;
    const share = tw.share ?? 0.5;
    const total = foe.maxHp;
    const mine = Math.round(total * (1 - share));
    foe.maxHp = foe.hp = mine;
    if (tw.fuse) foe.minHp = Math.round(mine * tw.fuse.at);
    const twin = this.fight.spawnFoe(tw.kind, tw.at[0], tw.at[1], total - mine, { id });
    twin.aloof = true;
    if (tw.fuse) twin.minHp = Math.round(twin.maxHp * tw.fuse.at);
    twin.f = faceTowards(tw.at[0], tw.at[1], 0, 0);
    for (const p of this.fight.players.values()) twin.enmity.set(p.id, 0);
    this.twin = twin;
  }

  /**
   * The ultimate moves on to stage k: whatever was left of the last one goes, its boss comes in with its
   * share of the duty's HP (an intermission's cannot be hurt), the tanks first on its list. `reuse` is the
   * boss the fight made at the start.
   */
  private enterStage(k: number, reuse?: Foe): void {
    const f = this.fight;
    const st = this.stages![k]!;
    this.stageIndex = k;
    this.stageStart = f.tick;
    this.pending = [];
    this.puddles = [];
    this.adds = [];
    this.addsSummoned = false;
    this.addAttack = null;
    this.blocks = [];
    this.pose = null;
    this.avoid = null;
    this.nisiUntil = 0;
    this.oneDownAt = 0;
    this.enraging = false;
    this.twin = null;
    for (const e of f.foes) if (!e.gone && e !== reuse) f.despawn(e);
    for (const q of f.players.values()) q.statuses = q.statuses.filter((x) => !STAGE_MARKS.has(x.id));
    this.script = st.script;
    const hp = Math.max(1, Math.round(this.totalHp * (st.hp || 0.05)));
    let boss = reuse;
    if (boss && boss.kind === st.script.kind) {
      boss.maxHp = boss.hp = hp;
    } else {
      if (boss) f.despawn(boss);
      const [bx, bz] = st.script.at ?? [0, 0];
      boss = f.spawnFoe(st.script.kind, bx, bz, hp, { id: `boss${k}`, auto: st.script.auto });
      for (const p of f.players.values()) boss.enmity.set(p.id, p.role === 'tank' ? RULES.enmityTankStart : 0);
      boss.autoAt = f.tick + sec(3);
    }
    boss.auto = st.script.auto;
    boss.untargetable = st.time !== undefined;
    this.foe = boss;
    if (st.script.twin) {
      this.spawnTwin(st.script.twin, `twin${k}`);
      if (st.time !== undefined) this.twin!.untargetable = true;
    }
    this.bird = null;
    this.beacons = [];
    this.images = [];
    this.phase = -1;
    this.shift = 0;
    this.next = 0;
  }

  /** This stage is over: an intermission's time is up, or its bosses (the twin too when both must fall) are down. */
  private stageDone(): boolean {
    const st = this.stages![this.stageIndex]!;
    if (st.time !== undefined) return this.fight.tick - this.stageStart >= sec(st.time);
    const both = st.script.twin?.together !== undefined;
    return this.foe.hp <= 0 && (!both || !this.twin || this.twin.hp <= 0);
  }

  /** The duty is won: the boss (or, the ultimate, the last stage's bosses) has fallen; two that must fall together, both. */
  cleared(): boolean {
    if (this.stages) return this.won;
    const both = this.script.twin?.together !== undefined && !!this.twin;
    return this.foe.hp <= 0 && (!both || this.twin!.hp <= 0);
  }

  /** Ticks until the enrage lands: the duty's clock, or the current stage's (the ultimate). */
  private enrageLeft(): number {
    const f = this.fight;
    if (!this.stages) return f.enrageTicks - f.fightTicks;
    const at = this.stages[this.stageIndex]?.enrageAt;
    return at === undefined ? Number.MAX_SAFE_INTEGER : this.stageStart + sec(at) - f.tick;
  }

  /** A stage's enrage has gone off (the ultimate): the fight ends. */
  enraged(): boolean {
    return !!this.stages && this.enrageLeft() <= 0;
  }

  /** Seconds into the current stage (the ultimate). */
  get stageTime(): number {
    return (this.fight.tick - this.stageStart) / TICK_RATE_HZ;
  }

  /** The ultimate is played in stages. */
  get staged(): boolean {
    return !!this.stages;
  }

  /** For the HUD: [stage, ticks into it, its enrage in seconds (0: an intermission, which shows its length)]. */
  stageClock(): [number, number, number] {
    const st = this.stages?.[this.stageIndex];
    return [Math.max(0, this.stageIndex), this.fight.tick - this.stageStart, st ? (st.enrageAt ?? 0) : 0];
  }

  get current(): Phase | undefined {
    return this.script.phases[this.phase];
  }

  /** The current adds must fall together (Hard 岩巨兵): computer players keep them even. */
  get addsTogether(): boolean {
    return this.together;
  }

  /** Telegraphs players can see now. */
  visible(): Tele[] {
    const t = this.fight.tick;
    const out: Tele[] = [];
    for (const p of this.pending) if (p.tele?.shown && p.tele.start <= t && p.tele.end >= t && !(p.tele.hideAt !== undefined && t >= p.tele.hideAt)) out.push(p.tele);
    for (const p of this.puddles) out.push(p.tele);
    return out;
  }

  /** All pending hazards, the hidden ones too, and the pools on the floor (for the computer players and the tests); previews are not hazards. */
  hazards(): readonly Tele[] {
    return [...this.pending.flatMap((p) => (p.tele && !p.tele.preview ? [p.tele] : [])), ...this.puddles.map((p) => p.tele)];
  }

  /** Who a following telegraph sits on right now. */
  holder(t: Tele): Fighter | undefined {
    if (!t.on) return undefined;
    if (t.on === TOP) return this.fight.topOf(this.foe) ?? undefined;
    return this.fight.players.get(t.on);
  }

  /**
   * Where a tank should drag a walking boss (computer players): the phase's home, or for the twins'
   * 熾核 the point across the arena from 凍核, far enough that they do not resonate.
   */
  home(foe: Foe): [number, number] {
    const h = this.homeFor(foe);
    const a = this.avoid;
    if (!a || foe !== this.foe || this.fight.tick > a.until) return h;
    const d = Math.hypot(h[0] - a.x, h[1] - a.z);
    if (d >= a.r) return h;
    // 栓塞: out of the way of the orbs, away from where they are heading (towards the middle if it is right there)
    const c = Math.hypot(a.x, a.z);
    const [ux, uz] = d > 0.1 ? [(h[0] - a.x) / d, (h[1] - a.z) / d] : c > 0.1 ? [-a.x / c, -a.z / c] : [0, 1];
    return clampToArena(this.fight.enc.arena, a.x + ux * a.r, a.z + uz * a.r, foe.r);
  }

  private homeFor(foe: Foe): [number, number] {
    const size = this.fight.enc.arena.size;
    const tw = this.twin;
    if (tw && foe === this.foe && this.script.twin?.resonance) {
      const d = Math.hypot(tw.x, tw.z);
      if (d > 1) return [(-tw.x / d) * size * 0.4, (-tw.z / d) * size * 0.4];
      return [0, size * 0.4];
    }
    // 合掌: the core next to its hand; 握拳: across the arena from it
    if (tw && foe === this.foe && this.pose && this.fight.tick <= this.pose.at) {
      const d = Math.hypot(tw.x, tw.z) || 1;
      const [ux, uz] = [tw.x / d, tw.z / d];
      if (this.pose.near) {
        const c = foe.r + tw.r + Math.max(1, this.pose.dist - 3);
        return [tw.x - ux * c, tw.z - uz * c];
      }
      return [-ux * size * 0.6, -uz * size * 0.6];
    }
    return this.current?.home ?? [0, 0];
  }

  // ------------------------------------------------------------------ the clock

  step(): void {
    const f = this.fight;
    if (this.stepped === f.tick) return;
    this.stepped = f.tick;
    if (this.stages && !this.won && this.stageDone()) {
      if (this.stageIndex < this.stages.length - 1) this.enterStage(this.stageIndex + 1);
      else {
        this.won = true;
        return;
      }
    }
    if (this.phase < 0) {
      // a stage's clock starts with its first phase (the first stage's at the pull, not during the countdown)
      this.stageStart = f.tick;
      this.enter(0);
    }
    // a twin that must fall with the other: once one is down, nothing else happens until the other follows
    const half = this.halfDown();
    if (this.foe.hp <= 0 && !half) return;
    // the enrage cast runs over whatever else is going on
    if (!this.enraging && this.enrageLeft() <= sec(this.script.enrage.cast)) {
      this.enraging = true;
      this.cancel();
      const caster = this.foe.hp > 0 ? this.foe : (this.twin ?? this.foe);
      this.castBar(caster, this.script.enrage.name, Math.max(1, this.enrageLeft()), 'enrage');
    }
    if (!this.enraging && !half) {
      this.twinRules();
      this.checkPhase();
      this.timeline();
    }
    this.togetherRule();
    this.track();
    this.resolve();
    this.pools();
    this.addsStep();
    this.marks();
    this.birdStep();
  }

  /** One of two bosses that must fall together is down and the other is not (yet). */
  private halfDown(): boolean {
    const tw = this.twin;
    if (!tw || this.script.twin?.together === undefined) return false;
    return (this.foe.hp <= 0) !== (tw.hp <= 0);
  }

  /** Two bosses that must fall together: the one left standing too long wipes the party. */
  private togetherRule(): void {
    const f = this.fight;
    const rules = this.script.twin;
    if (!rules || rules.together === undefined || !this.twin) return;
    if (!this.halfDown()) {
      this.oneDownAt = 0;
      return;
    }
    if (!this.oneDownAt) {
      this.oneDownAt = f.tick;
      this.cancel();
      const left = this.foe.hp > 0 ? this.foe : this.twin;
      this.castBar(left, '同歸於盡', sec(rules.together), 'enrage');
      f.emit({ k: 'boss', i: left.id, n: '同歸於盡', m: 'raidwide' });
      return;
    }
    if (f.tick - this.oneDownAt >= sec(rules.together)) {
      const left = this.foe.hp > 0 ? this.foe : this.twin;
      this.oneDownAt = f.tick + sec(9999);
      f.emit({ k: 'boss', i: left.id, n: '同歸於盡', m: 'raidwide' });
      f.hitName = '同歸於盡';
      for (const q of f.living()) f.hurt(q, 999_999, left);
      f.hitName = null;
    }
  }

  private enter(k: number): void {
    const f = this.fight;
    this.cancel();
    // the pools of the phase before dry up with it
    this.puddles = [];
    this.phase = k;
    this.phaseStart = f.tick;
    this.next = 0;
    this.shift = 0;
    this.adds = [];
    this.addsSummoned = false;
    this.reviveAt = 0;
    this.addAttack = null;
    const ph = this.current;
    this.foe.untargetable = !!ph?.untargetable;
    if (ph) f.emit({ k: 'phase', i: this.foe.id, n: ph.name, u: ph.untargetable ? 1 : undefined });
  }

  private checkPhase(): void {
    const ph = this.current;
    if (!ph || this.phase >= this.script.phases.length - 1) return;
    const low = ph.hpBelow !== undefined && this.foe.hp / this.foe.maxHp < ph.hpBelow;
    const addsGone = !!ph.untilAddsGone && this.addsSummoned && this.adds.every((a) => a.hp <= 0 || a.gone);
    if (low || addsGone) this.enter(this.phase + 1);
  }

  private timeline(): void {
    const ph = this.current;
    if (!ph) return;
    const t = this.fight.tick - this.phaseStart;
    for (;;) {
      if (this.next < ph.entries.length) {
        const e = ph.entries[this.next]!;
        if (sec(e.at) + this.shift > t) break;
        this.next++;
        this.begin(e);
        continue;
      }
      if (ph.loop && sec(ph.loop.at) + this.shift <= t) {
        this.shift += sec(ph.loop.at) - sec(ph.loop.to);
        this.next = ph.entries.findIndex((e) => e.at >= ph.loop!.to);
        if (this.next < 0) break;
        continue;
      }
      break;
    }
  }

  /** Aimed shapes turn to their player, moving origins follow their enemy. */
  private track(): void {
    const f = this.fight;
    for (const p of this.pending) {
      const tele = p.tele;
      if (!tele || (!tele.aim && !tele.from)) continue;
      const s = tele.shape;
      if (s.k !== 'cone' && s.k !== 'rect') continue;
      if (tele.from) {
        const src = f.foes.find((e) => e.id === tele.from);
        if (src) {
          s.x = src.x;
          s.z = src.z;
        }
      }
      const q = tele.aim ? f.players.get(tele.aim) : undefined;
      if (q && !q.dead && Math.hypot(q.x - s.x, q.z - s.z) > 0.05) s.f = faceTowards(s.x, s.z, q.x, q.z);
    }
  }

  private resolve(): void {
    const t = this.fight.tick;
    const due = this.pending.filter((p) => p.at <= t);
    if (!due.length) return;
    this.pending = this.pending.filter((p) => p.at > t);
    for (const p of due) {
      // damage events carry the move's name for the combat log
      this.fight.hitName = p.group.name;
      p.run();
      this.fight.hitName = null;
      p.group.left--;
      if (p.group.left === 0 && p.group.scored && !p.group.failed) {
        this.fight.lb = Math.min(100, this.fight.lb + RULES.lbClean);
        this.fight.emit({ k: 'clean', n: p.group.name });
      }
    }
  }

  /** Drops whatever was still coming (a phase change or the enrage cuts it short). */
  private cancel(): void {
    this.pending = [];
    for (const e of [this.foe, this.twin]) {
      if (!e) continue;
      e.cast = null;
      e.lockUntil = 0;
    }
  }

  // ------------------------------------------------------------------ casts and mechanics

  private castBar(foe: Foe, name: string, ticks: number, m: NonNullable<Foe['cast']>['m'], target: string | null = null): void {
    const t = this.fight.tick;
    foe.cast = { name, m, start: t, end: t + ticks, target };
    this.fight.emit({ k: 'bcast', i: foe.id, n: name, m, t: target ?? undefined, d: ticks });
  }

  private begin(e: Entry): void {
    const f = this.fight;
    const t0 = f.tick;
    const t1 = t0 + sec(e.cast);
    // a choice with its own cast names (合掌 / 握拳) is made now, so the cast bar can tell
    let name = e.name;
    const mechs = e.mechs.map((m) => {
      if (m.k !== 'either' || !m.names) return m;
      const k = Math.floor(f.random() * m.of.length);
      name = m.names[k] ?? name;
      return m.of[k]!;
    });
    e = { ...e, name, mechs };
    const kinds = e.mechs.map((m) => m.k);
    const m: NonNullable<Foe['cast']>['m'] = kinds.includes('raidwide') ? 'raidwide' : kinds.includes('buster') ? 'buster' : 'mech';
    const buster = e.mechs.find((x) => x.k === 'buster');
    const top = buster ? f.topOf(this.foe) : null;
    if (e.cast > 0) {
      const casters = e.by === 'both' ? [this.foe, this.twin] : e.by === 'twin' ? [this.twin] : [this.foe];
      for (const c of casters) if (c && !c.gone) this.castBar(c, e.name, t1 - t0, m, c === this.foe ? (top?.id ?? null) : null);
    }
    const group: Group = { name, left: 0, failed: false, scored: false };
    const jump = e.mechs.find((x) => x.k === 'jump' && x.to && x.src !== 'twin');
    const to = jump && jump.k === 'jump' ? (jump.to === 'mark' ? (this.mark ?? [0, 0]) : jump.to) : undefined;
    this.landTo = to ? clampToArena(f.enc.arena, to[0], to[1], this.foe.r) : null;
    this.memoAt = e.memo ? t0 + sec(e.memo) : null;
    for (const mech of e.mechs) this.schedule(mech, t0, t1, group, top);
    this.landTo = null;
    this.memoAt = null;
  }

  private add(at: number, group: Group, run: () => void, tele?: Omit<Tele, 'id' | 'end' | 'shown'> & { shown?: boolean }): void {
    group.left++;
    // a preview (未來視) does nothing when it ends; it shows only to a party that can see it
    const preview = this.previewing;
    const p: Pending = { at, group, run: preview ? () => undefined : run };
    if (tele) {
      const shown = (tele.shown ?? true) && (!preview || preview.shown) && !this.hiding;
      p.tele = { ...tele, id: ++this.seq, end: at, shown, hideAt: this.memoAt ?? undefined, preview: tele.preview || !!preview || undefined };
    }
    this.pending.push(p);
  }

  private teleStart(at: number, t0: number): number {
    return Math.max(t0, at - sec(this.script.tele));
  }

  private shown(k: MechDef['k']): boolean {
    return !this.script.hidden?.includes(k);
  }

  /** The mechanic's source: the boss, or its twin. */
  private srcOf(m: MechDef): Foe {
    return m.src === 'twin' && this.twin ? this.twin : this.foe;
  }

  /** The living players by the boss's enmity, highest first. */
  private ranked(): Fighter[] {
    const f = this.fight;
    const v = (q: Fighter) => this.foe.enmity.get(q.id) ?? 0;
    return f.living().sort((a, b) => v(b) - v(a));
  }

  /** How far a strip from (x, z) along f runs before it leaves the arena. */
  private reachEdge(x: number, z: number, fa: number): number {
    const size = this.fight.enc.arena.size;
    const ux = Math.sin(fa);
    const uz = Math.cos(fa);
    if (this.fight.enc.arena.shape === 'square') {
      const tx = ux > 1e-6 ? (size - x) / ux : ux < -1e-6 ? (-size - x) / ux : Infinity;
      const tz = uz > 1e-6 ? (size - z) / uz : uz < -1e-6 ? (-size - z) / uz : Infinity;
      return Math.max(0, Math.min(tx, tz));
    }
    // circle: solve |p + t u| = size
    const b = x * ux + z * uz;
    const c = x * x + z * z - size * size;
    return Math.max(0, -b + Math.sqrt(Math.max(0, b * b - c)));
  }

  private schedule(m: MechDef, t0: number, t1: number, g: Group, top: Fighter | null): void {
    const f = this.fight;
    const boss = this.srcOf(m);
    const size = f.enc.arena.size;
    switch (m.k) {
      case 'raidwide':
        for (let k = 0; k < (m.hits ?? 1); k++) {
          this.add(t1 + sec(m.gap ?? 1.5) * k, g, () => {
            this.bossEvent('raidwide', g.name, undefined, boss);
            for (const q of f.living()) f.hurt(q, m.dmg, boss);
          });
        }
        return;
      case 'buster': {
        const gap = sec(m.gap ?? 4);
        // without a tank the double buster hits once (缺角補正): nobody could take it twice
        const hits = f.roles.tank ? (m.hits ?? 1) : 1;
        const target = m.rank && m.rank > 1 ? this.ranked()[m.rank - 1]?.id : top?.id;
        if (m.rank && m.rank > 1 && !target) return;
        const crack = !m.noCrack;
        this.add(t1, g, () => this.busterHit(target, m.dmg, crack && hits > 1, gap, g.name, boss, m.soak), { shape: { k: 'mark' }, color: 'r', on: target, start: t0 });
        for (let k = 1; k < hits; k++) {
          // the next hit goes to whoever is top then: the other tank should have taken the boss
          this.add(t1 + gap * k, g, () => this.busterHit(undefined, m.dmg, crack && k < hits - 1, gap, g.name, boss), {
            shape: { k: 'mark' },
            color: 'r',
            on: TOP,
            start: t1 + gap * (k - 1) + 1,
          });
        }
        return;
      }
      case 'chariot': {
        const at = t1 + sec(m.delay ?? 0);
        g.scored = true;
        const shape: Shape = { k: 'circle', x: boss.x, z: boss.z, r: m.r };
        this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), { shape, color: 'o', start: this.teleStart(at, t0), shown: this.shown('chariot') });
        return;
      }
      case 'donut': {
        const at = t1 + sec(m.delay ?? 0);
        g.scored = true;
        const shape: Shape = { k: 'donut', x: boss.x, z: boss.z, r0: m.r0, r1: size * 2.2 };
        // a donut after a chariot shows only once the chariot has gone off
        const start = m.delay ? Math.max(t1, this.teleStart(at, t0)) : this.teleStart(at, t0);
        this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), { shape, color: 'o', start, shown: this.shown('donut') });
        return;
      }
      case 'cone': {
        g.scored = true;
        if (m.top) {
          // 噴焰: at the top of the enmity list as the cast begins, turning after them: the tank points it away
          const q = f.topOf(boss) ?? f.living()[0];
          if (!q) return;
          const shape: Shape = { k: 'cone', x: boss.x, z: boss.z, f: faceTowards(boss.x, boss.z, q.x, q.z), r: size * 2, deg: m.deg };
          this.add(t1, g, () => this.aimedHit(shape, q.id, m.dmg, g, boss), { shape, color: 'o', aim: q.id, from: boss.id, start: t0, shown: this.shown('cone') });
          return;
        }
        boss.lockUntil = t1; // it stops turning: the fan points where it faced when the cast began
        const shape: Shape = { k: 'cone', x: boss.x, z: boss.z, f: boss.f, r: size * 2, deg: m.deg };
        this.add(t1, g, () => this.areaHit(shape, m.dmg, g, boss), { shape, color: 'o', start: this.teleStart(t1, t0), shown: this.shown('cone') });
        return;
      }
      case 'rocks': {
        g.scored = true;
        for (let w = 0; w < m.waves; w++) {
          const at = t1 + sec(m.gap) * w;
          for (let k = 0; k < m.count; k++) {
            let x: number;
            let z: number;
            if (w === 0 && k < (m.nearBoss ?? 0)) {
              // right next to the boss: one side of it is no longer safe to wait on
              const a = f.random() * Math.PI * 2;
              const d = boss.r + f.random() * 1.5;
              [x, z] = [boss.x + Math.sin(a) * d, boss.z + Math.cos(a) * d];
            } else {
              const a = f.random() * Math.PI * 2;
              // with a rock next to the boss, the rest of the first wave keeps off the middle: there must be room to wait there
              const min = w === 0 && m.nearBoss ? Math.min(size - 1, boss.r + 6 + m.r) : 0;
              const d = min + Math.sqrt(f.random()) * Math.max(0, size - m.r * 0.5 - min);
              [x, z] = clampToArena(f.enc.arena, Math.sin(a) * d, Math.cos(a) * d, 0);
            }
            const shape: Shape = { k: 'circle', x, z, r: m.r };
            this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), { shape, color: 'o', start: Math.max(t0, at - sec(this.script.tele)), shown: this.shown('rocks') });
          }
        }
        return;
      }
      case 'lines': {
        g.scored = true;
        const th = f.random() * Math.PI;
        const [ux, uz] = [Math.sin(th), Math.cos(th)];
        const [nx, nz] = [uz, -ux];
        const len = size * 2.4;
        m.waves.forEach((offsets, w) => {
          const at = t1 + sec(m.gap) * w;
          for (const off of offsets) {
            const shape: Shape = { k: 'rect', x: nx * off - ux * (len / 2), z: nz * off - uz * (len / 2), f: th, len, w: m.w };
            this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), {
              shape,
              color: 'o',
              start: w === 0 ? this.teleStart(at, t0) : Math.max(t1 + sec(m.gap) * (w - 1), at - sec(this.script.tele)),
              shown: this.shown('lines'),
            });
          }
        });
        return;
      }
      case 'spread': {
        g.scored = true;
        const pool = this.shuffle(f.living());
        const n = m.count === 'all' ? pool.length : Math.min(m.count, pool.length);
        const marked = pool.slice(0, n).map((q) => q.id);
        for (const id of marked) {
          this.add(t1, g, () => this.spreadHit(id, m.r, m.dmg, g, boss), { shape: { k: 'circle', x: 0, z: 0, r: m.r }, color: 'p', on: id, start: t0 });
        }
        return;
      }
      case 'stack': {
        g.scored = true;
        const living = f.living();
        if (m.on === 'top') {
          // 分攤死刑: the tank and exactly want − 1 more
          const holder = top ?? f.topOf(this.foe);
          if (!holder) return;
          const want = Math.min(m.want ?? 2, living.length);
          this.add(t1, g, () => this.stackHit(holder.id, m.r, m.dmg, want, g, boss, true), {
            shape: { k: 'circle', x: 0, z: 0, r: m.r },
            color: 'y',
            on: holder.id,
            start: t0,
            text: String(want),
            exact: true,
          });
          return;
        }
        // healers and DPS first: a stack on a tank drags the boss around
        const pool = [...this.shuffle(living.filter((q) => q.role !== 'tank')), ...this.shuffle(living.filter((q) => q.role === 'tank'))];
        const groups = Math.max(1, Math.min(m.groups, Math.floor(living.length / 2) || 1));
        const want = Math.max(1, Math.ceil(living.length / groups));
        const marked = pool.slice(0, groups).map((q) => q.id);
        for (const id of marked) {
          this.add(t1, g, () => this.stackHit(id, m.r, m.dmg, want, g, boss), {
            shape: { k: 'circle', x: 0, z: 0, r: m.r },
            color: 'y',
            on: id,
            start: t0,
            text: String(want),
          });
        }
        return;
      }
      case 'knockback': {
        g.scored = true;
        const at = t1 + sec(m.delay ?? 0);
        const shape: Shape = { k: 'push', x: boss.x, z: boss.z, dist: m.dist };
        this.add(at, g, () => this.knockAll(m.dist, g, boss), { shape, color: 'w', start: this.teleStart(at, t0) });
        return;
      }
      case 'prison':
        g.scored = true;
        this.add(t1, g, () => this.prison(m.hp, m.time, g));
        return;
      case 'adds':
        this.add(t1, g, () => this.summon(m));
        return;
      case 'jump': {
        const to = m.to === 'mark' ? (this.mark ?? [0, 0]) : m.to;
        if (!to) {
          this.add(t0, g, () => this.bossEvent('jump', g.name, undefined, boss));
          return;
        }
        // the leap takes the last second of the cast (all of it when there is no cast)
        const leap = Math.min(sec(1), Math.max(1, t1 - t0));
        const [x, z] = clampToArena(f.enc.arena, to[0], to[1], boss.r);
        this.add(Math.max(t0, t1 - leap), g, () => {
          f.leapFoe(boss, x, z, leap);
          this.bossEvent('jump', g.name, undefined, boss);
        });
        if (m.land) {
          g.scored = true;
          const shape: Shape = { k: 'circle', x, z, r: m.land.r };
          const at = Math.max(t1, t0 + leap);
          this.add(at, g, () => this.areaHit(shape, m.land!.dmg, g, boss), { shape, color: 'o', start: t0 });
        }
        return;
      }
      case 'tether': {
        g.scored = true;
        const pool = this.shuffle(f.living());
        for (let k = 0; k < m.pairs && pool.length >= 2; k++) {
          const a = pool.shift()!;
          const b = pool.shift()!;
          this.add(
            t1,
            g,
            () => {
              const qa = f.players.get(a.id);
              const qb = f.players.get(b.id);
              if (!qa || !qb || qa.dead || qb.dead) return;
              if (Math.hypot(qa.x - qb.x, qa.z - qb.z) >= m.dist) return;
              for (const q of [qa, qb]) {
                f.hurt(q, m.dmg, boss);
                this.miss(q, g);
              }
            },
            { shape: { k: 'tether', a: a.id, b: b.id, dist: m.dist }, color: 'b', on: a.id, start: t0, text: `拉開 ${m.dist} m` },
          );
        }
        return;
      }
      case 'tower': {
        g.scored = true;
        const living = f.living().length;
        const need = Math.max(1, Math.min(m.need, living));
        const count = Math.max(1, Math.min(Math.round((m.count * living) / 4), Math.floor(living / need)));
        const ring = m.ring ?? size * 0.55;
        const a0 = f.random() * Math.PI * 2;
        for (let k = 0; k < count; k++) {
          const a = a0 + (k * Math.PI * 2) / count;
          const [x, z] = clampToArena(f.enc.arena, Math.sin(a) * ring, Math.cos(a) * ring, m.r);
          const shape: Shape = { k: 'tower', x, z, r: m.r, need };
          this.add(
            t1,
            g,
            () => {
              const ins = f.living().filter((q) => inside(shape, q.x, q.z));
              for (const q of ins) f.hurt(q, m.dmg, boss);
              if (m.exact && ins.length > need) {
                // 點數環: one too many and the ring takes everyone in it
                for (const q of ins) {
                  this.miss(q, g);
                  f.hurt(q, 999_999, boss);
                }
                return;
              }
              if (ins.length >= need) return;
              // a short tower blows up on everyone
              g.failed = true;
              this.bossEvent('raidwide', g.name, undefined, boss);
              for (const q of f.living()) f.hurt(q, m.fail, boss);
            },
            { shape, color: 'y', start: t0, text: m.exact ? `正好 ${need}` : String(need) },
          );
        }
        return;
      }
      case 'exaflare': {
        g.scored = true;
        // lanes across the arena along a random axis, every other one rolling the other way
        const axis = f.random() < 0.5 ? 0 : Math.PI / 2;
        const flip = f.random() < 0.5 ? 1 : -1;
        const [ux, uz] = [Math.sin(axis), Math.cos(axis)];
        const [nx, nz] = [uz, -ux];
        for (let lane = 0; lane < m.lanes; lane++) {
          const off = m.lanes === 1 ? 0 : -size + m.r + ((size - m.r) * 2 * lane) / (m.lanes - 1);
          const dir = (lane % 2 ? -1 : 1) * flip;
          // the lane's length inside the arena
          const half = f.enc.arena.shape === 'square' ? size : Math.sqrt(Math.max(0, size * size - off * off));
          const steps = Math.max(1, Math.ceil((half * 2) / m.step));
          for (let k = 0; k <= steps; k++) {
            const along = -dir * half + dir * k * m.step;
            const shape: Shape = { k: 'circle', x: nx * off + ux * along, z: nz * off + uz * along, r: m.r };
            const at = t1 + sec(m.gap) * k;
            this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), {
              shape,
              color: 'o',
              // the next circle of each lane shows when the one before it goes off
              start: k === 0 ? this.teleStart(at, t0) : t1 + sec(m.gap) * (k - 1),
              shown: this.shown('exaflare'),
            });
          }
        }
        return;
      }
      case 'los': {
        g.scored = true;
        const pillars = this.standing();
        // drawn from where the boss will be when it goes off (it leaps to the middle first)
        const [x, z] = this.landing(boss);
        const shape: Shape = { k: 'los', x, z, pillars: pillars.map((p) => p.p) };
        this.add(
          t1,
          g,
          () => {
            const sx = boss.x;
            const sz = boss.z;
            const live = this.standing();
            const used = new Set<number>();
            for (const q of f.living()) {
              const by = live.find((p) => hidden(sx, sz, [p.p], q.x, q.z));
              if (by) {
                used.add(by.k);
                continue;
              }
              this.miss(q, g);
              if (m.kill) f.kill(q);
              else f.hurt(q, m.dmg, boss);
            }
            this.bossEvent('raidwide', g.name, undefined, boss);
            if (m.shatter) for (const k of used) if (k < 1000) f.pillarsBroken[k] = true;
          },
          { shape, color: 's', start: this.teleStart(t1, t0), shown: this.shown('los') },
        );
        return;
      }
      case 'freeze': {
        g.scored = true;
        this.add(
          t1,
          g,
          () => {
            const recent = f.tick - sec(0.3);
            for (const q of f.living()) {
              // in the air from a jump, or just landed, counts as moving
              const jumped = f.tick - q.jumpAt < RULES.jump + sec(0.3);
              if ((q.movedAt < recent && !jumped) || q.dash) continue;
              f.addStatus(q, { id: 'frozen', src: boss.id, until: f.tick + sec(m.time), v: 0 }, false);
              this.miss(q, g);
            }
            // then something drops on everyone: the frozen cannot step out
            if (m.drop) {
              const drop = m.drop;
              for (const q of f.living()) {
                const shape: Shape = { k: 'circle', x: q.x, z: q.z, r: drop.r };
                this.add(f.tick + sec(drop.delay), g, () => this.areaHit(shape, drop.dmg, g, boss), { shape, color: 'o', start: f.tick });
              }
            }
          },
          { shape: { k: 'stop' }, color: 'c', start: t0 },
        );
        return;
      }
      case 'protean': {
        g.scored = true;
        const at = t1 + sec(m.delay ?? 0);
        for (const q of f.living()) {
          const shape: Shape = { k: 'cone', x: boss.x, z: boss.z, f: faceTowards(boss.x, boss.z, q.x, q.z), r: size * 2.2, deg: m.deg };
          this.add(at, g, () => this.aimedHit(shape, q.id, m.dmg, g, boss), {
            shape,
            color: 'o',
            aim: q.id,
            from: boss.id,
            start: m.delay ? Math.max(t1, this.teleStart(at, t0)) : this.teleStart(at, t0),
            shown: this.shown('protean'),
          });
          // 擴散波: the same fans again where they went, unmarked: step out of your own
          const again = m.again;
          if (again) {
            this.add(at, g, () => {
              const copy: Shape = { ...shape };
              this.add(f.tick + sec(again), g, () => this.areaHit(copy, m.dmg, g, boss), { shape: copy, color: 'o', start: f.tick, shown: false });
            });
          }
        }
        return;
      }
      case 'bombs': {
        g.scored = true;
        const pool = this.shuffle(f.living());
        const n = m.count === 'all' ? pool.length : Math.min(m.count, pool.length);
        for (let k = 0; k < n; k++) {
          const q = pool[k]!;
          const at = t1 + sec(m.at[k % m.at.length]!);
          f.addStatus(q, { id: 'bomb', src: boss.id, until: at, v: 0 }, false);
          this.add(
            at,
            g,
            () => {
              const h = f.players.get(q.id);
              if (!h || h.dead) return;
              this.bossEvent('bomb', g.name, h.id, boss);
              for (const o of f.living()) {
                if (o.id === h.id) f.hurt(o, m.self, boss);
                else if (Math.hypot(o.x - h.x, o.z - h.z) <= m.r) {
                  f.hurt(o, m.dmg, boss);
                  this.miss(o, g);
                }
              }
              if (m.pool) this.puddle(h.x, h.z, m.pool, g.name, boss);
            },
            { shape: { k: 'bomb', r: m.r }, color: 'p', on: q.id, start: t0 },
          );
        }
        return;
      }
      case 'tiles': {
        g.scored = true;
        const n = f.enc.arena.grid ?? 6;
        m.patterns.forEach((p, k) => {
          const at = t1 + sec(m.gap) * k;
          const shape: Shape = { k: 'tiles', size, n, cells: checker(n, p) };
          this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), {
            shape,
            color: 'o',
            start: Math.max(k === 0 ? t0 : t1 + sec(m.gap) * (k - 1), at - sec(m.tele)),
            shown: this.shown('tiles'),
          });
        });
        return;
      }
      case 'sweep': {
        g.scored = true;
        const step = sec(0.4);
        const n = Math.max(2, Math.round(sec(m.time) / step));
        const a0 = f.random() * Math.PI * 2;
        const turn = m.turn * DEG;
        // each step's fan overlaps the next a little, so nothing slips between them
        const deg = Math.max(m.deg, (m.turn / n) * 1.6);
        const [x, z] = [boss.x, boss.z];
        // 2 beams start on opposite sides and turn the same way, each through its own half: follow one round
        const dir = f.random() < 0.5 ? 1 : -1;
        for (let b = 0; b < m.beams; b++) {
          const from = a0 + b * Math.PI;
          for (let k = 0; k <= n; k++) {
            const at = t1 + step * k;
            const shape: Shape = { k: 'cone', x, z, f: from + (dir * turn * k) / n, r: size * 2.2, deg };
            const key = `${g.name}/${b}`;
            this.add(at, g, () => this.sweepHit(shape, key, m.dmg, g, boss), {
              shape,
              color: 'o',
              start: k === 0 ? this.teleStart(at, t0) : Math.max(t0, at - sec(1.2)),
              shown: this.shown('sweep'),
            });
          }
        }
        return;
      }
      case 'sequence': {
        g.scored = true;
        const pool = this.shuffle(f.living());
        const n = m.count === 'all' ? pool.length : Math.min(m.count, pool.length);
        for (let k = 0; k < n; k++) {
          const q = pool[k]!;
          const at = t1 + sec(m.gap) * k;
          this.add(at, g, () => undefined, { shape: { k: 'num', n: k + 1 }, color: 'o', on: q.id, start: t0 });
          const shape: Shape = { k: 'rect', x: boss.x, z: boss.z, f: faceTowards(boss.x, boss.z, q.x, q.z), len: size * 2.6, w: m.w };
          this.add(at, g, () => this.aimedHit(shape, q.id, m.dmg, g, boss), {
            shape,
            color: 'o',
            aim: q.id,
            from: boss.id,
            start: Math.max(t0, at - sec(2)),
            shown: this.shown('sequence'),
          });
        }
        return;
      }
      case 'drill': {
        g.scored = true;
        const marked = m.far
          ? [...f.living()].sort((a, b) => Math.hypot(b.x - boss.x, b.z - boss.z) - Math.hypot(a.x - boss.x, a.z - boss.z)).slice(0, m.n)
          : this.ranked().slice(0, m.n);
        for (const q of marked) {
          this.add(
            t1,
            g,
            () => {
              const h = f.players.get(q.id);
              if (!h || h.dead) return;
              for (const o of f.living()) {
                if (Math.hypot(o.x - h.x, o.z - h.z) > m.r) continue;
                // aimed at the top of the list like a tank buster: half on anyone who is not a tank (the far ones hit everyone alike)
                f.hurt(o, m.far ? m.dmg : m.dmg * (o.role === 'tank' ? 1 : RULES.noTankDamage), boss);
                // the other marked player's circle on top of this one: both got it wrong
                if (o.id !== h.id && (m.apart || !marked.some((x) => x.id === o.id))) this.miss(o, g);
              }
            },
            { shape: { k: 'circle', x: 0, z: 0, r: m.r }, color: 'r', on: q.id, start: t0 },
          );
        }
        return;
      }
      case 'charge': {
        g.scored = true;
        // marked: the others before the tanks
        const living = f.living();
        const pool = [...this.shuffle(living.filter((q) => q.role !== 'tank')), ...this.shuffle(living.filter((q) => q.role === 'tank'))];
        const n = Math.min(m.count, pool.length);
        for (let k = 0; k < n; k++) {
          const q = pool[k]!;
          const at = t1 + sec(m.gap) * k;
          this.add(at, g, () => undefined, { shape: { k: 'num', n: k + 1 }, color: 'r', on: q.id, start: t0 });
          const shape: Shape = { k: 'rect', x: boss.x, z: boss.z, f: faceTowards(boss.x, boss.z, q.x, q.z), len: size * 2.6, w: m.w };
          this.add(
            at,
            g,
            () => {
              // the strip runs from where the boss stands through the player to the edge; the boss charges along it
              shape.x = boss.x;
              shape.z = boss.z;
              const h = f.players.get(q.id);
              if (h && !h.dead && Math.hypot(h.x - boss.x, h.z - boss.z) > 0.05) shape.f = faceTowards(boss.x, boss.z, h.x, h.z);
              const len = Math.max(0, this.reachEdge(boss.x, boss.z, shape.f) - boss.r);
              shape.len = len + boss.r;
              this.aimedHit(shape, q.id, m.dmg, g, boss);
              this.bossEvent('charge', g.name, q.id, boss);
              f.leapFoe(boss, boss.x + Math.sin(shape.f) * len, boss.z + Math.cos(shape.f) * len, sec(0.6));
            },
            { shape, color: 'o', aim: q.id, from: boss.id, start: k === 0 ? t0 : t1 + sec(m.gap) * (k - 1), shown: this.shown('charge') },
          );
        }
        return;
      }
      case 'halves': {
        g.scored = true;
        // the boss burns the west half, the twin freezes the east half; who goes first is random
        const west = { k: 'half', x: 0, z: 0, f: -Math.PI / 2 } as const;
        const east = { k: 'half', x: 0, z: 0, f: Math.PI / 2 } as const;
        const fireFirst = f.random() < 0.5;
        const order: [Shape, TeleColor, Foe][] = [
          [{ ...west }, 'e', this.foe],
          [{ ...east }, 'i', this.twin ?? this.foe],
        ];
        if (!fireFirst) order.reverse();
        this.bossEvent('glow', g.name, undefined, order[0]![2]);
        order.forEach(([shape, color, src], k) => {
          const at = t1 + sec(m.gap) * k;
          this.add(at, g, () => this.areaHit(shape, m.dmg, g, src), {
            shape,
            color,
            start: k === 0 ? this.teleStart(at, t0) : t1,
            shown: this.shown('halves'),
          });
        });
        return;
      }
      case 'colorStack': {
        g.scored = true;
        const pool = this.shuffle(f.living());
        const reds = pool.filter((_, k) => k % 2 === 0);
        const blues = pool.filter((_, k) => k % 2 === 1);
        const until = t1 + sec(1);
        for (const q of reds) f.addStatus(q, { id: 'red', src: boss.id, until, v: 0 }, false);
        for (const q of blues) f.addStatus(q, { id: 'blue', src: boss.id, until, v: 0 }, false);
        if (m.swap) {
          // Hard: every colour flips once during the cast
          this.add(t0 + sec(m.swap), g, () => {
            for (const q of f.living()) {
              const was = q.statuses.find((s) => s.id === 'red' || s.id === 'blue');
              if (!was) continue;
              was.id = was.id === 'red' ? 'blue' : 'red';
            }
            this.bossEvent('swap', g.name, undefined, boss);
          });
        }
        const holders: [Fighter | undefined, 'red' | 'blue', TeleColor][] = [
          [reds.find((q) => q.role !== 'tank') ?? reds[0], 'red', 'e'],
          [blues.find((q) => q.role !== 'tank') ?? blues[0], 'blue', 'i'],
        ];
        const held = holders.flatMap(([h]) => (h ? [h.id] : []));
        for (const [h, colour, tc] of holders) {
          if (!h) continue;
          this.add(t1, g, () => this.colourHit(h.id, colour, held, m.r, m.dmg, g, boss), {
            shape: { k: 'circle', x: 0, z: 0, r: m.r },
            color: tc,
            on: h.id,
            start: t0,
            text: colour === 'red' ? '紅' : '藍',
          });
        }
        return;
      }
      case 'fans8': {
        g.scored = true;
        const [x, z] = [boss.x, boss.z];
        const cardFirst = f.random() < 0.5;
        if (m.towers) {
          // two towers in the first set's directions: wait out the first fans, then step in before the second
          const tw = m.towers;
          const living = f.living().length;
          const need = Math.max(1, Math.min(tw.need, Math.floor(living / 2) || 1));
          const a0 = (cardFirst ? 0 : Math.PI / 4) + (f.random() < 0.5 ? 0 : Math.PI / 2);
          for (let k = 0; k < (living >= 2 ? 2 : 1); k++) {
            const a = a0 + k * Math.PI;
            const [tx, tz] = clampToArena(f.enc.arena, x + Math.sin(a) * 10, z + Math.cos(a) * 10, tw.r);
            const shape: Shape = { k: 'tower', x: tx, z: tz, r: tw.r, need };
            this.add(
              t1 + sec(m.gap),
              g,
              () => {
                const ins = f.living().filter((q) => inside(shape, q.x, q.z));
                for (const q of ins) f.hurt(q, tw.dmg, boss);
                if (ins.length >= need) return;
                g.failed = true;
                this.bossEvent('raidwide', g.name, undefined, boss);
                for (const q of f.living()) f.hurt(q, tw.fail, boss);
              },
              { shape, color: 'y', start: t0, text: String(need) },
            );
          }
        }
        for (let set = 0; set < 2; set++) {
          const cardinal = set === 0 ? cardFirst : !cardFirst;
          const at = t1 + sec(m.gap) * set;
          for (let k = 0; k < 4; k++) {
            const fa = (k * Math.PI) / 2 + (cardinal ? 0 : Math.PI / 4);
            const shape: Shape = { k: 'cone', x, z, f: fa, r: size * 2.2, deg: 45 };
            this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), {
              shape,
              color: cardinal ? 'e' : 'i',
              start: set === 0 ? this.teleStart(at, t0) : t1,
              shown: this.shown('fans8'),
            });
          }
        }
        return;
      }
      case 'balance':
        g.scored = true;
        this.add(t1, g, () => {
          const tw = this.twin;
          if (!tw || tw.gone || tw.hp <= 0 || this.foe.hp <= 0) return;
          if (Math.abs(this.foe.hp / this.foe.maxHp - tw.hp / tw.maxHp) <= m.gap) return;
          g.failed = true;
          this.bossEvent('raidwide', g.name, undefined, boss);
          for (const q of f.living()) f.hurt(q, m.dmg, boss);
        });
        return;
      case 'pose':
        g.scored = true;
        this.pose = { near: m.near, dist: m.dist, at: t1 };
        this.add(
          t1,
          g,
          () => {
            this.pose = null;
            const tw = this.twin;
            if (!tw || tw.gone || tw.hp <= 0) return;
            const d = Math.hypot(this.foe.x - tw.x, this.foe.z - tw.z) - this.foe.r - tw.r;
            if (m.near ? d <= m.dist : d >= m.dist) return;
            g.failed = true;
            this.bossEvent('raidwide', g.name, undefined, boss);
            for (const q of f.living()) f.hurt(q, m.dmg, boss);
          },
          { shape: { k: 'mark' }, color: m.near ? 'y' : 'w', on: TOP, start: t0, text: m.near ? `核心拖到手邊 ${m.dist} m 內` : `核心拖離手 ${m.dist} m 以上` },
        );
        return;
      case 'quadrants': {
        g.scored = true;
        // three quadrants flood (cardinal or intercardinal), one stays dry: the party's new north. Chosen as
        // the cast begins and shown during it
        const base = f.random() < 0.5 ? 0 : Math.PI / 4;
        const dry = Math.floor(f.random() * 4);
        for (let k = 0; k < 4; k++) {
          if (k === dry) continue;
          const a = base + (k * Math.PI) / 2;
          const [x, z] = [Math.sin(a) * size * 0.55, Math.cos(a) * size * 0.55];
          const shape: Shape = { k: 'circle', x, z, r: size * 0.42 };
          this.add(t1, g, () => this.puddle(x, z, { r: size * 0.42, dmg: m.dmg, time: m.time }, g.name, boss), { shape, color: 'p', start: t0 });
        }
        return;
      }
      case 'throttle':
        g.scored = true;
        this.add(t1, g, () => {
          // DPS first: the healer has the healing to do
          const pool = [...this.shuffle(f.living().filter((q) => q.role === 'dps')), ...this.shuffle(f.living().filter((q) => q.role === 'healer'))];
          const check = f.tick + sec(m.time);
          // `count` for 4 players, more for a bigger party
          const n = Math.max(1, Math.round((m.count * f.living().length) / 4));
          for (const q of pool.slice(0, Math.min(n, pool.length))) {
            // down to half (no lower than they already are)
            q.hp = Math.max(1, Math.min(q.hp, Math.round(f.maxHp(q) * 0.5)));
            // it outlives the check by a second (statuses run out before the boss steps); healed to full, it goes at once
            f.addStatus(q, { id: 'throttle', src: boss.id, until: check + sec(1), v: 0 }, false);
            const id = q.id;
            this.add(
              check,
              g,
              () => {
                const h = f.players.get(id);
                if (!h || h.dead || !h.statuses.some((x) => x.id === 'throttle')) return;
                h.statuses = h.statuses.filter((x) => x.id !== 'throttle');
                this.miss(h, g);
                f.kill(h);
              },
              { shape: { k: 'mark' }, color: 'r', on: id, start: f.tick, text: '補滿血' },
            );
          }
        });
        return;
      case 'embolus': {
        g.scored = true;
        const [tx, tz] = [boss.x, boss.z];
        let last_ = t1;
        for (let k = 0; k < m.count; k++) {
          const a = f.random() * Math.PI * 2;
          const [sx, sz] = clampToArena(f.enc.arena, Math.sin(a) * size, Math.cos(a) * size, m.r);
          const n = Math.max(1, Math.ceil(Math.hypot(tx - sx, tz - sz) / m.step));
          for (let j = 1; j <= n; j++) {
            const shape: Shape = { k: 'circle', x: sx + ((tx - sx) * j) / n, z: sz + ((tz - sz) * j) / n, r: m.r };
            const at = t1 + sec(m.gap) * (j - 1);
            const last = j === n;
            if (last) last_ = Math.max(last_, at);
            this.add(
              at,
              g,
              () => {
                this.areaHit(shape, m.dmg, g, boss);
                // the orb reaching the boss where it stood: everyone pays (drag it away)
                const b = this.foe;
                if (last && b.hp > 0 && Math.hypot(b.x - shape.x, b.z - shape.z) <= m.r + b.r) {
                  g.failed = true;
                  this.bossEvent('raidwide', g.name, undefined, boss);
                  for (const q of f.living()) f.hurt(q, 999_999, boss);
                }
              },
              { shape, color: 'o', start: Math.max(t0, at - sec(1.5)) },
            );
          }
        }
        this.avoid = { x: tx, z: tz, r: m.r + boss.r + 3, until: last_ };
        return;
      }
      case 'rotor': {
        g.scored = true;
        const a0 = Math.floor(f.random() * 8) * (Math.PI / 4);
        for (let k = 0; k < m.steps; k++) {
          const at = t1 + sec(m.gap) * k;
          for (const off of [0, Math.PI]) {
            const a = a0 + off - k * m.turn * DEG;
            const shape: Shape = { k: 'circle', x: Math.sin(a) * m.dist, z: Math.cos(a) * m.dist, r: m.r };
            this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), { shape, color: 'o', start: Math.max(t0, at - sec(m.tele)) });
          }
        }
        return;
      }
      case 'nisi':
        g.scored = true;
        this.add(t1, g, () => {
          const living = f.living();
          // the marks go to DPS first, the judgements to two others
          const holders = [...this.shuffle(living.filter((q) => q.role === 'dps')), ...this.shuffle(living.filter((q) => q.role !== 'dps'))].slice(0, 2);
          const rest = this.shuffle(living.filter((q) => !holders.includes(q)));
          const judged = rest.length >= 2 ? rest.slice(0, 2) : holders;
          // the marks outlive 宣判 by a second (statuses run out before the boss steps); 宣判 takes them off
          const check = f.tick + sec(m.check);
          const until = check + sec(1);
          holders.forEach((q, k) => f.addStatus(q, { id: k ? 'nisiB' : 'nisiA', src: boss.id, until, v: m.dot }, false));
          judged.forEach((q, k) => f.addStatus(q, { id: k ? 'decreeB' : 'decreeA', src: boss.id, until, v: 0 }, false));
          this.nisiUntil = check;
          this.add(check, g, () => this.gavel(g, boss));
        });
        return;
      case 'compressed':
        g.scored = true;
        this.add(t1, g, () => {
          const living = f.living();
          const water = this.shuffle(living.filter((q) => q.role === 'healer'))[0] ?? this.shuffle(living.filter((q) => q.role !== 'tank'))[0];
          const bolt = this.shuffle(living.filter((q) => q.role === 'dps' && q !== water))[0] ?? this.shuffle(living.filter((q) => q !== water))[0];
          const until = f.tick + sec(m.gap * m.rounds * 2 + 1);
          if (water) f.addStatus(water, { id: 'water', src: boss.id, until, v: 0 }, false);
          if (bolt) f.addStatus(bolt, { id: 'bolt', src: boss.id, until, v: 0 }, false);
          this.compressRound(true, m.rounds * 2, m, g, boss, until);
        });
        return;
      case 'superjump': {
        g.scored = true;
        // the furthest player as it takes off (the last second of the cast) gets the landing
        this.add(Math.max(t0, t1 - sec(1.5)), g, () => {
          const far = [...f.living()].sort((a, b) => Math.hypot(b.x - boss.x, b.z - boss.z) - Math.hypot(a.x - boss.x, a.z - boss.z))[0];
          if (!far) return;
          const [x, z] = clampToArena(f.enc.arena, far.x, far.z, boss.r);
          f.leapFoe(boss, x, z, sec(1));
          this.bossEvent('jump', g.name, far.id, boss);
          const land: Shape = { k: 'circle', x, z, r: m.r };
          this.add(f.tick + sec(1), g, () => this.aimedHit(land, far.id, m.dmg, g, boss), { shape: land, color: 'o', start: f.tick });
          // 啟示光線: then a wide beam from where it landed through the middle, shown 3 s ahead, lingering
          const fb = Math.hypot(x, z) > 0.5 ? faceTowards(x, z, 0, 0) : boss.f;
          const beam: Shape = { k: 'rect', x, z, f: fb, len: this.reachEdge(x, z, fb), w: m.beam.w };
          this.add(f.tick + sec(3), g, () => this.zone(beam, 999_999, m.beam.time, '啟示光線', 0), { shape: beam, color: 'o', start: f.tick });
        });
        return;
      }
      case 'iceblock':
        this.add(t1, g, () => {
          const a = f.random() * Math.PI * 2;
          const b = f.spawnFoe('iceblock', Math.sin(a) * size * 0.35, Math.cos(a) * size * 0.35, 1, {});
          b.untargetable = true;
          b.aloof = true;
          this.blocks.push(b);
          this.add(f.tick + sec(m.time), g, () => {
            f.despawn(b);
            this.blocks = this.blocks.filter((x) => x !== b);
          });
        });
        return;
      case 'plasma':
        g.scored = true;
        this.add(t1, g, () => {
          if (boss.hp <= 0 || boss.gone) return;
          // it turns to face the middle and holds still behind its shield
          boss.f = faceTowards(boss.x, boss.z, 0, 0);
          boss.lockUntil = f.tick + sec(m.time);
          boss.statuses = boss.statuses.filter((x) => x.id !== 'plasma');
          // it outlives the check by a second (statuses run out before the boss steps); the check takes it off
          boss.statuses.push({ id: 'plasma', src: boss.id, until: f.tick + sec(m.time + 1), v: Math.round(m.hp * f.hpScale) });
          // the cast bar and the shield on its HP bar say it all
          this.add(f.tick + sec(m.time), g, () => {
            if (!boss.statuses.some((x) => x.id === 'plasma') || boss.hp <= 0) return;
            boss.statuses = boss.statuses.filter((x) => x.id !== 'plasma');
            g.failed = true;
            this.bossEvent('raidwide', g.name, undefined, boss);
            for (const q of f.living()) f.hurt(q, m.dmg, boss);
          });
        });
        return;
      case 'stasis': {
        g.scored = true;
        const [ea, fa] = m.at;
        // who is tied to whom, and who must not be hurt (加重: not a tank, they take the double hit)
        const living = f.living();
        const heavy = this.shuffle(living.filter((q) => q.role !== 'tank'))[0] ?? living[0];
        const rest = this.shuffle(living.filter((q) => q !== heavy));
        const bind = rest.length >= 2 ? [rest[0]!, rest[1]!] : null;
        const apart = living.length >= 6 && rest.length >= 4 ? [rest[2]!, rest[3]!] : null;
        const end = t1 + sec(m.freeze + 1);
        this.add(t0, g, () => {
          // 熾核 and 凍核 come back as images where they will strike from
          this.images = (
            [
              ['ember', ea],
              ['frost', fa],
            ] as const
          ).map(([kind, [x, z]]) => {
            const e = f.spawnFoe(kind, x, z, 1, {});
            e.untargetable = true;
            e.aloof = true;
            e.f = faceTowards(x, z, 0, 0);
            return e;
          });
          if (heavy) f.addStatus(heavy, { id: 'heavy', src: boss.id, until: end, v: 0 }, false);
          for (const q of bind ?? []) f.addStatus(q, { id: 'bound', src: boss.id, until: end, v: 0 }, false);
          for (const q of apart ?? []) f.addStatus(q, { id: 'apart', src: boss.id, until: end, v: 0 }, false);
        });
        // a negative distance on a tether: they must end up within it (拘束)
        if (bind) this.add(t1, g, () => undefined, { shape: { k: 'tether', a: bind[0].id, b: bind[1].id, dist: -m.bind }, color: 'b', on: bind[0].id, start: t0 });
        if (apart) this.add(t1, g, () => undefined, { shape: { k: 'tether', a: apart[0].id, b: apart[1].id, dist: m.apart }, color: 'b', on: apart[0].id, start: t0 });
        this.add(t1, g, () => {
          // time stops: nobody moves
          for (const q of f.living()) f.addStatus(q, { id: 'frozen', src: boss.id, until: f.tick + sec(m.freeze), v: 0 }, false);
          const check = (pair: Fighter[] | null, ok: (d: number) => boolean) => {
            if (!pair) return;
            const [a, b] = pair.map((q) => f.players.get(q.id));
            if (!a || !b || a.dead || b.dead || ok(Math.hypot(a.x - b.x, a.z - b.z))) return;
            for (const q of [a, b]) {
              this.miss(q, g);
              f.kill(q);
            }
          };
          check(bind, (d) => d <= m.bind);
          check(apart, (d) => d >= m.apart);
        }, { shape: { k: 'stop' }, color: 'c', start: t0 });
        // then the images strike the nearest to each of them
        this.add(t1 + sec(0.8), g, () => {
          this.images.forEach((img, k) => {
            const n = m.near[k] ?? 0;
            const near = [...f.living()].sort((a, b) => Math.hypot(a.x - img.x, a.z - img.z) - Math.hypot(b.x - img.x, b.z - img.z)).slice(0, n);
            for (const q of near) {
              this.bossEvent('charge', g.name, q.id, img);
              f.hurt(q, m.dmg, img);
            }
          });
        });
        this.add(t1 + sec(m.freeze), g, () => {
          for (const e of this.images) f.despawn(e);
          this.images = [];
        });
        return;
      }
      case 'inception': {
        g.scored = true;
        const a = f.random() * Math.PI * 2;
        const [ex, ez] = [Math.sin(a) * (size - 2), Math.cos(a) * (size - 2)];
        const [tx, tz] = [boss.x, boss.z];
        this.mark = [ex, ez];
        const living = f.living();
        // the tanks carry spheres first (they hold the boss: a crystal at their feet would shatter by it), then DPS
        const rank = (q: Fighter) => (q.role === 'tank' ? 0 : q.role === 'dps' ? 1 : 2);
        const order = this.shuffle([...living]).sort((a, b) => rank(a) - rank(b));
        const carriers = order.slice(0, Math.min(m.spheres, Math.max(0, living.length - 1)));
        const droppers = living.filter((q) => !carriers.includes(q));
        const drop = t1 + sec(m.crystal.after);
        const fly = drop + sec(0.5);
        const flight = sec(Math.hypot(tx - ex, tz - ez) / m.bird);
        const blast = t1 + sec(m.sphere.after);
        this.add(t0, g, () => {
          const bird = f.spawnFoe('bird', ex, ez, 1, {});
          bird.untargetable = true;
          bird.aloof = true;
          bird.f = faceTowards(ex, ez, tx, tz);
          this.bird = { foe: bird, crystals: [], total: 0, touched: 0, from: fly, landAt: fly + flight };
          for (const q of carriers) f.addStatus(q, { id: 'sphere', src: boss.id, until: blast + sec(1), v: 0 }, false);
        });
        // the way it will fly: drop the crystals on it
        this.add(fly + flight, g, () => undefined, { shape: { k: 'path', x0: ex, z0: ez, x1: tx, z1: tz }, color: 'w', start: t0 });
        // 審判晶石 where each of the others stands
        this.add(drop, g, () => {
          const b = this.bird;
          if (!b) return;
          for (const q of droppers) {
            const h = f.players.get(q.id);
            if (!h || h.dead) continue;
            b.total++;
            const c = f.spawnFoe('crystal', h.x, h.z, 1, {});
            c.untargetable = true;
            c.aloof = true;
            // too close to another crystal or to the boss: it shatters at once
            const crowded =
              b.crystals.some((o) => !o.gone && Math.hypot(o.x - c.x, o.z - c.z) < m.crystal.r * 2) ||
              f.foes.some((o) => o.boss && !o.gone && o.hp > 0 && Math.hypot(o.x - c.x, o.z - c.z) < o.r + m.crystal.r);
            if (crowded) {
              f.emit({ k: 'boss', i: c.id, n: '晶石碎裂', m: 'key' });
              f.despawn(c);
              for (const o of b.crystals) if (!o.gone && Math.hypot(o.x - c.x, o.z - c.z) < m.crystal.r * 2) f.despawn(o);
            } else b.crystals.push(c);
          }
        });
        this.add(fly, g, () => {
          if (this.bird) f.leapFoe(this.bird.foe, tx, tz, flight);
        });
        // 電漿球: a blast round each carrier, a gravity floor left where it went off
        const floors: { x: number; z: number }[] = [];
        for (const q of carriers) {
          this.add(
            blast,
            g,
            () => {
              const h = f.players.get(q.id);
              if (!h || h.dead) return;
              for (const o of f.living()) {
                if (Math.hypot(o.x - h.x, o.z - h.z) > m.sphere.r) continue;
                f.hurt(o, o === h ? m.sphere.dmg : this.dodgeDmg(o, m.sphere.dmg), boss);
                if (o !== h) this.miss(o, g);
              }
              floors.push({ x: h.x, z: h.z });
              // it bites from 2 s on: time for the carrier to walk out of it
              this.zone({ k: 'circle', x: h.x, z: h.z, r: m.sphere.pool.r }, m.sphere.pool.dmg, m.sphere.pool.time, '重力地面', 2);
            },
            { shape: { k: 'circle', x: 0, z: 0, r: m.sphere.r }, color: 'p', on: q.id, start: t0 },
          );
        }
        this.add(blast, g, () => {
          const touch = floors.some((p, i) => floors.some((o, j) => j > i && Math.hypot(p.x - o.x, p.z - o.z) < m.sphere.pool.r * 2));
          if (!touch) return;
          g.failed = true;
          f.emit({ k: 'boss', i: boss.id, n: '重力崩塌', m: 'raidwide' });
          f.hitName = '重力崩塌';
          for (const q of f.living()) f.hurt(q, 999_999, boss);
        });
        return;
      }
      case 'cross': {
        g.scored = true;
        const [bx, bz] = this.landing(boss);
        const fa = Math.hypot(bx, bz) > 0.5 ? faceTowards(bx, bz, 0, 0) : boss.f;
        const len = size * 2.2;
        for (const d of [fa, fa + Math.PI / 2]) {
          const shape: Shape = { k: 'rect', x: bx - Math.sin(d) * len, z: bz - Math.cos(d) * len, f: d, len: len * 2, w: m.w };
          this.add(t1, g, () => this.areaHit(shape, m.dmg, g, boss), { shape, color: 'o', start: this.teleStart(t1, t0) });
        }
        return;
      }
      case 'wormhole': {
        g.scored = true;
        const living = this.shuffle(f.living());
        const n = Math.min(m.steps, living.length);
        const a0 = f.random() * Math.PI;
        const rifts: [number, number][] = [
          [Math.sin(a0) * m.dist, Math.cos(a0) * m.dist],
          [-Math.sin(a0) * m.dist, -Math.cos(a0) * m.dist],
        ];
        for (let k = 0; k < n; k++) {
          const q = living[k]!;
          const at = t1 + sec(m.first + m.gap * k);
          this.add(at, g, () => undefined, { shape: { k: 'num', n: k + 1 }, color: 'c', on: q.id, start: t0, soak: k + 1 });
          const [x, z] = rifts[k % 2]!;
          const shape: Shape = { k: 'circle', x, z, r: Math.max(1.5, m.r - 0.4 * k) };
          this.add(
            at,
            g,
            () => {
              const ins = f.living().filter((p) => inside(shape, p.x, p.z));
              if (!ins.length) {
                // nobody stepped in: 懺悔
                g.failed = true;
                f.emit({ k: 'boss', i: boss.id, n: '懺悔', m: 'raidwide' });
                f.hitName = '懺悔';
                for (const p of f.living()) f.hurt(p, 999_999, boss);
                return;
              }
              for (const p of ins) {
                if (p.statuses.some((s) => s.id === 'warp')) {
                  this.miss(p, g);
                  f.kill(p);
                  continue;
                }
                f.hurt(p, 2000, boss);
                f.addStatus(p, { id: 'warp', src: boss.id, until: f.tick + sec(m.gap * 2.5), v: 0 }, false);
              }
            },
            { shape, color: 'c', start: Math.max(t0, at - sec(m.gap)), text: String(k + 1), soak: k + 1 },
          );
        }
        return;
      }
      case 'beacons': {
        g.scored = true;
        const a = f.random() * Math.PI * 2;
        const light: [number, number] = [Math.sin(a) * m.at, Math.cos(a) * m.at];
        const dark: [number, number] = [-light[0], -light[1]];
        const at = t1 + sec(m.delay);
        const pool = this.shuffle(f.living());
        const half = Math.ceil(pool.length / 2);
        const pulled = new Set(pool.slice(0, half).map((q) => q.id));
        this.add(t0, g, () => {
          this.beacons = [
            ['lightBeacon', light],
            ['darkBeacon', dark],
          ].map(([kind, [x, z]]) => {
            const b = f.spawnFoe(kind as FoeKind, x as number, z as number, 1, {});
            b.untargetable = true;
            b.aloof = true;
            return b;
          });
          for (const q of pool) f.addStatus(q, { id: pulled.has(q.id) ? 'lightPull' : 'darkPush', src: boss.id, until: at + sec(1), v: 0 }, false);
        });
        this.add(at, g, () => {
          for (const q of f.living()) {
            const pull = q.statuses.some((s) => s.id === 'lightPull');
            if (!pull && !q.statuses.some((s) => s.id === 'darkPush')) continue;
            q.statuses = q.statuses.filter((s) => s.id !== 'lightPull' && s.id !== 'darkPush');
            const [x, z] = beaconMove(q.x, q.z, pull, light, dark, m.dist);
            const [cx, cz] = clampToArena(f.enc.arena, x, z);
            f.knock(q, cx, cz, sec(0.4), false);
          }
        });
        this.add(at + sec(1.5), g, () => {
          for (const b of this.beacons) f.despawn(b);
          this.beacons = [];
        });
        return;
      }
      case 'order':
        g.scored = true;
        // the second order is always the other one
        if (m.then) this.schedule({ k: 'order', move: !m.move, dmg: m.dmg }, t1, t1 + sec(m.then), g, top);
        this.add(
          t1,
          g,
          () => {
            const recent = f.tick - sec(0.3);
            for (const q of f.living()) {
              // in the air from a jump, or just landed, counts as moving
              const moving = q.movedAt >= recent || f.tick - q.jumpAt < RULES.jump + sec(0.3) || !!q.dash;
              if (moving === m.move) continue;
              this.miss(q, g);
              f.hurt(q, this.dodgeDmg(q, m.dmg), boss);
            }
          },
          { shape: { k: m.move ? 'go' : 'stop' }, color: 'c', start: t0 },
        );
        return;
      case 'judgment': {
        g.scored = true;
        const square = (c: number): Shape => {
          const cx = ((c % 3) - 1) * m.cell;
          const cz = (Math.floor(c / 3) - 1) * m.cell;
          return { k: 'rect', x: cx - m.cell / 2, z: cz, f: Math.PI / 2, len: m.cell, w: m.cell };
        };
        for (let k = 0; k < m.rounds; k++) {
          const cells = this.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, m.per);
          // seen now, one round after another
          const s0 = t0 + sec(m.gap) * k;
          for (const c of cells) this.add(s0 + sec(m.gap), g, () => undefined, { shape: square(c), color: 'o', start: s0, preview: true });
          // struck later in the same order, unmarked
          const at = t1 + sec(m.delay + m.gap * k);
          for (const c of cells) {
            const shape = square(c);
            this.add(at, g, () => this.areaHit(shape, m.dmg, g, boss), { shape, color: 'o', start: at - sec(m.gap), shown: false });
          }
        }
        return;
      }
      case 'lasers': {
        g.scored = true;
        const lanes = this.shuffle([...Array(m.of).keys()]).slice(0, m.count);
        for (const j of lanes) {
          const x = -size + (2 * size * (j + 0.5)) / m.of;
          const shape: Shape = { k: 'rect', x, z: -size, f: 0, len: size * 2, w: m.w };
          this.add(t1, g, () => this.areaHit(shape, m.dmg, g, boss), { shape, color: 'o', start: this.teleStart(t1, t0) });
        }
        return;
      }
      case 'foresee': {
        // the same draws for what is seen now and what happens later
        const state = f.rngState();
        this.previewing = { shown: this.timeKey };
        for (const x of m.mechs) this.schedule(x, t0, t1, g, top);
        this.previewing = null;
        f.setRngState(state);
        this.hiding = true;
        for (const x of m.mechs) this.schedule(x, t0 + sec(m.delay), t1 + sec(m.delay), g, top);
        this.hiding = false;
        return;
      }
      case 'cages': {
        g.scored = true;
        const n = Math.max(1, Math.round((m.count * f.living().length) / 4));
        for (let k = 0; k < n; k++) {
          const a = Math.PI - (k * 2 * Math.PI) / n; // from the north, clockwise
          const shape: Shape = { k: 'tower', x: Math.sin(a) * m.dist, z: Math.cos(a) * m.dist, r: m.r, need: 1 };
          const at = t1 + sec(m.gap) * k;
          this.add(
            at,
            g,
            () => {
              const fresh = f.living().filter((q) => inside(shape, q.x, q.z) && !q.statuses.some((s) => s.id === 'jailed'));
              for (const q of fresh) f.addStatus(q, { id: 'jailed', src: boss.id, until: f.tick + sec(m.gap * n + 5), v: 0 }, false);
              if (fresh.length) return;
              g.failed = true;
              this.bossEvent('raidwide', g.name, undefined, boss);
              for (const q of f.living()) f.hurt(q, 999_999, boss);
            },
            { shape, color: 'y', start: t0, cage: true },
          );
        }
        return;
      }
      case 'later':
        this.schedule(m.mech, t0, t1 + sec(m.after), g, top);
        return;
      case 'either':
        if (m.of.length) this.schedule(m.of[Math.floor(f.random() * m.of.length)]!, t0, t1, g, top);
        return;
      case 'drop': {
        g.scored = true;
        // where everyone stands `after` seconds past the cast: whoever stays put is hit
        this.add(t1 + sec(m.after ?? 0), g, () => {
          for (const q of f.living()) {
            const shape: Shape = { k: 'circle', x: q.x, z: q.z, r: m.r };
            this.add(f.tick + sec(m.delay), g, () => this.areaHit(shape, m.dmg, g, boss), { shape, color: 'o', start: f.tick });
          }
        });
        return;
      }
      case 'replay': {
        g.scored = true;
        // remembered, not shown: the fans the adds fired, in the order they first fired
        this.echoes.forEach((e, k) => {
          const at = t1 + sec(m.gap) * k;
          this.add(at, g, () => this.areaHit(e.shape, m.dmg, g, boss), { shape: e.shape, color: 'o', start: t0, shown: false });
        });
        return;
      }
      case 'twinCircles': {
        g.scored = true;
        const tw = this.twin;
        if (!tw) return;
        let [cx, cz] = [this.foe.x, this.foe.z];
        let [dx, dz] = [tw.x, tw.z];
        let start = this.teleStart(t1, t0);
        if (m.swap) {
          // they trade places first; the circles show once they have landed
          [cx, cz, dx, dz] = [dx, dz, cx, cz];
          const leap = sec(1.2);
          this.add(t0 + sec(0.5), g, () => {
            f.leapFoe(this.foe, cx, cz, leap);
            f.leapFoe(tw, dx, dz, leap);
            this.bossEvent('jump', g.name, undefined, this.foe);
            this.bossEvent('jump', g.name, undefined, tw);
          });
          start = Math.max(start, t0 + sec(0.5) + leap);
        }
        const out: Shape = { k: 'circle', x: cx, z: cz, r: m.r };
        const ring: Shape = { k: 'donut', x: dx, z: dz, r0: m.r0, r1: size * 2.4 };
        this.add(t1, g, () => this.areaHit(out, m.dmg, g, this.foe), { shape: out, color: 'e', start, shown: this.shown('twinCircles') });
        this.add(t1, g, () => this.areaHit(ring, m.dmg, g, tw), { shape: ring, color: 'i', start, shown: this.shown('twinCircles') });
        return;
      }
    }
  }

  /** Where a boss will stand once a leap of this cast has landed (or where it is). */
  private landing(boss: Foe): [number, number] {
    if (this.landTo && boss === this.foe) return this.landTo;
    const d = boss.dash;
    return d ? [d.x1, d.z1] : [boss.x, boss.z];
  }

  /** The arena's pillars still standing, with their index. */
  /** 宣判: whoever was told to hold α (β) must hold it now, or the whole party goes down; the marks go. */
  private gavel(g: Group, src: Foe): void {
    const f = this.fight;
    const wrong = f.living().some(
      (q) =>
        (q.statuses.some((x) => x.id === 'decreeA') && !q.statuses.some((x) => x.id === 'nisiA')) ||
        (q.statuses.some((x) => x.id === 'decreeB') && !q.statuses.some((x) => x.id === 'nisiB')),
    );
    for (const q of f.players.values()) q.statuses = q.statuses.filter((x) => !['nisiA', 'nisiB', 'decreeA', 'decreeB', 'nisiCd'].includes(x.id));
    this.nisiUntil = 0;
    if (!wrong) return;
    g.failed = true;
    this.bossEvent('raidwide', g.name, undefined, src);
    for (const q of f.living()) f.hurt(q, 999_999, src);
  }

  /**
   * Every tick: 窒息 goes from whoever has been healed to full; 判決傳遞 while it runs: a mark passes to the
   * first player its holder touches who holds none (and has not just passed one on); α touching β takes both down.
   */
  private marks(): void {
    const f = this.fight;
    for (const q of f.living()) {
      if (q.hp >= f.maxHp(q) - 1 && q.statuses.some((x) => x.id === 'throttle')) q.statuses = q.statuses.filter((x) => x.id !== 'throttle');
    }
    if (f.tick >= this.nisiUntil) return;
    const living = f.living();
    const markOf = (q: Fighter) => q.statuses.find((x) => x.id === 'nisiA' || x.id === 'nisiB');
    for (const a of living) {
      const ma = markOf(a);
      if (!ma || a.dead) continue;
      for (const b of living) {
        if (a === b || b.dead || Math.hypot(a.x - b.x, a.z - b.z) > CONTACT) continue;
        const mb = markOf(b);
        if (mb && mb.id !== ma.id) {
          f.emit({ k: 'boss', i: this.foe.id, n: '判決衝突', m: 'raidwide' });
          f.hitName = '判決衝突';
          f.kill(a);
          f.kill(b);
          f.hitName = null;
          break;
        }
        // someone just raised (where they fell) cannot help where they stand: it does not pass to them
        if (mb || b.statuses.some((x) => x.id === 'nisiCd' || x.id === 'risen')) continue;
        a.statuses = a.statuses.filter((x) => x !== ma);
        f.addStatus(b, { id: ma.id, src: ma.src, until: ma.until, v: ma.v }, false);
        f.addStatus(a, { id: 'nisiCd', src: ma.src, until: f.tick + sec(10), v: 0 }, false);
        break;
      }
    }
  }

  /**
   * One round of 壓縮水 (water: a stack for 3 or more) or 壓縮雷 (bolt: exactly 2), on whoever holds it now;
   * then it passes to someone else in the stack who has not held it and does not hold the other one,
   * and the next round (the other element) is scheduled.
   */
  private compressRound(water: boolean, left: number, m: Extract<MechDef, { k: 'compressed' }>, g: Group, src: Foe, until: number): void {
    const f = this.fight;
    if (left <= 0) return;
    const id = water ? 'water' : 'bolt';
    const holder = f.living().find((q) => q.statuses.some((x) => x.id === id));
    const at = f.tick + sec(m.gap);
    if (!holder) {
      this.add(at, g, () => this.compressRound(!water, left - 1, m, g, src, until));
      return;
    }
    const r = water ? 4 : 3;
    const want = water ? Math.min(3, f.living().length) : 2;
    this.add(
      at,
      g,
      () => {
        const h = f.players.get(holder.id);
        if (h && !h.dead && h.statuses.some((x) => x.id === id)) {
          const ins = f.living().filter((q) => Math.hypot(q.x - h.x, q.z - h.z) <= r);
          this.stackHit(h.id, r, m.dmg, want, g, src, !water);
          // it moves on: the nearest in the stack who has not held this one and does not hold the other
          const down = water ? 'waterDown' : 'boltDown';
          const other = water ? 'bolt' : 'water';
          // nobody who can take it in the stack: it jumps to the nearest who can, wherever they stand
          const can = (q: Fighter) => q !== h && !q.statuses.some((x) => x.id === down || x.id === other);
          const near = (a: Fighter, b: Fighter) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z);
          const next = ins.filter(can).sort(near)[0] ?? f.living().filter(can).sort(near)[0];
          h.statuses = h.statuses.filter((x) => x.id !== id);
          f.addStatus(h, { id: down, src: src.id, until, v: 0 }, false);
          if (next && left > 2) f.addStatus(next, { id, src: src.id, until, v: 0 }, false);
        }
        this.compressRound(!water, left - 1, m, g, src, until);
      },
      { shape: { k: 'circle', x: 0, z: 0, r }, color: 'y', on: holder.id, start: f.tick, text: String(want), exact: !water, pass: true },
    );
  }

  /** 時之鳥 in flight: it takes each crystal it touches; landing with all of them, the party gets 時之鑰. */
  private birdStep(): void {
    const f = this.fight;
    const b = this.bird;
    if (!b || f.tick < b.from) return;
    for (const c of b.crystals) {
      if (c.gone || Math.hypot(c.x - b.foe.x, c.z - b.foe.z) > c.r + b.foe.r) continue;
      b.touched++;
      f.despawn(c);
      b.foe.statuses = b.foe.statuses.filter((s) => s.id !== 'gilded');
      b.foe.statuses.push({ id: 'gilded', src: b.foe.id, until: -1, v: b.touched });
    }
    if (f.tick < b.landAt) return;
    const golden = b.total > 0 && b.touched >= b.total;
    if (golden && !this.timeKey) {
      this.timeKey = true;
      for (const q of f.players.values()) if (!q.statuses.some((s) => s.id === 'timeKey')) q.statuses.push({ id: 'timeKey', src: b.foe.id, until: -1, v: 0 });
    }
    f.emit({ k: 'boss', i: b.foe.id, n: golden ? '時之鑰' : '時之鳥落空', m: 'key' });
    for (const c of b.crystals) if (!c.gone) f.despawn(c);
    f.despawn(b.foe);
    this.bird = null;
  }

  /** A lingering area of any shape (a pool, a beam) that hurts `dmg` a second to whoever stands in it. */
  private zone(shape: Shape, dmg: number, time: number, name: string, armed = 1): void {
    const f = this.fight;
    const tele: Tele = { id: ++this.seq, shape, color: 'r', start: f.tick, end: f.tick + sec(time), shown: true, zone: true };
    this.puddles.push({ tele, armed: f.tick + sec(armed), group: { name, left: 0, failed: false, scored: true }, dmg, hit: new Map(), missed: new Set() });
  }

  private standing(): { k: number; p: Pillar }[] {
    const f = this.fight;
    const fixed = (f.enc.arena.pillars ?? []).map((p, k) => ({ k, p })).filter(({ k }) => !f.pillarsBroken[k]);
    // ice blocks (冰塊) hide players too; they never shatter (k past the arena's pillars)
    const ice = this.blocks.filter((b) => !b.gone).map((b, j) => ({ k: 1000 + j, p: { x: b.x, z: b.z, r: b.r } }));
    return [...fixed, ...ice];
  }

  /** Ice blocks standing now (冰塊), for the line-of-sight telegraphs. */
  get extraPillars(): Pillar[] {
    return this.blocks.filter((b) => !b.gone).map((b) => ({ x: b.x, z: b.z, r: b.r }));
  }

  private bossEvent(m: Extract<FightEvent, { k: 'boss' }>['m'], n: string, t?: string, src: Foe = this.foe): void {
    this.fight.emit({ k: 'boss', i: src.id, n, m, t });
  }

  private shuffle<T>(list: T[]): T[] {
    const f = this.fight;
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(f.random() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    return list;
  }

  // ------------------------------------------------------------------ resolving

  private busterHit(target: string | undefined, dmg: number, crack: boolean, gap: number, name: string, src: Foe, soak?: number): void {
    const f = this.fight;
    const q = target ? f.players.get(target) : (f.topOf(this.foe) ?? undefined);
    if (!q || q.dead) return;
    this.bossEvent('buster', name, q.id, src);
    if (soak) {
      // 流體揮擊: a second one inside 水抗降低 takes everything; only an invulnerability (or 死戰) keeps them up
      const soaked = q.statuses.some((x) => x.id === 'waterDown');
      f.hurt(q, soaked ? 999_999 : dmg * (q.role === 'tank' ? 1 : RULES.noTankDamage), src);
      if (!q.dead) {
        q.statuses = q.statuses.filter((x) => x.id !== 'waterDown');
        f.addStatus(q, { id: 'waterDown', src: src.id, until: f.tick + sec(soak), v: 0 }, false);
      }
      return;
    }
    // a tank buster on someone who is not a tank (no tank in the party, or the second of the list) hits half
    f.hurt(q, dmg * (q.role === 'tank' ? 1 : RULES.noTankDamage), src);
    if (crack && !q.dead) {
      // with two tanks the crack outlasts the next hit (swap!); with one it ends just before it
      const dur = f.roles.tank >= 2 ? sec(20) : Math.max(1, gap - sec(0.5));
      f.addStatus(q, { id: 'crack', src: src.id, until: f.tick + dur, v: 0 }, false);
    }
  }

  /** What standing in an attack that should have been dodged costs: on Hard (`lethal`), all of the max HP. */
  private dodgeDmg(q: Fighter, dmg: number): number {
    return this.script.lethal ? Math.max(dmg, this.fight.maxHp(q)) : dmg;
  }

  /** Everyone inside takes the hit and counts a mistake. */
  private areaHit(shape: Shape, dmg: number, g: Group, src: Foe): void {
    const f = this.fight;
    for (const q of f.living()) {
      if (!inside(shape, q.x, q.z) || q.statuses.some((s) => s.id === 'airborne')) continue;
      f.hurt(q, this.dodgeDmg(q, dmg), src);
      this.miss(q, g);
    }
  }

  /** A fan or strip aimed at one player: they take it as planned, anyone else in it got it wrong. */
  private aimedHit(shape: Shape, target: string, dmg: number, g: Group, src: Foe): void {
    const f = this.fight;
    for (const q of f.living()) {
      if (!inside(shape, q.x, q.z) || q.statuses.some((s) => s.id === 'airborne')) continue;
      f.hurt(q, q.id === target ? dmg : this.dodgeDmg(q, dmg), src);
      if (q.id !== target) this.miss(q, g);
    }
  }

  /** A step of a sweeping beam: a player it already caught a moment ago is not caught again. */
  private sweepHit(shape: Shape, key: string, dmg: number, g: Group, src: Foe): void {
    const f = this.fight;
    for (const q of f.living()) {
      if (!inside(shape, q.x, q.z)) continue;
      const k = `${key}/${q.id}`;
      if (f.tick - (this.swept.get(k) ?? -999) < sec(1)) continue;
      this.swept.set(k, f.tick);
      f.hurt(q, this.dodgeDmg(q, dmg), src);
      this.miss(q, g);
    }
  }

  private spreadHit(id: string, r: number, dmg: number, g: Group, src: Foe): void {
    const f = this.fight;
    const holder = f.players.get(id);
    if (!holder || holder.dead) return;
    for (const q of f.living()) {
      if (Math.hypot(q.x - holder.x, q.z - holder.z) > r) continue;
      f.hurt(q, dmg, src);
      // the marked player's own circle is expected; anyone else in it (marked or not) got it wrong
      if (q.id !== id) this.miss(q, g);
    }
  }

  /** exact: a stack for exactly `want` (分攤死刑): the extra people in it get hurt and count a mistake too. */
  private stackHit(id: string, r: number, dmg: number, want: number, g: Group, src: Foe, exact = false): void {
    const f = this.fight;
    const holder = f.players.get(id);
    if (!holder || holder.dead) return;
    const ins = f.living().filter((q) => Math.hypot(q.x - holder.x, q.z - holder.z) <= r);
    const each = (dmg * want) / Math.max(1, ins.length);
    for (const q of ins) f.hurt(q, each, src);
    if (ins.length < want) for (const q of ins) this.miss(q, g);
    if (exact && ins.length > want) for (const q of ins) if (q.id !== id && q.role !== 'tank') this.miss(q, g);
  }

  /**
   * A colour stack: its own colour shares it (the holders stay with their own stack, whatever their colour
   * turned into); the other colour in it takes double and got it wrong.
   */
  private colourHit(id: string, colour: 'red' | 'blue', holders: string[], r: number, dmg: number, g: Group, src: Foe): void {
    const f = this.fight;
    const holder = f.players.get(id);
    if (!holder || holder.dead) return;
    const has = (q: Fighter) => q.id === id || (!holders.includes(q.id) && q.statuses.some((s) => s.id === colour));
    const want = Math.max(1, f.living().filter(has).length);
    const ins = f.living().filter((q) => Math.hypot(q.x - holder.x, q.z - holder.z) <= r);
    const same = ins.filter(has);
    const each = (dmg * want) / Math.max(1, same.length);
    for (const q of same) f.hurt(q, each, src);
    if (same.length < want) for (const q of same) this.miss(q, g);
    for (const q of ins) {
      if (same.includes(q)) continue;
      f.hurt(q, dmg * 2, src);
      this.miss(q, g);
    }
  }

  private knockAll(dist: number, g: Group, boss: Foe): void {
    const f = this.fight;
    const lim = f.enc.arena.size - RULES.playerRadius;
    const rocks = f.foes.filter((e) => e.kind === 'prison' && e.hp > 0 && !e.gone);
    for (const q of f.living()) {
      if (q.statuses.some((s) => s.id === 'airborne' || STATUS_STUN.has(s.id))) continue;
      if (rocks.some((r) => sheltered(boss, r, q.x, q.z))) continue;
      let dx = q.x - boss.x;
      let dz = q.z - boss.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) [dx, dz] = [Math.sin(boss.f), Math.cos(boss.f)];
      else [dx, dz] = [dx / d, dz / d];
      const x1 = q.x + dx * dist;
      const z1 = q.z + dz * dist;
      const out = f.enc.arena.shape === 'square' ? Math.max(Math.abs(x1), Math.abs(z1)) > lim : Math.hypot(x1, z1) > lim;
      if (out && this.script.edge === 'cliff') {
        f.knock(q, x1, z1, sec(0.5), true);
        this.miss(q, g);
      } else {
        const [cx, cz] = clampToArena(f.enc.arena, x1, z1);
        f.knock(q, cx, cz, sec(0.5), false);
      }
    }
  }

  private prison(hp: number, time: number, g: Group): void {
    const f = this.fight;
    const pool = f.living();
    const pick = this.shuffle(pool.filter((q) => q.role !== 'tank'))[0] ?? this.shuffle(pool)[0];
    if (!pick) return;
    // as hard as the help it can get: the others who are not tanks (or the tank, when nobody else is left)
    const helpers = Math.max(1, pool.filter((q) => q.id !== pick.id && q.role !== 'tank').length);
    const rock = f.spawnFoe('prison', pick.x, pick.z, Math.round(hp * helpers), { owner: pick.id });
    f.addStatus(pick, { id: 'stun', src: rock.id, until: f.tick + sec(time), v: 0 }, false);
    this.bossEvent('prison', g.name, pick.id);
    // checked when time is up: the rock still standing crushes the player inside
    const at = f.tick + sec(time);
    this.pending.push({
      at,
      group: g,
      run: () => {
        if (rock.hp > 0 && !rock.gone) {
          f.despawn(rock);
          const q = f.players.get(pick.id);
          if (q && !q.dead) {
            this.miss(q, g);
            f.kill(q);
          }
        }
      },
    });
    g.left++;
  }

  private summon(m: Extract<MechDef, { k: 'adds' }>): void {
    const f = this.fight;
    this.addsSummoned = true;
    this.adds = m.at.map(([x, z]) => {
      const a = f.spawnFoe(m.kind, x, z, Math.round(m.hp * f.hpScale), { auto: m.auto });
      a.f = faceTowards(x, z, 0, 0);
      if (m.floor) a.minHp = 1;
      return a;
    });
    this.feed = m.feed ?? null;
    if (m.onPlayers) {
      // each one on a different player (not a tank first), for good: they walk after them
      const marked = [...this.shuffle(f.living().filter((q) => q.role !== 'tank')), ...this.shuffle(f.living().filter((q) => q.role === 'tank'))];
      this.adds.forEach((a, k) => {
        const q = marked[k % Math.max(1, marked.length)];
        if (q) a.enmity.set(q.id, 1e9);
      });
    }
    this.addsDeadline = f.tick + sec(m.time);
    // 召喚機神: each shows how long it has before it blows up (a damage check)
    if (m.bar) for (const a of this.adds) a.cast = { name: m.bar, m: 'enrage', start: f.tick, end: this.addsDeadline, target: null };
    this.addsBoom = m.boom;
    this.together = !!m.together;
    this.togetherTicks = sec(typeof m.together === 'number' ? m.together : 10);
    this.addAttack = m.attack ?? null;
    this.addNext.clear();
    this.addTurn = 0;
    this.echoes = [];
    if (m.attack) {
      // the adds take turns: spread their first attacks over one period (on Hard in a random order, worth remembering)
      const order = f.hard ? this.shuffle(this.adds) : this.adds;
      order.forEach((a, k) => this.addNext.set(a.id, f.tick + sec(m.attack!.first + (m.attack!.every * k) / order.length)));
    }
    // what kind of adds, for the hint the clients show (獵殺人偶 are not to be killed)
    this.bossEvent('adds', m.feed ? '獵殺人偶' : '');
  }

  /** The adds' timer, what they do, and the Hard rule that they fall together. */
  private addsStep(): void {
    const f = this.fight;
    if (!this.adds.length) return;
    const alive = this.adds.filter((a) => a.hp > 0 && !a.gone);
    if (!alive.length) return;
    // 獵殺人偶: walked into the boss (or its twin) low enough, it is absorbed; too healthy, it overloads
    if (this.feed) {
      for (const a of alive) {
        const into = [this.foe, this.twin].find((b) => b && !b.gone && b.hp > 0 && Math.hypot(b.x - a.x, b.z - a.z) <= b.r + a.r);
        if (!into) continue;
        const ok = a.hp / a.maxHp <= this.feed.pct;
        f.emit({ k: 'boss', i: into.id, n: ok ? '回收' : '過載', m: 'raidwide' });
        f.hitName = ok ? '回收' : '過載';
        for (const q of f.living()) f.hurt(q, ok ? this.feed.dmg : this.feed.fail, into);
        f.hitName = null;
        a.hp = 0;
        f.despawn(a);
      }
    }
    if (f.tick >= this.addsDeadline) {
      for (const a of alive) {
        this.fight.emit({ k: 'boss', i: a.id, n: '自爆', m: 'raidwide' });
        f.hitName = '自爆';
        for (const q of f.living()) f.hurt(q, this.addsBoom, a);
        f.hitName = null;
        a.hp = 0;
        f.despawn(a);
      }
      return;
    }
    if (this.addAttack) for (const a of alive) this.addStrike(a, this.addAttack);
    if (this.together) {
      const dead = this.adds.filter((a) => a.hp <= 0);
      if (dead.length && !this.reviveAt) this.reviveAt = f.tick + this.togetherTicks;
      if (this.reviveAt && f.tick >= this.reviveAt) {
        this.reviveAt = 0;
        for (const a of dead) {
          if (a.gone) continue;
          a.hp = Math.round(a.maxHp * 0.5);
          f.emit({ k: 'boss', i: a.id, n: '再起', m: 'revive' });
        }
      }
    }
  }

  /** An add's own attack when its turn comes: a fan in front of it, or a shot at someone. */
  private addStrike(a: Foe, atk: AddAttack): void {
    const f = this.fight;
    const due = this.addNext.get(a.id);
    if (due === undefined || f.tick < due) return;
    // a small party is not shot at more often each than a party of 4 (點名數不超過人數)
    this.addNext.set(a.id, f.tick + sec(atk.every * Math.max(1, 4 / Math.max(1, f.living().length))));
    const size = f.enc.arena.size;
    const hit = f.tick + sec(atk.k === 'cone' ? this.script.tele : 3);
    if (atk.k === 'exhaust') {
      // it stops to charge a burst around itself: hit a second time within 20 s (以太) is down
      const g: Group = { name: '排氣', left: 0, failed: false, scored: true };
      a.lockUntil = hit;
      a.cast = { name: '排氣', m: 'mech', start: f.tick, end: hit, target: null };
      const shape: Shape = { k: 'circle', x: a.x, z: a.z, r: atk.r };
      this.add(
        hit,
        g,
        () => {
          if (a.hp <= 0 || a.gone) return;
          for (const q of f.living()) {
            if (!inside(shape, q.x, q.z)) continue;
            this.miss(q, g);
            if (q.statuses.some((x) => x.id === 'aether')) f.kill(q);
            else {
              f.hurt(q, atk.dmg, a);
              f.addStatus(q, { id: 'aether', src: a.id, until: f.tick + sec(20), v: 0 }, false);
            }
          }
        },
        { shape, color: 'o', start: f.tick },
      );
      return;
    }
    if (atk.k === 'cone') {
      const g: Group = { name: `${a.name}光束`, left: 0, failed: false, scored: true };
      const shape: Shape = { k: 'cone', x: a.x, z: a.z, f: a.f, r: atk.r, deg: atk.deg };
      if (!this.echoes.some((e) => e.id === a.id)) this.echoes.push({ id: a.id, shape });
      this.add(hit, g, () => (a.hp > 0 && !a.gone ? this.areaHit(shape, atk.dmg, g, a) : undefined), { shape, color: 'o', start: f.tick });
      return;
    }
    const living = f.living();
    if (!living.length) return;
    const q = living[(this.addTurn++ * 7 + Math.floor(f.random() * living.length)) % living.length]!;
    const g: Group = { name: `${a.name}射擊`, left: 0, failed: false, scored: true };
    const shape: Shape = { k: 'rect', x: a.x, z: a.z, f: faceTowards(a.x, a.z, q.x, q.z), len: size * 2.6, w: atk.w };
    this.add(
      hit,
      g,
      () => {
        if (a.hp <= 0 || a.gone) return;
        this.aimedHit(shape, q.id, atk.dmg, g, a);
        const h = f.players.get(q.id);
        if (atk.puddle && h && !h.dead) this.puddle(h.x, h.z, atk.puddle, g.name, a);
      },
      { shape, color: 'o', aim: q.id, from: a.id, start: f.tick },
    );
  }

  /** Leaves a pool that hurts whoever stands in it, once a second, for `time` seconds. */
  private puddle(x: number, z: number, p: { r: number; dmg: number; time: number }, name: string, src: Foe): void {
    const f = this.fight;
    const tele: Tele = { id: ++this.seq, shape: { k: 'circle', x, z, r: p.r }, color: 'p', start: f.tick, end: f.tick + sec(p.time), shown: true, zone: true };
    this.puddles.push({ tele, armed: f.tick + sec(1), group: { name, left: 0, failed: false, scored: true }, dmg: p.dmg, hit: new Map(), missed: new Set() });
    void src;
  }

  private pools(): void {
    const f = this.fight;
    if (!this.puddles.length) return;
    this.puddles = this.puddles.filter((p) => p.tele.end > f.tick);
    for (const p of this.puddles) {
      if (f.tick < p.armed) continue;
      for (const q of f.living()) {
        if (!inside(p.tele.shape, q.x, q.z)) continue;
        if (f.tick - (p.hit.get(q.id) ?? -999) < sec(1)) continue;
        p.hit.set(q.id, f.tick);
        f.hitName = p.group.name;
        f.hurt(q, p.dmg, null);
        f.hitName = null;
        if (!p.missed.has(q.id)) {
          p.missed.add(q.id);
          f.fail(q, p.group.name);
        }
      }
    }
  }

  // ------------------------------------------------------------------ 雙子機神

  /** 共鳴, 失衡 and 合體: the rules of fighting two bosses at once. */
  private twinRules(): void {
    const f = this.fight;
    const tw = this.twin;
    const rules = this.script.twin;
    if (!tw || !rules) return;
    const a = this.foe;
    const since = f.tick - this.phaseStart;
    // 共鳴: too close when checked, both power up
    if (rules.resonance && since > 0 && since % sec(rules.resonance.every) === 0 && Math.hypot(a.x - tw.x, a.z - tw.z) < rules.resonance.dist) {
      for (const e of [a, tw]) {
        const old = e.statuses.find((s) => s.id === 'resonance');
        if (old) old.v++;
        else e.statuses.push({ id: 'resonance', src: e.id, until: -1, v: 1 });
      }
      f.emit({ k: 'boss', i: a.id, n: '共鳴', m: 'resonance' });
    }
    // 失衡: one much healthier than the other
    const gap = Math.abs(a.hp / a.maxHp - tw.hp / tw.maxHp);
    if (rules.imbalance && since > 0 && since % sec(rules.imbalance.every) === 0 && gap > rules.imbalance.gap) {
      const src = a.hp / a.maxHp > tw.hp / tw.maxHp ? a : tw;
      f.emit({ k: 'boss', i: src.id, n: '失衡', m: 'raidwide' });
      f.hitName = '失衡';
      for (const q of f.living()) f.hurt(q, rules.imbalance!.dmg, src);
      f.hitName = null;
    }
    // the first one down to the threshold waits, unhurt; both there: they merge
    for (const e of [a, tw]) {
      if (e.minHp !== undefined && e.hp <= e.minHp && !e.statuses.some((s) => s.id === 'sealed')) e.statuses.push({ id: 'sealed', src: e.id, until: -1, v: 0 });
    }
    if (rules.fuse && a.minHp !== undefined && tw.minHp !== undefined && a.hp <= a.minHp && tw.hp <= tw.minHp) this.fuse(rules);
  }

  private fuse(rules: Twin): void {
    const f = this.fight;
    const a = this.foe;
    const tw = this.twin!;
    const hp = a.hp + tw.hp;
    const [x, z] = [(a.x + tw.x) / 2, (a.z + tw.z) / 2];
    a.minHp = undefined;
    tw.minHp = undefined;
    f.despawn(a);
    f.despawn(tw);
    const merged = f.spawnFoe(rules.fuse!.kind, x, z, hp, { id: 'fused', auto: this.script.auto });
    for (const [id, v] of a.enmity) merged.enmity.set(id, v);
    this.foe = merged;
    this.twin = null;
    f.emit({ k: 'boss', i: merged.id, n: '合體', m: 'fuse' });
    const next = this.script.phases.findIndex((p, k) => k > this.phase && !p.untilFused);
    this.enter(next < 0 ? this.phase : next);
  }

  /** A mistake: the penalty, the count, and no Limit Break bonus for this mechanic. */
  private miss(q: Fighter, g: Group): void {
    g.failed = true;
    this.fight.fail(q, g.name);
  }
}

/** What a stage of the ultimate leaves on players goes when the next one starts. */
const STAGE_MARKS = new Set(['throttle', 'aether', 'nisiA', 'nisiB', 'decreeA', 'decreeB', 'nisiCd', 'water', 'bolt', 'waterDown', 'boltDown']);

/** Within this distance (metres) two players touch, and a judgement mark passes on (判決傳遞). */
export const CONTACT = 1;

/** Statuses that hold a player in place (a prison, a freeze): no knockback moves them. */
const STATUS_STUN = new Set(['stun', 'frozen']);

/** A prison rock stands between the boss and (x, z), close enough to the line to stop a knockback. */
export function sheltered(boss: { x: number; z: number }, rock: { x: number; z: number; r: number }, x: number, z: number): boolean {
  const dx = x - boss.x;
  const dz = z - boss.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return false;
  const along = ((rock.x - boss.x) * dx + (rock.z - boss.z) * dz) / len;
  if (along <= 0 || along >= len) return false;
  const off = Math.abs((rock.x - boss.x) * dz - (rock.z - boss.z) * dx) / len;
  return off <= rock.r + 0.4;
}

/** Where 終焉之言 sends a player standing at (x, z): pulled `dist` m towards the light (no further than it), or pushed `dist` m away from the dark. */
export function beaconMove(x: number, z: number, pull: boolean, light: [number, number], dark: [number, number], dist: number): [number, number] {
  if (pull) {
    const d = Math.hypot(light[0] - x, light[1] - z);
    if (d < 0.01) return [x, z];
    const k = Math.min(dist, d) / d;
    return [x + (light[0] - x) * k, z + (light[1] - z) * k];
  }
  const d = Math.hypot(x - dark[0], z - dark[1]);
  if (d < 0.01) return [x + dist, z];
  return [x + ((x - dark[0]) / d) * dist, z + ((z - dark[1]) / d) * dist];
}
