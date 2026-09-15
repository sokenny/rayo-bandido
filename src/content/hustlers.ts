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
 * TONE. Funny, streetwise, a little pushy, and believable: the slang is what somebody on that
 * corner would actually say, and nobody is a caricature. Every line is short enough to read at a
 * red light (`MAX_LINE_CHARS` is the passengers' ceiling; these are all far under it).
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

export const TRAPITO_LINES: TrapitoLines = {
  call: [
    'Ehh, pa, acá tenés lugar.',
    'Vení, máquina. Acá entra de una.',
    'Dale, dale… seguí, seguí… ahí estás joya.',
    'Arrimate, rey. Yo te hago lugar.',
    'Dejámelo acá, que te lo miro.',
    'Acá no te lo toca nadie, olvidate.',
    'Qué nave, hermano. Vení que te la cuido.',
    'Estacionalo acá, pa. Zona premium.',
    'Acá queda flama, maestro.',
    'Dale para atrás… confiá en mí.',
  ],
  ignored: [
    'Bueno, máquina, yo te ofrecí.',
    'Dale, hacete el importante.',
    'Se pierde alto lugar, pa.',
    'Después no encontrás dónde dejarlo.',
    'Mucha nave, poca confianza.',
    'Andá nomás, rey. Está todo ocupado más adelante.',
    'Dale, seguí buscando entonces.',
  ],
  damaged: [
    '¿Qué hiciste, pa? ¿Estacionaste contra una pared?',
    'Te la cuido, pero revivirla sale aparte.',
    'Eso no necesita estacionamiento, necesita terapia intensiva.',
    'Lindo el auto. Medio masticado, pero lindo.',
    'Dejalo acá antes de que se te termine de desarmar.',
    'Yo te lo cuido, pero el choque ya vino de fábrica.',
    'Pa, ahí no entra otro bollo.',
    'Qué muñeca… pero para pegarle a todo.',
  ],
  clean: [
    'Apa, mirá esa nave.',
    'Eso no se deja en cualquier lado, pa.',
    'Dejámelo acá que te lo cuido con la vida.',
    'Qué máquina, rey. Está para ponerle una frazada.',
    'Ese auto vale más que toda la cuadra.',
  ],
  regular: [
    '¡Otra vez vos, máquina! Tu lugar te lo guardé.',
    'Mirá quién volvió. Ya sos de la cuadra, pa.',
    '¿Otra vuelta, rey? Algún día estacionás.',
  ],
};

export const WASHER_LINES: WasherLines = {
  offer: [
    '¿Te lo limpio, pa?',
    'Una lavadita, rey. Está pidiendo auxilio.',
    'Dale, máquina, te lo dejo flama.',
    '¿Una pasada? Son dos segundos.',
    'Frená ahí, pa. Te saco toda la mugre.',
    'Ese vidrio ya está viendo en baja resolución.',
    '¿Te mando una lavadita?',
    'Dale, rey, no ves un carajo así.',
  ],
  cleaning: [
    'Ahí va, máquina.',
    'Bancame que sale toda.',
    'Te lo dejo nuevo, pa.',
    'Mirá cómo cambia.',
    'Esta mugre ya pagaba alquiler.',
    'Un segundo más y queda de concesionaria.',
  ],
  thanks: [
    'Ahora sí, un espejo.',
    'Servicio premium, papá.',
    'Listo, rey. Buen viaje.',
    'Ahora por lo menos vas a ver contra qué chocás.',
    'Quedó flama… dentro de lo posible.',
    'Gracias, máquina. Portate mal.',
  ],
  refused: [
    'Está bien, pa. Manejá por intuición.',
    'Dale, dejá la mugre entonces.',
    'Bueno, máquina, yo ofrecí.',
    'Todo bien, rey. Nos vimos.',
    'Después no le eches la culpa a la niebla.',
    'Dale, seguí viendo el mundo en 240p.',
  ],
  damaged: [
    'El vidrio te lo limpio. El resto ya es chapista.',
    'Pa, yo tengo un secador, no una máquina del tiempo.',
    'Arrancamos por el vidrio y después vemos.',
    '¿Te chocó un edificio o qué?',
    'Te limpio el vidrio así ves el próximo paredón.',
    'Esto con agua no sale, máquina.',
    'El parabrisas queda nuevo. Del paragolpes no prometo nada.',
    'Venís juntando paredes, ¿no?',
  ],
  pursuit: [
    'No, no, seguí de largo. Venís complicado.',
    'Hoy no, pa. Tenés compañía.',
    'Dale, rajá, que a mí no me viste.',
    'Después volvés… si volvés.',
    'No frenes acá, máquina. Seguí.',
  ],
  regular: [
    '¡Mi cliente! ¿Lo de siempre, pa?',
    'Otra vez vos, rey. Este vidrio ya es mío.',
    'Volviste, máquina. Precio de amigo… mentira, sale lo mismo.',
  ],
};

/** What the regulars get called once they have worked your car a few times. One each, in spot order. */
export const HUSTLER_NICKNAMES: readonly string[] = ['El Chino', 'Pity', 'El Tucu', 'Rulo', 'Cabeza', 'El Flaco', 'Kevin', 'Brian'];

/** What the subtitle calls one before he has a name. */
export const HUSTLER_TRADE: Record<HustlerKind, string> = { trapito: 'Trapito', washer: 'Limpiavidrios' };

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
  return problems;
}
