import type { WorkshopBounds } from './workshopCamera';

/**
 * The showroom's dimensions, on their own so the camera tests can read them without building
 * the room. World metres; the turntable at the origin, the car's nose toward -Z at rest.
 */
export const ROOM = { minX: -10, maxX: 10, minZ: -10.5, maxZ: 10.5, height: 5.2 } as const;

/** The turntable: plate radius, its top's height (the car stands here), and the bevel's foot. */
export const TABLE = { radius: 3.3, top: 0.14, foot: 3.62 } as const;

/**
 * Where the lens may go: 0.7 m off the walls, above the floor, and under the hanging work lamps
 * (their shades bottom out at 3.7–4 m).
 */
export const CAMERA_BOUNDS: Readonly<WorkshopBounds> = {
  minX: ROOM.minX + 0.7,
  maxX: ROOM.maxX - 0.7,
  minZ: ROOM.minZ + 0.7,
  maxZ: ROOM.maxZ - 0.7,
  minY: 0.22,
  maxY: 3.55,
};
