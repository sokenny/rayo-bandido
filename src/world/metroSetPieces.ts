// Value imports spelt with their extension, so `scripts/metro-preview.mjs` can load the metro's
// spec (which carries these) under plain Node.
import { PARKADE } from './setPieces/parkade.ts';
import { ROADWORKS } from './setPieces/roadworks.ts';
import { STORM_DRAIN } from './setPieces/stormDrain.ts';
import type { SetPieceSpec } from './setPieces/types';

/**
 * Bandido Metro's set-pieces (`setPieces/types.ts`), in draw order. Each lives in its own file
 * under `setPieces/`, with its art in `render/scene/env/setPieces/<name>Builder.ts`.
 */
export const METRO_SET_PIECES: SetPieceSpec[] = [ROADWORKS, PARKADE, STORM_DRAIN];
