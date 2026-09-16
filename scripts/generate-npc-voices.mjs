/**
 * Render the street NPCs' lines (`src/content/ambientVoice.ts`) into static clips in
 * `public/npc-voice/`, through the same ElevenLabs path the server uses for dialogue
 * (`server/dialogue/speech.mjs`, voice settings in `server/dialogue/voices.mjs`).
 *
 *   node scripts/generate-npc-voices.mjs            only the clips that are missing
 *   node scripts/generate-npc-voices.mjs --force    all of them again
 *
 * Needs `ELEVENLABS_API_KEY` in `.env`. The key stays in this process; the game only ever
 * fetches the resulting mp3 files.
 */
import { copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDialogueSpeech, createFsSpeechCache } from '../server/dialogue/speech.mjs';
import { AMBIENT_CLIPS, AMBIENT_VOICE_CHARACTER } from '../src/content/ambientVoice.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'public', 'npc-voice');
const force = process.argv.includes('--force');
/**
 * Delivery direction for eleven_v3, not part of the line: an audio tag is performed, never read
 * out. Shouted at a car going by, not narrated.
 */
const DIRECTION = '[shouting]';

try {
  process.loadEnvFile(join(root, '.env'));
} catch {
  /* no .env: the key may be in the environment */
}

const cacheDir = await mkdtemp(join(tmpdir(), 'npc-voice-'));
const speech = createDialogueSpeech({ cache: createFsSpeechCache(cacheDir), log: (m) => console.log(m), dev: true, generate: true });
await mkdir(outDir, { recursive: true });

let failed = 0;
try {
  for (const [id, line] of Object.entries(AMBIENT_CLIPS)) {
    const target = join(outDir, `${id}.mp3`);
    if (!force) {
      const exists = await stat(target).then((s) => s.isFile(), () => false);
      if (exists) {
        console.log(`skip ${id} (exists)`);
        continue;
      }
    }
    try {
      const { key } = await speech.synthesize(AMBIENT_VOICE_CHARACTER, `${DIRECTION} ${line}`);
      await copyFile(join(cacheDir, `${key}.mp3`), target);
      const { size } = await stat(target);
      console.log(`wrote ${id}.mp3 (${(size / 1024).toFixed(1)} KB)  ${line}`);
    } catch (err) {
      failed++;
      console.error(`FAILED ${id}: ${err?.message || err}`);
    }
  }
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
