import type { HustlerKind } from '../core/types';
import { MAX_LINE_CHARS } from './passengers';

/**
 * THE STREET HUSTLERS: a piece of Buenos Aires that survived inside the city.
 *
 * DATA, NOT LOGIC, like El Búho (`buho.ts`) and Loco Mustang (`garage.ts`): everything they say is
 * written here, and the rules (`src/sim/hustlers.ts`) only pick which pool a moment calls for and
 * which line of it has not just been said.
 *
 * TRAPITOS offer to find and watch a space for a car that is plainly not going to park. That is
 * the whole joke, so nothing about them is interactive: no button, no price, no answer waited for.
 *
 * WINDSHIELD WASHERS work a red light and do take money — once, only on a yes.
 *
 * SOCK SELLERS walk a stretch of pavement with a cardboard box round their neck and pitch whoever
 * slows down: three pairs, a good price, for the kids, and — the moment you drive off — that they
 * are not stealing from anybody, they are selling socks. Talk only, like a trapito.
 *
 * TRAVESTIS work the kerb at night — the Bosques' loop road and a few dark corners of the city — in
 * a miniskirt and heels, a little bag over the arm. A car that slows by one gets called over and
 * offered the night, in the park's own words. Talk only, like a trapito: no button, no price
 * taken, nothing waited for. They have a voice of their own (`travesti`).
 *
 * TONE. Villero, the way it is actually spoken on that corner: "ameo" and "ñeri" and "pa" instead
 * of amigo, "la gorra" and "la yuta" for the police, "rescatate", "bardear", "posta", "de una".
 * Funny, a little pushy, never a caricature and never a threat. The trapitos and washers share a
 * voice (`trapito`), the sock sellers have the villero one (`villero`); all of them talk alike.
 * Every line is short enough to read at a red light (`MAX_LINE_CHARS` is the passengers' ceiling;
 * these are all far under it) and is spoken exactly as written, so it is written to be said.
 */

export interface TrapitoLines {
  /** The car slows or stops near him: he calls it into a space. */
  call: readonly string[];
  /** It drove off anyway. */
  ignored: readonly string[];
  /** Said instead of a call when the car wears crash damage. Takes priority. */
  damaged: readonly string[];
  /** Said instead of a call, sometimes, to a clean car. */
  clean: readonly string[];
  /** Said instead of a call, sometimes, once he has seen this car a few times. */
  regular: readonly string[];
}

export interface WasherLines {
  /** Squeegee up at the red light. */
  offer: readonly string[];
  /** While he works. */
  cleaning: readonly string[];
  /** Done, and paid. */
  thanks: readonly string[];
  /** The player said no, or let the offer run out. */
  refused: readonly string[];
  /** Said instead of an offer when the car wears crash damage. Takes priority. */
  damaged: readonly string[];
  /** Said instead of anything when the police are on the car: no offer at all. */
  pursuit: readonly string[];
  /** Said instead of an offer, sometimes, once he has seen this car a few times. */
  regular: readonly string[];
}

export interface MediasLines {
  /** The car slows by him: he stops walking and pitches. */
  pitch: readonly string[];
  /** It is still there: he tries again. */
  insist: readonly string[];
  /** It drove off, or sat there without buying. */
  ignored: readonly string[];
  /** Said instead of a pitch when the car wears crash damage. Takes priority. */
  damaged: readonly string[];
  /** Said instead of anything when the police are on the car. */
  pursuit: readonly string[];
  /** Said instead of a pitch, sometimes, to a clean car. */
  clean: readonly string[];
  /** Said instead of a pitch, sometimes, once he has seen this car a few times. */
  regular: readonly string[];
}

/** A travesti only calls: the car slows by her, and she makes her offer. */
export interface TravestiLines {
  call: readonly string[];
}

export const TRAVESTI_LINES: TravestiLines = {
  call: [
    '¿Andás perdido, rey, o buscás que te acomoden la noche?',
    'Vení, papi… por unos mangos te saco esa cara de preocupado.',
    '¿Querés compañía nomás o también un service rapidito?',
    'Estacioná más adelante, corazón. Acá se charla; allá arreglamos.',
    '¿Una atención completa o venís buscando algo para levantar la noche?',
    'No doy indicaciones gratis, bombón… pero conozco todos los atajos.',
    '¿Querés mimos o mercadería para después?',
    'Bajá el vidrio papi. El bucal son 200 pe y por 500 te entrego la burra',
    '¿Viniste a mirar, ratón, o vas a poner unos mangos y sacarte las ganas?',
    'Estacioná allá atrás, bebé. Por quinientos te vas contento y deslechado.',
  ],
};

export const TRAPITO_LINES: TrapitoLines = {
  call: [
    'Eu, ameo, acá tenés lugar.',
    'Vení, ñeri, que acá entra de una.',
    'Dale, pa, dale… seguí, seguí… ahí, joya.',
    'Arrimate, ameo, que te hago lugar.',
    'Dejalo acá, pa, que yo te lo miro.',
    'Acá no te lo toca nadie, ñeri. Palabra.',
    'Qué nave, ameo. Vení que te la cuido.',
    'Tirala acá, pa. Zona vip.',
    'Acá queda re piola, ñeri. Confiá.',
    'Dale marcha atrás, pa… tranqui, que yo te guío.',
    'Eu, ñeri, tengo un lugarcito para vos.',
  ],
  ignored: [
    'Bueno, ameo, yo te ofrecí.',
    'Dale, hacete el cheto nomás.',
    'Se perdió alto lugar, ñeri.',
    'Después no encontrás dónde dejarlo, eh, pa.',
    'Mucha nave y poca confianza, ameo.',
    'Andá nomás, pa. Más adelante está todo lleno.',
    'Rescatate, ñeri. Te estaba haciendo la gauchada.',
  ],
  damaged: [
    '¿Qué hiciste, pa? ¿Lo estacionaste contra una pared?',
    'Te lo cuido, ameo, pero revivirlo sale aparte.',
    'Eso no necesita lugar, ñeri. Necesita terapia intensiva.',
    'Linda nave, pa. Medio masticada, pero linda.',
    'Dejalo acá antes de que se te desarme todo, ameo.',
    'Yo te lo cuido, ñeri, pero el bollo ya lo trajiste vos.',
    'Uh, pa, ahí no entra otro bollo.',
    '¿Te bardearon la nave o chocaste solito, ameo?',
  ],
  clean: [
    'Apa, mirá esa nave, pa.',
    'Eso no se deja en cualquier lado, ameo.',
    'Dejámelo acá que te lo cuido con la vida, ñeri.',
    'Qué fierro, pa. Está para ponerle una frazada.',
    'Esa nave vale más que toda la cuadra, ameo.',
    'Alta nave, ñeri. Posta te digo.',
  ],
  regular: [
    '¡Otra vez vos, ñeri! Tu lugar te lo guardé.',
    'Mirá quién volvió. Ya sos de la cuadra, pa.',
    '¿Otra vuelta, ameo? Algún día estacionás.',
    'Eu, mi ñeri. ¿Hoy sí me lo dejás?',
  ],
};

export const WASHER_LINES: WasherLines = {
  offer: [
    '¿Te lo limpio, pa?',
    'Una lavadita, ameo. Está pidiendo auxilio.',
    'Dale, ñeri, te lo dejo brillando.',
    '¿Una pasadita? Son dos segundos, pa.',
    'Frená ahí, ameo. Te saco toda la mugre.',
    'Ese vidrio ya está viendo en baja resolución, pa.',
    '¿Te tiro una lavadita, ñeri?',
    'Dale, pa, que así no ves un carajo.',
  ],
  cleaning: [
    'Ahí va, ameo.',
    'Bancame que sale toda, pa.',
    'Te lo dejo nuevito, ñeri.',
    'Mirá cómo cambia, pa.',
    'Esta mugre ya pagaba alquiler, ameo.',
    'Un segundito más y queda de concesionaria.',
  ],
  thanks: [
    'Ahora sí, un espejo, pa.',
    'Servicio premium, ameo.',
    'Listo, ñeri. Andá con Dios.',
    'Ahora por lo menos ves contra qué chocás, pa.',
    'Quedó piola… dentro de lo posible.',
    'Gracias, ameo. Que Dios te lo devuelva.',
  ],
  refused: [
    'Todo bien, pa. Manejá por intuición.',
    'Dale, quedate con la mugre, ameo.',
    'Bueno, ñeri, yo ofrecí.',
    'Tranqui, pa. Nos vemos.',
    'Después no le eches la culpa a la niebla, ameo.',
    'Dale, seguí viendo todo borroso, ñeri.',
  ],
  damaged: [
    'El vidrio te lo limpio, pa. Lo demás ya es chapista.',
    'Ameo, yo tengo un secador, no una máquina del tiempo.',
    'Arrancamos por el vidrio y después vemos, ñeri.',
    '¿Te chocó un edificio o qué, pa?',
    'Te limpio el vidrio así ves el próximo paredón, ameo.',
    'Esto con agua no sale, ñeri.',
    'El parabrisas queda nuevo. Del paragolpes no prometo nada.',
    'Venís juntando paredes, ¿no, pa?',
  ],
  pursuit: [
    'No, no, seguí de largo, pa. Tenés la gorra atrás.',
    'Hoy no, ameo. Tenés compañía.',
    'Dale, rajá, que a mí no me viste.',
    'Después volvés, ñeri… si volvés.',
    'No frenes acá, pa. Seguí que viene la yuta.',
  ],
  regular: [
    '¡Mi cliente! ¿Lo de siempre, pa?',
    'Otra vez vos, ñeri. Este vidrio ya es mío.',
    'Volviste, ameo. Precio de amigo… mentira, sale lo mismo.',
  ],
};

export const MEDIAS_LINES: MediasLines = {
  pitch: [
    'Escuchame, ameo, sin faltar el respeto…',
    'Vendo medias, dos por tres, pa. Dale, para la criatura.',
    'Te puedo mostrar, pa. Sin compromiso.',
    'Eu, ñeri, ¿no precisás unas medias?',
    'Medias de algodón, ameo. Mirá la calidad.',
    'Tres pares, pa. Para vos, para tu vieja y para tu viejo.',
    'Escuchame una cosa, ñeri. Medias de fábrica, de primera.',
    'Dale, pa, que se viene el frío y estas abrigan.',
    'Ameo, disculpá que te moleste. Medias, ¿no llevás?',
  ],
  insist: [
    'Tocá, tocá, ameo. Algodón posta.',
    'Hacé la gauchada, ñeri. Es para la leche de los nenes.',
    'Te hago precio, pa. Tres pares, dos lucas.',
    'Mirá que no te estoy bardeando, ameo. Estoy laburando.',
    'Te muestro sin compromiso, ñeri. Mirar no cuesta nada.',
    'Negras, blancas, de colores… ¿cuál querés, pa?',
    'No son truchas, ameo. Son de fábrica, te lo juro por mi vieja.',
  ],
  ignored: [
    'Yo no robo, pa. Solo estoy vendiendo medias.',
    'Bueno, ameo, Dios te bendiga igual.',
    'Dale, ñeri. Prefiero vender medias que salir a robar.',
    'Después no me llores con los pies fríos, pa.',
    'Andá nomás, ameo. Otro día te llevás.',
    'Ni me miraste, pa. Qué ortiva.',
  ],
  damaged: [
    'Uh, ameo, ¿qué le pasó a la nave? Eso no lo arreglan unas medias.',
    'Pa, con ese bollo necesitás un chapista, no medias.',
    'Sin faltar el respeto, ñeri, pero ese auto está hecho percha.',
    'Escuchame, pa. Si chocás así, por lo menos andá con los pies calentitos.',
  ],
  pursuit: [
    'No, no, pa. Con la gorra atrás no te vendo nada.',
    'Seguí, ameo, seguí. Yo solo vendo medias.',
    'Uh, la yuta. Yo no te conozco, ñeri.',
    'Rajá, pa. Yo no vi nada, estoy con las medias.',
  ],
  clean: [
    'Qué nave, pa. Con ese fierro, medias nuevas.',
    'Alto auto, ameo. Un señor así no puede andar con medias rotas.',
    'Mirá vos, ñeri. Un auto así merece medias de primera.',
  ],
  regular: [
    '¡Mi cliente, pa! ¿Hoy sí te llevás?',
    'Otra vez vos, ameo. Te guardé los mejores pares.',
    'Eu, ñeri. ¿Todavía con las medias rotas?',
  ],
};

/** What the regulars get called once they have worked your car a few times. One each, in spot order. */
export const HUSTLER_NICKNAMES: readonly string[] = ['El Chino', 'Pity', 'El Tucu', 'Rulo', 'Cabeza', 'Toto', 'Nacho', 'El Pelado', 'Chiqui', 'El Flaco', 'Kevin', 'Brian',
  'Pocho', 'Lucho', 'El Colo', 'Tincho', 'Fede', 'El Rata', 'Jonathan', 'Maxi', 'Beto', 'El Mono', 'Pipa', 'Cacho', 'Dylan', 'El Topo', 'Chaca', 'Tito', 'Mati', 'El Oso',
  'Maicol', 'El Pollo', 'Yeison', 'Brandon', 'El Tano', 'Cristian'];

/** What a travesti gets called once she has worked your car a few times. One each, in the order the travestis are listed. */
export const TRAVESTI_NICKNAMES: readonly string[] = ['La Colo', 'Jessica', 'La Tati', 'Mía', 'Karen', 'La Negra', 'Luana', 'Daiana', 'La Rubia', 'Samanta', 'Pamela', 'Yésica'];

/** What the subtitle calls one before he has a name. */
export const HUSTLER_TRADE: Record<HustlerKind, string> = { trapito: 'Trapito', washer: 'Limpiavidrios', medias: 'Vendedor de medias', travesti: 'Travesti' };

/** Whose voice says a hustler's lines (`server/dialogue/voices.mjs`). */
export const HUSTLER_VOICE = { trapito: 'trapito', washer: 'trapito', medias: 'villero', travesti: 'travesti' } as const satisfies Record<HustlerKind, string>;

/** The washer's two buttons. The price is filled in from `HUSTLERS.washer.price`. */
export const WASHER_CHOICES = { accept: 'Dejarlo limpiar', decline: 'No, gracias' } as const;

/** `2000` -> `$2.000`: the washer quotes in the street's own format. */
export function streetPrice(value: number): string {
  const digits = String(Math.max(0, Math.round(value)));
  return `$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/** Everything that must hold for the cast to be playable, as a list of complaints. Empty means fine. */
export function validateHustlerLines(): string[] {
  const problems: string[] = [];
  const pools: Array<[string, readonly string[]]> = [
    ...Object.entries(TRAPITO_LINES).map(([k, v]) => [`trapito.${k}`, v] as [string, readonly string[]]),
    ...Object.entries(WASHER_LINES).map(([k, v]) => [`washer.${k}`, v] as [string, readonly string[]]),
    ...Object.entries(MEDIAS_LINES).map(([k, v]) => [`medias.${k}`, v] as [string, readonly string[]]),
    ...Object.entries(TRAVESTI_LINES).map(([k, v]) => [`travesti.${k}`, v] as [string, readonly string[]]),
  ];
  for (const [name, lines] of pools) {
    // Two at least, so "never the same line twice running" always has somewhere to go.
    if (lines.length < 2) problems.push(`${name}: needs at least 2 lines`);
    if (new Set(lines).size !== lines.length) problems.push(`${name}: repeats a line`);
    lines.forEach((text, i) => {
      if (text.trim().length === 0) problems.push(`${name} ${i}: empty`);
      if (text.length > MAX_LINE_CHARS) problems.push(`${name} ${i}: over ${MAX_LINE_CHARS} chars`);
    });
  }
  if (new Set(HUSTLER_NICKNAMES).size !== HUSTLER_NICKNAMES.length) problems.push('nicknames: repeats a name');
  if (new Set(TRAVESTI_NICKNAMES).size !== TRAVESTI_NICKNAMES.length) problems.push('travesti nicknames: repeats a name');
  return problems;
}
