import type { PartDef } from '../carParts';

/**
 * Number plate styles (the plate's text is `CarLoadout.plate.text`, not a part). OWNED BY
 * agent C (`docs/GARAGE_PLAN.md`, Ola 1). Every entry needs a style of the same id in
 * `src/render/scene/vehicles/plate.ts`.
 *
 * `plate.stock` is today's plain light plate.
 */
export const PLATE_PARTS: PartDef[] = [
  { id: 'plate.stock', category: 'plate', name: 'Lisa', price: 0, rating: 0 },
];
