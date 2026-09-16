import type { ActivitySite } from '../core/types';
import type { World } from './arenaWorld';
import { CIRCUIT_GATES, CIRCUIT_SPEC } from './circuitSpec';
import { buildTrackPath, createProjection, projectOntoPath } from './track';

/**
 * THE DOOR FROM THE CITY INTO THE CIRCUIT MISSIONS — as a LAYER over the city, never a part of
 * it.
 *
 * WHY IT IS ITS OWN FILE. The city does not know the race exists, and must not: `citySpec.ts`
 * and `cityWorld.ts` describe a place, and `circuitWorld.ts` instances that place and lays a
 * racing line over it. This is the mirror image of `circuitWorld.ts` — the same city, the same
 * one-way dependency, one much smaller thing added — so the free world can offer a way onto the
 * circuit without a single line of the city ever mentioning one.
 *
 * WHERE THE DOOR STANDS. On Bandido Bay it is `CIRCUIT_GATES[0]`, THE START/FINISH LINE ITSELF,
 * projected onto the lap so the ring is squared up with the racing line rather than with the
 * street it happens to be drawn on (`circuitGateSite`). Move the line in `circuitSpec.ts` and
 * the door on the Bay moves with it, because there is no second copy of where it is.
 *
 * The open world is Bandido Metro now (`src/world/openWorld.ts`), where the lap does not exist:
 * the circuit is still run on the Bay, on the other side of a page load. So the metro's door is
 * a site of its own (`METRO_CIRCUIT_SITE`), handed in as `site`.
 *
 * COST. One track path built once, at city load, and thrown away — the same build the circuit
 * pays for a race, and a few milliseconds against a world that takes a second and a half. Only
 * paid when no site is handed in.
 */

/** What the world calls the place, in the chrome's shouting case. */
const LABEL = 'BANDIDO GRID · START LINE';

/**
 * The start line as a site to stand a marker on: where it is, and which way the lap goes
 * through it. Exported so the tests can ask the same question the world does.
 */
export function circuitGateSite(): ActivitySite {
  const path = buildTrackPath(CIRCUIT_SPEC);
  const line = projectOntoPath(path, CIRCUIT_GATES[0].x, CIRCUIT_GATES[0].z, createProjection());
  return {
    // The point ON the lap, not the point the gate was specified at — they are within a metre
    // of each other, and the one on the lap is the one the player will cross.
    x: line.x,
    z: line.z,
    y: line.y,
    // The lap's own direction here, in this game's headings: 0 faces -Z, clockwise positive.
    // The chevrons painted into the approach then point down the racing line rather than across
    // it, which is the whole reason this is projected rather than typed.
    heading: Math.atan2(line.tx, -line.tz),
    label: LABEL,
  };
}

/**
 * Put the door on a city. Mutates the world it is given and hands it back, so a caller reads as
 * "the city, with a way onto the circuit" — `addCircuitGate(createCityWorld())`. `site` is where
 * it stands on a city the lap is not drawn through; omitted, it is the Bay's own start line.
 *
 * Called for the OPEN WORLD only. The circuit must never be given one: a race is not somewhere
 * you start a race from, and `circuitWorld.ts` explicitly clears the field this writes.
 */
export function addCircuitGate(world: World, site: ActivitySite = circuitGateSite()): World {
  // On the ground where the city puts its ground (the site is written at y 0; the street may be
  // on a hill). The rules' copy and the art's copy, made separately so neither can write
  // through the other.
  const y = world.layout.groundY ? Math.max(site.y, world.layout.groundY(site.x, site.z)) : site.y;
  world.layout.circuitSite = { ...site, y };
  world.plan.circuitMarker = { ...site, y };
  return world;
}
