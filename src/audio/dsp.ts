/**
 * Pure, allocation-light DSP helpers for the audio layer. No Web Audio, no DOM — just the
 * math that turns game state into oscillator frequencies, gains and stereo pans. Kept
 * separate so it can be unit tested without an AudioContext.
 */

import { clamp, clamp01, rightX, rightZ } from '../core/math';
import { REF_SPEED } from '../sim/drivetrain';

/** Idle floor for the engine note (0..1), so a stopped engine still has a low rumble. */
export const IDLE_RPM01 = 0.18;

/**
 * Speed (m/s) that maps to a speed fraction of 1: flat out with nitro lit. The drivetrain owns
 * it (the top of the last gear); re-exported so the audio layer keeps one name for it.
 */
export { REF_SPEED };

/** Simulation rpm (0 idle .. 1 redline) -> engine note position with the idle floor under it. */
export function engineNote(rpm01: number): number {
  return IDLE_RPM01 + (1 - IDLE_RPM01) * clamp01(rpm01);
}

/**
 * Slide intensity (0..1) for the tire scrub, mirroring the smoke emission in `render/fx/index.ts`
 * so the screech and the smoke rise and fall together. Below `MIN_SPEED` of *ground* speed (a
 * parked car) nothing scrubs sideways; a latched drift always scrubs at least `DRIFT_FLOOR`;
 * otherwise it ramps with slide speed between `LATERAL_START` and `LATERAL_FULL`. Spinning rear
 * wheels scrub at any speed — a burnout at a standstill — scaled by `SPIN_GAIN`.
 *
 * Ground speed, not forward speed, decides "moving": halfway through a 180 the car travels fully
 * sideways with ~0 forward speed, and gating on forward speed cut the screech mid-spin. The slide
 * speed is also at least the yaw scrub at the axles (`|yawRate| * YAW_ARM`), so a car rotating
 * through the moment its velocity lines up with the body keeps howling instead of blinking out.
 */
export const SKID = {
  MIN_SPEED: 2.5,
  /** Distance (m) from the car's centre to an axle: half the wheelbase. */
  YAW_ARM: 1.3,
  /** Lateral speed that counts as sliding even before a drift latches. */
  SLIDE_LATERAL: 4,
  LATERAL_START: 2.5,
  LATERAL_FULL: 10,
  DRIFT_FLOOR: 0.35,
  /** Wheelspin below which the rear is not audibly spinning. */
  SPIN_START: 0.3,
  /** Scrub intensity of fully spinning rears with no sideways motion. */
  SPIN_GAIN: 0.6,
} as const;

export function skidIntensity(lateralSpeed: number, speed: number, drifting: boolean, wheelspin = 0, yawRate = 0): number {
  const lateral = Math.max(Math.abs(lateralSpeed), Math.abs(yawRate) * SKID.YAW_ARM);
  const moving = Math.hypot(speed, lateralSpeed) > SKID.MIN_SPEED;
  const sliding = moving && (drifting || lateral > SKID.SLIDE_LATERAL);
  let i = 0;
  if (sliding) {
    i = clamp01((lateral - SKID.LATERAL_START) / (SKID.LATERAL_FULL - SKID.LATERAL_START));
    if (drifting && i < SKID.DRIFT_FLOOR) i = SKID.DRIFT_FLOOR;
  }
  if (wheelspin > SKID.SPIN_START) {
    const spin = clamp01((wheelspin - SKID.SPIN_START) / (1 - SKID.SPIN_START)) * SKID.SPIN_GAIN;
    if (spin > i) i = spin;
  }
  return i;
}

/** How the tire screech's level follows the slip angle (see `screechIntensity`). */
export const SCREECH = {
  /** Slip angle (degrees) below which the tires are silent: a car barely crabbing does not squeal. */
  ANGLE_START: 5,
  /** Slip angle (degrees) of a full-voiced slide. */
  ANGLE_FULL: 35,
  /** Sideways speed (m/s) over which the screech fades in, so a slow car at an angle stays quiet. */
  LATERAL_FULL: 3,
  /** Screech of fully spinning rears with no sideways motion (a burnout). */
  SPIN_GAIN: 0.5,
} as const;

/**
 * Slide intensity (0..1) for the tire screech. Unlike `skidIntensity` (which drives the smoke and
 * holds a latched drift at `DRIFT_FLOOR`), this is the slip angle itself — the angle between the
 * body and where it is going, as `vehicle.ts` computes `slipAngle` — ramped from `ANGLE_START` to
 * `ANGLE_FULL`. A drift that is barely crossed up is next to silent and the squeal grows with the
 * angle, so how loud the tires are says how sideways the car is.
 */
export function screechIntensity(lateralSpeed: number, speed: number, wheelspin = 0): number {
  const lateral = Math.abs(lateralSpeed);
  let i = 0;
  if (Math.hypot(speed, lateralSpeed) > SKID.MIN_SPEED) {
    const deg = (Math.atan2(lateral, Math.abs(speed)) * 180) / Math.PI;
    i = clamp01((deg - SCREECH.ANGLE_START) / (SCREECH.ANGLE_FULL - SCREECH.ANGLE_START)) * clamp01(lateral / SCREECH.LATERAL_FULL);
  }
  if (wheelspin > SKID.SPIN_START) {
    const spin = clamp01((wheelspin - SKID.SPIN_START) / (1 - SKID.SPIN_START)) * SCREECH.SPIN_GAIN;
    if (spin > i) i = spin;
  }
  return i;
}

/**
 * Fundamental (Hz) of the tire squeal for a given slide intensity and speed fraction.
 *
 * Squeal is a stick-slip oscillation: the tread grabs, stretches, releases, and repeats. It runs
 * faster as the rubber is worked harder, so the pitch climbs with both slide angle and road
 * speed — but speed only counts when the tire is actually sliding, which is why it is multiplied
 * by intensity rather than added. The range is kept inside roughly 700-1500 Hz, where real tire
 * squeal lives; going higher reads as a whistle rather than rubber.
 */
export function squealHz(intensity: number, speedFrac: number): number {
  const i = clamp01(intensity);
  return 700 + 520 * i + 300 * clamp01(speedFrac) * i;
}

/**
 * Squared distance falloff for a point source. Full gain within `near`, silent past `far`,
 * with a smooth (quadratic) rolloff between — quieter and more natural than a straight line.
 */
export function distanceGain(dist: number, near: number, far: number): number {
  if (dist <= near) return 1;
  if (dist >= far) return 0;
  const t = (dist - near) / (far - near);
  const k = 1 - t;
  return k * k;
}

/**
 * Stereo pan (-maxPan..maxPan) for a world-space source relative to a listener facing
 * `heading`. Positive = to the listener's right. Returns 0 when the source is on top of the
 * listener (no meaningful direction).
 */
export function stereoPan(dx: number, dz: number, heading: number, maxPan: number): number {
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 1e-3) return 0;
  const right = (dx * rightX(heading) + dz * rightZ(heading)) / dist;
  return clamp(right, -1, 1) * maxPan;
}
