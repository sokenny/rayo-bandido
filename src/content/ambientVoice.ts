/**
 * What the street yells at the player's car (`src/audio/ambientVoice.ts`): drivers in traffic and
 * the people waiting at bus stops. One voice for everyone for now, `npc-masculino-1`.
 *
 * The clips are static files in `public/npc-voice/<id>.mp3`, rendered once by
 * `scripts/generate-npc-voices.mjs` from exactly these lines. Nothing here reaches the voice API at
 * runtime. Changing a line means running the script again.
 *
 * No imports on purpose: the generation script loads this file straight into Node.
 */

export const AMBIENT_VOICE_CHARACTER = 'npc-masculino-1';

export const AMBIENT_CLIPS = {
  driver_toretto: '¡Dale, Toretto, pasá!',
  driver_turn_signal: '¡Poné el guiño, animal!',
  driver_mirror: '¡Casi me arrancás el espejo, pelotudo!',
  driver_hurry: '¡¿A dónde vas tan apurado, fantasma?!',
  driver_learn: '¡Aprendé a manejar, enfermo!',
  driver_crash_concha: '¡Pero la concha de tu madre!',
  driver_crash_pario: '¡La puta que te parió, pelotudo!',
  driver_crash_forro: '¡Forro de mierda, me rompiste el auto!',
  driver_crash_hijo: '¡Hijo de puta, mirá lo que hiciste!',
  driver_crash_bajate: '¡Bajate si tenés huevos, la re puta madre!',
  bus_stop_coming: '¡Uh, mirá cómo viene este!',
  bus_stop_record: '¡Grabalo, grabalo!',
  bus_stop_crash_prediction: '¡Este se mata acá adelante!',
  bus_stop_schumacher: '¡Pará, Schumacher, estamos esperando el bondi!',
  bus_stop_ray: '¡Ese es el del Rayo, boludo!',
} as const;

export type AmbientClipId = keyof typeof AMBIENT_CLIPS;

export function ambientClipUrl(id: AmbientClipId): string {
  return `/npc-voice/${id}.mp3`;
}

/** What happened, as the street saw it. Each picks from its own few lines. */
export type AmbientTrigger =
  /** Driver: blown past at a big closing speed. */
  | 'driverFast'
  /** Driver: shaved past alongside (`nearMiss`). */
  | 'driverClose'
  /** Driver: a near miss that finished in front of its bonnet. */
  | 'driverCut'
  /** Driver: a light touch down the side. */
  | 'driverSwipe'
  /** Driver: hit properly. */
  | 'driverHit'
  /** Bus stop: the car tearing past. */
  | 'stopFast'
  /** Bus stop: a drift in front of them. */
  | 'stopDrift'
  /** Bus stop: a crash nearby. */
  | 'stopCrash'
  /** Bus stop: the car going by with the police behind it. */
  | 'stopPursuit'
  /** Bus stop: the Rayo fired where they could see it. */
  | 'stopRayo';

export const AMBIENT_LINES: Record<AmbientTrigger, readonly AmbientClipId[]> = {
  driverFast: ['driver_toretto', 'driver_hurry'],
  driverClose: ['driver_mirror', 'driver_toretto', 'driver_hurry'],
  driverCut: ['driver_turn_signal', 'driver_learn'],
  driverSwipe: ['driver_mirror', 'driver_learn', 'driver_crash_pario', 'driver_crash_concha'],
  // Hit properly, a driver mostly just curses.
  driverHit: ['driver_crash_concha', 'driver_crash_pario', 'driver_crash_forro', 'driver_crash_hijo', 'driver_crash_bajate', 'driver_learn'],
  stopFast: ['bus_stop_coming', 'bus_stop_crash_prediction', 'bus_stop_schumacher'],
  stopDrift: ['bus_stop_record', 'bus_stop_coming'],
  stopCrash: ['bus_stop_record', 'bus_stop_crash_prediction'],
  stopPursuit: ['bus_stop_ray', 'bus_stop_record', 'bus_stop_coming'],
  stopRayo: ['bus_stop_ray', 'bus_stop_record'],
};
