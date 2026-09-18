import * as THREE from 'three';
import type { StreetPropKind, VehicleState } from '../../core/types';
import { VEHICLE } from '../../config/tuning';
import { clamp01, forwardX, forwardZ, rightX, rightZ } from '../../core/math';
import { createFxTextures } from './sprites';
import { createTireSmoke } from './tireSmoke';
import { createSkidMarks } from './skidMarks';
import { createWaterSpray } from './waterSpray';
import {
  createNitroExhaust,
  EXHAUST_LOCAL_X,
  EXHAUST_LOCAL_Y,
  EXHAUST_LOCAL_Z,
} from './nitroExhaust';
import { createLightningArc, BOLT_FROM_Y, BOLT_TO_Y } from './lightningArc';
import { createSparkFx } from './sparks';
import { createCrashSparks } from './crashSparks';
import { createShockRings } from './explosion';
import { createPowerDown } from './powerDown';
import { createScorePopups, POPUP_KILL, POPUP_RUSH } from './scorePopup';

/**
 * Pooled visual effects. Everything here is pre-allocated at creation; nothing allocates
 * per frame or per event. Budgets are deliberately small (see docs/MVP_SPEC.md).
 *
 * CONTRACT (called from `src/game.ts`)
 * - `setCarPose` every render frame with the interpolated car pose: used to emit tire smoke
 *   from the rear wheels while drifting, throw water off the wet road, lay skid marks, and
 *   drive the nitro exhaust.
 * - `lightning(fromX, fromZ, toX, toZ)` on a `lightningFired` event: a cyan/blue-white arc
 *   that clearly connects the car to the target for ~0.4 s.
 * - `backfire(strength)` when the exhaust pops: a flame spit at the tailpipes, in step with
 *   the bang from the audio layer (both are driven by the same trigger in `game.ts`).
 * - `powerDown(x, y, z)` on `targetDestroyed`: the ground ring, and then the cascade of
 *   arcs, sparks and haze in `powerDown.ts`, which plays out over the next second and a bit
 *   in step with the car going dark in `scene/electricCarVisual.ts`.
 * - `scorePopup(x, z, amount)` on `targetDestroyed`: a floating "+X" over the wreck.
 *   A near miss has no world pop: it is paid on the HUD, because the car it was scored on is
 *   already behind the camera by the time a number over it could be read.
 * - `collision(x, y, z, impact, nx, nz)` on collisions: a shower of streaking sparks off the
 *   bodywork at the contact point (`crashSparks.ts`), and a steady stream of them while the car
 *   grinds along a barrier (read off the vehicle in `setCarPose`).
 * - `reset()` on restart: hide every live effect.
 *
 * BUDGET
 * - 12 draw calls when absolutely everything is on screen at once, fewer when idle
 *   (each pool hides itself when empty): tire smoke, water spray, skid marks, nitro flames, nitro trail,
 *   bolt core, bolt glow, bolt branches, shock rings, sparks, metal sparks, flashes; plus one per live
 *   score popup (5 slots, all hidden when nothing was scored recently). Only kills spend that
 *   pool now, so five wrecks in a row is the worst it ever sees.
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
  /**
   * An electric car losing its power. NOT an explosion: the particles arrive in beats over
   * about a second, because the car does.
   */
  powerDown(x: number, y: number, z: number): void;
  /**
   * Flame out of the tailpipes for one exhaust pop (`strength` 0..1). Call after
   * `setCarPose` in the same frame — it fires from the tip positions that set.
   */
  backfire(strength: number): void;
  /** Floating acid-green "+X" reward number over a kill. */
  scorePopup(x: number, y: number, z: number, amount: number): void;
  /**
   * Floating yellow "EV DISABLED +X" over a wreck during a RAYO RUSH run. Replaces the ¥ pop
   * for that kill rather than joining it: two numbers over one wreck is one too many.
   */
  rushPopup(x: number, y: number, z: number, amount: number): void;
  /**
   * The car hit something. `nx`/`nz` is the outward contact normal when the sim knows it
   * (walls, cars); without it the sparks come off the car's belly. Call after `setCarPose`.
   */
  collision(x: number, y: number, z: number, impact: number, nx?: number, nz?: number): void;
  /**
   * A street prop knocked (`propHit`): a puff of dust off cardboard and bin bags, a scrape of
   * sparks off metal, and one electrical burst when a charger breaks. Budgeted: at most a few
   * per fraction of a second, whatever the car ploughs through.
   */
  propImpact(kind: StreetPropKind, x: number, y: number, z: number, impact: number, damaged: boolean): void;
  /**
   * Smoke from under the bonnet of a car carrying a heavy crash, in puffs per second (0 for none).
   * Held until changed; emitted from the pose `setCarPose` last saw, out of the tire smoke's pool.
   */
  setDamageSmoke(rate: number): void;
  update(frameDt: number, time: number): void;
  reset(): void;
  dispose(): void;
}

/** Lateral speed (m/s) at which the tires start to complain, and where they scream. */
const SLIP_START = 2.5;
const SLIP_FULL = 10;
/** Below this ground speed nothing is emitted, so a parked car never smokes. */
const MIN_SMOKE_SPEED = 2.5;
/** Slip that counts as sliding even when the drift rules have not latched yet. */
const SLIDE_LATERAL = 4;
/** Wheelspin below which the rears are not visibly spinning; matches `audio/dsp.ts:SKID`. */
const SPIN_START = 0.3;
/** Smoke of fully spinning rears with no sideways motion. */
const SPIN_SMOKE = 0.6;

/** Ground speed (m/s) where the rolling water mist starts, and where it is fullest. */
const SPRAY_ROLL_START = 9;
const SPRAY_ROLL_FULL = 42;

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

/** Prop impact effects: this many at once, refilled at this many per second. */
const PROP_FX_BURST = 4;
const PROP_FX_RATE = 8;

export function createEffects(scene: THREE.Scene): EffectsSystem {
  const root = new THREE.Group();
  root.name = 'effects';
  scene.add(root);

  const textures = createFxTextures();
  const smoke = createTireSmoke(root, textures);
  const spray = createWaterSpray(root, textures);
  const skid = createSkidMarks(root);
  const nitroFx = createNitroExhaust(root, textures);
  const bolt = createLightningArc(root, textures);
  const sparkFx = createSparkFx(root, textures);
  const crashSparks = createCrashSparks(root, sparkFx);
  const rings = createShockRings(root);
  const powerDownFx = createPowerDown(sparkFx, smoke);
  const popups = createScorePopups(root);

  const halfBase = VEHICLE.wheelbase / 2;
  const halfTrack = VEHICLE.trackWidth / 2;

  // Last exhaust tips in world space, so `backfire` can detonate without its own pose argument.
  let tipLeftX = 0;
  let tipLeftZ = 0;
  let tipRightX = 0;
  let tipRightZ = 0;
  let tipY = EXHAUST_LOCAL_Y;
  let propFxBudget = PROP_FX_BURST;
  // The damage smoke out of the bonnet: puffs per second, and the fraction of one owed.
  let damageSmokeRate = 0;
  let damageSmokeDue = 0;
  // The car's velocity as `setCarPose` last saw it: what a hit tears the sparks along.
  let carVx = 0;
  let carVz = 0;

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

      // Ground speed and axle yaw scrub, as in `audio/dsp.ts:skidIntensity`: mid-180 the car is
      // all sideways with no forward speed, and it must keep smoking through the spin.
      const lateral = Math.max(Math.abs(vehicle.lateralSpeed), Math.abs(vehicle.yawRate) * halfBase);
      const moving = Math.hypot(vehicle.speed, vehicle.lateralSpeed) > MIN_SMOKE_SPEED;
      const sliding = moving && (drifting || lateral > SLIDE_LATERAL);
      let intensity = 0;
      if (sliding) {
        intensity = clamp01((lateral - SLIP_START) / (SLIP_FULL - SLIP_START));
        // A latched drift always smokes, even in a smooth low-angle slide.
        if (drifting && intensity < 0.35) intensity = 0.35;
      }
      const slide = intensity;
      // Spinning rears smoke at any speed: a burnout at a standstill, the donut's cloud.
      let spin = 0;
      if (vehicle.wheelspin > SPIN_START) {
        spin = clamp01((vehicle.wheelspin - SPIN_START) / (1 - SPIN_START));
        if (spin * SPIN_SMOKE > intensity) intensity = spin * SPIN_SMOKE;
      }

      // The whole city is wet: the rears throw water whenever they are on it.
      if (vehicle.airborne) {
        spray.emit(frameDt, 0, 0, 0, pose.y, leftX, leftZ, rightWheelX, rightWheelZ, fx, fz, 0, 0, vehicle.vx, vehicle.vz);
      } else {
        const groundSpeed = Math.hypot(vehicle.vx, vehicle.vz);
        const roll = clamp01((groundSpeed - SPRAY_ROLL_START) / (SPRAY_ROLL_FULL - SPRAY_ROLL_START));
        // The slide's direction on the ground: the part of the car's velocity across its nose.
        // Mid-spin it can be near zero; fall back to the side the tail is swinging out to.
        const along = vehicle.vx * fx + vehicle.vz * fz;
        let sx = vehicle.vx - fx * along;
        let sz = vehicle.vz - fz * along;
        const across = Math.hypot(sx, sz);
        if (across > 0.5) {
          sx /= across;
          sz /= across;
        } else {
          const side = vehicle.yawRate >= 0 ? -1 : 1;
          sx = rx * side;
          sz = rz * side;
        }
        spray.emit(frameDt, roll, slide, spin, pose.y, leftX, leftZ, rightWheelX, rightWheelZ, fx, fz, sx, sz, vehicle.vx, vehicle.vz);
      }

      smoke.emit(frameDt, intensity, pose.y, leftX, leftZ, rightWheelX, rightWheelZ, vehicle.vx, vehicle.vz);
      skid.track(sliding, pose.y, leftX, leftZ, rightWheelX, rightWheelZ);
      skid.flush();

      carVx = vehicle.vx;
      carVz = vehicle.vz;
      crashSparks.scrape(frameDt, pose.x, pose.y, pose.z, vehicle.vx, vehicle.vz, vehicle.wallScrape, vehicle.wallNx, vehicle.wallNz);

      if (damageSmokeRate > 0) {
        // The bonnet, a metre and a half ahead of the wheelbase centre, just over the panel.
        const hoodX = pose.x + fx * 1.4;
        const hoodY = pose.y + 0.95;
        const hoodZ = pose.z + fz * 1.4;
        damageSmokeDue = Math.min(3, damageSmokeDue + damageSmokeRate * frameDt);
        while (damageSmokeDue >= 1) {
          damageSmokeDue -= 1;
          // Small, grey and short-lived: a wisp over the car, not a fire.
          smoke.puff(hoodX + (Math.random() - 0.5) * 0.5, hoodY, hoodZ + (Math.random() - 0.5) * 0.5, 0.55 + Math.random() * 0.35, 0.8 + Math.random() * 0.5, 0.32);
        }
      }

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

    powerDown(x, y, z) {
      // The ring is the only part that still lands all at once: it is the moment of the hit,
      // and it is what carries the kill across a street the wreck itself may be too far down
      // to be read on. Everything after it arrives on the beat — see `powerDown.ts`.
      rings.spawn(x, y, z);
      powerDownFx.spawn(x, y, z);
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

    rushPopup(x, y, z, amount) {
      popups.spawn(x, y, z, amount, POPUP_RUSH);
    },

    collision(x, y, z, impact, nx, nz) {
      crashSparks.impact(x, y, z, impact, nx, nz, carVx, carVz);
    },

    propImpact(kind, x, y, z, impact, damaged) {
      if (damaged) {
        // The charger's one burst: hot white-blue sparks, a flash, and a little smoke.
        sparkFx.burst(x, y, z, 22, 6.5, 0.5, 0.16, 0.7, 0.9, 1);
        sparkFx.burst(x, y, z, 8, 3.5, 0.35, 0.12, 1, 0.75, 0.3);
        sparkFx.flash(x, y, z, 1.6, 0.14, 0.6, 0.9, 1);
        smoke.puff(x, y - 0.2, z, 1.4, 1.2, 0.35);
        propFxBudget = 0;
        return;
      }
      if (propFxBudget <= 0) return;
      propFxBudget--;
      const strength = clamp01(impact / 12);
      if (kind === 'bag' || kind === 'box' || kind === 'bin') {
        // A can going over spills: the same grimy puff as a split bag.
        smoke.puff(x, y + 0.1, z, 0.7 + strength * 0.8, 0.6, 0.42);
        if (strength > 0.4) smoke.puff(x, y + 0.2, z, 0.9, 0.7, 0.38);
      } else if (kind === 'sign' || kind === 'barrier' || kind === 'charger' || kind === 'dumpster') {
        sparkFx.burst(x, y + 0.2, z, 3 + Math.round(strength * 5), 2.5 + strength * 3, 0.3, 0.1, 1, 0.66, 0.32);
      }
    },

    setDamageSmoke(rate) {
      damageSmokeRate = rate > 0 ? rate : 0;
      if (damageSmokeRate === 0) damageSmokeDue = 0;
    },

    update(frameDt, time) {
      propFxBudget = Math.min(PROP_FX_BURST, propFxBudget + frameDt * PROP_FX_RATE);
      smoke.update(frameDt);
      spray.update(frameDt);
      nitroFx.update(frameDt, time);
      bolt.update(frameDt);
      sparkFx.update(frameDt);
      crashSparks.update(frameDt);
      rings.update(frameDt);
      powerDownFx.update(frameDt);
      popups.update(frameDt);
    },

    reset() {
      smoke.reset();
      spray.reset();
      skid.reset();
      nitroFx.reset();
      bolt.reset();
      sparkFx.reset();
      crashSparks.reset();
      rings.reset();
      powerDownFx.reset();
      popups.reset();
    },

    dispose() {
      smoke.dispose();
      spray.dispose();
      skid.dispose();
      nitroFx.dispose();
      bolt.dispose();
      sparkFx.dispose();
      crashSparks.dispose();
      rings.dispose();
      popups.dispose();
      textures.dispose();
      scene.remove(root);
    },
  };
}
