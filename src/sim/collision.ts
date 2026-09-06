import type { ArenaLayout, GameEvent, TargetState, VehicleState } from '../core/types';
import { TARGETS, VEHICLE } from '../config/tuning';
import { forwardX, forwardZ, rightX, rightZ, wrapAngle } from '../core/math';

/** The part of a moving thing that world collision needs: a circle with a velocity. */
export interface CircleBody {
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  vx: number;
  vz: number;
}

/** How a surface answers a body that runs into it. See `WALL` for the car's own numbers. */
export interface WallResponse {
  /** Bounce fraction on a real impact (0..1). */
  restitution: number;
  /** Along-the-wall speed kept through a real impact (0..1). */
  slide: number;
  /** Speed into the surface (m/s) above which contact is an impact rather than a scrape. */
  impactSpeed: number;
  /** Along-the-wall deceleration while scraping (m/s^2). */
  scrapeDecel: number;
}

/** Where a body touched the world during a `pushOutOfWorld` call: the summed contact normals. */
export interface Contact {
  nx: number;
  nz: number;
  /** How many surfaces were touched. 0 means the body is in the clear. */
  count: number;
}

/** Reused across ticks: `resolveCollisions` is the only caller that asks for contacts. */
const CONTACT: Contact = { nx: 0, nz: 0, count: 0 };

/** The player's car against the world. */
const WALL: WallResponse = {
  restitution: VEHICLE.restitution,
  slide: VEHICLE.collisionSlide,
  impactSpeed: VEHICLE.wallImpactSpeed,
  scrapeDecel: VEHICLE.wallScrapeDecel,
};

/**
 * Collision of the car (a circle) against the world: axis-aligned boxes (buildings, the test
 * city's barriers) and wall segments (the circuit's guardrails and alley walls). Pushes the
 * car out, removes the velocity component into the wall and emits a collision event.
 * Deliberately simple and forgiving: arcade feel over accuracy.
 */
export function resolveCollisions(v: VehicleState, layout: ArenaLayout, events: GameEvent[], dt: number): void {
  const impact = pushOutOfWorld(v, VEHICLE.collisionRadius, layout, WALL, dt, CONTACT);
  if (CONTACT.count > 0) unwedge(v, CONTACT, dt);

  if (impact > 0.5) {
    v.collided = true;
    v.collisionImpact = impact;
    // Re-derive longitudinal/lateral speeds after the impulse.
    const fx = Math.sin(v.heading);
    const fz = -Math.cos(v.heading);
    const rx = Math.cos(v.heading);
    const rz = Math.sin(v.heading);
    v.speed = v.vx * fx + v.vz * fz;
    v.lateralSpeed = v.vx * rx + v.vz * rz;
    events.push({ type: 'collision', x: v.x, z: v.z, impact });
  }
}

/**
 * Push a circle of radius `r` out of every box, wall and the arena bounds, and answer its
 * velocity with `response`. Returns the hardest impact (m/s into a surface), 0 for none.
 * Shared by the player's car and by an electric car that has been shoved: neither may pass
 * through a guardrail.
 *
 * A hit and a scrape are different events. Driving into a wall is an impact: it bounces and
 * scrubs speed. Riding along one afterwards is contact, and contact must only take the
 * into-the-wall velocity away — scrubbing the along-the-wall part every tick is what used to
 * pin a car that touched a barrier at an angle, since the wall then ate 15% of its speed
 * sixty times a second while the nose kept it from steering off. So the scrape only costs the
 * steady `scrapeDecel`, which the engine can out-pull.
 */
export function pushOutOfWorld(
  v: CircleBody,
  r: number,
  layout: ArenaLayout,
  response: WallResponse,
  dt: number,
  contact: Contact | null = null,
): number {
  let impact = 0;
  if (contact) {
    contact.nx = 0;
    contact.nz = 0;
    contact.count = 0;
  }
  const boxes = layout.colliders;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    // Closest point on the box to the car center.
    const cx = v.x < b.minX ? b.minX : v.x > b.maxX ? b.maxX : v.x;
    const cz = v.z < b.minZ ? b.minZ : v.z > b.maxZ ? b.maxZ : v.z;
    let dx = v.x - cx;
    let dz = v.z - cz;
    let dist2 = dx * dx + dz * dz;
    if (dist2 >= r * r) continue;

    let nx: number;
    let nz: number;
    let penetration: number;
    if (dist2 > 1e-8) {
      const dist = Math.sqrt(dist2);
      nx = dx / dist;
      nz = dz / dist;
      penetration = r - dist;
    } else {
      // Center is inside the box: push out along the shallowest axis.
      const toMinX = v.x - b.minX;
      const toMaxX = b.maxX - v.x;
      const toMinZ = v.z - b.minZ;
      const toMaxZ = b.maxZ - v.z;
      const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
      if (m === toMinX) {
        nx = -1;
        nz = 0;
      } else if (m === toMaxX) {
        nx = 1;
        nz = 0;
      } else if (m === toMinZ) {
        nx = 0;
        nz = -1;
      } else {
        nx = 0;
        nz = 1;
      }
      penetration = m + r;
    }
    v.x += nx * penetration;
    v.z += nz * penetration;
    impact = Math.max(impact, answerSurface(v, nx, nz, response, dt));
    if (contact) {
      contact.nx += nx;
      contact.nz += nz;
      contact.count++;
    }
  }

  // Segment walls: guardrails and alley walls on the race circuit. Circle vs capsule.
  const walls = layout.walls;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const ex = w.bx - w.ax;
    const ez = w.bz - w.az;
    const len2 = ex * ex + ez * ez;
    let t = len2 > 0 ? ((v.x - w.ax) * ex + (v.z - w.az) * ez) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = w.ax + ex * t;
    const cz = w.az + ez * t;
    const dx = v.x - cx;
    const dz = v.z - cz;
    const dist2 = dx * dx + dz * dz;
    if (dist2 >= r * r) continue;

    let nx: number;
    let nz: number;
    let penetration: number;
    if (dist2 > 1e-8) {
      const dist = Math.sqrt(dist2);
      nx = dx / dist;
      nz = dz / dist;
      penetration = r - dist;
    } else {
      // Dead on the line: leave toward the side the car came from.
      const len = Math.sqrt(len2) || 1;
      const side = (v.prevX - w.ax) * ez - (v.prevZ - w.az) * ex >= 0 ? 1 : -1;
      nx = (ez / len) * side;
      nz = (-ex / len) * side;
      penetration = r;
    }
    v.x += nx * penetration;
    v.z += nz * penetration;
    impact = Math.max(impact, answerSurface(v, nx, nz, response, dt));
    if (contact) {
      contact.nx += nx;
      contact.nz += nz;
      contact.count++;
    }
  }

  // Last-resort clamp to the arena bounds.
  const bb = layout.bounds;
  if (v.x < bb.minX) {
    v.x = bb.minX;
    if (v.vx < 0) v.vx = 0;
  } else if (v.x > bb.maxX) {
    v.x = bb.maxX;
    if (v.vx > 0) v.vx = 0;
  }
  if (v.z < bb.minZ) {
    v.z = bb.minZ;
    if (v.vz < 0) v.vz = 0;
  } else if (v.z > bb.maxZ) {
    v.z = bb.maxZ;
    if (v.vz > 0) v.vz = 0;
  }

  return impact;
}

/**
 * Work a car that is stopped with its nose in a wall back off it.
 *
 * Yaw comes from road speed (`src/sim/vehicle.ts`, step 5), so a car pinned at a standstill
 * has none: full throttle only pushes harder into the wall and full lock does nothing, which
 * leaves reverse as the only way out of a scrape the player did not mean to take. The tyres
 * are still turning against the obstacle though, and a turned wheel there walks the car
 * around. So while the car is pressed into a surface below `wedgeSpeed` and the throttle is
 * asking to go, pivot it toward the wall's tangent — the side the wheel is asking for, or the
 * one the nose already leans toward. It fades out as the car finds speed and the normal model
 * takes over, and it can never turn a car that is moving.
 */
function unwedge(v: VehicleState, contact: Contact, dt: number): void {
  const throttle = v.throttleApplied;
  if (throttle <= 0.01) return;
  const speed = Math.hypot(v.vx, v.vz);
  if (speed >= VEHICLE.wedgeSpeed) return;

  const len = Math.hypot(contact.nx, contact.nz);
  if (len < 1e-6) return;
  const nx = contact.nx / len;
  const nz = contact.nz / len;
  const fx = forwardX(v.heading);
  const fz = forwardZ(v.heading);
  // Only when the nose is the part in the wall: a car backing into one steers out normally.
  if (fx * nx + fz * nz >= 0) return;

  // Which way to come off: the wheel decides when it is turned, otherwise the car follows the
  // wall tangent its nose already leans toward. Positive yaw turns the nose toward the right.
  const wheel = v.steerAngle;
  let sign: number;
  if (wheel > 0.05 || wheel < -0.05) {
    sign = wheel > 0 ? 1 : -1;
  } else {
    const tx = -nz;
    const tz = nx;
    const lean = fx * tx + fz * tz;
    if (lean > -1e-3 && lean < 1e-3) return; // Dead square to the wall, wheel straight: nothing asked for.
    const dx = lean > 0 ? tx : -tx;
    const dz = lean > 0 ? tz : -tz;
    sign = dx * rightX(v.heading) + dz * rightZ(v.heading) >= 0 ? 1 : -1;
  }

  const yaw = sign * VEHICLE.wedgeYaw * throttle * (1 - speed / VEHICLE.wedgeSpeed);
  v.heading = wrapAngle(v.heading + yaw * dt);
  v.yawRate += yaw;
}

/**
 * Answer a contact whose outward normal is (`nx`, `nz`): kill the velocity going into the
 * surface and decide what the along-the-surface part keeps. Returns the speed into the
 * surface (m/s), 0 when the body is already moving away.
 */
function answerSurface(v: CircleBody, nx: number, nz: number, response: WallResponse, dt: number): number {
  const vn = v.vx * nx + v.vz * nz;
  if (vn >= 0) return 0;

  const tx = -nz;
  const tz = nx;
  let vt = v.vx * tx + v.vz * tz;
  let bounce: number;
  if (-vn > response.impactSpeed) {
    // A real hit: bounce off it and scrub the along-the-wall speed once, for the crunch.
    vt *= response.slide;
    bounce = -vn * response.restitution;
  } else {
    // Scraping along: a steady drag the engine can pull against, and no bounce — bouncing a
    // car off a barrier it is only leaning on would buzz it away from the wall.
    const drop = Math.min(vt < 0 ? -vt : vt, response.scrapeDecel * dt);
    vt -= vt < 0 ? -drop : drop;
    bounce = 0;
  }
  v.vx = tx * vt + nx * bounce;
  v.vz = tz * vt + nz * bounce;
  return -vn;
}

/**
 * Circle-vs-circle collision of the car against the electric-car targets. Unlike walls, the
 * cars are movable: the player shoves them out of the way and keeps most of their own speed,
 * so it reads as a bump rather than hitting a wall. Arcade on purpose — the knock is a little
 * stronger than real momentum would give (`TARGETS.knock.transfer`). Mutates the vehicle and
 * targets in place and emits a `collision` event for feedback.
 */
export function resolveTargetCollisions(v: VehicleState, targets: TargetState[], events: GameEvent[]): void {
  const k = TARGETS.knock;
  const minDist = VEHICLE.collisionRadius + k.radius;
  const minDist2 = minDist * minDist;
  let bumped = false;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (t.status !== 'active') continue;
    let dx = t.x - v.x;
    let dz = t.z - v.z;
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
      // Exactly concentric: shove the car out along the player's forward axis.
      dist = 0;
      nx = Math.sin(v.heading);
      nz = -Math.cos(v.heading);
    }

    // Separate the overlap: mostly move the (light) target, nudge the player back a touch.
    const penetration = minDist - dist;
    t.x += nx * penetration * k.targetPush;
    t.z += nz * penetration * k.targetPush;
    v.x -= nx * penetration * (1 - k.targetPush);
    v.z -= nz * penetration * (1 - k.targetPush);

    // Only transfer momentum when the player is actually driving into the car.
    const approach = v.vx * nx + v.vz * nz;
    if (approach <= 0) continue;

    // Fling the target along the contact normal, a bit harder than pure momentum.
    const knockX = nx * approach * k.transfer;
    const knockZ = nz * approach * k.transfer;
    t.vx += knockX;
    t.vz += knockZ;

    // The player keeps most of their into-the-car speed, so it feels like a shove.
    const loss = approach * (1 - k.playerRetain);
    v.vx -= nx * loss;
    v.vz -= nz * loss;

    if (approach > k.minImpact) {
      bumped = true;
      // The event names the car and the knock, so a multiplayer client can tell the host.
      events.push({ type: 'collision', x: (v.x + t.x) * 0.5, z: (v.z + t.z) * 0.5, impact: approach, targetId: t.id, knockX, knockZ });
    }
  }

  if (bumped) {
    v.collided = true;
    // Re-derive body-frame speeds after the impulse so HUD/camera stay consistent this tick.
    const fx = Math.sin(v.heading);
    const fz = -Math.cos(v.heading);
    const rx = Math.cos(v.heading);
    const rz = Math.sin(v.heading);
    v.speed = v.vx * fx + v.vz * fz;
    v.lateralSpeed = v.vx * rx + v.vz * rz;
  }
}
