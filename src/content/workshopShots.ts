/**
 * WHERE THE SHOWROOM CAMERA GOES for each workshop category (`docs/GARAGE_PLAN.md` §2.5).
 *
 * Data only. `src/render/workshop/workshopCamera.ts` (agent D) eases between these; each
 * `CategoryDef.cameraShot` in `carParts.ts` names one. Its own file so agent D can tune the
 * numbers without editing the catalogue other agents are writing in.
 *
 * THE FRAME. Spherical coordinates around a target on the car's centreline, in the car's own
 * frame (`CarVisual` contract: nose toward local -Z, +X the car's right, y = 0 the floor):
 *
 *   target   = (0, targetY, targetZ)
 *   camera   = target + distance * (sin(yaw)·cos(pitch), sin(pitch), -cos(yaw)·cos(pitch))
 *
 * so `yaw` 0 stands in front of the nose looking back at it, +π/2 off the car's right flank,
 * π behind the tail; `pitch` 0 is level with the target and positive looks down on it. Angles
 * in radians, lengths in metres, `fov` vertical in degrees. The car's wheel centres are at
 * (±0.8, 0.33, ∓1.3), its plate at (0, 0.53, 2.145), its roof at y ≈ 1.31.
 *
 * `orbitSpeed` (rad/s), when set, turns the yaw slowly and continuously while the shot is held
 * (the paint shots: "3/4 general con órbita lenta continua").
 */
export interface CameraShot {
  yaw: number;
  pitch: number;
  distance: number;
  targetY: number;
  targetZ: number;
  fov: number;
  orbitSpeed?: number;
}

export type CameraShotKey =
  | 'overview'
  | 'front34Low'
  | 'rear34Low'
  | 'rear34High'
  | 'hoodHigh'
  | 'roofHigh'
  | 'sideLow'
  | 'wheelFront'
  | 'wheelFrontHead'
  | 'wheelRearTail'
  | 'plateRear'
  | 'interior';

/** Initial values from the plan's table. Agent D tunes them against the real showroom. */
export const CAMERA_SHOTS: Readonly<Record<CameraShotKey, CameraShot>> = {
  /** The whole car, three-quarter front, turning slowly: paint, finish, vinyls, decals. */
  overview: { yaw: 0.8, pitch: 0.26, distance: 7.2, targetY: 0.6, targetZ: 0, fov: 42, orbitSpeed: 0.18 },
  /** Front bumper, head lights: three-quarter front, low and close. */
  front34Low: { yaw: 0.7, pitch: 0.1, distance: 4.4, targetY: 0.45, targetZ: -1.5, fov: 42 },
  /** Rear bumper, tail lights, exhaust: three-quarter rear, low. */
  rear34Low: { yaw: Math.PI - 0.7, pitch: 0.1, distance: 4.4, targetY: 0.45, targetZ: 1.5, fov: 42 },
  /** Trunk and spoiler: three-quarter rear, from above the deck. */
  rear34High: { yaw: Math.PI - 0.55, pitch: 0.48, distance: 5.0, targetY: 0.95, targetZ: 1.4, fov: 42 },
  /** Hood: from the front, looking down on it. */
  hoodHigh: { yaw: 0.3, pitch: 0.72, distance: 4.3, targetY: 0.75, targetZ: -1.3, fov: 42 },
  /** Roof colour: high over the side, the roof filling the frame. */
  roofHigh: { yaw: 1.2, pitch: 0.9, distance: 5.2, targetY: 1.1, targetZ: 0.3, fov: 42 },
  /** Skirts, ride height, neon: the right flank, low, the whole length in frame. */
  sideLow: { yaw: Math.PI / 2, pitch: 0.05, distance: 5.8, targetY: 0.35, targetZ: 0, fov: 42 },
  /** Rims, rim colour, size, width: close on the front-right wheel at axle height. */
  wheelFront: { yaw: 1.25, pitch: 0.04, distance: 2.4, targetY: 0.33, targetZ: -1.3, fov: 40 },
  /** Front camber and track: head-on and low, both front wheels' lean in view. */
  wheelFrontHead: { yaw: 0, pitch: 0.03, distance: 3.6, targetY: 0.35, targetZ: -1.3, fov: 40 },
  /** Rear camber and track: from behind, low. */
  wheelRearTail: { yaw: Math.PI, pitch: 0.03, distance: 3.6, targetY: 0.35, targetZ: 1.3, fov: 40 },
  /** Plate: dead behind and very close. */
  plateRear: { yaw: Math.PI, pitch: 0.06, distance: 1.8, targetY: 0.53, targetZ: 2.1, fov: 36 },
  /** Cabin light: through the windscreen. */
  interior: { yaw: 0.12, pitch: 0.32, distance: 2.4, targetY: 1.0, targetZ: -0.2, fov: 48 },
};
