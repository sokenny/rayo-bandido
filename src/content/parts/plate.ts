import type { PartDef } from '../carParts';

/**
 * Number plate styles (the plate's text is `CarLoadout.plate.text`, not a part). OWNED BY
 * agent C (`docs/GARAGE_PLAN.md`, Ola 1). Every entry needs a style of the same id in
 * `src/render/scene/vehicles/plate.ts` (`PLATE_STYLES`, `buildPlateGeometry`, `drawPlate`).
 *
 * `plate.stock` is today's plain light plate (now with its number printed on it). Prices and
 * ratings are provisional; agent F calibrates them through `PRICING`.
 */
export const PLATE_PARTS: PartDef[] = [
  { id: 'plate.stock', category: 'plate', name: 'Lisa', price: 0, rating: 0 },
  { id: 'plate.mercosur', category: 'plate', name: 'Mercosur', price: 300, rating: 1, blurb: 'Blanca con la franja azul.' },
  { id: 'plate.classic', category: 'plate', name: 'Negra clásica', price: 400, rating: 2, blurb: 'La negra de siempre, marco cromado.' },
  { id: 'plate.kei', category: 'plate', name: 'Kei amarilla', price: 500, rating: 2, blurb: 'Amarilla japonesa de auto kei.' },
  { id: 'plate.neon', category: 'plate', name: 'Neón', price: 700, rating: 3, blurb: 'Letras cian encendidas, marco magenta.' },
];
