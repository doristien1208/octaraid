import { RULES } from '../constants';
import type { Arena } from '../encounters';

/**
 * Coordinates: metres on the ground, x to the east and z to the south, the boss at (0, 0). A facing f
 * points along (sin f, cos f), so f = π faces north.
 */

/** Pulls (x, z) back inside the walkable area: the arena minus the player's radius, outside its pillars. */
export function clampToArena(a: Arena, x: number, z: number, r: number = RULES.playerRadius): [number, number] {
  const lim = a.size - r;
  let out: [number, number];
  if (a.shape === 'square') out = [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, z))];
  else {
    const d = Math.hypot(x, z);
    out = d <= lim ? [x, z] : [(x / d) * lim, (z / d) * lim];
  }
  for (const p of a.pillars ?? []) {
    const dx = out[0] - p.x;
    const dz = out[1] - p.z;
    const d = Math.hypot(dx, dz);
    const min = p.r + r;
    if (d >= min) continue;
    // step out the way it came in (straight out from the middle when on the axis)
    const [ux, uz] = d > 1e-6 ? [dx / d, dz / d] : [p.x / Math.hypot(p.x, p.z), p.z / Math.hypot(p.x, p.z)];
    out = [p.x + ux * min, p.z + uz * min];
  }
  return out;
}

/** Where the party stands when the fight loads: a row south of the boss, facing it. */
export function spawnPoints(a: Arena, n: number): [number, number][] {
  const z = a.size * 0.55;
  const gap = 1.6;
  return Array.from({ length: n }, (_, k) => [(k - (n - 1) / 2) * gap, z] as [number, number]);
}

/** Signed difference b − a between two angles, in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** The facing that looks from (x0, z0) towards (x1, z1). */
export function faceTowards(x0: number, z0: number, x1: number, z1: number): number {
  return Math.atan2(x1 - x0, z1 - z0);
}

/** How far a point is from the edge of a target's ring (negative inside it). Ranges are measured this way. */
export function reach(x: number, z: number, t: { x: number; z: number; r: number }): number {
  return Math.hypot(t.x - x, t.z - z) - t.r;
}

/**
 * Which side of an enemy a point is on, against the way it faces: the 90° behind it is the rear, the 90°
 * on each side the flanks, the rest the front (positionals).
 */
export function sideOf(foe: { x: number; z: number; f: number }, x: number, z: number): 'front' | 'flank' | 'rear' {
  const a = Math.abs(angleDiff(foe.f, Math.atan2(x - foe.x, z - foe.z)));
  return a >= (Math.PI * 3) / 4 ? 'rear' : a > Math.PI / 4 ? 'flank' : 'front';
}
