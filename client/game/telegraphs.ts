import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { TICK_MS } from '../../shared/constants';
import type { SnapTele } from '../../shared/protocol';

/** Telegraph colours (section 六): orange ground damage, yellow stack, purple spread, red buster or death, white knockback. */
const COLORS: Readonly<Record<SnapTele['c'], number>> = { o: 0xff5500, y: 0xffd400, p: 0xb04dff, r: 0xff2b2b, w: 0xffffff };

/** how strongly the area shows, and the part that fills up to the hit */
const BASE = 0.26;
const FILL = 0.32;

interface View {
  group: THREE.Group;
  /** sits on this player: the group follows them */
  on?: string;
  /** when it hits (performance.now() ms) and how long it shows in all */
  endAt: number;
  total: number;
  /** the part that grows until the hit */
  fill?: (k: number) => void;
  /** a marker over a head */
  over?: THREE.Object3D;
  label?: HTMLElement;
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
}

/**
 * Draws the boss's telegraphs from the snapshots: shapes on the ground that fill up until the moment they
 * hit (the fill reaching the edge is when positions count), and markers over the heads of the players a
 * stack, a spread or a tank buster is on.
 */
export class Telegraphs {
  readonly group = new THREE.Group();
  private readonly views = new Map<number, View>();

  /**
   * `where(id)` gives where a player is drawn this frame. Called with every snapshot's list (or undefined),
   * and with `null` each frame just to animate.
   */
  update(list: SnapTele[] | undefined | null, where: (id: string) => { x: number; z: number } | null, now: number): void {
    if (list !== null) {
      const seen = new Set<number>();
      for (const t of list ?? []) {
        seen.add(t.i);
        let v = this.views.get(t.i);
        if (!v) {
          v = this.build(t);
          this.views.set(t.i, v);
          this.group.add(v.group);
        }
        v.endAt = now + t.l * TICK_MS;
        v.total = Math.max(1, t.n * TICK_MS);
        // a tank buster on whoever is top of the list moves with the enmity
        if (v.on && t.o) v.on = t.o;
      }
      for (const [id, v] of this.views) {
        if (seen.has(id)) continue;
        this.drop(v);
        this.views.delete(id);
      }
    }
    for (const v of this.views.values()) {
      const k = Math.max(0, Math.min(1, 1 - (v.endAt - now) / v.total));
      v.fill?.(k);
      if (v.on) {
        const p = where(v.on);
        v.group.visible = !!p;
        if (p) v.group.position.set(p.x, 0, p.z);
      }
      if (v.over) {
        v.over.position.y = 2.9 + Math.sin(now / 160) * 0.12;
        v.over.rotation.y = now / 400;
      }
    }
  }

  private mat(c: SnapTele['c'], opacity: number, v: View): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color: COLORS[c], transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    v.mats.push(m);
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(g: T, v: View): T {
    v.geos.push(g);
    return g;
  }

  private flat(m: THREE.Mesh, y = 0.05): THREE.Mesh {
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.renderOrder = 2;
    return m;
  }

  private build(t: SnapTele): View {
    const v: View = { group: new THREE.Group(), endAt: 0, total: 1, mats: [], geos: [] };
    const s = t.s;
    const n = (k: number) => Number(s[k]);
    switch (s[0]) {
      case 'c': {
        const r = n(3);
        v.group.add(this.flat(new THREE.Mesh(this.geo(new THREE.CircleGeometry(r, 48), v), this.mat(t.c, BASE, v))));
        v.group.add(this.flat(new THREE.Mesh(this.geo(new THREE.RingGeometry(r - 0.24, r, 48), v), this.mat(t.c, 1, v)), 0.06));
        const fill = this.flat(new THREE.Mesh(this.geo(new THREE.CircleGeometry(1, 48), v), this.mat(t.c, FILL, v)), 0.055);
        v.group.add(fill);
        v.fill = (k) => fill.scale.setScalar(Math.max(0.01, r * k));
        if (t.o) {
          v.on = t.o;
          v.over = this.overhead(t, v);
        } else v.group.position.set(n(1), 0, n(2));
        break;
      }
      case 'd': {
        const r0 = n(3);
        const r1 = n(4);
        v.group.add(this.flat(new THREE.Mesh(this.geo(new THREE.RingGeometry(r0, r1, 64), v), this.mat(t.c, BASE, v))));
        v.group.add(this.flat(new THREE.Mesh(this.geo(new THREE.RingGeometry(r0, r0 + 0.24, 64), v), this.mat(t.c, 1, v)), 0.06));
        // a bright band closing in from the outside towards the safe middle
        const band = this.flat(new THREE.Mesh(this.geo(new THREE.RingGeometry(0.985, 1, 96), v), this.mat(t.c, 0.8, v)), 0.055);
        v.group.add(band);
        v.fill = (k) => band.scale.setScalar(r1 - (r1 - r0) * k);
        v.group.position.set(n(1), 0, n(2));
        break;
      }
      case 'f': {
        const f = n(3);
        const r = n(4);
        const rad = (n(5) * Math.PI) / 180;
        const start = Math.PI / 2 - rad / 2;
        const holder = new THREE.Group();
        holder.add(this.flat(new THREE.Mesh(this.geo(new THREE.CircleGeometry(r, 40, start, rad), v), this.mat(t.c, BASE, v))));
        holder.add(this.flat(new THREE.Mesh(this.geo(new THREE.RingGeometry(r - 0.24, r, 40, 1, start, rad), v), this.mat(t.c, 1, v)), 0.06));
        const fill = this.flat(new THREE.Mesh(this.geo(new THREE.CircleGeometry(1, 40, start, rad), v), this.mat(t.c, FILL, v)), 0.055);
        holder.add(fill);
        if (rad < Math.PI * 2 - 0.01) {
          // the two straight edges, from the centre out along each side of the fan
          for (const side of [-1, 1]) {
            const a = (side * rad) / 2;
            const edge = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.22, r), v), this.mat(t.c, 1, v));
            edge.rotation.set(-Math.PI / 2, 0, a);
            edge.position.set(-Math.sin(a) * (r / 2), 0.06, -Math.cos(a) * (r / 2));
            edge.renderOrder = 2;
            holder.add(edge);
          }
        }
        holder.rotation.y = f + Math.PI; // the fan's middle points along (sin f, cos f)
        v.group.add(holder);
        v.fill = (k) => fill.scale.setScalar(Math.max(0.01, r * k));
        v.group.position.set(n(1), 0, n(2));
        break;
      }
      case 'l': {
        const f = n(3);
        const len = n(4);
        const w = n(5);
        const holder = new THREE.Group();
        const area = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, len), v), this.mat(t.c, BASE, v));
        area.rotation.x = -Math.PI / 2;
        area.position.set(0, 0.05, len / 2);
        holder.add(area);
        for (const side of [-1, 1]) {
          const edge = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.22, len), v), this.mat(t.c, 1, v));
          edge.rotation.x = -Math.PI / 2;
          edge.position.set((side * w) / 2, 0.06, len / 2);
          holder.add(edge);
        }
        const fill = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, 1), v), this.mat(t.c, FILL, v));
        fill.rotation.x = -Math.PI / 2;
        holder.add(fill);
        for (const m of holder.children) m.renderOrder = 2;
        // fills from where it starts to its far end
        v.fill = (k) => {
          fill.scale.y = Math.max(0.01, len * k);
          fill.position.set(0, 0.055, (len * k) / 2);
        };
        holder.rotation.y = f;
        v.group.add(holder);
        v.group.position.set(n(1), 0, n(2));
        break;
      }
      case 'k': {
        // arrows pointing out from the boss: where everyone will be thrown
        const dist = n(3);
        const ring = this.flat(new THREE.Mesh(this.geo(new THREE.RingGeometry(1.6, 1.8, 48), v), this.mat(t.c, 0.8, v)), 0.07);
        v.group.add(ring);
        const arrows: THREE.Mesh[] = [];
        const coneGeo = this.geo(new THREE.ConeGeometry(0.5, 1.2, 4), v);
        const m = this.mat(t.c, 0.85, v);
        for (let a = 0; a < 8; a++) {
          const arrow = new THREE.Mesh(coneGeo, m);
          arrow.rotation.set(Math.PI / 2, 0, -(a * Math.PI) / 4);
          arrows.push(arrow);
          v.group.add(arrow);
        }
        v.fill = (k) => {
          arrows.forEach((arrow, a) => {
            const ang = (a * Math.PI) / 4;
            const r = 3 + ((k * dist * 2) % dist);
            arrow.position.set(Math.sin(ang) * r, 0.3, Math.cos(ang) * r);
            arrow.rotation.set(Math.PI / 2, 0, -ang);
          });
        };
        v.group.position.set(n(1), 0, n(2));
        break;
      }
      default: {
        // a marker only: the tank buster's cracked red shield over a head
        if (t.o) {
          v.on = t.o;
          v.over = this.overhead(t, v);
        }
      }
    }
    if (t.x && t.o) {
      const el = document.createElement('div');
      el.className = `tele-label ${t.c}`;
      el.textContent = t.c === 'y' ? `分攤 ${t.x} 人` : t.x;
      const tag = new CSS2DObject(el);
      tag.position.set(0, 3.6, 0);
      v.group.add(tag);
      v.label = el;
    }
    return v;
  }

  /** Over a head: a yellow arrow for a stack, a purple ring for a spread, a red cracked shield for a buster. */
  private overhead(t: SnapTele, v: View): THREE.Object3D {
    const g = new THREE.Group();
    const m = this.mat(t.c, 0.95, v);
    if (t.c === 'y') {
      const arrow = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.35, 0.7, 4), v), m);
      arrow.rotation.x = Math.PI; // pointing down
      g.add(arrow);
    } else if (t.c === 'p') {
      g.add(new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.4, 0.07, 6, 24), v), m));
      g.children[0]!.rotation.x = Math.PI / 2;
    } else {
      const shield = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.42, 0.28, 0.08, 6), v), m);
      shield.rotation.x = Math.PI / 2;
      g.add(shield);
      const crack = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.08, 0.6, 0.1), v), this.mat('w', 0.95, v));
      crack.rotation.z = 0.5;
      g.add(crack);
    }
    v.group.add(g);
    return g;
  }

  private drop(v: View): void {
    this.group.remove(v.group);
    v.label?.remove();
    for (const m of v.mats) m.dispose();
    for (const g of v.geos) g.dispose();
  }

  dispose(): void {
    for (const v of this.views.values()) this.drop(v);
    this.views.clear();
  }
}
