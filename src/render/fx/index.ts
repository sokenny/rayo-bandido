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
import { createScorePopups } from './scorePopup';

/**
 * Pooled visual effects. Everything here is pre-allocated at creation; nothing allocates
 * per frame or per event. Budgets are deliberately small (see docs/MVP_SPEC.md).
 *
 * CONTRACT (called from `src/game.ts`)
 * - `setCarPose` every render frame with the interpolated car pose: used to emit tire smoke
 *   from the rear wheels while drifting, lay skid marks, and drive the nitro exhaust.
 * - `lightning(fromX, fromZ, toX, toZ)` on a `lightningFired` event: a cyan/blue-white arc
 *   that clearly connects the car to the target for ~0.4 s.
 * - `explosion(x, z)` on `targetDestroyed`: stylized burst (sparks, flash, short-lived debris).
 * - `scorePopup(x, z, amount)` on `targetDestroyed`: a floating "+X" over the wreck.
 * - `collision(x, z, impact)` on collisions: a few sparks.
 * - `reset()` on restart: hide every live effect.
 *
 * BUDGET
 * - 10 draw calls when absolutely everything is on screen at once, fewer when idle
 *   (each pool hides itself when empty): tire smoke, skid marks, nitro flames, nitro trail,
 *   bolt core, bolt glow, bolt branches, shock rings, sparks, flashes; plus one per live
 *   score popup (5 slots, all hidden when nothing was scored recently).
 * - ~2.6k triangles worst case (points are two triangles each).
 * - No allocation in `setCarPose`, `update` or any of the event entry points.
 */
export interface CarPose {
  x: number;
  z: number;
  heading: number;
}

export interface EffectsSystem {
  setCarPose(pose: CarPose, vehicle: VehicleState, drifting: boolean, nitro: number, frameDt: number): void;
  lightning(fromX: number, fromZ: number, toX: number, toZ: number): void;
  explosion(x: number, z: number): void;
  /** Floating "+X" reward number over a kill. */
  scorePopup(x: number, z: number, amount: number): void;
  collision(x: number, z: number, impact: number): void;
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

      smoke.emit(frameDt, intensity, leftX, leftZ, rightWheelX, rightWheelZ, vehicle.vx, vehicle.vz);
      skid.track(sliding, leftX, leftZ, rightWheelX, rightWheelZ);
      skid.flush();

      // Exhaust tips: car-local (+-x, y, +z is behind the nose).
      const tipZOffsetX = fx * EXHAUST_LOCAL_Z;
      const tipZOffsetZ = fz * EXHAUST_LOCAL_Z;
      nitroFx.set(
        frameDt,
        nitro,
        pose.x - rx * EXHAUST_LOCAL_X - tipZOffsetX,
        EXHAUST_LOCAL_Y,
        pose.z - rz * EXHAUST_LOCAL_X - tipZOffsetZ,
        pose.x + rx * EXHAUST_LOCAL_X - tipZOffsetX,
        EXHAUST_LOCAL_Y,
        pose.z + rz * EXHAUST_LOCAL_X - tipZOffsetZ,
        fx,
        fz,
        vehicle.vx,
        vehicle.vz,
      );
    },

    lightning(fromX, fromZ, toX, toZ) {
      bolt.fire(fromX, fromZ, toX, toZ);
      // Muzzle pop plus a brighter hit flash, so the direction of the shot reads instantly.
      sparkFx.flash(fromX, BOLT_FROM_Y, fromZ, 0.95, 0.11, 0.75, 0.98, 1);
      sparkFx.flash(toX, BOLT_TO_Y + 0.1, toZ, 2.1, 0.17, 0.85, 1, 1);
      sparkFx.burst(toX, BOLT_TO_Y, toZ, 8, 5.5, 0.35, 0.16, 0.55, 0.95, 1);
    },

    explosion(x, z) {
      rings.spawn(x, z);
      sparkFx.flash(x, 1.0, z, 3.4, 0.22, 0.9, 1, 1);
      sparkFx.burst(x, 0.7, z, 40, 9, 0.8, 0.22, 0.45, 0.92, 1);
      // A little non-glowing smoke gives the burst some weight against the neon.
      for (let i = 0; i < 7; i++) {
        smoke.puff(
          x + (Math.random() - 0.5) * 1.6,
          0.4 + Math.random() * 0.8,
          z + (Math.random() - 0.5) * 1.6,
          0.7 + Math.random() * 0.5,
          1.0 + Math.random() * 0.5,
          0.45,
        );
      }
    },

    scorePopup(x, z, amount) {
      popups.spawn(x, z, amount);
    },

    collision(x, z, impact) {
      const strength = clamp01(impact / 12);
      const count = 6 + Math.round(strength * 8);
      // Warm orange/white scrape, deliberately unlike the cyan of the lightning.
      sparkFx.burst(x, 0.45, z, count, 3 + strength * 5, 0.4, 0.14, 1, 0.62 + strength * 0.25, 0.3);
      sparkFx.flash(x, 0.5, z, 0.7 + strength * 0.9, 0.1, 1, 0.7, 0.4);
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
