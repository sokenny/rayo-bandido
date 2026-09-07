import { describe, expect, it } from 'vitest';
import type { ObstacleBox, ObstacleWall } from '../src/core/types';
import { BUSES, RACE, SIM_STEP, VEHICLE } from '../src/config/tuning';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { createCruiseController } from '../src/sim/cruise';
import { createInitialGameState, stepGame } from '../src/sim/gameState';
import { builderStats, createBuilders } from '../src/render/scene/env/builders';
import { buildCity } from '../src/render/scene/env/cityBuilder';
import { buildLandmarks } from '../src/render/scene/env/landmarksBuilder';
import { buildNeonWalls } from '../src/render/scene/env/neonWalls';
import { buildProps } from '../src/render/scene/env/propsBuilder';
import { buildReclamation } from '../src/render/scene/env/reclaimBuilder';
import { buildTrack } from '../src/render/scene/env/trackBuilder';
import { buildTransit } from '../src/render/scene/env/transitBuilder';
import { createCityWorld } from '../src/world/cityWorld';
import { createCircuitWorld } from '../src/world/circuitWorld';
import {
  CIRCUIT_BORROWED,
  CIRCUIT_DECK_Y,
  CIRCUIT_GATES,
  CIRCUIT_LAPS,
  CIRCUIT_SPEC,
  CIRCUIT_STREETS,
  circuitZoneOf,
} from '../src/world/circuitSpec';
import { CITY_ROADS, RAMP_SPECS, VIADUCT_SPEC, VIADUCT_Y, zoneOf } from '../src/world/citySpec';
import { buildTrackPath, createProjection, projectOntoPath, type TrackPath } from '../src/world/track';

/**
 * The versus circuit is the city with a race drawn inside it. These tests pin its three
 * promises:
 *
 *  1. it is the CITY. `circuitSpec.ts` repeats the streets it uses, and the ramp and viaduct
 *     nodes it borrows, as plain data so the design tool can load it in Node; if that copy
 *     drifts from `citySpec.ts` the lap is drawn on a road that is not there.
 *  2. it stands on DRIVABLE GROUND, edge to edge, at its own height — including where it is
 *     fifteen metres up on the viaduct — and the barrier that follows those edges is a pair of
 *     continuous curves with no branch and no gap.
 *  3. it is DRIVEABLE, and it is a two-minute race. The last block drives the whole thing
 *     through the real simulation, against the real barrier.
 */

const path = buildTrackPath(CIRCUIT_SPEC);
const { layout, plan } = createCircuitWorld(1234);
const course = layout.race!;
const barriers = plan.neonWalls!;

/** Every road in the city, ground and elevated, as a path. */
const roads: Array<{ tag: string; path: TrackPath }> = [
  ...CITY_ROADS.map((r) => ({ tag: r.tag, path: buildTrackPath(r.spec) })),
  ...RAMP_SPECS.map((r) => ({ tag: r.tag, path: buildTrackPath(r.spec) })),
  { tag: 'viaduct', path: buildTrackPath(VIADUCT_SPEC) },
];

/** A road covering (x, z) within `LEVEL` of height `y`, or null. */
const LEVEL = 2.5;
const roadProj = createProjection();
function roadAt(x: number, z: number, y: number): string | null {
  for (const r of roads) {
    projectOntoPath(r.path, x, z, roadProj);
    if (roadProj.dist <= roadProj.halfWidth && Math.abs(roadProj.y - y) <= LEVEL) return r.tag;
  }
  return null;
}

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

/** Twice the signed area of a closed loop: which way round it goes. */
function sense(loop: ReadonlyArray<{ x: number; z: number }>): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.sign(sum);
}

describe('the circuit stands on the city', () => {
  it('repeats the streets it uses without drifting from citySpec', () => {
    for (const s of CIRCUIT_STREETS) {
      const road = CITY_ROADS.find((r) => r.tag === s.tag);
      expect(road, `${s.tag} is a road in citySpec.ts`).toBeDefined();
      const nodes = road!.spec.nodes;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (s.axis === 'z') {
        expect(first.x, `${s.tag} x`).toBeCloseTo(s.at, 6);
        expect(Math.min(first.z, last.z), `${s.tag} from`).toBeCloseTo(s.from, 6);
        expect(Math.max(first.z, last.z), `${s.tag} to`).toBeCloseTo(s.to, 6);
      } else {
        expect(first.z, `${s.tag} z`).toBeCloseTo(s.at, 6);
        expect(Math.min(first.x, last.x), `${s.tag} from`).toBeCloseTo(s.from, 6);
        expect(Math.max(first.x, last.x), `${s.tag} to`).toBeCloseTo(s.to, 6);
      }
      for (const n of nodes) expect(n.width / 2, `${s.tag} half width`).toBeCloseTo(s.halfWidth, 6);
    }
  });

  it('borrows the ramp and viaduct nodes verbatim, heights included', () => {
    expect(CIRCUIT_DECK_Y).toBe(VIADUCT_Y);
    for (const b of CIRCUIT_BORROWED) {
      const spec = b.road === 'viaduct' ? VIADUCT_SPEC : RAMP_SPECS.find((r) => r.tag === b.road)?.spec;
      expect(spec, `${b.road} is a road in citySpec.ts`).toBeDefined();
      const hit = spec!.nodes.find((n) => Math.abs(n.x - b.x) < 1e-6 && Math.abs(n.z - b.z) < 1e-6);
      expect(hit, `${b.road} has a node at (${b.x}, ${b.z})`).toBeDefined();
      // And the lap really uses it, so the list cannot rot into decoration.
      const used = CIRCUIT_SPEC.nodes.some((n) => Math.abs(n.x - b.x) < 1e-6 && Math.abs(n.z - b.z) < 1e-6);
      expect(used, `the lap runs through (${b.x}, ${b.z})`).toBe(true);
    }
  });

  it('reads the same districts as the city', () => {
    for (let x = -260; x <= 260; x += 20) {
      for (let z = -250; z <= 190; z += 20) {
        expect(circuitZoneOf(x, z), `zone at (${x}, ${z})`).toBe(zoneOf(x, z));
      }
    }
  });

  it('keeps the whole ribbon, edge to edge and at its own height, on a real road', () => {
    const ACROSS = 9;
    for (const s of path.samples) {
      for (let k = 0; k < ACROSS; k++) {
        const lat = (k / (ACROSS - 1) - 0.5) * 2 * s.halfWidth;
        const x = s.x + -s.tz * lat;
        const z = s.z + s.tx * lat;
        expect(
          roadAt(x, z, s.y),
          `station ${s.s.toFixed(0)} at (${x.toFixed(1)}, ${z.toFixed(1)}) y ${s.y.toFixed(1)} is off the road`,
        ).not.toBeNull();
      }
    }
  });

  it('climbs onto the viaduct and comes back down', () => {
    const top = Math.max(...path.samples.map((s) => s.y));
    expect(top, 'the lap gets onto the deck').toBeCloseTo(VIADUCT_Y, 0);
    const onDeck = path.samples.filter((s) => s.y > VIADUCT_Y - 0.5).length / path.samples.length;
    expect(onDeck, 'a real stretch of the lap is up there').toBeGreaterThan(0.15);
    expect(path.samples.some((s) => s.y < 0.5), 'and a real stretch of it is on the street').toBe(true);
  });
});

describe('the barrier', () => {
  it('is two continuous curves round the lap, one per side, with no gap', () => {
    for (const side of [-1, 1]) {
      const run = barriers.filter((w) => w.side === side);
      expect(run.length, `side ${side} has spans`).toBeGreaterThan(100);
      // Consecutive spans meet exactly, and the last one closes back onto the first.
      for (let i = 0; i < run.length; i++) {
        const a = run[i];
        const b = run[(i + 1) % run.length];
        expect(Math.hypot(b.ax - a.bx, b.az - a.bz), `side ${side} span ${i} joins the next`).toBeLessThan(1e-6);
      }
    }
  });

  it('never stands in a building and never leaves the road it edges', () => {
    for (const w of barriers) {
      const points: Array<[number, number, number]> = [
        [w.ax, w.az, w.ay],
        [(w.ax + w.bx) / 2, (w.az + w.bz) / 2, (w.ay + w.by) / 2],
      ];
      for (const [x, z, y] of points) {
        expect(roadAt(x, z, y), `barrier at (${x.toFixed(1)}, ${z.toFixed(1)}) is on a road`).not.toBeNull();
        if (y < 1) {
          expect(plan.isSolid(x, z, 0.4), `barrier at (${x.toFixed(1)}, ${z.toFixed(1)}) is clear of the blocks`).toBe(false);
        }
      }
    }
  });

  it('carries the height of the road at both ends, so it rides the ramp and the deck', () => {
    for (const w of barriers) expect(Math.abs(w.ay - w.by), 'a span never steps').toBeLessThan(1.2);
    expect(barriers.some((w) => w.ay > VIADUCT_Y - 0.5), 'some of it is on the deck').toBe(true);
    expect(barriers.some((w) => w.ay < 0.5), 'some of it is on the street').toBe(true);
  });

  it('hands every span to the simulation as a wall bounded to its own level', () => {
    const neon = layout.walls.filter((w) => w.tag === 'neon-wall');
    expect(neon).toHaveLength(barriers.length);
    for (const w of neon) {
      expect(w.maxY! - w.minY!, 'the collider brackets the road it stands on').toBeGreaterThan(VEHICLE.collisionRadius);
      // Low: a barrier, not a wall. It stops the car and nothing else reaches over it.
      expect(w.maxY! - w.minY!, 'and never reaches the deck fifteen metres up').toBeLessThan(VIADUCT_Y);
    }
  });
});

describe('the race inside the city', () => {
  it('is two laps of about 1.5 km, with corners and a highway', () => {
    expect(path.closed).toBe(true);
    expect(path.length).toBeGreaterThan(1400);
    expect(path.length).toBeLessThan(1700);
    expect(course.laps).toBe(CIRCUIT_LAPS);
    expect(CIRCUIT_LAPS).toBe(2);
    expect(path.pieces.filter((p) => p.kind === 'arc').length, 'corners').toBeGreaterThanOrEqual(14);
    // A street circuit is not a slalom: nothing sharper than a right angle anywhere.
    const sharpest = Math.max(...path.pieces.map((p) => (p.kind === 'arc' ? Math.abs(p.angle) : 0)));
    expect(sharpest).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
  });

  it('spreads six gates round the lap, in lap order from the line', () => {
    expect(course.gates).toHaveLength(CIRCUIT_GATES.length);
    const L = path.length;
    const from = (s: number): number => (((s - course.gates[0].s) % L) + L) % L;
    let last = 0;
    for (let i = 1; i < course.gates.length; i++) {
      const at = from(course.gates[i].s);
      expect(at, `gate ${i} comes after gate ${i - 1}`).toBeGreaterThan(last);
      expect(at - last, `gate ${i} is not on top of gate ${i - 1}`).toBeGreaterThan(L / 12);
      last = at;
    }
    expect(L - last, 'the last gate is not on top of the line').toBeGreaterThan(L / 12);
  });

  it('puts the whole grid on the asphalt and clear of everything', () => {
    expect(course.grid).toHaveLength(RACE.gridSlots);
    for (const [i, slot] of course.grid.entries()) {
      expect(roadAt(slot.x, slot.z, 0), `grid slot ${i} is on the road`).not.toBeNull();
      let nearest = Infinity;
      for (const c of layout.colliders) nearest = Math.min(nearest, distanceToBox(c, slot.x, slot.z));
      for (const w of layout.walls) nearest = Math.min(nearest, distanceToWall(w, slot.x, slot.z));
      expect(nearest, `grid slot ${i} has room`).toBeGreaterThan(VEHICLE.collisionRadius);
    }
    expect(layout.playerSpawn.x).toBeCloseTo(course.grid[0].x, 6);
  });
});

describe('the city instance the race is run in', () => {
  it('takes the street traffic and the buses out, and keeps the highway running one way', () => {
    expect(layout.busRoutes).toHaveLength(0);
    expect(layout.walls.some((w) => w.tag === 'bus'), 'no bus wall slots are left behind').toBe(false);
    const onDeck = layout.targetSpawns.filter((s) => (s.y ?? 0) > 5);
    expect(onDeck.length, 'the elevated highway is still busy').toBeGreaterThan(15);
    // Everything on the deck runs the way the lap does: the race shares that road.
    const lap = sense(path.samples.filter((_, i) => i % 4 === 0));
    for (let i = 0; i < layout.targetSpawns.length; i++) {
      if ((layout.targetSpawns[i].y ?? 0) <= 5) continue;
      expect(sense(layout.targetPatrols[i]), 'a car on the deck drives against the race').toBe(lap);
    }
  });

  it('puts cars on the lap, none of them on the grid', () => {
    const onLap = layout.targetSpawns.filter((s) => (s.y ?? 0) <= 5);
    expect(onLap.length).toBeGreaterThanOrEqual(5);
    for (const s of onLap) {
      let toGrid = Infinity;
      for (const g of course.grid) toGrid = Math.min(toGrid, Math.hypot(g.x - s.x, g.z - s.z));
      expect(toGrid, `a car spawned ${toGrid.toFixed(0)} m from the grid`).toBeGreaterThan(20);
    }
  });

  it('is the same world for the same seed and leaves the open-world city alone', () => {
    const a = createCircuitWorld(77);
    const b = createCircuitWorld(77);
    expect(a.layout.targetSpawns.map((s) => [s.x.toFixed(3), s.z.toFixed(3)])).toEqual(
      b.layout.targetSpawns.map((s) => [s.x.toFixed(3), s.z.toFixed(3)]),
    );
    const city = createCityWorld();
    expect(city.layout.race, 'the open world still has no race in it').toBeNull();
    expect(city.layout.busRoutes!.length, 'the open world still runs its buses').toBeGreaterThan(0);
    expect(city.plan.neonWalls, 'the open world has no barrier in it').toBeUndefined();
    expect(city.layout.walls.filter((w) => w.tag === 'bus')).toHaveLength(city.layout.busRoutes!.length * BUSES.perRoute * 4);
  });

  it('adds the circuit to the city without adding a draw call', () => {
    const draw = (p: typeof plan) => {
      const b = createBuilders(p);
      buildCity(b);
      buildProps(b);
      buildTransit(b);
      buildTrack(b);
      buildNeonWalls(b);
      buildLandmarks(b);
      buildReclamation(b);
      return builderStats(b);
    };
    const city = draw(createCityWorld().plan);
    const circuit = draw(plan);
    // A kerb unit, two hairlines and one glow panel per span, plus a chevron every 5.5 m.
    // `MARK_STEP` in `env/neonWalls.ts` is the number that trades density against this.
    expect(circuit.triangles - city.triangles, `barrier: ${circuit.triangles - city.triangles} triangles`).toBeLessThan(52000);
    expect(circuit.drawCalls, `circuit draw calls: ${circuit.drawCalls}`).toBeLessThanOrEqual(city.drawCalls);
  });
});

describe('a lap of the circuit', () => {
  /**
   * The autopilot is not a racing driver — it lifts for every corner and takes them all at the
   * same speed — so its time is a floor, not a target. What it proves is worth proving: that
   * the lap goes all the way round, that a car gets through every corner between the barriers,
   * up the ramp, over the bay and back down, and that the gates count it as a finished race.
   */
  it('can be driven start to finish without reversing out of anything', () => {
    const state = createInitialGameState(layout);
    for (const t of state.targets) {
      t.status = 'destroyed';
      t.hitTime = Number.POSITIVE_INFINITY;
    }
    const cmd = createPlayerCommand();
    const cruise = createCruiseController(layout.cruiseRoute);
    cruise.reset(state.vehicle);

    let reversedTicks = 0;
    let finishedAt = -1;
    const steps = Math.round(600 / SIM_STEP);
    for (let i = 0; i < steps && finishedAt < 0; i++) {
      cruise.step(state.vehicle, cmd, SIM_STEP);
      stepGame(state, cmd, layout, SIM_STEP);
      if (state.vehicle.speed < -0.1) reversedTicks++;
      if (state.race && state.race.phase === 'finished') finishedAt = state.race.finishTime;
    }

    expect(
      finishedAt,
      `the autopilot got to lap ${state.race?.lap} of ${course.laps}, gate ${state.race?.nextGate}, at (${state.vehicle.x.toFixed(0)}, ${state.vehicle.z.toFixed(0)})`,
    ).toBeGreaterThan(0);
    expect(reversedTicks * SIM_STEP, 'never had to back out of a corner').toBeLessThan(3);
  });
});
