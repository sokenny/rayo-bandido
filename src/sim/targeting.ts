import type { TargetState } from '../core/types';
import { LIGHTNING } from '../config/tuning';
import { forwardX, forwardZ } from '../core/math';
import { LEVEL_GAP } from './collision';

/**
 * Straight-line beam test. The shot travels along the car's heading and stops at `range`;
 * this returns the id of the first active target whose centre lies within `hitRadius` of
 * that line, or -1. There is no cone and no lock-on: aiming is the player's job.
 * Pure function, allocation free.
 */
export function rayTarget(
  x: number,
  z: number,
  heading: number,
  targets: TargetState[],
  range: number,
  hitRadius = LIGHTNING.hitRadius,
  y = 0,
): number {
  const fx = forwardX(heading);
  const fz = forwardZ(heading);
  let bestId = -1;
  let bestAlong = range;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (t.status !== 'active') continue;
    // A car on another level (the viaduct overhead, the street below) cannot be hit.
    if (Math.abs(t.y - y) > LEVEL_GAP) continue;
    const dx = t.x - x;
    const dz = t.z - z;
    // Distance along the beam, and how far the car sits off its line.
    const along = dx * fx + dz * fz;
    if (along <= 0 || along > bestAlong) continue;
    const off = Math.abs(dx * fz - dz * fx);
    if (off > hitRadius) continue;
    bestAlong = along;
    bestId = t.id;
  }
  return bestId;
}
