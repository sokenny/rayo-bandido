import { PAL } from './palette';
import { makeRng, type MeshBuilder } from './meshBuilder';
import { groundGlow, halo, type EnvBuilders } from './builders';
import { ROAD_TILE } from './cityBuilder';
import { graffitiCell, grimeSurface, paintSurface } from './graffiti';
import { shrub, weeds } from './plants';
import type { GraffitiSurface, ReclaimProfile } from './reclaim';
import { frameAt, GAS, GAS_BRANDS, stationParts, type GasBox, type GasStationParts, type GasStationSpec } from '../../../world/gasStation';

/**
 * THE GAS STATIONS, drawn (`world/gasStation.ts`): the forecourt, the canopy and its lights, the
 * islands and pumps, the shop, the service bay, the price pylon. All of it into the city's own
 * batches, like the meets: a station costs triangles, never a draw call.
 *
 * THE LOOK is Juan's reference: a wet forecourt at night under the towers. A flat, dark canopy
 * with a thin amber strip round its lower edge and cold panels underneath throwing a white pool
 * on the concrete; pale columns painted in the brand's colour to knee height; white pumps with lit
 * screens on kerbed islands between yellow bollards; a shop glowing warm through its glass with
 * OPEN in red; a shuttered service bay with paint on it; and the pylon on the corner, the brand in
 * neon over a black board of amber prices. The lettering is tubes (`neonText`), not a texture, so
 * every brand and price is data.
 */

/** Painted, not given up: a tag or two on the back walls and the shutter. */
const TAGGED: ReclaimProfile = {
  intensity: 0.5,
  level: 1,
  vegetation: 0,
  weeds: 0,
  vines: 0,
  graffiti: 0.75,
  graffitiScale: 0.8,
  decay: 0.55,
  planter: 0,
  bigTree: false,
  grafWall: true,
};

/** Heights laid over the forecourt (m). */
const Y = { slab: 0.004, joint: 0.02, paint: 0.03, stain: 0.045, glow: 0.055 } as const;

const PANEL_LIGHT = 0xf4f8ff;
const SHOP_LIGHT = 0xffdcae;
const OPEN_RED = 0xff2a3a;
const BOLLARD = 0xf2c400;

export function buildGasStations(b: EnvBuilders): void {
  for (const s of b.plan.gasStations ?? []) {
    const p = stationParts(s);
    const rng = makeRng(seedOf(s.tag));
    forecourt(b, s, p, rng);
    edgeWalls(b, s, p, rng);
    canopy(b, s, p);
    islands(b, s, p);
    shop(b, s, p, rng);
    serviceBay(b, s, p);
    backLot(b, p, rng);
    pylon(b, s, p, rng);
  }
}

/* ------------------------------------------------------------------ helpers */

function seedOf(tag: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) h = Math.imul(h ^ tag.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Facing of a vertical panel as `MeshBuilder.panel` takes it: rotY 0 faces +Z. */
const faceRot = (nx: number, nz: number): number => Math.atan2(nx, nz);

/** A `GasBox` into a builder, trimmed by `inset` on every side. */
function boxOf(mb: MeshBuilder, g: GasBox, opts?: { bottom?: boolean; inset?: number }): void {
  const i = opts?.inset ?? 0;
  mb.box((g.minX + g.maxX) / 2, (g.y0 + g.y1) / 2, (g.minZ + g.maxZ) / 2, g.maxX - g.minX - i * 2, g.y1 - g.y0, g.maxZ - g.minZ - i * 2, { bottom: opts?.bottom });
}

/** The middle of a box's face toward (nx, nz), at its foot, and the width of that face. */
function faceOf(g: GasBox, nx: number, nz: number): { x: number; z: number; width: number } {
  const cx = (g.minX + g.maxX) / 2;
  const cz = (g.minZ + g.maxZ) / 2;
  const hx = (g.maxX - g.minX) / 2;
  const hz = (g.maxZ - g.minZ) / 2;
  return { x: cx + nx * hx, z: cz + nz * hz, width: nx !== 0 ? hz * 2 : hx * 2 };
}

function surface(x: number, y: number, z: number, nx: number, nz: number, width: number, height: number): GraffitiSurface {
  return { x, y, z, nx, nz, tx: nz, tz: -nx, width, height, out: 0.03 };
}

/* ------------------------------------------------------------------ neon lettering */

type Stroke = ReadonlyArray<readonly [number, number]>;

/**
 * A stroke font on a unit cell (x 0..1 across, y 0..1 up), squared off like a DIN sign so the
 * tubes read at a distance. Only the letters the stations spell; an unknown character is a gap.
 */
const GLYPHS: Record<string, { w: number; strokes: Stroke[] }> = {
  A: { w: 1, strokes: [[[0, 0], [0, 0.72], [0.5, 1], [1, 0.72], [1, 0]], [[0, 0.45], [1, 0.45]]] },
  B: { w: 1, strokes: [[[0, 0], [0, 1], [0.72, 1], [0.95, 0.88], [0.95, 0.62], [0.72, 0.5], [0, 0.5]], [[0.72, 0.5], [1, 0.38], [1, 0.12], [0.72, 0], [0, 0]]] },
  C: { w: 1, strokes: [[[1, 1], [0, 1], [0, 0], [1, 0]]] },
  D: { w: 1, strokes: [[[0, 0], [0, 1], [0.62, 1], [1, 0.7], [1, 0.3], [0.62, 0], [0, 0]]] },
  E: { w: 0.9, strokes: [[[1, 1], [0, 1], [0, 0], [1, 0]], [[0, 0.5], [0.78, 0.5]]] },
  F: { w: 0.9, strokes: [[[1, 1], [0, 1], [0, 0]], [[0, 0.5], [0.78, 0.5]]] },
  G: { w: 1, strokes: [[[1, 1], [0, 1], [0, 0], [1, 0], [1, 0.45], [0.5, 0.45]]] },
  H: { w: 1, strokes: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]] },
  I: { w: 0.2, strokes: [[[0.5, 0], [0.5, 1]]] },
  J: { w: 0.8, strokes: [[[1, 1], [1, 0], [0, 0], [0, 0.3]]] },
  K: { w: 1, strokes: [[[0, 0], [0, 1]], [[1, 1], [0, 0.45], [1, 0]]] },
  L: { w: 0.9, strokes: [[[0, 1], [0, 0], [1, 0]]] },
  M: { w: 1.15, strokes: [[[0, 0], [0, 1], [0.5, 0.52], [1, 1], [1, 0]]] },
  N: { w: 1, strokes: [[[0, 0], [0, 1], [1, 0], [1, 1]]] },
  O: { w: 1, strokes: [[[0.28, 0], [0, 0.22], [0, 0.78], [0.28, 1], [0.72, 1], [1, 0.78], [1, 0.22], [0.72, 0], [0.28, 0]]] },
  P: { w: 1, strokes: [[[0, 0], [0, 1], [1, 1], [1, 0.5], [0, 0.5]]] },
  R: { w: 1, strokes: [[[0, 0], [0, 1], [1, 1], [1, 0.5], [0, 0.5]], [[0.42, 0.5], [1, 0]]] },
  S: { w: 1, strokes: [[[1, 1], [0, 1], [0, 0.5], [1, 0.5], [1, 0], [0, 0]]] },
  T: { w: 1, strokes: [[[0, 1], [1, 1]], [[0.5, 1], [0.5, 0]]] },
  U: { w: 1, strokes: [[[0, 1], [0, 0], [1, 0], [1, 1]]] },
  V: { w: 1, strokes: [[[0, 1], [0.5, 0], [1, 1]]] },
  W: { w: 1.25, strokes: [[[0, 1], [0.22, 0], [0.5, 0.62], [0.78, 0], [1, 1]]] },
  X: { w: 1, strokes: [[[0, 0], [1, 1]], [[0, 1], [1, 0]]] },
  Y: { w: 1, strokes: [[[0, 1], [0.5, 0.5], [1, 1]], [[0.5, 0.5], [0.5, 0]]] },
  Z: { w: 1, strokes: [[[0, 1], [1, 1], [0, 0], [1, 0]]] },
  Q: { w: 1, strokes: [[[0.28, 0], [0, 0.22], [0, 0.78], [0.28, 1], [0.72, 1], [1, 0.78], [1, 0.22], [0.72, 0], [0.28, 0]], [[0.6, 0.3], [1.05, -0.1]]] },
  '0': { w: 0.9, strokes: [[[0.28, 0], [0, 0.2], [0, 0.8], [0.28, 1], [0.72, 1], [1, 0.8], [1, 0.2], [0.72, 0], [0.28, 0]]] },
  '1': { w: 0.5, strokes: [[[0, 0.78], [0.5, 1], [0.5, 0]]] },
  '2': { w: 1, strokes: [[[0, 1], [1, 1], [1, 0.5], [0, 0.5], [0, 0], [1, 0]]] },
  '3': { w: 1, strokes: [[[0, 1], [1, 1], [1, 0], [0, 0]], [[0.25, 0.5], [1, 0.5]]] },
  '4': { w: 1, strokes: [[[0, 1], [0, 0.5], [1, 0.5]], [[1, 1], [1, 0]]] },
  '5': { w: 1, strokes: [[[1, 1], [0, 1], [0, 0.5], [1, 0.5], [1, 0], [0, 0]]] },
  '6': { w: 1, strokes: [[[1, 1], [0, 1], [0, 0], [1, 0], [1, 0.5], [0, 0.5]]] },
  '7': { w: 1, strokes: [[[0, 1], [1, 1], [0.45, 0]]] },
  '8': { w: 1, strokes: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]], [[0, 0.5], [1, 0.5]]] },
  '9': { w: 1, strokes: [[[1, 0.5], [0, 0.5], [0, 1], [1, 1], [1, 0], [0, 0]]] },
  '.': { w: 0.12, strokes: [[[0.5, 0], [0.5, 0.1]]] },
  "'": { w: 0.12, strokes: [[[0.5, 1], [0.5, 0.75]]] },
  '-': { w: 0.6, strokes: [[[0, 0.5], [1, 0.5]]] },
};

/** How wide `text` is at letter height `h` (m). */
export function textWidth(text: string, h: number): number {
  const cell = h * 0.62;
  let w = 0;
  for (const ch of text) w += ((GLYPHS[ch]?.w ?? 0.6) + 0.42) * cell;
  return Math.max(0, w - 0.42 * cell);
}

/**
 * `text` in tubes on a vertical face: (x, z) is where its middle stands, `y` its baseline,
 * (nx, nz) the way the face looks. Reads left to right from in front of it.
 */
export function neonText(mb: MeshBuilder, text: string, x: number, y: number, z: number, nx: number, nz: number, h: number, color: number, strength = 1): void {
  const cell = h * 0.62;
  const tube = Math.max(0.03, h * 0.1);
  // Right as seen by someone facing the face: forward is (-nx, -nz), right of forward is (nz, -nx).
  const rx = nz;
  const rz = -nx;
  let pen = -textWidth(text, h) / 2;
  mb.color(color, strength);
  for (const ch of text) {
    const g = GLYPHS[ch];
    const w = (g?.w ?? 0.6) * cell;
    if (g) {
      for (const s of g.strokes) {
        for (let i = 1; i < s.length; i++) {
          const [u0, v0] = s[i - 1];
          const [u1, v1] = s[i];
          const a = pen + u0 * w;
          const c = pen + u1 * w;
          mb.tube(x + rx * a + nx * 0.04, y + v0 * h, z + rz * a + nz * 0.04, x + rx * c + nx * 0.04, y + v1 * h, z + rz * c + nz * 0.04, tube);
        }
      }
    }
    pen += w + 0.42 * cell;
  }
}

/** A price as the pylon shows it: one decimal. */
const priceText = (p: number): string => p.toFixed(1);

/* ------------------------------------------------------------------ the forecourt */

function forecourt(b: EnvBuilders, s: GasStationSpec, p: GasStationParts, rng: () => number): void {
  const l = s.lot;
  const f = p.frame;
  const w = l.maxX - l.minX;
  const d = l.maxZ - l.minZ;
  // Poured concrete, paler and newer than the street, slabbed.
  b.road.color(0xf0f2f6, 1.05);
  b.road.planeY((l.minX + l.maxX) / 2, Y.slab, (l.minZ + l.maxZ) / 2, w, d, l.minX / ROAD_TILE, l.maxZ / ROAD_TILE, l.maxX / ROAD_TILE, l.minZ / ROAD_TILE);
  // The joints between the slabs, every five metres both ways.
  b.lane.color(0x0b0e12, 0.8);
  for (let x = l.minX + 5; x < l.maxX - 1; x += 5) b.lane.planeY(x, Y.joint, (l.minZ + l.maxZ) / 2, 0.07, d);
  for (let z = l.minZ + 5; z < l.maxZ - 1; z += 5) b.lane.planeY((l.minX + l.maxX) / 2, Y.joint, z, w, 0.07);

  // Hazard paint round each island, and white bays in front of the shop.
  const P = GAS;
  b.lane.color(0xd9b43a, 0.8);
  for (const i of p.islands) {
    const g = i.box;
    const pad = 0.35;
    b.lane.planeY((g.minX + g.maxX) / 2, Y.paint, g.minZ - pad / 2, g.maxX - g.minX + pad * 2, pad);
    b.lane.planeY((g.minX + g.maxX) / 2, Y.paint, g.maxZ + pad / 2, g.maxX - g.minX + pad * 2, pad);
    b.lane.planeY(g.minX - pad / 2, Y.paint, (g.minZ + g.maxZ) / 2, pad, g.maxZ - g.minZ);
    b.lane.planeY(g.maxX + pad / 2, Y.paint, (g.minZ + g.maxZ) / 2, pad, g.maxZ - g.minZ);
  }
  b.lane.color(PAL.laneWhite, 0.8);
  const bayV0 = p.shopV - P.shopDepth / 2 - 5.2;
  for (let u = p.shopU - p.shopLength / 2 + 1; u <= p.shopU + p.shopLength / 2 - 1; u += 2.8) {
    const a = frameAt(f, u, bayV0);
    const c = frameAt(f, u, bayV0 + 4.8);
    stripe(b.lane, a.x, a.z, c.x, c.z, 0.12);
  }
  // Arrows round the one-way lane behind the canopy, and in from the front.
  const laneV = (p.canopyV + P.canopyDepth / 2 + bayV0) / 2;
  arrow(b.lane, frameAt(f, p.canopyU - 6, laneV), f.ax, f.az, 4.2);
  arrow(b.lane, frameAt(f, p.canopyU + 8, laneV), f.ax, f.az, 4.2);
  const inAt = frameAt(f, p.canopyU - p.canopyLength / 2 - 2.5, 2.2);
  arrow(b.lane, inAt, f.dx, f.dz, 3.4);

  // Oil where cars stand at the pumps.
  const stain = graffitiCell(13);
  for (const i of p.islands) {
    for (const side of [-1, 1]) {
      const at = frameAt(f, i.u + side * 2.1, i.v + (rng() - 0.5) * 2);
      b.decal.color(PAL.grime, 1 + rng() * 0.5);
      b.decal.planeY(at.x, Y.stain, at.z, 1.6 + rng(), 1.6 + rng(), stain.u0, stain.v0, stain.u1, stain.v1);
    }
  }
}

/** A painted stripe on the ground from (ax, az) to (bx, bz). */
function stripe(mb: MeshBuilder, ax: number, az: number, bx: number, bz: number, width: number): void {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-3) return;
  const fx = (bx - ax) / len;
  const fz = (bz - az) / len;
  const rx = -fz * (width / 2);
  const rz = fx * (width / 2);
  mb.quad(ax - rx, Y.paint, az - rz, ax + rx, Y.paint, az + rz, bx + rx, Y.paint, bz + rz, bx - rx, Y.paint, bz - rz);
}

/** A painted arrow at `at`, pointing along (fx, fz). */
function arrow(mb: MeshBuilder, at: { x: number; z: number }, fx: number, fz: number, len: number): void {
  const shaft = len * 0.6;
  const back = { x: at.x - fx * len / 2, z: at.z - fz * len / 2 };
  const neck = { x: back.x + fx * shaft, z: back.z + fz * shaft };
  stripe(mb, back.x, back.z, neck.x, neck.z, len * 0.13);
  const rx = -fz * len * 0.22;
  const rz = fx * len * 0.22;
  const tip = { x: at.x + fx * len / 2, z: at.z + fz * len / 2 };
  mb.quad(neck.x - rx, Y.paint, neck.z - rz, neck.x + rx, Y.paint, neck.z + rz, tip.x, Y.paint, tip.z, tip.x, Y.paint, tip.z);
}

/** A knee wall along each side that is not a street, weeds at its foot and a tag or two on it. */
function edgeWalls(b: EnvBuilders, s: GasStationSpec, p: GasStationParts, rng: () => number): void {
  const cx = (s.lot.minX + s.lot.maxX) / 2;
  const cz = (s.lot.minZ + s.lot.maxZ) / 2;
  for (const e of p.edges) {
    const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
    const dx = (e.bx - e.ax) / len;
    const dz = (e.bz - e.az) / len;
    let nx = -dz;
    let nz = dx;
    if ((cx - e.ax) * nx + (cz - e.az) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const mx = (e.ax + e.bx) / 2 + nx * 0.18;
    const mz = (e.az + e.bz) / 2 + nz * 0.18;
    b.wall.color(PAL.curb, 1.1);
    b.wall.orientedBox(mx, mz, dx, dz, len, 0.32, 0, GAS.edgeWall);
    for (let t = 1.2; t < len - 1; t += 1.6 + rng() * 2.4) {
      weeds(b, e.ax + dx * t + nx * 0.55, 0, e.az + dz * t + nz * 0.55, rng, { scale: 1 + rng() * 0.6, dry: 0.5 });
    }
    const runs = Math.max(1, Math.round(len / 14));
    for (let i = 0; i < runs; i++) {
      const t = ((i + 0.5) / runs) * len;
      paintSurface(b, surface(e.ax + dx * t + nx * 0.35, 0, e.az + dz * t + nz * 0.35, nx, nz, len / runs, GAS.edgeWall), TAGGED, seedOf(`${s.tag}:edge:${e.side}:${i}`));
    }
  }
}

/* ------------------------------------------------------------------ the canopy */

function canopy(b: EnvBuilders, s: GasStationSpec, p: GasStationParts): void {
  const brand = GAS_BRANDS[s.brand];
  const f = p.frame;
  const c = p.canopy;
  const cx = (c.minX + c.maxX) / 2;
  const cz = (c.minZ + c.maxZ) / 2;
  const sx = c.maxX - c.minX;
  const sz = c.maxZ - c.minZ;

  // The slab: dark, with a lighter soffit.
  b.concrete.color(0x5a636d, 0.9);
  b.concrete.box(cx, (c.y0 + c.y1) / 2, cz, sx, c.y1 - c.y0, sz, { bottom: true });
  b.props.color(0x2a3038, 1);
  b.props.box(cx, c.y1 + 0.06, cz, sx - 0.3, 0.12, sz - 0.3);

  // The amber strip round the lower edge, and a thin line of the brand along the top.
  const edge = (y: number, color: number, width: number, strength: number): void => {
    b.neon.color(color, strength);
    const o = 0.04;
    b.neon.tube(c.minX - o, y, c.minZ - o, c.maxX + o, y, c.minZ - o, width);
    b.neon.tube(c.minX - o, y, c.maxZ + o, c.maxX + o, y, c.maxZ + o, width);
    b.neon.tube(c.minX - o, y, c.minZ - o, c.minX - o, y, c.maxZ + o, width);
    b.neon.tube(c.maxX + o, y, c.minZ - o, c.maxX + o, y, c.maxZ + o, width);
  };
  edge(c.y0 + 0.12, brand.accent, 0.1, 1);
  edge(c.y1 - 0.14, brand.color, 0.05, 0.85);
  // The strip blooms off every face.
  const nx = -f.dx;
  const nz = -f.dz;
  for (const [fx, fz] of [[nx, nz], [-nx, -nz], [f.ax, f.az], [-f.ax, -f.az]] as const) {
    const face = faceOf(c, fx, fz);
    halo(b, face.x + fx * 0.3, c.y0 + 0.2, face.z + fz * 0.3, face.width + 2, 1.4, faceRot(fx, fz), brand.accent, 0.16);
  }

  // The soffit, faintly lit by its own panels: without it the underside is a black slab.
  b.neon.color(0x6f7c8a, 0.32);
  b.neon.planeY(cx, c.y0 - 0.01, cz, sx - 0.1, sz - 0.1);
  // Light panels under it, two rows between the islands, and the white pool they throw.
  b.neon.color(PANEL_LIGHT, 0.95);
  const rows = [-3.4, 3.4];
  const cols = Math.max(2, p.islands.length + 1);
  for (const dv of rows) {
    for (let k = 0; k < cols; k++) {
      const u = p.canopyU - p.canopyLength / 2 + (p.canopyLength / cols) * (k + 0.5);
      const at = frameAt(f, u, p.canopyV + dv);
      const lx = Math.abs(f.ax) * 2.6 + Math.abs(f.dx) * 0.7;
      const lz = Math.abs(f.az) * 2.6 + Math.abs(f.dz) * 0.7;
      b.neon.planeY(at.x, c.y0 - 0.04, at.z, lx, lz);
      groundGlow(b, at.x, at.z, 9, 9, PANEL_LIGHT, 0.14, Y.glow);
    }
  }
  groundGlow(b, cx, cz, sx + 10, sz + 10, PANEL_LIGHT, 0.2, Y.glow + 0.003);
  // The amber line, doubled in the wet under the front edge.
  const front = faceOf(c, nx, nz);
  const fl = Math.abs(f.ax) * front.width + Math.abs(f.dx) * 1.2;
  const fw = Math.abs(f.az) * front.width + Math.abs(f.dz) * 1.2;
  groundGlow(b, front.x + nx * 1.5, front.z + nz * 1.5, fl, fw, brand.accent, 0.2, Y.glow + 0.006);

  // The brand on a lit box on the roof, over the front edge, lettered both ways.
  const boxLen = Math.min(p.canopyLength * 0.45, 11);
  const at = frameAt(f, p.canopyU, GAS.frontMargin + 1.2);
  const bx = Math.abs(f.ax) * boxLen + Math.abs(f.dx) * 0.9;
  const bz = Math.abs(f.az) * boxLen + Math.abs(f.dz) * 0.9;
  const y0 = c.y1 + 0.12;
  const h = 1.9;
  b.props.color(0x15181d, 1);
  b.props.box(at.x, y0 + h / 2, at.z, bx, h, bz);
  for (const side of [1, -1]) {
    const ox = at.x + nx * side * 0.46;
    const oz = at.z + nz * side * 0.46;
    b.neon.color(brand.color, 0.22);
    b.neon.panel(ox, y0 + h / 2, oz, boxLen - 0.2, h - 0.2, faceRot(nx * side, nz * side));
    neonText(b.neon, brand.name, ox, y0 + 0.42, oz, nx * side, nz * side, 1.05, 0xf4ffff, 1);
    halo(b, ox + nx * side * 0.5, y0 + h / 2, oz + nz * side * 0.5, boxLen + 3, h + 2.2, faceRot(nx * side, nz * side), brand.color, 0.2);
  }

  // Columns: pale, the brand's colour to knee height, a light tube up the street face.
  for (const col of p.columns) {
    b.concrete.color(0xc8ccd0, 1);
    boxOf(b.concrete, col);
    b.props.color(brand.color, 0.42);
    boxOf(b.props, { ...col, y1: 1.3 }, { inset: -0.04 });
  }
}

/* ------------------------------------------------------------------ islands and pumps */

function islands(b: EnvBuilders, s: GasStationSpec, p: GasStationParts): void {
  const brand = GAS_BRANDS[s.brand];
  const f = p.frame;
  for (const i of p.islands) {
    b.concrete.color(PAL.curb, 1.35);
    boxOf(b.concrete, i.box);
  }
  let number = 1;
  for (const pump of p.pumps) {
    const g = pump.box;
    // The body, white, on a dark plinth, with a dark head carrying the brand's band.
    b.props.color(0x1b1f25, 1);
    boxOf(b.props, { ...g, y1: g.y0 + 0.22 }, { inset: -0.05 });
    b.props.color(0xdfe3e8, 1.05);
    boxOf(b.props, { ...g, y0: g.y0 + 0.22, y1: g.y1 - 0.42 });
    b.props.color(0x1b1f25, 1);
    boxOf(b.props, { ...g, y0: g.y1 - 0.42 }, { inset: -0.03 });
    for (const side of [1, -1]) {
      const fx = f.ax * side;
      const fz = f.az * side;
      const face = faceOf(g, fx, fz);
      const rot = faceRot(fx, fz);
      const ox = face.x + fx * 0.04;
      const oz = face.z + fz * 0.04;
      // Brand band on the head, the pump's number over it.
      b.neon.color(brand.color, 0.9);
      b.neon.panel(ox, g.y1 - 0.3, oz, face.width - 0.12, 0.14, rot);
      neonText(b.neon, String(number), ox, g.y1 - 0.2, oz, fx, fz, 0.16, 0xffffff, 0.95);
      // The screen and the keypad.
      b.neon.color(0xbfeaff, 0.85);
      b.neon.panel(ox, g.y0 + 1.42, oz, face.width * 0.62, 0.34, rot);
      b.neon.color(brand.digits, 0.9);
      b.neon.panel(ox, g.y0 + 1.1, oz, face.width * 0.4, 0.14, rot);
      // Holsters and the hoses hanging from them, dark against the white.
      b.props.color(0x101318, 1);
      const rx = fz;
      const rz = -fx;
      for (const k of [-1, 1]) {
        const hx = face.x + fx * 0.1 + rx * k * 0.34;
        const hz = face.z + fz * 0.1 + rz * k * 0.34;
        b.props.box(hx, g.y0 + 0.95, hz, 0.14, 0.26, 0.14);
        b.props.box(hx + fx * 0.06, g.y0 + 0.58, hz + fz * 0.06, 0.05, 0.62, 0.05);
      }
      halo(b, ox + fx * 0.5, g.y0 + 1.3, oz + fz * 0.5, 1.6, 1.6, rot, 0xbfeaff, 0.12);
      groundGlow(b, face.x + fx * 1.4, face.z + fz * 1.4, 2.6, 2.6, brand.color, 0.12, Y.glow);
    }
    number++;
  }
  // Yellow bollards at the island ends, a white band near the top.
  for (const bo of p.bollards) {
    b.props.color(BOLLARD, 1.2);
    b.props.box(bo.x, GAS.islandHeight + 0.5, bo.z, 0.24, 1.0, 0.24);
    b.props.color(0xf2f2f2, 1.2);
    b.props.box(bo.x, GAS.islandHeight + 0.86, bo.z, 0.26, 0.1, 0.26);
  }
}

/* ------------------------------------------------------------------ the shop */

function shop(b: EnvBuilders, s: GasStationSpec, p: GasStationParts, rng: () => number): void {
  const brand = GAS_BRANDS[s.brand];
  const f = p.frame;
  const g = p.shop;
  const nx = -f.dx;
  const nz = -f.dz;
  const rot = faceRot(nx, nz);
  b.wall.color(PAL.curb, 1.6);
  boxOf(b.wall, g);
  b.roof.color(0x2a3036, 1);
  b.roof.box((g.minX + g.maxX) / 2, g.y1 + 0.02, (g.minZ + g.maxZ) / 2, g.maxX - g.minX - 0.2, 0.04, g.maxZ - g.minZ - 0.2);

  const face = faceOf(g, nx, nz);
  // Right along the face as seen from the forecourt.
  const rx = nz;
  const rz = -nx;
  const glassW = face.width - 3.2;
  const gx = face.x + nx * 0.03 - rx * 0.8;
  const gz = face.z + nz * 0.03 - rz * 0.8;
  const glassH = 2.7;
  const glassY = 0.35 + glassH / 2;
  // The glass, warm from inside, and what is on the shelves behind it.
  b.neon.color(SHOP_LIGHT, 0.62);
  b.neon.panel(gx, glassY, gz, glassW, glassH, rot);
  const goods = [0x7fd6ff, 0xff7a9a, 0xfff0a0, 0x9dff9a, 0xffffff];
  for (const shelfY of [0.95, 1.55, 2.15]) {
    for (let t = -glassW / 2 + 0.4; t < glassW / 2 - 0.4; t += 0.45 + rng() * 0.4) {
      if (rng() < 0.3) continue;
      b.neon.color(goods[Math.floor(rng() * goods.length)], 0.55 + rng() * 0.3);
      b.neon.panel(gx + rx * t + nx * 0.01, shelfY + 0.18, gz + rz * t + nz * 0.01, 0.25 + rng() * 0.25, 0.28, rot);
    }
    b.props.color(0x2b2f36, 1);
    b.props.panel(gx + nx * 0.015, shelfY, gz + nz * 0.015, glassW - 0.4, 0.06, rot);
  }
  // Mullions and the transom.
  b.props.color(0x1a1d22, 1);
  const panes = Math.max(3, Math.round(glassW / 1.8));
  for (let k = 0; k <= panes; k++) {
    const t = -glassW / 2 + (glassW / panes) * k;
    b.props.box(gx + rx * t + nx * 0.03, glassY, gz + rz * t + nz * 0.03, Math.abs(rx) * 0.1 + Math.abs(nx) * 0.08, glassH, Math.abs(rz) * 0.1 + Math.abs(nz) * 0.08);
  }
  b.props.box(gx + nx * 0.03, glassY + glassH / 2, gz + nz * 0.03, Math.abs(rx) * glassW + Math.abs(nx) * 0.1, 0.12, Math.abs(rz) * glassW + Math.abs(nz) * 0.1);
  // The door at the corner end: glass, cooler.
  const dx = face.x + nx * 0.03 + rx * (face.width / 2 - 1.2);
  const dz = face.z + nz * 0.03 + rz * (face.width / 2 - 1.2);
  b.neon.color(0xa8dcff, 0.45);
  b.neon.panel(dx, 1.2, dz, 1.6, 2.4, rot);
  b.props.color(0x1a1d22, 1);
  b.props.box(dx + nx * 0.03, 2.45, dz + nz * 0.03, Math.abs(rx) * 1.8 + Math.abs(nx) * 0.1, 0.12, Math.abs(rz) * 1.8 + Math.abs(nz) * 0.1);
  // OPEN, red, in the window.
  const ox = gx + rx * (glassW / 2 - 1.3) + nx * 0.06;
  const oz = gz + rz * (glassW / 2 - 1.3) + nz * 0.06;
  b.props.color(0x0b0c10, 1);
  b.props.panel(ox + nx * 0.01, 2.36, oz + nz * 0.01, 1.35, 0.52, rot);
  neonText(b.neon, 'OPEN', ox + nx * 0.02, 2.2, oz + nz * 0.02, nx, nz, 0.32, OPEN_RED, 1);
  halo(b, ox + nx * 0.3, 2.36, oz + nz * 0.3, 2.2, 1.3, rot, OPEN_RED, 0.3);

  // The fascia over the front: a slab out over the pavement with an amber strip under its edge.
  const over = 1.5;
  const fyTop = g.y1 - 0.1;
  const fyBot = 3.35;
  const fcx = face.x + nx * over / 2;
  const fcz = face.z + nz * over / 2;
  b.concrete.color(0x4d565f, 1);
  b.concrete.box(fcx, (fyTop + fyBot) / 2, fcz, Math.abs(rx) * (face.width + 0.4) + Math.abs(nx) * over, fyTop - fyBot, Math.abs(rz) * (face.width + 0.4) + Math.abs(nz) * over, { bottom: true });
  const ex = face.x + nx * (over + 0.03);
  const ez = face.z + nz * (over + 0.03);
  b.neon.color(brand.accent, 1);
  b.neon.tube(ex - rx * (face.width / 2), fyBot + 0.06, ez - rz * (face.width / 2), ex + rx * (face.width / 2), fyBot + 0.06, ez + rz * (face.width / 2), 0.08);
  b.neon.color(brand.color, 0.8);
  b.neon.tube(ex - rx * (face.width / 2), fyTop - 0.12, ez - rz * (face.width / 2), ex + rx * (face.width / 2), fyTop - 0.12, ez + rz * (face.width / 2), 0.05);
  halo(b, face.x + nx * 1.2, 1.7, face.z + nz * 1.2, face.width + 2, 3.4, rot, SHOP_LIGHT, 0.14);
  const pl = Math.abs(rx) * (face.width + 4) + Math.abs(nx) * 7;
  const pw = Math.abs(rz) * (face.width + 4) + Math.abs(nz) * 7;
  groundGlow(b, face.x + nx * 3.5, face.z + nz * 3.5, pl, pw, SHOP_LIGHT, 0.24, Y.glow);

  // Plant on the roof, and paint on the side the forecourt sees.
  b.props.color(PAL.metalDark, 1.1);
  const rc = frameAt(f, p.shopU - p.shopLength / 4, p.shopV + 1.5);
  b.props.box(rc.x, g.y1 + 0.5, rc.z, 1.8, 1, 1.4);
  const rc2 = frameAt(f, p.shopU + p.shopLength / 5, p.shopV + 2.5);
  b.props.box(rc2.x, g.y1 + 0.35, rc2.z, 1.1, 0.7, 1.1);
  const side = faceOf(g, -f.ax, -f.az);
  paintSurface(b, surface(side.x - f.ax * 0.02, 0, side.z - f.az * 0.02, -f.ax, -f.az, side.width, GAS.shopHeight - 0.6), TAGGED, seedOf(`${s.tag}:shop-side`));
  grimeSurface(b, surface(side.x - f.ax * 0.02, 0, side.z - f.az * 0.02, -f.ax, -f.az, side.width, GAS.shopHeight), TAGGED, seedOf(`${s.tag}:shop-grime`), 'streak');
}

/* ------------------------------------------------------------------ the service bay */

function serviceBay(b: EnvBuilders, s: GasStationSpec, p: GasStationParts): void {
  const g = p.bay;
  if (!g) return;
  const f = p.frame;
  const nx = -f.dx;
  const nz = -f.dz;
  const rot = faceRot(nx, nz);
  const rx = nz;
  const rz = -nx;
  b.wall.color(PAL.curb, 1.45);
  boxOf(b.wall, g);
  b.roof.color(0x2a3036, 1);
  b.roof.box((g.minX + g.maxX) / 2, g.y1 + 0.02, (g.minZ + g.maxZ) / 2, g.maxX - g.minX - 0.2, 0.04, g.maxZ - g.minZ - 0.2);
  const face = faceOf(g, nx, nz);
  const w = face.width - 1.4;
  const h = 3.8;
  // The roller shutter: a grey panel ribbed across, a dark gap under it.
  b.props.color(0x6b7178, 1);
  b.props.panel(face.x + nx * 0.04, h / 2, face.z + nz * 0.04, w, h, rot);
  b.props.color(0x4d5258, 1);
  for (let y = 0.2; y < h; y += 0.3) {
    b.props.box(face.x + nx * 0.06, y, face.z + nz * 0.06, Math.abs(rx) * w + Math.abs(nx) * 0.04, 0.05, Math.abs(rz) * w + Math.abs(nz) * 0.04);
  }
  b.props.color(0x2f343a, 1);
  b.props.box(face.x + nx * 0.2, h + 0.18, face.z + nz * 0.2, Math.abs(rx) * (w + 0.3) + Math.abs(nx) * 0.4, 0.36, Math.abs(rz) * (w + 0.3) + Math.abs(nz) * 0.4);
  paintSurface(b, surface(face.x + nx * 0.07, 0, face.z + nz * 0.07, nx, nz, w, h - 0.6), TAGGED, seedOf(`${s.tag}:shutter`));
  // TALLER over it in tired white, and the work light that washes the shutter.
  neonText(b.neon, 'TALLER', face.x + nx * 0.05, h + 0.45, face.z + nz * 0.05, nx, nz, 0.42, 0xe8f4ff, 0.7);
  const lx = face.x + nx * 0.5 + rx * (w / 2 - 0.4);
  const lz = face.z + nz * 0.5 + rz * (w / 2 - 0.4);
  b.props.color(PAL.metalDark, 1.2);
  b.props.box(lx, h + 0.95, lz, 0.4, 0.2, 0.4);
  b.neon.color(0xe8f4ff, 0.9);
  b.neon.planeY(lx, h + 0.84, lz, 0.32, 0.32);
  b.glow.color(0xe8f4ff, 0.1);
  b.glow.panel(face.x + nx * 0.1, h / 2, face.z + nz * 0.1, w, h, rot);
  groundGlow(b, face.x + nx * 4, face.z + nz * 4, 8, 8, 0xe8f4ff, 0.14, Y.glow);
}

/* ------------------------------------------------------------------ behind the shop */

function backLot(b: EnvBuilders, p: GasStationParts, rng: () => number): void {
  const f = p.frame;
  const g = p.dumpster;
  // A skip, lid half open.
  b.props.color(0x2f5d3a, 1);
  boxOf(b.props, { ...g, y1: g.y1 - 0.12 });
  b.props.color(0x1d3b25, 1);
  boxOf(b.props, { ...g, y0: g.y1 - 0.12 }, { inset: -0.05 });
  // Cardboard and bags at its foot, weeds in the corner.
  const pile = (u: number, v: number, sz: number, color: number, hgt: number): void => {
    const at = frameAt(f, u, v);
    b.props.color(color, 0.9 + rng() * 0.3);
    b.props.box(at.x, hgt / 2, at.z, sz, hgt, sz * (0.8 + rng() * 0.4));
  };
  const u0 = p.frame.length / 2 - 3.5;
  const v0 = p.frame.depth - 2.2;
  pile(u0 - 2.1, v0 + 0.2, 0.7, 0x8a6a45, 0.55);
  pile(u0 - 2.3, v0 - 0.7, 0.55, 0x8a6a45, 0.45);
  pile(u0 + 1.6, v0 - 0.3, 0.6, 0x14171b, 0.5);
  pile(u0 + 1.4, v0 - 1.1, 0.5, 0x14171b, 0.42);
  for (let k = 0; k < 4; k++) {
    const at = frameAt(f, u0 + 2.8 - rng() * 6, p.frame.depth - 0.9);
    weeds(b, at.x, 0, at.z, rng, { scale: 1.2, dry: 0.5 });
  }
  const corner = frameAt(f, p.frame.length / 2 - 0.8, p.frame.depth - 0.8);
  shrub(b, corner.x, 0, corner.z, rng, { scale: 0.7, dry: 0.4, room: 0.7 });
}

/* ------------------------------------------------------------------ the pylon */

const PRICE_LABELS = ['REG', 'PRE', 'ULT', 'DSL'];

function pylon(b: EnvBuilders, s: GasStationSpec, p: GasStationParts, rng: () => number): void {
  const brand = GAS_BRANDS[s.brand];
  const f = p.frame;
  const g = p.pylon;
  const P = GAS.pylon;
  const at = frameAt(f, p.pylonU, p.pylonV);
  const nx = -f.dx;
  const nz = -f.dz;
  const lx = (along: number, across: number): number => Math.abs(f.ax) * along + Math.abs(f.dx) * across;
  const lz = (along: number, across: number): number => Math.abs(f.az) * along + Math.abs(f.dz) * across;

  // The planter it stands in.
  b.concrete.color(PAL.curb, 1.2);
  boxOf(b.concrete, { ...g, y1: P.base });
  for (let k = 0; k < 5; k++) {
    const t = (rng() - 0.5) * (P.width - 0.6);
    const side = rng() < 0.5 ? -1 : 1;
    weeds(b, at.x + f.ax * t + nx * side * 0.55, P.base, at.z + f.az * t + nz * side * 0.55, rng, { scale: 1.1, dry: 0.4, room: 0.25 });
  }

  // The slab: a dark column, the brand's panel at the top, the board of prices under it.
  const top = P.height;
  b.props.color(0x202329, 1);
  b.props.box(at.x, (P.base + top) / 2, at.z, lx(P.slab, P.slabThick), top - P.base, lz(P.slab, P.slabThick));
  b.props.color(0x0b0c0f, 1);
  b.props.box(at.x, top + 0.08, at.z, lx(P.slab + 0.2, P.slabThick + 0.2), 0.16, lz(P.slab + 0.2, P.slabThick + 0.2));

  const brandY0 = top - 2.1;
  const boardTop = brandY0 - 0.35;
  const rowH = 1.02;
  for (const side of [1, -1]) {
    const fx = nx * side;
    const fz = nz * side;
    const rot = faceRot(fx, fz);
    const ox = at.x + fx * (P.slabThick / 2 + 0.01);
    const oz = at.z + fz * (P.slabThick / 2 + 0.01);
    // Right along the face as seen from in front of it.
    const rx = fz;
    const rz = -fx;
    // The brand: its name in its colour, on a box lit faintly from inside.
    b.neon.color(brand.color, 0.14);
    b.neon.panel(ox, brandY0 + 0.95, oz, P.slab - 0.2, 1.8, rot);
    b.neon.color(brand.color, 1);
    const frame = (y0: number, y1: number, w: number): void => {
      b.neon.tube(ox - rx * w / 2, y0, oz - rz * w / 2, ox + rx * w / 2, y0, oz + rz * w / 2, 0.05);
      b.neon.tube(ox - rx * w / 2, y1, oz - rz * w / 2, ox + rx * w / 2, y1, oz + rz * w / 2, 0.05);
      b.neon.tube(ox - rx * w / 2, y0, oz - rz * w / 2, ox - rx * w / 2, y1, oz - rz * w / 2, 0.05);
      b.neon.tube(ox + rx * w / 2, y0, oz + rz * w / 2, ox + rx * w / 2, y1, oz + rz * w / 2, 0.05);
    };
    frame(brandY0 + 0.1, brandY0 + 1.8, P.slab - 0.25);
    const nameH = Math.min(0.95, (P.slab - 0.6) / (textWidth(brand.name, 1) || 1));
    neonText(b.neon, brand.name, ox, brandY0 + 0.95 - nameH / 2, oz, fx, fz, nameH, brand.color, 1);
    halo(b, ox + fx * 0.4, brandY0 + 0.95, oz + fz * 0.4, P.slab + 3.5, 3.4, rot, brand.color, 0.32);

    // The board: four rows, the grade in white, the price in the brand's digits.
    b.props.color(0x050608, 1);
    b.props.panel(ox + fx * 0.005, boardTop - (rowH * 4) / 2, oz + fz * 0.005, P.slab - 0.3, rowH * 4 + 0.2, rot);
    for (let r = 0; r < 4; r++) {
      const base = boardTop - rowH * (r + 1) + 0.25;
      const labelAt = -(P.slab - 0.3) / 2 + 0.2 + textWidth(PRICE_LABELS[r], 0.36) / 2;
      neonText(b.neon, PRICE_LABELS[r], ox + rx * labelAt, base + 0.06, oz + rz * labelAt, fx, fz, 0.36, 0xf0f4f8, 0.9);
      const price = priceText(s.prices[r]);
      const priceAt = (P.slab - 0.3) / 2 - 0.3 - textWidth(price, 0.52) / 2;
      neonText(b.neon, price, ox + rx * priceAt, base, oz + rz * priceAt, fx, fz, 0.52, brand.digits, 1);
    }
    halo(b, ox + fx * 0.3, boardTop - rowH * 2, oz + fz * 0.3, P.slab + 1.5, rowH * 4 + 1.2, rot, brand.digits, 0.12);
  }
  groundGlow(b, at.x, at.z, 11, 11, brand.color, 0.22, Y.glow);
}
