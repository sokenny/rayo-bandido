import type { Rect } from './cityPlan';
import type { TrackNode, TrackSpec, TrackZone } from './track';

/**
 * THE CITY CIRCUIT — "Bandido Grid". The versus race, run inside the open world.
 *
 * A ribbon, not a street plan: one closed racing line through the city with a barrier down
 * each side of it, the way a street circuit is actually laid out. Corners are radiused arcs
 * taken across the junctions, side streets are closed by the barrier sweeping past their
 * mouths, and there are no branches, no stubs and nothing to drive into by mistake.
 *
 * THE LAP, in order:
 *
 *   1. up st-west and east along blvd-center — the tight bit, walls close on both sides,
 *   2. north up av-main, 220 m of full throttle between the skyscrapers of downtown,
 *   3. east along blvd-north, still in downtown, then south down av-east and east on st-n2,
 *   4. THE HIGHWAY. Up the east on-ramp onto the viaduct, fifteen metres over the city, down
 *      its east leg, round the big south-east sweeper and west along the deck OVER THE BAY,
 *   5. down the south off-ramp, back onto the waterfront, and into the first corner again.
 *
 * Two laps. Tune it with `node scripts/circuit-preview.mjs`.
 *
 * PURE GEOMETRY, NO IMPORTS THAT RUN, so the design tool can load this straight into Node.
 * The price is that the bits of the city the lap borrows — the widths of the streets, and the
 * ramp and viaduct nodes with their heights — are repeated here rather than imported;
 * `tests/circuitWorld.test.ts` fails the moment any of it drifts from `citySpec.ts`.
 */

/* ------------------------------------------------------------------ the city's streets */

export interface CircuitStreet {
  /** The road's tag in `citySpec.ts`. */
  tag: string;
  /** Which way it runs: 'x' east-west, 'z' north-south. */
  axis: 'x' | 'z';
  /** The coordinate it holds constant (m). */
  at: number;
  from: number;
  to: number;
  halfWidth: number;
}

/** The streets the lap drives down, copied from `CITY_ROADS`. */
export const CIRCUIT_STREETS: CircuitStreet[] = [
  { tag: 'st-west', axis: 'z', at: -190, from: -245.5, to: 192, halfWidth: 6.5 },
  { tag: 'av-main', axis: 'z', at: -70, from: -245.5, to: 192, halfWidth: 10 },
  { tag: 'av-east', axis: 'z', at: 110, from: -245.5, to: 192, halfWidth: 9 },
  { tag: 'blvd-north', axis: 'x', at: -160, from: -255.5, to: 255.5, halfWidth: 10 },
  { tag: 'st-n2', axis: 'x', at: -60, from: -255.5, to: 255.5, halfWidth: 6.5 },
  { tag: 'blvd-center', axis: 'x', at: 60, from: -255.5, to: 255.5, halfWidth: 9 },
  { tag: 'blvd-water', axis: 'x', at: 186, from: -255.5, to: 255.5, halfWidth: 8 },
];

/** The city's districts (`citySpec.zoneOf`), repeated so this file imports nothing that runs. */
export function circuitZoneOf(x: number, z: number): TrackZone {
  if (z < -100 && x < 60) return 'corporate';
  if (z > 90 || (x > 150 && z > -20)) return 'jdm';
  return 'urban';
}

/* ------------------------------------------------------------------ the elevated road */

/** Height of the viaduct deck (m): `citySpec.VIADUCT_Y`. */
export const CIRCUIT_DECK_Y = 15;

/**
 * The nodes the highway sector borrows, verbatim, from `RAMP_SPECS` and `VIADUCT_SPEC`: the
 * lap follows the ramps and the deck by standing on their own corners. Listed here so
 * `tests/circuitWorld.test.ts` can compare them one by one against `citySpec.ts` and refuse a
 * lap that has quietly drifted off the road it is drawn on.
 *
 * The two nodes NOT in this list — 'deck-in' and 'bay-west' — are on the viaduct's centreline
 * between its own corners, where there is no city node to borrow. The ribbon check covers
 * them like everything else.
 */
export const CIRCUIT_BORROWED = [
  { road: 'ramp-e-on', x: 224, z: -40 },
  { road: 'ramp-e-on', x: 224, z: 110 },
  { road: 'ramp-e-on', x: 240, z: 150 },
  { road: 'viaduct', x: 245, z: 240 },
  { road: 'ramp-s-off', x: -40, z: 226 },
  { road: 'ramp-s-off', x: -150, z: 222 },
  { road: 'ramp-s-off', x: -180, z: 190 },
];

/* ------------------------------------------------------------------ the lap */

/** Widths (m). Each is its street less the room the barriers and their footings want. */
const W_STREET = 11;
const W_BLVD = 17;
const W_RAMP = 9.5;
const W_DECK = 13;

const n = (x: number, z: number, r: number, width: number, tag: string, y?: number): TrackNode => ({
  x,
  z,
  r,
  width,
  zone: circuitZoneOf(x, z),
  tag,
  ...(y !== undefined ? { y } : {}),
});

/**
 * The lap. Radii are the largest each corner will take with the ribbon still on drivable
 * ground and a car's width in hand — `scripts/circuit-preview.mjs` prints both, and refuses
 * the spec if either is broken.
 *
 * Heights: y is anchored at 0 where the lap is on the street and at the deck height where it
 * is on the viaduct; `track.ts` eases the grade in and out between them, and the ramps under
 * it do the same, so the ribbon climbs with the road it is drawn on.
 */
export const CIRCUIT_SPEC: TrackSpec = {
  closed: true,
  nodes: [
    // --- the streets
    n(-190, 60, 11, W_STREET, 'west-in', 0),
    n(-70, 60, 30, W_STREET + 2, 'centre-hook'),
    n(-70, -110, 0, W_BLVD, 'downtown'),
    n(-70, -160, 18, W_STREET + 2, 'downtown-north'),
    n(110, -160, 16, W_STREET + 2, 'east-hook'),
    n(110, -60, 11, W_STREET, 'n2-east'),
    n(213, -60, 20, W_RAMP, 'ramp-gate', 0),
    // --- the highway: up the east ramp, round the bay, down the south ramp
    n(224, -40, 26, W_RAMP, 'ramp-e-lower'),
    n(224, 110, 26, W_RAMP, 'ramp-e-upper', CIRCUIT_DECK_Y),
    n(240, 150, 26, W_RAMP, 'ramp-e-merge'),
    n(245, 170, 40, W_DECK, 'deck-in', CIRCUIT_DECK_Y),
    n(245, 240, 60, W_DECK, 'bay-corner', CIRCUIT_DECK_Y),
    n(40, 240, 60, W_DECK, 'bay-west', CIRCUIT_DECK_Y),
    n(-40, 226, 40, W_RAMP, 'ramp-s-upper', CIRCUIT_DECK_Y),
    n(-150, 222, 30, W_RAMP, 'ramp-s-lower'),
    n(-180, 190, 24, W_RAMP, 'quay-landing', 0),
    n(-190, 182, 11, W_STREET, 'west-turn', 0),
  ],
};

/** Laps. One lap is about a minute; two of them is the race. */
export const CIRCUIT_LAPS = 2;

/** The city's extents: the circuit is inside them, and the minimap frames the same picture. */
export const CIRCUIT_BOUNDS: Rect = { minX: -270, maxX: 270, minZ: -260, maxZ: 290 };

/**
 * Checkpoints near the centreline; the world builder projects them onto the lap. Index 0 is
 * the start/finish line, on the downtown straight up av-main. The rest sit one per fifth of
 * the lap: they are what makes reversing into a barrier and rejoining further on illegal.
 */
export const CIRCUIT_GATES: Array<{ x: number; z: number }> = [
  { x: -70, z: 20 },
  { x: -70, z: -140 },
  { x: 110, z: -100 },
  { x: 224, z: 60 },
  { x: 150, z: 240 },
  { x: -110, z: 224 },
];
