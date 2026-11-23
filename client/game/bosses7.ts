import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FoeKind } from '../../shared/bosses/foes';
import { FoeBase } from './foebase';
import { ball, box, cone, cyl, disc, gem, mesh, ring } from './models';

/**
 * The foes of 時律機神殿 (the ultimate, v0.7), built in code like those in bosses.ts and bosses4.ts
 * (section 八): P1's 水銀核心 and the 水銀之手 that rises beside it, both of living quicksilver, the
 * clockwork 獵殺人偶 that each hunt one player, and 凍核's 冰塊 that players hide behind. Models of our own
 * design; they face +z.
 */

/** Quicksilver: silver-blue metal, its shade, the cyan of its glints, and the grey it dulls to while it cannot be targeted. */
const SILVER = '#b8c8e0';
const SHADE = '#8fa3c4';
const GLINT = '#7fe0ff';
const DULL = new THREE.Color('#6c7484');
/** The doll's brass and copper, and the orange they glow while its exhaust burst builds up. */
const BRASS = '#c99a3e';
const COPPER = '#b5653a';
const HOT = '#ff6a2a';

/** How long the hand keeps a 合掌 or 握拳 pose after the cast ends, and how long a leap takes, seconds. */
const HOLD = 1.5;
const HOP_TIME = 1.3;

const Z = new THREE.Vector3(0, 0, 1);
const tmp = new THREE.Vector3();

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** 0 → 1, eased at both ends */
function smooth(v: number): number {
  const k = clamp01(v);
  return k * k * (3 - 2 * k);
}

/** 0 → 1 with a small overshoot at the end: what bursts up out of the floor */
function popUp(v: number): number {
  const u = clamp01(v) - 1;
  return 1 + 2.7 * u * u * u + 1.7 * u * u;
}

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

/**
 * A liquid surface: a shape whose vertices are pushed out or in every frame by `push(x, y, z)` (given where
 * the vertex is at rest, a fraction of its distance from the centre; with `round` false, from the y axis, so
 * a column ripples but keeps its height). The seams are welded first so the normals stay smooth.
 */
class Ripple {
  readonly geometry: THREE.BufferGeometry;
  private readonly rest: Float32Array;

  constructor(
    shape: THREE.BufferGeometry,
    private readonly round = true,
  ) {
    shape.deleteAttribute('normal');
    shape.deleteAttribute('uv');
    this.geometry = mergeVertices(shape);
    shape.dispose();
    this.geometry.computeVertexNormals();
    this.rest = (this.geometry.getAttribute('position') as THREE.BufferAttribute).array.slice() as Float32Array;
    // the surface swells by a quarter at most: keep it from being culled while still on screen
    this.geometry.computeBoundingSphere();
    this.geometry.boundingSphere!.radius *= 1.3;
  }

  update(push: (x: number, y: number, z: number) => number): void {
    const at = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = at.array as Float32Array;
    const r = this.rest;
    for (let i = 0; i < r.length; i += 3) {
      const k = 1 + push(r[i], r[i + 1], r[i + 2]);
      p[i] = r[i] * k;
      p[i + 1] = this.round ? r[i + 1] * k : r[i + 1];
      p[i + 2] = r[i + 2] * k;
    }
    at.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}

/**
 * What the foes here share, like Rigged in bosses4.ts: the model hangs on `rig` (hover, leaps, shakes) so
 * FoeBase can still sink `body` when the foe is gone; walking is read from how far the engine moved the root
 * since the last frame; act('jump') starts a leap; `age` counts from when it appeared (they rise into view).
 */
abstract class Figure extends FoeBase {
  protected readonly rig = new THREE.Group();
  /** 0 standing … 1 walking, eased */
  protected stride = 0;
  /** the walk cycle (radians), advanced by the distance walked so the feet do not slide */
  protected walk = 0;
  /** 0 … 1 while it casts, eased */
  protected cast = 0;
  /** seconds since it appeared */
  protected age = 0;
  private readonly last = new THREE.Vector3(NaN, 0, NaN);
  private hopT = -1;

  /** `pace`: metres walked per walk cycle */
  constructor(
    kind: FoeKind,
    height: number,
    ticks: boolean,
    private readonly pace = 3,
  ) {
    super(kind, height, ticks);
    this.body.add(this.rig);
  }

  act(move: string): void {
    if (move === 'jump') this.hopT = 0;
  }

  protected animate(dt: number, time: number): void {
    const p = this.root.position;
    const moved = Math.hypot(p.x - this.last.x, p.z - this.last.z); // NaN on the first frame: standing
    this.last.copy(p);
    const walking = moved > 0.002 && this.hopT < 0;
    this.stride += ((walking ? 1 : 0) - this.stride) * Math.min(1, dt * 8);
    if (walking) this.walk += (Math.min(moved, dt * 8) / this.pace) * Math.PI * 2;
    this.cast += ((this.casting ? 1 : 0) - this.cast) * Math.min(1, dt * 5);
    if (this.hopT >= 0) {
      this.hopT += dt;
      if (this.hopT >= HOP_TIME) this.hopT = -1;
    }
    this.age += dt;
    this.pose(dt, time);
  }

  /** The model's own animation for this frame. */
  protected abstract pose(dt: number, time: number): void;

  /** 0 → 1 → 0 over a leap */
  protected get hop(): number {
    return this.hopT < 0 ? 0 : Math.sin((this.hopT / HOP_TIME) * Math.PI);
  }

  /** a quick shudder right after a hit */
  protected jolt(time: number, amount: number): number {
    return Math.sin(time * 40) * amount * this.shake;
  }

  /** A cartoon material of its own that glows in `emissive` (the intensity is set per frame). */
  protected lit(color: string, emissive: string, glow = 0): THREE.MeshToonMaterial {
    const m = this.toonOwn(color);
    m.emissive.set(emissive);
    m.emissiveIntensity = glow;
    return m;
  }

  /** A see-through glow added onto what is behind it. */
  protected halo(color: number, opacity: number): THREE.MeshBasicMaterial {
    const m = this.basic(color, opacity);
    m.blending = THREE.AdditiveBlending;
    return m;
  }
}

/** the blob's radius at rest and the height of its centre, metres */
const BLOB = 1.85;
const FLOAT = 2.45;
/** where the core sits in the blob: in front, turned a little up so the camera sees it from above */
const FRONT = new THREE.Vector3(0, 0.2, 1).normalize();

/**
 * 水銀核心: a living blob of quicksilver about 3.7 m across, floating over its shadow. It never keeps still:
 * its surface swells and ripples, beads of metal circle it and sink back in, drops fall from its underside
 * and ring out on the floor, and white and cyan glints run over it. Its core, a cyan orb in a dark ring at
 * the front, blazes while it casts (the ripples quicken, the beads draw in and it takes a cyan sheen). It
 * glides after the tank, leaning and stretching into the way it goes, goes dull and slow while it cannot be
 * targeted, and melts flat into the floor when it dies.
 */
export class Liquid extends Figure {
  private readonly skin = new Ripple(new THREE.SphereGeometry(1, 44, 30));
  private readonly blob: THREE.Mesh;
  private readonly metal: THREE.MeshToonMaterial;
  private readonly shade: THREE.MeshToonMaterial;
  private readonly heart: THREE.MeshToonMaterial;
  private readonly aura: THREE.MeshBasicMaterial;
  private readonly dark: THREE.MeshBasicMaterial;
  private readonly shadow: THREE.Mesh;
  private readonly eye = new THREE.Group();
  private readonly glow: THREE.Mesh;
  private readonly glints: { m: THREE.Mesh; dir: THREE.Vector3 }[] = [];
  private readonly sparks: { m: THREE.Mesh; from: THREE.Vector3; side: THREE.Vector3; speed: number }[] = [];
  private readonly beads: { m: THREE.Mesh; size: number; far: number; y: number; speed: number; phase: number; angle: number }[] = [];
  private readonly drops: { drop: THREE.Mesh; splash: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number }[] = [];
  /** the blob's stretch this frame */
  private readonly size = new THREE.Vector3(1, 1, 1);
  /** the ripple clock: it runs faster while it casts or moves */
  private flow = 0;
  private amp = 1;
  private dull = 0;

  constructor() {
    super('liquid', 4.6, true, 5);
    this.metal = this.lit(SILVER, GLINT);
    this.shade = this.toonOwn(SHADE);
    this.heart = this.lit('#c4f4ff', GLINT, 1.2);
    const sheen = this.lit('#ffffff', '#ffffff', 0.6);
    const spark = this.lit(GLINT, GLINT, 0.9);
    this.aura = this.halo(0x7fe0ff, 0.06);
    this.dark = this.basic(0x000000, 0.22);
    // its shadow stays on the floor (on body, not the rig) while it hovers
    this.shadow = turned(mesh(disc(1), this.dark, 0, 0.02, 0), -Math.PI / 2);
    this.body.add(this.shadow);
    this.geo(this.skin.geometry);
    this.blob = mesh(this.skin.geometry, this.metal);
    this.rig.add(this.blob);
    // the core: a cyan orb in a dark ring, set into the front of the surface
    this.eye.quaternion.setFromUnitVectors(Z, FRONT);
    const orb = mesh(ball(0.44), this.heart);
    orb.scale.z = 0.75;
    this.glow = mesh(ball(0.6), this.aura);
    this.eye.add(mesh(ring(0.52, 0.11), this.shade), orb, this.glow);
    this.rig.add(this.eye);
    // white glints on its top, where the light catches it
    for (const [x, y, z, s] of [
      [-0.42, 0.8, 0.42, 1],
      [-0.1, 0.95, 0.28, 0.55],
      [0.5, 0.62, -0.6, 0.7],
    ] as const) {
      const dir = new THREE.Vector3(x, y, z).normalize();
      const m = sized(mesh(ball(1), sheen), 0.44 * s, 0.15 * s, 0.03);
      m.quaternion.setFromUnitVectors(Z, dir);
      this.glints.push({ m, dir });
      this.rig.add(m);
    }
    // cyan sparks running over it on tilted great circles
    for (let k = 0; k < 4; k++) {
      const axis = new THREE.Vector3(Math.sin(k * 2.4), 1.4, Math.cos(k * 2.4)).normalize();
      const from = new THREE.Vector3(Math.cos(k * 1.7), 0, Math.sin(k * 1.7));
      from.addScaledVector(axis, -from.dot(axis)).normalize();
      const m = mesh(gem(0.13), spark);
      this.sparks.push({ m, from, side: axis.clone().cross(from), speed: 0.5 + k * 0.13 });
      this.rig.add(m);
    }
    // beads of metal circling it
    for (let k = 0; k < 6; k++) {
      const m = mesh(ball(1), this.metal);
      const phase = k * 1.05;
      this.beads.push({ m, size: 0.22 + (k % 3) * 0.08, far: 2.3 + ((k * 2) % 3) * 0.22, y: -0.6 + ((k * 5) % 6) * 0.24, speed: 0.5 + (k % 4) * 0.1, phase, angle: phase });
      this.rig.add(m);
    }
    // drops that fall from its underside and ring out on the floor
    for (const [x, z, phase] of [
      [0.3, 0.2, 0],
      [-0.35, -0.15, 0.5],
    ] as const) {
      const mat = this.basic(0xdde8f6, 0);
      const splash = turned(mesh(ring(1, 0.05), mat, x, 0.04, z), Math.PI / 2);
      const drop = mesh(ball(1), this.metal, x, 0, z);
      this.body.add(drop, splash);
      this.drops.push({ drop, splash, mat, phase });
    }
  }

  /**
   * How far the surface is pushed out (a fraction of the radius) in the direction (x, y, z) this frame:
   * slow waves on slanted axes (waves along x, y and z alone would square it off) and a faster ripple.
   */
  private swell(x: number, y: number, z: number): number {
    const t = this.flow;
    return (
      this.amp *
      (0.06 * Math.sin(1.9 * x + 1.4 * y + 1.9 * t) +
        0.05 * Math.sin(2.4 * z - 1.1 * x + 2.3 * t + 1.3) +
        0.045 * Math.sin(2.6 * y + 1.8 * z - 1.7 * t + 0.7) +
        0.025 * Math.sin(4 * (x - y + z) + 2.9 * t + 2.1))
    );
  }

  /** The point of the surface in the direction d (a unit vector), `lift` metres out from it, into out. */
  private onSurface(d: THREE.Vector3, lift: number, out: THREE.Vector3): THREE.Vector3 {
    const k = BLOB * (1 + this.swell(d.x, d.y, d.z)) + lift;
    return out.set(d.x * k * this.size.x, d.y * k * this.size.y, d.z * k * this.size.z);
  }

  protected pose(dt: number, time: number): void {
    const on = this.fade;
    const cast = this.cast;
    const sw = this.stride;
    const hop = this.hop;
    this.dull += ((this.untargetable && !this.gone ? 1 : 0) - this.dull) * Math.min(1, dt * 3);
    const live = 1 - this.dull * 0.7;
    this.flow += dt * (1 + cast * 1.3 + sw * 0.5) * live;
    this.amp = (1 + cast * 0.4) * (1 - this.dull * 0.4);
    // it breathes, stretches into the way it goes and upwards in a leap, and melts flat when it dies
    const melt = 1 - on;
    const sy = 0.93 + Math.sin(time * 1.3) * 0.04 - sw * 0.06 + hop * 0.2;
    const sx = (1 / Math.sqrt(sy)) * (1 + melt * 0.5);
    this.size.set(sx, sy * (1 - melt * 0.65), sx * (1 + sw * 0.12));
    const r = this.rig;
    r.position.y = FLOAT + Math.sin(time * 1.1) * 0.12 + hop * 3.2;
    r.rotation.x = sw * 0.16 + Math.sin(time * 0.7) * 0.03;
    r.rotation.z = Math.sin(time * 0.9) * 0.04 + this.jolt(time, 0.04);
    this.skin.update((x, y, z) => this.swell(x, y, z));
    this.blob.scale.copy(this.size).multiplyScalar(BLOB);
    this.onSurface(FRONT, -0.1, this.eye.position);
    this.eye.scale.setScalar(1 + cast * 0.15 + Math.sin(time * 2.4) * 0.04);
    for (const g of this.glints) {
      this.onSurface(g.dir, 0.015, g.m.position);
      g.m.visible = this.dull < 0.5;
    }
    this.sparks.forEach((s, k) => {
      const a = time * s.speed + k * 1.6;
      tmp.copy(s.from).multiplyScalar(Math.cos(a)).addScaledVector(s.side, Math.sin(a));
      this.onSurface(tmp, 0.03, s.m.position);
      s.m.rotation.y = time * 3 + k;
      s.m.scale.setScalar(Math.max(0.001, (0.45 + 0.6 * Math.max(0, Math.sin(time * 4 + k * 2))) * (1 + cast * 0.5) * (1 - this.dull) * on));
    });
    for (const b of this.beads) {
      b.angle += dt * b.speed * (1 + cast * 1.4) * live;
      // now and then a bead sinks back into the blob and comes out again; while it casts they draw in
      const out = smooth(Math.sin(time * 0.42 + b.phase) * 1.6 + 0.6) * (1 - cast * 0.5);
      const far = (BLOB * 0.9 + (b.far - BLOB * 0.9) * out) * sx;
      b.m.position.set(Math.sin(b.angle) * far, b.y * (0.6 + 0.4 * out) + Math.sin(b.angle * 2 + b.phase) * 0.15, Math.cos(b.angle) * far - sw * 0.6 * out);
      b.m.scale.setScalar(b.size * (0.6 + 0.4 * out) * on);
    }
    // the underside, measured from the floor (the drops hang on body, which stays down)
    const bottom = r.position.y - BLOB * this.size.y * (1 + this.swell(0, -1, 0));
    for (const d of this.drops) {
      const u = (time / 1.8 + d.phase) % 1;
      const grow = clamp01(u / 0.4);
      const fall = clamp01((u - 0.4) / 0.22);
      d.drop.visible = u < 0.62 && hop === 0 && !this.gone;
      d.drop.position.y = u < 0.4 ? bottom + 0.05 - grow * 0.1 : (bottom - 0.05) * (1 - fall * fall);
      d.drop.scale.set(0.11 * grow, (0.15 + fall * 0.08) * grow, 0.11 * grow);
      const s = clamp01((u - 0.62) / 0.38);
      d.splash.scale.setScalar(0.15 + s * 0.85);
      d.mat.opacity = u < 0.62 ? 0 : (1 - s) * 0.6 * on;
    }
    this.shadow.scale.setScalar(BLOB * 0.95 * sx * (1 - hop * 0.4));
    this.dark.opacity = 0.22 * on * (1 - hop * 0.5);
    this.metal.color.set(SILVER).lerp(DULL, this.dull * 0.7);
    this.shade.color.set(SHADE).lerp(DULL, this.dull * 0.7);
    this.metal.emissiveIntensity = cast * 0.08 * on;
    this.heart.emissiveIntensity = (1.1 + Math.sin(time * 2.4) * 0.25 + cast * (1.6 + Math.sin(time * 10) * 0.4)) * on * (1 - this.dull * 0.75);
    this.aura.opacity = (0.06 + cast * (0.22 + Math.sin(time * 9) * 0.06)) * on * live;
    this.glow.scale.setScalar(1 + cast * 0.25);
  }
}

/** A pose of the hand; it blends between three. */
interface Grip {
  /** how far each finger bends at its three joints, knuckle first (radians, towards the palm) */
  curl: readonly [number, number, number];
  /** how far the fingers fan out (× each finger's own angle) */
  fan: number;
  /** the thumb's root turned forward (x) and to the side (z: - out, + across the palm), then its two joints bent across */
  thumb: readonly [x: number, z: number, bend1: number, bend2: number];
  /** the hand tipped back at the wrist (-: palm up) or forward, radians */
  tilt: number;
  /** the arm risen out of its pool (+) or sunk into it, metres */
  lift: number;
}

const LOOSE: Grip = { curl: [0.22, 0.38, 0.25], fan: 0.3, thumb: [0.3, -0.45, 0.15, 0.1], tilt: -0.08, lift: 0 };
const OPEN: Grip = { curl: [-0.12, 0, 0.03], fan: 1.1, thumb: [0.15, -1.0, -0.05, 0], tilt: -0.4, lift: 0.4 };
const FIST: Grip = { curl: [1.45, 1.75, 1.25], fan: -0.05, thumb: [0.5, 0.42, 0.6, 0.5], tilt: 0.1, lift: -0.2 };

/** index (next to the thumb, +x), middle, ring and little finger: where it leaves the palm, its length, thickness and fan */
const FINGERS = [
  { x: 0.44, y: 1.28, len: 1.04, r: 0.14, fan: -0.24 },
  { x: 0.15, y: 1.32, len: 1.16, r: 0.145, fan: -0.07 },
  { x: -0.15, y: 1.29, len: 1.07, r: 0.14, fan: 0.1 },
  { x: -0.43, y: 1.2, len: 0.86, r: 0.12, fan: 0.3 },
] as const;
/** each finger's three bones, as parts of its length */
const PHALANX = [0.44, 0.31, 0.25] as const;

/**
 * 水銀之手: a right hand of the same quicksilver, about 4 m tall, risen out of a pool on the floor (it rises
 * when it appears and sinks back when it is gone). Its pose is the tell: while it casts a 合掌 move it opens
 * wide, fingers fanned and the palm turned up with a cyan sigil burning on it; for a 握拳 move it clenches
 * into a fist, lower down, and trembles; otherwise it rests half open, the fingers flexing in turn. A pose
 * is held 1.5 s after its cast ends so the players see it resolve. The fingertips and knuckles glint cyan
 * and blaze while it casts; ripples climb the arm, drops run down it and rings spread on the pool.
 */
export class Hand extends Figure {
  private readonly pool = new THREE.Group();
  private readonly arm = new THREE.Group();
  private readonly wrist = new THREE.Group();
  private readonly column = new Ripple(new THREE.CylinderGeometry(0.5, 0.74, 1.7, 24, 10, true), false);
  private readonly fingers: { joints: THREE.Group[]; fan: number }[] = [];
  private readonly thumb: THREE.Group[] = [];
  private readonly runs: THREE.Mesh[] = [];
  private readonly waves: [THREE.Mesh, THREE.MeshBasicMaterial][] = [];
  private readonly sigil = new THREE.Group();
  private readonly metal: THREE.MeshToonMaterial;
  private readonly shade: THREE.MeshToonMaterial;
  private readonly tip: THREE.MeshToonMaterial;
  private readonly knuckle: THREE.MeshToonMaterial;
  private readonly sigilLine: THREE.MeshBasicMaterial;
  private readonly sigilFill: THREE.MeshBasicMaterial;
  /** the pose asked for (0 loose, 1 open, 2 fist) and how much longer it is held after its cast */
  private grip = 0;
  private hold = 0;
  private open = 0;
  private fist = 0;
  private flow = 0;
  private dull = 0;

  constructor() {
    super('hand', 4.4, true);
    this.metal = this.lit(SILVER, GLINT);
    this.shade = this.toonOwn(SHADE);
    this.tip = this.lit('#d4e2f4', GLINT, 0.25);
    this.knuckle = this.lit(SILVER, GLINT);
    this.sigilLine = this.halo(0x7fe0ff, 0);
    this.sigilFill = this.halo(0x7fe0ff, 0);
    // the pool, with a darker rim and rings spreading on it
    this.pool.add(sized(mesh(ball(1), this.metal), 1.8, 0.07, 1.8));
    this.pool.add(turned(mesh(ring(1.78, 0.07), this.shade, 0, 0.02, 0), Math.PI / 2));
    for (let k = 0; k < 2; k++) {
      const mat = this.basic(0xe6eef9, 0);
      const m = turned(mesh(ring(1, 0.035), mat, 0, 0.075, 0), Math.PI / 2);
      this.waves.push([m, mat]);
      this.pool.add(m);
    }
    this.rig.add(this.pool);
    // the arm: a rippling column out of a swell in the pool, drops running down it
    const a = this.arm;
    a.add(sized(mesh(ball(1), this.metal, 0, 0.06, 0), 0.98, 0.3, 0.98));
    a.add(turned(mesh(ring(0.8, 0.15), this.metal, 0, 0.14, 0), Math.PI / 2));
    this.geo(this.column.geometry);
    a.add(mesh(this.column.geometry, this.metal, 0, 0.85, 0));
    for (let k = 0; k < 2; k++) {
      const m = mesh(ball(1), this.metal);
      this.runs.push(m);
      a.add(m);
    }
    // the hand: wrist, palm (facing +z) with the balls of the thumb and the little finger
    const w = this.wrist;
    w.position.y = 1.62;
    w.add(sized(mesh(ball(0.52), this.metal, 0, 0.06, 0), 1.08, 0.75, 0.88));
    w.add(mesh(this.geo(new RoundedBoxGeometry(1.24, 1.36, 0.46, 3, 0.19)), this.metal, 0, 0.66, 0));
    w.add(sized(mesh(ball(1), this.metal, 0.4, 0.38, 0.1), 0.32, 0.46, 0.15));
    w.add(sized(mesh(ball(1), this.metal, -0.43, 0.44, 0.08), 0.26, 0.42, 0.15));
    // the fingers: three bones each, bending at the joints; a knuckle on the back of the hand
    for (const f of FINGERS) {
      const joints: THREE.Group[] = [];
      let parent: THREE.Object3D = w;
      let at = new THREE.Vector3(f.x, f.y, 0);
      PHALANX.forEach((part, k) => {
        const len = f.len * part;
        const j = new THREE.Group();
        j.position.copy(at);
        j.add(mesh(this.geo(new THREE.CapsuleGeometry(f.r * (1 - k * 0.06), len, 4, 12)), k === 2 ? this.tip : this.metal, 0, len / 2, 0));
        parent.add(j);
        joints.push(j);
        parent = j;
        at = new THREE.Vector3(0, len, 0);
      });
      // fanned out in the palm's plane, then bent in its own
      joints[0].rotation.order = 'ZXY';
      w.add(sized(mesh(ball(1), this.knuckle, f.x, f.y - 0.04, -0.13), f.r * 1.05));
      this.fingers.push({ joints, fan: f.fan });
    }
    // the thumb, from the ball of the thumb
    let parent: THREE.Object3D = w;
    let at = new THREE.Vector3(0.48, 0.4, 0.14);
    for (const [len, r] of [
      [0.42, 0.17],
      [0.36, 0.158],
      [0.3, 0.148],
    ] as const) {
      const j = new THREE.Group();
      j.position.copy(at);
      j.add(mesh(this.geo(new THREE.CapsuleGeometry(r, len, 4, 12)), this.thumb.length === 2 ? this.tip : this.metal, 0, len / 2, 0));
      parent.add(j);
      this.thumb.push(j);
      parent = j;
      at = new THREE.Vector3(0, len, 0);
    }
    this.thumb[0].rotation.order = 'ZXY';
    // the sigil that burns on the open palm: two rings and six rays
    this.sigil.position.set(0, 0.74, 0.25);
    this.sigil.add(mesh(ring(0.38, 0.035), this.sigilLine), mesh(ring(0.16, 0.03), this.sigilLine), mesh(disc(0.36), this.sigilFill));
    for (let k = 0; k < 6; k++) {
      const ang = (k * Math.PI) / 3;
      this.sigil.add(turned(mesh(box(0.045, 0.15, 0.01), this.sigilLine, Math.sin(ang) * 0.27, Math.cos(ang) * 0.27, 0), 0, 0, -ang));
    }
    w.add(this.sigil);
    a.add(w);
    this.rig.add(a);
  }

  protected pose(dt: number, time: number): void {
    // the pose its cast asks for, held a moment after the cast so the players see it resolve; else loose
    const want = this.casting?.includes('合掌') ? 1 : this.casting?.includes('握拳') ? 2 : 0;
    if (want) {
      this.grip = want;
      this.hold = HOLD;
    } else {
      this.hold -= dt;
      if (this.hold <= 0) this.grip = 0;
    }
    const ease = Math.min(1, dt * 7);
    this.open += ((this.grip === 1 ? 1 : 0) - this.open) * ease;
    this.fist += ((this.grip === 2 ? 1 : 0) - this.fist) * ease;
    const o = this.open;
    const f = this.fist;
    const loose = 1 - o - f;
    const mix = (pick: (g: Grip) => number): number => pick(LOOSE) * loose + pick(OPEN) * o + pick(FIST) * f;
    this.dull += ((this.untargetable && !this.gone ? 1 : 0) - this.dull) * Math.min(1, dt * 3);
    const on = this.fade;

    // it rises out of its pool when it appears and sinks back into it when it is gone (the pool stays on
    // the floor while FoeBase sinks the rest, and shrinks); a fist trembles
    this.pool.scale.setScalar(Math.max(0.001, smooth(this.age / 0.4) * (0.4 + 0.6 * on)));
    this.pool.position.y = -this.body.position.y / this.body.scale.y;
    this.arm.position.set(
      Math.sin(time * 37) * 0.02 * f + this.jolt(time, 0.05),
      (popUp((this.age - 0.25) / 1.1) - 1) * 4.6 + mix((g) => g.lift) + Math.sin(time * 1.2) * 0.04 * loose - (1 - on) * 1.5,
      0,
    );
    this.wrist.rotation.set(mix((g) => g.tilt) + Math.sin(time * 0.9) * 0.04 * loose, 0, Math.sin(time * 0.7) * 0.06 * loose + Math.sin(time * 33) * 0.025 * f);
    this.fingers.forEach((finger, k) => {
      const flex = Math.sin(time * 1.5 - k * 0.7) * 0.12 * loose; // loose fingers flex in turn
      finger.joints.forEach((j, n) => {
        j.rotation.x = mix((g) => g.curl[n]) + flex;
      });
      finger.joints[0].rotation.z = finger.fan * mix((g) => g.fan);
    });
    const [t0, t1, t2] = this.thumb;
    t0.rotation.set(mix((g) => g.thumb[0]), 0, mix((g) => g.thumb[1]));
    t1.rotation.z = mix((g) => g.thumb[2]);
    t2.rotation.z = mix((g) => g.thumb[3]);

    // ripples climb the arm, drops run down it, rings spread on the pool
    this.flow += dt * (1 + this.cast * 0.8) * (1 - this.dull * 0.6);
    const t = this.flow;
    this.column.update((x, y, z) => 0.07 * Math.sin(6 * y - 3 * t + 2 * Math.atan2(z, x)) + 0.04 * Math.sin(10 * y + 4.2 * t));
    this.runs.forEach((m, k) => {
      const u = (time / 1.7 + k * 0.5) % 1;
      const y = 1.55 - u * 1.4;
      const rad = 0.77 - (y / 1.7) * 0.24;
      const ang = 0.7 + k * 2.6;
      m.position.set(Math.cos(ang) * rad, y, Math.sin(ang) * rad);
      const s = Math.min(1, u * 8) * (1 - this.dull) * on;
      m.scale.set(0.08 * s, 0.13 * s, 0.08 * s);
    });
    this.waves.forEach(([m, mat], k) => {
      const u = (time / 2.4 + k * 0.5) % 1;
      m.scale.setScalar(0.9 + u * 0.8);
      mat.opacity = (1 - u) * 0.55 * on * (1 - this.dull * 0.5);
    });

    this.metal.color.set(SILVER).lerp(DULL, this.dull * 0.7);
    this.shade.color.set(SHADE).lerp(DULL, this.dull * 0.7);
    this.knuckle.color.copy(this.metal.color);
    this.metal.emissiveIntensity = this.cast * 0.06 * on;
    // the fingertips blaze while it casts, the knuckles too while it makes a fist (its tips are hidden then)
    const blaze = this.cast * (1.3 + Math.sin(time * 9) * 0.3) * on * (1 - this.dull * 0.8);
    this.tip.emissiveIntensity = (0.25 + Math.sin(time * 2) * 0.08) * on * (1 - this.dull * 0.8) + blaze;
    this.knuckle.emissiveIntensity = blaze * f;
    const burn = o * (0.8 + Math.sin(time * 7) * 0.2) * on;
    this.sigilLine.opacity = burn;
    this.sigilFill.opacity = burn * 0.35;
    this.sigil.visible = burn > 0.01;
    this.sigil.rotation.z = time * 0.8;
  }
}

/**
 * 獵殺人偶: a clockwork doll about 1.4 m tall: a round brass body with a riveted copper band and a little
 * clock face, a round head with ear discs, a winding knob and one glowing red-orange eye, stubby legs and
 * arms, two exhaust pipes puffing steam, and a wind-up key turning on its back. It toddles after its quarry
 * (bobbing on its stubby legs and rocking side to side) with the key turning faster. While it casts an
 * exhaust burst (排氣) it builds up pressure: it glows hotter and hotter, shakes, swells, spreads its arms,
 * the key whirls and steam pours out; when the cast ends the pressure goes in one puff. Shot down, it
 * topples over.
 */
export class Doll extends Figure {
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly trunk = new THREE.Group();
  private readonly head = new THREE.Group();
  /** the key's handle */
  private readonly bow = new THREE.Group();
  /** the clock face's hour and minute hands */
  private readonly clock: THREE.Group[] = [];
  private readonly puffs: { m: THREE.Mesh; at: THREE.Vector3; phase: number }[] = [];
  private readonly brass: THREE.MeshToonMaterial;
  private readonly copper: THREE.MeshToonMaterial;
  private readonly eye: THREE.MeshToonMaterial;
  private readonly eyeGlow: THREE.MeshBasicMaterial;
  private readonly heat: THREE.MeshBasicMaterial;
  private readonly heatBall: THREE.Mesh;
  /** so two dolls do not toddle in step */
  private readonly phase = Math.random() * 10;
  /** 0 … 1 while the exhaust burst builds up, eased */
  private vent = 0;
  private venting = false;
  /** seconds since the pressure went (-1: not now) */
  private popT = -1;
  private spin = 0;
  private steam = 0;
  private throb = 0;

  constructor() {
    super('doll', 1.5, false, 0.75);
    this.brass = this.lit(BRASS, HOT);
    this.copper = this.lit(COPPER, HOT);
    const dark = this.toonOwn('#5a3a22');
    const face = this.toonOwn('#f2e4c0');
    const ink = this.toonOwn('#3a2a1e');
    this.eye = this.lit('#ff6a3a', '#ff6a3a', 1.2);
    this.eyeGlow = this.halo(0xff7a3a, 0.2);
    this.heat = this.halo(0xff7a2a, 0);
    const steam = this.basic(0xf2efe8, 0.6);
    const r = this.rig;
    // stubby legs from the hips, round feet
    for (const s of [1, -1]) {
      const leg = new THREE.Group();
      leg.position.set(s * 0.15, 0.36, 0);
      leg.add(mesh(cyl(0.085, 0.1, 0.24, 10), this.copper, 0, -0.12, 0));
      leg.add(sized(mesh(ball(1), this.brass, 0, -0.28, 0.04), 0.13, 0.08, 0.18));
      this.legs.push(leg);
      r.add(leg);
    }
    // the round body: a copper band with rivets, a clock face on the front
    const t = this.trunk;
    t.position.y = 0.68;
    t.add(sized(mesh(ball(0.37), this.brass), 1, 0.95, 1));
    t.add(turned(mesh(ring(0.37, 0.045), this.copper, 0, -0.03, 0), Math.PI / 2));
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * Math.PI * 2;
      t.add(mesh(ball(0.03), dark, Math.sin(a) * 0.41, -0.03, Math.cos(a) * 0.41));
    }
    const dial = new THREE.Group();
    dial.position.set(0, 0.14, 0.32);
    dial.rotation.x = -0.36; // tipped up with the curve of the body
    dial.add(turned(mesh(cyl(0.15, 0.15, 0.06, 20), face), Math.PI / 2), mesh(ring(0.15, 0.025), this.copper, 0, 0, 0.03));
    for (const [len, wide] of [
      [0.09, 0.026],
      [0.13, 0.018],
    ] as const) {
      const hand = new THREE.Group();
      hand.position.z = 0.035;
      hand.add(mesh(box(wide, len, 0.01), ink, 0, len / 2, 0));
      dial.add(hand);
      this.clock.push(hand);
    }
    t.add(dial);
    // stubby arms with round hands, splayed a little so they clear the body
    for (const s of [1, -1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 0.36, 0.1, 0);
      arm.add(mesh(ball(0.07), dark));
      arm.add(mesh(cyl(0.06, 0.07, 0.26, 8), this.copper, 0, -0.13, 0));
      arm.add(mesh(ball(0.085), this.brass, 0, -0.3, 0));
      this.arms.push(arm);
      t.add(arm);
    }
    // two exhaust pipes on its back that puff steam
    const tips: THREE.Vector3[] = [];
    for (const s of [1, -1]) {
      t.add(turned(mesh(cyl(0.045, 0.055, 0.26, 8), this.copper, s * 0.17, 0.32, -0.2), -0.5));
      tips.push(new THREE.Vector3(s * 0.17, 0.32 + Math.cos(0.5) * 0.14, -0.2 - Math.sin(0.5) * 0.14));
    }
    for (let k = 0; k < 6; k++) {
      const m = mesh(ball(1), steam);
      this.puffs.push({ m, at: tips[k % 2], phase: Math.floor(k / 2) / 3 + (k % 2) * 0.17 });
      t.add(m);
    }
    // the wind-up key: a shaft out of its back and a handle of two loops
    const key = new THREE.Group();
    key.position.set(0, 0.04, -0.36);
    key.add(turned(mesh(cyl(0.04, 0.04, 0.22, 8), this.copper, 0, 0, -0.08), Math.PI / 2));
    this.bow.position.z = -0.2;
    this.bow.add(turned(mesh(cyl(0.055, 0.055, 0.08, 10), this.brass), Math.PI / 2));
    for (const s of [1, -1]) this.bow.add(mesh(ring(0.12, 0.04), this.brass, s * 0.17, 0, 0), mesh(box(0.1, 0.07, 0.05), this.brass, s * 0.06, 0, 0));
    key.add(this.bow);
    t.add(key);
    // the head: ear discs, a winding knob on top, one eye in a dark socket
    const h = this.head;
    h.position.y = 0.5;
    h.add(mesh(ball(0.25), this.brass));
    for (const s of [1, -1]) h.add(turned(mesh(cyl(0.08, 0.08, 0.06, 12), this.copper, s * 0.25, 0, 0), 0, 0, Math.PI / 2));
    h.add(mesh(cyl(0.06, 0.08, 0.1, 10), this.copper, 0, 0.27, 0), mesh(ball(0.05), this.brass, 0, 0.34, 0));
    h.add(mesh(ring(0.11, 0.035), dark, 0, 0.02, 0.215), mesh(ball(0.095), this.eye, 0, 0.02, 0.2), mesh(ball(0.14), this.eyeGlow, 0, 0.02, 0.23));
    t.add(h);
    // the heat it gives off while the pressure builds
    this.heatBall = mesh(ball(0.8), this.heat);
    t.add(this.heatBall);
    r.add(t);
  }

  protected pose(dt: number, time: number): void {
    const t = time + this.phase;
    const on = this.fade;
    // an exhaust burst builds up while it is cast and goes off in one puff when the cast ends
    const venting = this.casting?.includes('排氣') ?? false;
    if (this.venting && !venting) this.popT = 0;
    this.venting = venting;
    this.vent += ((venting ? 1 : 0) - this.vent) * Math.min(1, dt * (venting ? 1.5 : 6));
    const v = this.vent;
    let pop = 0;
    if (this.popT >= 0) {
      this.popT += dt;
      pop = clamp01(1 - this.popT / 0.5);
      if (this.popT >= 0.5) this.popT = -1;
    }
    this.throb += dt * (6 + v * 12);
    // stubby legs swing, the foot going forward lifts; the body bobs and rocks; the arms swing
    const sw = this.stride;
    const s = Math.sin(this.walk) * sw;
    this.legs.forEach((leg, k) => {
      const side = k ? -1 : 1;
      leg.rotation.x = side * s * 0.6;
      leg.position.y = 0.36 + Math.max(0, -side * Math.cos(this.walk)) * 0.06 * sw;
    });
    // shot down, it topples over forwards on the floor (held up against FoeBase's sinking), then sinks
    const down = clamp01((1 - on) / 0.4);
    const held = -this.body.position.y / this.body.scale.y - clamp01((0.6 - on) / 0.6) * 1.2;
    const r = this.rig;
    r.position.set(Math.sin(t * 53) * 0.03 * v, Math.abs(s) * 0.05 + held, Math.cos(t * 47) * 0.03 * v);
    r.rotation.set(smooth(down) * 1.35, 0, s * 0.08 + this.jolt(time, 0.05) + Math.sin(t * 61) * 0.05 * v);
    this.trunk.position.y = 0.68 + Math.sin(t * 2.2) * 0.01;
    const swell = 1 + v * (0.08 + Math.sin(this.throb) * 0.02);
    this.trunk.scale.set(swell, swell * (1 - pop * 0.1), swell);
    this.arms.forEach((arm, k) => {
      const side = k ? -1 : 1;
      arm.rotation.set(-side * s * 0.5 - v * 0.2, 0, side * (0.35 + v * 0.5));
    });
    this.head.rotation.set(0, Math.sin(t * 0.6) * 0.12 * (1 - sw), Math.sin(t * 0.9) * 0.08);
    this.spin += dt * (1.5 + sw * 2.5 + v * 14) * on;
    this.bow.rotation.z = this.spin;
    this.clock[0].rotation.z = -t * 0.2;
    this.clock[1].rotation.z = -t * 2.4;
    this.steam += dt * (1 + v * 2.5 + pop * 3);
    for (const p of this.puffs) {
      const u = (this.steam * 0.9 + p.phase) % 1;
      p.m.position.set(p.at.x * (1 + u * 0.6), p.at.y + u * 0.55, p.at.z - u * 0.3);
      p.m.scale.setScalar(Math.max(0.001, (0.04 + u * 0.12) * (1 - u * u) * (1 + v * 0.8 + pop * 1.5) * on));
    }
    const hot = (v * (0.35 + Math.sin(this.throb) * 0.2) + pop * 0.8) * on;
    this.brass.emissiveIntensity = hot;
    this.copper.emissiveIntensity = hot * 1.3;
    this.eye.emissiveIntensity = (1.1 + Math.sin(t * 3) * 0.2 + this.cast * 0.4 + v * 1.5) * on;
    this.eyeGlow.opacity = (0.2 + v * 0.35 + this.cast * 0.15) * on;
    this.heat.opacity = (v * (0.16 + Math.sin(this.throb) * 0.06) + pop * 0.35) * on;
    this.heatBall.scale.setScalar(1 + v * 0.15 + (this.popT >= 0 ? (1 - pop) * 1.6 : 0));
    this.heatBall.visible = this.heat.opacity > 0.005;
  }
}

/** where the ice block's glint shows, in turn: corners and edges near its top */
const SPARKLES: readonly (readonly [number, number, number])[] = [
  [0.7, 2.6, 0.6],
  [-0.7, 1.9, 0.6],
  [0.2, 2.6, -0.6],
  [-0.7, 2.6, -0.6],
  [0.7, 1.4, -0.6],
  [-0.3, 2.6, 0.6],
];

/**
 * 冰塊: a tall block of pale blue ice, 1.4 m wide and 2.6 m tall, with edges rounded as if melting, see-
 * through with a cloudy heart, a crack on its faces, a cap of snow and two small crystals on top, standing on
 * a patch of frost with shards stuck in the floor round its foot. It bursts up out of the floor when it
 * appears (the shards a moment later) and a glint runs round its corners; players hide behind it. It sinks
 * away when it breaks.
 */
export class IceBlock extends Figure {
  private readonly ice: THREE.MeshToonMaterial;
  private readonly frost: THREE.MeshBasicMaterial;
  private readonly patch: THREE.Mesh;
  private readonly shards: THREE.Mesh[] = [];
  private readonly glint: THREE.Mesh;

  constructor() {
    super('iceblock', 2.8, false);
    this.ice = this.lit('#bfe8ff', '#bfe8ff', 0.12);
    this.ice.transparent = true;
    this.ice.opacity = 0.78;
    const cloud = this.lit('#d8f1ff', '#d2efff', 0.2);
    const snow = this.lit('#f4fbff', '#eaf8ff', 0.3);
    const crack = this.lit('#f4fbff', '#e6f8ff', 0.5);
    const crystal = this.lit('#a6dcf7', '#9fdcff', 0.25);
    this.frost = this.basic(0xe8f6ff, 0.5);
    const spark = this.halo(0xffffff, 0.9);
    // a patch of frost on the floor (on body: it stays down while the block rises)
    this.patch = turned(mesh(disc(1.2), this.frost, 0, 0.02, 0), -Math.PI / 2);
    this.body.add(this.patch);
    // shards stuck in the floor round its foot, tipped outwards
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.3;
      const h = 0.45 + (k % 3) * 0.15;
      const m = turned(mesh(cone(0.11, h, 5), crystal, Math.sin(a) * 0.98, h * 0.35, Math.cos(a) * 0.98), Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5);
      this.shards.push(m);
      this.body.add(m);
    }
    const b = this.rig;
    // the block with its rounded edges, and a cloudy heart inside it
    b.add(mesh(this.geo(new RoundedBoxGeometry(1.4, 2.6, 1.2, 3, 0.14)), this.ice, 0, 1.3, 0));
    b.add(turned(mesh(box(0.6, 1.85, 0.5), cloud, -0.08, 1.2, 0), 0, 0.35, 0.04));
    b.add(turned(mesh(box(0.42, 1.1, 0.38), cloud, 0.22, 1.7, 0.05), 0.05, -0.4, -0.06));
    // a zigzag crack on the front and the back
    for (const side of [1, -1]) {
      const pts = [
        [-0.38, 2.15],
        [-0.14, 1.75],
        [-0.27, 1.42],
        [0.02, 1.0],
      ];
      for (let k = 0; k + 1 < pts.length; k++) {
        const [x0, y0] = pts[k];
        const [x1, y1] = pts[k + 1];
        const len = Math.hypot(x1 - x0, y1 - y0);
        b.add(turned(mesh(box(0.03, len, 0.01), crack, (side * (x0 + x1)) / 2, (y0 + y1) / 2, side * 0.605), 0, 0, Math.atan2(-(x1 - x0) * side, y1 - y0)));
      }
    }
    // a cap of snow on top, lumpy, and two small crystals growing out of it
    b.add(mesh(this.geo(new RoundedBoxGeometry(1.26, 0.14, 1.06, 2, 0.06)), snow, 0, 2.6, 0));
    b.add(turned(mesh(this.geo(new RoundedBoxGeometry(0.7, 0.12, 0.55, 2, 0.05)), snow, 0.2, 2.68, 0.15), 0, 0.5, 0));
    for (const [x, z, h, tx, tz] of [
      [-0.32, 0.18, 0.55, 0.2, 0.25],
      [0.28, -0.2, 0.4, -0.15, -0.3],
    ] as const) {
      const c = turned(mesh(gem(0.14), crystal, x, 2.62 + h * 0.4, z), tx, 0, tz);
      c.scale.set(0.8, h / 0.28, 0.8);
      b.add(c);
    }
    this.glint = mesh(gem(0.09), spark);
    b.add(this.glint);
  }

  protected pose(dt: number, time: number): void {
    void dt;
    const on = this.fade;
    // it bursts up out of the floor, shaking, and the shards round its foot pop up a moment after
    const rising = 1 - clamp01(this.age / 0.8);
    this.rig.position.y = (popUp(this.age / 1.1) - 1) * 2.8;
    this.rig.rotation.z = Math.sin(time * 60) * 0.03 * rising + this.jolt(time, 0.025);
    this.patch.scale.setScalar(Math.max(0.001, smooth(this.age / 0.3)));
    this.shards.forEach((m, k) => m.scale.setScalar(Math.max(0.001, popUp((this.age - 0.4 - k * 0.05) / 0.35))));
    this.ice.opacity = 0.78 * on;
    this.frost.opacity = 0.5 * on;
    // a glint that twinkles at one corner after another
    const u = (time / 1.4) % 1;
    const [x, y, z] = SPARKLES[Math.floor(time / 1.4) % SPARKLES.length];
    this.glint.position.set(x, y, z);
    this.glint.rotation.y = time * 2;
    this.glint.scale.setScalar(Math.max(0.001, Math.sin(u * Math.PI) * 1.3 * on));
  }
}
