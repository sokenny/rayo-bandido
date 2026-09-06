import type { TargetState } from '../core/types';
import { LIGHTNING } from '../config/tuning';
import { forwardX, forwardZ } from '../core/math';
import { LEVEL_GAP } from './collision';

/**
 * Forward-cone auto-aim. Returns the id of the nearest active target within `range`
 * whose direction lies within `coneHalfAngle` of the car's heading, or -1.
 * Pure function, allocation free.
 */
export function selectTarget(
  x: number,
  z: number,
  heading: number,
  targets: TargetState[],
  range = LIGHTNING.range,
  coneHalfAngle = LIGHTNING.coneHalfAngle,
  y = 0,
): number {
  const fx = forwardX(heading);
  const fz = forwardZ(heading);
  const cosLimit = Math.cos(coneHalfAngle);
  let bestId = -1;
  let bestDist2 = range * range;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (t.status !== 'active') continue;
    // A car on another level (the viaduct overhead, the street below) cannot be aimed at.
    if (Math.abs(t.y - y) > LEVEL_GAP) continue;
    const dx = t.x - x;
    const dz = t.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > bestDist2 || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const dot = (dx * fx + dz * fz) / d;
    if (dot < cosLimit) continue;
    bestDist2 = d2;
    bestId = t.id;
  }
  return bestId;
}
