import type { ArenaLayout, TargetState } from '../core/types';
import { TARGETS } from '../config/tuning';
import { wrapAngle } from '../core/math';
import { pushOutOfWorld, type WallResponse } from './collision';

/**
 * Electric-car targets. Each target starts at a spawn point and optionally patrols a loop
 * of waypoints at a slow, uniform speed. Destroyed targets respawn after `respawnDelay`
 * so the loop never runs dry, but a reward is paid only once per destruction.
 *
 * A shoved car (`TARGETS.knock`) coasts along the shove and is stopped by the same walls
 * and buildings that stop the player: the patrol lane never meets a wall, but a bump at
 * speed used to send a car straight through the guardrail and out of the circuit.
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
      heading: s.heading,
      prevX: s.x,
      prevZ: s.z,
      prevHeading: s.heading,
      vx: 0,
      vz: 0,
      status: 'active',
      hitTime: -1,
      patrolIndex: 0,
      patrolSpeed: TARGETS.patrolSpeed,
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
  t.heading = s.heading;
  t.prevX = s.x;
  t.prevZ = s.z;
  t.prevHeading = s.heading;
  t.vx = 0;
  t.vz = 0;
  t.status = 'active';
  t.hitTime = -1;
  t.patrolIndex = 0;
  t.rewarded = false;
}

/**
 * Advance every target by `dt`. `respawn` false leaves destroyed cars destroyed: a
 * multiplayer client that does not own the traffic lets the host's reports bring them back.
 */
export function stepTargets(targets: TargetState[], layout: ArenaLayout, time: number, dt: number, respawn = true): void {
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    t.prevX = t.x;
    t.prevZ = t.z;
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
    if (!patrol || patrol.length < 2) continue;
    const wp = patrol[t.patrolIndex % patrol.length];
    const dx = wp.x - t.x;
    const dz = wp.z - t.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < TARGETS.waypointRadius) {
      t.patrolIndex = (t.patrolIndex + 1) % patrol.length;
      continue;
    }
    const desired = Math.atan2(dx, -dz);
    const delta = wrapAngle(desired - t.heading);
    const maxTurn = 1.8 * dt;
    t.heading = wrapAngle(t.heading + Math.max(-maxTurn, Math.min(maxTurn, delta)));
    const step = Math.min(dist, t.patrolSpeed * dt);
    t.x += Math.sin(t.heading) * step;
    t.z += -Math.cos(t.heading) * step;
  }
}
