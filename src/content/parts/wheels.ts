import type { PartDef } from '../carParts';

/**
 * Rim designs. OWNED BY agent B (`docs/GARAGE_PLAN.md`, Ola 1). Every entry needs a design of
 * the same id in `src/render/scene/vehicles/wheel.ts` / `wheelRig.ts`. Rim colour, size, width
 * and the stance steps are not parts (they are `color`/`step` categories priced per change in
 * `CATEGORIES`), so they have no entries here.
 *
 * `rims.stock` is today's five-spoke dish with the magenta centre cap.
 */
export const WHEEL_PARTS: PartDef[] = [
  { id: 'rims.stock', category: 'rims', name: '5 rayos', price: 0, rating: 2 },
];
