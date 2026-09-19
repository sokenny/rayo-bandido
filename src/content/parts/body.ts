import type { PartDef } from '../carParts';

/**
 * Bodywork parts: bumpers, skirts, hood, trunk, spoiler and exhaust tips.
 *
 * OWNED BY agent A (`docs/GARAGE_PLAN.md`, Ola 1). Every entry here needs a variant of the same
 * id in the matching slot builder under `src/render/scene/vehicles/parts/` — the catalogue says
 * what a part is called and costs, the builder says what it looks like. Prices and ratings here
 * are provisional; the economy's calibration is `PRICING` in `../carParts.ts`.
 *
 * The `.stock` entries ARE today's car (the GT wing, the carbon splitter, the wide-body skirts,
 * the twin round tips) and must never change shape: `tests/carVisualStock.test.ts` pins them.
 */
export const BODY_PARTS: PartDef[] = [
  { id: 'frontBumper.stock', category: 'frontBumper', name: 'De fábrica', price: 0, rating: 2, blurb: 'Splitter de carbono y toma baja.' },
  { id: 'rearBumper.stock', category: 'rearBumper', name: 'De fábrica', price: 0, rating: 2, blurb: 'Difusor con aletas.' },
  { id: 'skirts.stock', category: 'skirts', name: 'De fábrica', price: 0, rating: 1 },
  { id: 'hood.stock', category: 'hood', name: 'De fábrica', price: 0, rating: 1, blurb: 'Dos tomas de carbono.' },
  { id: 'trunk.stock', category: 'trunk', name: 'De fábrica', price: 0, rating: 0 },
  { id: 'spoiler.stock', category: 'spoiler', name: 'GT', price: 0, rating: 3, blurb: 'Alerón GT de un plano.' },
  { id: 'exhaustTips.stock', category: 'exhaustTips', name: 'Doble redondo', price: 0, rating: 1 },
];
