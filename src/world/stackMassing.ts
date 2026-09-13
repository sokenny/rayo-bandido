// Spelt with its extension: `stackSpec.ts` imports this and is loaded under plain Node by the
// QA scripts (see the note at the top of `cityMegastructures.ts`).
import { carveVolumes, findPassages, roadCuts, type CarveOptions } from './cityMegastructures.ts';
import type { CityVolume, MegastructureDef, Rect, RibbonDef } from './cityPlan';

/**
 * THE STACK'S MASSING — Phase 2 of `docs/CITY_V2_BRIEF.md`.
 *
 * The city is one structure: the towers are not beside the roads, the roads run through
 * them. Fifteen footprints are placed by hand over the spine, the ring, the deck and the two
 * interchange corridors, given a simple massing each, and then CARVED by every ribbon that
 * crosses them (`cityMegastructures.ts`): each road reserves its asphalt, a margin, and the
 * headroom the chase camera needs, from two metres under the surface up. What is left is the
 * building — walls at the kerb, a ceiling over the lane, a slab over the whole interchange
 * with the decks and ramps passing through it at their own heights — and it is the same set
 * of boxes the simulation collides with, so no road is ever sealed by accident.
 *
 * Every stretch of road that ends up under a ceiling is a PASSAGE (`PassageDef`), which the
 * passage builder dresses with the soffit, ribs, ducts and amber strip lamps of
 * `city-v2-highway.webp`. `tests/stackWorld.test.ts` holds the brief's numbers: at least 40 %
 * of the spine enclosed on two sides, at least 30 % of L1 + L2 inside or under a building.
 *
 * Placement rules learned laying these out (north up, x east, z south):
 *
 *  - a footprint sits on the STRAIGHT part of a road. A road curving through a footprint is
 *    cut sample by sample and leaves a sawtooth wall; the fillets of the loops are 40-50 m,
 *    so every footprint below stops short of a corner's tangent points,
 *  - a straight road on the diagonal is cut as one box across the footprint
 *    (`clipDiagonals`), so the south passage and the deck bridges have straight walls,
 *  - in the two corridors the roads run 17-18 m apart and each reserves 11-13 m of width,
 *    so nothing solid survives between them at road height: a building across a corridor is
 *    a slab over the whole interchange on a tower each side, which is the reference's
 *    "highway inside a structure" and the plan's stacked-crossing picture in one.
 */

/** How a road reserves its way through the buildings here. */
export const STACK_MASSING: CarveOptions = {
  /** Wall past the asphalt edge (m): the rail, a verge, the wall. */
  roadMargin: 2.4,
  /** Ceiling over the road (m). The chase camera rides 2-3 m over the car. */
  cameraClearance: 8.5,
  clipDiagonals: true,
  minSliver: 1.0,
};

/** How far over a road a ceiling may be and still make the stretch a passage (m). */
export const PASSAGE_MAX_CEILING = 12;
/**
 * How far past the asphalt edge a wall may stand and still enclose the lane (m). A diagonal
 * road through a straight-walled building drifts up to this far from its walls.
 */
export const PASSAGE_WALL_REACH = 14;

type Form = 'tower' | 'slab' | 'bridge';

interface Site {
  tag: string;
  footprint: Rect;
  /** Height of the tallest part (m). */
  height: number;
  form: Form;
  /** Which way the tower's cantilevered cap reaches: +x, -x, +z, -z. */
  reach?: [number, number];
}

/**
 * The footprints. Each comment names the roads that run through it; the carve does the rest.
 * Heights are the core's 80-160 m in the middle, lower toward the edges and on the bridges.
 */
export const STACK_SITES: Site[] = [
  // The spine's north leg (z -130, at 24): three passages with gaps of open sky between.
  { tag: 'north-a', footprint: { minX: -122, maxX: -72, minZ: -152, maxZ: -100 }, height: 124, form: 'tower', reach: [0, 1] },
  // Spine, the deck's nw→pinch diagonal crossing under it, and cut-b along it at ground.
  { tag: 'north-b', footprint: { minX: -48, maxX: 20, minZ: -152, maxZ: -96 }, height: 156, form: 'tower', reach: [-1, 0] },
  { tag: 'north-c', footprint: { minX: 44, maxX: 104, minZ: -152, maxZ: -100 }, height: 112, form: 'slab' },
  // The east corridor: spine, e-up-12, the deck's east leg and e-up-01, with av-gran-via
  // passing under the whole slab at ground.
  { tag: 'east-n', footprint: { minX: 150, maxX: 246, minZ: -108, maxZ: -36 }, height: 136, form: 'tower', reach: [-1, 0] },
  { tag: 'east-s', footprint: { minX: 150, maxX: 246, minZ: -8, maxZ: 66 }, height: 104, form: 'slab' },
  // The spine's south diagonal, ring-down coming in beside it, av-central under it.
  { tag: 'south', footprint: { minX: -95, maxX: -30, minZ: 134, maxZ: 194 }, height: 120, form: 'tower', reach: [1, 0] },
  // The west corridor: the spine's west leg with w-up-12 beside it (north), and the whole
  // corridor — st-west's kerb to the spine — under one slab (south).
  { tag: 'west-n', footprint: { minX: -200, maxX: -160, minZ: -88, maxZ: -10 }, height: 116, form: 'slab' },
  { tag: 'west-s', footprint: { minX: -246, maxX: -150, minZ: 24, maxZ: 100 }, height: 96, form: 'bridge' },
  // The ring (36): a tower over its west leg, a bridge over its east leg.
  { tag: 'ring-w', footprint: { minX: -125, maxX: -85, minZ: -40, maxZ: 0 }, height: 128, form: 'tower', reach: [1, 0] },
  { tag: 'ring-e', footprint: { minX: 76, maxX: 104, minZ: -4, maxZ: 40 }, height: 100, form: 'bridge' },
  // Bridges over the deck's diagonals: the w→nw leg in the north-west (st-north under it),
  // the se→s leg in the south with s-up-01 merging beside it (st-centre under it).
  { tag: 'deck-nw', footprint: { minX: -112, maxX: -74, minZ: -250, maxZ: -198 }, height: 82, form: 'bridge' },
  { tag: 'deck-s', footprint: { minX: 12, maxX: 56, minZ: 200, maxZ: 236 }, height: 76, form: 'bridge' },
];

/* ------------------------------------------------------------------ massing */

function box(r: Rect, y0: number, y1: number, role: CityVolume['role']): CityVolume {
  return { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, y0, y1, role };
}

function inset(r: Rect, dx0: number, dx1: number, dz0: number, dz1: number): Rect {
  return { minX: r.minX + dx0, maxX: r.maxX - dx1, minZ: r.minZ + dz0, maxZ: r.maxZ - dz1 };
}

/** Whole floors (3 m), never less than one. */
function floors(h: number): number {
  return Math.max(3, Math.round(h / 3) * 3);
}

/** The uncarved massing of a site: a few boxes, the carve makes them a building. */
function massing(site: Site): CityVolume[] {
  const f = site.footprint;
  const w = f.maxX - f.minX;
  const d = f.maxZ - f.minZ;
  const h = floors(site.height);
  if (site.form === 'bridge') {
    // A slab building: the road corridors take their bites out of one block, and the top
    // storeys step back a little so the roofline is not one line.
    return [box(f, 0, h - 9, 'podium'), box(inset(f, 4, 4, 3, 3), h - 9, h, 'top')];
  }
  if (site.form === 'slab') {
    // A podium the full footprint, then one thin slab the long way, pushed to one side.
    const podium = floors(Math.min(h * 0.4, 42));
    const thin = w >= d ? 'z' : 'x';
    const slab = thin === 'z' ? inset(f, 3, 3, d * 0.08, d * 0.5) : inset(f, w * 0.08, w * 0.5, 3, 3);
    return [box(f, 0, podium, 'podium'), box(slab, podium, h, 'body')];
  }
  // A tower: podium, a main shaft in one corner, a lower second shaft in the other, and the
  // top storeys of the main shaft cantilevered out past the footprint on `reach`'s side.
  const podium = floors(Math.min(h * 0.32, 39));
  const [rx, rz] = site.reach ?? [1, 0];
  const main: Rect = rx !== 0
    ? inset(f, rx > 0 ? w * 0.34 : 3, rx > 0 ? 3 : w * 0.34, d * 0.1, d * 0.1)
    : inset(f, w * 0.1, w * 0.1, rz > 0 ? d * 0.34 : 3, rz > 0 ? 3 : d * 0.34);
  const other: Rect = rx !== 0
    ? inset(f, rx > 0 ? 3 : w * 0.7, rx > 0 ? w * 0.7 : 3, d * 0.16, d * 0.16)
    : inset(f, w * 0.16, w * 0.16, rz > 0 ? 3 : d * 0.7, rz > 0 ? d * 0.7 : 3);
  const cap: Rect = {
    minX: main.minX - (rx < 0 ? 6 : 0),
    maxX: main.maxX + (rx > 0 ? 6 : 0),
    minZ: main.minZ - (rz < 0 ? 6 : 0),
    maxZ: main.maxZ + (rz > 0 ? 6 : 0),
  };
  const capY = h - 12;
  return [
    box(f, 0, podium, 'podium'),
    box(main, podium, capY, 'body'),
    box(cap, capY, h, 'wing'),
    box(other, podium, floors(podium + (h - podium) * 0.58), 'body'),
  ];
}

/* ------------------------------------------------------------------ the plan */

/**
 * Every site carved by every ribbon, with the passages the carve produced. `offset` moves the
 * footprints: Bandido Metro (`metroSpec.ts`) builds the Stack in the middle of a bigger map,
 * and its ribbons arrive already translated, so the sites follow them by the same vector.
 */
export function planStackMassing(ribbons: readonly RibbonDef[], offset = { x: 0, z: 0 }): MegastructureDef[] {
  return STACK_SITES.map((site) => {
    const footprint: Rect = { minX: site.footprint.minX + offset.x, maxX: site.footprint.maxX + offset.x, minZ: site.footprint.minZ + offset.z, maxZ: site.footprint.maxZ + offset.z };
    const cuts = roadCuts(ribbons, STACK_MASSING, footprint);
    const volumes = carveVolumes(massing({ ...site, footprint }), cuts, STACK_MASSING.minSliver);
    const passages = findPassages(volumes, footprint, ribbons, PASSAGE_MAX_CEILING, PASSAGE_WALL_REACH, STACK_MASSING.roadMargin);
    return { tag: `stack-${site.tag}`, footprint, volumes, passages };
  });
}
