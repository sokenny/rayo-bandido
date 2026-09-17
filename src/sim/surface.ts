import type { ArenaLayout, SurfaceField, SurfaceSample, TargetState, VehicleState } from '../core/types';
import { ROAD_ROUGHNESS, SIM_STEP, VERTICAL } from '../config/tuning';
import { forwardX, forwardZ, rightX, rightZ } from '../core/math';
import { sampleRoadRoughness, type RoadRoughnessSample } from './roadRoughness';

/**
 * Elevation. The handling model is planar; this is where a body learns how high the road under
 * it is, and — for the cars — what gravity does about it.
 *
 * TARGETS (traffic, police) are pinned: `settleTarget` asks the layout's surface field for the
 * surface nearest the height the body already had — that is what keeps a car on a viaduct from
 * being dropped to the street below it, and a car under the viaduct from being lifted onto it —
 * and writes the height back.
 *
 * VEHICLES (the player and the race rivals) are a sprung rigid body in the vertical plane:
 * height and vertical velocity, pitch and roll with their rates. Each of the four wheels asks
 * the surface field for the road under ITSELF, at a hint of its own height, and pushes the body
 * up with a preloaded spring and a damper (`VERTICAL`). Everything else falls out of that:
 *  - a crest taken faster than gravity can follow (curvature x speed^2 > g) unloads the springs
 *    and the car flies, carrying the vertical speed the ramp gave it;
 *  - a ledge unloads the front wheels first, so a car rolling slowly off a deck tips nose down
 *    and one leaving fast stays nearly level: the rear holds the nose up for less time;
 *  - leaving sideways does the same about the roll axis;
 *  - a landing loads whichever wheels arrive first, so a nose-down touchdown rotates the car
 *    back onto all four, and a drop too big for the springs bottoms out (`bumpTravel`) into a
 *    near-dead impulse at that corner.
 * While no wheel touches for `airGrace`, `airborne` is set and `stepVehicle` stops asking the
 * tyres for anything: the car keeps its velocity and its yaw rate until it is back down.
 *
 * The road is not a plane under the wheels: `src/sim/roadRoughness.ts` lays a few centimetres of
 * unevenness over the surface field (`ArenaLayout.roughness`), so the springs never quite rest
 * at speed. What they push with is handed to the handling model as `tyreLoad` / `loadSkew`.
 *
 * The horizontal motion stays the handling model's; the road's push is treated as vertical,
 * which is what leaves the planar model's tuning untouched on a street.
 *
 * A world with no surface field is flat ground at y 0: the same body, nothing to fall off.
 * Allocation-free.
 */
const SAMPLE: SurfaceSample = { y: 0, gx: 0, gz: 0 };
const ROUGH: RoadRoughnessSample = { h: 0, gx: 0, gz: 0 };
/** Wheel order: front-left, front-right, rear-left, rear-right. */
const SIGN_A = [1, 1, -1, -1];
const SIGN_B = [-1, 1, -1, 1];
const CORNER_SY = new Float64Array(4);
const CORNER_GX = new Float64Array(4);
const CORNER_GZ = new Float64Array(4);
const BUMP_CLOSING = new Float64Array(4);
const CORNER_FORCE = new Float64Array(4);
const BUMP_PASSES = 8;

function sampleSurface(field: SurfaceField | null, x: number, z: number, hint: number): void {
  if (field) field.sample(x, z, hint, SAMPLE);
  else {
    SAMPLE.y = 0;
    SAMPLE.gx = 0;
    SAMPLE.gz = 0;
  }
}

export function settleVehicle(v: VehicleState, layout: ArenaLayout, dt = SIM_STEP): void {
  const field = layout.surface;
  const g = VERTICAL.gravity;
  const A = VERTICAL.halfWheelbase;
  const B = VERTICAL.halfTrack;
  const IP = VERTICAL.pitchInertia;
  const IR = VERTICAL.rollInertia;
  // Per corner, per unit mass: the four springs together ring at `springFrequency`.
  const w = VERTICAL.springFrequency;
  const K = (w * w) / 4;
  const C = (2 * VERTICAL.springDamping * w) / 4;
  const fx = forwardX(v.heading);
  const fz = forwardZ(v.heading);
  const rx = rightX(v.heading);
  const rz = rightZ(v.heading);
  const airTimeBefore = v.airTime;
  const roughness = layout.roughness ?? 1;

  // --- Springs: each wheel reads the road under itself. ----------------------------------
  let cp = Math.cos(v.pitch);
  let sp = Math.sin(v.pitch);
  let cr = Math.cos(v.roll);
  let sr = Math.sin(v.roll);
  let lift = 0;
  let torqueP = 0;
  let torqueR = 0;
  let contacts = 0;
  let touchdown = 0;
  // A falling wheel looks as far down as it will travel this tick, so a fast drop cannot step
  // past a deck between two probes.
  const fall = v.vy < 0 ? -v.vy * dt : 0;
  for (let i = 0; i < 4; i++) {
    const a = SIGN_A[i] * A;
    const b = SIGN_B[i] * B;
    const cx = v.x + fx * a * cp + rx * b * cr;
    const cz = v.z + fz * a * cp + rz * b * cr;
    const cy = v.y + a * sp + b * sr;
    sampleSurface(field, cx, cz, cy + fall);
    if (roughness > 0) {
      sampleRoadRoughness(cx, cz, roughness, ROUGH);
      SAMPLE.y += ROUGH.h;
      SAMPLE.gx += ROUGH.gx;
      SAMPLE.gz += ROUGH.gz;
    }
    CORNER_FORCE[i] = 0;
    CORNER_SY[i] = SAMPLE.y;
    CORNER_GX[i] = SAMPLE.gx;
    CORNER_GZ[i] = SAMPLE.gz;
    // Compressed by `pen`; preloaded, so it can hang `g / 4K` below the road before it leaves.
    const pen = SAMPLE.y - cy;
    let force = g / 4 + K * pen;
    if (force <= 0) continue;
    // How fast the road closes on this wheel: the road's own rise under the car's motion, less
    // the wheel's vertical speed (body heave plus the rotations' share at this corner).
    const wheelVy = v.vy + a * cp * v.pitchRate + b * cr * v.rollRate;
    const closing = SAMPLE.gx * v.vx + SAMPLE.gz * v.vz - wheelVy;
    force = Math.max(0, force + C * closing);
    CORNER_FORCE[i] = force;
    contacts++;
    if (closing > touchdown) touchdown = closing;
    lift += force;
    torqueP += force * a * cp;
    torqueR += force * b * cr;
  }

  // --- What the tyres feel: the springs' push, relaxed (a tyre builds force as it rolls). ---
  const relax = 1 - Math.exp(-ROAD_ROUGHNESS.loadRelax * dt);
  v.tyreLoad += (lift / g - v.tyreLoad) * relax;
  v.loadSkew += (((CORNER_FORCE[1] - CORNER_FORCE[0]) * 2) / g - v.loadSkew) * relax;

  // --- Integrate. -------------------------------------------------------------------------
  v.vy = Math.max(-VERTICAL.maxFallSpeed, v.vy + (lift - g) * dt);
  v.pitchRate += (torqueP / IP) * dt;
  v.rollRate += (torqueR / IR) * dt;
  if (contacts === 0) {
    const spin = Math.exp(-VERTICAL.airSpinDamping * dt);
    v.pitchRate *= spin;
    v.rollRate *= spin;
  }
  v.y += v.vy * dt;
  v.pitch += v.pitchRate * dt;
  v.roll += v.rollRate * dt;

  // --- Bump stops: a wheel pushed past its travel takes the rest rigidly. -----------------
  // Every bottomed wheel is solved against the same body state and their pushes are averaged
  // (Jacobi, not wheel by wheel): solved in order, the first wheel of a flat landing would take
  // the whole hit and throw the car onto its side. A few passes converge on the shared answer.
  // Position is corrected in full (no visible sinking into the road), velocity by an impulse
  // with a little bounce left in it — judged on the closing speed before the first pass, so the
  // bounce is not compounded pass over pass.
  for (let pass = 0; pass < BUMP_PASSES; pass++) {
    cp = Math.cos(v.pitch);
    sp = Math.sin(v.pitch);
    cr = Math.cos(v.roll);
    sr = Math.sin(v.roll);
    let hits = 0;
    let dY = 0;
    let dP = 0;
    let dR = 0;
    let jY = 0;
    let jP = 0;
    let jR = 0;
    for (let i = 0; i < 4; i++) {
      const a = SIGN_A[i] * A;
      const b = SIGN_B[i] * B;
      const excess = CORNER_SY[i] - (v.y + a * sp + b * sr) - VERTICAL.bumpTravel;
      if (excess <= 0) continue;
      hits++;
      const ap = a * cp;
      const br = b * cr;
      const share = 1 + (ap * ap) / IP + (br * br) / IR;
      const dy = excess / share;
      dY += dy;
      dP += (dy * ap) / IP;
      dR += (dy * br) / IR;
      const wheelVy = v.vy + ap * v.pitchRate + br * v.rollRate;
      const closing = CORNER_GX[i] * v.vx + CORNER_GZ[i] * v.vz - wheelVy;
      if (pass === 0 && closing > 0) {
        if (closing > touchdown) touchdown = closing;
        BUMP_CLOSING[i] = closing;
      }
      // Drive the wheel toward leaving the road at the bounce of the speed it arrived at.
      const target = closing + VERTICAL.bumpRestitution * BUMP_CLOSING[i];
      if (target <= 0) continue;
      const j = target / share;
      jY += j;
      jP += (j * ap) / IP;
      jR += (j * br) / IR;
    }
    if (hits === 0) break;
    if (contacts === 0) contacts = 1;
    v.y += dY / hits;
    v.pitch += dP / hits;
    v.roll += dR / hits;
    v.vy += jY / hits;
    v.pitchRate += jP / hits;
    v.rollRate += jR / hits;
  }
  BUMP_CLOSING.fill(0);

  // --- A body on its wheels this far over is eased back; past the limits it is held. ------
  if (contacts > 0) {
    const ease = 1 - Math.exp(-VERTICAL.uprightRate * dt);
    const over = VERTICAL.uprightFrom;
    if (v.pitch > over || v.pitch < -over) v.pitch -= (v.pitch - Math.sign(v.pitch) * over) * ease;
    if (v.roll > over || v.roll < -over) v.roll -= (v.roll - Math.sign(v.roll) * over) * ease;
  }
  if (v.pitch > VERTICAL.maxPitch || v.pitch < -VERTICAL.maxPitch) {
    v.pitch = Math.sign(v.pitch) * VERTICAL.maxPitch;
    if (v.pitchRate * v.pitch > 0) v.pitchRate = 0;
  }
  if (v.roll > VERTICAL.maxRoll || v.roll < -VERTICAL.maxRoll) {
    v.roll = Math.sign(v.roll) * VERTICAL.maxRoll;
    if (v.rollRate * v.roll > 0) v.rollRate = 0;
  }

  // --- Flight bookkeeping. ------------------------------------------------------------------
  v.landingImpact = 0;
  if (contacts > 0) {
    if (airTimeBefore >= VERTICAL.landingMinAir) {
      v.landingImpact = touchdown;
      // The tyres meet the road at whatever the car carries, and scrub some of it.
      const scrub = 1 - Math.min(VERTICAL.landingScrubMax, touchdown * VERTICAL.landingScrub);
      v.vx *= scrub;
      v.vz *= scrub;
      v.speed *= scrub;
      v.lateralSpeed *= scrub;
    }
    v.airTime = 0;
  } else v.airTime += dt;
  v.airborne = v.airTime > VERTICAL.airGrace;
}

/**
 * Stand a car on the road at the height it was just given: no flight, no spin. For every place
 * that writes a pose directly (spawns, recoveries, teleports).
 */
export function restVehicle(v: VehicleState): void {
  v.prevY = v.y;
  v.vy = 0;
  v.pitch = 0;
  v.roll = 0;
  v.pitchRate = 0;
  v.rollRate = 0;
  v.airborne = false;
  v.airTime = 0;
  v.landingImpact = 0;
  v.tyreLoad = 1;
  v.loadSkew = 0;
}

export function settleTarget(t: TargetState, layout: ArenaLayout): void {
  const field = layout.surface;
  if (!field) {
    t.y = 0;
    return;
  }
  field.sample(t.x, t.z, t.y, SAMPLE);
  t.y = SAMPLE.y;
}
