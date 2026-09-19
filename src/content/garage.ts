import { MAX_LINE_CHARS } from './passengers';

/**
 * LOCO MUSTANG: the man outside the garage across from the car meet.
 *
 * DATA, NOT LOGIC, like El Búho (`buho.ts`): everything he says is written here and the rules
 * (`src/sim/garage.ts`) only pick one line for a moment — the car pulls up onto his apron, the
 * showroom comes up, a part is installed, the money is short, the car rolls back out.
 *
 * WHAT HE HAS TO GET ACROSS. The workshop is OPEN (`docs/GARAGE_PLAN.md`): come in, try anything
 * on for free, pay for what you install. The HUD's sign says that in its own English caps, so it
 * is never missed; he says it in his own Rioplatense Spanish, loud and warm, the way the city's
 * name is. One or two short sentences, at most `MAX_LINE_CHARS`.
 *
 * LOOK. From Juan's photograph: a black bucket hat, a sleeveless navy shirt with a red 99 on it,
 * tattooed arms, khaki cords, white trainers, a big grin (`garageFigure.ts`, `portraits.ts`).
 */
export interface GarageDef {
  id: string;
  name: string;
  /** Under the name in the HUD. */
  tagline: string;
  /** For authors. Not shown. */
  personality: string;
  /** Which portrait to draw (`src/ui/portraits.ts`). */
  portrait: string;
  /** The sign over the apron: what this place is, that it is open, and what the key does. */
  sign: { title: string; sub: string; verb: string };
  /**
   * LEGACY — from before the workshop opened: "not yet, soon". Kept because their voices are
   * baked (`src/content/dialogueLines.ts`, `tests/dialogueClips.test.ts`) and because the rules
   * still say them until the integrator wires the door (`stepGarage`'s `workshop: false`).
   */
  greetings: readonly string[];
  /** LEGACY — said to the key before the workshop opened. See `greetings`. */
  soon: readonly string[];

  /* The open workshop's lines (`docs/GARAGE_PLAN.md`). NOT VOICED YET: they go into
     `RUNTIME_DIALOGUE` once `npm run dialogue:voices` has baked them (D6, the integrator's). */

  /** Said as the car pulls up onto the ring: open, come in, F. */
  openGreetings: readonly string[];
  /** Said as the showroom comes up (`workshopEnter`). */
  welcome: readonly string[];
  /** Said on an INSTALL that cost something (`workshopPurchase` with a price). */
  installed: readonly string[];
  /** Said when INSTALL costs more than the player has (`workshopDenied: 'funds'`). */
  broke: readonly string[];
  /** Said when the door stays shut: police on the car, or something else has it. */
  doorShut: readonly string[];
  /** Said as the car rolls back out onto the street (`workshopExit`). */
  goodbye: readonly string[];
}

export const LOCO_MUSTANG: GarageDef = {
  id: 'loco-mustang',
  name: 'Loco Mustang',
  tagline: 'THE GARAGE · TUNING & MODS',
  personality: 'Loud, warm, oil to the elbows. Talks about cars like other people talk about football. Every car is a project to him.',
  portrait: 'mustang',
  sign: { title: "LOCO MUSTANG'S GARAGE", sub: 'TUNING & MODS · OPEN · F TO ENTER', verb: 'ENTER' },
  greetings: [
    '¡Eh, loco! El taller todavía no abrió. Pero pronto te tuneo ese auto acá mismo.',
    '¡Qué máquina! Volvé en un tiempito: estoy armando el taller para meterle mods.',
    'Todavía estamos cerrados, hermano. Muy pronto: motor, suspensión, llantas, todo.',
  ],
  soon: [
    'Paciencia, loco. Cuando abra, ese auto sale de acá irreconocible.',
    'Estoy juntando las herramientas. Pronto: turbo, escape, pintura. Lo que quieras.',
    'No, todavía no. Pero guardá la plata, que los mods no son gratis.',
    'La Daewoo es mía, no se vende. Tu auto, en cambio, pronto lo dejamos volando.',
  ],

  openGreetings: [
    '¡Eh, loco! ¡Ya abrimos! Metelo adentro que lo dejamos de revista.',
    '¡Qué máquina, hermano! El taller está abierto. Apretá la F y pasá.',
    '¡Llegaste justo! Paragolpes, llantas, pintura, neón... entrá y elegí.',
    '¡Abierto, loco! Traé ese auto que hoy le cambiamos la cara.',
  ],
  welcome: [
    '¡Bienvenido al taller! Mirá todo, probá lo que quieras: probar es gratis.',
    'Subilo a la plataforma, loco. Elegí tranquilo, que acá no se apura a nadie.',
    '¡Pasá, pasá! Probate lo que quieras. Pagás solo lo que instalás.',
  ],
  installed: [
    '¡Eso, loco! Ahora sí es un auto.',
    '¡Tremendo! Con eso no te para nadie en la ciudad.',
    '¡Mirá lo que es eso! Quedó de exposición, hermano.',
    'Instalado. Ese auto ya tiene más onda que la Daewoo. Casi.',
  ],
  broke: [
    'Uh, loco, no te alcanza. Salí a laburar un rato y volvé, que te lo guardo.',
    'Con esa plata no llegamos, hermano. Unos viajes más y es tuyo.',
    'Te falta guita, loco. Probátelo igual, que mirar es gratis.',
  ],
  doorShut: [
    '¡Ni loco te abro con la cana atrás! Sacátelos de encima y volvé.',
    'Ahora no, hermano. Terminá lo tuyo y después pasás.',
    'Con los patrulleros encima, no. Andá, perdelos y te espero.',
  ],
  goodbye: [
    '¡Andá, loco! Y cuidame ese auto, eh.',
    '¡Salí a romper la calle! Acá te espero cuando quieras más.',
    'Dale, hermano. Volvé cuando juntes para la próxima.',
  ],
};

/** Everything that must hold for him to be playable, as a list of complaints. Empty means fine. */
export function validateGarage(def: GarageDef): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) problems.push(message);
  };
  check(!!def.id && !!def.name && !!def.portrait, 'garage: missing id, name or portrait');
  const pools: Array<[string, readonly string[]]> = [
    ['greeting', def.greetings],
    ['soon', def.soon],
    ['openGreeting', def.openGreetings],
    ['welcome', def.welcome],
    ['installed', def.installed],
    ['broke', def.broke],
    ['doorShut', def.doorShut],
    ['goodbye', def.goodbye],
  ];
  check([def.sign.title, def.sign.sub, def.sign.verb].every((s) => s.trim().length > 0 && s === s.toUpperCase()), 'garage: the sign is written in the HUD caps');
  for (const [kind, lines] of pools) {
    check(lines.length >= 2, `garage: needs at least 2 ${kind} lines`);
    lines.forEach((text, i) => {
      check(text.trim().length > 0, `garage: ${kind} ${i} is empty`);
      check(text.length <= MAX_LINE_CHARS, `garage: ${kind} ${i} is over ${MAX_LINE_CHARS} chars`);
    });
  }
  return problems;
}
