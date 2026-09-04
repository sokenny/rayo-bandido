import type { TrackNode, TrackSpec } from './track';

/**
 * THE CIRCUIT — "Bandido Loop". Data only; `src/world/raceWorld.ts` turns it into colliders,
 * checkpoints, city blocks and art. Tune with `node scripts/track-preview.mjs`.
 *
 * Read clockwise on the map (north up, x east, z south). Every corner is a fillet arc of at
 * least 32 m radius and no single arc turns more than 70 degrees: direction changes are made of
 * chained sweepers, never a right-angle street corner. That is the whole design brief -
 * fast enough to empty the nitro on the west straight, open enough to drift every corner.
 *
 *   zone 'corporate'  highway: 20 m wide, guardrails, towers set back on a shoulder
 *   zone 'urban'      city streets: 13-15 m, mid-rise right at the sidewalk, cables overhead
 *   zone 'jdm'        old town: 12 m, low garages, the two alley shortcuts leave from here
 */
const node = (x: number, z: number, r: number, width: number, zone: TrackNode['zone'], tag?: string): TrackNode => ({
  x,
  z,
  r,
  width,
  zone,
  tag,
});

export const RACE_SPEC: TrackSpec = {
  closed: true,
  nodes: [
    // South-west: two 45-degree sweepers feed the start straight.
    node(-168, 156, 42, 20, 'corporate', 'sw-in'),
    node(-226, 98, 42, 20, 'corporate', 'start'),
    // The start straight runs north up the highway. Start/finish line and grid sit on it.
    node(-226, -96, 75, 20, 'corporate', 'nw-in'),
    node(-168, -154, 75, 20, 'corporate', 'north'),
    // North bay: the road dives into the city through four 60-degree corners and comes back
    // out heading east. Alley A runs straight across the mouth of the bay.
    node(-67, -154, 45, 16, 'urban', 'bay-a'),
    node(-37, -102, 40, 14, 'urban', 'bay-b'),
    node(11, -102, 40, 14, 'urban', 'bay-c'),
    node(40, -154, 45, 16, 'urban', 'bay-d'),
    // North-east: 45-degree pair into the east side.
    node(134, -154, 42, 16, 'urban', 'ne-in'),
    node(192, -96, 42, 14, 'urban', 'east'),
    // Old-town bay: the same trick on the east side, dipping west. Alley B cuts it.
    node(192, -43, 40, 14, 'urban', 'old-a'),
    node(140, -13, 36, 13, 'jdm', 'old-b'),
    node(140, 29, 36, 13, 'jdm', 'old-c'),
    node(192, 59, 40, 14, 'jdm', 'old-d'),
    // South-east: 45-degree pair onto the south highway, which sweeps gently on the way west.
    node(192, 113, 36, 14, 'jdm', 'se-in'),
    node(154, 152, 42, 16, 'jdm', 'south-in'),
    node(-29, 132, 110, 20, 'corporate', 'south'),
  ],
};

/** Overall drivable bounds; the perimeter wall band sits just outside. */
export const RACE_BOUNDS = { minX: -254, maxX: 232, minZ: -188, maxZ: 188 };

/**
 * Hidden shortcuts: narrow alleys that leave the main road on the OUTSIDE of a corner, just
 * where the guardrail starts to bend away, and run behind the buildings across the mouth of a
 * bay. Each alley starts and ends inside the main ribbon so the surfaces join; the guardrails
 * open where they meet.
 */
export const RACE_SHORTCUTS: TrackSpec[] = [
  // A: behind the north bay. Entrance on the left, right where the road turns in.
  {
    closed: false,
    nodes: [
      node(-92, -154, 0, 8, 'jdm', 'alley-a-in'),
      node(-67, -171, 14, 8, 'jdm'),
      node(40, -171, 14, 8, 'jdm'),
      node(65, -154, 0, 8, 'jdm', 'alley-a-out'),
    ],
  },
  // B: behind the old town. Entrance on the left as the east side turns in toward the bay.
  {
    closed: false,
    nodes: [
      node(192, -69, 0, 8, 'jdm', 'alley-b-in'),
      node(209, -44, 14, 8, 'jdm'),
      node(209, 60, 14, 8, 'jdm'),
      node(192, 84, 0, 8, 'jdm', 'alley-b-out'),
    ],
  },
];

/**
 * Checkpoints as points near the centreline; the world builder projects them onto the lap.
 * Index 0 is the start/finish line. No checkpoint sits inside a stretch a shortcut skips.
 */
export const RACE_GATES: Array<{ x: number; z: number }> = [
  { x: -226, z: 38 },
  { x: -125, z: -154 },
  { x: 192, z: -96 },
  { x: 38, z: 152 },
  { x: -197, z: 130 },
];
