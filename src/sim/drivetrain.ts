import type { VehicleState } from '../core/types';
import { DRIVETRAIN, NITRO, VEHICLE } from '../config/tuning';
import { clamp01 } from '../core/math';

/**
 * Six-speed automatic with a real engine rpm. Runs inside `stepVehicle` once the body-frame
 * speed is known and before the slide is computed, so the wheelspin it reports is this tick's.
 *
 *  - `gear` follows road speed on the automatic (upshift at a gear's top, downshift with
 *    hysteresis) — and engine revs: rev it into the band with the rear spinning and it shifts
 *    up from under you (`autoUpshiftRpm`). On the manual box it moves only on the player's shifts;
 *    a downshift that puts the road above the gear's top is a money shift, and the limiter in
 *    `stepVehicle` drags the car down to it.
 *  - `rpm01` is road rpm (`speed / gearTop`, linear through zero) plus `spinRev`, the excess the
 *    throttle has revved above it. The excess rises at `revRiseRate` toward what the gear's
 *    torque allows (`spinAuthority`) and falls at `revFallRate` when the throttle lifts. That
 *    integrator is the throttle modulation: a binary key held is a climbing needle, a key
 *    tapped is a needle hovering, an analog trigger is a needle parked where the finger says.
 *  - `wheelspin` is the excess, normalised, gated by the torque band: the engine has to be in
 *    the band for the excess to actually spin the rear. The rear only spins with a reason
 *    (`demand`): never on a straight, so a launch is a plain automatic's. Braking never spins
 *    the wheels, the handbrake locks them, and reverse is geared like first.
 *
 * Allocation-free; mutates `v` in place.
 */

/** Speed (m/s) at the top of the last gear: flat out with nitro lit. */
export const REF_SPEED = VEHICLE.maxSpeed + NITRO.boostMaxSpeedBonus;
export const GEAR_COUNT = DRIVETRAIN.gearTops.length;

/** Road speed (m/s) at which `gear` reaches redline. */
export function gearTopSpeed(gear: number): number {
  return DRIVETRAIN.gearTops[gear] * REF_SPEED;
}

/** Engine rpm the road is turning the engine at in `gear` (0 idle .. 1 redline). */
export function roadRpm01(absSpeed: number, gear: number): number {
  return clamp01(absSpeed / gearTopSpeed(gear));
}

/** Automatic selection from the current gear: up at the top, down with hysteresis. */
export function autoGear(absSpeed: number, gear: number): number {
  let g = gear;
  while (g < GEAR_COUNT - 1 && absSpeed >= gearTopSpeed(g)) g++;
  while (g > 0 && absSpeed <= gearTopSpeed(g - 1) * DRIVETRAIN.downshiftRpm) g--;
  return g;
}

/** How much of the engine's torque is available at `rpm01` (0..1): nothing below the band. */
export function torqueGate(rpm01: number): number {
  const t = clamp01((rpm01 - (DRIVETRAIN.bandLow - DRIVETRAIN.bandRamp)) / DRIVETRAIN.bandRamp);
  return t * t * (3 - 2 * t);
}

/** How hard the engine is against the limiter (0..1): above `bandHigh`, full at redline. */
export function overRev(rpm01: number): number {
  const t = clamp01((rpm01 - DRIVETRAIN.bandHigh) / (1 - DRIVETRAIN.bandHigh));
  return t * t * (3 - 2 * t);
}

/** The most the engine can rev above road rpm in `gear` while sliding `slide` (rpm01). */
export function spinAuthority(gear: number, slide: number): number {
  return DRIVETRAIN.spinAuthority[gear] * (1 + DRIVETRAIN.slideSpinBonus * clamp01(slide));
}

/** Slowest road speed (m/s) at which the throttle can reach the torque band in `gear`. */
export function bandEntrySpeed(gear: number, slide = 0): number {
  const need = DRIVETRAIN.bandLow - spinAuthority(gear, slide);
  return need <= 0 ? 0 : need * gearTopSpeed(gear);
}

/**
 * Advance gear, rpm and wheelspin one tick. `absSpeed` is this tick's body-frame speed,
 * `forward` whether the car is moving forwards, `driving` the throttle with the handbrake
 * already accounted for (a locked rear cannot spin), `demand` how much reason the rear has to
 * spin (0 on a straight, 1 with the wheel turned at low speed, in a slide or in a held drift),
 * `manual` whether the player owns the gear and `shift` their request this tick (-1, 0, +1),
 * and `v.slide` last tick's slide.
 */
export function stepDrivetrain(
  v: VehicleState,
  driving: number,
  absSpeed: number,
  forward: boolean,
  demand: number,
  manual: boolean,
  shift: number,
  dt: number,
): void {
  const slide = v.slide;

  if (manual) {
    if (shift > 0 && v.gear < GEAR_COUNT - 1) v.gear++;
    else if (shift < 0 && v.gear > 0) v.gear--;
    v.shiftHold = 0;
  } else if (!forward) {
    v.gear = 0;
    v.shiftHold = 0;
  } else {
    // A real automatic reads engine revs: with the rear spinning it shifts up before the road
    // speed asks for it, then holds that gear for a moment rather than hunting back down.
    const road = roadRpm01(absSpeed, v.gear);
    const freeRevving = v.spinRev >= DRIVETRAIN.autoSpinShift && v.rpm01 >= DRIVETRAIN.autoUpshiftRpm;
    if (v.gear < GEAR_COUNT - 1 && freeRevving && road >= DRIVETRAIN.autoUpshiftMinRoad && road < 1) {
      v.gear++;
      v.shiftHold = DRIVETRAIN.autoShiftHold;
    }
    if (v.shiftHold > 0) {
      v.shiftHold = Math.max(0, v.shiftHold - dt);
      while (v.gear < GEAR_COUNT - 1 && absSpeed >= gearTopSpeed(v.gear)) v.gear++;
    } else {
      v.gear = autoGear(absSpeed, v.gear);
    }
  }
  // Reverse turns the engine through first's ratio whatever gear is selected.
  const engineGear = forward ? v.gear : 0;

  const road = roadRpm01(absSpeed, engineGear);
  // The excess can never take the engine past redline, whatever the gear allows.
  const target = Math.min(1 - road, clamp01(driving) * clamp01(demand) * spinAuthority(engineGear, slide));
  if (target > v.spinRev) v.spinRev = Math.min(target, v.spinRev + DRIVETRAIN.revRiseRate * dt);
  else v.spinRev = Math.max(target, v.spinRev - DRIVETRAIN.revFallRate * dt);

  v.rpm01 = Math.min(1, road + v.spinRev);
  v.wheelspin = clamp01(v.spinRev / DRIVETRAIN.spinFull) * torqueGate(v.rpm01);
  // Time against the limiter builds while pinned and unwinds twice as fast once lifted.
  if (overRev(v.rpm01) > 0.5) v.limiterTime = Math.min(DRIVETRAIN.overRevGrace, v.limiterTime + dt);
  else v.limiterTime = Math.max(0, v.limiterTime - 2 * dt);
}

/**
 * How hard a change from `fromGear` into `v.gear` shoves the body (signed, -1..1; positive is
 * an upshift). Presentation only — `src/render/scene/bodyAttitude.ts:kick` turns it into the
 * dip and lurch, and nothing in the simulation reads it.
 *
 * Two things set the size. The step in engine rpm the new ratio makes at this road speed is
 * the shift itself: the short low gears jolt, sixth barely registers, and a gear swapped at a
 * standstill (or the forced drop into first when the car starts rolling backwards) is nothing
 * at all. On top of that, how much throttle was interrupted — a shift off the power still
 * moves the body, just less than one taken flat out.
 */
export function shiftKickStrength(v: VehicleState, fromGear: number): number {
  if (fromGear === v.gear) return 0;
  const absSpeed = Math.abs(v.speed);
  const step = Math.abs(roadRpm01(absSpeed, v.gear) - roadRpm01(absSpeed, fromGear));
  const load = DRIVETRAIN.shiftKickIdle + (1 - DRIVETRAIN.shiftKickIdle) * clamp01(v.throttleApplied);
  const magnitude = clamp01((step / DRIVETRAIN.shiftKickFullStep) * load);
  return v.gear > fromGear ? magnitude : -magnitude;
}

/** Drive available at `rpm01` in `gear` (0..1): a tall gear lugs below `lugRpm`. */
export function lugFactor(rpm01: number, gear: number): number {
  if (gear === 0) return 1;
  const t = clamp01(rpm01 / DRIVETRAIN.lugRpm);
  return DRIVETRAIN.lugDrive + (1 - DRIVETRAIN.lugDrive) * t * t * (3 - 2 * t);
}

/** Limiter penalty strength this tick (0..1): how hard it is pinned, ramped by how long. */
export function limiterPenalty(v: VehicleState): number {
  return overRev(v.rpm01) * clamp01(v.limiterTime / DRIVETRAIN.overRevGrace);
}
