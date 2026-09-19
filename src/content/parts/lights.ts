import type { PartDef } from '../carParts';

/**
 * Head and tail light shapes. OWNED BY agent G (`docs/GARAGE_PLAN.md`, Ola 1). Every entry
 * needs a shape of the same id in `src/render/scene/vehicles/lights.ts`. Head light colour,
 * neon and cabin light are `color` categories and have no entries here.
 */
export const LIGHT_PARTS: PartDef[] = [
  { id: 'headlights.stock', category: 'headlights', name: 'De fábrica', price: 0, rating: 1 },
  { id: 'taillights.stock', category: 'taillights', name: 'De fábrica', price: 0, rating: 1 },
];
