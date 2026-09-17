import type { Rect } from './cityPlan';
import { reliefOf, type HillDef, type TerrainSpec } from './terrain.ts';

/**
 * THE LIE OF THE LAND in Bandido Metro (2026-09-16): Juan asked for the city to stop being a
 * sheet — streets that climb and fall a little, a higher district or two, the way Los Angeles
 * has topography without being a mountain — and for the viaducts to stay exactly where they
 * are, since they already give the city its altitude.
 *
 * Five hills, none steeper than about five per cent on the streets that climb them:
 *
 *   - LA LOMA, the big one: the middle of the district inside the viaduct, cresting ten
 *     metres on av-s2 east of av-central, with the market avenue climbing its north flank,
 *     Plaza Estrella on its west flank and the Paseo Media Luna over its shoulder toward the
 *     shore (`metroSouth.ts`),
 *   - EL BAJO, the low hill south-west of it: the two make a saddle the Diagonal Sur runs
 *     through, and the south-west business district sits on its western slope,
 *   - EL ALTO, the west flank north of the meet: st-w3 and av-w1 climb it toward the north
 *     boulevard, the radio mast stands on its side,
 *   - LOMA ESTE, its smaller mirror on the east flank behind the works.
 *
 * There was a fifth, LA CRESTA, a ridge along the north wall behind downtown; the park took
 * its ground (2026-09-16, `metroPark.ts`) — a park's land is a lot, held level, and its fence
 * would have cut the ridge to a bump — so what rises behind the skyline now is the trees.
 *
 * What stays flat is what `createTerrain` protects, plus what this world says it wants flat
 * (`METRO_FLATS`): downtown, because The Stack is carved at absolute floors and its rings and
 * skyway are level; and the meet district west of av-central, from the ring down to st-s4 —
 * the car meet, the garage, El Búho's bay, the ramps by them, and the streets La Curva is run
 * on (`curvaSpec.ts`), which were laid out on level ground and are proved barrier-tight there.
 * The hills are drawn so they die away before those edges; the fence in `terrain.ts` is a
 * belt over braces.
 */
export const METRO_HILLS: readonly HillDef[] = [
  { x: 120, z: 780, rx: 330, rz: 380, height: 10.5 },
  { x: -220, z: 950, rx: 230, rz: 230, height: 6.5 },
  { x: -560, z: -200, rx: 230, rz: 250, height: 8 },
  { x: 560, z: -330, rx: 200, rz: 260, height: 7 },
];

/**
 * The meet district, level: from the west wall to av-central between the Stack's south rows
 * and st-s3 (the race's canyon leg runs down av-central there, and its ramp feet lie just
 * south of downtown), and from the wall to blvd-ring-w from st-s3 to st-s4 (its chicane and
 * its west shortcut). Downtown itself covers the rest of the course. East and south of these,
 * La Loma's west flank and El Bajo may rise; north of them, El Alto.
 */
export const METRO_MEET_DISTRICT: readonly Rect[] = [
  { minX: -700, maxX: -40, minZ: 100, maxZ: 380 },
  { minX: -700, maxX: -300, minZ: 380, maxZ: 650 },
];

export function metroTerrain(downtown: Rect): TerrainSpec {
  return {
    relief: reliefOf(METRO_HILLS),
    maxGrade: 0.045,
    flat: [downtown, ...METRO_MEET_DISTRICT],
  };
}
