import type * as THREE from 'three';
import { STOCK_LOADOUT, type CarLoadout } from '../../../core/loadout';
import { mergeParts } from './geometryKit';
import { buildSlotParts } from './parts';
import { buildPlateGeometry } from './plate';
import { applyBodyUVs } from './bodyUVs';

/**
 * The bodywork, merged into one geometry, for one loadout.
 *
 * It is the slots of `./parts/` in `BODY_SLOTS` order with the number plate (`./plate.ts`)
 * after the rear bumper, merged, uv-mapped (`./bodyUVs.ts`) and given a bounding sphere. With
 * `STOCK_LOADOUT` it is exactly the body the car had before the workshop existed
 * (`tests/carVisualStock.test.ts`).
 *
 * Re-exported by `../carVisual.ts` under the same name, because the rival cars in a multiplayer
 * race (`rivalCarVisual.ts`), the meet (`meetVisual.ts`) and the micro-scene props build it once
 * with no arguments to share between them — the stock car, closed cabin. The player's own car
 * keeps its own copy, with an open cabin, and rebuilds it from `CarVisual.applyLoadout`.
 *
 * Allocates a fresh geometry every call: workshop-time only, never per frame. The caller owns
 * the result and disposes it.
 */
export function buildBodyGeometry(openCabin = false, loadout: CarLoadout = STOCK_LOADOUT): THREE.BufferGeometry {
  const parts = buildSlotParts(
    { openCabin, loadout },
    { after: 'rearBumper', parts: () => buildPlateGeometry(loadout.plate) },
  );
  const merged = mergeParts(parts);
  applyBodyUVs(merged);
  merged.computeBoundingSphere();
  return merged;
}
