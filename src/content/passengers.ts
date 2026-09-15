import type { PassengerPreferenceKind, PassengerReaction, PassengerStop, PassengerTripRange } from '../core/types';
import { PASSENGER } from '../config/tuning';

/**
 * THE PASSENGER CATALOGUE: who can be picked up, and everything they will say.
 *
 * DATA, NOT LOGIC. The rules (`src/sim/passenger.ts`) know six preference kinds and eight
 * things a passenger can react to, and that is all they know. A character is a bundle of those
 * plus text: adding one means adding an entry here, never touching the rules. Every line a ride
 * can need is authored in advance and chosen before the ride starts — there is no generation at
 * runtime, and the game never waits on anything to say the next thing.
 *
 * IDENTITY VERSUS RIDE. `PassengerDef` is the character: the same person, the same rules, the
 * same voice every time they get in. Where they are picked up and taken, which opening variant
 * plays and how the ride goes are per-ride facts (`PassengerTrip`, `PassengerState`) that leave
 * this file alone. A destination named in a line is written as `{destination}` and resolved
 * from the trip actually chosen, so nobody asks to be taken somewhere they are not going.
 *
 * WHAT A CHARACTER MAY ASK FOR. Two preferences at most, never a contradictory pair, and never
 * anything but the six kinds below — "neutralise an EV" always means the Rayo and never the
 * bumper. `validatePassengerCatalog` enforces every one of those at test time, together with
 * the lines each preference obliges the character to have, so a fourth passenger that forgets
 * their collision line fails a test rather than a ride.
 *
 * VOICE. Subtitles: one or two short sentences, sentence case, read at a glance while driving.
 * The player never answers — nothing here is a question that waits for one. The lines are in
 * rioplatense Spanish (vos, the swearing included) and cheeky with it, the way El Búho's are
 * (`src/content/buho.ts`); the chrome round them — names, taglines, the rules — stays English.
 */

export interface PassengerPreference {
  kind: PassengerPreferenceKind;
  /** Scales how much this rule moves the mood. 1 is as tuned. */
  weight: number;
  /** For `slow`: the limit. For `fast`: the threshold. km/h. */
  kmh?: number;
}

export interface PassengerFarewells {
  high: readonly string[];
  medium: readonly string[];
  low: readonly string[];
}

export interface PassengerDef {
  /** Stable id: the catalogue's key, and what a ride record names. Never reused. */
  id: string;
  name: string;
  /** Under the name in the HUD ("DEADAIR · UNDERGROUND STREAMER"). */
  tagline: string;
  /** For authors: who this person is. Not shown. */
  personality: string;
  background: string;
  /** Which portrait to draw (`src/ui/portraits.ts`). */
  portrait: string;
  /** For authors: why they need a ride. Not shown; the opening says it in their own words. */
  reason: string;
  /** Stops they may be picked up at / taken to: any stop carrying any of these tags. */
  pickupTags: readonly string[];
  destinationTags: readonly string[];
  /** One or two. See `validatePassengerCatalog` for what may be combined. */
  preferences: readonly PassengerPreference[];
  /** Said on boarding. At least two; one is chosen at the offer. */
  openings: readonly string[];
  /** Said right after the opening: where to, and how. `{destination}` is the stop's label. */
  brief: string;
  /** Incidental lines, by the thing that happened. Each preference obliges some of these. */
  reactions: Partial<Record<PassengerReaction, readonly string[]>>;
  /** Said as the car first reaches the destination zone. */
  arrival: string;
  farewell: PassengerFarewells;
}

/** Longest a subtitle may be. Two short sentences; anything more is a paragraph, not a line. */
export const MAX_LINE_CHARS = 150;

/** The pairs that cannot both be asked for. Checked in both orders. */
const CONTRADICTIONS: ReadonlyArray<readonly [PassengerPreferenceKind, PassengerPreferenceKind]> = [
  ['slow', 'fast'],
  ['noDrift', 'drift'],
  ['noRayo', 'rayo'],
];

/** What each preference obliges a character to be able to say. `collision` is owed by everyone. */
const OBLIGED_REACTIONS: Record<PassengerPreferenceKind, readonly PassengerReaction[]> = {
  slow: ['tooFast', 'goodSpeed'],
  fast: ['goodSpeed', 'tooSlow'],
  noDrift: ['driftBad'],
  drift: ['driftGood'],
  noRayo: ['rayoBad'],
  rayo: ['rayoGood'],
};

const KINDS: readonly PassengerPreferenceKind[] = ['slow', 'fast', 'noDrift', 'drift', 'noRayo', 'rayo'];

/**
 * The compact HUD summary of one rule, in the chrome's shouting case. What the player is held
 * to is never only in the flavour text: this is printed next to the portrait for the whole ride.
 */
export function preferenceLabel(pref: PassengerPreference): string {
  switch (pref.kind) {
    case 'slow':
      return `STAY UNDER ${Math.round(pref.kmh ?? 0)} KM/H`;
    case 'fast':
      return `DRIVE FAST · ${Math.round(pref.kmh ?? PASSENGER.speed.fastKmh)}+ KM/H`;
    case 'noDrift':
      return 'NO DRIFTING';
    case 'drift':
      return 'SHOW ME DRIFTS';
    case 'noRayo':
      return 'NO RAYO ON EVs';
    case 'rayo':
      return 'RAYO THE EVs';
    default:
      return '';
  }
}

/** `{destination}` in a line becomes the label of the stop the trip actually goes to. */
export function resolveLine(text: string, destination: string): string {
  return text.replace(/\{destination\}/g, destination);
}

/**
 * Everything that must hold for the catalogue to be playable, as a list of complaints. Empty
 * means fine. Run at test time (`tests/passenger.test.ts`), so a bad entry fails a test rather
 * than a ride. `stops` is optional: without it the location checks are skipped. `range` is the
 * world's trip range (`ArenaLayout.passengerTrip`), `PASSENGER.offer` when it names none.
 */
export function validatePassengerCatalog(
  catalog: readonly PassengerDef[],
  stops?: readonly PassengerStop[] | null,
  range: PassengerTripRange = PASSENGER.offer,
): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const check = (ok: boolean, message: string): void => {
    if (!ok) problems.push(message);
  };
  const lineOk = (text: string, where: string): void => {
    check(text.trim().length > 0, `${where}: empty line`);
    check(text.length <= MAX_LINE_CHARS, `${where}: line over ${MAX_LINE_CHARS} chars`);
  };

  for (const p of catalog) {
    const who = p.id || '(no id)';
    check(!!p.id, `passenger with no id`);
    check(!ids.has(p.id), `${who}: duplicate id`);
    ids.add(p.id);
    check(!!p.name, `${who}: no name`);
    check(!!p.portrait, `${who}: no portrait`);

    /* ---------------------------------------------------------- preferences */

    check(p.preferences.length >= 1 && p.preferences.length <= 2, `${who}: needs one or two preferences`);
    const kinds = p.preferences.map((pref) => pref.kind);
    for (const pref of p.preferences) {
      check(KINDS.includes(pref.kind), `${who}: unknown preference "${pref.kind}"`);
      check(pref.weight > 0, `${who}: preference "${pref.kind}" needs a positive weight`);
      if (pref.kind === 'slow') check((pref.kmh ?? 0) > 0, `${who}: a "slow" preference needs a km/h limit`);
    }
    check(new Set(kinds).size === kinds.length, `${who}: the same preference twice`);
    for (const [a, b] of CONTRADICTIONS) {
      check(!(kinds.includes(a) && kinds.includes(b)), `${who}: asks for both "${a}" and "${b}"`);
    }

    /* ---------------------------------------------------------- lines */

    check(p.openings.length >= 2, `${who}: needs at least two openings`);
    p.openings.forEach((text, i) => lineOk(text, `${who}: opening ${i}`));
    lineOk(p.brief, `${who}: brief`);
    lineOk(p.arrival, `${who}: arrival`);
    for (const tier of ['high', 'medium', 'low'] as const) {
      check(p.farewell[tier].length >= 1, `${who}: needs a ${tier} farewell`);
      p.farewell[tier].forEach((text, i) => lineOk(text, `${who}: ${tier} farewell ${i}`));
    }
    const owed = new Set<PassengerReaction>(['collision']);
    for (const kind of kinds) for (const r of OBLIGED_REACTIONS[kind] ?? []) owed.add(r);
    for (const r of owed) {
      const lines = p.reactions[r];
      check(!!lines && lines.length >= 1, `${who}: preference set obliges a "${r}" reaction`);
    }
    for (const [r, lines] of Object.entries(p.reactions)) {
      (lines ?? []).forEach((text, i) => lineOk(text, `${who}: reaction ${r} ${i}`));
    }

    /* ---------------------------------------------------------- places */

    check(p.pickupTags.length >= 1, `${who}: no pickup tags`);
    check(p.destinationTags.length >= 1, `${who}: no destination tags`);
    if (stops && stops.length > 0) {
      const has = (tag: string): boolean => stops.some((s) => s.tags.includes(tag));
      for (const tag of p.pickupTags) check(has(tag), `${who}: no stop carries pickup tag "${tag}"`);
      for (const tag of p.destinationTags) check(has(tag), `${who}: no stop carries destination tag "${tag}"`);
      // At least one trip of a sensible length has to exist, or the pin would go up for a
      // ride the planner cannot make.
      let trips = 0;
      for (const a of stops) {
        if (!a.tags.some((t) => p.pickupTags.includes(t))) continue;
        for (const b of stops) {
          if (b === a || !b.tags.some((t) => p.destinationTags.includes(t))) continue;
          const d = Math.hypot(b.x - a.x, b.z - a.z);
          if (d >= range.minTrip && d <= range.maxTrip) trips++;
        }
      }
      check(trips > 0, `${who}: no pickup/destination pair between ${range.minTrip} and ${range.maxTrip} m apart`);
    }
  }
  return problems;
}

/* ================================================================== the catalogue */

/**
 * Three to start with. Each asks for two things that can be read off the HUD, and none of them
 * asks for a crash: Mika wants speed and slides but flinches at a hit, Vera wants the opposite,
 * Nico wants clean Rayo shots and a steady car. Add a fourth by adding an entry.
 */
export const PASSENGERS: readonly PassengerDef[] = [
  {
    id: 'mika',
    name: 'Mika',
    tagline: 'DEADAIR · UNDERGROUND STREAMER',
    personality: 'Playful, sarcastic, thrill-seeking. The ride is content; the chat is watching.',
    background: 'Streams from the back seats of strangers\' cars under the handle DeadAir. Her audience tips for style, not for wreckage.',
    portrait: 'mika',
    reason: 'Chasing a live segment somewhere with better light.',
    pickupTags: ['downtown', 'market'],
    destinationTags: ['waterfront', 'outskirts', 'downtown'],
    preferences: [
      { kind: 'fast', weight: 1, kmh: 110 },
      { kind: 'drift', weight: 1 },
    ],
    openings: [
      'Estoy en vivo, así que no me hagas quedar como una boluda. Dale gas, pero el auto entero.',
      'El chat dice que el último chofer era un plomo. Demostrales que se equivocan, ¿dale?',
      'DeadAir, trescientos mirando y yo en tu asiento de atrás. Cero presión, bombón.',
    ],
    brief: 'Llevame a {destination}. Rápido, de costado y sin dejar chapa en el asfalto. El chat se da cuenta.',
    reactions: {
      goodSpeed: ['¡Esto sí es contenido, papá!', 'El chat está re manija. No aflojes.', 'Por fin alguien que sabe dónde queda el acelerador.'],
      tooSlow: ['¿Esto es un paseo de jubilados? El chat se está yendo.', '¿Vamos por la panorámica o me llevás al colegio?', 'El pedal de la derecha, amor. Pisalo, no lo acaricies.'],
      driftGood: ['¡Clipeá eso! ¡CLIPEÁ ESO!', '¡De costado, la puta madre! Eso va derecho al resumen.', 'Mirá vos. Con eso te ganaste mi número. Bah, el del chat.'],
      collision: ['Eso es un choque, no contenido, pelotudo.', 'Limpio, te dije. El chat se está cagando de risa.', 'Auch. Los puntos de estilo no sobreviven a eso.'],
    },
    arrival: 'Es acá. Estacioná donde la cámara lo vea, que quiero que se luzca.',
    farewell: {
      high: ['El mejor stream de la semana. El chat pide tu Instagram, y yo también.', 'Eso fue un show. La propina la juntó el chat, posta.'],
      medium: ['Stream decente. La próxima, más de costado y menos de abuela.', 'Zafa. Un par de momentos buenos. El chat te pone un seis.'],
      low: ['Aire muerto todo el viaje. Qué ironía, ¿no?', 'He visto más emoción en un ascensor, boludo.'],
    },
  },
  {
    id: 'vera',
    name: 'Vera',
    tagline: 'NIGHT-SHIFT TECHNICIAN',
    personality: 'Dry humour, tired, direct. Wants nothing to happen.',
    background: 'Twelve-hour nights fixing the machines that keep the district lit. Has strong views on things that break.',
    portrait: 'vera',
    reason: 'Going home after a double shift, and wants to arrive asleep.',
    pickupTags: ['industrial', 'downtown'],
    destinationTags: ['residential', 'market'],
    preferences: [
      { kind: 'slow', weight: 1, kmh: 80 },
      { kind: 'noDrift', weight: 1 },
    ],
    openings: [
      'Doce horas arreglando máquinas. No me hagas bajar de otra rota, te lo pido por favor.',
      'A casa. Despacito. Si me duermo, tomalo como un elogio.',
      'Doce horas, cuatro inversores fritos y una sola yo. Llevame a casa y no me hables.',
    ],
    brief: 'Llevame a {destination}. Por debajo de ochenta y con las ruedas apuntando para donde vamos. Nada de derrapar.',
    reactions: {
      goodSpeed: ['Esto está bien. Seguí así y te presento a mi hermana.', 'Así se maneja, carajo. Me podría dormir.', 'Suavecito. Gracias, en serio.'],
      tooFast: ['Frená. No sobreviví a un turno doble para morirme en un hatchback.', 'Ochenta. Te dije ochenta, no ciento ochenta.', 'Muy rápido. Mi café y yo te odiamos.'],
      driftBad: ['No. Nada de derrapar. Te lo dije, la concha de la lora.', '¿Por qué el auto va de costado? ¿Por qué el auto va de costado?', 'Justo lo único que te pedí que no hicieras. Genio.'],
      collision: ['Espectacular. Otra cosa rota. Justo lo que necesitaba.', 'Arreglo máquinas para vivir. Esta no te la arreglo ni en pedo.', '¿Era necesario, pedazo de animal?'],
    },
    arrival: 'Esa es mi calle. Dejame por acá. Despacio, ¿eh?',
    farewell: {
      high: ['Casi me duermo. Es lo mejor que te puedo decir. Tomá.', 'Suave todo el camino. Tenés permiso para volver a llevarme.'],
      medium: ['Llegamos. Casi enteros. Gracias.', 'Aceptable. No es sarcasmo. Estoy demasiado cansada para el sarcasmo.'],
      low: ['La próxima me tomo el bondi. Es más lento, pero nunca derrapó.', 'Te pedí una sola cosa. Una. Andá a cagar.'],
    },
  },
  {
    id: 'nico',
    name: 'Nico',
    tagline: 'STATIC · ELECTRONICS SCAVENGER',
    personality: 'Conspiratorial, mischievous, delighted whenever corporate infrastructure goes dark.',
    background: 'Strips dead autonomous EVs for parts and sells what the corporations would rather nobody had. Carries the good stuff in a padded case.',
    portrait: 'nico',
    reason: 'Moving a case of delicate salvage across town before anyone notices it is missing.',
    pickupTags: ['outskirts', 'industrial', 'waterfront'],
    destinationTags: ['market', 'downtown', 'industrial'],
    preferences: [
      { kind: 'rayo', weight: 1 },
      { kind: 'noDrift', weight: 1 },
    ],
    openings: [
      'EVs corporativos: si tenés tiro limpio, bajalos. Pero manejá derecho, que lo que llevo vale más que mi departamento.',
      'Me dicen Static. No preguntes qué hay en la valija. Sí avisame si ves uno de sus autos.',
      'Cada EV de esos es un buchón con ruedas. Cuantos menos anden, mejor dormimos todos.',
    ],
    brief: 'Llevame a {destination}. Fundí cualquier EV corporativo que tengas a tiro. Y nada de derrapar: la valija no va de costado.',
    reactions: {
      rayoGood: ['¡Ja! Apagado. Un buchón menos.', 'Tiro limpio. A algún garca se le acaba de apagar el tablero.', '¡Eso, hermano! ¡Eso es lo que quiero ver!'],
      driftBad: ['¡Derecho! ¡La valija! ¿Vos sabés lo que hay en la valija?', 'De costado es malo para la mercadería, ¿entendés?', 'Cada derrape es un componente que no voy a poder vender. Me estás fundiendo.'],
      collision: ['¡Así no! ¡Con el rayo, no con el paragolpes!', 'Eso fue un choque, y los choques tienen testigos. Y la yuta.', 'La valija. Pensá en la valija, por el amor de Dios.'],
    },
    arrival: 'Es acá. Metete despacito y en silencio, como si no existiéramos.',
    farewell: {
      high: ['Pulso firme y buena puntería. Estás en mi lista. La buena.', 'Dos cámaras menos en la calle y la valija sin un rayón. Tomá, te lo ganaste.'],
      medium: ['La valija está entera. Faltó un poco más de oscuridad en el camino.', 'Bien. Nada memorable. En mi rubro, eso es un elogio.'],
      low: ['La valija hace ruido. Si algo se rompió, tengo tu patente.', 'Te dije derecho. Te dije limpio. Rezá que no se haya roto nada.'],
    },
  },
];

/** Look a character up by id. Null for an id the catalogue does not carry. */
export function passengerById(catalog: readonly PassengerDef[], id: string): PassengerDef | null {
  for (let i = 0; i < catalog.length; i++) if (catalog[i].id === id) return catalog[i];
  return null;
}
