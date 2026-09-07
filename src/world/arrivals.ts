/**
 * Where a car appears when somebody joins the open world.
 *
 * A race has a grid: the layout names one spawn per slot and the server hands them out. The
 * city has one spawn and no grid, so everybody who picks OPEN WORLD would land on the same
 * square metre — inside whoever got there a second earlier. The slot the server gives a roamer
 * (`server/room.mjs`) is therefore also their place in a fan around that spawn: three abreast
 * across the road, then a row behind, and so on.
 *
 * Laid out in the spawn's OWN frame rather than in world axes, so the fan still points down the
 * street whichever way the street runs, and slot 0 is left exactly on the spawn the
 * single-player city has always used.
 *
 * Pure geometry, no imports: the simulation, the tests and `src/game.ts` all read it.
 */

/** Sideways and backwards spacing of the fan, in metres. */
const LANE = 3;
const ROW = 6;
/**
 * Lane offsets across the road, in the order the slots take them: the middle first, so slot 0
 * is left exactly on the spawn, then one either side of it before a new row starts behind.
 */
const LANES = [0, -1, 1];

export interface Spawn {
  x: number;
  z: number;
  heading: number;
}

export function spawnForSlot(spawn: Spawn, slot: number): Spawn {
  const index = Math.max(0, slot);
  // Heading 0 faces -Z (`src/core/types.ts`); right is that turned a quarter clockwise.
  const forwardX = Math.sin(spawn.heading);
  const forwardZ = -Math.cos(spawn.heading);
  const rightX = -forwardZ;
  const rightZ = forwardX;
  const lane = LANES[index % LANES.length];
  const row = Math.floor(index / LANES.length);
  return {
    x: spawn.x + rightX * lane * LANE - forwardX * row * ROW,
    z: spawn.z + rightZ * lane * LANE - forwardZ * row * ROW,
    heading: spawn.heading,
  };
}
