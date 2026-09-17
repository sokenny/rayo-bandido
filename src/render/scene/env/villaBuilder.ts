import type { BlockRect } from '../../../world/cityPlan';
import { drapedSlab, groundGlow, type EnvBuilders } from './builders';
import { neonText } from './gasStationBuilder';
import { makeRng, type MeshBuilder, type Rect2 } from './meshBuilder';
import { PAL } from './palette';

/**
 * THE VILLA, drawn (`world/metroVilla.ts`): Villa 31 round the metro's east ramp. Every block the
 * generator cut inside a villa's land is built here instead of by `cityBuilder`'s kit, and only
 * inside the block's collider, so what can be hit is still exactly the block.
 *
 * A block is packed to its pavement with self-built houses on narrow lots: bare brick mostly,
 * some rendered and painted, two to six storeys with the slab edge showing at every floor. The
 * houses get taller toward the middle of the block — each generation built on top of the last —
 * and in STACKS (`stackAt`, patches a couple of dozen metres across) they go on up to fourteen
 * storeys, the upper floors set back or pushed out over the lower ones, so the barrio rises over
 * the highway running through it rather than lying at its rail. On the roofs:
 * black water tanks, rebar left standing for the next floor, railings and washing. Windows are
 * few and small and mostly warm; now and then one is the city's neon instead. Cables are strung
 * across the roofs. The block's street face toward the avenue carries the murals.
 *
 * Nothing is a flat wall: the slab edges and the corner columns of the concrete frame stand proud
 * of the brick, windows have sills, and floor by floor a face gets a room built out over the
 * street, a balcony with its rail and door, a patch of render over the brick (or brick through
 * the paint), an air conditioner, a shutter at street level, a pipe down its length.
 *
 * Budget: a face that can be seen is dressed floor by floor (a face against a taller neighbour is
 * skipped); roofs get their things.
 */

/** Storey height of a self-built house (m). */
const STOREY = 2.9;

const VILLA = {
  /** How far inside the collider the houses stand (m): a narrow, broken pavement. */
  inset: 1.6,
  /** Lot widths along a block's frontage (m). */
  minLot: 4.2,
  maxLot: 8.5,
  /** Storeys at the block's edge and the most added toward its middle. */
  edgeFloors: [2, 4] as const,
  centreFloors: 4,
  /** Share of the villa's ground in stacks, what a house in one adds, and the most any house has. */
  stackShare: 0.42,
  stackFloors: [4, 9] as const,
  maxFloors: 14,
  /** Share of houses rendered and painted rather than bare brick. */
  painted: 0.3,
  /** Share of windows lit, and of those, the share that are neon rather than a bulb. */
  lit: 0.42,
  neon: 0.12,
  tank: 0.72,
  rebar: 0.4,
} as const;

const BRICK = [0x8c4a33, 0x7d3f2b, 0x9a573a, 0x6f3a2a, 0x85503c];
const PAINT = [0x3c6aa6, 0x3e8a58, 0xc29b36, 0xb0587a, 0xb8ad94, 0x5b8e9a, 0x9a4e8e, 0x6d7278];
const BLOCKWORK = 0x777b7e;

interface House extends Rect2 {
  base: number;
  /** A lower part with more house built on it: its roof is not dressed. */
  built?: boolean;
  top: number;
  color: number;
}

export function buildVillas(b: EnvBuilders): void {
  for (const blk of b.plan.blocks) if (blk.villa) buildVillaBlock(b, blk);
}

/** Whether a point is in one of the villa's stacks: patches on a 22 m grid, some of them. */
function stackAt(x: number, z: number): boolean {
  const ix = Math.floor(x / 22);
  const iz = Math.floor(z / 22);
  return Math.abs(Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453) % 1 < VILLA.stackShare;
}

/** A guillotine split of the block's inside into lots: long runs cut across, so lots front the streets. */
function splitLots(r: Rect2, rng: () => number, out: Rect2[]): void {
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  if (w <= VILLA.maxLot && d <= VILLA.maxLot) {
    out.push(r);
    return;
  }
  const alongX = w >= d;
  const span = alongX ? w : d;
  const cut = VILLA.minLot + rng() * Math.min(VILLA.maxLot - VILLA.minLot, span - 2 * VILLA.minLot);
  const at = span <= VILLA.maxLot + VILLA.minLot ? span / 2 : cut;
  if (alongX) {
    splitLots({ ...r, maxX: r.minX + at }, rng, out);
    splitLots({ ...r, minX: r.minX + at }, rng, out);
  } else {
    splitLots({ ...r, maxZ: r.minZ + at }, rng, out);
    splitLots({ ...r, minZ: r.minZ + at }, rng, out);
  }
}

function buildVillaBlock(b: EnvBuilders, blk: BlockRect): void {
  const rng = makeRng(Math.floor(blk.minX * 73.1 + blk.minZ * 19.7) >>> 0);
  // A broken pavement, darker than the city's.
  b.concrete.color(PAL.curb, 0.85);
  drapedSlab(b, b.concrete, { minX: blk.minX + 0.3, maxX: blk.maxX - 0.3, minZ: blk.minZ + 0.3, maxZ: blk.maxZ - 0.3 }, 0);
  b.concrete.color(PAL.sidewalk, 0.62);
  drapedSlab(b, b.concrete, { minX: blk.minX + 0.85, maxX: blk.maxX - 0.85, minZ: blk.minZ + 0.85, maxZ: blk.maxZ - 0.85 }, 0.006);

  const inner: Rect2 = { minX: blk.minX + VILLA.inset, maxX: blk.maxX - VILLA.inset, minZ: blk.minZ + VILLA.inset, maxZ: blk.maxZ - VILLA.inset };
  const iw = inner.maxX - inner.minX;
  const id = inner.maxZ - inner.minZ;
  if (iw < 3 || id < 3) return;
  const lots: Rect2[] = [];
  splitLots(inner, rng, lots);
  const half = Math.min(iw, id) / 2;
  const ceiling = blk.maxHeight;

  const houses: House[] = [];
  for (const lot of lots) {
    // Houses do not quite fill their lots: a passage now and then, a step back from a neighbour.
    const gap = rng() < 0.18 ? 0.9 : 0.05;
    const r: Rect2 = { minX: lot.minX + gap * rng(), maxX: lot.maxX - gap * rng(), minZ: lot.minZ + gap * rng(), maxZ: lot.maxZ - gap * rng() };
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const edge = Math.min(cx - inner.minX, inner.maxX - cx, cz - inner.minZ, inner.maxZ - cz);
    const middle = Math.min(1, edge / Math.max(8, half));
    let floors = VILLA.edgeFloors[0] + Math.floor(rng() * (VILLA.edgeFloors[1] - VILLA.edgeFloors[0] + 1)) + Math.round(middle * VILLA.centreFloors * (0.6 + rng() * 0.6));
    if (stackAt(cx, cz) && rng() < 0.8) floors += VILLA.stackFloors[0] + Math.floor(rng() * (VILLA.stackFloors[1] - VILLA.stackFloors[0] + 1));
    floors = Math.min(floors, VILLA.maxFloors);
    const base = b.plan.padY(cx, cz);
    if (ceiling !== undefined) floors = Math.min(floors, Math.floor((ceiling - 0.6) / STOREY));
    if (floors < 1) continue;
    const pick = (): number => {
      const painted = rng() < VILLA.painted;
      return painted ? PAINT[Math.floor(rng() * PAINT.length)] : rng() < 0.15 ? BLOCKWORK : BRICK[Math.floor(rng() * BRICK.length)];
    };
    if (floors <= 5 || r.maxX - r.minX < 4.5 || r.maxZ - r.minZ < 4.5) {
      houses.push({ ...r, base, top: base + floors * STOREY, color: pick() });
      continue;
    }
    // A tall one is two builds: the house, and what was put on top of it later, set back on some
    // sides and pushed out over the street on others, in another brick or another paint.
    const lower = Math.max(2, Math.round(floors * (0.35 + rng() * 0.3)));
    const shift = (): number => (rng() - 0.55) * 1.6;
    const upper: Rect2 = { minX: r.minX + shift(), maxX: r.maxX - shift(), minZ: r.minZ + shift(), maxZ: r.maxZ - shift() };
    const mid = base + lower * STOREY;
    houses.push({ ...r, base, top: mid, color: pick(), built: true });
    houses.push({ ...upper, base: mid, top: base + floors * STOREY, color: pick() });
  }

  /** Whether a neighbour's wall stands against this point at this height: then nobody sees it. */
  const hidden = (x: number, y: number, z: number, self: House): boolean => {
    for (const h of houses) {
      if (h === self) continue;
      if (x >= h.minX - 0.2 && x <= h.maxX + 0.2 && z >= h.minZ - 0.2 && z <= h.maxZ + 0.2 && h.top >= y && h.base <= y) return true;
    }
    return false;
  };

  for (const h of houses) buildHouse(b, h, hidden, rng);
  buildCables(b, houses, rng);
}

function buildHouse(b: EnvBuilders, h: House, hidden: (x: number, y: number, z: number, self: House) => boolean, rng: () => number): void {
  const w = h.maxX - h.minX;
  const d = h.maxZ - h.minZ;
  const cx = (h.minX + h.maxX) / 2;
  const cz = (h.minZ + h.maxZ) / 2;
  const height = h.top - h.base;
  // The body, down past the ground so a house on a slope never shows daylight under it.
  b.wall.color(h.color, 0.62 + rng() * 0.25);
  b.wall.box(cx, h.base - 0.4 + (height + 0.4) / 2, cz, w, height + 0.4, d, { tileW: 4, tileH: 4, uOffset: rng() });
  b.roof.color(0x2a2c2e, 0.9);
  b.roof.planeY(cx, h.top + 0.02, cz, w - 0.1, d - 0.1);

  const floors = Math.round(height / STOREY);
  // The four faces: outward normal, the wall's run.
  const faces: Array<{ nx: number; nz: number; len: number; ox: number; oz: number; rot: number }> = [
    { nx: 1, nz: 0, len: d, ox: h.maxX, oz: cz, rot: Math.PI / 2 },
    { nx: -1, nz: 0, len: d, ox: h.minX, oz: cz, rot: -Math.PI / 2 },
    { nx: 0, nz: 1, len: w, ox: cx, oz: h.maxZ, rot: 0 },
    { nx: 0, nz: -1, len: w, ox: cx, oz: h.minZ, rot: Math.PI },
  ];
  const brick = BRICK.includes(h.color) || h.color === BLOCKWORK;
  for (const f of faces) {
    // Right of the face, as its viewer sees it.
    const rx = f.nz;
    const rz = -f.nx;
    let seen = 0;
    for (let k = 0; k < floors; k++) {
      const y0 = h.base + k * STOREY;
      const probeX = f.ox + f.nx * 0.6;
      const probeZ = f.oz + f.nz * 0.6;
      if (hidden(probeX, y0 + STOREY * 0.5, probeZ, h)) continue;
      seen++;
      // The slab edge: a concrete band at each floor, standing proud of the brick.
      if (k > 0) {
        b.concrete.color(PAL.concrete, 0.5 + rng() * 0.12);
        ledge(b.concrete, f.ox, f.oz, f.nx, f.nz, f.len + 0.3, 0.22, y0 - 0.02, y0 + 0.24);
      }
      // What each floor has done to its wall: its render patched in another colour, a room built
      // out over the street, a balcony, an air conditioner, a shutter at street level.
      const reach = k === 0 ? 0.5 : 1.2;
      const spot = (rng() - 0.5) * Math.max(0, f.len - 3);
      const roll = rng();
      let skipWindow = -1;
      if (k === 0 && roll < 0.3 && f.len > 3) {
        const sw = Math.min(f.len - 1, 2.4 + rng());
        b.props.color(0x565b61, 0.9);
        b.props.panel(f.ox + rx * spot + f.nx * 0.06, y0 + 1.2, f.oz + rz * spot + f.nz * 0.06, sw, 2.3, f.rot);
        b.props.color(0x2a2d31, 1);
        for (let n = 1; n < 6; n++) b.props.panel(f.ox + rx * spot + f.nx * 0.07, y0 + 0.1 + n * 0.4, f.oz + rz * spot + f.nz * 0.07, sw, 0.04, f.rot);
        skipWindow = 0;
      } else if (k > 0 && roll < 0.12 && f.len > 3.5) {
        // A balcony: slab, rail, and the door onto it.
        const bw = Math.min(f.len * 0.6, 2.2 + rng() * 1.2);
        const depth = 0.8 + rng() * 0.4;
        const bx = f.ox + rx * spot + f.nx * (depth / 2);
        const bz = f.oz + rz * spot + f.nz * (depth / 2);
        b.concrete.color(PAL.concrete, 0.55);
        b.concrete.orientedBox(bx, bz, rx, rz, bw, depth, y0 - 0.02, y0 + 0.16);
        const ry = y0 + 1.05;
        const px0 = f.ox + rx * (spot - bw / 2) + f.nx * depth;
        const pz0 = f.oz + rz * (spot - bw / 2) + f.nz * depth;
        const px1 = f.ox + rx * (spot + bw / 2) + f.nx * depth;
        const pz1 = f.oz + rz * (spot + bw / 2) + f.nz * depth;
        b.props.color(0x202327, 1);
        b.props.tube(px0, ry, pz0, px1, ry, pz1, 0.05);
        b.props.tube(px0, ry, pz0, px0 - f.nx * depth, ry, pz0 - f.nz * depth, 0.05);
        b.props.tube(px1, ry, pz1, px1 - f.nx * depth, ry, pz1 - f.nz * depth, 0.05);
        for (let n = 0; n <= 3; n++) {
          const t = n / 3;
          b.props.tube(px0 + (px1 - px0) * t, y0 + 0.16, pz0 + (pz1 - pz0) * t, px0 + (px1 - px0) * t, ry, pz0 + (pz1 - pz0) * t, 0.035);
        }
        const lit = rng() < 0.4;
        b.neon.color(lit ? PAL.winWarm : 0x0c0e11, lit ? 0.35 : 1);
        b.neon.panel(f.ox + rx * spot + f.nx * 0.05, y0 + 1.15, f.oz + rz * spot + f.nz * 0.05, 0.9, 2, f.rot);
        skipWindow = spot < 0 ? 0 : 1;
      } else if (k > 0 && roll < 0.22 && f.len > 3) {
        // A room added out over the street, in whatever there was to build it with.
        const bw = Math.min(f.len - 0.6, 1.8 + rng() * 1.8);
        const depth = Math.min(reach, 0.7 + rng() * 0.6);
        const bx = f.ox + rx * spot + f.nx * (depth / 2);
        const bz = f.oz + rz * spot + f.nz * (depth / 2);
        const other = rng() < 0.5 ? PAINT[Math.floor(rng() * PAINT.length)] : BRICK[Math.floor(rng() * BRICK.length)];
        b.wall.color(other, 0.6 + rng() * 0.25);
        b.wall.orientedBox(bx, bz, rx, rz, bw, depth, y0, y0 + STOREY - 0.12, { tile: 4 });
        const lit = rng() < 0.5;
        b.neon.color(lit ? PAL.winWarm : 0x0d0f12, lit ? 0.4 : 1);
        b.neon.panel(bx + f.nx * (depth / 2 + 0.03), y0 + 1.5, bz + f.nz * (depth / 2 + 0.03), Math.min(1.2, bw - 0.5), 0.9, f.rot);
        skipWindow = spot < 0 ? 0 : 1;
      } else if (roll < 0.4) {
        // Render patched over the brick, or the brick showing through the paint.
        const pw = 1 + rng() * Math.min(3, f.len);
        const ph = 0.8 + rng() * 1.6;
        const patch = brick ? PAINT[Math.floor(rng() * PAINT.length)] : BRICK[Math.floor(rng() * BRICK.length)];
        b.wall.color(patch, 0.5 + rng() * 0.2);
        const py = y0 + 0.3 + rng() * Math.max(0, STOREY - ph - 0.4);
        b.wall.panel(f.ox + rx * spot + f.nx * 0.04, py + ph / 2, f.oz + rz * spot + f.nz * 0.04, pw, ph, f.rot);
      }
      if (rng() < 0.07 && k > 0) {
        b.props.color(0x8a8f94, 0.7);
        b.props.orientedBox(f.ox - rx * spot * 0.5 + f.nx * 0.25, f.oz - rz * spot * 0.5 + f.nz * 0.25, rx, rz, 0.8, 0.45, y0 + 1.9, y0 + 2.45);
      }
      const count = f.len > 7 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        if (i === skipWindow || (count === 1 && skipWindow === 0)) continue;
        if (rng() < 0.22) continue;
        const along = (count === 1 ? 0 : (i === 0 ? -0.25 : 0.25) * f.len) + (rng() - 0.5) * 0.8;
        const wx = f.ox + rx * along + f.nx * 0.05;
        const wz = f.oz + rz * along + f.nz * 0.05;
        const wy = y0 + 1.5;
        const ww = 0.9 + rng() * 0.5;
        const wh = 1.0 + rng() * 0.25;
        const roll = rng();
        if (roll < VILLA.lit * VILLA.neon) {
          b.neon.color(rng() < 0.5 ? PAL.neonMagenta : PAL.neonCyan, 0.55);
          b.neon.panel(wx, wy, wz, ww, wh, f.rot);
        } else if (roll < VILLA.lit) {
          b.neon.color(rng() < 0.75 ? PAL.winWarm : PAL.winAmber, 0.32 + rng() * 0.3);
          b.neon.panel(wx, wy, wz, ww, wh, f.rot);
        } else {
          b.props.color(0x0d0f12, 1);
          b.props.panel(wx, wy, wz, ww, wh, f.rot);
        }
        // The sill, or the lintel, in concrete: the opening has depth.
        if (rng() < 0.6) {
          b.concrete.color(PAL.concrete, 0.55);
          ledge(b.concrete, wx, wz, f.nx, f.nz, ww + 0.3, 0.16, wy - wh / 2 - 0.12, wy - wh / 2);
        }
      }
    }
    // A drain pipe or a cable run down the face.
    if (seen > 2 && rng() < 0.25) {
      const along = (rng() - 0.5) * f.len * 0.9;
      const px = f.ox + rx * along + f.nx * 0.12;
      const pz = f.oz + rz * along + f.nz * 0.12;
      b.props.color(0x1a1c1f, 1);
      b.props.tube(px, h.base, pz, px, h.top, pz, 0.09);
    }
  }
  // The frame the brick fills: concrete columns at the corners, proud of the wall.
  if (brick && height > STOREY * 1.5) {
    b.concrete.color(PAL.concrete, 0.52);
    for (const [px, pz] of [[h.minX, h.minZ], [h.maxX, h.minZ], [h.minX, h.maxZ], [h.maxX, h.maxZ]]) {
      b.concrete.box(px, h.base + height / 2, pz, 0.46, height, 0.46, { top: false });
    }
  }

  // The roof: a tank, rebar for the floor still to come, a railing, washing. Not on a house with
  // more house built on it.
  if (h.built) return;
  const top = h.top;
  if (rng() < VILLA.tank) {
    const tx = h.minX + 0.9 + rng() * Math.max(0, w - 1.8);
    const tz = h.minZ + 0.9 + rng() * Math.max(0, d - 1.8);
    b.props.color(0x121416, 1);
    b.props.box(tx, top + 0.35, tz, 0.5, 0.7, 0.5, { top: false });
    b.props.chamfer(0.18).box(tx, top + 1.15, tz, 1.25, 1.1, 1.25);
    b.props.chamfer(0);
  }
  if (rng() < VILLA.rebar) {
    b.props.color(0x4a3a30, 1);
    for (const [px, pz] of [[h.minX + 0.3, h.minZ + 0.3], [h.maxX - 0.3, h.minZ + 0.3], [h.minX + 0.3, h.maxZ - 0.3], [h.maxX - 0.3, h.maxZ - 0.3]]) {
      b.props.tube(px, top, pz, px + (rng() - 0.5) * 0.2, top + 1.1 + rng() * 0.6, pz + (rng() - 0.5) * 0.2, 0.06);
    }
  } else if (rng() < 0.35) {
    b.props.color(0x1d2024, 1);
    const ry = top + 1;
    b.props.tube(h.minX + 0.2, ry, h.minZ + 0.2, h.maxX - 0.2, ry, h.minZ + 0.2, 0.05);
    b.props.tube(h.minX + 0.2, ry, h.maxZ - 0.2, h.maxX - 0.2, ry, h.maxZ - 0.2, 0.05);
    b.props.tube(h.minX + 0.2, top, h.minZ + 0.2, h.minX + 0.2, ry, h.minZ + 0.2, 0.05);
    b.props.tube(h.maxX - 0.2, top, h.maxZ - 0.2, h.maxX - 0.2, ry, h.maxZ - 0.2, 0.05);
  }
  if (rng() < 0.16 && w > 3 && d > 3) {
    const ly = top + 1.6;
    b.props.color(0x202326, 1);
    b.props.tube(h.minX + 0.3, ly, cz, h.maxX - 0.3, ly, cz, 0.03);
    for (let k = 0; k < 3; k++) {
      b.props.color(PAINT[Math.floor(rng() * PAINT.length)], 0.8);
      b.props.panel(h.minX + 0.9 + k * ((w - 1.8) / 3), ly - 0.4, cz, 0.6, 0.75, 0);
    }
  }
  // A neon strip on a few walls, and the light it throws: the villa is in the city.
  if (rng() < 0.05) {
    const color = rng() < 0.5 ? PAL.neonMagenta : PAL.neonCyan;
    const y = h.base + STOREY * (1 + Math.floor(rng() * Math.max(1, floors - 1))) - 0.3;
    b.neonPulse.color(color, 0.8);
    b.neonPulse.tube(h.minX - 0.05, y, h.maxZ + 0.08, h.maxX + 0.05, y, h.maxZ + 0.08, 0.1);
    groundGlow(b, cx, h.maxZ + 2, w + 2, 4, color, 0.06);
  }
}

/**
 * A band standing `out` proud of a wall whose face is at (x, z) with outward normal (nx, nz),
 * `len` along it, from `y0` to `y1`: its front and its top, which is all anyone sees of it.
 */
function ledge(mb: MeshBuilder, x: number, z: number, nx: number, nz: number, len: number, out: number, y0: number, y1: number): void {
  const rx = nz;
  const rz = -nx;
  const h = len / 2;
  const fx = x + nx * out;
  const fz = z + nz * out;
  // Front, facing out: bottom-left, bottom-right, top-right, top-left as its viewer sees it.
  mb.quad(fx - rx * h, y0, fz - rz * h, fx + rx * h, y0, fz + rz * h, fx + rx * h, y1, fz + rz * h, fx - rx * h, y1, fz - rz * h, 0, 0, 1, 1);
  // Top, facing up.
  mb.quad(fx - rx * h, y1, fz - rz * h, fx + rx * h, y1, fz + rz * h, x + rx * h, y1, z + rz * h, x - rx * h, y1, z - rz * h, 0, 0, 1, 1);
}

/** Cables slung from roof to roof across the block, sagging in two runs. */
function buildCables(b: EnvBuilders, houses: readonly House[], rng: () => number): void {
  if (houses.length < 2) return;
  b.props.color(0x0b0c0e, 1);
  const count = Math.min(40, Math.floor(houses.length * 0.5));
  for (let k = 0; k < count; k++) {
    const a = houses[Math.floor(rng() * houses.length)];
    const c = houses[Math.floor(rng() * houses.length)];
    if (a === c) continue;
    const ax = a.minX + rng() * (a.maxX - a.minX);
    const az = a.minZ + rng() * (a.maxZ - a.minZ);
    const cx = c.minX + rng() * (c.maxX - c.minX);
    const cz = c.minZ + rng() * (c.maxZ - c.minZ);
    const span = Math.hypot(cx - ax, cz - az);
    if (span < 4 || span > 28) continue;
    const ay = a.top + 1.4;
    const cy = c.top + 1.4;
    const my = Math.min(ay, cy) - span * 0.05;
    b.props.tube(ax, ay, az, (ax + cx) / 2, my, (az + cz) / 2, 0.035);
    b.props.tube((ax + cx) / 2, my, (az + cz) / 2, cx, cy, cz, 0.035);
  }
}

/**
 * A mural: painted lettering on a wall, lit only by the street (a dim, cold neon standing in for
 * paint in the dark). `nx`/`nz` is the wall's outward normal.
 */
export function villaMural(b: EnvBuilders, text: string, x: number, y: number, z: number, nx: number, nz: number, h: number, color: number): void {
  neonText(b.neon, text, x, y, z, nx, nz, h, color, 0.42);
}
