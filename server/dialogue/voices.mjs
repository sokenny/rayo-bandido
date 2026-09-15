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

export const CHARACTER_VOICES = {
  badkala: voice('iHaDFejiMLsI0XjCnQVt'),
  buho: voice('bew2VwXQAJqJ81jujT8j'),
  'loco-mustang': voice('tRJ3Kfo9sezJtxC5JySt'),
  trapito: voice('vJzdJ8zgnM2pmrSLXSPG'),
};
