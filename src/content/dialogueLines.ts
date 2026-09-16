import type { DialogueCharacterId } from '../audio/dialogueVoice';
import { BUHO } from './buho';
import { LOCO_MUSTANG } from './garage';
import { MEDIAS_LINES, TRAPITO_LINES, WASHER_LINES } from './hustlers';
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
  policia: Object.values(POLICE_RADIO_LINES).flat(),
};
