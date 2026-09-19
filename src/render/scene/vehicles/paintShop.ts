import * as THREE from 'three';
import { STOCK_LOADOUT, type CarLoadout, type DecalZone, type PaintFinish, type PartId } from '../../../core/loadout';
import { findColor } from '../../../content/carParts';
import {
  ATLAS_SIZE,
  FRAME_IDS,
  GUTTER,
  NEUTRAL_CELL,
  PAINT_FRAMES,
  PLATE_CELL,
  UNDER_CELL,
  frameScale,
  frameToCanvas,
  type FrameId,
  type PaintFrame,
} from './bodyUVs';
import { drawPlate } from './plate';
import { LIVERY_SIZE, drawLivery, liveryPaletteFor } from './livery';
import { graffitiAspect, graffitiCell, makeGraffitiAtlas, type GraffitiAtlas } from '../env/graffiti';

/**
 * THE PAINT SHOP: base colour × finish → vinyls → decals → plate, composed into the body's map.
 * OWNED BY agent C (`docs/GARAGE_PLAN.md` §2.7).
 *
 * ONE 1024² CANVAS for the life of the car, laid out by `bodyUVs.ts` (left flank, right flank,
 * top, nose, tail, plate cell). `compose` paints it in this order:
 *   1. the base colour everywhere (lifted toward silver for `chrome`, which mirrors its albedo);
 *   2. the roof colour over the greenhouse, if `paint.roof` asks for a two-tone;
 *   3. up to four vinyl layers, bottom first, each a procedural painter tinted by its colour;
 *   4. the decals, each in its fixed `DecalZone` box;
 *   5. the plate face (`plate.ts` `drawPlate`), the white trim cell and the dark underside cell.
 *
 * PAINTERS DRAW IN METRES. Each region is an orthographic projection of the car, so a painter is
 * handed the canvas already transformed to world coordinates — (z, y) on a flank, (z, x) on the
 * top, (x, y) on the nose and tail — and draws the shape where it goes on the car. Both flanks are
 * the same world coordinates, so a vinyl comes out symmetric and a flame points backwards on
 * both sides; text goes through `upright()`, which undoes the mirroring and the top region's
 * quarter turn so it reads the right way from the side it is meant to be read from.
 *
 * WHAT THE MATERIAL GETS. The paint lives in the canvas, so `material.color` stays WHITE — that is
 * the CLEAN paint `CarVisual` reads back and darkens for crash grime — and the finish goes into
 * the `MeshPhysicalMaterial`'s own parameters (`FINISH_PARAMS`): metalness, roughness, clearcoat,
 * and thin-film `iridescence` for pearl. `metallic` is exactly what the car was built with.
 *
 * COST. `compose` runs only when the paint actually changed (`paintKey`), in the workshop, and
 * repaints the one canvas in place (`needsUpdate`): no texture is ever replaced, so the material
 * never recompiles for a new map. The one exception to "nothing async": the graffiti art
 * (`env/graffiti.ts`'s atlas, shared, loaded on first use) arrives a moment later and repaints
 * the cars that wear a graffiti decal once. Nothing here runs per frame.
 *
 * WITHOUT A DOM (unit tests) `texture` is null exactly like the old `livery.ts` path: the body
 * keeps its flat vertex-coloured paint, and `apply` only sets the finish parameters.
 *
 * Created only for the single-player car: in a match the body is the slot colour (D3) and
 * `CarVisual` never creates a paint shop.
 */
export interface CarPaint {
  readonly texture: THREE.CanvasTexture | null;
  apply(loadout: CarLoadout, material: THREE.MeshPhysicalMaterial): void;
  dispose(): void;
}

/* ================================================================== finishes */

export interface FinishParams {
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  /** Thin-film strength, 0..1. Only pearl has any. */
  iridescence: number;
  iridescenceIOR: number;
  iridescenceThicknessRange: [number, number];
  /** How far the base colour is lifted toward silver in the canvas (chrome reflects its albedo). */
  lift: number;
  /** How hard the paint reflects `carPaintEnv` (the car is built at 2.3). */
  envMapIntensity: number;
}

export const FINISH_PARAMS: Readonly<Record<PaintFinish, FinishParams>> = {
  gloss: { metalness: 0.08, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04, iridescence: 0, iridescenceIOR: 1.3, iridescenceThicknessRange: [100, 400], lift: 0, envMapIntensity: 2.3 },
  // The car as it has always been built (`carVisual.ts`): the stock finish changes nothing.
  metallic: { metalness: 0.62, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0, iridescenceIOR: 1.3, iridescenceThicknessRange: [100, 400], lift: 0, envMapIntensity: 2.3 },
  pearl: { metalness: 0.4, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [260, 640], lift: 0.06, envMapIntensity: 2.3 },
  matte: { metalness: 0.12, roughness: 0.82, clearcoat: 0, clearcoatRoughness: 0.5, iridescence: 0, iridescenceIOR: 1.3, iridescenceThicknessRange: [100, 400], lift: 0, envMapIntensity: 1.6 },
  chrome: { metalness: 0.9, roughness: 0.12, clearcoat: 0.5, clearcoatRoughness: 0.03, iridescence: 0, iridescenceIOR: 1.3, iridescenceThicknessRange: [100, 400], lift: 0.35, envMapIntensity: 3.4 },
};

/** The finish onto the material. Never touches its colour, maps or emissive. */
export function applyFinish(material: THREE.MeshPhysicalMaterial, finish: PaintFinish): void {
  const f = FINISH_PARAMS[finish] ?? FINISH_PARAMS.metallic;
  material.metalness = f.metalness;
  material.roughness = f.roughness;
  material.clearcoat = f.clearcoat;
  material.clearcoatRoughness = f.clearcoatRoughness;
  material.iridescence = f.iridescence;
  material.iridescenceIOR = f.iridescenceIOR;
  material.iridescenceThicknessRange[0] = f.iridescenceThicknessRange[0];
  material.iridescenceThicknessRange[1] = f.iridescenceThicknessRange[1];
  material.envMapIntensity = f.envMapIntensity;
}

/* ================================================================== colour */

function hexOf(id: string | undefined, fallback: string): string {
  return findColor(id)?.hex ?? fallback;
}

/** `a` → `b` by `t`, as `#rrggbb`. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number): number => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Tiny deterministic PRNG: a painter draws the same thing on every machine, every time. */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ================================================================== frames */

type Ctx = CanvasRenderingContext2D;
type Pt = readonly [number, number];

/** Everything a painter may want besides its own colour. */
interface PaintEnv {
  /** The body colour as painted (after the finish's lift). */
  base: string;
}

/** Clip to `frame`'s rect (plus its half of the gutter) and put the canvas in its world metres. */
function enterFrame(ctx: Ctx, frame: PaintFrame): void {
  const r = frame.rect;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x - GUTTER, r.y - GUTTER, r.w + GUTTER * 2, r.h + GUTTER * 2);
  ctx.clip();
  const a = r.w / (frame.p.to - frame.p.from);
  const d = r.h / (frame.q.to - frame.q.from);
  ctx.setTransform(a, 0, 0, d, r.x - frame.p.from * a, r.y - frame.q.from * d);
}

/** Which side of the car a piece of upright text is read from. Only matters on the top. */
type ReadFrom = 'rear' | 'front';

const TMP_PT = { x: 0, y: 0 };

/**
 * Run `draw` in an upright, un-mirrored MILLIMETRE space centred on world point (P, Q) of
 * `frame`: +x is the viewer's right, +y their down, as seen from beside the car (flanks), from
 * ahead or behind (nose, tail), or from `read` (top). Text drawn here reads correctly. Millimetres
 * rather than metres so font sizes stay in the tens of pixels, where every browser rasterizes
 * them properly.
 */
function upright(ctx: Ctx, frame: PaintFrame, P: number, Q: number, read: ReadFrom, draw: () => void): void {
  const { sx, sy } = frameScale(frame);
  const c = frameToCanvas(frame, P, Q, TMP_PT);
  const k = 1 / 1000;
  ctx.save();
  if (!frame.rotated) ctx.setTransform(sx * k, 0, 0, sy * k, c.x, c.y);
  // Top region: canvas x runs nose → tail (P = z), canvas y runs +x → -x. Read from behind, the
  // viewer's right is +x (canvas up) and their down is +z (canvas right); from ahead, both flip.
  else if (read === 'rear') ctx.setTransform(0, -sy * k, sx * k, 0, c.x, c.y);
  else ctx.setTransform(0, sy * k, -sx * k, 0, c.x, c.y);
  draw();
  ctx.restore();
}

/* ================================================================== drawing kit */

function poly(ctx: Ctx, pts: readonly Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/**
 * A polyline thickened into a polygon, its width running from `w0` at the first point to `w1`
 * at the last: a bolt, a spike, a tapering stroke.
 */
function taperedPath(ctx: Ctx, pts: readonly Pt[], w0: number, w1: number): void {
  const n = pts.length;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    left.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
    right.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  poly(ctx, [...left, ...right.reverse()]);
}

/**
 * One flame tongue in (along, across) coordinates: from a base `w` wide at `a0`, licking
 * `len` along and curling `curl` across at the tip.
 */
function tongue(ctx: Ctx, a0: number, b0: number, len: number, w: number, curl: number): void {
  ctx.beginPath();
  ctx.moveTo(a0, b0 + w / 2);
  ctx.bezierCurveTo(a0 + len * 0.45, b0 + w * 0.55 + curl * 0.2, a0 + len * 0.75, b0 + curl + w * 0.1, a0 + len, b0 + curl + w * 0.3);
  ctx.bezierCurveTo(a0 + len * 0.72, b0 + curl - w * 0.2, a0 + len * 0.42, b0 - w * 0.62 + curl * 0.1, a0, b0 - w / 2);
  ctx.closePath();
}

/* ================================================================== vinyls */

/** A vinyl paints one region of the atlas, already in that region's world metres. */
export type VinylPainter = (ctx: Ctx, frame: PaintFrame, color: string, env: PaintEnv) => void;

/*
 * Reference numbers of the stock body the painters line up against (`vehicles/parts/`): nose
 * z ≈ -2.26, tail z ≈ 2.24; the hull's flank runs y ≈ 0.12..0.89 between the arches; wheel
 * centres at z = ±1.3, y = 0.33, arches out to r ≈ 0.47; greenhouse z -0.74..1.58, |x| < 0.78;
 * the roof z -0.06..0.62 at y 1.3.
 */

/** The body box the old lengthwise uvs were normalized to: the stock body's bounds. */
const LIVERY_BOX = { minX: -1.07759, maxX: 1.07759, minY: 0.07, maxY: 1.33, minZ: -2.26, maxZ: 2.24 } as const;

/** One shard canvas per colour, drawn on first use. Small, few, and never GPU resources. */
const liveryCache = new Map<string, HTMLCanvasElement>();

function liveryCanvas(hex: string): HTMLCanvasElement | null {
  const hit = liveryCache.get(hex);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = LIVERY_SIZE;
  cv.height = LIVERY_SIZE;
  const c = cv.getContext('2d');
  if (!c) return null;
  drawLivery(c, liveryPaletteFor(hex), null);
  if (liveryCache.size >= 8) liveryCache.delete(liveryCache.keys().next().value as string);
  liveryCache.set(hex, cv);
  return cv;
}

/**
 * `vinyls.rayo`, the stock livery. The shards are the pre-workshop 512² canvas, laid onto each
 * region with exactly the projection the old lengthwise uvs gave that face — (z, y) on the flanks,
 * (z, x) on the top, (x, y) nose and tail, all over the stock body's box — so the stock car wears
 * the same livery it always did, now through the atlas.
 */
const rayo: VinylPainter = (ctx, frame, color) => {
  const img = liveryCanvas(color);
  if (!img) return;
  const B = LIVERY_BOX;
  const s = 1 / LIVERY_SIZE;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (frame.id === 'top') {
    ctx.translate(B.minZ, B.maxX);
    ctx.scale((B.maxZ - B.minZ) * s, -(B.maxX - B.minX) * s);
  } else if (frame.id === 'left' || frame.id === 'right') {
    ctx.translate(B.minZ, B.maxY);
    ctx.scale((B.maxZ - B.minZ) * s, -(B.maxY - B.minY) * s);
  } else {
    ctx.translate(B.minX, B.maxY);
    ctx.scale((B.maxX - B.minX) * s, -(B.maxY - B.minY) * s);
  }
  // A 1-texel overdraw all round, so the edges of the old texture's clamp are there too.
  ctx.drawImage(img, -1, -1, LIVERY_SIZE + 2, LIVERY_SIZE + 2);
  ctx.restore();
};

/** A lightning bolt along `pts`: halo, body, hot core. */
function bolt(ctx: Ctx, pts: readonly Pt[], w0: number, w1: number, color: string): void {
  ctx.lineJoin = 'miter';
  taperedPath(ctx, pts, w0 * 1.9, w1 * 1.9 + 0.01);
  ctx.fillStyle = rgba(color, 0.28);
  ctx.fill();
  taperedPath(ctx, pts, w0, w1);
  ctx.fillStyle = color;
  ctx.fill();
  taperedPath(ctx, pts.slice(0, -1), w0 * 0.28, w1 * 0.28 + 0.004);
  ctx.fillStyle = rgba(mixHex(color, '#ffffff', 0.8), 0.9);
  ctx.fill();
}

const bolts: VinylPainter = (ctx, frame, color) => {
  if (frame.id === 'left' || frame.id === 'right') {
    // (z, y): from behind the front arch to the tail, with the classic back-steps.
    bolt(ctx, [[-1.95, 0.66], [-0.95, 0.7], [-0.82, 0.52], [0.02, 0.6], [0.14, 0.44], [1.0, 0.54], [1.1, 0.4], [2.2, 0.47]], 0.13, 0.02, color);
    bolt(ctx, [[0.1, 0.46], [0.55, 0.3], [0.62, 0.36], [1.25, 0.2]], 0.05, 0.01, color);
  } else if (frame.id === 'top') {
    // (z, x): a pair down the hood, one each side of the centre line.
    for (const s of [-1, 1]) {
      bolt(ctx, [[-2.15, 0.34 * s], [-1.7, 0.46 * s], [-1.62, 0.33 * s], [-1.05, 0.44 * s], [-0.98, 0.36 * s], [-0.72, 0.42 * s]], 0.1, 0.015, color);
    }
  }
};

/**
 * A claw: a curved spike from a `baseW`-wide root at `base` to a point at `tip`, both edges
 * bowing `bend` metres the same way (to the left of base → tip; negative bows right), so it
 * hooks like a thorn. The unit of the tribal.
 */
function claw(ctx: Ctx, base: Pt, tip: Pt, baseW: number, bend: number): void {
  const dx = tip[0] - base[0];
  const dy = tip[1] - base[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const hw = baseW / 2;
  const a: Pt = [base[0] + nx * hw, base[1] + ny * hw];
  const b: Pt = [base[0] - nx * hw, base[1] - ny * hw];
  const m1: Pt = [(a[0] + tip[0]) / 2 + nx * bend * 2, (a[1] + tip[1]) / 2 + ny * bend * 2];
  const m2: Pt = [(b[0] + tip[0]) / 2 + nx * bend * 1.3, (b[1] + tip[1]) / 2 + ny * bend * 1.3];
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.quadraticCurveTo(m1[0], m1[1], tip[0], tip[1]);
  ctx.quadraticCurveTo(m2[0], m2[1], b[0], b[1]);
  ctx.closePath();
}

const tribal: VinylPainter = (ctx, frame, color) => {
  const edge = mixHex(color, '#000000', 0.5);
  const draw = (claws: ReadonlyArray<readonly [Pt, Pt, number, number]>): void => {
    ctx.lineJoin = 'miter';
    // A dark keyline first, a little fatter than the shapes, then the shapes over it.
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.022;
    for (const [base, tip, w, bend] of claws) {
      claw(ctx, base, tip, w, bend);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    for (const [base, tip, w, bend] of claws) {
      claw(ctx, base, tip, w, bend);
      ctx.fill();
    }
  };
  if (frame.id === 'left' || frame.id === 'right') {
    // (z, y): a spine from behind the front wheel sagging back to the tail, claws raking off it
    // up and back, a few down and back, and a hook curling forward over the front arch.
    const z0 = -0.95;
    const z1 = 2.2;
    const spineY = (z: number): number => {
      const t = (z - z0) / (z1 - z0);
      return 0.44 + 0.3 * t - 0.5 * t * (1 - t);
    };
    const up = (z: number, len: number, rise: number, w: number): readonly [Pt, Pt, number, number] => [[z, spineY(z) + w * 0.2], [z + len, spineY(z) + rise], w, 0.07];
    const down = (z: number, len: number, drop: number, w: number): readonly [Pt, Pt, number, number] => [[z, spineY(z) - w * 0.2], [z + len, spineY(z) - drop], w, -0.05];
    draw([
      [[z0, 0.44], [z1, 0.74], 0.26, -0.06],
      [[-0.8, 0.46], [-1.62, 0.84], 0.2, -0.1],
      [[-0.9, 0.4], [-1.5, 0.2], 0.12, 0.05],
      up(-0.55, 0.7, 0.36, 0.2),
      up(0.05, 0.75, 0.42, 0.18),
      up(0.65, 0.7, 0.44, 0.15),
      up(1.2, 0.62, 0.36, 0.12),
      down(-0.35, 0.95, 0.24, 0.14),
      down(0.45, 0.95, 0.22, 0.12),
      down(1.25, 0.8, 0.16, 0.1),
    ]);
  } else if (frame.id === 'top') {
    // (z, x): mirrored claws fanning back from a point at the nose over the hood.
    const claws: Array<readonly [Pt, Pt, number, number]> = [];
    for (const s of [-1, 1]) {
      claws.push(
        [[-2.2, 0.0], [-0.8, 0.62 * s], 0.34, 0.1 * s],
        [[-1.85, 0.24 * s], [-1.15, 0.78 * s], 0.16, 0.06 * s],
        [[-1.55, 0.36 * s], [-0.95, 0.86 * s], 0.12, 0.05 * s],
        [[-2.0, 0.08 * s], [-1.2, 0.1 * s], 0.12, -0.05 * s],
      );
    }
    draw(claws);
  }
};

/** A field of flame tongues licking along +P from `a0`, in (along, across) = (P, Q). */
function flameField(ctx: Ctx, color: string, a0: number, bMin: number, bMax: number, count: number, lenMin: number, lenMax: number, seed: number): void {
  const rand = makeRandom(seed);
  const tongues: Array<[number, number, number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const b = bMin + (bMax - bMin) * t;
    // Longest through the middle, like a real flame job.
    const mid = 1 - Math.abs(t - 0.5) * 1.3;
    const len = lenMin + (lenMax - lenMin) * Math.max(0.15, mid) * (0.75 + rand() * 0.25);
    const w = ((bMax - bMin) / count) * (1.5 + rand() * 0.5);
    const curl = (rand() - 0.35) * w * 1.1;
    tongues.push([b, len, w, curl, rand()]);
  }
  const rim = mixHex(color, '#ffe7a0', 0.6);
  const hot = mixHex(color, '#fff6c8', 0.7);
  // The rim first, under everything: a light outline round the whole job.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rim;
  ctx.lineWidth = 0.028;
  for (const [b, len, w, curl] of tongues) {
    tongue(ctx, a0, b, len, w, curl);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  for (const [b, len, w, curl] of tongues) {
    tongue(ctx, a0, b, len, w, curl);
    ctx.fill();
  }
  ctx.fillStyle = rgba(hot, 0.85);
  for (const [b, len, w, curl, r] of tongues) {
    if (r < 0.3) continue;
    tongue(ctx, a0, b + w * 0.05, len * 0.55, w * 0.42, curl * 0.6);
    ctx.fill();
  }
}

const flames: VinylPainter = (ctx, frame, color) => {
  if (frame.id === 'left' || frame.id === 'right') {
    ctx.fillStyle = color;
    ctx.fillRect(-2.5, 0.14, 0.62, 0.74);
    flameField(ctx, color, -1.95, 0.24, 0.8, 7, 0.7, 2.1, 0xf1a3e);
  } else if (frame.id === 'top') {
    flameField(ctx, color, -2.14, -0.72, 0.72, 9, 0.35, 1.25, 0x70b5);
  } else if (frame.id === 'front') {
    // The nose above the splitter (which would only turn a dark red under it).
    ctx.fillStyle = color;
    ctx.fillRect(-1.3, 0.27, 2.6, 0.56);
  }
};

const stripes: VinylPainter = (ctx, frame, color) => {
  // Twin stripes nose to tail over the top, down the nose and the tail. Across = x in all three.
  const bands = (draw: (x0: number, x1: number) => void): void => {
    for (const s of [-1, 1]) {
      draw(0.075 * s, 0.235 * s);
      draw(0.26 * s, 0.275 * s);
    }
  };
  ctx.fillStyle = color;
  if (frame.id === 'top') {
    // (z, x)
    bands((x0, x1) => ctx.fillRect(-2.5, Math.min(x0, x1), 5, Math.abs(x1 - x0)));
  } else if (frame.id === 'front' || frame.id === 'rear') {
    // (x, y)
    bands((x0, x1) => ctx.fillRect(Math.min(x0, x1), -0.1, Math.abs(x1 - x0), 1.6));
  }
};

const kanji: VinylPainter = (ctx, frame, color, env) => {
  if (frame.id !== 'left' && frame.id !== 'right') return;
  // (z, y): a slanted band low along the sill, the text cut out of it in the body colour.
  ctx.fillStyle = color;
  poly(ctx, [[-1.98, 0.3], [2.1, 0.3], [2.02, 0.5], [-1.9, 0.5]]);
  ctx.fill();
  ctx.fillRect(-1.8, 0.535, 3.8, 0.018);
  // Between the arches (z ±0.83), so neither wheel cuts the words.
  upright(ctx, frame, 0, 0.4, 'rear', () => {
    ctx.fillStyle = env.base;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.font = `900 170px ${JP}`;
    ctx.fillText('稲妻', -460, 10);
    ctx.textAlign = 'left';
    ctx.font = `italic 900 120px ${DISPLAY}`;
    const w = ctx.measureText('RAYO BANDIDO').width;
    ctx.save();
    ctx.translate(-400, 8);
    if (w > 1150) ctx.scale(1150 / w, 1);
    ctx.fillText('RAYO BANDIDO', 0, 0);
    ctx.restore();
  });
};

/** Circuit-board traces over a (P, Q) box: runs, 45° jogs, pads and vias. */
function traces(ctx: Ctx, color: string, p0: number, p1: number, q0: number, q1: number, count: number, seed: number): void {
  const rand = makeRandom(seed);
  const step = 0.045;
  const snap = (v: number): number => Math.round(v / step) * step;
  const runs: Pt[][] = [];
  for (let i = 0; i < count; i++) {
    let p = snap(p0 + rand() * (p1 - p0));
    let q = snap(q0 + rand() * (q1 - q0));
    const dir = rand() < 0.5 ? -1 : 1;
    const pts: Pt[] = [[p, q]];
    const segs = 2 + Math.floor(rand() * 4);
    for (let s = 0; s < segs; s++) {
      p += dir * step * (2 + Math.floor(rand() * 9));
      pts.push([p, q]);
      if (s < segs - 1) {
        const jog = step * (1 + Math.floor(rand() * 2)) * (rand() < 0.5 ? -1 : 1);
        const nq = Math.max(q0, Math.min(q1, q + jog));
        p += dir * Math.abs(nq - q);
        q = nq;
        pts.push([p, q]);
      }
    }
    runs.push(pts);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [w, style] of [
    [0.034, rgba(color, 0.22)],
    [0.012, color],
  ] as const) {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    for (const pts of runs) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
  }
  for (const pts of runs) {
    const [sp, sq] = pts[0];
    ctx.fillStyle = color;
    ctx.fillRect(sp - 0.018, sq - 0.018, 0.036, 0.036);
    const [ep, eq] = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(ep, eq, 0.02, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.01;
    ctx.stroke();
    ctx.fillStyle = mixHex(color, '#ffffff', 0.7);
    ctx.beginPath();
    ctx.arc(ep, eq, 0.007, 0, Math.PI * 2);
    ctx.fill();
  }
}

const circuit: VinylPainter = (ctx, frame, color) => {
  if (frame.id === 'left' || frame.id === 'right') traces(ctx, color, -2.0, 2.0, 0.2, 0.84, 30, 0xc1c0);
  else if (frame.id === 'top') traces(ctx, color, -2.1, 2.1, -0.82, 0.82, 44, 0x70c1);
  else traces(ctx, color, -0.7, 0.7, 0.3, 0.72, 7, frame.id === 'front' ? 0xf0 : 0xba);
};

const camo: VinylPainter = (ctx, frame, color) => {
  // Splinter camo: sharp slivers all leaning the same way, in three tones of the colour.
  const pMin = Math.min(frame.p.from, frame.p.to);
  const pMax = Math.max(frame.p.from, frame.p.to);
  const qMin = Math.min(frame.q.from, frame.q.to);
  const qMax = Math.max(frame.q.from, frame.q.to);
  // The flanks share a seed so both sides wear the same pattern; the rest get their own.
  const rand = makeRandom(frame.id === 'right' ? 0xca30 : 0xca30 + FRAME_IDS.indexOf(frame.id) * 131);
  const tones = [color, mixHex(color, '#000000', 0.5), mixHex(color, '#ffffff', 0.3)];
  const area = (pMax - pMin) * (qMax - qMin);
  const n = Math.round(area * 22);
  const lean = frame.id === 'top' ? 0.5 : -0.35;
  for (let i = 0; i < n; i++) {
    const cp = pMin + rand() * (pMax - pMin);
    const cq = qMin + rand() * (qMax - qMin);
    const len = 0.22 + rand() * 0.5;
    const wid = 0.05 + rand() * 0.14;
    const a = lean + (rand() - 0.5) * 0.35;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const at = (s: number, t: number): Pt => [cp + ux * s - uy * t, cq + uy * s + ux * t];
    poly(ctx, [
      at(-len / 2, 0),
      at(-len * 0.1, wid * (0.4 + rand() * 0.6)),
      at(len * 0.3, wid * (0.2 + rand() * 0.5)),
      at(len / 2, 0),
      at(len * 0.15, -wid * (0.3 + rand() * 0.6)),
    ]);
    const tone = rand();
    ctx.fillStyle = tones[tone < 0.45 ? 0 : tone < 0.8 ? 1 : 2];
    ctx.fill();
  }
};

/** Solid toward `pFull`, gone by `pClear`, with a halftone of dots through the change. */
function fadeAlong(ctx: Ctx, color: string, pFull: number, pClear: number, q0: number, q1: number): void {
  const g = ctx.createLinearGradient(pFull, 0, pClear, 0);
  g.addColorStop(0, rgba(color, 1));
  g.addColorStop(0.55, rgba(color, 0.35));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(Math.min(pFull, pClear) - 0.4, q0, Math.abs(pClear - pFull) + 0.8, q1 - q0);
  // Halftone: dots shrinking from the gradient's middle out to past its clear end.
  const dir = Math.sign(pClear - pFull);
  const start = pFull + (pClear - pFull) * 0.35;
  const span = Math.abs(pClear - pFull) * 1.1;
  const pitch = 0.05;
  ctx.fillStyle = color;
  for (let s = 0; s <= span; s += pitch) {
    const radius = 0.024 * (1 - s / span);
    if (radius < 0.003) break;
    const p = start + dir * s;
    let row = 0;
    for (let q = q0 + pitch / 2; q < q1; q += pitch) {
      const off = row++ % 2 ? pitch / 2 : 0;
      ctx.beginPath();
      ctx.arc(p + dir * off, q, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const fade: VinylPainter = (ctx, frame, color) => {
  if (frame.id === 'left' || frame.id === 'right') fadeAlong(ctx, color, 2.3, 0.2, 0.0, 1.42);
  else if (frame.id === 'top') fadeAlong(ctx, color, 2.3, 0.6, -1.3, 1.3);
  else if (frame.id === 'rear') {
    ctx.fillStyle = color;
    ctx.fillRect(-1.3, -0.1, 2.6, 1.6);
  }
};

/** Checker squares over a (P, Q) box, full at `pFull`, crumbling away toward `pClear`. */
function checkerAlong(ctx: Ctx, color: string, pFull: number, pClear: number, q0: number, q1: number, seed: number): void {
  const rand = makeRandom(seed);
  const s = 0.085;
  const dir = Math.sign(pClear - pFull);
  const cols = Math.ceil(Math.abs(pClear - pFull) / s);
  const rows = Math.ceil((q1 - q0) / s);
  ctx.fillStyle = color;
  for (let c = 0; c < cols; c++) {
    const t = c / cols; // 0 at the full end
    const p = pFull + dir * (c * s + s / 2);
    for (let r = 0; r < rows; r++) {
      if ((c + r) % 2) continue;
      const keep = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
      if (rand() > keep * 1.15) continue;
      const k = t < 0.35 ? 1 : Math.max(0.25, keep);
      const q = q0 + r * s + s / 2;
      ctx.fillRect(p - (s * k) / 2, q - (s * k) / 2, s * k, s * k);
    }
  }
}

const checker: VinylPainter = (ctx, frame, color) => {
  if (frame.id === 'left' || frame.id === 'right') checkerAlong(ctx, color, 2.3, -0.5, 0.14, 0.88, 0xc4ec);
  else if (frame.id === 'top') checkerAlong(ctx, color, 2.3, 0.8, -1.1, 1.1, 0x70c4);
  else if (frame.id === 'rear') checkerAlong(ctx, color, -1.2, 1.2, 0.26, 0.8, 0xbac4);
};

/** Every vinyl the paint shop draws, by part id. The catalogue must match (`tests/paintShop.test.ts`). */
export const VINYL_PAINTERS: Readonly<Record<PartId, VinylPainter>> = {
  'vinyls.rayo': rayo,
  'vinyls.bolts': bolts,
  'vinyls.tribal': tribal,
  'vinyls.flames': flames,
  'vinyls.stripes': stripes,
  'vinyls.kanji': kanji,
  'vinyls.circuit': circuit,
  'vinyls.camo': camo,
  'vinyls.fade': fade,
  'vinyls.checker': checker,
};

/* ================================================================== decals */

/**
 * Where each zone sits: the region, the world point its centre is on, how big it is (w across
 * the viewer, h down, in metres) and which side it reads from. A decal is fitted inside,
 * keeping its own shape.
 *
 * `windshield` is a sun strip across the FRONT EDGE OF THE ROOF, read from ahead: the player's
 * windscreen is a real opening onto the cabin (`greenhouse.ts`), and the glass is its own mesh
 * with no paint map, so the strip goes on the first paint above it. `hood` also reads from
 * ahead (the workshop's hood shot is a high front view); `roof` and `trunk` read from behind,
 * where the chase camera is.
 */
export interface DecalPlace {
  frame: FrameId;
  P: number;
  Q: number;
  w: number;
  h: number;
  read: ReadFrom;
}

export const DECAL_PLACES: Readonly<Record<DecalZone, DecalPlace>> = {
  hood: { frame: 'top', P: -1.74, Q: 0, w: 0.95, h: 0.42, read: 'front' },
  windshield: { frame: 'top', P: 0.035, Q: 0, w: 1.08, h: 0.17, read: 'front' },
  roof: { frame: 'top', P: 0.34, Q: 0, w: 0.88, h: 0.42, read: 'rear' },
  trunk: { frame: 'top', P: 2.0, Q: 0, w: 1.0, h: 0.2, read: 'rear' },
  sideLeft: { frame: 'left', P: 0.0, Q: 0.52, w: 1.35, h: 0.46, read: 'rear' },
  sideRight: { frame: 'right', P: 0.0, Q: 0.52, w: 1.35, h: 0.46, read: 'rear' },
  rearQuarterLeft: { frame: 'left', P: 1.74, Q: 0.66, w: 0.46, h: 0.22, read: 'rear' },
  rearQuarterRight: { frame: 'right', P: 1.74, Q: 0.66, w: 0.46, h: 0.22, read: 'rear' },
};

/**
 * A decal draws centred on (0, 0) in upright millimetres, inside `w` × `h`. It picks its own
 * size within that box (`fit`) so a sticker keeps its shape in every zone.
 */
export type DecalPainter = (ctx: Ctx, w: number, h: number) => void;

/** The largest `aspect` (w / h) box inside `w` × `h`. */
function fit(w: number, h: number, aspect: number): { w: number; h: number } {
  return w / h > aspect ? { w: h * aspect, h } : { w, h: w / aspect };
}

const DISPLAY = '"Arial Black", "Helvetica Neue", Arial, sans-serif';
const CONDENSED = 'Bahnschrift, "DIN Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const JP = '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", Meiryo, "Noto Sans JP", "Noto Sans CJK JP", sans-serif';

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Text centred at (x, y), squeezed to `maxW`, `size` px tall-ish. */
function label(ctx: Ctx, text: string, x: number, y: number, maxW: number, size: number, font: string, weight = '900', italic = false): void {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${Math.max(1, Math.round(size))}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const m = ctx.measureText(text).width;
  const k = m > maxW && m > 0 ? maxW / m : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** A small lightning-bolt glyph centred at (x, y), `h` tall. */
function boltGlyph(ctx: Ctx, x: number, y: number, h: number): void {
  const u = h / 10;
  poly(ctx, [
    [x + 1.5 * u, y - 5 * u],
    [x - 2.5 * u, y + 0.6 * u],
    [x - 0.1 * u, y + 0.6 * u],
    [x - 1.6 * u, y + 5 * u],
    [x + 2.6 * u, y - 1 * u],
    [x + 0.2 * u, y - 1 * u],
  ]);
  ctx.fill();
}

const rayoBanner: DecalPainter = (ctx, W, H) => {
  const { w, h } = fit(W, H, 6.2);
  ctx.fillStyle = 'rgba(8,9,16,0.92)';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, '#22e6ff');
  g.addColorStop(0.5, '#b8f4ff');
  g.addColorStop(1, '#ff2fd0');
  ctx.fillStyle = g;
  label(ctx, 'RAYO BANDIDO', 0, h * 0.04, w * 0.84, h * 0.74, DISPLAY, '900', true);
  ctx.fillStyle = '#ff2fd0';
  ctx.fillRect(-w / 2, h / 2 - h * 0.08, w, h * 0.08);
  ctx.fillStyle = '#22e6ff';
  ctx.fillRect(-w / 2, -h / 2, w, h * 0.06);
};

const kaminari: DecalPainter = (ctx, W, H) => {
  const { w, h } = fit(W, H, 3);
  roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.2);
  ctx.fillStyle = '#ffd400';
  ctx.fill();
  ctx.lineWidth = h * 0.06;
  ctx.strokeStyle = '#111111';
  ctx.stroke();
  ctx.fillStyle = '#111111';
  boltGlyph(ctx, -w * 0.38, 0, h * 0.8);
  label(ctx, 'KAMINARI', w * 0.06, -h * 0.1, w * 0.66, h * 0.52, DISPLAY, '900', true);
  ctx.fillStyle = '#d11a2a';
  label(ctx, 'JUICE · 雷', w * 0.1, h * 0.29, w * 0.5, h * 0.24, DISPLAY, '900');
};

const neomate: DecalPainter = (ctx, W, H) => {
  const { w, h } = fit(W, H, 3.2);
  roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.5);
  ctx.fillStyle = '#0d1a10';
  ctx.fill();
  ctx.lineWidth = h * 0.05;
  ctx.strokeStyle = '#a6ff00';
  ctx.stroke();
  // The gourd and its straw.
  const gx = -w * 0.34;
  ctx.fillStyle = '#a6ff00';
  ctx.beginPath();
  ctx.ellipse(gx, h * 0.08, h * 0.24, h * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0d1a10';
  ctx.fillRect(gx - h * 0.18, -h * 0.2, h * 0.36, h * 0.08);
  ctx.strokeStyle = '#c9d1dc';
  ctx.lineWidth = h * 0.06;
  ctx.beginPath();
  ctx.moveTo(gx + h * 0.02, h * 0.05);
  ctx.lineTo(gx + h * 0.2, -h * 0.4);
  ctx.stroke();
  ctx.fillStyle = '#a6ff00';
  label(ctx, 'NEOMATE', w * 0.1, -h * 0.06, w * 0.6, h * 0.5, DISPLAY, '900');
  ctx.fillStyle = '#e9ecf2';
  label(ctx, 'YERBA CYBER', w * 0.1, h * 0.28, w * 0.5, h * 0.2, CONDENSED, '700');
};

const chispa: DecalPainter = (ctx, W, H) => {
  const { w, h } = fit(W, H, 2.7);
  ctx.save();
  ctx.transform(1, 0, -0.18, 1, 0, 0);
  ctx.fillStyle = '#f4f5f8';
  ctx.fillRect(-w / 2 + h * 0.1, -h / 2, w - h * 0.2, h);
  ctx.fillStyle = '#ff6a13';
  ctx.fillRect(-w / 2 + h * 0.1, -h / 2, h * 0.16, h);
  ctx.restore();
  // A four-point spark.
  ctx.fillStyle = '#ff6a13';
  const sx = -w * 0.3;
  const r = h * 0.34;
  poly(ctx, [
    [sx, -r],
    [sx + r * 0.22, -r * 0.22],
    [sx + r, 0],
    [sx + r * 0.22, r * 0.22],
    [sx, r],
    [sx - r * 0.22, r * 0.22],
    [sx - r, 0],
    [sx - r * 0.22, -r * 0.22],
  ]);
  ctx.fill();
  label(ctx, 'CHISPA', w * 0.1, -h * 0.12, w * 0.56, h * 0.5, DISPLAY, '900', true);
  ctx.fillStyle = '#111111';
  label(ctx, 'TUNING', w * 0.1, h * 0.27, w * 0.46, h * 0.26, CONDENSED, '700');
};

const tallerLoco: DecalPainter = (ctx, W, H) => {
  const { w, h } = fit(W, H, 1.6);
  roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.14);
  ctx.fillStyle = '#8e0f22';
  ctx.fill();
  ctx.lineWidth = h * 0.04;
  ctx.strokeStyle = '#ffb347';
  ctx.stroke();
  // A horseshoe, points down: the Loco's luck.
  ctx.strokeStyle = '#ffb347';
  ctx.lineWidth = h * 0.09;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.arc(0, -h * 0.06, h * 0.2, Math.PI * 0.85, Math.PI * 2.15);
  ctx.stroke();
  ctx.fillStyle = '#ffb347';
  label(ctx, 'TALLER', 0, -h * 0.36, w * 0.7, h * 0.14, CONDENSED, '700');
  ctx.fillStyle = '#f4f5f8';
  label(ctx, 'LOCO MUSTANG', 0, h * 0.3, w * 0.86, h * 0.2, DISPLAY, '900');
};

const wakaba: DecalPainter = (ctx, W, H) => {
  const { w, h } = fit(W, H, 0.78);
  // Two leaves meeting in a point at the bottom, a notch at the top: yellow left, green right.
  const top = -h / 2;
  const bot = h / 2;
  const left: Pt[] = [[0, top + h * 0.2], [-w / 2, top], [-w / 2, top + h * 0.55], [0, bot]];
  const right: Pt[] = [[0, top + h * 0.2], [w / 2, top], [w / 2, top + h * 0.55], [0, bot]];
  ctx.lineJoin = 'round';
  ctx.lineWidth = w * 0.08;
  ctx.strokeStyle = '#ffffff';
  poly(ctx, [...left, ...right.slice(0, 3).reverse()]);
  ctx.stroke();
  poly(ctx, left);
  ctx.fillStyle = '#ffd400';
  ctx.fill();
  poly(ctx, right);
  ctx.fillStyle = '#1a9b45';
  ctx.fill();
};

const sunDisc: DecalPainter = (ctx, W, H) => {
  const { w, h } = fit(W, H, 1.5);
  ctx.fillStyle = '#f4f5f8';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = '#d11a2a';
  ctx.beginPath();
  ctx.arc(0, 0, h * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = h * 0.03;
  ctx.strokeStyle = '#1b1b1b';
  ctx.strokeRect(-w / 2, -h / 2, w, h);
};

const driftKanji: DecalPainter = (ctx, W, H) => {
  const { w, h } = fit(W, H, 3.4);
  ctx.save();
  ctx.transform(1, 0, -0.2, 1, 0, 0);
  ctx.font = `900 ${Math.round(h * 0.78)}px ${JP}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const m = ctx.measureText('ドリフト').width;
  const k = m > w * 0.94 ? (w * 0.94) / m : 1;
  ctx.scale(k, 1);
  ctx.lineJoin = 'round';
  ctx.lineWidth = h * 0.14;
  ctx.strokeStyle = '#0b0c10';
  ctx.strokeText('ドリフト', 0, 0);
  ctx.fillStyle = '#f4f5f8';
  ctx.fillText('ドリフト', 0, 0);
  ctx.restore();
  ctx.fillStyle = '#ff2fd0';
  ctx.fillRect(-w * 0.44, h * 0.42, w * 0.88, h * 0.06);
};

/** The graffiti atlas the city paints with, shared and made on the first graffiti decal. */
let graffiti: GraffitiAtlas | null = null;
const graffitiListeners = new Set<() => void>();

function graffitiCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!graffiti) {
    graffiti = makeGraffitiAtlas();
    void graffiti.ready.then(() => {
      for (const listener of graffitiListeners) listener();
    });
  }
  return graffiti.texture.image as HTMLCanvasElement;
}

/** A piece of the city's graffiti atlas (`env/graffiti.ts`), sprayed onto the car at its own shape. */
function graffitiDecal(cell: number): DecalPainter {
  return (ctx, W, H) => {
    const img = graffitiCanvas();
    if (!img) return;
    const uv = graffitiCell(cell);
    const size = img.width;
    const { w, h } = fit(W, H, graffitiAspect(cell));
    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.drawImage(img, uv.u0 * size, (1 - uv.v1) * size, (uv.u1 - uv.u0) * size, (uv.v1 - uv.v0) * size, -w / 2, -h / 2, w, h);
    ctx.restore();
  };
}

/** Every decal the paint shop draws, by part id. The catalogue must match (`tests/paintShop.test.ts`). */
export const DECAL_PAINTERS: Readonly<Record<PartId, DecalPainter>> = {
  'decals.rayo-banner': rayoBanner,
  'decals.kaminari': kaminari,
  'decals.neomate': neomate,
  'decals.chispa': chispa,
  'decals.taller-loco': tallerLoco,
  'decals.wakaba': wakaba,
  'decals.sun-disc': sunDisc,
  'decals.drift-kanji': driftKanji,
  // Cells of the city's atlas: a square tag, a 2:1 wildstyle, bubble letters, a 3:1 banner mural.
  'decals.graffiti-tag': graffitiDecal(0),
  'decals.graffiti-wild': graffitiDecal(1),
  'decals.graffiti-bubble': graffitiDecal(3),
  'decals.graffiti-mural': graffitiDecal(6),
};

const GRAFFITI_DECALS = new Set(Object.keys(DECAL_PAINTERS).filter((id) => id.startsWith('decals.graffiti-')));

/* ================================================================== composing */

/** Everything the canvas depends on, as one string: `compose` runs only when this changes. */
export function paintKey(l: CarLoadout): string {
  return JSON.stringify([l.paint.base, l.paint.finish, l.paint.roof ?? '', l.vinyls, l.decals, l.plate]);
}

/* The greenhouse, for a two-tone roof: in the top region (z, x), and above the beltline on the
 * flanks (z, y). */
const ROOF_TOP = { z0: -0.76, z1: 1.6, halfX: 0.775 };
const ROOF_SIDE = { z0: -0.8, z1: 1.64, y0: 0.885 };

/** Paint the whole atlas for `l` into `ctx` (a 1024² canvas). Exported for the harness and tests. */
export function composePaint(ctx: Ctx, l: CarLoadout): void {
  const finish = FINISH_PARAMS[l.paint.finish] ?? FINISH_PARAMS.metallic;
  const lift = (hex: string): string => (finish.lift > 0 ? mixHex(hex, '#dfe4ee', finish.lift) : hex);
  const base = lift(hexOf(l.paint.base, '#070915'));
  const roof = l.paint.roof !== undefined ? lift(hexOf(l.paint.roof, base)) : null;
  const env: PaintEnv = { base };

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

  for (const id of FRAME_IDS) {
    const frame = PAINT_FRAMES[id];
    enterFrame(ctx, frame);
    if (roof) {
      ctx.fillStyle = roof;
      if (id === 'top') ctx.fillRect(ROOF_TOP.z0, -ROOF_TOP.halfX, ROOF_TOP.z1 - ROOF_TOP.z0, ROOF_TOP.halfX * 2);
      else if (id === 'left' || id === 'right') ctx.fillRect(ROOF_SIDE.z0, ROOF_SIDE.y0, ROOF_SIDE.z1 - ROOF_SIDE.z0, 1);
    }
    for (const layer of l.vinyls) {
      const painter = VINYL_PAINTERS[layer.id];
      if (!painter) continue;
      ctx.save();
      painter(ctx, frame, hexOf(layer.color, '#ff2fd0'), env);
      ctx.restore();
    }
    ctx.restore();
  }

  for (const decal of l.decals) {
    const painter = DECAL_PAINTERS[decal.id];
    const place = DECAL_PLACES[decal.zone];
    if (!painter || !place) continue;
    const frame = PAINT_FRAMES[place.frame];
    enterFrame(ctx, frame);
    upright(ctx, frame, place.P, place.Q, place.read, () => painter(ctx, place.w * 1000, place.h * 1000));
    ctx.restore();
  }

  // Undersides: the paint in shadow. Trim: white, so the plate's frame shows its own colour.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = mixHex(base, '#000000', 0.6);
  ctx.fillRect(UNDER_CELL.x, UNDER_CELL.y, UNDER_CELL.w, UNDER_CELL.h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(NEUTRAL_CELL.x, NEUTRAL_CELL.y, NEUTRAL_CELL.w, NEUTRAL_CELL.h);
  drawPlate(ctx, { x: PLATE_CELL.x, y: PLATE_CELL.y, width: PLATE_CELL.w, height: PLATE_CELL.h }, l.plate);
  ctx.restore();
}

/**
 * The car's paint shop: one canvas and one texture for the car's whole life, painted for
 * `loadout` now and repainted by `apply` whenever the paint changes.
 */
export function createCarPaint(loadout: CarLoadout = STOCK_LOADOUT): CarPaint {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (canvas) {
    canvas.width = ATLAS_SIZE;
    canvas.height = ATLAS_SIZE;
  }
  const ctx = canvas ? canvas.getContext('2d') : null;
  if (!canvas || !ctx) {
    // No DOM: no texture, like the old livery path. The finish still reaches the material.
    return {
      texture: null,
      apply(l, material) {
        applyFinish(material, l.paint.finish);
      },
      dispose() {},
    };
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;

  const c2d = ctx;
  let current = loadout;
  let key = '';
  let disposed = false;

  const compose = (l: CarLoadout): void => {
    composePaint(c2d, l);
    texture.needsUpdate = true;
    key = paintKey(l);
    current = l;
  };

  // The graffiti art lands a moment after the first graffiti decal is drawn: repaint once then.
  const onGraffiti = (): void => {
    if (!disposed && current.decals.some((d) => GRAFFITI_DECALS.has(d.id))) compose(current);
  };
  graffitiListeners.add(onGraffiti);

  compose(loadout);

  return {
    texture,
    apply(l, material) {
      applyFinish(material, l.paint.finish);
      // The paint is in the map: the material's colour is white, the CLEAN paint grime darkens.
      material.color.setRGB(1, 1, 1);
      if (paintKey(l) !== key) compose(l);
    },
    dispose() {
      disposed = true;
      graffitiListeners.delete(onGraffiti);
      texture.dispose();
      // Let the 4 MB of canvas go at once rather than whenever the texture is collected.
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
