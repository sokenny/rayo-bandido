import { describe, expect, it } from 'vitest';
import { createVehicleState } from '../src/sim/gameState';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { stepVehicle } from '../src/sim/vehicle';
import { resolveCollisions } from '../src/sim/collision';
import { VEHICLE } from '../src/config/tuning';
import type { ArenaLayout, GameEvent, VehicleState } from '../src/core/types';

/**
 * Wall behaviour. A hit has to hurt, but a car that ends up leaning on a barrier must be able
 * to drive itself off it: the old response scrubbed the along-the-wall speed on every tick of
 * contact, which pinned any car that touched a wall at an angle and left reverse as the only
 * way out.
 */

const DT = 1 / 60;

/** One straight guardrail along z = 0. The car approaches it from below (negative z). */
const LAYOUT = {
  bounds: { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 },
  playerSpawn: { x: 0, z: 0, heading: 0 },
  targetSpawns: [],
  targetPatrols: [],
  cruiseRoute: [],
  colliders: [],
  walls: [{ ax: -2000, az: 0, bx: 2000, bz: 0 }],
  race: null,
} as unknown as ArenaLayout;

/** `deg` is the angle between the car's path and the wall: 0 is parallel, 90 is head-on. */
function approach(deg: number, kmh: number, z = -8): VehicleState {
  const rad = (deg * Math.PI) / 180;
  const dirX = Math.cos(rad);
  const dirZ = Math.sin(rad);
  const v = createVehicleState(0, z, Math.atan2(dirX, -dirZ));
  const speed = kmh / 3.6;
  v.vx = dirX * speed;
  v.vz = dirZ * speed;
  v.speed = speed;
  return v;
}

function drive(
  v: VehicleState,
  seconds: number,
  opts: { throttle?: number; steer?: number } = {},
): GameEvent[] {
  const cmd = createPlayerCommand();
  cmd.throttle = opts.throttle ?? 1;
  cmd.steer = opts.steer ?? 0;
  const events: GameEvent[] = [];
  const collected: GameEvent[] = [];
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    stepVehicle(v, cmd, false, DT);
    events.length = 0;
    resolveCollisions(v, LAYOUT, events, DT);
    for (const e of events) collected.push({ ...e } as GameEvent);
  }
  return collected;
}

const kmh = (v: VehicleState): number => Math.hypot(v.vx, v.vz) * 3.6;

describe('hitting a wall at an angle', () => {
  it('keeps the car rolling along the wall instead of pinning it', () => {
    for (const deg of [10, 20, 30, 45]) {
      const v = approach(deg, 90);
      drive(v, 4);
      // Still against the wall, still going, and going along it rather than into it.
      expect(kmh(v), `${deg} deg`).toBeGreaterThan(60);
      expect(v.x, `${deg} deg`).toBeGreaterThan(40);
    }
  });

  it('lets the throttle pull away along a wall it is scraping', () => {
    const v = approach(20, 60);
    drive(v, 2); // Reach the wall and settle along it.
    const settled = kmh(v);
    drive(v, 2);
    // The scrape is a drag the engine can out-pull, not a brake that holds the car down.
    expect(kmh(v)).toBeGreaterThan(settled + 10);
  });

  it('still answers a real hit as a hit', () => {
    const v = approach(90, 90);
    const events = drive(v, 1, { throttle: 0 });
    const hits = events.filter((e) => e.type === 'collision');
    expect(hits.length).toBeGreaterThan(0);
    expect(Math.max(...hits.map((e) => (e.type === 'collision' ? e.impact : 0)))).toBeGreaterThan(
      VEHICLE.wallImpactSpeed,
    );
    expect(kmh(v)).toBeLessThan(30);
  });
});

describe('a car wedged nose-first into a wall', () => {
  it('works itself off the wall on throttle and lock', () => {
    for (const nose of [90, 70, 50]) {
      for (const steer of [-1, 1]) {
        const v = approach(nose, 0, -VEHICLE.collisionRadius);
        let freed = -1;
        for (let t = 0; t < 5 / DT; t++) {
          drive(v, DT, { steer });
          if (freed < 0 && v.z < -3 && kmh(v) > 15) freed = t * DT;
        }
        expect(freed, `${nose} deg, steer ${steer}`).toBeGreaterThan(0);
        expect(freed, `${nose} deg, steer ${steer}`).toBeLessThan(4);
      }
    }
  });

  it('stays put when the driver is not asking to go anywhere', () => {
    const v = approach(90, 0, -VEHICLE.collisionRadius);
    const heading = v.heading;
    drive(v, 2, { throttle: 0 });
    expect(kmh(v)).toBeLessThan(1);
    expect(v.heading).toBeCloseTo(heading, 6);
  });
});
