/**
 * Every gameplay tuning constant lives here. Starting values come from docs/DECISIONS.md
 * ("Temporary MVP defaults") and may be tuned freely. Keep this the single obvious place.
 *
 * Units: meters, seconds, radians, m/s unless a name says otherwise.
 */

export const SIM_STEP = 1 / 60;

export const VEHICLE = {
  /** Peak forward speed without nitro (m/s). ~205 km/h. */
  maxSpeed: 57,
  /** Reverse speed cap (m/s). ~35 km/h. */
  maxReverseSpeed: 9.8,
  /** Forward acceleration at zero speed (m/s^2). Tuned for 0-100 km/h in ~2.7 s. */
  engineAccel: 13.2,
  /** Braking deceleration (m/s^2). */
  brakeDecel: 26,
  /**
   * Fraction of the brake force that also scrubs sideways velocity. The brakes act on the
   * velocity vector, not on the car's forward axis: at a big slip angle most of the speed is
   * sideways, so 1 here would kill a drift stone dead and 0 would let the brake drive the
   * forward component straight through zero into reverse while the car is still moving.
   */
  brakeLateralShare: 0.6,
  /** Brake effectiveness while the throttle is also held: left-foot braking fights the engine. */
  brakeThrottleFight: 0.55,
  /** Speed at which the forward weight transfer under braking is fully developed (m/s). */
  brakeLoadSpeed: 6,
  /** Yaw-budget multiplier at full forward weight transfer. The loaded front bites and turns in. */
  brakeYawGain: 1.4,
  /** Lateral-grip-cap multiplier at full forward weight transfer. Pulls the car toward the apex. */
  brakeFrontBite: 1.25,
  /** Self-aligning multiplier at full forward weight transfer. The light rear keeps rotating. */
  brakeAlignScale: 0.7,
  /** Slide floor held by the unloaded rear under braking while already sliding (0..1). */
  brakeRearUnload: 0.35,
  /** Reverse acceleration (m/s^2). */
  reverseAccel: 9,
  /** Rolling / air drag: longitudinal deceleration factor per second. */
  rollingDrag: 0.02,
  /** Quadratic drag coefficient (applied as v^2 * coeff). */
  airDrag: 0.0004,
  /** Constant rolling resistance opposing motion (m/s^2). */
  rollingResistance: 0.6,
  /** Extra deceleration while neither throttle nor brake is applied (m/s^2). */
  engineBrake: 1.8,
  /**
   * Engine falloff reference: the power curve reaches zero at
   * `maxSpeed * powerCurveRef`, so the car still pulls near its top speed.
   */
  powerCurveRef: 1.16,
  /** Speed (m/s) at which the nitro boost is fully available (ramped in from 0). */
  nitroRampSpeed: 10,
  /** Fraction of the nitro boost applied when nitro is held without throttle. */
  nitroIdleThrottle: 0.4,
  /** Below this forward speed a held brake may become reverse (m/s). */
  brakeToReverseSpeed: 0.5,
  /**
   * Total speed — forward AND sideways — below which the car counts as stopped for reverse
   * (m/s). A car sliding sideways is not stopped, so the brake cannot flip it into reverse.
   */
  reverseSpeedWindow: 1.2,
  /** Seconds the brake must be held at that standstill before reverse engages. */
  reverseArmTime: 0.35,
  /** Max steering angle at standstill (rad). */
  maxSteerAngle: 0.55,
  /** Steering angle at max speed (rad). Steering tightens with speed for stability. */
  maxSteerAngleHighSpeed: 0.22,
  /** Shape of the steering-vs-speed falloff (<1 tightens early, >1 keeps lock longer). */
  steerSpeedCurve: 0.7,
  /** How fast the steering angle moves toward the input (1/s). High = responsive. */
  steerRate: 16,
  /** How fast the steering returns to center (1/s). */
  steerReturnRate: 20,
  /** Wheelbase (m), used for kinematic turning. */
  wheelbase: 2.6,
  /** Track width (m). Visual only. */
  trackWidth: 1.6,
  /** Lateral grip: how quickly lateral velocity is bled off while gripping (1/s). */
  gripLateral: 11,
  /** Lateral grip while drifting / handbraking (1/s). Lower = more slide. */
  gripLateralDrift: 2.2,
  /** Grip circle: max lateral acceleration while gripping (m/s^2). Caps turn tightness. */
  maxLatAccel: 16,
  /** Max lateral acceleration while fully sliding (m/s^2). Lower = the slide carries. */
  maxLatAccelDrift: 12,
  /** Speed floor used when converting the lateral budget into a yaw rate cap (m/s). */
  yawLimitMinSpeed: 3,
  /** Extra yaw authority while drifting so the player can hold and steer the slide. */
  driftYawGain: 1.7,
  /**
   * Self-aligning rate while drifting (1/s): how strongly the nose rotates back toward the
   * velocity direction. Low = the slide holds; this is what makes drifts forgiving.
   */
  driftStability: 1.65,
  /** Self-aligning rate while gripping (1/s). Keeps the car straight and stable. */
  alignGrip: 3.2,
  /** Below this forward speed no self-aligning torque is applied (m/s). */
  alignMinSpeed: 1.5,
  /** Speed range over which the self-aligning torque fades in above `alignMinSpeed` (m/s). */
  alignFadeSpeed: 2,
  /** Slip angle beyond which the anti-spin assist ramps up (rad). ~55 deg. */
  spinGuardSlip: (55 * Math.PI) / 180,
  /** Extra self-aligning rate per radian of slip beyond `spinGuardSlip`. */
  spinGuardGain: 3,
  /** Slip angle where the car starts losing grip on its own (rad). ~6 deg. */
  slideSlipStart: (6 * Math.PI) / 180,
  /** Slip angle at which the car is fully in drift mode (rad). ~22 deg. */
  slideSlipFull: (22 * Math.PI) / 180,
  /** Fraction of the slide that survives when throttle and steering are released (0..1). */
  slideReleaseFloor: 0.85,
  /**
   * How fast the rear can break away, at full commitment (1/s). The axle does not let go in
   * one tick: `slide` chases its target through a first-order ramp, and this is the ceiling
   * of that ramp's rate.
   */
  slideBreakRate: 12,
  /**
   * Fraction of `slideBreakRate` available at the instant traction starts to go (0..1). The
   * rate climbs from here toward 1 as the slide develops, so the break-out is an S-curve —
   * a soft first few degrees, then the tail running away — instead of a step. Lower = the
   * car hangs on longer before it lets go.
   */
  slideBreakEase: 0.22,
  /**
   * Shape of that climb: the rate scales with `slide ** slideBreakCurve`. Below 1 the rate
   * picks up early (the loss accelerates soon after it starts); above 1 it stays soft for
   * longer and then snaps.
   */
  slideBreakCurve: 0.7,
  /** Break-away rate while the handbrake is pulled (1/s). A yank is meant to snap — but not instantly. */
  slideHandbrakeRate: 22,
  /**
   * How fast the tyres take hold again when the slide target drops (1/s). Deliberately
   * quicker and uncurved: losing the rear should be progressive, catching it should not lag.
   */
  slideRegripRate: 9,
  /** Speed above which throttle + hard steering can break traction (m/s). ~70 km/h. */
  powerSlideSpeed: 19.4,
  /** Speed range over which power oversteer ramps in above `powerSlideSpeed` (m/s). */
  powerSlideSpeedRamp: 8,
  /** Steering input above which power oversteer starts (0..1). */
  powerSlideSteer: 0.55,
  /** Maximum slide produced by power oversteer alone (0..1). Below 1 = milder than handbrake. */
  powerSlideGain: 0.95,
  /** Slide multiplier while counter-steering: lower = the car regrips when you catch it. */
  counterSteerGrip: 0.45,
  /** Self-aligning multiplier while counter-steering. Above 1 = the slide is easy to catch. */
  counterSteerAssist: 1.6,
  /** Handbrake longitudinal deceleration (m/s^2). */
  handbrakeDecel: 8,
  /**
   * Fraction of that deceleration the locked rear also scrubs off sideways velocity (0..1).
   * Kept well below 1 so a held pull still slides, but above 0 so a car sitting sideways on
   * the handbrake actually bleeds speed instead of coasting across the junction.
   */
  handbrakeLateralShare: 0.12,
  /** Minimum speed for handbrake to kick the rear out (m/s). Gates *starting* a pull. */
  handbrakeMinSpeed: 8,
  /**
   * Speed below which a pull already under way finally dies (m/s). Well under
   * `handbrakeMinSpeed`: throwing the car at a junction is a decision made at speed, and a
   * rotation that is already happening should not stop dead just because the scrub worked.
   */
  handbrakeHoldMinSpeed: 3,
  /** Speed range above `handbrakeHoldMinSpeed` over which the kick reaches full strength (m/s). */
  handbrakeKickRamp: 4,
  /** Yaw kick from a flick of the handbrake, before the hold ramp adds to it (rad/s). */
  handbrakeYawKick: 1.35,
  /** Yaw kick once the pull has been held long enough to reach full authority (rad/s). */
  handbrakeHoldYawKick: 4,
  /** Seconds a pull counts as a flick before the hold ramp starts. Below this, nothing changes. */
  handbrakeTapTime: 0.14,
  /** Seconds of holding, past `handbrakeTapTime`, to reach full pull authority. */
  handbrakeHoldRamp: 0.5,
  /**
   * Rotation a flick of the handbrake is allowed to add before its kick fades out (rad). ~45
   * deg: the old fixed slip fade, expressed as the angle it used to buy.
   */
  handbrakeTapAngle: (45 * Math.PI) / 180,
  /**
   * Rotation a fully held pull is allowed to add (rad). ~175 deg, so holding the button for
   * about a second swings the nose all the way round - the reverse entry - and no further.
   */
  handbrakeHoldAngle: (175 * Math.PI) / 180,
  /** Rotation over which the kick eases off as the budget above runs out (rad). */
  handbrakeAngleFade: (30 * Math.PI) / 180,
  /**
   * Self-aligning rate left while a pull is at full authority (0..1). Locked rear tyres make
   * no aligning force, so a held handbrake is what lets the nose keep coming round past the
   * angle the spin guard would otherwise defend.
   */
  handbrakeAlignScale: 0.18,
  /**
   * Throttle effectiveness while fully sliding (0..1). Holding a drift is done on the power:
   * sideways tyres scrub hard, and this is the drive that pays for it. It was half that while
   * the body rotation was quietly manufacturing speed (see step 6 of `stepVehicle`); with that
   * gone, the engine has to actually do the job or a drift just decays into a spin.
   */
  driftThrottleScale: 0.7,
  /** Longitudinal scrub per m/s of lateral speed while sliding (1/s). */
  driftDrag: 0.14,
  /** Minimum speed to consider the car "moving" for direction/steering logic (m/s). */
  movingThreshold: 0.5,
  /** Collision restitution (0..1). */
  restitution: 0.25,
  /** Speed retained along the wall after a real impact (0..1). Applied once per hit. */
  collisionSlide: 0.85,
  /**
   * Speed into a surface (m/s) above which contact counts as an impact — bounce, scrub and a
   * collision event — rather than the car merely leaning on the wall. Below it the wall only
   * takes the into-the-wall velocity away, so a car scraping along a barrier keeps moving.
   */
  wallImpactSpeed: 2.5,
  /** Along-the-wall deceleration while scraping a surface (m/s^2). Panel damage, not a brake. */
  wallScrapeDecel: 4,
  /** Speed below which a car pressed nose-first into a surface may pivot off it (m/s). */
  wedgeSpeed: 3,
  /** How fast that pivot turns the car at full throttle (rad/s). */
  wedgeYaw: 1.1,
  /** Collision proxy radius (m). */
  collisionRadius: 1.1,
  /** Wheel radius (m). */
  wheelRadius: 0.33,
  /**
   * Fraction of gravity felt along a road's grade (0 = hills are free, 1 = real). Kept low:
   * the ramps onto the viaducts should cost a gear, not the run.
   */
  gradeGravity: 0.45,
};

/**
 * Drivetrain: a six-speed automatic with a real engine rpm, so the tachometer is a gameplay
 * instrument and not just a picture of road speed.
 *
 * MODEL (`src/sim/drivetrain.ts`)
 *  - Road rpm in a gear is linear through zero: `speed / gearTop`. The box upshifts at a gear's
 *    top and downshifts with hysteresis, so a shift lands at 60-85% and not at idle.
 *  - Under throttle the engine can rev *above* road rpm: that excess is wheelspin. How far it
 *    can rev is the torque at the wheels, `spinAuthority` per gear: first gear spins at a
 *    standstill, third needs real road speed before the band is reachable, sixth never spins.
 *  - Wheelspin only reads inside the torque band (`bandLow`..`bandHigh`); above it the engine
 *    is bouncing off the limiter. The rear only spins with a reason (a slide already under way
 *    or a drift being held), so a straight-line launch revs and shifts like any automatic.
 *  - The manual box (`GameState.transmission`) gives the player the gear, and with it a gear
 *    that will not shift out from under a slide and a limiter that caps the car at the gear's
 *    top speed. The automatic picks for them.
 *
 * SCOPE: this is a longitudinal and presentational system. `wheelspin` drives the tacho and the
 * engine note; it is NOT an input to the handling model. The slide is owned entirely by
 * `src/sim/vehicle.ts` (slip angle, handbrake, power oversteer, left-foot brake), and the car
 * slides identically on either box. Keep it that way — the gearbox is a gearbox.
 */
export const DRIVETRAIN = {
  /**
   * Top speed of each gear as a fraction of the reference speed (flat out with nitro lit,
   * `REF_SPEED` in `src/sim/drivetrain.ts`). Road rpm = speed / top, so the note drops on
   * every upshift to the ratio of consecutive tops.
   */
  gearTops: [0.13, 0.28, 0.45, 0.64, 0.83, 1.0],
  /** The auto drops a gear once the lower gear would sit at or below this rpm (0..1). */
  downshiftRpm: 0.85,
  /**
   * The auto also shifts up when the *engine* reaches this rpm (0..1), wheelspin included —
   * a real automatic reads revs, not road speed. That is what makes it hard to hold a drift
   * on: rev into the band with the rear spinning and it shifts up from under you, dropping
   * the needle out of the band in a taller gear with less torque to climb back.
   */
  autoUpshiftRpm: 0.82,
  /** Excess rpm (rpm01) above which the auto reads the revs as free-revving and shifts on them. */
  autoSpinShift: 0.1,
  /** Road rpm below which the auto never shifts on revs: a standing burnout stays in first. */
  autoUpshiftMinRoad: 0.25,
  /** Seconds the auto holds a gear after such a rev-triggered upshift, so it does not hunt. */
  autoShiftHold: 1.0,
  /** How fast the engine revs up above road rpm under throttle (rpm01/s). ~0.4 s idle to redline. */
  revRiseRate: 2.4,
  /** How fast the excess falls back to road rpm when the throttle lifts (rpm01/s). */
  revFallRate: 2.0,
  /**
   * Torque at the wheels per gear: the most the engine can rev above road rpm (rpm01). This is
   * what makes a first-gear donut possible at walking pace and a third-gear one need 40 km/h.
   */
  spinAuthority: [1, 0.45, 0.22, 0.08, 0.03, 0],
  /**
   * Extra authority while the rear is already loose: an unloaded, sliding rear spins in any
   * gear up to fourth, so a held drift can be over-revved (and has to be modulated) at speed.
   */
  slideSpinBonus: 1.5,
  /** Excess rpm over road rpm at which the drive wheels count as fully spinning (rpm01). */
  spinFull: 0.2,
  /** Bottom of the torque band (rpm01, 0 idle .. 1 redline). ~6000 rpm on the dial. */
  bandLow: 0.6,
  /** Top of the torque band; above it the engine is bouncing off the limiter. ~8200 rpm. */
  bandHigh: 0.88,
  /** rpm range below `bandLow` over which torque ramps in from nothing. */
  bandRamp: 0.15,
  /**
   * Seconds against the limiter before its penalties are fully in. A flick with the key held
   * is forgiven; a drift held that way for a couple of seconds is not.
   */
  overRevGrace: 0.8,
  /** Deceleration that holds a locked gear at its top speed (m/s^2). */
  limiterDecel: 6,
  /**
   * Banging off the limiter (manual box only — the automatic shifts up before it can happen).
   * Pinned at redline the ECU cuts fuel in a square wave instead of holding a smooth note:
   * `limiterCutHz` cycles a second, fuel off for `limiterCutDuty` of each one. That stutter is
   * the "ta-ta-ta-ta-ta" — the cut kills drive, drops the needle by `limiterCutDip`, mutes the
   * note and lights the exhaust, all off the one flag (`VehicleState.limiterCut`).
   */
  limiterCutRpm: 0.985,
  /** Cuts per second. ~11 Hz is fast enough to machine-gun, slow enough to hear each one. */
  limiterCutHz: 11,
  /** Fraction of each cycle with the fuel off. */
  limiterCutDuty: 0.45,
  /** How far the needle drops on a cut (rpm01): the bounce off the limiter. */
  limiterCutDip: 0.05,
  /** Throttle below which the limiter just backs off quietly instead of banging. */
  limiterCutThrottle: 0.2,
  /**
   * Drive left at idle in a tall gear (fraction): a manual box lugging in third at walking
   * pace pulls weakly until the revs come up. First gear is exempt (the clutch slips it away).
   */
  lugDrive: 0.3,
  /** rpm01 at which the lugging penalty is fully gone. */
  lugRpm: 0.3,

  /* PRESENTATION ONLY: how big a shove a gear change gives the body. See
   * `drivetrain.shiftKickStrength` and `render/scene/bodyAttitude.ts:kick`. */
  /** Step in engine rpm (rpm01) at which a shift kicks the body its hardest. First into second
   * at redline is about 0.54, so the short gears saturate and sixth arrives with a nudge. */
  shiftKickFullStep: 0.45,
  /** Fraction of the kick a shift taken with the throttle shut still gives. */
  shiftKickIdle: 0.35,
};

/**
 * Body attitude on the springs: roll in corners, dive under braking, squat on power.
 *
 * PRESENTATION ONLY — the simulation never reads this block. `src/render/scene/bodyAttitude.ts`
 * runs a spring-damper per axis, driven by `VehicleState.latAccel` / `.longAccel`, and
 * `carVisual` applies the result to the chassis group while the wheels stay planted.
 *
 * The car is a low, stiffly sprung drift build, so the angles are small on purpose: the point
 * is a readable weight transfer, not a wallowing sedan. Keep the limits where they are —
 * they are what stops the side skirts from sinking into the road on a collision spike.
 */
export const BODY = {
  /** Roll per m/s^2 of lateral acceleration (rad). ~3 deg at `VEHICLE.maxLatAccel`. */
  rollPerLatAccel: 0.0033,
  /** Lateral acceleration above which roll stops growing (m/s^2). */
  latAccelClamp: 22,
  /** Hard cap on the roll target (rad). ~3.4 deg. */
  rollLimit: 0.06,
  /** Roll spring frequency (rad/s). Higher = stiffer, settles sooner. */
  rollFrequency: 11,
  /** Roll damping ratio. Under 1 leaves a small overshoot — that is the inertia cue. */
  rollDamping: 0.62,
  /** Pitch per m/s^2 of longitudinal acceleration (rad). ~1.7 deg under full braking. */
  pitchPerLongAccel: 0.0011,
  /** Longitudinal acceleration clamp (m/s^2). A collision dumps far more than this in a tick. */
  longAccelClamp: 40,
  /** Hard cap on the pitch target (rad). ~2.6 deg. */
  pitchLimit: 0.045,
  /** Pitch spring frequency (rad/s). Pitch is stiffer than roll on this car. */
  pitchFrequency: 13,
  pitchDamping: 0.7,
  /** Largest sub-step the spring integrator takes (s). Long frames are split, not skipped. */
  maxStepDt: 1 / 120,

  /* ------------------------------------------------------------ gear change
   * A shift is a torque interruption: drive cuts, the car stops pulling for a moment, the
   * body runs forward on its mounts, then drive comes back and shoves it home. The
   * accelerations behind that happen inside one tick, so `longAccel` never really sees them
   * — the shift is fed to the springs as an impulse instead (`BodyAttitude.kick`), and the
   * under-damped springs turn it into the dip-and-settle by themselves.
   *
   * Strength (0..1) comes from `drivetrain.shiftKickStrength`: how big a step in engine rpm
   * the new ratio is, and how much throttle was being interrupted.
   *
   * The pitch and roll kicks run on their own springs rather than the corner/brake ones
   * above, so tuning how a shift feels never touches how the car leans or dives — only
   * `surge` (fore-aft) had that separation before; pitch and roll now get it too. Their
   * frequencies sit at half of the corner/brake springs' on purpose: a slower spring with
   * half the impulse traces the same peak angle but takes twice as long to get there and
   * come back, which is what actually reads as "slower" rather than "smaller". */
  /** Pitch velocity an upshift injects at full strength (rad/s). Nose drops, then rebounds. */
  shiftPitchImpulse: 0.25,
  /** Fore-aft velocity a shift injects at full strength (m/s): the body lurching on its mounts. */
  shiftSurgeImpulse: 0.21,
  /** Roll velocity a shift injects (rad/s): torque reaction always rocks the body the same way. */
  shiftRollImpulse: 0.06,
  /** Hard cap on the shift's own pitch contribution (rad), on top of whatever braking/power owns. */
  pitchKickLimit: 0.05,
  /** Hard cap on the shift's own roll contribution (rad), on top of whatever cornering owns. */
  rollKickLimit: 0.03,
  /** How far the body may travel fore-aft (m). ~3 cm; the wheels stay where they are. */
  surgeLimit: 0.03,
  /** Shift-pitch spring frequency (rad/s): half of `pitchFrequency`, so the dip plays out slow. */
  shiftPitchFrequency: 6.5,
  shiftPitchDamping: 0.7,
  /** Shift-roll spring frequency (rad/s): half of `rollFrequency`. */
  shiftRollFrequency: 5.5,
  shiftRollDamping: 0.62,
  /** Surge spring frequency (rad/s): half of the original 17 — the lurch takes twice as long. */
  surgeFrequency: 8.5,
  /** Surge damping ratio. Low enough to leave the one rebound that reads as the shift. */
  surgeDamping: 0.5,
  /**
   * A downshift kicks the other way at this fraction of an upshift's impulse: the lower gear
   * grabs and shoves the body back, where the upshift's cut lets it run forward.
   */
  downshiftScale: 0.85,
};

export const DRIFT = {
  /** Minimum speed for a valid drift (m/s). 25 km/h. */
  minSpeed: 25 / 3.6,
  /** Slip angle above which the car is considered sliding (rad). ~12 degrees. */
  slipEnter: (12 * Math.PI) / 180,
  /** Slip angle below which a drift may lapse (rad). ~7 degrees, hysteresis for forgiveness. */
  slipExit: (7 * Math.PI) / 180,
  /** Seconds of slip required before a drift becomes active. */
  activationTime: 0.2,
  /** Seconds a drift survives without meeting slip conditions. */
  cancelGrace: 0.35,
  /** Seconds after a drift ends in which the next one continues the chain. */
  chainWindow: 1.5,
  /** Base lightning charge generated per second of valid drift. */
  chargePerSecond: 8,
  /** Extra charge per second per chain level, capped by `maxChainBonus`. */
  chargeChainBonus: 4,
  maxChainBonus: 4,
  /** Extra charge multiplier per radian of slip angle (rewards bigger angles). */
  chargeAngleGain: 1.6,
  /** Slip angle beyond which the angle bonus stops growing (rad). ~45 deg. */
  chargeAngleCap: (45 * Math.PI) / 180,
};

export const NITRO = {
  capacity: 100,
  /** Units consumed per second while boosting. */
  drainPerSecond: 28,
  /** Units restored per second while moving and not boosting. */
  rechargePerSecond: 9,
  /** Delay before recharging resumes after boost ends (s). */
  rechargeDelay: 0.6,
  /** Minimum speed to recharge (m/s). No recharge while stationary. */
  rechargeMinSpeed: 3,
  /** Minimum amount to start a boost. */
  minToActivate: 8,
  /** Extra acceleration while boosting (m/s^2). */
  boostAccel: 20,
  /** Extra max speed while boosting (m/s). */
  boostMaxSpeedBonus: 14,
};

export const LIGHTNING = {
  capacity: 100,
  /**
   * WHAT A SHOT COSTS is not one number, because a shot is not one thing: the gun is loaded by
   * holding it, and it draws charge the whole time it is being loaded. `minCost` is taken at
   * the press — the down payment on the shortest shot that is not a fumble — and the rest is
   * drawn steadily over `maxHold`, so a full-reach bolt costs `cost` and a snap shot costs
   * little more than the down payment. The meter drains as the player holds, which is the
   * whole point: the trade between reach and ammunition is visible while it is being made,
   * not discovered afterwards.
   *
   * A hold the meter cannot pay for simply stops growing — the shot is still there, it just
   * reaches as far as the charge bought. And a fumble refunds every unit it took, because
   * nothing left the car.
   */
  /** Charge a full-reach shot costs, spent gradually across the hold. */
  cost: 50,
  /** Charge taken at the press. The floor under every shot, and what a snap shot costs. */
  minCost: 14,
  /**
   * The shot is aimed, not locked on: it leaves the nose along the car's heading and stops at
   * whatever `range` the hold bought. Nothing curves towards a car, so pointing counts.
   */
  /** Reach of a fully charged shot (m). A shorter hold reaches proportionally less far. */
  range: 75,
  /** Seconds of held fire for a full-range shot. The shot leaves on its own at this point. */
  maxHold: 1,
  /** A hold shorter than this is a fumble: nothing leaves, nothing is spent. */
  minHold: 0.12,
  /** How far off the beam's line a car may be and still be hit (m). Roughly a car's width. */
  hitRadius: 2.2,
  /** Seconds between shots. */
  cooldown: 0.35,
  /** Seconds the arc stays visible. */
  arcDuration: 0.45,
};

export const TARGETS = {
  reward: 100,
  /** Patrol speed of electric cars (m/s). Slow and homogeneous. */
  patrolSpeed: 6,
  /** Distance to a waypoint at which the next waypoint is selected (m). */
  waypointRadius: 3,
  /** Seconds a destroyed target stays in the world before respawning at its spawn. -1 = never respawn. */
  respawnDelay: 12,
  /**
   * Physical bump when the player drives into an electric car. Arcade, not realistic: the car
   * is light, gets shoved a bit harder than momentum alone would (`transfer` > 1), and the
   * player barely loses speed so it never feels like hitting a wall.
   */
  knock: {
    /** Collision proxy radius of an electric car (m). */
    radius: 1.1,
    /** Approach speed -> target knock velocity multiplier. >1 sends them flying a little. */
    transfer: 1.9,
    /** Fraction of the player's into-the-car speed kept after the bump (soft, not a wall). */
    playerRetain: 0.82,
    /** How fast the knock velocity decays back to 0 (1/s). Lower = the car slides further. */
    damping: 2.6,
    /** Share of the overlap separation pushed onto the target (rest onto the player). */
    targetPush: 0.7,
    /** Minimum approach speed to register a bump event for feedback (m/s). */
    minImpact: 1.2,
  },
  /**
   * How electric cars behave towards EACH OTHER (`src/sim/targets.ts`).
   *
   * Patrol loops share streets and junctions, so two cars regularly want the same piece of
   * road at the same moment. Left alone they drove straight through one another, which is
   * the one thing traffic can do that no amount of lighting will excuse.
   *
   * Two mechanisms, in that order of preference. `lookahead`/`halfWidth` are a lane-shaped
   * cone in front of each car: anything inside it makes the car lift off and, close enough,
   * stop — so most conflicts are settled before they are collisions. `contact` is the
   * backstop for the ones that are not (a car shoved by the player, a junction taken at an
   * angle the cone missed): the two are pushed apart and given a knock, so a crossing reads
   * as a shunt rather than a merge.
   */
  traffic: {
    /** How far ahead a car watches for another car in its lane (m). */
    lookahead: 11,
    /** Half-width of that lane (m). Wider than a car, so a near-lane pass still registers. */
    halfWidth: 2.3,
    /** Clear road ahead below which the car is stopped outright (m). */
    stopGap: 3.6,
    /** How hard a car may slow for the one in front (m/s^2). Brisk: it must not be rammed. */
    brake: 16,
    /** How fast it picks the patrol speed back up once the road clears (m/s^2). */
    accel: 4.5,
    /** Centre distance at which two cars are touching (m). Two `knock.radius` and a margin. */
    contactDistance: 2.5,
    /** Fraction of the closing speed turned into a knock when they touch anyway. */
    bounce: 0.45,
    /** Ceiling on that knock (m/s), so a corner case cannot fire a car across the street. */
    maxBounce: 3,
  },
};

/**
 * Contact between two PLAYERS' cars in a multiplayer race (`src/sim/rivalCollision.ts`).
 *
 * Separate from `TARGETS.knock` because the situation is not the same. An electric car is a
 * local object this client may shove around; a rival is being driven by somebody else's
 * machine and cannot be moved from here at all. Each client can only move its own car, and
 * both do it at the same time — which is why `separate` is a little over half the overlap
 * rather than all of it. Any more and a door-to-door pass flings both cars apart; any less
 * and they sink into each other before the two corrections add up.
 */
export const RIVALS = {
  /** Collision proxy radius of a rival (m). Same circle the local car uses on itself. */
  radius: 1.1,
  /** Share of the overlap this client resolves by moving its own car. */
  separate: 0.62,
  /** Fraction of the closing speed kept after a bump. Below `TARGETS.knock.playerRetain`:
   *  hitting a car that is fighting back costs more than shoving traffic aside. */
  retain: 0.6,
  /** Push back out of the contact, as a fraction of the closing speed. */
  bounce: 0.3,
  /** Sideways rub: fraction of the along-the-contact speed kept while scraping. */
  slide: 0.94,
  /** Minimum closing speed that registers a bump event for sparks and camera shake (m/s). */
  minImpact: 1.4,
};

/**
 * Near miss: points for shaving past an electric car at speed without touching it.
 *
 * A pass is tracked from the moment the player enters `radius` of an active target and is
 * scored when they leave again (`exitRadius`, a little wider so skimming the edge cannot
 * flicker two passes out of one). The award is driven by the two things the player controls:
 * how close they got and how fast they were going. Touching the car voids the pass entirely -
 * a near miss has to be a miss.
 *
 * `contactDist` is the centre distance at which the collision proxies already overlap, so
 * closeness is measured over the ~1.8 m of clearance that actually exists between "touching"
 * and "not a near miss any more".
 */
export const NEAR_MISS = {
  /** Centre distance at which a pass starts being tracked (m). */
  radius: 4,
  /** Centre distance at which a pass is considered over (m). Wider than `radius`, for hysteresis. */
  exitRadius: 4.6,
  /** Centre distance at which the two collision proxies touch (m). Below this it is a bump. */
  contactDist: VEHICLE.collisionRadius + TARGETS.knock.radius,
  /**
   * Clearance (m) above `contactDist` at which closeness is already full. A hair of margin,
   * so the ceiling is reachable at all instead of sitting one rounding step out of reach.
   */
  grazeClearance: 0.15,
  /** Slack above `contactDist` treated as contact, so a resolved bump never scores. */
  contactSlack: 0.02,
  /**
   * Metres the gap has to reopen past the closest approach before the pass is called done and
   * paid. Small, so the award lands while the car is still alongside and on screen, but above
   * the per-tick jitter of two cars running parallel.
   */
  apexSlack: 0.05,
  /** Minimum speed for a pass to score at all (m/s). ~65 km/h. */
  minSpeed: 18,
  /** Speed at which the speed factor saturates (m/s). Above the un-boosted top speed on purpose. */
  fullSpeed: 59,
  /**
   * Seconds after a pass in which the next one counts as part of the same run of them. Used by
   * presentation only - the HUD tally counts up in place inside this window (`ui/hud.ts`) and
   * the reward chime climbs a step (`audio/oneShots.ts`). One number so the two never disagree.
   */
  chainWindow: 1.6,
  /** Award floor for any qualifying pass. */
  minPoints: 10,
  /** Award ceiling. Only a paint-scraping pass on nitro gets here. */
  maxPoints: 50,
  /** Exponent on closeness. >1 = the last half metre is worth far more than the first. */
  closenessCurve: 1.5,
  /** Exponent on the speed factor. */
  speedCurve: 1.3,
  /** Exponent on the combined quality. Pushes the ceiling out of reach of a merely good pass. */
  qualityCurve: 1.35,
};

export const CAMERA = {
  /** Base vertical FOV in degrees. */
  fov: 60,
  /** FOV while nitro is active. */
  fovNitro: 70,
  /** Distance behind the car (m). */
  distance: 5.2,
  /** Extra distance while nitro is active (m). */
  nitroPullback: 0.45,
  /** Height above the ground (m). */
  height: 2.1,
  /** Height of the look-at point (m). */
  lookHeight: 1.7,
  /** How far ahead of the car the look-at point sits (m). Puts the car low in frame. */
  lookAhead: 6.5,
  /** Extra look-ahead per m/s of speed (m). More road visible when going fast. */
  lookAheadPerSpeed: 0.05,
  /** Upper bound for the look-ahead distance (m). */
  lookAheadMax: 10,
  /** Look-ahead while reversing (m). Short, so the car stays readable. */
  reverseLookAhead: 2.2,
  /** Position smoothing rate (1/s). */
  positionDamping: 14,
  /** How much the camera follows velocity direction instead of heading during drift (0..1). */
  driftFollow: 0.55,
  /** Same blend while gripping. Small, so the camera mostly sits behind the nose. */
  followBlend: 0.18,
  /** Hard cap between camera yaw and car heading (rad). Keeps the car inside the frame. */
  maxFollowOffset: (40 * Math.PI) / 180,
  /** Lateral camera lag per m/s of sideways speed (m). Gives drifts a small trailing feel. */
  lateralLag: 0.09,
  /** Cap for the lateral lag offset (m). */
  lateralLagMax: 1.2,
  /** Smoothing rate of the lateral lag (1/s). */
  lateralLagDamping: 5,
  /** Rotation smoothing rate (1/s). */
  rotationDamping: 5,
  /** Hard cap on how fast the camera yaw may turn (rad/s). Kills whip during flicks. */
  maxYawRate: 2.6,
  /** FOV smoothing rate (1/s). */
  fovDamping: 5,
  /** Far clip plane (m). Past the fog everything is fog colour anyway; this only has to reach the skyline. */
  far: 900,
  /** How much of the road's grade ahead the chase camera's look point follows (0..1). */
  pitchFollow: 0.7,
  /** Shake amplitude on nitro (m). */
  shakeNitro: 0.03,
  /** Shake amplitude on lightning (m). */
  shakeLightning: 0.12,
  /** Shake amplitude on collision per m/s of impact (m). */
  shakeCollisionPerImpact: 0.02,
  shakeDecay: 6,

  /**
   * Click-and-drag look (chase view only). Dragging on the canvas orbits the camera around
   * the car; letting go holds the new angle for `dragHold` seconds and then eases it back
   * behind the car so normal driving never leaves you stuck looking sideways.
   */
  dragYawPerPixel: 0.005,
  dragPitchPerPixel: 0.004,
  /** Vertical look limits (rad): a little under the car, well above it. */
  dragPitchMin: (-25 * Math.PI) / 180,
  dragPitchMax: (70 * Math.PI) / 180,
  /** Seconds the look angle is held after the drag ends before it recenters. */
  dragHold: 0.7,
  /** Recentring rate once the hold expires (1/s). */
  dragRecenterDamping: 3.5,
  /** Look offset (rad) at which the camera is fully aimed at the car instead of down the road. */
  dragLookBlend: 0.35,

  /**
   * Bolted-on camera views, cycled with P (chase -> front -> side -> chase). Unlike the chase
   * camera these are rigid mounts: the pose is written straight onto the camera with no
   * damping or lag, because a camera bolted to the bodywork should not trail the car — the
   * world moves, the lens does not.
   *
   * Every offset is in the car's own frame, in metres: `ahead` toward the nose (negative =
   * toward the tail), `side` toward the car's right (negative = left), `height` above the
   * road. The lens sits at that mount and aims at (`lookAhead`, `lookSide`, `lookHeight`) in
   * the same frame, so a look point behind the mount gives a rear-facing view.
   *
   * `rollFollow` / `pitchFollow` are the fraction of the body's roll and dive the lens
   * inherits (0 = a level horizon that reads as floating, 1 = the full body motion, which is
   * nauseating). Their sign flips with the direction the lens faces: a rear-facing mount sees
   * the same lean mirrored.
   *
   * `ridesBody` says the mount is bolted to the sprung shell rather than to the road: its
   * offsets are swung by the body's own roll and dive before they are placed, not just its
   * lens. Only the cabin view needs it, and it needs it badly — a lens sitting 40 cm from a
   * dashboard that leans without it would watch that dashboard swim around the frame.
   *
   * Body reference (`carVisual.ts`): nose at ahead 2.16, tail at ahead -2.24, flanks at
   * side ±1.0, roof at height 1.35.
   */
  mounts: {
    /**
     * Cabin view: the driver's own eyeline, just behind and above the wheel on the left-hand
     * seat, aimed level down the road. Not on P's rotation (see `VIEW_ORDER` in
     * `render/camera/chaseCamera.ts`); it is reached by name, through `setView`. The dashboard, the wheel and the sound system's
     * spectrum display (`render/scene/vehicles/interior.ts`) sit in the bottom of the frame,
     * which is the whole point of the view — so it is the one mount that rides the body
     * outright (`ridesBody`, both follows at 1) and keeps the cabin rock steady while the
     * world leans around it.
     *
     * The eye sits 11 cm below the headlining and about 60 cm back from the wheel, which is
     * further back than a driver really sits: the cabin is modelled at 42 cm of headroom, and
     * from any closer the wheel swallows the frame.
     */
    cabin: {
      ahead: -0.27,
      side: -0.33,
      height: 1.17,
      lookAhead: 9,
      lookSide: -0.33,
      lookHeight: 1.02,
      fov: 66,
      rollFollow: 1,
      pitchFollow: 1,
      ridesBody: true,
    },
    /**
     * Front view: the lens hangs just over 2 m off the nose looking back down the car, so the
     * whole front end fills the lower frame and the road behind you fills the rest. Aimed at
     * a point past the tail so anyone chasing stays in shot.
     *
     * It sits deliberately close. This mount is the one view whose lens lives out in the
     * world rather than on the bodywork, so anything the car is driving into — traffic, a
     * wall — reaches the lens before it reaches the bumper. Keeping the boom short bounds
     * that to the space the car is about to occupy anyway: if something is inside it, you
     * were about to hit it.
     */
    front: {
      ahead: 4.3,
      side: 0,
      height: 1.4,
      lookAhead: -1.4,
      lookSide: 0,
      lookHeight: 1,
      fov: 58,
      /** Facing backwards, so the body's lean arrives mirrored. */
      rollFollow: -0.45,
      pitchFollow: -0.45,
      ridesBody: false,
    },
    /**
     * Side-door view: a fender-mounted lens just outboard of the driver's-side skirt, aimed
     * forward and a touch inboard so the flank and front arch ride the edge of the frame with
     * the road opening up beside them.
     *
     * The lens sits at hub height rather than door height (wheel radius is 0.33, so the top of
     * the tyre is at 0.66 and the front wheel centre at 0.33): from up by the door the arch
     * only clipped the corner of the frame, while from here the whole front wheel stands above
     * the horizon line and the road rushes past under it. Dropping the look point with it
     * keeps the aim near level, so the view gains the wheel without losing the road ahead.
     */
    side: {
      ahead: 0.35,
      side: -1.3,
      height: 0.6,
      lookAhead: 9,
      lookSide: -0.95,
      lookHeight: 0.5,
      fov: 64,
      rollFollow: 0.45,
      pitchFollow: 0.45,
      ridesBody: false,
    },
  },
  /**
   * Near plane for the mounted views (m). The default 0.3 would slice into the bodywork from
   * a lens parked 30 cm off the door; 0.12 clears it and still leaves ample depth precision
   * against the 400 m far plane.
   */
  mountNear: 0.12,
  /** How much the mounted views widen on nitro (deg). Smaller than the chase camera's swing. */
  mountFovNitro: 6,
};

/**
 * Nitro speed blur (see `src/render/post/speedBlur.ts`). A radial smear that opens from the
 * edges of the frame while the boost is lit and the car is actually moving, so the world tears
 * past instead of just going faster. Postprocessing stays optional and cheap: nothing is
 * allocated and no extra pass runs until the first boost.
 */
export const SPEED_BLUR = {
  /** Forward speed at which the blur starts to appear while boosting (m/s). ~65 km/h. */
  speedStart: 18,
  /** Forward speed at which it reaches full strength (m/s). ~135 km/h. */
  speedFull: 37,
  /**
   * Total radial smear at full strength, as a fraction of the frame, at the very edge of the
   * screen. Small on purpose: past ~0.08 the neon turns into mush rather than streaks.
   */
  maxShift: 0.05,
  /**
   * Radius (0 = center of the frame, 1 = top/bottom edge) inside which the image stays sharp.
   * The car, the road ahead and the target being aimed at all live in here — readability first.
   */
  centerClear: 0.26,
};

/**
 * THE STORM SKY.
 *
 * Everything the atmosphere does, in one object. The sky is not a texture and not a skybox:
 * it is one inverted dome with a procedural shader (`render/scene/env/skyDome.ts`), and the
 * storm above the city is drawn by that shader every frame from noise, so nothing tiles and
 * nothing repeats. This block is the whole art direction of it; `__rb.atmosphere` writes to
 * these same fields live, so anything here can be tuned with the game running.
 *
 * Colours are sRGB hex, exactly as the palette writes them.
 */
export const ATMOSPHERE = {
  /**
   * `auto` picks `high` on a pointer device and `medium` on a touch one, which is the same
   * split the rest of the renderer makes. `low`, `medium` and `high` differ only in noise
   * octaves, whether the second cloud layer is drawn, dome tessellation and rain count —
   * never in colour, so the three look like the same sky at different resolutions.
   */
  quality: 'auto' as 'auto' | 'low' | 'medium' | 'high',

  /* ------------------------------------------------------------------ the gradient */

  /** Overhead. Near-black navy: the sky has to be the darkest thing in the frame. */
  zenith: 0x02050b,
  /** The body of the sky. Deep, desaturated teal. */
  middle: 0x0a1d25,
  /** Where the city's light hits the cloud base: a brighter cyan-grey industrial haze. */
  horizon: 0x24414b,
  /** How high the middle colour takes over from the horizon (0..1 of the upper hemisphere). */
  middleBand: 0.3,
  /**
   * How much of the sky above that the teal takes to become the navy. The zenith colour is
   * the last to arrive on purpose: reach it too early and the whole ceiling reads as black
   * and the clouds have nothing to be seen against.
   */
  zenithSpan: 0.55,
  /** Extra lift in the last few degrees above the skyline. 0 turns the glow off. */
  horizonGlow: 0.34,
  /** How tightly that lift hugs the horizon. Smaller is tighter. */
  horizonFalloff: 0.16,

  /* ------------------------------------------------------------------ the clouds */

  /** Thick cloud core. Storm cloud is not grey: it is a cold, dirty slate blue. */
  cloudDark: 0x070d14,
  /** Cloud edge, where the sky behind it shows through. The "silver" of a storm lining. */
  cloudLight: 0x39505c,
  /**
   * How much darker a bank reads when it is seen from underneath (0..1). Straight up you are
   * looking at the base of the cloud and it is nearly black; towards the skyline you see its
   * flank, turned to the city and catching its light. Without this the ceiling overhead
   * fills with pale grey and stops being the dark navy the sky is meant to be.
   */
  cloudUnderside: 0.55,
  /**
   * How much of the sky is cloud (0 = clear, 1 = overcast). This is the single value that
   * changes the weather most; 0.62 is the layered, broken cover of the reference.
   */
  coverage: 0.62,
  /** Softness of the cloud edge. Low is hard-edged and graphic, high is vapourous. */
  edgeSoftness: 0.34,
  /** Contrast inside the cloud mass. Above 1 pushes the thin stuff away and thickens cores. */
  contrast: 1.5,
  /**
   * Cloud scale, in noise cells across the plane each layer is projected onto. Low numbers
   * are the large, layered systems the reference has; raise it and the sky turns to popcorn.
   * Too low and the whole upper sky falls inside a single cell and goes flat, which is what
   * the projection does at the zenith: `d.xz` goes to zero there, so the scale has to be
   * generous enough that straight up still has structure in it.
   */
  scaleFar: 3.1,
  scaleNear: 1.8,
  /**
   * Drift, in noise units per second. Deliberately tiny: a storm ceiling barely moves, and
   * the near layer moving faster than the far one is the whole parallax cue. Never raise
   * these far — fast cloud is the fastest way to make a sky look like a screensaver.
   */
  driftFar: 0.0062,
  driftNear: 0.0135,
  /** How much the near layer's shape is bent by the far layer's. Kills any residual grid. */
  warp: 0.55,
  /** Master opacity of both layers. Below 1 leaves the gradient reading through the storm. */
  cloudOpacity: 0.94,

  /* ------------------------------------------------- light pollution */

  /** The city's glow on the underside of the cloud base. */
  pollutionColor: 0xd8348c,
  /** How hard it burns. This is the magenta in the reference; a little goes a long way. */
  pollution: 0.42,
  /** How far up the sky the glow reaches (0..1 of the upper hemisphere). */
  pollutionHeight: 0.42,
  /**
   * How far the glow is pushed into the thick parts of a layer. 1 spreads it evenly and
   * reads as a painted pink band along the skyline; higher values light the underside of a
   * few banks and leave the gaps between them dark, which is what the reference does.
   */
  pollutionFocus: 3.2,

  /**
   * Where cloud detail starts and finishes dissolving into haze, measured in noise cells per
   * radian of view — so it follows the projection rather than an angle, and a coarse layer
   * survives closer to the skyline than a fine one. Raise both to keep structure lower down;
   * lower them for a thicker, hazier horizon. They are also the anti-aliasing: below
   * `hazeEnd` the noise would run far past a pixel per cell and crawl.
   */
  hazeStart: 22,
  hazeEnd: 65,

  /* ------------------------------------------------------------------ aerial depth */

  /**
   * The haze distance dissolves into. Mixed `fogTint` of the way from the world's own fog
   * colour towards this, so each palette keeps its identity and gains the storm's blue-grey.
   */
  fogColor: 0x17313d,
  fogTint: 0.7,
  /**
   * Multipliers on whatever haze the world asked for (`plan.fog`). Above 1 is denser air:
   * distant buildings fade sooner. 1 leaves the world exactly as it was tuned.
   */
  fogDensityScale: 1.15,
  fogFarScale: 0.92,

  /* ------------------------------------------------------------------ lightning */

  storm: {
    /**
     * Strike rate multiplier. 1 is roughly one strike every 9-26 s; 0 turns the weather
     * lightning off entirely (the lightning WEAPON is `LIGHTNING`, and is unrelated).
     */
    frequency: 1,
    /** Seconds between strikes, before `frequency`. The gap is skewed towards the short end. */
    minGap: 9,
    maxGap: 26,
    /** Sub-flashes per strike. Never one: a single clean flash is what reads as fake. */
    minFlashes: 2,
    maxFlashes: 4,
    /** Seconds between sub-flashes inside one strike. */
    flashGapMin: 0.04,
    flashGapMax: 0.26,
    /** How long one sub-flash lasts, seconds. */
    flashDurationMin: 0.1,
    flashDurationMax: 0.34,
    /** Master brightness of a strike (0..1). The rest of the block scales off this. */
    intensity: 1,
    /** Colour of the flash: cold blue-white, the same family as the weapon's arc. */
    color: 0xcfe6ff,
    /**
     * How tightly the flash is focused on the part of the sky it came from. Higher is a
     * more local flash; low values wash the whole ceiling.
     */
    focus: 2.2,
    /** How far the flash lifts the fog. This is what turns distant blocks into silhouettes. */
    fogLift: 0.55,
    /** How far it lifts the two scene lights, as a fraction of their own intensity. */
    lightLift: 1.1,
    /**
     * How far it lifts the environment map, which is what the wet road and the car paint
     * reflect — the "everything wet flares for a moment" cue.
     */
    envLift: 1.6,
    /** How much brighter the rain gets in a flash. */
    rainLift: 1.4,
  },

  /* ------------------------------------------------------------------ rain */

  rain: {
    /** 0 removes the rain entirely: no geometry, no material, no draw call. */
    intensity: 0.55,
    /** Drops in the box at full intensity, before the quality preset scales it. */
    count: 2600,
    /** The box that follows the camera, in metres. */
    boxWidth: 70,
    boxHeight: 42,
    /** Fall speed (m/s) and streak length (m). */
    speed: 26,
    length: 1.5,
    /** Wind drift (m/s) on x and z. */
    windX: 2.4,
    windZ: -1.1,
    /** How far the camera's own motion tilts a streak back. 0 is dead vertical rain. */
    motionTilt: 0.16,
    color: 0xa8ccdc,
    /** Peak opacity of the head of a streak. */
    opacity: 0.3,
  },
};

export const RENDER = {
  maxPixelRatio: 1.5,
  /**
   * Resolution governor (`src/render/adaptiveResolution.ts`). The render scale starts at
   * `min(devicePixelRatio, maxPixelRatio)` and steps down by `resolutionStep` whenever the
   * display is dropping frames for `resolutionDownWindow` seconds, never below
   * `minPixelRatio`. It climbs back one notch at a time once there is measured headroom.
   * `?scale=1` locks a scale for testing; `adaptiveResolution: false` turns it off.
   */
  adaptiveResolution: true,
  minPixelRatio: 0.7,
  resolutionStep: 0.85,
  /** Frame interval (ms) above which a frame missed 60 FPS. */
  resolutionDownMs: 18.5,
  /**
   * Share of frames in the window allowed to miss `resolutionDownMs` before the scale steps
   * down, even when the AVERAGE still looks healthy.
   *
   * The average alone is blind on a high-refresh display. A 240 Hz panel presents whole
   * refreshes, so a game that mostly runs at 120 FPS but regularly slips to 40 averages about
   * 16 ms — under the threshold — while the player sees the cadence lurch on every slip, which
   * is exactly what reads as "not smooth". Counting the frames that actually missed catches
   * that; the average catches the steady case. Either one steps the scale down.
   */
  resolutionDownShare: 0.25,
  /** Average frame interval (ms) that proves a high-refresh display has headroom. */
  resolutionUpMs: 11,
  /** GPU ms per frame that leave enough room to step the scale up one notch. */
  resolutionGpuUpMs: 9,
  /** GPU ms per frame under which the GPU is clearly not what is stalling. */
  resolutionGpuIdleMs: 8,
  resolutionDownWindow: 1.5,
  resolutionUpWindow: 6,
  resolutionSettle: 1.0,
  /** Frames longer than this are hitches (compile, GC, tab switch), not load. */
  resolutionHitchMs: 66,
  /**
   * The haze is the mood. It starts early and closes fast so the skyline is always read
   * through blue air; anything past `fogFar` is pure fog colour, which is a lifted blue-teal,
   * never black.
   */
  fogNear: 20,
  fogFar: 165,
  shadowMapSize: 1024,
};

/**
 * All sound is synthesized at runtime with the Web Audio API (no asset files), to match the
 * procedural-everything approach used for textures and livery. Volumes are pre-limiter; a
 * gentle limiter on the master bus catches the peaks when several layers stack.
 */
export const AUDIO = {
  /** Master bus gain (0..1). Also the ceiling the mute toggle drops to 0. */
  masterVolume: 0.85,
  /** Player gas engine (fundamental + harmonics + combustion noise) mix level. */
  engineVolume: 0.22,
  /** Turbo whine level. Kept low so it seasons the engine, not dominates. */
  turboVolume: 0.07,
  /** Turbo flutter ("stututu") level on throttle lift. Its own knob so it cuts through the engine. */
  turboFlutterVolume: 0.5,
  /**
   * Exhaust backfire ("pops and bangs") level. Short and heavily clipped, so it is meant to sit
   * hot and push the master limiter — that momentary duck of the engine is part of the impact.
   */
  backfireVolume: 0.9,
  /**
   * How far a limiter fuel cut ducks the engine note (0..1, 1 = silent). The gaps are what the
   * ear hears as separate hits, so this wants to be deep — but not total: a fully silenced
   * engine between cracks reads as a dropout rather than as a car fighting its own ECU.
   */
  limiterCutDuck: 0.72,
  /** Strength of the exhaust bang fired on each limiter cut. */
  limiterCutBang: 0.45,
  /**
   * The chime when the car rolls onto a free-world activity marker. The arcade pickup idiom —
   * short, bright, rising — so stepping on the circle is confirmed by ear before the prompt has
   * finished animating in.
   */
  pickupVolume: 0.5,
  /**
   * Tire scrub/screech level while sliding. Driven by the same slide intensity as the smoke.
   * The howl is soft-clipped inside the voice, so its aggression comes from the drive stage
   * there and not from this knob — raising this only makes a slide loud.
   */
  tireVolume: 0.26,
  /** Per-car electric hover hum level. Deliberately near-silent. */
  humVolume: 0.05,
  /** Lightning zap one-shot level. */
  lightningVolume: 0.55,
  /** Electric-vehicle-out-of-service (power-down) one-shot level. */
  shutdownVolume: 0.5,
  /** Near-miss whoosh level. Scaled down further by how good the pass was. */
  nearMissVolume: 0.45,
  /**
   * The bright ping ON TOP of that whoosh: the whoosh is the physics, this is the reward. Held
   * a little under the whoosh so a long run of passes never turns into a xylophone solo.
   */
  nearMissChimeVolume: 0.3,
  /** Nitro spool whoosh level. */
  nitroVolume: 0.4,
  /** Race countdown beeps level. */
  countdownVolume: 0.35,
  /** Engine firing fundamental at idle (Hz) — a ~4-cylinder at ~850 rpm. */
  engineIdleHz: 28,
  /** Engine firing fundamental at redline (Hz). */
  engineRedlineHz: 220,
  /** Distance (m) within which an electric car hum is at full (small) volume. */
  humNear: 6,
  /** Distance (m) beyond which an electric car hum is inaudible. */
  humFar: 55,
  /**
   * How many hum voices exist at once. A voice is thirteen always-running Web Audio nodes,
   * and `humFar` means a car further away than that contributes exactly nothing — so the
   * open world's 126 cars would be 1,600-odd nodes rendering silence. The voices are pooled
   * instead and handed to the nearest cars in range (`src/audio/electricHum.ts`). Comfortably
   * more than can ever be within `humFar` at once; if it were not, the car dropped would be
   * the furthest one, which is the quietest.
   */
  humVoices: 12,
  /** Widest stereo pan applied to a spatialized electric hum (0..1). */
  maxPan: 0.85,
  /** The police (`audio/police.ts`, `audio/oneShots.ts`). */
  sirenVolume: 0.26,
  /** Metres: full loudness inside `sirenNear`, silent beyond `sirenFar` — heard before it is seen. */
  sirenNear: 10,
  sirenFar: 160,
  policeMotorVolume: 0.07,
  scannerVolume: 0.32,
  bustedVolume: 0.5,
  shieldVolume: 0.3,
};

/**
 * Background theme song + music-reactive lighting. The track loops quietly under the game and
 * its spectrum is split into three bands, each with its own envelope, so different families of
 * lights move to different parts of the song instead of all flashing together:
 *
 *   bass   kick and sub          punchy, hangs on the hit   -> the main neon mass, halos
 *   mid    snare, chords, body   late and wide, a swell     -> facades, breathing signs, board
 *   high   hats and shimmer      in and out in a frame      -> stutter tubes, roof beacons
 *
 * plus a very slow loudness follower (`energy`) that moves at the scale of bars, not hits, and
 * drives only the two scene lights. Everything here is deliberately understated: the song sets
 * the mood, it does not run the light show.
 */
export const THEME = {
  /** Path (served from public/) of the looping theme track. */
  src: '/rayo-bandido-theme.mp3',
  /** Playback gain (0..1). Background level — sits under the engine and effects. */
  volume: 0.32,
  /** Seconds to fade the track in when it first starts, so it does not stab in. */
  fadeInSeconds: 2.5,
  /**
   * The three analysis bands. Each is measured independently: the mean level in its frequency
   * window is compared to its own rolling baseline, the excess divided by `gain` to get 0..1,
   * then smoothed with its own attack/release. The envelopes are what give each group of lights
   * its own pacing — bass snaps and hangs, mid arrives late and lingers, high ticks.
   *
   * `loHz`/`hiHz` are real frequencies; the analyser maps them to bins from the live sample
   * rate, so the split survives a 48 kHz device. `baselineRate` is how fast the band forgets
   * (per frame): slow enough to average over a bar, fast enough to track a section change.
   */
  bands: {
    /** Kick and sub. Snaps up, decays over ~half a second. */
    bass: { loHz: 40, hiHz: 190, gain: 26, attack: 0.72, release: 0.1, baselineRate: 0.05 },
    /** Snare, chords, vocal body. Rises slowly and lets go slowly: a swell behind the kick. */
    mid: { loHz: 260, hiHz: 1800, gain: 20, attack: 0.2, release: 0.045, baselineRate: 0.04 },
    /** Hats, rides, transients. Nearly instant both ways, so it reads as a tick, not a pulse. */
    high: { loHz: 2600, hiHz: 9000, gain: 15, attack: 0.9, release: 0.34, baselineRate: 0.09 },
  },
  /**
   * The dashboard spectrum analyser: the bar display in the car's cabin
   * (`src/render/scene/vehicles/interior.ts`).
   *
   * This is a different read of the same FFT than `bands` above. The bands answer "did
   * something just hit?" and are baseline-relative, which is right for lights but wrong for a
   * meter: a meter has to sit at a height that means something even while nothing changes. So
   * each bar reports its own window's absolute level, tilted upward with frequency to undo the
   * natural roll-off of a mix (without the tilt the right-hand half of the display never
   * leaves the floor), then smoothed with a fast attack and a slow fall — the drop is what
   * makes it read as a sound system rather than a noise plot.
   */
  spectrum: {
    /** Number of bars. Matches the instance count of the display mesh. */
    bars: 14,
    /** Frequency span covered, split into `bars` logarithmically spaced windows. */
    loHz: 55,
    hiHz: 9000,
    /** Correction applied to a window's raw level, at the low end of the display and at the
     *  high end: a mix rolls off toward the treble, and without this the right-hand third of
     *  the display never leaves the floor. */
    tiltLo: 1,
    tiltHi: 1.9,
    /** How much of a bar's height is its window's own level. This is the display's *shape* —
     *  tall at the bass end, falling toward the treble — and it is all that is left of a bar
     *  when the music holds still. */
    shape: 0.45,
    /** ...and how hard the excess over that window's own rolling average is amplified on top.
     *  This is the display's *movement*: a loud mix pins a level meter near its ceiling and
     *  stops saying anything, so what dances here is the part that just changed. */
    punch: 3.2,
    /** How fast a window forgets its recent average (per frame). Slow enough to sit under a
     *  bar of music, fast enough to follow a drop. */
    baselineRate: 0.05,
    /** Per-frame smoothing of a bar climbing to a louder level, and falling away from one. */
    attack: 0.55,
    release: 0.12,
  },
  /** Mean bin level (0..255) across the mix treated as `energy` 1.0. */
  energyFull: 96,
  /** How fast `energy` rises toward a louder section (per frame). Seconds, not beats. */
  energyRise: 0.01,
  /** How fast `energy` sags in a quiet section. Slower than the rise, so it holds a chorus. */
  energyFall: 0.004,
};

/**
 * Race mode (`src/sim/race.ts`): a timed run of `laps` laps around the circuit in
 * `src/world/raceSpec.ts`, through every checkpoint in order. No opponents yet; the clock is
 * the opponent, and `RaceState.progress` is what a multiplayer host will rank players by.
 */
export const RACE = {
  laps: 2,
  /** Seconds of countdown before GO. The car is held on the brakes until then. */
  countdownSeconds: 3,
  /** Seconds of driving against the lap direction before WRONG WAY shows. */
  wrongWayDelay: 1.2,
  /** Speed below which direction is not judged (m/s). Sitting still is never the wrong way. */
  wrongWayMinSpeed: 4,
  /** Metres of clearance past the road edge in which a car still counts as on a shortcut. */
  shortcutPad: 2,
  /** Grid layout: distance from the line to the first slot and between rows (m), lateral offset (m). */
  gridFirstRow: 8,
  gridRowGap: 6,
  gridLateral: 3.6,
  gridSlots: 8,
};

/**
 * TIME ATTACK: the mission chain on the city circuit (`src/sim/timeAttack.ts`).
 *
 * The offline circuit was always a lap against the clock with nothing at stake. This is what
 * is at stake: three runs of the same two laps of the Bandido Grid, in order, each asking for
 * a shorter time AND a cleaner one than the last. Nothing about the race changes — same
 * course, same gates, same traffic, same restart — the chain only watches the race that was
 * going to happen anyway, the way RAYO RUSH watches the free world.
 *
 * TIME AND CRASHES TOGETHER, which is the whole idea. A time on its own is beaten by throwing
 * the car at the barriers and bouncing off in roughly the right direction; the crash allowance
 * is what makes the last mission ask for a lap that is fast BECAUSE it is tidy rather than in
 * spite of not being. So the two tighten together:
 *
 *   1 SHAKEDOWN     2:40, up to three crashes  <- get round it without parking it
 *   2 ON THE PACE   2:20, one crash            <- carry speed, and mostly stay off the walls
 *   3 SPOTLESS      2:05, none at all          <- the fast lap, without touching anything
 *
 * WHY THESE NUMBERS. Measured, not guessed: a line-following driver taken round the real
 * circuit through the real simulation, with no nitro and no shortcuts, finishes the two laps
 * in about 141 s driving carefully, 117 s committed and clean, and 111 s on the limit while
 * scraping the barriers eight times. So the first mission is inside a careful lap, the second
 * needs the pace of a committed one, and the third asks for a committed lap driven clean —
 * with the nitro and the hidden shortcuts, which that driver never used, as the margin.
 *
 * WHAT COUNTS AS A CRASH. Not every touch: a `collision` at `crashImpact` or more of velocity
 * INTO the surface, which is the difference between brushing a barrier on the exit of a corner
 * (~1-4 m/s) and hitting it (~7-9 m/s). And one accident is one crash — a real impact raises
 * a burst of events over the next few ticks as the car bounces and rides down the wall, so
 * `crashCooldown` seconds pass before another can be counted.
 */
export const TIME_ATTACK = {
  /**
   * The chain, in order. `seconds` is the whole race (every lap), not one lap: the mission is
   * to complete the circuit, and the finish time is the number the race already puts on that.
   * `crashes` is how many are ALLOWED — 0 means the run is over the moment the car hits
   * anything.
   */
  levels: [
    { name: 'SHAKEDOWN', seconds: 160, crashes: 3 },
    { name: 'ON THE PACE', seconds: 140, crashes: 1 },
    { name: 'SPOTLESS', seconds: 125, crashes: 0 },
  ],
  /** Velocity into a surface at or above which a contact is a crash (m/s). */
  crashImpact: 5,
  /** Seconds after a counted crash in which further impacts are the same accident. */
  crashCooldown: 1.2,

  /**
   * THE WAY IN, from the street. The chain is driven on the circuit, but it is FOUND in the
   * open world: a ring painted across the Bandido Grid's own start/finish line, at the point
   * of the city the race is cut through (`ArenaLayout.circuitSite`). Roll onto it, press the
   * key, and the circuit loads with the mission on offer.
   *
   * Same shape as `RUSH.marker` and for the same reason: the painted circle IS the trigger,
   * `src/render/scene/env/activityMarker.ts` draws it at exactly `promptRadius`, so the sign
   * is up while the car is standing on the paint and gone the moment it rolls off.
   *
   * `rearmRadius` is what the other markers use to stop a dismissed card dropping straight back
   * into its own prompt. Nothing here is dismissed — the key leaves the world altogether — but
   * ESC out of the circuit puts the car back at the city's spawn, not on this ring, so the
   * number is only ever the guard against a re-entry the player did not ask for.
   */
  marker: {
    promptRadius: 7.5,
    exitRadius: 8.4,
    rearmRadius: 18,
  },
};

/** The minimap in the top-right corner of the HUD (`src/ui/minimap.ts`). */
export const MINIMAP = {
  /** Canvas size in CSS pixels (square). */
  size: 176,
  /** Padding inside the canvas around the map (px). */
  padding: 10,
};

/**
 * Cruise mode (C): the car drives itself around `ArenaLayout.cruiseRoute` at a relaxed pace
 * so the game can be left running as a scene. Tuned to look like driving, not like a rail:
 * it lifts off before a corner, leans into it and picks the speed back up on the exit.
 */
export const CRUISE = {
  /** Cruising speed on a straight (m/s). ~47 km/h. */
  speed: 13,
  /** Speed carried through a full corner or the plaza weave (m/s). ~25 km/h. */
  cornerSpeed: 7,
  /** Distance at which the next waypoint is selected (m). Also how early a corner is cut. */
  arriveRadius: 7,
  /** Distance over which the car eases off before the corner at the next waypoint (m). */
  cornerLookahead: 26,
  /** Turn angle at a waypoint that calls for the full slowdown (rad). 90 degrees. */
  cornerFullTurn: Math.PI / 2,
  /** Heading error that on its own calls for the full slowdown (rad). ~50 degrees. */
  errorSlowdown: 0.9,
  /** Steering input per radian of heading error. */
  steerGain: 1.6,
  /** Steering input subtracted per rad/s of yaw rate. Damps the weave on a long straight. */
  yawDamping: 0.35,
  /** Speed error tolerated before touching throttle or brake (m/s). Lets the car coast. */
  speedDeadband: 0.4,
  /** Throttle applied per m/s of missing speed. */
  throttleGain: 0.35,
  /** Brake applied per m/s of excess speed. Gentle: the corner is anticipated, not braked into. */
  brakeGain: 0.45,
  /** Speed below which the car counts as stopped for the stuck guard (m/s). */
  stuckSpeed: 0.6,
  /** Seconds at a standstill before the car backs out of whatever it is against. */
  stuckTime: 1.2,
  /** Seconds spent reversing on opposite lock when the stuck guard fires. */
  reverseTime: 1,
};

/**
 * The city's buses. Deliberately slow and heavy: a bus is a rolling piece of the city, an
 * obstacle to read the street by, not another car in the traffic. Its size is the one the
 * collider and the model are both cut from.
 */
export const BUSES = {
  /** Buses on each route. Two is a service; one reads as a stray. */
  perRoute: 2,
  /** Length, width and height of the articulated body (m). */
  length: 13.6,
  width: 2.6,
  height: 3.75,
  /** Cruising speed between stops (m/s). About 40 km/h. */
  cruiseSpeed: 11,
  /** Acceleration and braking (m/s^2). A bus does neither in a hurry. */
  accel: 1.6,
  brake: 3.2,
  /** Distance out from a stop over which it eases off (m). */
  brakeDistance: 26,
  /** Seconds standing at a stop, doors open. */
  dwell: 6,
  /** Seconds the doors take to open, and to close again at the end of the wait. */
  doorTime: 1.2,
  /** How fast it can swing its nose round a corner (rad/s). */
  turnRate: 0.9,
};

/**
 * RAYO RUSH: the free-world time attack (`src/sim/rush.ts`).
 *
 * A two-minute run, started from a marker in the city, scored on electric cars disabled with
 * the Rayo. Nothing about it is a separate mode: the same world keeps running, the same
 * traffic patrols, the same drift charges the same weapon — the activity only watches what
 * the player was going to do anyway and puts a clock and a score on it.
 *
 * EVERY number the rules read is here. `src/sim/rush.ts` imports this and nothing else, so
 * the whole feel of the activity can be retuned without touching a rule.
 */
export const RUSH = {
  /** Length of one run (s). The headline number in the prompt, which reads it from here. */
  durationSeconds: 90,
  /** `3 - 2 - 1 - RAYO RUSH` before the clock starts (s). */
  countdownSeconds: 3,
  /**
   * How long the results card stays up before it puts itself away (s). F still dismisses it
   * the moment the player is done reading; this is only the promise that they never have to.
   */
  resultsHoldSeconds: 7,
  /** Ranked attempts one player may submit to the global board per calendar day. */
  dailyRankedAttempts: 3,

  /**
   * THE MISSION CHAIN. Three of them, in order, and the ONLY thing that separates one from the
   * next is the number it asks for: same clock, same city, same weapon. Clear one and the
   * marker packs up and re-paints itself somewhere else, which is what turns a leaderboard
   * into a progression — the player is sent somewhere new rather than told to try harder in
   * the same street.
   *
   * WHERE each level is driven is not here. A target score is a rule and belongs in this file;
   * a street corner is a fact about a particular city, so it lives with that city
   * (`ArenaLayout.rushSites`, one site per level, in this order, each carrying its own name).
   * A world that ships fewer sites than there are levels simply reuses its last one.
   *
   * WHY THESE NUMBERS. A kill is 100 before the streak multiplier, a drift-charged shot pays
   * 50-150 on top and a bolt thrown the length of a street up to `longShotBonus` more, so a run
   * is roughly `kills x (100 x average multiplier + style)`:
   *
   *   ~5 kills, barely chained              ~720   <- level 1 is "you have understood the loop"
   *   ~7 kills, streaks held               ~1,800   <- level 2 needs the chain window respected
   *   ~11 kills, streaks AND clean drifts  ~3,600   <- level 3 needs both at once
   *
   * The reach bonus is deliberately not written into those figures: it is the newest of the
   * habits and the one a player picks up last, so it reads as a run going better than expected
   * rather than as a target that cannot be met without it.
   *
   * So each level is beaten by adding one habit rather than by grinding the last one. Progress
   * is per browser and lives in localStorage (`src/core/progress.ts`); it is deliberately NOT
   * the global board, which keeps ranking whole runs however far through the chain you are.
   */
  levels: [{ target: 720 }, { target: 1800 }, { target: 3600 }],

  /**
   * The activity marker in the world, and the prompt it raises.
   *
   * THE PAINTED CIRCLE IS THE TRIGGER. `promptRadius` is not a detection range that happens to
   * sit near some art — it IS the ring stencilled on the road, which
   * `src/render/scene/env/rushMarker.ts` reads this number to draw. So the prompt is up while
   * the car is standing on the circle and gone the moment it rolls off, and there is no
   * invisible catchment around it that keeps a sign on screen half a block later.
   */
  marker: {
    /** Radius of the circle you have to be standing on (m). Also the radius it is painted at. */
    promptRadius: 7.5,
    /**
     * And the radius at which it goes away again (m). Barely wider — enough that a car parked
     * exactly on the line cannot flicker the prompt, and not enough to read as a lag.
     */
    exitRadius: 8.4,
    /**
     * Distance the player has to get from the marker after a run before it will offer another
     * (m). Without it the results screen dismisses straight back into a live prompt.
     */
    rearmRadius: 18,
  },

  /**
   * Which electric cars wear the target treatment. Everything alive and unscored is a legal
   * kill; only the near ones are DRAWN as targets, because a marker on all ~126 cars in the
   * city is both unreadable and a hundred draw calls nobody asked for.
   */
  targets: {
    /** Marked out to here (m). Comfortably past `LIGHTNING.range`, so a target is seen coming. */
    markRadius: 92,
    /** Never more than this many marked at once, nearest first. */
    maxMarked: 14,
  },

  /**
   * Scoring. Readable on purpose: a kill is a round hundred, and everything else is a bonus
   * printed next to it.
   */
  scoring: {
    /** Points for disabling one electric car, before the streak multiplier. */
    disable: 100,
    /** Seconds after a kill in which the next one extends the streak. */
    chainWindow: 5,
    /** Multiplier added per link of the streak: x1, x1.5, x2, ... */
    chainStep: 0.5,
    /** Ceiling on the streak multiplier. */
    chainMax: 5,
    /** Flat bonus for a shot whose charge came out of a drift. */
    driftChargeBonus: 50,
    /**
     * Seconds after a drift ends in which a shot still counts as drift-charged. The drift that
     * paid for the shot is usually over by the time the car is pointed at anything.
     */
    driftChargeGrace: 1.2,
    /** Extra points per second of that drift, on top of the flat bonus. */
    driftBonusPerSecond: 15,
    /** Seconds of drift past which the length bonus stops growing. */
    driftBonusMaxSeconds: 4,
    /** Extra on top again when the drift was clean: held from start to finish without a hit. */
    cleanDriftBonus: 40,

    /**
     * THE LONG SHOT. A bolt that crosses the street is worth more than one fired into the car
     * in front, and it has to be: reaching that far means holding the trigger down, and a long
     * hold drains the meter (`LIGHTNING.cost` against `LIGHTNING.minCost`). Without the bonus
     * the cheapest shot would also be the most efficient one, and the whole gun would collapse
     * into driving up behind a car and tapping.
     *
     * Ramped, not a threshold: the extra grows from nothing at `longShotFrom` to
     * `longShotBonus` at the weapon's full `LIGHTNING.range`, so there is no line on the road
     * where a metre further pays 80 more points. Measured muzzle to car — the distance the
     * bolt actually travelled, not the reach the hold bought, so a full hold into a car six
     * metres away is a close shot and is paid like one.
     */
    /** Distance at which a shot starts paying for its reach (m). Below this, nothing extra. */
    longShotFrom: 32,
    /** The extra a shot at maximum reach pays. Roughly what a good drift charge is worth. */
    longShotBonus: 80,
  },
};

/**
 * PASSENGERS: the free-world side rides (`src/sim/passenger.ts`).
 *
 * Someone waits at a stop, gets in, says where they are going and how they like to be driven,
 * and tips according to how the ride went. Every threshold, weight, grace and reward the rules
 * use is here; the characters themselves — who they are and what they say — are data in
 * `src/content/passengers.ts`, and where the stops are is the city's business
 * (`ArenaLayout.passengerStops`).
 *
 * THE MOOD is one number 0..100. It starts neutral-positive and moves two ways: SLOWLY, per
 * second, for how the car is being driven right now (a calm ride for someone who asked for one,
 * a fast one for someone who asked for that), and IN STEPS for things that happen (a drift, a
 * Rayo hit, a crash). Both gains are capped per ride, so nothing can be farmed; sitting still
 * earns nothing, so the pickup and the drop-off cost nobody anything. Penalties are not capped
 * but the mood floors at zero and a bad ride is a small tip, never a failed mission.
 */
export const PASSENGER = {
  offer: {
    /** Seconds after entering the world before the first pin goes up. */
    firstDelay: 5,
    /** Seconds after a ride (finished or abandoned) before the next pin goes up. */
    reofferSeconds: 10,
    /** A pin never goes up closer to the car than this (m): it is found, not handed over. */
    minDistanceFromPlayer: 70,
    /** Straight-line trip length the planner aims for (m). Long enough to be a ride, short enough to stay a side thing. */
    minTrip: 170,
    maxTrip: 520,
  },
  /**
   * The pickup and drop-off zones. Like the RAYO RUSH marker, the painted ring IS the trigger:
   * standing on it is the whole condition, so the prompt is up the moment the car rolls onto
   * the paint and gone the moment it rolls off. Nothing asks the car to have stopped first —
   * that only made the prompt look late.
   */
  marker: {
    /** Radius of the pickup and drop-off zones (m), and the radius the ring is painted at. */
    promptRadius: 7,
    /** Radius at which the zone lets go again (m). Slightly wider so a parked car cannot flicker it. */
    exitRadius: 8.2,
  },
  /**
   * The destination arrow: the chevron over the street ahead while a fare is aboard
   * (`render/scene/env/destinationArrow.ts`), aimed along the roads by `world/roadGraph.ts`.
   * Underground 2's idea — the answer to "left or right" arrives before the junction does.
   */
  arrow: {
    /**
     * How far up the route it hovers (m). Far enough that it has already turned into the next
     * street while the car is still in this one; near enough to read at a glance.
     */
    lookahead: 34,
    /**
     * Road distance to the drop-off (m) at which the arrow starts nosing down at it, reaching
     * fully down at zero. The last stretch is not a direction any more, it is an address.
     */
    diveDistance: 22,
  },
  /** Pressing the key twice inside this window (s) ends a ride early. One press only arms it. */
  cancelArmSeconds: 2.5,
  /** How long the fare card stays up before it puts itself away (s). F still ends it early. */
  resultsHoldSeconds: 7,
  mood: {
    /** Where every ride starts. */
    start: 62,
    /** Ceiling on what continuous good driving may add over a whole ride. */
    maxFlowGain: 30,
    /** Ceiling on what discrete events (drifts, Rayo hits) may add over a whole ride. */
    maxEventGain: 40,
    /** Farewell tiers, by final mood. */
    highTier: 72,
    mediumTier: 42,
  },
  speed: {
    /** Below this (m/s) the car counts as stopped: no speed rule applies either way. */
    movingSpeed: 3,
    /** Seconds over a limit before it starts to cost. A spike over a crest is not a habit. */
    limitGraceSeconds: 1.2,
    /** Mood per second while over the limit past the grace (times the preference's weight). */
    overDrainPerSecond: 4,
    /** Mood per second while moving under the limit. */
    calmGainPerSecond: 1.1,
    /** Fast-preference default threshold (km/h) when a character does not name one. */
    fastKmh: 110,
    /** Mood per second at or over the fast threshold. */
    fastGainPerSecond: 1.5,
    /** Moving below this share of the fast threshold counts as dawdling. */
    dawdleShare: 0.45,
    /** Seconds of dawdling before it starts to cost. Corners and traffic are not dawdling. */
    slowGraceSeconds: 6,
    /** Mood per second of dawdling past the grace. */
    slowDrainPerSecond: 1.2,
    /** Seconds of continuous satisfied driving before the passenger says so. */
    goodStreakSeconds: 12,
  },
  drift: {
    /** A slide shorter than this (s) is nobody's business either way. */
    minSeconds: 0.8,
    /** For a passenger who wants drifts: flat, plus per second of the slide, up to a ceiling. */
    bonus: 6,
    bonusPerSecond: 2,
    bonusMax: 14,
    /** Seconds before another drift may pay. */
    cooldown: 3,
    /** For a passenger who does not: the cost of one drift, and the least time between two. */
    penalty: 8,
    penaltyCooldown: 2,
  },
  rayo: {
    /** For a passenger who wants EVs shut down: per car, once per car, no faster than the cooldown. */
    bonus: 12,
    cooldown: 2,
    /** For a passenger who does not: per car, once per car. */
    penalty: 12,
  },
  collision: {
    /** Speed lost in a hit (m/s) below which it is a scrape and not a crash. */
    minImpact: 2.5,
    /** The cost of one crash, for everybody. */
    penalty: 6,
    /** Seconds before another crash counts. A grind along a wall is one crash, not sixty. */
    cooldown: 1.5,
  },
  dialogue: {
    /** A subtitle stays up for at least this long (s), plus a little per character, up to a cap. */
    minSeconds: 2.8,
    secondsPerChar: 0.045,
    maxSeconds: 6.5,
    /** Silence between two lines (s). */
    gapSeconds: 0.5,
    /** Least time between two incidental reactions (s), so the passenger is not a commentator. */
    reactionCooldown: 7,
    /** A reaction still waiting after this long (s) is dropped: the moment has passed. */
    reactionStale: 4,
    /** Least time between two remarks about speed (s). */
    speedLineCooldown: 18,
  },
  reward: {
    /** The fare: a flat call-out plus a rate on the trip's straight-line length. Fixed at the offer. */
    baseFare: 120,
    farePerMetre: 0.6,
    /** The most a delighted passenger tips. Scales linearly from `tipFloor` mood to 100. */
    maxTip: 300,
    /** Mood at or under which the tip is nothing. */
    tipFloor: 35,
  },
};

/**
 * EL BÚHO AND THE MOOGUL: the free-world encounter (`src/sim/buho.ts`, `src/render/scene/moogulTrip.ts`).
 *
 * Somebody stands under the highway selling one thing. Buying it charges the yen counter once
 * and starts a clock; what the clock drives is the city slowly coming alive — the sky, the
 * facades, the paint, the windows — and then slowly settling down again. Nothing here touches
 * the car, the traffic, the weapon or another player's screen: the whole experience is local
 * rendering, and every number that shapes it is in this block.
 *
 * THE ENVELOPE is one number 0..1 read off `timeline.keys` at the elapsed fraction of
 * `timeline.duration`, eased between keys so it never steps. Each visual LAYER then reads that
 * number through its own `[start, full]` window, which is what keeps the sky from arriving on
 * the same beat as the faces: a layer is exactly nothing below `start`, so the layers stack up
 * in order rather than all at once, the sky and the air first and the faces last.
 */
export const MOOGUL = {
  /** ¥. Charged once, on the confirming press. */
  price: 400,
  /** El Búho's ring: the bay under the deck is 12 m wide, so it is tighter than a passenger stop. */
  marker: {
    promptRadius: 5.5,
    exitRadius: 6.8,
  },
  /** Seconds the first press keeps the confirm up. A second press inside it is the purchase. */
  confirmSeconds: 4,
  /** Seconds a refusal ("not enough", "one is plenty") stays on the prompt. */
  noticeSeconds: 2.6,

  timeline: {
    /** The whole thing, seconds. Every key below is a fraction of this. */
    duration: 300,
    /**
     * `[fraction of duration, intensity]`, eased between. It comes on inside the first twenty
     * seconds rather than making the player wait for it: 0-0:20 rising out of nothing;
     * 0:20-1:15 clearly on and still climbing; 1:15-3:20 up to the peak; 3:20-5:00 back down
     * to nothing. Five minutes end to end.
     */
    keys: [
      [0, 0],
      [0.0667, 0.2],
      [0.25, 0.45],
      [0.5, 0.75],
      [0.667, 1],
      [0.8, 0.85],
      [1, 0],
    ] as ReadonlyArray<readonly [number, number]>,
  },

  /** Where on the envelope each layer starts and where it is fully in. */
  layers: {
    sky: [0.04, 0.85],
    fog: [0.08, 0.9],
    lights: [0.25, 1],
    surface: [0.15, 0.95],
    graffiti: [0.1, 0.8],
    faces: [0.4, 0.9],
    chroma: [0.5, 1],
    swim: [0.6, 1],
    bleed: [0.06, 0.9],
    glow: [0.2, 1],
  } as Record<
    'sky' | 'fog' | 'lights' | 'surface' | 'graffiti' | 'faces' | 'chroma' | 'swim' | 'bleed' | 'glow',
    readonly [number, number]
  >,

  /**
   * The sky and the air. Two moods, cycled between over `cyclePeriod` seconds, and the live
   * atmosphere colours are pulled `blend` of the way towards the mix at full intensity — never
   * all the way, so the storm's own structure and the flash stay in it.
   */
  sky: {
    cyclePeriod: 52,
    blend: 0.88,
    fogBlend: 0.55,
    moodA: {
      zenith: 0x1a0838,
      middle: 0x0e4a52,
      horizon: 0x7a2a72,
      cloudDark: 0x2a0c3e,
      cloudLight: 0x6fd8c4,
      pollution: 0xf0a030,
      fog: 0x2f2452,
    },
    moodB: {
      zenith: 0x0a2438,
      middle: 0x55144e,
      horizon: 0xb85a18,
      cloudDark: 0x0e2a40,
      cloudLight: 0xe6a0d8,
      pollution: 0x30e0c0,
      fog: 0x38284a,
    },
  },
  /** The two scene lights lean violet and teal at the peak. Fraction of the way to these. */
  lights: {
    hemiSky: 0x7a48c8,
    hemiGround: 0x1c5a58,
    key: 0xd07ad8,
    blend: 0.55,
  },
  /** Facades and paint (`env/moogulSurface.ts`). */
  surface: {
    /** How far the window grid drifts at full, in panes. Half a pane is unmistakable, one is mush. */
    warpPanes: 0.55,
    /** Wavelength of the drift across a wall (m) and how fast it moves (rad/s). */
    warpWavelength: 21,
    warpRate: 0.42,
    /** How far the window tints and the graffiti rotate round the hue wheel at full (rad). */
    hue: 1.1,
    /** How much the paint pulses in brightness at full (fraction). */
    pulse: 0.4,
    /**
     * How much brighter the lit windows burn at full (fraction). Small on its own — a window
     * cannot be made to glare without looking like a bug — but it is what pushes the panes
     * over `bleed.threshold`, so what it really buys is the halo round them.
     */
    glow: 0.85,
    /** Slow variation inside the envelope (s), so the peak breathes rather than holds. */
    breathPeriod: 17,
  },
  /** The faces in the windows (`moogulTrip.ts`). */
  faces: {
    /** At once, and how far from the car one may be put (m). */
    max: 4,
    range: 58,
    minDistance: 9,
    /** Seconds between one appearing and the next, at full; stretched out at lower intensity. */
    interval: [2.5, 6] as readonly [number, number],
    /** Random walls tried per attempt, and how soon an attempt that found no pane is repeated (s). */
    attempts: 24,
    retrySeconds: 0.6,
    /**
     * How often a wall outside the cone the player is looking down is passed over for one
     * inside it, and the cone's half-angle as a cosine (0.5 = 60° either side of the nose).
     */
    aheadShare: 0.75,
    aheadCos: 0.5,
    /** Seconds to emerge, to linger, and to go. */
    fadeIn: 1.8,
    hold: [2.5, 6] as readonly [number, number],
    fadeOut: 2.4,
    /** Size on the glass (m): a little wider than a pane, a little shorter than a floor. */
    width: 1.6,
    height: 2.3,
    /** Floors above the wall's base one may stand on (0 = ground floor). */
    minFloor: 1,
    maxFloor: 6,
    opacity: 0.82,
    /** Metres off the glass, so a face never fights the pane. */
    lift: 0.07,
  },
  /** The finishing pass, in `render/post/speedBlur.ts`. Fractions of the frame, at the edge. */
  post: {
    chroma: 0.0055,
    swim: 0.0042,
    swimPeriod: 8.5,
  },
  /**
   * THE LIGHTS, SPREAD (`render/post/lightBleed.ts`). The layer that does the most work for the
   * least: every lit pane, hairline, lamp and tail light in the frame grows a soft halo in a
   * colour that is not quite its own, so the city stops being made of points and starts being
   * made of light. It reaches the whole frame, not just the edge.
   */
  bleed: {
    /** How much of the halo goes back into the frame at full. Past ~2 it stops being a city. */
    amount: 1.15,
    /**
     * Brightness a pixel must reach before it bleeds: `[at the layer's start, at full]`. It
     * FALLS as the trip deepens — first only the actual lights halo, and by the peak so does
     * anything merely bright, which is what turns a haze round the lamps into a soft city.
     */
    threshold: [0.68, 0.34] as readonly [number, number],
    /** How much brighter than the threshold a pixel must be to bleed fully. Wide: no pane pops. */
    knee: 0.34,
    /** How far the halo's colour turns off its light's, and how far off white it is pushed. */
    hue: 1.5,
    huePeriod: 23,
    saturation: 1.45,
    /** Halo width as a fraction of the frame's height, `[start, full]`, and its sideways stretch. */
    radius: [0.03, 0.075] as readonly [number, number],
    stretch: 1.35,
    /** Slow variation inside the envelope (s), so the glow breathes with the walls. */
    breathPeriod: 13,
    /** How far the halo's channels split along the radius at full (fraction of the frame). */
    fringe: 0.006,
    /** How much halo survives in the middle of the frame, where the car and the road are. */
    centre: 0.55,
  },
  /** Seconds the overrides take to let go when the trip is cut short. */
  stopFadeSeconds: 0.9,
  /** Development only: multiplies the trip clock. `__rb.buho.timeScale(20)`. */
  debug: {
    timeScale: 1,
  },
};

/**
 * THE POLICE (`src/sim/police.ts`). Free Roam only — never in a race, a mission or any other
 * activity — see `isPoliceEnabledForCurrentGameState`. Everything the MVP tunes lives here.
 *
 * Units are traffic-shaped: they drive by position the way the electric cars do, so the
 * numbers are metres, seconds and metres per second, never forces.
 */
export const POLICE = {
  /** One patrol car for every this-many civilian electric cars. */
  patrolRatio: 16,
  /** Hard cap on patrol cars, whatever the ratio says. */
  maxPatrols: 6,
  /** Hard cap on every police car at once, patrols and pursuers together. The visual pool size. */
  maxUnits: 9,
  /** Seconds after the police are (re)enabled before the first car appears. */
  resumeDelay: 6,
  /** Seconds between patrol spawns while the ratio is short. */
  patrolSpawnInterval: 2.5,
  /** A car spawns no nearer than this to the player (m), and no farther than the max. */
  spawnMinDistance: 70,
  spawnMaxDistance: 170,
  /** A patrol this far from the player (m) is recycled to a spawn nearer the action. */
  patrolRecycleDistance: 260,
  patrol: {
    speed: 7,
    turnRate: 1.8,
    accel: 5,
    brake: 14,
  },
  /** What a patrol has to be, relative to an offence, to have seen it. */
  detection: {
    /** Metres, from the patrol to either the player or the car that was hit. */
    radius: 60,
    /** Cosine of the half-angle: -0.2 is "in front or beside", about 100 degrees each way. */
    forwardCos: -0.2,
  },
  heat: {
    max: 100,
    /** Offence heat by the distance the bolt crossed (m). */
    closeRange: 25,
    mediumRange: 60,
    close: 35,
    medium: 20,
    far: 10,
    /** On top, when a patrol saw it happen. */
    witnessed: 15,
    /** Heat lost per second while nothing is happening and nobody can see the car. */
    decayPerSecond: 3,
    /** Seconds after the last offence before decay starts. */
    decayDelay: 5,
  },
  /** Heat at which each star lights: one, two, three. */
  stars: [25, 50, 75],
  /** Pursuing cars allowed by star count (index = stars). */
  unitsByStars: [0, 0, 1, 3],
  /** Radius (m) inside which an alerted patrol drives to where the offence happened. */
  alertRadius: 120,
  /** Seconds a one-star investigation lasts before the patrol goes back to its loop. */
  investigateSeconds: 12,
  pursuit: {
    /** Top speed by star count (m/s). Below the player's, on purpose. */
    speedByStars: [0, 0, 21, 25],
    accelByStars: [0, 0, 7, 9],
    turnRate: 2.6,
    /** How far ahead of the player the chaser aims (s of the player's velocity). */
    lead: 0.45,
    /** Road-network lookahead (m) when steering by the route rather than straight at the car. */
    routeLookahead: 16,
    /** Inside this (m) with a clear line the chaser stops routing and drives straight at the car. */
    directRange: 40,
    /** Seconds between route recomputations (Dijkstra over the junctions). */
    routeInterval: 0.5,
    /** Sight: metres, and the cosine of the half-angle of the chaser's view. */
    sightRadius: 80,
    sightCos: 0.2,
    /** Inside this (m) the chaser sees the player whatever way it is facing. */
    sightNearRadius: 18,
    /** Seconds without any chaser seeing the car before ESCAPING is shown. */
    loseSightSeconds: 3,
    /** A pursuit whose chasers never find the car at all gives up after this long (s). */
    firstContactSeconds: 20,
    /** Seconds of ESCAPING that end the pursuit. */
    escapeSeconds: 8,
    /** A chaser farther than this (m) is recycled to a spawn behind the player. */
    recycleDistance: 240,
    /** Seconds a chaser may sit against a wall before it is recycled. */
    stuckSeconds: 3.5,
    /** Seconds a stuck chaser reverses before trying again. */
    reverseSeconds: 1.2,
    /** Where a joining chaser appears: behind the player, this far away (m). */
    joinMinDistance: 70,
    joinMaxDistance: 130,
  },
  bust: {
    /** Player slower than this (m/s) counts as stopped. */
    speed: 2.5,
    /** A chaser inside this (m) of the player's centre is pinning them. */
    distance: 5,
    /** Seconds pinned before the arrest. */
    seconds: 2.5,
    /** Seconds the car is held after the arrest before control comes back. */
    holdSeconds: 3.5,
    /** Fine by star count (index = stars). Taken from the counter, never below zero. */
    fineByStars: [0, 200, 500, 1000],
    /** Seconds after release before any police car may spawn again. */
    graceSeconds: 8,
  },
  /** How the pursuit's knocks land on the player: the same channel the traffic uses. */
  knock: {
    radius: 1.15,
  },
};
