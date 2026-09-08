import type { Rect, ZoneId } from './cityPlan';
import type { TrackNode, TrackSpec, TrackZone } from './track';

/**
 * THE CITY — "Bandido Bay". Data only; `src/world/cityWorld.ts` turns it into colliders,
 * blocks, viaducts, traffic and art.
 *
 * Read with north up (x east, z south). About 540 x 550 m, almost five times the test arena:
 *
 *   - a grid of avenues and streets, cut by one long S-shaped diagonal avenue,
 *   - narrow alleys threaded between the big streets,
 *   - the VIADUCT: a closed 18 m highway on pillars, 15 m up, that runs round the whole city
 *     and out over the bay on its south side, with four ramps on and off it,
 *   - the SKYWAY: an open bridge road that climbs to 24 m, runs along the north edge between
 *     the towers, crosses over the viaduct twice and comes back down,
 *   - open water along the south edge, a quay, and a waterfront boulevard,
 *   - a corporate core with a screen-covered "square" in the north-west, old town by the water.
 *
 * Zones (`zoneOf`): corporate in the north-west, old town (jdm) along the water and in the
 * east, urban between. A road's nodes carry the zone of the district they stand in.
 *
 * Heights are in the nodes (`y`): flat roads have none, the viaduct carries 15 everywhere,
 * the ramps run from 0 to 15, the skyway from 0 to 24 and back. Grades ease in and out
 * (`track.ts`), and the world builder's tests pin every crossing to a drivable clearance.
 */

export const CITY_BOUNDS: Rect = { minX: -270, maxX: 270, minZ: -260, maxZ: 290 };
/** Perimeter band thickness (m) on the three land sides. */
export const CITY_WALL_BAND = 12;
/** The quay: land ends here, water begins. */
export const CITY_QUAY_Z = 200;
/** Height of the viaduct deck (m). */
export const VIADUCT_Y = 15;
/** Height of the skyway (m). */
export const SKYWAY_Y = 24;

export function zoneOf(x: number, z: number): ZoneId {
  if (z < -100 && x < 60) return 'corporate';
  if (z > 90 || (x > 150 && z > -20)) return 'jdm';
  return 'urban';
}

export interface CityRoadSpec {
  tag: string;
  kind: 'track' | 'alley';
  spec: TrackSpec;
}

/** A node in its district's zone. `y` given only on height anchors. */
const n = (x: number, z: number, r: number, width: number, y?: number, zone?: TrackZone, tag?: string): TrackNode => ({
  x,
  z,
  r,
  width,
  zone: zone ?? zoneOf(x, z),
  ...(y !== undefined ? { y } : {}),
  ...(tag ? { tag } : {}),
});

const road = (tag: string, width: number, nodes: TrackNode[], kind: 'track' | 'alley' = 'track'): CityRoadSpec => ({
  tag,
  kind,
  spec: { closed: false, nodes: nodes.map((nd) => ({ ...nd, width })) },
});

/** Where the roads stop: at the perimeter band, less a car's length so the wall is the stop. */
const EDGE = CITY_WALL_BAND + 2.5;
const X_MIN = CITY_BOUNDS.minX + EDGE;
const X_MAX = CITY_BOUNDS.maxX - EDGE;
const Z_MIN = CITY_BOUNDS.minZ + EDGE;
/** Where the north-south roads stop: inside the waterfront boulevard. */
const Z_SHORE = 192;

/* ------------------------------------------------------------------ ground network */

export const CITY_ROADS: CityRoadSpec[] = [
  // North-south avenues and streets. Extra nodes mark the zone changes.
  road('av-main', 20, [n(-70, Z_MIN, 0, 20), n(-70, -100, 0, 20), n(-70, 90, 0, 20), n(-70, Z_SHORE, 0, 20)]),
  road('av-east', 18, [n(110, Z_MIN, 0, 18), n(110, 90, 0, 18), n(110, Z_SHORE, 0, 18)]),
  road('st-west', 13, [n(-190, Z_MIN, 0, 13), n(-190, -100, 0, 13), n(-190, 90, 0, 13), n(-190, Z_SHORE, 0, 13)]),
  road('st-mid', 13, [n(20, Z_MIN, 0, 13), n(20, -100, 0, 13), n(20, 90, 0, 13), n(20, Z_SHORE, 0, 13)]),
  road('st-far-east', 12, [n(210, Z_MIN, 0, 12), n(210, -20, 0, 12), n(210, Z_SHORE, 0, 12)]),
  // East-west.
  road('blvd-north', 20, [n(X_MIN, -160, 0, 20), n(60, -160, 0, 20), n(X_MAX, -160, 0, 20)]),
  road('st-n2', 13, [n(X_MIN, -60, 0, 13), n(X_MAX, -60, 0, 13)]),
  road('blvd-center', 18, [n(X_MIN, 60, 0, 18), n(150, 60, 0, 18), n(X_MAX, 60, 0, 18)]),
  road('st-south', 12, [n(X_MIN, 120, 0, 12), n(X_MAX, 120, 0, 12)]),
  road('blvd-water', 16, [n(X_MIN, 186, 0, 16), n(X_MAX, 186, 0, 16)]),
  // The diagonal: an S of sweepers from the south-west waterfront to the north-east.
  // It meets the edge at an angle, so it stops a little further in than the straights.
  road('av-diag', 16, [
    n(X_MIN + 5, 168, 0, 16),
    n(-140, 120, 110, 16),
    n(-60, 10, 120, 16),
    n(30, -60, 120, 16),
    n(140, -110, 120, 16),
    n(X_MAX - 5, -196, 0, 16),
  ]),
  // Alleys: narrow, bare, threaded between the big streets.
  road('alley-a', 7.5, [n(65, 120, 0, 7.5), n(65, 186, 0, 7.5)], 'alley'),
  road('alley-b', 7.5, [n(110, 150, 0, 7.5), n(210, 150, 0, 7.5)], 'alley'),
  road('alley-c', 7.5, [n(-150, 60, 0, 7.5), n(-150, 118, 0, 7.5)], 'alley'),
  road('alley-d', 7.5, [n(160, -60, 0, 7.5), n(160, 60, 0, 7.5)], 'alley'),
  road('alley-e', 7.5, [n(-190, -110, 0, 7.5), n(-70, -110, 0, 7.5)], 'alley'),
];

/* ------------------------------------------------------------------ viaducts */

/** The viaduct: clockwise, the south leg out over the bay. */
export const VIADUCT_SPEC: TrackSpec = {
  closed: true,
  nodes: [
    n(-230, 240, 60, 18, VIADUCT_Y, 'corporate', 'sw'),
    n(-230, -205, 70, 18, VIADUCT_Y, 'corporate', 'nw'),
    n(245, -205, 70, 18, VIADUCT_Y, 'corporate', 'ne'),
    n(245, 240, 60, 18, VIADUCT_Y, 'corporate', 'se'),
  ],
};

/**
 * Ramps. Each starts inside a street (y 0) or inside the viaduct (y 15) and ends inside the
 * other, running beside the deck before it merges. Where a ramp crosses a street it is
 * already high enough to drive under (`tests/cityWorld.test.ts` checks every crossing).
 */
export const RAMP_SPECS: CityRoadSpec[] = [
  // On-ramps climb beside the deck, reach its height, then slide in parallel to it.
  road('ramp-w-on', 11, [
    n(-196, 64, 0, 11, 0, 'corporate'),
    n(-212, 50, 25, 11, undefined, 'corporate'),
    n(-212, -60, 40, 11, VIADUCT_Y, 'corporate'),
    n(-226, -100, 30, 11, undefined, 'corporate'),
    n(-227, -140, 0, 11, VIADUCT_Y, 'corporate'),
  ]),
  road('ramp-e-on', 11, [
    n(216, -56, 0, 11, 0, 'corporate'),
    n(224, -40, 25, 11, undefined, 'corporate'),
    n(224, 110, 40, 11, VIADUCT_Y, 'corporate'),
    n(240, 150, 30, 11, undefined, 'corporate'),
    n(241, 178, 0, 11, VIADUCT_Y, 'corporate'),
  ]),
  // Off-ramps peel away at deck height and only start down once they are clear of it.
  road('ramp-n-off', 11, [
    n(-60, -201, 0, 11, VIADUCT_Y, 'corporate'),
    n(0, -192, 40, 11, VIADUCT_Y, 'corporate'),
    n(150, -188, 30, 11, undefined, 'corporate'),
    n(190, -166, 0, 11, 0, 'corporate'),
  ]),
  road('ramp-s-off', 11, [
    n(40, 236, 0, 11, VIADUCT_Y, 'corporate'),
    n(-40, 226, 40, 11, VIADUCT_Y, 'corporate'),
    n(-150, 222, 30, 11, undefined, 'corporate'),
    n(-180, 190, 0, 11, 0, 'corporate'),
  ]),
];

/** The skyway: up the west side, along the north edge, over the viaduct twice, down the east side. */
export const SKYWAY_SPEC: CityRoadSpec = road('skyway', 13, [
  n(-130, 56, 0, 13, 0, 'urban'),
  n(-130, -235, 40, 13, SKYWAY_Y, 'urban'),
  n(-60, -235, 80, 13, SKYWAY_Y, 'urban'),
  n(64, -170, 80, 13, SKYWAY_Y, 'urban'),
  n(64, 64, 0, 13, 0, 'urban'),
]);

/* ------------------------------------------------------------------ dressing */

/**
 * Downtown: the skyscraper district in the north-west, from the viaduct's west leg to the
 * middle avenue. Blocks here carry 70-140 m towers, every facade is a wall of screens, the
 * perimeter behind it and the skyline beyond grow to match. The viaduct's north leg and the
 * skyway both run through it, so from the deck the towers stand close on both sides.
 */
export const DOWNTOWN: Rect = { minX: -218, maxX: 62, minZ: -260, maxZ: -98 };

/** Where the street facades are stacked with screens: the whole of downtown. */
export const NEON_DISTRICTS: Rect[] = [{ ...DOWNTOWN }];

export const RING_BILLBOARDS = [{ x: -112, z: -186, y: 60, radius: 13, height: 11 }];

export const RADIO_TOWERS = [
  { x: -262, z: -120, height: 110, base: 9 },
  { x: 264, z: 60, height: 95, base: 8 },
  { x: 170, z: 90, height: 75, base: 6 },
  { x: -40, z: 150, height: 58, base: 5 },
];

/** Transmission line across the bay, behind the viaduct. */
export const POWER_LINE = { z: 262, xs: [-250, -170, -90, -10, 70, 150, 230], height: 34, base: 8 };

/**
 * Traffic: rectangles of street centrelines, driven clockwise in the right-hand lane, the
 * cars of each spread evenly round it. Nine rectangles cover the whole grid.
 */
export const TRAFFIC_LOOPS: Array<{ rect: Rect; cars: number }> = [
  { rect: { minX: -190, maxX: -70, minZ: -160, maxZ: -60 }, cars: 6 },
  { rect: { minX: -70, maxX: 20, minZ: -160, maxZ: 60 }, cars: 8 },
  { rect: { minX: 20, maxX: 110, minZ: -160, maxZ: -60 }, cars: 6 },
  { rect: { minX: 110, maxX: 210, minZ: -160, maxZ: 60 }, cars: 8 },
  { rect: { minX: -190, maxX: -70, minZ: -60, maxZ: 120 }, cars: 8 },
  { rect: { minX: -70, maxX: 110, minZ: -60, maxZ: 60 }, cars: 6 },
  { rect: { minX: 20, maxX: 110, minZ: -60, maxZ: 186 }, cars: 8 },
  { rect: { minX: 110, maxX: 210, minZ: 60, maxZ: 186 }, cars: 6 },
  { rect: { minX: -190, maxX: 20, minZ: 120, maxZ: 186 }, cars: 6 },
];
/**
 * Cars patrolling the viaduct itself, split evenly between its lanes. The highway is the one
 * road in the city wide enough for two files of traffic, and it should read as busy from the
 * street below.
 */
export const VIADUCT_CARS = 64;
/** Offsets from the viaduct centreline (m) of the lanes the traffic runs in. */
export const VIADUCT_LANES = [5, 1.5];

/**
 * Bus routes: rectangles of boulevard centrelines, driven clockwise in the kerb lane —
 * `cityWorld.ts` puts each leg in the lane that street's own width allows, and calls at the
 * shelters that stand on that kerb.
 *
 * Only the wide boulevards are used. A 2.6 m bus in the kerb lane of a 13 m street would
 * stand in the electric cars' lane, and the traffic does not steer round anything.
 * Both rectangles run the same way for the same reason: two routes sharing a street would
 * otherwise share one lane head-on.
 *
 * Together they cover the grid from the north edge to the waterfront: the northern one round
 * downtown and the middle, the southern one down to the bay.
 */
export const BUS_ROUTE_LOOPS: Rect[] = [
  { minX: -70, maxX: 110, minZ: -160, maxZ: 60 },
  { minX: -70, maxX: 110, minZ: 60, maxZ: 186 },
];

/** The car starts on the main avenue, pointed at the square. */
export const CITY_SPAWN = { x: -66, z: -20, heading: 0 };

/**
 * Where the RAYO RUSH marker stands — one site per mission of `RUSH.levels`, in that order. The
 * marker packs up and re-paints itself at the next one each time a mission is cleared, so this
 * list is read as a route through the city rather than as three unrelated spots.
 *
 * EACH IS A MARK ON THE ROAD, not an object in it: nothing here is a collider, and the art
 * (`src/render/scene/env/rushMarker.ts`) hangs its hologram well above roof height. Every one
 * stands mid-block rather than in a junction — the ring is 15 m across and traffic drives
 * straight through a crossing, so a marker painted on one would be a marker you cannot park on.
 *
 * They are chosen for what is AROUND them, and in an order that widens what the player has to
 * do rather than just moving the furniture:
 *
 *   1  CENTRE BOULEVARD  `blvd-center`, a short block east of the `st-mid` crossing. Three of
 *      the nine traffic rectangles meet here (`TRAFFIC_LOOPS` 2, 6, 7), so there are electric
 *      cars in every direction the moment the clock starts, and 18 m of boulevard to drift on
 *      with side streets close enough to chain into. ~120 m from the spawn: far enough to be
 *      come across rather than handed over, close enough to find on a first drive.
 *
 *   2  DOWNTOWN CANYON   `av-main` between `blvd-north` and the mouth of `alley-e`, inside
 *      `DOWNTOWN` — so it is driven between towers with every facade screened. Loops 1 and 2
 *      both run the length of this avenue, which puts traffic on BOTH sides of a 20 m street,
 *      and the alley 15 m north is the chain: duck into it and the next kill is already there.
 *
 *   3  THE WATERFRONT    `blvd-water` between `av-east` and `st-far-east`, out in the old town
 *      by the quay. The hardest of the three to hold a streak in, and deliberately: the bay is
 *      at your back, so half the escape routes of the other two simply are not there, and the
 *      traffic that is here (loops 8 and 9 along the shore, `alley-b` a block north) has to be
 *      chased rather than met.
 */
export const RUSH_SITES = [
  { x: 40, z: 60, y: 0, heading: Math.PI / 2, label: 'CENTRE BOULEVARD' },
  { x: -70, z: -124, y: 0, heading: 0, label: 'DOWNTOWN CANYON' },
  { x: 150, z: 186, y: 0, heading: Math.PI / 2, label: 'THE WATERFRONT' },
];

/**
 * Where passengers wait and where they are taken (`src/sim/passenger.ts`).
 *
 * EACH IS A STOPPING POINT ON A ROAD, mid-block, well clear of every junction and of the three
 * RUSH sites — the car has to stand still inside a 7 m ring to pick up or drop off, and a ring
 * on a crossing is one the traffic drives through. `tests/passenger.test.ts` checks every one
 * against the city's own road predicate, so a stop typed into a building fails a test rather
 * than strands a passenger.
 *
 * The tags are what the catalogue matches on (`PassengerDef.pickupTags`): a character is
 * "picked up downtown, taken to the waterfront", never "picked up at (-70, -200)", so the
 * catalogue knows nothing about this city and a fourth stop is a line here.
 */
/**
 * Where El Búho stands (`src/sim/buho.ts`): the corridor under the viaduct's EAST LEG, in the
 * open bay north of `blvd-center`. The deck at x 245 runs over bare ground between its street
 * crossings; the columns stand 7.4 m either side of it with chain-link between them two bays
 * in three, and this bay (z 21..33) is one of the open ones. The reclamation field puts it in
 * a pocket, so the columns and the fences round it are painted and the junk is thick — the
 * one place in the city that already looks like somebody lives under the highway.
 *
 * Reached by turning off `blvd-center` under the deck at (245, 60) and driving 30 m north up
 * the corridor. He faces west, back to the outer column; the ring is centred on the corridor
 * and is smaller than a passenger stop (`MOOGUL.marker`) so it stays clear of the columns.
 * `tests/buho.test.ts` checks the ground is drivable, level, and free of colliders.
 */
export const BUHO_SITE = { x: 245, z: 27, y: 0, heading: -Math.PI / 2, label: 'UNDER THE VIADUCT' };

export const PASSENGER_STOPS = [
  { id: 'av-main-north', x: -70, z: -205, y: 0, heading: 0, label: 'AV MAIN · NORTH GATE', tags: ['downtown'] },
  { id: 'blvd-north-mid', x: -25, z: -160, y: 0, heading: Math.PI / 2, label: 'BLVD NORTH · THE TOWERS', tags: ['downtown'] },
  { id: 'st-n2-west', x: -130, z: -60, y: 0, heading: Math.PI / 2, label: 'ST N2 · WEST BLOCKS', tags: ['residential'] },
  { id: 'st-mid-market', x: 20, z: 0, y: 0, heading: 0, label: 'ST MID · THE MARKET', tags: ['market'] },
  { id: 'av-east-yard', x: 110, z: 0, y: 0, heading: 0, label: 'AV EAST · THE YARD', tags: ['industrial'] },
  { id: 'st-south-west', x: -110, z: 120, y: 0, heading: Math.PI / 2, label: 'ST SOUTH · THE TERRACES', tags: ['residential'] },
  { id: 'blvd-water-quay', x: -25, z: 186, y: 0, heading: Math.PI / 2, label: 'THE QUAY', tags: ['waterfront'] },
  { id: 'st-far-east', x: 210, z: 90, y: 0, heading: 0, label: 'ST FAR EAST · THE EDGE', tags: ['outskirts', 'industrial'] },
];
