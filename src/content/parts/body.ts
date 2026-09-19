import type { PartDef } from '../carParts';

/**
 * Bodywork parts: bumpers, skirts, hood, trunk, spoiler and exhaust tips.
 *
 * OWNED BY agent A (`docs/GARAGE_PLAN.md`, Ola 1). Every entry here needs a variant of the same
 * id in the matching slot builder under `src/render/scene/vehicles/parts/` — the catalogue says
 * what a part is called and costs, the builder says what it looks like. Prices and ratings here
 * are provisional; the economy's calibration is `PRICING` in `../carParts.ts`.
 *
 * The `.stock` entries ARE today's car (the GT wing, the carbon splitter, the wide-body skirts,
 * the twin round tips) and must never change shape: `tests/carVisualStock.test.ts` pins them.
 *
 * NAMES. What the tuner scene calls the part: the English street name where that is what a
 * shop would write on the box ("Time Attack", "Swan Neck"), plain Spanish where the part is
 * just what it is ("Toma de aire", "Cañón"). Blurbs are always Spanish. Each category runs
 * stock first, then from subtle to aggressive, and the rating follows.
 */
export const BODY_PARTS: PartDef[] = [
  // Front bumpers.
  { id: 'frontBumper.stock', category: 'frontBumper', name: 'De fábrica', price: 0, rating: 2, blurb: 'Splitter de carbono y toma baja.' },
  { id: 'frontBumper.street-lip', category: 'frontBumper', name: 'Street Lip', price: 900, rating: 2, blurb: 'Paragolpes pintado con un labio fino de carbono.' },
  { id: 'frontBumper.canard', category: 'frontBumper', name: 'Canard Kit', price: 1800, rating: 4, blurb: 'Toma ancha, ductos en las esquinas y dos canards por lado.' },
  { id: 'frontBumper.mesh-aggressor', category: 'frontBumper', name: 'Mesh Aggressor', price: 2600, rating: 6, blurb: 'Una boca de malla de lado a lado, enmarcada en carbono.' },
  { id: 'frontBumper.time-attack', category: 'frontBumper', name: 'Time Attack', price: 3800, rating: 8, blurb: 'Splitter gigante con tensores, cercas laterales y canards.' },

  // Rear bumpers.
  { id: 'rearBumper.stock', category: 'rearBumper', name: 'De fábrica', price: 0, rating: 2, blurb: 'Difusor con aletas.' },
  { id: 'rearBumper.valance', category: 'rearBumper', name: 'Valance Slim', price: 800, rating: 2, blurb: 'Faldón pintado y un difusor corto.' },
  { id: 'rearBumper.touge', category: 'rearBumper', name: 'Touge', price: 1500, rating: 3, blurb: 'Canal central oscuro con dos aletas.' },
  { id: 'rearBumper.quad-fin', category: 'rearBumper', name: 'Quad Fin', price: 2200, rating: 5, blurb: 'Cuatro aletas largas que salen por detrás.' },
  { id: 'rearBumper.big-tunnel', category: 'rearBumper', name: 'Big Tunnel', price: 3600, rating: 8, blurb: 'Cola de carbono con difusor de túneles altos.' },

  // Side skirts.
  { id: 'skirts.stock', category: 'skirts', name: 'De fábrica', price: 0, rating: 1 },
  { id: 'skirts.slim', category: 'skirts', name: 'Slim', price: 600, rating: 1, blurb: 'Una hoja fina, pintada, con puntas afinadas.' },
  { id: 'skirts.flare-duct', category: 'skirts', name: 'Flare Duct', price: 1400, rating: 3, blurb: 'Abierta abajo, con rejillas antes de la rueda trasera.' },
  { id: 'skirts.winglet', category: 'skirts', name: 'Winglet', price: 2000, rating: 5, blurb: 'Carbono con cuchilla lateral y aletas en las puntas.' },
  { id: 'skirts.aero-box', category: 'skirts', name: 'Aero Box', price: 2400, rating: 6, blurb: 'Zócalo profundo y redondeado con inserto de carbono.' },

  // Hoods.
  { id: 'hood.stock', category: 'hood', name: 'De fábrica', price: 0, rating: 1, blurb: 'Dos tomas de carbono.' },
  { id: 'hood.bulge', category: 'hood', name: 'Power Bulge', price: 1000, rating: 2, blurb: 'Joroba central con salida hacia el parabrisas.' },
  { id: 'hood.scoop', category: 'hood', name: 'Toma de aire', price: 1400, rating: 3, blurb: 'Una toma al frente que muere en el capot.' },
  { id: 'hood.twin-vent', category: 'hood', name: 'Ventilado doble', price: 1800, rating: 4, blurb: 'Dos extractores de persiana.' },
  { id: 'hood.carbon', category: 'hood', name: 'Carbono ventilado', price: 3000, rating: 6, blurb: 'Capot entero de carbono con rejillas.' },

  // Trunks.
  { id: 'trunk.stock', category: 'trunk', name: 'De fábrica', price: 0, rating: 0 },
  { id: 'trunk.gurney', category: 'trunk', name: 'Gurney', price: 500, rating: 1, blurb: 'Una tira de carbono en el borde de la tapa.' },
  { id: 'trunk.carbon', category: 'trunk', name: 'Tapa carbono', price: 1600, rating: 3, blurb: 'La tapa del baúl, en carbono.' },
  { id: 'trunk.ducktail', category: 'trunk', name: 'Ducktail', price: 2000, rating: 4, blurb: 'La tapa se levanta en una cola de pato.' },
  { id: 'trunk.louver', category: 'trunk', name: 'Persianas', price: 2400, rating: 5, blurb: 'Persianas de carbono sobre la luneta, estilo noventas.' },

  // Spoilers.
  { id: 'spoiler.stock', category: 'spoiler', name: 'GT', price: 0, rating: 3, blurb: 'Alerón GT de un plano.' },
  { id: 'spoiler.none', category: 'spoiler', name: 'Sin alerón', price: 200, rating: 0, blurb: 'Tapa limpia, nada arriba.' },
  { id: 'spoiler.lip', category: 'spoiler', name: 'Lip', price: 700, rating: 1, blurb: 'Un labio pintado en el borde del baúl.' },
  { id: 'spoiler.street', category: 'spoiler', name: 'Street Wing', price: 1500, rating: 2, blurb: 'Alerón bajo de un plano, pintado.' },
  { id: 'spoiler.swan-neck', category: 'spoiler', name: 'Swan Neck', price: 3400, rating: 6, blurb: 'Colgado de cuellos de cisne: el plano queda limpio abajo.' },
  { id: 'spoiler.double-gt', category: 'spoiler', name: 'GT doble plano', price: 4200, rating: 8, blurb: 'Alto, con flap superior y placas grandes.' },

  // Exhaust tips.
  { id: 'exhaustTips.stock', category: 'exhaustTips', name: 'Doble redondo', price: 0, rating: 1 },
  { id: 'exhaustTips.single', category: 'exhaustTips', name: 'Simple', price: 300, rating: 0, blurb: 'Una sola punta chica, a la izquierda.' },
  { id: 'exhaustTips.quad', category: 'exhaustTips', name: 'Cuádruple', price: 1400, rating: 3, blurb: 'Cuatro puntas en fila.' },
  { id: 'exhaustTips.side', category: 'exhaustTips', name: 'Salida lateral', price: 1600, rating: 4, blurb: 'Un caño que escupe por la esquina, estilo drift.' },
  { id: 'exhaustTips.cannon', category: 'exhaustTips', name: 'Cañón', price: 1800, rating: 4, blurb: 'Una boca enorme al centro.' },
  { id: 'exhaustTips.titanium', category: 'exhaustTips', name: 'Titanio quemado', price: 2600, rating: 5, blurb: 'Doble, de titanio azulado por el calor.' },
];
