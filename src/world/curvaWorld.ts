import type { World } from './arenaWorld';
import { createCityWorld } from './cityWorld';
import { CURVA_COURSE, CURVA_RAMPS } from './curvaSpec';
import { METRO_SPEC } from './metroSpec';
import { layStreetCourse } from './streetWorld';
import { RAMP_LIFT } from './cityDef';

/**
 * LA CURVA: Bandido Metro with the fourth Street Race drawn inside it (`curvaSpec.ts`).
 *
 * The Quay Circuit's construction (`layStreetCourse`), over the metro instead of the Bay, with one
 * change to the city: the two race ramps onto and off the viaduct by the meet (`CURVA_RAMPS`),
 * added to its elevated roads the way the metro's own ramps are, so the assembler gives them their
 * slab, rails, columns and cleared plots. Nothing else in `METRO_SPEC` is touched, and the free
 * world does not have them.
 */
export function createCurvaWorld(seed?: number): World {
  const elevated = [...METRO_SPEC.elevated, ...CURVA_RAMPS.map((r) => ({ tag: r.tag, spec: r.spec, lift: RAMP_LIFT }))];
  return layStreetCourse(createCityWorld({ ...METRO_SPEC, elevated }), CURVA_COURSE, seed);
}
