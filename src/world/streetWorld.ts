import type { ObstacleWall, RaceCourse, RaceGate, RaceShortcut, SpawnPoint } from '../core/types';
import { BUSES, STREET_RACE } from '../config/tuning';
import type { World } from './arenaWorld';
import { createCityWorld } from './cityWorld';
import { createRandom } from './cityGen';
import { QUAY_COURSE, STREET_LAPS, type StreetCourseSpec } from './streetSpec';
import { layRaceBarriers } from './raceBarriers';
import { buildTrackPath, createProjection, offsetAtStation, projectOntoPath, type TrackPath } from './track';

/**
 * THE QUAY CIRCUIT ("STREET RACE"): the open world with the second race drawn inside it.
 *
 * The same construction as `circuitWorld.ts` — `createCityWorld()` is called unchanged, and
 * nothing in `citySpec.ts` or `cityWorld.ts` knows this file exists — with three differences:
 *
 *  - THE BARRIER stands only where the city would let a car off the course — the mouths of
 *    side streets, open ground, a ramp off a deck — and the blocks and guardrails hold the
 *    rest (`raceBarriers.ts`). Branch mouths stay open; a flood proves nothing else is.
 *  - THE SHORTCUTS are real branches. Two alleys carry their own centrelines
 *    (`RaceCourse.shortcuts`) and a BRANCH GATE each — one checkpoint with a segment across the
 *    main road and another across the alley (`RaceGate.alt`), so either route validates and
 *    neither can be skipped.
 *  - THE GRID is four slots: the player and up to three rivals.
 *
 * Street traffic and buses come out as they do for the versus circuit (neither steers round
 * anything); the viaduct keeps its traffic — the lap never goes near it — and a few electric
 * cars patrol the lap itself as targets. Everything else is the city's, untouched.
 */

const PATROL_LANE = 2.8;
const TRAFFIC_CLEAR_BEHIND = 60;
const TRAFFIC_CLEAR_AHEAD = 90;
const TRAFFIC_JITTER = 0.4;
const VIADUCT_FLOOR = 5;

export const STREET_RACE_LAPS = STREET_LAPS;

export function createStreetWorld(seed: number = (Math.random() * 0xffffffff) >>> 0): World {
  return layStreetCourse(createCityWorld(), QUAY_COURSE, seed);
}

/**
 * Lay a Street Race course over a freshly built city: the barrier, the branches, the gates, the
 * grid, the lap's own traffic, and every free-world activity taken off. Shared by the Quay
 * Circuit (above) and La Curva (`curvaWorld.ts`).
 */
export function layStreetCourse(world: World, courseSpec: StreetCourseSpec, seed: number = (Math.random() * 0xffffffff) >>> 0): World {
  const { layout, plan } = world;
  const path = buildTrackPath(courseSpec.spec);
  const samples = path.samples;
  const L = path.length;

  /* ---------------------------------------------------------- the shortcuts */

  const shortcuts: RaceShortcut[] = courseSpec.shortcuts.map((spec) => {
    const alley = buildTrackPath(spec);
    const first = alley.samples[0];
    const last = alley.samples[alley.samples.length - 1];
    const sIn = projectOntoPath(path, first.x, first.z, createProjection(), -1, 12, first.y).s;
    const sOut = projectOntoPath(path, last.x, last.z, createProjection(), -1, 12, last.y).s;
    return { path: alley, sIn, sOut };
  });

  /* ---------------------------------------------------------- the barrier */

  const busCount = (layout.busRoutes ?? []).length * BUSES.perRoute;
  const walls: ObstacleWall[] = busCount > 0 ? layout.walls.slice(0, layout.walls.length - busCount * 4) : [...layout.walls];
  const neonWalls = layRaceBarriers(world, [path, ...shortcuts.map((sc) => sc.path)], walls);

  /* ---------------------------------------------------------- the race */

  const g0 = courseSpec.gates[0];
  const line = projectOntoPath(path, g0.x, g0.z, createProjection(), -1, 12, g0.y ?? 0);
  const segmentAt = (p: TrackPath, x: number, z: number, pad: number, y = 0): RaceGate => {
    const q = projectOntoPath(p, x, z, createProjection(), -1, 12, y);
    const hw = q.halfWidth + pad;
    return {
      ax: q.x + -q.tz * -hw,
      az: q.z + q.tx * -hw,
      bx: q.x + -q.tz * hw,
      bz: q.z + q.tx * hw,
      fx: q.tx,
      fz: q.tz,
      s: q.s,
    };
  };
  /** The height each gate was laid at, for its arch (`RaceGate` itself is flat). */
  const gateY = new Map<RaceGate, number>();
  const gates: RaceGate[] = courseSpec.gates.map((g) => {
    const gate = segmentAt(path, g.x, g.z, 1.5, g.y ?? 0);
    gateY.set(gate, g.y ?? 0);
    if (g.alt) {
      const alt = segmentAt(shortcuts[g.alt.shortcut].path, g.alt.x, g.alt.z, 1.5, g.alt.y ?? 0);
      gate.alt = { ax: alt.ax, az: alt.az, bx: alt.bx, bz: alt.bz, fx: alt.fx, fz: alt.fz };
    }
    return gate;
  });
  const lapOrder = (s: number): number => (((s - line.s) % L) + L) % L;
  const rest = gates.slice(1).sort((a, b) => lapOrder(a.s) - lapOrder(b.s));
  gates.splice(1, gates.length - 1, ...rest);

  const grid: SpawnPoint[] = [];
  const gridFirstRow = 8;
  const gridRowGap = 6;
  const gridLateral = 3.2;
  for (let i = 0; i < STREET_RACE.gridSlots; i++) {
    const row = Math.floor(i / 2);
    const lateral = (i % 2 === 0 ? -1 : 1) * gridLateral;
    const p = offsetAtStation(path, line.s - gridFirstRow - row * gridRowGap, lateral);
    grid.push({ x: p.x, z: p.z, ...(p.y !== 0 ? { y: p.y } : {}), heading: Math.atan2(p.tx, -p.tz) });
  }

  const course: RaceCourse = { laps: courseSpec.laps, gates, grid, path, shortcuts };

  /* ---------------------------------------------------------- traffic */

  const targetSpawns: SpawnPoint[] = [];
  const targetPatrols: Array<Array<{ x: number; z: number }>> = [];
  for (let i = 0; i < layout.targetSpawns.length && courseSpec.keepDeckTraffic !== false; i++) {
    const s = layout.targetSpawns[i];
    const patrol = layout.targetPatrols[i];
    if ((s.y ?? 0) < VIADUCT_FLOOR || !patrol || patrol.length < 3) continue;
    targetSpawns.push(s);
    targetPatrols.push(patrol);
  }
  const laneWaypoints = (lateral: number): Array<{ x: number; z: number }> => {
    const out: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < samples.length; i += 3) {
      const s = samples[i];
      out.push({ x: s.x + -s.tz * lateral, z: s.z + s.tx * lateral });
    }
    return out;
  };
  const random = createRandom(seed);
  const count = courseSpec.traffic ?? STREET_RACE.trafficCount;
  const usable = Math.max(1, L - TRAFFIC_CLEAR_AHEAD - TRAFFIC_CLEAR_BEHIND);
  const slot = usable / Math.max(1, count);
  for (let i = 0; i < count; i++) {
    const lateral = (random() < 0.5 ? 1 : -1) * PATROL_LANE;
    const loop = laneWaypoints(lateral);
    const jitter = (random() * 2 - 1) * TRAFFIC_JITTER * slot;
    const startStation = (line.s + TRAFFIC_CLEAR_AHEAD + (i + 0.5) * slot + jitter + L) % L;
    const start = Math.min(loop.length - 1, Math.floor((startStation / L) * loop.length));
    const rotated = [...loop.slice(start), ...loop.slice(0, start)];
    const s = samples[Math.min(samples.length - 1, start * 3)];
    targetSpawns.push({ x: rotated[0].x, z: rotated[0].z, y: s.y, heading: Math.atan2(s.tx, -s.tz) });
    targetPatrols.push(rotated);
  }

  const cruiseRoute: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < samples.length; i += 4) cruiseRoute.push({ x: samples[i].x, z: samples[i].z });

  /* ---------------------------------------------------------- layout */

  layout.walls = walls;
  layout.busRoutes = [];
  layout.targetSpawns = targetSpawns;
  layout.targetPatrols = targetPatrols;
  layout.cruiseRoute = cruiseRoute;
  layout.playerSpawn = { ...grid[0] };
  layout.race = course;
  // THE RACE IS JUST THE RACE: the city's activities come off at the source, as they do for
  // the versus circuit (`circuitWorld.ts`), the Street Race rings included.
  layout.rushSites = null;
  layout.passengerStops = null;
  layout.buhoSite = null;
  layout.garageSite = null;
  layout.circuitSite = null;
  layout.streetSites = null;
  // The minimap draws the race and its alleys, not the city it is cut out of.
  layout.minimap = {
    ...layout.minimap,
    rects: [],
    ribbons: [
      {
        points: samples.map((s) => ({ x: s.x, z: s.z })),
        width: samples.reduce((sum, s) => sum + s.halfWidth * 2, 0) / samples.length,
        closed: true,
        hidden: false,
      },
      ...shortcuts.map((sc) => ({
        points: sc.path.samples.map((s) => ({ x: s.x, z: s.z })),
        width: sc.path.samples.reduce((sum, s) => sum + s.halfWidth * 2, 0) / sc.path.samples.length,
        closed: false,
        hidden: false,
      })),
    ],
  };

  /* ---------------------------------------------------------- plan */

  plan.neonWalls = neonWalls;
  plan.rushMarkers = null;
  plan.circuitMarker = null;
  plan.streetMarkers = null;
  plan.startLine = lineDef(line);
  plan.checkpoints = gates.slice(1).map((g) => {
    const p = projectOntoPath(path, (g.ax + g.bx) / 2, (g.az + g.bz) / 2, createProjection(), -1, 12, gateY.get(g) ?? 0);
    return lineDef(p);
  });

  return world;
}

function lineDef(p: { x: number; z: number; y: number; tx: number; tz: number; halfWidth: number }): {
  x: number;
  z: number;
  y?: number;
  tx: number;
  tz: number;
  halfWidth: number;
} {
  return { x: p.x, z: p.z, ...(p.y > 1 ? { y: p.y } : {}), tx: p.tx, tz: p.tz, halfWidth: p.halfWidth };
}
