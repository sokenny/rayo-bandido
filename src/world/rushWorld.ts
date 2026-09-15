import type { World } from './arenaWorld';
import { createOpenWorld } from './openWorld';

/**
 * RAYO RUSH on its own (`?mode=rush`): QUICK PLAY's way into the run, and the world a rush room
 * plays in.
 *
 * The same Bandido Metro the open world is — the same streets, the same electric cars on the
 * same patrols, the same markers — because a run is only worth anything if it is the run the
 * city offers. What comes off is everything that is not the run: the passengers, El Búho, Loco
 * Mustang, and the doors to the circuit and to the Street Race, taken off at the source exactly
 * as the race worlds take them off (`circuitWorld.ts`, `streetWorld.ts`). The rules build no
 * state for an activity whose site is missing, and the art paints no marker for a plan that
 * carries none.
 *
 * `site` is which RAYO RUSH marker the car is put down on: the mission on offer when played
 * alone, and the first one for a room, where every car has to start from the same corner.
 */
export function createRushWorld(site = 0): World {
  const world = createOpenWorld();
  const { layout, plan } = world;
  layout.passengerStops = null;
  layout.buhoSite = null;
  layout.garageSite = null;
  layout.circuitSite = null;
  layout.streetSites = null;
  plan.circuitMarker = null;
  plan.streetMarkers = null;

  const sites = layout.rushSites ?? [];
  const at = sites[Math.max(0, Math.min(sites.length - 1, Math.floor(site) || 0))];
  // On the paint, squared up with the street the marker was drawn along.
  if (at) layout.playerSpawn = { x: at.x, z: at.z, y: at.y, heading: at.heading };
  return world;
}
