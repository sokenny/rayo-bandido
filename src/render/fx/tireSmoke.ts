import * as THREE from 'three';
import { createParticlePool, type ParticlePool } from './particlePool';
import type { FxTextures } from './sprites';
import { emissionCount } from './shapes';

/**
 * Grey-violet tire smoke puffed from both rear contact patches while the rear axle slides.
 * One pooled `THREE.Points` (one draw call) with normal blending, so the smoke reads as
 * haze lit by the underglow instead of a glowing additive blob.
 */
export const SMOKE_CAPACITY = 220;

/** Puffs per second per wheel at full slip. Steady state stays near 80 live particles. */
const MAX_RATE_PER_WHEEL = 34;
/** Hard cap so a long frame cannot dump the whole pool at once. */
const MAX_PER_FRAME = 8;

export interface TireSmoke {
  object: THREE.Points;
  /**
   * Accumulate emission for one frame. `intensity` is 0..1 slip strength; the two contact
   * points are the rear wheel patches in world space.
   */
  emit(
    dt: number,
    intensity: number,
    /** Height of the road under the car (m). */
    baseY: number,
    leftX: number,
    leftZ: number,
    rightX: number,
    rightZ: number,
    carVx: number,
    carVz: number,
  ): void;
  /** One-off puff, used to give explosions some non-glowing weight. */
  puff(x: number, y: number, z: number, size: number, life: number, tint: number): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
}

export function createTireSmoke(parent: THREE.Object3D, textures: FxTextures): TireSmoke {
  const pool: ParticlePool = createParticlePool({
    name: 'fx-tire-smoke',
    capacity: SMOKE_CAPACITY,
    map: textures.smoke,
    blending: THREE.NormalBlending,
    baseSize: 1,
    opacity: 0.5,
    accelY: 0.25,
    drag: 1.5,
    endScale: 3.2,
    fadePower: 1.4,
    fadeIn: 0.14,
    fog: true,
  });
  parent.add(pool.object);

  let accumulator = 0;
  let wheelToggle = 0;

  return {
    object: pool.object,
    emit(dt, intensity, baseY, leftX, leftZ, rightX, rightZ, carVx, carVz) {
      if (intensity <= 0) {
        accumulator = 0;
        return;
      }
      accumulator += intensity * MAX_RATE_PER_WHEEL * 2 * dt;
      const count = emissionCount(accumulator, MAX_PER_FRAME);
      if (count === 0) return;
      accumulator -= count;
      if (accumulator > 1) accumulator = 1;
      for (let i = 0; i < count; i++) {
        wheelToggle ^= 1;
        const cx = wheelToggle === 0 ? leftX : rightX;
        const cz = wheelToggle === 0 ? leftZ : rightZ;
        const x = cx + (Math.random() - 0.5) * 0.34;
        const z = cz + (Math.random() - 0.5) * 0.34;
        const y = baseY + 0.1 + Math.random() * 0.16;
        // Inherit a little of the car's motion, drift up and spread sideways.
        const vx = carVx * 0.2 + (Math.random() - 0.5) * 1.6;
        const vz = carVz * 0.2 + (Math.random() - 0.5) * 1.6;
        const vy = 0.5 + Math.random() * 0.8 + intensity * 0.5;
        const size = 0.4 + Math.random() * 0.28;
        const life = 0.9 + Math.random() * 0.45;
        // Desaturated lavender; slightly brighter the harder the slide.
        const shade = 0.5 + intensity * 0.22 + Math.random() * 0.1;
        pool.spawn(x, y, z, vx, vy, vz, size, life, shade * 0.94, shade * 0.9, shade * 1.12);
      }
    },
    puff(x, y, z, size, life, tint) {
      const vx = (Math.random() - 0.5) * 2.4;
      const vz = (Math.random() - 0.5) * 2.4;
      const vy = 1.2 + Math.random() * 1.4;
      pool.spawn(x, y, z, vx, vy, vz, size, life, tint * 0.9, tint * 0.94, tint * 1.1);
    },
    update(dt) {
      pool.update(dt);
    },
    reset() {
      accumulator = 0;
      pool.reset();
    },
    dispose() {
      parent.remove(pool.object);
      pool.dispose();
    },
  };
}
