import type { ArenaLayout, TargetState } from '../core/types';
import { TARGETS } from '../config/tuning';
import { wrapAngle } from '../core/math';
import { pushOutOfWorld, type WallResponse } from './collision';
import { settleTarget } from './surface';

/**
 * Electric-car targets. Each target starts at a spawn point and optionally patrols a loop
 * of waypoints at a slow, uniform speed. Destroyed targets respawn after `respawnDelay`
 * so the loop never runs dry, but a reward is paid only once per destruction.
 *
 * A shoved car (`TARGETS.knock`) coasts along the shove and is stopped by the same walls
 * and buildings that stop the player: the patrol lane never meets a wall, but a bump at
 * speed used to send a car straight through the guardrail and out of the circuit.
 *
 * Cars also see each other (`TARGETS.traffic`): they give way to whatever is in the lane
 * ahead, and the ones that touch anyway are pushed apart instead of overlapping. Both
 * passes are pure functions of the car states, so every client still reaches the same
 * traffic from the same tick and `src/sim/traffic.ts` has nothing new to reconcile.
 */

/** How a wall answers a shoved electric car: a firm bounce, and a drag once it settles on it. */
const WALL: WallResponse = { restitution: 0.25, slide: 0.7, impactSpeed: 2.5, scrapeDecel: 6 };
export function createTargets(layout: ArenaLayout): TargetState[] {
  const list: TargetState[] = [];
  for (let i = 0; i < layout.targetSpawns.length; i++) {
    const s = layout.targetSpawns[i];
    list.push({
      id: i,
      x: s.x,
      z: s.z,
      y: s.y ?? 0,
      heading: s.heading,
      prevX: s.x,
      prevZ: s.z,
      prevY: s.y ?? 0,
      prevHeading: s.heading,
      vx: 0,
      vz: 0,
      status: 'active',
      hitTime: -1,
      patrolIndex: 0,
      patrolSpeed: TARGETS.patrolSpeed,
      speed: TARGETS.patrolSpeed,
      rewarded: false,
    });
  }
  return list;
}

export function resetTargets(targets: TargetState[], layout: ArenaLayout): void {
  for (let i = 0; i < targets.length; i++) respawnTarget(targets[i], layout);
}

function respawnTarget(t: TargetState, layout: ArenaLayout): void {
  const s = layout.targetSpawns[t.id];
  t.x = s.x;
  t.z = s.z;
  t.y = s.y ?? 0;
  t.heading = s.heading;
  t.prevX = s.x;
  t.prevZ = s.z;
  t.prevY = t.y;
  t.prevHeading = s.heading;
  t.vx = 0;
  t.vz = 0;
  t.status = 'active';
  t.hitTime = -1;
  t.patrolIndex = 0;
  t.speed = t.patrolSpeed;
  t.rewarded = false;
}

/**
 * How much of its patrol speed each car may use this tick, by id. Allocated once and grown
 * only if a layout ever carries more cars than the last one: stepping the traffic must not
 * allocate.
 */
let throttle = new Float64Array(0);

/**
 * Is `other` (offset `dx`,`dz`) inside the lane-shaped cone in front of `t`? Returns the
 * clear distance along the lane, or -1 when there is nothing in the way.
 */
function gapAhead(t: TargetState, dx: number, dz: number): number {
  // Forward for a heading, and the perpendicular that measures how far off the lane it is.
  const fx = Math.sin(t.heading);
  const fz = -Math.cos(t.heading);
  const ahead = dx * fx + dz * fz;
  if (ahead <= 0 || ahead > TARGETS.traffic.lookahead) return -1;
  const lateral = Math.abs(dx * -fz + dz * fx);
  return lateral < TARGETS.traffic.halfWidth ? ahead : -1;
}

/**
 * Give way. Every car looks up its own lane and lifts off for whatever is in it, down to a
 * full stop at `stopGap`.
 *
 * WHEN BOTH SEE EACH OTHER — a crossing taken at a right angle, or a rare nose to nose —
 * only one may give way, or the two stop and stay stopped for the rest of the session. The
 * higher id yields and the lower one drives on through: arbitrary, but arbitrary in the
 * same direction on every machine, which is what the traffic sync needs of it.
 */
function yieldToTraffic(targets: readonly TargetState[]): void {
  const n = targets.length;
  if (throttle.length < n) throttle = new Float64Array(n);
  for (let i = 0; i < n; i++) throttle[i] = 1;
  const { lookahead, stopGap } = TARGETS.traffic;
  const span = lookahead - stopGap;
  for (let i = 0; i < n; i++) {
    const a = targets[i];
    if (a.status !== 'active') continue;
    for (let j = i + 1; j < n; j++) {
      const b = targets[j];
      if (b.status !== 'active') continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      // A hundred-odd cars is several thousand pairs a tick, so the pair that is nowhere
      // near is rejected on two comparisons before anything is multiplied.
      if (dx > lookahead || dx < -lookahead || dz > lookahead || dz < -lookahead) continue;
      if (dx * dx + dz * dz > lookahead * lookahead) continue;
      const aGap = gapAhead(a, dx, dz);
      const bGap = gapAhead(b, -dx, -dz);
      // j is the higher id, so it is the one that gives way when the sight is mutual.
      if (aGap >= 0 && bGap < 0) throttle[i] = Math.min(throttle[i], Math.max(0, (aGap - stopGap) / span));
      if (bGap >= 0) throttle[j] = Math.min(throttle[j], Math.max(0, (bGap - stopGap) / span));
    }
  }
}

/**
 * The backstop: cars that ended the tick inside one another are pushed apart, half the
 * overlap each, and the speed they were closing at becomes a knock. That knock is the same
 * channel the player's bumps use, so it decays, it is stopped by walls, and the traffic
 * sync already carries it.
 */
function separateTraffic(targets: TargetState[], dt: number): void {
  const { contactDistance, bounce, maxBounce } = TARGETS.traffic;
  for (let i = 0; i < targets.length; i++) {
    const a = targets[i];
    if (a.status !== 'active') continue;
    for (let j = i + 1; j < targets.length; j++) {
      const b = targets[j];
      if (b.status !== 'active') continue;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      if (dx > contactDistance || dx < -contactDistance || dz > contactDistance || dz < -contactDistance) continue;
      const distSq = dx * dx + dz * dz;
      if (distSq >= contactDistance * contactDistance) continue;
      let dist = Math.sqrt(distSq);
      if (dist < 1e-4) {
        // Exactly concentric: no contact normal to be had, so pick one and keep it stable.
        dx = 1;
        dz = 0;
        dist = 1;
      }
      const nx = dx / dist;
      const nz = dz / dist;
      // Closing speed from the step each car just took, before the push below moves them:
      // the patrol drives the car by position, so this is the only place it can be read.
      const closing = (((a.x - a.prevX) - (b.x - b.prevX)) * nx + ((a.z - a.prevZ) - (b.z - b.prevZ)) * nz) / dt;
      const push = (contactDistance - dist) * 0.5;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      if (closing <= 0) continue;
      const impulse = Math.min(closing * bounce, maxBounce);
      a.vx -= nx * impulse;
      a.vz -= nz * impulse;
      b.vx += nx * impulse;
      b.vz += nz * impulse;
    }
  }
}

/**
 * Advance every target by `dt`. `respawn` false leaves destroyed cars destroyed: a
 * multiplayer client that does not own the traffic lets the host's reports bring them back.
 */
export function stepTargets(targets: TargetState[], layout: ArenaLayout, time: number, dt: number, respawn = true): void {
  yieldToTraffic(targets);
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    t.prevX = t.x;
    t.prevZ = t.z;
    t.prevY = t.y;
    t.prevHeading = t.heading;
    if (t.status !== 'active') {
      if (respawn && TARGETS.respawnDelay >= 0 && t.hitTime >= 0 && time - t.hitTime >= TARGETS.respawnDelay) {
        respawnTarget(t, layout);
      }
      continue;
    }

    // Knockback from a player bump: coast along the shove, then decay back to the patrol.
    if (t.vx !== 0 || t.vz !== 0) {
      t.x += t.vx * dt;
      t.z += t.vz * dt;
      const decay = Math.max(0, 1 - TARGETS.knock.damping * dt);
      t.vx *= decay;
      t.vz *= decay;
      if (Math.abs(t.vx) < 0.05 && Math.abs(t.vz) < 0.05) {
        t.vx = 0;
        t.vz = 0;
      }
      // Walls, buildings and the arena edge. Only while shoved: the patrol lane is clear of
      // them all, so an unbumped car never pays for this.
      pushOutOfWorld(t, TARGETS.knock.radius, layout, WALL, dt);
    }

    const patrol = layout.targetPatrols[t.id];
    if (!patrol || patrol.length < 2) {
      settleTarget(t, layout);
      continue;
    }
    const wp = patrol[t.patrolIndex % patrol.length];
    const dx = wp.x - t.x;
    const dz = wp.z - t.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < TARGETS.waypointRadius) {
      t.patrolIndex = (t.patrolIndex + 1) % patrol.length;
      settleTarget(t, layout);
      continue;
    }
    const desired = Math.atan2(dx, -dz);
    const delta = wrapAngle(desired - t.heading);
    const maxTurn = 1.8 * dt;
    t.heading = wrapAngle(t.heading + Math.max(-maxTurn, Math.min(maxTurn, delta)));
    // Ease on and off the patrol speed rather than switching it: a car that stops dead for
    // the one in front, or resumes in a single tick, reads as a glitch and not as traffic.
    const cruise = t.patrolSpeed * throttle[i];
    const rate = (cruise < t.speed ? TARGETS.traffic.brake : TARGETS.traffic.accel) * dt;
    t.speed += Math.max(-rate, Math.min(rate, cruise - t.speed));
    const step = Math.min(dist, t.speed * dt);
    t.x += Math.sin(t.heading) * step;
    t.z += -Math.cos(t.heading) * step;
    // The road under the car may be climbing: follow it.
    settleTarget(t, layout);
  }
  separateTraffic(targets, dt);
}
