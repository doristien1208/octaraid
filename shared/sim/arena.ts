import { RULES } from '../constants';
import type { Arena } from '../encounters';

/**
 * Coordinates: metres on the ground, x to the east and z to the south, the boss at (0, 0). A facing f
 * points along (sin f, cos f), so f = π faces north.
 */

/** Pulls (x, z) back inside the walkable area: the arena minus the player's radius. */
export function clampToArena(a: Arena, x: number, z: number, r: number = RULES.playerRadius): [number, number] {
  const lim = a.size - r;
  if (a.shape === 'square') return [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, z))];
  const d = Math.hypot(x, z);
  if (d <= lim) return [x, z];
  return [(x / d) * lim, (z / d) * lim];
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
