import type { PlayerCommand, VehicleState } from '../core/types';
import { DRIVETRAIN, NITRO, ROAD_ROUGHNESS, VEHICLE, VERTICAL } from '../config/tuning';
import { clamp, clamp01, damp, forwardX, forwardZ, lerp, rightX, rightZ, wrapAngle } from '../core/math';
import { gearTopSpeed, lugFactor, stepDrivetrain } from './drivetrain';

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
 *     Anything added here later — launch behaviour, a diff, wheelspin — must keep drive at
 *     the rear.
 *  2c. GEARBOX (`src/sim/drivetrain.ts`): the engine has a gear and an rpm, six-speed, either
 *     automatic or handed to the player (`manual`). It is a longitudinal and presentational
 *     system only: it sets the tachometer and the engine note, a gear caps the car at its top
 *     speed (`limited`), and a tall gear lugs at low revs (`lugFactor`). It deliberately does
 *     NOT feed the slide — handling is the same under either box, and `wheelspin` is a
 *     readout, not a handling input. Keep it that way: the drift model below owns the slide.
 *  3. Steering angle tightens with speed and reacts within a couple of frames.
 *  4. Yaw = grip-limited bicycle yaw (+ handbrake kick) + a self-aligning term that rotates
 *     the nose back toward the velocity direction. The self-aligning term is what keeps
 *     slides stable instead of spinning: bigger slip angle => stronger counter-rotation.
 *  4b. HANDBRAKE: the pull is an angle budget, not an event. `handbrakeHold` times how long the
 *     button has been down and raises both the kick and the rotation the pull is allowed to
 *     buy (`handbrakeTapAngle` -> `handbrakeHoldAngle`), while damping the aligning torque that
 *     would fight it - locked rears make no aligning force. So a flick still flicks, and a pull
 *     held for about a second swings the nose the better part of the way round. The pull also
 *     survives the nose passing the velocity vector, which is what a reverse entry needs;
 *     nothing here is written for that trick specifically, it falls out of the budget.
 *  5. Lateral: rotating the body moves velocity between the forward and lateral axes (the
 *     velocity vector keeps its world direction, so a rotation on its own never changes how
 *     fast the car is going - see step 6), and lateral grip bleeds it off. High grip
 *     => the car follows its nose. Low grip => it slides. `slide` (0..1) blends between them
 *     and is driven by slip angle, handbrake and power-oversteer, so drifting is easy to
 *     start, easy to hold with throttle + steering, and regrips when inputs are released.
 *  5b. Those inputs set a *target*; `slide` ramps toward it instead of adopting it, and the
 *     ramp rate on the way out of grip grows with how far the rear has already gone
 *     (`slideBreakEase` / `slideBreakCurve`). Traction is therefore lost along an S-curve —
 *     soft, then running away, then settling — rather than flipped in one tick, which is what
 *     the step change used to feel like. Everything downstream (`grip`, `latCap`, the yaw
 *     budget, the self-aligning rate) is a `lerp` on `slide`, so they all inherit the curve.
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
  v.prevY = v.y;
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

  // --- 1b. Gearbox: gear and rpm for this tick (uses last tick's slide). -----------------
  // The rear is given a reason to rev above road speed when the car is already loose, so the
  // needle and the engine note come alive in a slide. Nothing below reads `wheelspin` back:
  // the gearbox does not change how the car handles.
  const spinDemand = drifting ? 1 : v.slide;
  const shift = cmd.shiftUp ? 1 : cmd.shiftDown ? -1 : 0;
  stepDrivetrain(v, cmd.handbrake ? 0 : throttle, absSpeed, speed >= 0, spinDemand, manual, shift, dt);

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
  // Where the wheel sits against the slide: + counter-steered, - steered into it. A readout
  // for the cluster's wheel indicator; the handling terms below use `counter` directly.
  const counter = slipMag > VEHICLE.slideSlipStart ? clamp01((slip < 0 ? -1 : 1) * steerInput) : 0;
  v.counterSteer = slipMag > VEHICLE.slideSlipStart ? (slip < 0 ? -1 : 1) * steerInput : 0;

  // --- 2b. In the air (`src/sim/surface.ts`): no tyre on the road, no tyre force. ------------
  // The car keeps the world velocity it left with, less the air's drag, and the yaw rate it
  // took off with, which the air bleeds slowly. The wheels and the gearbox above still answer
  // the pedals, so the engine revs and the wheels turn; none of it reaches the road.
  if (v.airborne) {
    const yaw = v.yawRate * Math.exp(-VERTICAL.airYawDamping * dt);
    v.yawRate = yaw;
    v.heading = wrapAngle(v.heading + yaw * dt);
    const flat = Math.hypot(v.vx, v.vz);
    if (flat > 1e-6) {
      const drag = Math.max(0, 1 - (VEHICLE.airDrag * flat * dt));
      v.vx *= drag;
      v.vz *= drag;
    }
    v.x += v.vx * dt;
    v.z += v.vz * dt;
    const afx = forwardX(v.heading);
    const afz = forwardZ(v.heading);
    const airSpeed = v.vx * afx + v.vz * afz;
    const airLateral = v.vx * rightX(v.heading) + v.vz * rightZ(v.heading);
    v.speed = airSpeed;
    v.lateralSpeed = airLateral;
    const airAbs = airSpeed < 0 ? -airSpeed : airSpeed;
    v.slipAngle = airAbs > VEHICLE.movingThreshold ? Math.atan2(airLateral, airAbs) : 0;
    v.latAccel = 0;
    v.longAccel = 0;
    if (!cmd.handbrake) v.wheelSpin = wrapAngle(v.wheelSpin + (Math.max(speedLastTick, throttle * VEHICLE.maxSpeed) / VEHICLE.wheelRadius) * dt);
    v.throttleApplied = nitroActive ? Math.max(throttle, VEHICLE.nitroIdleThrottle) : throttle;
    v.brakeApplied = brake;
    v.handbrake = cmd.handbrake;
    return;
  }

  // --- 3. How much the car is sliding this tick (0 = full grip, 1 = full drift). -------
  const forwardMotion = speed > VEHICLE.movingThreshold;
  // Forward weight transfer under braking (0..1). Drives the left-foot-brake behaviour used
  // in steps 3, 4 and 5: front loaded, rear light.
  const brakeLoad = forwardMotion ? brake * clamp01(absSpeed / VEHICLE.brakeLoadSpeed) : 0;
  // A pull can only be *opened* while the car is going forwards, but once open it lives off
  // total speed rather than forward speed, so it survives the nose swinging past the velocity
  // vector. That is what a reverse entry is, and the old forward-only gate cut it dead at 90.
  const velMag = Math.hypot(speed, lateral);
  const handbrakeSlide =
    cmd.handbrake &&
    (v.handbrakeHold > 0
      ? velMag > VEHICLE.handbrakeHoldMinSpeed
      : forwardMotion && velMag > VEHICLE.handbrakeMinSpeed);
  if (handbrakeSlide) {
    v.handbrakeHold += dt;
  } else {
    v.handbrakeHold = 0;
    v.handbrakeYaw = 0;
  }
  // How much authority this pull has earned: 0 for a flick, 1 once it has been held for
  // `handbrakeTapTime + handbrakeHoldRamp`. Used by the kick below and by the aligning torque.
  const holdT = clamp01((v.handbrakeHold - VEHICLE.handbrakeTapTime) / VEHICLE.handbrakeHoldRamp);
  // How loose the conditions *ask* the car to be this tick. The axle then ramps toward it
  // below rather than adopting it outright.
  let slideTarget = 0;
  if (forwardMotion) {
    // Already sliding: stay loose while the player asks for it (throttle or steering).
    const hold = throttle > steerMag ? throttle : steerMag;
    // A tyre that is already sliding holds less than one that is gripping (kinetic friction is
    // below static), so the angle it takes to keep the rear loose drops once it has gone: the
    // full-slide edge moves from `slideSlipFull` toward `slideSlipHeld` with the slide itself.
    // Without that the drift only existed above one angle, and any swing below it bit the rear
    // straight back in - the car could hold its angle but never move about inside it. It lasts
    // only while the player keeps the rear busy (a spinning rear stays sliding): let go of
    // everything and the tyres bite at the usual edge, so catching the car stays quick.
    const slipFull = lerp(VEHICLE.slideSlipFull, VEHICLE.slideSlipHeld, v.slide * hold);
    slideTarget =
      smoothstep(VEHICLE.slideSlipStart, slipFull, slipMag) *
      lerp(VEHICLE.slideReleaseFloor, 1, hold);

    // Power oversteer: hard steering + throttle above `powerSlideSpeed` breaks traction.
    const powerSpeed = clamp01((absSpeed - VEHICLE.powerSlideSpeed) / VEHICLE.powerSlideSpeedRamp);
    const power =
      throttle * powerSpeed * smoothstep(VEHICLE.powerSlideSteer, 1, steerMag) * VEHICLE.powerSlideGain;
    if (power > slideTarget) slideTarget = power;

    // Counter-steering (steering out of the slide) recovers grip faster.
    slideTarget *= lerp(1, VEHICLE.counterSteerGrip, counter);

    // Left-foot brake: the unloaded rear keeps sliding, so braking mid-drift trims the line
    // instead of snapping the car straight. Only while a slide already exists — braking in a
    // straight line must not loosen the car.
    if (slipMag > VEHICLE.slideSlipStart) {
      const rear = brakeLoad * VEHICLE.brakeRearUnload;
      if (rear > slideTarget) slideTarget = rear;
    }

    slideTarget = clamp01(slideTarget);
  }
  // A pull owns the axle outright, and it keeps owning it after the car has stopped pointing
  // where it is going - otherwise the tyres would bite again halfway through the rotation.
  if (handbrakeSlide) slideTarget = 1;

  // The rear does not let go in a single tick — that is what makes a step change here read as
  // arcade. `slide` chases its target through a rate-limited ramp, and on the way *out* of
  // grip that rate itself grows with how far the axle has already stepped out: soft for the
  // first few degrees (`slideBreakEase` of full rate), then running away as the slide
  // develops. Rate rising into an asymptotic approach is an S-curve — the tail eases out,
  // accelerates, then settles — instead of the old cliff. Regrip uses a single, quicker rate:
  // losing the car should be progressive, catching it should not feel laggy. The handbrake
  // keeps its own fast rate so a yank still snaps.
  const prevSlide = v.slide;
  const slideRate =
    slideTarget > prevSlide
      ? handbrakeSlide
        ? VEHICLE.slideHandbrakeRate
        : VEHICLE.slideBreakRate *
          lerp(VEHICLE.slideBreakEase, 1, Math.pow(prevSlide, VEHICLE.slideBreakCurve))
      : VEHICLE.slideRegripRate;
  const slide = clamp01(damp(prevSlide, slideTarget, slideRate, dt));

  // The road's swells take load off an axle and put it back (`settleVehicle`): a light tyre
  // holds less, a pressed one only a little more. The rear's grip is what keeps the car's
  // velocity behind its nose, so a light rear mid-corner lets the tail step out; the front's is
  // what turns it, so a light front runs wide. At a cruise the load barely moves.
  const frontGrip = axleGrip(v.frontLoad);
  const rearGrip = axleGrip(v.rearLoad);
  const grip = lerp(VEHICLE.gripLateral, VEHICLE.gripLateralDrift, slide) * rearGrip;
  // The loaded front can hold more lateral force, which is what closes the apex.
  const latCap =
    lerp(VEHICLE.maxLatAccel, VEHICLE.maxLatAccelDrift, slide) *
    lerp(1, VEHICLE.brakeFrontBite, brakeLoad) *
    rearGrip;

  // --- 4. Longitudinal. -----------------------------------------------------------------
  const maxForward = VEHICLE.maxSpeed + (nitroActive ? NITRO.boostMaxSpeedBonus : 0);
  const fwdSpeed = speed > 0 ? speed : 0;
  // The ceiling stops the car *gaining* speed past it; it never takes speed away. Speed carried
  // above it (nitro just ran out, a collision shove) is momentum, and bleeds off through drag —
  // at no less than `overspeedBleed` so the car does not hover just over its top speed.
  const ceiling = Math.max(maxForward, fwdSpeed - VEHICLE.overspeedBleed * dt);
  // A gear cannot be pushed past its top: the limiter cuts the engine there and holds the car
  // at that speed. The automatic shifts up before this can bite, so it only ever acts on the
  // manual box — flat out in a gear, or after a downshift the road speed was too high for.
  const gearTop = gearTopSpeed(v.gear);
  // The limiter cuts drive two ways: the gear is simply out of road speed, or the engine is
  // banging off the rev limiter and this tick falls in a fuel cut.
  const limited = manual && (fwdSpeed >= gearTop || v.limiterCut > 0);

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

  // Locked rears scrub the velocity vector, not the forward axis: a car sitting sideways on
  // the handbrake has almost no forward speed left to take away, and it should still be
  // slowing down. Sideways speed only pays `handbrakeLateralShare` of it so the slide lives.
  if (cmd.handbrake) {
    const vmag = Math.hypot(speed, lateral);
    if (vmag > 1e-6) {
      const dv = Math.min(vmag, VEHICLE.handbrakeDecel * dt);
      speed -= (dv * speed) / vmag;
      const latShare = (dv * lateral * VEHICLE.handbrakeLateralShare) / vmag;
      lateral -= Math.abs(latShare) > Math.abs(lateral) ? lateral : latShare;
    }
  }

  if (manual && speed > gearTop) speed = Math.max(gearTop, speed - DRIVETRAIN.limiterDecel * dt);

  // Hills. A climb leans on the engine and a descent pushes the car along: a fraction of
  // gravity along the road's grade (`pitch` is last tick's, read off the surface under the
  // car). Arcade-scaled so a ramp is felt without ever stalling a car on it.
  if (v.pitch !== 0) speed -= VEHICLE.gradeGravity * 9.81 * Math.sin(v.pitch) * dt;

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
  speed = clamp(speed, -VEHICLE.maxReverseSpeed, ceiling);
  absSpeed = speed < 0 ? -speed : speed;

  // --- 5. Yaw. --------------------------------------------------------------------------
  // Bicycle yaw, limited by how much lateral acceleration the tyres can produce. Drifting
  // raises that budget (`driftYawGain`) so the nose can out-rotate the velocity.
  // Roll steer: one front wheel up a swell and the other not toes the axle a hair. The angle
  // is the same at any speed; the yaw it buys grows with speed, so it only asks for a
  // correction when the car is really moving.
  const rollSteer = v.frontRoll * ROAD_ROUGHNESS.rollSteer;
  const kinematicYaw = (speed / VEHICLE.wheelbase) * Math.tan(v.steerAngle + rollSteer);
  // Weight on the nose = more front grip to spend on rotation: the left-foot brake tightens
  // the line rather than opening it.
  const yawBudget =
    VEHICLE.maxLatAccel * lerp(1, VEHICLE.driftYawGain, slide) * lerp(1, VEHICLE.brakeYawGain, brakeLoad);
  const yawLimit = (yawBudget * frontGrip) / Math.max(absSpeed, VEHICLE.yawLimitMinSpeed);
  let yaw = clamp(kinematicYaw, -yawLimit, yawLimit);

  // Handbrake kick. The pull has an angle *budget* rather than a fixed life: a flick buys
  // `handbrakeTapAngle` of rotation and dies, and holding the button raises the budget toward
  // `handbrakeHoldAngle` faster than the kick can spend it, so the nose keeps coming round for
  // as long as the player keeps it up. `handbrakeYaw` is the running spend; once it reaches the
  // budget the kick eases off over `handbrakeAngleFade` and the car simply keeps the angle it
  // has. Direction is the wheel, so counter-steering with the button down stops the rotation.
  let kickDir = 0;
  if (handbrakeSlide) {
    const budget = lerp(VEHICLE.handbrakeTapAngle, VEHICLE.handbrakeHoldAngle, holdT);
    const left = 1 - smoothstep(budget - VEHICLE.handbrakeAngleFade, budget, v.handbrakeYaw);
    const ramp = clamp01((velMag - VEHICLE.handbrakeHoldMinSpeed) / VEHICLE.handbrakeKickRamp);
    const kick =
      lerp(VEHICLE.handbrakeYawKick, VEHICLE.handbrakeHoldYawKick, holdT) * steerInput * left * ramp;
    kickDir = kick > 0 ? 1 : kick < 0 ? -1 : 0;
    yaw += kick;
  }

  // Self-aligning torque: rotates the nose toward the velocity direction. Weak while
  // drifting (so slides can be held), strong while gripping, and it ramps up hard past
  // `spinGuardSlip` so only a really abusive input can spin the car.
  if (speed > VEHICLE.alignMinSpeed) {
    // The light rear under braking resists straightening, so the nose keeps coming around.
    let alignRate =
      lerp(VEHICLE.alignGrip, VEHICLE.driftStability, slide) * lerp(1, VEHICLE.brakeAlignScale, brakeLoad);
    const beyond = slipMag - VEHICLE.spinGuardSlip;
    if (beyond > 0) alignRate += beyond * VEHICLE.spinGuardGain;
    // Locked rear tyres make no aligning force, so a held pull switches the straightening
    // torque - spin guard included - almost off. Without this the guard simply out-muscles the
    // kick past 55 degrees and no amount of holding could add angle.
    alignRate *= lerp(1, VEHICLE.handbrakeAlignScale, holdT);
    alignRate *= lerp(1, VEHICLE.counterSteerAssist, counter);
    const fade = clamp01((speed - VEHICLE.alignMinSpeed) / VEHICLE.alignFadeSpeed);
    yaw += slip * alignRate * fade;
  }

  // Everything above is the yaw rate the tyres *ask* for. The body has a moment of inertia, so
  // it does not adopt that rate in a tick: it swings toward it. Gripping, the lag is a few
  // frames and nobody feels it. Sliding, the tyres hold the body only loosely and the lag grows,
  // which turns the slip angle from a first-order settle — the car snapping to an equilibrium
  // angle and locking there — into a lightly damped pendulum. The nose overshoots its angle and
  // swings back, answers a change of lock with a sway rather than a jump, and the road's swells
  // (`rearGrip`) now set the tail moving instead of being absorbed on the spot. Regrip goes
  // through the same inertia, so the car rolls back straight instead of clicking into line.
  // The catch grows with how far apart the two are: a small sway lives, a big swing (a pull
  // just released, a slide collapsing) is caught before it can throw the car the other way.
  const yawGap = yaw - v.yawRate;
  const yawResponse =
    (handbrakeSlide ? VEHICLE.yawResponseHandbrake : lerp(VEHICLE.yawResponseGrip, VEHICLE.yawResponseSlide, slide)) +
    VEHICLE.yawResponseCatch * (yawGap < 0 ? -yawGap : yawGap);
  yaw = damp(v.yawRate, yaw, yawResponse, dt);

  // The pull's spend is the rotation the player actually got, measured along the way the kick
  // is pushing — not the kick's own integral, which the aligning torque eats into and which
  // would leave the budget promising more angle than it delivers. Rotation the other way pays
  // it back, so opposite lock buys a pull its angle back and a pendulum can be worked.
  if (kickDir !== 0) v.handbrakeYaw = Math.max(0, v.handbrakeYaw + kickDir * yaw * dt);

  v.yawRate = yaw;
  v.heading = wrapAngle(v.heading + yaw * dt);

  // --- 6. Lateral velocity: inertia keeps it in world space, grip bleeds it off. --------
  // Rotating the body leaves the velocity pointing where it was, which shows up as lateral
  // velocity; the grip term is the tyre force that pulls it back. That force is the only
  // real lateral acceleration the body feels, so it is what `latAccel` reports.
  //
  // The re-projection has to be the full rotation of BOTH components, not just the lateral
  // one: turning the body moves velocity out of the forward axis and into the lateral axis in
  // equal measure, and a rotation on its own cannot change how fast the car is going. Taking
  // only the lateral half (`lateral -= speed * yaw * dt`) quietly manufactured speed —
  // negligible at a few degrees of slip, and a catastrophe at ninety, where the car was flung
  // sideways faster than its own top speed as if it were swinging around some distant anchor.
  const spin = yaw * dt;
  const spinCos = Math.cos(spin);
  const spinSin = Math.sin(spin);
  const spunSpeed = speed * spinCos + lateral * spinSin;
  lateral = lateral * spinCos - speed * spinSin;
  speed = spunSpeed;
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

/** Grip of an axle carrying `load` (1 = static), per `ROAD_ROUGHNESS`. */
function axleGrip(load: number): number {
  return Math.max(
    ROAD_ROUGHNESS.minGrip,
    load < 1 ? 1 - (1 - load) * ROAD_ROUGHNESS.unloadGrip : 1 + Math.min(load - 1, 1) * ROAD_ROUGHNESS.loadGrip,
  );
}

/** Hermite ease between two edges. Local copy so `src/core/math.ts` stays untouched. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
