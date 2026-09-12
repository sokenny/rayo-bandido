import type { CityRoadSpec, CitySpec, ElevatedRoadSpec } from './cityDef';
import type { BlockOptions } from './cityGen';
import type { Rect, ZoneId } from './cityPlan';
// The one value import in this data module, spelt with its extension so the QA scripts can
// still load the spec under plain Node (see `cityMegastructures.ts`).
import { planStackMassing } from './stackMassing.ts';
import type { TrackNode, TrackSpec } from './track';

/**
 * CITY v2 — "THE STACK". Data only; `createCityWorld(STACK_SPEC)` turns it into a world.
 * The brief is `docs/CITY_V2_BRIEF.md`, the approved plan `docs/CITY_V2_PLAN.md`; this file
 * is Phase 1 of it: the roads and the levels. Massing, enclosure and light are later phases.
 *
 * Read with north up (x east, z south). 600 x 600 m, no water, towers on all four sides:
 *
 *   - L0, the streets (y 0): two avenues, one long sweeper, two edge streets that double as
 *     the interchange corridors' ground level, three cross streets, curved connectors and
 *     narrow one-way cuts. Not a grid: spacing runs 70-140 m,
 *   - L1, the DECK (y 12): a closed loop that wanders the whole map and pinches through the
 *     centre in a hairpin, crossing under the spine four times,
 *   - L2, the SPINE (y 24): a closed highway loop through the middle of the core, mid-block
 *     on every leg, so the towers stand at its rails. The single most important road here,
 *   - L3, the RING (y 36): a small closed loop over the core, fed from the spine,
 *   - eight ramps: two vertical CORRIDORS on the west and east edges of the core where
 *     street, deck and spine run parallel 35 m apart and the ramps climb in the gaps
 *     between them, three ramps between the spine and the ring, and one from the sweeper up
 *     to the deck's south leg.
 *
 * Every ramp starts inside one road and ends inside another at that road's height, sliding
 * in parallel for its last stretch, the way Bandido Bay's do. All eight are drivable both
 * ways; the direction each is written in is the one whose merge is tangential.
 *
 * Districts (`zoneOf`): the CORE is corporate, the OLD-TOWN pocket in the south-east is jdm,
 * everything else urban. `scripts/stack-preview.mjs` reads these same lists and runs the
 * plan's checks over them; `tests/stackWorld.test.ts` is the contract.
 */

export const STACK_BOUNDS: Rect = { minX: -300, maxX: 300, minZ: -300, maxZ: 300 };
/** Perimeter band thickness (m), all four sides. */
export const STACK_WALL_BAND = 12;
/** The levels (m). */
export const STACK_L1_Y = 12;
export const STACK_L2_Y = 24;
export const STACK_L3_Y = 36;

/** The core: towers 80-160 m, the spine and the ring inside it. */
export const STACK_CORE: Rect = { minX: -175, maxX: 175, minZ: -150, maxZ: 200 };
/** The old-town pocket: 3-6 storey shabby blocks and alleys. */
export const STACK_OLD_TOWN: Rect = { minX: 150, maxX: 300, minZ: 130, maxZ: 300 };

export function zoneOf(x: number, z: number): ZoneId {
  if (x > STACK_OLD_TOWN.minX && z > STACK_OLD_TOWN.minZ) return 'jdm';
  if (x > STACK_CORE.minX && x < STACK_CORE.maxX && z > STACK_CORE.minZ && z < STACK_CORE.maxZ) return 'corporate';
  return 'urban';
}

/** Where the roads stop: at the perimeter band, less a car's length so the wall is the stop. */
const EDGE = STACK_WALL_BAND + 2.5;
const X_MIN = STACK_BOUNDS.minX + EDGE;
const X_MAX = STACK_BOUNDS.maxX - EDGE;
const Z_MIN = STACK_BOUNDS.minZ + EDGE;
const Z_MAX = STACK_BOUNDS.maxZ - EDGE;

/** A node in its district's zone. `y` given only on height anchors. */
const n = (x: number, z: number, r: number, width: number, y?: number, tag?: string): TrackNode => ({
  x,
  z,
  r,
  width,
  zone: zoneOf(x, z),
  ...(y !== undefined ? { y } : {}),
  ...(tag ? { tag } : {}),
});

const road = (tag: string, width: number, nodes: TrackNode[], kind: 'track' | 'alley' = 'track'): CityRoadSpec => ({
  tag,
  kind,
  spec: { closed: false, nodes: nodes.map((nd) => ({ ...nd, width })) },
});

/**
 * The elevated roads are sampled at 5 m round their bends rather than `track.ts`'s 3 m: the
 * fillets here are 30-50 m, where a 5 m chord sits 7-10 cm off the arc, and every sample of
 * an elevated road is a slab segment, two rail colliders and their art. A third of the
 * network's samples are in its bends.
 */
const ELEVATED_ARC_STEP = 5;
const ramp = (tag: string, nodes: TrackNode[]): CityRoadSpec => ({
  tag,
  kind: 'track',
  spec: { closed: false, arcStep: ELEVATED_ARC_STEP, nodes: nodes.map((nd) => ({ ...nd, width: 11 })) },
});
const loop = (width: number, nodes: TrackNode[]): TrackSpec => ({ closed: true, arcStep: ELEVATED_ARC_STEP, nodes: nodes.map((nd) => ({ ...nd, width })) });

/* ------------------------------------------------------------------ L0: the streets */

/**
 * Nothing crosses the two interchange corridors (x -252..-180 and 178..250) except
 * `av-gran-via` and `st-south`, which the ramps clear.
 */
export const STACK_ROADS: CityRoadSpec[] = [
  road('av-central', 22, [n(-60, Z_MIN, 0, 22), n(-60, Z_MAX, 0, 22)]),
  road('av-gran-via', 20, [n(X_MIN, -60, 0, 20), n(X_MAX, -60, 0, 20)]),
  // The sweeper: the southern boulevard, one long curve north-east, then straight up the map.
  road('av-sweeper', 18, [n(X_MIN, 252, 0, 18), n(20, 252, 170, 18), n(115, 130, 170, 18), n(115, Z_MIN, 0, 18)]),
  road('st-west', 13, [n(-252, Z_MIN, 0, 13), n(-252, Z_MAX, 0, 13)]),
  road('st-east', 13, [n(250, Z_MIN, 0, 13), n(250, Z_MAX, 0, 13)]),
  road('st-centre', 13, [n(30, Z_MIN, 0, 13), n(30, Z_MAX, 0, 13)]),
  road('st-north', 13, [n(X_MIN, -200, 0, 13), n(X_MAX, -200, 0, 13)]),
  road('st-mid', 13, [n(-130, 40, 0, 13), n(60, 40, 0, 13)]),
  road('st-south', 13, [n(X_MIN, 130, 0, 13), n(X_MAX, 130, 0, 13)]),
  road('st-oldtown', 12, [n(160, 130, 0, 12), n(160, Z_MAX, 0, 12)]),
  road('st-market', 12, [n(160, 200, 0, 12), n(250, 200, 0, 12)]),
  // Curved connectors.
  road('cn-northwest', 13, [n(-130, -200, 0, 13), n(-200, -235, 50, 13), n(-252, -235, 0, 13)]),
  road('cn-centre', 13, [n(60, 40, 0, 13), n(60, -10, 40, 13), n(20, -60, 0, 13)]),
  road('cn-southeast', 13, [n(160, 200, 0, 13), n(195, 250, 45, 13), n(250, 250, 0, 13)]),
  // Cuts: narrow one-way alleys between buildings.
  road('cut-a', 7.5, [n(-130, -200, 0, 7.5), n(-130, 130, 0, 7.5)], 'alley'),
  road('cut-b', 7.5, [n(-60, -130, 0, 7.5), n(30, -130, 0, 7.5)], 'alley'),
  road('cut-c', 7.5, [n(-130, 100, 0, 7.5), n(-60, 100, 0, 7.5)], 'alley'),
  road('cut-d', 7.5, [n(0, 130, 0, 7.5), n(0, Z_MAX, 0, 7.5)], 'alley'),
  road('cut-e', 7.5, [n(190, 130, 0, 7.5), n(190, Z_MAX, 0, 7.5)], 'alley'),
  road('cut-g', 7.5, [n(30, -10, 0, 7.5), n(115, -10, 0, 7.5)], 'alley'),
];

/* ------------------------------------------------------------------ L1, L2, L3 */

/** L1 — the deck: a closed loop with a hairpin pinch through the centre; crosses under the spine four times. */
export const STACK_DECK_SPEC: TrackSpec = loop(14, [
  n(-215, -160, 40, 14, STACK_L1_Y, 'w'),
  n(-60, -250, 50, 14, STACK_L1_Y, 'nw'),
  n(0, -20, 45, 14, STACK_L1_Y, 'pinch'),
  n(215, -180, 50, 14, STACK_L1_Y, 'ne'),
  n(215, 170, 50, 14, STACK_L1_Y, 'se'),
  n(-40, 215, 50, 14, STACK_L1_Y, 's'),
  n(-215, 150, 40, 14, STACK_L1_Y, 'sw'),
]);

/** L2 — the spine: a closed highway loop through the middle, mid-block on every leg. */
export const STACK_SPINE_SPEC: TrackSpec = loop(18, [
  n(-180, -130, 40, 18, STACK_L2_Y, 'nw'),
  n(178, -130, 40, 18, STACK_L2_Y, 'ne'),
  n(178, 110, 40, 18, STACK_L2_Y, 'se'),
  n(60, 190, 40, 18, STACK_L2_Y, 's'),
  n(-180, 150, 40, 18, STACK_L2_Y, 'w'),
]);

/** L3 — the ring: a small closed loop above the core, fed from the spine. */
export const STACK_RING_SPEC: TrackSpec = loop(13, [
  n(-105, -85, 45, 13, STACK_L3_Y, 'nw'),
  n(95, -85, 45, 13, STACK_L3_Y, 'ne'),
  n(95, 110, 45, 13, STACK_L3_Y, 'se'),
  n(-105, 110, 45, 13, STACK_L3_Y, 'sw'),
]);

/**
 * Ramps. Each starts inside one road, runs beside the next one in the gap between them and
 * slides in parallel. Every ramp is drivable both ways; the direction it is written in is
 * the one whose merge is tangential.
 *
 *   west corridor  x: st-west -252 | gap -232 | deck -215 | gap -198 | spine -180
 *   east corridor  x: spine 178 | gap 198 | deck 215 | gap 232 | st-east 250
 *
 * THE DIRECTIONS ARE A SYSTEM, like the Bay's viaduct, where each direction of the loop has
 * an on-ramp and an off-ramp. Both corridor 01 ramps merge onto the deck clockwise (north up
 * the west leg, south down the east); of the two 12 ramps one leaves the deck clockwise
 * (`w-up-12`, north) and one anticlockwise (`e-up-12`, north up the east leg), so whichever
 * way a car is going round the deck it can climb, and whichever way it is going round the
 * spine it can come down (a ramp driven backwards is the other direction's exit). The ring
 * ramps attach to the spine's clockwise direction, and `e-up-12` reversed brings the
 * anticlockwise spine back down. The plan first had both 12 ramps leaving anticlockwise,
 * which left a car coming up either 01 ramp with no way onto the spine short of a U-turn;
 * `w-up-12` was turned round in Phase 1.
 */
export const STACK_RAMPS: CityRoadSpec[] = [
  // Starts north of st-south so the climb crosses nothing at grade (the first draft's foot
  // crossed st-south as a metre-high hump).
  ramp('w-up-01', [n(-249, 120, 0, 11, 0), n(-232, 80, 30, 11), n(-232, -5, 30, 11, STACK_L1_Y), n(-218, -40, 30, 11), n(-217, -75, 0, 11, STACK_L1_Y)]),
  ramp('w-up-12', [n(-214, 115, 0, 11, STACK_L1_Y), n(-198, 80, 30, 11), n(-198, -50, 30, 11, STACK_L2_Y), n(-183, -78, 30, 11), n(-182, -88, 0, 11, STACK_L2_Y)]),
  // Flat until it is clear of st-east's asphalt, then the climb (see s-up-01).
  ramp('e-up-01', [n(247, -170, 0, 11, 0), n(232, -130, 30, 11, 0), n(232, -10, 30, 11, STACK_L1_Y), n(218, 25, 30, 11), n(217, 60, 0, 11, STACK_L1_Y)]),
  ramp('e-up-12', [n(214, 110, 0, 11, STACK_L1_Y), n(198, 70, 30, 11), n(198, -40, 30, 11, STACK_L2_Y), n(183, -72, 30, 11), n(182, -95, 0, 11, STACK_L2_Y)]),
  // Off the spine sideways first, at spine height, and only then up: a ramp that climbs while
  // its slab is still between the spine's rails puts the spine's rail across its own lane (the
  // first draft's did, at 3 m up).
  ramp('ring-up', [n(-135, -131, 0, 11, STACK_L2_Y), n(-120, -131, 30, 11, STACK_L2_Y), n(-88, -114, 30, 11, STACK_L2_Y), n(10, -98, 40, 11), n(30, -86, 30, 11, STACK_L3_Y), n(50, -86, 0, 11, STACK_L3_Y)]),
  ramp('ring-down', [n(30, 111, 0, 11, STACK_L3_Y), n(-20, 111, 30, 11, STACK_L3_Y), n(-90, 145, 40, 11), n(-125, 159, 30, 11, STACK_L2_Y), n(-160, 153, 0, 11, STACK_L2_Y)]),
  ramp('ring-up-e', [n(177, -70, 0, 11, STACK_L2_Y), n(177, -30, 30, 11, STACK_L2_Y), n(118, 22, 40, 11), n(97, 45, 20, 11, STACK_L3_Y), n(96, 66, 0, 11, STACK_L3_Y)]),
  // The south: up from the sweeper onto the deck's south leg, eastbound. Flat until it has
  // left the sweeper's asphalt, then the climb: a ramp that rises while its slab still hangs
  // over a street's lane is a wall in that lane (Phase 1 found the first draft doing exactly
  // that, 1-4 m over the sweeper's north lane for 50 m).
  // It also keeps 16 m south of the deck's south leg until it is at deck height: closer, its
  // rail ran under the deck's own edge at the s corner.
  ramp('s-up-01', [n(-190, 255, 0, 11, 0), n(-150, 236.5, 25, 11, 0), n(-20, 228, 40, 11, STACK_L1_Y), n(30, 210, 30, 11, STACK_L1_Y), n(80, 194, 0, 11, STACK_L1_Y)]),
];

/** The elevated roads in one list, each with the level it belongs to (ramps: the level they climb to). */
export const STACK_ELEVATED: Array<ElevatedRoadSpec & { level: 1 | 2 | 3 }> = [
  { tag: 'deck', spec: STACK_DECK_SPEC, lift: 0, level: 1 },
  { tag: 'spine', spec: STACK_SPINE_SPEC, lift: 0, level: 2 },
  { tag: 'ring', spec: STACK_RING_SPEC, lift: 0, level: 3 },
  ...STACK_RAMPS.map((r) => ({ tag: r.tag, spec: r.spec, lift: 0.08, level: rampLevel(r.tag) })),
];

function rampLevel(tag: string): 1 | 2 | 3 {
  return tag.startsWith('ring-up') ? 3 : tag.endsWith('-12') || tag === 'ring-down' ? 2 : 1;
}

/* ------------------------------------------------------------------ blocks */

/**
 * `cityGen.hash01`, repeated: this module imports types only, so that `scripts/stack-preview.mjs`
 * can load it under plain Node (whose TypeScript loader does not resolve extensionless value
 * imports) and check the very same lists the game builds from.
 */
function hash01(x: number, z: number): number {
  return Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
}

/**
 * The plain blocks between the megastructures (`stackMassing.ts`): the core banded tall, the
 * old town low. ZERO SETBACK: the brief wants the buildings at the kerb, so the shoulder
 * between a road's edge and the block is under a metre (the Bay's is 2.6-5) and the blocks
 * keep half a metre of their own slab in front of their walls (`STACK_ART.setback`). Nothing
 * is paved beside the streets: the kerb field does not pave a shoulder that narrow, which is
 * the brief's "pavement only where a bus stop or a stall needs it".
 */
export const STACK_BLOCK_OPTIONS: BlockOptions = {
  cell: 110,
  minCell: 11,
  axisSplit: true,
  mergeUpTo: 80,
  shoulder: { corporate: 0.6, urban: 0.6, jdm: 0.4 },
  alleyShoulder: 0.3,
  elevatedShoulder: 1.6,
  elevatedAbove: 2.5,
  massingFor(rect, zone) {
    const w = rect.maxX - rect.minX;
    const d = rect.maxZ - rect.minZ;
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    const h = hash01(cx, cz);
    if (Math.min(w, d) < 7) return 1;
    if (zone === 'corporate') return Math.min(w, d) >= 12 && h < 0.8 ? 4 : 3;
    if (Math.min(w, d) < 11 || w * d < 220) return 1;
    if (zone === 'urban') return h < 0.35 ? 3 : h < 0.85 ? 2 : 1;
    return h < 0.2 ? 2 : 1;
  },
};

/* ------------------------------------------------------------------ traffic */

/**
 * Traffic: rectangles of street centrelines, driven clockwise in the right-hand lane. Ten
 * rectangles, every corner a real crossing of two straight streets (the sweeper's straight
 * leg up x 115 and its southern straight both count).
 */
export const STACK_TRAFFIC_LOOPS: Array<{ rect: Rect; cars: number }> = [
  { rect: { minX: -252, maxX: -60, minZ: -200, maxZ: -60 }, cars: 6 },
  { rect: { minX: -60, maxX: 30, minZ: -200, maxZ: -60 }, cars: 6 },
  { rect: { minX: 30, maxX: 115, minZ: -200, maxZ: -60 }, cars: 6 },
  { rect: { minX: 115, maxX: 250, minZ: -200, maxZ: -60 }, cars: 6 },
  { rect: { minX: -252, maxX: -60, minZ: -60, maxZ: 130 }, cars: 6 },
  { rect: { minX: -60, maxX: 30, minZ: -60, maxZ: 130 }, cars: 6 },
  { rect: { minX: 30, maxX: 115, minZ: -60, maxZ: 130 }, cars: 6 },
  { rect: { minX: 115, maxX: 250, minZ: -60, maxZ: 130 }, cars: 6 },
  { rect: { minX: 160, maxX: 250, minZ: 130, maxZ: 200 }, cars: 4 },
  { rect: { minX: -252, maxX: -60, minZ: 130, maxZ: 252 }, cars: 4 },
];

/**
 * Cars lapping the three elevated loops: Bandido Bay's density (64 on 1,728 m of viaduct)
 * scaled by length, as the plan asks, to be measured against the frame budget at the gate.
 */
export const STACK_DECK_TRAFFIC = [
  { tag: 'deck', cars: 60, lanes: [4.6, 1.5] },
  { tag: 'spine', cars: 44, lanes: [5, 1.5] },
  { tag: 'ring', cars: 24, lanes: [4.2, 1.4] },
];

/** The car starts on the central avenue in the core, pointed north at the spine. */
export const STACK_SPAWN = { x: -56, z: 70, heading: 0 };

/* ------------------------------------------------------------------ the spec */

/**
 * Where the triangles go. Bandido Bay's elevated structure costs about 34 triangles per metre
 * all in (slab, soffit, ribs, four girders, three service runs, rails, columns, fences, a
 * street lamp every 38 m); The Stack has 5.2 km of it against the Bay's 3.4 km and a 220k
 * ceiling for the whole city (`docs/CITY_V2_BRIEF.md`). So the decks here take the plan's
 * lean profile (`docs/CITY_V2_PLAN.md` §9): ribs every 16 m, the edge girders only, one
 * service run, columns every 16 m with a fence in one bay in three, and lamps further apart.
 * The greenery floor is lower too: the reclamation budget is 15k here, not the Bay's 50k.
 */
export const STACK_ART = {
  ribSpacing: 16,
  deckServices: 'lean' as const,
  lampSpacing: { street: 56, deck: 76 },
  neglect: 0.25,
  /** Buildings at the kerb: half a metre of slab in front of a wall, not the Bay's 3.4. */
  setback: 0.5,
  /** Rooftop clutter is where the Bay spends triangles nobody drives past (brief, rule 6). */
  roofClutter: 0.35,
  /** The megastructures wear the kit's facades; the passages inside them carry the detail. */
  megaDetail: 'lean' as const,
};

/**
 * The three hand-drawn silhouettes on the horizon (`buildingKit`'s `LANDMARKS`: 0 spire,
 * 2 blade, 3 twins), one in each far corner the core does not reach.
 */
export const STACK_LANDMARKS = [
  { x: -240, z: -240, kind: 0 },
  { x: 250, z: -250, kind: 2 },
  { x: -250, z: 250, kind: 3 },
];

/**
 * Skybridges between the towers over the avenues: three tiers, two in five bare concrete,
 * the rest lit and occupied.
 */
export const STACK_SKYBRIDGES = { heights: [16, 27, 40], concreteShare: 0.4, max: 28, step: 45 };

export const STACK_SPEC: CitySpec = {
  name: 'The Stack',
  bounds: STACK_BOUNDS,
  wallBand: STACK_WALL_BAND,
  water: null,
  pillarStep: 16,
  fenceBays: 'few',
  art: STACK_ART,
  zoneOf,
  roads: STACK_ROADS,
  elevated: STACK_ELEVATED.map(({ tag, spec, lift }) => ({ tag, spec, lift })),
  blockOptions: STACK_BLOCK_OPTIONS,
  // The city is one structure: the towers the spine, the ring and the deck run through.
  planMegastructures: planStackMassing,
  // Portal frames over every open stretch of the two highway levels.
  portalFrames: ['spine', 'ring'],
  landmarks: STACK_LANDMARKS,
  skybridges: STACK_SKYBRIDGES,
  downtown: STACK_CORE,
  // Neon is rare in the references: no screen districts, no holograms, no drum of screens.
  neonDistricts: [],
  ringBillboards: [],
  radioTowers: [
    { x: -294, z: -240, height: 100, base: 8 },
    { x: 294, z: 40, height: 84, base: 7 },
  ],
  powerLine: null,
  billboards: () => [],
  gates: () => [],
  skybridgeStreets: ['av-central', 'av-gran-via', 'st-centre', 'st-north', 'st-south', 'st-mid'],
  trafficLoops: STACK_TRAFFIC_LOOPS,
  deckTraffic: STACK_DECK_TRAFFIC,
  cruiseLoop: STACK_TRAFFIC_LOOPS[5].rect,
  // No bus network and no missions: those move in with Phase 4.
  busRoutes: [],
  busRouteLoops: [],
  spawn: STACK_SPAWN,
  rushSites: [],
  passengerStops: [],
  buhoSite: null,
};
