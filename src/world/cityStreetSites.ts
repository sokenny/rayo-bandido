import type { ActivitySite } from '../core/types';
import type { World } from './arenaWorld';
import { STREET_SITES } from './streetSpec';

/**
 * THE STREET RACE RINGS, as a LAYER over the city — the same one-way dependency as
 * `cityCircuitGate.ts`, for the same reason: the city does not know the race exists.
 *
 * Three rings at three places, one per event of the series: the Bay's are `STREET_SITES`
 * (`streetSpec.ts`), the open world's are `METRO_STREET_SITES` (`metroSpec.ts`) — the race is
 * run on the Bay either way. Which of them are open is the rules' business
 * (`src/sim/streetGate.ts`); which are painted is the game's (`src/game.ts` hides the markers of
 * events not yet reached). This only says where they are.
 */
export function streetSites(): ActivitySite[] {
  return STREET_SITES.map((s) => ({ ...s }));
}

/** Put the rings on a city. Called for the OPEN WORLD only; the race worlds clear the field. */
export function addStreetSites(world: World, sites: readonly ActivitySite[] = STREET_SITES): World {
  // On the ground where the city puts its ground: a site is written at y 0, the street may not be.
  const groundY = world.layout.groundY;
  const placed = sites.map((s) => ({ ...s, y: groundY ? Math.max(s.y, groundY(s.x, s.z)) : s.y }));
  world.layout.streetSites = placed.map((s) => ({ ...s }));
  world.plan.streetMarkers = placed.map((s) => ({ ...s }));
  return world;
}
