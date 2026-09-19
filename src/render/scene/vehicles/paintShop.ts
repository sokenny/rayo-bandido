import type * as THREE from 'three';
import { STOCK_LOADOUT, type CarLoadout } from '../../../core/loadout';
import { createLiveryTexture } from './livery';

/**
 * THE PAINT SHOP: base colour × finish → vinyls → decals → plate, composed into the body's map.
 * OWNED BY agent C (`docs/GARAGE_PLAN.md` §2.7, Ola 1).
 *
 * WAVE 0 STATE: a stub with the final API that does exactly what `carVisual.ts` did before —
 * the stock livery canvas (`livery.ts`) as the body's map, nothing else. Agent C fills in:
 *
 * - a 1024² canvas atlas with regions (`bodyUVs.ts` maps the body onto them),
 * - `apply(loadout, material)`: `paint.base` × `paint.finish` → the `MeshPhysicalMaterial`'s
 *   colour, metalness, roughness, clearcoat and iridescence (pearl); the vinyl layers as canvas
 *   painters (the stock `vinyls.rayo` IS today's `livery.ts` shards), decals per `DecalZone`,
 *   and the plate cell (`drawPlate` in `plate.ts`). Recomposes only when the paint changed.
 *
 * CONTRACT
 * - Created once per player car, only when the car wears its own paint: in a match the body is
 *   the slot colour (D3) and `CarVisual` never creates a paint shop.
 * - `texture` is the body material's `map` and `emissiveMap` for the life of the car: `apply`
 *   repaints it in place (canvas + `needsUpdate`) rather than replacing it, so the material never
 *   needs recompiling. `null` without a DOM (unit tests), where the body falls back to its
 *   vertex-coloured paint.
 * - `apply` is workshop-time and may allocate; it must leave the material's colour at the
 *   CLEAN paint — `CarVisual` reads it back as the base the crash grime darkens.
 */
export interface CarPaint {
  readonly texture: THREE.CanvasTexture | null;
  apply(loadout: CarLoadout, material: THREE.MeshPhysicalMaterial): void;
  dispose(): void;
}

export function createCarPaint(_loadout: CarLoadout = STOCK_LOADOUT): CarPaint {
  const texture = createLiveryTexture();
  return {
    texture,
    apply() {
      /* Wave 0: the stock livery is all there is, and it was painted at creation. */
    },
    dispose() {
      texture?.dispose();
    },
  };
}
