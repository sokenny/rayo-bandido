import type { PartDef } from '../carParts';

/**
 * Vinyls and decals (graffiti included). OWNED BY agent C (`docs/GARAGE_PLAN.md`, Ola 1).
 * Every entry needs a painter of the same id in `src/render/scene/vehicles/paintShop.ts`.
 *
 * Both are `layers` categories: a car wears a list of them (`CarLoadout.vinyls`, up to four,
 * each with a colour; `CarLoadout.decals`, one per `DecalZone`). There is no `decals.stock` —
 * the stock car wears none — and the stock vinyl is `vinyls.rayo`: today's torn magenta/violet
 * shard livery (`livery.ts`), which the stock loadout wears as its one layer.
 */
export const PAINT_PARTS: PartDef[] = [
  { id: 'vinyls.rayo', category: 'vinyls', name: 'Rayo', price: 0, rating: 3, defaultColor: 'magenta', blurb: 'Esquirlas magenta y violeta.' },
];
