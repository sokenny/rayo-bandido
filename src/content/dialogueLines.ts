import type { DialogueCharacterId } from '../audio/dialogueVoice';
import { BUHO } from './buho';
import { LOCO_MUSTANG } from './garage';
import { MEDIAS_LINES, TRAPITO_LINES, TRAVESTI_LINES, WASHER_LINES } from './hustlers';
import { INTRO } from './intro';
import { POLICE_RADIO_LINES } from './policeRadio';

/**
 * EVERY LINE THE GAME ASKS THE SERVER TO SPEAK (`/api/dialogue/speech`), by voice.
 *
 * Each one has a clip baked into `public/dialogue/` (`npm run dialogue:voices`), and a deployed
 * server never generates (`server/dialogue/speech.mjs`), so a line missing here is a line that
 * plays silent in production. `tests/dialogueClips.test.ts` fails until every line has its clip.
 *
 * Street shouts and micro-scenes are not here: they are static files of their own
 * (`public/npc-voice/`).
 */
export const RUNTIME_DIALOGUE: Partial<Record<DialogueCharacterId, readonly string[]>> = {
  // The overlay voices only the lines with no recording of their own (`introOverlay.ts`).
  badkala: INTRO.lines.filter((l) => l.tts && !l.voice).map((l) => l.text),
  buho: [...BUHO.greetings, ...BUHO.remarks, ...BUHO.broke, ...BUHO.busy],
  'loco-mustang': [...LOCO_MUSTANG.greetings, ...LOCO_MUSTANG.soon],
  trapito: [...Object.values(TRAPITO_LINES).flat(), ...Object.values(WASHER_LINES).flat()],
  villero: Object.values(MEDIAS_LINES).flat(),
  travesti: Object.values(TRAVESTI_LINES).flat(),
  policia: Object.values(POLICE_RADIO_LINES).flat(),
};

/**
 * LINES WRITTEN BUT NOT VOICED YET. They are said on screen (subtitles, the workshop's card) and
 * asked of the server like any other line, but no clip is baked for them, so they play silent:
 * `speakDialogue` swallows the refusal and the subtitle carries on (`src/audio/dialogueVoice.ts`).
 *
 * TODO(voices): Loco Mustang's workshop lines (`docs/GARAGE_PLAN.md` D6, approved) need a run of
 * `npm run dialogue:voices` on a machine with `ELEVENLABS_API_KEY` in `.env` — it bakes these as
 * well as the runtime ones. Then move each pool up into `RUNTIME_DIALOGUE`, where
 * `tests/dialogueClips.test.ts` holds it to having its clip, and empty this.
 */
export const PENDING_VOICE_DIALOGUE: Partial<Record<DialogueCharacterId, readonly string[]>> = {
  'loco-mustang': [
    ...LOCO_MUSTANG.openGreetings,
    ...LOCO_MUSTANG.welcome,
    ...LOCO_MUSTANG.installed,
    ...LOCO_MUSTANG.broke,
    ...LOCO_MUSTANG.doorShut,
    ...LOCO_MUSTANG.goodbye,
  ],
};

/** Everything `npm run dialogue:voices` bakes: the runtime lines and the ones waiting for a voice. */
export function bakeableDialogue(): Partial<Record<DialogueCharacterId, readonly string[]>> {
  const out: Partial<Record<DialogueCharacterId, string[]>> = {};
  for (const table of [RUNTIME_DIALOGUE, PENDING_VOICE_DIALOGUE]) {
    for (const [id, lines] of Object.entries(table) as Array<[DialogueCharacterId, readonly string[]]>) {
      (out[id] ??= []).push(...lines);
    }
  }
  return out;
}
