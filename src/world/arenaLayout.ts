import type { ArenaLayout, ObstacleBox } from '../core/types';

/**
 * Arena layout data. Pure data, no Three.js. Consumed by the simulation (collision, spawns)
 * and by `src/render/scene/environment.ts`, which builds every visual from the same rectangles
 * so collision and art can never disagree.
 *
 * THE ARENA (240 x 240 m overall, 200 x 200 m drivable core)
 *
 *   Z-                       north street (urban)
 *        +---------------------------------------------------+
 *        |  [nw-a]     [nw-b] |  |  [ne-b]      [ne-a]        |
 *   HW   |                    |  |                            |  east
 *  west  |--------------- P L A Z A  50x50 -------------------|  avenue
 *  corp  |                    |  |                            |
 *        |  [sw-a]     [sw-b] |  |  [se-b] [se-a1]|[se-a2]    |
 *        +---------------------------------------------------+
 *   Z+                       south street (jdm)
 *
 * Conventions
 * - y = 0 is the road surface; everything here is a footprint on the XZ plane.
 * - Every collider is an axis-aligned box. Roads, the plaza and the JDM alley are the ONLY
 *   places without colliders, so "drivable" is exactly "not covered by a collider".
 * - Block colliders cover the whole city block including its sidewalk ledge; the renderer
 *   insets the visible sidewalk and buildings inside the collider so the car never clips in.
 * - Clutter props (containers, pipes, AC units, signs) are placed *inside* a block or wall
 *   footprint, so they never need a collider of their own.
 */

export type ZoneId = 'corporate' | 'urban' | 'jdm';

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoadRect extends Rect {
  tag: string;
  /** 'z' runs north-south, 'x' runs east-west, 'open' is the plaza (no lane markings). */
  axis: 'x' | 'z' | 'open';
  /** Number of painted lanes; 0 for the plaza and the alley. */
  lanes: number;
  zone: ZoneId;
}

export interface BlockRect extends Rect {
  tag: string;
  zone: ZoneId;
  /** Rough height band for the renderer: 1 = low industrial, 2 = mid-rise, 3 = tower. */
  massing: 1 | 2 | 3;
}

const HALF = 120;
/** Outer edge of the road ring. Everything beyond is wall band + skyline. */
const RING = 100;

/** Drivable surfaces. Never covered by a collider. */
export const ARENA_ROADS: readonly RoadRect[] = [
  // Corporate highway: the long west straight the player spawns on. 20 m wide.
  { tag: 'hw-west', minX: -100, maxX: -80, minZ: -RING, maxZ: RING, axis: 'z', lanes: 4, zone: 'corporate' },
  // East avenue, 20 m wide, urban in the north half and JDM in the south half.
  { tag: 'av-east', minX: 80, maxX: 100, minZ: -RING, maxZ: RING, axis: 'z', lanes: 4, zone: 'urban' },
  // North street, 18 m.
  { tag: 'st-north', minX: -RING, maxX: RING, minZ: -100, maxZ: -82, axis: 'x', lanes: 4, zone: 'urban' },
  // South street, 18 m, the JDM run.
  { tag: 'st-south', minX: -RING, maxX: RING, minZ: 82, maxZ: 100, axis: 'x', lanes: 4, zone: 'jdm' },
  // Central cross, 18 m each, meeting in the plaza.
  { tag: 'cross-ew', minX: -RING, maxX: RING, minZ: -9, maxZ: 9, axis: 'x', lanes: 4, zone: 'urban' },
  { tag: 'cross-ns', minX: -9, maxX: 9, minZ: -RING, maxZ: RING, axis: 'z', lanes: 4, zone: 'urban' },
  // The drift plaza: 50 x 50 m of open asphalt over the central intersection.
  { tag: 'plaza', minX: -25, maxX: 25, minZ: -25, maxZ: 25, axis: 'open', lanes: 0, zone: 'urban' },
  // JDM service alley: 10 m wide shortcut between the central cross and the south street.
  { tag: 'alley-jdm', minX: 50, maxX: 60, minZ: 9, maxZ: 82, axis: 'z', lanes: 0, zone: 'jdm' },
];

/** City blocks. Each one is exactly one collider. */
export const ARENA_BLOCKS: readonly BlockRect[] = [
  // North-west: corporate slabs facing the highway.
  { tag: 'blk-nw-a', minX: -75, maxX: -31, minZ: -77, maxZ: -14, zone: 'corporate', massing: 3 },
  { tag: 'blk-nw-b', minX: -31, maxX: -14, minZ: -77, maxZ: -31, zone: 'urban', massing: 2 },
  // North-east: dense urban mid-rise.
  { tag: 'blk-ne-b', minX: 14, maxX: 31, minZ: -77, maxZ: -31, zone: 'urban', massing: 2 },
  { tag: 'blk-ne-a', minX: 31, maxX: 75, minZ: -77, maxZ: -14, zone: 'urban', massing: 2 },
  // South-west: corporate tower + urban infill.
  { tag: 'blk-sw-a', minX: -75, maxX: -31, minZ: 14, maxZ: 77, zone: 'corporate', massing: 3 },
  { tag: 'blk-sw-b', minX: -31, maxX: -14, minZ: 31, maxZ: 77, zone: 'jdm', massing: 1 },
  // South-east: the JDM garage district, split by the alley.
  { tag: 'blk-se-b', minX: 14, maxX: 31, minZ: 31, maxZ: 77, zone: 'jdm', massing: 1 },
  { tag: 'blk-se-a1', minX: 31, maxX: 50, minZ: 14, maxZ: 77, zone: 'jdm', massing: 1 },
  { tag: 'blk-se-a2', minX: 60, maxX: 75, minZ: 14, maxZ: 77, zone: 'jdm', massing: 1 },
];

/** Perimeter band: a 12 m thick frame just outside the ring road. */
export const ARENA_WALLS: readonly (Rect & { tag: string })[] = [
  { tag: 'wall-n', minX: -112, maxX: 112, minZ: -112, maxZ: -RING },
  { tag: 'wall-s', minX: -112, maxX: 112, minZ: RING, maxZ: 112 },
  { tag: 'wall-w', minX: -112, maxX: -RING, minZ: -RING, maxZ: RING },
  { tag: 'wall-e', minX: RING, maxX: 112, minZ: -RING, maxZ: RING },
];

/**
 * Free-standing barrier runs on the highway shoulder (the only clutter that is not already
 * inside a block or wall footprint, so it carries its own collider).
 */
export const ARENA_BARRIERS: readonly (Rect & { tag: string; zone: ZoneId })[] = [
  { tag: 'bar-hw-n', minX: -80, maxX: -77.5, minZ: -80, maxZ: -12, zone: 'corporate' },
  { tag: 'bar-hw-s', minX: -80, maxX: -77.5, minZ: 12, maxZ: 80, zone: 'corporate' },
  { tag: 'bar-av-n', minX: 77.5, maxX: 80, minZ: -80, maxZ: -12, zone: 'urban' },
  { tag: 'bar-av-s', minX: 77.5, maxX: 80, minZ: 12, maxZ: 80, zone: 'jdm' },
];

/** Patrol loops. Every leg runs along a road centreline. */
const PATROLS: Array<Array<{ x: number; z: number }>> = [
  // 0 - around the north-west block (highway -> north street -> central cross).
  [
    { x: 0, z: -40 },
    { x: 0, z: -91 },
    { x: -90, z: -91 },
    { x: -90, z: 0 },
    { x: 0, z: 0 },
  ],
  // 1 - around the north-east block.
  [
    { x: 40, z: -91 },
    { x: 90, z: -91 },
    { x: 90, z: 0 },
    { x: 0, z: 0 },
    { x: 0, z: -91 },
  ],
  // 2 - around the south-west block.
  [
    { x: -90, z: 40 },
    { x: -90, z: 91 },
    { x: 0, z: 91 },
    { x: 0, z: 0 },
    { x: -90, z: 0 },
  ],
  // 3 - around the south-east (JDM) block.
  [
    { x: 40, z: 91 },
    { x: 0, z: 91 },
    { x: 0, z: 0 },
    { x: 90, z: 0 },
    { x: 90, z: 91 },
  ],
  // 4 - the full outer ring.
  [
    { x: 90, z: -40 },
    { x: 90, z: -91 },
    { x: -90, z: -91 },
    { x: -90, z: 91 },
    { x: 90, z: 91 },
  ],
  // 5 - a slow square inside the drift plaza.
  [
    { x: -16, z: -16 },
    { x: 16, z: -16 },
    { x: 16, z: 16 },
    { x: -16, z: 16 },
  ],
];

/** Headings point along the first patrol leg. heading 0 faces -Z, PI/2 faces +X. */
const SPAWN_HEADINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0, Math.PI / 2];

export function createArenaLayout(): ArenaLayout {
  const colliders: ObstacleBox[] = [];
  for (const w of ARENA_WALLS) colliders.push({ minX: w.minX, maxX: w.maxX, minZ: w.minZ, maxZ: w.maxZ, tag: w.tag });
  for (const b of ARENA_BLOCKS) colliders.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, tag: b.tag });
  for (const b of ARENA_BARRIERS) colliders.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, tag: b.tag });

  const targetSpawns = PATROLS.map((loop, i) => ({ x: loop[0].x, z: loop[0].z, heading: SPAWN_HEADINGS[i] }));

  return {
    bounds: { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF },
    // On the corporate highway, facing 190 m of clean straight to the north.
    playerSpawn: { x: -90, z: 95, heading: 0 },
    targetSpawns,
    targetPatrols: PATROLS.map((loop) => loop.map((p) => ({ x: p.x, z: p.z }))),
    colliders,
  };
}
