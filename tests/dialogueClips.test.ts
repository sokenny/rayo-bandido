import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RUNTIME_DIALOGUE } from '../src/content/dialogueLines';

/**
 * Every line the game asks the server to speak has its clip baked into `public/dialogue/`. A deployed
 * server never generates (`server/dialogue/speech.mjs`), so a line without one is silent in
 * production. Fix a failure with `npm run dialogue:voices`.
 */

interface SpeechModule {
  normalizeText(text: string): string;
  speechCacheKey(input: { normalizedText: string; characterId: string; voice: unknown }): string;
}
const load = <T>(path: string): Promise<T> => import(/* @vite-ignore */ new URL(path, import.meta.url).href) as Promise<T>;

describe('baked dialogue clips', () => {
  it('exist for every runtime line', async () => {
    const speech = await load<SpeechModule>('../server/dialogue/speech.mjs');
    const { CHARACTER_VOICES } = await load<{ CHARACTER_VOICES: Record<string, unknown> }>('../server/dialogue/voices.mjs');
    const missing: string[] = [];
    let total = 0;
    for (const [characterId, lines] of Object.entries(RUNTIME_DIALOGUE)) {
      expect(CHARACTER_VOICES[characterId], characterId).toBeTruthy();
      for (const line of lines) {
        total++;
        const key = speech.speechCacheKey({ normalizedText: speech.normalizeText(line), characterId, voice: CHARACTER_VOICES[characterId] });
        if (!existsSync(fileURLToPath(new URL(`../public/dialogue/${key}.mp3`, import.meta.url)))) missing.push(`${characterId}: ${line}`);
      }
    }
    expect(total).toBeGreaterThan(100);
    expect(missing, 'run `npm run dialogue:voices`').toEqual([]);
  });
});
