import type { TrackNode, TrackSpec, TrackZone } from './track';

/**
 * THE QUAY CIRCUIT — the STREET RACE course, run inside the open world.
 *
 * Same idea as `circuitSpec.ts` (a ribbon laid over an instance of the city) and deliberately a
 * different lap: it never touches the viaduct or the ramps, it is driven CLOCKWISE on the map
 * where the Bandido Grid runs the other way, and the only stretches the two share are 60 m of
 * st-west and the av-east / blvd-center corner, each taken in the opposite direction.
 *
 * THE LAP, from the line on st-south:
 *
 *   1. east along st-south, the 300 m straight, four crossings and the nitro,
 *   2. right onto av-east, down to the waterfront, THE QUAY BAY: left along blvd-water and
 *      left again up st-far-east — or alley-b, which cuts the bay 72 m short (shortcut A),
 *   3. left onto blvd-center, right up av-east, left onto st-n2,
 *   4. THE DIAGONAL: off st-n2 onto av-diag, two sweepers south-west across av-main,
 *   5. right onto blvd-center, THE WEST BAY: left down st-west and left onto st-south — or
 *      alley-c, which cuts that bay 80 m short (shortcut B) — and back to the line.
 *
 * Two laps. Check it with the same road-coverage test the versus circuit has
 * (`tests/streetRace.test.ts`): the whole ribbon, edge to edge, on a road that exists.
 *
 * PURE GEOMETRY, no imports that run (the same rule as `circuitSpec.ts`).
 */

/** The city's districts (`citySpec.zoneOf`), repeated so this file imports nothing that runs. */
function zoneAt(x: number, z: number): TrackZone {
  if (z < -100 && x < 60) return 'corporate';
  if (z > 90 || (x > 150 && z > -20)) return 'jdm';
  return 'urban';
}

const n = (x: number, z: number, r: number, width: number, tag: string): TrackNode => ({ x, z, r, width, zone: zoneAt(x, z), tag });

/** Ribbon widths (m): each is its street less a margin either side. */
const W_STREET = 11;
const W_NARROW = 10;
const W_DIAG = 13;
const W_AVE = 15;
const W_ALLEY = 7;

/** The main lap. Radii are the largest each corner takes with the ribbon still on the road. */
export const STREET_SPEC: TrackSpec = {
  closed: true,
  nodes: [
    n(110, -60, 12, W_STREET, 'north-hook'), // av-east north -> st-n2 west
    n(30, -60, 34, 12, 'diag-in'), // st-n2 -> av-diag, the first sweeper
    n(-60, 10, 120, W_DIAG, 'diag-mid'), // av-diag's own bend
    n(-96, 60, 28, 12, 'diag-out'), // av-diag -> blvd-center west
    n(-190, 60, 12, W_STREET, 'west-in'), // blvd-center -> st-west south (THE WEST BAY)
    n(-190, 120, 10, W_NARROW, 'west-out'), // st-west -> st-south east
    n(110, 120, 10, W_STREET, 'quay-in'), // st-south -> av-east south (THE QUAY BAY)
    n(110, 186, 14, W_DIAG, 'quay-turn'), // av-east -> blvd-water east
    n(210, 186, 12, W_NARROW, 'quay-out'), // blvd-water -> st-far-east north
    n(210, 60, 12, W_NARROW, 'east-in'), // st-far-east -> blvd-center west
    n(110, 60, 12, W_AVE, 'east-out'), // blvd-center -> av-east north
  ],
};

/**
 * The shortcuts: two alleys, each cutting across a bay of the main lap. Every one starts and
 * ends inside the main ribbon so the surfaces join and the race's station interpolation has
 * somewhere to hand over (`RaceCourse.shortcuts`).
 *
 *   A  alley-b, off av-east southbound and out onto st-far-east northbound: 7.5 m wide, two
 *      right-angle turns 30 m after a corner, saves ~72 m. Narrow, hard to enter, no overtaking.
 *   B  alley-c, off blvd-center westbound and out onto st-south eastbound: the same shape in
 *      the west, saves ~80 m, with a sharper exit onto the long straight.
 */
export const STREET_SHORTCUTS: TrackSpec[] = [
  { closed: false, nodes: [n(112, 150, 0, W_ALLEY, 'a-in'), n(208, 150, 0, W_ALLEY, 'a-out')] },
  { closed: false, nodes: [n(-150, 58, 0, W_ALLEY, 'b-in'), n(-150, 122, 0, W_ALLEY, 'b-out')] },
];

/**
 * Checkpoints near the centreline; the world builder projects them onto the lap. Index 0 is
 * the start/finish line, on st-south. A gate with `alt` is a BRANCH gate: its main segment is
 * laid across the main road and `alt` across the shortcut it names, and crossing either counts
 * (`src/sim/race.ts`). The gates either side of a branch are what make skipping both illegal.
 */
export const STREET_GATES: Array<{ x: number; z: number; alt?: { shortcut: number; x: number; z: number } }> = [
  { x: -20, z: 120 }, // the line, st-south eastbound
  { x: 110, z: 138 }, // av-east, before the quay bay
  { x: 160, z: 186, alt: { shortcut: 0, x: 160, z: 150 } }, // the bay's far side, or alley-b
  { x: 210, z: 118 }, // st-far-east, after the bay
  { x: 170, z: 60 }, // blvd-center westbound
  { x: 110, z: 0 }, // av-east northbound
  { x: -15, z: -25 }, // the diagonal
  { x: -128, z: 60 }, // blvd-center, before the west bay
  { x: -190, z: 90, alt: { shortcut: 1, x: -150, z: 90 } }, // st-west, or alley-c
  { x: -100, z: 120 }, // st-south, after the bay
];

export const STREET_LAPS = 2;

/**
 * A Street Race course as data: everything `streetWorld.ts` lays over a city. The Quay Circuit
 * below is one; La Curva (`curvaSpec.ts`) is the other.
 */
export interface StreetCourseSpec {
  spec: TrackSpec;
  shortcuts: TrackSpec[];
  /** `y` is the height of the road the gate stands on, where the course is elevated (a deck, a ramp). */
  gates: Array<{ x: number; z: number; y?: number; alt?: { shortcut: number; x: number; z: number; y?: number } }>;
  laps: number;
  /** False to take the city's elevated traffic off too, for a course that races on the decks. */
  keepDeckTraffic?: boolean;
  /** Electric cars patrolling the lap; `STREET_RACE.trafficCount` when omitted. */
  traffic?: number;
}

/**
 * The Quay Circuit as one course. Its barrier is not written here: `raceBarriers.ts` closes
 * whatever the city leaves open round the lap and both alleys.
 */
export const QUAY_COURSE: StreetCourseSpec = {
  spec: STREET_SPEC,
  shortcuts: STREET_SHORTCUTS,
  gates: STREET_GATES,
  laps: STREET_LAPS,
};

/**
 * Where the three events are MET, in the open world: three rings at three places, as if each
 * rival waits somewhere more serious than the last. All three launch the same circuit. Each is
 * mid-block on a road, clear of every other ring (`tests/streetRace.test.ts` checks).
 */
export const STREET_SITES = [
  { x: 110, z: -32, y: 0, heading: 0, label: 'AV-EAST · THE CROSSING' },
  { x: 65, z: -160, y: 0, heading: Math.PI / 2, label: 'BLVD-NORTH · DOWNTOWN' },
  { x: -130, z: 186, y: 0, heading: Math.PI / 2, label: 'THE WEST QUAY' },
];
