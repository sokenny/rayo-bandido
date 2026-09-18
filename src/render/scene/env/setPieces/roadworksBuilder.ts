import type { SetPieceSpec } from '../../../../world/setPieces/types';
import { halo, type EnvBuilders } from '../builders';
import { ROAD_TILE } from '../cityBuilder';
import { graffitiCell, grimeSurface, paintSurface } from '../graffiti';
import { makeRng, type MeshBuilder } from '../meshBuilder';
import { PAL } from '../palette';
import type { GraffitiSurface, ReclaimProfile } from '../reclaim';
import {
  BARRIER_HEIGHT,
  BLOCK,
  DETOUR,
  EXIT_LEN,
  LIP_U,
  RAMP,
  RAMP_START,
  ROADWORKS_BARRIERS,
  ROADWORKS_SOLIDS,
  RUN_FRAME,
  STREET,
  TRENCH,
  TRENCH_BOX,
  WALL_INSET,
  rampHeightAt,
  rampProfile,
  rwWorld,
  trenchDepthAt,
  type RwBarrier,
  type RwSolid,
} from '../../../../world/setPieces/roadworks';

/**
 * LA OBRA DE LA N3, drawn (`world/setPieces/roadworks.ts`, tag 'roadworks'): the rubble mound
 * across the carriageway and its steel plates, the dig with its sheet-piled sides and the crews'
 * ramp out, the broken pavements, the desvío's gravel, the barriers, what the contractor left
 * behind, and what the racers left on top: rubber, paint, a flasher or two still blinking.
 *
 * The street's own asphalt, paint, cracks and lamps stop at the works by themselves
 * (`env/trackBuilder.ts` reads `groundHoles` and `lots`); the kerbs draw no pavement on the
 * works' land, so this lays its own. Every position comes from the data file's constants and
 * helpers, so moving or reshaping the jump there moves the art with it. Shared batches only.
 */

/** The racers found it before the writers left: paint on everything. */
const PAINTED: ReclaimProfile = {
  intensity: 0.9,
  level: 3,
  vegetation: 0,
  weeds: 0,
  vines: 0,
  graffiti: 1,
  graffitiScale: 1,
  decay: 0.8,
  planter: 0,
  bigTree: false,
  grafWall: true,
};

/** Heights the layers of the ground are laid at (m). */
const Y = { dirt: 0.004, gravel: 0.01, slab: 0.014, paint: 0.028, marks: 0.034, stain: 0.042 } as const;

const DIRT = 0x6b5d4f;
const GRAVEL = 0x8c867c;
const ASPHALT = 0xc4c3c9;
const RUBBER = 0x07090c;
const STEEL = 0x8e8b86;
const RUST = 0x7a4a32;
const AMBER = 0xffa032;
const CONE = 0xd8662a;

interface V3 {
  x: number;
  y: number;
  z: number;
}

export function buildRoadworks(b: EnvBuilders, _piece: SetPieceSpec): void {
  const rng = makeRng(0x0b7a);
  buildGround(b, rng);
  buildMound(b, rng);
  buildTrench(b, rng);
  for (const bar of ROADWORKS_BARRIERS) barrier(b, bar, rng);
  for (const s of ROADWORKS_SOLIDS) solid(b, s, rng);
  buildMarks(b, rng);
  buildLitter(b, rng);
}

/* ------------------------------------------------------------------ helpers */

/** Run-frame point at (u, w), at height y. */
function at(u: number, w: number, y: number): V3 {
  const p = rwWorld(u, w);
  return { x: p.x, y, z: p.z };
}

/** Four corners laid facing up, UVs a..d = (u0,v0) (u1,v0) (u1,v1) (u0,v1) whichever winding they need. */
function quadUp(m: MeshBuilder, a: V3, q: V3, c: V3, d: V3, u0 = 0, v0 = 0, u1 = 1, v1 = 1): void {
  const ny = (q.z - a.z) * (c.x - q.x) - (q.x - a.x) * (c.z - q.z);
  if (ny > 0) m.quad(a.x, a.y, a.z, q.x, q.y, q.z, c.x, c.y, c.z, d.x, d.y, d.z, u0, v0, u1, v1);
  else m.quad(d.x, d.y, d.z, c.x, c.y, c.z, q.x, q.y, q.z, a.x, a.y, a.z, u0, v1, u1, v0);
}

/** A (u, w) box at height y, facing up. */
function patch(m: MeshBuilder, u0: number, u1: number, w0: number, w1: number, y: number): void {
  if (u1 - u0 < 0.05 || w1 - w0 < 0.05) return;
  quadUp(m, at(u0, w0, y), at(u1, w0, y), at(u1, w1, y), at(u0, w1, y));
}

/** A (u, w) box laid as asphalt, the texture running along the run. */
function asphalt(b: EnvBuilders, u0: number, u1: number, w0: number, w1: number, y: number): void {
  quadUp(b.road, at(u0, w0, y), at(u1, w0, y), at(u1, w1, y), at(u0, w1, y), w0 / ROAD_TILE, u0 / ROAD_TILE, w1 / ROAD_TILE, u1 / ROAD_TILE);
}

/**
 * A vertical quad from ground point a to b, each with its own foot and top, facing (nx, nz)
 * (which must be one of the two normals of a→b).
 */
function vQuad(m: MeshBuilder, ax: number, az: number, bx: number, bz: number, a0: number, a1: number, b0: number, b1: number, nx: number, nz: number): void {
  // `quad` faces (−dz, dx) for a run d = b − a laid bottom-left, bottom-right, top-right, top-left.
  if (-(bz - az) * nx + (bx - ax) * nz >= 0) m.quad(ax, a0, az, bx, b0, bz, bx, b1, bz, ax, a1, az);
  else m.quad(bx, b0, bz, ax, a0, az, ax, a1, az, bx, b1, bz);
}

/** What a car drives on at (u, w) from above: the mound where there is one, else grade less the dig. */
function topAt(u: number, w: number): number {
  const r = rampHeightAt(u, w);
  if (r !== null) return r;
  return -trenchDepthAt(u, w);
}

/** A stripe on the ground (or the mound) from (ua, wa) to (ub, wb) in the run's frame. */
function groundStripe(m: MeshBuilder, ua: number, wa: number, ub: number, wb: number, width: number, lift: number): void {
  const len = Math.hypot(ub - ua, wb - wa);
  if (len < 1e-3) return;
  const nu = (-(wb - wa) / len) * (width / 2);
  const nw = ((ub - ua) / len) * (width / 2);
  const h = (u: number, w: number): number => topAt(u, w) + lift;
  quadUp(m, at(ua - nu, wa - nw, h(ua - nu, wa - nw)), at(ub - nu, wb - nw, h(ub - nu, wb - nw)), at(ub + nu, wb + nw, h(ub + nu, wb + nw)), at(ua + nu, wa + nw, h(ua + nu, wa + nw)));
}

/** A flat decal quad from the graffiti atlas, turned in the run's frame, on whatever is under it. */
function groundDecal(b: EnvBuilders, u: number, w: number, along: number, across: number, turn: number, cell: number, color: number, bright: number, lift: number = Y.stain): void {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const corner = (lu: number, lw: number): V3 => {
    const uu = u + lu * c - lw * s;
    const ww = w + lu * s + lw * c;
    return at(uu, ww, topAt(uu, ww) + lift);
  };
  const uv = graffitiCell(cell);
  b.decal.color(color, bright);
  quadUp(b.decal, corner(-along / 2, -across / 2), corner(along / 2, -across / 2), corner(along / 2, across / 2), corner(-along / 2, across / 2), uv.u0, uv.v0, uv.u1, uv.v1);
}

/** A face to paint, (x, z) its middle at its foot. */
function face(x: number, y: number, z: number, nx: number, nz: number, width: number, height: number, out = 0.03): GraffitiSurface {
  return { x, y, z, nx, nz, tx: nz, tz: -nx, width, height, out };
}

const faceRot = (nx: number, nz: number): number => Math.atan2(nx, nz);

/** World direction of the run's (du, dw). */
function dir(du: number, dw: number): { x: number; z: number } {
  return { x: RUN_FRAME.fx * du + RUN_FRAME.rx * dw, z: RUN_FRAME.fz * du + RUN_FRAME.rz * dw };
}

/* ------------------------------------------------------------------ the ground */

function buildGround(b: EnvBuilders, rng: () => number): void {
  const { u0, u1, w1 } = TRENCH_BOX;
  const end = DETOUR.u1;
  // The pavements on the works' land, broken up: slabs of the old pavement where they survive,
  // dirt where they were lifted. North side first (the desvío runs over it), then the south.
  const pavement = (wa: number, wb: number, from: number, to: number): void => {
    for (let u = from; u < to - 0.2; ) {
      const len = Math.min(to - u, 2 + rng() * 6);
      if (rng() < 0.55) {
        b.concrete.color(PAL.sidewalk, 0.7 + rng() * 0.2);
        patch(b.concrete, u, u + len, wa, wb, Y.slab);
      } else {
        b.concrete.color(DIRT, 0.48 + rng() * 0.1);
        patch(b.concrete, u, u + len, wa, wb, Y.dirt);
      }
      u += len;
    }
  };
  // Kerb lines still there under the dirt.
  b.concrete.color(PAL.curb, 0.9);
  patch(b.concrete, BLOCK.u0, u0, STREET.half, STREET.half + 0.6, Y.slab + 0.002);
  patch(b.concrete, u1, end, STREET.half, STREET.half + 0.6, Y.slab + 0.002);
  pavement(STREET.half + 0.6, STREET.south, BLOCK.u0, u0);
  pavement(STREET.half + 0.6, STREET.south, u1, end);
  // The desvío: gravel over the north pavement and the strip of lot behind it.
  b.concrete.color(GRAVEL, 0.55);
  patch(b.concrete, BLOCK.u0, end, DETOUR.w0, -STREET.half, Y.gravel);
  b.concrete.color(DIRT, 0.5);
  for (let i = 0; i < 10; i++) {
    const u = BLOCK.u0 + 2 + rng() * (end - BLOCK.u0 - 6);
    const w = DETOUR.w0 + 1 + rng() * (DETOUR.w1 - DETOUR.w0 - 2);
    const s = 1.5 + rng() * 3;
    patch(b.concrete, u, u + s, w - s * 0.3, w + s * 0.3, Y.gravel + 0.003);
  }
  // The notch the crews' ramp climbs into: dirt, and gravel where their lorries turned.
  const notchU0 = u0 - 3;
  const notchU1 = u0 + 25;
  const notchW1 = w1 + 9;
  b.concrete.color(DIRT, 0.5);
  patch(b.concrete, notchU0, u0, STREET.south, notchW1, Y.dirt);
  patch(b.concrete, u1, notchU1, STREET.south, notchW1, Y.dirt);
  patch(b.concrete, u0, u1, w1, notchW1, Y.dirt);
  b.concrete.color(GRAVEL, 0.5);
  patch(b.concrete, u0 - 2, u1 + 2, w1, notchW1 - 0.5, Y.gravel);
  patch(b.concrete, u1, u1 + 10, STREET.south, STREET.south + 8, Y.gravel);
  // Old asphalt under the mound's foot and right after the dig, the street's own going to rubble.
  b.road.color(ASPHALT, 0.46);
  asphalt(b, u1 + 0.2, u1 + 2.5, -STREET.half, STREET.half, 0.012);
}

/* ------------------------------------------------------------------ the mound */

function buildMound(b: EnvBuilders, rng: () => number): void {
  const half = RAMP.width / 2;
  const sh = RAMP.shoulder;
  const lift = 0.03;
  const du = 1;
  const ws = [-half, -half + sh, -half / 3, half / 3, half - sh, half];
  const n = Math.ceil(RAMP.length / du);
  const h = (u: number, w: number): number => (rampHeightAt(u, Math.max(-half, Math.min(half, w))) ?? 0) + lift;
  // The top: compacted rubble, a grid that follows the grade and the shoulders.
  for (let i = 0; i < n; i++) {
    const ua = RAMP_START + (i / n) * RAMP.length;
    const ub = RAMP_START + ((i + 1) / n) * RAMP.length;
    for (let j = 0; j < ws.length - 1; j++) {
      const wa = ws[j];
      const wb = ws[j + 1];
      const shoulder = j === 0 || j === ws.length - 2;
      b.concrete.color(shoulder ? 0x7a7066 : 0x8d877e, shoulder ? 0.62 : 0.72);
      quadUp(b.concrete, at(ua, wa, h(ua, wa)), at(ub, wa, h(ub, wa)), at(ub, wb, h(ub, wb)), at(ua, wb, h(ua, wb)));
    }
  }
  // The lip's face, down into the dig: rubble held by a steel plate on edge.
  const lip = LIP_U;
  const floor = -TRENCH.depth;
  for (let j = 0; j < ws.length - 1; j++) {
    const pa = rwWorld(lip, ws[j]);
    const pb = rwWorld(lip, ws[j + 1]);
    b.concrete.color(0x4d463f, 0.5);
    vQuad(b.concrete, pa.x, pa.z, pb.x, pb.z, floor, h(lip, ws[j]), floor, h(lip, ws[j + 1]), RUN_FRAME.fx, RUN_FRAME.fz);
  }
  b.props.color(RUST, 0.55);
  {
    const pa = rwWorld(lip + 0.05, -(half - sh));
    const pb = rwWorld(lip + 0.05, half - sh);
    const top = rampProfile(lip) + lift + 0.04;
    vQuad(b.props, pa.x, pa.z, pb.x, pb.z, top - 1.1, top, top - 1.1, top, RUN_FRAME.fx, RUN_FRAME.fz);
  }
  // Steel road plates over the top: most of it, some shoved askew, a couple missing.
  const pl = 3;
  const pw = 1.5;
  for (let u = RAMP_START + 6; u + pl <= lip + 0.35; u += pl + 0.05) {
    for (let w = -half + sh + 0.15; w + pw <= half - sh - 0.1; w += pw + 0.04) {
      if (rng() < 0.2) continue;
      const turn = (rng() - 0.5) * 0.08;
      const cu = u + pl / 2 + (rng() - 0.5) * 0.2;
      const cw = w + pw / 2 + (rng() - 0.5) * 0.15;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const corner = (lu: number, lw: number): V3 => {
        const uu = cu + lu * c - lw * s;
        const ww = cw + lu * s + lw * c;
        // Past the lip, the plate overhangs level with it.
        return at(uu, ww, rampProfile(Math.min(uu, lip)) + lift + 0.035);
      };
      b.props.color(rng() < 0.35 ? RUST : STEEL, 0.62 + rng() * 0.25);
      quadUp(b.props, corner(-pl / 2, -pw / 2), corner(pl / 2, -pw / 2), corner(pl / 2, pw / 2), corner(-pl / 2, pw / 2));
    }
  }
  // Rubble at the foot of the flanks, inside the band the flank walls keep cars out of.
  const toe = half + WALL_INSET - 0.1;
  const from = RAMP_START + 12;
  for (const side of [-1, 1]) {
    for (let u = from; u < lip - 0.5; u += 1.1 + rng() * 1.3) {
      const w = side * (half + 0.15 + rng() * (toe - half - 0.3));
      const p = rwWorld(u, w);
      const sx = 0.5 + rng() * 0.9;
      const sz = 0.35 + rng() * 0.5;
      const sy = 0.2 + rng() * Math.min(0.7, rampProfile(u) * 0.4);
      const turn = rng() * Math.PI;
      if (rng() < 0.7) b.concrete.color(0x6d6862, 0.5 + rng() * 0.2);
      else b.concrete.color(0x5b5048, 0.45);
      b.concrete.orientedBox(p.x, p.z, Math.cos(turn), Math.sin(turn), sx, sz, -0.05, sy);
    }
  }
  // Rebar bristling out of the rubble at the lip's corners.
  b.props.color(RUST, 0.5);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const u = lip - 0.3 - rng() * 1.5;
      const w = side * (half - 0.2 - rng() * 1.0);
      const base = rwWorld(u, w);
      const y0 = (rampHeightAt(u, w) ?? 0) - 0.2;
      const len = 0.6 + rng() * 0.8;
      const tip = rwWorld(u + (rng() - 0.3) * 0.6, w + side * (0.3 + rng() * 0.5));
      b.props.tube(base.x, y0, base.z, tip.x, y0 + len, tip.z, 0.04);
    }
  }
}

/* ------------------------------------------------------------------ the dig */

function buildTrench(b: EnvBuilders, rng: () => number): void {
  const { u0, u1, w0, w1 } = TRENCH_BOX;
  const D = TRENCH.depth;
  const floorTo = TRENCH.floorTo;
  const half = RAMP.width / 2;
  // The floor: the underpass's base course, laid and left. Flat, then the crews' ramp.
  b.road.color(ASPHALT, 0.34);
  quadUp(b.road, at(u0, w0, -D), at(u1, w0, -D), at(u1, floorTo, -D), at(u0, floorTo, -D), w0 / ROAD_TILE, u0 / ROAD_TILE, floorTo / ROAD_TILE, u1 / ROAD_TILE);
  const steps = Math.ceil(EXIT_LEN / 2);
  for (let i = 0; i < steps; i++) {
    const wa = floorTo + (i / steps) * EXIT_LEN;
    const wb = floorTo + ((i + 1) / steps) * EXIT_LEN;
    const ya = -trenchDepthAt(u0 + 1, wa);
    const yb = -trenchDepthAt(u0 + 1, wb) + 0.002;
    b.concrete.color(GRAVEL, 0.46);
    quadUp(b.concrete, at(u0, wa, ya), at(u1, wa, ya), at(u1, wb, yb), at(u0, wb, yb));
  }
  // The sides: sheet piling, rusted, the pans told apart by their light.
  const piling = (ua: number, wa: number, ub: number, wb: number, nu: number, nw: number): void => {
    const len = Math.hypot(ub - ua, wb - wa);
    const n = Math.max(1, Math.round(len / 0.6));
    const nd = dir(nu, nw);
    for (let i = 0; i < n; i++) {
      const s0 = i / n;
      const s1 = (i + 1) / n;
      const pa = { u: ua + (ub - ua) * s0, w: wa + (wb - wa) * s0 };
      const pb = { u: ua + (ub - ua) * s1, w: wa + (wb - wa) * s1 };
      const fa = -trenchDepthAt(pa.u + nu * 0.3, pa.w + nw * 0.3) - 0.05;
      const fb = -trenchDepthAt(pb.u + nu * 0.3, pb.w + nw * 0.3) - 0.05;
      if (fa > -0.06 && fb > -0.06) continue;
      const a = rwWorld(pa.u, pa.w);
      const c = rwWorld(pb.u, pb.w);
      b.props.color(rng() < 0.3 ? RUST : 0x5a524a, (i % 2 === 0 ? 0.42 : 0.55) + rng() * 0.08);
      vQuad(b.props, a.x, a.z, c.x, c.z, fa, 0.06, fb, 0.06, nd.x, nd.z);
    }
  };
  // Near face beside the lip (the lip's own face is the mound's), far face, north end.
  piling(u0, half, u0, w1, 1, 0);
  piling(u1, w0, u1, w1, -1, 0);
  piling(u0, w0, u1, w0, 0, 1);
  // A capping beam along the top of the far face, the edge the landing starts at.
  const capA = rwWorld(u1 + 0.2, w0);
  const capB = rwWorld(u1 + 0.2, w1 - 1);
  const run = dir(0, 1);
  b.concrete.color(PAL.curb, 0.9);
  b.concrete.orientedBox((capA.x + capB.x) / 2, (capA.z + capB.z) / 2, run.x, run.z, Math.hypot(capB.x - capA.x, capB.z - capA.z), 0.4, -0.35, 0.02);
  // Paint on the far face, where every run-up is looking: the writers came down the crews' ramp.
  const back = dir(-1, 0);
  for (let k = 0; k < 3; k++) {
    const w = w0 + 2.5 + k * 6.5 + rng() * 1.5;
    const p = rwWorld(u1 - 0.1, w);
    const s = face(p.x, -D, p.z, back.x, back.z, 6, D - 0.2);
    paintSurface(b, s, PAINTED, 0x7a11 + k * 31);
    grimeSurface(b, s, PAINTED, 0x5b1 + k, 'streak');
  }
  {
    const p = rwWorld(u0 + 0.1, floorTo - 2.5);
    const fwd = dir(1, 0);
    paintSurface(b, face(p.x, -D, p.z, fwd.x, fwd.z, 6, D - 0.2), PAINTED, 0x7a99);
    // And the north end, seen from the desvío.
    const e = rwWorld((u0 + u1) / 2, w0 + 0.1);
    const south = dir(0, 1);
    paintSurface(b, face(e.x, -D, e.z, south.x, south.z, TRENCH.length - 1, D - 0.2), PAINTED, 0x7ab3);
  }
  // Down there, in the band the walls keep cars out of: rubble, a pipe, puddle stains.
  const band = WALL_INSET + 0.9;
  for (let i = 0; i < 14; i++) {
    const nearSide = rng() < 0.5;
    const u = nearSide ? u0 + 0.3 + rng() * (band - 0.4) : u1 - 0.3 - rng() * (band - 0.4);
    const w = w0 + 1 + rng() * (floorTo - w0 - 1);
    const p = rwWorld(u, w);
    const turn = rng() * Math.PI;
    b.concrete.color(0x6d6862, 0.45 + rng() * 0.2);
    b.concrete.orientedBox(p.x, p.z, Math.cos(turn), Math.sin(turn), 0.4 + rng() * 0.9, 0.3 + rng() * 0.6, -D - 0.05, -D + 0.15 + rng() * 0.35);
  }
  {
    // A length of concrete drain pipe the crews never laid, along the far face.
    const a = rwWorld(u1 - 0.75, w0 + 2);
    const c = rwWorld(u1 - 0.75, w0 + 8);
    b.wall.color(PAL.curb, 1.0);
    b.wall.orientedBox((a.x + c.x) / 2, (a.z + c.z) / 2, run.x, run.z, 6, 1.0, -D, -D + 1.0);
    b.props.color(0x10151a, 1);
    const end = rwWorld(u1 - 0.75, w0 + 8.02);
    b.props.panel(end.x, -D + 0.5, end.z, 0.7, 0.7, faceRot(run.x, run.z));
  }
  for (let i = 0; i < 6; i++) {
    groundDecal(b, u0 + 3 + rng() * (TRENCH.length - 6), w0 + 2 + rng() * (floorTo - w0 - 4), 2 + rng() * 3, 1.5 + rng() * 2.5, rng() * 3, 13, PAL.grime, 1.1 + rng() * 0.4);
  }
  // Rebar along the near face's top beside the mound.
  b.props.color(RUST, 0.5);
  for (let w = half + 0.8; w < w1 - 2; w += 1.3 + rng() * 1.2) {
    const base = rwWorld(u0 + 0.12, w);
    const tip = rwWorld(u0 + 0.3 + rng() * 0.4, w + (rng() - 0.5) * 0.5);
    b.props.tube(base.x, -0.6, base.z, tip.x, 0.35 + rng() * 0.4, tip.z, 0.035);
  }
}

/* ------------------------------------------------------------------ barriers */

function barrier(b: EnvBuilders, bar: RwBarrier, rng: () => number): void {
  const len = bar.len;
  b.wall.color(PAL.curb, 0.95 + rng() * 0.3);
  if (bar.fallen) {
    b.wall.orientedBox(bar.x, bar.z, bar.dx, bar.dz, len, BARRIER_HEIGHT, 0, 0.62);
    return;
  }
  b.wall.orientedBox(bar.x, bar.z, bar.dx, bar.dz, len, 0.62, 0, 0.3);
  b.wall.orientedBox(bar.x, bar.z, bar.dx, bar.dz, len, 0.3, 0.3, BARRIER_HEIGHT);
  const nx = -bar.dz;
  const nz = bar.dx;
  // Hazard paint, mostly scraped off.
  if (rng() < 0.45) {
    b.lane.color(rng() < 0.5 ? CONE : 0xd9d4c8, 0.35 + rng() * 0.2);
    for (const side of [-1, 1]) {
      b.lane.panel(bar.x + nx * 0.16 * side, 0.62, bar.z + nz * 0.16 * side, len * 0.8, 0.14, faceRot(nx * side, nz * side));
    }
  }
  if (rng() < 0.35) {
    const side = rng() < 0.5 ? 1 : -1;
    paintSurface(b, face(bar.x + nx * 0.17 * side, 0.3, bar.z + nz * 0.17 * side, nx * side, nz * side, len, 0.5, 0.02), PAINTED, Math.floor(rng() * 1e6));
  }
  if (bar.flasher !== 'none') {
    b.props.color(PAL.metalDark, 1.1);
    b.props.box(bar.x, BARRIER_HEIGHT + 0.14, bar.z, 0.22, 0.28, 0.12);
    const lens = bar.flasher === 'live' ? b.neonFlicker : b.props;
    lens.color(AMBER, bar.flasher === 'live' ? 1.2 : 0.3);
    for (const side of [-1, 1]) lens.panel(bar.x + nx * 0.065 * side, BARRIER_HEIGHT + 0.2, bar.z + nz * 0.065 * side, 0.16, 0.14, faceRot(nx * side, nz * side));
    if (bar.flasher === 'live') halo(b, bar.x, BARRIER_HEIGHT + 0.2, bar.z, 1.6, 1.2, faceRot(nx, nz), AMBER, 0.12);
  }
}

/* ------------------------------------------------------------------ what was left behind */

function solid(b: EnvBuilders, s: RwSolid, rng: () => number): void {
  switch (s.kind) {
    case 'excavator':
      return excavator(b, s);
    case 'culverts':
      return culverts(b, s);
    case 'plates':
      return plateStack(b, s, rng);
    case 'lamp':
      return lightMast(b, s);
    default:
      return;
  }
}

/** A tracked excavator, long abandoned, laid along its footprint's long axis: the arm down at the far end. */
function excavator(b: EnvBuilders, s: RwSolid): void {
  const alongX = s.sx >= s.sz;
  const L = alongX ? s.sx : s.sz;
  const W = alongX ? s.sz : s.sx;
  // Local (along, across) to world.
  const P = (a: number, c: number): { x: number; z: number } => (alongX ? { x: s.x + a, z: s.z + c } : { x: s.x + c, z: s.z + a });
  const box = (m: MeshBuilder, a: number, c: number, y: number, la: number, lc: number, h: number): void => {
    const p = P(a, c);
    if (alongX) m.box(p.x, y, p.z, la, h, lc);
    else m.box(p.x, y, p.z, lc, h, la);
  };
  b.props.color(0x1d2226, 1);
  for (const side of [-1, 1]) box(b.props, 0, side * (W / 2 - 0.35), 0.45, L - 2.4, 0.7, 0.9);
  b.props.color(0x9a7a2a, 0.55);
  box(b.props, 0.4, 0, 1.35, 3.4, W - 0.2, 0.9);
  box(b.props, -0.5, -0.55, 2.3, 1.3, 1.2, 1.1);
  b.props.color(0x9a7a2a, 0.5);
  const a0 = P(-0.6, 0.4);
  const a1 = P(-2.4, 0.4);
  const a2 = P(-3.5, 0.4);
  b.props.tube(a0.x, 1.7, a0.z, a1.x, 3.3, a1.z, 0.4);
  b.props.tube(a1.x, 3.3, a1.z, a2.x, 0.8, a2.z, 0.3);
  b.props.color(0x2c2a26, 1);
  box(b.props, -3.5, 0.4, 0.45, 0.9, 1.0, 0.8);
  const side = P(0.4, W / 2 - 0.08);
  const n = alongX ? { x: 0, z: 1 } : { x: 1, z: 0 };
  paintSurface(b, face(side.x, 0.95, side.z, n.x, n.z, 3.2, 0.8, 0.03), PAINTED, 0xe8c);
}

/** Precast box culverts, stacked two high, hollow ends, along the footprint's long axis. */
function culverts(b: EnvBuilders, s: RwSolid): void {
  const alongX = s.sx >= s.sz;
  const L = alongX ? s.sx : s.sz;
  const W = alongX ? s.sz : s.sx;
  const unit = W / 2;
  for (let tier = 0; tier < 2; tier++) {
    for (let k = 0; k < (tier === 0 ? 2 : 1); k++) {
      const c = -W / 2 + unit * (k + 0.5 + tier * 0.5);
      const y0 = tier * (s.h / 2);
      const x = alongX ? s.x : s.x + c;
      const z = alongX ? s.z + c : s.z;
      b.wall.color(PAL.curb, 1.0 + ((k + tier) % 2) * 0.12);
      if (alongX) b.wall.box(x, y0 + s.h / 4, z, L, s.h / 2, unit - 0.08);
      else b.wall.box(x, y0 + s.h / 4, z, unit - 0.08, s.h / 2, L);
      b.props.color(0x0c1014, 1);
      for (const e of [-1, 1]) {
        if (alongX) b.props.panel(x + e * (L / 2 + 0.01), y0 + s.h / 4, z, unit - 0.5, s.h / 2 - 0.4, faceRot(e, 0));
        else b.props.panel(x, y0 + s.h / 4, z + e * (L / 2 + 0.01), unit - 0.5, s.h / 2 - 0.4, faceRot(0, e));
      }
    }
  }
  const n = alongX ? { x: 0, z: 1 } : { x: 1, z: 0 };
  paintSurface(b, face(s.x + n.x * (W / 2 + 0.02), 0, s.z + n.z * (W / 2 + 0.02), n.x, n.z, L, s.h / 2, 0.03), PAINTED, 0xc0c);
}

/** Spare road plates, stacked crooked. */
function plateStack(b: EnvBuilders, s: RwSolid, rng: () => number): void {
  const n = 5;
  for (let k = 0; k < n; k++) {
    const turn = (rng() - 0.5) * 0.12;
    b.props.color(rng() < 0.5 ? RUST : STEEL, 0.45 + rng() * 0.15);
    b.props.orientedBox(s.x + (rng() - 0.5) * 0.2, s.z + (rng() - 0.5) * 0.2, Math.cos(turn), Math.sin(turn), s.sx - 0.2, s.sz - 0.2, k * (s.h / n), (k + 1) * (s.h / n) - 0.02);
  }
}

/**
 * A site light mast: one lamp of the four still works, turned back across the dig onto the lip.
 * Its light is the unlit kind every lamp in the city is (neon head, halo, pools on what it hits).
 */
function lightMast(b: EnvBuilders, s: RwSolid): void {
  const WORK = 0xe8f0ff;
  b.concrete.color(PAL.curb, 0.9);
  b.concrete.box(s.x, 0.25, s.z, s.sx, 0.5, s.sz);
  b.props.color(PAL.metalDark, 1.2);
  b.props.box(s.x, s.h / 2, s.z, 0.22, s.h, 0.22);
  const back = dir(-1, 0);
  const across = dir(0, 1);
  const top = s.h - 0.3;
  b.props.orientedBox(s.x, s.z, across.x, across.z, 2.2, 0.14, top - 0.07, top + 0.07);
  for (let k = 0; k < 4; k++) {
    const off = -0.8 + k * 0.53;
    const hx = s.x + across.x * off + back.x * 0.18;
    const hz = s.z + across.z * off + back.z * 0.18;
    b.props.color(PAL.metalDark, 1.1);
    b.props.box(hx, top - 0.3, hz, 0.42, 0.34, 0.42);
    const lit = k === 1;
    (lit ? b.neon : b.props).color(lit ? WORK : 0x2a3036, 1);
    (lit ? b.neon : b.props).panel(hx + back.x * 0.22, top - 0.3, hz + back.z * 0.22, 0.36, 0.28, faceRot(back.x, back.z));
    if (lit) halo(b, hx + back.x * 0.4, top - 0.3, hz + back.z * 0.4, 4.5, 3.2, faceRot(back.x, back.z), WORK, 0.16);
  }
  // Where it lands: the top of the mound and the lip, the far face of the dig, the landing's edge.
  const half = RAMP.width / 2;
  const ua0 = LIP_U - 12;
  const n = 6;
  b.glow.color(WORK, 0.11);
  for (let i = 0; i < n; i++) {
    const ua = ua0 + (i / n) * (LIP_U - ua0);
    const ub = ua0 + ((i + 1) / n) * (LIP_U - ua0);
    const ya = rampProfile(ua) + 0.09;
    const yb = rampProfile(ub) + 0.09;
    quadUp(b.glow, at(ua, -half + 0.6, ya), at(ub, -half + 0.6, yb), at(ub, half - 0.6, yb), at(ua, half - 0.6, ya));
  }
  const { u1, w0 } = TRENCH_BOX;
  b.glow.color(WORK, 0.08);
  const fa = rwWorld(u1 - 0.12, w0 + 0.5);
  const fb = rwWorld(u1 - 0.12, TRENCH.floorTo);
  vQuad(b.glow, fa.x, fa.z, fb.x, fb.z, -TRENCH.depth + 0.1, -0.1, -TRENCH.depth + 0.1, -0.1, back.x, back.z);
  b.glow.color(WORK, 0.07);
  quadUp(b.glow, at(u1 + 0.5, -half, 0.06), at(u1 + 10, -half, 0.06), at(u1 + 10, half, 0.06), at(u1 + 0.5, half, 0.06));
}

/* ------------------------------------------------------------------ what the racers left */

function buildMarks(b: EnvBuilders, rng: () => number): void {
  const { u1 } = TRENCH_BOX;
  b.lane.color(RUBBER, 1);
  // The run-up: two pairs of lines down the street and onto the mound, wandering a little.
  for (const off of [-1.6, 1.2]) {
    for (const wheel of [-0.8, 0.8]) {
      let w = off + wheel;
      for (let u = -40; u < LIP_U - 0.3; u += 2) {
        const wn = w + (rng() - 0.5) * 0.08;
        const ue = Math.min(u + 2, LIP_U - 0.3);
        if (rng() > 0.18) groundStripe(b.lane, u, w, ue, wn, 0.22, u > RAMP_START ? 0.075 : Y.marks);
        w = wn;
      }
    }
  }
  // Where they come down: short black smears down the landing, thickest at 20-50 m/s.
  for (let i = 0; i < 30; i++) {
    const u = u1 + 6 + Math.pow(rng(), 0.9) * 110;
    const w = (rng() - 0.5) * 6;
    const len = 1.2 + rng() * 2.5;
    for (const wheel of [-0.8, 0.8]) groundStripe(b.lane, u, w + wheel, u + len, w + wheel + (rng() - 0.5) * 0.3, 0.26, Y.marks);
  }
  // And somebody's fishtail after.
  let w = 0;
  for (let u = u1 + 40; u < u1 + 80; u += 1.5) {
    const wn = Math.sin((u - u1) * 0.16) * 2.2;
    groundStripe(b.lane, u, w - 0.8, u + 1.5, wn - 0.8, 0.24, Y.marks);
    groundStripe(b.lane, u, w + 0.8, u + 1.5, wn + 0.8, 0.24, Y.marks);
    w = wn;
  }
  // Tyre tracks down the desvío's gravel.
  for (const lane of [-14.5, -12.8]) {
    for (let u = BLOCK.u0 + 2; u < DETOUR.u1 - 14; u += 3) {
      if (rng() < 0.3) continue;
      groundStripe(b.lane, u, lane, u + 2.6, lane + (rng() - 0.5) * 0.2, 0.2, Y.gravel + 0.02);
    }
  }
  // Oil where they wait their turn before the run, and a piece sprayed on the street.
  for (let i = 0; i < 8; i++) {
    groundDecal(b, -30 + rng() * 25, (rng() - 0.5) * 9, 1.6 + rng(), 1.3 + rng(), rng() * 3, 13, PAL.grime, 1.2 + rng() * 0.4);
  }
  groundDecal(b, RAMP_START - 14, 3, 6, 3, Math.PI / 2, 6 + Math.floor(rng() * 3), 0xffffff, 0.6, Y.stain + 0.004);
}

/** Small stuff: cones knocked over by the verges, a stack of tyres. All of it too small to matter. */
function buildLitter(b: EnvBuilders, rng: () => number): void {
  const spots: Array<[number, number]> = [
    [RAMP_START - 2, -STREET.half - 1.5],
    [RAMP_START + 6, STREET.half + 2.2],
    [RAMP_START + 14, STREET.half + 3.5],
    [TRENCH_BOX.u1 + 2.5, STREET.south + 7],
    [DETOUR.u1 - 16, DETOUR.w0 + 1],
  ];
  for (const [u, w] of spots) {
    const p = rwWorld(u, w);
    b.props.color(CONE, 0.55);
    if (rng() < 0.6) {
      const t = rng() * Math.PI;
      b.props.orientedBox(p.x, p.z, Math.cos(t), Math.sin(t), 0.7, 0.28, 0, 0.28);
    } else {
      b.props.box(p.x, 0.36, p.z, 0.26, 0.72, 0.26);
      b.props.color(0x2a2e33, 1);
      b.props.box(p.x, 0.02, p.z, 0.42, 0.04, 0.42);
    }
  }
  const t = rwWorld(TRENCH_BOX.u0 - 1.5, TRENCH_BOX.w1 + 7);
  b.props.color(0x15181b, 1);
  for (let k = 0; k < 3; k++) b.props.box(t.x, 0.12 + k * 0.24, t.z + k * 0.05, 0.9, 0.22, 0.9);
}
