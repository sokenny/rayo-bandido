import type * as THREE from 'three';
import { applyTriangleUVs, type UVProjector, type UVTriangle } from './geometryKit';
import { PLATE_MOUNT } from './plate';

/**
 * THE BODY'S UV MAPPING: the paint atlas. OWNED BY agent C (`docs/GARAGE_PLAN.md` §1 point 2, §2.7).
 *
 * `applyBodyUVs` is the one function `bodyAssembler.ts` calls, and the only place body uvs are
 * set. It lays the merged body onto a 1024² canvas (`paintShop.ts` paints it) in REGIONS, one
 * decision per triangle by its mean normal (`applyTriangleUVs`):
 *
 *     canvas px (y down)             what                                projection
 *     ┌───────────────────────────┐
 *     │ LEFT FLANK      0..224    │  faces looking -X                   z → right, y → up
 *     │ RIGHT FLANK   232..456    │  faces looking +X                   z → LEFT (mirrored), y → up
 *     │ TOP           464..792    │  faces looking up: hood, roof, deck z → right, -x → down
 *     │ FRONT  | REAR    | PLATE  │  800..1024: nose (352 px wide),     x (mirrored on the nose), y
 *     │        |         |NEUT|UND│  tail (448: the chase camera's view), plate face, trim, undersides
 *     └───────────────────────────┘
 *
 * Each region is a straight orthographic projection with its own world→pixel scale, so what is
 * painted into it lands on the car undistorted, in METRES: a painter draws in world coordinates
 * through `PaintFrame` and never thinks in pixels. The right flank runs nose-to-the-right so a
 * canvas painted non-mirrored reads correctly from EITHER side of the car (text, kanji, numbers);
 * a shape that must point backwards (a flame) is simply drawn in world z and comes out pointing
 * backwards on both sides, because both flanks are projected from the same world coordinates.
 * A vinyl on the flank can never reach the roof: an up-facing triangle goes to TOP whatever it
 * is next to. The regions are separated by 8 px gutters that the painters also fill, so mipmaps
 * never bleed one region's colour into another's.
 *
 * The plate's face (the triangles lying flat on `PLATE_MOUNT`'s front face) maps onto the PLATE
 * cell, which `plate.ts` `drawPlate` paints; the rest of the plate's geometry (its edges, frames,
 * bolts) maps onto the NEUTRAL cell, painted white, so those keep their vertex colour. Faces
 * looking down go to UNDER, the base paint shaded dark.
 */

export const ATLAS_SIZE = 1024;

/** A rectangle of the atlas canvas, in pixels, y down. */
export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Axis = 'x' | 'y' | 'z';
export type FrameId = 'left' | 'right' | 'top' | 'front' | 'rear';

/** One linear world axis → canvas axis: world value `from` lands on the rect's near edge, `to` on its far edge. */
export interface FrameAxis {
  axis: Axis;
  from: number;
  to: number;
}

/**
 * One projected region. A painter's coordinates in it are (P, Q) = (world[p.axis],
 * world[q.axis]) in metres: (z, y) on the flanks, (z, x) on the top, (x, y) nose and tail.
 */
export interface PaintFrame {
  id: FrameId;
  rect: AtlasRect;
  /** Canvas x. */
  p: FrameAxis;
  /** Canvas y (down). */
  q: FrameAxis;
  /**
   * The top region lies on its side: seen from behind the car, the viewer's "up" (toward the
   * nose) is the canvas's left. The other regions are upright as the viewer sees them.
   */
  rotated: boolean;
}

/* The world box every region covers, a little past the stock body (x ±1.08, y 0.07..1.33,
 * z -2.26..2.24) so a wider kit or a longer bumper from the workshop still lands inside; a
 * vertex past it is clamped to the region's edge (it takes the edge's paint, nothing worse). */
const Z_FROM = -2.4;
const Z_TO = 2.4;
const Y_TOP = 1.36;
const Y_BOTTOM = 0.06;
const X_HALF = 1.15;

export const PAINT_FRAMES: Readonly<Record<FrameId, PaintFrame>> = {
  left: {
    id: 'left',
    rect: { x: 0, y: 0, w: 1024, h: 224 },
    p: { axis: 'z', from: Z_FROM, to: Z_TO },
    q: { axis: 'y', from: Y_TOP, to: Y_BOTTOM },
    rotated: false,
  },
  right: {
    id: 'right',
    rect: { x: 0, y: 232, w: 1024, h: 224 },
    p: { axis: 'z', from: Z_TO, to: Z_FROM },
    q: { axis: 'y', from: Y_TOP, to: Y_BOTTOM },
    rotated: false,
  },
  top: {
    id: 'top',
    rect: { x: 0, y: 464, w: 1024, h: 328 },
    p: { axis: 'z', from: Z_FROM, to: Z_TO },
    q: { axis: 'x', from: X_HALF, to: -X_HALF },
    rotated: true,
  },
  front: {
    id: 'front',
    rect: { x: 0, y: 800, w: 352, h: 224 },
    // Seen from ahead of the car, the car's right (+X) is on the viewer's left.
    p: { axis: 'x', from: X_HALF, to: -X_HALF },
    q: { axis: 'y', from: Y_TOP, to: Y_BOTTOM },
    rotated: false,
  },
  rear: {
    id: 'rear',
    rect: { x: 360, y: 800, w: 448, h: 224 },
    p: { axis: 'x', from: -X_HALF, to: X_HALF },
    q: { axis: 'y', from: Y_TOP, to: Y_BOTTOM },
    rotated: false,
  },
};

export const FRAME_IDS: readonly FrameId[] = ['left', 'right', 'top', 'front', 'rear'];

/** The plate's face. Same shape as the plate (0.46 × 0.15 m ≈ 3.07:1). */
export const PLATE_CELL: AtlasRect = { x: 816, y: 800, w: 208, h: 68 };
/** Painted white: plate edges, frames and bolts keep their own vertex colour. */
export const NEUTRAL_CELL: AtlasRect = { x: 816, y: 876, w: 100, h: 148 };
/** Faces looking down: the base paint in shadow. */
export const UNDER_CELL: AtlasRect = { x: 924, y: 876, w: 100, h: 148 };

/** Pixels a frame's painting spills past its rect into the gutter (half the 8 px gutter). */
export const GUTTER = 4;

/** Canvas pixel of painter coordinate (P, Q) in `frame`. */
export function frameToCanvas(frame: PaintFrame, P: number, Q: number, out: { x: number; y: number }): { x: number; y: number } {
  const r = frame.rect;
  out.x = r.x + ((P - frame.p.from) / (frame.p.to - frame.p.from)) * r.w;
  out.y = r.y + ((Q - frame.q.from) / (frame.q.to - frame.q.from)) * r.h;
  return out;
}

/** Pixels per metre along the frame's canvas x and y (always positive). */
export function frameScale(frame: PaintFrame): { sx: number; sy: number } {
  return {
    sx: frame.rect.w / Math.abs(frame.p.to - frame.p.from),
    sy: frame.rect.h / Math.abs(frame.q.to - frame.q.from),
  };
}

const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

/** A projector into `rect`, clamped one pixel inside it so no vertex samples a neighbour. */
function rectProjector(rect: AtlasRect, p: FrameAxis, q: FrameAxis): UVProjector {
  const pi = AXIS_INDEX[p.axis];
  const qi = AXIS_INDEX[q.axis];
  const xyz = [0, 0, 0];
  const x0 = rect.x + 1;
  const x1 = rect.x + rect.w - 1;
  const y0 = rect.y + 1;
  const y1 = rect.y + rect.h - 1;
  return (x, y, z, out) => {
    xyz[0] = x;
    xyz[1] = y;
    xyz[2] = z;
    let cx = rect.x + ((xyz[pi] - p.from) / (p.to - p.from)) * rect.w;
    let cy = rect.y + ((xyz[qi] - q.from) / (q.to - q.from)) * rect.h;
    cx = cx < x0 ? x0 : cx > x1 ? x1 : cx;
    cy = cy < y0 ? y0 : cy > y1 ? y1 : cy;
    out[0] = cx / ATLAS_SIZE;
    out[1] = 1 - cy / ATLAS_SIZE;
  };
}

function constantProjector(rect: AtlasRect): UVProjector {
  const u = (rect.x + rect.w / 2) / ATLAS_SIZE;
  const v = 1 - (rect.y + rect.h / 2) / ATLAS_SIZE;
  return (_x, _y, _z, out) => {
    out[0] = u;
    out[1] = v;
  };
}

const PROJECT: Readonly<Record<FrameId, UVProjector>> = {
  left: rectProjector(PAINT_FRAMES.left.rect, PAINT_FRAMES.left.p, PAINT_FRAMES.left.q),
  right: rectProjector(PAINT_FRAMES.right.rect, PAINT_FRAMES.right.p, PAINT_FRAMES.right.q),
  top: rectProjector(PAINT_FRAMES.top.rect, PAINT_FRAMES.top.p, PAINT_FRAMES.top.q),
  front: rectProjector(PAINT_FRAMES.front.rect, PAINT_FRAMES.front.p, PAINT_FRAMES.front.q),
  rear: rectProjector(PAINT_FRAMES.rear.rect, PAINT_FRAMES.rear.p, PAINT_FRAMES.rear.q),
};

/** The plate face fills the plate cell edge to edge. */
const PLATE_FACE_Z = PLATE_MOUNT.z + PLATE_MOUNT.depth / 2;
const PROJECT_PLATE = rectProjector(
  PLATE_CELL,
  { axis: 'x', from: PLATE_MOUNT.x - PLATE_MOUNT.width / 2, to: PLATE_MOUNT.x + PLATE_MOUNT.width / 2 },
  { axis: 'y', from: PLATE_MOUNT.y + PLATE_MOUNT.height / 2, to: PLATE_MOUNT.y - PLATE_MOUNT.height / 2 },
);
const PROJECT_NEUTRAL = constantProjector(NEUTRAL_CELL);
const PROJECT_UNDER = constantProjector(UNDER_CELL);

/** How far the plate's trim (frames, bolts) may reach around the mount and still count as plate. */
const PLATE_TRIM = 0.045;
const EPS = 0.003;

/** Which part of the atlas a triangle belongs to. Exported for the tests. */
export type BodyRegion = FrameId | 'plate' | 'neutral' | 'under';

export function classifyTriangle(t: UVTriangle): BodyRegion {
  const m = PLATE_MOUNT;
  const hw = m.width / 2;
  const hh = m.height / 2;
  // The plate first: small triangles inside the mount's envelope.
  const inTrim =
    t.minX >= m.x - hw - PLATE_TRIM &&
    t.maxX <= m.x + hw + PLATE_TRIM &&
    t.minY >= m.y - hh - PLATE_TRIM &&
    t.maxY <= m.y + hh + PLATE_TRIM &&
    t.minZ >= m.z - m.depth / 2 - PLATE_TRIM / 2 &&
    t.maxZ <= m.z + m.depth / 2 + PLATE_TRIM;
  if (inTrim) {
    const onFace =
      t.nz > 0.9 &&
      Math.abs(t.minZ - PLATE_FACE_Z) < EPS &&
      Math.abs(t.maxZ - PLATE_FACE_Z) < EPS &&
      t.minX >= m.x - hw - EPS &&
      t.maxX <= m.x + hw + EPS &&
      t.minY >= m.y - hh - EPS &&
      t.maxY <= m.y + hh + EPS;
    return onFace ? 'plate' : 'neutral';
  }
  const ax = Math.abs(t.nx);
  const ay = Math.abs(t.ny);
  const az = Math.abs(t.nz);
  if (ay >= ax && ay >= az) return t.ny >= 0 ? 'top' : 'under';
  if (ax >= az) return t.nx < 0 ? 'left' : 'right';
  return t.nz < 0 ? 'front' : 'rear';
}

function projectorOf(region: BodyRegion): UVProjector {
  switch (region) {
    case 'plate':
      return PROJECT_PLATE;
    case 'neutral':
      return PROJECT_NEUTRAL;
    case 'under':
      return PROJECT_UNDER;
    default:
      return PROJECT[region];
  }
}

export function applyBodyUVs(geometry: THREE.BufferGeometry): void {
  applyTriangleUVs(geometry, (t) => projectorOf(classifyTriangle(t)));
}
