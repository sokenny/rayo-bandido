import type { Rect } from './cityPlan';

/**
 * LA BAJADA (2026-09-16): Juan asked for the Autopista Illia's descent past Villa 31 onto the
 * 9 de Julio — the elevated road dropping between the brick houses of the villa, landing on the
 * widest avenue in the city with the Obelisco ahead, the planted "BA" letters at its foot and the
 * McDonald's on the corner — made dystopian, and made Bandido City's: the letters read BA over
 * NDIDO CITY, and nothing in the game says the real city's name.
 *
 * It is put where the metro already has the right road for it and The Stack is not touched:
 *
 *   - THE DESCENT is the viaduct's east-leg ramp (`ramp-e-s`, `metroSpec.ts`) driven backwards:
 *     off the deck heading north, down over st-s4, onto st-e3 at z 540, pointed at downtown.
 *   - THE VILLA (`METRO_VILLA`) is every block between blvd-ring-e and av-e1 from av-s1 to av-s2:
 *     either side of the ramp, under it, and out past the viaduct's east leg. The generator still
 *     cuts the blocks and they are still solid; what stands on them is the villa's
 *     (`env/villaBuilder.ts`) — self-built brick houses, stacked higher toward the middle of each
 *     block and in stacks of eight to fourteen storeys here and there, so the barrio rises over
 *     the highway beside it, water tanks on every roof.
 *   - THE 9 DE JULIO (`NUEVE_DE_JULIO`) is st-e3 widened to `width` from the ramp's foot to
 *     blvd-ring-s, under the viaduct's north-east curve.
 *   - THE OBELISCO (`METRO_OBELISCO`) stands in an oval plaza in the middle of its crossing with
 *     st-s3, the metro's Corrientes: lawns, a ring walk, the letters, the avenue running round it
 *     on both sides as the Plaza de la República has it. The plaza is solid; the traffic drives
 *     round it (`metroSpec.ts`, `METRO_TRAFFIC_LOOPS`).
 *
 * Data only (and the one footprint rule its barricades need), with no runtime imports, so `scripts/metro-preview.mjs` can load the metro's spec
 * under plain Node.
 */

/** St-e3's centreline. */
const AVENUE_X = 480;

/** The widened stretch of st-e3: full width between `fromZ` and `toZ`, tapering to the street's own over `taper`. */
export const NUEVE_DE_JULIO = {
  tag: 'st-e3',
  x: AVENUE_X,
  width: 76,
  /** The north end, just past blvd-ring-s. */
  fromZ: 243,
  /** The south end, at the ramp's foot. */
  toZ: 520,
  taper: 28,
  /** The lanes the traffic drives round the Obelisco's plaza on, as centrelines either side of it (`metroSpec.ts`). */
  laneWest: AVENUE_X - 31,
  laneEast: AVENUE_X + 31,
} as const;

export interface ObeliscoSpec {
  tag: string;
  x: number;
  z: number;
  /** The plaza's half-width across the avenue and half-length along it (m): kerb, lawns, walk, letters. Solid. */
  plaza: { rx: number; rz: number };
  /** The shaft's height to the foot of its tip (m). */
  height: number;
  /** Side of the shaft's square base (m). */
  base: number;
  /** The corner the McDonald's takes: cut out of the block the generator drew there. */
  mcdonalds: Rect;
  /** Which way the McDonald's front faces (the avenue). */
  mcdonaldsFront: 'w' | 'e' | 'n' | 's';
  /** The green gantry sign over the descent, where the ramp leaves the deck's side. */
  gantry: { x: number; z: number; y: number; width: number };
  /**
   * The quake's fissure across the avenue south of the plaza: polylines of (x, z, width). Art
   * only: a car drives over it.
   */
  fissures: Array<Array<{ x: number; z: number; w: number }>>;
  /**
   * Concrete barriers left from the protests, axis-aligned so each is one exact collider:
   * `alongX` is the long side's axis, `toppled` lies on its side.
   */
  barricades: Array<{ x: number; z: number; alongX: boolean; toppled?: boolean }>;
}

/** A jersey barrier's size (m): length, base width, height; toppled it is its height wide and its width tall. */
export const BARRICADE = { length: 5, width: 1.4, height: 1.76 } as const;

/** A barricade's footprint: the collider and the art are the same rectangle. */
export function barricadeBox(bc: ObeliscoSpec['barricades'][number]): Rect {
  const across = bc.toppled ? BARRICADE.height : BARRICADE.width;
  const hx = (bc.alongX ? BARRICADE.length : across) / 2;
  const hz = (bc.alongX ? across : BARRICADE.length) / 2;
  return { minX: bc.x - hx, maxX: bc.x + hx, minZ: bc.z - hz, maxZ: bc.z + hz };
}

export const METRO_OBELISCO: ObeliscoSpec = {
  tag: 'obelisco',
  x: AVENUE_X,
  z: 360,
  plaza: { rx: 22, rz: 46 },
  height: 80,
  base: 9,
  // The corner east of the avenue, south of st-s3: on the right as the descent lands.
  mcdonalds: { minX: 524, maxX: 538.5, minZ: 368, maxZ: 404 },
  mcdonaldsFront: 'w',
  gantry: { x: 502, z: 612, y: 6.5, width: 12 },
  fissures: [
    // Kerb to kerb, widest in the middle of the avenue.
    [
      { x: 441, z: 452, w: 0.5 },
      { x: 451, z: 446, w: 1.4 },
      { x: 460, z: 453, w: 2.3 },
      { x: 470, z: 445, w: 3.2 },
      { x: 480, z: 450, w: 3.8 },
      { x: 489, z: 442, w: 3 },
      { x: 497, z: 449, w: 2.3 },
      { x: 507, z: 443, w: 1.4 },
      { x: 519, z: 448, w: 0.5 },
    ],
    // North, to the plaza's kerb.
    [
      { x: 470, z: 445, w: 1.3 },
      { x: 465, z: 433, w: 1 },
      { x: 471, z: 421, w: 0.7 },
      { x: 467, z: 408, w: 0.3 },
    ],
    // South, down the avenue toward the ramp.
    [
      { x: 497, z: 449, w: 1.1 },
      { x: 503, z: 463, w: 0.8 },
      { x: 499, z: 478, w: 0.5 },
      { x: 505, z: 494, w: 0.2 },
    ],
  ],
  // Clear of the traffic's files (x 445-453 and 507-515) and of the island.
  barricades: [
    // A broken line across the avenue south of the plaza, gaps where the crowd pushed through.
    { x: 458.5, z: 425, alongX: true },
    { x: 466, z: 427, alongX: true, toppled: true },
    { x: 481, z: 424, alongX: true },
    { x: 494, z: 425.5, alongX: true },
    { x: 500, z: 422.5, alongX: true },
    { x: 474, z: 435, alongX: false, toppled: true },
    // A chicane north of the plaza, by the ring.
    { x: 466, z: 296, alongX: false },
    { x: 469.5, z: 287, alongX: false },
    { x: 491, z: 300, alongX: false },
    { x: 494.5, z: 291, alongX: false, toppled: true },
    // Dragged onto the fissure.
    { x: 486, z: 458, alongX: true, toppled: true },
    { x: 458, z: 464, alongX: false },
  ],
};

export interface VillaSpec {
  tag: string;
  /** Blocks whose centre is inside this rectangle are the villa's. */
  land: Rect;
}

export const METRO_VILLA: VillaSpec = {
  tag: 'villa-31',
  land: { minX: 340, maxX: 620, minZ: 500, maxZ: 780 },
};
