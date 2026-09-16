import type { TrackNode, TrackSpec, TrackZone } from './track';
import type { StreetCourseSpec } from './streetSpec';

/**
 * THE LA CURVA CIRCUIT — the fourth STREET RACE, run on BANDIDO METRO and on its highways.
 *
 * Met at La Curva, the car meet under the viaduct's north-west corner (`METRO_MEET`). The lap is
 * built round the two elevated roads the metro has: the VIADUCT, whose curve it takes right over
 * the meet, and The Stack's DECK, the 12 m loop through the towers with its hairpin in the middle.
 * Juan's second brief (2026-09-14): it has to use the highway, no long plain straights, and the
 * fence must not let anybody off the course. So:
 *
 * ONE LAP, from the line on blvd-ring-w southbound (metro coordinates, north up):
 *
 *   1. south on the ring, then THE CHICANE: right on av-s1, left down st-w3, right on st-s4 —
 *      or straight on down the ring and right on st-s4 (branch B, one corner instead of three),
 *   2. right into av-w1 and straight UP the race ramp onto the viaduct's west leg,
 *   3. THE CURVE: north and round the 70 m bend over La Curva, east along the north leg,
 *   4. off on the race ramp, over blvd-ring-w and st-west, down into st-s3,
 *   5. left up av-central into The Stack, left on st-south, right up st-west onto w-up-01,
 *   6. THE DECK: north, round the west corner, down the diagonal into THE HAIRPIN under the
 *      spine, back up to the north-east corner, down the east leg and round into the south leg,
 *   7. off the deck down s-up-01 onto av-sweeper westbound, over av-central,
 *   8. left down st-west and right on the ring — or on along the sweeper and left down the ring
 *      (branch A, the wide way) — and left down the ring to the line.
 *
 * Nothing at grade crosses the lap; where the lap passes over itself (the race ramp over the ring,
 * s-up-01 over av-central) the race and the rivals project by height (`projectOntoPath`'s `y`).
 * The two race ramps (`CURVA_RAMPS`) exist only in the race's copy of the city, built exactly like
 * the metro's own four (`METRO_RAMPS`): the viaduct had no way on or off near the meet.
 *
 * Nothing gets off the lap or the branches: the viaduct's and the deck's rails and the blocks
 * hold most of it, and `raceBarriers.ts` closes the rest — every mouth, lot and ramp junction.
 *
 * PURE GEOMETRY, no imports that run (the same rule as `streetSpec.ts`).
 */

/** `metroSpec.zoneOf` for the stretches this lap uses, repeated so this file imports nothing that runs. */
function zoneAt(x: number, z: number): TrackZone {
  if (x >= -300 && x <= 300 && z >= -420 && z <= 180) return 'corporate';
  if (x >= -480 && x <= 480 && z >= -600 && z <= 360) return 'corporate';
  return 'urban';
}

const n = (x: number, z: number, r: number, width: number, tag: string, y?: number): TrackNode => ({
  x,
  z,
  r,
  width,
  zone: zoneAt(x, z),
  tag,
  ...(y !== undefined ? { y } : {}),
});

/** The viaduct's deck and The Stack's deck (m). */
const VIADUCT_Y = 15;
const DECK_Y = 12;

/** Ribbon widths (m): each is its road less a margin either side. */
const W_BLVD = 15; // the 20 m ring boulevards
const W_AVE = 13; // 18-22 m avenues
const W_STREET = 11; // 13 m streets
const W_RAMP = 9; // 11 m ramps
const W_VIADUCT = 14; // the 18 m viaduct
const W_DECK = 11; // The Stack's 14 m deck

/**
 * The race ramps, as the metro writes its ramps (`metroSpec.rampNodes`): foot inside a street
 * 64 m off the leg, climbing beside the deck 48 m off it, sliding in 3 m off its centre. Written
 * foot first. Each starts clear of a cross street and is at deck height over the next one.
 *
 *   race-ramp-w  av-w1 northbound from st-s4, on the WEST side of the viaduct's west leg, merging
 *                northbound at z 416, 56 m before the curve. Over av-s1 at deck height.
 *   race-ramp-n  on the SOUTH side of the north leg; written as the on-ramp westbound from st-s3,
 *                driven by the race the other way: off the deck eastbound at x -340, over the ring
 *                at deck height and over st-west still at 15 m, down into st-s3 52 m short of
 *                av-central.
 */
export const CURVA_RAMPS: Array<{ tag: string; spec: TrackSpec }> = [
  {
    tag: 'race-ramp-w',
    spec: {
      closed: false,
      nodes: [
        n(-614, 636, 0, 11, 'foot', 0),
        n(-614, 614, 15, 11, 'lead'),
        n(-598, 594, 25, 11, 'climb'),
        n(-598, 496, 40, 11, 'up', VIADUCT_Y),
        n(-554, 456, 30, 11, 'slide'),
        n(-553, 416, 0, 11, 'merge', VIADUCT_Y),
      ],
    },
  },
  {
    tag: 'race-ramp-n',
    spec: {
      closed: false,
      nodes: [
        n(-112, 360, 0, 11, 'foot', 0),
        n(-134, 360, 15, 11, 'lead'),
        n(-158, 338, 25, 11, 'climb'),
        n(-260, 338, 40, 11, 'up', VIADUCT_Y),
        n(-300, 294, 30, 11, 'slide'),
        n(-340, 293, 0, 11, 'merge', VIADUCT_Y),
      ],
    },
  },
];

export const CURVA_SPEC: TrackSpec = {
  closed: true,
  nodes: [
    // 1. The chicane.
    n(-340, 500, 12, W_AVE, 'chicane-in', 0), // blvd-ring-w south -> av-s1 west
    n(-480, 500, 10, W_STREET, 'chicane-mid'), // av-s1 -> st-w3 south
    n(-480, 640, 8.5, W_STREET, 'chicane-out'), // st-w3 -> st-s4 west
    // 2. Up race-ramp-w: its foot is in the corner.
    n(-614, 640, 6, W_RAMP, 'ramp-w-turn', 0), // st-s4 -> av-w1 north, onto the ramp
    n(-614, 614, 15, W_RAMP, 'ramp-w-lead'),
    n(-598, 594, 25, W_RAMP, 'ramp-w-climb'),
    n(-598, 496, 40, W_RAMP, 'ramp-w-up', VIADUCT_Y),
    n(-554, 456, 30, W_RAMP, 'ramp-w-slide'),
    n(-553, 416, 0, W_RAMP, 'viaduct-in', VIADUCT_Y), // off the ramp and out to the deck's width
    n(-550, 380, 0, W_VIADUCT, 'viaduct-west', VIADUCT_Y),
    // 3. The curve over La Curva.
    n(-550, 290, 70, W_VIADUCT, 'the-curve', VIADUCT_Y),
    // 4. Off on race-ramp-n.
    n(-340, 293, 0, W_RAMP, 'ramp-n-split', VIADUCT_Y),
    n(-300, 294, 30, W_RAMP, 'ramp-n-slide'),
    n(-260, 338, 40, W_RAMP, 'ramp-n-down', VIADUCT_Y),
    n(-158, 338, 25, W_RAMP, 'ramp-n-drop'),
    n(-134, 360, 15, W_RAMP, 'ramp-n-lead'),
    n(-112, 360, 0, W_STREET, 'ramp-n-foot', 0),
    // 5. Into The Stack.
    n(-60, 360, 12, W_STREET, 'canyon-in'), // st-s3 east -> av-central north
    n(-60, 10, 12, W_STREET, 'canyon-out'), // av-central -> st-south west
    n(-252, 10, 6, W_RAMP, 'deck-turn'), // st-south -> st-west north, onto w-up-01
    n(-249, 0, 0, W_RAMP, 'w-up-foot', 0),
    n(-232, -40, 30, W_RAMP, 'w-up-climb'),
    n(-232, -125, 30, W_RAMP, 'w-up-up', DECK_Y),
    n(-218, -160, 30, W_RAMP, 'w-up-slide'),
    n(-217, -195, 0, W_RAMP, 'deck-in', DECK_Y),
    n(-215, -225, 0, W_DECK, 'deck-west', DECK_Y),
    // 6. The deck, clockwise, node for node.
    n(-215, -280, 40, W_DECK, 'deck-w', DECK_Y),
    n(-60, -370, 50, W_DECK, 'deck-nw', DECK_Y),
    n(0, -140, 45, W_DECK, 'the-hairpin', DECK_Y),
    n(215, -300, 50, W_DECK, 'deck-ne', DECK_Y),
    n(215, 50, 50, W_DECK, 'deck-se', DECK_Y),
    // 7. Down s-up-01, driven the other way.
    n(80, 74, 0, W_RAMP, 'deck-out', DECK_Y),
    n(30, 90, 30, W_RAMP, 's-down-slide'),
    n(-20, 108, 40, W_RAMP, 's-down-drop', DECK_Y),
    n(-150, 116.5, 25, W_RAMP, 's-down-flat', 0),
    n(-190, 135, 20, W_RAMP, 's-down-foot', 0),
    // 8. Back to the ring.
    n(-252, 132, 10, W_STREET, 'back-in'), // av-sweeper west -> st-west south
    n(-252, 220, 12, W_STREET, 'back-mid'), // st-west -> blvd-ring-s west
    n(-340, 220, 12, W_BLVD, 'back-out'), // blvd-ring-s -> blvd-ring-w south
  ],
};

/**
 * The branches. Each starts and ends inside the lap's ribbon, so the barrier leaves a branch's mouth
 * open where it leaves and joins (`raceBarriers.ts`).
 *
 *   A  THE WIDE WAY BACK: on along av-sweeper past st-west and left down blvd-ring-w. The same
 *      distance as st-west and the ring, one corner instead of two, on roads half as wide again.
 *   B  THE BOULEVARD: straight on down blvd-ring-w past av-s1 and right on st-s4, skipping the
 *      chicane. The same distance, one corner instead of three.
 */
export const CURVA_SHORTCUTS: TrackSpec[] = [
  {
    closed: false,
    nodes: [n(-240, 132.4, 0, W_STREET, 'a-in', 0), n(-340, 132, 12, W_AVE, 'a-turn'), n(-340, 240, 0, W_BLVD, 'a-out', 0)],
  },
  {
    closed: false,
    nodes: [n(-340, 486, 0, W_BLVD, 'b-in', 0), n(-340, 640, 12, W_STREET, 'b-turn'), n(-502, 640, 0, W_STREET, 'b-out', 0)],
  },
];

export const CURVA_GATES: StreetCourseSpec['gates'] = [
  { x: -340, z: 420 }, // the line, blvd-ring-w southbound
  { x: -480, z: 570, alt: { shortcut: 1, x: -340, z: 570 } }, // the chicane, or the boulevard
  { x: -560, z: 640 }, // st-s4, before the ramp
  { x: -522, z: 304, y: VIADUCT_Y }, // on the curve, over La Curva
  { x: -100, z: 360 }, // st-s3, off the ramp
  { x: -60, z: 190 }, // av-central
  { x: -160, z: 10 }, // st-south
  { x: 0, z: -140, y: DECK_Y }, // the hairpin
  { x: 215, z: -130, y: DECK_Y }, // the deck's east leg
  { x: -215, z: 133 }, // av-sweeper, off the deck
  { x: -252, z: 176, alt: { shortcut: 0, x: -340, z: 176 } }, // st-west, or the wide way
  { x: -340, z: 262 }, // blvd-ring-w, after it
];

/** One lap: at ~3.8 km two would be a five-minute race. Kept equal to the event's `laps` (tests). */
export const CURVA_LAPS = 1;

export const CURVA_COURSE: StreetCourseSpec = {
  spec: CURVA_SPEC,
  shortcuts: CURVA_SHORTCUTS,
  gates: CURVA_GATES,
  laps: CURVA_LAPS,
  // The lap races on both decks: the city's own traffic up there comes off.
  keepDeckTraffic: false,
};

/**
 * Where the race is met: on La Curva's lot, in the open ground between the north fence's row and
 * the curve, facing the main gate. Not a road: the one ring on a lot (`tests/curvaRace.test.ts`
 * checks it against the meet's cars, people and props instead).
 */
export const CURVA_SITE = { x: -550, z: 272, y: 0, heading: 0, label: 'LA CURVA · CAR MEET' };
