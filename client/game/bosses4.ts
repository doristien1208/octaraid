import * as THREE from 'three';
import type { FoeKind } from '../../shared/bosses/foes';
import { FoeBase } from './foebase';
import { ball, box, cap, cone, cyl, disc, gem, mesh, ring } from './models';

/**
 * The M4 foes, built in code like those in bosses.ts (section 八): 霜冠魔女 and her ice mirrors, 守門機兵 and
 * its drones, the twins 熾核 and 凍核, and 雙極機神 that they merge into. Chunky cartoon models of our own
 * design; they face +z.
 */

/** How long a twin's weapon burns after act('glow'), the lean of act('charge') and the hop of a leap, seconds. */
const GLOW_TIME = 3.5;
const CHARGE_TIME = 0.7;
const HOP_TIME = 1.3;

/** Which side of 雙極機神 is red: +1 its own left (+x), -1 its own right. The other side is blue. */
const RED_SIDE: number = 1;

const AMBER = new THREE.Color('#ff8a1e');
const SCARLET = new THREE.Color('#ff2a1a');
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Sets o's rotation and hands o back. */
function turned<T extends THREE.Object3D>(o: T, x: number, y = 0, z = 0): T {
  o.rotation.set(x, y, z);
  return o;
}

/** A 1 m tall shape (box(w, 1, d), cyl(r, r, 1)) stretched from a to b: a limb, a haft. */
function span(g: THREE.BufferGeometry, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3): THREE.Mesh {
  const d = b.clone().sub(a);
  const len = d.length();
  const m = mesh(g, mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
  m.scale.y = len;
  return m;
}

/** A group at p whose +y points along dir: where a weapon is held. */
function aimed(p: THREE.Vector3, dir: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(p);
  g.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  return g;
}

/**
 * A two-part arm (upper arm, elbow, forearm; each part `part` long and `w` thick) from the shoulder s to
 * the hand h with the elbow bent towards `pole`, added to `parent`. Returns where the elbow is.
 */
function arm(
  parent: THREE.Object3D,
  s: THREE.Vector3,
  h: THREE.Vector3,
  part: number,
  w: number,
  pole: THREE.Vector3,
  mats: readonly [upper: THREE.Material, joint: THREE.Material, fore: THREE.Material],
): THREE.Vector3 {
  const d = h.clone().sub(s);
  const len = d.length();
  const side = pole.clone().addScaledVector(d, -pole.dot(d) / (len * len)).normalize();
  const e = s.clone().addScaledVector(d, 0.5).addScaledVector(side, Math.sqrt(Math.max(0, part * part - (len * len) / 4)));
  parent.add(span(box(w, 1, w), mats[0], s, e), mesh(ball(w * 0.6), mats[1], e.x, e.y, e.z), span(box(w, 1, w), mats[2], e, h));
  return e;
}

/**
 * What the foes here share. The model is built on `rig`, which carries the hover, the hop of a leap and the
 * shake of a hit, so FoeBase can still sink `body` when the foe is gone. Walking is read from how far the
 * engine moved the root since the last frame; act() starts the timed moves ('jump', 'glow', 'charge').
 */
abstract class Rigged extends FoeBase {
  protected readonly rig = new THREE.Group();
  /** 0 standing … 1 walking, eased */
  protected stride = 0;
  /** the walk cycle (radians), advanced by the distance walked so the feet do not slide */
  protected walk = 0;
  /** 0 … 1 while it casts, eased */
  protected cast = 0;
  private readonly last = new THREE.Vector3(NaN, 0, NaN);
  private hopT = -1;
  private glowT = 0;
  private chargeT = 0;

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
    else if (move === 'glow') this.glowT = GLOW_TIME;
    else if (move === 'charge') this.chargeT = CHARGE_TIME;
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
    this.glowT = Math.max(0, this.glowT - dt);
    this.chargeT = Math.max(0, this.chargeT - dt);
    this.pose(dt, time);
  }

  /** The model's own animation for this frame. */
  protected abstract pose(dt: number, time: number): void;

  /** 0 → 1 → 0 over a leap */
  protected get hop(): number {
    return this.hopT < 0 ? 0 : Math.sin((this.hopT / HOP_TIME) * Math.PI);
  }

  /** the weapon glow of act('glow'): up at once, held, faded out at the end */
  protected get glow(): number {
    return this.glowT > 0 ? Math.min(1, (GLOW_TIME - this.glowT) / 0.15, this.glowT / 0.6) : 0;
  }

  /** the forward lean of act('charge') */
  protected get charge(): number {
    return this.chargeT > 0 ? Math.min(1, (CHARGE_TIME - this.chargeT) / 0.08, this.chargeT / 0.3) : 0;
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

  /** A see-through glow added onto what is behind it: flames, auras, rotor blur. */
  protected halo(color: number, opacity: number): THREE.MeshBasicMaterial {
    const m = this.basic(color, opacity);
    m.blending = THREE.AdditiveBlending;
    return m;
  }
}

/**
 * 霜冠魔女: an ice witch about 4 m tall who floats a little above the floor and sways: a crown and a pair of
 * wings of crystal shards, a long flared skirt with icicles under its hem, a staff in her left hand and a
 * crystal over her right. The staff and hand crystals blaze while she casts; while her ice mirrors fight
 * (she cannot be targeted) she fades to a see-through ghost. Her leaps are glides.
 */
export class Frostwitch extends Rigged {
  private readonly crystal: THREE.MeshToonMaterial;
  private readonly focus: THREE.MeshToonMaterial;
  /** all her materials with their own opacity: she fades as one */
  private readonly see: [THREE.Material, number][] = [];
  private readonly overskirt: THREE.Mesh;
  private readonly wingL = new THREE.Group();
  private readonly wingR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly staff = new THREE.Group();
  private readonly orb: THREE.Mesh;
  private ghost = 0;

  constructor() {
    super('frostwitch', 4.4, true);
    const own = (color: string, opacity = 1, glow = 0, emissive = color): THREE.MeshToonMaterial => {
      const m = this.lit(color, emissive, glow);
      m.transparent = true;
      m.opacity = opacity;
      this.see.push([m, opacity]);
      return m;
    };
    const dress = own('#8cc4ec');
    const lilac = own('#c4b2ee');
    const white = own('#f3f6ff');
    const violet = own('#6c5ab4');
    const skin = own('#e2ebff');
    const hair = own('#d6dcf5');
    const silver = own('#9ba9cc');
    const frost = own('#e8f8ff', 1, 0.3);
    const eye = own('#5cc8ff', 1, 0.9);
    this.crystal = own('#86d6ff', 0.9, 0.4, '#4cc0ff');
    this.focus = own('#aef0ff', 0.95, 0.6, '#5fd6ff');
    const r = this.rig;

    // the long flared skirt, a lilac overskirt over its upper part, a frosted hem and icicles under it
    r.add(mesh(cyl(0.32, 1.25, 2.0, 16), dress, 0, 1.0, 0));
    this.overskirt = mesh(cyl(0.34, 1.12, 1.3, 8), lilac, 0, 1.4, 0);
    r.add(this.overskirt);
    r.add(turned(mesh(ring(1.22, 0.07), frost, 0, 0.04, 0), Math.PI / 2));
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      r.add(turned(mesh(cone(0.08, 0.22, 5), this.crystal, Math.sin(a) * 0.85, -0.07, Math.cos(a) * 0.85), Math.PI));
    }
    // a slim bodice: belt, brooch and a raised collar
    r.add(mesh(cyl(0.34, 0.34, 0.12, 12), violet, 0, 2.06, 0));
    r.add(mesh(cyl(0.36, 0.29, 0.72, 12), white, 0, 2.46, 0));
    r.add(mesh(gem(0.11), this.crystal, 0, 2.6, 0.34));
    r.add(mesh(cyl(0.5, 0.3, 0.18, 10), lilac, 0, 2.88, 0));
    // a pale face, silver hair down her back, glowing eyes, a circlet with a crown of shards (tallest in front)
    r.add(mesh(ball(0.32), skin, 0, 3.25, 0));
    r.add(turned(mesh(cap(0.35), hair, 0, 3.29, -0.02), -0.2));
    r.add(turned(mesh(box(0.54, 1.0, 0.16), hair, 0, 2.85, -0.27), 0.1));
    for (const s of [1, -1]) r.add(mesh(box(0.07, 0.1, 0.02), eye, s * 0.11, 3.23, 0.31));
    r.add(turned(mesh(ring(0.29, 0.03), silver, 0, 3.5, 0), Math.PI / 2));
    for (const [a, h] of [
      [0, 0.6],
      [0.5, 0.42],
      [-0.5, 0.42],
      [1, 0.3],
      [-1, 0.3],
    ] as const) {
      const spike = turned(mesh(gem(0.1), this.crystal, Math.sin(a) * 0.29, 3.46 + h / 2, Math.cos(a) * 0.29), Math.cos(a) * 0.2, 0, -Math.sin(a) * 0.3);
      spike.scale.set(0.8, h / 0.2, 0.8);
      r.add(spike);
    }
    // wings: four long shards on each side fanned out from her upper back
    for (const [wing, s] of [
      [this.wingL, 1],
      [this.wingR, -1],
    ] as const) {
      wing.position.set(s * 0.2, 2.75, -0.3);
      [1.35, 1.2, 1.0, 0.8].forEach((len, k) => {
        const a = 0.3 + k * 0.36; // from upright towards her side
        const shard = turned(mesh(gem(0.15), this.crystal, (s * Math.sin(a) * len) / 2, (Math.cos(a) * len) / 2, -k * 0.04), 0, 0, -s * a);
        shard.scale.set(0.5, len / 0.3, 0.22);
        wing.add(shard);
      });
      r.add(wing);
    }
    // slim arms with flared sleeves
    for (const [limb, s] of [
      [this.armL, 1],
      [this.armR, -1],
    ] as const) {
      limb.position.set(s * 0.4, 2.78, 0);
      limb.add(mesh(box(0.13, 0.55, 0.13), white, 0, -0.27, 0));
      limb.add(mesh(cyl(0.08, 0.19, 0.5, 8), lilac, 0, -0.72, 0));
      limb.add(mesh(ball(0.075), skin, 0, -1.0, 0));
      r.add(limb);
    }
    // a crystal floating over her right hand, a staff in her left (kept upright: see pose)
    this.orb = mesh(gem(0.22), this.focus, 0, -1.32, 0.05);
    this.armR.add(this.orb);
    this.staff.position.y = -1.0;
    this.staff.rotation.order = 'ZYX';
    this.staff.add(mesh(cyl(0.04, 0.04, 2.9, 6), silver, 0, 0.35, 0));
    const tip = mesh(gem(0.17), this.focus, 0, 2.05, 0);
    tip.scale.y = 1.9;
    this.staff.add(tip, mesh(ring(0.25, 0.03), silver, 0, 2.05, 0));
    this.armL.add(this.staff);
  }

  protected pose(dt: number, time: number): void {
    this.ghost += ((this.untargetable && !this.gone ? 1 : 0) - this.ghost) * Math.min(1, dt * 2.5);
    const r = this.rig;
    const glide = this.hop;
    r.position.y = 0.32 + Math.sin(time * 1.3) * 0.08 + glide * 1.2;
    r.rotation.x = this.stride * 0.06 + glide * 0.2 + Math.sin(time * 0.6) * 0.015;
    r.rotation.z = Math.sin(time * 0.8) * 0.035 + this.jolt(time, 0.03);
    this.overskirt.rotation.y = Math.PI / 8 + Math.sin(time * 0.7) * 0.2;
    const flap = 0.45 + Math.sin(time * 1.5) * 0.12;
    this.wingL.rotation.set(-0.25, flap, 0);
    this.wingR.rotation.set(-0.25, -flap, 0);
    // the right hand lifts its crystal while she casts; the staff rises a little and stays upright
    this.armL.rotation.set(-0.3 - this.cast * 0.25, 0, 0.22);
    this.armR.rotation.set(-0.5 - this.cast * 0.9, 0, -0.3);
    this.staff.rotation.set(-this.armL.rotation.x, 0, -this.armL.rotation.z);
    this.orb.rotation.y = time * 2;
    this.orb.scale.setScalar(1 + this.cast * 0.5);
    this.crystal.emissiveIntensity = 0.4 + Math.sin(time * 2) * 0.1;
    this.focus.emissiveIntensity = 0.6 + this.cast * (1.8 + Math.sin(time * 9) * 0.4);
    const seen = (1 - this.ghost * 0.55) * this.fade;
    for (const [m, o] of this.see) m.opacity = o * seen;
  }
}

/**
 * 冰鏡: an upright mirror of ice about 3 m tall floating over an icy base. Its front (+z), which fires the
 * fans, is a bright shimmering surface with a glint and a glowing snowflake sigil; the back is dull ice.
 */
export class Mirror extends Rigged {
  private readonly pane = new THREE.Group();
  private readonly sigil = new THREE.Group();
  private readonly face: THREE.MeshToonMaterial;
  private readonly mark: THREE.MeshToonMaterial;
  private readonly shards: THREE.MeshToonMaterial;
  /** so two mirrors do not shimmer in step */
  private readonly phase = Math.random() * 10;

  constructor() {
    super('mirror', 3, false);
    const base = this.toonOwn('#7fb0d4');
    const frame = this.toonOwn('#3f6aa8');
    const back = this.toonOwn('#9cc6e6');
    this.shards = this.lit('#9fdcff', '#7fd0ff', 0.4);
    this.face = this.lit('#b8e4fa', '#c8f2ff', 0.35);
    this.mark = this.lit('#1aa8e0', '#1ac8ff', 1);
    const glint = this.lit('#ffffff', '#ffffff', 0.5);
    const r = this.rig;
    r.add(mesh(cyl(0.62, 0.8, 0.32, 6), base, 0, 0.16, 0));
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      r.add(turned(mesh(cone(0.14, 0.6, 5), this.shards, Math.sin(a) * 0.62, 0.38, Math.cos(a) * 0.62), Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4));
    }
    for (const s of [1, -1]) {
      const shard = turned(mesh(gem(0.2), this.shards, s * 0.72, 0.62, -0.05), 0, 0, -s * 0.3);
      shard.scale.set(0.6, 2.2, 0.6);
      r.add(shard);
    }
    // a tall pointed hexagon: rim, dull ice, and the bright surface on the front only
    const hex = (radius: number, depth: number, mat: THREE.Material, z: number): THREE.Mesh => {
      const m = turned(mesh(cyl(radius, radius, depth, 6), mat, 0, 0, z), Math.PI / 2);
      m.scale.z = 1.42;
      return m;
    };
    this.pane.position.y = 1.72;
    this.pane.add(hex(0.92, 0.12, frame, -0.02), hex(0.84, 0.2, back, 0), hex(0.76, 0.04, this.face, 0.11));
    this.pane.add(turned(mesh(box(0.08, 0.6, 0.01), glint, -0.32, 0.62, 0.135), 0, 0, -0.6));
    this.pane.add(turned(mesh(box(0.05, 0.35, 0.01), glint, -0.12, 0.72, 0.135), 0, 0, -0.6));
    // the sigil: a ring around a six-armed star, glowing cyan on the pale surface
    this.sigil.position.z = 0.15;
    const heart = mesh(gem(0.14), this.mark);
    heart.scale.z = 0.4;
    this.sigil.add(mesh(ring(0.36, 0.035), this.mark), heart);
    for (let k = 0; k < 3; k++) this.sigil.add(turned(mesh(box(0.05, 1.0, 0.02), this.mark), 0, 0, (k * Math.PI) / 3));
    this.pane.add(this.sigil);
    r.add(this.pane);
  }

  protected pose(dt: number, time: number): void {
    const t = time + this.phase;
    this.pane.position.y = 1.72 + Math.sin(t * 1.7) * 0.05;
    this.sigil.rotation.z += dt * 0.5;
    this.rig.rotation.z = this.jolt(time, 0.05);
    const on = this.fade;
    this.face.emissiveIntensity = (0.35 + Math.sin(t * 2.6) * 0.2 + this.cast * 0.3) * on;
    this.mark.emissiveIntensity = (0.9 + Math.sin(t * 3.4) * 0.3 + this.cast * 0.8) * on;
    this.shards.emissiveIntensity = (0.35 + Math.sin(t * 2 + 1) * 0.1) * on;
  }
}

/**
 * 守門機兵: a 5 m four-legged guard machine of steel and brass: an armoured body, a cannon on each side, one
 * big lens at the front that burns brighter and redder while it casts, and a great gear turning on its back.
 * It trots after the tank (diagonal legs together); overheated (it cannot be targeted while its drones
 * fight) its vents glow, its lens dims and the gear slows to a crawl.
 */
export class Gatekeeper extends Rigged {
  /** front left, front right, back left, back right */
  private readonly legs: THREE.Group[] = [];
  /** the feet of those legs, kept flat */
  private readonly feet: THREE.Mesh[] = [];
  private readonly cannons: THREE.Group[] = [];
  private readonly gear = new THREE.Group();
  private readonly eye: THREE.MeshToonMaterial;
  private readonly muzzle: THREE.MeshToonMaterial;
  private readonly vent: THREE.MeshToonMaterial;
  private heat = 0;

  constructor() {
    super('gatekeeper', 5.5, true, 2.7);
    const steel = this.toonOwn('#a2acba');
    const dark = this.toonOwn('#545c6a');
    const brass = this.toonOwn('#c9a04a');
    const darkBrass = this.toonOwn('#8e6a2c');
    this.eye = this.lit('#ff8a1e', '#ff8a1e', 0.8);
    this.muzzle = this.lit('#ffb060', '#ff8a1e', 0.3);
    this.vent = this.lit('#5a4a44', '#ff5a1a', 0);
    const r = this.rig;
    // legs: thigh, knee drum and a heavy foot, swinging from the hips
    for (const [x, z] of [
      [1.25, 1.15],
      [-1.25, 1.15],
      [1.25, -1.15],
      [-1.25, -1.15],
    ] as const) {
      const leg = new THREE.Group();
      leg.position.set(x, 2.1, z);
      leg.add(mesh(box(0.6, 1.1, 0.6), dark, 0, -0.45, 0));
      leg.add(turned(mesh(cyl(0.32, 0.32, 0.72, 10), brass, 0, -1.05, 0), 0, 0, Math.PI / 2));
      const foot = mesh(box(0.85, 0.85, 1.05), steel, 0, -1.68, 0.05);
      leg.add(foot);
      this.legs.push(leg);
      this.feet.push(foot);
      r.add(leg);
    }
    // the armoured body with a brass band; the sensor head with its brow and single lens
    r.add(mesh(box(2.9, 1.5, 3.3), steel, 0, 2.75, 0));
    r.add(mesh(box(2.5, 0.55, 2.7), dark, 0, 3.75, -0.1));
    r.add(mesh(box(3.0, 0.18, 3.4), brass, 0, 2.1, 0));
    r.add(mesh(box(1.5, 1.1, 0.8), dark, 0, 3.05, 1.85));
    r.add(turned(mesh(box(1.7, 0.2, 0.55), steel, 0, 3.68, 2.0), 0.3));
    r.add(turned(mesh(cyl(0.5, 0.5, 0.22, 16), brass, 0, 3.05, 2.3), Math.PI / 2));
    const lens = mesh(ball(0.36), this.eye, 0, 3.05, 2.36);
    lens.scale.z = 0.6;
    r.add(lens);
    // a cannon on each side, pointing forward
    for (const s of [1, -1]) {
      const c = new THREE.Group();
      c.position.set(s * 1.55, 3.0, 0.3);
      c.add(mesh(box(0.6, 0.9, 1.1), dark, s * 0.2, 0, 0));
      c.add(turned(mesh(cyl(0.26, 0.3, 2.0, 12), steel, s * 0.28, -0.15, 1.1), Math.PI / 2));
      c.add(mesh(ring(0.3, 0.07), brass, s * 0.28, -0.15, 2.1));
      c.add(mesh(disc(0.2), this.muzzle, s * 0.28, -0.15, 2.115));
      this.cannons.push(c);
      r.add(c);
    }
    // the great gear on its back: a disc, six bars for twelve teeth, a ring and the hub
    this.gear.position.set(0, 4.05, -1.25);
    this.gear.add(turned(mesh(cyl(1.1, 1.1, 0.22, 24), brass), Math.PI / 2));
    for (let k = 0; k < 6; k++) this.gear.add(turned(mesh(box(0.26, 2.64, 0.16), brass), 0, 0, (k * Math.PI) / 6));
    this.gear.add(mesh(ring(0.72, 0.07), darkBrass, 0, 0, -0.12));
    this.gear.add(turned(mesh(cyl(0.36, 0.36, 0.4, 12), darkBrass), Math.PI / 2));
    r.add(this.gear);
    // exhaust pipes and side grilles: they glow when it overheats
    for (const s of [1, -1]) {
      r.add(mesh(cyl(0.16, 0.2, 0.9, 8), this.vent, s * 1.05, 3.95, -1.6));
      r.add(mesh(box(0.08, 0.6, 1.2), this.vent, s * 1.47, 2.8, -0.9));
    }
  }

  protected pose(dt: number, time: number): void {
    this.heat += ((this.untargetable && !this.gone ? 1 : 0) - this.heat) * Math.min(1, dt * 2);
    const sw = this.stride;
    const hop = this.hop;
    // a trot: diagonal pairs swing together, each foot lifted while it swings forward; tucked in a leap
    this.legs.forEach((leg, k) => {
      const ph = this.walk + (k === 0 || k === 3 ? 0 : Math.PI);
      leg.rotation.x = Math.sin(ph) * 0.32 * sw - (k < 2 ? 1 : -1) * hop * 0.5;
      leg.position.y = 2.1 + Math.max(0, -Math.cos(ph)) * 0.18 * sw;
      this.feet[k]!.rotation.x = -leg.rotation.x;
    });
    const r = this.rig;
    // the body drops as the legs spread, so the planted feet stay on the floor
    const th = Math.sin(this.walk) * 0.32 * sw;
    r.position.y = (Math.cos(th) - 1) * 1.68 + Math.abs(Math.sin(th)) * 0.05 + hop * 2.6;
    r.rotation.z = this.jolt(time, 0.02) + Math.sin(time * 30) * 0.004 * this.heat;
    this.gear.rotation.z += dt * (0.5 + sw * 0.6) * (1 - this.heat * 0.85);
    for (const c of this.cannons) c.rotation.x = -this.cast * 0.12 + Math.sin(time * 0.9) * 0.03;
    const on = this.fade * (1 - this.heat * 0.8);
    this.eye.emissive.lerpColors(AMBER, SCARLET, this.cast);
    this.eye.color.copy(this.eye.emissive);
    this.eye.emissiveIntensity = (0.9 + this.cast * (1.6 + Math.sin(time * 10) * 0.4)) * on;
    this.muzzle.emissiveIntensity = (0.25 + this.cast * 1.4) * on;
    this.vent.emissiveIntensity = this.heat * (1.2 + Math.sin(time * 6) * 0.3) * this.fade;
  }
}

/** 僚機: a small hovering drone in the guard's steel and brass, with four rotors and one red lens at the front. */
export class Drone extends Rigged {
  private readonly blades: THREE.Mesh[] = [];
  private readonly lens: THREE.MeshToonMaterial;
  /** so two drones do not bob in step */
  private readonly phase = Math.random() * 10;

  constructor() {
    super('drone', 2.6, false);
    const steel = this.toonOwn('#a2acba');
    const dark = this.toonOwn('#3e4552');
    const brass = this.toonOwn('#c9a04a');
    const blade = this.toonOwn('#2c313a');
    const blur = this.basic(0xd8e2ef, 0.2);
    this.lens = this.lit('#ff3030', '#ff3030', 1.1);
    const r = this.rig;
    // the body: hull, brass band, dome, the lens in its housing, a gun underneath, an antenna
    r.add(mesh(cyl(0.42, 0.34, 0.42, 8), steel));
    r.add(mesh(cyl(0.45, 0.45, 0.1, 8), brass));
    r.add(mesh(cap(0.3), dark, 0, 0.2, 0));
    r.add(turned(mesh(cyl(0.17, 0.17, 0.2, 12), dark, 0, -0.02, 0.4), Math.PI / 2));
    r.add(mesh(ball(0.13), this.lens, 0, -0.02, 0.47));
    r.add(mesh(box(0.16, 0.12, 0.24), dark, 0, -0.26, 0.15));
    r.add(turned(mesh(cyl(0.05, 0.05, 0.5, 6), dark, 0, -0.28, 0.4), Math.PI / 2));
    r.add(mesh(cyl(0.015, 0.015, 0.35, 4), dark, 0.12, 0.42, -0.16));
    r.add(mesh(ball(0.04), this.lens, 0.12, 0.6, -0.16));
    // two crossed booms with a rotor at each end: motor, blade and a blur disc
    for (const a of [Math.PI / 4, -Math.PI / 4]) r.add(turned(mesh(box(1.3, 0.07, 0.12), dark, 0, 0.06, 0), 0, a, 0));
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const x = Math.sin(a) * 0.62;
      const z = Math.cos(a) * 0.62;
      r.add(mesh(cyl(0.09, 0.11, 0.16, 8), steel, x, 0.14, z));
      const b = mesh(box(0.56, 0.025, 0.08), blade, x, 0.24, z);
      this.blades.push(b);
      r.add(b, turned(mesh(disc(0.3), blur, x, 0.25, z), -Math.PI / 2));
    }
  }

  protected pose(dt: number, time: number): void {
    const t = time + this.phase;
    const r = this.rig;
    r.position.y = 1.5 + Math.sin(t * 2.4) * 0.12;
    r.rotation.x = 0.12 + Math.sin(t * 1.7) * 0.04;
    // shot down, it tips over as it sinks and its rotors run down
    r.rotation.z = Math.sin(t * 1.3) * 0.05 + this.jolt(time, 0.08) + (1 - this.fade) * 0.7;
    const spin = dt * 40 * (0.15 + 0.85 * this.fade);
    this.blades.forEach((b, k) => {
      b.rotation.y += k % 2 ? spin : -spin;
    });
    this.lens.emissiveIntensity = (1 + Math.sin(t * 5) * 0.25 + this.cast * 1.5) * this.fade;
  }
}

/**
 * 熾核: the red twin, a 4.5 m mech in red, orange and black armour carrying a huge hammer in both hands
 * (the haft across its body, the head up by its right shoulder). It walks after the tank: legs, a sway of
 * the arms and hammer. act('glow') sets the hammer head burning orange for 3.5 s (it strikes first);
 * act('charge') throws it forward for a moment with its back jets flaring.
 */
export class Ember extends Rigged {
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  /** the feet, kept flat */
  private readonly feet: THREE.Mesh[] = [];
  private readonly torso = new THREE.Group();
  /** both arms and the hammer: they move together */
  private readonly carry = new THREE.Group();
  private readonly jets: THREE.Group[] = [];
  private readonly head: THREE.MeshToonMaterial;
  private readonly core: THREE.MeshToonMaterial;
  private readonly flame: THREE.MeshBasicMaterial;
  private readonly aura: THREE.MeshBasicMaterial;
  private readonly auraMesh: THREE.Mesh;

  constructor() {
    super('ember', 4.8, true, 3.8);
    const red = this.toonOwn('#d23b2a');
    const deep = this.toonOwn('#8e2418');
    const black = this.toonOwn('#2a2428');
    const metal = this.toonOwn('#4a4248');
    const orange = this.lit('#ff8a2a', '#ff8a2a', 0.25);
    const visor = this.lit('#ffb03a', '#ffb03a', 1);
    this.core = this.lit('#ff6a1a', '#ff6a1a', 0.9);
    this.head = this.lit('#3a3036', '#ff7a1a', 0);
    this.flame = this.halo(0xff7a2a, 0.35);
    this.aura = this.halo(0xffa040, 0);
    const r = this.rig;
    // legs from the hips: thigh, knee guard, shin, foot
    for (const [leg, s] of [
      [this.legL, 1],
      [this.legR, -1],
    ] as const) {
      leg.position.set(s * 0.55, 2.0, 0);
      const foot = mesh(box(0.75, 0.3, 1.1), black, 0, -1.86, 0.15);
      leg.add(mesh(box(0.62, 1.05, 0.7), black, 0, -0.47, 0));
      leg.add(mesh(box(0.7, 0.5, 0.42), red, 0, -1.0, 0.2));
      leg.add(mesh(box(0.6, 0.85, 0.65), red, 0, -1.4, 0), foot);
      this.feet.push(foot);
      r.add(leg);
    }
    r.add(mesh(box(1.5, 0.6, 0.9), black, 0, 2.05, 0));
    r.add(turned(mesh(box(0.9, 0.55, 0.12), deep, 0, 1.8, 0.48), 0.15));
    // the torso turns and breathes: chest with its core, the head, shoulders and back jets
    const t = this.torso;
    t.position.y = 2.3;
    t.add(mesh(box(1.1, 0.6, 0.75), black, 0, 0.3, 0));
    t.add(mesh(box(2.0, 1.2, 1.3), red, 0, 1.15, 0));
    t.add(mesh(box(1.4, 0.8, 0.2), deep, 0, 1.2, 0.68));
    t.add(mesh(ball(0.28), this.core, 0, 1.2, 0.78));
    t.add(mesh(box(0.75, 0.65, 0.75), red, 0, 2.05, 0.05));
    t.add(mesh(box(0.6, 0.14, 0.05), visor, 0, 2.08, 0.43));
    for (const s of [1, -1]) {
      t.add(turned(mesh(cone(0.1, 0.45, 6), orange, s * 0.3, 2.45, -0.05), -0.7, 0, -s * 0.35));
      t.add(turned(mesh(box(0.8, 0.55, 0.95), red, s * 1.2, 1.75, 0), 0, 0, -s * 0.25));
      t.add(turned(mesh(cone(0.12, 0.45, 6), orange, s * 1.42, 2.1, 0), 0, 0, -s * 0.6));
      // back jets angled down a little: in a charge the torso leans forward and they blow straight back
      t.add(turned(mesh(cyl(0.18, 0.24, 0.5, 8), black, s * 0.5, 1.3, -0.8), Math.PI / 2 - 0.4));
      const jet = new THREE.Group();
      jet.position.set(s * 0.5, 1.2, -1.03);
      jet.rotation.x = -0.4;
      jet.add(turned(mesh(cone(0.17, 0.8, 8), this.flame, 0, 0, -0.4), -Math.PI / 2));
      this.jets.push(jet);
      t.add(jet);
    }
    // both hands on the hammer: the haft runs across the body, the head up by the right shoulder
    const hR = v3(-0.55, 1.0, 1.05);
    const hL = v3(0.35, 0.25, 0.95);
    arm(this.carry, v3(-1.2, 1.55, 0.05), hR, 1.15, 0.42, v3(-1, -0.6, -0.4), [red, black, red]);
    arm(this.carry, v3(1.2, 1.55, 0.05), hL, 1.15, 0.42, v3(1, -0.6, -0.4), [red, black, red]);
    const along = hR.clone().sub(hL).normalize();
    const top = hR.clone().addScaledVector(along, 1.5);
    const end = hL.clone().addScaledVector(along, -0.7);
    this.carry.add(span(cyl(0.11, 0.11, 1, 8), metal, end, top));
    for (const h of [hR, hL]) this.carry.add(mesh(box(0.44, 0.44, 0.44), black, h.x, h.y, h.z));
    this.carry.add(mesh(box(0.26, 0.26, 0.26), orange, end.x, end.y, end.z));
    const hammer = aimed(top, along);
    hammer.add(mesh(box(1.5, 0.85, 0.85), this.head));
    for (const s of [1, -1]) hammer.add(mesh(box(0.14, 1.0, 1.0), deep, s * 0.78, 0, 0));
    this.auraMesh = mesh(ball(0.5), this.aura);
    this.auraMesh.scale.set(2.1, 1.3, 1.3);
    this.auraMesh.visible = false;
    hammer.add(this.auraMesh);
    this.carry.add(hammer);
    t.add(this.carry);
    r.add(t);
  }

  protected pose(dt: number, time: number): void {
    void dt;
    const sw = this.stride;
    const s = Math.sin(this.walk) * sw;
    const charge = this.charge;
    const glow = this.glow;
    // legs swing from the hips with the feet kept flat; the foot moving forward is lifted
    const th = s * 0.5;
    const lift = Math.cos(this.walk) * 0.25 * sw;
    this.legL.rotation.x = th;
    this.legR.rotation.x = -th;
    this.legL.position.y = 2.0 + Math.max(0, -lift);
    this.legR.position.y = 2.0 + Math.max(0, lift);
    this.feet[0]!.rotation.x = -th;
    this.feet[1]!.rotation.x = th;
    const r = this.rig;
    // the body drops as the legs spread, so the planted foot (its centre 1.86 below and 0.15 ahead of the hip) stays down
    r.position.y = (Math.cos(th) - 1) * 1.86 + Math.abs(Math.sin(th)) * 0.15 + this.hop * 3;
    r.rotation.z = this.jolt(time, 0.025);
    this.torso.position.y = 2.3 + Math.sin(time * 1.6) * 0.03;
    this.torso.rotation.set(charge * 0.4, -s * 0.1, 0);
    // the hammer sways with the walk and is drawn back over the shoulder in a charge
    this.carry.rotation.x = Math.sin(this.walk * 2) * 0.04 * sw + Math.sin(time * 1.6) * 0.02 - charge * 0.25;
    for (const j of this.jets) j.scale.z = 1 + charge * 2.8 + Math.sin(time * 30) * 0.08;
    this.flame.opacity = (0.3 + charge * 0.6) * this.fade;
    this.head.emissiveIntensity = glow * (2.2 + Math.sin(time * 12) * 0.4);
    this.aura.opacity = glow * (0.4 + Math.sin(time * 14) * 0.08);
    this.auraMesh.visible = glow > 0.01;
    this.core.emissiveIntensity = (0.8 + Math.sin(time * 3) * 0.15 + this.cast * 1.2) * this.fade;
  }
}

/**
 * 凍核: the blue twin, a 4.5 m mech in blue, cyan and white armour with a long crystal blade in each hand.
 * It never walks: it hovers on jets under its feet and sways, and only leaps where its script says
 * (act('jump') adds the hop). act('glow') makes both blades burn cyan for 3.5 s (it strikes first).
 */
export class Frost extends Rigged {
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly auras: THREE.Mesh[] = [];
  private readonly blade: THREE.MeshToonMaterial;
  private readonly core: THREE.MeshToonMaterial;
  private readonly aura: THREE.MeshBasicMaterial;
  private readonly jet: THREE.MeshBasicMaterial;

  constructor() {
    super('frost', 4.8, true);
    const blue = this.toonOwn('#3f7fd6');
    const navy = this.toonOwn('#1e2c4a');
    const white = this.toonOwn('#e8f2ff');
    const cyan = this.lit('#5fe0ff', '#5fe0ff', 0.3);
    const visor = this.lit('#8ff4ff', '#8ff4ff', 1);
    this.core = this.lit('#6fe8ff', '#6fe8ff', 0.9);
    this.blade = this.lit('#9ef0ff', '#7fe8ff', 0.5);
    this.aura = this.halo(0x7fe8ff, 0);
    this.jet = this.halo(0x7fe8ff, 0.5);
    const r = this.rig;
    // legs hang from the hips, a jet under each boot
    for (const s of [1, -1]) {
      const leg = new THREE.Group();
      leg.position.set(s * 0.5, 1.8, 0);
      leg.add(mesh(box(0.5, 0.85, 0.58), navy, 0, -0.4, 0));
      leg.add(mesh(box(0.55, 0.85, 0.6), white, 0, -1.2, 0));
      leg.add(mesh(box(0.6, 0.3, 0.85), blue, 0, -1.72, 0.08));
      leg.add(turned(mesh(cone(0.17, 0.28, 8), this.jet, 0, -2.01, 0), Math.PI));
      this.legs.push(leg);
      r.add(leg);
    }
    r.add(mesh(box(1.3, 0.5, 0.8), navy, 0, 1.85, 0));
    for (const s of [1, -1]) r.add(turned(mesh(box(0.5, 0.7, 0.1), white, s * 0.42, 1.6, 0.4), 0.2, 0, s * 0.12));
    // the torso: chest with a crystal core, the head with its ear fins, shoulders and back fins
    const t = new THREE.Group();
    t.position.y = 2.05;
    t.add(mesh(box(0.95, 0.55, 0.65), navy, 0, 0.28, 0));
    t.add(mesh(box(1.75, 1.05, 1.1), blue, 0, 1.08, 0));
    t.add(mesh(box(1.2, 0.7, 0.16), white, 0, 1.15, 0.58));
    t.add(mesh(gem(0.24), this.core, 0, 1.12, 0.7));
    t.add(mesh(box(0.66, 0.62, 0.7), white, 0, 1.92, 0.02));
    t.add(mesh(box(0.56, 0.12, 0.05), visor, 0, 1.95, 0.38));
    for (const s of [1, -1]) {
      t.add(turned(mesh(box(0.08, 0.5, 0.42), cyan, s * 0.3, 2.3, -0.1), -0.3, 0, -s * 0.35));
      t.add(turned(mesh(box(0.7, 0.4, 0.85), white, s * 1.08, 1.62, 0), 0, 0, -s * 0.3));
      const fin = turned(mesh(gem(0.18), cyan, s * 1.35, 1.98, -0.05), 0, 0, -s * 0.5);
      fin.scale.set(0.4, 2.2, 1);
      t.add(fin);
      t.add(turned(mesh(box(0.1, 1.2, 0.5), blue, s * 0.55, 1.5, -0.7), -0.4, 0, -s * 0.5));
    }
    // arms a little forward, a blade in each fist pointing ahead and out
    for (const s of [1, -1]) {
      const a = new THREE.Group();
      a.position.set(s * 1.1, 1.5, 0);
      const hand = v3(s * 0.25, -1.15, 0.6);
      arm(a, v3(0, 0, 0), hand, 0.75, 0.36, v3(s, -0.3, -0.6), [blue, navy, white]);
      a.add(mesh(box(0.38, 0.38, 0.38), navy, hand.x, hand.y, hand.z));
      const held = aimed(hand, v3(s * 0.3, -0.25, 1));
      held.add(mesh(box(0.42, 0.1, 0.22), cyan, 0, 0.24, 0));
      const edge = mesh(gem(0.5), this.blade, 0, 1.25, 0);
      edge.scale.set(0.18, 2.0, 0.5);
      const halo = mesh(ball(0.5), this.aura, 0, 1.25, 0);
      halo.scale.set(0.45, 2.3, 0.8);
      halo.visible = false;
      held.add(edge, halo);
      this.auras.push(halo);
      a.add(held);
      this.arms.push(a);
      t.add(a);
    }
    r.add(t);
  }

  protected pose(dt: number, time: number): void {
    void dt;
    const hop = this.hop;
    const r = this.rig;
    r.position.y = 0.48 + Math.sin(time * 1.3) * 0.1 + hop * 3.5;
    r.rotation.x = Math.sin(time * 0.7) * 0.02 + hop * 0.15;
    r.rotation.z = Math.sin(time * 0.9) * 0.03 + this.jolt(time, 0.025);
    this.legs.forEach((leg, k) => {
      leg.rotation.x = 0.12 + Math.sin(time * 1.3 + k) * 0.05 + hop * (k ? -0.4 : 0.3);
    });
    this.arms.forEach((a, k) => {
      a.rotation.x = Math.sin(time * 1.3 + k * Math.PI) * 0.05 - this.cast * 0.15;
    });
    const glow = this.glow;
    this.blade.emissiveIntensity = (0.5 + Math.sin(time * 2.2) * 0.1 + glow * (2.4 + Math.sin(time * 12) * 0.4)) * this.fade;
    this.aura.opacity = glow * (0.38 + Math.sin(time * 14) * 0.07);
    for (const h of this.auras) h.visible = glow > 0.01;
    this.jet.opacity = (0.45 + Math.sin(time * 23) * 0.1) * this.fade;
    this.core.emissiveIntensity = (0.8 + Math.sin(time * 3) * 0.15 + this.cast * 1.2) * this.fade;
  }
}

/**
 * 雙極機神: the twins merged, a 6 m colossus split down the middle: one half red with a hammer for a fist,
 * the other blue with a crystal blade out of its fist (RED_SIDE says which is which), and a core of both
 * colours in the chest whose halves beat in turn; both blaze while it casts. It walks after the tank and
 * lifts the hammer high for 雙極重擊.
 */
export class Bipolar extends Rigged {
  private readonly legRed = new THREE.Group();
  private readonly legBlue = new THREE.Group();
  /** the red foot and the blue one, kept flat */
  private readonly feet: THREE.Mesh[] = [];
  private readonly torso = new THREE.Group();
  private readonly armRed = new THREE.Group();
  private readonly armBlue = new THREE.Group();
  private readonly coreRed: THREE.MeshToonMaterial;
  private readonly coreBlue: THREE.MeshToonMaterial;
  private readonly heat: THREE.MeshToonMaterial;
  private readonly edge: THREE.MeshToonMaterial;
  private raise = 0;

  constructor() {
    super('bipolar', 6.5, true, 4.5);
    const R = RED_SIDE;
    const B = -RED_SIDE;
    const red = this.toonOwn('#d23b2a');
    const deep = this.toonOwn('#8e2418');
    const black = this.toonOwn('#2a2428');
    const orange = this.lit('#ff8a2a', '#ff8a2a', 0.25);
    const blue = this.toonOwn('#3f7fd6');
    const navy = this.toonOwn('#1e2c4a');
    const white = this.toonOwn('#e8f2ff');
    const cyan = this.lit('#5fe0ff', '#5fe0ff', 0.3);
    const silver = this.toonOwn('#d8dce6');
    const eyeRed = this.lit('#ffb03a', '#ffb03a', 1);
    const eyeBlue = this.lit('#8ff4ff', '#8ff4ff', 1);
    this.coreRed = this.lit('#ff6a1a', '#ff6a1a', 0.9);
    this.coreBlue = this.lit('#6fe8ff', '#6fe8ff', 0.9);
    this.heat = this.lit('#3a3036', '#ff7a1a', 0.3);
    this.edge = this.lit('#9ef0ff', '#7fe8ff', 0.5);
    // built at the twins' size, then scaled up
    const big = new THREE.Group();
    big.scale.setScalar(1.3);
    this.rig.add(big);
    for (const [leg, s, frame, plate] of [
      [this.legRed, R, black, red],
      [this.legBlue, B, navy, blue],
    ] as const) {
      leg.position.set(s * 0.6, 2.0, 0);
      const foot = mesh(box(0.8, 0.3, 1.15), frame, 0, -1.86, 0.15);
      leg.add(mesh(box(0.7, 1.05, 0.75), frame, 0, -0.47, 0), mesh(box(0.68, 0.85, 0.72), plate, 0, -1.4, 0), foot);
      this.feet.push(foot);
      big.add(leg);
    }
    big.add(mesh(box(0.8, 0.6, 0.95), deep, R * 0.4, 2.05, 0), mesh(box(0.8, 0.6, 0.95), navy, B * 0.4, 2.05, 0));
    // the torso: two chest halves with a silver seam, the two-colour core, a split head
    const t = this.torso;
    t.position.y = 2.3;
    t.add(mesh(box(1.2, 0.6, 0.8), black, 0, 0.3, 0));
    t.add(mesh(box(1.1, 1.3, 1.4), red, R * 0.55, 1.15, 0), mesh(box(1.1, 1.3, 1.4), blue, B * 0.55, 1.15, 0));
    t.add(mesh(box(0.12, 1.36, 1.46), silver, 0, 1.15, 0));
    const half = this.geo(new THREE.SphereGeometry(0.42, 16, 12, Math.PI / 2, Math.PI)); // the +x half
    t.add(turned(mesh(half, this.coreRed, 0, 1.2, 0.72), 0, R > 0 ? 0 : Math.PI));
    t.add(turned(mesh(half, this.coreBlue, 0, 1.2, 0.72), 0, R > 0 ? Math.PI : 0));
    t.add(mesh(ring(0.47, 0.07), silver, 0, 1.2, 0.74));
    t.add(mesh(box(0.4, 0.72, 0.8), red, R * 0.2, 2.1, 0.05), mesh(box(0.4, 0.72, 0.8), blue, B * 0.2, 2.1, 0.05));
    t.add(mesh(box(0.3, 0.13, 0.05), eyeRed, R * 0.17, 2.12, 0.47), mesh(box(0.3, 0.13, 0.05), eyeBlue, B * 0.17, 2.12, 0.47));
    t.add(turned(mesh(cone(0.11, 0.5, 6), orange, R * 0.3, 2.55, 0), -0.6, 0, -R * 0.4));
    t.add(turned(mesh(box(0.08, 0.6, 0.45), cyan, B * 0.28, 2.55, -0.05), -0.3, 0, -B * 0.35));
    // shoulders: a spiked red one, a white one with a crystal fin
    t.add(turned(mesh(box(0.95, 0.6, 1.05), red, R * 1.3, 1.8, 0), 0, 0, -R * 0.25));
    t.add(turned(mesh(cone(0.13, 0.5, 6), orange, R * 1.55, 2.2, 0), 0, 0, -R * 0.6));
    t.add(turned(mesh(box(0.85, 0.45, 0.95), white, B * 1.28, 1.75, 0), 0, 0, -B * 0.3));
    const fin = turned(mesh(gem(0.2), cyan, B * 1.55, 2.08, -0.05), 0, 0, -B * 0.5);
    fin.scale.set(0.4, 2.2, 1);
    t.add(fin);
    // the hammer arm: the forearm ends in a hammer head instead of a fist
    this.armRed.position.set(R * 1.3, 1.55, 0.05);
    const hR = v3(-R * 0.1, -1.5, 0.6);
    const eR = arm(this.armRed, v3(0, 0, 0), hR, 0.95, 0.46, v3(R, -0.3, -0.6), [red, black, red]);
    // the head lies across the arm (its striking faces point to the sides), just past where the fist would be
    const at = hR.clone().addScaledVector(hR.clone().sub(eR).normalize(), 0.3);
    this.armRed.add(mesh(box(1.4, 1.0, 1.0), this.heat, at.x, at.y, at.z));
    for (const s of [1, -1]) this.armRed.add(mesh(box(0.14, 1.14, 1.14), orange, at.x + s * 0.74, at.y, at.z));
    t.add(this.armRed);
    // the blade arm: a long crystal blade out of the fist
    this.armBlue.position.set(B * 1.28, 1.55, 0.05);
    const hB = v3(-B * 0.15, -1.35, 0.7);
    arm(this.armBlue, v3(0, 0, 0), hB, 0.95, 0.4, v3(B, -0.3, -0.6), [blue, navy, blue]);
    this.armBlue.add(mesh(box(0.42, 0.42, 0.42), navy, hB.x, hB.y, hB.z));
    const held = aimed(hB, v3(B * 0.25, -0.3, 1));
    const edge = mesh(gem(0.5), this.edge, 0, 1.2, 0);
    edge.scale.set(0.2, 1.9, 0.6);
    held.add(mesh(box(0.5, 0.12, 0.3), cyan, 0, 0.25, 0), edge);
    this.armBlue.add(held);
    t.add(this.armBlue);
    // on its back: a red jet and a blue fin
    t.add(turned(mesh(cyl(0.2, 0.26, 0.55, 8), black, R * 0.55, 1.3, -0.85), Math.PI / 2));
    t.add(turned(mesh(box(0.1, 1.3, 0.55), blue, B * 0.6, 1.5, -0.8), -0.4, 0, -B * 0.5));
    big.add(t);
  }

  protected pose(dt: number, time: number): void {
    const s = Math.sin(this.walk) * this.stride;
    // legs swing from the hips with the feet kept flat; the foot moving forward is lifted
    const th = s * 0.45;
    const lift = Math.cos(this.walk) * 0.25 * this.stride;
    this.legRed.rotation.x = th;
    this.legBlue.rotation.x = -th;
    this.legRed.position.y = 2.0 + Math.max(0, -lift);
    this.legBlue.position.y = 2.0 + Math.max(0, lift);
    this.feet[0]!.rotation.x = -th;
    this.feet[1]!.rotation.x = th;
    const r = this.rig;
    // the body drops as the legs spread so the planted foot stays down (as 熾核, at 1.3 times the size)
    r.position.y = ((Math.cos(th) - 1) * 1.86 + Math.abs(Math.sin(th)) * 0.15) * 1.3 + this.hop * 3;
    r.rotation.z = this.jolt(time, 0.02);
    this.torso.position.y = 2.3 + Math.sin(time * 1.4) * 0.03;
    this.torso.rotation.y = -s * 0.08;
    // each arm swings against its leg; the hammer goes up high for the tank buster
    this.raise += ((this.casting === '雙極重擊' ? 1 : 0) - this.raise) * Math.min(1, dt * 4);
    this.armRed.rotation.x = -s * 0.25 - this.raise * 2.2;
    this.armBlue.rotation.x = s * 0.25;
    const beat = Math.sin(time * 2.5);
    const on = this.fade;
    this.coreRed.emissiveIntensity = (0.7 + Math.max(0, beat) * 0.9 + this.cast) * on;
    this.coreBlue.emissiveIntensity = (0.7 + Math.max(0, -beat) * 0.9 + this.cast) * on;
    this.heat.emissiveIntensity = (0.25 + Math.max(0, beat) * 0.6) * on;
    this.edge.emissiveIntensity = (0.4 + Math.max(0, -beat) * 0.6) * on;
  }
}
