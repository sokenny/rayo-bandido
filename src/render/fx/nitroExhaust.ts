import * as THREE from 'three';
import { createParticlePool, type ParticlePool } from './particlePool';
import { patchPointsMaterial, type FxTextures } from './sprites';
import { emissionCount } from './shapes';

/**
 * Nitro exhaust: two flame billboards at the tailpipes plus a short magenta trail.
 *
 * The flame sprite already carries the palette (warm white-orange core fading through
 * magenta into violet), so both tips are a single two-point `THREE.Points` - one draw call
 * instead of separate core and rim meshes.
 */
export const NITRO_TRAIL_CAPACITY = 60;

/** Exhaust tip in car-local space: rear (local +Z is behind the nose), low, off-center. */
export const EXHAUST_LOCAL_X = 0.45;
export const EXHAUST_LOCAL_Y = 0.35;
export const EXHAUST_LOCAL_Z = 2.05;

/** Below this the exhaust is fully hidden. */
const VISIBLE_THRESHOLD = 0.05;
const TRAIL_RATE = 46;
const TRAIL_MAX_PER_FRAME = 5;

export interface NitroExhaust {
  flames: THREE.Points;
  trail: THREE.Points;
  /**
   * `nitro` is the smoothed 0..1 intensity. The two tip positions are world space, and
   * (forwardX, forwardZ) is the car's forward unit vector so the trail streams backwards.
   */
  set(
    dt: number,
    nitro: number,
    leftX: number,
    leftY: number,
    leftZ: number,
    rightX: number,
    rightY: number,
    rightZ: number,
    forwardX: number,
    forwardZ: number,
    carVx: number,
    carVz: number,
  ): void;
  update(dt: number, time: number): void;
  reset(): void;
  dispose(): void;
}

export function createNitroExhaust(parent: THREE.Object3D, textures: FxTextures): NitroExhaust {
  // --- Flame billboards (2 points, driven directly rather than pooled) ---
  const flamePositions = new Float32Array(6);
  const flameColors = new Float32Array([1, 1, 1, 1, 1, 1]);
  const flameScales = new Float32Array([0, 0]);
  const flameAlphas = new Float32Array([0, 0]);

  const flameGeo = new THREE.BufferGeometry();
  const flamePosAttr = new THREE.BufferAttribute(flamePositions, 3);
  const flameScaleAttr = new THREE.BufferAttribute(flameScales, 1);
  const flameAlphaAttr = new THREE.BufferAttribute(flameAlphas, 1);
  flamePosAttr.setUsage(THREE.DynamicDrawUsage);
  flameScaleAttr.setUsage(THREE.DynamicDrawUsage);
  flameAlphaAttr.setUsage(THREE.DynamicDrawUsage);
  flameGeo.setAttribute('position', flamePosAttr);
  flameGeo.setAttribute('color', new THREE.BufferAttribute(flameColors, 3));
  flameGeo.setAttribute('aScale', flameScaleAttr);
  flameGeo.setAttribute('aAlpha', flameAlphaAttr);

  const flameMat = new THREE.PointsMaterial({
    map: textures.flame,
    size: 1,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    opacity: 1,
    fog: false,
  });
  patchPointsMaterial(flameMat);

  const flames = new THREE.Points(flameGeo, flameMat);
  flames.name = 'fx-nitro-flames';
  flames.frustumCulled = false;
  flames.visible = false;
  flames.renderOrder = 3;
  parent.add(flames);

  // --- Magenta trail ---
  const trailPool: ParticlePool = createParticlePool({
    name: 'fx-nitro-trail',
    capacity: NITRO_TRAIL_CAPACITY,
    map: textures.flare,
    blending: THREE.AdditiveBlending,
    baseSize: 1,
    opacity: 0.85,
    accelY: 0.7,
    drag: 2.6,
    endScale: 2.4,
    fadePower: 2,
    fadeIn: 0,
    fog: false,
  });
  parent.add(trailPool.object);

  let intensity = 0;
  let accumulator = 0;

  return {
    flames,
    trail: trailPool.object,
    set(dt, nitro, leftX, leftY, leftZ, rightX, rightY, rightZ, forwardX, forwardZ, carVx, carVz) {
      intensity = nitro;
      flamePositions[0] = leftX;
      flamePositions[1] = leftY;
      flamePositions[2] = leftZ;
      flamePositions[3] = rightX;
      flamePositions[4] = rightY;
      flamePositions[5] = rightZ;
      flamePosAttr.needsUpdate = true;

      if (nitro < VISIBLE_THRESHOLD) {
        accumulator = 0;
        return;
      }
      accumulator += TRAIL_RATE * nitro * dt;
      const count = emissionCount(accumulator, TRAIL_MAX_PER_FRAME);
      if (count === 0) return;
      accumulator -= count;
      if (accumulator > 1) accumulator = 1;
      for (let i = 0; i < count; i++) {
        const left = (i & 1) === 0;
        const x = (left ? leftX : rightX) + (Math.random() - 0.5) * 0.14;
        const y = (left ? leftY : rightY) + (Math.random() - 0.5) * 0.12;
        const z = (left ? leftZ : rightZ) + (Math.random() - 0.5) * 0.14;
        const push = 3.5 + Math.random() * 3;
        const vx = carVx * 0.12 - forwardX * push + (Math.random() - 0.5) * 0.9;
        const vz = carVz * 0.12 - forwardZ * push + (Math.random() - 0.5) * 0.9;
        const vy = 0.2 + Math.random() * 0.5;
        // Magenta core drifting toward violet as the puff cools.
        const warm = Math.random() * 0.25;
        trailPool.spawn(
          x,
          y,
          z,
          vx,
          vy,
          vz,
          0.22 + Math.random() * 0.14,
          0.28 + Math.random() * 0.16,
          0.95 + warm,
          0.22 + warm * 0.6,
          0.98,
        );
      }
    },
    update(dt, time) {
      trailPool.update(dt);
      const visible = intensity >= VISIBLE_THRESHOLD;
      flames.visible = visible;
      if (!visible) {
        flameScales[0] = 0;
        flameScales[1] = 0;
        flameAlphas[0] = 0;
        flameAlphas[1] = 0;
        flameScaleAttr.needsUpdate = true;
        flameAlphaAttr.needsUpdate = true;
        return;
      }
      // Two out-of-phase flickers so the tips never pulse in lockstep.
      const f0 = 0.82 + 0.18 * Math.sin(time * 47.3);
      const f1 = 0.82 + 0.18 * Math.sin(time * 39.1 + 1.7);
      const base = 0.5 + 0.62 * intensity;
      flameScales[0] = base * f0;
      flameScales[1] = base * f1;
      flameAlphas[0] = intensity * f0;
      flameAlphas[1] = intensity * f1;
      flameScaleAttr.needsUpdate = true;
      flameAlphaAttr.needsUpdate = true;
    },
    reset() {
      intensity = 0;
      accumulator = 0;
      flameScales[0] = 0;
      flameScales[1] = 0;
      flameAlphas[0] = 0;
      flameAlphas[1] = 0;
      flameScaleAttr.needsUpdate = true;
      flameAlphaAttr.needsUpdate = true;
      flames.visible = false;
      trailPool.reset();
    },
    dispose() {
      parent.remove(flames);
      parent.remove(trailPool.object);
      flameGeo.dispose();
      flameMat.dispose();
      trailPool.dispose();
    },
  };
}
