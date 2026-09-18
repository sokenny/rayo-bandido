import type { SetPieceSpec } from '../../../../world/setPieces/types';
import {
  STORM_DRAIN_CONFIG as C,
  bankXAtDepth,
  bridgeAt,
  floorDepth,
  floorToes,
  stormDrainDepth,
} from '../../../../world/setPieces/stormDrain';
import { groundGlow, halo, type EnvBuilders } from '../builders';
import { graffitiAspect, graffitiCell, grimeSurface, paintSurface, pickPaintCell } from '../graffiti';
import { makeRng, type MeshBuilder } from '../meshBuilder';
import { PAL } from '../palette';
import type { GraffitiSurface, ReclaimProfile } from '../reclaim';

/**
 * The art of the concrete storm drain channel (`world/setPieces/stormDrain.ts`, tag 'storm-drain'):
 * the LA River look — two long pale concrete banks at 30° from street level down to a dirty floor,
 * bridges sitting on abutments, a headwall with an arched culvert mouth, the vaulted tunnel behind
 * it with a few old lamps, and the open cut climbing out of it.
 *
 * Everything below grade is drawn from `stormDrainDepth`, the very function the surface field
 * reads (4 cm under it, where the city's ground plane sits), and every wall a car stops at is drawn
 * ON its collider's line. Shared batches only: no material, no light, no draw call of its own.
 * Deterministic: one seeded rng.
 */

const T = C.tunnel;
/** The ground plane sits this far under the road (`cityBuilder.ts` GROUND_Y); so does this. */
const SINK = 0.04;
/** Rows of the channel surface (m along z), the finest step across it (m), and the tunnel's rows. */
const ROW = 2;
const COL = 1;
const TUNNEL_ROW = 4;
/** Expansion joints across the channel, and seams along each bank (m of slope between them). */
const JOINT = 12;
const SEAM = 5;
/** The headwall's face (z) where the channel's cars stop, and its back, where the lot's cars do. */
const HEAD_FACE = T.portalZ - 2.2;
const HEAD_BACK = T.portalZ + 0.6;
/** The concrete: pale on the banks, where the sun and the rain keep it clean; darker on the floor. */
const BANK = 0xb9b4a6;
const FLOOR = 0x8a877e;
/** The trickle down the middle, and the tunnel's old sodium lamps. */
const WATER = 0x3c5560;
const SODIUM = 0xffb45a;

/** A bank as the writers and the weather see it. */
const DRAIN_WALLS: ReclaimProfile = {
  intensity: 0.75,
  level: 2,
  vegetation: 0,
  weeds: 0,
  vines: 0,
  graffiti: 0.85,
  graffitiScale: 0.9,
  decay: 0.95,
  planter: 0,
  bigTree: false,
  grafWall: true,
};

type At = (x: number, z: number) => number;

export function buildStormDrain(b: EnvBuilders, piece: SetPieceSpec): void {
  if (!piece.cut) return;
  const rng = makeRng(0x57d7a1);
  /** World y of the concrete at a point. */
  const at: At = (x, z) => b.plan.padY(x, z) - stormDrainDepth(x, z) - SINK;
  channel(b, at);
  bridges(b, at);
  headwall(b, at);
  tunnel(b, rng);
  exitCut(b, at);
  joints(b, at);
  water(b, at);
  bankPaint(b, at, rng);
  outfalls(b, at, rng);
  tyreMarks(b, at, rng);
  stains(b, at, rng);
  litter(b, at, rng);
}

/* ------------------------------------------------------------------ helpers */

/** Row boundaries of the open channel along z, with each deck's edges exactly. */
function channelRows(): number[] {
  const set = new Set<number>();
  for (let z = C.rows[0][0]; z < HEAD_FACE; z += ROW) set.add(Math.round(z * 100) / 100);
  set.add(HEAD_FACE);
  for (const br of C.bridges) {
    set.add(br.z0);
    set.add(br.z1);
  }
  return [...set].sort((a, c) => a - c);
}

/** One strip of a height field between two rows, columns dropped where it is straight across. */
function strip(mb: MeshBuilder, at: At, za: number, zb: number, x0: number, x1: number, tint: (y: number) => void): void {
  const xs: number[] = [];
  for (let x = x0; x < x1 - 1e-6; x += COL) xs.push(x);
  xs.push(x1);
  const keep: number[] = [xs[0]];
  for (let i = 1; i + 1 < xs.length; i++) {
    const bend = (z: number): number => Math.abs(at(xs[i - 1], z) - 2 * at(xs[i], z) + at(xs[i + 1], z));
    if (bend(za) > 0.004 || bend(zb) > 0.004 || i % 6 === 0) keep.push(xs[i]);
  }
  keep.push(xs[xs.length - 1]);
  for (let i = 0; i + 1 < keep.length; i++) {
    const xa = keep[i];
    const xb = keep[i + 1];
    const ya0 = at(xa, za);
    const yb0 = at(xb, za);
    const ya1 = at(xa, zb);
    const yb1 = at(xb, zb);
    tint((ya0 + yb0 + ya1 + yb1) / 4);
    mb.quad(xa, ya1, zb, xb, yb1, zb, xb, yb0, za, xa, ya0, za);
  }
}

/** A vertical face across x at z (facing ±z), from a bottom that follows `bottom(x)` up to `top`. */
function faceZ(mb: MeshBuilder, z: number, facing: 1 | -1, x0: number, x1: number, bottom: (x: number) => number, top: number, step = 1): void {
  for (let x = x0; x < x1 - 1e-6; x += step) {
    const xb = Math.min(x1, x + step);
    const ya = bottom(x);
    const yb = bottom(xb);
    if (ya >= top && yb >= top) continue;
    if (facing > 0) mb.quad(x, ya, z, xb, yb, z, xb, top, z, x, top, z);
    else mb.quad(xb, yb, z, x, ya, z, x, top, z, xb, top, z);
  }
}

/** The vault's underside at x across the tunnel (world y): walls to the springline, then an arch. */
function vaultY(x: number): number {
  const half = (T.east - T.west) / 2;
  const cx = (T.west + T.east) / 2;
  const rise = T.crown - T.spring;
  const r = (half * half + rise * rise) / (2 * rise);
  const u = Math.min(half, Math.abs(x - cx));
  return T.crown - r + Math.sqrt(r * r - u * u);
}

/* ------------------------------------------------------------------ the channel */

/** Floor and banks, lip to perimeter wall, and the bit of the perimeter wall's foot below grade. */
function channel(b: EnvBuilders, at: At): void {
  const rows = channelRows();
  for (let r = 0; r + 1 < rows.length; r++) {
    const za = rows[r];
    const zb = rows[r + 1];
    strip(b.wall, at, za, zb, C.lipX - 0.5, C.eastX, (y) => {
      const t = Math.min(1, Math.max(0, (-y - 1) / (C.depth - 1.5)));
      b.wall.color(t > 0.97 ? FLOOR : BANK, 1.05 - 0.2 * t);
    });
    // The perimeter wall carried down to the bank's top (facing -x, into the channel).
    const ya = at(C.eastX - 0.01, za) - 0.2;
    const yb = at(C.eastX - 0.01, zb) - 0.2;
    if (ya < -0.1 || yb < -0.1) {
      b.wall.color(PAL.concrete, 1.1);
      b.wall.quad(C.eastX, ya, za, C.eastX, yb, zb, C.eastX, 0.3, zb, C.eastX, 0.3, za);
    }
  }
  // A kerb of lighter concrete along the lip, where the bank meets av-e1's pavement.
  // Broken at each stub, whose road runs over it.
  b.concrete.color(BANK, 0.9);
  let from: number = C.north.dry;
  for (const br of [...C.bridges, { z0: HEAD_FACE, z1: HEAD_FACE }]) {
    if (br.z0 > from + 1) b.concrete.box(C.lipX - 0.25, -SINK + 0.03, (from + br.z0) / 2, 1.1, 0.08, br.z0 - from);
    from = br.z1;
  }
}

/**
 * Each stub's deck: a slab at grade with girders under it and parapets over the drop, sitting on
 * two ABUTMENTS — the top of each bank filled up to the soffit, faced where the collider stands
 * (its z edges and the depth `abutmentY` down the bank).
 */
function bridges(b: EnvBuilders, at: At): void {
  const th = C.deck.thickness;
  const soffit = -SINK - th;
  for (const br of C.bridges) {
    const cz = (br.z0 + br.z1) / 2;
    const len = br.z1 - br.z0;
    b.concrete.color(PAL.concrete, 0.85);
    b.concrete.box((C.lotWest + C.eastX) / 2, -SINK - th / 2, cz, C.eastX - C.lotWest, th, len, { bottom: true });
    b.wall.color(PAL.concrete, 0.95);
    for (let z = br.z0 + 2; z < br.z1 - 1; z += 4) b.wall.box((C.lotWest + C.eastX) / 2, soffit - 0.35, z, C.eastX - C.lotWest, 0.7, 0.5, { bottom: true });
    const from = bankXAtDepth(0.6, cz).west;
    for (const [edge, side] of [[br.z0, -1], [br.z1, 1]] as Array<[number, number]>) {
      // The parapet a metre in from the edge (where the collider is), and the fascia's rust.
      const pz = edge - side * 1;
      b.wall.color(PAL.concrete, 1.25);
      b.wall.box((from + C.eastX) / 2, 0.5, pz + side * 0.2, C.eastX - from, 1.08, 0.4);
      b.props.color(PAL.metalDark, 0.8);
      b.props.box((from + C.eastX) / 2, 1.08, pz + side * 0.2, C.eastX - from, 0.08, 0.5);
      const s: GraffitiSurface = { x: (C.lotWest + C.eastX) / 2, y: soffit - 0.7, z: edge + side * 0.01, nx: 0, nz: side, tx: side, tz: 0, width: C.eastX - C.lotWest - 2, height: th + 0.7, out: 0.03 };
      grimeSurface(b, s, DRAIN_WALLS, (Math.round(br.z0) * 131 + side * 7) >>> 0, 'streak');
    }
    // The abutments on both banks.
    const w = bankXAtDepth(-C.abutmentY, cz);
    const bottom = (x: number): number => Math.min(at(x, br.z0), at(x, br.z1)) - 0.1;
    b.wall.color(PAL.concrete, 1.15);
    for (const [x0, x1] of [[C.lipX - 0.5, w.west], [w.east, C.eastX]] as Array<[number, number]>) {
      faceZ(b.wall, br.z0, -1, x0, x1, bottom, soffit);
      faceZ(b.wall, br.z1, 1, x0, x1, bottom, soffit);
    }
    // Their inner faces, from the abutment line down the bank to the soffit.
    b.wall.quad(w.west, C.abutmentY - 0.1, br.z1, w.west, C.abutmentY - 0.1, br.z0, w.west, soffit, br.z0, w.west, soffit, br.z1);
    b.wall.quad(w.east, C.abutmentY - 0.1, br.z0, w.east, C.abutmentY - 0.1, br.z1, w.east, soffit, br.z1, w.east, soffit, br.z0);
    for (const x of [w.west, w.east]) {
      const s: GraffitiSurface = { x, y: C.abutmentY, z: cz, nx: x === w.west ? 1 : -1, nz: 0, tx: 0, tz: x === w.west ? -1 : 1, width: len - 2, height: -C.abutmentY + soffit, out: 0.03 };
      paintSurface(b, s, DRAIN_WALLS, (Math.round(cz * 17) + (x === w.west ? 1 : 2)) >>> 0);
    }
  }
}

/* ------------------------------------------------------------------ the culvert */

/** The channel's end: a thick headwall across the whole cut, an arched mouth over the floor. */
function headwall(b: EnvBuilders, at: At): void {
  const top = C.parapet;
  const mouth = (x: number): boolean => x > T.west + 1e-6 && x < T.east - 1e-6;
  b.wall.color(PAL.concrete, 1.2);
  // Its face, where the channel's cars stop: down to the banks, and over the arch.
  faceZ(b.wall, HEAD_FACE, -1, C.lipX - 0.5, C.eastX, (x) => (mouth(x) ? vaultY(x) : at(x, HEAD_FACE - 0.01) - 0.1), top, 0.5);
  // Its top, and its back where the lot's cars stop.
  b.wall.quad(C.lotWest, top, HEAD_BACK, C.eastX, top, HEAD_BACK, C.eastX, top, HEAD_FACE, C.lotWest, top, HEAD_FACE);
  faceZ(b.wall, HEAD_BACK, 1, C.lotWest, C.eastX, () => -SINK, top, 4);
  // A ring of heavier concrete round the arch, standing proud of the face.
  b.concrete.color(PAL.concrete, 1.45);
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const x0 = T.west + ((T.east - T.west) * i) / steps;
    const x1 = T.west + ((T.east - T.west) * (i + 1)) / steps;
    const y0 = vaultY(x0);
    const y1 = vaultY(x1);
    b.concrete.quad(x1, y1, HEAD_FACE - 0.35, x0, y0, HEAD_FACE - 0.35, x0, y0 + 0.7, HEAD_FACE - 0.35, x1, y1 + 0.7, HEAD_FACE - 0.35);
    b.concrete.quad(x0, y0, HEAD_FACE - 0.35, x1, y1, HEAD_FACE - 0.35, x1, y1, HEAD_FACE, x0, y0, HEAD_FACE);
  }
  for (const x of [T.west - 0.35, T.east + 0.35]) b.concrete.box(x, (T.spring - C.depth) / 2, HEAD_FACE - 0.18, 0.7, T.spring + C.depth, 0.35);
  // A name board over the mouth, stencilled by the city, painted over by everyone since.
  const s: GraffitiSurface = { x: (T.west + T.east) / 2, y: T.crown + 0.2, z: HEAD_FACE, nx: 0, nz: -1, tx: -1, tz: 0, width: 26, height: top - T.crown - 0.3, out: 0.03 };
  paintSurface(b, s, { ...DRAIN_WALLS, graffiti: 1 }, 0x1ead);
  for (const side of [-1, 1]) {
    const cx = side < 0 ? (C.lipX + T.west) / 2 : (T.east + C.eastX) / 2;
    const ws: GraffitiSurface = { x: cx, y: -4, z: HEAD_FACE, nx: 0, nz: -1, tx: -1, tz: 0, width: 14, height: 4 + top, out: 0.03 };
    paintSurface(b, ws, DRAIN_WALLS, (0x2b0 + side) >>> 0);
    grimeSurface(b, ws, DRAIN_WALLS, (0x3c0 + side) >>> 0, 'streak');
  }
}

/** The vaulted tunnel: floor, walls, vault, ring joints, lamps and the trickle. */
function tunnel(b: EnvBuilders, rng: () => number): void {
  const z0 = HEAD_FACE;
  const z1 = T.exitZ;
  const floorY = -C.depth - SINK;
  const n = 12;
  const arch: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const x = T.west + ((T.east - T.west) * i) / n;
    arch.push([x, vaultY(x)]);
  }
  for (let z = z0; z < z1 - 1e-6; z += TUNNEL_ROW) {
    const zb = Math.min(z1, z + TUNNEL_ROW);
    b.wall.color(FLOOR, 0.8);
    b.wall.quad(T.west, floorY, zb, T.east, floorY, zb, T.east, floorY, z, T.west, floorY, z);
    b.wall.color(PAL.concrete, 1.05);
    // The walls, up to the springline, facing in.
    b.wall.quad(T.west, floorY, zb, T.west, floorY, z, T.west, T.spring, z, T.west, T.spring, zb);
    b.wall.quad(T.east, floorY, z, T.east, floorY, zb, T.east, T.spring, zb, T.east, T.spring, z);
    // The vault, facing down.
    b.wall.color(PAL.concrete, 1.0);
    for (let i = 0; i < n; i++) {
      const [xa, ya] = arch[i];
      const [xb, yb] = arch[i + 1];
      b.wall.quad(xa, ya, z, xb, yb, z, xb, yb, zb, xa, ya, zb);
    }
  }
  // Ring joints every 8 m: a dark band round the section.
  b.lane.color(0x06080a, 0.9);
  for (let z = z0 + 8; z < z1 - 2; z += 8) {
    b.lane.quad(T.west, floorY + 0.01, z + 0.08, T.east, floorY + 0.01, z + 0.08, T.east, floorY + 0.01, z - 0.08, T.west, floorY + 0.01, z - 0.08);
    b.lane.quad(T.west + 0.02, floorY, z + 0.08, T.west + 0.02, floorY, z - 0.08, T.west + 0.02, T.spring, z - 0.08, T.west + 0.02, T.spring, z + 0.08);
    b.lane.quad(T.east - 0.02, floorY, z - 0.08, T.east - 0.02, floorY, z + 0.08, T.east - 0.02, T.spring, z + 0.08, T.east - 0.02, T.spring, z - 0.08);
    for (let i = 0; i < n; i++) {
      const [xa, ya] = arch[i];
      const [xb, yb] = arch[i + 1];
      b.lane.quad(xa, ya - 0.02, z - 0.08, xb, yb - 0.02, z - 0.08, xb, yb - 0.02, z + 0.08, xa, ya - 0.02, z + 0.08);
    }
  }
  // Old sodium lamps on alternate walls under the springline: some steady, some stuttering, some dead.
  for (let z = z0 + 8, k = 0; z < z1 - 4; z += 11, k++) {
    const roll = rng();
    if (roll < 0.18) continue;
    const west = k % 2 === 0;
    const x = west ? T.west + 0.18 : T.east - 0.18;
    const y = T.spring - 0.6;
    b.props.color(PAL.metalDark, 1);
    b.props.box(x, y + 0.25, z, 0.3, 0.12, 1.5);
    const mb = roll < 0.35 ? b.neonFlicker : b.neon;
    mb.color(SODIUM, 1.2);
    mb.box(x, y + 0.13, z, 0.16, 0.1, 1.2);
    halo(b, x + (west ? 0.35 : -0.35), y, z, 4.5, 2.2, west ? Math.PI / 2 : -Math.PI / 2, SODIUM, 0.8);
    // The wall lit round it, and the pool on the floor.
    halo(b, x + (west ? 0.05 : -0.05), y - 1.2, z, 7, 4.5, west ? Math.PI / 2 : -Math.PI / 2, SODIUM, 0.25);
    groundGlow(b, x + (west ? 3.5 : -3.5), z, 8, 10, SODIUM, 0.45, floorY + 0.03);
  }
  // Grime down the walls, and paint near both mouths.
  for (let z = z0 + 6; z < z1 - 6; z += 16) {
    for (const west of [true, false]) {
      const s: GraffitiSurface = { x: west ? T.west : T.east, y: floorY, z, nx: west ? 1 : -1, nz: 0, tx: 0, tz: west ? -1 : 1, width: 12, height: T.spring - floorY, out: 0.03 };
      grimeSurface(b, s, DRAIN_WALLS, Math.floor(rng() * 1e9), rng() < 0.7 ? 'streak' : 'stain');
      if (z < z0 + 40 || z > z1 - 40) paintSurface(b, s, DRAIN_WALLS, Math.floor(rng() * 1e9));
    }
  }
  // The trickle down the middle of the tunnel floor.
  const cell = graffitiCell(13);
  const cx = (T.west + T.east) / 2 - 1.5;
  for (let z = z0; z < z1 - 1e-6; z += 6) {
    const zb = Math.min(z1, z + 6);
    const w = 0.8 + 0.3 * Math.sin(z * 0.2);
    b.decal.color(WATER, 1.3);
    b.decal.quad(cx - w, floorY + 0.02, z, cx - w, floorY + 0.02, zb, cx + w, floorY + 0.02, zb, cx + w, floorY + 0.02, z, cell.u0, cell.v0, cell.u1, cell.v1);
  }
}

/** The open cut out of the tunnel: its ramp, its retaining walls with parapets, the exit portal. */
function exitCut(b: EnvBuilders, at: At): void {
  const z0 = T.exitZ;
  const z1 = C.ramp.cutEnd;
  const top = C.parapet;
  for (let z = z0; z < z1 - 1e-6; z += ROW) {
    const zb = Math.min(z1, z + ROW);
    strip(b.wall, at, z, zb, T.west, T.east, () => b.wall.color(FLOOR, 0.95));
    // The walls: a slab from the ramp up to a parapet, behind each collider line.
    const foot = Math.min(at(T.west + 0.1, z), at(T.west + 0.1, zb)) - 0.2;
    b.wall.color(PAL.concrete, 1.2);
    for (const [x0, x1] of [[T.west - T.guard, T.west], [T.east, T.east + T.guard]] as Array<[number, number]>) {
      b.wall.box((x0 + x1) / 2, (foot + top) / 2, (z + zb) / 2, x1 - x0, top - foot, zb - z);
    }
  }
  // The exit portal: a headwall facing the cut, the vault's mouth in it, and its back on the lot.
  b.wall.color(PAL.concrete, 1.2);
  faceZ(b.wall, z0, 1, T.west - T.guard, T.east + T.guard, (x) => (x > T.west && x < T.east ? vaultY(x) : -C.depth), top, 0.5);
  b.wall.quad(T.west - T.guard, top, z0, T.east + T.guard, top, z0, T.east + T.guard, top, z0 - 0.6, T.west - T.guard, top, z0 - 0.6);
  faceZ(b.wall, z0 - 0.6, -1, T.west - T.guard, T.east + T.guard, () => -SINK, top, 4);
  for (const west of [true, false]) {
    const s: GraffitiSurface = { x: west ? T.west : T.east, y: -C.depth / 2, z: z0 + 12, nx: west ? 1 : -1, nz: 0, tx: 0, tz: west ? -1 : 1, width: 20, height: C.depth / 2, out: 0.03 };
    paintSurface(b, s, DRAIN_WALLS, west ? 0x51 : 0x52);
  }
  // Rubber up the ramp: two tracks swinging out of it towards av-e1.
  tracks(b, at, [[(T.west + T.east) / 2 + 1, z0 + 6], [(T.west + T.east) / 2, z0 + 30], [(T.west + T.east) / 2 - 1, z1 - 4]], 1);
}

/* ------------------------------------------------------------------ the details */

/** Joints across the channel, following the section, and seams along both banks. */
function joints(b: EnvBuilders, at: At): void {
  b.lane.color(0x0a0c0e, 0.75);
  for (let z = C.rows[0][0] + JOINT / 2; z < HEAD_FACE; z += JOINT) {
    if (floorDepth(z) < 0.3 || bridgeAt(z)) continue;
    let px = C.lipX - 0.5;
    let py = at(px, z) + 0.015;
    for (let x = px + 1; x <= C.eastX; x += 1) {
      const y = at(x, z) + 0.015;
      b.lane.quad(px, py, z + 0.05, x, y, z + 0.05, x, y, z - 0.05, px, py, z - 0.05);
      px = x;
      py = y;
    }
  }
  // Seams along the banks every few metres of slope, and one down each toe.
  for (let z = C.north.full; z < HEAD_FACE - 1e-6; z += 4) {
    const zb = Math.min(HEAD_FACE, z + 4);
    if (bridgeAt(z) || bridgeAt(zb)) continue;
    const toes = floorToes(z);
    const toesB = floorToes(zb);
    for (let d = 0; d < C.depth - 0.5; d += SEAM * C.bank.grade) {
      const wa = d === 0 ? toes.west : bankXAtDepth(C.depth - d, z).west;
      const wb = d === 0 ? toesB.west : bankXAtDepth(C.depth - d, zb).west;
      const ea = d === 0 ? toes.east : bankXAtDepth(C.depth - d, z).east;
      const eb = d === 0 ? toesB.east : bankXAtDepth(C.depth - d, zb).east;
      for (const [xa, xb] of [[wa, wb], [ea, eb]]) {
        if (xa > C.eastX - 0.3 || xa < C.lipX) continue;
        b.lane.quad(xa - 0.05, at(xa, zb) + 0.015, zb, xa + 0.05, at(xa, zb) + 0.015, zb, xb + 0.05, at(xb, z) + 0.015, z, xb - 0.05, at(xb, z) + 0.015, z);
      }
    }
  }
}

/** The trickle that is always there: standing water down the middle of the floor. */
function water(b: EnvBuilders, at: At): void {
  const cell = graffitiCell(13);
  let prev: { x: number; y: number; z: number } | null = null;
  for (let z = C.north.full; z <= HEAD_FACE; z += 4) {
    const toes = floorToes(z);
    const x = (toes.west + toes.east) / 2 + Math.sin(z * 0.045) * 1.2;
    const cur = { x, y: at(x, z) + 0.018, z };
    if (prev) {
      const w = 0.9 + 0.35 * Math.sin(z * 0.13);
      b.decal.color(WATER, 1.3);
      b.decal.quad(prev.x - w, prev.y, prev.z, cur.x - w, cur.y, cur.z, cur.x + w, cur.y, cur.z, prev.x + w, prev.y, prev.z, cell.u0, cell.v0, cell.u1, cell.v1);
      b.decal.color(PAL.grime, 1.2);
      b.decal.quad(prev.x - w - 1.2, prev.y - 0.002, prev.z, cur.x - w - 1.2, cur.y - 0.002, cur.z, cur.x + w + 1.2, cur.y - 0.002, cur.z, prev.x + w + 1.2, prev.y - 0.002, prev.z, cell.u0, cell.v0, cell.u1, cell.v1);
    }
    prev = cur;
  }
}

/** A quad laid on the bank: centre (x, z), `w` along the channel, `h` up the slope. */
function onBank(mb: MeshBuilder, at: At, x: number, z: number, w: number, h: number, west: boolean, lift: number, uv: { u0: number; v0: number; u1: number; v1: number }, flip = false): void {
  const run = (h / 2) / Math.sqrt(1 + C.bank.grade * C.bank.grade);
  const up = west ? -run : run;
  const xl = x - up;
  const xh = x + up;
  const za = z - w / 2;
  const zb = z + w / 2;
  const u0 = flip ? uv.u1 : uv.u0;
  const u1 = flip ? uv.u0 : uv.u1;
  // Bottom-left, bottom-right, top-right, top-left, seen from the channel (facing up the bank's normal).
  if (west) mb.quad(xl, at(xl, zb) + lift, zb, xl, at(xl, za) + lift, za, xh, at(xh, za) + lift, za, xh, at(xh, zb) + lift, zb, u0, uv.v0, u1, uv.v1);
  else mb.quad(xl, at(xl, za) + lift, za, xl, at(xl, zb) + lift, zb, xh, at(xh, zb) + lift, zb, xh, at(xh, za) + lift, za, u0, uv.v0, u1, uv.v1);
}

/** The pieces: big faded paint laid on the banks' slope, the way a river channel gets painted. */
function bankPaint(b: EnvBuilders, at: At, rng: () => number): void {
  for (let z = C.north.full + 20; z < HEAD_FACE - 12; z += 16 + rng() * 22) {
    if (bridgeAt(z) || bridgeAt(z - 8) || bridgeAt(z + 8)) continue;
    const west = rng() < 0.55;
    const cellIndex = pickPaintCell(rng);
    const aspect = graffitiAspect(cellIndex);
    const w = 7 + rng() * 9;
    const h = Math.min(8, w / aspect);
    // Centred between a third and two thirds of the way up the bank.
    const d = C.depth * (0.35 + rng() * 0.3);
    const x = bankXAtDepth(d, z)[west ? 'west' : 'east'];
    const fresh = rng() < 0.35;
    b.decal.color(0xffffff, fresh ? 0.95 : 0.5 + rng() * 0.25);
    onBank(b.decal, at, x, z, w, h, west, 0.03, graffitiCell(cellIndex), rng() < 0.3);
  }
}

/** Outfall pipes in the banks: a dark mouth, a steel grille, a stain run down to the floor. */
function outfalls(b: EnvBuilders, at: At, rng: () => number): void {
  const stain = graffitiCell(12);
  for (let z = C.north.full + 40; z < HEAD_FACE - 20; z += 38 + rng() * 20) {
    if (bridgeAt(z) || bridgeAt(z - 4) || bridgeAt(z + 4)) continue;
    const west = rng() < 0.5;
    const d = C.depth - 2.2;
    const x = bankXAtDepth(d, z)[west ? 'west' : 'east'];
    const y = at(x, z);
    b.props.color(0x040506, 1);
    onBank(b.props, at, x, z, 1.6, 1.4, west, 0.04, { u0: 0, v0: 0, u1: 1, v1: 1 });
    b.props.color(PAL.metalDark, 1.1);
    for (let k = -3; k <= 3; k++) b.props.box(x, y + 0.12, z + k * 0.22, 0.9, 0.06, 0.05);
    b.decal.color(PAL.grime, 1.5);
    onBank(b.decal, at, bankXAtDepth(d + 1.8, z)[west ? 'west' : 'east'], z, 2.2, 4.2, west, 0.025, stain);
  }
}

/** Rubber: two tracks along a path, laid on the concrete. */
function tracks(b: EnvBuilders, at: At, pts: Array<[number, number]>, bright: number): void {
  const streak = graffitiCell(12);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [cx, cz] = pts[i + 1];
    const len = Math.hypot(cx - ax, cz - az) || 1;
    const nx = -(cz - az) / len;
    const nz = (cx - ax) / len;
    for (const side of [-0.8, 0.8]) {
      const w = 0.13;
      const p0x = ax + nx * side;
      const p0z = az + nz * side;
      const p1x = cx + nx * side;
      const p1z = cz + nz * side;
      const y0 = at(p0x, p0z) + 0.025;
      const y1 = at(p1x, p1z) + 0.025;
      b.decal.color(0x020304, bright);
      b.decal.quad(p0x + nx * w, y0, p0z + nz * w, p1x + nx * w, y1, p1z + nz * w, p1x - nx * w, y1, p1z - nz * w, p0x - nx * w, y0, p0z - nz * w, streak.u0, streak.v0, streak.u1, streak.v1);
    }
  }
}

/** Where people drive: long arcs up the banks and back down, and down the north head. */
function tyreMarks(b: EnvBuilders, at: At, rng: () => number): void {
  for (let z = C.north.full + 30; z < HEAD_FACE - 60; z += 45 + rng() * 40) {
    const west = rng() < 0.5;
    const peak = C.depth * (0.35 + rng() * 0.35);
    const pts: Array<[number, number]> = [];
    for (let k = 0; k <= 16; k++) {
      const zz = z + k * 3.5;
      if (bridgeAt(zz)) break;
      const lift = Math.sin((Math.PI * k) / 16);
      const toes = floorToes(zz);
      const floorX = (toes.west + toes.east) / 2;
      const high = bankXAtDepth(C.depth - peak, zz)[west ? 'west' : 'east'];
      pts.push([floorX + (high - floorX) * lift, zz]);
    }
    if (pts.length > 3) tracks(b, at, pts, 0.6 + rng() * 0.6);
  }
  // Down the north head from av-e1.
  tracks(b, at, [[640, C.north.dry + 4], [652, C.north.dry + 25], [660, C.north.full], [662, C.north.full + 30]], 1);
}

/** Damp patches, oil and cracks on the floor and the banks. */
function stains(b: EnvBuilders, at: At, rng: () => number): void {
  const stain = graffitiCell(13);
  const crack = graffitiCell(14);
  for (let z = C.north.full; z < HEAD_FACE - 4; z += 6 + rng() * 9) {
    const toes = floorToes(z);
    const x = toes.west + 1 + rng() * (toes.east - toes.west - 2);
    const cell = rng() < 0.6 ? stain : crack;
    const s = 1.5 + rng() * 3;
    b.decal.color(PAL.grime, 0.9 + rng() * 0.7);
    b.decal.planeY(x, at(x, z) + 0.02 + rng() * 0.004, z, s, s * (0.7 + rng() * 0.6), cell.u0, cell.v0, cell.u1, cell.v1);
  }
}

/**
 * What the water left behind: tyres, crates, a mattress, bags, a trolley — on the lip by av-e1 and
 * against the perimeter wall at the top of the east bank, out of the line anyone drives.
 */
function litter(b: EnvBuilders, at: At, rng: () => number): void {
  for (let z = C.north.full + 10; z < HEAD_FACE - 10; z += 10 + rng() * 16) {
    if (bridgeAt(z)) continue;
    const west = rng() < 0.4;
    const x = west ? C.lotWest + 0.5 : C.eastX - 0.45;
    const y = at(x, z);
    const kind = rng();
    if (kind < 0.3) {
      b.props.color(0x0c0d0e, 1);
      b.props.box(x, y + 0.12, z, 0.62, 0.24, 0.62);
    } else if (kind < 0.55) {
      b.props.color(0x101214, 1.2);
      b.props.box(x, y + 0.2, z, 0.5, 0.4, 0.6);
      b.props.box(x, y + 0.14, z + 0.6, 0.45, 0.28, 0.45);
    } else if (kind < 0.72) {
      b.props.color(0x4a3a26, 0.8);
      b.props.box(x, y + 0.2, z, 0.55, 0.4, 0.8);
    } else if (kind < 0.85 && !west) {
      b.props.color(0x6e6558, 0.7);
      b.props.quad(x + 0.3, y + 1.1, z - 0.9, x + 0.3, y + 1.1, z + 0.9, x - 0.4, y + 0.05, z + 0.9, x - 0.4, y + 0.05, z - 0.9);
      b.props.quad(x - 0.4, y + 0.05, z - 0.9, x - 0.4, y + 0.05, z + 0.9, x + 0.3, y + 1.1, z + 0.9, x + 0.3, y + 1.1, z - 0.9);
    } else {
      b.props.color(0x8c949a, 0.6);
      b.props.tube(x, y + 0.1, z - 0.45, x, y + 0.1, z + 0.45, 0.04);
      b.props.tube(x, y + 0.6, z - 0.45, x, y + 0.6, z + 0.45, 0.04);
      b.props.tube(x, y + 0.1, z - 0.45, x, y + 0.6, z - 0.45, 0.04);
      b.props.tube(x, y + 0.1, z + 0.45, x, y + 0.6, z + 0.45, 0.04);
    }
  }
}
