import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { TICK_MS } from '../../shared/constants';
import type { Arena } from '../../shared/encounters';
import type { SnapTele } from '../../shared/protocol';
import { faceTowards } from '../../shared/sim/arena';

/**
 * Telegraph colours (section 六): orange ground damage, yellow stack or tower, purple spread or pool, red
 * buster or death, white knockback, blue tether, cyan freeze, green safe spot, the twins' fire and ice.
 */
const COLORS: Readonly<Record<SnapTele['c'], number>> = {
  o: 0xff5500,
  y: 0xffd400,
  p: 0xb04dff,
  r: 0xff2b2b,
  w: 0xffffff,
  b: 0x3c8cff,
  c: 0x4ff0ff,
  s: 0x3cff78,
  e: 0xff5a28,
  i: 0x3cc8ff,
};

/** how strongly the area shows, and the part that fills up to the hit */
const BASE = 0.26;
const FILL = 0.32;

type Where = (id: string) => { x: number; z: number } | null;

interface View {
  group: THREE.Group;
  /** sits on this player: the group follows them (or, aimed, it points at them) */
  on?: string;
  /** a fan or strip from (x, z) that turns towards `on` */
  aimed?: THREE.Group;
  /** when it hits (performance.now() ms) and how long it shows in all */
  endAt: number;
  total: number;
  /** the part that grows until the hit */
  fill?: (k: number) => void;
  /** anything else to redo every frame */
  each?: (now: number, left: number, where: Where) => void;
  /** a marker over a head */
  over?: THREE.Object3D;
  labels: HTMLElement[];
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
}

/**
 * Draws the boss's telegraphs from the snapshots: shapes on the ground that fill up until the moment they
 * hit (the fill reaching the edge is when positions count), pools that hurt all the while, markers over
 * the heads of the players a stack, a spread, a bomb, a number or a tank buster is on, tethers between two
 * players, towers to stand in, the safe shadows behind pillars, and fans and strips that turn to follow the
 * player they are aimed at.
 */
export class Telegraphs {
  readonly group = new THREE.Group();
  private readonly views = new Map<number, View>();

  constructor(private readonly arena: Arena) {}

  /**
   * `where(id)` gives where a player is drawn this frame. Called with every snapshot's list (or undefined),
   * and with `null` each frame just to animate.
   */
  update(list: SnapTele[] | undefined | null, where: Where, now: number): void {
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
        // a fan or strip from a moving enemy: its origin moves with it
        if (v.aimed) v.group.position.set(Number(t.s[1]), 0, Number(t.s[2]));
      }
      for (const [id, v] of this.views) {
        if (seen.has(id)) continue;
        this.drop(v);
        this.views.delete(id);
      }
    }
    for (const v of this.views.values()) {
      const left = v.endAt - now;
      const k = Math.max(0, Math.min(1, 1 - left / v.total));
      v.fill?.(k);
      if (v.on) {
        const p = where(v.on);
        if (v.aimed) {
          if (p) v.aimed.rotation.y = faceTowards(v.group.position.x, v.group.position.z, p.x, p.z);
        } else {
          v.group.visible = !!p;
          if (p) v.group.position.set(p.x, 0, p.z);
        }
      }
      v.each?.(now, left, where);
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

  private label(v: View, text: string, cls: string, y: number, parent: THREE.Object3D = v.group): { el: HTMLElement; tag: CSS2DObject } {
    const el = document.createElement('div');
    el.className = `tele-label ${cls}`;
    el.textContent = text;
    const tag = new CSS2DObject(el);
    tag.position.set(0, y, 0);
    parent.add(tag);
    v.labels.push(el);
    return { el, tag };
  }

  private build(t: SnapTele): View {
    const v: View = { group: new THREE.Group(), endAt: 0, total: 1, mats: [], geos: [], labels: [] };
    const s = t.s;
    const n = (k: number) => Number(s[k]);
    const size = this.arena.size;
    switch (s[0]) {
      case 'c': {
        const r = n(3);
        if (t.z) {
          // a pool: it hurts all the while, so it shows steadily and breathes a little
          const pool = this.mat(t.c, 0.42, v);
          v.group.add(this.flat(new THREE.Mesh(this.geo(new THREE.CircleGeometry(r, 40), v), pool)));
          v.group.add(this.flat(new THREE.Mesh(this.geo(new THREE.RingGeometry(r - 0.18, r, 40), v), this.mat(t.c, 0.9, v)), 0.06));
          v.each = (now) => {
            pool.opacity = 0.34 + Math.sin(now / 240) * 0.08;
          };
          v.group.position.set(n(1), 0, n(2));
          break;
        }
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
        const outer = Math.min(r1, size * 1.6);
        v.fill = (k) => band.scale.setScalar(outer - (outer - r0) * k);
        v.group.position.set(n(1), 0, n(2));
        break;
      }
      case 'f': {
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
        // the fan's middle points along (sin f, cos f): the holder's local −z turns there
        const turn = new THREE.Group();
        turn.add(holder);
        holder.rotation.y = Math.PI;
        turn.rotation.y = n(3);
        v.group.add(turn);
        v.fill = (k) => fill.scale.setScalar(Math.max(0.01, r * k));
        v.group.position.set(n(1), 0, n(2));
        if (t.o) {
          v.on = t.o;
          v.aimed = turn;
        }
        break;
      }
      case 'l': {
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
        holder.rotation.y = n(3);
        v.group.add(holder);
        v.group.position.set(n(1), 0, n(2));
        if (t.o) {
          v.on = t.o;
          v.aimed = holder;
          // a small diamond over whoever it is aimed at
          const mark = new THREE.Mesh(this.geo(new THREE.OctahedronGeometry(0.3), v), this.mat(t.c, 0.95, v));
          v.group.add(mark);
          const target = t.o;
          v.each = (now, _left, where) => {
            const p = where(target);
            mark.visible = !!p;
            if (p) mark.position.set(p.x - v.group.position.x, 3.1 + Math.sin(now / 160) * 0.12, p.z - v.group.position.z);
            mark.rotation.y = now / 400;
          };
        }
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
      case 'h': {
        // half of the arena: a broad sheet on one side of the line through (x, z), the line itself bright
        const len = size * 2.6;
        const holder = new THREE.Group();
        const sheet = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(len, size * 1.3), v), this.mat(t.c, BASE, v));
        sheet.rotation.x = -Math.PI / 2;
        sheet.position.set(0, 0.05, (size * 1.3) / 2);
        holder.add(sheet);
        const line = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(len, 0.3), v), this.mat(t.c, 1, v));
        line.rotation.x = -Math.PI / 2;
        line.position.set(0, 0.06, 0.15);
        holder.add(line);
        const fill = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(len, 1), v), this.mat(t.c, FILL, v));
        fill.rotation.x = -Math.PI / 2;
        holder.add(fill);
        for (const m of holder.children) m.renderOrder = 2;
        v.fill = (k) => {
          const d = Math.max(0.01, size * 1.3 * k);
          fill.scale.y = d;
          fill.position.set(0, 0.055, d / 2);
        };
        holder.rotation.y = n(3);
        v.group.add(holder);
        v.group.position.set(n(1), 0, n(2));
        break;
      }
      case 'g': {
        // live floor tiles: each lit square fills up to the shock
        const cells = String(s[2]);
        const grid = n(1);
        const cell = (size * 2) / grid;
        const tile = this.geo(new THREE.PlaneGeometry(cell - 0.3, cell - 0.3), v);
        const edgeGeo = this.geo(new THREE.RingGeometry(cell * 0.66, cell * 0.7, 4, 1), v);
        const base = this.mat(t.c, BASE, v);
        const bright = this.mat(t.c, 0.9, v);
        const fillMat = this.mat(t.c, FILL, v);
        const fills: THREE.Mesh[] = [];
        for (let k = 0; k < cells.length; k++) {
          if (cells[k] !== '1') continue;
          const x = -size + cell * ((k % grid) + 0.5);
          const z = -size + cell * (Math.floor(k / grid) + 0.5);
          const sq = this.flat(new THREE.Mesh(tile, base));
          sq.position.set(x, 0.05, z);
          v.group.add(sq);
          const edge = this.flat(new THREE.Mesh(edgeGeo, bright), 0.06);
          edge.position.set(x, 0.06, z);
          edge.rotation.z = Math.PI / 4;
          v.group.add(edge);
          const f = this.flat(new THREE.Mesh(tile, fillMat), 0.055);
          f.position.set(x, 0.055, z);
          fills.push(f);
          v.group.add(f);
        }
        v.fill = (k) => {
          for (const f of fills) f.scale.setScalar(Math.max(0.01, k));
        };
        break;
      }
      case 's': {
        // line of sight: the shadows behind the standing pillars are safe (green), out from the caster
        const [sx, sz] = [n(1), n(2)];
        const standing = String(s[3]);
        const pillars = this.arena.pillars ?? [];
        const mat = this.mat('s', 0.3, v);
        const edge = this.mat('s', 0.9, v);
        pillars.forEach((p, k) => {
          if (standing[k] !== '1') return;
          const d = Math.hypot(p.x - sx, p.z - sz);
          if (d < 0.5) return;
          const half = Math.asin(Math.min(0.95, p.r / d));
          const a = Math.atan2(p.x - sx, p.z - sz);
          // ring sector from just behind the pillar to the edge, centred on the line from the caster
          const sector = this.geo(new THREE.RingGeometry(d + p.r * 0.6, size * 1.25, 16, 1, Math.PI / 2 - half, half * 2), v);
          const holder = new THREE.Group();
          holder.add(this.flat(new THREE.Mesh(sector, mat)));
          const rim = this.geo(new THREE.RingGeometry(d + p.r * 0.6, d + p.r * 0.6 + 0.2, 16, 1, Math.PI / 2 - half, half * 2), v);
          holder.add(this.flat(new THREE.Mesh(rim, edge), 0.06));
          // the sector's middle points along local −z after the flat turn: face it along a
          holder.rotation.y = a + Math.PI;
          holder.position.set(sx, 0, sz);
          v.group.add(holder);
        });
        this.label(v, '躲到柱子後面', 's', 5);
        break;
      }
      case 'T': {
        // a tower: a glowing column to stand in, with the number of people it needs
        const r = n(3);
        v.group.add(this.flat(new THREE.Mesh(this.geo(new THREE.CircleGeometry(r, 40), v), this.mat(t.c, BASE, v))));
        v.group.add(this.flat(new THREE.Mesh(this.geo(new THREE.RingGeometry(r - 0.22, r, 40), v), this.mat(t.c, 1, v)), 0.06));
        const column = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(r, r, 7, 32, 1, true), v), this.mat(t.c, 0.16, v));
        column.position.y = 3.5;
        v.group.add(column);
        const fill = this.flat(new THREE.Mesh(this.geo(new THREE.CircleGeometry(1, 40), v), this.mat(t.c, FILL, v)), 0.055);
        v.group.add(fill);
        v.fill = (k) => fill.scale.setScalar(Math.max(0.01, r * k));
        this.label(v, `${n(4)} 人`, 'y tower', 7.6);
        v.group.position.set(n(1), 0, n(2));
        break;
      }
      case 'b': {
        // a tether between `o` and another player: blue while too close, green once far enough apart
        const other = String(s[1]);
        const dist = n(2);
        const beamMat = this.mat('b', 0.85, v);
        const beam = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.09, 0.09, 1, 6, 1, true), v), beamMat);
        beam.rotation.x = Math.PI / 2; // along z before it is aimed
        const pivot = new THREE.Group();
        pivot.add(beam);
        v.group.add(pivot);
        const text = this.label(v, `拉開 ${dist} m`, 'b', 0.5, pivot);
        const a = t.o ?? '';
        v.each = (now, _left, where) => {
          const p = where(a);
          const q = where(other);
          v.group.visible = !!p && !!q;
          if (!p || !q) return;
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          v.group.position.set(p.x, 1.2, p.z);
          pivot.rotation.y = faceTowards(p.x, p.z, q.x, q.z);
          beam.scale.y = Math.max(0.01, d);
          beam.position.z = d / 2;
          text.el.textContent = d >= dist ? '夠遠了' : `拉開 ${dist} m（${d.toFixed(0)}）`;
          text.tag.position.set(0, 0.5, d / 2);
          beamMat.color.setHex(d >= dist ? COLORS.s : COLORS.b);
          beamMat.opacity = 0.65 + Math.sin(now / 90) * 0.2;
        };
        break;
      }
      case 'B': {
        // a timed bomb over a head, counting down; its blast circle shows for the last 3 seconds
        const r = n(1);
        v.on = t.o;
        const ring = this.flat(new THREE.Mesh(this.geo(new THREE.RingGeometry(r - 0.25, r, 48), v), this.mat('p', 1, v)), 0.06);
        const disc = this.flat(new THREE.Mesh(this.geo(new THREE.CircleGeometry(r, 48), v), this.mat('p', 0.18, v)));
        v.group.add(ring, disc);
        const icon = new THREE.Group();
        icon.add(new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.32, 14, 10), v), this.mat('p', 0.95, v)));
        v.group.add(icon);
        v.over = icon;
        const count = this.label(v, '', 'p bomb', 4.4).el;
        v.each = (_now, left) => {
          const secs = Math.max(0, left / 1000);
          count.textContent = secs < 10 ? secs.toFixed(1) : String(Math.ceil(secs));
          ring.visible = disc.visible = secs <= 3;
        };
        break;
      }
      case 'n': {
        // a number over a head: the order of attacks (red: a charge comes at you)
        v.on = t.o;
        this.label(v, String(n(1)), `${t.c} num`, 3.4);
        break;
      }
      case 'x': {
        // the freeze check is shown on the HUD (see the view); nothing on the ground
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
    if (t.x && t.o && s[0] !== 'b') this.label(v, t.c === 'y' ? `分攤 ${t.x} 人` : t.x, t.c, 3.6);
    return v;
  }

  /** Over a head: an arrow for a stack (yellow, or the twins' colours), a purple ring for a spread, a red cracked shield for a buster. */
  private overhead(t: SnapTele, v: View): THREE.Object3D {
    const g = new THREE.Group();
    const m = this.mat(t.c, 0.95, v);
    if (t.c === 'y' || t.c === 'e' || t.c === 'i') {
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
    for (const el of v.labels) el.remove();
    for (const m of v.mats) m.dispose();
    for (const g of v.geos) g.dispose();
  }

  dispose(): void {
    for (const v of this.views.values()) this.drop(v);
    this.views.clear();
  }

  /** Is a freeze check on its way (the HUD warns), and how long until it ends (ms)? */
  freezeLeft(list: SnapTele[] | undefined): number | null {
    const t = list?.find((x) => x.s[0] === 'x');
    return t ? t.l * TICK_MS : null;
  }
}
