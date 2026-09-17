/**
 * Who can be voiced, and how. The client names a character (`characterId`); only this server
 * ever learns the ElevenLabs voice behind it.
 *
 * Adding a character: add an entry here and its id to `DialogueCharacterId` in
 * `src/audio/dialogueVoice.ts`. Bump `version` whenever the voice itself is re-tuned in ElevenLabs
 * without its id changing — every cached line of that character is then generated afresh.
 *
 * Voice ids are not secrets, so they live here; the only secret is `ELEVENLABS_API_KEY`.
 */
// eleven_v3: the lines are generated ahead of time, so its speed does not matter and its delivery
// does — statements land as statements. Its stability takes only 0 / 0.5 / 1 (creative / natural /
// robust). Picked by ear against flash v2.5 and multilingual v2 on BadKala's intro.
const voice = (voiceId) => ({
  voiceId,
  modelId: 'eleven_v3',
  languageCode: 'es',
  outputFormat: 'mp3_44100_128',
  voiceSettings: {
    stability: 0.5,
    similarityBoost: 0.8,
    style: 0,
    useSpeakerBoost: true,
    speed: 1.0,
  },
  version: 1,
});

/**
 * The police radio (`src/audio/policeRadio.ts`). The clone is CLEAN on purpose — no radio baked
 * in — so the walkie-talkie is the client's FX chain, and these settings only make the delivery
 * exaltada: multilingual v2 because v3's stability is locked to 0 / 0.5 / 1, low stability for an
 * agitated, variable read, high style for expression.
 */
const radioVoice = (voiceId) => ({
  voiceId,
  modelId: 'eleven_multilingual_v2',
  outputFormat: 'mp3_44100_128',
  voiceSettings: {
    stability: 0.3,
    similarityBoost: 0.8,
    style: 0.75,
    useSpeakerBoost: true,
    speed: 1.0,
  },
  version: 1,
});

/**
 * Street NPCs yelling at a passing car (`src/audio/ambientVoice.ts`). Never asked for at runtime:
 * `scripts/generate-npc-voices.mjs` renders their few lines once into `public/npc-voice/`. v3 at
 * "creative" stability so the `[shouting]` direction lands; 64 kbps is plenty for a two-second
 * shout heard through a lowpass from across the street.
 */
const shoutVoice = (voiceId) => ({
  voiceId,
  modelId: 'eleven_v3',
  languageCode: 'es',
  outputFormat: 'mp3_44100_64',
  voiceSettings: {
    stability: 0,
    similarityBoost: 0.8,
    style: 0,
    useSpeakerBoost: true,
    speed: 1.0,
  },
  version: 1,
});

export const CHARACTER_VOICES = {
  'npc-masculino-1': shoutVoice('9JOGcDYAYTmowtTJuqVV'),
  // Micro-scene conversations (`src/microScenes/voices.ts`): overheard, not shouted, so the natural
  // v3 settings rather than the street's creative ones. Rendered ahead of time like the shouts.
  'npc-femenino-1': voice('dvhhbmWu6suM0Vq99t7I'),
  badkala: voice('iHaDFejiMLsI0XjCnQVt'),
  buho: voice('bew2VwXQAJqJ81jujT8j'),
  'loco-mustang': voice('tRJ3Kfo9sezJtxC5JySt'),
  // The street hustlers (`src/ui/hustlerOverlay.ts`): trapitos and washers in one voice, and the
  // villero cast — the sock sellers first — in another that talks the same way.
  trapito: voice('hcoTXwGtTbk7rmbQW4G0'),
  villero: voice('JmUKrnhUnPYfwSKGSEFT'),
  // The travestis working the Bosques' loop and the city's dark corners.
  travesti: voice('KEowAojY5C8EodzPy9Ic'),
  policia: radioVoice('mZTof7eSbESeUWP6fuMw'),
};
