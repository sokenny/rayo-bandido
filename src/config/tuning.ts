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
  /** Below this forward speed a held brake becomes reverse (m/s). */
  brakeToReverseSpeed: 0.5,
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
  /** Speed retained along the wall after a collision (0..1). */
  collisionSlide: 0.85,
  /** Collision proxy radius (m). */
  collisionRadius: 1.1,
  /** Wheel radius (m). */
  wheelRadius: 0.33,
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
  /** Shake amplitude on nitro (m). */
  shakeNitro: 0.03,
  /** Shake amplitude on lightning (m). */
  shakeLightning: 0.12,
  /** Shake amplitude on collision per m/s of impact (m). */
  shakeCollisionPerImpact: 0.02,
  shakeDecay: 6,
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
  /**
   * Fake automatic gearbox for the engine note: the upper speed-fraction bound of each gear
   * (fraction of VEHICLE.maxSpeed). Within a gear the note rises to redline, then drops on the
   * shift, so acceleration sounds like a car and not an endless siren.
   */
  gearBounds: [0.13, 0.28, 0.45, 0.64, 0.83, 1.0],
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
  /** Mean bin level (0..255) across the mix treated as `energy` 1.0. */
  energyFull: 96,
  /** How fast `energy` rises toward a louder section (per frame). Seconds, not beats. */
  energyRise: 0.01,
  /** How fast `energy` sags in a quiet section. Slower than the rise, so it holds a chorus. */
  energyFall: 0.004,
  /**
   * How far `energy` is allowed to move the two scene lights, as a fraction of their base
   * value. This is the slowest thing in the scene: the arena gets brighter through a chorus.
   */
  lightDepth: 0.3,
  /**
   * How hard the bass drives the main neon mass — the static tubes, strips and window glow
   * that light most of this world. This is the one you feel: the city thumps on the kick.
   */
  neonDepth: 0.6,
  /** How hard the bass blooms the additive halos and wet light pools under the neon. */
  glowDepth: 0.5,
  /** How hard the mids lift the emissive facades. Slow and wide — whole buildings breathe. */
  facadeDepth: 0.4,
  /** How hard the mids lift the breathing signs (vertical signs, gate bars, hanging tubes). */
  signDepth: 0.55,
  /** How hard the highs tick the stutter neon: broken alley tubes and roof beacons. */
  flickerDepth: 0.45,
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
