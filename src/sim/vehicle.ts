import type { PlayerCommand, VehicleState } from '../core/types';
import { NITRO, VEHICLE } from '../config/tuning';
import { clamp, clamp01, damp, forwardX, forwardZ, lerp, rightX, rightZ, wrapAngle } from '../core/math';

/**
 * Arcade vehicle controller on a planar world (no wheel simulation).
 *
 * MODEL (all constants live in `src/config/tuning.ts`, VEHICLE section)
 *  1. World velocity is decomposed into the body frame every tick, so collision impulses
 *     applied by `src/sim/collision.ts` after the previous tick are respected.
 *  2. Longitudinal: engine force with a speed falloff curve, strong brakes that turn into
 *     reverse near standstill, drag + rolling resistance + engine braking + drift scrub.
 *  3. Steering angle tightens with speed and reacts within a couple of frames.
 *  4. Yaw = grip-limited bicycle yaw (+ handbrake kick) + a self-aligning term that rotates
 *     the nose back toward the velocity direction. The self-aligning term is what keeps
 *     slides stable instead of spinning: bigger slip angle => stronger counter-rotation.
 *  5. Lateral: rotating the body injects lateral velocity (`-speed * yaw * dt`, i.e. the
 *     velocity vector keeps its world direction), and lateral grip bleeds it off. High grip
 *     => the car follows its nose. Low grip => it slides. `slide` (0..1) blends between them
 *     and is driven by slip angle, handbrake and power-oversteer, so drifting is easy to
 *     start, easy to hold with throttle + steering, and regrips when inputs are released.
 *
 * Mutates `v` in place, allocation-free.
 */
export function stepVehicle(v: VehicleState, cmd: PlayerCommand, nitroActive: boolean, dt: number): void {
  v.prevX = v.x;
  v.prevZ = v.z;
  v.prevHeading = v.heading;
  v.collided = false;
  v.collisionImpact = 0;

  // --- 1. Body-frame velocity (re-derived so collision impulses are honoured). ---------
  const fx0 = forwardX(v.heading);
  const fz0 = forwardZ(v.heading);
  const rx0 = rightX(v.heading);
  const rz0 = rightZ(v.heading);
  let speed = v.vx * fx0 + v.vz * fz0;
  let lateral = v.vx * rx0 + v.vz * rz0;

  let absSpeed = speed < 0 ? -speed : speed;
  const moving = absSpeed > VEHICLE.movingThreshold;
  const slip = moving ? Math.atan2(lateral, absSpeed) : 0;
  const slipMag = slip < 0 ? -slip : slip;

  const throttle = clamp01(cmd.throttle);
  const brake = clamp01(cmd.brake);
  const steerInput = clamp(cmd.steer, -1, 1);
  const steerMag = steerInput < 0 ? -steerInput : steerInput;

  // --- 2. Steering angle: quick response, tightens with speed. -------------------------
  const speedT = clamp01(absSpeed / VEHICLE.maxSpeed);
  const steerLimit = lerp(
    VEHICLE.maxSteerAngle,
    VEHICLE.maxSteerAngleHighSpeed,
    Math.pow(speedT, VEHICLE.steerSpeedCurve),
  );
  const targetSteer = steerInput * steerLimit;
  const returning = Math.abs(targetSteer) < Math.abs(v.steerAngle) && targetSteer * v.steerAngle >= 0;
  v.steerAngle = damp(v.steerAngle, targetSteer, returning ? VEHICLE.steerReturnRate : VEHICLE.steerRate, dt);

  // --- 3. How much the car is sliding this tick (0 = full grip, 1 = full drift). -------
  const forwardMotion = speed > VEHICLE.movingThreshold;
  const handbrakeSlide = cmd.handbrake && forwardMotion && absSpeed > VEHICLE.handbrakeMinSpeed;
  let slide = 0;
  if (forwardMotion) {
    // Already sliding: stay loose while the player asks for it (throttle or steering).
    const hold = throttle > steerMag ? throttle : steerMag;
    slide =
      smoothstep(VEHICLE.slideSlipStart, VEHICLE.slideSlipFull, slipMag) *
      lerp(VEHICLE.slideReleaseFloor, 1, hold);

    // Power oversteer: hard steering + throttle above `powerSlideSpeed` breaks traction.
    const powerSpeed = clamp01((absSpeed - VEHICLE.powerSlideSpeed) / VEHICLE.powerSlideSpeedRamp);
    const power =
      throttle * powerSpeed * smoothstep(VEHICLE.powerSlideSteer, 1, steerMag) * VEHICLE.powerSlideGain;
    if (power > slide) slide = power;

    // Counter-steering (steering out of the slide) recovers grip faster.
    if (slipMag > VEHICLE.slideSlipStart) {
      const counter = clamp01((slip < 0 ? -1 : 1) * steerInput);
      slide *= lerp(1, VEHICLE.counterSteerGrip, counter);
    }

    if (handbrakeSlide) slide = 1;
    slide = clamp01(slide);
  }

  const grip = lerp(VEHICLE.gripLateral, VEHICLE.gripLateralDrift, slide);
  const latCap = lerp(VEHICLE.maxLatAccel, VEHICLE.maxLatAccelDrift, slide);

  // --- 4. Longitudinal. -----------------------------------------------------------------
  const maxForward = VEHICLE.maxSpeed + (nitroActive ? NITRO.boostMaxSpeedBonus : 0);
  const fwdSpeed = speed > 0 ? speed : 0;

  if (throttle > 0) {
    const ratio = clamp01(fwdSpeed / (VEHICLE.maxSpeed * VEHICLE.powerCurveRef));
    let drive = throttle * VEHICLE.engineAccel * (1 - ratio * ratio);
    if (nitroActive) {
      const boostRatio = clamp01(fwdSpeed / (maxForward * VEHICLE.powerCurveRef));
      const ramp = clamp01(absSpeed / VEHICLE.nitroRampSpeed);
      drive += NITRO.boostAccel * ramp * (1 - boostRatio * boostRatio);
    }
    // Wheels that are already sliding put down less power.
    speed += drive * lerp(1, VEHICLE.driftThrottleScale, slide) * dt;
  } else if (nitroActive) {
    // Boost without throttle still gives a small shove so the button always feels alive.
    const boostRatio = clamp01(fwdSpeed / (maxForward * VEHICLE.powerCurveRef));
    const ramp = clamp01(absSpeed / VEHICLE.nitroRampSpeed);
    speed += NITRO.boostAccel * VEHICLE.nitroIdleThrottle * ramp * (1 - boostRatio * boostRatio) * dt;
  }

  if (brake > 0) {
    if (speed > VEHICLE.brakeToReverseSpeed) {
      speed -= VEHICLE.brakeDecel * brake * dt;
      if (speed < 0) speed = 0; // stop first, then a held brake engages reverse next tick
    } else if (speed > -VEHICLE.maxReverseSpeed) {
      speed -= VEHICLE.reverseAccel * brake * dt;
    }
  }

  if (cmd.handbrake) {
    const hb = VEHICLE.handbrakeDecel * dt;
    speed = speed > 0 ? Math.max(0, speed - hb) : Math.min(0, speed + hb);
  }

  absSpeed = speed < 0 ? -speed : speed;
  const coasting = throttle <= 0.01 && brake <= 0.01;
  const resist =
    VEHICLE.rollingDrag * absSpeed +
    VEHICLE.airDrag * absSpeed * absSpeed +
    VEHICLE.rollingResistance +
    (coasting ? VEHICLE.engineBrake : 0) +
    VEHICLE.driftDrag * slide * (lateral < 0 ? -lateral : lateral);
  const resistDv = Math.min(absSpeed, resist * dt);
  speed -= speed > 0 ? resistDv : -resistDv;
  speed = clamp(speed, -VEHICLE.maxReverseSpeed, maxForward);
  absSpeed = speed < 0 ? -speed : speed;

  // --- 5. Yaw. --------------------------------------------------------------------------
  // Bicycle yaw, limited by how much lateral acceleration the tyres can produce. Drifting
  // raises that budget (`driftYawGain`) so the nose can out-rotate the velocity.
  const kinematicYaw = (speed / VEHICLE.wheelbase) * Math.tan(v.steerAngle);
  const yawBudget = VEHICLE.maxLatAccel * lerp(1, VEHICLE.driftYawGain, slide);
  const yawLimit = yawBudget / Math.max(absSpeed, VEHICLE.yawLimitMinSpeed);
  let yaw = clamp(kinematicYaw, -yawLimit, yawLimit);

  // Handbrake kick: snaps the rear out, then fades as the slide establishes itself.
  if (handbrakeSlide) {
    const fade = 1 - smoothstep(VEHICLE.handbrakeKickFadeStart, VEHICLE.handbrakeKickFadeEnd, slipMag);
    const ramp = clamp01((absSpeed - VEHICLE.handbrakeMinSpeed) / VEHICLE.handbrakeKickRamp);
    yaw += VEHICLE.handbrakeYawKick * steerInput * fade * ramp;
  }

  // Self-aligning torque: rotates the nose toward the velocity direction. Weak while
  // drifting (so slides can be held), strong while gripping, and it ramps up hard past
  // `spinGuardSlip` so only a really abusive input can spin the car.
  if (speed > VEHICLE.alignMinSpeed) {
    let alignRate = lerp(VEHICLE.alignGrip, VEHICLE.driftStability, slide);
    const over = slipMag - VEHICLE.spinGuardSlip;
    if (over > 0) alignRate += over * VEHICLE.spinGuardGain;
    if (slipMag > VEHICLE.slideSlipStart) {
      const counter = clamp01((slip < 0 ? -1 : 1) * steerInput);
      alignRate *= lerp(1, VEHICLE.counterSteerAssist, counter);
    }
    const fade = clamp01((speed - VEHICLE.alignMinSpeed) / VEHICLE.alignFadeSpeed);
    yaw += slip * alignRate * fade;
  }

  v.yawRate = yaw;
  v.heading = wrapAngle(v.heading + yaw * dt);

  // --- 6. Lateral velocity: inertia keeps it in world space, grip bleeds it off. --------
  lateral -= speed * yaw * dt;
  const latAbs = lateral < 0 ? -lateral : lateral;
  if (latAbs > 1e-6) {
    const gripAccel = Math.min(latAbs * grip, latCap);
    const dv = Math.min(latAbs, gripAccel * dt);
    lateral -= lateral > 0 ? dv : -dv;
  }

  // --- 7. Recompose and integrate. ------------------------------------------------------
  const fx = forwardX(v.heading);
  const fz = forwardZ(v.heading);
  const rx = rightX(v.heading);
  const rz = rightZ(v.heading);
  v.vx = fx * speed + rx * lateral;
  v.vz = fz * speed + rz * lateral;
  v.x += v.vx * dt;
  v.z += v.vz * dt;

  v.speed = speed;
  v.lateralSpeed = lateral;
  v.slipAngle = Math.abs(speed) > VEHICLE.movingThreshold ? Math.atan2(lateral, Math.abs(speed)) : 0;
  if (!cmd.handbrake) v.wheelSpin = wrapAngle(v.wheelSpin + (speed / VEHICLE.wheelRadius) * dt);
  v.throttleApplied = nitroActive ? Math.max(throttle, VEHICLE.nitroIdleThrottle) : throttle;
  v.brakeApplied = brake;
  v.handbrake = cmd.handbrake;
}

/** Hermite ease between two edges. Local copy so `src/core/math.ts` stays untouched. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
