import type { HustlerSpot } from '../core/types';
import type { World } from './arenaWorld';

/**
 * WHERE THE STREET HUSTLERS WORK (`src/sim/hustlers.ts`), as a LAYER over the open world — the same
 * one-way dependency as the race doors (`cityStreetSites.ts`): the city does not know they exist.
 *
 * Few, and on purpose. They make particular places memorable rather than standing on every
 * corner, so each spot is somewhere a player already goes:
 *
 *   TRAPITOS, each pointing at a space at the kerb nobody is going to park in —
 *     - outside Loco Mustang's garage, on the boulevard end of its frontage,
 *     - at the car meet's main gate off blvd-ring-s, under the viaduct's curve (La Curva's door),
 *     - on the NEOGAS forecourt's pavement where the two ring boulevards cross,
 *     - beside the EV chargers on av-s2 in the south-west neon district,
 *     - on the wide pavement beside the Bandido Grid start line on av-s1.
 *
 *   WASHERS, each working the one approach whose kerb corner he stands on, at his own light —
 *     - av-s1 eastbound at st-w3, under the viaduct's west ramp, a block from the VOLTA station
 *       and the meet,
 *     - av-central northbound at blvd-ring-s: the way into downtown, straight up from the spawn,
 *     - av-e1 southbound at st-south, on the OCTANO station's corner in the industrial east.
 *
 * Every spot stands on pavement, every washer's car waits on his approach's lane, and none of them
 * is inside anything solid (`tests/hustlers.test.ts`). The coordinates were read off the built
 * world, not the spec: kerb lines, lot edges and the ramp are where the assembler put them.
 *
 * Headings follow the game's convention: 0 faces north (-z), π/2 faces east.
 */

const N = 0;
const E = Math.PI / 2;
const S = Math.PI;
const W = -Math.PI / 2;

/** Seeds were chosen so the eight of them dress differently: a hood, a bucket hat, messy hair, shorts, six shirts. */
export const METRO_HUSTLER_SPOTS: HustlerSpot[] = [
  {
    id: 'trapito-garage',
    kind: 'trapito',
    label: "LOCO MUSTANG'S GARAGE",
    x: -446.5,
    z: 232.6,
    heading: N,
    seed: 1,
    space: { x: -452.5, z: 227.8 },
  },
  {
    id: 'trapito-meet-gate',
    kind: 'trapito',
    label: 'LA CURVA · MEET GATE',
    x: -563.2,
    z: 231.8,
    heading: N,
    seed: 13,
    space: { x: -575, z: 239 },
  },
  {
    id: 'trapito-neogas',
    kind: 'trapito',
    label: 'NEOGAS · RING NORTH',
    x: -398,
    z: -472.6,
    heading: S,
    seed: 42,
    space: { x: -391.5, z: -467.8 },
  },
  {
    id: 'trapito-chargers',
    kind: 'trapito',
    label: 'AV SOUTH 2 · THE CHARGERS',
    x: -403.2,
    z: 768.6,
    heading: S,
    seed: 178,
    space: { x: -410.5, z: 773.2 },
  },
  {
    id: 'trapito-grid',
    kind: 'trapito',
    label: 'BANDIDO GRID',
    x: -126,
    z: 487.5,
    heading: S,
    seed: 92,
    space: { x: -132.5, z: 494.2 },
  },
  {
    id: 'washer-volta',
    kind: 'washer',
    label: 'AV SOUTH × ST WEST 3',
    x: -488.6,
    z: 511.1,
    heading: N,
    seed: 2,
    approach: { x: -491.5, z: 504.6, heading: E },
    signal: { x: -487.2, z: 510, heading: W, offset: 0 },
  },
  {
    id: 'washer-downtown',
    kind: 'washer',
    label: 'AV CENTRAL × RING SOUTH',
    x: -47,
    z: 232.4,
    heading: W,
    seed: 50,
    approach: { x: -54.5, z: 235, heading: N },
    signal: { x: -48.4, z: 231, heading: S, offset: 13 },
  },
  {
    id: 'washer-octano',
    kind: 'washer',
    label: 'AV EAST × ST SOUTH',
    x: 609.2,
    z: 1.9,
    heading: E,
    seed: 5,
    approach: { x: 614.5, z: -1, heading: S },
    signal: { x: 610.2, z: 3, heading: N, offset: 26 },
  },
];

/** Put the hustlers on a world's layout. Before the street props, which keep clear of them. */
export function addHustlers(world: World, spots: readonly HustlerSpot[] = METRO_HUSTLER_SPOTS): World {
  world.layout.hustlerSpots = spots.map((s) => ({ ...s }));
  return world;
}
