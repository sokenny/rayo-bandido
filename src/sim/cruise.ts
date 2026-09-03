import type { PlayerCommand, VehicleState } from '../core/types';
import { CRUISE } from '../config/tuning';
import { clamp, clamp01, lerp, wrapAngle } from '../core/math';

/**
 * Cruise mode autopilot: a command source, not a simulation rule.
 *
 * It reads the vehicle state and writes a `PlayerCommand` exactly like the keyboard does,
 * so the car is still driven by `stepVehicle` with the same physics, collisions, drift
 * detection and audio. Nothing downstream knows the difference between this and a player.
 *
 * The controller is a two-part follower of a fixed loop of waypoints (`ArenaLayout.cruiseRoute`):
 *  - steering is a PD on the bearing to the next waypoint (P on heading error, D on yaw rate,
 *    which is what keeps a long straight from weaving),
 *  - speed is a target that drops toward `CRUISE.cornerSpeed` as a corner comes up, driven by
 *    the turn angle waiting at the waypoint and by the heading error being carried right now.
 *
 * A stuck guard covers the one case the follower cannot: something parked on the route
 * (an electric car, a barrier clipped in a corner). After `stuckTime` at a standstill it
 * reverses for a moment with opposite lock, then resumes.
 *
 * Allocation-free; safe to call every tick.
 */
export interface CruiseWaypoint {
  x: number;
  z: number;
}

export interface CruiseController {
  /** Re-acquire the route from the car's current pose. Call on enable and on restart. */
  reset(v: VehicleState): void;
  /**
   * Write throttle / brake / steer / handbrake / nitro for one tick.
   * `fire` and `restart` are left untouched, so the player can still shoot while cruising.
   */
  step(v: VehicleState, out: PlayerCommand, dt: number): void;
  /** Waypoint currently being driven to. Debug / QA only. */
  readonly waypoint: number;
}

/** Bearing from a to b in the heading convention of `core/types.ts` (0 = -Z, clockwise). */
function bearing(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(bx - ax, -(bz - az));
}

/** Squared distance from (px, pz) to the segment a-b. */
function distSqToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = clamp01(t);
  const cx = ax + dx * t - px;
  const cz = az + dz * t - pz;
  return cx * cx + cz * cz;
}

/**
 * Index of the waypoint that closes the route segment the car is nearest to. Entering cruise
 * mid-street therefore continues along that street instead of turning back to a waypoint
 * that happens to be a couple of metres closer behind the car.
 */
export function nearestRouteTarget(route: readonly CruiseWaypoint[], x: number, z: number): number {
  let best = 1;
  let bestDist = Infinity;
  for (let i = 0; i < route.length; i++) {
    const a = route[i];
    const b = route[(i + 1) % route.length];
    const d = distSqToSegment(x, z, a.x, a.z, b.x, b.z);
    if (d < bestDist) {
      bestDist = d;
      best = (i + 1) % route.length;
    }
  }
  return best;
}

export function createCruiseController(route: readonly CruiseWaypoint[]): CruiseController {
  if (route.length < 3) throw new Error('Rayo Bandido cruise: a route needs at least 3 waypoints');

  let index = 0;
  let stuck = 0;
  let reverseLeft = 0;
  let reverseSteer = 0;

  return {
    get waypoint() {
      return index;
    },

    reset(v) {
      index = nearestRouteTarget(route, v.x, v.z);
      stuck = 0;
      reverseLeft = 0;
      reverseSteer = 0;
    },

    step(v, out, dt) {
      out.handbrake = false;
      out.nitro = false;

      let wp = route[index];
      let dx = wp.x - v.x;
      let dz = wp.z - v.z;
      let dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < CRUISE.arriveRadius) {
        index = (index + 1) % route.length;
        wp = route[index];
        dx = wp.x - v.x;
        dz = wp.z - v.z;
        dist = Math.sqrt(dx * dx + dz * dz);
      }

      const err = wrapAngle(Math.atan2(dx, -dz) - v.heading);
      const steer = clamp(err * CRUISE.steerGain - v.yawRate * CRUISE.yawDamping, -1, 1);

      // --- Stuck guard: back out of whatever is in the way, then carry on. ---------------
      if (reverseLeft > 0) {
        reverseLeft -= dt;
        out.throttle = 0;
        out.brake = 1;
        out.steer = reverseSteer;
        return;
      }
      const absSpeed = v.speed < 0 ? -v.speed : v.speed;
      stuck = absSpeed < CRUISE.stuckSpeed ? stuck + dt : 0;
      if (stuck >= CRUISE.stuckTime) {
        stuck = 0;
        reverseLeft = CRUISE.reverseTime;
        // Opposite lock while backing up swings the nose back toward the route.
        reverseSteer = steer >= 0 ? -1 : 1;
        out.throttle = 0;
        out.brake = 1;
        out.steer = reverseSteer;
        return;
      }

      // --- Speed target: ease off for the corner ahead and for lock already carried. -----
      const before = route[(index + route.length - 1) % route.length];
      const after = route[(index + 1) % route.length];
      const legIn = bearing(before.x, before.z, wp.x, wp.z);
      const legOut = bearing(wp.x, wp.z, after.x, after.z);
      const turn = Math.abs(wrapAngle(legOut - legIn));
      const nearCorner = clamp01(1 - (dist - CRUISE.arriveRadius) / CRUISE.cornerLookahead);
      const cornerSlow = clamp01(turn / CRUISE.cornerFullTurn) * nearCorner;
      const errSlow = clamp01(Math.abs(err) / CRUISE.errorSlowdown);
      const target = lerp(CRUISE.speed, CRUISE.cornerSpeed, cornerSlow > errSlow ? cornerSlow : errSlow);

      const delta = target - v.speed;
      out.throttle = delta > CRUISE.speedDeadband ? clamp01((delta - CRUISE.speedDeadband) * CRUISE.throttleGain) : 0;
      out.brake = delta < -CRUISE.speedDeadband ? clamp01((-delta - CRUISE.speedDeadband) * CRUISE.brakeGain) : 0;
      out.steer = steer;
    },
  };
}
