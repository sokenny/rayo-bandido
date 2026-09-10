import type { PlayerCommand, RaceCourse, VehicleState } from '../core/types';
import { STREET_RACE } from '../config/tuning';
import { clamp, wrapAngle } from '../core/math';
import { createProjection, pointAtStation, projectOntoPath, type PathProjection, type TrackPath } from '../world/track';

/**
 * THE RIVAL DRIVER: a look-ahead waypoint controller that produces a `PlayerCommand`.
 *
 * It drives the SAME car the player does — the command goes through `stepVehicle`, the wall
 * pass and the traffic pass exactly as the player's does — so a rival accelerates, brakes,
 * slides, collides and recovers by the vehicle model's rules, never by moving along a spline.
 *
 * ONE CONTROLLER, THREE TIERS. Everything that makes a rival easy or hard is a number in
 * `STREET_RACE.ai` (`AiTier`): how fast it asks to go, how much grip it believes it has in a
 * corner, how early it brakes, how far ahead it looks, how far off the line it wanders, how
 * often it makes a mistake and how likely it is to take a shortcut. There is no per-opponent
 * personality: two rivals of one tier differ only by their random seeds.
 *
 * THE ROUTE is the course itself. The racing line is the lap centreline (`RaceCourse.path`)
 * plus each shortcut's centreline; a rival aims `lookahead` metres ahead along whichever it is
 * on, and its speed plan is the tightest curvature inside its braking distance — the rival's
 * own belief about grip, not the physics', which is what lets a tier be wrong and drive wide.
 *
 * WHAT IT DOES NOT DO: no overtaking prediction, no defence, no obstacle avoidance beyond the
 * collision passes it shares with the player. A rival that is stuck reverses out; one that is
 * off its route steers back; one far off it for long enough is put back on the line — only
 * ever out of the player's sight (`STREET_RACE.recovery`).
 *
 * Pure: no Three.js, no DOM, no allocation per tick beyond the scratch projection each state
 * owns. Randomness is a seeded LCG in the state, so a race replays the same.
 */

export type AiTier = (typeof STREET_RACE.ai)[keyof typeof STREET_RACE.ai];

export interface RivalAiState {
  tier: AiTier;
  /** -1 on the main lap, else the index of the shortcut being driven. */
  route: number;
  /** Shortcut chosen for the next mouth, or -1. Decided once per approach. */
  chosen: number;
  /** Station of the last decision, so one mouth is rolled once. */
  decidedAt: number;
  /** Station along the active path, from the last projection. */
  station: number;
  /** Lateral wander (m) and how long until the next value is drawn. */
  noise: number;
  noiseTimer: number;
  /** Seconds until the next mistake roll, and seconds left in the current one. */
  mistakeTimer: number;
  mistakeLeft: number;
  /** Seconds spent stationary under throttle; seconds left reversing out. */
  stuckTime: number;
  reverseLeft: number;
  /** Seconds spent further than the recovery threshold from the route. */
  offRouteTime: number;
  /** Speed scale the rubber band is currently applying. Read by the HUD/debug only. */
  band: number;
  seed: number;
  /** Seconds left of the slow exit onto the street after leaving an alley. */
  mouthHold: number;
  /** True while this tick's command is a recovery manoeuvre. */
  recovering: boolean;
  proj: PathProjection;
  aim: PathProjection;
}

export function createRivalAiState(tier: AiTier, seed: number): RivalAiState {
  return {
    tier,
    route: -1,
    chosen: -1,
    decidedAt: -1e9,
    station: 0,
    noise: 0,
    noiseTimer: 0,
    mistakeTimer: tier.mistakeEvery,
    mistakeLeft: 0,
    stuckTime: 0,
    reverseLeft: 0,
    offRouteTime: 0,
    band: 1,
    seed: seed >>> 0 || 1,
    mouthHold: 0,
    recovering: false,
    proj: createProjection(),
    aim: createProjection(),
  };
}

export function resetRivalAiState(ai: RivalAiState): void {
  ai.route = -1;
  ai.chosen = -1;
  ai.decidedAt = -1e9;
  ai.station = 0;
  ai.noise = 0;
  ai.noiseTimer = 0;
  ai.mistakeTimer = ai.tier.mistakeEvery;
  ai.mistakeLeft = 0;
  ai.stuckTime = 0;
  ai.reverseLeft = 0;
  ai.offRouteTime = 0;
  ai.band = 1;
  ai.mouthHold = 0;
  ai.recovering = false;
}

/** Park-Miller LCG, 0..1. Deterministic per rival. */
export function nextRandom(ai: RivalAiState): number {
  ai.seed = (ai.seed * 48271) % 2147483647;
  return ai.seed / 2147483647;
}

/** Wipe a command to "hands off". */
function clearCommand(cmd: PlayerCommand): void {
  cmd.throttle = 0;
  cmd.brake = 0;
  cmd.steer = 0;
  cmd.handbrake = false;
  cmd.nitro = false;
  cmd.fire = false;
  cmd.restart = false;
  cmd.cruise = false;
  cmd.pov = false;
  cmd.shiftUp = false;
  cmd.shiftDown = false;
  cmd.transmission = false;
  cmd.activate = false;
}

/** The path the rival is currently following. */
function activePath(ai: RivalAiState, course: RaceCourse): TrackPath {
  return ai.route >= 0 ? course.shortcuts[ai.route].path : course.path;
}

/** How far ahead a shortcut mouth is decided, and how close the car has to be to commit. */
const DECIDE_AHEAD = 40;
const COMMIT_WITHIN = 4;
/** Braking-plan sampling step (m) and the least distance the plan looks (m). */
const PLAN_STEP = 5;
const PLAN_MIN = 20;
/** Heading error above which the rival slows right down to turn round (rad). */
const TURN_ROUND = Math.PI * 0.55;
/**
 * The speed a rival takes an alley's mouth at, as a fraction of its ceiling: the two right-angle
 * turns into and out of a shortcut are not on either centreline's curvature, so they are planned
 * as corners in their own right — at the mouth on the way in, at the alley's end on the way out.
 */
const MOUTH_SPEED = 0.22;
/** How far into an alley the mouth speed still applies: the length of the turn itself (m). */
const MOUTH_TURN = 14;
/** Seconds the mouth speed is held after leaving an alley, for the turn onto the street. */
const MOUTH_HOLD = 1.1;
/** The aim point is pulled in to this while turning into an alley, so the corner is not cut (m). */
const MOUTH_LOOKAHEAD = 7;

/**
 * Corner speed the tier believes in for a curvature: v = sqrt(a / k). Straight = the ceiling.
 */
function cornerSpeed(tier: AiTier, curvature: number, ceiling: number): number {
  const k = Math.abs(curvature);
  if (k < 1e-4) return ceiling;
  return Math.min(ceiling, Math.sqrt(tier.cornerGrip / k));
}

/**
 * One tick of the driver: writes `cmd` for the car `v` on `course`.
 *
 * `speedScale` is the rubber band (1 = none), `playerDistance` how far the player is (m), which
 * is what decides whether an off-route rival may be put back on the line. Returns true when the
 * rival was teleported this tick, so the caller can reset the car's visuals.
 */
export function stepRivalAi(
  ai: RivalAiState,
  v: VehicleState,
  course: RaceCourse,
  cmd: PlayerCommand,
  dt: number,
  speedScale: number,
  playerDistance: number,
): boolean {
  const tier = ai.tier;
  clearCommand(cmd);
  ai.recovering = false;
  ai.band = speedScale;

  /* ------------------------------------------------------------ where am I */
  let path = activePath(ai, course);
  projectOntoPath(path, v.x, v.z, ai.proj);
  if (ai.route >= 0) {
    const sc = course.shortcuts[ai.route];
    // Off the end of the alley, or lost the alley altogether: back to the lap.
    if (ai.proj.s >= sc.path.length - 2 || ai.proj.dist > ai.proj.halfWidth + STREET_RACE.recovery.offRouteMetres * 0.5) {
      ai.route = -1;
      path = course.path;
      projectOntoPath(path, v.x, v.z, ai.proj);
      // The right angle back onto the street is taken at mouth speed too.
      ai.mouthHold = MOUTH_HOLD;
    }
  }
  const L = path.length;
  ai.station = ai.proj.s;
  const speed = v.speed;

  /* ------------------------------------------------------------ shortcuts */
  /** Distance to the next mouth this rival has committed to, or -1: a corner to plan for. */
  let mouthAhead = -1;
  if (ai.route < 0) {
    for (let i = 0; i < course.shortcuts.length; i++) {
      const sc = course.shortcuts[i];
      let ahead = sc.sIn - ai.station;
      if (ahead < -COMMIT_WITHIN) ahead += course.path.length;
      if (ahead > DECIDE_AHEAD) continue;
      // One roll per approach: the decision is remembered by the station it was made at.
      let since = ai.station - ai.decidedAt;
      if (since < 0) since += course.path.length;
      if (since > DECIDE_AHEAD * 2) {
        ai.decidedAt = ai.station;
        ai.chosen = nextRandom(ai) < tier.shortcutChance ? i : -1;
      }
      if (ai.chosen === i && Math.abs(ahead) <= COMMIT_WITHIN) {
        ai.route = i;
        ai.chosen = -1;
        path = sc.path;
        projectOntoPath(path, v.x, v.z, ai.proj);
        ai.station = ai.proj.s;
        mouthAhead = 0;
      } else if (ai.chosen === i && ahead > 0) {
        mouthAhead = ahead;
      }
      break;
    }
  } else {
    // On the alley: its end is the next mouth, and its start is still the corner being turned.
    mouthAhead = ai.station < MOUTH_TURN ? 0 : Math.max(0, L - ai.station);
  }

  /* ------------------------------------------------------------ mistakes, wander */
  ai.noiseTimer -= dt;
  if (ai.noiseTimer <= 0) {
    ai.noiseTimer = 1.5 + nextRandom(ai) * 2;
    ai.noise = (nextRandom(ai) * 2 - 1) * tier.lineNoise;
  }
  if (ai.mistakeLeft > 0) ai.mistakeLeft -= dt;
  else {
    ai.mistakeTimer -= dt;
    if (ai.mistakeTimer <= 0) {
      ai.mistakeTimer = tier.mistakeEvery * (0.7 + nextRandom(ai) * 0.6);
      if (nextRandom(ai) < tier.mistakeChance) ai.mistakeLeft = tier.mistakeSeconds;
    }
  }
  const mistaken = ai.mistakeLeft > 0;

  /* ------------------------------------------------------------ the aim point */
  let lookahead = tier.lookaheadBase + tier.lookaheadPerSpeed * Math.max(0, speed);
  // Turning into an alley the aim is kept short, and inside one it never reaches past the end:
  // an aim point already out on the street pulls the car into the alley's wall.
  if (ai.route >= 0 && ai.station < MOUTH_TURN) lookahead = Math.min(lookahead, MOUTH_LOOKAHEAD);
  let aimS = ai.station + lookahead;
  const aimPath: TrackPath = path;
  if (ai.route >= 0 && aimS > L) aimS = L;
  pointAtStation(aimPath, aimS, ai.aim);
  const wander = mistaken ? ai.noise * 2.2 : ai.noise;
  // Right-hand normal of the tangent is (-tz, tx).
  const tx = ai.aim.x + -ai.aim.tz * wander;
  const tz = ai.aim.z + ai.aim.tx * wander;
  const want = Math.atan2(tx - v.x, -(tz - v.z));
  const err = wrapAngle(want - v.heading);

  /* ------------------------------------------------------------ the speed plan */
  const ceiling = tier.topSpeed * speedScale * (mistaken ? 1.12 : 1);
  const brakeDist = Math.max(PLAN_MIN, (speed * speed) / (2 * tier.brakeDecel) + PLAN_MIN);
  let target = ceiling;
  const scratch = ai.aim;
  for (let d = 0; d <= brakeDist; d += PLAN_STEP) {
    let s = ai.station + d;
    let p: TrackPath = path;
    if (ai.route >= 0 && s > L) {
      p = course.path;
      s = course.shortcuts[ai.route].sOut + (s - L);
    }
    pointAtStation(p, s, scratch);
    const k = p.samples[scratch.index].curvature;
    const vc = cornerSpeed(tier, k, ceiling);
    // Allowed now, given the corner is `d` metres away and the plan's deceleration.
    const allowed = Math.sqrt(vc * vc + 2 * tier.brakeDecel * d);
    if (allowed < target) target = allowed;
  }
  // A narrow road is driven slower: the alley is the tradeoff, not a free 70 m.
  if (ai.route >= 0) target = Math.min(target, tier.topSpeed * 0.62 * speedScale);
  // The right angle into or out of an alley, planned like any other corner.
  if (ai.mouthHold > 0) {
    ai.mouthHold -= dt;
    if (mouthAhead < 0) mouthAhead = 0;
  }
  if (mouthAhead >= 0) {
    const entry = tier.topSpeed * MOUTH_SPEED;
    target = Math.min(target, Math.sqrt(entry * entry + 2 * tier.brakeDecel * mouthAhead));
  }
  // Turning round, or well off the line: no point in speed.
  if (Math.abs(err) > TURN_ROUND) target = Math.min(target, STREET_RACE.recovery.wrongWayMaxSpeed);
  else if (Math.abs(err) > 0.6) target = Math.min(target, tier.topSpeed * 0.45);

  /* ------------------------------------------------------------ stuck, off route */
  const wantsForward = target > 2;
  if (wantsForward && Math.abs(speed) < 1 && ai.reverseLeft <= 0) ai.stuckTime += dt;
  else if (ai.reverseLeft <= 0) ai.stuckTime = 0;
  if (ai.stuckTime >= tier.stuckSeconds) {
    ai.stuckTime = 0;
    ai.reverseLeft = tier.reverseSeconds;
  }

  const offRoute = ai.proj.dist > ai.proj.halfWidth + STREET_RACE.recovery.offRouteMetres;
  ai.offRouteTime = offRoute ? ai.offRouteTime + dt : 0;
  if (ai.offRouteTime >= STREET_RACE.recovery.offRouteSeconds && playerDistance >= STREET_RACE.recovery.respawnMinPlayerDistance) {
    // Out of sight: back on the line at the station it fell off, facing down the lap.
    ai.offRouteTime = 0;
    ai.route = -1;
    pointAtStation(course.path, ai.station, ai.aim);
    placeOnLine(v, ai.aim);
    ai.recovering = true;
    cmd.handbrake = true;
    return true;
  }

  /* ------------------------------------------------------------ the command */
  if (ai.reverseLeft > 0) {
    ai.reverseLeft -= dt;
    ai.recovering = true;
    // Brake held from a standstill engages reverse (`src/sim/vehicle.ts`); steer away from
    // the aim point so the nose swings back toward it when drive is taken up again.
    cmd.brake = 1;
    cmd.steer = err > 0 ? -1 : 1;
    return false;
  }

  const steer = clamp(err * tier.steerGain - v.yawRate * tier.steerDamp, -1, 1);
  cmd.steer = steer;
  const deficit = target - speed;
  if (deficit >= 0) {
    cmd.throttle = clamp(deficit * tier.throttleGain + 0.15, 0, 1);
  } else {
    cmd.brake = clamp(-deficit * tier.brakeGain, 0, 1);
  }
  return false;
}

/** Stand the car on the line at a station, at rest, facing along it. */
export function placeOnLine(v: VehicleState, at: PathProjection): void {
  v.x = v.prevX = at.x;
  v.z = v.prevZ = at.z;
  v.y = v.prevY = at.y;
  v.heading = v.prevHeading = Math.atan2(at.tx, -at.tz);
  v.vx = 0;
  v.vz = 0;
  v.speed = 0;
  v.lateralSpeed = 0;
  v.yawRate = 0;
  v.slipAngle = 0;
  v.steerAngle = 0;
  v.pitch = 0;
  v.slide = 0;
  v.handbrake = false;
  v.collided = false;
}
