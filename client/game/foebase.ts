import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { FOES, type FoeKind } from '../../shared/bosses/foes';
import { box, mesh, toonGradient } from './models';

/**
 * What the view needs from any enemy on screen: the training dummy, the bosses (built in code, section 八)
 * and what they summon.
 */
export interface FoeView {
  readonly root: THREE.Group;
  /** what a mouse click on it hits */
  readonly hitbox: THREE.Object3D;
  update(x: number, z: number, f: number, dt: number, time: number): void;
  setTargeted(on: boolean): void;
  /** the name of the move it is casting, or null */
  setCasting(name: string | null): void;
  /** a small shake when something hits it */
  hit(): void;
  /** between phases (cannot be targeted) or gone (dead, broken) */
  setState(untargetable: boolean, gone: boolean): void;
  /** a one-off move: 'jump' (a leap), 'glow' (a twin's weapon burns), 'charge' (熾核 rushes) */
  act(move: string): void;
  dispose(): void;
}

/** The ground ring with its positional ticks, the picked ring, the name plate and the hitbox, shared by all foes. */
export abstract class FoeBase implements FoeView {
  readonly root = new THREE.Group();
  readonly hitbox: THREE.Mesh;
  protected readonly body = new THREE.Group();
  protected readonly mats: THREE.Material[] = [];
  protected readonly geos: THREE.BufferGeometry[] = [];
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly pickMat: THREE.MeshBasicMaterial;
  private readonly picked: THREE.Mesh;
  private readonly plate: HTMLElement;
  protected casting: string | null = null;
  protected shake = 0;
  protected fade = 1;
  protected gone = false;
  protected untargetable = false;

  constructor(
    readonly kind: FoeKind,
    height: number,
    ticks: boolean,
  ) {
    const r = FOES[kind].ring;
    this.ringMat = this.basic(0xff6b6b, 0.7);
    this.pickMat = this.basic(0xff3b3b, 0.55);
    const flat = (m: THREE.Mesh, y: number) => {
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      this.root.add(m);
      return m;
    };
    flat(new THREE.Mesh(this.geo(new THREE.RingGeometry(r - 0.1, r + 0.05, 64, 1, Math.PI * 0.6, Math.PI * 1.8)), this.ringMat), 0.03);
    if (ticks) {
      for (const a of [Math.PI / 4, (Math.PI * 3) / 4, (Math.PI * 5) / 4, (Math.PI * 7) / 4]) {
        const tick = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.14, 0.8)), this.ringMat);
        tick.rotation.x = -Math.PI / 2;
        tick.rotation.z = a;
        tick.position.set(Math.sin(a) * (r + 0.35), 0.035, Math.cos(a) * (r + 0.35));
        this.root.add(tick);
      }
      const arrow = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.35, 0.6, 3)), this.ringMat);
      arrow.rotation.x = Math.PI / 2;
      arrow.position.set(0, 0.04, r + 0.4);
      this.root.add(arrow);
    }
    this.picked = flat(new THREE.Mesh(this.geo(new THREE.RingGeometry(r + 0.15, r + 0.5, 64)), this.pickMat), 0.025);
    this.picked.visible = false;
    this.hitbox = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(Math.max(0.8, r * 0.7), Math.max(0.8, r * 0.7), height, 12)), new THREE.MeshBasicMaterial({ visible: false }));
    this.mats.push(this.hitbox.material as THREE.Material);
    this.hitbox.position.y = height / 2;
    this.root.add(this.hitbox, this.body);
    this.plate = document.createElement('div');
    this.plate.className = `nameplate ${FOES[kind].boss ? 'boss' : 'add'}`;
    this.plate.textContent = FOES[kind].name;
    const tag = new CSS2DObject(this.plate);
    tag.position.set(0, height + 0.6, 0);
    this.root.add(tag);
  }

  protected basic(color: number, opacity: number): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.mats.push(m);
    return m;
  }

  /** A cartoon material of its own (so this foe can darken or glow without touching others). */
  protected toonOwn(color: string, glow = 0): THREE.MeshToonMaterial {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    if (glow) {
      m.emissive = new THREE.Color(color);
      m.emissiveIntensity = glow;
    }
    this.mats.push(m);
    return m;
  }

  protected geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  setTargeted(on: boolean): void {
    this.picked.visible = on && !this.gone;
  }

  setCasting(name: string | null): void {
    this.casting = name;
  }

  hit(): void {
    this.shake = 1;
  }

  setState(untargetable: boolean, gone: boolean): void {
    this.untargetable = untargetable;
    if (gone !== this.gone) {
      this.gone = gone;
      // an add that stands up again (Hard 岩巨兵) comes back whole
      if (!gone) {
        this.fade = 1;
        this.body.position.y = 0;
        this.body.scale.setScalar(1);
        this.ringMat.opacity = 0.7;
        this.plate.style.opacity = '1';
      }
    }
    this.plate.classList.toggle('dim', untargetable);
    this.picked.visible = this.picked.visible && !gone;
  }

  act(move: string): void {
    void move;
  }

  update(x: number, z: number, f: number, dt: number, time: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = f;
    this.shake = Math.max(0, this.shake - dt * 6);
    if (this.gone) {
      // sinks into the ground
      this.fade = Math.max(0, this.fade - dt * 0.9);
      this.body.position.y = -(1 - this.fade) * 2.5;
      this.body.scale.setScalar(0.6 + this.fade * 0.4);
      this.ringMat.opacity = 0.7 * this.fade;
      this.plate.style.opacity = String(this.fade);
    }
    this.animate(dt, time);
  }

  protected abstract animate(dt: number, time: number): void;

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.plate.remove();
  }
}

/** A rough block of rock, turned a little so the silhouette is not too tidy. */
export function rock(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, tilt = 0.12): THREE.Mesh {
  const m = mesh(box(w, h, d), mat, x, y, z);
  m.rotation.set((Math.sin(x * 7 + y) * tilt) / 2, Math.sin(y * 3 + z) * tilt, (Math.cos(x + z * 5) * tilt) / 2);
  return m;
}
