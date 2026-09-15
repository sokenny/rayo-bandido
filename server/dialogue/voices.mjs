/**
 * Who can be voiced, and how. The client names a character (`characterId`); only this server
 * ever learns the ElevenLabs voice behind it.
 *
 * Adding a character: add an entry here, its `ELEVENLABS_<NAME>_VOICE_ID` to `.env.example`, and
 * its id to `DialogueCharacterId` in `src/audio/dialogueVoice.ts`. Bump `version` whenever the
 * voice itself is re-tuned in ElevenLabs without its id changing — every cached line of that
 * character is then generated afresh.
 *
 * A function of `env`, not a constant: `server/index.mjs` loads `.env` after its imports run.
 */
export function characterVoices(env = process.env) {
  return {
    badkala: {
      voiceId: env.ELEVENLABS_BADKALA_VOICE_ID,
      modelId: 'eleven_flash_v2_5',
      outputFormat: 'mp3_44100_128',
      voiceSettings: {
        stability: 0.4,
        similarityBoost: 0.8,
        style: 0.25,
        useSpeakerBoost: true,
        speed: 1.0,
      },
      version: 1,
    },
  };
}
