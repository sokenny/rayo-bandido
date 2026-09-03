import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/world/arenaLayout';
import { createCruiseController, nearestRouteTarget } from '../src/sim/cruise';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { createInitialGameState, stepGame } from '../src/sim/gameState';
import { isRoad } from '../src/render/scene/env/builders';
import { CRUISE, SIM_STEP, VEHICLE } from '../src/config/tuning';
import { msToKmh } from '../src/core/math';
import type { ObstacleBox } from '../src/core/types';

/**
 * Cruise mode has one promise: leave it running and come back to a car that is still driving
 * around the city. So the test is the promise - a full lap through the real simulation, with
 * the real vehicle physics and the real colliders, asserting the car never touches anything.
 */

const layout = createArenaLayout();
const route = layout.cruiseRoute;

function distanceToBox(b: ObstacleBox, x: number, z: number): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

function nearestCollider(x: number, z: number): { dist: number; tag: string } {
  let dist = Infinity;
  let tag = '';
  for (const c of layout.colliders) {
    const d = distanceToBox(c, x, z);
    if (d < dist) {
      dist = d;
      tag = c.tag ?? '';
    }
  }
  return { dist, tag };
}

/**
 * A lap with the electric cars parked out of the way, so a `collision` event can only mean
 * the autopilot drove into the city itself. `hitTime: Infinity` keeps them from respawning.
 */
function driveLap(maxSeconds: number) {
  const state = createInitialGameState(layout);
  for (const t of state.targets) {
    t.status = 'destroyed';
    t.hitTime = Number.POSITIVE_INFINITY;
  }
  const cmd = createPlayerCommand();
  const cruise = createCruiseController(route);
  cruise.reset(state.vehicle);

  const start = cruise.waypoint;
  const visited = new Set<number>([start]);
  const collisions: Array<{ x: number; z: number; impact: number }> = [];
  let minClearance = Infinity;
  let closestTag = '';
  let peakSpeed = 0;
  let lapSeconds = -1;
  let reversedTicks = 0;

  const steps = Math.round(maxSeconds / SIM_STEP);
  for (let i = 0; i < steps; i++) {
    cruise.step(state.vehicle, cmd, SIM_STEP);
    stepGame(state, cmd, layout, SIM_STEP);

    for (const ev of state.events) {
      if (ev.type === 'collision') collisions.push({ x: ev.x, z: ev.z, impact: ev.impact });
    }
    const near = nearestCollider(state.vehicle.x, state.vehicle.z);
    if (near.dist < minClearance) {
      minClearance = near.dist;
      closestTag = near.tag;
    }
    if (state.vehicle.speed > peakSpeed) peakSpeed = state.vehicle.speed;
    if (state.vehicle.speed < -0.1) reversedTicks++;

    visited.add(cruise.waypoint);
    if (lapSeconds < 0 && visited.size === route.length && cruise.waypoint === start) {
      lapSeconds = state.time;
    }
  }

  return { state, collisions, minClearance, closestTag, peakSpeed, lapSeconds, visited, reversedTicks };
}

describe('cruise route', () => {
  it('is a closed loop of at least eight waypoints', () => {
    expect(route.length).toBeGreaterThanOrEqual(8);
  });

  it('runs every leg over a road, clear of the colliders', () => {
    for (let i = 0; i < route.length; i++) {
      const a = route[i];
      const b = route[(i + 1) % route.length];
      const samples = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2) + 1;
      for (let s = 0; s <= samples; s++) {
        const t = s / samples;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const near = nearestCollider(x, z);
        expect(near.dist, `leg ${i} passes ${near.dist.toFixed(2)} m from ${near.tag}`).toBeGreaterThanOrEqual(2.5);
        expect(isRoad(x, z), `leg ${i} at (${x.toFixed(0)}, ${z.toFixed(0)}) is on a road`).toBe(true);
      }
    }
  });

  it('visits all three zones and the plaza', () => {
    expect(route.some((p) => p.x <= -80)).toBe(true);
    expect(route.some((p) => p.z <= -82)).toBe(true);
    expect(route.some((p) => p.z >= 82)).toBe(true);
    expect(route.some((p) => Math.abs(p.x) < 25 && Math.abs(p.z) < 25)).toBe(true);
  });
});

describe('cruise controller', () => {
  it('drives a full lap of the city without touching anything', () => {
    const lap = driveLap(240);

    expect(lap.collisions, `collisions: ${JSON.stringify(lap.collisions.slice(0, 3))}`).toHaveLength(0);
    expect(
      lap.minClearance,
      `closest approach was ${lap.minClearance.toFixed(2)} m from ${lap.closestTag}`,
    ).toBeGreaterThan(VEHICLE.collisionRadius);
    expect(lap.visited.size, 'every waypoint is visited').toBe(route.length);
    expect(lap.lapSeconds, 'the loop closes').toBeGreaterThan(0);
    expect(lap.reversedTicks, 'never has to reverse out of anything').toBe(0);
  });

  it('cruises at a relaxed speed and never floors it', () => {
    const lap = driveLap(240);
    expect(msToKmh(lap.peakSpeed)).toBeLessThan(msToKmh(CRUISE.speed) + 8);
    expect(lap.peakSpeed).toBeLessThan(VEHICLE.maxSpeed * 0.5);
  });

  it('never uses the handbrake or nitro, and leaves the action keys to the player', () => {
    const state = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    const cruise = createCruiseController(route);
    cruise.reset(state.vehicle);

    for (let i = 0; i < 3600; i++) {
      cmd.fire = true;
      cmd.restart = true;
      cruise.step(state.vehicle, cmd, SIM_STEP);
      expect(cmd.handbrake).toBe(false);
      expect(cmd.nitro).toBe(false);
      expect(cmd.fire, 'fire belongs to the player').toBe(true);
      expect(cmd.restart, 'restart belongs to the player').toBe(true);
      expect(cmd.steer).toBeGreaterThanOrEqual(-1);
      expect(cmd.steer).toBeLessThanOrEqual(1);
      cmd.fire = false;
      cmd.restart = false;
      stepGame(state, cmd, layout, SIM_STEP);
    }
  });

  it('picks up the route from wherever the car is', () => {
    expect(nearestRouteTarget(route, 40, -91)).toBe(2);
    expect(nearestRouteTarget(route, layout.playerSpawn.x, layout.playerSpawn.z)).toBe(1);
  });

  it('backs out when it is jammed against something', () => {
    const state = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    const cruise = createCruiseController(route);
    cruise.reset(state.vehicle);

    state.vehicle.x = -78;
    state.vehicle.z = -40;
    state.vehicle.heading = -Math.PI / 2;

    let reversing = false;
    for (let i = 0; i < Math.round((CRUISE.stuckTime + 0.5) / SIM_STEP); i++) {
      cruise.step(state.vehicle, cmd, SIM_STEP);
      if (cmd.brake === 1 && cmd.throttle === 0) reversing = true;
      state.vehicle.speed = 0;
      state.vehicle.vx = 0;
      state.vehicle.vz = 0;
    }
    expect(reversing, 'the stuck guard fires').toBe(true);
  });
});
