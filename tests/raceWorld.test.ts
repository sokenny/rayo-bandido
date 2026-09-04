import { describe, expect, it } from 'vitest';
import type { ObstacleBox, ObstacleWall } from '../src/core/types';
import { RACE, SIM_STEP, VEHICLE } from '../src/config/tuning';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { createInitialGameState, stepGame } from '../src/sim/gameState';
import { createCruiseController } from '../src/sim/cruise';
import { createRaceWorld } from '../src/world/raceWorld';
import { longestStraight, maxCornerAngle, minCornerRadius, projectOntoPath, createProjection } from '../src/world/track';

/**
 * The circuit is generated from `raceSpec.ts`; these tests pin the design brief (fast
 * straights, no right-angle corners, two hidden shortcuts, a ~90 s two-lap race) and the
 * contract between art and simulation (nothing drivable inside a collider).
 */
const { layout, plan } = createRaceWorld();
const course = layout.race!;
const path = course.path;

function distanceToBox(b: ObstacleBox, x: number, z: number): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

function distanceToWall(w: ObstacleWall, x: number, z: number): number {
  const dx = w.bx - w.ax;
  const dz = w.bz - w.az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((x - w.ax) * dx + (z - w.az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(w.ax + dx * t - x, w.az + dz * t - z);
}

function clearance(x: number, z: number): number {
  let d = Infinity;
  for (const c of layout.colliders) d = Math.min(d, distanceToBox(c, x, z));
  for (const w of layout.walls) d = Math.min(d, distanceToWall(w, x, z));
  return d;
}

describe('race circuit design', () => {
  it('is a closed lap of about 1.4 km', () => {
    expect(course).not.toBeNull();
    expect(path.closed).toBe(true);
    expect(path.length).toBeGreaterThan(1300);
    expect(path.length).toBeLessThan(1500);
  });

  it('has no corner sharper than 90 degrees and none tighter than 30 m radius', () => {
    expect(maxCornerAngle(path)).toBeLessThan(Math.PI / 2);
    expect(minCornerRadius(path)).toBeGreaterThanOrEqual(30);
  });

  it('has a highway straight long enough to empty the nitro', () => {
    expect(longestStraight(path)).toBeGreaterThan(140);
  });

  it('mixes highway and city widths', () => {
    const widths = new Set(path.samples.map((s) => Math.round(s.halfWidth * 2)));
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(20);
    expect(Math.min(...widths)).toBeLessThanOrEqual(14);
    expect(path.samples.some((s) => s.zone === 'corporate')).toBe(true);
    expect(path.samples.some((s) => s.zone === 'urban')).toBe(true);
    expect(path.samples.some((s) => s.zone === 'jdm')).toBe(true);
  });

  it('offers two narrow shortcuts that each skip part of the lap without skipping a gate', () => {
    expect(course.shortcuts).toHaveLength(2);
    const L = path.length;
    for (const sc of course.shortcuts) {
      const skipped = (((sc.sOut - sc.sIn) % L) + L) % L;
      expect(sc.path.length, 'the alley is shorter than the road it replaces').toBeLessThan(skipped);
      expect(skipped - sc.path.length, 'and worth taking').toBeGreaterThan(25);
      for (const s of sc.path.samples) expect(s.halfWidth * 2).toBeLessThanOrEqual(8);
      for (const g of course.gates) {
        const rel = (((g.s - sc.sIn) % L) + L) % L;
        expect(rel > skipped || rel === 0, `gate at ${g.s.toFixed(0)} is not inside the skipped stretch`).toBe(true);
      }
    }
  });

  it('orders the gates along the lap from the line', () => {
    expect(course.gates.length).toBeGreaterThanOrEqual(4);
    const L = path.length;
    const line = course.gates[0].s;
    let prev = 0;
    for (let i = 1; i < course.gates.length; i++) {
      const rel = (((course.gates[i].s - line) % L) + L) % L;
      expect(rel).toBeGreaterThan(prev);
      prev = rel;
    }
    // Every gate spans the whole road.
    for (const g of course.gates) expect(Math.hypot(g.bx - g.ax, g.bz - g.az)).toBeGreaterThan(12);
  });
});

describe('race circuit contract', () => {
  it('keeps the whole road clear of buildings and walls', () => {
    for (const rb of plan.ribbons) {
      for (const s of rb.path.samples) {
        for (const side of [-0.85, 0, 0.85]) {
          const x = s.x + -s.tz * s.halfWidth * side;
          const z = s.z + s.tx * s.halfWidth * side;
          expect(plan.isSolid(x, z), `road at (${x.toFixed(0)}, ${z.toFixed(0)}) is clear`).toBe(false);
          for (const c of layout.colliders) {
            expect(distanceToBox(c, x, z), `${c.tag} vs road at (${x.toFixed(0)}, ${z.toFixed(0)})`).toBeGreaterThan(0.5);
          }
        }
      }
    }
  });

  it('fences the road with wall segments that never sit on another road', () => {
    expect(layout.walls.length).toBeGreaterThan(400);
    for (const w of layout.walls) {
      const mx = (w.ax + w.bx) / 2;
      const mz = (w.az + w.bz) / 2;
      expect(plan.isRoad(mx, mz, -0.2), `wall at (${mx.toFixed(0)}, ${mz.toFixed(0)}) is on the road edge, not inside a road`).toBe(false);
    }
  });

  it('opens the guardrail where each alley joins the lap', () => {
    for (const sc of course.shortcuts) {
      for (const end of [sc.path.samples[0], sc.path.samples[sc.path.samples.length - 1]]) {
        // Walk a few metres into the alley from the junction: nothing solid may block the car.
        for (let k = 0; k <= 6; k++) {
          const x = end.x + (end.tx * (k - 3)) * 2;
          const z = end.z + (end.tz * (k - 3)) * 2;
          expect(clearance(x, z), `alley mouth clear at (${x.toFixed(0)}, ${z.toFixed(0)})`).toBeGreaterThan(VEHICLE.collisionRadius);
        }
      }
    }
  });

  it('puts the grid on the road just past the line, facing along the lap', () => {
    expect(course.grid).toHaveLength(RACE.gridSlots);
    const p = createProjection();
    for (const slot of course.grid) {
      expect(plan.isRoad(slot.x, slot.z)).toBe(true);
      expect(clearance(slot.x, slot.z)).toBeGreaterThan(2.5);
      projectOntoPath(path, slot.x, slot.z, p);
      const heading = Math.atan2(p.tx, -p.tz);
      expect(Math.abs(slot.heading - heading)).toBeLessThan(0.05);
      const rel = (((p.s - course.gates[0].s) % path.length) + path.length) % path.length;
      expect(rel).toBeGreaterThan(2);
      expect(rel).toBeLessThan(60);
    }
    expect(layout.playerSpawn).toEqual(course.grid[0]);
  });

  it('starts every electric car on the lap and keeps every patrol point clear of walls', () => {
    expect(layout.targetSpawns.length).toBeGreaterThanOrEqual(6);
    layout.targetPatrols.forEach((loop, i) => {
      expect(loop.length).toBeGreaterThan(50);
      const s = layout.targetSpawns[i];
      expect(Math.hypot(s.x - loop[0].x, s.z - loop[0].z)).toBeLessThan(1e-6);
      for (const p of loop) {
        expect(plan.isRoad(p.x, p.z), `patrol ${i} point on the road`).toBe(true);
        expect(clearance(p.x, p.z)).toBeGreaterThan(2.2);
      }
    });
    // Not on the grid.
    for (const s of layout.targetSpawns) {
      for (const g of course.grid) expect(Math.hypot(s.x - g.x, s.z - g.z)).toBeGreaterThan(15);
    }
  });

  it('gives cruise mode a route along the centreline', () => {
    expect(layout.cruiseRoute.length).toBeGreaterThan(40);
    for (const p of layout.cruiseRoute) expect(plan.isRoad(p.x, p.z)).toBe(true);
  });

  it('describes the minimap as one visible lap and hidden alleys', () => {
    const visible = layout.minimap.ribbons.filter((r) => !r.hidden);
    expect(visible).toHaveLength(1);
    expect(visible[0].closed).toBe(true);
    expect(layout.minimap.ribbons.filter((r) => r.hidden)).toHaveLength(2);
  });

  it('generates a city: dozens of blocks, none of them on a road', () => {
    expect(plan.blocks.length).toBeGreaterThan(40);
    for (const b of plan.blocks) {
      expect(b.maxX - b.minX).toBeGreaterThan(5);
      expect(b.maxZ - b.minZ).toBeGreaterThan(5);
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      expect(plan.isRoad(cx, cz)).toBe(false);
    }
  });
});

describe('race in the simulation', () => {
  it('holds the car on the grid through the countdown, then lets it launch', () => {
    const state = createInitialGameState(layout);
    expect(state.race?.phase).toBe('countdown');
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    const x0 = state.vehicle.x;
    const z0 = state.vehicle.z;
    const holdTicks = Math.floor((RACE.countdownSeconds - 0.1) / SIM_STEP);
    for (let i = 0; i < holdTicks; i++) stepGame(state, cmd, layout, SIM_STEP);
    expect(Math.hypot(state.vehicle.x - x0, state.vehicle.z - z0)).toBeLessThan(0.5);
    expect(state.race?.phase).toBe('countdown');
    for (let i = 0; i < 60 * 2; i++) stepGame(state, cmd, layout, SIM_STEP);
    expect(state.race?.phase).toBe('racing');
    expect(state.vehicle.speed).toBeGreaterThan(10);
    expect(state.events.some((e) => e.type === 'collision')).toBe(false);
  });

  it('lets cruise mode drive a clean lap that the race rules count', () => {
    const state = createInitialGameState(layout);
    // Park the electric cars: a bump would be a collision too, and this test is about walls.
    for (const t of state.targets) {
      t.status = 'destroyed';
      t.hitTime = -1;
    }
    const cmd = createPlayerCommand();
    const cruise = createCruiseController(layout.cruiseRoute);
    cruise.reset(state.vehicle);
    let collisions = 0;
    const gates: number[] = [];
    let laps = 0;
    let ticks = 0;
    // The autopilot cruises at ~47 km/h, so a lap takes well under two and a half minutes.
    while (laps < 1 && ticks < 60 * 150) {
      cruise.step(state.vehicle, cmd, SIM_STEP);
      stepGame(state, cmd, layout, SIM_STEP);
      for (const e of state.events) {
        if (e.type === 'collision') collisions++;
        if (e.type === 'checkpoint') gates.push(e.index);
        if (e.type === 'lapComplete') laps++;
      }
      ticks++;
    }
    expect(collisions, 'wall contacts during the lap').toBe(0);
    expect(gates).toEqual([1, 2, 3, 4]);
    expect(laps).toBe(1);
    expect(state.race?.lap).toBe(2);
    expect(state.race?.lapTimes[0]).toBeGreaterThan(60);
    expect(state.race?.wrongWay).toBe(false);
  });
});
