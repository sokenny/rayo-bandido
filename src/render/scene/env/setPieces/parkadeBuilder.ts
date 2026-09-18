import type { SetPieceSpec } from '../../../../world/setPieces/types';
import {
  BOOTH,
  kickHeave,
  PARKADE_RESERVED,
  PARKADE_GEOM as G,
  PARKADE_RUBBLE,
  parkadeBoxes,
  parkadeColumns,
  parkadeWalls,
  RAIL_IN,
  rampAt,
  STAIR_CORE,
  toWorld,
  worldRect,
  wreckRects,
  exitY,
  laneEdgeU,
  level1Y,
  level2Y,
  rampAY,
  rampBY,
  type LRect,
  type LWall,
  type RampDef,
} from '../../../../world/setPieces/parkade';
import { groundGlow, type EnvBuilders } from '../builders';
import { ROAD_TILE } from '../cityBuilder';
import { graffitiCell, grimeSurface, paintSurface } from '../graffiti';
import { makeRng, type MeshBuilder } from '../meshBuilder';
import { PAL } from '../palette';
import { weeds } from '../plants';
import type { GraffitiSurface, ReclaimProfile } from '../reclaim';

/**
 * The art of the collapsed parking garage (`world/setPieces/parkade.ts`, tag 'parkade'). Called
 * once by `buildSetPieces` with its spec. Everything is laid out in the data file's LOCAL frame
 * (u across, v toward the jump) and turned into the world through `toWorld`, so the art follows
 * the physics whatever the constants say. Shared batches only (`./index.ts`).
 *
 * NOTHING SOLID IS INVISIBLE. Every wall and box in the spec comes from `parkadeWalls()` /
 * `parkadeBoxes()`, and this file draws those same lists: a parapet, kerb or blank face for each
 * wall over the heights it stops cars at, a column, heap, wreck, core or booth for each box.
 *
 * THE LOOK. Raw board-marked concrete gone dark with forty winters, the slab edges and parapets
 * reading as deep horizontal bands over an open ground floor; worn paint that shows the way
 * (chevrons up the ramps, a colour band per level round every column); tyre marks where people
 * have been doing exactly what the player is about to do — round the column on L1, donuts on
 * the roof, black lines down the runway into the lip and landing scars down the exit. The broken
 * corner is the landmark: a heaved slab with its rebar out, and below and ahead of it the exit
 * running straight down to the boulevard, lit, with amber markers down both sides.
 */

/** Paint and dirt: a garage nobody has run for years. */
const DERELICT: ReclaimProfile = {
  intensity: 0.85,
  level: 2,
  vegetation: 0.4,
  weeds: 0.5,
  vines: 0,
  graffiti: 1,
  graffitiScale: 0.9,
  decay: 1,
  planter: 0,
  bigTree: false,
  grafWall: true,
};

const PARAPET_H = 1.05;
const PARAPET_T = 0.3;
const KERB_H = 0.95;
/** Paint and decal lift over a deck. */
const LIFT = { paint: 0.02, decal: 0.035, glow: 0.05 } as const;
const SODIUM = 0xffb25e;
const HAZARD = 0xd9b43a;
const MARK = 0xffa640;
/** One band colour per level round the columns: wayfinding by paint, not by signs. */
const LEVEL_BAND = [0xd9b43a, 0x3fb8c8, 0xd0457a];
const RUST = 0x6a4030;

type V3 = [number, number, number];
/** A deck's height at a local point. */
type Deck = (u: number, v: number) => number;

export function buildParkade(b: EnvBuilders, piece: SetPieceSpec): void {
  void piece;
  const rng = makeRng(0x9a4c1de5);
  floors(b, rng);
  slabs(b);
  ramp(b, G.rampA);
  ramp(b, G.rampB);
  exit(b, rng);
  solids(b, rng);
  broken(b, rng);
  apron(b, rng);
  core(b);
  facade(b, rng);
  paint(b, rng);
  tyreMarks(b, rng);
  lights(b, rng);
  debris(b, rng);
}

/* ------------------------------------------------------------------ local helpers */

function P(u: number, v: number): { x: number; z: number } {
  return toWorld(u, v);
}
/**
 * A quad from local corners, wound so its front faces along `n` (a local normal: u, y, v), so no
 * call site has to get the winding right by hand.
 */
function quadN(mb: MeshBuilder, a: V3, bq: V3, c: V3, d: V3, n: V3, uv?: { u0: number; v0: number; u1: number; v1: number }): void {
  const A = P(a[0], a[1]);
  const B = P(bq[0], bq[1]);
  const C = P(c[0], c[1]);
  const D = P(d[0], d[1]);
  const pa: V3 = [A.x, a[2], A.z];
  const pb: V3 = [B.x, bq[2], B.z];
  const pc: V3 = [C.x, c[2], C.z];
  const pd: V3 = [D.x, d[2], D.z];
  const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
  const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
  const nx = e1[1] * e2[2] - e1[2] * e2[1];
  const ny = e1[2] * e2[0] - e1[0] * e2[2];
  const nz = e1[0] * e2[1] - e1[1] * e2[0];
  const O = P(0, 0);
  const H = P(n[0], n[2]);
  const hx = H.x - O.x;
  const hz = H.z - O.z;
  const flip = nx * hx + ny * n[1] + nz * hz < 0;
  const [q0, q1, q2, q3] = flip ? [pa, pd, pc, pb] : [pa, pb, pc, pd];
  if (uv) mb.quad(q0[0], q0[1], q0[2], q1[0], q1[1], q1[2], q2[0], q2[1], q2[2], q3[0], q3[1], q3[2], uv.u0, uv.v0, uv.u1, uv.v1);
  else mb.quad(q0[0], q0[1], q0[2], q1[0], q1[1], q1[2], q2[0], q2[1], q2[2], q3[0], q3[1], q3[2]);
}
const UP: V3 = [0, 1, 0];
/** Axis-aligned box in local metres. */
function boxL(mb: MeshBuilder, u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, bottom = false): void {
  const r = worldRect({ u0, u1, v0, v1 });
  mb.box((r.minX + r.maxX) / 2, (y0 + y1) / 2, (r.minZ + r.maxZ) / 2, r.maxX - r.minX, y1 - y0, r.maxZ - r.minZ, { bottom });
}
/** A box from local (u0,v0) to (u1,v1) along its length, `thick` across, y0..y1. */
function beamL(mb: MeshBuilder, u0: number, v0: number, u1: number, v1: number, thick: number, y0: number, y1: number, bottom = false): void {
  const a = P(u0, v0);
  const c = P(u1, v1);
  const len = Math.hypot(c.x - a.x, c.z - a.z);
  if (len < 1e-3) return;
  mb.orientedBox((a.x + c.x) / 2, (a.z + c.z) / 2, (c.x - a.x) / len, (c.z - a.z) / len, len, thick, y0, y1, { bottom });
}
/** A kerb or parapet that climbs: base from ya to yb. */
function slopedL(mb: MeshBuilder, u0: number, v0: number, u1: number, v1: number, ya: number, yb: number, thick: number, h: number): void {
  const a = P(u0, v0);
  const c = P(u1, v1);
  mb.slopedBox(a.x, a.z, c.x, c.z, ya, yb, thick, h);
}
function tubeL(mb: MeshBuilder, u0: number, v0: number, y0: number, u1: number, v1: number, y1: number, w: number): void {
  const a = P(u0, v0);
  const c = P(u1, v1);
  mb.tube(a.x, y0, a.z, c.x, y1, c.z, w);
}
/** A flat quad on a deck, centred at (u, v), `along` metres down local (du, dv), following `y`. */
function flatL(mb: MeshBuilder, u: number, v: number, du: number, dv: number, along: number, across: number, y: number | Deck, uv?: { u0: number; v0: number; u1: number; v1: number }): void {
  const l = Math.hypot(du, dv) || 1;
  const fu = du / l;
  const fv = dv / l;
  const ru = -fv;
  const rv = fu;
  const hx = across / 2;
  const hz = along / 2;
  const at = (lx: number, lz: number): V3 => {
    const pu = u + ru * lx + fu * lz;
    const pv = v + rv * lx + fv * lz;
    return [pu, pv, typeof y === 'number' ? y : y(pu, pv)];
  };
  quadN(mb, at(-hx, -hz), at(hx, -hz), at(hx, hz), at(-hx, hz), UP, uv);
}
/** A face as a surface for paint and grime: its foot's middle, the outward normal (local). */
function faceL(u: number, v: number, y: number, nu: number, nv: number, width: number, height: number): GraffitiSurface {
  const p = P(u, v);
  const n0 = P(0, 0);
  const n1 = P(nu, nv);
  const nx = n1.x - n0.x;
  const nz = n1.z - n0.z;
  return { x: p.x, y, z: p.z, nx, nz, tx: nz, tz: -nx, width, height, out: 0.03 };
}
/** The highest drivable top at a point no higher than `below` (for paint and kerbs). */
function topAt(u: number, v: number, below: number): number {
  let best = 0;
  for (const f of [level1Y, level2Y, rampAY, rampBY, exitY]) {
    const h = f(u, v);
    if (h !== null && h <= below + 0.01 && h > best) best = h;
  }
  return best;
}
const roofDeck = (lift: number): Deck => (u, v) => (level2Y(u, v) ?? G.L2) + lift;
const rampDeck = (r: RampDef, lift: number): Deck => (u, v) => rampAt(r, r.axis === 'u' ? u : v) + lift;
const exitDeck = (lift: number): Deck => (u, v) => (exitY(u, v) ?? 0) + lift;

/* ------------------------------------------------------------------ the decks */

/** L0's concrete floor, grimy, with joints and oil where cars stood. */
function floors(b: EnvBuilders, rng: () => number): void {
  const f = G.footprint;
  b.concrete.color(PAL.curb, 1.35);
  flatL(b.concrete, (f.u0 + f.u1) / 2, (f.v0 + f.v1) / 2, 0, 1, f.v1 - f.v0, f.u1 - f.u0, 0.012);
  b.concrete.color(PAL.curb, 0.7);
  for (const u of G.columnsU) flatL(b.concrete, u, (f.v0 + f.v1) / 2, 0, 1, f.v1 - f.v0, 0.12, 0.016);
  for (const v of G.columnsV) flatL(b.concrete, (f.u0 + f.u1) / 2, v, 1, 0, f.u1 - f.u0, 0.12, 0.016);
  const stain = graffitiCell(13);
  for (let i = 0; i < 24; i++) {
    const u = 2 + rng() * 62;
    const v = rng() < 0.5 ? 2 + rng() * 12 : 34 + rng() * 12;
    b.decal.color(PAL.grime, 0.7 + rng() * 0.5);
    flatL(b.decal, u, v, rng() - 0.5, 1, 1.4 + rng() * 1.6, 1 + rng() * 1.2, LIFT.decal, stain);
  }
}

/** Split a rectangle into the pieces left after cutting `holes` out of it (axis-aligned). */
function cut(r: LRect, holes: LRect[]): LRect[] {
  let parts = [r];
  for (const h of holes) {
    const next: LRect[] = [];
    for (const p of parts) {
      if (h.u1 <= p.u0 || h.u0 >= p.u1 || h.v1 <= p.v0 || h.v0 >= p.v1) {
        next.push(p);
        continue;
      }
      if (h.v0 > p.v0) next.push({ ...p, v1: h.v0 });
      if (h.v1 < p.v1) next.push({ ...p, v0: h.v1 });
      const v0 = Math.max(p.v0, h.v0);
      const v1 = Math.min(p.v1, h.v1);
      if (h.u0 > p.u0) next.push({ u0: p.u0, u1: h.u0, v0, v1 });
      if (h.u1 < p.u1) next.push({ u0: h.u1, u1: p.u1, v0, v1 });
    }
    parts = next;
  }
  return parts.filter((p) => p.u1 - p.u0 > 0.05 && p.v1 - p.v0 > 0.05);
}

/** The L1 and L2 slabs: top, underside and downstand beams, each around its holes. */
function slabs(b: EnvBuilders): void {
  const s = G.slab;
  const f = G.footprint;
  const A = G.rampA.lane;
  const B = G.rampB.lane;
  const k = G.kick;
  const fl = G.fallen;
  // L1: all but ramp A's slot (under ramp B it is still L0's ceiling: drawn).
  const l1 = cut(f, [{ u0: A.u0, u1: A.u1 - 0.5, v0: A.v0 - 0.5, v1: A.v1 + 0.5 }]);
  // L2: all but ramp B's slot and the fallen corner (the lip is drawn over it).
  const l2 = cut(f, [
    { u0: B.u0 + 0.5, u1: B.u1, v0: B.v0 - 0.5, v1: B.v1 + 0.5 },
    { u0: fl.u0, u1: fl.u1, v0: fl.v0, v1: fl.v1 },
  ]);
  for (const [rects, y] of [
    [l1, G.L1],
    [l2, G.L2],
  ] as const) {
    for (const r of rects) {
      b.wall.color(PAL.curb, 1.55);
      boxL(b.wall, r.u0, r.u1, r.v0, r.v1, y - s, y, true);
      b.concrete.color(PAL.curb, 1.5);
      flatL(b.concrete, (r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2, 0, 1, r.v1 - r.v0, r.u1 - r.u0, y + 0.01);
    }
    // Downstand beams on the column lines across v (the ceiling's ribs), where there is slab.
    b.wall.color(PAL.curb, 1.4);
    for (const u of G.columnsU) {
      for (const r of rects) {
        if (u < r.u0 + 0.3 || u > r.u1 - 0.3) continue;
        boxL(b.wall, u - 0.35, u + 0.35, r.v0, r.v1, y - s - 0.55, y - s, true);
      }
    }
  }
  // The lip: the heaved slab laid over the roof along the lane, a grid that follows the heave.
  const half = G.laneHalf;
  const nu = 4;
  const nv = 8;
  const h = (u: number, v: number): number => G.L2 + kickHeave(u, v) + 0.012;
  const at = (off: number, v: number): V3 => {
    const u = laneEdgeU(off * 0.999, v);
    return [u, v, h(u, v)];
  };
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const oa = -half + (2 * half * i) / nu;
      const ob = -half + (2 * half * (i + 1)) / nu;
      const va = k.v0 + ((k.v1 - k.v0) * j) / nv;
      const vb = k.v0 + ((k.v1 - k.v0) * (j + 1)) / nv;
      b.concrete.color(PAL.curb, 1.55 - j * 0.03);
      quadN(b.concrete, at(oa, va), at(ob, va), at(ob, vb), at(oa, vb), UP);
    }
  }
  // The heave's sides (under the rails) and its underside over the hole's edge.
  b.wall.color(PAL.curb, 1.5);
  for (let j = 0; j < nv; j++) {
    const va = k.v0 + ((k.v1 - k.v0) * j) / nv;
    const vb = k.v0 + ((k.v1 - k.v0) * (j + 1)) / nv;
    for (const side of [-1, 1]) {
      const a = at(side * half, va);
      const c = at(side * half, vb);
      quadN(b.wall, [a[0], a[1], G.L2], [c[0], c[1], G.L2], c, a, [side, 0, 0]);
    }
  }
  // The tip's broken face across the lane: jagged, stepping in and out, facing the drop.
  b.wall.color(PAL.curb, 1.7);
  for (let i = 0; i < 6; i++) {
    const oa = -half + (2 * half * i) / 6;
    const ob = -half + (2 * half * (i + 1)) / 6;
    const jag = ((i * 37) % 5) * 0.12;
    const v = k.v1 - 0.15 - jag;
    const top = h(laneEdgeU((oa + ob) / 2, k.v1), k.v1 - 0.01);
    beamL(b.wall, laneEdgeU(oa, v), v, laneEdgeU(ob, v), v, 0.3 + jag, top - s - 0.3, top, true);
  }
}

/* ------------------------------------------------------------------ the ramps */

/** One ramp: its deck, solid sides down to its base floor, the yellow line along each kerb. */
function ramp(b: EnvBuilders, r: RampDef): void {
  const L = r.lane;
  const alongU = r.axis === 'u';
  const a0 = alongU ? L.u0 : L.v0;
  const a1 = alongU ? L.u1 : L.v1;
  // The deck and its solid sides stop at the kerbs' outer faces, on the walls' lines (the
  // physics' half-metre overhang past them is never seen: a car's wheel only reaches it).
  const c0 = (alongU ? L.v0 : L.u0) - 0.15;
  const c1 = (alongU ? L.v1 : L.u1) + 0.15;
  const pt = (a: number, c: number, y: number): V3 => (alongU ? [a, c, y] : [c, a, y]);
  const base = Math.min(r.y0, r.y1);
  const n = 24;
  const sideN = (c: number): V3 => (alongU ? [0, 0, c < 0 ? -1 : 1] : [c < 0 ? -1 : 1, 0, 0]);
  for (let i = 0; i < n; i++) {
    const aa = a0 + ((a1 - a0) * i) / n;
    const ab = a0 + ((a1 - a0) * (i + 1)) / n;
    const ya = rampAt(r, aa);
    const yb = rampAt(r, ab);
    b.concrete.color(PAL.curb, 1.45);
    quadN(b.concrete, pt(aa, c0, ya + 0.01), pt(ab, c0, yb + 0.01), pt(ab, c1, yb + 0.01), pt(aa, c1, ya + 0.01), UP);
    b.wall.color(PAL.curb, 1.6);
    if (Math.max(ya, yb) > base + 0.02) {
      quadN(b.wall, pt(aa, c0, base), pt(ab, c0, base), pt(ab, c0, yb), pt(aa, c0, ya), sideN(-1));
      quadN(b.wall, pt(aa, c1, base), pt(ab, c1, base), pt(ab, c1, yb), pt(aa, c1, ya), sideN(1));
    }
    b.lane.color(HAZARD, 0.55);
    for (const c of [c0 + 0.5, c1 - 0.5]) quadN(b.lane, pt(aa, c - 0.08, ya + LIFT.paint), pt(ab, c - 0.08, yb + LIFT.paint), pt(ab, c + 0.08, yb + LIFT.paint), pt(aa, c + 0.08, ya + LIFT.paint), UP);
  }
}

/* ------------------------------------------------------------------ the exit (and landing) */

function exit(b: EnvBuilders, rng: () => number): void {
  const e = G.exit;
  // The deck and its solid sides stop at the kerbs' outer faces, on the walls' lines.
  const half = G.laneHalf - RAIL_IN + 0.15;
  const h = (v: number): number => exitY(G.laneU(v), v) ?? 0;
  const E = (off: number, v: number, y: number): V3 => [laneEdgeU(off, v), v, y];
  const n = 30;
  for (let i = 0; i < n; i++) {
    const va = e.v0 + ((e.v1 - e.v0) * i) / n;
    const vb = e.v0 + ((e.v1 - e.v0) * (i + 1)) / n;
    const ya = h(va);
    const yb = h(vb);
    b.road.color(0xc4c6cc, 0.8);
    quadN(b.road, E(-half, va, ya + 0.01), E(half, va, ya + 0.01), E(half, vb, yb + 0.01), E(-half, vb, yb + 0.01), UP);
    // Solid sides down to the lot.
    b.wall.color(PAL.curb, 1.6);
    if (Math.max(ya, yb) > 0.02) {
      quadN(b.wall, E(-half, va, 0), E(-half, vb, 0), E(-half, vb, yb), E(-half, va, ya), [-1, 0, 0]);
      quadN(b.wall, E(half, va, 0), E(half, vb, 0), E(half, vb, yb), E(half, va, ya), [1, 0, 0]);
    }
    // Worn lane edges and a broken centre line.
    b.lane.color(PAL.laneWorn, 0.75);
    for (const o of [-half + 1.3, half - 1.3]) quadN(b.lane, E(o - 0.09, va, ya + LIFT.paint), E(o + 0.09, va, ya + LIFT.paint), E(o + 0.09, vb, yb + LIFT.paint), E(o - 0.09, vb, yb + LIFT.paint), UP);
    if (i % 2 === 0) quadN(b.lane, E(-0.1, va, ya + LIFT.paint), E(0.1, va, ya + LIFT.paint), E(0.1, vb, yb + LIFT.paint), E(-0.1, vb, yb + LIFT.paint), UP);
  }
  // Old one-way arrows down the lane: this way out, toward st-w3.
  b.lane.color(PAL.laneWhite, 0.55);
  for (const v of [e.vRamp + 8, e.vRamp + 24, e.vRamp + 38]) arrowL(b, G.laneU(v), v, G.laneTan, 1, 4.5, exitDeck(0));
  // The solid face L0 meets under the bridge, painted.
  b.wall.color(PAL.curb, 1.5);
  quadN(b.wall, E(-half, e.v0, 0), E(half, e.v0, 0), E(half, e.v0, G.L1 - G.slab), E(-half, e.v0, G.L1 - G.slab), [0, 0, -1]);
  const nE = { u: 1, v: -G.laneTan };
  paintSurface(b, faceL(G.laneU(e.v0), e.v0, 0, 0, -1, 2 * half - 1, G.L1 - G.slab), DERELICT, 4240);
  // Paint and grime on its long blank sides, seen from the boulevard and st-w3.
  const vm = e.vRamp + 10;
  paintSurface(b, faceL(laneEdgeU(half, vm), vm, 0, nE.u, nE.v, 18, 3.4), DERELICT, 4242);
  paintSurface(b, faceL(laneEdgeU(-half, vm), vm, 0, -nE.u, -nE.v, 18, 3.4), DERELICT, 4243);
  grimeSurface(b, faceL(laneEdgeU(-half, e.v0 + 5), e.v0 + 5, 0, -nE.u, -nE.v, 8, G.L1), DERELICT, 4244, 'streak');
  grimeSurface(b, faceL(laneEdgeU(half, e.v0 + 5), e.v0 + 5, 0, nE.u, nE.v, 8, G.L1), DERELICT, 4245, 'streak');
  // Landing scars down the middle: where the jump comes down, speed by speed.
  const scar = graffitiCell(12);
  for (let k = 0; k < 16; k++) {
    const v = e.vRamp + 2 + rng() * (e.v1 - e.vRamp - 4);
    const u = laneEdgeU((rng() - 0.5) * 4, v);
    b.decal.color(0x050607, 0.8 + rng() * 0.3);
    flatL(b.decal, u, v, G.laneTan + (rng() - 0.5) * 0.1, 1, 2.5 + rng() * 4, 0.5 + rng() * 0.6, exitDeck(LIFT.decal), scar);
  }
  // The run-out, painted across the lot to the corner: where the line goes, st-w3.
  b.lane.color(PAL.laneWhite, 0.45);
  for (let v = e.v1 + 2; v < 107; v += 4) flatL(b.lane, G.laneU(v), v, G.laneTan, 1, 2, 0.2, LIFT.paint);
  b.lane.color(HAZARD, 0.5);
  arrowL(b, G.laneU(104), 104, G.laneTan, 1, 4.5, 0);
}

/* ------------------------------------------------------------------ what the physics knows */

/** Every wall and box in the spec, drawn over the heights it stops cars at. */
function solids(b: EnvBuilders, rng: () => number): void {
  for (const w of parkadeWalls()) wallArt(b, w);
  const cols = new Set(parkadeColumns().map((c) => `${c.u},${c.v}`));
  const c = G.column / 2;
  const f = G.fallen;
  for (const box of parkadeBoxes()) {
    if (box.kind !== 'column') continue;
    const u = (box.r.u0 + box.r.u1) / 2;
    const v = (box.r.v0 + box.r.v1) / 2;
    if (!cols.has(`${u},${v}`)) continue;
    // Under the fallen corner the columns stand only to L1 and a bit, snapped, rebar out; still
    // taller than any car on L1, which is as high as their collider reaches a car.
    const snapped = u >= f.u0 && v >= f.v0 - 0.01;
    const top = snapped ? G.L1 + 2.4 + rng() * 0.8 : G.L2 - G.slab;
    b.wall.color(PAL.curb, 1.8 + rng() * 0.2);
    boxL(b.wall, u - c, u + c, v - c, v + c, 0, top);
    if (snapped) {
      b.props.color(RUST, 1.6);
      for (let i = 0; i < 5; i++) {
        const du = (rng() - 0.5) * 0.7;
        const dv = (rng() - 0.5) * 0.7;
        tubeL(b.props, u + du, v + dv, top - 0.1, u + du * 2.4 + (rng() - 0.5), v + dv * 2.4 + (rng() - 0.5), top + 0.8 + rng() * 1.2, 0.04);
      }
    }
    for (const lvl of [0, 1] as const) {
      const y = lvl === 0 ? 0 : G.L1;
      b.lane.color(LEVEL_BAND[lvl], 0.5 + rng() * 0.2);
      boxL(b.lane, u - c - 0.01, u + c + 0.01, v - c - 0.01, v + c + 0.01, y + 0.9, y + 1.45);
    }
  }
}

/** A wall's art: a parapet on a floor, a kerb along a ramp, or a blank face down to the floor below. */
function wallArt(b: EnvBuilders, w: LWall): void {
  const len = Math.hypot(w.u1 - w.u0, w.v1 - w.v0);
  if (len < 0.05) return;
  const du = (w.u1 - w.u0) / len;
  const dv = (w.v1 - w.v0) / len;
  if (w.kind === 'face') {
    // A blank face from the floor it stops (ranges sit 1.6 m under a floor, or at −2 for grade)
    // up to the slab or ramp over it.
    const y0 = w.minY <= -1.9 ? 0 : w.minY + 1.6;
    b.wall.color(PAL.curb, 1.55);
    beamL(b.wall, w.u0, w.v0, w.u1, w.v1, 0.25, y0, y0 + G.L1 - G.slab);
    return;
  }
  // Walk it: a parapet or kerb on whatever top stands there within the wall's range, on the side
  // that is drivable. Pieces of 2 m so a kerb follows a ramp.
  const steps = Math.max(1, Math.ceil(len / 2));
  const h = w.kind === 'kerb' ? KERB_H : PARAPET_H;
  for (let i = 0; i < steps; i++) {
    const ta = i / steps;
    const tb = (i + 1) / steps;
    const ua = w.u0 + (w.u1 - w.u0) * ta;
    const va = w.v0 + (w.v1 - w.v0) * ta;
    const ub = w.u0 + (w.u1 - w.u0) * tb;
    const vb = w.v0 + (w.v1 - w.v0) * tb;
    // The deck under the wall: the highest top within its range at the ends, either side.
    const deck = (u: number, v: number): number => {
      let best = -Infinity;
      for (const s of [-0.6, 0.6]) {
        const pu = u - dv * s;
        const pv = v + du * s;
        for (const fn of w.kind === 'kerb' ? [rampAY, rampBY, exitY] : [level1Y, level2Y, exitY]) {
          const y = fn(pu, pv);
          if (y !== null && y >= w.minY - 0.1 && y <= w.maxY && y > best) best = y;
        }
      }
      return best === -Infinity ? Math.max(0, w.minY + 1.6) : best;
    };
    const ya = deck(ua, va);
    const yb = deck(ub, vb);
    b.wall.color(PAL.curb, w.kind === 'kerb' ? 1.9 : 2.1);
    slopedL(b.wall, ua, va, ub, vb, ya, yb, PARAPET_T, h);
  }
}

/* ------------------------------------------------------------------ the fallen corner */

function broken(b: EnvBuilders, rng: () => number): void {
  const k = G.kick;
  const f = G.fallen;
  const half = G.laneHalf;
  // Rebar out of the lip's face, bent down over the drop.
  b.props.color(RUST, 1.7);
  for (let o = -half + 0.3; o < half - 0.2; o += 0.55 + rng() * 0.35) {
    const u = laneEdgeU(o, k.v1);
    const y = G.L2 + kickHeave(u, k.v1 - 0.01) - 0.15 - rng() * 0.2;
    tubeL(b.props, u, k.v1 - 0.2, y, u + (rng() - 0.5) * 0.4 + G.laneTan, k.v1 + 0.6 + rng() * 1.1, y - 0.2 - rng() * 0.8, 0.035);
  }
  // Rebar along the roof's broken edge west of the hole, and a jagged face there.
  for (let v = k.v1 + 0.3; v < G.depth; v += 0.7 + rng() * 0.4) {
    tubeL(b.props, f.u0 + 0.2, v, G.L2 - 0.2, f.u0 + 0.9 + rng() * 0.9, v + (rng() - 0.5) * 0.4, G.L2 - 0.5 - rng() * 0.6, 0.035);
  }
  b.wall.color(PAL.curb, 1.7);
  for (let v = k.v1; v < G.depth - 0.4; v += 1.3) {
    const j = rng() * 0.25;
    boxL(b.wall, f.u0 - 0.35 - j, f.u0 - j, v, v + 1.3, G.L2 - G.slab - 0.15, G.L2 + 0.02, true);
  }
  // The L2 parapets' broken ends: stubs with rebar.
  b.props.color(RUST, 1.6);
  for (const [u, v] of [
    [G.width - RAIL_IN, k.v1],
    [f.u0 - RAIL_IN, G.depth - RAIL_IN],
  ] as const) {
    for (let i = 0; i < 4; i++) tubeL(b.props, u + (rng() - 0.5) * 0.2, v, G.L2 + 0.2 + i * 0.2, u + (rng() - 0.5) * 1.2, v + (rng() - 0.5) * 1.2, G.L2 + 0.4 + i * 0.25, 0.03);
  }
  // Cracks back up the chute from the heave, and over the open L1 floor under the hole.
  const crack = graffitiCell(14);
  for (let n = 0; n < 10; n++) {
    const v = k.v0 - 8 + rng() * 14;
    const u = laneEdgeU((rng() - 0.5) * 6, v);
    b.decal.color(PAL.grime, 0.9 + rng() * 0.5);
    flatL(b.decal, u, v, (rng() - 0.5) * 0.4, 1, 3.5 + rng() * 3, 2 + rng() * 2, roofDeck(LIFT.decal), crack);
  }
  for (let n = 0; n < 6; n++) {
    const u = f.u0 + 1 + rng() * (f.u1 - f.u0 - 2);
    const v = f.v0 - 3 + rng() * 6;
    b.decal.color(PAL.grime, 0.9 + rng() * 0.4);
    flatL(b.decal, u, v, rng() - 0.5, rng() - 0.5, 2.5 + rng() * 2, 2.5 + rng() * 2, G.L1 + LIFT.decal, crack);
  }
}

/* ------------------------------------------------------------------ outside */

/** Old asphalt over the lot, the way in from st-w3, the booth, weeds. */
function apron(b: EnvBuilders, rng: () => number): void {
  const lot = PARKADE_RESERVED;
  /** The west lot's far edge, in u (the garage fills the east of the block). */
  const west = PARKADE_RESERVED.minX - toWorld(0, 0).x + 1;
  b.road.color(0xd0d0d6, 0.72);
  b.road.planeY((lot.minX + lot.maxX) / 2, 0.006, (lot.minZ + lot.maxZ) / 2, lot.maxX - lot.minX, lot.maxZ - lot.minZ, lot.minX / ROAD_TILE, lot.maxZ / ROAD_TILE, lot.maxX / ROAD_TILE, lot.minZ / ROAD_TILE);
  for (let i = 0; i < 10; i++) {
    const u = west + rng() * 30;
    const v = rng() * 100;
    const w = 3 + rng() * 9;
    const d = 2 + rng() * 6;
    const r = worldRect({ u0: u, u1: u + w, v0: v, v1: v + d });
    b.road.color(0xb9bcc4, 0.6 + rng() * 0.1);
    b.road.planeY((r.minX + r.maxX) / 2, 0.009, (r.minZ + r.maxZ) / 2, r.maxX - r.minX, r.maxZ - r.minZ, r.minX / ROAD_TILE, r.maxZ / ROAD_TILE, r.maxX / ROAD_TILE, r.minZ / ROAD_TILE);
  }
  // The way in off st-w3's pavement, straight at ramp A's foot.
  const vIn = (G.rampA.lane.v0 + G.rampA.lane.v1) / 2;
  b.lane.color(PAL.laneWhite, 0.55);
  arrowL(b, G.width - 3, vIn, -1, 0, 5, 0);
  arrowL(b, G.rampA.foot + 6, vIn, -1, 0, 5, 0);
  // Ticket booth.
  b.wall.color(PAL.curb, 1.7);
  boxL(b.wall, BOOTH.u0, BOOTH.u1, BOOTH.v0, BOOTH.v1, 0, BOOTH.top);
  b.props.color(0x15181d, 1);
  boxL(b.props, BOOTH.u0 - 0.02, BOOTH.u0, BOOTH.v0 + 0.8, BOOTH.v1 - 0.8, 1.1, 2.1);
  b.wall.color(PAL.curb, 1.4);
  boxL(b.wall, BOOTH.u0 - 0.3, BOOTH.u1 + 0.3, BOOTH.v0 - 0.3, BOOTH.v1 + 0.3, BOOTH.top, BOOTH.top + 0.25);
  b.props.color(0xd9d9d9, 1.1);
  beamL(b.props, BOOTH.u0 + 0.6, BOOTH.v0 + 0.4, BOOTH.u0 - 3.2, BOOTH.v0 + 1.6, 0.12, 0.02, 0.16);
  paintSurface(b, faceL(BOOTH.u1, (BOOTH.v0 + BOOTH.v1) / 2, 0, 1, 0, BOOTH.v1 - BOOTH.v0, BOOTH.top), DERELICT, 5151);
  // Weeds along the lot's edges and the building's foot, clear of the exit and its run-out.
  for (let n = 0; n < 24; n++) {
    const u = west + rng() * (-1.5 - west);
    const v = rng() * 106;
    const p = P(u, v);
    weeds(b, p.x, 0, p.z, rng, { scale: 0.9 + rng() * 0.8, dry: 0.5, room: 1.2 });
  }
}

/** The stair and lift core on the west face: a blank concrete tower, painted, with a dead P. */
function core(b: EnvBuilders): void {
  const c = STAIR_CORE;
  b.wall.color(PAL.curb, 1.7);
  boxL(b.wall, c.u0, c.u1, c.v0, c.v1, 0, c.top);
  b.wall.color(PAL.curb, 1.4);
  boxL(b.wall, c.u0 - 0.2, c.u1 + 0.1, c.v0 - 0.2, c.v1 + 0.2, c.top, c.top + 0.4);
  b.props.color(0x0d1014, 1);
  for (let y = 2; y < c.top - 2; y += 2.6) boxL(b.props, c.u0 - 0.02, c.u0, c.v0 + 2.4, c.v0 + 3.1, y, y + 1.6);
  const wide = c.v1 - c.v0;
  paintSurface(b, faceL(c.u0, (c.v0 + c.v1) / 2, 0, -1, 0, wide, 6), DERELICT, 6161);
  grimeSurface(b, faceL(c.u0, (c.v0 + c.v1) / 2, 0, -1, 0, wide, c.top), DERELICT, 6162, 'streak');
  const u = c.u0 - 0.08;
  const vm = (c.v0 + c.v1) / 2;
  const y0 = c.top - 5.4;
  b.neonFlicker.color(PAL.neonCyan, 0.9);
  tubeL(b.neonFlicker, u, vm - 0.9, y0, u, vm - 0.9, y0 + 3.2, 0.14);
  b.neon.color(PAL.neonCyan, 0.12);
  const loop: Array<[number, number]> = [
    [-0.9, 3.2],
    [0.4, 3.2],
    [0.9, 2.8],
    [0.9, 2.1],
    [0.4, 1.7],
    [-0.9, 1.7],
  ];
  for (let i = 0; i < loop.length - 1; i++) tubeL(b.neon, u, vm + loop[i][0], y0 + loop[i][1], u, vm + loop[i + 1][0], y0 + loop[i + 1][1], 0.14);
}

/** The facade bands: a spandrel hung over each slab edge, streaked, painted low down. */
function facade(b: EnvBuilders, rng: () => number): void {
  const W = G.width;
  const D = G.depth;
  const f = G.fallen;
  for (const lvl of [1, 2] as const) {
    const y = lvl === 1 ? G.L1 : G.L2;
    const y0 = y - G.slab - 0.35;
    const y1 = y + PARAPET_H + 0.05;
    b.wall.color(PAL.curb, 1.85);
    boxL(b.wall, -0.2, W + 0.2, -0.2, 0.05, y0, y1, true);
    boxL(b.wall, -0.2, 0.05, -0.2, D + 0.2, y0, y1, true);
    boxL(b.wall, W - 0.05, W + 0.2, -0.2, lvl === 1 ? D + 0.2 : G.kick.v1, y0, y1, true);
    // South: L1's band either side of the exit's mouth, L2's short of the hole.
    const mouthW = laneEdgeU(-G.laneHalf, D);
    const mouthE = laneEdgeU(G.laneHalf, D);
    boxL(b.wall, -0.2, lvl === 1 ? mouthW : f.u0 - RAIL_IN, D - 0.05, D + 0.2, y0, y1, true);
    if (lvl === 1) boxL(b.wall, mouthE, W + 0.2, D - 0.05, D + 0.2, y0, y1, true);
    let seed = 101 + lvl * 50;
    for (let v = 6; v < D - 4; v += 11) {
      grimeSurface(b, faceL(-0.2, v, y0, -1, 0, 9, y1 - y0), DERELICT, seed++, 'streak');
      grimeSurface(b, faceL(W + 0.2, v, y0, 1, 0, 9, y1 - y0), DERELICT, seed++, 'streak');
    }
    for (let u = 6; u < f.u0 - 6; u += 12) grimeSurface(b, faceL(u, D + 0.2, y0, 0, 1, 10, y1 - y0), DERELICT, seed++, 'streak');
    if (lvl === 1) {
      for (let u = 8; u < f.u0 - 8; u += 16) paintSurface(b, faceL(u, D + 0.2, y0, 0, 1, 14, y1 - y0), DERELICT, 777 + u);
      paintSurface(b, faceL(W + 0.2, 24, y0, 1, 0, 20, y1 - y0), DERELICT, 913);
    }
  }
  // Weeds on the roof, in the corners and along the parapets.
  for (let n = 0; n < 24; n++) {
    const side = n % 3;
    const t = rng();
    const u = side === 0 ? 1.2 + t * (W - 2.4) : side === 1 ? 1.2 : 1.2 + t * (f.u0 - 3);
    const v = side === 0 ? 1.2 : side === 1 ? 17 + t * (D - 18.2) : D - 1.2;
    const p = P(u, v);
    weeds(b, p.x, G.L2, p.z, rng, { scale: 0.8 + rng() * 0.7, dry: 0.6, room: 0.9 });
  }
}

/* ------------------------------------------------------------------ paint */

/** A chevron arrow on a deck, pointing along local (du, dv). */
function arrowL(b: EnvBuilders, u: number, v: number, du: number, dv: number, len: number, y: number | Deck): void {
  const l = Math.hypot(du, dv) || 1;
  const fu = du / l;
  const fv = dv / l;
  const ru = -fv;
  const rv = fu;
  const w = len * 0.3;
  const at: number | Deck = typeof y === 'number' ? y + LIFT.paint : (pu, pv) => y(pu, pv) + LIFT.paint;
  flatL(b.lane, u - fu * len * 0.15, v - fv * len * 0.15, du, dv, len * 0.7, 0.35, at);
  for (const s of [-1, 1]) {
    const tu = u + fu * len * 0.35;
    const tv = v + fv * len * 0.35;
    const bu = tu - fu * w + ru * w * s;
    const bv = tv - fv * w + rv * w * s;
    flatL(b.lane, (tu + bu) / 2, (tv + bv) / 2, tu - bu, tv - bv, Math.hypot(tu - bu, tv - bv) + 0.2, 0.35, at);
  }
}

function paint(b: EnvBuilders, rng: () => number): void {
  const A = G.rampA;
  const B = G.rampB;
  const worn = (): number => 0.4 + rng() * 0.35;
  // Stalls: L0's north and south rows, L1's south row, both nose-in to the facade.
  for (const [y, v0, v1] of [
    [0, 0.8, 6],
    [0, 42, 47.2],
    [G.L1, 42, 47.2],
  ] as const) {
    for (let u = 16; u < 50; u += 2.6) {
      b.lane.color(PAL.laneWhite, worn());
      flatL(b.lane, u, (v0 + v1) / 2, 0, 1, v1 - v0, 0.12, y + LIFT.paint);
    }
  }
  // Chevrons: in, up A, round the column, up B, along the roof, down the runway, out the exit.
  const midA = (A.lane.v0 + A.lane.v1) / 2;
  const midB = (B.lane.v0 + B.lane.v1) / 2;
  b.lane.color(HAZARD, 0.6);
  for (const s of [5, 19, 32]) {
    arrowL(b, A.foot - s, midA, -1, 0, 5, rampDeck(A, 0));
    arrowL(b, B.foot + s, midB, 1, 0, 5, rampDeck(B, 0));
  }
  arrowL(b, 7, 16, 0, -1, 5, G.L1);
  arrowL(b, 58, midB, 1, 0, 5, G.L2);
  arrowL(b, 30, 40, 1, 0, 5, G.L1);
  b.lane.color(HAZARD, 0.5);
  for (const v of [22, 31]) arrowL(b, G.laneU(v), v, G.laneTan, 1, 5, G.L2);
  // Hazard bars across the heave, laid on it, faded: the last thing before the air.
  const k = G.kick;
  for (let v = k.v0 + 0.6; v < k.v1 - 0.4; v += 1.7) {
    b.lane.color(HAZARD, 0.55 + rng() * 0.15);
    for (const o of [-2.4, 0, 2.4]) flatL(b.lane, laneEdgeU(o, v), v, 1, 0.35, 1.8, 0.55, roofDeck(LIFT.paint));
  }
  // A wide worn band in each level's colour at every ramp mouth.
  for (const [u, v, y, lvl] of [
    [A.foot + 1.5, midA, 0, 0],
    [A.top - 1.5, midA, G.L1, 1],
    [B.foot - 1.5, midB, G.L1, 1],
    [B.top + 1.5, midB, G.L2, 2],
  ] as const) {
    b.lane.color(LEVEL_BAND[lvl], 0.5);
    flatL(b.lane, u, v, 0, 1, 13, 0.8, y + LIFT.paint);
  }
}

/** Two tyres' worth of black along a local polyline on a deck. */
function tyreLine(b: EnvBuilders, pts: Array<[number, number]>, deck: Deck, alpha: number, rng: () => number): void {
  const uv = graffitiCell(12);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ua, va] = pts[i];
    const [ub, vb] = pts[i + 1];
    const du = ub - ua;
    const dv = vb - va;
    const l = Math.hypot(du, dv);
    if (l < 0.2) continue;
    const ru = -dv / l;
    const rv = du / l;
    for (const s of [-0.8, 0.8]) {
      b.decal.color(0x040506, alpha * (0.8 + rng() * 0.4));
      flatL(b.decal, (ua + ub) / 2 + ru * s, (va + vb) / 2 + rv * s, du, dv, l + 0.3, 0.32, deck, uv);
    }
  }
}
function arc(cu: number, cv: number, r: number, a0: number, a1: number, n: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r]);
  }
  return out;
}

function tyreMarks(b: EnvBuilders, rng: () => number): void {
  const l1: Deck = () => G.L1 + LIFT.decal;
  const roof = roofDeck(LIFT.decal);
  // L1: the U-turn round the column in the west bay, laid many times over.
  for (let k = 0; k < 4; k++) tyreLine(b, arc(G.rampA.top, G.row, 7.5 + k * 0.6 + rng() * 0.4, Math.PI / 2, Math.PI * 1.5, 14), l1, 0.55, rng);
  // L1's south row out to the exit.
  tyreLine(b, [[8, 36], [20, 40], [40, 40], ...arc(40, 50, 10, -Math.PI / 2, 0, 8)], l1, 0.4, rng);
  // The roof: off ramp B round into the runway, donuts in the middle, a figure of eight.
  tyreLine(b, arc(G.rampB.top, 16, 7, -Math.PI / 2, 0, 10), roof, 0.6, rng);
  for (let k = 0; k < 3; k++) tyreLine(b, arc(30 + (rng() - 0.5) * 4, 38 + (rng() - 0.5) * 3, 4 + rng() * 1.5, 0, Math.PI * 2, 18), roof, 0.7, rng);
  tyreLine(b, arc(22, 26, 5, Math.PI / 2, Math.PI * 2.5, 16), roof, 0.5, rng);
  // Down the runway into the lip.
  for (let k = 0; k < 3; k++) {
    const o = (rng() - 0.5) * 2.4;
    tyreLine(b, [[G.rampB.top + 1, 9], [laneEdgeU(o - 1, 18), 18], [laneEdgeU(o, 28), 28], [laneEdgeU(o * 0.5, 38), 38], [laneEdgeU(o * 0.3, G.kick.v1 - 0.3), G.kick.v1 - 0.3]], roof, 0.75, rng);
  }
}

/* ------------------------------------------------------------------ light */

function lights(b: EnvBuilders, rng: () => number): void {
  const W = G.width;
  const D = G.depth;
  const A = G.rampA;
  const e = G.exit;
  const half = G.laneHalf;
  // Sodium strips under the slabs along the drive lanes: [level, u0, v0, u1, v1]. One in five
  // dead, one in six dying; the pools they throw light the way round.
  const midA = (A.lane.v0 + A.lane.v1) / 2;
  const runs: Array<[0 | 1 | 2, number, number, number, number]> = [
    [0, 4, 8, 62, 8],
    [0, 4, 40, 62, 40],
    [0, 59, 4, 59, 46],
    [1, 7, 4, 7, 46],
    [1, 4, 40, 62, 40],
    [1, 59, 4, 59, 30],
    // Over ramp A, hung from the roof slab.
    [2, A.lane.u0 + 2, midA, A.lane.u1 - 2, midA],
  ];
  for (const [lvl, u0, v0, u1, v1] of runs) {
    const ceiling = (lvl === 0 ? G.L1 : G.L2) - G.slab - 0.06;
    const floor = lvl === 0 ? 0 : lvl === 1 ? G.L1 : -1;
    const len = Math.hypot(u1 - u0, v1 - v0);
    const du = (u1 - u0) / len;
    const dv = (v1 - v0) / len;
    for (let t = 0; t <= len; t += 7.5) {
      const u = u0 + du * t;
      const v = v0 + dv * t;
      const dead = rng() < 0.2;
      const dying = !dead && rng() < 0.17;
      b.props.color(PAL.metalDark, 1.6);
      beamL(b.props, u - du * 0.8, v - dv * 0.8, u + du * 0.8, v + dv * 0.8, 0.26, ceiling - 0.1, ceiling);
      if (dead) continue;
      const mb = dying ? b.neonFlicker : b.neon;
      mb.color(SODIUM, dying ? 0.8 : 0.75);
      beamL(mb, u - du * 0.75, v - dv * 0.75, u + du * 0.75, v + dv * 0.75, 0.16, ceiling - 0.15, ceiling - 0.1);
      const p = P(u, v);
      if (floor >= 0) groundGlow(b, p.x, p.z, 8, 8, SODIUM, dying ? 0.06 : 0.12, floor + LIFT.glow);
    }
  }
  // Amber markers on every parapet and kerb, the city's rail language.
  b.neon.color(MARK, 0.85);
  for (const w of parkadeWalls()) {
    if (w.kind === 'face') continue;
    const len = Math.hypot(w.u1 - w.u0, w.v1 - w.v0);
    for (let t = 2; t < len - 0.5; t += 5) {
      const u = w.u0 + ((w.u1 - w.u0) * t) / len;
      const v = w.v0 + ((w.v1 - w.v0) * t) / len;
      const y = topAt(u, v, w.maxY - 1) + (w.kind === 'kerb' ? KERB_H : PARAPET_H);
      boxL(b.neon, u - 0.09, u + 0.09, v - 0.09, v + 0.09, y, y + 0.07);
    }
  }
  // Roof lamps on the parapets; the live ones light the drift room.
  for (const [u, v, live] of [
    [1.6, 17, true],
    [1.6, D - 1.6, true],
    [30, D - 1.6, false],
    [G.fallen.u0 - 3, D - 1.6, true],
    [W - 1.6, 1.6, false],
  ] as const) {
    const p = P(u, v);
    const cu = u + (u < W / 2 ? 2.2 : -2.2);
    const cv = v + (v < D / 2 ? 2.2 : -2.2);
    const c = P(cu, cv);
    b.props.color(PAL.metalDark, 1.9);
    b.props.box(p.x, G.L2 + 3.6, p.z, 0.22, 7.2, 0.22);
    b.props.tube(p.x, G.L2 + 7.1, p.z, c.x, G.L2 + 7.3, c.z, 0.16);
    if (!live) continue;
    b.neon.color(SODIUM, 0.95);
    b.neon.box(c.x, G.L2 + 7.12, c.z, 0.6, 0.08, 0.6);
    const pool = P(u + (u < W / 2 ? 8 : -8), v + (v < D / 2 ? 8 : -8));
    groundGlow(b, pool.x, pool.z, 18, 18, SODIUM, 0.12, G.L2 + LIFT.glow);
  }
  // The exit, lit from both kerbs so it reads from the lip: poles every 12 m with pools on it.
  for (let v = e.vRamp + 4; v < e.v1 - 2; v += 12) {
    for (const side of [-1, 1]) {
      const u = laneEdgeU(side * (half + 0.15), v);
      const y = exitY(laneEdgeU(side * (half - 0.8), v), v) ?? 0;
      const p = P(u, v);
      const head = P(laneEdgeU(side * (half - 2.2), v), v);
      b.props.color(PAL.metalDark, 1.9);
      b.props.box(p.x, y + 3.2, p.z, 0.2, 6.4, 0.2);
      b.props.tube(p.x, y + 6.3, p.z, head.x, y + 6.5, head.z, 0.14);
      if (rng() < 0.2) continue;
      b.neon.color(SODIUM, 0.9);
      b.neon.box(head.x, y + 6.36, head.z, 0.5, 0.07, 0.5);
      const pu = laneEdgeU(side * 1.5, v);
      const pool = P(pu, v);
      groundGlow(b, pool.x, pool.z, 9, 12, SODIUM, 0.12, (exitY(pu, v) ?? 0) + LIFT.glow);
    }
  }
  // A dying red beacon on each corner of the lip.
  for (const [u, v, y] of [
    [laneEdgeU(-(half - RAIL_IN), G.kick.v1), G.kick.v1, G.L2 + G.kickRise + PARAPET_H + 0.05],
    [laneEdgeU(half - RAIL_IN, G.kick.v1), G.kick.v1, G.L2 + G.kickRise + PARAPET_H + 0.05],
  ] as const) {
    b.neonFlicker.color(0xff3b2e, 1);
    boxL(b.neonFlicker, u - 0.14, u + 0.14, v - 0.14, v + 0.14, y, y + 0.22);
    const p = P(u, v);
    b.glow.color(0xff3b2e, 0.22);
    b.glow.panel(p.x, y + 0.1, p.z, 1.6, 1.6, 0);
    b.glow.panel(p.x, y + 0.1, p.z, 1.6, 1.6, Math.PI / 2);
  }
}

/* ------------------------------------------------------------------ what was left behind */

function debris(b: EnvBuilders, rng: () => number): void {
  // Wrecks: stripped, burnt shells on their rims, as big as their colliders.
  for (const w of wreckRects()) {
    const y = w.level * G.L1;
    const r = w.r;
    const cu = (r.u0 + r.u1) / 2;
    const cv = (r.v0 + r.v1) / 2;
    const long = w.alongU ? r.u1 - r.u0 : r.v1 - r.v0;
    const wide = w.alongU ? r.v1 - r.v0 : r.u1 - r.u0;
    const du = w.alongU ? 1 : 0;
    const dv = w.alongU ? 0 : 1;
    b.props.color(rng() < 0.5 ? 0x2a2320 : 0x33302e, 1);
    beamL(b.props, cu - (du * long) / 2, cv - (dv * long) / 2, cu + (du * long) / 2, cv + (dv * long) / 2, wide, y + 0.25, y + 0.95);
    beamL(b.props, cu - (du * long) / 4, cv - (dv * long) / 4, cu + (du * long) / 5, cv + (dv * long) / 5, wide - 0.35, y + 0.95, y + 1.35);
    b.props.color(RUST, 1.3);
    beamL(b.props, cu - (du * long) / 2, cv - (dv * long) / 2, cu + (du * long) / 2, cv + (dv * long) / 2, wide + 0.02, y + 0.05, y + 0.3);
    b.decal.color(PAL.grime, 1.2);
    flatL(b.decal, cu, cv, du, dv, long + 1.5, wide + 1.2, y + LIFT.decal, graffitiCell(15));
  }
  // Rubble heaps: a slab lying across the whole collider, chunks and rebar on it.
  for (const [u, v, hu, hv, lvl] of PARKADE_RUBBLE) {
    const y = lvl === 0 ? 0 : G.L1;
    b.wall.color(PAL.curb, 1.6);
    quadN(b.wall, [u - hu, v - hv, y + 0.3], [u + hu, v - hv, y + 1.9], [u + hu, v + hv, y + 1.7], [u - hu, v + hv, y + 0.2], UP);
    quadN(b.wall, [u - hu, v - hv, y], [u + hu, v - hv, y], [u + hu, v - hv, y + 1.9], [u - hu, v - hv, y + 0.3], [0, 0, -1]);
    quadN(b.wall, [u - hu, v + hv, y], [u + hu, v + hv, y], [u + hu, v + hv, y + 1.7], [u - hu, v + hv, y + 0.2], [0, 0, 1]);
    quadN(b.wall, [u - hu, v - hv, y], [u - hu, v + hv, y], [u - hu, v + hv, y + 0.2], [u - hu, v - hv, y + 0.3], [-1, 0, 0]);
    for (let i = 0; i < 5; i++) {
      const cu = u + (rng() - 0.5) * hu * 1.6;
      const cv = v + (rng() - 0.5) * hv * 1.6;
      const s = Math.min(hu, hv) * (0.4 + rng() * 0.5);
      beamL(b.wall, cu - s, cv - s * (rng() - 0.5), cu + s, cv + s * (rng() - 0.5) + 0.01, s * 1.2, y, y + 0.8 + rng() * 0.9);
    }
    b.props.color(RUST, 1.5);
    for (let i = 0; i < 6; i++) {
      const cu = u + (rng() - 0.5) * hu * 1.6;
      const cv = v + (rng() - 0.5) * hv * 1.6;
      tubeL(b.props, cu, cv, y + 0.6, cu + (rng() - 0.5) * 2, cv + (rng() - 0.5) * 2, y + 1.4 + rng() * 1.2, 0.035);
    }
  }
  // Loose chunks on L1 under the hole, flat enough to roll over.
  const f = G.fallen;
  b.wall.color(PAL.curb, 1.6);
  for (let n = 0; n < 10; n++) {
    const v = f.v0 + rng() * (f.v1 - f.v0 - 0.8);
    const u = laneEdgeU(G.laneHalf + 0.8, v) + rng() * (f.u1 - laneEdgeU(G.laneHalf + 0.8, v) - 1.5);
    const s = 0.3 + rng() * 0.5;
    beamL(b.wall, u, v, u + (rng() - 0.5) * s * 2, v + (rng() - 0.5) * s * 2 + 0.01, s, G.L1, G.L1 + 0.08 + rng() * 0.12);
  }
}
