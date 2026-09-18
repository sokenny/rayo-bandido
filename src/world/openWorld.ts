import type { World } from './arenaWorld';
import { addHustlers } from './hustlerSpots';
import { addMicroSceneAnchors } from './microSceneAnchors';
import { addStreetSites } from './cityStreetSites';
import { addStreetProps } from './streetProps';
import { createCityWorld } from './cityWorld';
import { METRO_SPEC, METRO_STREET_SITES } from './metroSpec';

/**
 * THE OPEN WORLD: Bandido Metro (`metroSpec.ts`), with the doors to the races painted on it.
 *
 * One function because the game and the tests have to build exactly the same thing: the intro,
 * the doors and the free-world activities are all checked against this world, not against a
 * city assembled a slightly different way in each test file.
 *
 * The races themselves are still run on Bandido Bay (`circuitWorld.ts`, `streetWorld.ts`); the
 * doors are where the metro hands the player over to them.
 *
 * TIME ATTACK HAS NO DOOR HERE (2026-09-18): its start-line ring (`addCircuitGate`,
 * `METRO_CIRCUIT_SITE`) came off the metro and the game off QUICK PLAY. The circuit world and
 * the gate code are untouched — `?mode=circuit` still loads it, and putting the door back is
 * wrapping `createCityWorld` in `addCircuitGate` again.
 */
export function createOpenWorld(): World {
  // The street props go on last: they keep clear of every door, ring, hustler and micro-scene
  // anchor laid before them.
  return addStreetProps(
    addMicroSceneAnchors(addHustlers(addStreetSites(createCityWorld(METRO_SPEC), METRO_STREET_SITES))),
  );
}
