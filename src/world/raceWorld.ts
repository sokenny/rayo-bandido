import type { ArenaLayout, ObstacleBox, ObstacleWall, RaceCourse, RaceGate, RaceShortcut, SpawnPoint } from '../core/types';
import { RACE } from '../config/tuning';
import { PAL } from '../render/scene/env/palette';
import type { World } from './arenaWorld';
import { inRect, SIDEWALK_Y, type BlockRect, type CityPlan, type RailDef, type Rect, type RibbonDef, type WallRect, type ZoneId } from './cityPlan';
import { RACE_BOUNDS, RACE_GATES, RACE_SHORTCUTS, RACE_SPEC } from './raceSpec';
import {
  buildTrackPath,
  createProjection,
  isOnPath,
  offsetAtStation,
  projectOntoPath,
  segmentCount,
  type TrackPath,
  type TrackSample,
  type TrackZone,
} from './track';

/**
 * The racing circuit ("Race" in the main menu), derived entirely from `raceSpec.ts`:
 *
 *  - the lap and the two alleys become ribbons (asphalt) and their edges become wall
 *    segments: guardrails on the highway, barriers in the city, concrete walls in the alleys;
 *    an edge gets a gap wherever another ribbon runs through it, which is how the alleys join,
 *  - the checkpoint points are projected onto the lap and become gates; the grid sits just
 *    past the line,
 *  - the city is generated around the road: a grid of blocks, recursively split and dropped
 *    wherever a ribbon (plus a zone-dependent shoulder) cuts through, so diagonal and curved
 *    roads read as avenues cut through a grid with stepped building fronts,
 *  - the electric cars patrol the lap itself in the direction of travel, so they are both
 *    targets ahead of the player and traffic to thread through.
 *
 * Collision and art come from the same segments and rectangles, as in the test city.
 */

/** Perimeter wall band thickness (m), same as the test city. */
const WALL_BAND = 12;
/** Shoulder between the road edge and the first building, per zone (m). */
const SHOULDER: Record<TrackZone, number> = { corporate: 9, urban: 3.6, jdm: 3 };
const ALLEY_SHOULDER = 1.2;
/** Coarsest / finest block cell (m). */
const CELL = 46;
const MIN_CELL = 11;
/** Lateral offset of the electric cars' patrol lane (m); which side is drawn per car. */
const PATROL_LANE = 3.4;
const TARGET_COUNT = 12;
/**
 * Metres of lap either side of the start line kept clear of traffic. The grid sits from
 * `RACE.gridFirstRow` to a few rows past it, so a car spawned just behind the line used to
 * rear-end the back row before the countdown finished — and it did it every single race,
 * because the spawns were spread at an exact `L / TARGET_COUNT` and one of them always
 * landed there. Nothing spawns in this window now.
 */
const TRAFFIC_CLEAR_BEHIND = 70;
const TRAFFIC_CLEAR_AHEAD = 80;
/** How far into its slot a car may be jittered, as a fraction of the slot (0..0.5). */
const TRAFFIC_JITTER = 0.4;

/** mulberry32: small, fast, and the same sequence for the same seed on every machine. */
function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const RACE_LAPS = RACE.laps;

/* ------------------------------------------------------------------ geometry helpers */

function segmentRectDistance(ax: number, az: number, bx: number, bz: number, r: Rect): number {
  // Any endpoint inside, or the segment crossing an edge, means contact.
  if (inRect(r, ax, az) || inRect(r, bx, bz)) return 0;
  const corners: Array<[number, number]> = [
    [r.minX, r.minZ],
    [r.maxX, r.minZ],
    [r.maxX, r.maxZ],
    [r.minX, r.maxZ],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx, cz] = corners[i];
    const [dx, dz] = corners[(i + 1) % 4];
    if (segmentsIntersect(ax, az, bx, bz, cx, cz, dx, dz)) return 0;
  }
  let best = Infinity;
  best = Math.min(best, pointRectDistance(ax, az, r), pointRectDistance(bx, bz, r));
  for (const [cx, cz] of corners) best = Math.min(best, pointSegmentDistance(cx, cz, ax, az, bx, bz));
  return best;
}

function segmentsIntersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function pointRectDistance(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

function pointSegmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

/** Smallest clearance between the rect and any ribbon, minus that ribbon's width and shoulder. */
function rectClearance(r: Rect, ribbons: RibbonDef[]): number {
  let best = Infinity;
  for (const rb of ribbons) {
    const samples = rb.path.samples;
    const segs = segmentCount(rb.path);
    for (let i = 0; i < segs; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % samples.length];
      const shoulder = rb.kind === 'alley' ? ALLEY_SHOULDER : SHOULDER[a.zone];
      const d = segmentRectDistance(a.x, a.z, b.x, b.z, r) - Math.max(a.halfWidth, b.halfWidth) - shoulder;
      if (d < best) best = d;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ blocks */

/**
 * Recursive grid: a cell that a road runs through is split in four until it is clear or too
 * small to matter. What survives is the city.
 */
function generateBlocks(inner: Rect, ribbons: RibbonDef[], zoneAt: (x: number, z: number) => ZoneId): BlockRect[] {
  const blocks: BlockRect[] = [];
  const cols = Math.max(1, Math.round((inner.maxX - inner.minX) / CELL));
  const rows = Math.max(1, Math.round((inner.maxZ - inner.minZ) / CELL));
  const cw = (inner.maxX - inner.minX) / cols;
  const ch = (inner.maxZ - inner.minZ) / rows;
  let n = 0;

  const visit = (r: Rect, depth: number): void => {
    const clear = rectClearance(r, ribbons);
    if (clear >= 0) {
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      if (w < MIN_CELL * 0.6 || d < MIN_CELL * 0.6) return;
      const cx = (r.minX + r.maxX) / 2;
      const cz = (r.minZ + r.maxZ) / 2;
      const zone = zoneAt(cx, cz);
      const small = w < 20 || d < 20;
      const massing: 1 | 2 | 3 = small ? 1 : zone === 'corporate' ? 3 : zone === 'urban' ? 2 : 1;
      blocks.push({ tag: `blk-${n++}`, minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, zone, massing });
      return;
    }
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    if (w <= MIN_CELL && d <= MIN_CELL) return;
    // Split the longer axis (both when the cell is still big).
    const splitX = w > MIN_CELL && (w >= d || d <= MIN_CELL);
    const splitZ = d > MIN_CELL && (d >= w || w <= MIN_CELL);
    const mx = (r.minX + r.maxX) / 2;
    const mz = (r.minZ + r.maxZ) / 2;
    const xs = splitX ? [r.minX, mx, r.maxX] : [r.minX, r.maxX];
    const zs = splitZ ? [r.minZ, mz, r.maxZ] : [r.minZ, r.maxZ];
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < zs.length - 1; j++) {
        visit({ minX: xs[i], maxX: xs[i + 1], minZ: zs[j], maxZ: zs[j + 1] }, depth + 1);
      }
    }
  };

  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      visit(
        { minX: inner.minX + cw * i, maxX: inner.minX + cw * (i + 1), minZ: inner.minZ + ch * j, maxZ: inner.minZ + ch * (j + 1) },
        0,
      );
    }
  }
  return blocks;
}

/* ------------------------------------------------------------------ rails */

/** Edge segments of every ribbon, with gaps wherever another ribbon runs through. */
function buildRails(ribbons: RibbonDef[]): RailDef[] {
  const rails: RailDef[] = [];
  for (const rb of ribbons) {
    const samples = rb.path.samples;
    const segs = segmentCount(rb.path);
    for (const side of [-1, 1]) {
      for (let i = 0; i < segs; i++) {
        const a = samples[i];
        const b = samples[(i + 1) % samples.length];
        const ax = a.x + -a.tz * a.halfWidth * side;
        const az = a.z + a.tx * a.halfWidth * side;
        const bx = b.x + -b.tz * b.halfWidth * side;
        const bz = b.z + b.tx * b.halfWidth * side;
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        let open = false;
        for (const other of ribbons) {
          if (other === rb) continue;
          // The gap is a little wider than the other road so the corner posts stay clear of it.
          if (isOnPath(other.path, mx, mz, 1.6)) {
            open = true;
            break;
          }
        }
        if (open) continue;
        rails.push({ ax, az, bx, bz, kind: rb.kind === 'alley' ? 'wall' : 'rail', zone: a.zone });
      }
    }
  }
  return rails;
}

/* ------------------------------------------------------------------ world */

/**
 * `seed` decides where the traffic starts. Same seed, same circuit down to the last car —
 * which is what multiplayer needs, since every client builds the world itself and the host
 * only corrects it from there. In a match the match's `raceId` is the seed; alone, the
 * caller passes nothing and each race gets a fresh one.
 */
export function createRaceWorld(seed: number = (Math.random() * 0xffffffff) >>> 0): World {
  const path = buildTrackPath(RACE_SPEC);
  const alleys = RACE_SHORTCUTS.map((spec) => buildTrackPath(spec));
  const ribbons: RibbonDef[] = [{ path, kind: 'track' }, ...alleys.map((p) => ({ path: p, kind: 'alley' as const }))];
  const bounds: Rect = { ...RACE_BOUNDS };
  const inner: Rect = {
    minX: bounds.minX + WALL_BAND,
    maxX: bounds.maxX - WALL_BAND,
    minZ: bounds.minZ + WALL_BAND,
    maxZ: bounds.maxZ - WALL_BAND,
  };

  const perimeter: WallRect[] = [
    { tag: 'wall-n', minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: inner.minZ },
    { tag: 'wall-s', minX: bounds.minX, maxX: bounds.maxX, minZ: inner.maxZ, maxZ: bounds.maxZ },
    { tag: 'wall-w', minX: bounds.minX, maxX: inner.minX, minZ: inner.minZ, maxZ: inner.maxZ },
    { tag: 'wall-e', minX: inner.maxX, maxX: bounds.maxX, minZ: inner.minZ, maxZ: inner.maxZ },
  ];

  /** Zone of the nearest road sample: the city follows the road it stands on. */
  const proj = createProjection();
  const zoneAt = (x: number, z: number): ZoneId => {
    let best = Infinity;
    let zone: ZoneId = 'urban';
    for (const rb of ribbons) {
      projectOntoPath(rb.path, x, z, proj);
      if (proj.dist < best) {
        best = proj.dist;
        zone = rb.path.samples[proj.index].zone;
      }
    }
    return zone;
  };

  const blocks = generateBlocks(inner, ribbons, zoneAt);
  const rails = buildRails(ribbons);
  const solids: Rect[] = [...blocks, ...perimeter];

  /* ---------------------------------------------------------- race course */

  const line = projectOntoPath(path, RACE_GATES[0].x, RACE_GATES[0].z, createProjection());
  const L = path.length;
  const gates: RaceGate[] = RACE_GATES.map((g) => {
    const p = projectOntoPath(path, g.x, g.z, createProjection());
    const hw = p.halfWidth + 1.5;
    return {
      ax: p.x + -p.tz * -hw,
      az: p.z + p.tx * -hw,
      bx: p.x + -p.tz * hw,
      bz: p.z + p.tx * hw,
      fx: p.tx,
      fz: p.tz,
      s: p.s,
    };
  });
  // Lap order from the line.
  const lapOrder = (s: number): number => (((s - line.s) % L) + L) % L;
  const rest = gates.slice(1).sort((a, b) => lapOrder(a.s) - lapOrder(b.s));
  gates.splice(1, gates.length - 1, ...rest);

  const grid: SpawnPoint[] = [];
  for (let i = 0; i < RACE.gridSlots; i++) {
    const row = Math.floor(i / 2);
    const lateral = (i % 2 === 0 ? -1 : 1) * RACE.gridLateral;
    const p = offsetAtStation(path, line.s + RACE.gridFirstRow + row * RACE.gridRowGap, lateral);
    grid.push({ x: p.x, z: p.z, heading: Math.atan2(p.tx, -p.tz) });
  }

  const shortcuts: RaceShortcut[] = alleys.map((alley) => {
    const first = alley.samples[0];
    const last = alley.samples[alley.samples.length - 1];
    const sIn = projectOntoPath(path, first.x, first.z, createProjection()).s;
    const sOut = projectOntoPath(path, last.x, last.z, createProjection()).s;
    return { path: alley, sIn, sOut };
  });

  const course: RaceCourse = { laps: RACE_LAPS, gates, grid, path, shortcuts };

  /* ---------------------------------------------------------- targets, cruise */

  // Patrol lane: every ~3rd sample of the lap, pushed into a lane.
  const laneWaypoints = (lateral: number): Array<{ x: number; z: number }> => {
    const out: Array<{ x: number; z: number }> = [];
    const samples = path.samples;
    for (let i = 0; i < samples.length; i += 3) {
      const s = samples[i];
      out.push({ x: s.x + -s.tz * lateral, z: s.z + s.tx * lateral });
    }
    return out;
  };
  const targetSpawns: SpawnPoint[] = [];
  const targetPatrols: Array<Array<{ x: number; z: number }>> = [];
  const random = createRandom(seed);
  // The lap minus the window around the grid, cut into one slot per car: the cars land in a
  // different place every race, but never two on top of each other and never on the grid.
  const usable = Math.max(1, L - TRAFFIC_CLEAR_AHEAD - TRAFFIC_CLEAR_BEHIND);
  const slot = usable / TARGET_COUNT;
  for (let i = 0; i < TARGET_COUNT; i++) {
    const lateral = (random() < 0.5 ? 1 : -1) * PATROL_LANE;
    const loop = laneWaypoints(lateral);
    const jitter = (random() * 2 - 1) * TRAFFIC_JITTER * slot;
    const startStation = (line.s + TRAFFIC_CLEAR_AHEAD + (i + 0.5) * slot + jitter + L) % L;
    const start = Math.min(loop.length - 1, Math.floor(startStation / L * loop.length));
    const rotated = [...loop.slice(start), ...loop.slice(0, start)];
    const s = path.samples[Math.min(path.samples.length - 1, start * 3)];
    targetSpawns.push({ x: rotated[0].x, z: rotated[0].z, heading: Math.atan2(s.tx, -s.tz) });
    targetPatrols.push(rotated);
  }

  const cruiseRoute: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < path.samples.length; i += 4) cruiseRoute.push({ x: path.samples[i].x, z: path.samples[i].z });

  /* ---------------------------------------------------------- layout */

  const colliders: ObstacleBox[] = [];
  for (const w of perimeter) colliders.push({ minX: w.minX, maxX: w.maxX, minZ: w.minZ, maxZ: w.maxZ, tag: w.tag });
  for (const b of blocks) colliders.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, tag: b.tag });
  const walls: ObstacleWall[] = rails.map((r) => ({ ax: r.ax, az: r.az, bx: r.bx, bz: r.bz, tag: r.kind }));

  const layout: ArenaLayout = {
    bounds,
    playerSpawn: grid[0],
    targetSpawns,
    targetPatrols,
    cruiseRoute,
    colliders,
    walls,
    race: course,
    minimap: {
      bounds: inner,
      rects: [],
      ribbons: ribbons.map((rb) => ({
        points: rb.path.samples.filter((_, i) => i % 2 === 0 || !rb.path.closed).map((s) => ({ x: s.x, z: s.z })),
        width: rb.path.samples.reduce((sum, s) => sum + s.halfWidth * 2, 0) / rb.path.samples.length,
        closed: rb.path.closed,
        hidden: rb.kind === 'alley',
      })),
    },
  };

  /* ---------------------------------------------------------- plan */

  const lineDef = (p: { x: number; z: number; tx: number; tz: number; halfWidth: number }) => ({
    x: p.x,
    z: p.z,
    tx: p.tx,
    tz: p.tz,
    halfWidth: p.halfWidth,
  });

  const plan: CityPlan = {
    bounds,
    roads: [],
    ribbons,
    rails,
    blocks,
    walls: perimeter,
    barriers: [],
    gates: routeGates(path),
    billboards: [
      { variant: 0, x: inner.minX + 0.6, y: 27, z: -30, w: 30, h: 17, rotY: Math.PI / 2, color: PAL.neonCyan },
      { variant: 1, x: 80, y: 25, z: inner.minZ + 0.6, w: 26, h: 15, rotY: 0, color: PAL.neonMagenta },
      { variant: 0, x: inner.maxX - 0.6, y: 25, z: 110, w: 26, h: 15, rotY: -Math.PI / 2, color: PAL.neonCyan },
      { variant: 1, x: -60, y: 21, z: inner.maxZ - 0.6, w: 24, h: 14, rotY: Math.PI, color: PAL.neonMagenta },
    ],
    cableRuns: cableRuns(ribbons),
    pylons: [],
    plaza: null,
    // The WANTED board stands at the end of the start straight, facing the cars flat out.
    wantedBoard: { x: -226, z: inner.minZ + 4, rotY: 0 },
    startLine: lineDef(projectOntoPath(path, RACE_GATES[0].x, RACE_GATES[0].z, createProjection())),
    checkpoints: gates.slice(1).map((g) => {
      const p = projectOntoPath(path, (g.ax + g.bx) / 2, (g.az + g.bz) / 2, createProjection());
      return lineDef(p);
    }),
    zoneAt,
    isRoad(x, z, pad = 0) {
      for (const rb of ribbons) if (isOnPath(rb.path, x, z, pad)) return true;
      return false;
    },
    isSolid(x, z, pad = 0) {
      for (const b of solids) if (inRect(b, x, z, -pad)) return true;
      return false;
    },
    padY(x, z) {
      for (const b of solids) if (inRect(b, x, z)) return SIDEWALK_Y;
      return 0;
    },
  };

  return { layout, plan };
}

/** Neon route gates over the highway sections, at fixed stations along the lap. */
function routeGates(path: TrackPath): CityPlan['gates'] {
  const out: CityPlan['gates'] = [];
  const stations: Array<[number, number, number]> = [
    [300, PAL.neonCyan, PAL.neonBlue],
    [700, PAL.neonMagenta, PAL.neonCyan],
    [1060, PAL.neonPink, PAL.neonMagenta],
    [1260, PAL.neonCyan, PAL.neonMagenta],
  ];
  for (const [s, left, right] of stations) {
    const c = offsetAtStation(path, s, 0);
    const hw = c.halfWidth + 1.6;
    out.push({
      x0: c.x + -c.tz * -hw,
      z0: c.z + c.tx * -hw,
      x1: c.x + -c.tz * hw,
      z1: c.z + c.tx * hw,
      height: c.zone === 'corporate' ? 11.5 : 9.5,
      left,
      right,
      trusted: true,
    });
  }
  return out;
}

/** Overhead cables across the city streets and the alleys, anchored in the blocks either side. */
function cableRuns(ribbons: RibbonDef[]): Array<[number, number, number, number]> {
  const runs: Array<[number, number, number, number]> = [];
  for (const rb of ribbons) {
    const step = rb.kind === 'alley' ? 18 : 26;
    for (let s = step / 2; s < rb.path.length; s += step) {
      const c = offsetAtStation(rb.path, s, 0);
      if (rb.kind === 'track' && c.zone === 'corporate') continue;
      const reach = c.halfWidth + (rb.kind === 'alley' ? ALLEY_SHOULDER : SHOULDER[c.zone]) + 2.2;
      runs.push([c.x + -c.tz * -reach, c.z + c.tx * -reach, c.x + -c.tz * reach, c.z + c.tx * reach]);
    }
  }
  return runs;
}

/** Test/tool helper: every sample of the lap, for tests that walk the circuit. */
export function raceLapSamples(): TrackSample[] {
  return buildTrackPath(RACE_SPEC).samples;
}
