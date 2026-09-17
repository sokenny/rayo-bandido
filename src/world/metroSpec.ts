import type { CarMeetSpec } from './carMeet';
import { RAMP_LIFT, type CityRoadSpec, type CitySpec, type ElevatedRoadSpec, type PassengerStopSpec } from './cityDef';
import type { GasStationSpec } from './gasStation';
import type { GarageSpec } from './garage';
import type { BlockOptions } from './cityGen';
import type { Rect, ZoneId } from './cityPlan';
// Value imports spelt with their extension, so `scripts/metro-preview.mjs` can load this spec
// under plain Node the way `scripts/stack-preview.mjs` loads the Stack's (see `stackSpec.ts`).
import { inRect } from './cityPlan.ts';
import { CURVA_SITE } from './curvaSpec.ts';
import { PAL } from '../render/scene/env/palette.ts';
import { metroTerrain } from './metroTerrain.ts';
import { METRO_PARK, PARK_BRIDGE, PARK_ENTRIES, PARK_LAND, PARK_NORTH, PARK_ROADS } from './metroPark.ts';
import { planStackMassing } from './stackMassing.ts';
import { METRO_OBELISCO, METRO_VILLA, NUEVE_DE_JULIO } from './metroVilla.ts';
import { METRO_ROUNDABOUTS, METRO_SOUTH_CUTS, METRO_SOUTH_PATH_TRAFFIC, METRO_SOUTH_RING_TRAFFIC, cutRoads, metroSouthRoads } from './metroSouth.ts';
import {
  STACK_ART,
  STACK_BLOCK_OPTIONS,
  STACK_BOUNDS,
  STACK_CORE,
  STACK_DECK_TRAFFIC,
  STACK_ELEVATED,
  STACK_LANDMARKS,
  STACK_ROADS,
  STACK_SCREENS,
  STACK_SKYBRIDGES,
  STACK_SPEC,
  STACK_TRAFFIC_LOOPS,
  STACK_WALL_BAND,
  zoneOf as stackZoneOf,
} from './stackSpec.ts';
import type { TrackNode, TrackSpec } from './track';

/**
 * BANDIDO METRO — the two cities in one. Data only; `createCityWorld(METRO_SPEC)` turns it into
 * a world, the same assembler Bandido Bay and The Stack go through, and neither of those two
 * specs is touched: they stay on the menu as they are.
 *
 * Read with north up (x east, z south). 1,400 x 1,950 m of city, water along the south edge,
 * and since 2026-09-16 a 500 m park across the whole north edge (`metroPark.ts`): the city's
 * grid, its wall bands and its streets are exactly what they were; the park is land added
 * beyond the old north wall, entered through three of the avenues, and the north wall band
 * now stands behind its trees.
 *
 *   - DOWNTOWN is The Stack (`stackSpec.ts`), every road, level, ramp, megastructure and
 *     traffic loop of it, moved as one piece to `STACK_OFFSET` (the north end of the map, so
 *     the district south of it and the waterfront have room). Its streets that used to stop
 *     at its wall now run on across the whole map and become the spine of the outer grid,
 *     so downtown is entered along the same avenues it is built on. Inside `STACK_RECT`
 *     everything is the Stack's: concrete finish, half-metre setback, kerb-tight shoulders,
 *     the three-tier skybridges, the carved towers. Outside it is the Bay's,
 *   - the RING: four 20 m boulevards a block clear of the Stack's edge streets, the seam
 *     between the two cities and the bus network's inner loop,
 *   - the OUTER GRID: two avenues and two streets either side of the ring, streets every
 *     ~140 m down to the water, a couple of alleys, the waterfront boulevard along the quay —
 *     and since 2026-09-17, south of av-s1, broken by diagonals, curved streets and three
 *     roundabouts round Plaza Estrella (`metroSouth.ts`),
 *   - the VIADUCT: a Bay-style closed highway at 15 m round the district south of downtown,
 *     out over the water on its south leg, with four ramps on its west and east legs (two
 *     per leg, one merging each way, so both directions have a way up and a way down),
 *   - districts: a corporate MIDTOWN band round downtown so the skyline steps down from the
 *     Stack, a small district of screens in the south-west, old town (jdm) along the water
 *     and in the south-east, urban everywhere else, thinning to low blocks at the edge.
 *
 * The Bay's economy of art everywhere but downtown: pavements, glass, a neon district,
 * holograms, gates, the reclamation floor, buses on the boulevards, the free-world activities.
 * A first cut was 2.6 km square (2026-09-13); Juan trimmed it to the Stack, the viaduct
 * district and the shore. `METRO_BOUNDS` is where to grow it again.
 */

export const METRO_BOUNDS: Rect = { minX: -700, maxX: 700, minZ: PARK_NORTH, maxZ: 1300 };
export const METRO_WALL_BAND = 12;
/** The city's own north edge, where its wall stood before the park: its grid and its streets still stop here. */
export const METRO_CITY_NORTH = -650;
/** Where the blocks are generated: the city inside its wall bands, above the quay (`CitySpec.blockBounds`). */
export const METRO_CITY: Rect = { minX: METRO_BOUNDS.minX + METRO_WALL_BAND, maxX: METRO_BOUNDS.maxX - METRO_WALL_BAND, minZ: METRO_CITY_NORTH + METRO_WALL_BAND, maxZ: 1200 };
/** The quay: land ends here, water begins. */
export const METRO_QUAY_Z = 1200;
/** Where the Stack is put down, as a translation of its own coordinates. */
export const STACK_OFFSET = { x: 0, z: -120 };
/** The Stack's footprint in the metro: inside it every rule is the Stack's. */
export const STACK_RECT: Rect = {
  minX: STACK_BOUNDS.minX + STACK_OFFSET.x,
  maxX: STACK_BOUNDS.maxX + STACK_OFFSET.x,
  minZ: STACK_BOUNDS.minZ + STACK_OFFSET.z,
  maxZ: STACK_BOUNDS.maxZ + STACK_OFFSET.z,
};
/** The Stack's core, in the metro: the skyscraper district. */
export const METRO_DOWNTOWN: Rect = shift(STACK_CORE);

/** The ring boulevards: 40 m clear of the Stack's bounds. */
export const RING = { west: STACK_RECT.minX - 40, east: STACK_RECT.maxX + 40, north: STACK_RECT.minZ - 40, south: STACK_RECT.maxZ + 40 };

/** Height of the viaduct deck (m), the Bay's. */
export const METRO_VIADUCT_Y = 15;

/** Where the roads stop: at the perimeter band, less a car's length so the wall is the stop. */
const EDGE = METRO_WALL_BAND + 2.5;
const X_MIN = METRO_BOUNDS.minX + EDGE;
const X_MAX = METRO_BOUNDS.maxX - EDGE;
const Z_MIN = METRO_CITY_NORTH + EDGE;
/** Where the north-south roads stop: inside the waterfront boulevard. */
const Z_SHORE = METRO_QUAY_Z - 8;
/** The Stack's own edge, in its own coordinates: where its roads used to stop. */
const STACK_EDGE = STACK_WALL_BAND + 2.5;

/* ------------------------------------------------------------------ districts */

/** The south-west business district: towers and screens, the Bay's square. */
export const SOUTHWEST: Rect = { minX: -620, maxX: -340, minZ: 640, maxZ: 920 };
/** Midtown: the corporate band round downtown. */
export const MIDTOWN: Rect = { minX: -480, maxX: 480, minZ: -600, maxZ: 360 };

export function zoneOf(x: number, z: number): ZoneId {
  if (inRect(STACK_RECT, x, z)) return stackZoneOf(x - STACK_OFFSET.x, z - STACK_OFFSET.z);
  if (z > 1000) return 'jdm';
  if (x > 480 && z > 640) return 'jdm';
  if (inRect(SOUTHWEST, x, z)) return 'corporate';
  if (inRect(MIDTOWN, x, z)) return 'corporate';
  return 'urban';
}

/** How far out toward the edge a point is, 0 in the middle of the land, 1 at the wall. */
function edgeness(x: number, z: number): number {
  return Math.max(Math.abs(x) / METRO_BOUNDS.maxX, Math.abs(z - 300) / (METRO_BOUNDS.maxZ - 300));
}

/**
 * How much of the dressing a point gets (`CityPlan.densityAt`): downtown everything, as the
 * Stack was approved; the ring of midtown most of it; the rest a little less. The first,
 * 2.6 km cut of this map was three and a half million triangles at the Bay's density of
 * lamps, greenery and rooftop clutter before downtown was counted; this is the knob.
 */
export function densityAt(x: number, z: number): number {
  // The park: its roads keep fewer of the street lamps, so there is dark between the lit places.
  if (inRect(PARK_LAND, x, z)) return 0.55;
  if (inRect(STACK_RECT, x, z)) return 1;
  if (inRect(MIDTOWN, x, z)) return 0.85;
  return 0.7;
}

/* ------------------------------------------------------------------ helpers */

function shift(r: Rect): Rect {
  return { minX: r.minX + STACK_OFFSET.x, maxX: r.maxX + STACK_OFFSET.x, minZ: r.minZ + STACK_OFFSET.z, maxZ: r.maxZ + STACK_OFFSET.z };
}

/** `cityGen.hash01`, repeated so this module keeps to type imports and Node can load it. */
function hash01(x: number, z: number): number {
  return Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
}

/** A node in its district's zone. `y` given only on height anchors. */
const n = (x: number, z: number, r: number, width: number, y?: number, zone?: ZoneId): TrackNode => ({
  x,
  z,
  r,
  width,
  zone: zone ?? zoneOf(x, z),
  ...(y !== undefined ? { y } : {}),
});

const road = (tag: string, width: number, nodes: TrackNode[], kind: 'track' | 'alley' = 'track'): CityRoadSpec => ({
  tag,
  kind,
  spec: { closed: false, nodes: nodes.map((nd) => ({ ...nd, width })) },
});

/** How finely a straight road is walked for the district changes along it (m). */
const ZONE_STEP = 10;

/**
 * The nodes of a straight from (ax, az) to (bx, bz), with a node wherever the district
 * changes, so the blocks along it take the zone of the stretch they stand on (the assembler
 * reads a block's zone off the nearest road sample). The Bay marks these by hand.
 */
function straightNodes(ax: number, az: number, bx: number, bz: number, width: number, from = 0, to = 1): TrackNode[] {
  const len = Math.hypot(bx - ax, bz - az);
  const out: TrackNode[] = [];
  const at = (t: number): [number, number] => [ax + (bx - ax) * t, az + (bz - az) * t];
  const [sx, sz] = at(from);
  out.push(n(sx, sz, 0, width));
  let zone = zoneOf(sx, sz);
  for (let d = ZONE_STEP; d < len * (to - from) - ZONE_STEP; d += ZONE_STEP) {
    const t = from + d / len;
    const [x, z] = at(t);
    const zn = zoneOf(x, z);
    if (zn === zone) continue;
    zone = zn;
    out.push(n(x, z, 0, width));
  }
  const [ex, ez] = at(to);
  out.push(n(ex, ez, 0, width));
  return out;
}

const straight = (tag: string, width: number, ax: number, az: number, bx: number, bz: number, kind: 'track' | 'alley' = 'track'): CityRoadSpec =>
  road(tag, width, straightNodes(ax, az, bx, bz, width), kind);

/* ------------------------------------------------------------------ the Stack, moved */

/** A Stack node in the metro. */
function moved(nd: TrackNode): TrackNode {
  return { ...nd, x: nd.x + STACK_OFFSET.x, z: nd.z + STACK_OFFSET.z };
}

function movedSpec(spec: TrackSpec): TrackSpec {
  return { ...spec, nodes: spec.nodes.map(moved) };
}

/**
 * A Stack road, moved, and run on to the edge of the metro wherever it used to stop at the
 * Stack's wall: a street that ended at x -285.5 now starts at the west wall, one that ended
 * at z 285.5 runs to the shore. The cuts (alleys) only run on to the ring. The stretch added
 * takes its districts from `zoneOf` node by node; the Stack's own nodes keep theirs.
 */
function stackRoad(r: CityRoadSpec): CityRoadSpec {
  const nodes = r.spec.nodes.map(moved);
  const width = nodes[0].width;
  const alley = r.kind === 'alley';
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const edgeW = STACK_BOUNDS.minX + STACK_EDGE + STACK_OFFSET.x;
  const edgeE = STACK_BOUNDS.maxX - STACK_EDGE + STACK_OFFSET.x;
  const edgeN = STACK_BOUNDS.minZ + STACK_EDGE + STACK_OFFSET.z;
  const edgeS = STACK_BOUNDS.maxZ - STACK_EDGE + STACK_OFFSET.z;
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;
  /** The straight from the edge to the Stack's end node, the Stack's node dropped (it is the last one added). */
  const lead = (ax: number, az: number, node: TrackNode): TrackNode[] => straightNodes(ax, az, node.x, node.z, width).slice(0, -1);
  const trail = (node: TrackNode, bx: number, bz: number): TrackNode[] => straightNodes(node.x, node.z, bx, bz, width).slice(1);
  let out = nodes;
  // A street that runs on into the park (`PARK_ENTRIES`) starts past the loop it crosses there.
  const north = PARK_ENTRIES[r.tag] ?? Z_MIN;
  if (near(first.x, edgeW)) out = [...lead(alley ? RING.west : X_MIN, first.z, first), ...out];
  else if (near(first.x, edgeE)) out = [...lead(alley ? RING.east : X_MAX, first.z, first), ...out];
  else if (near(first.z, edgeN)) out = [...lead(first.x, alley ? RING.north : north, first), ...out];
  else if (near(first.z, edgeS)) out = [...lead(first.x, alley ? RING.south : Z_SHORE, first), ...out];
  if (near(last.x, edgeW)) out = [...out, ...trail(last, alley ? RING.west : X_MIN, last.z)];
  else if (near(last.x, edgeE)) out = [...out, ...trail(last, alley ? RING.east : X_MAX, last.z)];
  else if (near(last.z, edgeN)) out = [...out, ...trail(last, last.x, alley ? RING.north : Z_MIN)];
  else if (near(last.z, edgeS)) out = [...out, ...trail(last, last.x, alley ? RING.south : Z_SHORE)];
  return { tag: r.tag, kind: r.kind, spec: { ...r.spec, nodes: out } };
}

export const DOWNTOWN_ROADS: CityRoadSpec[] = STACK_ROADS.map(stackRoad);

export const DOWNTOWN_ELEVATED: ElevatedRoadSpec[] = STACK_ELEVATED.map(({ tag, spec, lift }) => ({ tag, spec: movedSpec(spec), lift }));

/* ------------------------------------------------------------------ the outer grid */

/** North-south roads outside the Stack's columns: [x, width, tag]. Avenues 18 m, streets 13. */
const OUTER_NS: Array<[number, number, string]> = [
  [-620, 18, 'av-w1'],
  [-480, 13, 'st-w3'],
  [480, 13, 'st-e3'],
  [620, 18, 'av-e1'],
];

/** East-west roads outside the Stack's rows: [z, width, tag]. */
const OUTER_EW: Array<[number, number, string]> = [
  [-600, 13, 'st-n3'],
  [360, 13, 'st-s3'],
  [500, 18, 'av-s1'],
  [640, 13, 'st-s4'],
  [780, 18, 'av-s2'],
  [920, 13, 'st-s5'],
  [1060, 13, 'st-s6'],
];

export const OUTER_ROADS: CityRoadSpec[] = [
  // The ring: four boulevards, each the full width of the map.
  straight('blvd-ring-n', 20, X_MIN, RING.north, X_MAX, RING.north),
  straight('blvd-ring-s', 20, X_MIN, RING.south, X_MAX, RING.south),
  straight('blvd-ring-w', 20, RING.west, Z_MIN, RING.west, Z_SHORE),
  straight('blvd-ring-e', 20, RING.east, Z_MIN, RING.east, Z_SHORE),
  // Two of these run on into the park, across its loop (`PARK_ENTRIES`); st-e3 is the 9 de Julio
  // for a stretch (`metroVilla.ts`).
  ...OUTER_NS.map(([x, w, tag]) =>
    tag === NUEVE_DE_JULIO.tag
      ? { tag, kind: 'track' as const, spec: { closed: false, nodes: nueveDeJulioNodes(x, PARK_ENTRIES[tag] ?? Z_MIN, w) } }
      : straight(tag, w, x, PARK_ENTRIES[tag] ?? Z_MIN, x, Z_SHORE),
  ),
  ...OUTER_EW.map(([z, w, tag]) => straight(tag, w, X_MIN, z, X_MAX, z)),
  // The waterfront boulevard, along the quay.
  straight('blvd-water', 16, X_MIN, METRO_QUAY_Z - 14, X_MAX, METRO_QUAY_Z - 14),
  // Alleys: narrow, bare, threaded between the big streets.
  straight('alley-s1', 7.5, -180, 1060, -180, METRO_QUAY_Z - 14, 'alley'),
  straight('alley-s2', 7.5, 480, 990, 620, 990, 'alley'),
  straight('alley-w1', 7.5, -550, 920, -550, 1060, 'alley'),
  straight('alley-e1', 7.5, 480, -530, 620, -530, 'alley'),
];

/**
 * St-e3 with the 9 de Julio in it: the street's own nodes outside the stretch, and four nodes
 * that taper it out to the avenue's width and back (`track.ts` lerps a width along a straight).
 */
function nueveDeJulioNodes(x: number, north: number, width: number): TrackNode[] {
  const { fromZ, toZ, taper } = NUEVE_DE_JULIO;
  const nodes = straightNodes(x, north, x, Z_SHORE, width)
    // The tapers are straight lerps, so nothing may break them; a district change inside the full stretch is kept.
    .filter((nd) => !((nd.z > fromZ - taper && nd.z < fromZ) || (nd.z > toZ && nd.z < toZ + taper)))
    .map((nd) => (nd.z >= fromZ && nd.z <= toZ ? { ...nd, width: NUEVE_DE_JULIO.width } : nd));
  const ends = [n(x, fromZ - taper, 0, width), n(x, fromZ, 0, NUEVE_DE_JULIO.width), n(x, toZ, 0, NUEVE_DE_JULIO.width), n(x, toZ + taper, 0, width)];
  return [...nodes.filter((nd) => !ends.some((e) => Math.abs(e.z - nd.z) < 1)), ...ends].sort((a, b) => a.z - b.z);
}

/** The south's diagonals, curves and roundabouts (`metroSouth.ts`). */
export const METRO_SOUTH_ROADS: CityRoadSpec[] = metroSouthRoads(zoneOf, Z_SHORE, X_MAX, X_MIN);

/* ------------------------------------------------------------------ the viaduct */

/** The viaduct's legs: mid-block between the streets at ±480 and ±620, and between the ring and the street at 360. */
const VIA_X = 550;
const VIA_N = 290;
const VIA_S = 1245;

/** Clockwise from the south-west corner, the south leg out over the water. All corporate, like the Bay's. */
export const VIADUCT_SPEC: TrackSpec = {
  closed: true,
  nodes: [
    n(-VIA_X, VIA_S, 60, 18, METRO_VIADUCT_Y, 'corporate'),
    n(-VIA_X, VIA_N, 70, 18, METRO_VIADUCT_Y, 'corporate'),
    n(VIA_X, VIA_N, 70, 18, METRO_VIADUCT_Y, 'corporate'),
    n(VIA_X, VIA_S, 60, 18, METRO_VIADUCT_Y, 'corporate'),
  ],
};

/**
 * Four ramps, all the Bay's on-ramp shape: start inside the street 70 m from the leg, climb
 * beside the deck, slide in parallel and merge. Two on each leg, one merging each way round
 * the loop, so whichever way a car is going it can get on, and (driven backwards) off. Each
 * starts 20 m past a cross street and is at deck height by the next one, so nothing at grade
 * is crossed while it is low (`tests/metroWorld.test.ts` walks every crossing).
 */
const rampNodes = (leg: number, dir: 1 | -1, z0: number): TrackNode[] => {
  const side = Math.sign(leg);
  const x = (off: number): number => leg - side * off;
  return [
    n(x(64), z0, 0, 11, 0, 'corporate'),
    n(x(48), z0 + dir * 14, 25, 11, undefined, 'corporate'),
    n(x(48), z0 + dir * 124, 40, 11, METRO_VIADUCT_Y, 'corporate'),
    n(x(4), z0 + dir * 164, 30, 11, undefined, 'corporate'),
    n(x(3), z0 + dir * 204, 0, 11, METRO_VIADUCT_Y, 'corporate'),
  ];
};

export const METRO_RAMPS: CityRoadSpec[] = [
  road('ramp-w-n', 11, rampNodes(-VIA_X, -1, 900)),
  road('ramp-w-s', 11, rampNodes(-VIA_X, 1, 400)),
  road('ramp-e-s', 11, rampNodes(VIA_X, 1, 540)),
  road('ramp-e-n', 11, rampNodes(VIA_X, -1, 1040)),
];

/* ------------------------------------------------------------------ blocks */

/** The Bay's shoulders, kept for the outer city; the Stack's inside `STACK_RECT`. */
const BAY_SHOULDER = { corporate: 5, urban: 3.2, jdm: 2.6 } as const;

export const METRO_BLOCK_OPTIONS: BlockOptions = {
  cell: 110,
  minCell: 11,
  axisSplit: true,
  mergeUpTo: 80,
  // The widest of either city's, for the bounding boxes; `shoulderAt` is the real rule.
  shoulder: { ...BAY_SHOULDER },
  shoulderAt(x, z, zone) {
    return inRect(STACK_RECT, x, z) ? STACK_BLOCK_OPTIONS.shoulder[zone] : BAY_SHOULDER[zone];
  },
  alleyShoulder: STACK_BLOCK_OPTIONS.alleyShoulder,
  elevatedShoulder: 1.6,
  elevatedAbove: 2.5,
  massingFor(rect, zone) {
    const w = rect.maxX - rect.minX;
    const d = rect.maxZ - rect.minZ;
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    if (inRect(STACK_RECT, cx, cz)) return STACK_BLOCK_OPTIONS.massingFor(rect, zone);
    const h = hash01(cx, cz);
    // Only a sliver stays low; a narrow plot in the core still carries a tower.
    if (Math.min(w, d) < 11 || w * d < 220) return 1;
    // The outskirts: low blocks, so the city thins toward the wall instead of stopping at it.
    if (edgeness(cx, cz) > 0.84) return h < 0.25 ? 2 : 1;
    if (zone === 'corporate') {
      // Midtown steps down from the Stack: a few skyscrapers, then towers.
      if (inRect(MIDTOWN, cx, cz) && Math.min(w, d) >= 14 && h < 0.3) return 4;
      return h < 0.15 ? 2 : 3;
    }
    if (zone === 'urban') return h < 0.3 ? 3 : h < 0.85 ? 2 : 1;
    return h < 0.25 ? 2 : 1;
  },
};

/* ------------------------------------------------------------------ the meet */

/**
 * THE CAR MEET (`carMeet.ts`), after Daikoku: the block inside the viaduct's north-west corner,
 * between blvd-ring-s, st-s3, av-w1 and st-w3, given up as a lot. The deck's curve (radius 70
 * about the crossing of st-w3 and st-s3) sweeps across it on seven pairs of columns, so from
 * anywhere on the lot the highway bends overhead against the sky.
 *
 * The lot runs out to the back of the pavement on all four sides. Four ways in: off the
 * boulevard (the main gate, with the green sign), off the avenue, and under the deck from
 * st-s3 and from st-w3, where the curve leaves the lot.
 *
 * What is on it: five cars nose-in along the north fence, four in a double row by the west
 * wall, three fanned out under a mast for the people standing in front of them, two under the
 * deck between the columns (one of them not parked so much as stopped), and two in the pocket
 * inside the curve by the kiosk and its vending machines, with a pair of trucks behind them.
 * Every position is checked against the columns, the walls and each other
 * (`tests/metroWorld.test.ts`).
 */
export const METRO_MEET_LOT: Rect = {
  minX: -620 + 9 + BAY_SHOULDER.urban,
  maxX: -480 - 6.5 - BAY_SHOULDER.corporate,
  minZ: RING.south + 10 + BAY_SHOULDER.urban,
  maxZ: 360 - 6.5 - BAY_SHOULDER.urban,
};

const L = METRO_MEET_LOT;

export const METRO_MEET: CarMeetSpec = {
  tag: 'meet-daikoku',
  label: 'LA CURVA · CAR MEET',
  lot: METRO_MEET_LOT,
  edges: [
    { side: 'n', from: L.minX, to: -588, kind: 'hoarding' },
    { side: 'n', from: -566, to: L.maxX, kind: 'fence' },
    { side: 'w', from: L.minZ, to: 298, kind: 'hoarding' },
    { side: 'w', from: 316, to: L.maxZ, kind: 'fence' },
    { side: 's', from: L.minX, to: -559, kind: 'hoarding' },
    { side: 's', from: -540, to: L.maxX, kind: 'barrier' },
    { side: 'e', from: L.minZ, to: 281.5, kind: 'fence' },
    { side: 'e', from: 300.5, to: L.maxZ, kind: 'hoarding' },
  ],
  cars: [
    // Nose-in along the north fence, one of them across two bays, one backed in.
    { x: -553.2, z: 237.3, heading: 0.03, paint: 0x565d66, glow: 0x39ff6a, tail: true },
    { x: -550.1, z: 237.2, heading: -0.02, paint: 0xc4161c, glow: 0xff9a2e, tail: true },
    { x: -541.4, z: 237.4, heading: 0, paint: 0xe9edf0, glow: 0x2f7bff },
    { x: -533.8, z: 238.3, heading: 0.32, paint: 0xf2c400, glow: 0x3fe8ff, steer: -0.35 },
    { x: -522.6, z: 237.6, heading: Math.PI + 0.04, paint: 0x3a1f5c, glow: 0xa04bff, head: true },
    // The double row by the west wall.
    { x: -596.2, z: 287, heading: Math.PI, paint: 0x16181c, glow: 0xff2fb4, tail: true },
    { x: -590.4, z: 286.8, heading: Math.PI + 0.07, paint: 0xaeb6bf, glow: 0x3fe8ff },
    { x: -593.3, z: 293.1, heading: 0, paint: 0x8fd12a, glow: 0x2f7bff, head: true },
    { x: -578.8, z: 293.3, heading: -0.05, paint: 0xe8671c, glow: 0x39ff6a },
    // Fanned out under the mast, lights on, for the people in front of them.
    { x: -583.6, z: 319.2, heading: -0.48, paint: 0x1f3c9a, glow: 0xa04bff, head: true, steer: -0.3 },
    { x: -576, z: 321.4, heading: 0, paint: 0x121317, glow: 0xb04bff, head: true, tail: true },
    { x: -568.4, z: 319.2, heading: 0.48, paint: 0xd11a22, glow: 0xffa030, head: true, steer: 0.3 },
    // Under the deck, between the columns.
    { x: -537.2, z: 327, heading: 0.77, paint: 0xf1f1ee, glow: 0x39ff6a, steer: 0.4, tail: true },
    { x: -519.2, z: 299.6, heading: 0.4, paint: 0x6d8fb3, glow: 0xff2fb4, steer: -0.45, tail: true },
    // The pocket inside the curve.
    { x: -524.5, z: 340.5, heading: 0.08, paint: 0x8a5a2b, glow: 0x39ff6a },
    { x: -510.5, z: 322.5, heading: 1.25, paint: 0x1b7f86, glow: 0xff9a2e, head: true },
  ],
  // What each of them is doing is theirs (`carMeet.ts`, `MeetPersonAct`): unsaid, a camera films,
  // a cooler sells, a case is someone on their phone and anyone else talks to the nearest person.
  people: [
    // In front of the fan of cars: one filming whoever pulls in, two talking.
    { x: -579, z: 313, heading: Math.PI - 0.25, kind: 'camera', seed: 1 },
    { x: -574.6, z: 313.6, heading: Math.PI + 0.35, kind: 'folded', seed: 2 },
    { x: -571.8, z: 312.4, heading: -2.4, kind: 'pocket', seed: 3 },
    // Leaning on the bonnet of the middle car of the fan, a step off its bumper.
    { x: -576, z: 318.35, heading: Math.PI, kind: 'idle', seed: 11, act: 'inspect', focus: { x: -576, z: 321.4 } },
    // Round the fire in the drum, and moving to the speakers beside it.
    { x: -562.13, z: 327.32, heading: -Math.PI / 2, kind: 'idle', seed: 4, act: 'warm', focus: { x: -563.2, z: 326.5 } },
    { x: -564.28, z: 325.69, heading: 0.9, kind: 'pocket', seed: 12, act: 'warm', focus: { x: -563.2, z: 326.5 } },
    { x: -564.2, z: 321.6, heading: 1.93, kind: 'idle', seed: 15, act: 'vibe', focus: { x: -561.8, z: 322.5 } },
    // Two more in front of the stack, heads going to the song.
    { x: -559.3, z: 320.2, heading: -0.7, kind: 'folded', seed: 16, act: 'vibe', focus: { x: -561.8, z: 322.5 } },
    { x: -561.6, z: 319.0, heading: 0, kind: 'pocket', seed: 17, act: 'vibe', focus: { x: -561.8, z: 322.5 } },
    // Behind the row along the north fence: two talking, the cooler, and someone pacing on the phone.
    { x: -547.2, z: 243.2, heading: 0.15, kind: 'folded', seed: 5 },
    { x: -544.9, z: 244.2, heading: -0.7, kind: 'pocket', seed: 6 },
    { x: -539.9, z: 250.3, heading: -1.2, kind: 'cooler', seed: 7 },
    { x: -528.5, z: 244.5, heading: Math.PI / 2, kind: 'phone', seed: 13, act: 'pace', to: { x: -525.5, z: 244.5 } },
    // By the vending machines, and pacing the pocket in front of the kiosk.
    { x: -510.8, z: 334.4, heading: 0.15, kind: 'case', seed: 8 },
    { x: -507.2, z: 333.6, heading: -0.5, kind: 'pocket', seed: 9 },
    { x: -503.5, z: 330.8, heading: Math.PI / 2, kind: 'phone', seed: 14, act: 'pace', to: { x: -499.8, z: 330.8 } },
    // Under the deck, filming the car stopped between the columns.
    { x: -533.6, z: 323.8, heading: -2.3, kind: 'camera', seed: 10 },
  ],
  props: [
    { kind: 'kiosk', x: -508, z: 340, heading: 0 },
    { kind: 'vending', x: -510, z: 336.35, heading: 0 },
    { kind: 'truck', x: -497.4, z: 321, heading: 0, color: 0xcfd5da },
    { kind: 'truck', x: -504, z: 320.2, heading: 0.05, color: 0x2c3440 },
    { kind: 'container', x: -603.9, z: 262, heading: 0, color: 0x2f5d62 },
    { kind: 'mast', x: -604.8, z: 285, heading: Math.PI / 2, color: 0xffb86b },
    { kind: 'mast', x: -604.8, z: 338, heading: Math.PI / 2, color: 0xdfeeff, faulty: true },
    { kind: 'mast', x: -560.5, z: 236.3, heading: Math.PI, color: 0xffb86b },
    { kind: 'mast', x: -512.5, z: 236.3, heading: Math.PI, color: 0xdfeeff },
    { kind: 'mast', x: -560.4, z: 308.5, heading: -Math.PI / 2, color: 0xffb86b },
    { kind: 'mast', x: -534, z: 347.5, heading: Math.PI / 4, color: 0xffb86b },
    { kind: 'mast', x: -494.5, z: 306, heading: -Math.PI / 2, color: 0xdfeeff },
    { kind: 'mast', x: -604.8, z: 246, heading: Math.PI / 2, color: 0xdfeeff },
    { kind: 'sign', x: -591.5, z: 236.6, heading: 0 },
    { kind: 'speakers', x: -561.8, z: 322.5, heading: -1.2 },
    { kind: 'barrel', x: -563.2, z: 326.5, heading: 0 },
    { kind: 'barrel', x: -530.5, z: 246.5, heading: 0 },
    { kind: 'table', x: -537.5, z: 247.8, heading: 0.12 },
    { kind: 'tyres', x: -603.2, z: 322.5, heading: 0.3 },
    { kind: 'tyres', x: -495.6, z: 262, heading: 0 },
    { kind: 'cones', x: -556.5, z: 343, heading: 0 },
    { kind: 'cones', x: -600, z: 239, heading: 0 },
  ],
};

/* ------------------------------------------------------------------ gas stations */

/**
 * FOUR GAS STATIONS (`gasStation.ts`), each on the corner of two streets and each a different
 * part of the map, for variety rather than for anything to do yet (2026-09-14):
 *
 *   - NEOGAS in midtown, where the two ring boulevards cross north-west of downtown, under the
 *     towers: the reference's own picture, teal and amber,
 *   - OCTANO on the east avenue at st-south, in the low urban blocks past the ring,
 *   - VOLTA in the south-west, on av-s1 at st-w3, a block from the viaduct's west ramps,
 *   - MAREA on the old town's quay, open on three sides with the bay and the viaduct behind it.
 *
 * Each lot runs from the back of the pavement on its street sides (road half-width plus that
 * zone's shoulder) and its inner edges sit on the plot lines the generator already draws there,
 * so the plots cut back to it keep a buildable width (`tests/metroWorld.test.ts`).
 */
export const METRO_GAS_STATIONS: GasStationSpec[] = [
  {
    tag: 'gas-ring-nw',
    label: 'NEOGAS · RING NORTH',
    brand: 'neogas',
    lot: { minX: -410, maxX: RING.west - 10 - BAY_SHOULDER.corporate, minZ: -529.8, maxZ: RING.north - 10 - BAY_SHOULDER.corporate },
    front: 's',
    corner: 'e',
    streets: ['s', 'e'],
    prices: [23.9, 25.4, 27.9, 19.9],
  },
  {
    tag: 'gas-av-east',
    label: 'OCTANO · AV EAST',
    brand: 'octano',
    lot: { minX: 536.9, maxX: 620 - 9 - BAY_SHOULDER.urban, minZ: -48.5, maxZ: 10 - 6.5 - BAY_SHOULDER.urban },
    front: 's',
    corner: 'e',
    streets: ['s', 'e'],
    prices: [22.9, 24.9, 26.5, 18.9],
  },
  {
    tag: 'gas-southwest',
    label: 'VOLTA · AV SOUTH',
    brand: 'volta',
    lot: { minX: -480 + 6.5 + BAY_SHOULDER.urban, maxX: -410, minZ: 500 + 9 + BAY_SHOULDER.urban, maxZ: 551.2 },
    front: 'n',
    corner: 'w',
    streets: ['n', 'w'],
    prices: [24.5, 26.9, 28.9, 20.5],
  },
  {
    tag: 'gas-quay',
    label: 'MAREA · THE QUAY',
    brand: 'marea',
    lot: { minX: 160 + 6 + BAY_SHOULDER.jdm, maxX: 250 - 6.5 - BAY_SHOULDER.jdm, minZ: 1120, maxZ: METRO_QUAY_Z - 14 - 8 - BAY_SHOULDER.jdm },
    front: 's',
    corner: 'w',
    streets: ['s', 'w', 'e'],
    prices: [21.9, 23.9, 25.9, 17.9],
  },
];

/* ------------------------------------------------------------------ the garage */

/**
 * LOCO MUSTANG'S GARAGE (`garage.ts`), not open yet (2026-09-14): where the car will be tuned
 * and modded. On the corner of blvd-ring-s and st-w3, directly across st-w3 from the car meet,
 * because that is where anybody who cares about their car already is: the introduction ends at
 * the meet, the ring boulevard is the bus loop everybody drives, and El Búho and the start line
 * are a couple of blocks south-east. The mouth faces the boulevard, the apron is open to both
 * streets, and the viaduct's deck passes behind it.
 *
 * The lot runs from the back of the pavement on its two street sides; the plot behind it is cut
 * back to its edge and keeps the rest of the block (`tests/garage.test.ts`).
 */
export const METRO_GARAGE: GarageSpec = {
  tag: 'garage-loco-mustang',
  label: "LOCO MUSTANG'S GARAGE",
  lot: { minX: -480 + 6.5 + BAY_SHOULDER.corporate, maxX: -444.5, minZ: RING.south + 10 + BAY_SHOULDER.corporate, maxZ: 279.4 },
  front: 'n',
  corner: 'w',
  streets: ['n', 'w'],
};

/* ------------------------------------------------------------------ traffic */

const loop =(minX: number, maxX: number, minZ: number, maxZ: number, cars: number): { rect: Rect; cars: number } => ({ rect: { minX, maxX, minZ, maxZ }, cars });

/**
 * Traffic: the Stack's ten rectangles moved with it, plus rectangles of the outer streets,
 * every corner a real crossing of two straight roads. Two blocks a side in the outer city,
 * three cars each (four round the ring):
 * the cars are where the player is likely to be, round downtown and along the boulevards.
 * Raised 2026-09-14 twice (about 1.5x, then to six a loop); the Stack's own loops get four more cars each
 * (two per direction) here only, so the standalone Stack keeps its halved fleet.
 */
export const METRO_TRAFFIC_LOOPS: Array<{ rect: Rect; cars: number }> = [
  ...STACK_TRAFFIC_LOOPS.map((l) => ({ rect: shift(l.rect), cars: l.cars + 4 })),
  // The ring's quadrants: the ring and the Stack's own edge streets.
  loop(RING.west, -252, RING.north, -320, 6),
  loop(250, RING.east, RING.north, -320, 6),
  loop(RING.west, -252, 10, RING.south, 6),
  loop(250, RING.east, 10, RING.south, 6),
  loop(-252, -60, RING.north, -320, 6),
  loop(30, 250, RING.north, -320, 6),
  loop(-252, -60, 132, RING.south, 6),
  // North of the ring, and the flanks.
  loop(-620, -340, -600, RING.north, 6),
  loop(340, 620, -600, RING.north, 6),
  loop(-620, -340, -320, 10, 6),
  loop(340, 620, -320, 10, 6),
  // South: the viaduct district down to the water.
  loop(-620, -340, RING.south, 500, 6),
  loop(340, 620, RING.south, 500, 6),
  // South of av-s1 the grid is broken by the roundabouts and the curves (`metroSouth.ts`): these
  // keep to what is still straight, and the new roads carry their own (`pathTraffic`).
  loop(-620, -480, 500, 780, 6),
  loop(30, 250, 500, 780, 6),
  loop(250, 340, 500, 780, 4),
  loop(340, 620, 500, 780, 6),
  loop(-620, -480, 780, 1060, 6),
  loop(30, 250, 780, 1186, 6),
  loop(480, 620, 780, 1060, 6),
  ...fillLoops(),
];

/**
 * The fill (2026-09-14, "the open world feels empty"): the loops above left whole streets
 * without a car — the waterfront, st-s3/s4/s5, st-w3/e3, the downtown avenues north of the
 * ring. One-block rectangles so every street segment in the outer city carries traffic, the
 * counts below doubled by `FILL_DENSITY` (a car each way was still too few to see through the
 * haze). Every rectangle was checked lane-by-lane against the built roads and colliders; the
 * east side has no road at z 132, so its cells there run 10 to the ring.
 */
function fillLoops(): Array<{ rect: Rect; cars: number }> {
  // Here, not at module level: `METRO_TRAFFIC_LOOPS` calls this before a later const would exist.
  const FILL_DENSITY = 2;
  const fill: Array<{ rect: Rect; cars: number }> = [
    // North of the ring, from wall to wall.
    loop(-480, -340, -600, RING.north, 2),
    loop(-340, -252, -600, RING.north, 2),
    loop(-252, -60, -600, RING.north, 3),
    loop(-60, 30, -600, RING.north, 2),
    loop(30, 250, -600, RING.north, 3),
    loop(250, 340, -600, RING.north, 2),
    loop(340, 480, -600, RING.north, 2),
    loop(-60, 30, RING.north, -320, 2),
    // The flanks: st-w3 and st-e3 down to the ring, and the Stack's rows run out to them.
    loop(-480, -340, RING.north, -320, 2),
    loop(-480, -340, -320, -180, 2),
    loop(-480, -340, -180, 10, 2),
    loop(-480, -340, 10, 132, 2),
    loop(-480, -340, 132, RING.south, 2),
    loop(-620, -480, -180, 10, 2),
    loop(-620, -480, 10, RING.south, 2),
    loop(-340, -252, -320, -180, 2),
    loop(-340, -252, -180, 10, 2),
    loop(340, 480, RING.north, -320, 2),
    loop(340, 480, -320, -180, 2),
    loop(340, 480, -180, 10, 2),
    loop(340, 480, 10, RING.south, 2),
    loop(480, 620, -180, 10, 2),
    loop(480, 620, 10, RING.south, 2),
    loop(250, 340, -320, -180, 2),
    loop(250, 340, -180, 10, 2),
  ];
  // South of the ring to the waterfront: a staggered checkerboard of one-block cells, so
  // alternate bands take alternate columns and every north-south street is driven in each.
  // Down to av-s1: south of it the grid is what `metroSouth.ts` left, and its cells are below.
  const bands = [RING.south, 360, 500];
  const even: Array<[number, number, number]> = [[-620, -480, 2], [-340, -252, 2], [-60, 30, 2], [160, 250, 2], [340, 480, 2]];
  const odd: Array<[number, number, number]> = [[-480, -340, 2], [-252, -60, 3], [30, 160, 2], [250, 340, 2], [480, 620, 2]];
  for (let b = 0; b < bands.length - 1; b++) {
    for (const [minX, maxX, cars] of b % 2 === 0 ? even : odd) {
      // The two cells with a corner on the Obelisco's island (`metroVilla.ts`) are replaced below.
      if (b < 2 && (minX === 480 || maxX === 480)) continue;
      fill.push(loop(minX, maxX, bands[b], bands[b + 1], cars));
    }
  }
  // The 9 de Julio: a file each side of the island, round from the ring to av-s1, so the avenue
  // carries its traffic past the Obelisco on both sides and nothing turns across the island.
  fill.push(loop(RING.east, NUEVE_DE_JULIO.laneWest, RING.south, 500, 3));
  fill.push(loop(NUEVE_DE_JULIO.laneEast, 620, RING.south, 500, 3));
  // South of av-s1: the cells that still have four straight sides and no roundabout on a corner.
  // The waterfront is driven end to end as a road of its own (`METRO_SOUTH_PATH_TRAFFIC`).
  fill.push(
    loop(-620, -480, 500, 640, 2),
    loop(-480, -340, 500, 640, 2),
    loop(160, 250, 500, 780, 2),
    loop(340, 480, 500, 640, 2),
    loop(480, 620, 640, 780, 2),
    loop(-620, -480, 780, 920, 2),
    loop(340, 480, 780, 920, 2),
    loop(480, 620, 920, 1060, 2),
    loop(-620, -480, 1060, METRO_QUAY_Z - 14, 2),
    loop(480, 620, 1060, METRO_QUAY_Z - 14, 2),
  );
  return fill.map((l) => ({ rect: l.rect, cars: l.cars * FILL_DENSITY }));
}

/** Cars lapping the viaduct: the Bay's density scaled by length, then halved as the Stack's were; raised 2026-09-14. Multiple of its four lane files. */
export const METRO_VIADUCT_CARS = 60;

/** The Stack's elevated loops in the open world: its own counts, raised 1.5x (kept to multiples of four lane files). */
const METRO_DECK_TRAFFIC = STACK_DECK_TRAFFIC.map((d) => ({ ...d, cars: Math.round((d.cars * 1.5) / 4) * 4 }));

/* ------------------------------------------------------------------ buses */

/**
 * Bus routes: rectangles of boulevards (all 18-20 m, so a bus in the kerb lane stays out of
 * the traffic's), driven clockwise: the ring round downtown, and one loop each side of the
 * viaduct district.
 */
export const METRO_BUS_LOOPS: Rect[] = [
  { minX: RING.west, maxX: RING.east, minZ: RING.north, maxZ: RING.south },
  // Round st-w3, not the ring: the ring's corner at av-s2 is the Rotonda de las Pantallas (`metroSouth.ts`).
  { minX: -620, maxX: -480, minZ: 500, maxZ: 780 },
  { minX: RING.east, maxX: 620, minZ: 500, maxZ: 780 },
];
/** The boulevards with shelters. */
// av-s2 east of Plaza Estrella is its own road now (`metroSouth.ts`).
export const METRO_BUS_ROUTES = ['blvd-ring-n', 'blvd-ring-s', 'blvd-ring-w', 'blvd-ring-e', 'av-s1', 'av-s2', 'av-s2-e', 'av-w1', 'av-e1'];

/* ------------------------------------------------------------------ the free-world activities */

/** The car starts on the central avenue south of the ring, pointed north at downtown, the viaduct crossing overhead on the way in. */
export const METRO_SPAWN = { x: -56, z: 420, heading: 0 };

/**
 * The RAYO RUSH sites, in mission order: the ring boulevard south of downtown with traffic
 * from three rectangles; the central avenue inside the Stack's core under the spine; and
 * the waterfront, with the water at your back. Each mid-block, never in a junction.
 */
/**
 * RAYO RUSH is met at ONE place: every mission of the chain is offered on this ring, and
 * clearing one makes the next harder rather than moving it (`rushSiteFor` runs the later
 * missions at the last site a world ships).
 */
export const METRO_RUSH_SITES = [{ x: -150, z: RING.south, y: 0, heading: Math.PI / 2, label: 'RING SOUTH' }];

/** Where passengers wait: mid-block stopping points, the Bay's tags so the catalogue needs nothing new. */
export const METRO_PASSENGER_STOPS: PassengerStopSpec[] = [
  { id: 'ring-n-towers', x: -150, z: RING.north, y: 0, heading: Math.PI / 2, label: 'RING NORTH · THE TOWERS', tags: ['downtown'] },
  { id: 'av-central-core', x: -60, z: -60, y: 0, heading: 0, label: 'AV CENTRAL · THE CORE', tags: ['downtown'] },
  { id: 'st-north-west', x: -550, z: -320, y: 0, heading: Math.PI / 2, label: 'ST NORTH · WEST BLOCKS', tags: ['residential'] },
  { id: 'av-s1-market', x: 200, z: 500, y: 0, heading: Math.PI / 2, label: 'AV SOUTH · THE MARKET', tags: ['market'] },
  { id: 'av-e1-yard', x: 620, z: -250, y: 0, heading: 0, label: 'AV EAST · THE YARD', tags: ['industrial'] },
  { id: 'ring-e-works', x: 340, z: -100, y: 0, heading: 0, label: 'RING EAST · THE WORKS', tags: ['industrial'] },
  { id: 'av-w1-terraces', x: -620, z: 570, y: 0, heading: 0, label: 'AV WEST · THE TERRACES', tags: ['residential'] },
  { id: 'blvd-water-quay', x: -300, z: METRO_QUAY_Z - 14, y: 0, heading: Math.PI / 2, label: 'THE QUAY', tags: ['waterfront'] },
  { id: 'st-east-edge', x: 480, z: 300, y: 0, heading: 0, label: 'ST EAST · THE EDGE', tags: ['outskirts', 'industrial'] },
  { id: 'st-north-edge', x: -150, z: -600, y: 0, heading: Math.PI / 2, label: 'ST NORTH · THE OUTSKIRTS', tags: ['outskirts'] },
];

/** El Búho: under the viaduct's west leg, in an open bay between the columns, facing west. */
export const METRO_BUHO_SITE = { x: -VIA_X, z: 460, y: 0, heading: -Math.PI / 2, label: 'UNDER THE VIADUCT' };

/**
 * THE RACE DOORS, where the open world has them (`src/world/openWorld.ts`). Not part of
 * `METRO_SPEC`: the city does not know the races exist, the layers over it do
 * (`cityCircuitGate.ts`, `cityStreetSites.ts`). Both races are still run on Bandido Bay, on the
 * other side of a page load; these are only the rings that take you there.
 *
 * Each is mid-block on a boulevard with 60 m of clear road either side, never in a junction
 * (`tests/metroWorld.test.ts`). The start line is on the avenue that runs east from the meet
 * under the viaduct, where the introduction leaves the player; the one Street Race
 * ring is on the car meet's lot.
 */
export const METRO_CIRCUIT_SITE = { x: -156, z: 500, y: 0, heading: Math.PI / 2, label: 'BANDIDO GRID · START LINE' };

/**
 * STREET RACE is met at ONE ring, on La Curva's lot (`curvaSpec.ts`). It offers the newest event
 * of the series; winning puts a harder field on the same ring (`src/sim/streetGate.ts`).
 */
export const METRO_STREET_SITES = [CURVA_SITE];

/* ------------------------------------------------------------------ the spec */

/** The Stack's tiers over its avenues, inside its footprint only; the Bay's bridges over the outer boulevards. */
export const METRO_SKYBRIDGE_SETS: NonNullable<CitySpec['skybridgeSets']> = [
  { streets: STACK_SPEC.skybridgeStreets, style: STACK_SKYBRIDGES, within: STACK_RECT },
  { streets: ['blvd-ring-n', 'blvd-ring-s', 'blvd-ring-w', 'blvd-ring-w-s', 'blvd-ring-e', 'av-s1', 'av-s2', 'av-s2-mid', 'av-s2-e', 'av-w1', 'av-e1', 'diag-norte', 'diag-sur'], style: { heights: [12, 15, 19, 24], concreteShare: 0.15, max: 40, step: 120 } },
];

export const METRO_SPEC: CitySpec = {
  name: 'Bandido Metro',
  bounds: METRO_BOUNDS,
  wallBand: METRO_WALL_BAND,
  water: { quayZ: METRO_QUAY_Z },
  zoneOf,
  // The south without its grid (`metroSouth.ts`): the grid cut back, then the diagonals, curves and roundabouts.
  roads: [...cutRoads([...DOWNTOWN_ROADS, ...OUTER_ROADS], METRO_SOUTH_CUTS), ...METRO_SOUTH_ROADS, ...PARK_ROADS],
  roundabouts: METRO_ROUNDABOUTS,
  elevated: [
    ...DOWNTOWN_ELEVATED,
    { tag: 'viaduct', spec: VIADUCT_SPEC, lift: 0 },
    ...METRO_RAMPS.map((r) => ({ tag: r.tag, spec: r.spec, lift: RAMP_LIFT })),
    // The park's bridge over the strait (`metroPark.ts`).
    PARK_BRIDGE,
  ],
  // The park (`metroPark.ts`): the north edge, beyond the city's own rectangle.
  parks: [METRO_PARK],
  // La bajada (`metroVilla.ts`): Villa 31 round the east ramp, the Obelisco on the 9 de Julio.
  villas: [METRO_VILLA],
  obelisco: METRO_OBELISCO,
  blockBounds: METRO_CITY,
  blockOptions: METRO_BLOCK_OPTIONS,
  // The hills (`metroTerrain.ts`): downtown and the meet district stay level, the rest rolls.
  terrain: metroTerrain(STACK_RECT),
  planMegastructures: (ribbons) => planStackMassing(ribbons, STACK_OFFSET),
  downtown: METRO_DOWNTOWN,
  // The Bay's art everywhere, the Stack's inside its footprint: its lean megastructures (the
  // passages carry the detail), its concrete, its half-metre setback.
  pillarStep: 12,
  fenceBays: 'most',
  art: { ...STACK_ART, finish: 'glass', setback: 3.4 },
  // The park counts as concrete for the one thing it changes there: sodium lamps, warm, and
  // quiet concrete parapets on its bridge (`propsBuilder.lampColor`, `trackBuilder`).
  finishAt: (x, z) => (inRect(STACK_RECT, x, z) || inRect(PARK_LAND, x, z) ? 'concrete' : 'glass'),
  setbackAt: (x, z) => (inRect(STACK_RECT, x, z) ? STACK_ART.setback : 3.4),
  densityAt,
  palette: 'bay',
  portalFrames: ['spine', 'ring'],
  landmarks: [
    ...STACK_LANDMARKS.map((l) => ({ ...l, x: l.x + STACK_OFFSET.x, z: l.z + STACK_OFFSET.z })),
    { x: -560, z: 1000, kind: 1 },
    { x: 560, z: -560, kind: 4 },
  ],
  skybridgeStreets: [],
  skybridgeSets: METRO_SKYBRIDGE_SETS,
  neonDistricts: [{ ...SOUTHWEST }],
  // Downtown's LED boards, blades and holograms, as the Stack has them.
  screens: [
    { within: STACK_RECT, ...STACK_SCREENS },
    // The Obelisco's crossing, lit like downtown: boards on the towers round the plaza.
    { within: { minX: 380, maxX: 560, minZ: 250, maxZ: 470 }, boards: 22, heroes: 4, blades: 10, roofBoards: 4, holograms: 2, crossings: 2, bridges: 0 },
  ],
  ringBillboards: [{ x: -520, z: 700, y: 60, radius: 13, height: 11 }],
  radioTowers: [
    ...STACK_SPEC.radioTowers.map((t) => ({ ...t, x: t.x + STACK_OFFSET.x, z: t.z + STACK_OFFSET.z })),
    { x: -690, z: -300, height: 95, base: 8 },
    { x: 690, z: 900, height: 84, base: 7 },
    { x: -500, z: 1100, height: 58, base: 5 },
  ],
  // Transmission line across the bay, behind the viaduct.
  powerLine: { z: 1268, xs: Array.from({ length: 17 }, (_, i) => -640 + i * 80), height: 34, base: 8 },
  billboards: (bounds) => [
    { variant: 0, x: -450, y: 30, z: bounds.minZ + 0.6, w: 30, h: 17, rotY: 0, color: PAL.neonCyan },
    { variant: 1, x: 450, y: 26, z: bounds.minZ + 0.6, w: 26, h: 15, rotY: 0, color: PAL.neonMagenta },
    { variant: 2, x: 40, y: 30, z: bounds.minZ + 0.6, w: 14, h: 28, rotY: 0, color: PAL.neonMagenta },
    { variant: 0, x: bounds.minX + 0.6, y: 28, z: -200, w: 30, h: 17, rotY: Math.PI / 2, color: PAL.neonCyan },
    { variant: 2, x: bounds.minX + 0.6, y: 30, z: 700, w: 14, h: 28, rotY: Math.PI / 2, color: PAL.neonMagenta },
    { variant: 1, x: bounds.maxX - 0.6, y: 26, z: 400, w: 26, h: 15, rotY: -Math.PI / 2, color: PAL.neonMagenta },
    { variant: 2, x: bounds.maxX - 0.6, y: 28, z: -300, w: 13, h: 26, rotY: -Math.PI / 2, color: PAL.neonMagenta },
  ],
  gates: () => [
    ['blvd-ring-n', 300, PAL.neonCyan, PAL.neonBlue],
    ['blvd-ring-n', 1100, PAL.neonMagenta, PAL.neonCyan],
    ['blvd-ring-s', 300, PAL.neonCyan, PAL.neonMagenta],
    ['blvd-ring-s', 1100, PAL.neonPink, PAL.neonMagenta],
    ['av-s1', 700, PAL.neonMagenta, PAL.neonPink],
    ['blvd-water', 700, PAL.neonMagenta, PAL.neonPink],
    ['blvd-ring-w', 1300, PAL.neonCyan, PAL.neonBlue],
  ],
  trafficLoops: METRO_TRAFFIC_LOOPS,
  // A few cars lapping the park's loop, so its curves are driven and its lamps light somebody.
  deckTraffic: [...METRO_DECK_TRAFFIC, { tag: 'viaduct', cars: METRO_VIADUCT_CARS, lanes: [5, 1.5] }, { tag: 'park-loop', cars: 8, lanes: [3.5] }, ...METRO_SOUTH_RING_TRAFFIC],
  pathTraffic: METRO_SOUTH_PATH_TRAFFIC,
  cruiseLoop: METRO_BUS_LOOPS[0],
  busRoutes: METRO_BUS_ROUTES,
  busRouteLoops: METRO_BUS_LOOPS,
  busStopSpacing: 260,
  spawn: METRO_SPAWN,
  rushSites: METRO_RUSH_SITES,
  passengerStops: METRO_PASSENGER_STOPS,
  buhoSite: METRO_BUHO_SITE,
  meets: [METRO_MEET],
  gasStations: METRO_GAS_STATIONS,
  garage: METRO_GARAGE,
  // Drawn in chunks: a map this size cannot be one mesh per material. Beyond the cull the
  // Bay's haze (`HAZE.cityDensity`) has taken everything but the brightest windows.
  render: { chunk: 325, cullDistance: 850 },
};
