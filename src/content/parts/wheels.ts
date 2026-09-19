import type { PartDef } from '../carParts';

/**
 * Rim designs. OWNED BY agent B (`docs/GARAGE_PLAN.md`, Ola 1). Every entry needs a design of
 * the same id in `RIM_DESIGNS` (`src/render/scene/vehicles/wheel.ts`); `tests/wheelRig.test.ts`
 * checks both ways. Rim colour, size, width and the stance steps are not parts (they are
 * `color`/`step` categories priced per change in `CATEGORIES`), so they have no entries here.
 *
 * `rims.stock` is today's five-spoke dish with the magenta centre cap. Prices and ratings are
 * provisional; the economy's word is `PRICING` in `carParts.ts`.
 */
export const WHEEL_PARTS: PartDef[] = [
  { id: 'rims.stock', category: 'rims', name: '5 rayos', price: 0, rating: 2 },
  { id: 'rims.hart-10', category: 'rims', name: 'Hart 10 rayos', price: 2200, rating: 4, blurb: 'Rayos finos, labio pulido.' },
  { id: 'rims.twin-6', category: 'rims', name: '6 rayos dobles', price: 2600, rating: 4 },
  { id: 'rims.steelie', category: 'rims', name: 'Chapa drift', price: 1200, rating: 3, blurb: 'Llanta de acero para romper.' },
  { id: 'rims.concave-5', category: 'rims', name: '5 rayos cóncava', price: 3400, rating: 6, blurb: 'Rayos que se hunden al centro.' },
  { id: 'rims.mesh', category: 'rims', name: 'Malla cruzada', price: 4200, rating: 7, blurb: 'Malla estilo BBS, labio ancho.' },
  { id: 'rims.turbofan', category: 'rims', name: 'Turbofan', price: 3800, rating: 6, blurb: 'Disco con aspas, puro ochentas.' },
  { id: 'rims.dish-3p', category: 'rims', name: 'Dish 3 piezas', price: 5200, rating: 8, blurb: 'Labio profundo pulido y bulones.' },
];
