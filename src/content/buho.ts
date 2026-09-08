import { MAX_LINE_CHARS } from './passengers';

/**
 * EL BÚHO: the one character in the city who is not going anywhere.
 *
 * DATA, NOT LOGIC. Like the passenger catalogue (`passengers.ts`), everything he can say is
 * written here in advance and the rules (`src/sim/buho.ts`) only ever pick one of these lines
 * for one of four moments: the car rolls onto his paint, the Moogul is bought, the player is
 * short, or the player already has one in them. Nothing is generated and nothing is waited on.
 *
 * VOICE. A local. Dry, unhurried, a little too observant; the humour is in what he does not
 * say. He never explains what the Moogul is and never sells it — the price is on the sign. His
 * lines are in his own Spanish, the way the city's name is; the chrome round him stays in the
 * HUD's English caps. One or two short sentences, read at a glance. The player never answers.
 */
export interface BuhoDef {
  id: string;
  name: string;
  /** Under the name in the HUD. */
  tagline: string;
  /** For authors. Not shown. */
  personality: string;
  background: string;
  /** Which portrait to draw (`src/ui/portraits.ts`). */
  portrait: string;
  /** What he sells, as printed on the prompt. */
  item: string;
  /** Said as the car rolls onto the paint. */
  greetings: readonly string[];
  /** Said on a purchase, with the money already gone. */
  remarks: readonly string[];
  /** Said when the counter cannot cover the price. */
  broke: readonly string[];
  /** Said when the last one has not worn off yet. */
  busy: readonly string[];
}

export const BUHO: BuhoDef = {
  id: 'buho',
  name: 'El Búho',
  tagline: 'UNDER THE VIADUCT · ASK FOR MOOGUL',
  personality: 'Calm, dry, amused by everything and impressed by nothing. Notices what the city is doing before it does.',
  background:
    'Has stood under the same span of the highway for as long as anyone can remember, next to paint nobody remembers being done. Sells one thing. Does not say what it is.',
  portrait: 'buho',
  item: 'Moogul',
  greetings: [
    'Llegaste justo. Siempre llegás justo, y eso es lo raro.',
    'Tranquilo. Acá abajo no pasa nada. Casi nunca.',
    '¿Buscás algo, o te gustan las columnas?',
    'La ciudad está de buen humor hoy. Aprovechá.',
  ],
  remarks: [
    'Si pasás dos veces por la misma esquina, saludá de mi parte.',
    'Después contame si el puente sigue ahí.',
    'No mires mucho las ventanas. Son curiosas.',
    'La ciudad anda rara hoy. Pero ya venía de antes.',
    'Manejá tranquilo la primera hora. Después no va a importar.',
  ],
  broke: ['Con eso no llegás ni al chicle. Volvé con plata.', 'El Moogul no fía. Yo tampoco.'],
  busy: ['Con uno alcanza. Con dos te olvidás cómo se frena.', 'Ya tenés el tuyo. Mirá para arriba, y después me contás.'],
};

/** Everything that must hold for him to be playable, as a list of complaints. Empty means fine. */
export function validateBuho(def: BuhoDef): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) problems.push(message);
  };
  check(!!def.id && !!def.name && !!def.portrait && !!def.item, 'buho: missing id, name, portrait or item');
  const pools: Array<[string, readonly string[], number]> = [
    ['greeting', def.greetings, 2],
    ['remark', def.remarks, 3],
    ['broke', def.broke, 1],
    ['busy', def.busy, 1],
  ];
  for (const [kind, lines, min] of pools) {
    check(lines.length >= min, `buho: needs at least ${min} ${kind} line(s)`);
    lines.forEach((text, i) => {
      check(text.trim().length > 0, `buho: ${kind} ${i} is empty`);
      check(text.length <= MAX_LINE_CHARS, `buho: ${kind} ${i} is over ${MAX_LINE_CHARS} chars`);
    });
  }
  return problems;
}
