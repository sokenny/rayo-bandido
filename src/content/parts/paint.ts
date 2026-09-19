import type { PartDef } from '../carParts';

/**
 * Vinyls and decals (graffiti included). OWNED BY agent C (`docs/GARAGE_PLAN.md`, Ola 1).
 * Every entry needs a painter of the same id in `src/render/scene/vehicles/paintShop.ts`
 * (`VINYL_PAINTERS` / `DECAL_PAINTERS`; `tests/paintShop.test.ts` checks both ways).
 *
 * Both are `layers` categories: a car wears a list of them (`CarLoadout.vinyls`, up to four,
 * each with a colour; `CarLoadout.decals`, one per `DecalZone`). There is no `decals.stock` —
 * the stock car wears none — and the stock vinyl is `vinyls.rayo`: today's torn magenta/violet
 * shard livery (`livery.ts`), which the stock loadout wears as its one layer.
 *
 * Every sponsor here is invented for the game's world. Never a real brand.
 *
 * Prices and ratings are provisional; agent F calibrates them through `PRICING`.
 */
export const PAINT_PARTS: PartDef[] = [
  /* ------------------------------------------------------------------ vinyls */
  { id: 'vinyls.rayo', category: 'vinyls', name: 'Rayo', price: 0, rating: 3, defaultColor: 'magenta', blurb: 'Esquirlas magenta y violeta.' },
  { id: 'vinyls.bolts', category: 'vinyls', name: 'Relámpagos', price: 1800, rating: 4, defaultColor: 'cyan', blurb: 'Dos rayos quebrados por los costados y uno por el capot.' },
  { id: 'vinyls.tribal', category: 'vinyls', name: 'Tribal', price: 2200, rating: 4, defaultColor: 'gunmetal', blurb: 'Púas tribales desde la rueda delantera.' },
  { id: 'vinyls.flames', category: 'vinyls', name: 'Llamas', price: 2000, rating: 4, defaultColor: 'orange', blurb: 'Llamas desde la trompa, con filo claro.' },
  { id: 'vinyls.stripes', category: 'vinyls', name: 'Franjas dobles', price: 1200, rating: 3, defaultColor: 'white', blurb: 'Dos franjas de punta a punta por arriba.' },
  { id: 'vinyls.kanji', category: 'vinyls', name: 'Banda kanji', price: 1600, rating: 4, defaultColor: 'red', blurb: 'Banda baja con 稲妻 calado.' },
  { id: 'vinyls.circuit', category: 'vinyls', name: 'Circuito', price: 1900, rating: 4, defaultColor: 'cyan', blurb: 'Pistas de placa madre por toda la carrocería.' },
  { id: 'vinyls.camo', category: 'vinyls', name: 'Camo astillado', price: 1700, rating: 3, defaultColor: 'gunmetal', blurb: 'Camuflaje de astillas en dos tonos.' },
  { id: 'vinyls.fade', category: 'vinyls', name: 'Degradé', price: 1400, rating: 3, defaultColor: 'violet', blurb: 'Color desde la cola que se disuelve hacia la trompa.' },
  { id: 'vinyls.checker', category: 'vinyls', name: 'Bandera', price: 1500, rating: 3, defaultColor: 'white', blurb: 'Cuadros que se desarman hacia adelante.' },

  /* ------------------------------------------------------------------ decals */
  { id: 'decals.rayo-banner', category: 'decals', name: 'Banner Rayo Bandido', price: 600, rating: 2, blurb: 'Para el parasol o el capot.' },
  { id: 'decals.kaminari', category: 'decals', name: 'Kaminari Juice', price: 400, rating: 1, blurb: 'Bebida energizante del barrio.' },
  { id: 'decals.neomate', category: 'decals', name: 'NeoMate', price: 400, rating: 1, blurb: 'Yerba cyber, sponsor de la noche.' },
  { id: 'decals.chispa', category: 'decals', name: 'Chispa Tuning', price: 400, rating: 1 },
  { id: 'decals.taller-loco', category: 'decals', name: 'Taller Loco Mustang', price: 300, rating: 2, blurb: 'El sello de la casa.' },
  { id: 'decals.wakaba', category: 'decals', name: 'Wakaba', price: 250, rating: 1, blurb: 'La hoja del conductor novato.' },
  { id: 'decals.sun-disc', category: 'decals', name: 'Disco rojo', price: 250, rating: 1 },
  { id: 'decals.drift-kanji', category: 'decals', name: 'ドリフト', price: 350, rating: 2, blurb: '"Drift" en katakana.' },
  { id: 'decals.graffiti-tag', category: 'decals', name: 'Grafiti: firma', price: 500, rating: 2 },
  { id: 'decals.graffiti-wild', category: 'decals', name: 'Grafiti: wildstyle', price: 700, rating: 3 },
  { id: 'decals.graffiti-bubble', category: 'decals', name: 'Grafiti: bombas', price: 600, rating: 2 },
  { id: 'decals.graffiti-mural', category: 'decals', name: 'Grafiti: mural', price: 900, rating: 3 },
];
