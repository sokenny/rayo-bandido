import { BODY } from '../../config/tuning';
import { clamp } from '../../core/math';

/**
 * Chassis-on-springs model for a car body. Presentation only — it reads simulation
 * accelerations and produces two angles; nothing here feeds back into the simulation.
 *
 * MODEL
 *  - Lateral acceleration (the tyre force from `src/sim/vehicle.ts` step 6) sets a roll
 *    target; longitudinal acceleration sets a pitch target. Both are clamped, so a
 *    collision impulse produces a hard dive rather than a somersault.
 *  - Each axis is a damped spring chasing its target. The damping ratio is under 1, so the
 *    body overshoots slightly and settles back — that overshoot is what reads as mass.
 *  - Integration is semi-implicit Euler, sub-stepped at `BODY.maxStepDt`, so a hitching
 *    frame slows the spring down instead of blowing it up.
 *
 * SIGNS (in the car's local frame: nose toward -Z, right toward +X)
 *  - `roll` goes on `rotation.z`. A right-hand turn pushes the body toward +X, and the car
 *    leans onto its outer (left) side, which is a positive rotation about Z.
 *  - `pitch` goes on `rotation.x`. Braking is negative acceleration and drops the nose,
 *    which is a negative rotation about X; on power the nose lifts.
 */
export interface BodyAttitude {
  /** Lean about the forward axis (rad). Apply to `rotation.z`. */
  readonly roll: number;
  /** Dive / squat about the lateral axis (rad). Apply to `rotation.x`. */
  readonly pitch: number;
  /** Feed the accelerations the body is under this frame (m/s^2, car local frame). */
  setAccel(latAccel: number, longAccel: number): void;
  /** Advance the springs. `dt` is frame time, not the simulation step. */
  update(dt: number): void;
  /** Drop everything back to level, e.g. on respawn. */
  reset(): void;
}

export function createBodyAttitude(): BodyAttitude {
  let rollTarget = 0;
  let pitchTarget = 0;
  let roll = 0;
  let pitch = 0;
  let rollVel = 0;
  let pitchVel = 0;

  const rollStiffness = BODY.rollFrequency * BODY.rollFrequency;
  const rollFriction = 2 * BODY.rollDamping * BODY.rollFrequency;
  const pitchStiffness = BODY.pitchFrequency * BODY.pitchFrequency;
  const pitchFriction = 2 * BODY.pitchDamping * BODY.pitchFrequency;

  return {
    get roll() {
      return roll;
    },
    get pitch() {
      return pitch;
    },
    setAccel(latAccel, longAccel) {
      const lat = clamp(latAccel, -BODY.latAccelClamp, BODY.latAccelClamp);
      const long = clamp(longAccel, -BODY.longAccelClamp, BODY.longAccelClamp);
      rollTarget = clamp(lat * BODY.rollPerLatAccel, -BODY.rollLimit, BODY.rollLimit);
      pitchTarget = clamp(long * BODY.pitchPerLongAccel, -BODY.pitchLimit, BODY.pitchLimit);
    },
    update(dt) {
      if (!(dt > 0)) return;
      const steps = Math.min(8, Math.ceil(dt / BODY.maxStepDt));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        rollVel += (rollStiffness * (rollTarget - roll) - rollFriction * rollVel) * h;
        roll += rollVel * h;
        pitchVel += (pitchStiffness * (pitchTarget - pitch) - pitchFriction * pitchVel) * h;
        pitch += pitchVel * h;
      }
    },
    reset() {
      rollTarget = 0;
      pitchTarget = 0;
      roll = 0;
      pitch = 0;
      rollVel = 0;
      pitchVel = 0;
    },
  };
}
