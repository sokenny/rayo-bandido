import type * as THREE from 'three';
import type { CarLoadout } from '../../../core/loadout';
import { box, part } from './geometryKit';
import { BODY_COLORS } from './parts/common';

/**
 * THE NUMBER PLATE. OWNED BY agent C (`docs/GARAGE_PLAN.md` §2.7, Ola 1).
 *
 * WAVE 0 STATE: a stub with the final API. The plate is still what it has always been — a plain
 * light box merged into the body (`buildPlateGeometry`, called by `bodyAssembler.ts` right after
 * the rear bumper) — and nothing draws its text yet. Agent C fills in:
 *
 * - `buildPlateGeometry(plate)` — a style-specific shape for `plate.style` (a frame, a Mercosur
 *   blue band), still merged into the body: 0 extra draw calls.
 * - `drawPlate(ctx2d, cell, plate)` — paints the plate face (text in `formatPlateText`, the
 *   style's band) into the paint atlas's plate cell (`paintShop.ts`), which the plate geometry's
 *   uvs map onto (`bodyUVs.ts`).
 *
 * Everything here stays where `PLATE_MOUNT` says, so the rear bumpers (agent A) know what to keep
 * clear of.
 */

/** Where the plate sits, in the car frame: centre and size (m). Rear bumpers keep this clear. */
export const PLATE_MOUNT = { x: 0, y: 0.53, z: 2.145, width: 0.46, height: 0.15, depth: 0.03 } as const;

/** The plate's geometry for the body merge. Stock: today's plain light box. */
export function buildPlateGeometry(plate: CarLoadout['plate']): THREE.BufferGeometry[] {
  switch (plate.style) {
    default: {
      const g = box(PLATE_MOUNT.width, PLATE_MOUNT.height, PLATE_MOUNT.depth);
      g.translate(PLATE_MOUNT.x, PLATE_MOUNT.y, PLATE_MOUNT.z);
      return [part(g, BODY_COLORS.PLATE)];
    }
  }
}

/**
 * The text as printed on the plate: Mercosur style splits seven characters `AB 123 CD`; anything
 * that is not seven characters with no spaces of its own is printed as the player typed it.
 */
export function formatPlateText(text: string): string {
  if (text.length === 7 && !text.includes(' ')) return `${text.slice(0, 2)} ${text.slice(2, 5)} ${text.slice(5)}`;
  return text;
}

/** A rectangle of a 2D canvas, in pixels. */
export interface CanvasCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Paint the plate face into `cell` of the paint atlas. Returns whether anything was drawn.
 * STUB until agent C: draws nothing, so the plate keeps its plain vertex-coloured face.
 */
export function drawPlate(_ctx: CanvasRenderingContext2D, _cell: CanvasCell, _plate: CarLoadout['plate']): boolean {
  return false;
}
