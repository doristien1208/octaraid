import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Job, JobId } from '../../shared/jobs';

/**
 * Code-built models: the training dummy that stands in for the boss until the boss fights land (M3), the
 * shared cartoon materials and shapes, and a chibi character per job, used when the KayKit models
 * (avatar.ts) cannot be loaded. Models face +z.
 */

let gradient: THREE.DataTexture | null = null;

/** 3-step light ramp for the cartoon look. */
export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    const data = new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
    gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const materials = new Map<string, THREE.Material>();

/** Shared cartoon material per colour (and glow). Kept for the whole page: there are only a few dozen. */
export function toon(color: string, glow = 0): THREE.MeshToonMaterial {
  const key = `${color}/${glow}`;
  let m = materials.get(key) as THREE.MeshToonMaterial | undefined;
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    if (glow) {
      m.emissive = new THREE.Color(color);
      m.emissiveIntensity = glow;
    }
    materials.set(key, m);
  }
  return m;
}

const geometries = new Map<string, THREE.BufferGeometry>();

/** Shared geometries, built once per shape and size. */
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometries.get(key);
  if (!g) {
    g = make();
    geometries.set(key, g);
  }
  return g;
}

export const box = (w: number, hgt: number, d: number) => geo(`b${w},${hgt},${d}`, () => new THREE.BoxGeometry(w, hgt, d));
export const ball = (r: number) => geo(`s${r}`, () => new THREE.SphereGeometry(r, 20, 14));
export const cap = (r: number) => geo(`c${r}`, () => new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55));
export const cyl = (rt: number, rb: number, hgt: number, seg = 16) =>
  geo(`y${rt},${rb},${hgt},${seg}`, () => new THREE.CylinderGeometry(rt, rb, hgt, seg));
export const cone = (r: number, hgt: number, seg = 16) => geo(`k${r},${hgt},${seg}`, () => new THREE.ConeGeometry(r, hgt, seg));
export const ring = (r: number, t: number, arc = Math.PI * 2) =>
  geo(`t${r},${t},${arc}`, () => new THREE.TorusGeometry(r, t, 8, 32, arc));
export const gem = (r: number) => geo(`o${r}`, () => new THREE.OctahedronGeometry(r));
export const disc = (r: number) => geo(`d${r}`, () => new THREE.CircleGeometry(r, 40));
export const flatRing = (r0: number, r1: number) => geo(`f${r0},${r1}`, () => new THREE.RingGeometry(r0, r1, 48));

export function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  return o;
}

const SKIN = '#f6d6ba';
const DARK = '#2a2230';
const HAIR: Readonly<Record<JobId, string>> = {
  guardian: '#6b4a2b',
  berserker: '#2a2020',
  priest: '#e8c46a',
  warden: '#c9c6e6',
  brawler: '#3b2a1e',
  lancer: '#1d3a3a',
  ranger: '#7a4a24',
  sorcerer: '#1e1a24',
};
const ROBES: ReadonlySet<JobId> = new Set(['priest', 'warden', 'sorcerer']);

interface Orbiter {
  obj: THREE.Object3D;
  radius: number;
  height: number;
  speed: number;
  phase: number;
}

/** A code-built character with a simple walk cycle: the fallback when the KayKit models do not load. */
export class CodeBody {
  readonly body = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly orbiters: Orbiter[] = [];
  private walk = 0;
  private blend = 0;

  constructor(readonly job: Job) {
    const main = toon(job.colors.main);
    const trim = toon(job.colors.trim);
    const skin = toon(SKIN);
    const hair = toon(HAIR[job.id]);
    const dark = toon(DARK);

    // legs hang from the hips, arms from the shoulders, so the walk cycle just rotates the groups
    for (const [leg, x] of [
      [this.legL, 0.13],
      [this.legR, -0.13],
    ] as const) {
      leg.position.set(x, 0.55, 0);
      leg.add(mesh(box(0.2, 0.52, 0.22), ROBES.has(job.id) ? dark : trim, 0, -0.27, 0));
      leg.add(mesh(box(0.22, 0.1, 0.3), dark, 0, -0.52, 0.04));
      this.body.add(leg);
    }
    this.body.add(mesh(cyl(0.27, 0.32, 0.55), main, 0, 0.83, 0));
    this.body.add(mesh(cyl(0.335, 0.335, 0.08), trim, 0, 0.6, 0));
    if (ROBES.has(job.id)) this.body.add(mesh(cyl(0.33, 0.47, 0.45), main, 0, 0.45, 0));
    for (const [arm, x] of [
      [this.armL, 0.38],
      [this.armR, -0.38],
    ] as const) {
      arm.position.set(x, 1.04, 0);
      arm.add(mesh(box(0.14, 0.42, 0.14), main, 0, -0.2, 0));
      arm.add(mesh(ball(0.085), job.id === 'brawler' ? toon('#ff9a3c', 0.7) : skin, 0, -0.44, 0));
      this.body.add(arm);
    }
    // head: a big chibi head with hair and two eyes
    this.body.add(mesh(ball(0.34), skin, 0, 1.43, 0));
    const hairCap = mesh(cap(0.36), hair, 0, 1.45, -0.02);
    hairCap.rotation.x = -0.25;
    this.body.add(hairCap);
    for (const x of [0.11, -0.11]) this.body.add(mesh(box(0.06, 0.1, 0.02), dark, x, 1.4, 0.33));

    this.dress(job.id, main, trim);
  }

  /** Hats, weapons and floating bits that make each job recognisable at a glance. */
  private dress(id: JobId, main: THREE.Material, trim: THREE.Material): void {
    const b = this.body;
    const metal = toon('#c9d3e0');
    const wood = toon('#8a5a33');
    const gold = toon('#e0b23a', 0.35);
    switch (id) {
      case 'guardian': {
        b.add(mesh(cap(0.38), metal, 0, 1.47, 0));
        b.add(mesh(cone(0.07, 0.34), toon('#d84343'), 0, 1.92, -0.05));
        const sword = new THREE.Group();
        sword.add(mesh(box(0.06, 0.85, 0.03), metal, 0, 0.45, 0));
        sword.add(mesh(box(0.26, 0.05, 0.06), toon('#e0b23a'), 0, 0.03, 0));
        sword.position.set(0, -0.46, 0.05);
        sword.rotation.x = 1.2;
        this.armR.add(sword);
        const shield = mesh(box(0.06, 0.66, 0.48), main, 0.08, -0.3, 0.06);
        shield.add(mesh(box(0.07, 0.5, 0.3), trim, 0.01, 0, 0));
        this.armL.add(shield);
        break;
      }
      case 'berserker': {
        b.add(mesh(cap(0.38), toon('#3a3036'), 0, 1.47, 0));
        for (const s of [1, -1]) {
          const horn = mesh(cone(0.07, 0.32), toon('#efe6d2'), s * 0.33, 1.72, 0);
          horn.rotation.z = -s * 0.9;
          b.add(horn);
        }
        const axe = new THREE.Group();
        axe.add(mesh(cyl(0.035, 0.035, 1.35), wood, 0, 0.45, 0));
        axe.add(mesh(box(0.05, 0.42, 0.5), metal, 0, 0.95, 0.2));
        axe.position.set(0, -0.44, 0.05);
        axe.rotation.x = 0.9;
        this.armR.add(axe);
        break;
      }
      case 'priest': {
        const hood = mesh(cap(0.4), main, 0, 1.44, -0.06);
        hood.rotation.x = -0.55;
        b.add(hood);
        const halo = mesh(ring(0.3, 0.025), gold, 0, 1.55, -0.32);
        b.add(halo);
        const staff = new THREE.Group();
        staff.add(mesh(cyl(0.03, 0.03, 1.75), wood, 0, 0.55, 0));
        staff.add(mesh(ring(0.17, 0.03), gold, 0, 1.5, 0));
        staff.add(mesh(ball(0.07), toon('#ffe9a6', 0.9), 0, 1.5, 0));
        staff.position.set(0, -0.44, 0.08);
        this.armR.add(staff);
        break;
      }
      case 'warden': {
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          b.add(mesh(cone(0.05, 0.18), toon('#8e6bd1', 0.4), Math.sin(a) * 0.24, 1.78, Math.cos(a) * 0.24));
        }
        this.armL.add(mesh(box(0.08, 0.3, 0.24), toon('#5b3f99'), 0.06, -0.45, 0.1));
        for (let k = 0; k < 3; k++) {
          const orb = mesh(gem(0.09), toon('#b9a4ff', 0.9));
          b.add(orb);
          this.orbiters.push({ obj: orb, radius: 0.62, height: 1.25, speed: 1.6, phase: (k / 3) * Math.PI * 2 });
        }
        break;
      }
      case 'brawler': {
        const band = mesh(ring(0.35, 0.03), toon('#d84343'), 0, 1.55, 0);
        band.rotation.x = Math.PI / 2;
        b.add(band);
        for (const s of [1, -1]) {
          const tail = mesh(box(0.05, 0.32, 0.02), toon('#d84343'), s * 0.06, 1.42, -0.36);
          tail.rotation.x = 0.4;
          b.add(tail);
        }
        break;
      }
      case 'lancer': {
        b.add(mesh(cap(0.38), trim, 0, 1.47, 0));
        for (const s of [1, -1]) {
          const wing = mesh(box(0.03, 0.22, 0.32), toon('#ffffff'), s * 0.36, 1.62, -0.05);
          wing.rotation.z = -s * 0.5;
          b.add(wing);
        }
        const spear = new THREE.Group();
        spear.add(mesh(cyl(0.03, 0.03, 2.3), toon('#1f6f6f'), 0, 0.7, 0));
        spear.add(mesh(cone(0.07, 0.32), metal, 0, 1.98, 0));
        spear.position.set(0, -0.44, 0.06);
        this.armR.add(spear);
        break;
      }
      case 'ranger': {
        const hat = mesh(cone(0.33, 0.36), main, 0, 1.78, -0.02);
        hat.rotation.x = -0.2;
        b.add(hat);
        const feather = mesh(box(0.03, 0.34, 0.08), toon('#d84343'), 0.18, 1.85, -0.1);
        feather.rotation.z = -0.5;
        b.add(feather);
        const bow = mesh(ring(0.5, 0.025, Math.PI), wood, 0.08, -0.45, 0.1);
        bow.rotation.y = Math.PI / 2;
        bow.rotation.z = Math.PI / 2;
        this.armL.add(bow);
        const quiver = mesh(cyl(0.09, 0.09, 0.55), trim, -0.12, 0.95, -0.32);
        quiver.rotation.z = 0.35;
        b.add(quiver);
        break;
      }
      case 'sorcerer': {
        b.add(mesh(cyl(0.58, 0.58, 0.04, 28), main, 0, 1.66, 0));
        const hat = mesh(cone(0.33, 0.78, 20), main, 0, 2.05, 0);
        hat.rotation.x = -0.15;
        b.add(hat);
        const wand = new THREE.Group();
        wand.add(mesh(cyl(0.025, 0.025, 0.55), toon('#2a1f2b'), 0, 0.25, 0));
        wand.add(mesh(ball(0.06), toon('#ff7a2c', 1), 0, 0.55, 0));
        wand.position.set(0, -0.44, 0.06);
        wand.rotation.x = 0.8;
        this.armR.add(wand);
        for (let k = 0; k < 2; k++) {
          const rune = mesh(gem(0.08), toon('#ff5a2c', 1));
          b.add(rune);
          this.orbiters.push({ obj: rune, radius: 0.55, height: 1.0, speed: 2.4, phase: k * Math.PI });
        }
        break;
      }
    }
  }

  /** Animates the walk cycle for this frame. */
  update(moving: boolean, dt: number, time: number): void {
    this.blend += ((moving ? 1 : 0) - this.blend) * Math.min(1, dt * 10);
    if (moving) this.walk += dt * 11;
    const s = Math.sin(this.walk) * this.blend;
    this.legL.rotation.x = s * 0.7;
    this.legR.rotation.x = -s * 0.7;
    this.armL.rotation.x = -s * 0.5;
    this.armR.rotation.x = s * 0.3;
    this.body.position.y = Math.abs(Math.sin(this.walk)) * 0.07 * this.blend + Math.sin(time * 2.2) * 0.012;
    for (const o of this.orbiters) {
      const a = time * o.speed + o.phase;
      o.obj.position.set(Math.cos(a) * o.radius, o.height + Math.sin(a * 2) * 0.08, Math.sin(a) * o.radius);
      o.obj.rotation.y = a * 2;
    }
  }
}

let shadowMat: THREE.Material | null = null;
export function shadowMaterial(): THREE.Material {
  shadowMat ??= new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });
  return shadowMat;
}

let myRingMat: THREE.Material | null = null;
export function myRingMaterial(): THREE.Material {
  myRingMat ??= new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9, depthWrite: false });
  return myRingMat;
}

/**
 * The training dummy (木人) that stands where the boss will be. It turns to face whoever is top of its
 * enmity list and carries the boss's target ring: a gap marks its rear, ticks the corners of the 90°
 * rear and flank arcs (positionals), an arrow its front.
 */
export class Dummy {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
  private readonly pickMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: 0xffb03b, transparent: true, opacity: 0, depthWrite: false });
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly picked: THREE.Mesh;
  private readonly plate: HTMLElement;
  private shake = 0;
  private casting = false;
  private glow = 0;
  /** what a mouse click on the dummy hits */
  readonly hitbox: THREE.Mesh;

  constructor(name: string, readonly r: number) {
    const wood = toon('#b98b58');
    const darkWood = toon('#7a5432');
    const red = toon('#d84343');
    const b = this.body;
    b.add(mesh(cyl(0.65, 0.75, 0.2, 24), darkWood, 0, 0.1, 0));
    b.add(mesh(cyl(0.13, 0.13, 1.3), darkWood, 0, 0.75, 0));
    b.add(mesh(cyl(0.42, 0.38, 1.0, 20), wood, 0, 1.75, 0));
    const arms = mesh(cyl(0.09, 0.09, 1.6), darkWood, 0, 1.95, 0);
    arms.rotation.z = Math.PI / 2;
    b.add(arms);
    b.add(mesh(ball(0.32), wood, 0, 2.55, 0));
    b.add(mesh(ring(0.22, 0.05), red, 0, 1.8, 0.4));
    b.add(mesh(ball(0.07), red, 0, 1.8, 0.42));
    b.scale.setScalar(1.5);
    this.root.add(b);

    const own = <T extends THREE.BufferGeometry>(g: T) => (this.geos.push(g), g);
    const flat = (m: THREE.Mesh, y: number) => {
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      this.root.add(m);
      return m;
    };
    // the ring with a gap at the back; ticks at ±45° and ±135° split front, flanks and rear
    flat(new THREE.Mesh(own(new THREE.RingGeometry(r - 0.1, r + 0.05, 64, 1, Math.PI * 0.6, Math.PI * 1.8)), this.ringMat), 0.03);
    for (const a of [Math.PI / 4, (Math.PI * 3) / 4, (Math.PI * 5) / 4, (Math.PI * 7) / 4]) {
      const tick = new THREE.Mesh(own(new THREE.PlaneGeometry(0.12, 0.7)), this.ringMat);
      tick.rotation.x = -Math.PI / 2;
      tick.rotation.z = a; // after lying flat, the long side points away from the centre
      tick.position.set(Math.sin(a) * (r + 0.3), 0.035, Math.cos(a) * (r + 0.3));
      this.root.add(tick);
    }
    const arrow = new THREE.Mesh(own(new THREE.ConeGeometry(0.3, 0.5, 3)), this.ringMat);
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0.04, r + 0.35);
    this.root.add(arrow);
    // shown while it is my target
    this.picked = flat(new THREE.Mesh(own(new THREE.RingGeometry(r + 0.15, r + 0.45, 64)), this.pickMat), 0.025);
    this.picked.visible = false;
    // a glow while it casts
    const glow = new THREE.Mesh(own(new THREE.SphereGeometry(1.25, 20, 14)), this.glowMat);
    glow.position.y = 2.6;
    this.root.add(glow);

    this.hitbox = new THREE.Mesh(own(new THREE.CylinderGeometry(r * 0.6, r * 0.6, 4.2, 12)), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = 2.1;
    this.root.add(this.hitbox);

    this.plate = document.createElement('div');
    this.plate.className = 'nameplate boss';
    this.plate.textContent = name;
    const tag = new CSS2DObject(this.plate);
    tag.position.set(0, 4.6, 0);
    this.root.add(tag);
  }

  setTargeted(on: boolean): void {
    this.picked.visible = on;
  }

  setCasting(on: boolean): void {
    this.casting = on;
  }

  /** a small shake when something hits it */
  hit(): void {
    this.shake = 1;
  }

  update(x: number, z: number, f: number, dt: number, time: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = f;
    this.shake = Math.max(0, this.shake - dt * 6);
    this.body.rotation.z = Math.sin(time * 60) * 0.03 * this.shake;
    this.glow += ((this.casting ? 1 : 0) - this.glow) * Math.min(1, dt * 6);
    this.glowMat.opacity = this.glow * (0.25 + Math.sin(time * 10) * 0.08);
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.ringMat.dispose();
    this.pickMat.dispose();
    this.glowMat.dispose();
    (this.hitbox.material as THREE.Material).dispose();
    this.plate.remove();
  }
}
