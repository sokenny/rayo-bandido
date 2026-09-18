import type { ObstacleWall } from '../../core/types';
import type { Rect } from '../cityPlan';
import type { SetPieceSpec, SetPieceSurface } from './types';

/**
 * COLLAPSED PARKING GARAGE (set-piece B, tag 'parkade'). A three-level brutalist parkade on the
 * block between av-w1, st-w3, st-n3 and blvd-ring-n, its south-east corner fallen in. Visuals:
 * `render/scene/env/setPieces/parkadeBuilder.ts`. Contract: `render/scene/env/setPieces/index.ts`.
 *
 * THE DRIVE (orientation 0, the one placed: the jump flies south-south-east, down st-w3).
 *   L0 (grade, y 0)  open between columns; in off st-w3's pavement through the east face, onto
 *   ramp A           the middle row, climbing WEST to L1.
 *   L1 (y LEVEL_H)   U-turn round the column in the west bay, onto
 *   ramp B           the north row, climbing EAST to the roof.
 *   L2 (y 2·LEVEL_H) the roof, open to the sky: drift room over the middle and south rows.
 *                    Off ramp B's top, a walled CHUTE runs south across the east bay into the
 *                    broken corner: its last metres heaved up (the lip), past it the roof gone.
 *   jump             off the lip, over the fallen corner, down onto THE EXIT: L1's own way out,
 *                    a bridge out of the south face and a straight ramp down to the lot, laid in
 *                    the jump's line and falling with it.
 *   THE LINE         The lot is one city block: every straight line out of it at street level
 *                    meets a facade 23-51 m past its edge, except down st-w3, the one long clear
 *                    straight in reach (1.6 km south of blvd-ring-n, nothing solid on it, no
 *                    buses). So the chute, the lip and the exit are turned `JUMP_ANGLE` east of
 *                    south and placed so the line clears blk-428's corner and runs into st-w3's
 *                    lanes: slow jumps touch down on the exit, fast ones on the lot, the
 *                    boulevard or st-w3 itself, and all of them roll on down st-w3.
 *   back             the same ramps down (B west to L1, round the column, A east to L0), or L1's
 *                    south row to the exit and out. The exit is also a way in from the street.
 *
 * PHYSICS NOTES. Every drivable top is a `surfaces` slab (floors hold y, ramps ease in and out so
 * no crest launches below ~23 m/s and no step ever lifts a car); every vertical edge is a wall or
 * box y-bounded to the levels it exists at, and DRAWN (the builder draws each one; see the audit
 * in the report): a floor's rails stop only cars on that floor, a ramp's side walls stop both the
 * cars on it and the cars on the floor it passes through, columns stop everything below the roof.
 * A car's wheels reach 1.53 m from its centre and its collision circle only 1.1 m, so every slab
 * runs `OVERHANG` past the rail that keeps a car on it, and a rail between two different tops is
 * two rails a metre apart (the ramp's own on its lane edge, the floor's on the column line).
 *
 * Everything is derived from the constants below, in a LOCAL frame: u across (west→east when
 * ORIENT is 0), v toward the jump (0 at the garage's north face). `ORIENT` turns that frame by
 * quarter turns about `ORIGIN`; only orientation 0 is dimensioned to fit the reserved lot.
 */
export const PARKADE_RESERVED = { minX: -607.8, maxX: -491.5, minZ: -590.3, maxZ: -480.3 } as const;

/* ------------------------------------------------------------------ the knobs */

/** World position of local (0, 0): the garage's north-west corner at orientation 0. */
export const ORIGIN = { x: -564.1, z: -589 } as const;
/** Quarter turns of the local frame (0: the jump flies south, +z). Only 0 fits the lot. */
export const ORIENT = 0 as 0 | 1 | 2 | 3;
/** Rows across v (north: ramp B, middle: ramp A, south: L1's way to the exit). */
export const ROW = 16;
export const ROWS = 3;
/** The west turning bay, the ramps' run, the east bay (the runway on the roof). */
export const BAY_W = 14;
export const RAMP_RUN = 38;
export const BAY_E = 20;
/** Floor to floor, and the slab's thickness (headroom = LEVEL_H - SLAB). */
export const LEVEL_H = 5.2;
export const SLAB = 0.45;
/** Length of each ramp's rounded ends (m): a crest launches above sqrt(g · RAMP_EASE / grade). */
export const RAMP_EASE = 10;
/** A ramp lane's edge in from its row's column lines (m). */
export const RAMP_INSET = 1;
/**
 * The heaved slab at the end of the runway: length, how high it stands, its west taper. It rises
 * and levels off at the tip (a smoothstep), so it launches flat: the flight then stays on the
 * exit ramp from walking pace to nitro (see the report), where an upturned lip threw fast cars
 * past the ramp and across the boulevard.
 */
export const KICK_LEN = 8;
export const KICK_RISE = 0.45;
/** Where the lip's tip is, back from the garage's south face (m): the fallen span. */
export const KICK_TIP_BACK = 4;
/**
 * THE JUMP LANE: the chute, the lip and the exit share one straight line, turned this far east
 * of south (rad), its centre this far along u at the lip's tip, this wide (half). Tied to st-w3:
 * the line has to clear blk-428's north-east corner (x -491.5, z -434.3) and the exit's foot has
 * to stay inside the lot. Check both with the headless drive if any of these move.
 */
export const JUMP_ANGLE = (8.5 * Math.PI) / 180;
export const LANE_TIP_U = 60.9;
export const LANE_HALF = 4;
/** Where the chute's rails start (v): far enough south of ramp B's top to turn in without a scrape. */
export const CHUTE_V0 = 22;
/** THE EXIT: the flat bridge out of L1, and the ramp's run down to grade. */
export const EXIT_BRIDGE = 4;
export const EXIT_RUN = 41;
export const EXIT_EASE_TOP = 12;
export const EXIT_EASE_FOOT = 8;
/** Column section (m). */
export const COLUMN = 0.9;
/** How far a slab runs past the rail that keeps a car on it, and a perimeter rail's inset. */
export const OVERHANG = 0.5;
export const RAIL_IN = 0.6;
/** The stair and lift core against the west face (local), and how tall it stands. */
export const STAIR_CORE = { u0: -3.4, u1: 0, v0: 20, v1: 27.5, top: 15.5 } as const;
/** The dead ticket booth on the east apron, beside the way in (local). */
export const BOOTH = { u0: -28, u1: -25.6, v0: 30, v1: 34.5, top: 2.6 } as const;

/* ------------------------------------------------------------------ derived */

const W = BAY_W + RAMP_RUN + BAY_E;
const D = ROWS * ROW;
const L1 = LEVEL_H;
const L2 = 2 * LEVEL_H;
const R_U0 = BAY_W;
const R_U1 = BAY_W + RAMP_RUN;
const KICK_TIP = D - KICK_TIP_BACK;
const KICK_V0 = KICK_TIP - KICK_LEN;
const EXIT_V0 = D;
const EXIT_V_RAMP = D + EXIT_BRIDGE;
const EXIT_V1 = EXIT_V_RAMP + EXIT_RUN;
const LANE_TAN = Math.tan(JUMP_ANGLE);
/** The jump lane's centre line (u at a v). */
export const laneU = (v: number): number => LANE_TIP_U + (v - KICK_TIP) * LANE_TAN;
/** Signed distance across the lane from its centre line (+ east). */
const acrossLane = (u: number, v: number): number => (u - laneU(v)) * Math.cos(JUMP_ANGLE);

/** Height ranges the rails and walls are solid in, by what stands on them (car y). */
const BELOW = -2;
const OVER = 2.6;
const R0 = { minY: BELOW, maxY: OVER };
const R1 = { minY: L1 - 1.6, maxY: L1 + OVER };
const R2 = { minY: L2 - 1.6, maxY: L2 + OVER };

/** Local rectangle. */
export interface LRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}
const inL = (r: LRect, u: number, v: number): boolean => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1;

/** A rise of `h` over `len`, eased in over `e0` and out over `e1` (height at `s` along it). */
export function easedRise(s: number, len: number, h: number, e0: number, e1: number): number {
  const g = h / (len - (e0 + e1) / 2);
  if (s <= 0) return 0;
  if (s >= len) return h;
  if (s < e0) return (g * s * s) / (2 * e0);
  if (s <= len - e1) return g * (s - e0 / 2);
  const r = len - s;
  return h - (g * r * r) / (2 * e1);
}

/** The frame. */
export function toWorld(u: number, v: number): { x: number; z: number } {
  switch (ORIENT) {
    case 1:
      return { x: ORIGIN.x - v, z: ORIGIN.z + u };
    case 2:
      return { x: ORIGIN.x - u, z: ORIGIN.z - v };
    case 3:
      return { x: ORIGIN.x + v, z: ORIGIN.z - u };
    default:
      return { x: ORIGIN.x + u, z: ORIGIN.z + v };
  }
}
const LOCAL = { u: 0, v: 0 };
/** World → local (shared scratch: read it before the next call). */
export function toLocal(x: number, z: number): { u: number; v: number } {
  const dx = x - ORIGIN.x;
  const dz = z - ORIGIN.z;
  switch (ORIENT) {
    case 1:
      LOCAL.u = dz;
      LOCAL.v = -dx;
      break;
    case 2:
      LOCAL.u = -dx;
      LOCAL.v = -dz;
      break;
    case 3:
      LOCAL.u = -dz;
      LOCAL.v = dx;
      break;
    default:
      LOCAL.u = dx;
      LOCAL.v = dz;
  }
  return LOCAL;
}
/** World heading of a local direction (du, dv) (radians, 0 = north, the game's convention). */
export function headingOf(du: number, dv: number): number {
  const a = toWorld(du, dv);
  const b = toWorld(0, 0);
  return Math.atan2(a.x - b.x, -(a.z - b.z));
}
export function worldRect(r: LRect): Rect {
  const a = toWorld(r.u0, r.v0);
  const b = toWorld(r.u1, r.v1);
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

/* ------------------------------------------------------------------ the parts */

/**
 * A straight ramp: its lane, the axis it runs along, the along-coordinate of its foot and of its
 * top, and the heights there.
 */
export interface RampDef {
  lane: LRect;
  axis: 'u' | 'v';
  foot: number;
  top: number;
  y0: number;
  y1: number;
}
/** Height of a ramp at an along-coordinate. */
export function rampAt(r: RampDef, a: number): number {
  const len = Math.abs(r.top - r.foot);
  const s = (a - r.foot) * Math.sign(r.top - r.foot);
  return r.y0 + easedRise(s, len, r.y1 - r.y0, RAMP_EASE, RAMP_EASE);
}

const rampA: RampDef = { lane: { u0: R_U0, u1: R_U1, v0: ROW + RAMP_INSET, v1: 2 * ROW - RAMP_INSET }, axis: 'u', foot: R_U1, top: R_U0, y0: 0, y1: L1 };
const rampB: RampDef = { lane: { u0: R_U0, u1: R_U1, v0: RAMP_INSET, v1: ROW - RAMP_INSET }, axis: 'u', foot: R_U0, top: R_U1, y0: L1, y1: L2 };

/** Everything the builder draws from, in the local frame. */
export const PARKADE_GEOM = {
  width: W,
  depth: D,
  L1,
  L2,
  slab: SLAB,
  column: COLUMN,
  row: ROW,
  footprint: { u0: 0, u1: W, v0: 0, v1: D } as LRect,
  rampA,
  rampB,
  /** The jump lane: centre line u(v), half width, and the stretches along v it is made of. */
  laneU,
  laneHalf: LANE_HALF,
  laneTan: LANE_TAN,
  laneCos: Math.cos(JUMP_ANGLE),
  chute: { v0: CHUTE_V0, v1: KICK_V0 },
  kick: { v0: KICK_V0, v1: KICK_TIP },
  /** The roof that is gone past the lip: everything east of the lane's west edge. */
  fallen: { u0: LANE_TIP_U - LANE_HALF / Math.cos(JUMP_ANGLE), u1: W, v0: KICK_TIP, v1: D } as LRect,
  /** The exit: bridge (v0..vRamp, flat at L1) and ramp (vRamp..v1, down to grade), along the lane. */
  exit: { v0: EXIT_V0, vRamp: EXIT_V_RAMP, v1: EXIT_V1 },
  kickRise: KICK_RISE,
  /** Column lines. */
  columnsU: [0, R_U0, (R_U0 + R_U1) / 2, R_U1, W],
  columnsV: Array.from({ length: ROWS + 1 }, (_, i) => i * ROW),
  /** The exit's drop below L1 at a distance past the bridge. */
  exitDrop: (s: number): number => easedRise(s, EXIT_RUN, L1, EXIT_EASE_TOP, EXIT_EASE_FOOT),
};
const G = PARKADE_GEOM;

/** Every column that stands (and has a collider). */
export function parkadeColumns(): Array<{ u: number; v: number }> {
  const out: Array<{ u: number; v: number }> = [];
  for (const u of G.columnsU) for (const v of G.columnsV) out.push({ u, v });
  return out;
}
/** Is a point inside the jump lane (widened by `extra` each side)? */
export function inLane(u: number, v: number, extra = 0): boolean {
  return Math.abs(acrossLane(u, v)) <= LANE_HALF + extra;
}
/** u of a point on the lane's edge line at `off` metres across (+ east) at a v. */
export function laneEdgeU(off: number, v: number): number {
  return laneU(v) + off / Math.cos(JUMP_ANGLE);
}

/**
 * How far the broken slab has heaved at a point: inside the lane only (its rails stand on it),
 * rising along v and levelling off at the tip.
 */
export function kickHeave(u: number, v: number): number {
  if (!inLane(u, v)) return 0;
  const t = Math.max(0, Math.min(1, (v - KICK_V0) / KICK_LEN));
  return KICK_RISE * t * t * (3 - 2 * t);
}

/** A ramp lane widened across by the overhang (the ramp's own slab). */
const wide = (r: RampDef): LRect =>
  r.axis === 'u' ? { ...r.lane, v0: r.lane.v0 - OVERHANG, v1: r.lane.v1 + OVERHANG } : { ...r.lane, u0: r.lane.u0 - OVERHANG, u1: r.lane.u1 + OVERHANG };
/** A floor's slot over a ramp: the widened lane, stopping `OVERHANG` short of the rail at the end the floor must reach past. */
const slot = (r: RampDef, keepAt: number): LRect => {
  const w = wide(r);
  const lo = r.axis === 'u' ? w.u0 : w.v0;
  const hi = r.axis === 'u' ? w.u1 : w.v1;
  const a0 = keepAt <= lo + 1e-6 ? lo + OVERHANG : lo + 1e-6;
  const a1 = keepAt >= hi - 1e-6 ? hi - OVERHANG : hi - 1e-6;
  return r.axis === 'u' ? { ...w, u0: a0, u1: a1 } : { ...w, v0: a0, v1: a1 };
};
/** L1 runs on over ramp A's foot end (its rail is there) and over ramp B's top end (the wall under it). */
const L1_SLOT_A = slot(rampA, rampA.foot);
const L1_SLOT_B = slot(rampB, rampB.top);
/** L2 runs on over ramp B's foot end (its rail is there). */
const L2_SLOT_B = slot(rampB, rampB.foot);

export function level1Y(u: number, v: number): number | null {
  if (!inL(G.footprint, u, v)) return null;
  if (inL(L1_SLOT_A, u, v) || inL(L1_SLOT_B, u, v)) return null;
  return L1;
}
export function level2Y(u: number, v: number): number | null {
  if (!inL(G.footprint, u, v)) return null;
  if (inL(L2_SLOT_B, u, v)) return null;
  if (v > KICK_TIP && u >= G.fallen.u0) return null;
  return v > KICK_V0 ? L2 + kickHeave(u, v) : L2;
}
export function rampAY(u: number, v: number): number | null {
  return inL(wide(rampA), u, v) ? rampAt(rampA, u) : null;
}
export function rampBY(u: number, v: number): number | null {
  return inL(wide(rampB), u, v) ? rampAt(rampB, u) : null;
}
/** The exit: flat at L1 over the bridge, then down the ramp to grade, inside the lane. */
export function exitY(u: number, v: number): number | null {
  if (v < EXIT_V0 || v > EXIT_V1 || !inLane(u, v)) return null;
  return v <= EXIT_V_RAMP ? L1 : L1 - G.exitDrop(v - EXIT_V_RAMP);
}
/** The exit's bounds, for the surface field. */
const EXIT_BOUNDS: LRect = { u0: laneU(EXIT_V0) - LANE_HALF - 1, u1: laneU(EXIT_V1) + LANE_HALF + 1, v0: EXIT_V0, v1: EXIT_V1 };

function surface(r: LRect, local: (u: number, v: number) => number | null): SetPieceSurface {
  return {
    bounds: worldRect(r),
    heightAt(x: number, z: number): number | null {
      const p = toLocal(x, z);
      return local(p.u, p.v);
    },
  };
}

/* ------------------------------------------------------------------ solids */

/** A wall in local terms, with the range of car heights it stops. Exported for the builder and the audit. */
export interface LWall {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  minY: number;
  maxY: number;
  /** What the builder draws for it. */
  kind: 'parapet' | 'kerb' | 'face';
}
export interface LBox {
  r: LRect;
  minY: number;
  maxY: number;
  kind: 'column' | 'rubble' | 'wreck' | 'core' | 'booth';
}

/**
 * Rubble and wrecks, local: [u, v, half-size u, half-size v, level]. Kept off the lanes: the
 * route's turns, the ramps' mouths, the runway and the exit's mouth are clear.
 */
export const PARKADE_RUBBLE: Array<[number, number, number, number, 0 | 1]> = [
  // L1's east bay, north of the exit's mouth: the roof that fell, heaped against the east face.
  [69.4, 28, 1.6, 4, 1],
];
/** Burnt-out cars left in the stalls: [u, v, heading-along-u?, level]. */
export const PARKADE_WRECKS: Array<[number, number, boolean, 0 | 1 | 2]> = [
  [26, 5, true, 0],
  [40, 9, true, 0],
  [24, 45.5, true, 0],
  [24, 45.5, true, 1],
  [64, 22, false, 1],
];
const WRECK = { long: 4.6, wide: 2 };
export const wreckRects = (): Array<{ r: LRect; level: 0 | 1 | 2; alongU: boolean }> =>
  PARKADE_WRECKS.map(([u, v, alongU, level]) => {
    const hu = (alongU ? WRECK.long : WRECK.wide) / 2;
    const hv = (alongU ? WRECK.wide : WRECK.long) / 2;
    return { r: { u0: u - hu, u1: u + hu, v0: v - hv, v1: v + hv }, level, alongU };
  });

/** Every wall of the piece, in local terms (the spec's walls are these, turned into the world). */
export function parkadeWalls(): LWall[] {
  const out: LWall[] = [];
  const add = (u0: number, v0: number, u1: number, v1: number, range: { minY: number; maxY: number }, kind: LWall['kind']): void => {
    out.push({ u0, v0, u1, v1, minY: range.minY, maxY: range.maxY, kind });
  };
  const i0 = RAIL_IN;
  const iu = W - RAIL_IN;
  const iv = D - RAIL_IN;
  const rail = LANE_HALF - RAIL_IN;
  // L1's parapets: all round, but the south face opens onto the exit.
  add(i0, i0, iu, i0, R1, 'parapet');
  add(i0, i0, i0, iv, R1, 'parapet');
  add(iu, i0, iu, iv, R1, 'parapet');
  add(i0, iv, laneEdgeU(-rail, iv), iv, R1, 'parapet');
  add(laneEdgeU(rail, iv), iv, iu, iv, R1, 'parapet');
  // L2's: north, west and east (to the tip); south stops short of the hole, so a car leaving the
  // lip's west edge clears its end.
  add(i0, i0, iu, i0, R2, 'parapet');
  add(i0, i0, i0, iv, R2, 'parapet');
  add(iu, i0, iu, KICK_TIP, R2, 'parapet');
  add(i0, iv, G.fallen.u0 - RAIL_IN, iv, R2, 'parapet');
  // THE CHUTE: the lane's rails on the roof from ramp B's top to the lip's tip, and a rail across
  // from its east rail to the east parapet so the wedge east of it is shut. The lip is only ever
  // reached down the chute: flat out that is ~29 m/s without nitro.
  add(laneEdgeU(-rail, CHUTE_V0), CHUTE_V0, laneEdgeU(-rail, KICK_TIP), KICK_TIP, R2, 'parapet');
  add(laneEdgeU(rail, CHUTE_V0), CHUTE_V0, laneEdgeU(rail, KICK_TIP), KICK_TIP, R2, 'parapet');
  add(laneEdgeU(rail, CHUTE_V0), CHUTE_V0, iu, CHUTE_V0, R2, 'parapet');
  // The broken edge of the roof west of the hole has NO rail: a car there drops 5.2 m onto L1
  // at the exit's mouth, which is on the way out.

  // Ramp A: its sides are its kerbs and the wall that keeps L0 from under it; L1's rails round
  // its slot stand on the row lines; L1's rail across its foot end; L0's wall under its top end.
  const a = rampA.lane;
  const rangeA = { minY: BELOW, maxY: L1 + OVER };
  add(a.u0, a.v0, a.u1, a.v0, rangeA, 'kerb');
  add(a.u0, a.v1, a.u1, a.v1, rangeA, 'kerb');
  add(a.u0, a.v1 + RAMP_INSET, a.u1, a.v1 + RAMP_INSET, R1, 'parapet');
  add(a.u1, a.v0 - RAMP_INSET, a.u1, a.v1 + RAMP_INSET, R1, 'parapet');
  add(a.u0, a.v0, a.u0, a.v1, R0, 'face');
  // Ramp B: the same from L1 to above the roof; the roof's rail round its slot; L2's rail across
  // its foot end; L1's wall under its top end.
  const b = rampB.lane;
  const rangeB = { minY: L1 - 1.6, maxY: L2 + OVER };
  add(b.u0, b.v0, b.u1, b.v0, rangeB, 'kerb');
  add(b.u0, b.v1, b.u1, b.v1, rangeB, 'kerb');
  add(b.u0, b.v1 + RAMP_INSET, b.u1, b.v1 + RAMP_INSET, R2, 'parapet');
  add(b.u0, i0, b.u0, b.v1 + RAMP_INSET, R2, 'parapet');
  add(b.u1, b.v0, b.u1, b.v1, R1, 'face');

  // The exit is solid from the south face on: its rails keep its cars on it (bridge and ramp alike)
  // and the lot's cars off its sides; inside the garage they are L1's parapets to the face; and
  // the blank north face is what L0 meets under the bridge.
  for (const side of [-1, 1]) {
    add(laneEdgeU(side * rail, iv), iv, laneEdgeU(side * rail, EXIT_V0), EXIT_V0, R1, 'parapet');
    add(laneEdgeU(side * rail, EXIT_V0), EXIT_V0, laneEdgeU(side * rail, EXIT_V1), EXIT_V1, { minY: BELOW, maxY: L1 + OVER }, 'kerb');
  }
  add(laneEdgeU(-LANE_HALF, EXIT_V0), EXIT_V0, laneEdgeU(LANE_HALF, EXIT_V0), EXIT_V0, { minY: BELOW, maxY: L1 - 0.6 }, 'face');
  return out;
}

/** Every solid box of the piece, in local terms. */
export function parkadeBoxes(): LBox[] {
  const out: LBox[] = [];
  const c = COLUMN / 2;
  for (const { u, v } of parkadeColumns()) out.push({ r: { u0: u - c, u1: u + c, v0: v - c, v1: v + c }, minY: BELOW, maxY: L2 - 1.6, kind: 'column' });
  for (const [u, v, hu, hv, lvl] of PARKADE_RUBBLE) {
    const y = lvl === 0 ? 0 : L1;
    out.push({ r: { u0: u - hu, u1: u + hu, v0: v - hv, v1: v + hv }, minY: y + BELOW, maxY: y + OVER, kind: 'rubble' });
  }
  for (const w of wreckRects()) {
    const y = w.level * LEVEL_H;
    out.push({ r: w.r, minY: y + BELOW, maxY: y + OVER, kind: 'wreck' });
  }
  out.push({ r: STAIR_CORE, minY: BELOW, maxY: STAIR_CORE.top, kind: 'core' });
  out.push({ r: BOOTH, minY: BELOW, maxY: BOOTH.top, kind: 'booth' });
  return out;
}

function toWall(w: LWall): ObstacleWall {
  const a = toWorld(w.u0, w.v0);
  const b = toWorld(w.u1, w.v1);
  return { ax: a.x, az: a.z, bx: b.x, bz: b.z, minY: w.minY, maxY: w.maxY };
}

/* ------------------------------------------------------------------ the spec */

/** Named spots for QA and teleports: world x, z, y and heading. */
function spot(u: number, v: number, y: number, du: number, dv: number): { x: number; z: number; y: number; heading: number } {
  const p = toWorld(u, v);
  return { x: p.x, z: p.z, y, heading: headingOf(du, dv) };
}
const midV = (r: LRect): number => (r.v0 + r.v1) / 2;
export const PARKADE_SPOTS = {
  /** On st-w3's pavement, facing ramp A's foot through the open east face. */
  entrance: spot(W + 3, midV(rampA.lane), 0, -1, 0),
  /** L1, the west bay, facing the foot of ramp B. */
  level1: spot(6, midV(rampB.lane), L1, 1, 0),
  /** The roof, top of the chute, facing the lip down the lane. */
  roof: spot(laneU(CHUTE_V0 + 2), CHUTE_V0 + 2, L2, LANE_TAN, 1),
  /** The landing: the exit ramp, halfway down, facing out down the lane. */
  landing: spot(laneU(EXIT_V_RAMP + EXIT_RUN / 2), EXIT_V_RAMP + EXIT_RUN / 2, L1 - G.exitDrop(EXIT_RUN / 2), LANE_TAN, 1),
  /** The exit's foot, heading out toward st-w3. */
  exit: spot(laneU(EXIT_V1), EXIT_V1, 0, LANE_TAN, 1),
};

export const PARKADE: SetPieceSpec = {
  tag: 'parkade',
  // The whole block: its six low plots and their cables go.
  lots: [{ ...PARKADE_RESERVED }],
  surfaces: [
    surface(G.footprint, level1Y),
    surface(G.footprint, level2Y),
    surface(wide(rampA), rampAY),
    surface(wide(rampB), rampBY),
    surface(EXIT_BOUNDS, exitY),
  ],
  colliders: parkadeBoxes().map((b) => ({ ...worldRect(b.r), minY: b.minY, maxY: b.maxY })),
  walls: parkadeWalls().map(toWall),
  minimapRects: [{ ...PARKADE_RESERVED }],
};
