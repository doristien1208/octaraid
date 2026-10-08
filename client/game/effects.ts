import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/** Something on screen for a moment: k runs from 0 to 1 over its life. */
interface Item {
  obj: THREE.Object3D;
  t: number;
  dur: number;
  step(k: number, dt: number): void;
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
  /** a CSS label (combat text) to remove at the end */
  el?: HTMLElement;
}

type P = { x: number; y: number; z: number };

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Short code-built effects for skills and boss moves (section 八: effects are made in code): projectiles,
 * rings and fans on the ground matching the areas the simulation uses, bursts, heal sparkles, light
 * pillars, combat numbers, and the lasting circles of 星界領域 and 魔力湧泉.
 */
export class Effects {
  readonly group = new THREE.Group();
  private items: Item[] = [];
  private readonly zones = new Map<string, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; geo: THREE.BufferGeometry; seen: boolean }>();
  private readonly unitCircle = new THREE.CircleGeometry(1, 48);
  private readonly unitRing = new THREE.RingGeometry(0.92, 1, 48);
  private readonly unitSphere = new THREE.SphereGeometry(1, 16, 12);
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly spark = new THREE.OctahedronGeometry(0.09);

  private mat(color: string | number, opacity = 0.6, additive = true): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
  }

  private add(item: Omit<Item, 't'>): void {
    this.group.add(item.obj);
    this.items.push({ ...item, t: 0 });
  }

  // ------------------------------------------------------------------ shapes on the ground

  /** A filled circle that flashes and fades (an area attack), with a bright rim. */
  ring(x: number, z: number, r: number, color: string, dur = 0.55): void {
    // plain blending on the ground: added light would vanish on the snow of the ice arena
    const fill = this.mat(color, 0.35, false);
    const rim = this.mat(color, 0.9, false);
    const g = new THREE.Group();
    const disc = new THREE.Mesh(this.unitCircle, fill);
    const edge = new THREE.Mesh(this.unitRing, rim);
    for (const m of [disc, edge]) {
      m.rotation.x = -Math.PI / 2;
      m.scale.setScalar(r);
      g.add(m);
    }
    g.position.set(x, 0.06, z);
    this.add({
      obj: g,
      dur,
      mats: [fill, rim],
      geos: [],
      step: (k) => {
        const grow = 0.6 + 0.4 * Math.min(1, k * 4);
        disc.scale.setScalar(r * grow);
        edge.scale.setScalar(r * grow);
        fill.opacity = 0.35 * (1 - k);
        rim.opacity = 0.9 * (1 - k);
      },
    });
  }

  /** An expanding shock ring (raid-wide attacks, landing jumps). */
  wave(x: number, z: number, r: number, color: string, dur = 0.8): void {
    const m = this.mat(color, 0.8, false);
    const edge = new THREE.Mesh(this.unitRing, m);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(x, 0.08, z);
    this.add({
      obj: edge,
      dur,
      mats: [m],
      geos: [],
      step: (k) => {
        edge.scale.setScalar(Math.max(0.1, r * k));
        m.opacity = 0.8 * (1 - k);
      },
    });
  }

  /** A fan in front of (x, z) facing f: a cone attack. */
  fan(x: number, z: number, f: number, r: number, deg: number, color: string, dur = 0.45): void {
    const rad = (deg * Math.PI) / 180;
    const geo = new THREE.CircleGeometry(r, 24, Math.PI / 2 - rad / 2, rad);
    const m = this.mat(color, 0.45, false);
    const mesh = new THREE.Mesh(geo, m);
    mesh.rotation.x = -Math.PI / 2;
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(x, 0.06, z);
    g.rotation.y = f + Math.PI; // the fan's middle points along (sin f, cos f)
    this.add({ obj: g, dur, mats: [m], geos: [geo], step: (k) => (m.opacity = 0.45 * (1 - k)) });
  }

  /** A strip from (x, z) along f: a line attack. */
  line(x: number, z: number, f: number, len: number, w: number, color: string, dur = 0.45): void {
    const m = this.mat(color, 0.5, false);
    const mesh = new THREE.Mesh(this.unitBox, m);
    mesh.scale.set(w, 0.04, len);
    mesh.position.set(0, 0, len / 2);
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(x, 0.08, z);
    g.rotation.y = f;
    this.add({
      obj: g,
      dur,
      mats: [m],
      geos: [],
      step: (k) => {
        m.opacity = 0.5 * (1 - k);
        mesh.scale.x = w * (1 - k * 0.5);
      },
    });
  }

  // ------------------------------------------------------------------ in the air

  /** A glowing ball flying from `from` to wherever `to()` is, then a burst there. */
  projectile(from: P, to: () => P, color: string, kind: 'orb' | 'arrow' = 'orb', dur = 0.3): void {
    const m = this.mat(color, 0.95);
    const mesh = new THREE.Mesh(this.unitSphere, m);
    if (kind === 'arrow') mesh.scale.set(0.05, 0.05, 0.55);
    else mesh.scale.setScalar(0.22);
    const start = new THREE.Vector3(from.x, from.y, from.z);
    this.add({
      obj: mesh,
      dur,
      mats: [m],
      geos: [],
      step: (k) => {
        const end = to();
        const p = start.clone().lerp(new THREE.Vector3(end.x, end.y, end.z), k);
        p.y += Math.sin(k * Math.PI) * (kind === 'arrow' ? 0.8 : 0.3);
        if (kind === 'arrow') mesh.lookAt(end.x, end.y, end.z);
        mesh.position.copy(p);
        if (k >= 1) this.burst(end.x, end.y, end.z, 0.6, color, 0.25);
      },
    });
  }

  /** A quick flash of light. */
  burst(x: number, y: number, z: number, r: number, color: string, dur = 0.3): void {
    const m = this.mat(color, 0.8);
    const mesh = new THREE.Mesh(this.unitSphere, m);
    mesh.position.set(x, y, z);
    this.add({
      obj: mesh,
      dur,
      mats: [m],
      geos: [],
      step: (k) => {
        mesh.scale.setScalar(r * (0.4 + k));
        m.opacity = 0.8 * (1 - k);
      },
    });
  }

  /** A sword arc at a melee hit. */
  slash(x: number, y: number, z: number, f: number, color: string): void {
    const geo = new THREE.TorusGeometry(0.9, 0.05, 6, 24, Math.PI * 0.9);
    const m = this.mat(color, 0.95);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(Math.random() * 0.8 - 0.4, f + Math.PI / 2, Math.random() * Math.PI);
    this.add({
      obj: mesh,
      dur: 0.25,
      mats: [m],
      geos: [geo],
      step: (k) => {
        mesh.scale.setScalar(0.7 + k * 0.5);
        m.opacity = 0.95 * (1 - k);
      },
    });
  }

  /** Little lights rising around someone being healed (or buffed). */
  sparkle(x: number, z: number, color: string, n = 8, dur = 0.9): void {
    const m = this.mat(color, 0.9);
    const g = new THREE.Group();
    const bits: { mesh: THREE.Mesh; a: number; r: number; v: number }[] = [];
    for (let k = 0; k < n; k++) {
      const mesh = new THREE.Mesh(this.spark, m);
      bits.push({ mesh, a: Math.random() * Math.PI * 2, r: 0.3 + Math.random() * 0.4, v: 1.2 + Math.random() * 1.2 });
      g.add(mesh);
    }
    g.position.set(x, 0, z);
    this.add({
      obj: g,
      dur,
      mats: [m],
      geos: [],
      step: (k) => {
        for (const b of bits) b.mesh.position.set(Math.cos(b.a + k * 3) * b.r, 0.2 + k * b.v * 1.5, Math.sin(b.a + k * 3) * b.r);
        m.opacity = 0.9 * (1 - k);
      },
    });
  }

  /** A column of light (raise, the healer's Limit Break). */
  pillar(x: number, z: number, color: string, dur = 1.2, r = 0.8): void {
    const geo = new THREE.CylinderGeometry(r, r, 8, 20, 1, true);
    const m = this.mat(color, 0.5);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, 4, z);
    this.add({
      obj: mesh,
      dur,
      mats: [m],
      geos: [geo],
      step: (k) => {
        mesh.scale.set(1 - k * 0.6, 1, 1 - k * 0.6);
        m.opacity = 0.5 * Math.sin(Math.PI * Math.min(1, k * 1.2));
      },
    });
  }

  /** A dome over the party (the tank's Limit Break). */
  dome(x: number, z: number, r: number, color: string, dur = 1.6): void {
    const geo = new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const m = this.mat(color, 0.3);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, 0, z);
    this.add({
      obj: mesh,
      dur,
      mats: [m],
      geos: [geo],
      step: (k) => {
        mesh.scale.setScalar(0.3 + Math.min(1, k * 3) * 0.7);
        m.opacity = 0.3 * (1 - k);
      },
    });
  }

  /** A rock falling from the sky onto (x, z), then the blast (隕星). */
  meteor(x: number, z: number, r: number): void {
    const rock = new THREE.Mesh(this.unitSphere, this.mat('#ff7a2c', 1, false));
    const m = rock.material as THREE.MeshBasicMaterial;
    const fall = 0.45;
    this.add({
      obj: rock,
      dur: fall,
      mats: [m],
      geos: [],
      step: (k) => {
        rock.scale.setScalar(1.2);
        rock.position.set(x - 6 * (1 - k), 18 * (1 - k) + 0.5, z - 6 * (1 - k));
        if (k >= 1) {
          this.ring(x, z, r, '#ff7a2c', 0.8);
          this.burst(x, 1, z, r * 0.6, '#ffb03b', 0.5);
        }
      },
    });
  }

  /** A marker over a head while a boss charges a tank buster at it. */
  mark(at: () => P, color: string, dur: number): void {
    const geo = new THREE.TorusGeometry(0.45, 0.07, 6, 6);
    const m = this.mat(color, 0.95, false);
    const mesh = new THREE.Mesh(geo, m);
    this.add({
      obj: mesh,
      dur,
      mats: [m],
      geos: [geo],
      step: (_k, dt) => {
        const p = at();
        mesh.position.set(p.x, p.y + 2.6, p.z);
        mesh.rotateOnAxis(UP, dt * 3);
      },
    });
  }

  // ------------------------------------------------------------------ combat text

  /** A number (or word) rising from (x, y, z). */
  text(x: number, y: number, z: number, text: string, cls: string): void {
    // the renderer positions the outer box with a transform; the rise and fade animate the inner one
    const el = document.createElement('div');
    const inner = document.createElement('div');
    inner.className = `float ${cls}`;
    inner.textContent = text;
    el.append(inner);
    const obj = new CSS2DObject(el);
    obj.position.set(x + (Math.random() - 0.5) * 0.6, y, z);
    this.add({ obj, dur: 1.1, mats: [], geos: [], el, step: () => {} });
  }

  // ------------------------------------------------------------------ zones

  /** The lasting circles from the snapshot; key = owner + status. */
  setZones(list: readonly { key: string; x: number; z: number; r: number; color: string }[]): void {
    for (const z of this.zones.values()) z.seen = false;
    for (const s of list) {
      let z = this.zones.get(s.key);
      if (!z) {
        const geo = new THREE.RingGeometry(0, 1, 48);
        const mat = this.mat(s.color, 0.22, false);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        const rim = new THREE.Mesh(this.unitRing, this.mat(s.color, 0.7, false));
        mesh.add(rim);
        this.group.add(mesh);
        z = { mesh, mat, geo, seen: true };
        this.zones.set(s.key, z);
      }
      z.seen = true;
      z.mesh.position.set(s.x, 0.04, s.z);
      z.mesh.scale.setScalar(s.r);
    }
    for (const [key, z] of this.zones) {
      if (z.seen) continue;
      this.group.remove(z.mesh);
      z.geo.dispose();
      z.mat.dispose();
      ((z.mesh.children[0] as THREE.Mesh).material as THREE.Material).dispose();
      this.zones.delete(key);
    }
  }

  update(dt: number, time: number): void {
    for (const z of this.zones.values()) z.mat.opacity = 0.18 + Math.sin(time * 3) * 0.05;
    const keep: Item[] = [];
    for (const it of this.items) {
      it.t += dt;
      const k = Math.min(1, it.t / it.dur);
      it.step(k, dt);
      if (k < 1) keep.push(it);
      else this.drop(it);
    }
    this.items = keep;
  }

  private drop(it: Item): void {
    this.group.remove(it.obj);
    it.el?.remove();
    for (const m of it.mats) m.dispose();
    for (const g of it.geos) g.dispose();
  }

  dispose(): void {
    for (const it of this.items) this.drop(it);
    this.items = [];
    this.setZones([]);
    for (const g of [this.unitCircle, this.unitRing, this.unitSphere, this.unitBox, this.spark]) g.dispose();
  }
}
