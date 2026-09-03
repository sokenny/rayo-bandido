/**
 * Pure, allocation-light DSP helpers for the audio layer. No Web Audio, no DOM — just the
 * math that turns game state into oscillator frequencies, gains and stereo pans. Kept
 * separate so it can be unit tested without an AudioContext.
 */

import { clamp, clamp01, rightX, rightZ } from '../core/math';
import { NITRO, VEHICLE } from '../config/tuning';

/** Idle floor for the engine note (0..1), so a stopped engine still has a low rumble. */
export const IDLE_RPM01 = 0.18;

/**
 * Speed (m/s) that maps to a speed fraction of 1: flat out with nitro lit. Everything that
 * turns speed into a gearbox position divides by this, so they all agree on where redline is.
 */
export const REF_SPEED = VEHICLE.maxSpeed + NITRO.boostMaxSpeedBonus;

/**
 * Fake automatic gearbox. Maps a speed fraction (|speed| / maxSpeed, may exceed 1 under nitro)
 * to a normalized engine note position and the current gear index.
 *
 * Within each gear the note climbs from idle to redline; crossing a gear boundary drops it
 * back down, which is what makes acceleration read as a car working through its gears rather
 * than one endless rising whine.
 *
 * @param bounds Upper speed-fraction bound of each gear, ascending (e.g. AUDIO.gearBounds).
 */
export function engineTone(speedFrac: number, bounds: readonly number[]): { gear: number; rpm01: number } {
  const s = speedFrac < 0 ? 0 : speedFrac;
  let gear = bounds.length - 1;
  let lower = 0;
  for (let i = 0; i < bounds.length; i++) {
    if (s <= bounds[i]) {
      gear = i;
      break;
    }
    lower = bounds[i];
  }
  const upper = bounds[gear];
  const span = Math.max(1e-4, upper - lower);
  const within = clamp01((s - lower) / span);
  const rpm01 = IDLE_RPM01 + (1 - IDLE_RPM01) * within;
  return { gear, rpm01 };
}

/**
 * Slide intensity (0..1) for the tire scrub, mirroring the smoke emission in `render/fx/index.ts`
 * so the screech and the smoke rise and fall together. Below `MIN_SPEED` (a parked car) nothing
 * scrubs; a latched drift always scrubs at least `DRIFT_FLOOR`; otherwise it ramps with lateral
 * speed between `LATERAL_START` and `LATERAL_FULL`.
 */
export const SKID = {
  MIN_SPEED: 2.5,
  /** Lateral speed that counts as sliding even before a drift latches. */
  SLIDE_LATERAL: 4,
  LATERAL_START: 2.5,
  LATERAL_FULL: 10,
  DRIFT_FLOOR: 0.35,
} as const;

export function skidIntensity(lateralSpeed: number, speed: number, drifting: boolean): number {
  const lateral = Math.abs(lateralSpeed);
  const moving = Math.abs(speed) > SKID.MIN_SPEED;
  const sliding = moving && (drifting || lateral > SKID.SLIDE_LATERAL);
  if (!sliding) return 0;
  let i = clamp01((lateral - SKID.LATERAL_START) / (SKID.LATERAL_FULL - SKID.LATERAL_START));
  if (drifting && i < SKID.DRIFT_FLOOR) i = SKID.DRIFT_FLOOR;
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
