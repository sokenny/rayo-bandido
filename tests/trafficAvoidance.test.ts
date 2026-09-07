import { describe, it, expect } from 'vitest';
import type { ArenaLayout, TargetState } from '../src/core/types';
import { createTargets, stepTargets } from '../src/sim/targets';
import { TARGETS } from '../src/config/tuning';

/**
 * Electric cars against each other. Two cars used to occupy the same metre of road quite
 * happily and drive on through one another; these lock in the two things that stopped it —
 * giving way to the car in front, and being pushed apart when they touch anyway — plus the
 * thing that giving way must never become, which is a junction where nobody moves again.
 */

const SIM_STEP = 1 / 60;

/** A layout with no walls or surface: patrols are the only thing moving the cars. */
function layoutWith(
  spawns: { x: number; z: number; heading: number }[],
  patrols: { x: number; z: number }[][],
): ArenaLayout {
  return {
    bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 },
    playerSpawn: { x: 0, z: 0, heading: 0 },
    targetSpawns: spawns,
    targetPatrols: patrols,
    cruiseRoute: [],
    colliders: [],
    walls: [],
    surface: null,
    minimap: { bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 }, rects: [], ribbons: [] },
    race: null,
  };
}

/** Closest the two cars came to each other over the run (centre to centre, m). */
function run(targets: TargetState[], layout: ArenaLayout, seconds: number): number {
  let closest = Infinity;
  for (let i = 0; i < Math.round(seconds / SIM_STEP); i++) {
    stepTargets(targets, layout, i * SIM_STEP, SIM_STEP);
    for (let a = 0; a < targets.length; a++) {
      for (let b = a + 1; b < targets.length; b++) {
        const dx = targets[b].x - targets[a].x;
        const dz = targets[b].z - targets[a].z;
        closest = Math.min(closest, Math.sqrt(dx * dx + dz * dz));
      }
    }
  }
  return closest;
}

describe('electric cars in each other\'s way', () => {
  it('lifts off for a car standing in the lane ahead instead of driving through it', () => {
    // Both run east along z = 0; the leader is parked on the lane.
    const layout = layoutWith(
      [{ x: 40, z: 0, heading: Math.PI / 2 }, { x: 0, z: 0, heading: Math.PI / 2 }],
      [[{ x: 40, z: 0 }, { x: 120, z: 0 }], [{ x: 120, z: 0 }, { x: 0, z: 0 }]],
    );
    const targets = createTargets(layout);
    targets[0].patrolSpeed = 0;
    targets[0].speed = 0;

    const closest = run(targets, layout, 20);
    expect(closest).toBeGreaterThan(TARGETS.traffic.contactDistance);
    // Stopped short of the parked car, and stopped rather than crawling into it.
    expect(targets[1].x).toBeLessThan(40 - TARGETS.traffic.contactDistance);
    expect(targets[1].speed).toBeLessThan(0.5);
  });

  it('picks the patrol speed back up once the road ahead clears', () => {
    const layout = layoutWith(
      [{ x: 20, z: 0, heading: Math.PI / 2 }, { x: 12, z: 0, heading: Math.PI / 2 }],
      [[{ x: 20, z: 0 }, { x: 200, z: 0 }], [{ x: 12, z: 0 }, { x: 200, z: 0 }]],
    );
    const targets = createTargets(layout);
    targets[0].patrolSpeed = 0;
    targets[0].speed = 0;
    // A few seconds behind a parked car: closed the gap and settled at a stop.
    run(targets, layout, 6);
    expect(targets[1].speed).toBeLessThan(0.5);
    // The parked car drives off; the follower goes back to cruising.
    targets[0].patrolSpeed = TARGETS.patrolSpeed * 2;
    run(targets, layout, 6);
    expect(targets[1].speed).toBeCloseTo(TARGETS.patrolSpeed, 1);
  });

  it('never lets two patrols share the same piece of road at a crossing', () => {
    // One car west to east, one north to south, both through the origin, on loops that
    // bring them back for another attempt at it.
    const layout = layoutWith(
      [{ x: -60, z: 0, heading: Math.PI / 2 }, { x: 0, z: -60, heading: Math.PI }],
      [
        [{ x: 60, z: 0 }, { x: -60, z: 0 }],
        [{ x: 0, z: 60 }, { x: 0, z: -60 }],
      ],
    );
    const targets = createTargets(layout);
    const closest = run(targets, layout, 90);
    expect(closest).toBeGreaterThanOrEqual(TARGETS.traffic.contactDistance - 1e-6);
  });

  it('does not deadlock at that crossing: both cars are still getting round the loop', () => {
    const layout = layoutWith(
      [{ x: -60, z: 0, heading: Math.PI / 2 }, { x: 0, z: -60, heading: Math.PI }],
      [
        [{ x: 60, z: 0 }, { x: -60, z: 0 }],
        [{ x: 0, z: 60 }, { x: 0, z: -60 }],
      ],
    );
    const targets = createTargets(layout);
    run(targets, layout, 60);
    const laps = targets.map((t) => t.patrolIndex);
    // Both have been round at least one waypoint: neither is parked at the junction.
    expect(Math.min(...laps)).toBeGreaterThanOrEqual(0);
    const before = targets.map((t) => ({ x: t.x, z: t.z }));
    run(targets, layout, 10);
    for (let i = 0; i < targets.length; i++) {
      const moved = Math.hypot(targets[i].x - before[i].x, targets[i].z - before[i].z);
      expect(moved).toBeGreaterThan(1);
    }
  });

  it('pushes apart two cars that ended up inside one another, and knocks them along', () => {
    const layout = layoutWith([{ x: 0, z: 0, heading: 0 }, { x: 0.5, z: 0, heading: 0 }], []);
    const targets = createTargets(layout);
    // Closing at speed, from a shove: they meet rather than merge.
    targets[0].vx = 8;
    stepTargets(targets, layout, 0, SIM_STEP);
    const gap = Math.hypot(targets[1].x - targets[0].x, targets[1].z - targets[0].z);
    expect(gap).toBeCloseTo(TARGETS.traffic.contactDistance, 6);
    expect(targets[1].vx).toBeGreaterThan(0);
    expect(targets[0].vx).toBeLessThan(8);
  });
});
