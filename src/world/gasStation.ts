import type { ObstacleBox, ObstacleWall } from '../core/types';
import type { MeetSide } from './carMeet';
import type { BlockRect, Rect } from './cityPlan';

/**
 * A GAS STATION: a corner of a block the city gives up for a forecourt, a canopy over the pumps,
 * a shop and a service bay at the back, and a price pylon on the corner. After Juan's reference
 * (2026-09-14): a rain-soaked forecourt under towers, a flat canopy with a glowing amber edge and
 * pale columns painted teal at the foot, a lit shop, a tall sign with FUEL in neon over the prices.
 * Scenery for now: nothing on the forecourt does anything but stand there and be solid.
 *
 * Data only, and the one place a station's numbers become shapes, like `carMeet.ts`: the
 * assembler (`cityWorld.ts`) makes the colliders from `stationParts`, the art
 * (`render/scene/env/gasStationBuilder.ts`) draws from the same parts, so what can be seen and
 * what can be hit are the same boxes.
 *
 * Unlike a meet, a station takes a CORNER of a block, not all of it: the plots it touches are cut
 * back to its edge (`clipBlocksToLots`) and the buildings stand on behind it.
 *
 * THE FRAME every part is laid out in: `u` runs along the front street, positive toward the
 * corner street (where the pylon stands); `v` runs from the front edge of the lot inward. Every
 * lot is square to the world, so every part is an axis-aligned box once turned into x and z.
 */

export type GasBrand = 'neogas' | 'octano' | 'volta' | 'marea';

export interface GasStationSpec {
  tag: string;
  label: string;
  brand: GasBrand;
  /** The forecourt: pavement-edge to pavement-edge on its street sides. */
  lot: Rect;
  /** The street the canopy and the shop face. */
  front: MeetSide;
  /** The second street, across the front: the pylon stands on this corner. */
  corner: MeetSide;
  /** Every side of the lot that is a street (the rest get a low wall). Includes `front` and `corner`. */
  streets: MeetSide[];
  /** The four prices on the pylon, top to bottom, as they read (e.g. 23.9). */
  prices: [number, number, number, number];
}

/** What a brand looks like: its lit colour, the accent, and the name on the pylon and the canopy. */
export const GAS_BRANDS: Record<GasBrand, { name: string; color: number; accent: number; digits: number }> = {
  neogas: { name: 'NEOGAS', color: 0x2ee6d6, accent: 0xffb13b, digits: 0xff8a2a },
  octano: { name: 'OCTANO', color: 0xff9a2e, accent: 0xffd27a, digits: 0xffb13b },
  volta: { name: 'VOLTA', color: 0xff2fb4, accent: 0x9f6bff, digits: 0x3fe8ff },
  marea: { name: 'MAREA', color: 0x39ff9a, accent: 0x3fe8ff, digits: 0xff8a2a },
};

/** Sizes (m). `canopyY` is the underside of the canopy; its slab is `canopyThick` over that. */
export const GAS = {
  frontMargin: 4,
  canopyDepth: 13,
  canopyMaxLength: 30,
  canopyY: 5.4,
  canopyThick: 1.1,
  column: 0.8,
  islandLength: 7.4,
  islandWidth: 1.3,
  islandHeight: 0.2,
  islandSpacing: 9,
  /** A pump: `along` down the island, `across` it. */
  pump: { along: 1.15, across: 0.62, height: 2.05, offset: 2.2 },
  bollardOffset: 3.35,
  shopDepth: 10,
  shopMaxLength: 22,
  shopHeight: 4.4,
  bayLength: 8,
  bayHeight: 5,
  dumpster: { along: 2, across: 1.2, height: 1.4 },
  /** The pylon: its planter base is the footprint; the sign slab stands on it, `slab` wide. */
  pylon: { width: 4.4, thick: 1.6, height: 9.6, slab: 3.4, slabThick: 0.8, base: 0.45 },
  edgeWall: 0.8,
} as const;

/** A box on the ground, square to the world. */
export interface GasBox extends Rect {
  y0: number;
  y1: number;
}

export interface GasFrame {
  /** Unit vector along the front, toward the corner street. */
  ax: number;
  az: number;
  /** Unit vector from the front edge into the lot. */
  dx: number;
  dz: number;
  /** The middle of the front edge. */
  ox: number;
  oz: number;
  /** The lot's length along the front and its depth. */
  length: number;
  depth: number;
}

export interface GasStationParts {
  frame: GasFrame;
  canopy: GasBox;
  /** Centre of the canopy in the frame. */
  canopyU: number;
  canopyV: number;
  canopyLength: number;
  islands: Array<{ u: number; v: number; box: GasBox }>;
  columns: GasBox[];
  pumps: Array<{ u: number; v: number; box: GasBox }>;
  bollards: Array<{ x: number; z: number }>;
  shop: GasBox;
  shopU: number;
  shopV: number;
  shopLength: number;
  bay: GasBox | null;
  bayU: number;
  dumpster: GasBox;
  pylon: GasBox;
  pylonU: number;
  pylonV: number;
  /** The lot's sides that are not streets: a low wall on the lot's line. */
  edges: Array<{ side: MeetSide; ax: number; az: number; bx: number; bz: number }>;
}

/** Outward unit normal of a lot side. */
function outward(side: MeetSide): { x: number; z: number } {
  return side === 'n' ? { x: 0, z: -1 } : side === 's' ? { x: 0, z: 1 } : side === 'e' ? { x: 1, z: 0 } : { x: -1, z: 0 };
}

export function stationFrame(s: GasStationSpec): GasFrame {
  return lotFrame(s);
}

/**
 * The frame of any corner lot with a front street and a corner street across it: a station's,
 * and the garage's (`garage.ts`), which is laid out the same way.
 */
export function lotFrame(s: { tag: string; lot: Rect; front: MeetSide; corner: MeetSide }): GasFrame {
  const { lot } = s;
  const n = outward(s.front);
  const a = outward(s.corner);
  if (n.x * a.x + n.z * a.z !== 0) throw new Error(`${s.tag}: the corner street has to run across the front one`);
  const cx = (lot.minX + lot.maxX) / 2;
  const cz = (lot.minZ + lot.maxZ) / 2;
  const w = lot.maxX - lot.minX;
  const d = lot.maxZ - lot.minZ;
  const depth = n.x !== 0 ? w : d;
  return { ax: a.x, az: a.z, dx: -n.x, dz: -n.z, ox: cx + n.x * (depth / 2), oz: cz + n.z * (depth / 2), length: n.x !== 0 ? d : w, depth };
}

/** A point of the frame in the world. */
export function frameAt(f: GasFrame, u: number, v: number): { x: number; z: number } {
  return { x: f.ox + f.ax * u + f.dx * v, z: f.oz + f.az * u + f.dz * v };
}

/** A box of the frame, centred on (u, v), `lu` along the front and `lv` deep, in the world. */
export function frameBox(f: GasFrame, u: number, v: number, lu: number, lv: number, y0: number, y1: number): GasBox {
  const c = frameAt(f, u, v);
  const hx = (Math.abs(f.ax) * lu + Math.abs(f.dx) * lv) / 2;
  const hz = (Math.abs(f.az) * lu + Math.abs(f.dz) * lv) / 2;
  return { minX: c.x - hx, maxX: c.x + hx, minZ: c.z - hz, maxZ: c.z + hz, y0, y1 };
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Where everything on a station's lot stands. */
export function stationParts(s: GasStationSpec): GasStationParts {
  const f = stationFrame(s);
  const L = f.length;
  const D = f.depth;
  const P = GAS.pump;

  // The canopy: toward the front, a little off the pylon's corner so the sign stands clear of it.
  const canopyLength = Math.min(GAS.canopyMaxLength, L - 16);
  const canopyU = clamp(-3, -L / 2 + 4 + canopyLength / 2, L / 2 - 8 - canopyLength / 2);
  const canopyV = GAS.frontMargin + GAS.canopyDepth / 2;
  const canopy = frameBox(f, canopyU, canopyV, canopyLength, GAS.canopyDepth, GAS.canopyY, GAS.canopyY + GAS.canopyThick);

  // Islands down the depth of the canopy, a column in the middle of each and a pump either side of it.
  const count = Math.max(2, Math.floor(canopyLength / GAS.islandSpacing));
  const islands: GasStationParts['islands'] = [];
  const columns: GasBox[] = [];
  const pumps: GasStationParts['pumps'] = [];
  const bollards: GasStationParts['bollards'] = [];
  for (let i = 0; i < count; i++) {
    const u = canopyU - canopyLength / 2 + (canopyLength / count) * (i + 0.5);
    islands.push({ u, v: canopyV, box: frameBox(f, u, canopyV, GAS.islandWidth, GAS.islandLength, 0, GAS.islandHeight) });
    columns.push(frameBox(f, u, canopyV, GAS.column, GAS.column, 0, GAS.canopyY));
    for (const side of [-1, 1]) {
      const v = canopyV + side * P.offset;
      pumps.push({ u, v, box: frameBox(f, u, v, P.across, P.along, GAS.islandHeight, GAS.islandHeight + P.height) });
      bollards.push(frameAt(f, u, canopyV + side * GAS.bollardOffset));
    }
  }

  // The shop across the back, from the far corner; the service bay beside it when there is room.
  const shopLength = Math.min(GAS.shopMaxLength, L - 20);
  const shopU = -L / 2 + 1.5 + shopLength / 2;
  const shopV = D - 1 - GAS.shopDepth / 2;
  const shop = frameBox(f, shopU, shopV, shopLength, GAS.shopDepth, 0, GAS.shopHeight);
  const bayU = shopU + shopLength / 2 + 0.3 + GAS.bayLength / 2;
  const bay = bayU + GAS.bayLength / 2 < L / 2 - 7 ? frameBox(f, bayU, shopV, GAS.bayLength, GAS.shopDepth, 0, GAS.bayHeight) : null;

  const dumpster = frameBox(f, L / 2 - 3.5, D - 2.2, GAS.dumpster.along, GAS.dumpster.across, 0, GAS.dumpster.height);
  const pylonU = L / 2 - 3;
  const pylonV = 3.2;
  const pylon = frameBox(f, pylonU, pylonV, GAS.pylon.width, GAS.pylon.thick, 0, GAS.pylon.height);

  const { lot } = s;
  const edges: GasStationParts['edges'] = [];
  for (const side of ['n', 's', 'e', 'w'] as const) {
    if (s.streets.includes(side)) continue;
    if (side === 'n') edges.push({ side, ax: lot.minX, az: lot.minZ, bx: lot.maxX, bz: lot.minZ });
    else if (side === 's') edges.push({ side, ax: lot.minX, az: lot.maxZ, bx: lot.maxX, bz: lot.maxZ });
    else if (side === 'w') edges.push({ side, ax: lot.minX, az: lot.minZ, bx: lot.minX, bz: lot.maxZ });
    else edges.push({ side, ax: lot.maxX, az: lot.minZ, bx: lot.maxX, bz: lot.maxZ });
  }

  return { frame: f, canopy, canopyU, canopyV, canopyLength, islands, columns, pumps, bollards, shop, shopU, shopV, shopLength, bay, bayU, dumpster, pylon, pylonU, pylonV, edges };
}

/** Everything solid on a station's lot, from the same parts the art draws. */
export function stationColliders(s: GasStationSpec): { boxes: ObstacleBox[]; walls: ObstacleWall[] } {
  const p = stationParts(s);
  const box = (b: GasBox, tag: string, maxY = b.y1): ObstacleBox => ({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, maxY, tag });
  const boxes: ObstacleBox[] = [];
  // An island is solid as high as its pumps: the kerb, the pumps and the bollards on it are one thing to hit.
  for (const i of p.islands) boxes.push(box(i.box, 'gas-island', GAS.islandHeight + GAS.pump.height));
  for (const c of p.columns) boxes.push(box(c, 'gas-column'));
  boxes.push(box(p.shop, 'gas-shop'));
  if (p.bay) boxes.push(box(p.bay, 'gas-bay'));
  boxes.push(box(p.dumpster, 'gas-dumpster'));
  boxes.push(box(p.pylon, 'gas-pylon'));
  const walls: ObstacleWall[] = p.edges.map((e) => ({ ax: e.ax, az: e.az, bx: e.bx, bz: e.bz, maxY: GAS.edgeWall, tag: 'gas-wall' }));
  return { boxes, walls };
}

/** Narrowest a plot can be cut down to and still be a plot (m); anything thinner goes to the lot's verge. */
const MIN_PLOT = 10;

/**
 * The plots the generator laid, cut back to the edge of every lot in `lots`: a plot a lot
 * overlaps keeps whatever is left of it on each side, as up to four rectangles, and drops the
 * slivers too narrow to build on.
 */
export function clipBlocksToLots(blocks: BlockRect[], lots: Rect[]): BlockRect[] {
  let out = blocks;
  for (const l of lots) {
    const next: BlockRect[] = [];
    for (const b of out) {
      // A plot that only shares an edge with the lot (to a rounding error) is left whole.
      const e = 0.5;
      if (!(b.maxX > l.minX + e && b.minX < l.maxX - e && b.maxZ > l.minZ + e && b.minZ < l.maxZ - e)) {
        next.push(b);
        continue;
      }
      const pieces: Rect[] = [
        { minX: b.minX, maxX: l.minX, minZ: b.minZ, maxZ: b.maxZ },
        { minX: l.maxX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ },
        { minX: Math.max(b.minX, l.minX), maxX: Math.min(b.maxX, l.maxX), minZ: b.minZ, maxZ: l.minZ },
        { minX: Math.max(b.minX, l.minX), maxX: Math.min(b.maxX, l.maxX), minZ: l.maxZ, maxZ: b.maxZ },
      ];
      pieces.forEach((r, k) => {
        if (r.maxX - r.minX < MIN_PLOT || r.maxZ - r.minZ < MIN_PLOT) return;
        next.push({ ...b, ...r, tag: `${b.tag}-${k}` });
      });
    }
    out = next;
  }
  return out;
}
