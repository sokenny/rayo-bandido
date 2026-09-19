import type * as THREE from 'three';
import type { CarLoadout, PartId } from '../../../core/loadout';
import { box, part } from './geometryKit';
import { BODY_COLORS } from './parts/common';

/**
 * THE NUMBER PLATE. OWNED BY agent C (`docs/GARAGE_PLAN.md` §2.7).
 *
 * Two halves, both cheap:
 * - `buildPlateGeometry(plate)` — the plate's shape for `plate.style` (a holder, a chrome frame,
 *   bolts), merged into the body like everything else: 0 extra draw calls.
 * - `drawPlate(ctx2d, cell, plate)` — the plate's FACE: background, band and text, painted into
 *   the paint atlas's plate cell (`paintShop.ts`). `bodyUVs.ts` maps the triangles lying on the
 *   mount's front face onto that cell and the plate's other triangles onto a white cell, so the
 *   holder and frames show their own vertex colour whatever the car is painted.
 *
 * Every style's face is the same box on `PLATE_MOUNT` (that is how `bodyUVs.ts` finds it); trim
 * sits around it or in front of it, never over it. Rear bumpers (agent A) keep `PLATE_MOUNT`
 * plus ~4 cm clear. Without a paint shop (a match, a rival, Node) the face shows its vertex
 * colour: white, or the stock plate's warm grey.
 */

/** Where the plate sits, in the car frame: centre and size (m). Rear bumpers keep this clear. */
export const PLATE_MOUNT = { x: 0, y: 0.53, z: 2.145, width: 0.46, height: 0.15, depth: 0.03 } as const;

/** Every style `buildPlateGeometry` and `drawPlate` know, stock first. Catalogue: `src/content/parts/plate.ts`. */
export const PLATE_STYLES: readonly PartId[] = ['plate.stock', 'plate.mercosur', 'plate.classic', 'plate.kei', 'plate.neon'];

const FACE_WHITE = 0xffffff;
const NEON_TRIM = 0xff2fd0;

/** A box centred at (x, y, z) relative to the mount's centre, coloured. */
function trim(w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  const g = box(w, h, d);
  g.translate(PLATE_MOUNT.x + x, PLATE_MOUNT.y + y, PLATE_MOUNT.z + z);
  return part(g, color);
}

/** The face every style shares: the plate itself, on the mount. */
function face(color: number): THREE.BufferGeometry {
  return trim(PLATE_MOUNT.width, PLATE_MOUNT.height, PLATE_MOUNT.depth, 0, 0, 0, color);
}

/** A frame of four bars around the face, standing `proud` in front of it. */
function frame(bar: number, proud: number, color: number): THREE.BufferGeometry[] {
  const hw = PLATE_MOUNT.width / 2;
  const hh = PLATE_MOUNT.height / 2;
  const z = PLATE_MOUNT.depth / 2 + proud / 2 - 0.004;
  const d = proud + 0.008;
  return [
    trim(PLATE_MOUNT.width + bar * 2, bar, d, 0, hh + bar / 2, z, color),
    trim(PLATE_MOUNT.width + bar * 2, bar, d, 0, -hh - bar / 2, z, color),
    trim(bar, PLATE_MOUNT.height, d, -hw - bar / 2, 0, z, color),
    trim(bar, PLATE_MOUNT.height, d, hw + bar / 2, 0, z, color),
  ];
}

/** A holder a little larger than the plate, just behind its face: reads as a dark border. */
function holder(color: number): THREE.BufferGeometry {
  return trim(PLATE_MOUNT.width + 0.03, PLATE_MOUNT.height + 0.03, 0.02, 0, 0, -0.012, color);
}

/** The plate's geometry for the body merge. An unknown style builds stock. */
export function buildPlateGeometry(plate: CarLoadout['plate']): THREE.BufferGeometry[] {
  switch (plate.style) {
    case 'plate.mercosur':
      return [holder(BODY_COLORS.GRILLE), face(FACE_WHITE)];
    case 'plate.classic':
      return [face(FACE_WHITE), ...frame(0.012, 0.006, BODY_COLORS.CHROME)];
    case 'plate.kei': {
      const hw = PLATE_MOUNT.width / 2;
      const hh = PLATE_MOUNT.height / 2;
      const boltZ = PLATE_MOUNT.depth / 2 + 0.003;
      return [
        holder(BODY_COLORS.GRILLE),
        face(FACE_WHITE),
        trim(0.018, 0.018, 0.006, -hw + 0.05, hh - 0.022, boltZ, BODY_COLORS.CHROME),
        trim(0.018, 0.018, 0.006, hw - 0.05, hh - 0.022, boltZ, BODY_COLORS.CHROME),
      ];
    }
    case 'plate.neon':
      return [holder(BODY_COLORS.GRILLE), face(FACE_WHITE), ...frame(0.008, 0.008, NEON_TRIM)];
    default:
      // Stock: the plain light box the car has always had (pinned by `carVisualStock.test.ts`).
      return [face(BODY_COLORS.PLATE)];
  }
}

/** Two letters, three digits, two letters: an Argentine Mercosur registration. */
const MERCOSUR_RE = /^[A-Z]{2}[0-9]{3}[A-Z]{2}$/;

/**
 * The text as printed on the plate: a seven-character Mercosur registration is spaced
 * `AB 123 CD`; anything else — a word like the stock `BANDIDO`, text with its own spaces, a
 * shorter vanity plate — is printed as the player typed it (splitting `BANDIDO` into
 * `BA NDI DO` would read as nothing).
 */
export function formatPlateText(text: string): string {
  if (MERCOSUR_RE.test(text)) return `${text.slice(0, 2)} ${text.slice(2, 5)} ${text.slice(5)}`;
  return text;
}

/** A rectangle of a 2D canvas, in pixels. */
export interface CanvasCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Condensed, heavy, wide-available: the plate letters. */
const PLATE_FONT = '"DIN Condensed", "DIN Alternate", Bahnschrift, "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif';
const SMALL_FONT = '"Helvetica Neue", Arial, sans-serif';
const JP_FONT = '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", Meiryo, "Noto Sans JP", "Noto Sans CJK JP", sans-serif';

/**
 * Text centred at (cx, cy), squeezed horizontally (never stretched) to fit `maxW`.
 * `size` is the cap height-ish in pixels.
 */
function fitText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxW: number, size: number, font: string, weight = 700): void {
  ctx.font = `${weight} ${Math.round(size)}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width;
  const squeeze = w > maxW && w > 0 ? maxW / w : 1;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(squeeze, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Paint the plate face into `cell` of the paint atlas. Returns whether anything was drawn (it
 * always draws for a known or unknown style: an unknown one paints stock).
 */
export function drawPlate(ctx: CanvasRenderingContext2D, cell: CanvasCell, plate: CarLoadout['plate']): boolean {
  const { x, y, width: w, height: h } = cell;
  const text = formatPlateText(plate.text);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  switch (plate.style) {
    case 'plate.mercosur': {
      // White plate, the blue band across the top with the country, a flag at its left end.
      ctx.fillStyle = '#f7f8fa';
      ctx.fillRect(x, y, w, h);
      const band = h * 0.26;
      ctx.fillStyle = '#1b3f95';
      ctx.fillRect(x, y, w, band);
      // A tiny celeste-white-celeste flag.
      const fw = band * 1.2;
      const fh = band * 0.64;
      const fx = x + w * 0.05;
      const fy = y + (band - fh) / 2;
      ctx.fillStyle = '#74acdf';
      ctx.fillRect(fx, fy, fw, fh);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(fx, fy + fh / 3, fw, fh / 3);
      ctx.fillStyle = '#f6b40e';
      ctx.fillRect(fx + fw / 2 - 1, fy + fh / 2 - 1, 2, 2);
      ctx.fillStyle = '#ffffff';
      fitText(ctx, 'REPUBLICA ARGENTINA', x + w / 2, y + band * 0.54, w * 0.6, band * 0.62, SMALL_FONT, 700);
      ctx.fillStyle = '#111111';
      fitText(ctx, text, x + w / 2, y + band + (h - band) * 0.52, w * 0.9, (h - band) * 0.86, PLATE_FONT, 700);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      break;
    }
    case 'plate.classic': {
      // The black Argentine plate of the 1995–2016 fleet: white letters, a thin white rule.
      ctx.fillStyle = '#0c0d10';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#e9ecf2';
      ctx.lineWidth = 2;
      roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 5);
      ctx.stroke();
      ctx.fillStyle = '#e9ecf2';
      fitText(ctx, 'ARGENTINA', x + w / 2, y + h * 0.2, w * 0.4, h * 0.16, SMALL_FONT, 700);
      fitText(ctx, text, x + w / 2, y + h * 0.6, w * 0.86, h * 0.6, PLATE_FONT, 700);
      break;
    }
    case 'plate.kei': {
      // JDM kei-car yellow: a small top row (district and class), the big number below.
      ctx.fillStyle = '#f2c200';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = 2;
      roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 6);
      ctx.stroke();
      ctx.fillStyle = '#141414';
      fitText(ctx, '湾岸 580', x + w / 2, y + h * 0.24, w * 0.4, h * 0.26, JP_FONT, 700);
      fitText(ctx, 'ら', x + w * 0.1, y + h * 0.64, w * 0.1, h * 0.34, JP_FONT, 700);
      fitText(ctx, text, x + w * 0.56, y + h * 0.64, w * 0.8, h * 0.52, PLATE_FONT, 700);
      break;
    }
    case 'plate.neon': {
      // Cyber: near-black, cyan letters with a glow, a magenta rule.
      ctx.fillStyle = '#07051a';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#ff2fd0';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
      ctx.shadowColor = '#22e6ff';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#8ff6ff';
      fitText(ctx, text, x + w / 2, y + h * 0.54, w * 0.86, h * 0.66, PLATE_FONT, 700);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff5bd0';
      fitText(ctx, 'RB // NEO', x + w * 0.86, y + h * 0.16, w * 0.2, h * 0.14, SMALL_FONT, 700);
      break;
    }
    default: {
      // Stock ("Lisa"): the plain light plate, now with its number on it. The face's vertex
      // colour is the old warm grey, which tints this a touch.
      ctx.fillStyle = '#fbfaf5';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#2a2f3d';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
      ctx.fillStyle = '#1b2033';
      fitText(ctx, text, x + w / 2, y + h * 0.54, w * 0.86, h * 0.64, PLATE_FONT, 700);
      break;
    }
  }
  ctx.restore();
  return true;
}
