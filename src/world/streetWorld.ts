import type { ObstacleWall, RaceCourse, RaceGate, RaceShortcut, SpawnPoint, SurfaceSample } from '../core/types';
import { BUSES, STREET_RACE } from '../config/tuning';
import type { NeonWallDef } from './cityPlan';
import type { World } from './arenaWorld';
import { createCityWorld } from './cityWorld';
import { createRandom } from './cityGen';
import { QUAY_COURSE, STREET_LAPS, type StreetCourseSpec } from './streetSpec';
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
function barrierRanges(path: TrackPath, course: StreetCourseSpec): Array<{ from: number; to: number; side: number }> {
  const L = path.length;
  const ranges: Array<{ from: number; to: number; side: number }> = [];
  // The arcs: `pieces` are in station order, so their stations accumulate.
  let s = 0;
  for (const piece of path.pieces) {
    if (piece.kind === 'arc') {
      const lead = course.barriers.corners.lead;
      ranges.push({ from: s - lead, to: s + piece.length + lead, side: -1 });
      ranges.push({ from: s - lead, to: s + piece.length + lead, side: 1 });
    }
    s += piece.length;
  }
  const proj = createProjection();
  for (const span of course.barriers.spans) {
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

/**
 * Whether a barrier piece on `side` at station `s`, midpoint (x, z), would stand across a shortcut:
 * within the gap left at a mouth on the side the course says it opens, or anywhere on a
 * shortcut's own ribbon (a branch that goes straight on where the lap turns crosses the corner's
 * outer barrier well away from its mouth station).
 */
function inMouth(shortcuts: RaceShortcut[], mouths: StreetCourseSpec['mouths'], L: number, s: number, side: number, x: number, z: number): boolean {
  const proj = MOUTH_PROJ;
  for (let i = 0; i < shortcuts.length; i++) {
    const sc = shortcuts[i];
    const m = mouths[i] ?? { in: -1, out: -1 };
    for (const [station, open] of [
      [sc.sIn, m.in],
      [sc.sOut, m.out],
    ] as const) {
      if (side !== open) continue;
      let d = Math.abs(s - station);
      d = Math.min(d, L - d);
      if (d <= MOUTH_GAP) return true;
    }
    projectOntoPath(sc.path, x, z, proj);
    if (proj.dist <= proj.halfWidth + 0.5) return true;
  }
  return false;
}
const MOUTH_PROJ = createProjection();

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
  const segs = segmentCount(path);
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

  const probe: SurfaceSample = { y: 0, gx: 0, gz: 0 };
  const roadY = (x: number, z: number, hint: number): number => {
    if (!layout.surface) return 0;
    layout.surface.sample(x, z, hint, probe);
    return probe.y;
  };

  const ranges = barrierRanges(path, courseSpec);
  const neonWalls: NeonWallDef[] = [];
  if (courseSpec.fence === 'full') {
    layFullFence(path, shortcuts, roadY, neonWalls);
  } else for (const side of [-1, 1]) {
    for (let i = 0; i < segs; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % samples.length];
      const mid = (a.s + (i + 1 < samples.length ? b.s : L)) / 2;
      const ax = a.x + -a.tz * a.halfWidth * side;
      const az = a.z + a.tx * a.halfWidth * side;
      const bx = b.x + -b.tz * b.halfWidth * side;
      const bz = b.z + b.tx * b.halfWidth * side;
      if (!barrierAt(ranges, L, mid, side) || inMouth(shortcuts, courseSpec.mouths, L, mid, side, (ax + bx) / 2, (az + bz) / 2)) continue;
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

/** Pieces a fence edge is cut into to decide where it stands (m): the widest gap it can leave. */
const FENCE_PIECE = 0.75;
/** How far inside another ribbon an edge has to be before it gives way to it (m). */
const FENCE_GIVE = 0.3;

/**
 * THE CLOSED FENCE: both edges of the lap and of every branch, all the way round, so there is
 * nowhere off the course to drive. An edge stands wherever it is not ON another ribbon of the
 * course at its own height, which is exactly what opens a mouth: the lap's edge gives way where
 * a branch crosses it, and a branch's edges give way while they are still inside the lap.
 *
 * Each sample-to-sample edge is judged in short pieces and the pieces that stand are laid as
 * runs, so a mouth is as wide as the branch and no wider, and a straight stays one wall.
 */
function layFullFence(
  path: TrackPath,
  shortcuts: RaceShortcut[],
  roadY: (x: number, z: number, hint: number) => number,
  out: NeonWallDef[],
): void {
  const ribbons: TrackPath[] = [path, ...shortcuts.map((sc) => sc.path)];
  const proj = createProjection();
  // The lap's edge opens a little wide of a branch; a branch's edge stays until well inside the lap.
  const onOther = (self: number, x: number, z: number, y: number): boolean => {
    for (let r = 0; r < ribbons.length; r++) {
      if (r === self) continue;
      projectOntoPath(ribbons[r], x, z, proj, -1, 12, y);
      // Past the open end of a branch is not on it: the projection clamps to the end sample.
      if (!ribbons[r].closed && (proj.s <= 0.01 || proj.s >= ribbons[r].length - 0.01)) continue;
      const give = self === 0 ? -FENCE_GIVE : FENCE_GIVE;
      if (proj.dist < proj.halfWidth - give && Math.abs(proj.y - y) < 3) return true;
    }
    return false;
  };
  for (let r = 0; r < ribbons.length; r++) {
    const p = ribbons[r];
    const n = segmentCount(p);
    for (const side of [-1, 1]) {
      for (let i = 0; i < n; i++) {
        const a = p.samples[i];
        const b = p.samples[(i + 1) % p.samples.length];
        const ax = a.x + -a.tz * a.halfWidth * side;
        const az = a.z + a.tx * a.halfWidth * side;
        const bx = b.x + -b.tz * b.halfWidth * side;
        const bz = b.z + b.tx * b.halfWidth * side;
        const pieces = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / FENCE_PIECE));
        let runFrom = -1;
        const flush = (to: number): void => {
          if (runFrom < 0) return;
          // A run cut short by a mouth reaches half a piece past its last standing piece, so the
          // lap's fence and the branch's meet with an overlap rather than a seam.
          const t0 = runFrom > 0 ? (runFrom - 0.5) / pieces : 0;
          const t1 = to < pieces ? (to + 0.5) / pieces : 1;
          const x0 = ax + (bx - ax) * t0;
          const z0 = az + (bz - az) * t0;
          const x1 = ax + (bx - ax) * t1;
          const z1 = az + (bz - az) * t1;
          out.push({
            ax: x0,
            az: z0,
            ay: roadY(x0, z0, a.y + (b.y - a.y) * t0),
            bx: x1,
            bz: z1,
            by: roadY(x1, z1, a.y + (b.y - a.y) * t1),
            nx: -side * -a.tz,
            nz: -side * a.tx,
            side,
            curvature: a.curvature,
            zone: a.zone,
          });
          runFrom = -1;
        };
        for (let k = 0; k < pieces; k++) {
          const t = (k + 0.5) / pieces;
          const stands = !onOther(r, ax + (bx - ax) * t, az + (bz - az) * t, a.y + (b.y - a.y) * t);
          if (stands && runFrom < 0) runFrom = k;
          if (!stands) flush(k);
        }
        flush(pieces);
      }
    }
  }
}
