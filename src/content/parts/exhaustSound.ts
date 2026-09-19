import type { PartDef } from '../carParts';

/**
 * Exhaust sound presets. OWNED BY agent G (`docs/GARAGE_PLAN.md`, Ola 1). Every entry needs a
 * preset of the same id in `src/audio/engine.ts` (`setExhaust`). Juan tunes these by ear — the
 * numbers behind them are a starting point, never a spectrum match.
 *
 * `exhaustSound.stock` is the engine exactly as it sounds today.
 */
export const EXHAUST_SOUND_PARTS: PartDef[] = [
  { id: 'exhaustSound.stock', category: 'exhaustSound', name: 'De fábrica', price: 0, rating: 1 },
];
