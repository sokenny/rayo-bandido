import { LIGHTNING } from '../config/tuning';
import type { IntroObjectiveId } from '../core/types';
import type { HumanLook } from '../render/scene/env/humanFigure';

/**
 * THE INTRODUCTION — "Return Signal". Everything the first-time drive is made of, as data:
 * where it starts, what BadKala says, when the tutorial helps, the meet it ends at, and the
 * slots the media goes in. `src/sim/intro.ts` runs it; `src/ui/introOverlay.ts` shows it;
 * nothing here is code.
 *
 * WHAT IT IS AND IS NOT. One scripted phone call over three or four minutes of real driving,
 * ending in ordinary Free Roam. It is not a campaign, not a dialogue system and not a cutscene
 * editor: the lines are a flat list with stable ids, the triggers are a few numbers the rules
 * read by name, and there is deliberately no way to branch.
 *
 * THE SHAPE. The player starts on the outskirts, the phone rings, and the city is theirs: no
 * marker to follow. She asks for a drift (anywhere), then for an electric car (any one on the
 * street), and only then marks ONE point — the underground meet under the viaduct's east leg,
 * in the corridor El Búho already lives in. The cars parked there and the woman standing by
 * them are in the game; the clip plays on arrival, and Free Roam follows.
 *
 * Every point below is checked against the city (`tests/intro.test.ts`): the start on a road,
 * the meet drivable and level, the parked cars clear of every column. Headings follow the
 * game's convention (0 faces -z, i.e. north; π faces south; π/2 faces east).
 */

export interface IntroLine {
  /** Stable id. Triggers and tests refer to lines by this, never by text. */
  id: string;
  speaker: 'BADKALA';
  text: string;
  /**
   * Optional voice clip URL. Null: subtitle-only timing. A clip that fails to load is the
   * same as no clip — the line is still shown for `seconds`.
   */
  voice: string | null;
  /** Seconds on screen. Omitted: derived from the text length (`timing`). */
  seconds?: number;
  /** Seconds of silence after the line. Omitted: `timing.gap`. */
  gap?: number;
  /**
   * An instruction for this objective: dropped unsaid if the objective is already done by the
   * time the line would start. Lore lines carry nothing here and are always said.
   */
  instructional?: IntroObjectiveId;
  /** Said only when the world actually has this. Omitted: always. */
  requires?: 'rush' | 'circuit' | 'street' | 'police';
}

const line = (id: string, text: string, extra: Partial<Omit<IntroLine, 'id' | 'text' | 'speaker'>> = {}): IntroLine => ({
  id,
  speaker: 'BADKALA',
  text,
  voice: null,
  ...extra,
});

/** A car parked at the meet: where, which way, and which slot colour it wears. */
export interface IntroParkedCar {
  x: number;
  z: number;
  /** 0 or π only: the collider under it is an axis-aligned box. */
  heading: number;
  slot: number;
}

/**
 * BadKala, as the shared body draws her (`humanFigure.ts`), after the poster: long dark hair
 * with a magenta streak, the visor where the sunglasses are, a cropped black jacket, bare
 * legs, heavy boots, and a magenta glow she stands in. Arms folded: she is waiting, not
 * waving anybody down.
 */
const BADKALA_LOOK: HumanLook = {
  height: 0.98,
  build: 0.92,
  skin: 0xd9a37f,
  hair: 0x1a1012,
  hairAccent: 0xff3df0,
  head: 'fringe',
  coat: 0x1a1020,
  coatLength: 0.05,
  legs: 0xd9a37f,
  boots: 0x14101a,
  pose: 'folded',
  eyes: 'visor',
  eyeColor: 0xff3df0,
  aura: 0xff3df0,
  band: 0xff3df0,
  prop: 'none',
};

export const INTRO = {
  /**
   * PERSISTENCE (`src/core/progress.ts`). Bumping the version replays the intro for everyone
   * who saw an older one; nothing else about the stored record is read.
   */
  persistence: { key: 'rb.intro', version: 2 },

  /** ¥ paid once, on the first completion. 0: completion is its own reward. */
  completionReward: 0,

  /* ------------------------------------------------------------- the opening */

  /**
   * THE OPENING is not a clip: a short fade over the in-engine view of the start with two
   * title lines, skippable at once. The car waits under the deck until it is over.
   */
  opening: {
    seconds: 5,
    title: 'RED BANDIDA',
    sub: 'SEÑAL RESTABLECIDA',
  },

  /* ------------------------------------------------------------- the cinematic */

  /**
   * THE CINEMATIC, "The Meet": an asset entry, not a shot list. It plays when the player pulls
   * into the meet at the end of the drive. `src` is the MP4; null (or a file that fails to load
   * or to play) falls back to `placeholder` — a short in-engine hold at the meet with a title —
   * without blocking play.
   *
   * The clip is played inline (phones), started from the page's own Play flow, and is never
   * relied on to autoplay: a refused `play()` is retried muted, and a second refusal is the
   * placeholder. The player can skip it at any moment.
   */
  cinematic: {
    id: 'the-meet',
    /** Drop the final MP4 at `public/intro/the-meet.mp4` and set this to '/intro/the-meet.mp4'. */
    src: null as string | null,
    /** Seconds to wait for the clip to start playing before giving up on it. */
    loadTimeoutSeconds: 4,
    /** The placeholder: how long the in-engine view holds, and its two title lines. */
    placeholder: {
      seconds: 5,
      title: 'LA JUNTADA',
      sub: 'ABAJO DE LA AUTOPISTA',
    },
    /** Target 8–12 s. Restrained, atmospheric, simple/retro game-compatible visuals. */
    brief:
      "Night under the viaduct's east leg in Bandido Bay: the concrete corridor between the columns north of " +
      'Boulevard Centre, chain-link in the bays, painted columns, junk, a warm amber pool where El Búho stands with ' +
      'his cooler, the radio mast and the water beyond the deck. An underground meet of the Bandidos: a few modified ' +
      "combustion cars parked along the columns (the game's rival-car silhouettes in their slot colours), engines " +
      'ticking, subtle underglow. One of them is drifting in the corridor between the columns, tyre smoke under the ' +
      'deck lights, a small aftermarket device on its dash glowing as the slide charges it. BadKala — long dark hair ' +
      'with a magenta streak, sunglasses at night, cropped black jacket, heavy boots — leans on a car with her arms ' +
      "folded, phone in hand, and looks up as the player's own car pulls in and stops (src/render/scene/carVisual.ts: " +
      'do not redesign it). El Búho nods. A roadside display somewhere in the shot reads ' +
      "'COMBUSTIÓN NO AUTORIZADA'. The camera ends behind the player's car, matching the in-game arrival. " +
      'Restrained, atmospheric, simple/retro game-compatible visuals. No character lip-sync, no explanatory voiceover.',
  },

  /* ------------------------------------------------------------- the phone */

  call: {
    name: 'BADKALA',
    subtitle: 'CANAL CIFRADO',
    state: 'LLAMADA ENTRANTE',
    /** Seconds after the player has control before the phone rings. */
    delaySeconds: 3,
    /** Seconds it rings before connecting on its own. */
    ringSeconds: 2.2,
    /** Milliseconds of vibration on a phone, where the browser allows it. */
    vibrateMs: [180, 120, 180],
    /**
     * Portrait. `src` is tried first (the existing BadKala poster, cropped to the face by the
     * overlay's CSS); a load failure shows `initials` on a plain silhouette instead.
     */
    portrait: { src: '/badkala.webp', initials: 'BK' },
    /** Music level while a voice clip plays, as a fraction of the theme's own volume. */
    duck: 0.45,
  },

  /* ------------------------------------------------------------- the route */

  route: {
    /** The top of Avenida Main, on the service stretch north of the viaduct's north leg. */
    start: { x: -70, z: -224, heading: Math.PI },
    /** Metres driven at which the two lore lines are said, and at which the drift is asked for. */
    loreAtMetres: { batteries: 12, combustion: 60 },
    driftAskedAtMetres: 110,
    /**
     * THE MEET: the corridor under the viaduct's east leg, north of Boulevard Centre and south of
     * El Búho's bay. Turn off the boulevard under the deck at (245, 60) and it is straight ahead.
     */
    meetup: { x: 245, z: 44, radius: 11 },
  },

  /* ------------------------------------------------------------- the meet */

  meetup: {
    /** Parked along the columns, north of El Búho's bay, nose to the deck. */
    cars: [
      { x: 241, z: 15, heading: 0, slot: 1 },
      { x: 241, z: 9.4, heading: 0, slot: 4 },
      { x: 249, z: 12.5, heading: Math.PI, slot: 3 },
    ] as IntroParkedCar[],
    /** Half extents of the box each parked car is solid as (m). */
    carHalf: { x: 0.95, z: 2.25 },
    /** Where BadKala stands: the west column line, between the cars and the bay, facing the arrival. */
    badkala: { x: 241.4, z: 30, heading: Math.PI },
    badkalaLook: BADKALA_LOOK,
  },

  /* ------------------------------------------------------------- the tutorial */

  drift: {
    /** Seconds of a valid drift that count as "you still remember" — brief on purpose. */
    seconds: 0.5,
    /**
     * Charge the meter is topped up to after the first valid drift (and by the assists), so the
     * next stage is ready without touching the global charge economy. A full-reach shot costs
     * `LIGHTNING.cost`; the margin is a missed shot's worth of down payment.
     */
    chargeBonus: Math.min(LIGHTNING.capacity, LIGHTNING.cost + LIGHTNING.minCost),
    /** Seconds without a valid drift before the one hint. */
    hintAfterSeconds: 15,
    /** Seconds without a valid drift before CONTINUAR is offered. */
    assistAfterSeconds: 28,
  },

  ev: {
    /** Seconds the meter may sit unable to pay for a shot before it is topped up again. */
    rechargeAfterSeconds: 4,
  },

  /* ------------------------------------------------------------- the dialogue */

  timing: {
    /** Subtitle-only timing: seconds per character, within [min, max]. Unhurried on purpose. */
    perChar: 0.077,
    minSeconds: 3.1,
    maxSeconds: 10.5,
    /** Default silence after a line (s). */
    gap: 0.9,
  },

  /** Every line, by id. The order they are said in is the rules' business (`src/sim/intro.ts`). */
  lines: [
    // Stage A — back on the radar
    line('a1', 'Mirá quién volvió a encenderse… Pensé que habían enterrado ese auto con vos.', { gap: 1.6 }),
    line('a2', 'Tu Rayo acaba de aparecer en la red de la ciudad. Por ahora la única que lo vio fui yo, pero eso no va a durar.', { gap: 1.2 }),
    line('a3', 'Dale, manejá. Metete en la ciudad; yo te voy poniendo al día.', { gap: 1.4 }),
    // Stage B — entering the city
    line('b1', 'Mientras no estabas, cambiaron los motores por baterías. Casi no queda nadie haciendo ruido.', { gap: 1.4 }),
    line('b2', 'Nosotros seguimos con combustión. Y con un par de modificaciones que no pasan la revisión.', { gap: 1.4 }),
    line('b3', 'La que te importa a vos la llevás en el auto: el módulo del Rayo. Te enseño a usarlo ahora mismo.', { gap: 1.2 }),
    line('b4', 'Son dos pasos: primero lo cargás derrapando, y después le descargás ese rayo encima a un eléctrico.', { gap: 1.3 }),
    // Stage C — first drift
    line('c1', 'Probemos si todavía te acordás. Tomá velocidad, doblá y apretá la barra espaciadora: es el freno de mano. Soltá la cola.', {
      instructional: 'drift',
    }),
    line('c2', 'Ahí está. De costado todavía te entiendo.', { gap: 1.2 }),
    line('c-hint', 'Entrá con un poco de velocidad, doblá y mantené la barra espaciadora un momento. No hace falta dar la vuelta entera.', {
      instructional: 'drift',
    }),
    // Stage D — first EV shutdown
    line('d1', 'Tenés carga. Buscá un eléctrico, cualquiera de los que andan por la calle.', { instructional: 'disable', gap: 0.8 }),
    line('d2', 'Ponelo en la mira y soltá el Rayo.', { instructional: 'disable' }),
    line('d3', 'Eso. Sin fuego, sin explosión. Se le terminó el viaje.', { gap: 1.2 }),
    line('d4', 'Desde lejos cuesta más saber quién fue. De cerca, mejor que no haya una patrulla mirando.', {
      requires: 'police',
      gap: 1.4,
    }),
    // Stage E — the meet
    line('e1', 'Te marqué un punto. Estamos abajo de la autopista, del lado del río. Vení que te presento.', { instructional: 'arrival' }),
    line('e2', 'Listo. Ya estás adentro.', { gap: 1.2 }),
    line('e3', 'Si querés hacer ruido, buscá Rayo Rush.', { requires: 'rush' }),
    line('e4', 'Si querés bajar tiempos, Time Attack.', { requires: 'circuit' }),
    line('e5', 'Y si querés medirte con otros corredores, Street Race.', { requires: 'street' }),
    line('e6', 'Elegí vos. Yo ya sé que volviste.', { gap: 1.6 }),
    line('e7', 'Bienvenido a casa, Rayito.', { gap: 0.6 }),
  ] as IntroLine[],

  objectives: {
    approach: 'Manejá hacia la ciudad.',
    drift: 'Hacé un drift para cargar el Rayo.',
    disable: 'Deshabilitá un eléctrico de la calle.',
    arrival: 'Llegá a la juntada.',
  } as Record<IntroObjectiveId, string>,

  /** What the strip says under the objective, beyond the control hints. */
  notes: {
    recharged: 'CARGA REPUESTA',
    completed: 'INTRO COMPLETADA',
    skipped: 'INTRODUCCIÓN OMITIDA',
  },
};

export type IntroConfig = typeof INTRO;

/** The line with this id. Throws on an unknown id: a typo in a trigger is a bug, not a silence. */
export function introLine(cfg: IntroConfig, id: string): IntroLine {
  for (const l of cfg.lines) if (l.id === id) return l;
  throw new Error(`Rayo Bandido intro: unknown line "${id}"`);
}

/** Seconds a line stays on screen without a voice clip. */
export function introLineSeconds(cfg: IntroConfig, l: IntroLine): number {
  if (l.seconds !== undefined) return l.seconds;
  const t = cfg.timing;
  return Math.min(t.maxSeconds, Math.max(t.minSeconds, l.text.length * t.perChar + 0.8));
}
