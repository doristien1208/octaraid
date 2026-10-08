import * as THREE from 'three';
import { FOES, type FoeKind } from '../../shared/bosses/foes';
import { Bipolar, Drone, Ember, Frost, Frostwitch, Gatekeeper, Mirror } from './bosses4';
import { FoeBase, rock, type FoeView } from './foebase';
import { Dummy, box, cone, cyl, mesh, toonGradient } from './models';

export type { FoeView } from './foebase';

/**
 * 崩岩巨像: a 6 m stone giant of rough blocks with a lava core in its chest that brightens while it casts.
 * It raises its right arm for 岩拳橫掃 (Hard shows nothing else), leaps to the middle before its adds, and
 * goes dull and grey while it cannot be targeted.
 */
class Colossus extends FoeBase {
  private readonly stone: THREE.MeshToonMaterial;
  private readonly dark: THREE.MeshToonMaterial;
  private readonly lava: THREE.MeshToonMaterial;
  private readonly torso = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly core: THREE.Mesh;
  private raise = 0;
  private glow = 0;
  private leap = -1;
  private dim = 0;

  constructor() {
    super('colossus', 6.2, true);
    this.stone = this.toonOwn('#9a8a78');
    this.dark = this.toonOwn('#6a5b4f');
    this.lava = this.toonOwn('#ff7a2c', 0.9);
    const b = this.body;
    // legs and hips
    for (const s of [1, -1]) {
      b.add(rock(1.5, 2.3, 1.5, this.dark, s * 1.15, 1.15, 0));
      b.add(rock(1.8, 0.6, 2.0, this.dark, s * 1.2, 0.3, 0.2));
    }
    b.add(rock(3.4, 1.1, 2.2, this.stone, 0, 2.6, 0));
    // the torso turns and breathes; the core sits in it
    this.torso.position.y = 3.1;
    this.torso.add(rock(4.2, 2.8, 2.7, this.stone, 0, 1.4, 0, 0.05));
    this.torso.add(rock(1.6, 1.3, 1.5, this.dark, 0, 3.4, 0.2));
    this.core = mesh(new THREE.SphereGeometry(0.6, 16, 12), this.lava, 0, 1.5, 1.35);
    this.torso.add(this.core);
    for (const s of [1, -1]) {
      this.torso.add(mesh(box(0.35, 0.08, 0.05), this.lava, s * 0.35, 3.45, 0.98)); // eyes
      this.torso.add(rock(1.4, 0.9, 1.6, this.dark, s * 2.3, 2.6, -0.1)); // shoulders
      this.torso.add(rock(0.8, 0.12, 0.05, this.lava, s * 1.1, 1.2 + s * 0.3, 1.36, 0.6)); // cracks of lava
    }
    // arms hang from the shoulders
    for (const [arm, s] of [
      [this.armL, 1],
      [this.armR, -1],
    ] as const) {
      arm.position.set(s * 2.5, 2.6, 0);
      arm.add(rock(1.1, 2.0, 1.1, this.stone, 0, -1.1, 0));
      arm.add(rock(1.3, 1.6, 1.3, this.dark, 0, -2.7, 0.1));
      arm.add(rock(1.7, 1.3, 1.7, this.stone, 0, -3.8, 0.15));
      this.torso.add(arm);
    }
    b.add(this.torso);
  }

  act(move: string): void {
    if (move === 'jump') this.leap = 0;
  }

  protected animate(dt: number, time: number): void {
    const sweep = this.casting === '岩拳橫掃';
    this.raise += ((sweep ? 1 : 0) - this.raise) * Math.min(1, dt * 4);
    this.glow += ((this.casting ? 1 : 0) - this.glow) * Math.min(1, dt * 5);
    this.dim += ((this.untargetable && !this.gone ? 1 : 0) - this.dim) * Math.min(1, dt * 3);
    this.lava.emissiveIntensity = 0.5 + this.glow * (1.2 + Math.sin(time * 9) * 0.4);
    this.core.scale.setScalar(1 + this.glow * 0.15);
    this.stone.color.set('#9a8a78').lerp(new THREE.Color('#5a5a5f'), this.dim * 0.7);
    this.dark.color.set('#6a5b4f').lerp(new THREE.Color('#404046'), this.dim * 0.7);
    this.torso.position.y = 3.1 + Math.sin(time * 1.6) * 0.06;
    this.torso.rotation.z = Math.sin(time * 40) * 0.02 * this.shake;
    // the right arm lifts high for the sweep; the left one sways
    this.armR.rotation.x = -this.raise * 2.6 + Math.sin(time * 1.6 + 1) * 0.05;
    this.armR.rotation.z = this.raise * 0.4;
    this.armL.rotation.x = Math.sin(time * 1.6) * 0.06;
    if (this.leap >= 0) {
      this.leap += dt;
      const k = Math.min(1, this.leap / 1.4);
      this.body.position.y = Math.sin(k * Math.PI) * 4;
      if (k >= 1) {
        this.leap = -1;
        this.body.position.y = 0;
      }
    }
  }
}

/** 岩巨兵: a small walking rock with glowing blue eyes. */
class Golem extends FoeBase {
  private readonly torso = new THREE.Group();
  private last = new THREE.Vector3();
  private walk = 0;

  constructor() {
    super('golem', 2.6, false);
    const stone = this.toonOwn('#8f8577');
    const dark = this.toonOwn('#5f574f');
    const eye = this.toonOwn('#7fd8ff', 1);
    for (const s of [1, -1]) this.body.add(rock(0.6, 0.9, 0.6, dark, s * 0.45, 0.45, 0));
    this.torso.position.y = 0.9;
    this.torso.add(rock(1.5, 1.2, 1.1, stone, 0, 0.6, 0));
    this.torso.add(rock(0.8, 0.6, 0.7, dark, 0, 1.5, 0.1));
    for (const s of [1, -1]) {
      this.torso.add(mesh(box(0.14, 0.06, 0.04), eye, s * 0.18, 1.55, 0.46));
      this.torso.add(rock(0.5, 1.1, 0.5, stone, s * 0.95, 0.25, 0.1));
    }
    this.body.add(this.torso);
  }

  protected animate(dt: number, time: number): void {
    const moved = this.root.position.distanceTo(this.last) > 0.001;
    this.last.copy(this.root.position);
    if (moved) this.walk += dt * 9;
    this.torso.position.y = 0.9 + Math.abs(Math.sin(this.walk)) * 0.12 + Math.sin(time * 2) * 0.02;
    this.torso.rotation.z = Math.sin(this.walk) * 0.06 + Math.sin(time * 40) * 0.03 * this.shake;
  }
}

/** 岩牢: amber rock spikes closing around a player. */
class Prison extends FoeBase {
  constructor() {
    super('prison', 2.4, false);
    const rockMat = this.toonOwn('#c89a5a');
    const glass = new THREE.MeshToonMaterial({ color: '#e8c48a', gradientMap: toonGradient(), transparent: true, opacity: 0.55 });
    this.mats.push(glass);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const spike = mesh(cone(0.38, 2.4 - (k % 2) * 0.5), k % 2 ? rockMat : glass, Math.sin(a) * 0.72, 1.1, Math.cos(a) * 0.72);
      spike.rotation.set(Math.cos(a) * -0.25, 0, Math.sin(a) * 0.25);
      this.body.add(spike);
    }
    this.body.add(mesh(cyl(0.9, 1.0, 0.3, 14), rockMat, 0, 0.15, 0));
  }

  protected animate(dt: number, time: number): void {
    this.body.rotation.y = Math.sin(time * 0.8) * 0.05;
    this.body.position.x = Math.sin(time * 50) * 0.04 * this.shake;
    void dt;
  }
}

/** The training dummy, behind the same interface. */
class DummyFoe implements FoeView {
  private readonly d: Dummy;
  readonly root: THREE.Group;
  readonly hitbox: THREE.Object3D;

  constructor() {
    this.d = new Dummy(FOES.dummy.name, FOES.dummy.ring);
    this.root = this.d.root;
    this.hitbox = this.d.hitbox;
  }

  update(x: number, z: number, f: number, dt: number, time: number): void {
    this.d.update(x, z, f, dt, time);
  }
  setTargeted(on: boolean): void {
    this.d.setTargeted(on);
  }
  setCasting(name: string | null): void {
    this.d.setCasting(name !== null);
  }
  hit(): void {
    this.d.hit();
  }
  setState(): void {}
  act(): void {}
  dispose(): void {
    this.d.dispose();
  }
}

export function makeFoe(kind: FoeKind): FoeView {
  switch (kind) {
    case 'colossus':
      return new Colossus();
    case 'golem':
      return new Golem();
    case 'prison':
      return new Prison();
    case 'dummy':
      return new DummyFoe();
    case 'frostwitch':
      return new Frostwitch();
    case 'mirror':
      return new Mirror();
    case 'gatekeeper':
      return new Gatekeeper();
    case 'drone':
      return new Drone();
    case 'ember':
      return new Ember();
    case 'frost':
      return new Frost();
    case 'bipolar':
      return new Bipolar();
  }
}
