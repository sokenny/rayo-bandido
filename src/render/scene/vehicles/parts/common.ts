import type * as THREE from 'three';
import { VEHICLE } from '../../../../config/tuning';
import type { CarLoadout, PartId } from '../../../../core/loadout';

/**
 * Shared vocabulary of the body slot builders (`docs/GARAGE_PLAN.md` §1 point 1, §2.7).
 *
 * THE BODY IS STILL ONE GEOMETRY. It is assembled from slots — the hull, the greenhouse, the
 * fenders, each bumper, the skirts, the hood, the trunk, the spoiler, the mirrors, the exhaust
 * tips — and every slot builder returns plain parts that `bodyAssembler.ts` merges into the one
 * body mesh the car has always drawn. Changing a part is rebuilding that geometry, which only
 * ever happens inside the workshop. The fourteen draw calls do not move.
 *
 * WRITING A SLOT BUILDER
 * - `build(partId, ctx)` returns an array of geometries, each already passed through
 *   `part()`/`partRGBA()` from `../geometryKit` (non-indexed, `position` + `normal` + `color`,
 *   nothing else). The assembler consumes and disposes them; never return a shared geometry.
 * - An id the builder does not know builds `stock` — the catalogue (`src/content/parts/`) and the
 *   builders are written by the same agent, but a stale save must never build nothing.
 * - Vertex colour multiplies the paint map: `BODY_COLORS.PAINT` (white) wears the full paint,
 *   the darker tints read as carbon, plastic, grille or chrome.
 * - Car frame: nose toward -Z, +X the car's right, y = 0 the road, origin at the centre of the
 *   wheelbase (`CarVisual` contract). `CAR_DIMS` has the numbers every slot lines up against.
 * - List every id the builder draws in `variants`, stock first. `tests/` checks each catalogue
 *   part of the slot's category has one.
 * - Budget: the whole body may grow by at most ~1,500 triangles over stock with the heaviest
 *   options on (`docs/GARAGE_PLAN.md` §2.7).
 */

/** Every body slot, in the order the assembler merges them (the plate goes after `rearBumper`). */
export type BodySlot =
  | 'hull'
  | 'greenhouse'
  | 'fenders'
  | 'frontBumper'
  | 'skirts'
  | 'rearBumper'
  | 'spoiler'
  | 'mirrors'
  | 'hood'
  | 'trunk'
  | 'exhaustTips';

export const BODY_SLOTS: readonly BodySlot[] = [
  'hull',
  'greenhouse',
  'fenders',
  'frontBumper',
  'skirts',
  'rearBumper',
  'spoiler',
  'mirrors',
  'hood',
  'trunk',
  'exhaustTips',
];

/** The slots a loadout chooses a part for. The rest (`hull`, `greenhouse`, `fenders`, `mirrors`) are fixed. */
export type CustomBodySlot = keyof CarLoadout['body'];

export function isCustomSlot(slot: BodySlot): slot is CustomBodySlot {
  return slot !== 'hull' && slot !== 'greenhouse' && slot !== 'fenders' && slot !== 'mirrors';
}

/** The part a loadout puts in `slot`: its choice for a custom slot, `<slot>.stock` for a fixed one. */
export function slotPartId(slot: BodySlot, loadout: CarLoadout): PartId {
  return isCustomSlot(slot) ? loadout.body[slot] : `${slot}.stock`;
}

export interface BodyPartContext {
  /**
   * Leave the windscreen and backlight panels out of the greenhouse, so the cabin shows through
   * real holes (`interior.ts`). Only the player's own car takes it.
   */
  openCabin: boolean;
  /**
   * The whole loadout, for the builders that have to agree with another choice: a fender that
   * flares further when the track is pushed out, a trunk that makes room for a tall wing.
   */
  loadout: CarLoadout;
}

export interface SlotModule {
  slot: BodySlot;
  /** Every part id `build` draws, stock first. */
  variants: readonly PartId[];
  build(partId: PartId, ctx: BodyPartContext): THREE.BufferGeometry[];
}

/* Vertex colors multiply the paint map: white keeps the full livery, a dark tint turns a
 * merged part into matte carbon or plastic. */
export const BODY_COLORS = {
  PAINT: 0xffffff,
  PAINT_ROOF: 0xb8bfd0,
  CARBON: 0x5a5f70,
  CARBON_DARK: 0x3c404d,
  GRILLE: 0x1e2230,
  CHROME: 0x9aa3b5,
  PLATE: 0xe8e4d6,
} as const;

/** The numbers the slots line up against. Read-only views of `VEHICLE`; never tuned from here. */
export const CAR_DIMS = {
  halfBase: VEHICLE.wheelbase / 2,
  wheelRadius: VEHICLE.wheelRadius,
  /** Nose and tail of the hull (the splitter and exhaust stick out past them). */
  noseZ: -2.12,
  tailZ: 2.12,
} as const;
