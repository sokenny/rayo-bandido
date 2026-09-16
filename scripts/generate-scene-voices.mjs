/**
 * Render every micro-scene line (`src/microScenes/scenes/*.ts`) into a static clip in
 * `public/npc-voice/scenes/`, through the same ElevenLabs path the rest of the game's speech uses
 * (`server/dialogue/speech.mjs`, voice settings in `server/dialogue/voices.mjs`).
 *
 *   node scripts/generate-scene-voices.mjs                  only the clips that are missing
 *   node scripts/generate-scene-voices.mjs --force          all of them again
 *   node scripts/generate-scene-voices.mjs --scene bus-stop-conversation
 *   node scripts/generate-scene-voices.mjs --dry-run        say what it would do and stop
 *
 * Needs `ELEVENLABS_API_KEY` in `.env`. The key stays in this process; the game only ever fetches
 * the resulting mp3 files, and nothing about a micro-scene reaches the voice API at runtime.
 *
 * A LINE WHOSE VOICE PROFILE HAS NO RECORDING AND NO STAND-IN IS SKIPPED, LOUDLY. That is the
 * point of the profile indirection: the two female parts at the bus stop keep their text and their
 * speaker assignments, are reported here every run, and are never quietly generated in the male
 * placeholder's voice. Add the voice to `server/dialogue/voices.mjs`, point the profile at it in
 * `src/microScenes/voices.ts`, and run this again.
 */
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDialogueSpeech, createFsSpeechCache } from '../server/dialogue/speech.mjs';
import { MICRO_SCENES, sceneLines } from '../src/microScenes/registry.ts';
import { VOICE_PROFILES, resolvedVoice } from '../src/microScenes/voices.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'public', 'npc-voice', 'scenes');
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');
const durationsOnly = process.argv.includes('--durations');
const only = (() => {
  const i = process.argv.indexOf('--scene');
  return i >= 0 ? process.argv[i + 1] : null;
})();

try {
  process.loadEnvFile(join(root, '.env'));
} catch {
  /* no .env: the key may be in the environment */
}

/* ------------------------------------------------------------------ what to render */

const jobs = [];
const skipped = [];
for (const scene of MICRO_SCENES) {
  if (only && scene.id !== only) continue;
  for (const line of sceneLines(scene)) {
    const profileId = line.voice ?? scene.actors.find((a) => a.id === line.speaker)?.voice;
    const profile = profileId ? VOICE_PROFILES[profileId] : undefined;
    const heard = profileId ? resolvedVoice(profileId) : null;
    if (!profile || !heard) {
      skipped.push({ scene: scene.id, clip: line.clip, profile: profileId ?? '(none)', text: line.text });
      continue;
    }
    // The delivery direction is performed, never read out: the line's own if it has one, else the
    // profile's. A micro-scene is overheard, so nothing here is ever `[shouting]` by default.
    const direction = line.direction ?? profile.direction ?? '';
    jobs.push({
      scene: scene.id,
      clip: line.clip,
      character: heard.characterId,
      placeholder: heard.id !== profile.id,
      profile: profile.id,
      text: `${direction} ${line.text}`.trim(),
      plain: line.text,
    });
  }
}

console.log(`${jobs.length} lines to render, ${skipped.length} skipped for want of a voice.`);
if (skipped.length > 0) {
  const profiles = [...new Set(skipped.map((s) => s.profile))];
  console.warn('');
  console.warn(`MISSING VOICES: ${profiles.join(', ')}`);
  for (const s of skipped) console.warn(`  skip ${s.clip}  [${s.profile}]  ${s.text}`);
  console.warn('');
  console.warn('These lines are kept in the scene and are never generated in another voice. To record them:');
  console.warn('  1. add the voice id to CHARACTER_VOICES in server/dialogue/voices.mjs');
  console.warn('  2. add its DialogueCharacterId to src/audio/dialogueVoice.ts');
  console.warn('  3. set `characterId` on the profile in src/microScenes/voices.ts');
  console.warn('  4. run this script again');
  console.warn('');
}
const placeholders = jobs.filter((j) => j.placeholder);
if (placeholders.length > 0) {
  const by = [...new Set(placeholders.map((j) => `${j.profile} -> ${j.character}`))];
  console.warn(`PLACEHOLDER VOICES (${placeholders.length} lines): ${by.join(', ')}`);
}

if (dryRun) {
  for (const j of jobs) console.log(`would write ${j.clip}.mp3  [${j.profile}]  ${j.plain}`);
  process.exit(skipped.length > 0 ? 0 : 0);
}

/* ------------------------------------------------------------------ durations */

/**
 * Seconds of audio in an MP3, from its first frame header: ElevenLabs renders constant bitrate, so
 * bytes of audio over bits per second is the length to within a frame. No decoder, no dependency.
 */
function mp3Seconds(buf) {
  let i = 0;
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    i = 10 + ((buf[6] & 0x7f) << 21 | (buf[7] & 0x7f) << 14 | (buf[8] & 0x7f) << 7 | (buf[9] & 0x7f));
  }
  for (; i < buf.length - 4; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const mpeg1 = (buf[i + 1] & 0x18) === 0x18;
    const index = buf[i + 2] >> 4;
    const table = mpeg1
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const kbps = table[index];
    if (!kbps) continue;
    return ((buf.length - i) * 8) / (kbps * 1000);
  }
  return 0;
}

/** Measure every rendered clip and write `src/microScenes/clipDurations.ts` for the director. */
async function writeDurations() {
  const files = (await readdir(outDir).catch(() => [])).filter((f) => f.endsWith('.mp3')).sort();
  const lines = [];
  for (const f of files) {
    const seconds = mp3Seconds(await readFile(join(outDir, f)));
    if (seconds > 0) lines.push(`  ${f.slice(0, -4)}: ${seconds.toFixed(3)},`);
  }
  const text = [
    '/**',
    ' * GENERATED by `scripts/generate-scene-voices.mjs` from the rendered clips. Do not edit.',
    ' * Seconds of audio per clip id, at playback rate 1.',
    ' */',
    'export const CLIP_SECONDS: Record<string, number> = {',
    ...lines,
    '};',
    '',
  ].join('\n');
  await writeFile(join(root, 'src', 'microScenes', 'clipDurations.ts'), text, 'utf8');
  console.log(`measured ${lines.length} clips into src/microScenes/clipDurations.ts`);
}

if (durationsOnly) {
  await writeDurations();
  process.exit(0);
}

/* ------------------------------------------------------------------ render */

const cacheDir = await mkdtemp(join(tmpdir(), 'scene-voice-'));
const speech = createDialogueSpeech({ cache: createFsSpeechCache(cacheDir), log: (m) => console.log(m), dev: true });
await mkdir(outDir, { recursive: true });

let failed = 0;
let written = 0;
try {
  for (const job of jobs) {
    const target = join(outDir, `${job.clip}.mp3`);
    if (!force) {
      const exists = await stat(target).then((s) => s.isFile(), () => false);
      if (exists) {
        console.log(`skip ${job.clip} (exists)`);
        continue;
      }
    }
    try {
      const { key } = await speech.synthesize(job.character, job.text);
      await copyFile(join(cacheDir, `${key}.mp3`), target);
      const { size } = await stat(target);
      written++;
      console.log(`wrote ${job.clip}.mp3 (${(size / 1024).toFixed(1)} KB)  ${job.plain}`);
    } catch (err) {
      failed++;
      console.error(`FAILED ${job.clip}: ${err?.message || err}`);
    }
  }
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}

console.log(`${written} written, ${failed} failed, ${skipped.length} without a voice.`);
await writeDurations();
process.exit(failed ? 1 : 0);
