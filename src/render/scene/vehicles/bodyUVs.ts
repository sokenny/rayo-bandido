import type * as THREE from 'three';
import { applyLengthwiseUVs } from './geometryKit';

/**
 * THE BODY'S UV MAPPING. OWNED BY agent C (`docs/GARAGE_PLAN.md` §1 point 2, §2.7).
 *
 * Today this is `applyLengthwiseUVs` — the dominant-axis projection the shard livery was painted
 * for, in which both flanks share the texture and nothing has a region of its own. The paint
 * atlas replaces it with `applyBodyAtlasUVs` (left flank, right flank, hood/roof/deck, nose/tail,
 * plate), and this is the one function `bodyAssembler.ts` calls, so the swap is made here and
 * nowhere else. When it happens, the `uv` fingerprints in `tests/carVisualStock.test.ts` are
 * re-baselined on purpose — and only those.
 */
export function applyBodyUVs(geometry: THREE.BufferGeometry): void {
  applyLengthwiseUVs(geometry);
}
