import { MAX_LINE_CHARS } from './passengers';

/**
 * LOCO MUSTANG: the man outside the garage across from the car meet.
 *
 * DATA, NOT LOGIC, like El Búho (`buho.ts`): everything he says is written here and the rules
 * (`src/sim/garage.ts`) only pick one line for one of two moments — the car pulls up onto his
 * apron, or the player presses the key at him.
 *
 * WHAT HE HAS TO GET ACROSS. The garage is not open yet; soon it will be where the car is tuned
 * and modded. The HUD's sign says that in its own English caps, so it is never missed; he says it
 * in his own Spanish, loud and friendly, the way the city's name is. One or two short sentences.
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
  /** The sign over the apron: what this place is, and that it is not open yet. */
  sign: { title: string; sub: string; verb: string };
  /** Said as the car pulls up. Each says, one way or another, "not yet — soon: tuning and mods". */
  greetings: readonly string[];
  /** Said to the key. The same news, said again with more enthusiasm. */
  soon: readonly string[];
}

export const LOCO_MUSTANG: GarageDef = {
  id: 'loco-mustang',
  name: 'Loco Mustang',
  tagline: 'THE GARAGE · OPENING SOON',
  personality: 'Loud, warm, oil to the elbows. Talks about cars like other people talk about football. Every car is a project to him.',
  portrait: 'mustang',
  sign: { title: "LOCO MUSTANG'S GARAGE", sub: 'TUNING & MODS · NOT OPEN YET · COMING SOON', verb: 'TALK' },
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
  ];
  for (const [kind, lines] of pools) {
    check(lines.length >= 2, `garage: needs at least 2 ${kind} lines`);
    lines.forEach((text, i) => {
      check(text.trim().length > 0, `garage: ${kind} ${i} is empty`);
      check(text.length <= MAX_LINE_CHARS, `garage: ${kind} ${i} is over ${MAX_LINE_CHARS} chars`);
    });
  }
  return problems;
}
