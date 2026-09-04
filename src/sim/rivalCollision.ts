import type { GameEvent, RivalCar, VehicleState } from '../core/types';
import { RIVALS, VEHICLE } from '../config/tuning';

/**
 * Contact between the local car and the other players' cars.
 *
 * THE ASYMMETRY THAT SHAPES THIS. A rival is not simulated here — it is a report of where
 * somebody else's car was a moment ago (`src/net/rivals.ts`). This client cannot move it, and
 * must not try: the next snapshot would put it straight back. So the entire correction is
 * applied to the local car, and the same code on the other player's machine applies the
 * mirror image to theirs. Two halves of one collision, resolved independently.
 *
 * The consequence is worth being explicit about, because it is visible in play: the two
 * screens will not agree exactly on a hard hit. Each driver sees themselves knocked off line
 * by a car that, on their screen, kept its own. That is the accepted cost of letting both
 * cars stay perfectly responsive to their own driver; the alternative is a server that owns
 * the physics and gives everyone input latency instead.
 *
 * The impulse itself is worked out from the CLOSING speed — the local velocity relative to
 * the rival's — so drafting a car at the same speed does nothing, and a genuine punt costs
 * the puntee real momentum. Mutates the vehicle in place, allocation-free.
 */
export function resolveRivalCollisions(v: VehicleState, rivals: readonly RivalCar[], events: GameEvent[]): void {
  if (rivals.length === 0) return;
  const minDist = VEHICLE.collisionRadius + RIVALS.radius;
  const minDist2 = minDist * minDist;
  let impact = 0;
  let hitX = 0;
  let hitZ = 0;

  for (let i = 0; i < rivals.length; i++) {
    const other = rivals[i];
    if (!other.present) continue;
    const dx = v.x - other.x;
    const dz = v.z - other.z;
    const dist2 = dx * dx + dz * dz;
    if (dist2 >= minDist2) continue;

    let nx: number;
    let nz: number;
    let dist: number;
    if (dist2 > 1e-8) {
      dist = Math.sqrt(dist2);
      nx = dx / dist;
      nz = dz / dist;
    } else {
      // Exactly on top of each other (a respawn on somebody's head): leave sideways, so the
      // two cars pick opposite directions instead of both reversing down the same line.
      dist = 0;
      nx = Math.cos(v.heading);
      nz = Math.sin(v.heading);
    }

    // Separate only our own share of the overlap; the other client is doing the same.
    const penetration = (minDist - dist) * RIVALS.separate;
    v.x += nx * penetration;
    v.z += nz * penetration;

    // Closing speed along the contact normal. Positive means we are driving into them.
    const closing = (other.vx - v.vx) * nx + (other.vz - v.vz) * nz;
    if (closing <= 0) continue;

    const tx = -nz;
    const tz = nx;
    const along = (v.vx * tx + v.vz * tz) * RIVALS.slide;
    const normal = (v.vx * nx + v.vz * nz) * RIVALS.retain + closing * RIVALS.bounce;
    v.vx = tx * along + nx * normal;
    v.vz = tz * along + nz * normal;

    if (closing > impact) {
      impact = closing;
      hitX = (v.x + other.x) * 0.5;
      hitZ = (v.z + other.z) * 0.5;
    }
  }

  if (impact > RIVALS.minImpact) {
    v.collided = true;
    v.collisionImpact = impact;
    // Re-derive the body-frame speeds after the impulse, so the HUD, the camera and the next
    // vehicle tick all see the same car. Same wrap-up as `resolveTargetCollisions`.
    const fx = Math.sin(v.heading);
    const fz = -Math.cos(v.heading);
    const rx = Math.cos(v.heading);
    const rz = Math.sin(v.heading);
    v.speed = v.vx * fx + v.vz * fz;
    v.lateralSpeed = v.vx * rx + v.vz * rz;
    events.push({ type: 'collision', x: hitX, z: hitZ, impact });
  }
}
