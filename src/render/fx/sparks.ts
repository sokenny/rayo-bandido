import * as THREE from 'three';
import { createParticlePool, type ParticlePool } from './particlePool';
import type { FxTextures } from './sprites';

/**
 * Shared additive pools for sparks and impact flashes. Explosions and collisions both draw
 * from them, so the budget is fixed no matter how many events land in the same frame.
 */
export const SPARK_CAPACITY = 240;
export const FLASH_CAPACITY = 12;

export interface SparkFx {
  sparks: THREE.Points;
  flashes: THREE.Points;
  /** Radial burst with a slight upward bias. */
  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    speed: number,
    life: number,
    size: number,
    r: number,
    g: number,
    b: number,
  ): void;
  /** One short-lived bright sprite. */
  flash(x: number, y: number, z: number, size: number, life: number, r: number, g: number, b: number): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
}

export function createSparkFx(parent: THREE.Object3D, textures: FxTextures): SparkFx {
  const sparkPool: ParticlePool = createParticlePool({
    name: 'fx-sparks',
    capacity: SPARK_CAPACITY,
    map: textures.spark,
    blending: THREE.AdditiveBlending,
    baseSize: 1,
    opacity: 1,
    accelY: -11,
    drag: 0.7,
    endScale: 0.25,
    fadePower: 1,
    fadeIn: 0,
    fog: false,
  });
  parent.add(sparkPool.object);

  const flashPool: ParticlePool = createParticlePool({
    name: 'fx-flashes',
    capacity: FLASH_CAPACITY,
    map: textures.flare,
    blending: THREE.AdditiveBlending,
    baseSize: 1,
    opacity: 1,
    accelY: 0,
    drag: 0,
    endScale: 2.1,
    fadePower: 2,
    fadeIn: 0,
    fog: false,
  });
  parent.add(flashPool.object);

  return {
    sparks: sparkPool.object,
    flashes: flashPool.object,
    burst(x, y, z, count, speed, life, size, r, g, b) {
      for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        // Bias the cone upward so sparks arc instead of skidding along the ground.
        const phi = Math.random() * 1.0 - 0.12;
        const cp = Math.cos(phi);
        const s = speed * (0.5 + Math.random() * 0.6);
        const vx = Math.cos(theta) * cp * s;
        const vy = Math.sin(phi) * s + 1.2;
        const vz = Math.sin(theta) * cp * s;
        const tint = 0.75 + Math.random() * 0.25;
        sparkPool.spawn(
          x,
          y,
          z,
          vx,
          vy,
          vz,
          size * (0.7 + Math.random() * 0.6),
          life * (0.65 + Math.random() * 0.55),
          r * tint,
          g * tint,
          b * tint,
        );
      }
    },
    flash(x, y, z, size, life, r, g, b) {
      flashPool.spawn(x, y, z, 0, 0, 0, size, life, r, g, b);
    },
    update(dt) {
      sparkPool.update(dt);
      flashPool.update(dt);
    },
    reset() {
      sparkPool.reset();
      flashPool.reset();
    },
    dispose() {
      parent.remove(sparkPool.object);
      parent.remove(flashPool.object);
      sparkPool.dispose();
      flashPool.dispose();
    },
  };
}
