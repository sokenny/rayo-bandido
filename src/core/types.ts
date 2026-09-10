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
import type { RoadGraph, RouteAim, RouteField } from '../world/roadGraph';

/** Which world is loaded: the free-roam test city, the racing circuit or the big city. */
export type GameMode = 'test' | 'race' | 'city' | 'circuit' | 'street';

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
  /**
   * Charge drawn so far by the shot being charged (0 when not charging). The load is paid for
   * as it is loaded, so this is what a fumble has to hand back.
   */
  spent: number;
  /** True while a shot is charging: fire is held and the load is being paid for as it builds. */
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
  /**
   * What the player is told to call this place, in the chrome's own shouting case
   * ("DOWNTOWN CANYON"). The world names its own streets — the rules only know there is a
   * point here — so a mission that moves can say WHERE it moved to without the tuning file
   * having to learn any city's geography.
   */
  label?: string;
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
  /**
   * Which mission this run was for (0-based), what it asked for, and where it was driven —
   * frozen here rather than read back off `RushState`, because by the time the card is up the
   * state has ALREADY moved on to the next mission. The card has to describe the run that just
   * ended, not the one now on offer.
   */
  level: number;
  targetScore: number;
  /** The site's `label`, or '' in a world that does not name its sites. */
  levelLabel: string;
  /** True when `score` met `targetScore`. */
  cleared: boolean;
  /** True when this run was the one that unlocked the next mission (so: cleared, and first). */
  advanced: boolean;
}

export interface RushState {
  phase: RushPhase;
  /**
   * How many missions of `RUSH.levels` this player has finished, 0..`RUSH.levels.length`. THE
   * one number the chain is made of: which mission is on offer, which site the marker stands
   * on and what score it is asking for are all derived from it (`rushLevelIndex`), so there is
   * no second copy to fall out of step with it. It survives a restart and is mirrored to
   * localStorage by the caller (`src/core/progress.ts`) — the rules only ever move it forward
   * by one, at the end of a run that met the target.
   */
  cleared: number;
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
   * True while another free-world activity has the player — a passenger in the car
   * (`src/sim/passenger.ts`). Written by the orchestrator every tick, never by the rules; while
   * it is set the marker offers nothing, so the two activities cannot overlap.
   */
  locked: boolean;
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
   * Seconds left before the results card puts itself away. Counts down only while the card is
   * up, so a player who has walked off after a run gets the world back rather than a screen
   * waiting on a key that is never coming. Pressing F still dismisses it early.
   */
  resultsHold: number;
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
 * TIME ATTACK (`src/sim/timeAttack.ts`): the mission chain wrapped round the offline circuit.
 *
 * It owns no clock and no course of its own — the race already has both. All this holds is
 * how far through the chain the player is, what the run under way has cost them in crashes,
 * and the card the last one ended on.
 */
export interface TimeAttackState {
  /**
   * How many missions of `TIME_ATTACK.levels` this player has finished, 0..levels.length. THE
   * one number the chain is made of: which mission is on offer and what it asks for are both
   * derived from it, so there is no second copy to fall out of step with it. Mirrored to
   * localStorage by the caller (`src/core/progress.ts`).
   */
  cleared: number;
  /** Crashes counted in the run under way. */
  crashes: number;
  /** Seconds left in which another impact is still the same accident. 0 = ready to count one. */
  crashCooldown: number;
  /**
   * True once the crash allowance has been spent: the run can no longer clear the mission
   * however fast it finishes. The race is NOT stopped — the lap is still worth driving, and
   * the time still counts as a personal best — the mission simply cannot be passed.
   */
  failed: boolean;
  /** The race phase this state has already reacted to, so a start and a finish are seen once. */
  phase: RacePhase;
  /** The finished run, or null until there is one. */
  results: TimeAttackResults | null;
}

/** What one finished run was worth. Frozen at the flag; read by the results card. */
export interface TimeAttackResults {
  /** Which mission this run was for (0-based) and what it asked for, frozen: by the time the
   * card is up the chain may already have moved on to the next one. */
  level: number;
  levelName: string;
  targetTime: number;
  crashLimit: number;
  /** The race's own finish time (s) and what the run actually cost in crashes. */
  time: number;
  crashes: number;
  /** The two halves of the verdict, kept apart so the card can say WHICH one was missed. */
  withinTime: boolean;
  withinCrashes: boolean;
  /** True when both were met. */
  cleared: boolean;
  /** True when this run was the one that unlocked the next mission (so: cleared, and first). */
  advanced: boolean;
}

/**
 * THE WAY INTO THE CHAIN, from the street (`src/sim/circuitGate.ts`).
 *
 * The missions themselves are judged on the circuit; this is the ring painted across the
 * Bandido Grid's start/finish line in the open world, which is how they are found at all. It
 * holds nothing but where the car is in relation to that ring and whether the offer is live —
 * the chain's own progress lives in `TimeAttackState`, on the other side of the load.
 */
export interface CircuitGateState {
  /** True while the car is standing on the paint. */
  atSite: boolean;
  /**
   * Another activity has the car, so this one is not on offer. Written by the orchestrator
   * (`src/sim/gameState.ts`) before this module runs, exactly as it is for the other three.
   */
  locked: boolean;
  /**
   * False from the moment the key is taken until the car has driven `rearmRadius` clear. What
   * stops a player who comes back out of the circuit landing on the ring and being sent
   * straight back into it.
   */
  rearmed: boolean;
  /**
   * True once the key has been pressed. The rules are done at that point — the caller is
   * loading another world — and this is what stops a second press raising a second entry.
   */
  entering: boolean;
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
  | {
      type: 'lightningFired';
      targetId: number;
      fromX: number;
      fromY: number;
      fromZ: number;
      toX: number;
      toY: number;
      toZ: number;
      /** How far the bolt travelled (m), to the car it hit or to where its reach ran out. */
      distance: number;
      /** Charge the shot took, down payment and hold together. */
      spent: number;
    }
  | { type: 'lightningDenied'; reason: 'noCharge' | 'noTarget' | 'cooldown' | 'short' }
  | {
      type: 'targetDestroyed';
      targetId: number;
      x: number;
      y: number;
      z: number;
      reward: number;
      /** Muzzle-to-car distance of the shot that did it (m). 0 when nothing shot it. */
      distance: number;
    }
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
  /**
   * A crash was counted against the run's allowance. `crashes` is the new total, `allowance`
   * what the mission permits and `fatal` whether this was the one that spent it.
   */
  | { type: 'timeAttackCrash'; crashes: number; allowance: number; impact: number; fatal: boolean }
  /** The run ended. Raised at the chequered flag, after `raceFinish`. */
  | { type: 'timeAttackEnd'; results: TimeAttackResults }
  /** A mission was cleared for the first time and the chain moved on. Raised before `timeAttackEnd`. */
  | { type: 'timeAttackLevelUp'; level: number; cleared: number; allClear: boolean }
  /**
   * The start line started or stopped offering the circuit missions — the car rolled onto the
   * painted ring, or off it. Presentation only, exactly like `rushPrompt`.
   */
  | { type: 'circuitPrompt'; on: boolean }
  /**
   * The key was pressed on the start line: take the player to the circuit. The rules stop here
   * — leaving one world for another is the caller's business (`src/game.ts` hands it up to
   * `src/main.ts`, which is the only thing here that knows what an address is).
   */
  | { type: 'circuitEnter' }
  /** A STREET RACE ring started or stopped offering its event. Presentation only. */
  | { type: 'streetRacePrompt'; on: boolean; event: number }
  /** The key was pressed on a STREET RACE ring: take the player to that event. */
  | { type: 'streetRaceEnter'; event: number }
  /** The player's car entered (index) or left (-1) a shortcut during a STREET RACE. */
  | { type: 'streetRaceShortcut'; shortcut: number }
  /** The player took the flag in a STREET RACE: the placement, and whether the chain moved on. */
  | { type: 'streetRaceEnd'; results: StreetRaceResults }
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
      /** Points inside `points` paid for the shot's reach: 0 for anything fired up close. */
      rangeBonus: number;
      /** How far the bolt travelled to get there (m). */
      shotDistance: number;
    }
  | { type: 'rushEnd'; results: RushResults }
  /**
   * A mission was cleared for the first time and the chain moved on. Raised immediately before
   * the `rushEnd` that carries the run itself, so anything listening sees the run and the
   * promotion in the order they happened.
   *
   * `cleared` is the new total, `level` the mission just finished, and `allClear` true when
   * that was the last one. Presentation and persistence both hang off this: the marker in the
   * world re-paints itself at the next site, the minimap re-marks it, and the browser writes
   * the new total down.
   */
  | { type: 'rushLevelUp'; level: number; cleared: number; allClear: boolean }
  /** The results card was dismissed; the world is back to plain free roam. */
  | { type: 'rushDismissed' }
  /* ---------------------------------------------------------------- passengers */
  /** A pin went up: someone at `stopId` wants a ride. */
  | { type: 'passengerOffer'; passengerId: string; stopId: string }
  /** The pickup prompt came up or went away (the car stopped on the pin, or left it). */
  | { type: 'passengerPrompt'; on: boolean }
  /** The passenger got in. The ride is on; the destination is marked. */
  | { type: 'passengerBoard'; passengerId: string; destinationId: string }
  /** A subtitle line started. `kind` is what it is for, so a listener can pick a sound. */
  | { type: 'passengerLine'; passengerId: string; text: string; kind: PassengerLineKind }
  /** Satisfaction moved by a discrete amount. `reason` names the rule; presentation shows it. */
  | { type: 'passengerMood'; delta: number; reason: PassengerReaction }
  /** The car is stopped inside the destination (or just left it). */
  | { type: 'passengerDropPrompt'; on: boolean }
  /** The ride is over and paid. Raised exactly once per completed ride. */
  | { type: 'passengerComplete'; results: PassengerResults }
  /** The ride ended without a drop-off. Nothing is paid. */
  | { type: 'passengerCancel'; passengerId: string; reason: 'player' | 'restart' | 'respawn' }
  /** The fare card was put away; free roam continues. */
  | { type: 'passengerDismissed' }

  /* ---------------------------------------------------------------- el búho */

  /** The car rolled onto / off El Búho's paint. */
  | { type: 'buhoPrompt'; on: boolean }
  /** He said something. The subtitle strip shows it for `lineSeconds`. */
  | { type: 'buhoLine'; text: string; kind: BuhoLineKind }
  /** Paid and taken; the Moogul's clock has started. `price` is 0 for a development grant. */
  | { type: 'buhoPurchase'; price: number }
  /** A press that bought nothing: no money, or one already in the player. */
  | { type: 'buhoDenied'; reason: 'funds' | 'active' }
  /** The Moogul wore off, or something else took the player before it could. */
  | { type: 'moogulEnd'; reason: MoogulEndReason }
  /* ---------------------------------------------------------------- the police */
  /** A civilian electric car was neutralised in Free Roam. `category` is the range band the heat came from. */
  | { type: 'policeOffense'; distance: number; category: PoliceOffenseCategory; heat: number; witnessed: boolean }
  /** A patrol saw the offence: it is alerted at once, whatever the heat says. */
  | { type: 'policeWitness'; unit: number }
  /** The star count changed. `cooldown` is true when the stars are the outlined, fading kind. */
  | { type: 'wantedStars'; stars: number; prev: number; cooldown: boolean }
  | { type: 'pursuitStart'; stars: number }
  /** Escaped, or the pursuit ended for another reason (`cleared` when an activity began). */
  | { type: 'pursuitEnd'; reason: 'escaped' | 'busted' | 'cleared'; duration: number }
  | { type: 'policeEscaping'; on: boolean }
  /**
   * Arrested. `fine` is what the stars asked for; `charged` is what the counter could pay
   * (`src/sim/economy.ts` fills it in — the fine is never a debt).
   */
  | { type: 'policeBusted'; stars: number; fine: number; charged: number; duration: number }
  /** The hold after the arrest is over and the car is the player's again. */
  | { type: 'policeReleased' }
  /** The bolt met a police car: shielded, nothing happens to it. For the feedback flash only. */
  | { type: 'policeShielded'; unit: number; x: number; y: number; z: number }
  /** The police were switched off because the player left Free Roam for an activity. */
  | { type: 'policeCleared' };

export type PoliceOffenseCategory = 'close' | 'medium' | 'far';

/**
 * One police car (`src/sim/police.ts`). Deliberately the same shape as an electric car, so
 * every piece of traffic infrastructure — wall push-out, road height, the player's bumps, the
 * beam test — takes it unchanged. `status` is `'active'` on the road and `'disabled'` in the
 * pool; nothing ever destroys one.
 */
export interface PoliceUnit extends TargetState {
  role: PoliceRole;
  /** Which civilian patrol loop (`ArenaLayout.targetPatrols` index) a patrol borrows. */
  loop: number;
  /** Where an investigating patrol is driving to. */
  goalX: number;
  goalZ: number;
  /** Seconds left on an investigation, or a reverse, depending on the role. */
  timer: number;
  /** Seconds this chaser has been pressed against a wall going nowhere. */
  stuck: number;
  /** True while this chaser can see the player (this tick). */
  sight: boolean;
  /** Emergency lights and siren on. Read by presentation. */
  lights: boolean;
}

export type PoliceRole = 'patrol' | 'investigate' | 'pursuit';

/**
 *   calm      - nothing going on. Patrols drive their loops.
 *   alert     - one star: patrols nearby drive to where it happened, nobody chases.
 *   pursuit   - somebody is chasing, and can see the car.
 *   escaping  - the chasers have lost the car; the countdown is running.
 *   busted    - arrested: the car is held and the card is up.
 *   cooldown  - escaped: the stars fade as the heat drains, nobody is chasing.
 */
export type PolicePhase = 'calm' | 'alert' | 'pursuit' | 'escaping' | 'busted' | 'cooldown';

/** Counters for the session, read by automation (`__rb.police.stats`). */
export interface PoliceStats {
  offenses: number;
  offensesClose: number;
  offensesMedium: number;
  offensesFar: number;
  witnessed: number;
  /** Times each star was newly reached, index = stars (0 unused). */
  starsReached: number[];
  pursuits: number;
  escapes: number;
  busts: number;
  /** Seconds spent in pursuit (escaping included), summed. */
  pursuitSeconds: number;
  finesCharged: number;
}

export interface PoliceState {
  /** The pool: `POLICE.maxUnits` cars, most of them `'disabled'` most of the time. */
  units: PoliceUnit[];
  /** 0..`POLICE.heat.max`. THE number the wanted level is made of. */
  heat: number;
  stars: number;
  phase: PolicePhase;
  /** Seconds since the police were last allowed; spawns wait for `resumeDelay`. */
  enabledFor: number;
  /** Seconds until the next patrol may spawn. */
  spawnCooldown: number;
  /** Seconds since the last offence. */
  sinceOffense: number;
  /** Seconds no chaser has had sight of the player. */
  noSight: number;
  /** True once any chaser has seen the player during this pursuit: the escape clock runs from then. */
  contacted: boolean;
  /** Seconds left of ESCAPING; 0 otherwise. */
  escapeLeft: number;
  /** Seconds the player has been pinned by a chaser. */
  pinned: number;
  /** Seconds left of the post-arrest hold; 0 otherwise. */
  holdLeft: number;
  /** Seconds after a release during which nothing spawns. */
  grace: number;
  /** Sim time the current pursuit began, or -1. */
  pursuitStart: number;
  /** Where the last offence happened: what an alerted patrol drives to. */
  lastOffenseX: number;
  lastOffenseZ: number;
  /** Which police car the beam is lined up on right now, or -1. For the shield feedback. */
  aimedUnit: number;
  /** The arrest card's numbers, while it is up. */
  bustedStars: number;
  bustedFine: number;
  /** Whether the police were allowed on the last tick: the edge that clears them. */
  wasEnabled: boolean;
  /** Seed of the spawn picker, so a session is deterministic. */
  seed: number;
  /** Seconds until the chasers' route to the player is recomputed. */
  routeTimer: number;
  /** Tick counter that spreads the line-of-sight tests across ticks. */
  losCounter: number;
  bustedCharged: number;
  /**
   * The street network the chasers steer by, when the world has one. An implementation detail
   * of `src/sim/police.ts` — built once from `ArenaLayout.roadNetwork`, never serialised.
   */
  nav: PoliceNav | null;
  stats: PoliceStats;
}

export interface PoliceNav {
  graph: RoadGraph;
  /** Road distances to the player, refreshed every `POLICE.pursuit.routeInterval`. */
  field: RouteField | null;
  aim: RouteAim;
}

/** What one of El Búho's lines is for. */
export type BuhoLineKind = 'greeting' | 'remark' | 'broke' | 'busy';

export type MoogulEndReason = 'expired' | 'interrupted' | 'restart' | 'respawn' | 'debug';

/**
 * El Búho and the Moogul (`src/sim/buho.ts`). The encounter is stateless beyond "is the car
 * on his paint" and "is a confirm armed"; the Moogul itself is one clock.
 */
export interface BuhoState {
  /** True while the car is inside his ring. */
  atSite: boolean;
  /** Which activity has the car. See `RushState.locked`; written by the orchestrator. */
  locked: boolean;
  /** Seconds left in which a second press buys. 0 = not armed. */
  confirmArm: number;
  /** Whether he has greeted this visit. Reset on leaving the ring. */
  greeted: boolean;
  /** Whether the Moogul is in the player, and for how long (simulation seconds). */
  moogulActive: boolean;
  moogulElapsed: number;
  /** Purchases this session. */
  purchases: number;
  /** A refusal on the prompt, and how long it has left. */
  notice: 'funds' | 'active' | null;
  noticeFor: number;
  /** The subtitle on screen and how long it has left. `lineId` increments per line. */
  line: string;
  lineKind: BuhoLineKind;
  lineId: number;
  lineTimeLeft: number;
  lastText: string;
  /** Deterministic pick state for line variants. */
  seed: number;
}

/**
 * A place a passenger can be picked up or dropped at: a stopping point on a road, named for
 * the player, and tagged so the catalogue can say which kinds of place a character goes to
 * without knowing any city's geography. The world validates that every one is on a road.
 */
export interface PassengerStop {
  id: string;
  x: number;
  z: number;
  /** Road height under it (m). */
  y: number;
  /** Which way the marker faces (rad). */
  heading: number;
  /** What the player is told to call it ("THE QUAY"). */
  label: string;
  /** What kind of place it is: matched against a passenger's pickup and destination tags. */
  tags: readonly string[];
}

/** What one subtitle line is for. Openings outrank reactions in the queue. */
export type PassengerLineKind = 'opening' | 'brief' | 'reaction' | 'arrival' | 'farewell';

/** The rules a passenger can care about. See `src/content/passengers.ts`. */
export type PassengerPreferenceKind = 'slow' | 'fast' | 'noDrift' | 'drift' | 'noRayo' | 'rayo';

/** The things a passenger can react to. Each is raised by exactly one rule in `src/sim/passenger.ts`. */
export type PassengerReaction =
  | 'goodSpeed'
  | 'tooFast'
  | 'tooSlow'
  | 'driftGood'
  | 'driftBad'
  | 'rayoGood'
  | 'rayoBad'
  | 'collision';

/**
 * Passengers (`src/sim/passenger.ts`).
 *
 *   idle     - nobody is waiting. A timer runs down to the next offer.
 *   offered  - a pin stands at a pickup stop; stopping on it raises the prompt.
 *   riding   - someone is in the car. Satisfaction is live; the destination is marked.
 *   results  - dropped off and paid. The fare card is up until it is dismissed.
 */
export type PassengerPhase = 'idle' | 'offered' | 'riding' | 'results';

/** How the passenger reads one of their preferences right now. */
export type PassengerPreferenceStatus = 'neutral' | 'good' | 'bad';

/** What one finished ride was worth. Frozen at the drop-off; read by the fare card. */
export interface PassengerResults {
  passengerId: string;
  passengerName: string;
  destinationLabel: string;
  /** Final satisfaction, 0..100. */
  mood: number;
  /** Which farewell was chosen. */
  tier: 'high' | 'medium' | 'low';
  /** Fixed at the offer: the trip's own price, paid whatever the mood. */
  fare: number;
  /** What the mood earned on top, 0..`PASSENGER.reward.maxTip`. */
  tip: number;
  /** How many discrete events moved the mood, for the breakdown. */
  bonuses: number;
  penalties: number;
}

/** A subtitle waiting its turn. `expires` is sim time; a stale reaction is dropped, not played late. */
export interface PassengerQueuedLine {
  text: string;
  kind: PassengerLineKind;
  priority: number;
  expires: number;
}

/**
 * The trip on offer or under way. Everything a ride needs is chosen HERE, before it starts:
 * which character, which two stops, which opening — so nothing is decided while driving.
 */
export interface PassengerTrip {
  passengerId: string;
  pickupId: string;
  destinationId: string;
  fare: number;
  /** Straight-line length of the trip (m), for the fare and the HUD. */
  distance: number;
  /** Which opening variant plays, chosen at the offer so it cannot change mid-boarding. */
  opening: number;
}

export interface PassengerState {
  phase: PassengerPhase;
  /** Which activity has the car. See `RushState.locked`. */
  locked: boolean;
  /** Seconds until the next pin goes up, while idle. */
  offerIn: number;
  /** How many offers have been made; the catalogue and the stops are rotated by it. */
  offers: number;
  trip: PassengerTrip | null;
  /** True while the car is stopped inside the pickup pin. */
  atPickup: boolean;
  /** True while the car is stopped inside the destination. */
  atDestination: boolean;
  /**
   * Seconds left before the fare card puts itself away, counted only while it is up. See
   * `RushState.resultsHold` — the same promise, that no card waits forever on a key.
   */
  resultsHold: number;
  /** Seconds left in which a second press of the key cancels the ride. 0 = not armed. */
  cancelArm: number;
  /** Satisfaction, 0..100. */
  mood: number;
  /** Per preference slot (0 and 1), how it reads this tick. */
  prefStatus: PassengerPreferenceStatus[];
  /** Seconds the car has been over a speed limit (slow) or dawdling (fast). */
  overTime: number;
  slowTime: number;
  /** Seconds of continuous satisfied speed, for the "this is nice" line. */
  goodStreak: number;
  /** Whether the arrival line has played this ride. */
  arrivalSaid: boolean;
  /** Mood gained from continuous driving so far this ride, against `maxFlowGain`. */
  flowGain: number;
  /** Mood gained from discrete events so far this ride, against `maxEventGain`. */
  eventGain: number;
  /** Seconds until the next bonus of each kind may pay again. */
  driftCooldown: number;
  rayoCooldown: number;
  collisionCooldown: number;
  /** Seconds until the next reaction line may play. */
  reactionCooldown: number;
  /** Seconds until the next speed nag may play. */
  speedLineCooldown: number;
  /** One flag per electric car: whether it has already counted on this ride. */
  counted: Uint8Array;
  bonuses: number;
  penalties: number;
  /** The subtitle on screen, and how long it has left. `lineId` increments per line. */
  line: string;
  lineKind: PassengerLineKind;
  lineId: number;
  lineTimeLeft: number;
  /** The last reaction text played, so the same line is never read twice in a row. */
  lastText: string;
  queue: PassengerQueuedLine[];
  /** Deterministic pick state for line variants. */
  seed: number;
  results: PassengerResults | null;
}

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
  /** Rayo Rush. Present in worlds that carry activity markers (`ArenaLayout.rushSites`). */
  rush: RushState | null;
  /**
   * The circuit mission chain. Present only when the caller asked for it — the solo circuit —
   * because the same course is also driven as a versus race, where a private mission has no
   * business judging anybody.
   */
  timeAttack: TimeAttackState | null;
  /** Passenger rides. Present in worlds that carry stops (`ArenaLayout.passengerStops`). */
  passenger: PassengerState | null;
  /** El Búho and the Moogul. Present in the world that has his bay (`ArenaLayout.buhoSite`). */
  buho: BuhoState | null;
  /**
   * The circuit chain's marker in the street. Present in worlds that carry the site
   * (`ArenaLayout.circuitSite`) — the open-world city, and nothing else: the circuit is not
   * entered from inside itself.
   */
  circuitGate: CircuitGateState | null;
  /**
   * The STREET RACE meetup markers (`src/sim/streetGate.ts`). Present in worlds that carry the
   * sites (`ArenaLayout.streetSites`) — the open-world city, and nothing else.
   */
  streetGate: StreetGateState | null;
  /** The police (`src/sim/police.ts`). Only the open world has any. */
  police: PoliceState | null;
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
  /**
   * An alternate segment that ALSO satisfies this gate: the same checkpoint, laid across a
   * shortcut. A branch in the route is a mandatory gate before it, one gate here with its main
   * segment on the main road and `alt` across the alley, and a mandatory gate after it — so
   * either branch counts and neither can be skipped (`src/sim/race.ts`).
   */
  alt?: { ax: number; az: number; bx: number; bz: number; fx: number; fz: number };
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
   * Things to go and do, marked on the map so they can be found rather than stumbled on. Today
   * that is the RAYO RUSH marker — one entry, wherever the mission chain currently has it
   * standing; the array is what says a second one would not need a second field. Unlike the electric cars — which are deliberately NOT drawn, because hunting
   * them is the game — an activity is a destination, and a destination the player cannot find
   * is not a destination.
   */
  activities?: Array<{ x: number; z: number; kind?: ActivityMarkKind }>;
}

/**
 * What a mark on the minimap stands for: the RAYO RUSH circle, a waiting passenger, where they
 * are going, or the start line the circuit missions are entered on.
 */
export type ActivityMarkKind = 'rush' | 'passenger' | 'destination' | 'circuit' | 'street';

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
  /**
   * Where the Rayo Rush marker stands, one site per mission of `RUSH.levels` and in the same
   * order, in worlds that carry the activity. Empty or missing everywhere else.
   *
   * The list is the world's answer to "where", the tuning's `levels` is the rules' answer to
   * "how much", and `rushSiteFor` in `src/sim/rush.ts` is the only place the two are put
   * together — including the clamp that lets a world ship fewer sites than there are missions.
   */
  rushSites?: ActivitySite[] | null;
  /**
   * Where passengers wait and where they are taken (`src/sim/passenger.ts`), in worlds that
   * carry the activity. Every one is a stopping point on a road; the world's tests say so.
   */
  passengerStops?: PassengerStop[] | null;
  /**
   * The drivable street centrelines, for working out a route between two points on them
   * (`src/world/roadGraph.ts`): today the destination arrow that leads a fare home. Ground
   * level only — an elevated road belongs here only if a car can get onto it from a junction
   * in this same list. Missing in worlds nothing needs to navigate.
   */
  roadNetwork?: Array<{ points: Array<{ x: number; z: number }> }> | null;
  /**
   * Where El Búho stands (`src/sim/buho.ts`), in the world that has him. One point under the
   * highway; the ring round it is `MOOGUL.marker`. Null or missing everywhere else.
   */
  buhoSite?: ActivitySite | null;
  /**
   * Where the circuit missions are entered from the street (`src/sim/circuitGate.ts`): the
   * Bandido Grid's own start/finish line, in the city the race is cut through. Null or missing
   * in every other world, the circuit included — a race is not somewhere you enter a race from.
   */
  circuitSite?: ActivitySite | null;
  /**
   * Where the STREET RACE events are met in the street (`src/sim/streetGate.ts`), one site per
   * event of `STREET_RACE.events` and in that order. Null or missing in every other world.
   */
  streetSites?: ActivitySite[] | null;
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
  /** Circuit mission readout; null outside the solo circuit. */
  timeAttack: TimeAttackHudSnapshot | null;
  /** Passenger readout; null in a world without stops. */
  passenger: PassengerHudSnapshot | null;
  /** El Búho's readout; null in a world without his bay. */
  buho: BuhoHudSnapshot | null;
  /** The start line's sign; null in a world that does not carry the circuit's entrance. */
  circuitGate: CircuitGateHudSnapshot | null;
  /** The STREET RACE rings' sign; null in a world that does not carry the sites. */
  streetGate: StreetGateHudSnapshot | null;
  /** The STREET RACE readout; null outside a Street Race. */
  streetRace: StreetRaceHudSnapshot | null;
  police: PoliceHudSnapshot | null;
}

/**
 * STREET RACE (`src/sim/streetGate.ts`, `src/sim/streetRace.ts`): the meetup rings in the open
 * world, and the race against AI rivals they lead to.
 */
export interface StreetGateState {
  /** Index of the open event whose ring the car is standing on, or -1. */
  atSite: number;
  /** Another activity has the car (`src/sim/activities.ts`). */
  locked: boolean;
  /** False from the moment the key is taken until the car has driven clear of the ring. */
  rearmed: boolean;
  /** True once the key has been pressed: the caller is loading the race. */
  entering: boolean;
  /** Events won, 0..`STREET_RACE.events.length`. Events 0..cleared (clamped) are open. */
  cleared: number;
}

export interface StreetRaceResults {
  event: number;
  eventName: string;
  /** 1 = winner. */
  placement: number;
  /** Cars in the race, the player included. */
  field: number;
  time: number;
  won: boolean;
  /** First win of this event: the chain moved on by one. */
  advanced: boolean;
  /** Money granted for a first win, 0 otherwise. */
  reward: number;
  /** Name of the event just unlocked, or null. */
  unlockedName: string | null;
  allClear: boolean;
}

export interface StreetRaceHudSnapshot {
  event: number;
  eventCount: number;
  eventName: string;
  difficulty: string;
  /** Live position, 1-based, and the size of the field. */
  position: number;
  field: number;
  /** Index of the shortcut the player is inside, or -1. */
  shortcut: number;
  results: StreetRaceResults | null;
}

export interface StreetGateHudSnapshot {
  offering: boolean;
  /** The event on offer (the ring the car is on, or the newest open one). */
  event: number;
  eventCount: number;
  eventName: string;
  difficulty: string;
  blurb: string;
  rivals: number;
  /** True when this event has already been won. */
  completed: boolean;
  placeLabel: string;
}

/**
 * What the start line's sign needs: whether it is offering, and which mission it is offering.
 * The chain's own progress is read from storage by the caller — the city carries no
 * `TimeAttackState`, because the missions are not driven in it.
 */
export interface PoliceHudSnapshot {
  /** 0..1 of the way to the top of the scale. */
  heat01: number;
  stars: number;
  phase: PolicePhase;
  /** Seconds left of ESCAPING (0 otherwise). */
  escapeLeft: number;
  /** 0..1 of the way to an arrest. */
  bust01: number;
  /** Seconds left of the post-arrest hold. */
  holdLeft: number;
  /** The beam is lined up on a police car: shielded. */
  shielded: boolean;
  /** The arrest card. */
  bustedStars: number;
  bustedFine: number;
  bustedCharged: number;
}

export interface CircuitGateHudSnapshot {
  /** True while the sign is up: the car is on the paint and nothing else has it. */
  offering: boolean;
  /** Mission on offer (0-based), how many there are, and what it asks for. */
  level: number;
  levelCount: number;
  levelName: string;
  targetTime: number;
  crashLimit: number;
  /** True once every mission has been cleared: the circuit is still there, it just stops gating. */
  allClear: boolean;
  /** What the world calls this place, from the site itself. */
  placeLabel: string;
}

/** What El Búho's overlay needs: a flattened read-only view of `BuhoState` plus the names it cannot know. */
export interface BuhoHudSnapshot {
  name: string;
  tagline: string;
  portrait: string;
  item: string;
  price: number;
  /** True while the car is on his paint. */
  atSite: boolean;
  /** True when a press would arm or buy (`canBuyMoogul`). */
  canBuy: boolean;
  /** Seconds left on the confirm; 0 when not armed. */
  confirmArm: number;
  /** A refusal on the prompt, while it lasts. */
  notice: 'funds' | 'active' | null;
  /** The Moogul, for the prompt's "come back later" and for the debug overlay. */
  active: boolean;
  intensity: number;
  line: string;
  lineId: number;
}

/** What the passenger overlay needs: a flattened read-only view of `PassengerState` plus the names it cannot know. */
export interface PassengerHudSnapshot {
  phase: PassengerPhase;
  passengerId: string;
  name: string;
  /** Handle or role under the name ("DEADAIR · STREAMER"). */
  tagline: string;
  /** Which portrait to draw (`src/ui/portraits.ts`). */
  portrait: string;
  /** True when stopping here would board / drop off (`canBoard` / `canDropOff`). */
  canBoard: boolean;
  canDropOff: boolean;
  /** Seconds left in which a second press cancels; 0 when not armed. */
  cancelArm: number;
  destinationLabel: string;
  /** Straight-line distance to the destination (m) while riding. */
  distance: number;
  fare: number;
  mood: number;
  /** The compact rule summary: one label per preference, and how it reads right now. */
  prefLabels: string[];
  prefStatus: PassengerPreferenceStatus[];
  line: string;
  lineKind: PassengerLineKind;
  lineId: number;
  results: PassengerResults | null;
}

/**
 * What the Rayo Rush overlay needs. A flattened read-only view of `RushState` plus the two
 * things the rules cannot know: how many ranked attempts are left today and what the player's
 * previous personal best was, both of which live outside the simulation (`src/net/leaderboard.ts`).
 */
export interface RushHudSnapshot {
  phase: RushPhase;
  /** Mission on offer / under way (0-based), and how many there are in all. */
  level: number;
  levelCount: number;
  /** How many are already finished. Equal to `levelCount` once the chain is done. */
  cleared: number;
  /** What the mission on offer is asking for. */
  targetScore: number;
  /** Where it is driven, or '' in a world that does not name its sites. */
  levelLabel: string;
  /** True once every mission has been cleared: the marker stays put and runs stop gating. */
  allClear: boolean;
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

/**
 * What the circuit mission needs on screen: the mission on offer, and how the run under way is
 * doing against it. A flattened read-only view of `TimeAttackState` plus the numbers the rules
 * keep in the tuning file rather than in the state.
 */
export interface TimeAttackHudSnapshot {
  /** Mission under way (0-based), how many there are in all, and how many are already done. */
  level: number;
  levelCount: number;
  cleared: number;
  levelName: string;
  /** What it asks for: a finish time (s) and a crash allowance. */
  targetTime: number;
  crashLimit: number;
  /** How the run under way stands. */
  crashes: number;
  failed: boolean;
  /** True once every mission has been cleared. The chain stops gating and keeps the last one. */
  allClear: boolean;
  /** The finished run, or null. */
  results: TimeAttackResults | null;
  /** Best finish time on this mission before this run, or -1 when there is none. */
  previousBest: number;
  /** True when the run that just finished beat it. */
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
