import type { ArenaLayout, TargetState } from '../core/types';
import { TARGETS } from '../config/tuning';
import { wrapAngle } from '../core/math';

/**
 * Electric-car targets. Each target starts at a spawn point and optionally patrols a loop
 * of waypoints at a slow, uniform speed. Destroyed targets respawn after `respawnDelay`
 * so the loop never runs dry, but a reward is paid only once per destruction.
 */
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

export function stepTargets(targets: TargetState[], layout: ArenaLayout, time: number, dt: number): void {
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    t.prevX = t.x;
    t.prevZ = t.z;
    t.prevHeading = t.heading;
    if (t.status !== 'active') {
      if (TARGETS.respawnDelay >= 0 && t.hitTime >= 0 && time - t.hitTime >= TARGETS.respawnDelay) {
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
      const bb = layout.bounds;
      if (t.x < bb.minX) { t.x = bb.minX; if (t.vx < 0) t.vx = 0; }
      else if (t.x > bb.maxX) { t.x = bb.maxX; if (t.vx > 0) t.vx = 0; }
      if (t.z < bb.minZ) { t.z = bb.minZ; if (t.vz < 0) t.vz = 0; }
      else if (t.z > bb.maxZ) { t.z = bb.maxZ; if (t.vz > 0) t.vz = 0; }
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
