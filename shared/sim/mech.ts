import { angleDiff } from './arena';

export interface Pillar {
  x: number;
  z: number;
  r: number;
}

/**
 * The ground shapes boss attacks use (section 六 of the design doc). Metres; f is a facing, the
 * direction (sin f, cos f). A player counts as hit when the centre of their character is inside.
 */
export type Shape =
  /** a disc */
  | { k: 'circle'; x: number; z: number; r: number }
  /** a ring: safe inside r0 */
  | { k: 'donut'; x: number; z: number; r0: number; r1: number }
  /** a fan from (x, z) towards f */
  | { k: 'cone'; x: number; z: number; f: number; r: number; deg: number }
  /** a strip `len` long and `w` wide, from (x, z) along f */
  | { k: 'rect'; x: number; z: number; f: number; len: number; w: number }
  /** no area: a marker over someone's head (a tank buster) */
  | { k: 'mark' }
  /** arrows pushing away from (x, z) */
  | { k: 'push'; x: number; z: number; dist: number }
  /** half of the arena: the side of the line through (x, z) that f points to */
  | { k: 'half'; x: number; z: number; f: number }
  /** a square floor of n × n tiles over [−size, size]; `cells` row by row from the north-west, '1' = live */
  | { k: 'tiles'; size: number; n: number; cells: string }
  /** everywhere the caster at (x, z) can see: behind a standing pillar is safe (視線遮蔽) */
  | { k: 'los'; x: number; z: number; pillars: Pillar[] }
  /** a tower: `need` players must stand in it */
  | { k: 'tower'; x: number; z: number; r: number; need: number }
  /** two players tied together: keep `dist` apart */
  | { k: 'tether'; a: string; b: string; dist: number }
  /** a timed bomb on someone: it goes off `r` around them */
  | { k: 'bomb'; r: number }
  /** a number over someone's head: the order they are attacked in */
  | { k: 'num'; n: number }
  /** a freeze check for everyone: do not move when it ends */
  | { k: 'stop' };

/** Is (x, z) out of sight of (sx, sz) behind one of these pillars? */
export function hidden(sx: number, sz: number, pillars: readonly Pillar[], x: number, z: number): boolean {
  const dx = x - sx;
  const dz = z - sz;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return false;
  for (const p of pillars) {
    const along = ((p.x - sx) * dx + (p.z - sz) * dz) / len;
    if (along <= 0 || along >= len) continue; // the pillar must stand between them
    const across = Math.abs((p.x - sx) * dz - (p.z - sz) * dx) / len;
    if (across <= p.r + 0.15) return true;
  }
  return false;
}

/** Which tile of a tiles shape (x, z) is on, or −1 off the floor. */
export function tileOf(s: { size: number; n: number }, x: number, z: number): number {
  const cell = (s.size * 2) / s.n;
  const col = Math.floor((x + s.size) / cell);
  const row = Math.floor((z + s.size) / cell);
  if (col < 0 || row < 0 || col >= s.n || row >= s.n) return -1;
  return row * s.n + col;
}

/** The checkerboard pattern p (0 or 1) of an n × n floor, as a tiles `cells` string. */
export function checker(n: number, p: 0 | 1): string {
  let out = '';
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) out += (row + col) % 2 === p ? '1' : '0';
  return out;
}

export function inside(s: Shape, x: number, z: number): boolean {
  switch (s.k) {
    case 'circle':
    case 'tower':
      return Math.hypot(x - s.x, z - s.z) <= s.r;
    case 'donut': {
      const d = Math.hypot(x - s.x, z - s.z);
      return d >= s.r0 && d <= s.r1;
    }
    case 'cone': {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d > s.r) return false;
      if (d < 0.01) return true;
      return Math.abs(angleDiff(s.f, Math.atan2(x - s.x, z - s.z))) <= (s.deg * Math.PI) / 360;
    }
    case 'rect': {
      const ux = Math.sin(s.f);
      const uz = Math.cos(s.f);
      const vx = x - s.x;
      const vz = z - s.z;
      const along = vx * ux + vz * uz;
      const across = Math.abs(vx * uz - vz * ux);
      return along >= 0 && along <= s.len && across <= s.w / 2;
    }
    case 'half':
      return (x - s.x) * Math.sin(s.f) + (z - s.z) * Math.cos(s.f) >= 0;
    case 'tiles': {
      const k = tileOf(s, x, z);
      return k >= 0 && s.cells[k] === '1';
    }
    case 'los':
      return !hidden(s.x, s.z, s.pillars, x, z);
    case 'mark':
    case 'push':
    case 'tether':
    case 'bomb':
    case 'num':
    case 'stop':
      return false;
  }
}

/** Moves a shape that sits on a player (spreads and stacks follow their target until they go off). */
export function placed(s: Shape, x: number, z: number): Shape {
  return s.k === 'circle' ? { ...s, x, z } : s;
}

/**
 * Telegraph colours (section 六): orange ground damage, yellow stack or tower, purple spread or lingering
 * floor, red tank buster or instant death, white knockback, blue tether, cyan freeze check, green safe
 * spot, and the twins' fire (e) and ice (i).
 */
export type TeleColor = 'o' | 'y' | 'p' | 'r' | 'w' | 'b' | 'c' | 's' | 'e' | 'i';
