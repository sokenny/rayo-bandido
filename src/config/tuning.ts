/**
 * Every gameplay tuning constant lives here. Starting values come from docs/DECISIONS.md
 * ("Temporary MVP defaults") and may be tuned freely. Keep this the single obvious place.
 *
 * Units: meters, seconds, radians, m/s unless a name says otherwise.
 */

export const SIM_STEP = 1 / 60;

export const VEHICLE = {
  /** Peak forward speed without nitro (m/s). ~180 km/h. */
  maxSpeed: 50,
  /** Reverse speed cap (m/s). ~35 km/h. */
  maxReverseSpeed: 9.8,
  /** Forward acceleration at zero speed (m/s^2). Tuned for 0-100 km/h in ~4 s. */
  engineAccel: 8.8,
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
  /** Minimum speed for handbrake to kick the rear out (m/s). */
  handbrakeMinSpeed: 8,
  /** Speed range above `handbrakeMinSpeed` over which the kick reaches full strength (m/s). */
  handbrakeKickRamp: 4,
  /** Yaw kick while the handbrake is held and the wheel is turned (rad/s). */
  handbrakeYawKick: 1.35,
  /** Slip angle where the handbrake kick starts fading out (rad). */
  handbrakeKickFadeStart: (18 * Math.PI) / 180,
  /** Slip angle where the handbrake kick is fully gone (rad). Prevents handbrake spins. */
  handbrakeKickFadeEnd: (42 * Math.PI) / 180,
  /** Throttle effectiveness while fully sliding (0..1). Speed bleeds during a drift. */
  driftThrottleScale: 0.5,
  /** Longitudinal scrub per m/s of lateral speed while sliding (1/s). */
  driftDrag: 0.22,
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
  cost: 50,
  /** Half-angle of the forward auto-aim cone (rad). ~35 degrees. */
  coneHalfAngle: (35 * Math.PI) / 180,
  /** Auto-aim range (m). */
  range: 45,
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
  fullSpeed: 52,
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
   * Body reference (`carVisual.ts`): nose at ahead 2.16, tail at ahead -2.24, flanks at
   * side ±1.0, roof at height 1.35.
   */
  mounts: {
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
  /** Average frame interval (ms) that counts as dropping frames under 60 Hz vsync. */
  resolutionDownMs: 18.5,
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
  /** Widest stereo pan applied to a spatialized electric hum (0..1). */
  maxPan: 0.85,
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
