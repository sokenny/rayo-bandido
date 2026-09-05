import type { PlayerCommand, VehicleState } from '../core/types';
import { DRIVETRAIN, NITRO, VEHICLE } from '../config/tuning';
import { clamp, clamp01, damp, forwardX, forwardZ, lerp, rightX, rightZ, wrapAngle } from '../core/math';
import { gearTopSpeed, limiterPenalty, lugFactor, stepDrivetrain } from './drivetrain';

/**
 * Arcade vehicle controller on a planar world (no wheel simulation).
 *
 * MODEL (all constants live in `src/config/tuning.ts`, VEHICLE section)
 *  1. World velocity is decomposed into the body frame every tick, so collision impulses
 *     applied by `src/sim/collision.ts` after the previous tick are respected.
 *  2. Longitudinal: engine force with a speed falloff curve, brakes that act along the velocity
 *     vector (so a sideways car is slowed, not driven backwards), drag + rolling resistance +
 *     engine braking + drift scrub. Reverse is a separate gear that only engages from a real
 *     standstill after the brake has been held there for `reverseArmTime`.
 *     The brake also transfers weight forward: see the DRIVETRAIN note below.
 *  2b. DRIVETRAIN: the car is rear-wheel drive, and the model expresses that rather than
 *     simulating it. Drive force only ever loosens the rear (`powerSlideGain` breaks traction
 *     under throttle; it never helps the car turn in), and braking loads the front while
 *     unloading the rear — the left-foot-brake technique. So a brake pressed mid-corner raises
 *     the front's grip budget (`brakeYawGain`, `brakeFrontBite`), weakens the self-aligning
 *     torque that would straighten the car (`brakeAlignScale`) and holds a floor under the
 *     slide (`brakeRearUnload`): the car tightens toward the apex instead of running wide.
 *     Anything added here later — launch behaviour, a diff — must keep drive at the rear.
 *  2c. WHEELSPIN (`src/sim/drivetrain.ts`): the engine has a gear and an rpm, and under
 *     throttle it can rev above what the road turns it at. That excess, inside the torque band,
 *     is the rear spinning (`wheelspin`). It is what holds a slide (`hold` in step 3), what
 *     steps the rear out with the wheel turned (`spinSlide`, `powerYawKick`: a first-gear
 *     donut), and against the limiter it costs drive and stability (`overRev`). A binary
 *     throttle therefore has to be tapped to keep the needle in the band; that modulation is
 *     the skill in a sustained drift. The automatic shifts regardless of the drift, which is
 *     what makes holding one hard on it; the manual box hands the gear to the player.
 *  3. Steering angle tightens with speed and reacts within a couple of frames. Released in a
 *     slide, the wheel self-steers toward the direction of travel (counter-steer, see
 *     `VEHICLE.selfSteer*`); holding the arrow keeps lock, tapping it holds a partial angle.
 *  4. Yaw = grip-limited bicycle yaw (+ handbrake kick) + a self-aligning term that rotates
 *     the nose back toward the velocity direction. The self-aligning term is what keeps
 *     slides stable instead of spinning: bigger slip angle => stronger counter-rotation — but
 *     the anti-spin part of it only works while the wheel is counter-steered (`spinGuardBare`).
 *  5. Lateral: rotating the body injects lateral velocity (`-speed * yaw * dt`, i.e. the
 *     velocity vector keeps its world direction), and lateral grip bleeds it off. High grip
 *     => the car follows its nose. Low grip => it slides. `slide` (0..1) blends between them
 *     and is driven by slip angle, handbrake and power-oversteer, so drifting is easy to
 *     start, easy to hold with throttle + steering, and regrips when inputs are released.
 *
 * Mutates `v` in place, allocation-free.
 */
/**
 * `drifting` is whether the drift rules (`src/sim/drift.ts`) currently hold a drift, from the
 * previous tick: it gives the rear a reason to spin. `manual` hands the gear to the player's
 * `shiftUp` / `shiftDown`; otherwise the automatic picks it.
 */
export function stepVehicle(
  v: VehicleState,
  cmd: PlayerCommand,
  nitroActive: boolean,
  dt: number,
  drifting = false,
  manual = false,
): void {
  v.prevX = v.x;
  v.prevZ = v.z;
  v.prevHeading = v.heading;
  v.collided = false;
  v.collisionImpact = 0;
  // Kept so step 6 can report the accelerations the body felt (see `latAccel`/`longAccel`).
  const speedLastTick = v.speed;

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

  // --- 1b. Drivetrain: gear, rpm and wheelspin for this tick (uses last tick's slide). ----
  // The rear has a reason to spin in a held drift, in a slide already under way, or once the
  // wheel has been held at full lock at low speed for a moment (the donut is asked for; a
  // corner is not). On a straight it hooks up: launches are a plain automatic's.
  const spinLoad = smoothstep(VEHICLE.spinSteerStart, VEHICLE.spinSteerFull, steerMag) * powerSpeedFade(absSpeed);
  const wantsSpin = steerMag >= VEHICLE.spinIntentSteer && absSpeed < VEHICLE.spinIntentSpeed && !cmd.handbrake;
  v.spinIntent = wantsSpin
    ? Math.min(1, v.spinIntent + dt / VEHICLE.spinIntentRise)
    : Math.max(0, v.spinIntent - dt / VEHICLE.spinIntentFall);
  const intent = smoothstep(VEHICLE.spinIntentStart, 1, v.spinIntent);
  const spinDemand = drifting ? 1 : intent > v.slide ? intent : v.slide;
  const shift = cmd.shiftUp ? 1 : cmd.shiftDown ? -1 : 0;
  stepDrivetrain(v, cmd.handbrake ? 0 : throttle, absSpeed, speed >= 0, spinDemand, manual, shift, dt);
  const wheelspin = v.wheelspin;
  // Against the limiter for longer than a flick: drive, stability and rear grip suffer, all
  // scaled by how loose the car is, so on grip the limiter costs nothing.
  const over = limiterPenalty(v);

  // --- 2. Steering angle: quick response, tightens with speed. -------------------------
  const speedT = clamp01(absSpeed / VEHICLE.maxSpeed);
  const steerLimit = lerp(
    VEHICLE.maxSteerAngle,
    VEHICLE.maxSteerAngleHighSpeed,
    Math.pow(speedT, VEHICLE.steerSpeedCurve),
  );
  // Self-steer: a released wheel in a slide aligns itself with the direction of travel (the
  // wheel spinning through your hands), which is counter-steer. On grip it returns to centre.
  const forwardMotion = speed > VEHICLE.movingThreshold;
  const selfFade = forwardMotion ? smoothstep(VEHICLE.selfSteerSlipStart, VEHICLE.selfSteerSlipFull, slipMag) : 0;
  const selfSteer = clamp(slip, -steerLimit, steerLimit) * selfFade;
  // The input is added in full; only the self-steer part fades as the arrow is pressed.
  const targetSteer = steerInput * steerLimit + selfSteer * (1 - steerMag);
  let rate: number;
  if (steerMag > 0.05) {
    const returning = Math.abs(targetSteer) < Math.abs(v.steerAngle) && targetSteer * v.steerAngle >= 0;
    rate = returning ? VEHICLE.steerReturnRate : VEHICLE.steerRate;
  } else {
    rate = lerp(VEHICLE.steerReturnRate, VEHICLE.selfSteerRate, selfFade);
  }
  v.steerAngle = damp(v.steerAngle, targetSteer, rate, dt);
  // Where the wheel sits against the slide: + counter-steered, - steered into it.
  const steerFrac = v.steerAngle / steerLimit;
  const against = slipMag > VEHICLE.slideSlipStart ? (slip < 0 ? -1 : 1) * clamp(steerFrac, -1, 1) : 0;
  const counter = clamp01(against);
  v.counterSteer = against;

  // --- 3. How much the car is sliding this tick (0 = full grip, 1 = full drift). -------
  // Forward weight transfer under braking (0..1). Drives the left-foot-brake behaviour used
  // in steps 3, 4 and 5: front loaded, rear light.
  const brakeLoad = forwardMotion ? brake * clamp01(absSpeed / VEHICLE.brakeLoadSpeed) : 0;
  const handbrakeSlide = cmd.handbrake && forwardMotion && absSpeed > VEHICLE.handbrakeMinSpeed;
  let slide = 0;
  if (forwardMotion) {
    // Already sliding: what keeps the rear loose is torque at the wheels (wheelspin), with the
    // steering holding only part of it. Momentum alone decays to `slideReleaseFloor`.
    const steerHold = steerMag * VEHICLE.steerHold;
    const hold = wheelspin > steerHold ? wheelspin : steerHold;
    const slipFactor = smoothstep(VEHICLE.slideSlipStart, VEHICLE.slideSlipFull, slipMag);
    slide = slipFactor * lerp(VEHICLE.slideReleaseFloor, 1, hold);

    // Spinning rear wheels with the wheel turned step the rear out: the donut. That is a
    // low-speed tool (at speed the rear only comes out under lateral load, `power` below),
    // but once the car is sliding, wheelspin keeps it out at any speed. Straight-line
    // wheelspin (a launch) only smokes; it never makes the car wander.
    const spinSlide = wheelspin * (spinLoad > slipFactor ? spinLoad : slipFactor) * VEHICLE.spinSlideGain;
    if (spinSlide > slide) slide = spinSlide;

    // Power oversteer: hard steering + throttle above `powerSlideSpeed` breaks traction.
    const powerSpeed = clamp01((absSpeed - VEHICLE.powerSlideSpeed) / VEHICLE.powerSlideSpeedRamp);
    const power =
      throttle * powerSpeed * smoothstep(VEHICLE.powerSlideSteer, 1, steerMag) * VEHICLE.powerSlideGain;
    if (power > slide) slide = power;

    // Counter-steering (the wheel pointing where the car is going, held or self-steered)
    // recovers grip faster — unless the rear is being kept spinning, in which case it steers
    // the slide rather than ending it.
    slide *= lerp(1, VEHICLE.counterSteerGrip, counter * (1 - wheelspin));

    // Left-foot brake: the unloaded rear keeps sliding, so braking mid-drift trims the line
    // instead of snapping the car straight. Only while a slide already exists — braking in a
    // straight line must not loosen the car.
    if (slipMag > VEHICLE.slideSlipStart) {
      const rear = brakeLoad * VEHICLE.brakeRearUnload;
      if (rear > slide) slide = rear;
    }

    if (handbrakeSlide) slide = 1;
    slide = clamp01(slide);
  }

  const grip =
    lerp(VEHICLE.gripLateral, VEHICLE.gripLateralDrift, slide) * (1 - over * slide * DRIVETRAIN.overRevGripLoss);
  // The loaded front can hold more lateral force, which is what closes the apex.
  const latCap =
    lerp(VEHICLE.maxLatAccel, VEHICLE.maxLatAccelDrift, slide) * lerp(1, VEHICLE.brakeFrontBite, brakeLoad);

  // --- 4. Longitudinal. -----------------------------------------------------------------
  const maxForward = VEHICLE.maxSpeed + (nitroActive ? NITRO.boostMaxSpeedBonus : 0);
  const fwdSpeed = speed > 0 ? speed : 0;
  // A gear cannot be pushed past its top: the limiter cuts the engine there and holds the car
  // at that speed. The automatic shifts up before this can bite, so it only ever acts on the
  // manual box — flat out in a gear, or after a downshift the road speed was too high for.
  const gearTop = gearTopSpeed(v.gear);
  const limited = manual && fwdSpeed >= gearTop;

  if (limited) {
    // Fuel cut: no drive, nitro included.
  } else if (throttle > 0) {
    const ratio = clamp01(fwdSpeed / (VEHICLE.maxSpeed * VEHICLE.powerCurveRef));
    let drive = throttle * VEHICLE.engineAccel * (1 - ratio * ratio);
    if (nitroActive) {
      const boostRatio = clamp01(fwdSpeed / (maxForward * VEHICLE.powerCurveRef));
      const ramp = clamp01(absSpeed / VEHICLE.nitroRampSpeed);
      drive += NITRO.boostAccel * ramp * (1 - boostRatio * boostRatio);
    }
    // Loose rears pinned against the limiter put down far less power: a pinned throttle
    // mid-drift bogs. On grip the limiter costs nothing, so launches and straights are as ever.
    drive *= 1 - over * slide * DRIVETRAIN.overRevDriftDriveLoss;
    // A tall gear at low revs lugs (manual only in practice: the automatic never gets there).
    drive *= lugFactor(v.rpm01, v.gear);
    // Wheels that are already sliding put down less power.
    speed += drive * lerp(1, VEHICLE.driftThrottleScale, slide) * dt;
  } else if (nitroActive) {
    // Boost without throttle still gives a small shove so the button always feels alive.
    const boostRatio = clamp01(fwdSpeed / (maxForward * VEHICLE.powerCurveRef));
    const ramp = clamp01(absSpeed / VEHICLE.nitroRampSpeed);
    speed += NITRO.boostAccel * VEHICLE.nitroIdleThrottle * ramp * (1 - boostRatio * boostRatio) * dt;
  }

  // Brakes act on the velocity vector, not on the forward axis alone: the tyres do not care
  // which way the nose points. Sideways speed is scrubbed at `brakeLateralShare` so a drift
  // survives the pedal, and the forward component can only reach zero, never cross it.
  if (brake > 0 && speed > 0) {
    const vmag = Math.hypot(speed, lateral);
    if (vmag > 1e-6) {
      const fight = lerp(1, VEHICLE.brakeThrottleFight, throttle);
      const dv = Math.min(vmag, VEHICLE.brakeDecel * brake * fight * dt);
      speed -= (dv * speed) / vmag;
      if (speed < 0) speed = 0;
      const latShare = (dv * lateral * VEHICLE.brakeLateralShare) / vmag;
      lateral -= Math.abs(latShare) > Math.abs(lateral) ? lateral : latShare;
    }
  }

  // Reverse is its own gear. It needs the whole car stopped — sideways speed included — and
  // the brake held there for `reverseArmTime`, so a fast car (drifting or not) can never flick
  // itself into reverse with a stab of the pedal.
  const armed = v.reverseArm >= VEHICLE.reverseArmTime;
  const stopped =
    Math.hypot(speed, lateral) < VEHICLE.reverseSpeedWindow && speed <= VEHICLE.brakeToReverseSpeed;
  // Once armed, backing up keeps the gear engaged; releasing the brake drops out of it.
  v.reverseArm = brake > 0 && (stopped || (armed && speed <= 0)) ? v.reverseArm + dt : 0;
  if (v.reverseArm >= VEHICLE.reverseArmTime && speed > -VEHICLE.maxReverseSpeed) {
    speed -= VEHICLE.reverseAccel * brake * dt;
  }

  if (cmd.handbrake) {
    const hb = VEHICLE.handbrakeDecel * dt;
    speed = speed > 0 ? Math.max(0, speed - hb) : Math.min(0, speed + hb);
  }

  if (manual && speed > gearTop) speed = Math.max(gearTop, speed - DRIVETRAIN.limiterDecel * dt);

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
  // On grip the bicycle model reads the wheel's angle to the body. In a slide the front tyres
  // work against the direction of travel instead: the effective angle is the wheel minus the
  // slip, so a counter-steered wheel on the line of travel turns nothing and a wheel held into
  // the slide keeps the rotation going. The blend by `slide` keeps grip handling untouched.
  const steerEff = clamp(v.steerAngle - slip * slide, -VEHICLE.maxEffectiveSteer, VEHICLE.maxEffectiveSteer);
  const kinematicYaw = (speed / VEHICLE.wheelbase) * Math.tan(steerEff);
  // Weight on the nose = more front grip to spend on rotation: the left-foot brake tightens
  // the line rather than opening it.
  const yawBudget =
    VEHICLE.maxLatAccel * lerp(1, VEHICLE.driftYawGain, slide) * lerp(1, VEHICLE.brakeYawGain, brakeLoad);
  const yawLimit = yawBudget / Math.max(absSpeed, VEHICLE.yawLimitMinSpeed);
  let yaw = clamp(kinematicYaw, -yawLimit, yawLimit);

  // Handbrake kick: snaps the rear out, then fades as the slide establishes itself.
  if (handbrakeSlide) {
    const fade = 1 - smoothstep(VEHICLE.handbrakeKickFadeStart, VEHICLE.handbrakeKickFadeEnd, slipMag);
    const ramp = clamp01((absSpeed - VEHICLE.handbrakeMinSpeed) / VEHICLE.handbrakeKickRamp);
    yaw += VEHICLE.handbrakeYawKick * steerInput * fade * ramp;
  }

  // Power kick: spinning rears with the wheel turned rotate the car around its nose. This is
  // what makes a donut from a standstill; it fades with slip (so it cannot spin the car on
  // its own) and with speed (at speed the slide is held by grip balance, not by torque).
  if (wheelspin > 0 && forwardMotion) {
    const fade = 1 - smoothstep(VEHICLE.powerYawFadeStart, VEHICLE.powerYawFadeEnd, slipMag);
    yaw += VEHICLE.powerYawKick * wheelspin * steerInput * fade * powerSpeedFade(absSpeed);
  }

  // Pinned against the limiter with the rear loose, the rear keeps coming round in the
  // direction it is already going, and nothing about slip angle stops it: lift or spin.
  if (over > 0 && slipMag > VEHICLE.slideSlipStart) {
    yaw += (slip < 0 ? 1 : -1) * DRIVETRAIN.overRevYaw * over * slide;
  }

  // Self-aligning torque: rotates the nose toward the velocity direction. Weak while
  // drifting (so slides can be held), strong while gripping, and it ramps up hard past
  // `spinGuardSlip` so only a really abusive input can spin the car.
  if (speed > VEHICLE.alignMinSpeed) {
    // The light rear under braking resists straightening, so the nose keeps coming around.
    let alignRate =
      lerp(VEHICLE.alignGrip, VEHICLE.driftStability, slide) * lerp(1, VEHICLE.brakeAlignScale, brakeLoad);
    // The anti-spin assist needs the wheel counter-steered to work with. Steered into the
    // slide it is nearly gone: hold the arrow past the point of recovery and the car spins.
    const beyond = slipMag - VEHICLE.spinGuardSlip;
    if (beyond > 0) {
      const guard = lerp(VEHICLE.spinGuardBare, 1, smoothstep(-1, 0.5, against));
      alignRate += beyond * VEHICLE.spinGuardGain * guard;
    }
    alignRate *= lerp(1, VEHICLE.counterSteerAssist, counter);
    // A loose rear pinned against the limiter has nothing to align with, spin guard included.
    alignRate *= 1 - over * slide * DRIVETRAIN.overRevStabilityLoss;
    const fade = clamp01((speed - VEHICLE.alignMinSpeed) / VEHICLE.alignFadeSpeed);
    yaw += slip * alignRate * fade;
  }

  v.yawRate = yaw;
  v.heading = wrapAngle(v.heading + yaw * dt);

  // --- 6. Lateral velocity: inertia keeps it in world space, grip bleeds it off. --------
  // Rotating the body leaves the velocity pointing where it was, which shows up as lateral
  // velocity; the grip term is the tyre force that pulls it back. That force is the only
  // real lateral acceleration the body feels, so it is what `latAccel` reports.
  lateral -= speed * yaw * dt;
  const latAbs = lateral < 0 ? -lateral : lateral;
  let latAccel = 0;
  if (latAbs > 1e-6) {
    const latSign = lateral > 0 ? 1 : -1;
    const gripAccel = Math.min(latAbs * grip, latCap);
    const dv = Math.min(latAbs, gripAccel * dt);
    lateral -= latSign * dv;
    latAccel = (-latSign * dv) / dt;
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
  v.latAccel = latAccel;
  // Measured against the previous tick's speed, so a collision impulse (applied after the
  // last tick) reads as the hard deceleration it is.
  v.longAccel = (speed - speedLastTick) / dt;
  if (!cmd.handbrake) v.wheelSpin = wrapAngle(v.wheelSpin + (speed / VEHICLE.wheelRadius) * dt);
  v.slide = slide;
  v.throttleApplied = nitroActive ? Math.max(throttle, VEHICLE.nitroIdleThrottle) : throttle;
  v.brakeApplied = brake;
  v.handbrake = cmd.handbrake;
}

/** How much of the power-over tools (kick, step-out) survive at `absSpeed`: full slow, gone fast. */
function powerSpeedFade(absSpeed: number): number {
  return (
    1 -
    clamp01(
      (absSpeed - VEHICLE.powerYawSpeedFadeStart) / (VEHICLE.powerYawSpeedFadeEnd - VEHICLE.powerYawSpeedFadeStart),
    )
  );
}

/** Hermite ease between two edges. Local copy so `src/core/math.ts` stays untouched. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
