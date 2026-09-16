import type { ObstacleBox, ObstacleWall, SurfaceField, SurfaceSample } from '../core/types';
import type { World } from './arenaWorld';
import type { NeonWallDef } from './cityPlan';
import { createProjection, pointAtStation, projectOntoPath, segmentCount, type TrackPath } from './track';

/**
 * WHERE A STREET RACE NEEDS A BARRIER, and nowhere else.
 *
 * A race laid over the city (`circuitWorld.ts`, `streetWorld.ts`) used to fence its whole
 * ribbon. Most of that fence stood in front of something that already holds a car: a row of
 * buildings, a viaduct's guardrail. The way the Need for Speed street races do it is to close
 * only the openings — the mouth of a side street, the gap between two blocks, a ramp peeling
 * off the deck — corner to corner, and let the city be the rest of the track's edge.
 *
 * So the barrier is worked out, not drawn:
 *
 *  1. PROBES. Every half metre of both edges of every ribbon of the course (the lap and its
 *     branches), a probe walks straight out from the edge at the road's height. It stops at
 *     the first thing that holds a car (a building, a megastructure's foot, a guardrail, the
 *     quay) — HELD, at that depth — or at another ribbon of the course (a branch mouth: the
 *     course goes on there), or where the deck under it ends, or at its reach: OPEN.
 *  2. RUNS. Each run of stations that are not held gets a barrier, laid from the last hold
 *     before it to the first hold after it at depths interpolated along the station — which on
 *     a straight is the line from one block's corner to the next across a side street, and on
 *     the outside of a corner is a sweep across the junction. Its ends tuck back along the
 *     facade, so a barrier meets the building rather than stopping short of it.
 *  3. PROOF. A probe can be fooled (a gap behind a building it hit), so the plan is flooded:
 *     a car-sized search from the ribbon through everything that is not a hold or a barrier,
 *     at the height of whatever it is standing on. Wherever it gets well away from the course,
 *     or finds a way from one stretch of the lap to another far further along it (a SHORTCUT),
 *     the stations it slipped out past are opened up and the barrier is laid again, until the
 *     flood stays in. What is left over, if anything, is reported (`leaks`) for the tests.
 *  4. PRUNE. A span with nothing but a closed pocket behind it (a recess, a yard, the gap inside
 *     a tight corner) holds nothing in. Those come off, and the flood proves the course is still
 *     shut; any it needed after all go back up.
 *
 * Only big, continuous things count as a hold: a column, a bus shelter, a parked car or a
 * fuel island can be driven round, so a probe goes straight past them and so does the flood.
 */

/** How far a probe looks for a hold from a street's edge, and from a deck's (m). */
const REACH_GROUND = 18;
const REACH_DECK = 6;
/** Station step along each edge, and a probe's stride (m). */
const STEP = 0.5;
const STRIDE = 0.25;
/** Height band a car's body occupies above the road it stands on (m). */
const BODY_LO = 0.2;
const BODY_HI = 1.2;
/** A course sample above this is on a deck or a ramp, and its probe uses the deck's reach (m). */
const DECK_FLOOR = 1.5;
/** A hold narrower than this, with openings either side, is something to drive round (m). */
const MIN_HOLD = 4;
/** Where a run has no hold at either end: the ribbon's own edge, a little out (m). */
const EDGE_DEPTH = 0.4;
/** How far past a deck's end (as the surface field pads it) the barrier stays back (m). */
const DECK_PAD = 1.8;
/**
 * Where two ribbons of the course meet, one edge gives way to the other. A branch defers to the
 * lap (and a later branch to an earlier one): its edge and its probes count as on the lap from
 * a little outside it, so where the two run edge to edge only the lap's edge stands. The lap
 * gives way only where it is properly inside a branch — at a mouth (m, past the other's edge).
 */
const DEFER_EDGE = 0.3;
const DEFER_PROBE = EDGE_DEPTH + 0.1;
const YIELD_EDGE = -0.6;
const YIELD_PROBE = -0.3;
/** A probe that meets its own ribbon more than this far along it has found a hairpin, not itself (m). */
const SELF_NEAR = 30;
/**
 * A run up to this long with a hold at both ends is bridged straight across, corner to corner
 * (m). A longer one — an open lot, the open ground under a viaduct — comes in to the ribbon's
 * edge over `EASE` from each hold and follows it, rather than standing out in the open.
 */
const BRIDGE = 45;
const EASE = 12;

/**
 * Flood grid resolution when a world is built, and when a test asks (m), and the car's reach into
 * it. Coarse at load, where it has to be quick and small; fine in the tests, which hold the
 * shipped courses to the stricter answer.
 */
const RES = 1;
export const PROOF_RES = 0.5;
/**
 * The narrowest opening a car gets through (m): the simulation's car is a circle of 1.1 m. The
 * holds are grown so that, at whatever resolution, no opening this wide reads as closed; a
 * slightly narrower one may read as open, which only ever costs a little more barrier.
 */
const CAR_GAP = 2.2;
/** How far from the course the flood may get before it has escaped (m). */
const ESCAPE = REACH_GROUND + 5;
/**
 * A way between two stretches of the course that is this much shorter than the course itself is
 * a shortcut, and is closed like a way out (m). The inside of an ordinary corner never saves this.
 */
const SHORTCUT = 30;
/** Barrier passes before giving up on a leak (each pass opens the stations a leak slipped past). */
const MAX_PASSES = 24;

const HELD = 0;
const OPEN = 1;
const VOID = 2;
const COURSE = 3;

export interface RaceBarrierInput {
  /** The course: the lap first, then its branches. */
  ribbons: readonly TrackPath[];
  colliders: readonly ObstacleBox[];
  walls: readonly ObstacleWall[];
  surface: SurfaceField | null;
  /** The city's elevated roads, so the flood knows where a surface other than the ground can be. */
  decks: readonly TrackPath[];
  /** Height of the drivable surface at (x, z), nearest `hint`. */
  roadY: (x: number, z: number, hint: number) => number;
}

export interface RaceBarrierPlan {
  walls: NeonWallDef[];
  /** Ways out the flood still found after every pass: empty on a shipped course. */
  leaks: BarrierLeak[];
  passes: number;
}

/** Walls whose tag makes them a continuous edge a car cannot get round. */
const HOLDING_WALLS = new Set(['rail', 'wall', 'quay', 'meet-hoarding', 'meet-fence', 'meet-barrier', 'gas-wall']);

function holdsCar(box: ObstacleBox): boolean {
  const w = box.maxX - box.minX;
  const d = box.maxZ - box.minZ;
  return Math.min(w, d) >= 3 && Math.max(w, d) >= 6;
}

/* ------------------------------------------------------------------ obstacle index */

interface Holds {
  boxes: ObstacleBox[];
  walls: ObstacleWall[];
  cell: number;
  minX: number;
  minZ: number;
  nx: number;
  nz: number;
  boxCells: number[][];
  wallCells: number[][];
}

function indexHolds(boxes: ObstacleBox[], walls: ObstacleWall[], minX: number, minZ: number, maxX: number, maxZ: number): Holds {
  const cell = 8;
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / cell));
  const boxCells: number[][] = Array.from({ length: nx * nz }, () => []);
  const wallCells: number[][] = Array.from({ length: nx * nz }, () => []);
  const file = (lists: number[][], i: number, x0: number, z0: number, x1: number, z1: number): void => {
    const c0 = Math.max(0, Math.floor((x0 - minX) / cell));
    const c1 = Math.min(nx - 1, Math.floor((x1 - minX) / cell));
    const r0 = Math.max(0, Math.floor((z0 - minZ) / cell));
    const r1 = Math.min(nz - 1, Math.floor((z1 - minZ) / cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) lists[r * nx + c].push(i);
  };
  boxes.forEach((b, i) => file(boxCells, i, b.minX, b.minZ, b.maxX, b.maxZ));
  walls.forEach((w, i) => file(wallCells, i, Math.min(w.ax, w.bx), Math.min(w.az, w.bz), Math.max(w.ax, w.bx), Math.max(w.az, w.bz)));
  return { boxes, walls, cell, minX, minZ, nx, nz, boxCells, wallCells };
}

function atLevel(minY: number | undefined, maxY: number | undefined, y: number): boolean {
  return (minY ?? -Infinity) < y + BODY_HI && (maxY ?? Infinity) > y + BODY_LO;
}

function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1x = bx - ax;
  const d1z = bz - az;
  const d2x = dx - cx;
  const d2z = dz - cz;
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((cx - ax) * d2z - (cz - az) * d2x) / den;
  const u = ((cx - ax) * d1z - (cz - az) * d1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Whether moving from (ax, az) to (bx, bz) at height y runs into a hold. */
function blocked(h: Holds, ax: number, az: number, bx: number, bz: number, y: number): boolean {
  const c = Math.floor((bx - h.minX) / h.cell);
  const r = Math.floor((bz - h.minZ) / h.cell);
  if (c < 0 || r < 0 || c >= h.nx || r >= h.nz) return false;
  const k = r * h.nx + c;
  for (const i of h.boxCells[k]) {
    const b = h.boxes[i];
    if (bx >= b.minX && bx <= b.maxX && bz >= b.minZ && bz <= b.maxZ && atLevel(b.minY, b.maxY, y)) return true;
  }
  for (const i of h.wallCells[k]) {
    const w = h.walls[i];
    if (atLevel(w.minY, w.maxY, y) && segmentsCross(ax, az, bx, bz, w.ax, w.az, w.bx, w.bz)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ the course, as a lookup */

interface CourseHit {
  r: number;
  s: number;
  lateral: number;
  dist: number;
  halfWidth: number;
  y: number;
}

/**
 * The ribbon of the course (x, z) at height y is on, grown by `pad(r)` for ribbon r, nearest
 * edge first. Ribbon `self` is skipped within `near` metres of station `s0`.
 */
type CourseLookup = (x: number, z: number, y: number, pad: (r: number) => number, out: CourseHit, self?: number, s0?: number, near?: number) => boolean;

function createCourseLookup(ribbons: readonly TrackPath[]): CourseLookup {
  const proj = createProjection();
  // Every segment filed, grown by its ribbon's half width and the largest pad asked for, in the
  // cells of a coarse grid: a probe measures only the segments of its own cell.
  const CELL = 8;
  const REACH = 3;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of ribbons) {
    for (const s of p.samples) {
      minX = Math.min(minX, s.x - s.halfWidth - REACH);
      maxX = Math.max(maxX, s.x + s.halfWidth + REACH);
      minZ = Math.min(minZ, s.z - s.halfWidth - REACH);
      maxZ = Math.max(maxZ, s.z + s.halfWidth + REACH);
    }
  }
  const nx = Math.max(1, Math.ceil((maxX - minX) / CELL));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / CELL));
  const cells: number[][] = Array.from({ length: nx * nz }, () => []);
  ribbons.forEach((p, r) => {
    const segs = segmentCount(p);
    for (let i = 0; i < segs; i++) {
      const a = p.samples[i];
      const b = p.samples[(i + 1) % p.samples.length];
      const g = Math.max(a.halfWidth, b.halfWidth) + REACH;
      const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - g - minX) / CELL));
      const c1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x) + g - minX) / CELL));
      const r0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - g - minZ) / CELL));
      const r1 = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z) + g - minZ) / CELL));
      for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) cells[row * nx + col].push(r, i);
    }
  });
  return (x, z, y, pad, out, self = -1, s0 = 0, near = 0) => {
    const col = Math.floor((x - minX) / CELL);
    const row = Math.floor((z - minZ) / CELL);
    if (col < 0 || row < 0 || col >= nx || row >= nz) return false;
    const list = cells[row * nx + col];
    let found = false;
    let best = Infinity;
    for (let k = 0; k < list.length; k += 2) {
      const r = list[k];
      const p = ribbons[r];
      projectOntoPath(p, x, z, proj, list[k + 1], 0, y);
      if (Math.abs(proj.y - y) > 3) continue;
      // Past the open end of a branch is not on it: the projection clamps to the end sample.
      if (!p.closed && (proj.s <= 0.01 || proj.s >= p.length - 0.01)) continue;
      const over = proj.dist - proj.halfWidth;
      if (over > pad(r) || over >= best) continue;
      if (r === self) {
        let ds = Math.abs(proj.s - s0);
        if (p.closed) ds = Math.min(ds, p.length - ds);
        if (ds <= near) continue;
      }
      best = over;
      found = true;
      out.r = r;
      out.s = proj.s;
      out.lateral = proj.lateral;
      out.dist = proj.dist;
      out.halfWidth = proj.halfWidth;
      out.y = proj.y;
    }
    return found;
  };
}

/* ------------------------------------------------------------------ the plan */

interface Edge {
  r: number;
  side: -1 | 1;
  count: number;
  closed: boolean;
  kind: Uint8Array;
  depth: Float32Array;
  /** Stations forced open by the flood. */
  forced: Uint8Array;
}

interface Scope {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  holdBoxes: ObstacleBox[];
  holdWalls: ObstacleWall[];
}

/** The course's neighbourhood, and the holds in it. */
function scopeOf(input: RaceBarrierInput): Scope {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of input.ribbons) {
    for (const s of p.samples) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
  }
  const margin = ESCAPE + 10;
  minX -= margin;
  minZ -= margin;
  maxX += margin;
  maxZ += margin;
  const inBounds = (b: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean =>
    b.maxX >= minX && b.minX <= maxX && b.maxZ >= minZ && b.minZ <= maxZ;
  const holdBoxes = input.colliders.filter((b) => holdsCar(b) && inBounds(b));
  const holdWalls = input.walls.filter(
    (w) =>
      HOLDING_WALLS.has(w.tag ?? '') &&
      inBounds({ minX: Math.min(w.ax, w.bx), maxX: Math.max(w.ax, w.bx), minZ: Math.min(w.az, w.bz), maxZ: Math.max(w.az, w.bz) }),
  );
  return { minX, minZ, maxX, maxZ, holdBoxes, holdWalls };
}

/**
 * Where a car still gets away from the course with `barrier` standing: one point per way out,
 * where it left the ribbon. Empty is the promise every shipped course keeps (the tests ask).
 */
export function findBarrierLeaks(input: RaceBarrierInput, barrier: readonly NeonWallDef[], res = PROOF_RES): BarrierLeak[] {
  const scope = scopeOf(input);
  return createFlood(input, scope, res)(barrier, false).leaks;
}

export interface BarrierLeak {
  /** Where the way out left the ribbon. */
  x: number;
  z: number;
  y: number;
  /** Where it got clear of the course. */
  outX: number;
  outZ: number;
  /** The ribbon, side and station it left from; `r` is -1 when that could not be found. */
  r: number;
  side: number;
  station: number;
  /** The way itself, from the course out, a point every couple of metres: for a failing test to show. */
  trail: Array<{ x: number; z: number; y: number }>;
}

export function planRaceBarriers(input: RaceBarrierInput): RaceBarrierPlan {
  const { ribbons, surface } = input;
  const scope = scopeOf(input);
  const { minX, minZ, maxX, maxZ, holdBoxes, holdWalls } = scope;
  const holds = indexHolds(holdBoxes, holdWalls, minX, minZ, maxX, maxZ);
  const course = createCourseLookup(ribbons);

  /* -------------------------------------------------------- 1. probes */

  const probe: SurfaceSample = { y: 0, gx: 0, gz: 0 };
  const hit: CourseHit = { r: 0, s: 0, lateral: 0, dist: 0, halfWidth: 0, y: 0 };
  const at = createProjection();
  const edges: Edge[] = [];
  for (let r = 0; r < ribbons.length; r++) {
    const p = ribbons[r];
    const count = p.closed ? Math.floor(p.length / STEP) : Math.floor(p.length / STEP) + 1;
    for (const side of [-1, 1] as const) {
      const e: Edge = { r, side, count, closed: p.closed, kind: new Uint8Array(count), depth: new Float32Array(count), forced: new Uint8Array(count) };
      for (let i = 0; i < count; i++) {
        const s = pointAtStation(p, Math.min(p.length, i * STEP), at);
        const nx = -s.tz * side;
        const nz = s.tx * side;
        const ex = s.x + nx * s.halfWidth;
        const ez = s.z + nz * s.halfWidth;
        const y0 = s.y;
        // An edge standing inside another ribbon of the course is not an edge.
        if (onOtherRibbon(course, hit, r, ex, ez, y0, s.s, false) === 1) {
          e.kind[i] = COURSE;
          continue;
        }
        const deck = y0 > DECK_FLOOR;
        const reach = deck ? REACH_DECK : REACH_GROUND;
        let y = y0;
        let px = ex;
        let pz = ez;
        e.kind[i] = OPEN;
        e.depth[i] = reach;
        for (let d = STRIDE; d <= reach + 1e-6; d += STRIDE) {
          const qx = ex + nx * d;
          const qz = ez + nz * d;
          if (deck && surface) {
            surface.sample(qx, qz, y, probe);
            if (probe.y < y0 - DECK_FLOOR) {
              e.kind[i] = VOID;
              e.depth[i] = d;
              break;
            }
            y = probe.y;
          }
          if (blocked(holds, px, pz, qx, qz, y)) {
            e.kind[i] = HELD;
            e.depth[i] = d;
            break;
          }
          const other = onOtherRibbon(course, hit, r, qx, qz, y, s.s, true);
          if (other !== 0) {
            e.kind[i] = other === 1 ? COURSE : OPEN;
            e.depth[i] = d;
            break;
          }
          px = qx;
          pz = qz;
        }
      }
      // A hold too short to be a wall, between openings, is something to drive round.
      const minRun = Math.ceil(MIN_HOLD / STEP);
      forRuns(e, (k) => k === HELD, (i0, len) => {
        if (len >= minRun) return;
        const before = e.kind[wrap(e, i0 - 1)];
        const after = e.kind[wrap(e, i0 + len)];
        if ((before === OPEN || before === VOID) && (after === OPEN || after === VOID)) {
          for (let k = 0; k < len; k++) {
            const j = wrap(e, i0 + k);
            e.kind[j] = OPEN;
            e.depth[j] = reach(p, j);
          }
        }
      });
      edges.push(e);
    }
  }

  function reach(p: TrackPath, i: number): number {
    return pointAtStation(p, i * STEP, at).y > DECK_FLOOR ? REACH_DECK : REACH_GROUND;
  }

  /* -------------------------------------------------------- 2. runs, 3. proof */

  let walls: NeonWallDef[] = [];
  let leaks: BarrierLeak[] = [];
  let passes = 0;
  const flood = createFlood(input, scope, RES);
  for (; passes < MAX_PASSES; passes++) {
    walls = layRuns(ribbons, edges, input.roadY);
    const sealed = flood(walls, true);
    leaks = sealed.leaks;
    if (leaks.length === 0) {
      walls = prunePockets(walls, sealed.pockets, flood);
      break;
    }
    let opened = 0;
    for (const leak of leaks) {
      const e = edges.find((x) => x.r === leak.r && x.side === leak.side);
      if (!e) continue;
      const i0 = Math.round(leak.station / STEP);
      for (let k = -4; k <= 4; k++) {
        const j = wrap(e, i0 + k);
        if (j < 0 || e.kind[j] === COURSE) continue;
        if (!e.forced[j]) opened++;
        e.forced[j] = 1;
      }
    }
    if (opened === 0) break;
  }
  return { walls, leaks, passes: passes + 1 };
}

/**
 * Take off every span with nothing but a closed pocket behind it, then prove the course is still
 * shut. Where the proof finds a way out (two pockets that were only closed by each other, a
 * shortcut across a pocket between two stretches of course), the pocket spans near it go back up
 * and it is proved again; if that never settles, the plan is kept whole.
 */
function prunePockets(
  walls: NeonWallDef[],
  pockets: boolean[],
  flood: Flood,
): NeonWallDef[] {
  const drop = pockets.slice();
  for (let pass = 0; pass < 6; pass++) {
    if (!drop.some(Boolean)) return walls;
    const kept = walls.filter((_, i) => !drop[i]);
    const leaks = flood(kept, false).leaks;
    if (leaks.length === 0) return kept;
    let restored = 0;
    for (let i = 0; i < walls.length; i++) {
      if (!drop[i]) continue;
      const w = walls[i];
      const mx = (w.ax + w.bx) / 2;
      const mz = (w.az + w.bz) / 2;
      const near = leaks.some((l) => Math.hypot(l.x - mx, l.z - mz) < 12 || Math.hypot(l.outX - mx, l.outZ - mz) < 12);
      if (near) {
        drop[i] = false;
        restored++;
      }
    }
    if (restored === 0) break;
  }
  return walls;
}

/**
 * 0: nothing; 1: another ribbon of the course (a mouth); 2: this ribbon further along — a hairpin
 * or a lap that doubles back, which is not a mouth. `probe` picks the probe's pads over the edge's.
 */
function onOtherRibbon(course: CourseLookup, hit: CourseHit, r: number, x: number, z: number, y: number, s0: number, probe: boolean): 0 | 1 | 2 {
  const senior = probe ? DEFER_PROBE : DEFER_EDGE;
  const junior = probe ? YIELD_PROBE : YIELD_EDGE;
  const pad = (other: number): number => (other === r ? (probe ? 0 : -Infinity) : other < r ? senior : junior);
  if (!course(x, z, y, pad, hit, r, s0, SELF_NEAR)) return 0;
  return hit.r === r ? 2 : 1;
}

function wrap(e: Edge, i: number): number {
  if (e.closed) return ((i % e.count) + e.count) % e.count;
  return i < 0 || i >= e.count ? -1 : i;
}

/** Calls `fn(start, length)` for every maximal run of stations whose kind passes `test`. */
function forRuns(e: Edge, test: (kind: number, i: number) => boolean, fn: (i0: number, len: number) => void): void {
  const n = e.count;
  const ok = (i: number): boolean => test(e.kind[i], i);
  if (e.closed) {
    let start = -1;
    for (let i = 0; i < n; i++) if (!ok(i)) {
      start = i;
      break;
    }
    if (start < 0) {
      fn(0, n);
      return;
    }
    let i = start + 1;
    while (i < start + 1 + n) {
      const j = i % n;
      if (!ok(j)) {
        i++;
        continue;
      }
      let len = 0;
      while (len < n && ok((i + len) % n)) len++;
      fn(j, len);
      i += len;
    }
  } else {
    let i = 0;
    while (i < n) {
      if (!ok(i)) {
        i++;
        continue;
      }
      let len = 0;
      while (i + len < n && ok(i + len)) len++;
      fn(i, len);
      i += len;
    }
  }
}

/** The barrier for the current state of the edges. */
function layRuns(ribbons: readonly TrackPath[], edges: Edge[], roadY: (x: number, z: number, hint: number) => number): NeonWallDef[] {
  const out: NeonWallDef[] = [];
  const at = createProjection();
  for (const e of edges) {
    const p = ribbons[e.r];
    const needs = (kind: number, i: number): boolean => kind === OPEN || kind === VOID || (e.forced[i] === 1 && kind === HELD);
    forRuns(e, needs, (i0, len) => {
      const before = wrap(e, i0 - 1);
      const after = wrap(e, i0 + len);
      // Each end meets a hold at its depth, or another ribbon of the course at the edge — where
      // that ribbon's own barrier (or the lap's) comes in to meet it.
      const end = (j: number): { depth: number; hold: boolean } =>
        j >= 0 && e.kind[j] === HELD ? { depth: e.depth[j], hold: true } : { depth: EDGE_DEPTH, hold: false };
      const L = end(before);
      const R = end(after);
      const points: Array<{ x: number; z: number; y: number; i: number }> = [];
      const push = (i: number, depth: number): void => {
        const j = wrap(e, i);
        if (j < 0) return;
        const s = pointAtStation(p, Math.min(p.length, j * STEP), at);
        const nx = -s.tz * e.side;
        const nz = s.tx * e.side;
        const x = s.x + nx * (s.halfWidth + depth);
        const z = s.z + nz * (s.halfWidth + depth);
        points.push({ x, z, y: roadY(x, z, s.y), i: j });
      };
      const full = e.closed && len >= e.count;
      const ease = (h: { depth: number; hold: boolean }, from: number): number => {
        if (!h.hold) return EDGE_DEPTH;
        const u = Math.min(1, (from * STEP) / EASE);
        return EDGE_DEPTH + (h.depth - EDGE_DEPTH) * (1 - u * u * (3 - 2 * u));
      };
      if (!full) push(i0 - 1, L.depth);
      for (let k = 0; k < len; k++) {
        const j = wrap(e, i0 + k);
        let depth: number;
        if (full) depth = EDGE_DEPTH;
        else if ((len + 1) * STEP <= BRIDGE) depth = L.depth + ((R.depth - L.depth) * (k + 1)) / (len + 1);
        else depth = Math.max(ease(L, k + 1), ease(R, len - k));
        if (e.kind[j] === VOID) depth = Math.min(depth, Math.max(EDGE_DEPTH, e.depth[j] - DECK_PAD));
        if (e.kind[j] === OPEN || e.kind[j] === HELD) depth = Math.min(depth, e.depth[j]);
        push(i0 + k, depth);
      }
      if (!full) push(i0 + len, R.depth);
      if (full && points.length > 0) points.push({ ...points[0] });
      emitRun(p, e.side, points, out);
    });
  }
  return out;
}

/** Straight stretches of a run become one span; curves and grades are cut short. */
function emitRun(p: TrackPath, side: number, points: Array<{ x: number; z: number; y: number; i: number }>, out: NeonWallDef[]): void {
  if (points.length < 2) return;
  const MAX_SPAN = 8;
  const TOL = 0.06;
  let a = 0;
  while (a < points.length - 1) {
    let b = a + 1;
    while (b + 1 < points.length) {
      const c = b + 1;
      const pa = points[a];
      const pc = points[c];
      const len = Math.hypot(pc.x - pa.x, pc.z - pa.z);
      if (len > MAX_SPAN) break;
      let straight = true;
      for (let k = a + 1; k < c && straight; k++) {
        const q = points[k];
        const t = ((q.x - pa.x) * (pc.x - pa.x) + (q.z - pa.z) * (pc.z - pa.z)) / (len * len || 1);
        const ox = pa.x + (pc.x - pa.x) * t - q.x;
        const oz = pa.z + (pc.z - pa.z) * t - q.z;
        const oy = pa.y + (pc.y - pa.y) * t - q.y;
        if (Math.hypot(ox, oz) > TOL || Math.abs(oy) > 0.08) straight = false;
      }
      if (!straight) break;
      b = c;
    }
    const pa = points[a];
    const pb = points[b];
    const dx = pb.x - pa.x;
    const dz = pb.z - pa.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-3) {
      const sample = p.samples[Math.min(p.samples.length - 1, Math.max(0, sampleIndexAt(p, points[(a + b) >> 1].i * STEP)))];
      // In at the track: the inward normal is the outward one flipped by which side this is.
      out.push({
        ax: pa.x,
        az: pa.z,
        ay: pa.y,
        bx: pb.x,
        bz: pb.z,
        by: pb.y,
        nx: -side * (-dz / len),
        nz: -side * (dx / len),
        side,
        curvature: sample.curvature,
        zone: sample.zone,
      });
    }
    a = b;
  }
}

function sampleIndexAt(p: TrackPath, s: number): number {
  let lo = 0;
  let hi = p.samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p.samples[mid].s <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/* ------------------------------------------------------------------ the flood */

/**
 * The flood is a breadth-first search over a grid of cells round the course, in LEVELS: the
 * ground, and two bands of height for the decks (a ramp, The Stack's deck, the viaduct over it),
 * so a street under a deck and the deck over it are different places. A car moves a cell at a
 * time onto whatever surface it would stand on there (`SurfaceField.sample` with the height it
 * has, so it stays on a deck, climbs a ramp, and falls off an open edge), and not into a cell a
 * hold or a barrier fills at that height, grown by the car's radius.
 *
 * Every cell remembers how far round the lap the ribbon it was reached from is, and how far from
 * it: two fronts that meet from stretches of the course much further apart along the lap than
 * across here are a SHORTCUT, closed like a way out. Nothing but that and a car getting clear of
 * the course (`ESCAPE`) is a leak.
 *
 * Memory is what bounds it: a city is a big grid, so the ground keeps five bytes a cell and only
 * the cells under a deck keep the levels above.
 */

/** Height slices of the obstacle masks (m): slice k covers [SLICE0 + 2k, SLICE0 + 2k + 2). */
const SLICE0 = -4;
const SLICE_H = 2;
const SLICES = 16;
/** The levels: the ground below LEVEL_1, then [LEVEL_1, LEVEL_2), then above. */
const LEVEL_1 = 2;
const LEVEL_2 = 13.5;
/** The band's own coarse grid (m), and its height slices (1 m from `BAND_Y0`). */
const BAND_CELL = 2;
const BAND_Y0 = -4;

function sliceMask(lo: number, hi: number): number {
  const a = Math.max(0, Math.floor((lo - SLICE0) / SLICE_H));
  const b = Math.min(SLICES - 1, Math.floor((hi - SLICE0) / SLICE_H));
  if (b < a) return 0;
  let m = 0;
  for (let k = a; k <= b; k++) m |= 1 << k;
  return m;
}

function bandMask(lo: number, hi: number): number {
  const a = Math.max(0, Math.floor(lo - BAND_Y0));
  const b = Math.min(31, Math.floor(hi - BAND_Y0));
  if (b < a) return 0;
  let m = 0;
  for (let k = a; k <= b; k++) m |= 1 << k;
  return m >>> 0;
}

function levelOf(y: number): number {
  return y < LEVEL_1 ? 0 : y < LEVEL_2 ? 1 : 2;
}

interface FloodResult {
  leaks: BarrierLeak[];
  /** Per span, when asked: true where nothing but a closed pocket or the course is behind it. */
  pockets: boolean[];
}

type Flood = (barrier: readonly NeonWallDef[], prune: boolean) => FloodResult;

/** A link's low two bits are the direction back to the parent, the next two its level. */
const SEED = 0x80;
const DI = [1, -1, 0, 0];
const DJ = [0, 0, 1, -1];

function createFlood(input: RaceBarrierInput, scope: Scope, res: number): Flood {
  const { ribbons, surface } = input;
  const { minX, minZ, maxX, maxZ, holdBoxes, holdWalls } = scope;
  const W = Math.ceil((maxX - minX) / res);
  const H = Math.ceil((maxZ - minZ) / res);
  const N = W * H;
  const cx = (i: number): number => minX + (i + 0.5) * res;
  const cz = (j: number): number => minZ + (j + 0.5) * res;
  const cellAt = (x: number, z: number): number => {
    const i = Math.floor((x - minX) / res);
    const j = Math.floor((z - minZ) / res);
    return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i;
  };

  // The band: at which heights each coarse cell is within ESCAPE of the course.
  const BW = Math.ceil((maxX - minX) / BAND_CELL);
  const BH = Math.ceil((maxZ - minZ) / BAND_CELL);
  const band = new Uint32Array(BW * BH);
  {
    const at = createProjection();
    for (const p of ribbons) {
      for (let st = 0; st <= p.length; st += 1.5) {
        const s = pointAtStation(p, st, at);
        const reach = s.halfWidth + ESCAPE;
        const m = bandMask(s.y - 2.5, s.y + 2.5);
        const i0 = Math.max(0, Math.floor((s.x - reach - minX) / BAND_CELL));
        const i1 = Math.min(BW - 1, Math.floor((s.x + reach - minX) / BAND_CELL));
        const j0 = Math.max(0, Math.floor((s.z - reach - minZ) / BAND_CELL));
        const j1 = Math.min(BH - 1, Math.floor((s.z + reach - minZ) / BAND_CELL));
        for (let j = j0; j <= j1; j++) {
          const dz = minZ + (j + 0.5) * BAND_CELL - s.z;
          for (let i = i0; i <= i1; i++) {
            const dx = minX + (i + 0.5) * BAND_CELL - s.x;
            if (dx * dx + dz * dz <= reach * reach) band[j * BW + i] |= m;
          }
        }
      }
    }
  }
  const inBand = (k: number, y: number): boolean => {
    const i = Math.floor(((k % W) * res) / BAND_CELL);
    const j = Math.floor((((k / W) | 0) * res) / BAND_CELL);
    return (band[j * BW + i] & bandMask(y, y)) !== 0;
  };

  // The cells a surface other than the ground may be over, each with a slot in the level arrays.
  const deckIndex = new Int32Array(N).fill(-1);
  let D = 0;
  const stampDeck = (p: TrackPath): void => {
    for (let st = 0; st <= p.length; st += 2) {
      const s = pointAtStation(p, st, scratch);
      if (s.y < 0.05) continue;
      const reach = s.halfWidth + 3;
      const i0 = Math.max(0, Math.floor((s.x - reach - minX) / res));
      const i1 = Math.min(W - 1, Math.floor((s.x + reach - minX) / res));
      const j0 = Math.max(0, Math.floor((s.z - reach - minZ) / res));
      const j1 = Math.min(H - 1, Math.floor((s.z + reach - minZ) / res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (deckIndex[j * W + i] < 0) deckIndex[j * W + i] = D++;
    }
  };
  const scratch = createProjection();
  for (const p of input.decks) stampDeck(p);
  for (const p of ribbons) stampDeck(p);

  // The holds, grown by the car's reach, as height slices per cell.
  const holds = new Uint16Array(N);
  const bars = new Uint16Array(N);
  // A box is grown by `grow`; a wall by at least half a cell as well, so a thin one along a row
  // of cell edges still fills a row. Either way a 4-connected search can not slip through it.
  const grow = Math.max(0.3, (CAR_GAP - Math.SQRT2 * res) / 2);
  const wallGrow = Math.max(grow, res / 2);
  const r2 = grow * grow;
  const w2 = wallGrow * wallGrow;
  const stampBox = (mask: Uint16Array, b: ObstacleBox): void => {
    const m = sliceMask(b.minY ?? SLICE0, b.maxY ?? SLICE0 + SLICES * SLICE_H);
    const i0 = Math.max(0, Math.floor((b.minX - grow - minX) / res));
    const i1 = Math.min(W - 1, Math.floor((b.maxX + grow - minX) / res));
    const j0 = Math.max(0, Math.floor((b.minZ - grow - minZ) / res));
    const j1 = Math.min(H - 1, Math.floor((b.maxZ + grow - minZ) / res));
    for (let j = j0; j <= j1; j++) {
      const z = cz(j);
      const dz = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
      for (let i = i0; i <= i1; i++) {
        const x = cx(i);
        const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
        if (dx * dx + dz * dz <= r2) mask[j * W + i] |= m;
      }
    }
  };
  const stampWall = (mask: Uint16Array, ax: number, az: number, bx: number, bz: number, minY: number | undefined, maxY: number | undefined): void => {
    const m = sliceMask(minY ?? SLICE0, maxY ?? SLICE0 + SLICES * SLICE_H);
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - wallGrow - minX) / res));
    const i1 = Math.min(W - 1, Math.floor((Math.max(ax, bx) + wallGrow - minX) / res));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - wallGrow - minZ) / res));
    const j1 = Math.min(H - 1, Math.floor((Math.max(az, bz) + wallGrow - minZ) / res));
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    for (let j = j0; j <= j1; j++) {
      const z = cz(j);
      for (let i = i0; i <= i1; i++) {
        const x = cx(i);
        let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ox = ax + dx * t - x;
        const oz = az + dz * t - z;
        if (ox * ox + oz * oz <= w2) mask[j * W + i] |= m;
      }
    }
  };
  for (const b of holdBoxes) stampBox(holds, b);
  for (const w of holdWalls) stampWall(holds, w.ax, w.az, w.bx, w.bz, w.minY, w.maxY);

  // Visit state. The ground level for every cell; the two deck levels (and the ground level's
  // height, which a ramp's foot lifts) only for the cells under a deck.
  const gLabel = new Uint16Array(N);
  const gSteps = new Uint16Array(N);
  const gLink = new Uint8Array(N);
  const dLabel = new Uint16Array(D * 2);
  const dSteps = new Uint16Array(D * 2);
  const dLink = new Uint8Array(D * 2);
  const dHeight = new Float32Array(D * 3);
  const gRegion = new Uint16Array(N);
  const dRegion = new Uint16Array(D * 2);
  let queue = new Int32Array(1 << 16);

  const label = (k: number, l: number): number => (l === 0 ? gLabel[k] : deckIndex[k] < 0 ? 0 : dLabel[deckIndex[k] * 2 + l - 1]);
  const steps = (k: number, l: number): number => (l === 0 ? gSteps[k] : dSteps[deckIndex[k] * 2 + l - 1]);
  const link = (k: number, l: number): number => (l === 0 ? gLink[k] : dLink[deckIndex[k] * 2 + l - 1]);
  const height = (k: number, l: number): number => (deckIndex[k] < 0 ? 0 : dHeight[deckIndex[k] * 3 + l]);
  const visit = (k: number, l: number, lab: number, n: number, lnk: number, y: number): boolean => {
    const d = deckIndex[k];
    if (l > 0 && d < 0) return false;
    if (l === 0) {
      gLabel[k] = lab;
      gSteps[k] = n;
      gLink[k] = lnk;
    } else {
      dLabel[d * 2 + l - 1] = lab;
      dSteps[d * 2 + l - 1] = n;
      dLink[d * 2 + l - 1] = lnk;
    }
    if (d >= 0) dHeight[d * 3 + l] = y;
    return true;
  };

  // Where each branch leaves and rejoins the lap, so a cell reached from a branch can be told
  // how far round the lap it is. Labels are half metres round the lap, plus one (0 is unvisited).
  const lap = ribbons[0];
  const L = lap.length;
  const mouths = ribbons.map((p, r) => {
    if (r === 0) return { from: 0, span: L };
    const first = p.samples[0];
    const last = p.samples[p.samples.length - 1];
    const sIn = projectOntoPath(lap, first.x, first.z, createProjection(), -1, 12, first.y).s;
    const sOut = projectOntoPath(lap, last.x, last.z, createProjection(), -1, 12, last.y).s;
    return { from: sIn, span: (((sOut - sIn) % L) + L) % L };
  });
  const labelOf = (r: number, st: number): number => {
    const m = mouths[r];
    const station = r === 0 ? st : (m.from + (m.span * st) / Math.max(1e-6, ribbons[r].length)) % L;
    return Math.min(65535, Math.round(station * 2) + 1);
  };

  const course = createCourseLookup(ribbons);
  const hit: CourseHit = { r: 0, s: 0, lateral: 0, dist: 0, halfWidth: 0, y: 0 };
  const probe: SurfaceSample = { y: 0, gx: 0, gz: 0 };
  const body = (y: number): number => sliceMask(y + BODY_LO, y + BODY_HI);
  const heightAt = (k: number, fromY: number): number => {
    if (deckIndex[k] < 0 || !surface) return 0;
    surface.sample(cx(k % W), cz((k / W) | 0), fromY, probe);
    return probe.y;
  };

  return (barrier, prune) => {
    bars.fill(0);
    for (const w of barrier) {
      const lo = Math.min(w.ay, w.by);
      const hi = Math.max(w.ay, w.by);
      stampWall(bars, w.ax, w.az, w.bx, w.bz, lo - BARRIER_DROP, hi + BARRIER_HEIGHT);
    }
    gLabel.fill(0);
    dLabel.fill(0);
    let tail = 0;
    const push = (entry: number): void => {
      if (tail >= queue.length) {
        const grown = new Int32Array(queue.length * 2);
        grown.set(queue);
        queue = grown;
      }
      queue[tail++] = entry;
    };
    const free = (k: number, y: number): boolean => ((holds[k] | bars[k]) & body(y)) === 0;

    const at = createProjection();
    for (let r = 0; r < ribbons.length; r++) {
      const p = ribbons[r];
      for (let st = 0; st <= p.length; st += res) {
        const s = pointAtStation(p, st, at);
        const lab = labelOf(r, st);
        const l = levelOf(s.y);
        for (let lat = -s.halfWidth + 1; lat <= s.halfWidth - 1; lat += res) {
          const k = cellAt(s.x + -s.tz * lat, s.z + s.tx * lat);
          if (k < 0 || label(k, l) !== 0 || !free(k, s.y)) continue;
          if (visit(k, l, lab, 0, SEED, s.y)) push(k * 3 + l);
        }
      }
    }

    const escapes: number[] = [];
    const cuts: number[] = [];
    for (let head = 0; head < tail; head++) {
      const entry = queue[head];
      const k = (entry / 3) | 0;
      const l = entry - k * 3;
      const y = height(k, l);
      const lab = label(k, l);
      const n = steps(k, l);
      const i = k % W;
      const j = (k / W) | 0;
      for (let dir = 0; dir < 4; dir++) {
        const ni = i + DI[dir];
        const nj = j + DJ[dir];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nk = nj * W + ni;
        const ny = heightAt(nk, y);
        if (!free(nk, ny)) continue;
        const nl = levelOf(ny);
        if (nl > 0 && deckIndex[nk] < 0) continue;
        const other = label(nk, nl);
        if (other !== 0) {
          // Two fronts meeting from stretches of course far apart round the lap, and nearer each
          // other across here than along it: a way to cut the course.
          if (Math.abs(height(nk, nl) - ny) < 2.5) {
            let d = Math.abs(other - lab) / 2;
            d = Math.min(d, L - d);
            if (d - (n + steps(nk, nl) + 1) * res > SHORTCUT) cuts.push(entry, nk * 3 + nl);
          }
          continue;
        }
        // The link back points the other way: +x came from -x.
        const back = dir ^ 1;
        visit(nk, nl, lab, Math.min(65535, n + 1), back | (l << 2), ny);
        if (!inBand(nk, ny)) {
          escapes.push(nk * 3 + nl);
          continue;
        }
        push(nk * 3 + nl);
      }
    }

    // Walk a cell back to the course and find where it left the edge it passed.
    const leaks: BarrierLeak[] = [];
    const reported: Array<{ x: number; z: number }> = [];
    const walkBack = (entry: number, ex: number, ez: number): void => {
      const trail: Array<{ x: number; z: number; y: number }> = [];
      let k = (entry / 3) | 0;
      let l = entry - k * 3;
      for (let guard = 0; guard < 100000; guard++) {
        trail.push({ x: cx(k % W), z: cz((k / W) | 0), y: height(k, l) });
        const lnk = link(k, l);
        if (lnk & SEED) break;
        const dir = lnk & 3;
        k += DI[dir] + DJ[dir] * W;
        l = (lnk >> 2) & 3;
      }
      trail.reverse();
      // From the course outwards: the last point still on (or at) the ribbon is where it got out.
      let leak: BarrierLeak | null = null;
      for (const q of trail) {
        if (course(q.x, q.z, q.y, () => 0.5, hit)) {
          leak = { x: q.x, z: q.z, y: q.y, outX: ex, outZ: ez, r: hit.r, side: hit.lateral < 0 ? -1 : 1, station: hit.s, trail: [] };
        } else if (leak) {
          break;
        }
      }
      const out = leak ?? { x: ex, z: ez, y: trail[trail.length - 1]?.y ?? 0, outX: ex, outZ: ez, r: -1, side: 0, station: 0, trail: [] };
      out.trail = trail.filter((_, q) => q % 4 === 0 || q === trail.length - 1);
      leaks.push(out);
    };
    const fresh = (entry: number): { x: number; z: number } | null => {
      const k = (entry / 3) | 0;
      const x = cx(k % W);
      const z = cz((k / W) | 0);
      if (reported.some((q) => Math.hypot(q.x - x, q.z - z) < 25)) return null;
      reported.push({ x, z });
      return { x, z };
    };
    for (const e of escapes) {
      const p = fresh(e);
      if (p) walkBack(e, p.x, p.z);
    }
    for (let c = 0; c < cuts.length; c += 2) {
      const p = fresh(cuts[c + 1]);
      if (!p) continue;
      walkBack(cuts[c], p.x, p.z);
      walkBack(cuts[c + 1], p.x, p.z);
    }
    if (!prune || leaks.length > 0) return { leaks, pockets: barrier.map(() => false) };

    // What is behind each span: a span with nothing but a closed pocket (or the course itself)
    // behind it holds nothing in, and can go. Region 0 is unmarked; odd ids reached the outside.
    gRegion.fill(0);
    dRegion.fill(0);
    const region = (k: number, l: number): number => (l === 0 ? gRegion[k] : dRegion[deckIndex[k] * 2 + l - 1]);
    const mark = (k: number, l: number, id: number): void => {
      if (l === 0) gRegion[k] = id;
      else dRegion[deckIndex[k] * 2 + l - 1] = id;
    };
    const outside: boolean[] = [false];
    const regionQueue: number[] = [];
    const regionY: number[] = [];
    const floodRegion = (start: number, y0: number): boolean => {
      // Out of ids (a city of pockets): call it the outside, which only ever keeps a span.
      if (outside.length >= 65535) return true;
      const id = outside.length;
      outside.push(false);
      regionQueue.length = 0;
      regionY.length = 0;
      mark(start, levelOf(y0), id);
      regionQueue.push(start);
      regionY.push(y0);
      for (let h = 0; h < regionQueue.length; h++) {
        const k = regionQueue[h];
        const y = regionY[h];
        const i = k % W;
        const j = (k / W) | 0;
        for (let dir = 0; dir < 4; dir++) {
          const ni = i + DI[dir];
          const nj = j + DJ[dir];
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) return (outside[id] = true);
          const nk = nj * W + ni;
          const ny = heightAt(nk, y);
          if (!free(nk, ny)) continue;
          const nl = levelOf(ny);
          if (nl > 0 && deckIndex[nk] < 0) continue;
          const seenBy = region(nk, nl);
          if (seenBy !== 0) {
            if (outside[seenBy]) return (outside[id] = true);
            continue;
          }
          if (!inBand(nk, ny)) return (outside[id] = true);
          mark(nk, nl, id);
          regionQueue.push(nk);
          regionY.push(ny);
        }
      }
      return false;
    };
    // Just clear of the span's own stamp, on the far side, and a little further if that is filled
    // (the span's end tucked into a rail or a facade). A span stays unless every point along it
    // finds either a closed pocket or the course itself behind it; one that finds nothing it can
    // stand on (off a deck's edge, inside a hold) proves nothing, and stays.
    const pockets = barrier.map((w) => {
      for (const t of [0.2, 0.5, 0.8]) {
        const spanY = w.ay + (w.by - w.ay) * t;
        let decided = false;
        for (let extra = 0; extra < 3 && !decided; extra++) {
          const reach = wallGrow + res * (1 + extra);
          const k = cellAt(w.ax + (w.bx - w.ax) * t - w.nx * reach, w.az + (w.bz - w.az) * t - w.nz * reach);
          if (k < 0) return false;
          const y = heightAt(k, spanY);
          if (Math.abs(y - spanY) > 1.5) return false;
          const l = levelOf(y);
          if (!free(k, y) || (l > 0 && deckIndex[k] < 0)) continue;
          decided = true;
          if (label(k, l) !== 0) continue;
          const id = region(k, l);
          if (id !== 0 ? outside[id] : floodRegion(k, y)) return false;
        }
        if (!decided) return false;
      }
      return true;
    });
    return { leaks, pockets };
  };
}

/* ------------------------------------------------------------------ into a world */

/** How far above the road a barrier stops a car, and how far below it the collider still bites (m). */
export const BARRIER_HEIGHT = 2.4;
export const BARRIER_DROP = 3.2;

/** The simulation's side of a span: a wall bounded to the level of the road it stands on. */
export function barrierCollider(w: NeonWallDef): ObstacleWall {
  const lo = Math.min(w.ay, w.by);
  const hi = Math.max(w.ay, w.by);
  return { ax: w.ax, az: w.az, bx: w.bx, bz: w.bz, minY: lo - BARRIER_DROP, maxY: hi + BARRIER_HEIGHT, tag: 'neon-wall' };
}

/**
 * Plan the barrier for a course laid over `world` and append its colliders to `walls` (the list
 * the world is about to hand the simulation, buses already taken out). Returns the spans, for
 * `plan.neonWalls`. Throws nothing on a leak: the course tests hold every shipped lap to none.
 */
export function layRaceBarriers(world: World, ribbons: readonly TrackPath[], walls: ObstacleWall[]): NeonWallDef[] {
  const result = planRaceBarriers(barrierInput(world, ribbons, walls));
  for (const w of result.walls) walls.push(barrierCollider(w));
  return result.walls;
}

/** What the planner (and the tests' leak check) is asked about a world. */
export function barrierInput(world: World, ribbons: readonly TrackPath[], walls: readonly ObstacleWall[], probe: SurfaceSample = { y: 0, gx: 0, gz: 0 }): RaceBarrierInput {
  const { layout, plan } = world;
  const surface = layout.surface;
  return {
    ribbons,
    colliders: layout.colliders,
    walls: walls.filter((w) => w.tag !== 'neon-wall'),
    surface,
    decks: (plan.ribbons ?? []).filter((r) => r.elevated).map((r) => r.path),
    roadY: (x, z, hint) => {
      if (!surface) return 0;
      surface.sample(x, z, hint, probe);
      return probe.y;
    },
  };
}
