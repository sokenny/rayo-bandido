/**
 * Shared simulation contracts for Rayo Bandido.
 *
 * RULES
 * - This file is the contract between input, simulation, rendering and UI.
 * - Nothing in here may import Three.js or touch the DOM. Simulation state is plain data
 *   so it can later be serialized for multiplayer.
 * - Coordinate system (matches Three.js world space, Y up):
 *     * The simulation runs on the XZ plane. Positions are (x, z); y = 0 is the ground.
 *       A world may carry elevated roads (`ArenaLayout.surface`): the car and the traffic
 *       then also carry a `y`, the height of the road under them, but nothing about the
 *       handling model changes — a car on a viaduct steers exactly like one on the street.
 *     * `heading` is a compass-style yaw in radians, CLOCKWISE when viewed from above.
 *       heading 0 points toward -Z (the Three.js "forward" convention).
 *     * forward = (sin(heading), -cos(heading)),  right = (cos(heading), sin(heading)).
 *       Use helpers in `src/core/math.ts` instead of re-deriving these.
 *     * Positive steer / positive yaw turns the car to the RIGHT and INCREASES heading.
 *     * Presentation maps a heading to Three.js with `object.rotation.y = -heading`
 *       and models the car nose pointing toward local -Z. Only `src/render/sync.ts`
 *       performs that mapping.
 * - Units: meters, seconds, radians, m/s. Speed HUD conversion to km/h happens in UI.
 */

import type { TrackPath } from '../world/track';

/** Which world is loaded: the free-roam test city, the racing circuit or the big city. */
export type GameMode = 'test' | 'race' | 'city' | 'circuit';

/** One tick of player intent. Produced by the input layer; consumed by the simulation. */
export interface PlayerCommand {
  /** 0..1 forward throttle. */
  throttle: number;
  /** 0..1 brake. Held at a full standstill it becomes reverse throttle after a short delay. */
  brake: number;
  /** -1..1 steering; negative = left, positive = right. */
  steer: number;
  /** Handbrake held. */
  handbrake: boolean;
  /** Nitro held. */
  nitro: boolean;
  /**
   * Fire lightning, held: true for every tick the button is down. The shot charges while it
   * is held and leaves on release (or on its own at `LIGHTNING.maxHold`), so the sim — not
   * the input layer — owns the edges. See `src/sim/lightning.ts`.
   */
  fire: boolean;
  /** Restart. Edge-triggered: true for exactly one simulation tick per key press. */
  restart: boolean;
  /** Toggle cruise mode. Edge-triggered: true for exactly one tick per key press. */
  cruise: boolean;
  /** Cycle the camera view. Edge-triggered. Presentation only: the simulation ignores it. */
  pov: boolean;
  /** Manual transmission: shift up. Edge-triggered. Ignored by an automatic. */
  shiftUp: boolean;
  /** Manual transmission: shift down. Edge-triggered. Ignored by an automatic. */
  shiftDown: boolean;
  /** Toggle automatic / manual transmission. Edge-triggered. */
  transmission: boolean;
  /**
   * Take up whatever the world is offering here — today that is the Rayo Rush marker
   * (`src/sim/rush.ts`). Edge-triggered, and ignored everywhere nothing is on offer.
   */
  activate: boolean;
}

export type Transmission = 'auto' | 'manual';

export interface VehicleState {
  x: number;
  z: number;
  /** Height of the road surface under the car (m). 0 on a flat world. See `src/sim/surface.ts`. */
  y: number;
  heading: number;
  /** Pose at the start of the current tick, for render interpolation. */
  prevX: number;
  prevZ: number;
  prevY: number;
  prevHeading: number;
  /**
   * Grade of the road along the heading, as an angle (rad, positive = climbing). The body
   * tilts by it, and step 4 of `src/sim/vehicle.ts` feels a fraction of gravity along it.
   */
  pitch: number;
  /** World-space velocity in m/s. */
  vx: number;
  vz: number;
  /** Yaw rate in rad/s (positive = turning right). */
  yawRate: number;
  /** Signed longitudinal speed in m/s along the car's forward axis (negative when reversing). */
  speed: number;
  /** Lateral speed in m/s along the car's right axis. */
  lateralSpeed: number;
  /** Signed slip angle in radians between heading and velocity direction (0 when not moving). */
  slipAngle: number;
  /**
   * Acceleration felt by the body along its right axis (m/s^2), i.e. the lateral tyre force
   * per unit mass. Positive = pushed toward the car's right (what a right-hand turn produces).
   * Presentation-only signal: `src/render/scene/bodyAttitude.ts` turns it into body roll.
   */
  latAccel: number;
  /** Acceleration along the forward axis (m/s^2) over the last tick, collisions included. */
  longAccel: number;
  /** Current front wheel steering angle in radians (visual + physics). */
  steerAngle: number;
  /** Accumulated wheel rotation in radians for visuals. Wrapped to avoid unbounded growth. */
  wheelSpin: number;
  /** Throttle actually applied this tick (0..1), after nitro modifiers. */
  throttleApplied: number;
  /** Brake actually applied this tick (0..1). */
  brakeApplied: number;
  /**
   * Seconds the brake has been held with the car stopped. Reverse engages once it passes
   * `VEHICLE.reverseArmTime`; any real motion resets it to 0.
   */
  reverseArm: number;
  handbrake: boolean;
  /**
   * Seconds the current handbrake pull has been held with the rear actually loose. Resets to
   * 0 the moment the button is released or the car is too slow to slide, so every pull starts
   * fresh. It is what separates a flick from a held pivot: see `stepVehicle`.
   */
  handbrakeHold: number;
  /**
   * Radians of rotation the current pull's yaw kick has already spent (absolute). Measured
   * against the pull's angle budget, which grows with `handbrakeHold` - holding the button
   * keeps buying angle instead of the kick dying at a fixed slip.
   */
  handbrakeYaw: number;
  /** True on the tick a collision impulse was applied. Presentation uses it for feedback. */
  collided: boolean;
  /** Speed lost in the last collision (m/s), 0 when no collision this tick. */
  collisionImpact: number;
  /** How much the car is sliding this tick (0 = full grip, 1 = full drift). */
  slide: number;
  /** Zero-based gear of the automatic (`DRIVETRAIN.gearTops`). Displayed as `gear + 1`. */
  gear: number;
  /** Engine rpm, 0 at idle .. 1 at redline. Road rpm plus whatever the throttle revs above it. */
  rpm01: number;
  /** Excess rpm over road rpm the engine is holding under throttle (rpm01). The wheelspin integrator. */
  spinRev: number;
  /**
   * Rear wheels spinning (0..1): excess rpm inside the torque band. A readout for the tacho
   * and the engine note — the handling model in `src/sim/vehicle.ts` does not read it.
   */
  wheelspin: number;
  /** Seconds the engine has been against the limiter; its penalties ramp in over `overRevGrace`. */
  limiterTime: number;
  /**
   * Fuel cut this tick on the manual box's rev limiter (0 = firing, 1 = cut). Square-waved at
   * `DRIVETRAIN.limiterCutHz` while the needle is pinned at redline: the "ta-ta-ta-ta" of a car
   * banging off the limiter. Kills drive, dips the needle, mutes the note and spits a bang.
   */
  limiterCut: number;
  /** Phase (0..1) of that cut cycle. 0 whenever the engine is off the limiter. */
  limiterPhase: number;
  /** Seconds the automatic still refuses to shift down after a rev-triggered upshift. */
  shiftHold: number;
  /**
   * How the front wheels sit against the slide (-1..1): positive = counter-steered (pointing
   * where the car is going), negative = steered into the slide. 0 when not sliding.
   */
  counterSteer: number;
}

export interface DriftState {
  /** True while a valid drift is being sustained. */
  active: boolean;
  /** Seconds the current drift has lasted (0 when inactive). */
  duration: number;
  /** Seconds slip conditions have been met while not yet active (activation hysteresis). */
  candidateTime: number;
  /** Seconds slip conditions have failed while active (cancellation grace). */
  lapseTime: number;
  /** Number of drifts chained without the chain window expiring. */
  chain: number;
  /** Seconds remaining in which a new drift extends the chain. */
  chainWindow: number;
  /** Charge generated by the drift on the last tick (units per second), for feedback. */
  chargeRate: number;
}

export interface NitroState {
  /** 0..capacity. */
  amount: number;
  /** True while boost is applied this tick. */
  active: boolean;
  /** Seconds until recharge resumes after boosting (short delay so recharge is readable). */
  rechargeDelay: number;
}

export interface LightningState {
  /** 0..capacity. Only drifting adds charge. */
  charge: number;
  /** Id of the target the beam would hit right now, or -1. A preview, not a lock. */
  acquiredTargetId: number;
  /** Seconds the fire button has been held on the shot being charged (0 when not charging). */
  hold: number;
  /** True while a shot is charging: fire is held and the shot was paid for at the press. */
  charging: boolean;
  /** False until fire is released, so one press only ever charges one shot. */
  armed: boolean;
  /** Seconds until the next shot may be fired. */
  cooldown: number;
  /** Seconds remaining on the last arc for presentation (informational). */
  arcTimer: number;
  /** Last fired target id (or -1). */
  lastTargetId: number;
}

export type TargetStatus = 'active' | 'disabled' | 'destroyed';

export interface TargetState {
  id: number;
  x: number;
  z: number;
  /** Height of the road under the car (m), see `VehicleState.y`. */
  y: number;
  heading: number;
  prevX: number;
  prevZ: number;
  prevY: number;
  prevHeading: number;
  /** World-space knockback velocity (m/s) from being bumped by the player. Decays to 0. */
  vx: number;
  vz: number;
  status: TargetStatus;
  /** Sim time when the target was hit, or -1. */
  hitTime: number;
  /** Simple patrol progress. Implementation detail of `src/sim/targets.ts`. */
  patrolIndex: number;
  /** Patrol speed on a clear road (m/s). Constant. */
  patrolSpeed: number;
  /** Speed actually being driven (m/s). Eased down for cars ahead, see `src/sim/targets.ts`. */
  speed: number;
  /** Whether a reward has already been paid for this target. Guards against duplicate money. */
  rewarded: boolean;
}

/**
 * A bus on its route. Unlike an electric car it is not a target: it cannot be shot, shoved
 * or destroyed, and the player bounces off it as off a wall (`ArenaLayout.walls` carries four
 * segments per bus, rewritten as it moves). That is also what keeps it cheap to reason about
 * — nothing the player does changes a bus, so every screen draws it in the same place.
 */
export interface BusState {
  id: number;
  /** Which route in `ArenaLayout.busRoutes` it runs. */
  route: number;
  x: number;
  z: number;
  heading: number;
  prevX: number;
  prevZ: number;
  prevHeading: number;
  /** Distance travelled along the route loop (m). */
  station: number;
  /** Current speed (m/s): eased down into a stop and back up out of it. */
  speed: number;
  /** Seconds left standing at a stop; 0 when running. */
  dwell: number;
  /** Index into the route's `stops` of the one it is driving at. */
  nextStop: number;
  /** 0..1, how far the doors are open. Drawn, not simulated. */
  doors: number;
}

/** One in-flight "pass" of a single target: the player is inside the near-miss radius of it. */
export interface NearMissPass {
  /** True while the player is inside the scoring radius of this target. */
  active: boolean;
  /** Closest centre-to-centre approach so far during the current pass (m). */
  minDist: number;
  /** Player speed at that closest approach (m/s). Not the peak: the pass is what counts. */
  speedAtClosest: number;
  /** True once the two cars have touched, which voids the pass. */
  touched: boolean;
  /** True once this pass has been awarded, so leaving the radius cannot pay a second time. */
  scored: boolean;
}

export interface NearMissState {
  /** One slot per target, indexed by target id. Pre-allocated; never grows during play. */
  passes: NearMissPass[];
  /** Near misses scored this session. */
  count: number;
  /** Best single near miss this session. */
  best: number;
}

export interface EconomyState {
  money: number;
  destroyed: number;
  /** Money gained on the last tick (0 when nothing happened). For HUD flashes. */
  lastReward: number;
}

/**
 * A thing to do in the free world, marked in it. One point on the ground with a radius round
 * it: the simulation raises a prompt inside the radius, the renderer draws something there,
 * and neither has to know what the other put at that spot.
 */
export interface ActivitySite {
  x: number;
  z: number;
  /** Height of the road under it (m). */
  y: number;
  /** Which way the marker faces (rad), so its art can be squared up with the street. */
  heading: number;
}

/**
 * Rayo Rush (`src/sim/rush.ts`).
 *
 *   idle      - not running. The prompt may be up (`atMarker`), nothing is being scored.
 *   countdown - 3, 2, 1. The player drives normally; the clock has not started.
 *   running   - the two minutes.
 *   results   - time is up, the run is frozen and the card is on screen until it is dismissed.
 */
export type RushPhase = 'idle' | 'countdown' | 'running' | 'results';

/** What one finished run was worth. Frozen at the flag; read by the results card. */
export interface RushResults {
  score: number;
  /** Electric cars disabled with the Rayo during the run. */
  disabled: number;
  /** Longest streak of eliminations inside the chain window. */
  bestChain: number;
  /** Everything the drifting paid on top of the base kills. */
  styleBonus: number;
  /** Whether this run was one of the day's ranked attempts. */
  ranked: boolean;
}

export interface RushState {
  phase: RushPhase;
  /** Seconds left of `RUSH.countdownSeconds` while counting in; 0 otherwise. */
  countdown: number;
  /** Seconds left on the clock while running; 0 otherwise. */
  timeLeft: number;
  score: number;
  disabled: number;
  /** Eliminations chained so far (1 = the streak just started). */
  chain: number;
  /** What the next kill is multiplied by. 1 with no streak. */
  multiplier: number;
  /** Seconds left in which another kill extends the streak. 0 when there is no streak. */
  chainWindow: number;
  bestChain: number;
  styleBonus: number;
  /** True while the player is inside the marker and a run may be started. */
  atMarker: boolean;
  /**
   * False once the marker has been used up for the day: the run still plays and still scores,
   * it just is not submitted anywhere. Set by the caller before `activate`, never by the rules.
   */
  ranked: boolean;
  /**
   * True once the player has left the marker since the last run, so dismissing the results
   * does not drop them straight back into a live prompt.
   */
  rearmed: boolean;
  /**
   * One flag per electric car: whether it has already paid out during THIS run. An EV that is
   * shot, respawns and is shot again is worth nothing the second time. Sized to the traffic
   * at creation and cleared at the start of every run; never grows.
   */
  scored: Uint8Array;
  /**
   * The drift that is paying for shots right now. All lightning charge comes from drifting,
   * so "charged through drifting" has to mean the shot came OUT of a slide — during one, or
   * within `RUSH.scoring.driftChargeGrace` of one ending, because the slide is over by the
   * time the nose is pointed at anything. Kept here rather than in `DriftState` because it is
   * a scoring concern: `src/sim/drift.ts` has no reason to remember a drift that has ended.
   */
  driftSeconds: number;
  /** Whether that drift ran its whole length without a collision. */
  driftClean: boolean;
  /** Seconds of credit left. 0 = a shot fired now is not drift-charged. */
  driftCredit: number;
  /** Whether the drift being held right now has taken a hit. Armed between drifts. */
  driftHeldClean: boolean;
  /** The finished run, or null until there is one. */
  results: RushResults | null;
}

export type RacePhase = 'countdown' | 'racing' | 'finished';

/**
 * Race mode rules state (`src/sim/race.ts`). Plain data like everything else here, so a
 * multiplayer host can ship it to every client and rank them by `progress`.
 */
export interface RaceState {
  phase: RacePhase;
  /** Seconds until GO while in the countdown. */
  countdown: number;
  /** Current lap, 1-based. Stays at `laps` once the race is finished. */
  lap: number;
  laps: number;
  /** Index into `RaceCourse.gates` of the next gate that has to be crossed (0 = the line). */
  nextGate: number;
  /** Sim time of GO (or -1 before it). */
  goTime: number;
  /** Sim time the current lap started. */
  lapStart: number;
  /** Sim time the previous lap started (to undo a lap when the line is re-crossed backwards). */
  prevLapStart: number;
  /** Seconds since GO, frozen at the finish. */
  elapsed: number;
  /** Completed lap times (s). Preallocated to `laps`; -1 for laps not yet run. */
  lapTimes: number[];
  /** Best / last completed lap (s), or -1. */
  bestLap: number;
  lastLap: number;
  /** Total time at the finish (s), or -1 while racing. */
  finishTime: number;
  /** Station along the lap centreline (m), measured from sample 0 of the course path. */
  station: number;
  /** Race progress in laps: completed laps + fraction of the current one. Ranks players. */
  progress: number;
  /** True while the car has been driving against the direction of the lap for a while. */
  wrongWay: boolean;
  /** Seconds spent driving the wrong way (hysteresis timer). */
  wrongWayTime: number;
  /** Index of the shortcut the car is currently inside, or -1. */
  shortcut: number;
}

/**
 * Another player's car, as this client currently believes it to be.
 *
 * Plain data like everything else here, and deliberately shaped like the parts of
 * `VehicleState` that a rival needs rather than the whole thing: a rival is never simulated
 * locally, only received. `src/net/rivals.ts` fills these in by interpolating the snapshots
 * from the match server; `src/sim/rivalCollision.ts` reads them so the local car can bump
 * into one, and the renderer, minimap and standings read them too.
 *
 * The pose is already a render-ready position (interpolation happens on the network clock,
 * not the simulation clock), so unlike `VehicleState` there is no `prev` pose to blend from.
 */
export interface RivalCar {
  /** Server-assigned player id. Stable for as long as that player stays connected. */
  id: string;
  name: string;
  /** Grid slot, which also picks the car's colour. */
  slot: number;
  /** False while no recent state has arrived: the car is not drawn and cannot be hit. */
  present: boolean;
  x: number;
  z: number;
  heading: number;
  /** World velocity (m/s). Used to extrapolate and to work out a bump. */
  vx: number;
  vz: number;
  /** Signed longitudinal speed (m/s). */
  speed: number;
  steerAngle: number;
  /** Integrated locally from `speed`; never sent. */
  wheelSpin: number;
  latAccel: number;
  longAccel: number;
  drifting: boolean;
  nitro: boolean;
  braking: boolean;
  reversing: boolean;
  /** Lightning charge 0..1, for the underglow. */
  charge: number;
  /** Race standing, as last reported by that player. */
  lap: number;
  progress: number;
  lapTime: number;
  bestLap: number;
  finishTime: number;
  money: number;
}

/** Discrete happenings for presentation and audio. Cleared at the start of every tick. */
export type GameEvent =
  | { type: 'driftStart' }
  | { type: 'driftEnd'; duration: number; chain: number }
  | { type: 'nitroStart' }
  | { type: 'nitroEnd' }
  /** `targetId` is -1 when the shot went out and hit nothing. */
  | { type: 'lightningFired'; targetId: number; fromX: number; fromY: number; fromZ: number; toX: number; toY: number; toZ: number }
  | { type: 'lightningDenied'; reason: 'noCharge' | 'noTarget' | 'cooldown' | 'short' }
  | { type: 'targetDestroyed'; targetId: number; x: number; y: number; z: number; reward: number }
  | { type: 'nearMiss'; targetId: number; x: number; y: number; z: number; points: number; quality: number }
  | {
      type: 'collision';
      x: number;
      y: number;
      z: number;
      impact: number;
      /** Set when the other party was an electric car: its id and the knock velocity it was given. */
      targetId?: number;
      knockX?: number;
      knockZ?: number;
    }
  | { type: 'restart' }
  | { type: 'raceCountdown'; seconds: number }
  | { type: 'raceStart' }
  | { type: 'checkpoint'; index: number; split: number }
  | { type: 'lapComplete'; lap: number; time: number; best: boolean }
  | { type: 'raceFinish'; total: number; bestLap: number }
  | { type: 'wrongWay'; on: boolean }
  | { type: 'transmission'; mode: Transmission }
  /**
   * The marker started or stopped offering a run — the car rolled onto the painted circle, or
   * off it. Presentation only: the overlay reads `canStart` off the snapshot, and this is what
   * lets the audio hear the EDGE rather than poll a boolean.
   */
  | { type: 'rushPrompt'; on: boolean }
  | { type: 'rushStart'; ranked: boolean }
  /** One tick of the count-in. `seconds` 0 is the GO beat, drawn as RAYO RUSH. */
  | { type: 'rushCountdown'; seconds: number }
  | {
      type: 'rushScore';
      targetId: number;
      x: number;
      y: number;
      z: number;
      /** What the kill was actually worth, multiplier and bonuses included. */
      points: number;
      /** Streak length after this kill, and the multiplier it was paid at. */
      chain: number;
      multiplier: number;
      /** Style points inside `points`: 0 when the shot was not drift-charged. */
      driftBonus: number;
      /** Seconds of the drift that charged the shot (0 when it was not one). */
      driftSeconds: number;
      /** True when that drift ran from start to finish without a collision. */
      cleanDrift: boolean;
    }
  | { type: 'rushEnd'; results: RushResults }
  /** The results card was dismissed; the world is back to plain free roam. */
  | { type: 'rushDismissed' };

export interface GameState {
  /** Simulation time in seconds since the session started. */
  time: number;
  tick: number;
  vehicle: VehicleState;
  drift: DriftState;
  nitro: NitroState;
  lightning: LightningState;
  targets: TargetState[];
  /** Buses on their routes. Empty in a world without them. */
  buses: BusState[];
  nearMiss: NearMissState;
  economy: EconomyState;
  /** Present in race mode only. */
  race: RaceState | null;
  /** Rayo Rush. Present in worlds that carry an activity marker (`ArenaLayout.rushSite`). */
  rush: RushState | null;
  /** Automatic or manual gearbox. A player setting that lives in the state because the sim reads it. */
  transmission: Transmission;
  events: GameEvent[];
}

/**
 * Axis-aligned obstacle in world space. Buildings, barriers and arena walls.
 *
 * `minY` / `maxY` bound the heights at which the obstacle is solid: a viaduct pillar only
 * stops a car on the ground, a building only reaches as high as its roof, and a car on the
 * deck above sails past both. Either bound left out is open-ended.
 */
export interface ObstacleBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY?: number;
  maxY?: number;
  /** Optional tag for debugging / presentation. */
  tag?: string;
}

/**
 * Wall segment collider from a to b, for tracks with curves and diagonals that boxes cannot
 * follow. Solid on both sides; the car (a circle) is pushed off the segment. The height
 * bounds work as on `ObstacleBox`: a guardrail on a viaduct is not a wall for the street below.
 */
export interface ObstacleWall {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  minY?: number;
  maxY?: number;
  tag?: string;
}

export interface SpawnPoint {
  x: number;
  z: number;
  heading: number;
  /** Height of the road at the spawn (m). Missing = the ground. */
  y?: number;
}

/** Height and slope of the drivable surface under a point. Written by `SurfaceField.sample`. */
export interface SurfaceSample {
  y: number;
  /** Rise of the surface per metre of +x / +z travel. */
  gx: number;
  gz: number;
}

/**
 * The drivable surface of a world with elevated roads. `sample` answers with the highest
 * surface at (x, z) that a body at height `yHint` can step onto: an overpass and the street
 * under it share an (x, z), a body keeps the level it is on because its own height is the
 * hint, and a ramp carries it up because each tick the ramp is only a few centimetres higher.
 * The ground (y 0, flat) is always a candidate. Allocation-free; called for every moving body
 * every tick.
 */
export interface SurfaceField {
  sample(x: number, z: number, yHint: number, out: SurfaceSample): void;
}

/** A line across the track. Crossing it in the direction (fx, fz) counts. */
export interface RaceGate {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  fx: number;
  fz: number;
  /** Station of the gate along the lap (m). */
  s: number;
}

/** A shortcut off the main lap: its own path, and the main-lap stations where it leaves and rejoins. */
export interface RaceShortcut {
  path: TrackPath;
  sIn: number;
  sOut: number;
}

/** Everything race mode needs to know about the circuit. Built by `src/world/raceWorld.ts`. */
export interface RaceCourse {
  laps: number;
  /** gates[0] is the start/finish line; the rest are checkpoints in lap order. */
  gates: RaceGate[];
  /** Grid slots just past the line. Slot 0 is the local player; the rest are for multiplayer. */
  grid: SpawnPoint[];
  /** Lap centreline: progress, wrong-way detection, the minimap. */
  path: TrackPath;
  shortcuts: RaceShortcut[];
}

/** Drivable surfaces in map coordinates, for the minimap. */
export interface MinimapData {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Axis-aligned road rectangles. */
  rects: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  /** Roads as centreline polylines with a width. `hidden` ribbons (shortcuts) are not drawn. */
  ribbons: Array<{ points: Array<{ x: number; z: number }>; width: number; closed: boolean; hidden: boolean; elevated?: boolean }>;
  /** Water, drawn under the roads. */
  water?: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  /**
   * Fixed things to go and do, marked on the map so they can be found rather than stumbled on.
   * Today that is the RAYO RUSH marker; the array is what says a second one would not need a
   * second field. Unlike the electric cars — which are deliberately NOT drawn, because hunting
   * them is the game — an activity is a destination, and a destination the player cannot find
   * is not a destination.
   */
  activities?: Array<{ x: number; z: number }>;
}

/** Static arena data consumed by both the simulation (collision, spawns) and the renderer. */
export interface ArenaLayout {
  /** Drivable extents, used as a last-resort clamp. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  playerSpawn: SpawnPoint;
  /** At least 3 entries. Each electric car starts at one of these. */
  targetSpawns: SpawnPoint[];
  /** Optional patrol loops. Each target follows the loop with the same index, when present. */
  targetPatrols: Array<Array<{ x: number; z: number }>>;
  /** Closed scenic loop along road centrelines, driven by cruise mode (`src/sim/cruise.ts`). */
  cruiseRoute: Array<{ x: number; z: number }>;
  colliders: ObstacleBox[];
  /** Segment colliders (guardrails, alley walls). Empty on the box-only test city. */
  walls: ObstacleWall[];
  /** Drivable heights, when the world has roads off the ground. Null = everything at y 0. */
  surface: SurfaceField | null;
  /** Race course, when this world hosts races. */
  race: RaceCourse | null;
  /** Where the Rayo Rush marker stands, in worlds that have one. Null everywhere else. */
  rushSite?: ActivitySite | null;
  /** Bus routes, when the world runs buses. Empty or missing everywhere but the city. */
  busRoutes?: BusRoute[];
  minimap: MinimapData;
}

/**
 * One bus route: a closed loop of waypoints along street centrelines, driven in the kerb
 * lane, and the stations along it where the bus pulls in and waits.
 *
 * `stops` are distances from the start of the loop, in metres, already in the order the bus
 * meets them. The route is the same object the shelters were placed against, so a bus only
 * ever pulls in where there is a shelter to pull in at.
 */
export interface BusRoute {
  points: Array<{ x: number; z: number }>;
  stops: number[];
}

/** Read-only view of the state that the HUD needs. Built by `src/game.ts`. */
export interface HudSnapshot {
  speedKmh: number;
  /** 0..1 */
  nitro: number;
  nitroActive: boolean;
  /** 0..1 */
  charge: number;
  canFire: boolean;
  drifting: boolean;
  driftDuration: number;
  chain: number;
  money: number;
  destroyed: number;
  /** Near misses scored this session. */
  nearMisses: number;
  targetsRemaining: number;
  targetsTotal: number;
  targetAcquired: boolean;
  /** 0..1 of the hold needed for a full-range shot (0 when no shot is charging). */
  aim01: number;
  /** Reach of the shot as currently charged (m). */
  aimRange: number;
  lastReward: number;
  time: number;
  /** True while the car moves backwards. */
  reversing: boolean;
  /** 0..1 fraction of the lightning cooldown remaining (0 = can fire again). */
  cooldown01: number;
  /** Seconds remaining in which a new drift extends the chain (0 when no chain is pending). */
  chainWindow: number;
  /** True while nitro is actually refilling this frame. */
  nitroRecharging: boolean;
  /** True while cruise mode is driving the car. */
  cruising: boolean;
  /**
   * Engine rpm: 0 at idle, 1 at redline. The same `VehicleState.rpm01` the engine voice revs
   * on, so the needle and the sound shift together.
   */
  rpm01: number;
  /** Zero-based gear of the automatic (`DRIVETRAIN.gearTops`). Displayed as `gear + 1`. */
  gear: number;
  /** True while a drift is held: the tacho shows the torque band the needle has to sit in. */
  torqueBand: boolean;
  /** Manual transmission selected. */
  manual: boolean;
  /** Front wheel angle as a fraction of full lock (-1..1, positive = right). */
  steer: number;
  /** `VehicleState.counterSteer`, for the wheel indicator's tint. */
  counterSteer: number;
  mode: GameMode;
  /** Race readout; null outside race mode. */
  race: RaceHudSnapshot | null;
  /** Rayo Rush readout; null in a world without the activity. */
  rush: RushHudSnapshot | null;
}

/**
 * What the Rayo Rush overlay needs. A flattened read-only view of `RushState` plus the two
 * things the rules cannot know: how many ranked attempts are left today and what the player's
 * previous personal best was, both of which live outside the simulation (`src/net/leaderboard.ts`).
 */
export interface RushHudSnapshot {
  phase: RushPhase;
  /** Seconds left of the count-in. */
  countdown: number;
  /** Seconds left on the clock. */
  timeLeft: number;
  score: number;
  disabled: number;
  chain: number;
  multiplier: number;
  /** 0..1 of the chain window still open, for the streak's drain bar. */
  chainFraction: number;
  bestChain: number;
  styleBonus: number;
  /** True while the player is physically inside the marker. */
  atMarker: boolean;
  /**
   * True when the marker is actually OFFERING a run (`canStartRush`). Not the same as being
   * inside it: after a run the marker stays quiet until the player has driven away and come
   * back, and the prompt follows this rather than `atMarker` so it never offers nothing.
   */
  canStart: boolean;
  /** Ranked attempts left today, or -1 while that is still unknown. */
  attemptsLeft: number;
  /** True when starting now would be a ranked attempt. */
  ranked: boolean;
  /** Personal best before this run, or -1 when there is none. */
  previousBest: number;
  /** The finished run, or null. */
  results: RushResults | null;
  /** True when `results.score` beat `previousBest`. */
  newBest: boolean;
}

export interface RaceHudSnapshot {
  phase: RacePhase;
  countdown: number;
  lap: number;
  laps: number;
  /** Seconds since GO. */
  elapsed: number;
  /** Seconds into the current lap. */
  lapTime: number;
  lastLap: number;
  bestLap: number;
  finishTime: number;
  wrongWay: boolean;
  /** Fraction of the current lap completed (0..1). */
  lapFraction: number;
}

/**
 * The theme song, reduced to four independent 0..1 levels. Produced by `src/audio/theme.ts`
 * and consumed by the environment, which wires each one to a different family of lights so
 * the city reacts to the song in layers instead of flashing as a single block.
 */
export interface MusicBands {
  /** Kick and sub energy. Snaps up on a hit and hangs; the punch in the scene. */
  bass: number;
  /** Snare, chords and vocal body. Rises and falls slowly — a swell behind the kick. */
  mid: number;
  /** Hats and shimmer. On and off within a frame or two; reads as a tick. */
  high: number;
  /** Overall loudness, followed over seconds. Rises through a chorus, sags in a breakdown. */
  energy: number;
}

/** All bands at rest. Used wherever music is unavailable or not wired up. */
export const SILENT_MUSIC: MusicBands = { bass: 0, mid: 0, high: 0, energy: 0 };
