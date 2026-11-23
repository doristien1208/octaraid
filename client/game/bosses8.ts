import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FoeKind } from '../../shared/bosses/foes';
import type { SnapStatus } from '../../shared/protocol';
import { STATUS_IDS } from '../../shared/status';
import { Figure } from './bosses7';
import { ball, box, cone, cyl, disc, gem, mesh, ring } from './models';

/**
 * The foes of 時律機神殿's P3 and P4 (v0.8), built in code like those in bosses7.ts (section 八): 時律機神, the
 * clockwork deity of P3, and 時律機神・終式, the form it takes for P4; 時之鳥, the clockwork bird that turns gold
 * on the 審判晶石 it touches; and the light and dark beacons of 終焉之言. Models of our own design; they face +z.
 */

/** How long a deity keeps a move's pose after its cast ends, seconds (as the hand's 合掌 and 握拳 in bosses7). */
const HOLD = 1.5;
/** How high the deities float: the bottom of their rig above the floor, metres. */
const HOVER = 0.45;
/** The cold tint of 時間停止 and the grey a deity fades to while it cannot be targeted. */
const COLD = new THREE.Color('#d2eaff');
const GHOST = new THREE.Color('#8a90a6');
/** The bird's brass, and the gold it turns as it touches the crystals. */
const BRASS = new THREE.Color('#b8893a');
const BRASS_DEEP = new THREE.Color('#7a5a26');
const GOLD = new THREE.Color('#ffd451');
const GOLD_DEEP = new THREE.Color('#e9a92c');
/** 金色 in a snapshot's status rows: its v is how many crystals the bird has touched. */
const GILDED = STATUS_IDS.indexOf('gilded');
/** The beacons' orb height and how tall their beam stands, metres. */
const ORB = 2.5;
const BEAM = 6.5;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** 0 → 1, eased at both ends */
function smooth(v: number): number {
  const k = clamp01(v);
  return k * k * (3 - 2 * k);
}

/** 0 → 1 with a small overshoot at the end: what pops into view */
function popUp(v: number): number {
  const u = clamp01(v) - 1;
  return 1 + 2.7 * u * u * u + 1.7 * u * u;
}

/** v eased towards `to` at `rate` per second */
const toward = (v: number, to: number, rate: number, dt: number): number => v + (to - v) * Math.min(1, dt * rate);

/** the shortest turn from angle a to angle b, radians */
const turnTo = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Sets o's rotation and hands o back. */
function turned<T extends THREE.Object3D>(o: T, x: number, y = 0, z = 0): T {
  o.rotation.set(x, y, z);
  return o;
}

/** Sets o's scale and hands o back. */
function sized<T extends THREE.Object3D>(o: T, x: number, y = x, z = x): T {
  o.scale.set(x, y, z);
  return o;
}

/** Direction k of n spread evenly round a sphere: bursts that look scattered but are the same every time. */
function spray(k: number, n: number, out: THREE.Vector3): THREE.Vector3 {
  const y = 1 - ((k + 0.5) / n) * 2;
  const r = Math.sqrt(1 - y * y);
  const a = k * 2.39996;
  return out.set(Math.cos(a) * r, y, Math.sin(a) * r);
}

const euler = new THREE.Euler();
const quat = new THREE.Quaternion();

/** Where merged() puts a shape: at (x, y, z), turned (z first, then x, then y: tilted in place, then turned round) and sized. */
function place(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  quat.setFromEuler(euler.set(rx, ry, rz, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), quat, new THREE.Vector3(sx, sy, sz));
}

/** Shapes placed by their matrices, merged into one geometry: one draw call. `own`: the shapes were made for this and go. */
function merged(parts: readonly (readonly [THREE.BufferGeometry, THREE.Matrix4])[], own = false): THREE.BufferGeometry {
  const list = parts.map(([g, m]) => (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m));
  const out = mergeGeometries(list);
  for (const g of list) g.dispose();
  if (own) for (const [g] of parts) g.dispose();
  return out;
}

/** Writes each vertex's light (white × shade(x, y, z)) as a colour attribute; with `alpha`, white with that alpha. */
function shaded<T extends THREE.BufferGeometry>(g: T, shade: (x: number, y: number, z: number) => number, alpha = false): T {
  const p = g.getAttribute('position');
  const n = alpha ? 4 : 3;
  const c = new Float32Array(p.count * n);
  for (let i = 0; i < p.count; i++) {
    const k = clamp01(shade(p.getX(i), p.getY(i), p.getZ(i)));
    if (alpha) {
      c.fill(1, i * 4, i * 4 + 3);
      c[i * 4 + 3] = k;
    } else c.fill(k, i * 3, i * 3 + 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, n));
  return g;
}

/** A flat disc of light in the xy plane, brightest in the middle and gone at its rim. */
const softDisc = (r: number, alpha = false): THREE.BufferGeometry =>
  shaded(new THREE.RingGeometry(0, r, 40, 6), (x, y) => (1 - (x * x + y * y) / (r * r)) ** 2, alpha);

/** An open tube of light `h` tall standing on y = 0; its light at each height is shade(height / h). */
function softTube(r: number, h: number, shade: (k: number) => number, alpha = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, 24, 12, true);
  g.translate(0, h / 2, 0);
  return shaded(g, (_x, y) => shade(y / h), alpha);
}

/** A flat bar of light in the xy plane, w wide and h long (centred), fading to its long edges and by ends(0 … 1 up it). */
const softBar = (w: number, h: number, ends: (k: number) => number = () => 1): THREE.BufferGeometry =>
  shaded(new THREE.PlaneGeometry(w, h, 2, 10), (x, y) => (1 - Math.abs(x) / (w / 2)) * ends(y / h + 0.5));

/** The light of a beam, a cross or a ray: full along its middle, fading to both ends. */
const endsFade = (k: number): number => smooth(k * 6) * smooth((1 - k) * 3);

/**
 * Patches a basic material to fade where its surface turns edge-on to the camera (soft beams and balls of
 * light); fadeMiddle the other way round (bright at the edges, like a bubble). One function each, so each
 * compiles once whatever uses it.
 */
function fadeEdges(shader: { vertexShader: string; fragmentShader: string }): void {
  facing(shader, 'vFace * vFace');
}
function fadeMiddle(shader: { vertexShader: string; fragmentShader: string }): void {
  facing(shader, '(1.0 - vFace) * (1.0 - vFace)');
}
function facing(shader: { vertexShader: string; fragmentShader: string }, alpha: string): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vFace;')
    .replace('#include <project_vertex>', '#include <project_vertex>\n\tvFace = abs(dot(normalize(normalMatrix * normal), normalize(-mvPosition.xyz)));');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vFace;')
    .replace('#include <color_fragment>', `#include <color_fragment>\n\tdiffuseColor.a *= ${alpha};`);
}

let dotTexture: THREE.DataTexture | null = null;

/** A soft round dot of light for the glows that face the camera; made once and kept for the whole page (as toonGradient). */
function glowDot(): THREE.DataTexture {
  if (!dotTexture) {
    const n = 64;
    const data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
        const i = (y * n + x) * 4;
        data.fill(255, i, i + 3);
        data[i + 3] = Math.round(255 * clamp01(1 - d) ** 2);
      }
    }
    dotTexture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    dotTexture.magFilter = THREE.LinearFilter;
    dotTexture.minFilter = THREE.LinearFilter;
    dotTexture.needsUpdate = true;
  }
  return dotTexture;
}

/** A cog wheel face on (in the xy plane), `depth` thick: `teeth` teeth round radius r, a hole through its hub and `windows` cut out between hub and rim. */
function cog(r: number, teeth: number, depth: number, windows = 0): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const root = r * 0.84;
  const step = (Math.PI * 2) / teeth;
  for (let k = 0; k < teeth; k++) {
    for (const [da, rad] of [
      [0, root],
      [0.14, r],
      [0.42, r],
      [0.56, root],
    ] as const) {
      const a = (k + da) * step;
      if (k === 0 && da === 0) s.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else s.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
  }
  s.closePath();
  s.holes.push(new THREE.Path().absarc(0, 0, r * 0.11, 0, Math.PI * 2, true));
  for (let k = 0; k < windows; k++) {
    const a0 = (k / windows) * Math.PI * 2 + 0.22;
    const a1 = ((k + 1) / windows) * Math.PI * 2 - 0.22;
    const w = new THREE.Path();
    w.absarc(0, 0, root * 0.8, a0, a1, false);
    w.absarc(0, 0, r * 0.27, a1, a0, true);
    w.closePath();
    s.holes.push(w);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 5 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A flat shape from its outline (in the xy plane), `depth` thick and centred on z = 0. */
function slab(pts: readonly (readonly [number, number])[], depth: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  pts.forEach(([x, y], k) => (k ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A clock hand pointing up (+y) from its pivot: a slim blade with a spade near its tip and a short tail. */
const pointer = (len: number, w: number, depth: number): THREE.BufferGeometry =>
  slab(
    [
      [0, -len * 0.2],
      [w * 1.3, -len * 0.1],
      [w, 0],
      [w * 0.5, len * 0.66],
      [w * 2, len * 0.76],
      [0, len],
      [-w * 2, len * 0.76],
      [-w * 0.5, len * 0.66],
      [-w, 0],
      [-w * 1.3, -len * 0.1],
    ],
    depth,
  );

/** A feather of plate 1 long pointing up (+y) from its quill, w wide. */
const plume = (w: number, depth: number): THREE.BufferGeometry =>
  slab(
    [
      [-w * 0.2, 0],
      [-w * 0.5, 0.2],
      [-w * 0.42, 0.72],
      [0, 1],
      [w * 0.5, 0.8],
      [w * 0.5, 0.22],
      [w * 0.2, 0],
    ],
    depth,
  );

// ------------------------------------------------------------------------------------------------ shared base

/**
 * What the foes here share on top of Figure (bosses7.ts): glows that always face the camera, light added onto
 * what is behind it (shaded per vertex, soft at its edges), and `ground` for what lies on the floor. steady()
 * holds a part where it is while FoeBase sinks and shrinks `body` after the foe is gone, so each foe can go
 * its own way (fall apart, burst, shatter, fade).
 */
abstract class Shining extends Figure {
  protected readonly ground = new THREE.Group();

  constructor(kind: FoeKind, height: number, ticks: boolean, pace?: number) {
    super(kind, height, ticks, pace);
    this.body.add(this.ground);
  }

  /** a soft round glow `size` metres across that always faces the camera */
  protected sprite(color: number, opacity: number, size: number): THREE.Sprite {
    const m = new THREE.SpriteMaterial({ map: glowDot(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mats.push(m);
    return sized(new THREE.Sprite(m), size);
  }

  /** light added onto what is behind it (`plain`: blended normally, for darkness); `vertex`: shaded per vertex; `soft`: fading where it turns edge-on; `rim`: bright only there */
  protected light(color: number, opacity: number, o: { vertex?: boolean; soft?: boolean; rim?: boolean; plain?: boolean } = {}): THREE.MeshBasicMaterial {
    const m = this.basic(color, opacity);
    if (!o.plain) m.blending = THREE.AdditiveBlending;
    m.vertexColors = !!o.vertex;
    if (o.soft) m.onBeforeCompile = fadeEdges;
    else if (o.rim) m.onBeforeCompile = fadeMiddle;
    return m;
  }

  /** puts o (a child of body) at height y and full size, whatever FoeBase has done to body */
  protected steady(o: THREE.Object3D, y: number): void {
    const s = this.body.scale.x;
    o.position.y = (y - this.body.position.y) / s;
    o.scale.setScalar(1 / s);
  }
}

// ------------------------------------------------------------------------------------------------ the deity

/** An arm: shoulder swung forward (-) or back, raised out to the side, elbow bent (-: forward), radians. */
type Arm = readonly [swing: number, out: number, bend: number];

/** How a deity stands for a move. */
interface Stance {
  /** its left arm (+x) and its right arm */
  l: Arm;
  r: Arm;
  /** 終式's lower pair */
  lo: Arm;
  /** rises, metres */
  lift: number;
  /** leans forward, radians */
  lean: number;
  /** wings: 0 at rest … 1 spread wide */
  wings: number;
  /** head tipped back (-) or down */
  nod: number;
}

const REST: Stance = { l: [-0.25, 0.32, -0.55], r: [-0.25, 0.32, -0.55], lo: [-0.7, 0.55, -1.25], lift: 0, lean: 0, wings: 0, nod: 0 };
const stance = (s: Partial<Stance>): Stance => ({ ...REST, ...s });

/** A deity's arm as built: shoulder, elbow and hand, and the angles it has this frame. */
interface Limb {
  root: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Group;
  /** +1 its left (+x), -1 its right */
  side: number;
  lower: boolean;
  swing: number;
  out: number;
  bend: number;
  /** what the move adds this frame (a thrust, a slash) */
  dSwing: number;
  dBend: number;
}

/** A clock halo: it turns as a whole, its hands and gears follow how far it has turned. */
interface Dial {
  group: THREE.Group;
  /** radians the halo turns per unit turned (- the other way) */
  spin: number;
  turned: number;
  hands: THREE.Mesh[];
  gears: { m: THREE.Mesh; rate: number }[];
  glow: THREE.MeshBasicMaterial;
}

/** A part of a deity coming loose as it falls apart: where it was (to put it back) and how it flies. */
interface Piece {
  o: THREE.Object3D;
  parent: THREE.Object3D;
  pos: THREE.Vector3;
  rot: THREE.Quaternion;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  /** how far above the floor it comes to rest */
  rest: number;
}

/** A deity's colours and size. */
interface Look {
  /** armour plates (and the robe), what shows between them (joints, neck), gold and darker gold */
  plate: string;
  under: string;
  gold: string;
  deep: string;
  /** the visor its eyes glow in */
  visor: string;
  /** what glows on it (under and the second feathers, by underGlow and wingGlow) */
  glow: string;
  underGlow: number;
  /** its feathers in turn */
  wing: readonly [string, string];
  wingGlow: number;
  eye: string;
  core: string;
  /** the light of its moves */
  light: number;
  scale: number;
}

/**
 * What 時律機神 and its 終式 share: a towering clockwork deity floating half a metre over the floor. A bell of
 * plate hangs from its gold belt (gold tassets over the hips, a clock face on the belt) and narrows to an open
 * hem with a pendulum swinging under it; a faceted breastplate with a gem over a turning cog for a heart, gold
 * pauldrons with fins, an egg-smooth helm with two glowing eye slits in a dark visor and a crown of gold rays,
 * wings of long metal feathers, and behind it a clock halo of rings, hour marks, hands and gears. It glides
 * after the tank (leaning in, robe and pendulum trailing, wings swept back), leaps with its wings spread, and
 * poses for its moves by their cast names (held 1.5 s after the cast). Everything that ticks runs on its own
 * clock, so a form can stop time on itself. While it cannot be targeted it goes grey and see-through; when it
 * dies it falls apart: head, arms, wings, halo and robe fly loose and drop, gears spill out of its chest and
 * its heart bursts in a flash, all fading out in about a second.
 */
abstract class Deity extends Shining {
  protected readonly big = new THREE.Group();
  protected readonly torso = new THREE.Group();
  private readonly skirt = new THREE.Group();
  private readonly pendulum = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly clockHands: THREE.Group[] = [];
  protected readonly limbs: Limb[] = [];
  private readonly wings: { g: THREE.Group; side: number; feathers: THREE.Mesh[] }[] = [];
  protected readonly dials: Dial[] = [];
  private readonly paints: { m: THREE.MeshToonMaterial; base: THREE.Color; glows: boolean }[] = [];
  protected readonly armour: THREE.MeshToonMaterial;
  protected readonly under: THREE.MeshToonMaterial;
  protected readonly gold: THREE.MeshToonMaterial;
  protected readonly deep: THREE.MeshToonMaterial;
  private readonly wingA: THREE.MeshToonMaterial;
  private readonly wingB: THREE.MeshToonMaterial;
  private readonly eyes: THREE.MeshToonMaterial;
  private readonly core: THREE.MeshToonMaterial;
  private readonly eyeGlows: THREE.Sprite[] = [];
  private readonly coreGlow: THREE.Sprite;
  private readonly coreCog: THREE.Mesh;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly poolMat: THREE.MeshBasicMaterial;
  /** cogs of three sizes (0 big … 2 small): halo, heart, and what spills out when it falls apart */
  protected readonly cogs: THREE.BufferGeometry[];
  private readonly plumeGeo: THREE.BufferGeometry;
  private readonly spill: { m: THREE.Mesh; v: THREE.Vector3; spin: number }[] = [];
  private readonly flash: THREE.Sprite;
  private pieces: Piece[] | null = null;
  private deathY = 0;
  private deathT = 0;
  /** the move it shows (held a moment after its cast), the move of the cast going on now */
  protected move: string | null = null;
  private wanted: string | null = null;
  private hold = 0;
  /** its own clock: what ticks (halo, pendulum, wings, the hover) runs on it */
  protected clock = 0;
  protected ghost = 0;
  private readonly weights = new Map<string, number>();
  private readonly now = { lift: 0, lean: 0, wings: 0, nod: 0 };
  /** set by each form every frame: how much the halo blazes and the eyes flare (0 … 1) */
  protected haloGlow = 0;
  protected eyeFlare = 0;

  constructor(
    kind: FoeKind,
    height: number,
    protected readonly look: Look,
    /** the moves it has a pose for */
    private readonly moves: readonly string[],
    /** its feathers' lengths (one wing) and the angle between them */
    private readonly feathers: readonly number[],
    private readonly gap: number,
  ) {
    super(kind, height, true, 4);
    const L = look;
    this.armour = this.paint(L.plate);
    this.under = this.paint(L.under, L.glow, L.underGlow);
    this.gold = this.paint(L.gold);
    this.deep = this.paint(L.deep);
    this.wingA = this.paint(L.wing[0], L.glow, L.wingGlow);
    this.wingB = this.paint(L.wing[1]);
    this.eyes = this.paint('#ffffff', L.eye, 1.4);
    this.core = this.paint(L.core, L.core, 1);
    this.cogs = [this.geo(cog(0.8, 14, 0.14, 5)), this.geo(cog(0.55, 11, 0.12, 4)), this.geo(cog(0.36, 9, 0.1))];
    this.plumeGeo = this.geo(plume(0.42, 0.07));
    this.big.scale.setScalar(L.scale);
    this.rig.add(this.big);

    // the robe: a bell of plate swelling over the hips and narrowing to an open hem, where the pendulum hangs
    // out; gold tassets over the hips
    const s = this.skirt;
    s.position.y = 3.3;
    const bell = [
      [0.56, -1.85],
      [0.8, -1.5],
      [0.98, -1.1],
      [1.05, -0.7],
      [0.98, -0.35],
      [0.8, 0],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    s.add(mesh(this.geo(new THREE.LatheGeometry(bell, 20)), this.armour));
    const tilt = Math.atan2(0.27, 0.7);
    const tassets: [THREE.BufferGeometry, THREE.Matrix4][] = [];
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * Math.PI * 2;
      tassets.push([box(1, 1, 1), place(Math.sin(a) * 1.0, -0.5, Math.cos(a) * 1.0, -tilt, a, 0, 0.5, 0.95, 0.07)]);
    }
    s.add(mesh(this.geo(merged(tassets)), this.gold));
    s.add(turned(mesh(ring(0.57, 0.06), this.gold, 0, -1.84, 0), Math.PI / 2));
    s.add(turned(mesh(ring(0.84, 0.13), this.gold), Math.PI / 2));
    // the clock on its belt, between the front tassets
    const face = new THREE.Group();
    face.position.set(0, -0.36, 1.0);
    face.rotation.x = -tilt;
    face.add(turned(mesh(cyl(0.3, 0.3, 0.06, 24), this.armour), Math.PI / 2), mesh(ring(0.3, 0.045), this.gold));
    for (const [len, w] of [
      [0.17, 0.05],
      [0.25, 0.035],
    ] as const) {
      const hand = new THREE.Group();
      hand.position.z = 0.04;
      hand.add(mesh(box(w, len, 0.02), this.deep, 0, len / 2, 0));
      face.add(hand);
      this.clockHands.push(hand);
    }
    s.add(face);
    // the pendulum: a rod and a gold bob with a gem, swinging under the hem
    const p = this.pendulum;
    p.position.y = -1.55;
    p.add(mesh(cyl(0.045, 0.045, 1.25, 6), this.deep, 0, -0.62, 0));
    p.add(turned(mesh(cyl(0.38, 0.38, 0.09, 24), this.gold, 0, -1.4, 0), Math.PI / 2), mesh(ring(0.38, 0.05), this.deep, 0, -1.4, 0));
    p.add(sized(mesh(gem(1), this.core, 0, -1.4, 0.07), 0.14, 0.19, 0.08));
    s.add(p);
    this.big.add(s);

    // the torso (from the belt up): waist, a faceted breastplate with a ridge down its front, gold gorget, neck
    const t = this.torso;
    t.position.y = 3.3;
    t.add(mesh(cyl(0.6, 0.78, 0.6, 14), this.armour, 0, 0.3, 0));
    t.add(sized(mesh(cyl(1.02, 0.7, 1.45, 8), this.armour, 0, 1.25, 0), 1, 1, 0.62));
    t.add(sized(mesh(cyl(1.08, 1.02, 0.22, 8), this.gold, 0, 1.98, 0), 1, 1, 0.66));
    t.add(mesh(cyl(0.26, 0.34, 0.4, 10), this.under, 0, 2.2, 0));
    // broad pauldrons: a gold shell tipped outwards with a band of plate round its rim, and a fin rising off each
    for (const side of [1, -1]) {
      const pad = turned(new THREE.Group(), 0, 0, -side * 0.5);
      pad.position.set(side * 1.12, 1.8, 0);
      pad.add(sized(mesh(ball(1), this.gold), 0.64, 0.5, 0.68), turned(sized(mesh(ring(1, 0.09), this.armour, 0, -0.06, 0), 0.62, 0.66, 0.66), Math.PI / 2));
      t.add(pad);
      t.add(turned(sized(mesh(gem(1), this.gold, side * 1.34, 2.3, -0.05), 0.07, 0.36, 0.2), 0, 0, -side * 0.55));
    }
    // its heart: a gem over a turning cog on the ridge of the breastplate
    const heart = new THREE.Group();
    heart.position.set(0, 1.4, 0.58);
    this.coreCog = mesh(this.cogs[2]!, this.gold);
    this.coreGlow = this.sprite(L.light, 0.35, 1.5);
    this.coreGlow.position.z = 0.25;
    heart.add(this.coreCog, sized(mesh(gem(1), this.core, 0, 0, 0.12), 0.2, 0.26, 0.14), this.coreGlow);
    t.add(heart);

    // the head: a smooth helm, two eye slits, a circlet with a crown of rays, a gem on the brow
    const h = this.head;
    h.position.y = 2.72;
    h.add(sized(mesh(ball(1), this.armour), 0.4, 0.48, 0.43));
    h.add(turned(mesh(ring(0.41, 0.045), this.gold, 0, 0.16, -0.02), Math.PI / 2 - 0.22));
    const rays: [THREE.BufferGeometry, THREE.Matrix4][] = [];
    for (let k = -3; k <= 3; k++) {
      const f = k * 0.42;
      const len = 0.85 - Math.abs(k) * 0.14;
      const at = 0.37 + len / 2;
      rays.push([cone(1, 1, 6), place(Math.sin(f) * at, 0.12 + Math.cos(f) * at, -0.14, 0, 0, -f, 0.075, len, 0.075)]);
    }
    h.add(mesh(this.geo(merged(rays)), this.gold));
    h.add(sized(mesh(gem(1), this.core, 0, 0.2, 0.4), 0.06, 0.09, 0.05));
    // a dark visor across the face, the eyes glowing in it
    h.add(sized(mesh(ball(1), this.paint(L.visor), 0, 0.02, 0.29), 0.34, 0.11, 0.17));
    h.add(
      mesh(
        this.geo(
          merged([
            [box(0.17, 0.05, 0.05), place(0.13, 0.025, 0.44, 0, 0.32, 0.2)],
            [box(0.17, 0.05, 0.05), place(-0.13, 0.025, 0.44, 0, -0.32, -0.2)],
          ]),
        ),
        this.eyes,
      ),
    );
    for (const side of [1, -1]) {
      const glow = this.sprite(L.light, 0.55, 0.55);
      glow.position.set(side * 0.13, 0.025, 0.5);
      this.eyeGlows.push(glow);
      h.add(glow);
    }
    t.add(h);

    // arms and wings
    this.arm(1, 1.3, 1.95, 0, 1, false);
    this.arm(-1, 1.3, 1.95, 0, 1, false);
    this.wing(1);
    this.wing(-1);
    this.big.add(t);

    // what spills out when it falls apart, and the flash of its heart breaking
    for (let k = 0; k < 12; k++) {
      const m = sized(mesh(this.cogs[k % 3]!, k % 2 ? this.gold : this.deep), 0.6 + (k % 4) * 0.12);
      m.visible = false;
      this.spill.push({ m, v: new THREE.Vector3(), spin: 0 });
      this.big.add(m);
    }
    this.flash = this.sprite(L.light, 0, 3);
    this.flash.visible = false;
    this.big.add(this.flash);

    // its shadow and a faint pool of its light on the floor
    this.shadowMat = this.basic(0x000000, 0.22);
    this.poolMat = this.light(L.light, 0.14, { vertex: true });
    this.ground.add(turned(sized(mesh(disc(1), this.shadowMat, 0, 0.02, 0), 1.7), -Math.PI / 2), turned(mesh(this.geo(softDisc(2.8)), this.poolMat, 0, 0.03, 0), -Math.PI / 2));
  }

  /** A cartoon material of its own that can glow, see-through (so it can fade like a ghost), tinted with the rest each frame. */
  private paint(color: string, emissive: string | null = null, glow = 0): THREE.MeshToonMaterial {
    const m = this.lit(color, emissive ?? color, emissive ? glow : 0);
    m.transparent = true;
    this.paints.push({ m, base: new THREE.Color(color), glows: !!emissive && glow > 0 });
    return m;
  }

  /** An arm hanging from (side·x, y, z) on the torso: plate upper arm, gold gauntlet, a hand; `size` times the main pair. */
  protected arm(side: 1 | -1, x: number, y: number, z: number, size: number, lower: boolean): Limb {
    const root = new THREE.Group();
    root.position.set(side * x, y, z);
    const up = 1.15 * size;
    const fore = 1.05 * size;
    root.add(sized(mesh(ball(1), this.under), 0.3 * size));
    root.add(sized(mesh(cyl(1, 0.85, 1, 10), this.armour, 0, -up / 2, 0), 0.25 * size, up, 0.25 * size));
    const elbow = new THREE.Group();
    elbow.position.y = -up;
    elbow.add(sized(mesh(ball(1), this.under), 0.22 * size));
    elbow.add(sized(mesh(cyl(0.85, 1, 1, 10), this.gold, 0, -fore / 2, 0), 0.24 * size, fore, 0.24 * size));
    elbow.add(turned(sized(mesh(ring(1, 0.16), this.deep, 0, -fore + 0.04, 0), 0.25 * size), Math.PI / 2));
    // the hand: a palm and a thumb
    const hand = new THREE.Group();
    hand.position.y = -fore - 0.04 * size;
    const palm = merged([
      [ball(1), place(0, -0.22, 0, 0, 0, 0, 0.19, 0.29, 0.13)],
      [ball(1), place(0, -0.14, 0.11, -0.5, 0, 0, 0.07, 0.15, 0.07)],
    ]);
    hand.add(sized(mesh(this.geo(palm), this.armour), size));
    elbow.add(hand);
    root.add(elbow);
    this.torso.add(root);
    const limb: Limb = { root, elbow, hand, side, lower, swing: REST.l[0], out: REST.l[1], bend: REST.l[2], dSwing: 0, dBend: 0 };
    this.limbs.push(limb);
    return limb;
  }

  /** A wing of long feathers fanned from the upper back. */
  private wing(side: 1 | -1): void {
    const g = new THREE.Group();
    g.position.set(side * 0.42, 1.8, -0.5);
    g.add(sized(mesh(ball(1), this.deep), 0.2));
    const feathers = this.feathers.map((len, k) => {
      const m = sized(mesh(this.plumeGeo, k % 2 ? this.wingB : this.wingA, 0, 0, -k * 0.035), 0.75 + len * 0.12, len, 1);
      g.add(m);
      return m;
    });
    this.torso.add(g);
    this.wings.push({ g, side, feathers });
  }

  /**
   * A clock halo of radius r behind the deity: a rim, an inner ring, 12 hour marks (or 24 runes), the light
   * behind it, two hands (or none) and gears on the rim ([angle from the top, size]).
   */
  protected dial(r: number, y: number, z: number, o: { hands: boolean; runes: boolean; gears: readonly (readonly [number, number])[]; spin: number }): Dial {
    const g = new THREE.Group();
    g.position.set(0, y, z);
    g.add(mesh(this.geo(new THREE.TorusGeometry(r, 0.085, 6, 80)), this.gold));
    g.add(mesh(this.geo(new THREE.TorusGeometry(r * 0.84, 0.035, 4, 72)), this.deep));
    const marks: [THREE.BufferGeometry, THREE.Matrix4][] = [];
    const n = o.runes ? 24 : 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const at = r * (o.runes ? 1.08 : 0.92);
      const main = o.runes ? k % 2 === 0 : k % 3 === 0;
      marks.push(
        main
          ? [gem(1), place(Math.sin(a) * at, Math.cos(a) * at, 0, 0, 0, -a, 0.1, o.runes ? 0.26 : 0.2, 0.06)]
          : [box(1, 1, 1), place(Math.sin(a) * at, Math.cos(a) * at, 0, 0, 0, -a, 0.05, 0.22, 0.04)],
      );
    }
    g.add(mesh(this.geo(merged(marks)), this.gold));
    const glow = this.light(this.look.light, 0.1, { vertex: true });
    g.add(mesh(this.geo(softDisc(r * 1.3)), glow, 0, 0, -0.12));
    const hands: THREE.Mesh[] = [];
    if (o.hands) {
      for (const [len, w, dz] of [
        [r * 0.55, 0.09, 0.07],
        [r * 0.85, 0.065, 0.12],
      ] as const) {
        const m = mesh(this.geo(pointer(len, w, 0.04)), this.deep, 0, 0, dz);
        hands.push(m);
        g.add(m);
      }
      g.add(turned(mesh(cyl(0.16, 0.16, 0.12, 16), this.deep, 0, 0, 0.09), Math.PI / 2));
    }
    const gears = o.gears.map(([a, size], k) => {
      const m = mesh(this.cogs[size]!, k % 2 ? this.gold : this.deep, Math.sin(a) * r, Math.cos(a) * r, -0.05);
      g.add(m);
      return { m, rate: (k % 2 ? -1 : 1) * (0.5 + size * 0.3) };
    });
    this.big.add(g);
    const d: Dial = { group: g, spin: o.spin, turned: 0, hands, gears, glow };
    this.dials.push(d);
    return d;
  }

  /** how much a move's look has come in (0 … 1) */
  protected weight(move: string): number {
    return this.weights.get(move) ?? 0;
  }

  /** which move a cast is, by its name (null: none with a pose) */
  protected abstract moveOf(cast: string): string | null;
  /** how it stands for a move (null: at rest) */
  protected abstract stanceOf(move: string | null): Stance;
  /** how fast its own clock runs (1 normally, 0 stopped) */
  protected abstract tempo(): number;
  /** how fast its halo turns (1 at rest) */
  protected abstract haloRate(): number;
  /** how far it takes the cold tint of stopped time (0 … 1) */
  protected chill(): number {
    return 0;
  }
  /** the moves' own lights and props, and what they add to the arms; runs every frame, also while it is gone (all weights 0) */
  protected abstract effects(dt: number, time: number): void;
  /** a cast of this move has just ended */
  protected ended(move: string): void {
    void move;
  }
  /** how long a move's pose is held after its cast ends, seconds */
  protected holdOf(move: string): number {
    void move;
    return HOLD;
  }

  protected pose(dt: number, time: number): void {
    // the move it shows: the one its cast asks for, held a moment after the cast so the players see it resolve
    const want = this.casting && !this.gone ? this.moveOf(this.casting) : null;
    if (this.wanted && this.wanted !== want) this.ended(this.wanted);
    this.wanted = want;
    if (want) {
      this.move = want;
      this.hold = this.holdOf(want);
    } else if (this.move) {
      this.hold -= dt;
      if (this.hold <= 0 || this.gone) this.move = null;
    }
    for (const k of this.moves) this.weights.set(k, this.gone ? 0 : toward(this.weight(k), this.move === k ? 1 : 0, 4, dt));
    this.ghost = toward(this.ghost, this.untargetable && !this.gone ? 1 : 0, 2.5, dt);
    this.steady(this.ground, 0);
    this.effects(dt, time);
    if (this.gone) {
      this.collapse(dt);
      return;
    }
    if (this.pieces) this.mend();

    this.clock += dt * this.tempo();
    const c = this.clock;
    const st = this.stanceOf(this.move);
    const n = this.now;
    n.lift = toward(n.lift, st.lift, 3, dt);
    n.lean = toward(n.lean, st.lean, 4, dt);
    n.wings = toward(n.wings, st.wings, 3, dt);
    n.nod = toward(n.nod, st.nod, 4, dt);
    const sw = this.stride;
    const hop = this.hop;
    // it floats and bobs, leans into the way it glides, the robe and the pendulum trailing behind
    const r = this.rig;
    this.steady(r, HOVER + Math.sin(c * 1.1) * 0.1 + n.lift + hop * 3.2);
    r.rotation.set(n.lean + sw * 0.14 + this.jolt(time, 0.02), 0, Math.sin(c * 0.7) * 0.02 + this.jolt(time, 0.015));
    this.torso.position.y = 3.3 + Math.sin(c * 1.3) * 0.03;
    this.skirt.rotation.set(sw * 0.16 + Math.sin(c * 0.9) * 0.02, 0, 0);
    this.pendulum.rotation.set(sw * 0.4 + hop * 0.5, 0, Math.sin(c * 2.4) * 0.24);
    this.head.rotation.set(n.nod + Math.sin(c * 0.8) * 0.03, Math.sin(c * 0.5) * 0.05, 0);
    this.clockHands.forEach((hand, k) => (hand.rotation.z = -c * (k ? 0.9 : 0.075)));
    // the arms ease into the move's stance, sway a little and trail while it glides
    this.limbs.forEach((a, k) => {
      const want = a.lower ? st.lo : a.side > 0 ? st.l : st.r;
      a.swing = toward(a.swing, want[0], 5, dt);
      a.out = toward(a.out, want[1], 5, dt);
      a.bend = toward(a.bend, want[2], 5, dt);
      a.root.rotation.set(a.swing + a.dSwing + Math.sin(c * 1.1 + k * 1.7) * 0.04 + sw * 0.22, 0, a.side * (a.out + Math.sin(c * 0.9 + k) * 0.02));
      a.elbow.rotation.x = a.bend + a.dBend;
      a.dSwing = 0;
      a.dBend = 0;
    });
    // the wings sweep back while it glides and spread for some moves and in a leap
    const spread = Math.max(n.wings, hop);
    const breathe = Math.sin(c * 0.9) * 0.035;
    for (const w of this.wings) {
      w.g.rotation.set(-0.12, w.side * (0.42 - spread * 0.3 + sw * 0.3), 0);
      w.feathers.forEach((f, k) => (f.rotation.z = -w.side * (0.4 - spread * 0.1 + k * (this.gap + spread * 0.1 + breathe))));
    }
    const rate = this.haloRate();
    for (const d of this.dials) {
      d.turned += dt * rate;
      d.group.rotation.z = d.turned * d.spin;
      d.hands.forEach((m, k) => (m.rotation.z = -d.turned * (k ? 0.9 : 0.12)));
      for (const g of d.gears) g.m.rotation.z = d.turned * g.rate;
    }
    this.coreCog.rotation.z = c * 0.8;
    this.colour(1);
    this.shadowMat.opacity = 0.22 * (1 - Math.min(0.6, (r.position.y - HOVER) / 8));
  }

  /** Tints, fades and lights it for this frame; `show` fades everything out when it falls apart. */
  private colour(show: number): void {
    const chill = this.chill();
    const ghost = this.ghost;
    for (const p of this.paints) {
      p.m.color.copy(p.base).lerp(COLD, chill * 0.6).lerp(GHOST, ghost * 0.4);
      p.m.opacity = (1 - ghost * 0.55) * show;
      if (!p.glows) {
        // stopped time frosts it over; a blazing halo makes its gold shine
        p.m.emissive.copy(p.base).lerp(COLD, chill);
        p.m.emissiveIntensity = chill * 0.2 + (p.m === this.gold ? this.haloGlow * 0.3 : 0);
      }
    }
    const dim = (1 - ghost * 0.65) * show;
    this.eyes.emissiveIntensity = (1.4 + this.eyeFlare * 2.5 + this.cast * 0.3) * dim;
    for (const s of this.eyeGlows) {
      s.material.opacity = (0.55 + this.eyeFlare * 0.45) * dim;
      s.scale.setScalar(0.55 * (1 + this.eyeFlare * 1.6));
    }
    this.core.emissiveIntensity = (0.9 + this.cast * 1.1 + Math.sin(this.clock * 2.2) * 0.15) * dim;
    this.coreGlow.material.opacity = (0.35 + this.cast * 0.35) * dim;
    for (const d of this.dials) d.glow.opacity = (0.1 + this.haloGlow * 0.55 + this.cast * 0.05) * dim;
    this.poolMat.opacity = (0.14 + this.cast * 0.12 + this.haloGlow * 0.1) * dim;
  }

  /** It falls apart: the parts come loose and drop, gears spill from its chest, its heart flashes. */
  private collapse(dt: number): void {
    if (!this.pieces) this.breakUp();
    this.deathT += dt;
    this.steady(this.rig, this.deathY);
    const g = 9.8 / this.look.scale;
    const fly = (o: THREE.Object3D, v: THREE.Vector3, rest: number): boolean => {
      v.y -= g * dt;
      o.position.addScaledVector(v, dt);
      if (o.position.y >= rest) return false;
      o.position.y = rest;
      v.set(v.x * 0.5, Math.abs(v.y) * 0.25, v.z * 0.5);
      return true;
    };
    for (const p of this.pieces!) {
      if (fly(p.o, p.v, p.rest)) p.spin.multiplyScalar(0.5);
      p.o.rotation.x += p.spin.x * dt;
      p.o.rotation.y += p.spin.y * dt;
      p.o.rotation.z += p.spin.z * dt;
    }
    for (const s of this.spill) {
      if (fly(s.m, s.v, -this.deathY / this.look.scale + 0.08)) s.spin *= 0.6;
      s.m.rotation.z += s.spin * dt;
    }
    this.flash.visible = this.deathT < 0.5;
    this.flash.scale.setScalar(2 + this.deathT * 16);
    this.flash.material.opacity = Math.max(0, 1 - this.deathT / 0.5) * 0.9;
    this.colour(smooth(this.fade * 1.7));
    this.shadowMat.opacity = 0.22 * this.fade;
  }

  private breakUp(): void {
    this.deathY = this.rig.position.y * this.body.scale.x + this.body.position.y;
    this.deathT = 0;
    this.rig.rotation.set(0, 0, 0);
    this.steady(this.rig, this.deathY);
    this.root.updateMatrixWorld(true);
    const floor = -this.deathY / this.look.scale;
    const loose = [this.head, ...this.limbs.map((l) => l.root), ...this.wings.map((w) => w.g)];
    const parts = [...loose, ...this.dials.map((d) => d.group), this.torso, this.skirt];
    this.pieces = parts.map((o, k) => {
      const piece: Piece = { o, parent: o.parent!, pos: o.position.clone(), rot: o.quaternion.clone(), v: new THREE.Vector3(), spin: new THREE.Vector3(), rest: floor + 0.3 };
      this.big.attach(o);
      if (k < loose.length) {
        // head, arms and wings fly out from the middle, a little up, tumbling
        const out = new THREE.Vector3(o.position.x, 0, o.position.z + 0.4).normalize();
        piece.v.copy(out).multiplyScalar(1.3 + (k % 3) * 0.5).setY(1.4 + (k % 4) * 0.5);
        piece.spin.set(((k * 0.37) % 1) * 4 - 2, ((k * 0.61) % 1) * 2 - 1, ((k * 0.83) % 1) * 4 - 2);
      } else if (o === this.torso || o === this.skirt) {
        // the trunk drops where it was and tips over
        piece.v.set(0, 0.3, 0.2);
        piece.spin.set(o === this.torso ? 0.7 : -0.3, 0.2, 0.25);
        piece.rest = floor + (o === this.torso ? 0.7 : 1.4);
      } else {
        // a halo topples backwards
        piece.v.set(0, 0.8, -1.4);
        piece.spin.set(-1.5, 0, 0.4);
      }
      return piece;
    });
    const dir = new THREE.Vector3();
    this.spill.forEach((s, k) => {
      s.m.position.set(Math.sin(k) * 0.3, 4.6, 0.3 + Math.cos(k) * 0.2);
      s.m.rotation.set(k * 0.7, k * 1.3, 0);
      s.v.copy(spray(k, this.spill.length, dir)).multiplyScalar(2.6 + (k % 3) * 0.9);
      s.v.y = Math.abs(s.v.y) + 1.6;
      s.spin = (k % 2 ? 1 : -1) * (6 + (k % 4));
      s.m.visible = true;
    });
    this.flash.position.set(0, 4.7, 0.6);
  }

  /** Puts it back together (if what fell stands up again). */
  private mend(): void {
    for (const p of this.pieces!) {
      p.parent.add(p.o);
      p.o.position.copy(p.pos);
      p.o.quaternion.copy(p.rot);
    }
    this.pieces = null;
    for (const s of this.spill) s.m.visible = false;
    this.flash.visible = false;
  }
}

// ------------------------------------------------------------------------------------------------ 時律機神

type PrimeMove = 'holy' | 'spear' | 'cross' | 'formation' | 'stop' | 'summon';

const PRIME_POSE: Readonly<Record<PrimeMove, Stance>> = {
  holy: stance({ l: [-2.75, 0.42, -0.25], r: [-2.75, 0.42, -0.25], lift: 0.35, wings: 1, nod: -0.3 }),
  spear: stance({ l: [-0.55, 0.55, -1.0], r: [-1.4, 0.05, -0.1], lean: 0.1 }),
  cross: stance({ l: [0, 1.5, 0], r: [0, 1.5, 0], wings: 1, nod: -0.1 }),
  formation: stance({ l: [-1.35, 0.22, -0.2], r: [-1.35, 0.22, -0.2], lean: 0.08, wings: 0.5 }),
  stop: stance({ l: [-0.3, 0.45, -0.7], r: [-1.95, 0.12, -0.35], nod: -0.05 }),
  summon: stance({ l: [-2.15, 0.95, -0.3], r: [-2.15, 0.95, -0.3], lift: 1.2, wings: 1, nod: -0.25 }),
};

const PRIME_LOOK: Look = {
  plate: '#eef1f7',
  under: '#aeb8cc',
  gold: '#e3b43e',
  deep: '#a97b2c',
  visor: '#253049',
  glow: '#8ff2ff',
  underGlow: 0,
  wing: ['#cc9d42', '#a87a30'],
  wingGlow: 0,
  eye: '#9ff6ff',
  core: '#a8f4ff',
  light: 0xc8f6ff,
  scale: 1,
};

/**
 * 時律機神 (P3's boss): the deity in white plate and gold with brass wings, its eyes and heart glowing white-cyan,
 * about 7 m to the top of its helm (its crown and halo reach almost 9 m). Its poses, by cast name:
 * 大聖光 raises both arms and lifts its head, a ball of light between its hands, the halo blazing, and the
 * light flashes when the cast ends; 懲戒 / 聖槍 a spear of light grows out of its right hand and it thrusts it
 * forward again and again (held 3 s after the cast, for the hits that follow); 十字聖禮 arms out straight, a cross of light behind it; 起源陣 / 時隙陣 both hands
 * forward, a clock sigil of light in front of them and the halo's gears spinning fast; 時間停止 its right hand
 * raised to halt, every clock on it (halo, hands, gears, pendulum, wings, its hover) slows to a dead stop and it
 * frosts over cold blue-white inside a pale bubble; 召喚機神 arms raised wide, it rises a metre in a pillar of light.
 */
export class Prime extends Deity {
  private readonly orb = new THREE.Group();
  private readonly orbIn: THREE.Sprite;
  private readonly orbOut: THREE.Sprite;
  private readonly burst: THREE.Sprite;
  private burstT = -1;
  private readonly spear = new THREE.Group();
  private readonly spearMat: THREE.MeshToonMaterial;
  private readonly spearGlow: THREE.Sprite;
  private thrustT = 0;
  private readonly crossMat: THREE.MeshBasicMaterial;
  private readonly cross: THREE.Mesh;
  private readonly sigil = new THREE.Group();
  private readonly sigilMat: THREE.MeshBasicMaterial;
  private readonly pillarMat: THREE.MeshBasicMaterial;
  private readonly pillar: THREE.Mesh;
  private readonly bubbleMat: THREE.MeshBasicMaterial;
  private readonly bubble: THREE.Mesh;

  constructor() {
    super('prime', 7.6, PRIME_LOOK, Object.keys(PRIME_POSE), [3.2, 2.95, 2.65, 2.25, 1.8], 0.3);
    this.dial(2.4, 6.0, -1.5, {
      hands: true,
      runes: false,
      gears: [
        [2.35, 0],
        [-2.25, 1],
        [-0.85, 2],
        [0.9, 2],
      ],
      spin: 0.12,
    });
    const light = PRIME_LOOK.light;
    // 大聖光: a ball of light between its raised hands, and its flash
    this.orbIn = this.sprite(0xffffff, 0, 1.6);
    this.orbOut = this.sprite(light, 0, 4);
    this.orb.position.set(0, 7.5, 0.5);
    this.orb.add(this.orbOut, this.orbIn);
    this.burst = this.sprite(0xfff6e0, 0, 4);
    this.burst.position.set(0, 7, 0.5);
    this.burst.visible = false;
    this.big.add(this.orb, this.burst);
    // 懲戒與聖槍: a spear of light held along the right forearm, point first
    this.spearMat = this.lit('#f6fbff', '#bff6ff', 0.9);
    const sp = this.spear;
    sp.add(mesh(cyl(0.055, 0.055, 4.4, 8), this.spearMat, 0, -0.8, 0));
    sp.add(sized(mesh(gem(1), this.spearMat, 0, -3.55, 0), 0.2, 0.62, 0.06));
    sp.add(mesh(box(0.56, 0.09, 0.12), this.gold, 0, -2.95, 0));
    for (const side of [1, -1]) sp.add(turned(sized(mesh(gem(1), this.gold, side * 0.32, -3.08, 0), 0.06, 0.24, 0.04), 0, 0, side * 0.6));
    this.spearGlow = this.sprite(light, 0, 1.8);
    this.spearGlow.position.y = -3.4;
    sp.add(this.spearGlow);
    this.limbs[1]!.hand.add(sp);
    // 十字聖禮: a cross of light behind it
    this.crossMat = this.light(0xfff4cf, 0, { vertex: true });
    this.cross = mesh(
      this.geo(
        merged(
          [
            [softBar(0.9, 10.5, endsFade), place(0, 4.9, 0)],
            [softBar(0.9, 9.8, endsFade), place(0, 5.25, 0, 0, 0, Math.PI / 2)],
          ],
          true,
        ),
      ),
      this.crossMat,
      0,
      0,
      -0.35,
    );
    this.big.add(this.cross);
    // 起源陣 / 時隙陣: a clock sigil of light in front of its hands
    this.sigilMat = this.light(light, 0);
    const ticks: [THREE.BufferGeometry, THREE.Matrix4][] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ticks.push([box(1, 1, 1), place(Math.sin(a) * 0.86, Math.cos(a) * 0.86, 0, 0, 0, -a, 0.05, k % 3 ? 0.14 : 0.26, 0.02)]);
    }
    this.sigil.add(mesh(ring(1.05, 0.035), this.sigilMat), mesh(ring(0.68, 0.025), this.sigilMat), mesh(this.geo(merged(ticks)), this.sigilMat));
    this.sigil.add(sized(mesh(this.cogs[1]!, this.sigilMat), 0.85, 0.85, 0.3));
    this.sigil.position.set(0, 4.9, 2.9);
    this.sigil.rotation.x = -0.3;
    this.big.add(this.sigil);
    // 召喚機神: a pillar of light from the floor
    this.pillarMat = this.light(0xfff6dc, 0, { vertex: true, soft: true });
    this.pillar = mesh(this.geo(softTube(2.2, 16, (k) => (1 - k) ** 1.3 * smooth(k * 12))), this.pillarMat);
    this.ground.add(this.pillar);
    // 時間停止: a pale bubble of stopped time round it
    this.bubbleMat = this.light(0xb8dcff, 0, { rim: true });
    this.bubble = sized(mesh(this.geo(new THREE.SphereGeometry(1, 32, 20)), this.bubbleMat, 0, 4.2, 0), 4.6, 4.4, 4.6);
    this.big.add(this.bubble);
  }

  protected moveOf(cast: string): string | null {
    if (cast.includes('大聖光')) return 'holy';
    if (cast.includes('懲戒') || cast.includes('聖槍')) return 'spear';
    if (cast.includes('十字聖禮')) return 'cross';
    if (cast.includes('起源陣') || cast.includes('時隙陣')) return 'formation';
    if (cast.includes('時間停止')) return 'stop';
    if (cast.includes('召喚機神')) return 'summon';
    return null;
  }

  protected stanceOf(move: string | null): Stance {
    return (move && PRIME_POSE[move as PrimeMove]) || REST;
  }

  protected tempo(): number {
    return 1 - smooth(this.weight('stop') * 1.2);
  }

  protected haloRate(): number {
    return this.tempo() * (1 + this.weight('formation') * 8);
  }

  protected chill(): number {
    return this.weight('stop');
  }

  protected ended(move: string): void {
    if (move === 'holy') this.burstT = 0;
  }

  protected holdOf(move: string): number {
    // the four thrusts come after the cast: keep the spear out for them
    return move === 'spear' ? 3 : HOLD;
  }

  protected effects(dt: number, time: number): void {
    const holy = this.weight('holy');
    const spear = this.weight('spear');
    const cross = this.weight('cross');
    const form = this.weight('formation');
    const stop = this.weight('stop');
    const summon = this.weight('summon');
    this.haloGlow = Math.max(holy, form * 0.5, summon * 0.5, cross * 0.4);
    this.eyeFlare = Math.max(holy * 0.6, stop * 0.4, spear * 0.3);

    // 大聖光: the ball of light grows and throbs; when the cast ends it flashes
    this.orb.visible = holy > 0.01;
    const throb = 1 + Math.sin(time * 9) * 0.08;
    this.orbIn.scale.setScalar(Math.max(0.001, 1.8 * holy * throb));
    this.orbIn.material.opacity = 0.95 * holy;
    this.orbOut.scale.setScalar(Math.max(0.001, 4 * holy * throb));
    this.orbOut.material.opacity = 0.38 * holy;
    if (this.burstT >= 0) {
      this.burstT += dt;
      const k = this.burstT / 0.6;
      this.burst.visible = k < 1 && !this.gone;
      this.burst.scale.setScalar(5 + k * 16);
      this.burst.material.opacity = (1 - k) * 0.9;
      if (k >= 1) this.burstT = -1;
    }

    // 懲戒與聖槍: the spear grows out of the hand, then it pulls back and thrusts, again and again
    this.spear.visible = spear > 0.01;
    this.spear.scale.set(1, Math.max(0.001, smooth(spear * 1.4)), 1);
    this.spearMat.emissiveIntensity = 0.9 + Math.sin(time * 8) * 0.2;
    this.spearGlow.material.opacity = 0.7 * spear;
    if (this.move === 'spear') {
      this.thrustT += dt;
      const u = (this.thrustT % 0.9) / 0.9;
      const back = u < 0.6 ? smooth(u / 0.6) : u < 0.7 ? 1 - smooth((u - 0.6) / 0.1) : 0;
      const arm = this.limbs[1]!;
      arm.dSwing = (0.5 * back - 0.15) * spear;
      arm.dBend = -0.95 * back * spear;
    } else this.thrustT = 0;

    // 十字聖禮: the cross of light opens out from its middle
    this.cross.visible = cross > 0.01;
    this.cross.scale.set(0.3 + 0.7 * smooth(cross), 0.3 + 0.7 * smooth(cross), 1);
    this.crossMat.opacity = cross * (0.75 + Math.sin(time * 7) * 0.1);

    // 起源陣 / 時隙陣: the sigil pops up in front of its hands and spins
    this.sigil.visible = form > 0.01;
    this.sigil.scale.setScalar(Math.max(0.001, popUp(form) * 1.35));
    this.sigil.rotation.z += dt * 2.5;
    this.sigilMat.opacity = form * (0.7 + Math.sin(time * 6) * 0.1);

    // 召喚機神: the pillar of light rises round it
    this.pillar.visible = summon > 0.01;
    this.pillar.scale.set(1, Math.max(0.001, smooth(summon * 1.5)), 1);
    this.pillarMat.opacity = summon * 0.42;

    // 時間停止: the bubble of stopped time
    this.bubble.visible = stop > 0.01;
    this.bubbleMat.opacity = stop * 0.32;
  }
}

// ------------------------------------------------------------------------------------------------ 時律機神・終式

type PerfectMove = 'word' | 'still' | 'motion' | 'judge' | 'fate' | 'radiant' | 'execute' | 'prison';

const PERFECT_POSE: Readonly<Record<PerfectMove, Stance>> = {
  word: stance({ l: [-1.2, 0.75, -0.35], r: [-1.2, 0.75, -0.35], lo: [-0.85, 0.45, -1.3], wings: 0.5 }),
  still: stance({ l: [-0.35, 0.45, -0.6], r: [-1.6, 0.0, -0.05], lo: [-0.2, 0.55, -0.4] }),
  motion: stance({ l: [-0.9, 0.95, -0.5], r: [-1.85, 0.75, -0.25], lo: [-0.6, 1.1, -0.6], lean: 0.12, wings: 0.8 }),
  judge: stance({ l: [-0.65, 0.45, -0.75], r: [-2.95, 0.12, -0.05], lo: [-0.25, 1.25, -0.25], nod: -0.15 }),
  fate: stance({ l: [-0.95, 0.95, -0.55], r: [-0.95, 0.95, -0.55], lo: [-0.5, 1.0, -0.8], wings: 0.6, nod: -0.1 }),
  radiant: stance({ l: [-1.9, 1.25, -0.2], r: [-1.9, 1.25, -0.2], lo: [-0.6, 1.35, -0.3], lift: 0.4, wings: 1 }),
  execute: stance({ l: [-0.6, 0.5, -0.9], r: [-2.85, 0.3, -0.25], lean: 0.05 }),
  prison: stance({ l: [-1.25, 1.15, -0.4], r: [-1.25, 1.15, -0.4], lo: [-0.4, 1.3, -0.5], lift: 0.45, wings: 0.9 }),
};

const PERFECT_LOOK: Look = {
  plate: '#2d2738',
  under: '#2e1d50',
  gold: '#e8c04c',
  deep: '#9a7226',
  visor: '#0c0912',
  glow: '#9a5cff',
  underGlow: 0.32,
  wing: ['#2d2738', '#e8c04c'],
  wingGlow: 0.22,
  eye: '#e2c8ff',
  core: '#c9a2ff',
  light: 0xb57cff,
  scale: 1.08,
};

/**
 * 時律機神・終式 (P4's boss): the same deity remade, 8 % bigger, in black plate and gold with violet light in
 * its joints, eyes and heart; a second, lower pair of arms, longer black-and-gold wings of seven feathers, and a
 * double halo (the clock, and a wider ring of runes and gears turning the other way behind it). Its poses, by
 * cast name: 終焉之言 both arms held out, a white orb of light in its left hand and a black-violet orb in its
 * right; 靜止命令 its right hand out to halt and everything on it that ticks stops dead (halo, pendulum, wings,
 * its hover); 行動命令 an arm sweeping forward, its halo spinning hard and its clocks racing; 全能審判 its right
 * hand raised, a faint 3 × 3 grid glowing on the floor round it; 命運校準 its eyes and halos flare, rings of light
 * pulsing off the halo; 輝耀聖禮 arms raised wide, a sunburst of rays charging behind it that bursts in a sphere of
 * light when the cast ends; 處刑命令 a great blade of violet light in its right hand, raised high and brought down
 * again and again; 時間牢獄 hands out, bars of light rising in a ring round it.
 */
export class Perfect extends Deity {
  private readonly lightOrb = new THREE.Group();
  private readonly darkOrb = new THREE.Group();
  private readonly swirl: THREE.Mesh;
  private readonly gridMat: THREE.MeshBasicMaterial;
  private readonly grid: THREE.Mesh;
  private readonly raysMat: THREE.MeshBasicMaterial;
  private readonly rays: THREE.Mesh;
  private readonly shellMat: THREE.MeshBasicMaterial;
  private readonly shell: THREE.Mesh;
  private shellT = -1;
  private readonly blade = new THREE.Group();
  private readonly bladeMat: THREE.MeshToonMaterial;
  private readonly bladeAura: THREE.MeshBasicMaterial;
  private slashT = 0;
  private readonly cageMat: THREE.MeshBasicMaterial;
  private readonly cage = new THREE.Group();
  private readonly flareMat: THREE.MeshBasicMaterial;
  private readonly flare: THREE.Mesh;

  constructor() {
    super('perfect', 8.2, PERFECT_LOOK, Object.keys(PERFECT_POSE), [3.8, 3.55, 3.25, 2.9, 2.5, 2.1, 1.7], 0.25);
    this.arm(1, 0.9, 0.85, 0.05, 0.8, true);
    this.arm(-1, 0.9, 0.85, 0.05, 0.8, true);
    this.dial(2.5, 6.05, -1.5, {
      hands: true,
      runes: false,
      gears: [
        [2.4, 0],
        [-2.3, 1],
        [-0.9, 2],
      ],
      spin: 0.12,
    });
    this.dial(3.35, 6.05, -1.85, {
      hands: false,
      runes: true,
      gears: [
        [0.75, 1],
        [-2.75, 0],
        [1.9, 2],
      ],
      spin: -0.08,
    });
    const light = PERFECT_LOOK.light;
    // 終焉之言: a white orb in its left hand, a black one ringed in violet in its right
    const white = this.lit('#ffffff', '#fff4e0', 1.6);
    this.lightOrb.add(mesh(ball(0.42), white), this.sprite(0xfff4e0, 0.9, 2.8));
    const black = this.lit('#130a1e', '#4a1f80', 0.3);
    this.swirl = turned(mesh(ring(0.62, 0.04, Math.PI * 1.4), this.lit('#3a1d63', '#a66bff', 0.9)), 1.2);
    this.darkOrb.add(mesh(ball(0.42), black), this.sprite(light, 0.95, 2.8), this.swirl);
    for (const [orb, k] of [
      [this.lightOrb, 0],
      [this.darkOrb, 1],
    ] as const) {
      orb.position.set(0, -0.7, 0.2);
      this.limbs[k]!.hand.add(orb);
    }
    // 全能審判: a faint 3 × 3 grid on the floor, brighter at the cells' edges
    this.gridMat = this.light(0xd9b8ff, 0, { vertex: true });
    const cells: [THREE.BufferGeometry, THREE.Matrix4][] = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        cells.push([shaded(new THREE.PlaneGeometry(2.3, 2.3, 8, 8), (x, y) => 0.15 + 0.85 * Math.max(Math.abs(x), Math.abs(y)) ** 6 / 1.15 ** 6), place(i * 2.5, j * 2.5, 0)]);
      }
    }
    this.grid = turned(mesh(this.geo(merged(cells, true)), this.gridMat, 0, 0.04, 0), -Math.PI / 2);
    this.ground.add(this.grid);
    // 輝耀聖禮: a sunburst of rays behind it, and the sphere of light it bursts into
    this.raysMat = this.light(0xfff0c8, 0, { vertex: true });
    const rays: [THREE.BufferGeometry, THREE.Matrix4][] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const len = k % 2 ? 3.6 : 5;
      rays.push([softBar(0.6, len, endsFade), place(Math.sin(a) * (0.9 + len / 2), Math.cos(a) * (0.9 + len / 2), 0, 0, 0, -a)]);
    }
    this.rays = mesh(this.geo(merged(rays, true)), this.raysMat, 0, 4.7, -0.9);
    this.shellMat = this.light(0xfff0c8, 0, { soft: true });
    this.shell = mesh(this.geo(new THREE.SphereGeometry(1, 32, 20)), this.shellMat, 0, 4.6, 0);
    this.shell.visible = false;
    this.big.add(this.rays, this.shell);
    // 處刑命令: a great blade of light held along the right forearm, point first
    this.bladeMat = this.lit('#f1e6ff', '#b57cff', 1.1);
    this.bladeAura = this.light(light, 0);
    const edge = this.geo(
      slab(
        [
          [-0.3, 0],
          [-0.26, -3.4],
          [0, -4.4],
          [0.26, -3.4],
          [0.3, 0],
        ],
        0.08,
      ),
    );
    this.blade.add(mesh(edge, this.bladeMat, 0, -0.35, 0), sized(mesh(edge, this.bladeAura, 0, -0.25, 0), 1.6, 1.05, 3));
    this.blade.add(mesh(box(0.8, 0.12, 0.16), this.gold, 0, -0.32, 0), mesh(cyl(0.06, 0.06, 0.6, 8), this.deep, 0, 0, 0));
    this.limbs[1]!.hand.add(this.blade);
    // 時間牢獄: bars of light rising in a ring round it
    this.cageMat = this.light(0xe6d2ff, 0, { vertex: true, soft: true });
    const bar = softTube(0.2, 7, (k) => smooth(k * 8) * (1 - k * 0.6));
    const bars: [THREE.BufferGeometry, THREE.Matrix4][] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      bars.push([bar, place(Math.sin(a) * 5.6, 0, Math.cos(a) * 5.6)]);
    }
    this.cage.add(mesh(this.geo(merged(bars)), this.cageMat));
    bar.dispose();
    this.cage.add(turned(mesh(this.geo(new THREE.TorusGeometry(5.6, 0.05, 4, 96)), this.cageMat, 0, 0.1, 0), Math.PI / 2));
    this.ground.add(this.cage);
    // 命運校準: rings of light pulsing off the clock halo
    this.flareMat = this.light(light, 0);
    this.flare = mesh(this.geo(new THREE.TorusGeometry(2.5, 0.06, 4, 80)), this.flareMat);
    this.dials[0]!.group.add(this.flare);
  }

  protected moveOf(cast: string): string | null {
    if (cast.includes('終焉之言')) return 'word';
    if (cast.includes('靜止命令')) return 'still';
    if (cast.includes('行動命令')) return 'motion';
    if (cast.includes('全能審判')) return 'judge';
    if (cast.includes('命運校準')) return 'fate';
    if (cast.includes('輝耀聖禮')) return 'radiant';
    if (cast.includes('處刑命令')) return 'execute';
    if (cast.includes('時間牢獄')) return 'prison';
    return null;
  }

  protected stanceOf(move: string | null): Stance {
    return (move && PERFECT_POSE[move as PerfectMove]) || REST;
  }

  protected tempo(): number {
    // stillness stops its clocks dead (no easing); motion races them
    return this.move === 'still' ? 0 : 1 + this.weight('motion') * 0.8;
  }

  protected haloRate(): number {
    return this.move === 'still' ? 0 : 1 + this.weight('motion') * 10;
  }

  protected ended(move: string): void {
    if (move === 'radiant') this.shellT = 0;
  }

  protected effects(dt: number, time: number): void {
    const word = this.weight('word');
    const motion = this.weight('motion');
    const judge = this.weight('judge');
    const fate = this.weight('fate');
    const radiant = this.weight('radiant');
    const execute = this.weight('execute');
    const prison = this.weight('prison');
    this.haloGlow = Math.max(fate, motion * 0.6, radiant * 0.7, judge * 0.4, prison * 0.4);
    this.eyeFlare = Math.max(fate, judge * 0.4, execute * 0.4);

    // 終焉之言: the two orbs swell in its hands
    const orb = Math.max(0.001, smooth(word * 1.3) * (1 + Math.sin(time * 5) * 0.05));
    this.lightOrb.visible = this.darkOrb.visible = word > 0.01;
    this.lightOrb.scale.setScalar(orb);
    this.darkOrb.scale.setScalar(orb);
    this.swirl.rotation.z += dt * 4;

    // 全能審判: the grid glows faintly on the floor, square to the arena whichever way it faces
    this.grid.visible = judge > 0.01;
    this.grid.rotation.z = -this.root.rotation.y;
    this.gridMat.opacity = judge * (0.4 + Math.sin(time * 3) * 0.08);

    // 命運校準: a ring of light pulses off the halo every second
    const u = (time * 1.1) % 1;
    this.flare.visible = fate > 0.01;
    this.flare.scale.setScalar(1 + u * 0.55);
    this.flareMat.opacity = fate * (1 - u) * 0.8;

    // 輝耀聖禮: the rays charge (grow, turn); when the cast ends a sphere of light bursts out of it
    this.rays.visible = radiant > 0.01;
    this.rays.scale.setScalar(Math.max(0.001, 0.4 + 0.6 * smooth(radiant)));
    this.rays.rotation.z += dt * 0.5;
    this.raysMat.opacity = radiant * (0.6 + Math.sin(time * 8) * 0.12);
    if (this.shellT >= 0) {
      this.shellT += dt;
      const k = this.shellT / 0.7;
      this.shell.visible = k < 1 && !this.gone;
      this.shell.scale.setScalar(1.5 + smooth(k) * 10);
      this.shellMat.opacity = (1 - k) * 0.85;
      if (k >= 1) this.shellT = -1;
    }

    // 處刑命令: the blade appears, is raised high and brought down, again and again
    this.blade.visible = execute > 0.01;
    this.blade.scale.set(1, Math.max(0.001, smooth(execute * 1.4)), 1);
    this.bladeMat.emissiveIntensity = 1.1 + Math.sin(time * 9) * 0.25;
    this.bladeAura.opacity = execute * 0.35;
    if (this.move === 'execute') {
      this.slashT += dt;
      const s = (this.slashT % 1.4) / 1.4;
      const down = s < 0.55 ? 0 : s < 0.66 ? smooth((s - 0.55) / 0.11) : s < 0.85 ? 1 : 1 - smooth((s - 0.85) / 0.15);
      this.limbs[1]!.dSwing = 2.2 * down * execute;
    } else this.slashT = 0;

    // 時間牢獄: the bars rise round it and turn slowly
    this.cage.visible = prison > 0.01;
    this.cage.scale.set(1, Math.max(0.001, smooth(prison * 1.3)), 1);
    this.cage.rotation.y += dt * 0.3;
    this.cageMat.opacity = prison * (0.75 + Math.sin(time * 5) * 0.1);
  }
}

// ------------------------------------------------------------------------------------------------ 時之鳥

/**
 * 時之鳥: a small clockwork bird of brass, 1.2 m from wingtip to wingtip, flying 2 m up: an egg-shaped body
 * with a riveted band, a round head with a sharp beak and two white-cyan eyes, a cog turning on its back, a fan
 * of three tail plates and wings of three plates each. Its wings beat (faster while it flies) and it faces the
 * way it moves (read from how far the view moved it since the last frame), banking into turns. It turns gold
 * with each crystal it touches (金色's v): each touch flashes it bright and sends a ring of light out from it,
 * its brass shines a step more golden and a trail of golden glints follows it. When it goes it bursts into
 * golden sparks.
 */
export class Bird extends Shining {
  private readonly heading = new THREE.Group();
  private readonly model = new THREE.Group();
  private readonly wings: { g: THREE.Group; side: number }[] = [];
  private readonly tail = new THREE.Group();
  private readonly cogMesh: THREE.Mesh;
  private readonly brass: THREE.MeshToonMaterial;
  private readonly deep: THREE.MeshToonMaterial;
  private readonly aura: THREE.Sprite;
  private readonly waveMat: THREE.MeshBasicMaterial;
  private readonly wave: THREE.Mesh;
  private readonly glints: THREE.Mesh[] = [];
  private readonly sparks: { m: THREE.Mesh; v: THREE.Vector3 }[] = [];
  private readonly flash: THREE.Sprite;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly prev = new THREE.Vector3(NaN, 0, NaN);
  /** the way it faces in the world (NaN until it first moves) and its roll into a turn */
  private yaw = NaN;
  private bank = 0;
  private speed = 0;
  private flap = 0;
  private flyY = 2;
  /** crystals touched (金色's v), how gold it has turned (eased) and the flash of the latest touch */
  private touched = 0;
  private gold = 0;
  private shine = 0;
  /** seconds since it burst (-1: not yet) */
  private popT = -1;
  /** so two birds do not flap in step */
  private readonly phase = Math.random() * 10;

  constructor() {
    super('bird', 2.9, false);
    this.brass = this.lit('#b8893a', '#ffc83a');
    this.deep = this.lit('#7a5a26', '#ffc83a');
    const eye = this.lit('#cffcff', '#8ff2ff', 1.4);
    // a plate feather lying flat, pointing +x (its parts are merged per material below: few draw calls)
    const feather = plume(0.3, 0.025).rotateZ(-Math.PI / 2).rotateX(Math.PI / 2);
    this.heading.rotation.order = 'YXZ';
    this.rig.add(this.heading);
    this.heading.add(this.model);
    const m = this.model;
    // body and head, the band round it and the beak, two eyes; a cog turning on its back
    m.add(
      mesh(
        this.geo(
          merged([
            [ball(1), place(0, 0, 0, 0, 0, 0, 0.16, 0.15, 0.3)],
            [ball(1), place(0, 0.1, 0.3, 0, 0, 0, 0.125)],
          ]),
        ),
        this.brass,
      ),
      mesh(
        this.geo(
          merged([
            [ring(0.155, 0.024), place(0, 0, 0.06)],
            [cone(0.045, 0.17, 8), place(0, 0.08, 0.47, Math.PI / 2)],
          ]),
        ),
        this.deep,
      ),
      mesh(
        this.geo(
          merged([
            [ball(0.032), place(0.075, 0.13, 0.37)],
            [ball(0.032), place(-0.075, 0.13, 0.37)],
          ]),
        ),
        eye,
      ),
    );
    this.cogMesh = turned(mesh(this.geo(cog(0.11, 8, 0.03)), this.deep, 0, 0.16, -0.03), -Math.PI / 2);
    m.add(this.cogMesh);
    // a fan of tail plates
    const tail = (k: number): [THREE.BufferGeometry, THREE.Matrix4] => [feather, place(k * 0.03, 0, 0, 0, Math.PI / 2 + k * 0.35, 0, 0.42, 1, 0.8)];
    this.tail.position.set(0, 0.02, -0.24);
    this.tail.rotation.x = 0.25;
    this.tail.add(mesh(this.geo(merged([tail(-1), tail(1)])), this.brass), mesh(this.geo(merged([tail(0)])), this.deep));
    m.add(this.tail);
    // wings of three plates and a covert; the right one is the left one mirrored
    const plate = (len: number, k: number): [THREE.BufferGeometry, THREE.Matrix4] => [feather, place(0, -k * 0.012, -k * 0.06, 0, 0.12 + k * 0.3, 0, len, 1, 0.9)];
    const wingBrass = this.geo(merged([plate(0.58, 0), plate(0.4, 2), [ball(1), place(0.05, 0, 0, 0, 0, 0, 0.1, 0.05, 0.12)]]));
    const wingDeep = this.geo(merged([plate(0.5, 1)]));
    feather.dispose();
    for (const side of [1, -1]) {
      const g = new THREE.Group();
      g.position.set(side * 0.12, 0.05, 0.06);
      const inner = new THREE.Group();
      inner.scale.x = side;
      inner.add(mesh(wingBrass, this.brass), mesh(wingDeep, this.deep));
      g.add(inner);
      m.add(g);
      this.wings.push({ g, side });
    }
    // its golden light: an aura, the ring of a touch, glints in its wake
    this.aura = this.sprite(0xffd060, 0, 1.2);
    this.waveMat = this.light(0xffd767, 0);
    this.wave = turned(mesh(ring(1, 0.04), this.waveMat), Math.PI / 2);
    this.heading.add(this.aura, this.wave);
    const glint = this.lit('#ffd451', '#ffb52e', 0.9);
    for (let k = 0; k < 5; k++) {
      const s = mesh(gem(1), glint);
      this.glints.push(s);
      this.heading.add(s);
    }
    // the burst when it goes
    for (let k = 0; k < 16; k++) {
      const s = mesh(gem(1), glint);
      s.visible = false;
      this.sparks.push({ m: s, v: new THREE.Vector3() });
      this.rig.add(s);
    }
    this.flash = this.sprite(0xffe08a, 0, 2);
    this.flash.visible = false;
    this.rig.add(this.flash);
    // its shadow on the floor
    this.shadowMat = this.basic(0x000000, 0.18);
    this.ground.add(turned(mesh(disc(0.45), this.shadowMat, 0, 0.02, 0), -Math.PI / 2));
  }

  /**
   * The bird's statuses from its snapshot row (`SnapFoe.st`): 金色's v is how many crystals it has touched.
   * FoeView has no way to pass statuses yet, so view.ts has to call this for the bird.
   */
  setStatuses(st: readonly SnapStatus[] | undefined): void {
    const row = st?.find((x) => x[0] === GILDED);
    const n = row ? row[2] : 0;
    if (n > this.touched) this.shine = 1;
    this.touched = n;
  }

  protected pose(dt: number, time: number): void {
    const t = time + this.phase;
    const on = this.fade;
    this.steady(this.ground, 0);
    // which way it flies: from how far the view moved it since the last frame (NaN on the first: standing)
    const p = this.root.position;
    const dx = p.x - this.prev.x;
    const dz = p.z - this.prev.z;
    const moved = Math.hypot(dx, dz);
    this.prev.copy(p);
    const flying = moved > 0.0005 && moved < 2 && !this.gone;
    let swing = 0;
    if (flying) {
      const want = Math.atan2(dx, dz);
      if (Number.isNaN(this.yaw)) this.yaw = want;
      swing = turnTo(this.yaw, want);
      this.yaw += swing * Math.min(1, dt * 5);
    }
    if (Number.isNaN(this.yaw)) this.yaw = this.root.rotation.y;
    this.speed = toward(this.speed, flying ? Math.min(1, moved / Math.max(dt, 0.001) / 3) : 0, 3, dt);
    this.bank = toward(this.bank, Math.max(-0.6, Math.min(0.6, -swing * 1.5)), 4, dt);
    this.heading.rotation.set(this.speed * 0.15, this.yaw - this.root.rotation.y, this.bank);
    // wings beat, faster in flight; the body rises on each down stroke
    this.flap += dt * Math.PI * 2 * (2.2 + this.speed * 1.6);
    const beat = Math.sin(this.flap);
    for (const w of this.wings) w.g.rotation.z = w.side * (0.3 + beat * 0.65);
    this.tail.rotation.y = Math.sin(t * 2) * 0.1;
    this.cogMesh.rotation.z += dt * 2;

    // gold: a step more with each crystal touched (1 − 0.45ⁿ), a flash and a ring of light at each touch
    this.gold = toward(this.gold, 1 - 0.45 ** this.touched, 3, dt);
    this.shine = Math.max(0, this.shine - dt * 1.3);
    const g = this.gold;
    this.brass.color.copy(BRASS).lerp(GOLD, g);
    this.deep.color.copy(BRASS_DEEP).lerp(GOLD_DEEP, g);
    this.brass.emissiveIntensity = (g * 0.45 + this.shine * 1.2) * on;
    this.deep.emissiveIntensity = (g * 0.3 + this.shine * 0.8) * on;
    this.aura.material.opacity = (0.05 + g * 0.45 + this.shine * 0.6) * on;
    this.aura.scale.setScalar(1.1 + g * 0.8 + this.shine * 1.4);
    this.glints.forEach((s, k) => {
      s.visible = g > 0.02;
      const u = (t * 0.9 + k / this.glints.length) % 1;
      s.position.set(Math.sin(t * 3 + k * 2) * 0.12 * (1 + u), Math.cos(t * 2.4 + k) * 0.1 * (1 + u) - u * 0.1, -0.35 - u * 1.1);
      s.scale.setScalar(Math.max(0.001, 0.07 * g * Math.sin(u * Math.PI) * on));
      s.rotation.y = t * 4 + k;
    });

    if (!this.gone) {
      if (this.popT >= 0) this.mend();
      this.flyY = 2 + Math.sin(this.flap - 1.2) * 0.05 + Math.sin(t * 1.1) * 0.08;
      this.steady(this.rig, this.flyY);
      this.wave.visible = this.shine > 0.01;
      this.wave.scale.setScalar(0.4 + (1 - this.shine) * 2.6);
      this.waveMat.opacity = this.shine * 0.8;
      return;
    }
    // gone: it bursts into golden sparks where it was
    if (this.popT < 0) this.burst();
    this.popT += dt;
    this.steady(this.rig, this.flyY);
    this.model.scale.setScalar(Math.max(0.001, 1 - smooth(this.popT / 0.15)));
    for (const s of this.sparks) {
      s.v.multiplyScalar(Math.max(0, 1 - dt * 1.8));
      s.v.y -= dt * 2.5;
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.y += dt * 8;
      s.m.scale.setScalar(Math.max(0.001, 0.09 * clamp01(on * 1.5)));
    }
    this.flash.visible = this.popT < 0.5;
    this.flash.scale.setScalar(1.5 + this.popT * 10);
    this.flash.material.opacity = Math.max(0, 1 - this.popT / 0.5);
    this.wave.visible = this.popT < 0.6;
    this.wave.scale.setScalar(0.4 + this.popT * 6);
    this.waveMat.opacity = Math.max(0, 1 - this.popT / 0.6) * 0.9;
  }

  private burst(): void {
    this.popT = 0;
    const dir = new THREE.Vector3();
    this.sparks.forEach((s, k) => {
      s.m.visible = true;
      s.m.position.set(0, 0, 0);
      s.v.copy(spray(k, this.sparks.length, dir)).multiplyScalar(2.2 + (k % 3) * 0.8);
    });
  }

  /** Whole again (if what went comes back). */
  private mend(): void {
    this.popT = -1;
    this.model.scale.setScalar(1);
    for (const s of this.sparks) s.m.visible = false;
    this.flash.visible = false;
  }
}

// ------------------------------------------------------------------------------------------------ 審判晶石

/**
 * 審判晶石: a long violet-white octahedron of crystal 1.6 m tall with a bright heart, floating with its point
 * 0.6 m off the floor and slowly spinning over a soft violet pool of light, three motes circling it. It pops up
 * with a flash when it appears; when it dies or goes it shatters: a flash, and shards that fly out, bounce on
 * the floor and fade.
 */
export class Crystal extends Shining {
  private readonly stone = new THREE.Group();
  private readonly shell: THREE.MeshToonMaterial;
  private readonly glow: THREE.Sprite;
  private readonly flash: THREE.Sprite;
  private readonly poolMat: THREE.MeshBasicMaterial;
  private readonly motes: THREE.Mesh[] = [];
  private readonly shards: { m: THREE.Mesh; size: THREE.Vector3; v: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  /** seconds since it shattered (-1: whole) */
  private broke = -1;
  private readonly phase = Math.random() * 10;

  constructor() {
    super('crystal', 2.4, false);
    this.shell = this.lit('#e6dcff', '#a77bff', 0.45);
    this.shell.transparent = true;
    this.shell.opacity = 0.86;
    const heart = this.lit('#ffffff', '#e0ccff', 1.1);
    this.stone.position.y = 1.4;
    this.stone.add(sized(mesh(gem(1), this.shell), 0.42, 0.8, 0.42), sized(mesh(gem(1), heart), 0.15, 0.42, 0.15));
    this.glow = this.sprite(0xb48cff, 0.35, 2.6);
    this.glow.position.y = 1.4;
    this.flash = this.sprite(0xeadfff, 0, 2);
    this.flash.position.y = 1.4;
    this.rig.add(this.stone, this.glow, this.flash);
    for (let k = 0; k < 3; k++) {
      const s = mesh(gem(0.07), heart);
      this.motes.push(s);
      this.rig.add(s);
    }
    for (let k = 0; k < 10; k++) {
      const s = mesh(gem(1), this.shell);
      s.visible = false;
      this.shards.push({ m: s, size: new THREE.Vector3(0.06 + (k % 3) * 0.025, 0.18 + (k % 4) * 0.05, 0.06 + (k % 2) * 0.03), v: new THREE.Vector3(), spin: new THREE.Vector3() });
      this.rig.add(s);
    }
    this.poolMat = this.light(0x9a6bff, 0.4, { vertex: true });
    this.ground.add(turned(mesh(this.geo(softDisc(1.5)), this.poolMat, 0, 0.03, 0), -Math.PI / 2));
  }

  protected pose(dt: number, time: number): void {
    const t = time + this.phase;
    const on = this.fade;
    this.steady(this.rig, 0);
    this.steady(this.ground, 0);
    if (this.gone && this.broke < 0) this.shatter();
    if (!this.gone && this.broke >= 0) this.mend();
    const born = popUp(this.age / 0.5);
    this.stone.rotation.y += dt * 0.55;
    this.stone.position.y = 1.4 + Math.sin(t * 1.3) * 0.08;
    this.stone.scale.setScalar(Math.max(0.001, born));
    this.shell.emissiveIntensity = 0.4 + Math.sin(t * 2.1) * 0.12 + this.cast * 0.6;
    this.poolMat.opacity = (0.38 + Math.sin(t * 1.7) * 0.06) * smooth(this.age / 0.4) * on;
    this.motes.forEach((s, k) => {
      const a = t * (0.9 + k * 0.25) + k * 2.1;
      s.position.set(Math.sin(a) * 0.75, 1.0 + k * 0.35 + Math.sin(t * 2 + k) * 0.1, Math.cos(a) * 0.75);
      s.rotation.y = t * 3;
      s.visible = this.broke < 0;
    });
    if (this.broke < 0) {
      this.glow.material.opacity = (0.32 + Math.sin(t * 2.1) * 0.06 + this.cast * 0.2) * born;
      // a flash as it pops up
      this.flash.visible = this.age < 0.45;
      this.flash.scale.setScalar(1.5 + this.age * 5);
      this.flash.material.opacity = Math.max(0, 1 - this.age / 0.45) * 0.9;
      return;
    }
    this.broke += dt;
    this.glow.material.opacity = 0;
    this.flash.visible = this.broke < 0.4;
    this.flash.scale.setScalar(2 + this.broke * 9);
    this.flash.material.opacity = Math.max(0, 1 - this.broke / 0.4);
    for (const s of this.shards) {
      s.v.y -= 9.8 * dt;
      s.m.position.addScaledVector(s.v, dt);
      if (s.m.position.y < 0.06) {
        s.m.position.y = 0.06;
        s.v.set(s.v.x * 0.55, Math.abs(s.v.y) * 0.3, s.v.z * 0.55);
        s.spin.multiplyScalar(0.6);
      }
      s.m.rotation.x += s.spin.x * dt;
      s.m.rotation.z += s.spin.z * dt;
      s.m.scale.copy(s.size).multiplyScalar(Math.max(0.001, clamp01(on * 1.6)));
    }
  }

  private shatter(): void {
    this.broke = 0;
    this.stone.visible = false;
    const dir = new THREE.Vector3();
    this.shards.forEach((s, k) => {
      spray(k, this.shards.length, dir);
      s.m.visible = true;
      s.m.position.set(dir.x * 0.25, this.stone.position.y + dir.y * 0.6, dir.z * 0.25);
      s.m.rotation.set(k, k * 2, 0);
      s.v.set(dir.x * (2.5 + (k % 3)), 1.5 + Math.abs(dir.y) * 2, dir.z * (2.5 + (k % 3)));
      s.spin.set(5 + (k % 4), 0, 4 - (k % 3) * 3);
    });
  }

  private mend(): void {
    this.broke = -1;
    this.stone.visible = true;
    for (const s of this.shards) s.m.visible = false;
  }
}

// ------------------------------------------------------------------------------------------------ the beacons

/**
 * What the two beacons share: an orb hovering 2.5 m up over a pool on the floor, inside a beam of light 6.5 m
 * tall. The orb pops in and the beam grows up out of the floor when it appears; when it goes the orb shrinks,
 * the beam thins and everything fades where it stands.
 */
abstract class Beacon extends Shining {
  protected readonly orb = new THREE.Group();
  protected readonly beam = new THREE.Group();
  private readonly phase = Math.random() * 10;

  constructor(kind: FoeKind) {
    super(kind, ORB + 1, false);
    this.orb.position.y = ORB;
    this.rig.add(this.orb, this.beam);
  }

  protected pose(dt: number, time: number): void {
    const on = this.fade;
    this.steady(this.rig, 0);
    this.steady(this.ground, 0);
    this.orb.scale.setScalar(Math.max(0.001, popUp(this.age / 0.6) * (0.5 + 0.5 * on)));
    this.orb.position.y = ORB + Math.sin((time + this.phase) * 1.2) * 0.1;
    this.beam.scale.set(0.2 + 0.8 * on, Math.max(0.001, smooth(this.age / 0.9)), 0.2 + 0.8 * on);
    this.shine(dt, time + this.phase, on * smooth(this.age / 0.5));
  }

  /** the beacon's own lights this frame; `on` fades them in and out */
  protected abstract shine(dt: number, t: number, on: number): void;
}

/** the light of a beacon's beam up its height: brightest at the orb, fading to the floor and to its top */
const beamShade = (k: number): number => {
  const at = ORB / BEAM;
  return k < at ? 0.3 + 0.7 * smooth(k / at) : (1 - (k - at) / (1 - at)) ** 1.4;
};

/**
 * 光之信標: a white-gold orb of light in a warm glow, gentle rays turning slowly round it, a soft column of light
 * through it and motes of light rising up the beam, over a warm pool on the floor.
 */
export class LightBeacon extends Beacon {
  private readonly core: THREE.MeshToonMaterial;
  private readonly inner: THREE.Sprite;
  private readonly outer: THREE.Sprite;
  private readonly beamCore: THREE.MeshBasicMaterial;
  private readonly beamOuter: THREE.MeshBasicMaterial;
  private readonly raysMat: THREE.MeshBasicMaterial;
  private readonly rays: THREE.Mesh;
  private readonly poolMat: THREE.MeshBasicMaterial;
  private readonly motes: THREE.Mesh[] = [];

  constructor() {
    super('lightBeacon');
    this.core = this.lit('#fffdf2', '#ffe9a8', 1.1);
    this.core.transparent = true;
    this.inner = this.sprite(0xfff6dc, 0.6, 1.35);
    this.outer = this.sprite(0xffd87a, 0.4, 4.4);
    this.orb.add(mesh(ball(0.36), this.core), this.outer, this.inner);
    this.beamCore = this.light(0xfff4d0, 0.4, { vertex: true, soft: true });
    this.beamOuter = this.light(0xffd98a, 0.2, { vertex: true, soft: true });
    this.beam.add(mesh(this.geo(softTube(0.32, BEAM, beamShade)), this.beamCore), mesh(this.geo(softTube(0.85, BEAM, beamShade)), this.beamOuter));
    // rays: crossed bars of light pointing out all round, some up, some down
    this.raysMat = this.light(0xfff0c0, 0, { vertex: true });
    const bar = softBar(0.34, 1, (k) => smooth(k * 4) * (1 - k) ** 1.5);
    const pair = merged([
      [bar, place(0, 0, 0)],
      [bar, place(0, 0, 0, 0, Math.PI / 2)],
    ]);
    bar.dispose();
    const rays: [THREE.BufferGeometry, THREE.Matrix4][] = [];
    for (let k = 0; k < 8; k++) {
      const len = k % 2 ? 1.1 : 1.6;
      const up = k % 2 ? 0.55 : -0.2;
      const yaw = (k / 8) * Math.PI * 2;
      const at = 0.35 + len / 2;
      rays.push([pair, place(Math.cos(up) * Math.sin(yaw) * at, Math.sin(up) * at, Math.cos(up) * Math.cos(yaw) * at, Math.PI / 2 - up, yaw, 0, 1, len, 1)]);
    }
    this.rays = mesh(this.geo(merged(rays)), this.raysMat);
    pair.dispose();
    this.orb.add(this.rays);
    const mote = this.lit('#fffbe8', '#ffe39a', 1.4);
    for (let k = 0; k < 4; k++) {
      const s = mesh(gem(0.07), mote);
      this.motes.push(s);
      this.beam.add(s);
    }
    this.poolMat = this.light(0xffe2a0, 0.4, { vertex: true });
    this.ground.add(turned(mesh(this.geo(softDisc(1.8)), this.poolMat, 0, 0.03, 0), -Math.PI / 2));
  }

  protected shine(dt: number, t: number, on: number): void {
    this.core.emissiveIntensity = (1.0 + Math.sin(t * 2.2) * 0.15) * on;
    this.core.opacity = on;
    this.inner.material.opacity = (0.55 + Math.sin(t * 3) * 0.08) * on;
    this.outer.material.opacity = (0.35 + Math.sin(t * 1.6) * 0.08) * on;
    this.outer.scale.setScalar(4.2 + Math.sin(t * 1.6) * 0.3);
    this.beamCore.opacity = 0.4 * on;
    this.beamOuter.opacity = 0.2 * on;
    this.rays.rotation.y += dt * 0.25;
    this.raysMat.opacity = (0.26 + Math.sin(t * 1.3) * 0.08) * on;
    this.poolMat.opacity = (0.4 + Math.sin(t * 1.7) * 0.06) * on;
    this.motes.forEach((s, k) => {
      const u = (t * 0.25 + k / this.motes.length) % 1;
      const a = t * 1.5 + k * 1.6;
      s.position.set(Math.sin(a) * 0.3, ORB + u * (BEAM - ORB - 0.5), Math.cos(a) * 0.3);
      s.scale.setScalar(Math.max(0.001, Math.sin(u * Math.PI) * on));
      s.rotation.y = t * 3;
    });
  }
}

/**
 * 暗之信標: the light one's counterpart: a black-violet orb ringed in violet, dark arcs of a vortex swirling
 * round it over a haze of darkness, a dark violet column with a thin violet core, dark motes spiralling down
 * into the orb, and a stain of darkness with a violet rim on the floor.
 */
export class DarkBeacon extends Beacon {
  private readonly core: THREE.MeshToonMaterial;
  private readonly rim: THREE.Sprite;
  private readonly haze: THREE.Sprite;
  private readonly arcs: THREE.Group[] = [];
  private readonly arcMat: THREE.MeshToonMaterial;
  private readonly discMat: THREE.MeshBasicMaterial;
  private readonly beamDark: THREE.MeshBasicMaterial;
  private readonly beamCore: THREE.MeshBasicMaterial;
  private readonly stainMat: THREE.MeshBasicMaterial;
  private readonly edgeMat: THREE.MeshBasicMaterial;
  private readonly motes: THREE.Mesh[] = [];

  constructor() {
    super('darkBeacon');
    this.core = this.lit('#1a0f28', '#5a2a9a', 0.25);
    this.rim = this.sprite(0xa45cff, 0.95, 1.35);
    this.haze = this.sprite(0x7a3cd6, 0.4, 4.2);
    this.orb.add(mesh(ball(0.36), this.core), this.haze, this.rim);
    // the vortex: dark arcs swirling round the orb over a haze of darkness
    this.arcMat = this.lit('#2a1342', '#9a5cff', 0.7);
    this.arcMat.transparent = this.core.transparent = true;
    for (const [r, arc, tilt] of [
      [0.62, 4.2, 0.3],
      [0.86, 3.6, -0.15],
      [1.1, 2.9, 0.4],
    ] as const) {
      const tip = new THREE.Group();
      tip.rotation.x = tilt;
      const spin = new THREE.Group();
      spin.add(turned(mesh(ring(r, 0.03 + r * 0.02, arc), this.arcMat), Math.PI / 2));
      tip.add(spin);
      this.arcs.push(spin);
      this.orb.add(tip);
    }
    this.discMat = this.light(0x12081e, 0.6, { vertex: true, plain: true });
    this.orb.add(turned(mesh(this.geo(softDisc(1.35, true)), this.discMat), -Math.PI / 2 + 0.2));
    // the column: darkness with a thin core of violet light
    this.beamDark = this.light(0x2a0d48, 0.55, { vertex: true, soft: true, plain: true });
    this.beamCore = this.light(0x9a50ff, 0.4, { vertex: true, soft: true });
    this.beam.add(mesh(this.geo(softTube(0.8, BEAM, beamShade, true)), this.beamDark), mesh(this.geo(softTube(0.2, BEAM, beamShade)), this.beamCore));
    const mote = this.lit('#2a1342', '#b07aff', 0.9);
    for (let k = 0; k < 4; k++) {
      const s = mesh(gem(0.08), mote);
      this.motes.push(s);
      this.beam.add(s);
    }
    // a stain of darkness on the floor with a violet rim
    this.stainMat = this.light(0x0e0616, 0.55, { vertex: true, plain: true });
    this.edgeMat = this.light(0x9a5cff, 0.5);
    this.ground.add(turned(mesh(this.geo(softDisc(1.9, true)), this.stainMat, 0, 0.03, 0), -Math.PI / 2), turned(mesh(ring(1.1, 0.035), this.edgeMat, 0, 0.04, 0), Math.PI / 2));
  }

  protected shine(dt: number, t: number, on: number): void {
    this.core.emissiveIntensity = (0.25 + Math.sin(t * 2.2) * 0.1) * on;
    this.rim.material.opacity = (0.85 + Math.sin(t * 3) * 0.1) * on;
    this.haze.material.opacity = (0.35 + Math.sin(t * 1.6) * 0.08) * on;
    this.haze.scale.setScalar(4 + Math.sin(t * 1.6) * 0.3);
    this.arcs.forEach((a, k) => (a.rotation.y -= dt * (2.6 - k * 0.6)));
    this.arcMat.emissiveIntensity = (0.6 + Math.sin(t * 2.5) * 0.15) * on;
    this.arcMat.opacity = on;
    this.core.opacity = on;
    this.discMat.opacity = 0.6 * on;
    this.beamDark.opacity = 0.55 * on;
    this.beamCore.opacity = 0.4 * on;
    this.stainMat.opacity = 0.55 * on;
    this.edgeMat.opacity = (0.45 + Math.sin(t * 1.7) * 0.08) * on;
    this.motes.forEach((s, k) => {
      const u = (t * 0.22 + k / this.motes.length) % 1;
      const a = -t * 2 + k * 1.6;
      const r = 0.5 * (1 - u) + 0.1;
      s.position.set(Math.sin(a) * r, BEAM - 0.5 - u * (BEAM - 0.5 - ORB), Math.cos(a) * r);
      s.scale.setScalar(Math.max(0.001, Math.sin(u * Math.PI) * on));
      s.rotation.y = t * 3;
    });
  }
}
