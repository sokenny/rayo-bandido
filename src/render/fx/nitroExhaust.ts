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
 *
 * The same two billboards double as the backfire flash: `backfire()` adds a fast-decaying
 * spike on top of the nitro intensity and throws hot embers into the trail pool, so a pop
 * costs no extra draw call and reads even with the boost cold.
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

/** Backfire flash decay (1/s): ~110 ms from a full pop back to nothing. A bang is not a fade. */
const FLASH_DECAY = 9;
/** How much a full flash adds to a tip's billboard scale and alpha. */
const FLASH_SCALE = 2.1;
/**
 * Ignition colour at full flash. The flame sprite runs warm-white -> magenta -> violet for nitro;
 * multiplying by this crushes the magenta out and leaves a red-orange fireball, so a bang never
 * reads as more boost.
 */
const FLASH_R = 1;
const FLASH_G = 0.34;
const FLASH_B = 0.1;
/**
 * How much faster the colour saturates than the flash fades. Tying tint to brightness alone
 * left small crackles looking like white dust; combustion is red at any size, so the colour
 * goes fully over well before the flash has died.
 */
const FLASH_TINT_GAIN = 2.6;

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
  /**
   * Ignite the tailpipes for one exhaust bang (`strength` 0..1): a hard red-orange spike on the
   * two tip billboards that decays in about a tenth of a second. Independent of `nitro`, so the
   * tips flash on an overrun pop with the boost cold. The embers and the blast flash are thrown
   * by the shared spark pools in `fx/index.ts`, which own that look for every explosion.
   */
  backfire(strength: number): void;
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
  const flameColorAttr = new THREE.BufferAttribute(flameColors, 3);
  const flameScaleAttr = new THREE.BufferAttribute(flameScales, 1);
  const flameAlphaAttr = new THREE.BufferAttribute(flameAlphas, 1);
  flamePosAttr.setUsage(THREE.DynamicDrawUsage);
  flameColorAttr.setUsage(THREE.DynamicDrawUsage);
  flameScaleAttr.setUsage(THREE.DynamicDrawUsage);
  flameAlphaAttr.setUsage(THREE.DynamicDrawUsage);
  flameGeo.setAttribute('position', flamePosAttr);
  flameGeo.setAttribute('color', flameColorAttr);
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
  // Backfire flash per tip (0..1), decaying independently so the pop reads as one pipe first.
  let flash0 = 0;
  let flash1 = 0;

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
    backfire(strength) {
      const s = strength < 0 ? 0 : strength > 1 ? 1 : strength;
      if (s <= 0) return;
      // One pipe leads and the other answers, the way a real twin exit cracks unevenly.
      const leadLeft = Math.random() < 0.5;
      const answer = s * (0.45 + Math.random() * 0.3);
      flash0 = Math.min(1, flash0 + (leadLeft ? s : answer));
      flash1 = Math.min(1, flash1 + (leadLeft ? answer : s));
    },
    update(dt, time) {
      trailPool.update(dt);
      const decay = FLASH_DECAY * dt;
      flash0 = flash0 > decay ? flash0 - decay : 0;
      flash1 = flash1 > decay ? flash1 - decay : 0;

      const lit = intensity >= VISIBLE_THRESHOLD;
      const visible = lit || flash0 > 0 || flash1 > 0;
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
      const base = lit ? 0.5 + 0.62 * intensity : 0;
      const nitroAlpha = lit ? intensity : 0;
      flameScales[0] = base * f0 + flash0 * FLASH_SCALE;
      flameScales[1] = base * f1 + flash1 * FLASH_SCALE;
      flameAlphas[0] = Math.min(1, nitroAlpha * f0 + flash0);
      flameAlphas[1] = Math.min(1, nitroAlpha * f1 + flash1);
      // Pull each tip toward the ignition red as it flashes, back to neutral as it dies.
      const tint0 = Math.min(1, flash0 * FLASH_TINT_GAIN);
      const tint1 = Math.min(1, flash1 * FLASH_TINT_GAIN);
      flameColors[0] = 1 + (FLASH_R - 1) * tint0;
      flameColors[1] = 1 + (FLASH_G - 1) * tint0;
      flameColors[2] = 1 + (FLASH_B - 1) * tint0;
      flameColors[3] = 1 + (FLASH_R - 1) * tint1;
      flameColors[4] = 1 + (FLASH_G - 1) * tint1;
      flameColors[5] = 1 + (FLASH_B - 1) * tint1;
      flameScaleAttr.needsUpdate = true;
      flameAlphaAttr.needsUpdate = true;
      flameColorAttr.needsUpdate = true;
    },
    reset() {
      intensity = 0;
      accumulator = 0;
      flash0 = 0;
      flash1 = 0;
      flameColors.fill(1);
      flameColorAttr.needsUpdate = true;
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
