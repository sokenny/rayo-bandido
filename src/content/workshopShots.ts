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
  | 'headlightsClose'
  | 'rear34Low'
  | 'exhaustClose'
  | 'rear34High'
  | 'hoodHigh'
  | 'roofHigh'
  | 'sideLow'
  | 'neonLow'
  | 'wheelFront'
  | 'wheelFrontHead'
  | 'wheelRearTail'
  | 'plateRear'
  | 'interior';

/**
 * Tuned by agent D against the showroom (`src/render/workshop/`, captures from
 * `scripts/harness-shots-d.mjs`) after NFSU2's garage: the part being chosen fills the middle of
 * the frame, the rest of the car stays in it for context, and the workshop shows behind. The
 * camera also shifts the picture down and a little right (`WorkshopCamera.setFraming`) so the car
 * sits clear of the carousel on top and the rail on the left; these numbers assume that.
 */
export const CAMERA_SHOTS: Readonly<Record<CameraShotKey, CameraShot>> = {
  /** The whole car, three-quarter front, the table turning it slowly: paint, finish, vinyls, decals. */
  overview: { yaw: 0.72, pitch: 0.2, distance: 6.1, targetY: 0.62, targetZ: 0.1, fov: 40, orbitSpeed: 0.17 },
  /** Front bumper: three-quarter front, low and close, the nose filling the middle. */
  front34Low: { yaw: 0.62, pitch: 0.12, distance: 4.5, targetY: 0.5, targetZ: -1.0, fov: 40 },
  /** Head lights and their colour: low off the front corner, close on the lamp. */
  headlightsClose: { yaw: 0.42, pitch: 0.08, distance: 3.2, targetY: 0.6, targetZ: -1.55, fov: 40 },
  /** Rear bumper, tail lights: three-quarter rear, low. */
  rear34Low: { yaw: Math.PI - 0.62, pitch: 0.12, distance: 4.5, targetY: 0.52, targetZ: 1.0, fov: 40 },
  /** Exhaust tips and sound: low off the rear corner, on the tail pipes. */
  exhaustClose: { yaw: Math.PI - 0.5, pitch: 0.06, distance: 3.3, targetY: 0.4, targetZ: 1.6, fov: 40 },
  /** Trunk and spoiler: three-quarter rear, from above the deck. */
  rear34High: { yaw: Math.PI - 0.58, pitch: 0.34, distance: 4.8, targetY: 0.95, targetZ: 1.1, fov: 40 },
  /** Hood: three-quarter front from above, the bonnet in the middle. */
  hoodHigh: { yaw: 0.38, pitch: 0.46, distance: 4.4, targetY: 0.72, targetZ: -0.9, fov: 40 },
  /** Roof colour: high over the side, the roof filling the frame. */
  roofHigh: { yaw: 1.1, pitch: 0.42, distance: 6.0, targetY: 0.9, targetZ: 0.15, fov: 40 },
  /** Skirts, ride height: the right flank, low, the whole length in frame. */
  sideLow: { yaw: Math.PI / 2 + 0.08, pitch: 0.06, distance: 6.0, targetY: 0.5, targetZ: 0.05, fov: 40 },
  /** Neon: the flank from floor level, a little wider, so the light it throws on the table reads. */
  neonLow: { yaw: Math.PI / 2 + 0.3, pitch: 0.02, distance: 6.2, targetY: 0.42, targetZ: 0.2, fov: 42 },
  /** Rims, rim colour, size, width: the right flank at axle height, close on the front wheel. */
  wheelFront: { yaw: 1.3, pitch: 0.05, distance: 4.1, targetY: 0.42, targetZ: -0.85, fov: 40 },
  /**
   * Front camber and track: low off the front corner, on the right front wheel. Not head-on: the
   * wide body hides the wheels from straight ahead (only their outer few centimetres stand out of
   * the arches), so the lean and the track only read at about 50° round, where the tyre's face
   * is an ellipse whose tilt against the arch is the camber (checked in the live showroom at +6,
   * Ola 2).
   */
  wheelFrontHead: { yaw: 0.9, pitch: 0.03, distance: 3.2, targetY: 0.38, targetZ: -1.3, fov: 40 },
  /** Rear camber and track: the same, off the rear corner, on the right rear wheel. */
  wheelRearTail: { yaw: Math.PI - 0.9, pitch: 0.03, distance: 3.2, targetY: 0.38, targetZ: 1.3, fov: 40 },
  /** Plate: behind, low and close, the plate in the middle of the tail. */
  plateRear: { yaw: Math.PI, pitch: 0.1, distance: 2.0, targetY: 0.55, targetZ: 2.0, fov: 34 },
  /** Cabin light: over the bonnet, looking in through the windscreen. */
  interior: { yaw: 0.14, pitch: 0.36, distance: 2.3, targetY: 0.92, targetZ: -0.15, fov: 46 },
};
