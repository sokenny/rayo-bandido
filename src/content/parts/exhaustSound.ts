import type { PartDef } from '../carParts';

/**
 * Exhaust sound presets. OWNED BY agent G (`docs/GARAGE_PLAN.md`, Ola 1). Every entry needs a
 * row of the same id in `EXHAUST_PRESETS` (`src/audio/engine.ts`), which is where the sound is
 * actually tuned — one commented table, every number in it. Juan tunes these by ear; the
 * numbers are a starting point, never a spectrum match.
 *
 * `exhaustSound.stock` is the engine exactly as it sounds today. Prices and ratings are
 * provisional; the economy's word is `PRICING` in `../carParts.ts`.
 */
export const EXHAUST_SOUND_PARTS: PartDef[] = [
  { id: 'exhaustSound.stock', category: 'exhaustSound', name: 'De fábrica', price: 0, rating: 1 },
  { id: 'exhaustSound.street', category: 'exhaustSound', name: 'Callejero', price: 1500, rating: 2, blurb: 'Más grave y más fuerte.' },
  { id: 'exhaustSound.straight', category: 'exhaustSound', name: 'Directo', price: 2800, rating: 4, blurb: 'Caño libre: raspa y petardea.' },
  { id: 'exhaustSound.titanium', category: 'exhaustSound', name: 'Titanio', price: 3500, rating: 4, blurb: 'Grito metálico agudo, JDM puro.' },
  { id: 'exhaustSound.quiet', category: 'exhaustSound', name: 'Silenciado', price: 600, rating: 1, blurb: 'Tapado y discreto.' },
];
