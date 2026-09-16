import type { World } from './arenaWorld';
import { addCircuitGate } from './cityCircuitGate';
import { addHustlers } from './hustlerSpots';
import { addMicroSceneAnchors } from './microSceneAnchors';
import { addStreetSites } from './cityStreetSites';
import { addStreetProps } from './streetProps';
import { createCityWorld } from './cityWorld';
import { METRO_CIRCUIT_SITE, METRO_SPEC, METRO_STREET_SITES } from './metroSpec';

/**
 * THE OPEN WORLD: Bandido Metro (`metroSpec.ts`), with the doors to the races painted on it.
 *
 * One function because the game and the tests have to build exactly the same thing: the intro,
 * the doors and the free-world activities are all checked against this world, not against a
 * city assembled a slightly different way in each test file.
 *
 * The races themselves are still run on Bandido Bay (`circuitWorld.ts`, `streetWorld.ts`); the
 * doors are where the metro hands the player over to them.
 */
export function createOpenWorld(): World {
  // The street props go on last: they keep clear of every door, ring, hustler and micro-scene
  // anchor laid before them.
  return addStreetProps(
    addMicroSceneAnchors(addHustlers(addStreetSites(addCircuitGate(createCityWorld(METRO_SPEC), METRO_CIRCUIT_SITE), METRO_STREET_SITES))),
  );
}
