import type { ArenaLayout, GameEvent, TargetState, VehicleState } from '../core/types';
import { TARGETS, VEHICLE } from '../config/tuning';

/**
 * Circle-vs-AABB collision of the car against arena obstacles. Pushes the car out,
 * removes the velocity component into the wall and emits a collision event.
 * Deliberately simple and forgiving: arcade feel over accuracy.
 */
export function resolveCollisions(v: VehicleState, layout: ArenaLayout, events: GameEvent[]): void {
  const r = VEHICLE.collisionRadius;
  let impact = 0;
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
    const vn = v.vx * nx + v.vz * nz;
    if (vn < 0) {
      impact = Math.max(impact, -vn);
      // Remove the normal component (with a little bounce), keep most of the tangential.
      const tx = -nz;
      const tz = nx;
      const vt = (v.vx * tx + v.vz * tz) * VEHICLE.collisionSlide;
      const bounce = -vn * VEHICLE.restitution;
      v.vx = tx * vt + nx * bounce;
      v.vz = tz * vt + nz * bounce;
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
    t.vx += nx * approach * k.transfer;
    t.vz += nz * approach * k.transfer;

    // The player keeps most of their into-the-car speed, so it feels like a shove.
    const loss = approach * (1 - k.playerRetain);
    v.vx -= nx * loss;
    v.vz -= nz * loss;

    if (approach > k.minImpact) {
      bumped = true;
      events.push({ type: 'collision', x: (v.x + t.x) * 0.5, z: (v.z + t.z) * 0.5, impact: approach });
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
