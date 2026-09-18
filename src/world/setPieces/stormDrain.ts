import type { ObstacleBox, ObstacleWall } from '../../core/types';
import type { Rect } from '../cityPlan';
import type { SetPieceSpec, SetPieceSurface } from './types';

/**
 * CONCRETE STORM DRAIN CHANNEL (set-piece C), the LA River kind: a flat floor 8.5 m below the street
 * between two long concrete banks at 30°, each 16-21 m across, that climb all the way up to street
 * level. Corridor x 632.2..688 between av-e1's east pavement and the metro's east wall, z −95..604;
 * then a culvert takes the floor underground, south under st-s4-e and av-s2-e, and a ramp brings
 * it back up to a lot on av-e1 at z 858. Visuals: `render/scene/env/setPieces/stormDrainBuilder.ts`.
 * Contract: `render/scene/env/setPieces/index.ts`.
 *
 * THE SECTION. Floor, then each bank: a 7 m concave toe (radius ≈ 12 m) into a straight 0.58 grade.
 * The WEST bank runs out at street level at x 633.5 with a rounded lip (a C1 soft clamp): past it is
 * av-e1's pavement, and nothing in between — a car driven up and over it flies out onto the
 * avenue. The EAST bank tops out a metre or so under grade against the city's perimeter wall.
 * Everything below grade is ONE continuous function (`stormDrainDepth`), which the builder draws
 * too, so what a car is seen on is what it drives on.
 *
 * THE STUBS. st-south, blvd-ring-s, st-s3 and av-s1 cross on decks at grade (a `surfaces` slab),
 * 7.6 m over the floor. Under each deck the top of both banks is an ABUTMENT: a box collider only
 * for a car between y −3.8 and −0.3, so a car high on a bank meets the bridge's face instead of
 * driving through its soffit, one on the floor or low on a bank drives under, and one on the deck
 * (y ≈ 0) never touches it. Parapets on the decks' edges stop only a car on the deck.
 *
 * THE CULVERT. At z 604 a headwall closes the channel with an arched mouth 18 m wide over the floor;
 * behind it a vaulted tunnel (floor −8.5, crown −1.2: 7.3 m clear) runs 196 m south under the plots
 * and streets, whose buildings stand on over it (`underpasses`: their colliders only count above
 * y −1.5), then an open cut ramps up at ≤ 0.23 grade between two retaining walls into the plot
 * north of st-s5-e, cleared to a lot that opens onto av-e1. (Not up to st-s5-e itself: the plot
 * between carries the north ends of three strings of lamps across it.)
 *
 * WHY THE TUNNEL IS NOT A TRENCH UNDER st-s4-e. The three strings of lamps across st-s4-e hang from
 * the plots either side of it, and the one south of it is 9.7 m deep: `clipBlocksToLots` drops any
 * piece under 10 m, so cutting a trench through it would take the strings down. Under it, they stay.
 *
 * THE RULE FOR EVERY WALL LINE facing a step in the ground: the ground on the car's side runs on
 * ≥ 2 m past it — a wheel reaches 0.43 m past a line the 1.1 m circle is held off, a car at 57 m/s
 * gets up to 0.95 m into it before the collision pass, and the surface field's gradient looks
 * 0.25 m further. Measured: at 1 m a car run into the headwall at 40 m/s was thrown 93 m up.
 */
export const STORM_DRAIN_RESERVED = { minX: 632.2, maxX: 688, minZ: -95, maxZ: 1040 } as const;

/** Everything configurable. All of the spec below is derived from this, deterministically. */
export const STORM_DRAIN_CONFIG = {
  /** The lot's west edge: the face of av-e1's east pavement. */
  lotWest: 632.2,
  /** Where the west bank's rounded lip meets street level. */
  lipX: 633.5,
  /** East side: the metro's perimeter wall face (`wall-e`, x 688..700). */
  eastX: 688,
  /** Floor depth below grade (m). */
  depth: 8.5,
  /**
   * Both banks: straight grade (0.58 = 30°) and the length of the concave toe into it (m). 35° (0.7)
   * was measured too: the same rides fly ~40% higher off it (the road only pushes up, so a bank
   * turns sideways speed into vertical speed at its grade), and the floor would be 4 m narrower.
   */
  bank: { grade: 0.58, fillet: 7 },
  /** Soft clamp at the lip (m of depth): the lip's curvature is grade² / (2 · rim). */
  rim: 1.6,
  /** Depth of the east bank's top against the perimeter wall: `mean` ± `swing` along a `wave` (m). */
  eastTop: { mean: 1.1, swing: 0.5, wave: 260, phase: 40 },
  /** The north head: the floor climbs to grade on a cosine between `full` and `dry`. */
  north: { dry: -92, full: -25 },
  /** The stubs' decks at grade over [z0, z1] (roadway ± 5 m), their thickness, and the abutments. */
  bridges: [
    { road: 'st-south', z0: -1.5, z1: 21.5 },
    { road: 'blvd-ring-s', z0: 205, z1: 235 },
    { road: 'st-s3', z0: 348.5, z1: 371.5 },
    { road: 'av-s1', z0: 486, z1: 514 },
  ],
  deck: { thickness: 0.9, parapetMinY: -0.3 },
  /** Under a deck, a car may be on a bank only below this (m, world y): its roof clears the soffit. */
  abutmentY: -3.8,
  /**
   * The rows of plots the channel takes (their z extents), full width. Never the open ground of a
   * gap round a stub: a lot within 11.2 m of a road edge is a face the kerbs pave out to
   * (`kerbs.ts`), which would widen the stubs' pavements and move their micro-scenes.
   */
  rows: [
    [-95, -11.9],
    [32.1, 195.8],
    [245.9, 342.7],
    [378.9, 476.6],
    [512.2, 617.7],
  ] as Array<[number, number]>,
  /** The culvert: headwall, tunnel walls' faces (x), crown and springline (world y), exit portal. */
  tunnel: { portalZ: 604, west: 654, east: 672, crown: -1.2, spring: -4.4, exitZ: 800, guard: 2 },
  /** The exit ramp: from the floor at `exitZ` up to grade at `topZ` in a cut; the lot round it, cleared. */
  ramp: { topZ: 858, cutEnd: 858, lot: { minZ: 791.6, maxZ: 875.6 } },
  /**
   * The land taken starts at the plots' old face on av-e1 (m): the avenue's pavement keeps the face
   * it paves out to, and its kerb-side micro-scenes keep the solid ground behind them that ruled
   * them out before (tried at 640.5: av-e1 gained seven new ones and the chain of 70 m spacings
   * dropped two elsewhere).
   */
  lotFrom: 632.2,
  /** Buildings over the tunnel are solid only above this (m, world y). */
  underY: -1.5,
  /** Height of the headwalls' and the cut's parapets over grade (art), and where they stop a car. */
  parapet: 1.0,
} as const;

const C = STORM_DRAIN_CONFIG;
const T = C.tunnel;

/* ------------------------------------------------------------------ the profile */

/** Height above the toe `s` metres up a bank: a parabolic toe into a straight grade. 0 below the toe. */
export function bankHeight(s: number, grade: number = C.bank.grade, fillet: number = C.bank.fillet): number {
  if (s <= 0) return 0;
  if (s < fillet) return (grade * s * s) / (2 * fillet);
  return (grade * fillet) / 2 + grade * (s - fillet);
}

/** Metres from the toe at which the straight part of a bank reaches `h` (inverse of `bankHeight`). */
export function bankRun(h: number, grade: number = C.bank.grade, fillet: number = C.bank.fillet): number {
  return fillet / 2 + h / grade;
}

/** max(u, 0), rounded over ±r: C1, so a lip is a curve and never a kink. */
function softPos(u: number, r: number): number {
  if (u >= r) return u;
  if (u <= -r) return 0;
  return ((u + r) * (u + r)) / (4 * r);
}

/** 0 → 1 as t goes 0 → 1, with zero slope at both ends. */
function ease(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

/** Depth of the channel's floor at z (the north head climbs to grade). */
export function floorDepth(z: number): number {
  return z < C.north.full ? C.depth * ease((z - C.north.dry) / (C.north.full - C.north.dry)) : C.depth;
}

/** The floor's two toes at z. The west is fixed by the lip; the east swings with the bank's top. */
export function floorToes(z: number): { west: number; east: number } {
  const e = C.eastTop;
  const top = e.mean + e.swing * Math.sin((2 * Math.PI * (z - e.phase)) / e.wave);
  return { west: C.lipX + bankRun(C.depth + C.rim), east: C.eastX - bankRun(C.depth - top) };
}

/** The open channel's depth below grade at (x, z). */
function channelDepth(x: number, z: number): number {
  const df = floorDepth(z);
  if (df <= 0) return 0;
  const toes = floorToes(z);
  return softPos(df - bankHeight(toes.west - x) - bankHeight(x - toes.east), C.rim);
}

/** Depth of the tunnel's and the exit ramp's floor at z. */
export function tunnelDepth(z: number): number {
  if (z <= T.exitZ) return C.depth;
  return C.depth * (1 - ease((z - T.exitZ) / (C.ramp.topZ - T.exitZ)));
}

/** Metres below grade at (x, z): the one function the sim and the art both read. */
export function stormDrainDepth(x: number, z: number): number {
  if (z < T.portalZ) return channelDepth(x, z);
  if (x >= T.west - T.guard && x <= T.east + T.guard && z <= C.ramp.cutEnd) return tunnelDepth(z);
  return 0;
}

/** The bridge whose deck covers z, if any. */
export function bridgeAt(z: number): (typeof C.bridges)[number] | null {
  for (const br of C.bridges) if (z >= br.z0 && z <= br.z1) return br;
  return null;
}

/** x on the west bank where the open channel is `d` deep (full depth), and the same on the east at z. */
export function bankXAtDepth(d: number, z: number): { west: number; east: number } {
  const toes = floorToes(z);
  const run = bankRun(C.depth - d);
  return { west: toes.west - run, east: toes.east + run };
}

/* ------------------------------------------------------------------ the spec */

const PIECE: Rect = { minX: C.lotWest - 1.5, maxX: C.eastX + 3, minZ: C.rows[0][0] - 1, maxZ: C.ramp.cutEnd + 1 };

/**
 * One slab at grade: every bridge deck across its whole width, the ground over the tunnel (its
 * roof) from the headwall to the exit portal, and the strips behind the exit cut's walls.
 */
const GRADE_SLAB: SetPieceSurface = {
  bounds: PIECE,
  heightAt(x, z) {
    if (bridgeAt(z)) return 0;
    if (z >= T.portalZ && z <= T.exitZ && x >= T.west - T.guard - 0.6 && x <= T.east + T.guard + 0.6) return 0;
    // Beside the exit cut, the guard strips behind its walls, for a car on the lot at grade.
    if (z > T.exitZ && z <= C.ramp.cutEnd && ((x >= T.west - T.guard - 0.6 && x <= T.west + 0.6) || (x >= T.east - 0.6 && x <= T.east + T.guard + 0.6))) return 0;
    return null;
  },
};

function buildWalls(): ObstacleWall[] {
  const walls: ObstacleWall[] = [];
  // Each deck's parapets, over the drop: only a car on the deck meets them. A metre in from the
  // deck's edge, so a car held off one still has all four wheels on the deck.
  for (const br of C.bridges) {
    const mid = (br.z0 + br.z1) / 2;
    const from = bankXAtDepth(0.6, mid).west;
    for (const z of [br.z0 + 1, br.z1 - 1]) walls.push({ ax: from, az: z, bx: C.eastX, bz: z, minY: C.deck.parapetMinY });
  }
  // The headwall: across the banks for a car in the channel (the ground runs on to z 604, 2.2 m
  // behind the line: a wheel reaches 0.43 m past it, plus up to 0.95 m a tick at 57 m/s before the
  // collision pass, plus the 0.25 m the surface field's gradients look ahead); across the whole width for a car on the lot above (whose ground is grade).
  const face = T.portalZ - 2.2;
  walls.push({ ax: C.lotWest, az: face, bx: T.west, bz: face });
  walls.push({ ax: T.east, az: face, bx: C.eastX, bz: face });
  walls.push({ ax: C.lotWest, az: T.portalZ + 0.6, bx: C.eastX, bz: T.portalZ + 0.6, minY: C.underY });
  // The tunnel's walls (only for a car in it: the street is above), then the cut's (for everything).
  for (const x of [T.west, T.east]) {
    walls.push({ ax: x, az: face, bx: x, bz: T.exitZ, maxY: C.underY });
    walls.push({ ax: x, az: T.exitZ, bx: x, bz: C.ramp.cutEnd });
  }
  // The exit portal's headwall, for a car on the ground over the tunnel.
  walls.push({ ax: T.west - T.guard - 0.6, az: T.exitZ - 0.6, bx: T.east + T.guard + 0.6, bz: T.exitZ - 0.6, minY: C.underY });
  return walls;
}

/** Under each deck, the top of both banks: solid only for a car at a height its roof would hit the deck. */
function buildAbutments(): ObstacleBox[] {
  const out: ObstacleBox[] = [];
  for (const br of C.bridges) {
    const at = bankXAtDepth(-C.abutmentY, (br.z0 + br.z1) / 2);
    const y = { minY: C.abutmentY, maxY: C.deck.parapetMinY };
    out.push({ minX: C.lotWest, maxX: at.west, minZ: br.z0, maxZ: br.z1, ...y });
    out.push({ minX: at.east, maxX: C.eastX + 1, minZ: br.z0, maxZ: br.z1, ...y });
  }
  return out;
}

export const STORM_DRAIN: SetPieceSpec = {
  tag: 'storm-drain',
  lots: [],
  // The corridor's plot rows and the exit ramp's plot. Plots are cut back, never deleted whole: the one strip left of
  // the plot north of st-s4-e (z 617.7..630.3) still carries its strings of lamps.
  clipLots: [
    ...C.rows.map(([z0, z1]) => ({ minX: C.lotFrom, maxX: C.eastX, minZ: z0, maxZ: z1 })),
    { minX: C.lotFrom, maxX: C.eastX, minZ: C.ramp.lot.minZ, maxZ: C.ramp.lot.maxZ },
  ],
  cut: { bounds: PIECE, depthAt: stormDrainDepth },
  surfaces: [GRADE_SLAB],
  colliders: buildAbutments(),
  walls: buildWalls(),
  groundHoles: [
    { minX: C.lipX - 0.5, maxX: C.eastX, minZ: C.rows[0][0], maxZ: T.portalZ },
    { minX: T.west - T.guard, maxX: T.east + T.guard, minZ: T.exitZ, maxZ: C.ramp.cutEnd },
  ],
  minimapRects: [
    { minX: C.lipX, maxX: C.eastX, minZ: C.north.dry, maxZ: T.portalZ },
    { minX: T.west, maxX: T.east, minZ: T.portalZ, maxZ: C.ramp.cutEnd },
  ],
  underpasses: [{ minX: T.west - T.guard, maxX: T.east + T.guard, minZ: T.portalZ, maxZ: T.exitZ, minY: C.underY }],
};
