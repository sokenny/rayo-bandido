import type { Rect } from './cityPlan';
// Value imports spelt with their extension, like `terrain.ts`'s, so plain Node can load this.
import { contourDistance, insideContour, PLANETARIUM_STEP, type ParkRiseSpec, type ParkSpec } from './park.ts';
import { hillHeight } from './terrain.ts';
import { createProjection, pathBounds, projectOntoPath, type TrackPath } from './track.ts';

/**
 * A PARK'S HILLS (`ParkSpec.relief`), as a relief the terrain can add to the city's own
 * (`terrain.ts`, `TerrainSpec.relief`). The park's land stops being a lot held level and rolls:
 * broad swells the roads climb over, and knolls on the lawns that die away before an asphalt
 * edge. What must stay level stays level, and it is the park that knows what that is:
 *
 *  - the water: a lake's bank is cut from y 0 (`LAKE`), and its surface is at an absolute
 *    height, so the ground is level for `shoreFlat` metres from every shore and island,
 *  - the planetarium's podium, drawn round one height,
 *  - every meeting place (the people in it stand at y 0) and every bench,
 *  - the footbridges' feet,
 *  - the land's edge: its wall and the city streets that run in through it.
 *
 * Each of those is a distance at which the rise is gone and a run over which it comes back, a
 * smoothstep between: the product of all of them is the MASK. Near a road the ground is blended
 * to the height of the road's centreline straight across — the swells under it, no knoll — so
 * a road is cut level into a hillside and the lawn's rises start past its pavement.
 *
 * COST. Everything above is measured once, on a grid over the land (`cell`), and the relief is a
 * bilinear read of it: the terrain asks for it for every body every tick. Outside the land it
 * is 0 without touching the grid.
 */
export const PARK_RELIEF = {
  /** Grid step (m). The knolls are tens of metres across, so a few metres keeps their shape. */
  cell: 4,
  /**
   * From the land's edge: level for this far (m), then the rise comes back over `edgeFade`. More
   * than a cell of the city's terrain floor and a cell of this grid, so the floor never draws an
   * off-level cell across the edge onto the lawn (`cityBuilder.ts`, `buildTerrainFloor`).
   */
  edgeFlat: 22,
  edgeFade: 45,
  /** From a shore or an island's edge. */
  shoreFlat: 9,
  shoreFade: 40,
  /** Past the planetarium's lower step. */
  podiumFlat: 8,
  podiumFade: 34,
  /** Past a meeting place's clear radius. */
  meetFlat: 4,
  meetFade: 22,
  /** Round a bench or a bin on its own: past the bench and a diagonal of the grid, which the bilinear read blends across. */
  benchFlat: 6,
  benchFade: 9,
  /** Round a footbridge's foot. */
  bridgeFlat: 6,
  bridgeFade: 20,
  /** From a road's edge: the road's own height straight across for this far (its pavement), the lawn's back over `roadFade`. */
  roadFlat: 7,
  roadFade: 20,
} as const;

function smoothstep(d: number, flat: number, fade: number): number {
  if (d <= flat) return 0;
  if (d >= flat + fade) return 1;
  const t = (d - flat) / fade;
  return t * t * (3 - 2 * t);
}

function sumRises(rises: readonly ParkRiseSpec[], x: number, z: number): number {
  let y = 0;
  for (const h of rises) y += hillHeight(h, x, z);
  return y;
}

/**
 * The relief of one park. `roads` are the ground roads the knolls keep off: the park's own and
 * the city streets that run into it (a road that never reaches the land is skipped).
 */
export function createParkRelief(park: ParkSpec, roads: readonly TrackPath[]): (x: number, z: number) => number {
  const relief = park.relief;
  if (!relief || (relief.swells.length === 0 && relief.knolls.length === 0)) return () => 0;
  const R = PARK_RELIEF;
  const land: Rect = park.land;
  const cell = R.cell;
  const nx = Math.ceil((land.maxX - land.minX) / cell) + 1;
  const nz = Math.ceil((land.maxZ - land.minZ) / cell) + 1;
  const height = new Float32Array(nx * nz);
  const proj = createProjection();
  const reach = R.roadFlat + R.roadFade;
  const near = roads.filter((p) => {
    const b = pathBounds(p);
    return b.maxX > land.minX - reach && b.minX < land.maxX + reach && b.maxZ > land.minZ - reach && b.minZ < land.maxZ + reach;
  });

  /** How much of the relief survives at a point: the product of every level place's fade. */
  const maskAt = (x: number, z: number): number => {
    const edge = Math.min(x - land.minX, land.maxX - x, z - land.minZ, land.maxZ - z);
    let mask = smoothstep(edge, R.edgeFlat, R.edgeFade);
    for (const lake of park.lakes) {
      if (mask <= 0) return 0;
      if (insideContour(lake.shore, x, z)) return 0;
      let d = contourDistance(lake.shore, x, z);
      for (const isl of lake.islands) d = Math.min(d, contourDistance(isl, x, z));
      mask *= smoothstep(d, R.shoreFlat, R.shoreFade);
    }
    const p = park.planetarium;
    if (p && mask > 0) mask *= smoothstep(Math.hypot(p.x - x, p.z - z) - p.radius * PLANETARIUM_STEP, R.podiumFlat, R.podiumFade);
    for (const e of park.encounters) {
      if (mask <= 0) return 0;
      mask *= smoothstep(Math.hypot(e.x - x, e.z - z) - e.clear, R.meetFlat, R.meetFade);
    }
    for (const f of park.furniture) {
      if (mask <= 0) return 0;
      mask *= smoothstep(Math.hypot(f.x - x, f.z - z), R.benchFlat, R.benchFade);
    }
    for (const f of park.footbridges) {
      if (mask <= 0) return 0;
      mask *= smoothstep(Math.min(Math.hypot(f.ax - x, f.az - z), Math.hypot(f.bx - x, f.bz - z)), R.bridgeFlat, R.bridgeFade);
    }
    return mask;
  };

  for (let j = 0; j < nz; j++) {
    const z = land.minZ + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = land.minX + i * cell;
      const swell = sumRises(relief.swells, x, z);
      const knoll = sumRises(relief.knolls, x, z);
      if (swell <= 0 && knoll <= 0) continue;
      const mask = maskAt(x, z);
      if (mask <= 0) continue;
      const here = (swell + knoll) * mask;

      // The nearest road's edge, and the ground at its centreline across from here.
      let d = Infinity;
      let cx = 0;
      let cz = 0;
      for (const path of near) {
        const b = pathBounds(path);
        const bx = Math.max(b.minX - x, 0, x - b.maxX);
        const bz = Math.max(b.minZ - z, 0, z - b.maxZ);
        // The box already reaches the asphalt's edge: a box further off than the best edge so far cannot beat it.
        if (Math.hypot(bx, bz) >= Math.min(d, reach)) continue;
        projectOntoPath(path, x, z, proj);
        const edge = proj.dist - proj.halfWidth;
        if (edge < d) {
          d = edge;
          cx = proj.x;
          cz = proj.z;
        }
      }
      if (d >= reach) {
        height[j * nx + i] = here;
        continue;
      }
      // By a road the ground is the road's own height straight across (the swell under its
      // centreline, no knoll), and the lawn's rises come back beyond the pavement: a road is cut
      // level into a hillside, never tilted by one.
      const road = sumRises(relief.swells, cx, cz) * maskAt(cx, cz);
      const t = smoothstep(d, R.roadFlat, R.roadFade);
      height[j * nx + i] = road + (here - road) * t;
    }
  }

  return (x, z) => {
    if (x <= land.minX || x >= land.maxX || z <= land.minZ || z >= land.maxZ) return 0;
    const fx = (x - land.minX) / cell;
    const fz = (z - land.minZ) / cell;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i > nx - 2) i = nx - 2;
    if (j > nz - 2) j = nz - 2;
    const u = fx - i;
    const v = fz - j;
    const k = j * nx + i;
    return (height[k] * (1 - u) + height[k + 1] * u) * (1 - v) + (height[k + nx] * (1 - u) + height[k + nx + 1] * u) * v;
  };
}
