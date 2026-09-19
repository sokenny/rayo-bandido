/**
 * Bake every runtime dialogue line (`src/content/dialogueLines.ts`, the pending ones included) into `public/dialogue/`, so the
 * build ships them and a deployed server never calls ElevenLabs (`server/dialogue/speech.mjs`).
 *
 *   npm run dialogue:voices                 bake what is missing: reuse `.cache/`, else generate
 *   npm run dialogue:voices -- --dry-run    say what it would do and stop
 *   npm run dialogue:voices -- --no-generate   only copy from `.cache/`; list what is still missing
 *   npm run dialogue:voices -- --prune      also delete baked clips no line uses any more
 *   npm run dialogue:voices -- --from https://rayobandido.com
 *                                           first try a running server's clips (a GET, never a generation)
 *
 * A clip is named by the server's cache key, so a line re-worded, or a voice re-tuned in
 * `voices.mjs`, is a new file: run this again after either. Generating needs `ELEVENLABS_API_KEY`
 * in `.env`, and only ever pays for lines that have no clip anywhere on this machine.
 */
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeableDialogue } from '../src/content/dialogueLines';

interface SpeechModule {
  normalizeText(text: string): string;
  speechCacheKey(input: { normalizedText: string; characterId: string; voice: unknown }): string;
  createFsSpeechCache(dir: string): unknown;
  createDialogueSpeech(opts: Record<string, unknown>): { synthesize(c: string, t: string): Promise<{ key: string }> };
}

const root = fileURLToPath(new URL('..', import.meta.url));
const speech = (await import(/* @vite-ignore */ new URL('../server/dialogue/speech.mjs', import.meta.url).href)) as SpeechModule;
const { CHARACTER_VOICES } = (await import(/* @vite-ignore */ new URL('../server/dialogue/voices.mjs', import.meta.url).href)) as {
  CHARACTER_VOICES: Record<string, unknown>;
};

const outDir = join(root, 'public', 'dialogue');
const cacheDir = join(root, '.cache', 'generated-dialogue');
const dryRun = process.argv.includes('--dry-run');
const mayGenerate = !process.argv.includes('--no-generate');
const prune = process.argv.includes('--prune');
const from = (() => {
  const i = process.argv.indexOf('--from');
  return i >= 0 ? process.argv[i + 1]?.replace(/\/$/, '') : null;
})();

try {
  process.loadEnvFile(join(root, '.env'));
} catch {
  /* no .env: the key may be in the environment */
}

const exists = (p: string): Promise<boolean> =>
  stat(p).then(
    (s) => s.isFile(),
    () => false,
  );

const service = speech.createDialogueSpeech({
  cache: speech.createFsSpeechCache(cacheDir),
  log: (m: string) => console.log(m),
  dev: true,
  generate: true,
});

await mkdir(outDir, { recursive: true });
const wanted = new Set<string>();
let baked = 0;
let copied = 0;
let generated = 0;
let downloaded = 0;
const missing: string[] = [];

// The runtime lines and the ones still waiting for their voice (`PENDING_VOICE_DIALOGUE`), so a
// bake never leaves them behind and `--prune` never deletes their clips.
for (const [characterId, lines] of Object.entries(bakeableDialogue())) {
  const voice = CHARACTER_VOICES[characterId];
  if (!voice) throw new Error(`no voice for ${characterId} in server/dialogue/voices.mjs`);
  for (const line of new Set(lines)) {
    const key = speech.speechCacheKey({ normalizedText: speech.normalizeText(line), characterId, voice });
    wanted.add(key);
    const out = join(outDir, `${key}.mp3`);
    const label = `${characterId}: ${line.slice(0, 70)}`;
    if (await exists(out)) {
      baked++;
      continue;
    }
    const cached = join(cacheDir, `${key}.mp3`);
    if (await exists(cached)) {
      if (!dryRun) await copyFile(cached, out);
      copied++;
      console.log(`copy      ${label}`);
      continue;
    }
    if (from && !dryRun) {
      const res = await fetch(`${from}/generated-dialogue/${key}.mp3`).catch(() => null);
      const bytes = res?.ok && res.headers.get('content-type')?.startsWith('audio/') ? Buffer.from(await res.arrayBuffer()) : null;
      if (bytes?.length) {
        await writeFile(out, bytes);
        downloaded++;
        console.log(`download  ${label}`);
        continue;
      }
    }
    if (!mayGenerate || dryRun) {
      missing.push(label);
      console.log(`missing   ${label}`);
      continue;
    }
    try {
      await service.synthesize(characterId, line);
      await copyFile(cached, out);
      generated++;
      console.log(`generated ${label}`);
    } catch (err) {
      missing.push(label);
      console.log(`FAILED    ${label} (${(err as Error).message})`);
    }
  }
}

const stale = (await readdir(outDir)).filter((f) => f.endsWith('.mp3') && !wanted.has(f.slice(0, -4)));
if (prune && !dryRun) for (const f of stale) await rm(join(outDir, f));

console.log(
  `\n${wanted.size} lines: ${baked} already baked, ${copied} copied from .cache, ${downloaded} downloaded, ${generated} generated, ${missing.length} missing.` +
    (stale.length ? ` ${stale.length} unused clip(s)${prune && !dryRun ? ' pruned' : ' (--prune to delete)'}.` : ''),
);
if (missing.length) process.exitCode = 1;
