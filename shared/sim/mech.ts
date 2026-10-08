import { angleDiff } from './arena';

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
  | { k: 'push'; x: number; z: number; dist: number };

export function inside(s: Shape, x: number, z: number): boolean {
  switch (s.k) {
    case 'circle':
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
    case 'mark':
    case 'push':
      return false;
  }
}

/** Moves a shape that sits on a player (spreads and stacks follow their target until they go off). */
export function placed(s: Shape, x: number, z: number): Shape {
  return s.k === 'circle' ? { ...s, x, z } : s;
}

/**
 * Telegraph colours (section 六): orange ground damage, yellow stack, purple spread, red tank buster or
 * instant death, white knockback.
 */
export type TeleColor = 'o' | 'y' | 'p' | 'r' | 'w';
