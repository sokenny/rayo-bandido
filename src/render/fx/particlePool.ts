import * as THREE from 'three';
import { patchPointsMaterial } from './sprites';
import { ringNext } from './shapes';

/**
 * One fixed-size pool of camera-facing particles drawn as a single `THREE.Points`
 * (one draw call). Every buffer is allocated once; `spawn` overwrites the oldest slot and
 * `update` integrates in place, so neither path allocates.
 */
export interface ParticlePoolOptions {
  name: string;
  capacity: number;
  map: THREE.Texture;
  blending: THREE.Blending;
  /** Point size in world units at scale 1. Per-particle scale multiplies this. */
  baseSize: number;
  /** Material opacity ceiling (per-particle alpha multiplies it). */
  opacity: number;
  /** Signed vertical acceleration in m/s^2. Positive rises (buoyant smoke), negative falls. */
  accelY: number;
  /** Velocity damping in 1/s. */
  drag: number;
  /** Scale multiplier reached at the end of a particle's life (1 keeps the size constant). */
  endScale: number;
  /** Alpha follows t^fadePower, where t runs 1 -> 0 across the life. */
  fadePower: number;
  /** Fraction of the life spent fading in. 0 disables the fade-in. */
  fadeIn: number;
  /** Scene fog. Keep it off for additive pools so distant sparks are not washed out. */
  fog: boolean;
}

export interface ParticlePool {
  readonly object: THREE.Points;
  /** Number of particles currently alive. */
  readonly live: number;
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    life: number,
    r: number,
    g: number,
    b: number,
  ): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
}

export function createParticlePool(options: ParticlePoolOptions): ParticlePool {
  const cap = options.capacity;

  const positions = new Float32Array(cap * 3);
  const colors = new Float32Array(cap * 3);
  const scales = new Float32Array(cap);
  const alphas = new Float32Array(cap);

  // Simulation-side state, parallel to the attribute arrays.
  const velocities = new Float32Array(cap * 3);
  const life = new Float32Array(cap);
  const invMaxLife = new Float32Array(cap);
  const baseScale = new Float32Array(cap);

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  const scaleAttr = new THREE.BufferAttribute(scales, 1);
  const alphaAttr = new THREE.BufferAttribute(alphas, 1);
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  scaleAttr.setUsage(THREE.DynamicDrawUsage);
  alphaAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('color', colorAttr);
  geometry.setAttribute('aScale', scaleAttr);
  geometry.setAttribute('aAlpha', alphaAttr);

  const material = new THREE.PointsMaterial({
    map: options.map,
    size: options.baseSize,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    blending: options.blending,
    vertexColors: true,
    opacity: options.opacity,
    fog: options.fog,
  });
  patchPointsMaterial(material);

  const object = new THREE.Points(geometry, material);
  object.name = options.name;
  object.frustumCulled = false;
  object.visible = false;
  object.renderOrder = options.blending === THREE.AdditiveBlending ? 3 : 2;

  const { accelY, drag, endScale, fadePower, fadeIn } = options;
  const linearFade = fadePower === 1;
  const squareFade = fadePower === 2;
  const invFadeIn = fadeIn > 0 ? 1 / fadeIn : 0;

  let head = 0;
  let liveCount = 0;
  let dirty = false;

  function upload(): void {
    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    scaleAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  }

  return {
    object,
    get live() {
      return liveCount;
    },
    spawn(x, y, z, vx, vy, vz, size, lifeSeconds, r, g, b) {
      const i = head;
      head = ringNext(head, cap);
      const i3 = i * 3;
      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;
      velocities[i3] = vx;
      velocities[i3 + 1] = vy;
      velocities[i3 + 2] = vz;
      colors[i3] = r;
      colors[i3 + 1] = g;
      colors[i3 + 2] = b;
      baseScale[i] = size;
      scales[i] = size;
      alphas[i] = fadeIn > 0 ? 0 : 1;
      life[i] = lifeSeconds;
      invMaxLife[i] = 1 / lifeSeconds;
      dirty = true;
    },
    update(dt) {
      if (liveCount === 0 && !dirty) return;
      const damp = drag > 0 ? Math.max(0, 1 - drag * dt) : 1;
      let alive = 0;
      for (let i = 0; i < cap; i++) {
        let remaining = life[i];
        if (remaining <= 0) continue;
        remaining -= dt;
        if (remaining <= 0) {
          life[i] = 0;
          alphas[i] = 0;
          scales[i] = 0;
          continue;
        }
        life[i] = remaining;
        const i3 = i * 3;
        let vx = velocities[i3];
        let vy = velocities[i3 + 1] + accelY * dt;
        let vz = velocities[i3 + 2];
        if (damp !== 1) {
          vx *= damp;
          vy *= damp;
          vz *= damp;
        }
        velocities[i3] = vx;
        velocities[i3 + 1] = vy;
        velocities[i3 + 2] = vz;
        positions[i3] += vx * dt;
        positions[i3 + 1] += vy * dt;
        positions[i3 + 2] += vz * dt;

        const t = remaining * invMaxLife[i];
        scales[i] = baseScale[i] * (endScale + (1 - endScale) * t);
        let a = linearFade ? t : squareFade ? t * t : Math.pow(t, fadePower);
        if (invFadeIn !== 0) {
          const age = 1 - t;
          if (age < fadeIn) a *= age * invFadeIn;
        }
        alphas[i] = a;
        alive++;
      }
      liveCount = alive;
      upload();
      object.visible = alive > 0;
      dirty = alive > 0;
    },
    reset() {
      life.fill(0);
      alphas.fill(0);
      scales.fill(0);
      velocities.fill(0);
      liveCount = 0;
      head = 0;
      dirty = false;
      upload();
      object.visible = false;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
