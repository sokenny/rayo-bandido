import { BODY } from '../../config/tuning';
import { clamp } from '../../core/math';

/**
 * Chassis-on-springs model for a car body. Presentation only — it reads simulation
 * accelerations and produces two angles and a small fore-aft offset; nothing here feeds back
 * into the simulation.
 *
 * MODEL
 *  - Lateral acceleration (the tyre force from `src/sim/vehicle.ts` step 6) sets a roll
 *    target; longitudinal acceleration sets a pitch target. Both are clamped, so a
 *    collision impulse produces a hard dive rather than a somersault.
 *  - Each axis is a damped spring chasing its target. The damping ratio is under 1, so the
 *    body overshoots slightly and settles back — that overshoot is what reads as mass.
 *  - A gear change is not an acceleration the springs can see (the whole torque interruption
 *    happens inside one tick), so `kick` injects it as a velocity impulse instead: the body
 *    dips and rebounds on its own. It runs on three springs of its own (pitch, roll, and a
 *    fore-aft `surge` with no target at all) rather than sharing the corner/brake ones, so
 *    tuning how a shift feels never touches how the car leans or dives.
 *  - Integration is semi-implicit Euler, sub-stepped at `BODY.maxStepDt`, so a hitching
 *    frame slows the spring down instead of blowing it up.
 *
 * SIGNS (in the car's local frame: nose toward -Z, right toward +X)
 *  - `roll` goes on `rotation.z`. A right-hand turn pushes the body toward +X, and the car
 *    leans onto its outer (left) side, which is a positive rotation about Z.
 *  - `pitch` goes on `rotation.x`. Braking is negative acceleration and drops the nose,
 *    which is a negative rotation about X; on power the nose lifts.
 *  - `surge` goes on `position.z`. The car decelerating leaves the body running forward,
 *    toward the nose, which is -Z.
 */
export interface BodyAttitude {
  /** Lean about the forward axis (rad). Apply to `rotation.z`. */
  readonly roll: number;
  /** Dive / squat about the lateral axis (rad). Apply to `rotation.x`. */
  readonly pitch: number;
  /** Fore-aft travel on the mounts (m, negative = forward). Apply to `position.z`. */
  readonly surge: number;
  /** Feed the accelerations the body is under this frame (m/s^2, car local frame). */
  setAccel(latAccel: number, longAccel: number): void;
  /**
   * Shove the body once, the way a gear change does. `strength` is 0..1 signed: positive for
   * an upshift (drive cuts, nose drops, body runs forward), negative for a downshift (the
   * lower gear grabs and shoves it back). Everything past the impulse is the springs.
   */
  kick(strength: number): void;
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
  let surge = 0;
  let rollVel = 0;
  let pitchVel = 0;
  let surgeVel = 0;
  // The shift's own pitch/roll, on their own springs — see the class comment.
  let pitchKick = 0;
  let pitchKickVel = 0;
  let rollKick = 0;
  let rollKickVel = 0;

  const rollStiffness = BODY.rollFrequency * BODY.rollFrequency;
  const rollFriction = 2 * BODY.rollDamping * BODY.rollFrequency;
  const pitchStiffness = BODY.pitchFrequency * BODY.pitchFrequency;
  const pitchFriction = 2 * BODY.pitchDamping * BODY.pitchFrequency;
  const surgeStiffness = BODY.surgeFrequency * BODY.surgeFrequency;
  const surgeFriction = 2 * BODY.surgeDamping * BODY.surgeFrequency;
  const shiftPitchStiffness = BODY.shiftPitchFrequency * BODY.shiftPitchFrequency;
  const shiftPitchFriction = 2 * BODY.shiftPitchDamping * BODY.shiftPitchFrequency;
  const shiftRollStiffness = BODY.shiftRollFrequency * BODY.shiftRollFrequency;
  const shiftRollFriction = 2 * BODY.shiftRollDamping * BODY.shiftRollFrequency;

  return {
    get roll() {
      return roll + rollKick;
    },
    get pitch() {
      return pitch + pitchKick;
    },
    get surge() {
      return surge;
    },
    setAccel(latAccel, longAccel) {
      const lat = clamp(latAccel, -BODY.latAccelClamp, BODY.latAccelClamp);
      const long = clamp(longAccel, -BODY.longAccelClamp, BODY.longAccelClamp);
      rollTarget = clamp(lat * BODY.rollPerLatAccel, -BODY.rollLimit, BODY.rollLimit);
      pitchTarget = clamp(long * BODY.pitchPerLongAccel, -BODY.pitchLimit, BODY.pitchLimit);
    },
    kick(strength) {
      const s = clamp(strength, -1, 1);
      // A downshift is the weaker of the two, and every axis flips with it.
      const scaled = s > 0 ? s : s * BODY.downshiftScale;
      // Nose down and body forward on an upshift: both negative in the car's frame.
      pitchKickVel -= scaled * BODY.shiftPitchImpulse;
      surgeVel -= scaled * BODY.shiftSurgeImpulse;
      // Torque reaction rocks the shell the same way whichever gear it lands in, so this one
      // keeps the sign of the shift's magnitude, not its direction.
      rollKickVel += Math.abs(scaled) * BODY.shiftRollImpulse;
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
        // Surge and the shift's pitch/roll have no target: they only ever move because a
        // shift kicked them, and their only job is to come home. The clamps keep a burst of
        // shifts from pushing the shell off the wheels.
        surgeVel += (-surgeStiffness * surge - surgeFriction * surgeVel) * h;
        surge = clamp(surge + surgeVel * h, -BODY.surgeLimit, BODY.surgeLimit);
        pitchKickVel += (-shiftPitchStiffness * pitchKick - shiftPitchFriction * pitchKickVel) * h;
        pitchKick = clamp(pitchKick + pitchKickVel * h, -BODY.pitchKickLimit, BODY.pitchKickLimit);
        rollKickVel += (-shiftRollStiffness * rollKick - shiftRollFriction * rollKickVel) * h;
        rollKick = clamp(rollKick + rollKickVel * h, -BODY.rollKickLimit, BODY.rollKickLimit);
      }
    },
    reset() {
      rollTarget = 0;
      pitchTarget = 0;
      roll = 0;
      pitch = 0;
      surge = 0;
      rollVel = 0;
      pitchVel = 0;
      surgeVel = 0;
      pitchKick = 0;
      pitchKickVel = 0;
      rollKick = 0;
      rollKickVel = 0;
    },
  };
}
