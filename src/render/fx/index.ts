import * as THREE from 'three';
import type { VehicleState } from '../../core/types';
import { VEHICLE } from '../../config/tuning';
import { clamp01, forwardX, forwardZ, rightX, rightZ } from '../../core/math';
import { createFxTextures } from './sprites';
import { createTireSmoke } from './tireSmoke';
import { createSkidMarks } from './skidMarks';
import {
  createNitroExhaust,
  EXHAUST_LOCAL_X,
  EXHAUST_LOCAL_Y,
  EXHAUST_LOCAL_Z,
} from './nitroExhaust';
import { createLightningArc, BOLT_FROM_Y, BOLT_TO_Y } from './lightningArc';
import { createSparkFx } from './sparks';
import { createShockRings } from './explosion';
import { createScorePopups, POPUP_KILL, POPUP_NEAR_MISS } from './scorePopup';

/**
 * Pooled visual effects. Everything here is pre-allocated at creation; nothing allocates
 * per frame or per event. Budgets are deliberately small (see docs/MVP_SPEC.md).
 *
 * CONTRACT (called from `src/game.ts`)
 * - `setCarPose` every render frame with the interpolated car pose: used to emit tire smoke
 *   from the rear wheels while drifting, lay skid marks, and drive the nitro exhaust.
 * - `lightning(fromX, fromZ, toX, toZ)` on a `lightningFired` event: a cyan/blue-white arc
 *   that clearly connects the car to the target for ~0.4 s.
 * - `backfire(strength)` when the exhaust pops: a flame spit at the tailpipes, in step with
 *   the bang from the audio layer (both are driven by the same trigger in `game.ts`).
 * - `explosion(x, z)` on `targetDestroyed`: stylized burst (sparks, flash, short-lived debris).
 * - `scorePopup(x, z, amount)` on `targetDestroyed`: a floating "+X" over the wreck.
 * - `nearMissPopup(x, z, amount)` on `nearMiss`: the same pop in cyan, captioned, over the car
 *   that was just shaved. Shares the one popup pool with kills.
 * - `collision(x, z, impact)` on collisions: a few sparks.
 * - `reset()` on restart: hide every live effect.
 *
 * BUDGET
 * - 10 draw calls when absolutely everything is on screen at once, fewer when idle
 *   (each pool hides itself when empty): tire smoke, skid marks, nitro flames, nitro trail,
 *   bolt core, bolt glow, bolt branches, shock rings, sparks, flashes; plus one per live
 *   score popup (5 slots, all hidden when nothing was scored recently). Kills and near misses
 *   share that one pool, so a flurry of passes can evict the oldest pop early - deliberate,
 *   since five numbers alive at once is already past what anyone reads at speed.
 * - ~2.6k triangles worst case (points are two triangles each).
 * - No allocation in `setCarPose`, `update` or any of the event entry points.
 */
export interface CarPose {
  x: number;
  /** Height of the road under the car (m). */
  y: number;
  z: number;
  heading: number;
}

export interface EffectsSystem {
  setCarPose(pose: CarPose, vehicle: VehicleState, drifting: boolean, nitro: number, frameDt: number): void;
  lightning(fromX: number, fromY: number, fromZ: number, toX: number, toY: number, toZ: number): void;
  explosion(x: number, y: number, z: number): void;
  /**
   * Flame out of the tailpipes for one exhaust pop (`strength` 0..1). Call after
   * `setCarPose` in the same frame — it fires from the tip positions that set.
   */
  backfire(strength: number): void;
  /** Floating acid-green "+X" reward number over a kill. */
  scorePopup(x: number, y: number, z: number, amount: number): void;
  /**
   * Floating cyan "NEAR MISS +X" over the car that was just shaved. Fired at the closest
   * approach, while that car is still alongside and on screen.
   */
  nearMissPopup(x: number, y: number, z: number, amount: number): void;
  collision(x: number, y: number, z: number, impact: number): void;
  update(frameDt: number, time: number): void;
  reset(): void;
  dispose(): void;
}

/** Lateral speed (m/s) at which the tires start to complain, and where they scream. */
const SLIP_START = 2.5;
const SLIP_FULL = 10;
/** Below this forward speed nothing is emitted, so a parked car never smokes. */
const MIN_SMOKE_SPEED = 2.5;
/** Slip that counts as sliding even when the drift rules have not latched yet. */
const SLIDE_LATERAL = 4;
/** Wheelspin below which the rears are not visibly spinning; matches `audio/dsp.ts:SKID`. */
const SPIN_START = 0.3;
/** Smoke of fully spinning rears with no sideways motion. */
const SPIN_SMOKE = 0.6;

/**
 * Backfire ignition colour: deep red-orange, hot enough to glow white in the additive core but
 * with no green to wash it toward yellow. Deliberately unlike the nitro magenta and the
 * lightning cyan, so a pop reads instantly as combustion.
 */
const BANG_R = 1;
const BANG_G = 0.3;
const BANG_B = 0.07;
/**
 * Embers thrown by a full-strength bang, split across the two tips. Deliberately sparse: a
 * handful of tracers reads as a crisp pop, where a dense burst starts to look like a plume.
 */
const BANG_EMBERS = 5;

export function createEffects(scene: THREE.Scene): EffectsSystem {
  const root = new THREE.Group();
  root.name = 'effects';
  scene.add(root);

  const textures = createFxTextures();
  const smoke = createTireSmoke(root, textures);
  const skid = createSkidMarks(root);
  const nitroFx = createNitroExhaust(root, textures);
  const bolt = createLightningArc(root, textures);
  const sparkFx = createSparkFx(root, textures);
  const rings = createShockRings(root);
  const popups = createScorePopups(root);

  const halfBase = VEHICLE.wheelbase / 2;
  const halfTrack = VEHICLE.trackWidth / 2;

  // Last exhaust tips in world space, so `backfire` can detonate without its own pose argument.
  let tipLeftX = 0;
  let tipLeftZ = 0;
  let tipRightX = 0;
  let tipRightZ = 0;
  let tipY = EXHAUST_LOCAL_Y;

  return {
    setCarPose(pose, vehicle, drifting, nitro, frameDt) {
      const fx = forwardX(pose.heading);
      const fz = forwardZ(pose.heading);
      const rx = rightX(pose.heading);
      const rz = rightZ(pose.heading);

      // Rear contact patches: behind the wheelbase center, one to each side.
      const rearX = pose.x - fx * halfBase;
      const rearZ = pose.z - fz * halfBase;
      const leftX = rearX - rx * halfTrack;
      const leftZ = rearZ - rz * halfTrack;
      const rightWheelX = rearX + rx * halfTrack;
      const rightWheelZ = rearZ + rz * halfTrack;

      const lateral = Math.abs(vehicle.lateralSpeed);
      const moving = Math.abs(vehicle.speed) > MIN_SMOKE_SPEED;
      const sliding = moving && (drifting || lateral > SLIDE_LATERAL);
      let intensity = 0;
      if (sliding) {
        intensity = clamp01((lateral - SLIP_START) / (SLIP_FULL - SLIP_START));
        // A latched drift always smokes, even in a smooth low-angle slide.
        if (drifting && intensity < 0.35) intensity = 0.35;
      }
      // Spinning rears smoke at any speed: a burnout at a standstill, the donut's cloud.
      if (vehicle.wheelspin > SPIN_START) {
        const spin = clamp01((vehicle.wheelspin - SPIN_START) / (1 - SPIN_START)) * SPIN_SMOKE;
        if (spin > intensity) intensity = spin;
      }

      smoke.emit(frameDt, intensity, pose.y, leftX, leftZ, rightWheelX, rightWheelZ, vehicle.vx, vehicle.vz);
      skid.track(sliding, pose.y, leftX, leftZ, rightWheelX, rightWheelZ);
      skid.flush();

      // Exhaust tips: car-local (+-x, y, +z is behind the nose).
      const tipZOffsetX = fx * EXHAUST_LOCAL_Z;
      const tipZOffsetZ = fz * EXHAUST_LOCAL_Z;
      tipLeftX = pose.x - rx * EXHAUST_LOCAL_X - tipZOffsetX;
      tipLeftZ = pose.z - rz * EXHAUST_LOCAL_X - tipZOffsetZ;
      tipRightX = pose.x + rx * EXHAUST_LOCAL_X - tipZOffsetX;
      tipRightZ = pose.z + rz * EXHAUST_LOCAL_X - tipZOffsetZ;
      tipY = pose.y + EXHAUST_LOCAL_Y;
      nitroFx.set(
        frameDt,
        nitro,
        tipLeftX,
        tipY,
        tipLeftZ,
        tipRightX,
        tipY,
        tipRightZ,
        fx,
        fz,
        vehicle.vx,
        vehicle.vz,
      );
    },

    lightning(fromX, fromY, fromZ, toX, toY, toZ) {
      bolt.fire(fromX, fromY, fromZ, toX, toY, toZ);
      // Muzzle pop plus a brighter hit flash, so the direction of the shot reads instantly.
      sparkFx.flash(fromX, fromY + BOLT_FROM_Y, fromZ, 0.95, 0.11, 0.75, 0.98, 1);
      sparkFx.flash(toX, toY + BOLT_TO_Y + 0.1, toZ, 2.1, 0.17, 0.85, 1, 1);
      sparkFx.burst(toX, toY + BOLT_TO_Y, toZ, 8, 5.5, 0.35, 0.16, 0.55, 0.95, 1);
    },

    explosion(x, y, z) {
      rings.spawn(x, y, z);
      sparkFx.flash(x, y + 1.0, z, 3.4, 0.22, 0.9, 1, 1);
      sparkFx.burst(x, y + 0.7, z, 40, 9, 0.8, 0.22, 0.45, 0.92, 1);
      // A little non-glowing smoke gives the burst some weight against the neon.
      for (let i = 0; i < 7; i++) {
        smoke.puff(
          x + (Math.random() - 0.5) * 1.6,
          y + 0.4 + Math.random() * 0.8,
          z + (Math.random() - 0.5) * 1.6,
          0.7 + Math.random() * 0.5,
          1.0 + Math.random() * 0.5,
          0.45,
        );
      }
    },

    backfire(strength) {
      const s = clamp01(strength);
      if (s <= 0) return;
      // The tips themselves ignite red...
      nitroFx.backfire(s);
      // ...wrapped in a blast flash that expands and dies inside a tenth of a second, and a
      // handful of embers that arc and burn out. Both come from the same pools the explosions
      // use, so a bang looks like a small combustion event rather than a puff of exhaust.
      const y = tipY;
      const flashSize = 0.65 + 1.2 * s;
      sparkFx.flash(tipLeftX, y, tipLeftZ, flashSize, 0.07 + 0.045 * s, BANG_R, BANG_G, BANG_B);
      sparkFx.flash(tipRightX, y, tipRightZ, flashSize * 0.85, 0.065 + 0.04 * s, BANG_R, BANG_G, BANG_B);
      const embers = Math.max(1, Math.round(BANG_EMBERS * s));
      const speed = 4 + 5 * s;
      const half = embers >> 1;
      sparkFx.burst(tipLeftX, y, tipLeftZ, embers - half, speed, 0.2, 0.13, BANG_R, BANG_G, BANG_B);
      sparkFx.burst(tipRightX, y, tipRightZ, half, speed, 0.2, 0.13, BANG_R, BANG_G, BANG_B);
    },

    scorePopup(x, y, z, amount) {
      popups.spawn(x, y, z, amount, POPUP_KILL);
    },

    nearMissPopup(x, y, z, amount) {
      popups.spawn(x, y, z, amount, POPUP_NEAR_MISS);
    },

    collision(x, y, z, impact) {
      const strength = clamp01(impact / 12);
      const count = 6 + Math.round(strength * 8);
      // Warm orange/white scrape, deliberately unlike the cyan of the lightning.
      sparkFx.burst(x, y + 0.45, z, count, 3 + strength * 5, 0.4, 0.14, 1, 0.62 + strength * 0.25, 0.3);
      sparkFx.flash(x, y + 0.5, z, 0.7 + strength * 0.9, 0.1, 1, 0.7, 0.4);
    },

    update(frameDt, time) {
      smoke.update(frameDt);
      nitroFx.update(frameDt, time);
      bolt.update(frameDt);
      sparkFx.update(frameDt);
      rings.update(frameDt);
      popups.update(frameDt);
    },

    reset() {
      smoke.reset();
      skid.reset();
      nitroFx.reset();
      bolt.reset();
      sparkFx.reset();
      rings.reset();
      popups.reset();
    },

    dispose() {
      smoke.dispose();
      skid.dispose();
      nitroFx.dispose();
      bolt.dispose();
      sparkFx.dispose();
      rings.dispose();
      popups.dispose();
      textures.dispose();
      scene.remove(root);
    },
  };
}
