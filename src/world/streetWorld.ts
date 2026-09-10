import type { ObstacleWall, RaceCourse, RaceGate, RaceShortcut, SpawnPoint, SurfaceSample } from '../core/types';
import { BUSES, STREET_RACE } from '../config/tuning';
import type { NeonWallDef } from './cityPlan';
import type { World } from './arenaWorld';
import { createCityWorld } from './cityWorld';
import { createRandom } from './cityGen';
import { STREET_BARRIERS, STREET_GATES, STREET_LAPS, STREET_SHORTCUTS, STREET_SPEC } from './streetSpec';
import { buildTrackPath, createProjection, offsetAtStation, projectOntoPath, segmentCount, type TrackPath } from './track';

/**
 * THE QUAY CIRCUIT ("STREET RACE"): the open world with the second race drawn inside it.
 *
 * The same construction as `circuitWorld.ts` — `createCityWorld()` is called unchanged, and
 * nothing in `citySpec.ts` or `cityWorld.ts` knows this file exists — with three differences:
 *
 *  - THE BARRIER is not continuous. It stands at every corner and at the mouths and framings
 *    `streetSpec.ts` names, and nowhere else: this is a race through the city, not a course
 *    fenced off from it. Same kerb units, same colliders, same builder (`env/neonWalls.ts`).
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

const BARRIER_HEIGHT = 2.2;
const BARRIER_DROP = 3.2;
const PATROL_LANE = 2.8;
const TRAFFIC_CLEAR_BEHIND = 60;
const TRAFFIC_CLEAR_AHEAD = 90;
const TRAFFIC_JITTER = 0.4;
const VIADUCT_FLOOR = 5;

export const STREET_RACE_LAPS = STREET_LAPS;

/** Where the shortcut mouths are on the lap, and how wide a gap the barrier leaves for each (m). */
const MOUTH_GAP = 5.5;

/**
 * The stations along the lap the barrier stands on, one side at a time: every fillet arc
 * extended by `lead`, plus the explicit spans, less a gap at every shortcut mouth.
 */
function barrierRanges(path: TrackPath): Array<{ from: number; to: number; side: number }> {
  const L = path.length;
  const ranges: Array<{ from: number; to: number; side: number }> = [];
  // The arcs: `pieces` are in station order, so their stations accumulate.
  let s = 0;
  for (const piece of path.pieces) {
    if (piece.kind === 'arc') {
      const lead = STREET_BARRIERS.corners.lead;
      ranges.push({ from: s - lead, to: s + piece.length + lead, side: -1 });
      ranges.push({ from: s - lead, to: s + piece.length + lead, side: 1 });
    }
    s += piece.length;
  }
  const proj = createProjection();
  for (const span of STREET_BARRIERS.spans) {
    const a = projectOntoPath(path, span.a.x, span.a.z, proj).s;
    const b = projectOntoPath(path, span.b.x, span.b.z, proj).s;
    let from = Math.min(a, b);
    let to = Math.max(a, b);
    // A span across the line wraps; written as two.
    if (to - from > L / 2) {
      ranges.push({ from: to, to: L + from, side: span.side });
    } else {
      ranges.push({ from, to, side: span.side });
    }
  }
  return ranges;
}

/** Whether station `s` (mod L) falls inside any of the ranges for `side`. */
function barrierAt(ranges: ReadonlyArray<{ from: number; to: number; side: number }>, L: number, s: number, side: number): boolean {
  for (const r of ranges) {
    if (r.side !== side) continue;
    for (const w of [-L, 0, L]) {
      const t = s + w;
      if (t >= r.from && t <= r.to) return true;
    }
  }
  return false;
}

/** Whether station `s` is within the gap left for a shortcut mouth on `side`. */
function inMouth(shortcuts: RaceShortcut[], L: number, s: number, side: number): boolean {
  // Both alleys leave and rejoin on the LEFT of the direction of travel (`streetSpec.ts`).
  if (side !== -1) return false;
  for (const sc of shortcuts) {
    for (const m of [sc.sIn, sc.sOut]) {
      let d = Math.abs(s - m);
      d = Math.min(d, L - d);
      if (d <= MOUTH_GAP) return true;
    }
  }
  return false;
}

export function createStreetWorld(seed: number = (Math.random() * 0xffffffff) >>> 0): World {
  const { layout, plan } = createCityWorld();
  const path = buildTrackPath(STREET_SPEC);
  const samples = path.samples;
  const segs = segmentCount(path);
  const L = path.length;

  /* ---------------------------------------------------------- the shortcuts */

  const shortcuts: RaceShortcut[] = STREET_SHORTCUTS.map((spec) => {
    const alley = buildTrackPath(spec);
    const first = alley.samples[0];
    const last = alley.samples[alley.samples.length - 1];
    const sIn = projectOntoPath(path, first.x, first.z, createProjection()).s;
    const sOut = projectOntoPath(path, last.x, last.z, createProjection()).s;
    return { path: alley, sIn, sOut };
  });

  /* ---------------------------------------------------------- the barrier */

  const probe: SurfaceSample = { y: 0, gx: 0, gz: 0 };
  const roadY = (x: number, z: number, hint: number): number => {
    if (!layout.surface) return 0;
    layout.surface.sample(x, z, hint, probe);
    return probe.y;
  };

  const ranges = barrierRanges(path);
  const neonWalls: NeonWallDef[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < segs; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % samples.length];
      const mid = (a.s + (i + 1 < samples.length ? b.s : L)) / 2;
      if (!barrierAt(ranges, L, mid, side) || inMouth(shortcuts, L, mid, side)) continue;
      const ax = a.x + -a.tz * a.halfWidth * side;
      const az = a.z + a.tx * a.halfWidth * side;
      const bx = b.x + -b.tz * b.halfWidth * side;
      const bz = b.z + b.tx * b.halfWidth * side;
      neonWalls.push({
        ax,
        az,
        ay: roadY(ax, az, a.y),
        bx,
        bz,
        by: roadY(bx, bz, b.y),
        nx: -side * -a.tz,
        nz: -side * a.tx,
        side,
        curvature: a.curvature,
        zone: a.zone,
      });
    }
  }

  const busCount = (layout.busRoutes ?? []).length * BUSES.perRoute;
  const walls: ObstacleWall[] = busCount > 0 ? layout.walls.slice(0, layout.walls.length - busCount * 4) : [...layout.walls];
  for (const w of neonWalls) {
    const lo = Math.min(w.ay, w.by);
    const hi = Math.max(w.ay, w.by);
    walls.push({ ax: w.ax, az: w.az, bx: w.bx, bz: w.bz, minY: lo - BARRIER_DROP, maxY: hi + BARRIER_HEIGHT, tag: 'neon-wall' });
  }

  /* ---------------------------------------------------------- the race */

  const line = projectOntoPath(path, STREET_GATES[0].x, STREET_GATES[0].z, createProjection());
  const segmentAt = (p: TrackPath, x: number, z: number, pad: number): RaceGate => {
    const q = projectOntoPath(p, x, z, createProjection());
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
  const gates: RaceGate[] = STREET_GATES.map((g) => {
    const gate = segmentAt(path, g.x, g.z, 1.5);
    if (g.alt) {
      const alt = segmentAt(shortcuts[g.alt.shortcut].path, g.alt.x, g.alt.z, 1.5);
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
    grid.push({ x: p.x, z: p.z, heading: Math.atan2(p.tx, -p.tz) });
  }

  const course: RaceCourse = { laps: STREET_LAPS, gates, grid, path, shortcuts };

  /* ---------------------------------------------------------- traffic */

  const targetSpawns: SpawnPoint[] = [];
  const targetPatrols: Array<Array<{ x: number; z: number }>> = [];
  for (let i = 0; i < layout.targetSpawns.length; i++) {
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
  const count = STREET_RACE.trafficCount;
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
        width: 7,
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
    const p = projectOntoPath(path, (g.ax + g.bx) / 2, (g.az + g.bz) / 2, createProjection());
    return lineDef(p);
  });

  return { layout, plan };
}

function lineDef(p: { x: number; z: number; tx: number; tz: number; halfWidth: number }): {
  x: number;
  z: number;
  tx: number;
  tz: number;
  halfWidth: number;
} {
  return { x: p.x, z: p.z, tx: p.tx, tz: p.tz, halfWidth: p.halfWidth };
}
