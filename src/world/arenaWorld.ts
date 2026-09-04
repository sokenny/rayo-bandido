import type { ArenaLayout } from '../core/types';
import { PAL } from '../render/scene/env/palette';
import { ARENA_BARRIERS, ARENA_BLOCKS, ARENA_ROADS, ARENA_WALLS, createArenaLayout } from './arenaLayout';
import { rectPredicates, type CityPlan, type ZoneId } from './cityPlan';

/**
 * The test city ("Test" in the main menu): the original free-roam arena, packaged as a world.
 * The layout is unchanged; the plan lists the same rectangles plus the dressing that used to
 * be hard-coded inside the renderer (route gates, billboards, cables, plaza pylons).
 */
export interface World {
  layout: ArenaLayout;
  plan: CityPlan;
}

export function arenaZoneAt(x: number, z: number): ZoneId {
  if (x < -30) return 'corporate';
  if (z > 30) return 'jdm';
  return 'urban';
}

export function createArenaWorld(): World {
  const layout = createArenaLayout();
  const roads = [...ARENA_ROADS];
  const blocks = [...ARENA_BLOCKS];
  const walls = [...ARENA_WALLS];
  const barriers = [...ARENA_BARRIERS];
  const predicates = rectPredicates(roads, [...blocks, ...walls, ...barriers]);

  const plan: CityPlan = {
    bounds: layout.bounds,
    roads,
    ribbons: [],
    rails: [],
    blocks,
    walls,
    barriers,
    gates: [
      // Corporate highway, north and south approaches.
      { x0: -100.8, z0: -55, x1: -78.7, z1: -55, height: 11.5, left: PAL.neonCyan, right: PAL.neonBlue },
      { x0: -100.8, z0: 55, x1: -78.7, z1: 55, height: 11.5, left: PAL.neonCyan, right: PAL.neonMagenta },
      // Urban north street.
      { x0: -45, z0: -100.8, x1: -45, z1: -76, height: 10.5, left: PAL.neonMagenta, right: PAL.neonCyan },
      // East avenue, entering the JDM half.
      { x0: 100.8, z0: 40, x1: 78.7, z1: 40, height: 10.5, left: PAL.neonPink, right: PAL.neonMagenta },
      // The garage alley.
      { x0: 49.4, z0: 40, x1: 60.6, z1: 40, height: 7.5, left: PAL.neonMagenta, right: PAL.neonCyan },
    ],
    billboards: [
      { variant: 0, x: -100.6, y: 27, z: -22, w: 30, h: 17, rotY: Math.PI / 2, color: PAL.neonCyan },
      { variant: 0, x: 26, y: 24, z: -100.6, w: 26, h: 15, rotY: 0, color: PAL.neonCyan },
      { variant: 1, x: 100.6, y: 25, z: -34, w: 26, h: 15, rotY: -Math.PI / 2, color: PAL.neonMagenta },
      { variant: 1, x: -26, y: 21, z: 100.6, w: 24, h: 14, rotY: Math.PI, color: PAL.neonMagenta },
    ],
    cableRuns: arenaCableRuns(),
    pylons: [
      { x: -15.4, z: -32.4, color: PAL.neonCyan },
      { x: 15.4, z: -32.4, color: PAL.neonCyan },
      { x: -15.4, z: 32.4, color: PAL.neonMagenta },
      { x: 15.4, z: 32.4, color: PAL.neonMagenta },
    ],
    plaza: { minX: -25, maxX: 25, minZ: -25, maxZ: 25 },
    wantedBoard: { x: 0, z: -30, rotY: 0 },
    startLine: null,
    checkpoints: [],
    zoneAt: arenaZoneAt,
    ...predicates,
  };

  return { layout, plan };
}

/** Overhead cables strung between facing blocks, as in the approved reference. */
function arenaCableRuns(): Array<[number, number, number, number]> {
  const runs: Array<[number, number, number, number]> = [];
  for (let z = -70; z <= -34; z += 9) runs.push([-14.6, z, 14.6, z]);
  for (let x = -70; x <= -34; x += 9) runs.push([x, -14.6, x, 14.6]);
  for (let z = 20; z <= 74; z += 9) runs.push([49.4, z, 60.6, z]);
  for (let x = 34; x <= 72; x += 9) runs.push([x, 76.6, x, 100.6]);
  return runs;
}
