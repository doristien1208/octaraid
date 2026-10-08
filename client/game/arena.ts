import * as THREE from 'three';
import type { Encounter } from '../../shared/encounters';
import { Rng } from '../../shared/rng';
import { toonGradient } from './models';

export interface ArenaView {
  group: THREE.Group;
  /** turned every frame so their letters read the right way up from wherever the camera is */
  waymarks: THREE.Mesh[];
  /** pillars that have shattered (Hard 絕對零度) show as stumps */
  setBroken(list: readonly number[]): void;
  dispose(): void;
}

/** Fixed waymarks painted on the floor, so a party can say "stack on A" or "tower at 2". */
const WAYMARKS = [
  { label: 'A', color: '#e53935', x: 0, z: -1, round: true },
  { label: 'B', color: '#fbc02d', x: 1, z: 0, round: true },
  { label: 'C', color: '#1e88e5', x: 0, z: 1, round: true },
  { label: 'D', color: '#8e24aa', x: -1, z: 0, round: true },
  { label: '1', color: '#e53935', x: Math.SQRT1_2, z: -Math.SQRT1_2, round: false },
  { label: '2', color: '#fbc02d', x: Math.SQRT1_2, z: Math.SQRT1_2, round: false },
  { label: '3', color: '#1e88e5', x: -Math.SQRT1_2, z: Math.SQRT1_2, round: false },
  { label: '4', color: '#8e24aa', x: -Math.SQRT1_2, z: -Math.SQRT1_2, round: false },
] as const;

/** The arena of an encounter: platform, patterned floor, rim, waymarks and themed scenery. */
export function buildArena(enc: Encounter): ArenaView {
  const group = new THREE.Group();
  const trash: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => {
    trash.push(x);
    return x;
  };
  const mat = (color: string, extra: THREE.MeshToonMaterialParameters = {}) =>
    own(new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra }));
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    group.add(o);
    return o;
  };
  const { arena: a, theme: t } = enc;
  const round = a.shape === 'circle';

  const outside = add(own(new THREE.CircleGeometry(170, 48)), mat(t.outside), 0, -1.6, 0);
  outside.rotation.x = -Math.PI / 2;
  add(
    own(round ? new THREE.CylinderGeometry(a.size + 0.6, a.size + 1.8, 1.6, 96) : new THREE.BoxGeometry(a.size * 2 + 1.2, 1.6, a.size * 2 + 1.2)),
    mat(t.edge),
    0,
    -0.8,
    0,
  );
  const tex = own(floorTexture(enc));
  const floor = add(
    own(round ? new THREE.CircleGeometry(a.size, 96) : new THREE.PlaneGeometry(a.size * 2, a.size * 2)),
    own(new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient() })),
    0,
    0.005,
    0,
  );
  floor.rotation.x = -Math.PI / 2;

  // a low rim marks where the wall is
  const rimMat = mat(t.edge);
  if (round) {
    const rim = add(own(new THREE.TorusGeometry(a.size + 0.25, 0.25, 8, 96)), rimMat, 0, 0.05, 0);
    rim.rotation.x = Math.PI / 2;
  } else {
    const side = own(new THREE.BoxGeometry(a.size * 2 + 1, 0.5, 0.5));
    for (const [x, z, ry] of [
      [0, -a.size - 0.25, 0],
      [0, a.size + 0.25, 0],
      [-a.size - 0.25, 0, Math.PI / 2],
      [a.size + 0.25, 0, Math.PI / 2],
    ] as const) {
      add(side, rimMat, x, 0.15, z).rotation.y = ry;
    }
  }

  const markR = a.size * 0.72;
  const waymarks: THREE.Mesh[] = [];
  for (const w of WAYMARKS) {
    const m = add(
      own(w.round ? new THREE.CircleGeometry(0.95, 32) : new THREE.PlaneGeometry(1.7, 1.7)),
      own(new THREE.MeshBasicMaterial({ map: own(waymarkTexture(w.label, w.color, w.round)), transparent: true, depthWrite: false })),
      w.x * markR,
      0.02,
      w.z * markR,
    );
    m.rotation.x = -Math.PI / 2;
    waymarks.push(m);
  }

  const rng = new Rng(enc.id.length * 7919 + a.size);
  switch (enc.id) {
    case 'colossus': {
      const rock = own(new THREE.DodecahedronGeometry(1));
      const shades = [mat('#8a5a3a'), mat('#6e4630'), mat('#a06a44')];
      for (let k = 0; k < 14; k++) {
        const ang = (k / 14) * Math.PI * 2 + rng.next() * 0.3;
        const r = 26 + rng.next() * 9;
        const s = 2 + rng.next() * 2.5;
        const o = add(rock, shades[k % 3]!, Math.sin(ang) * r, -1 + s * 0.6, Math.cos(ang) * r);
        o.scale.set(s, s * (1.4 + rng.next()), s);
        o.rotation.set(rng.next(), rng.next() * 3, rng.next());
      }
      break;
    }
    case 'frostwitch': {
      const spike = own(new THREE.ConeGeometry(1, 4, 6));
      const snow = mat('#e3f5ff');
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2 + rng.next() * 0.2;
        const r = 25 + rng.next() * 9;
        const s = 1 + rng.next() * 1.6;
        const o = add(spike, snow, Math.sin(ang) * r, -1.6 + 2 * s, Math.cos(ang) * r);
        o.scale.set(s, s, s);
      }
      break;
    }
    case 'gatekeeper': {
      const tower = own(new THREE.CylinderGeometry(1.6, 1.9, 10, 12));
      const gear = own(new THREE.TorusGeometry(1.8, 0.35, 6, 12));
      const metal = mat('#5c6372');
      const brass = mat('#b8893a');
      for (const [x, z] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        const d = a.size + 5;
        add(tower, metal, x * d, 3.4, z * d);
        add(gear, brass, x * d, 8.6, z * d).rotation.x = Math.PI / 2;
      }
      break;
    }
    case 'twins': {
      const post = own(new THREE.CylinderGeometry(0.15, 0.22, 3.5, 8));
      const lamp = own(new THREE.SphereGeometry(0.38, 16, 12));
      const dark = mat('#2a2338');
      const red = mat('#ff5a3c', { emissive: new THREE.Color('#ff5a3c'), emissiveIntensity: 0.9 });
      const blue = mat('#3cc8ff', { emissive: new THREE.Color('#3cc8ff'), emissiveIntensity: 0.9 });
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const r = a.size + 1.4;
        add(post, dark, Math.sin(ang) * r, 1.75, Math.cos(ang) * r);
        add(lamp, k % 2 ? blue : red, Math.sin(ang) * r, 3.7, Math.cos(ang) * r);
      }
      break;
    }
  }

  // pillars (霜冠魔女: they hide players from 絕對零度; on Hard the ones used shatter to stumps)
  const ice = mat('#a8e6ff', { transparent: true, opacity: 0.88, emissive: new THREE.Color('#5fc8ff'), emissiveIntensity: 0.25 });
  const stump = mat('#7fa8c0');
  const pillars = (a.pillars ?? []).map((p) => {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    const whole = new THREE.Mesh(own(new THREE.CylinderGeometry(p.r * 0.85, p.r, 6, 6)), ice);
    whole.position.y = 3;
    const broken = new THREE.Mesh(own(new THREE.CylinderGeometry(p.r * 0.95, p.r, 1.1, 6)), stump);
    broken.position.y = 0.55;
    broken.visible = false;
    g.add(whole, broken);
    group.add(g);
    return { whole, broken };
  });

  return {
    group,
    waymarks,
    setBroken(list: readonly number[]) {
      pillars.forEach((p, k) => {
        const gone = list.includes(k);
        p.whole.visible = !gone;
        p.broken.visible = gone;
      });
    },
    dispose() {
      for (const x of trash) x.dispose();
    },
  };
}

/** The floor pattern: rings and spokes on round arenas, the 6 × 6 tile grid on the square one. */
function floorTexture(enc: Encounter): THREE.CanvasTexture {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  const { arena: a, theme: t } = enc;
  const px = S / (a.size * 2); // pixels per metre
  ctx.fillStyle = t.floor;
  ctx.fillRect(0, 0, S, S);

  // speckles give the ground some grain
  const rng = new Rng(97);
  for (let k = 0; k < 1400; k++) {
    ctx.fillStyle = rng.next() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)';
    const r = 1 + rng.next() * 3;
    ctx.beginPath();
    ctx.arc(rng.next() * S, rng.next() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = t.floorLine;
  ctx.globalAlpha = 0.55;
  if (a.shape === 'circle') {
    ctx.lineWidth = 3;
    for (let r = 5; r < a.size; r += 5) {
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, r * px, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(S / 2 + Math.cos(ang) * 2.5 * px, S / 2 + Math.sin(ang) * 2.5 * px);
      ctx.lineTo(S / 2 + Math.cos(ang) * a.size * px, S / 2 + Math.sin(ang) * a.size * px);
      ctx.stroke();
    }
  } else {
    const tiles = 6;
    const step = S / tiles;
    for (let r = 0; r < tiles; r++) {
      for (let c = 0; c < tiles; c++) {
        if ((r + c) % 2) {
          ctx.fillStyle = 'rgba(255,255,255,0.07)';
          ctx.fillRect(c * step, r * step, step, step);
        }
      }
    }
    ctx.lineWidth = 4;
    for (let k = 1; k < tiles; k++) {
      ctx.beginPath();
      ctx.moveTo(k * step, 0);
      ctx.lineTo(k * step, S);
      ctx.moveTo(0, k * step);
      ctx.lineTo(S, k * step);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 2.5 * px, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function waymarkTexture(label: string, color: string, round: boolean): THREE.CanvasTexture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.lineWidth = 10;
  ctx.strokeStyle = color;
  ctx.fillStyle = `${color}55`;
  if (round) {
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(10, 10, S - 20, S - 20);
    ctx.strokeRect(10, 10, S - 20, S - 20);
  }
  ctx.font = 'bold 72px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(label, S / 2, S / 2 + 4);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, S / 2, S / 2 + 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
