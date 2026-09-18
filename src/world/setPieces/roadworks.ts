import type { ObstacleBox, ObstacleWall } from '../../core/types';
import type { Rect } from '../cityPlan';
import type { SetPieceSpec } from './types';

/**
 * ROADWORKS JUMP (set-piece A): LA OBRA DE LA N3. An underpass the city dug across st-n3 years ago
 * and never finished, on the one long block of the street (between st-west at x −252 and
 * av-central at x −60). st-n3 runs dead straight from one edge of the map to the other, so the
 * run-up is the street itself: come east along it flat out from anywhere west of st-w3 (x −480).
 *
 *   - the MOUND: compacted rubble the crews pushed up across the carriageway, half-covered in
 *     steel road plates. Its grade eases in, then holds `RAMP.lipGrade` to the lip — the kicker the
 *     racers use it as;
 *   - the TRENCH ("la calzada hundida"): the dig across the whole carriageway and the south
 *     pavement, `TRENCH.depth` deep, sheet-piled; at its south end the ramp the crews drove down,
 *     climbing into the lot behind the pavement (the way out if you fall in);
 *   - the LANDING: the same street again, straight and open to av-central, so every speed from
 *     ~20 m/s to flat out on nitro comes down on asphalt and runs on east along st-n3;
 *   - the DESVÍO: a gravel lane on the north pavement and the strip of lot behind it, fenced off
 *     from the dig with jersey barriers, for anyone not jumping.
 *
 * Everything is laid out in the RUN'S FRAME: `u` metres along `HEADING` from `ORIGIN`, `w` metres
 * to its right (south). Change the constants below and the data here and the art
 * (`render/scene/env/setPieces/roadworksBuilder.ts`) both follow.
 *
 * PHYSICS (`sim/surface.ts`, `world/surface.ts`): the road only pushes vertically, so on the
 * mound's constant-grade top the car climbs at v·lipGrade and leaves the lip with it. Range to the
 * landing at grade: v·(v·s + √((v·s)² + 2·g·h))/g — ~19 m at 20 m/s, ~86 m at 57, ~124 m at 71
 * (nitro) with the defaults; the block leaves ~128 m of asphalt past the dig. The ground candidate
 * is never filtered by `STEP_UP`, so every vertical face of the dig would throw a wheel up it: each
 * carries a wall `WALL_INSET` inside (a wheel reaches 1.53 m from the centre, the circle 1.1 m),
 * bounded in y so only a car down there meets it. The mound's flanks the same way, for a car at grade.
 *
 * TRAFFIC: st-n3 between st-west and av-central carried one fill loop; it is gone
 * (`metroSpec.ts`), so no NPC drives this block. The taxi stop that stood on it moved east.
 */

/* ------------------------------------------------------------------ the knobs */

/** `u` = 0: the st-n3 × st-west crossing. */
export const ORIGIN = { x: -252, z: -600 } as const;
/** East along st-n3 (game convention: forward = (sin h, −cos h)). */
export const HEADING = Math.PI / 2;

/** The street, in the run's frame: half the carriageway, and the block faces either side (w). */
export const STREET = { half: 6.5, north: -11.5, south: 11.5 } as const;
/** Where the clear block starts and ends along the run (the crossings' edges). */
export const BLOCK = { u0: 6.5, u1: 181 } as const;

/** The mound (the kicker). */
export const RAMP = {
  /** Foot of the mound (u). */
  start: 9,
  /** Length of the rise (m). */
  length: 32,
  /** Over this first stretch the grade eases in from 0 (m). Then it holds `lipGrade`. */
  transition: 12,
  /** Grade on the top and at the lip (rise per metre). */
  lipGrade: 0.1,
  /** Drivable width (m): the carriageway, kerb to kerb. */
  width: 13,
  /** Each edge slopes to the ground over this much of the width (m). */
  shoulder: 1.2,
  /** Where the flank walls start: above this height a car at grade could hop onto the side (m). */
  flankFrom: 0.35,
} as const;

/** The dig. */
export const TRENCH = {
  /** Along the run from the lip (m): the gap a jump has to clear. */
  length: 12,
  /** Below grade (m). */
  depth: 3,
  /** Its north end: the carriageway's north kerb (w). */
  w0: -6.5,
  /** Where the flat floor ends to the south, under the pavement (w). Then the crews' ramp. */
  floorTo: 12.5,
  /** The way-out ramp's grade, climbing south into the lot. The house ramp grade. */
  exitGrade: 0.17,
} as const;

/** Walls sit this far inside every vertical face (m): see the notes above. */
export const WALL_INSET = 1.0;

/** The desvío: a lane over the north pavement and a strip of lot, fenced from the works (w). */
export const DETOUR = { w0: -21, w1: -8.2, u0: BLOCK.u0, u1: 72 } as const;

/* ------------------------------------------------------------------ the frame */

const FX = Math.sin(HEADING);
const FZ = -Math.cos(HEADING);
const RX = Math.cos(HEADING);
const RZ = Math.sin(HEADING);

/** The run's forward and right, as world unit vectors. */
export const RUN_FRAME = { fx: FX, fz: FZ, rx: RX, rz: RZ } as const;

/** World point at (u, w) in the run's frame. */
export function rwWorld(u: number, w: number): { x: number; z: number } {
  return { x: ORIGIN.x + FX * u + RX * w, z: ORIGIN.z + FZ * u + RZ * w };
}
/** Along the run from `ORIGIN` (m). */
export function rwU(x: number, z: number): number {
  return (x - ORIGIN.x) * FX + (z - ORIGIN.z) * FZ;
}
/** To the right of the run's axis (m). */
export function rwW(x: number, z: number): number {
  return (x - ORIGIN.x) * RX + (z - ORIGIN.z) * RZ;
}

/* ------------------------------------------------------------------ derived shape */

/** Where the mound starts rising, and the lip (u). */
export const RAMP_START = RAMP.start;
export const LIP_U = RAMP.start + RAMP.length;
/** Height of the lip above grade (m). */
export const LIP_HEIGHT = RAMP.lipGrade * (RAMP.transition / 2 + RAMP.length - RAMP.transition);
/** Length of the trench's way-out ramp (m). */
export const EXIT_LEN = TRENCH.depth / TRENCH.exitGrade;
/** The trench in the run's frame: u0..u1 along it, w0..w1 across (the way-out ramp included). */
export const TRENCH_BOX = {
  u0: LIP_U,
  u1: LIP_U + TRENCH.length,
  w0: TRENCH.w0,
  w1: TRENCH.floorTo + EXIT_LEN,
} as const;

/** The mound's centreline height at `u` (m above grade). */
export function rampProfile(u: number): number {
  const t = Math.min(Math.max(u - RAMP.start, 0), RAMP.length);
  const s = RAMP.lipGrade;
  const lt = RAMP.transition;
  return t < lt ? (s * t * t) / (2 * lt) : s * (lt / 2 + t - lt);
}

/** Where the profile first reaches `h` (u). */
function profileAt(h: number): number {
  const s = RAMP.lipGrade;
  const lt = RAMP.transition;
  const hT = (s * lt) / 2;
  return RAMP.start + (h <= hT ? Math.sqrt((2 * lt * h) / s) : lt + (h - hT) / s);
}

/** The mound's drivable top at (u, w), m above grade; null off it. */
export function rampHeightAt(u: number, w: number): number | null {
  if (u < RAMP.start || u > LIP_U) return null;
  const half = RAMP.width / 2;
  const aw = Math.abs(w);
  if (aw > half) return null;
  const t = Math.min(1, (half - aw) / RAMP.shoulder);
  return rampProfile(u) * t;
}

/** Depth of the dig at (u, w) (m, ≥ 0). */
export function trenchDepthAt(u: number, w: number): number {
  if (u < TRENCH_BOX.u0 || u > TRENCH_BOX.u1 || w < TRENCH_BOX.w0 || w > TRENCH_BOX.w1) return 0;
  if (w <= TRENCH.floorTo) return TRENCH.depth;
  return TRENCH.depth * (1 - (w - TRENCH.floorTo) / EXIT_LEN);
}

/** World-axis rectangle of a (u, w) box. */
export function rwRect(u0: number, u1: number, w0: number, w1: number): Rect {
  const pts = [rwWorld(u0, w0), rwWorld(u1, w0), rwWorld(u1, w1), rwWorld(u0, w1)];
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minZ: Math.min(...pts.map((p) => p.z)),
    maxZ: Math.max(...pts.map((p) => p.z)),
  };
}

/** The works' own land: the street and both pavements from the crossing to past the dig. */
export const WORKS_LOT = rwRect(BLOCK.u0, DETOUR.u1, STREET.north, STREET.south);
/** The strip of lot north of the street the desvío runs on (plots cut back to it). */
export const DETOUR_CLIP = rwRect(BLOCK.u0, DETOUR.u1, DETOUR.w0, STREET.north);
/** The notch of lot south of the street the crews' ramp climbs into (plots cut back to it). */
export const EXIT_CLIP = rwRect(LIP_U - 3, LIP_U + 25, STREET.south, TRENCH_BOX.w1 + 9);

/* ------------------------------------------------------------------ what stands on the site */

/** A tiny deterministic generator, so the jitter below is the same on every load. */
function rngOf(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One precast jersey barrier, 2 m of it, pushed about by years of cars. */
export interface RwBarrier {
  x: number;
  z: number;
  /** Unit direction along it. */
  dx: number;
  dz: number;
  len: number;
  /** Knocked over: lying on its side, still in the way. */
  fallen: boolean;
  /** An amber flasher bolted on top (most are dead). */
  flasher: 'none' | 'dead' | 'live';
}

/** A run of site hoarding, from a to b (none on this site today: the street's walls are buildings). */
export interface RwHoarding {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit normal pointing onto the site. */
  nx: number;
  nz: number;
}

/** A solid thing standing on the site, axis-aligned. */
export interface RwSolid {
  kind: 'office' | 'excavator' | 'culverts' | 'gravel' | 'plates' | 'lamp';
  x: number;
  z: number;
  /** Footprint along x and z, and height (m). */
  sx: number;
  sz: number;
  h: number;
  /** Which way it faces (radians about y; 0 faces +z). Art only: the collider is the footprint. */
  face: number;
}

const BARRIER_LEN = 2;

/** A line of barriers from (u, w) a to b in the run's frame, jittered by `mess` (0..1). */
function barrierLine(ua: number, wa: number, ub: number, wb: number, seed: number, mess: number, out: RwBarrier[]): void {
  const a = rwWorld(ua, wa);
  const b = rwWorld(ub, wb);
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.round(len / BARRIER_LEN));
  const dx = (b.x - a.x) / len;
  const dz = (b.z - a.z) / len;
  const rng = rngOf(seed);
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * len;
    const jog = (rng() - 0.5) * 0.5 * mess;
    const turn = (rng() - 0.5) * 0.35 * mess;
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    const fallen = rng() < 0.08 * mess;
    const f = rng();
    out.push({
      x: a.x + dx * s - dz * jog,
      z: a.z + dz * s + dx * jog,
      dx: dx * c - dz * sn,
      dz: dz * c + dx * sn,
      len: BARRIER_LEN - 0.08,
      fallen,
      flasher: fallen || f > 0.3 ? 'none' : f < 0.07 ? 'live' : 'dead',
    });
  }
}

function buildBarriers(): RwBarrier[] {
  const out: RwBarrier[] = [];
  const { u0, u1 } = TRENCH_BOX;
  // The desvío's fence: the whole works, from the crossing to past the dig, kept off the lane.
  barrierLine(BLOCK.u0 + 3, DETOUR.w1 + 0.4, u1 + 6, DETOUR.w1 + 0.4, 21, 0.4, out);
  // Across the south pavement beside the mound, and the dig's far edge on it: nobody rolls in.
  barrierLine(u0 - 1.8, STREET.half + 1.2, u0 - 1.8, STREET.south - 0.5, 22, 0.6, out);
  barrierLine(u1 + 1.8, STREET.half + 1.8, u1 + 1.8, STREET.south - 0.5, 23, 0.7, out);
  // Round the notch the crews' ramp climbs into, clear of its mouth.
  barrierLine(u0 - 1.8, STREET.south + 0.5, u0 - 1.8, TRENCH_BOX.w1 - 2, 24, 0.8, out);
  // (east of the notch only over the deep end: past it, the way out of the crews' ramp is open)
  barrierLine(u1 + 1.8, STREET.south + 1, u1 + 1.8, STREET.south + 8.5, 25, 0.8, out);
  // The ones that used to close the street, shoved onto the south pavement at the foot of the mound.
  barrierLine(RAMP.start - 2, STREET.half + 1.5, RAMP.start + 2.5, STREET.half + 2.6, 27, 1, out);
  // The desvío's far end: a diagonal line that turns the lane back onto the street before the
  // buildings stand at the kerb again.
  barrierLine(DETOUR.u1 - 13, DETOUR.w0 + 0.6, DETOUR.u1 - 0.5, STREET.north - 0.4, 28, 0.5, out);
  return out;
}

function buildSolids(): RwSolid[] {
  const { u0 } = TRENCH_BOX;
  return [
    // A site light mast in the notch past the dig: its one working lamp is turned back on the
    // lip, which is how the mound reads from the run-up at night.
    { kind: 'lamp', ...rwWorld(u0 + 15, STREET.south + 4.5), sx: 0.8, sz: 0.8, h: 7.2, face: 0 },
    // An excavator the contractor never came back for, bucket down, at the back of the notch.
    { kind: 'excavator', ...rwWorld(u0 + 21, TRENCH_BOX.w1 + 6), sx: 7.4, sz: 3.2, h: 3.3, face: 0 },
    // Spare road plates, stacked by the notch's mouth.
    { kind: 'plates', ...rwWorld(u0 + 10, TRENCH_BOX.w1 + 6.5), sx: 3.2, sz: 1.8, h: 0.7, face: 0 },
    // Precast box culverts at the end of the desvío's strip.
    { kind: 'culverts', ...rwWorld(DETOUR.u1 - 2.5, DETOUR.w0 + 2.5), sx: 5, sz: 4.2, h: 2.8, face: 0 },
  ];
}

export const ROADWORKS_BARRIERS: RwBarrier[] = buildBarriers();
export const ROADWORKS_HOARDING: RwHoarding[] = [];
export const ROADWORKS_SOLIDS: RwSolid[] = buildSolids();

/** Hoarding height (m). */
export const HOARDING_HEIGHT = 2.4;
/** Jersey barrier height (m). */
export const BARRIER_HEIGHT = 0.82;

/* ------------------------------------------------------------------ the solids, for the sim */

function segment(ua: number, wa: number, ub: number, wb: number, maxY: number): ObstacleWall {
  const a = rwWorld(ua, wa);
  const b = rwWorld(ub, wb);
  return { ax: a.x, az: a.z, bx: b.x, bz: b.z, maxY };
}

function buildWalls(): ObstacleWall[] {
  const walls: ObstacleWall[] = [];
  const { u0, u1, w0 } = TRENCH_BOX;
  const inset = WALL_INSET;
  // Deep enough that a car at grade (or flying over) never meets them, and a car creeping off
  // an edge falls clear of them before they wake; shallow enough that a car on the floor always does.
  const deep = -2;
  // The faces across the run (the lip's and the landing's), over the flat floor.
  for (const u of [u0 + inset, u1 - inset]) walls.push(segment(u, w0 + inset, u, TRENCH.floorTo, deep));
  // Its north end.
  walls.push(segment(u0 + inset, w0 + inset, u1 - inset, w0 + inset, deep));
  // Along the way-out ramp the faces shrink: each piece of wall stops a car as high as the
  // shallow end of it, and the last stretch (a step a wheel takes) has none.
  const pieces = Math.ceil(EXIT_LEN / 1.5);
  for (let i = 0; i < pieces; i++) {
    const wa = TRENCH.floorTo + (i / pieces) * EXIT_LEN;
    const wb = TRENCH.floorTo + ((i + 1) / pieces) * EXIT_LEN;
    const shallow = TRENCH.depth * (1 - (wb - TRENCH.floorTo) / EXIT_LEN);
    if (shallow < 0.3) break;
    for (const u of [u0 + inset, u1 - inset]) walls.push(segment(u, wa, u, wb, -shallow + 0.1));
  }
  // The mound's flanks, for a car at grade: from where the side is a step worth stopping.
  const half = RAMP.width / 2 + inset;
  const from = profileAt(RAMP.flankFrom);
  const flank = Math.ceil((LIP_U - from) / 2);
  for (let i = 0; i < flank; i++) {
    const ua = from + ((LIP_U - from) * i) / flank;
    const ub = from + ((LIP_U - from) * (i + 1)) / flank;
    const maxY = Math.min(0.15, rampProfile(ua) - 0.25);
    for (const side of [-1, 1]) walls.push(segment(ua, half * side, ub, half * side, maxY));
  }
  // Barriers (a car flying over one clears it).
  for (const bar of ROADWORKS_BARRIERS) {
    const h = bar.len / 2;
    walls.push({ ax: bar.x - bar.dx * h, az: bar.z - bar.dz * h, bx: bar.x + bar.dx * h, bz: bar.z + bar.dz * h, maxY: BARRIER_HEIGHT + 0.3 });
  }
  return walls;
}

function buildColliders(): ObstacleBox[] {
  return ROADWORKS_SOLIDS.map((s) => ({
    minX: s.x - s.sx / 2,
    maxX: s.x + s.sx / 2,
    minZ: s.z - s.sz / 2,
    maxZ: s.z + s.sz / 2,
    maxY: s.h,
  }));
}

/* ------------------------------------------------------------------ the spec */

const TRENCH_BOUNDS = rwRect(TRENCH_BOX.u0, TRENCH_BOX.u1, TRENCH_BOX.w0, TRENCH_BOX.w1);
const RAMP_BOUNDS = rwRect(RAMP.start, LIP_U, -RAMP.width / 2, RAMP.width / 2);

export const ROADWORKS: SetPieceSpec = {
  tag: 'roadworks',
  // The street itself (it touches no plot: the blocks stand behind the pavements), so the
  // kerbs, the street props, sewer vents, cables and lamps keep off the works.
  lots: [WORKS_LOT],
  clipLots: [DETOUR_CLIP, EXIT_CLIP],
  cut: {
    bounds: TRENCH_BOUNDS,
    depthAt: (x, z) => trenchDepthAt(rwU(x, z), rwW(x, z)),
  },
  surfaces: [
    {
      bounds: RAMP_BOUNDS,
      heightAt: (x, z) => rampHeightAt(rwU(x, z), rwW(x, z)),
    },
  ],
  colliders: buildColliders(),
  walls: buildWalls(),
  // The ground plane and the street's own asphalt, paint and cracks are cut over the dig
  // (`env/trackBuilder.ts`, `env/roadCracks.ts`); the builder lays the rest of the box.
  groundHoles: [TRENCH_BOUNDS],
  minimapRects: [DETOUR_CLIP, EXIT_CLIP],
};
