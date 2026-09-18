import * as THREE from 'three';
import { createParticlePool, type ParticlePool } from './particlePool';
import type { FxTextures } from './sprites';
import { emissionCount } from './shapes';

/**
 * Water thrown off the rear tyres by the wet asphalt. Every street in the city is wet, so this
 * runs wherever the car is on the ground; it stays light on purpose:
 *  - ROLLING: a thin mist kicked up behind the rears, only past a brisk speed and never dense;
 *  - SLIDING: the drift sweeps the water sideways, so the rears fling a sheet of droplets out
 *    along the direction of the slide, with a little mist under it;
 *  - WHEELSPIN: a burnout throws a short rooster tail straight back.
 *
 * One pooled `THREE.Points` (one draw call, hidden when empty) with normal blending and a
 * cool grey tint: water lit by the city, not a glow. Droplets and mist share the pool; the
 * mist is just bigger, slower and fainter. Gravity pulls both, so the spray arcs and drops
 * back instead of rising like the smoke.
 */
export const SPRAY_CAPACITY = 170;

/** Rolling mist, particles per second across both wheels at full speed. */
const ROLL_RATE = 22;
/** Drift sheet, particles per second across both wheels at full slide. */
const SLIDE_RATE = 70;
/** Burnout rooster tail, particles per second across both wheels at full wheelspin. */
const SPIN_RATE = 34;
/** Hard cap so a long frame cannot dump the pool at once. */
const MAX_PER_FRAME = 7;

export interface WaterSpray {
  object: THREE.Points;
  /**
   * Accumulate emission for one frame. `roll`, `slide` and `spin` are 0..1; the contact points
   * are the rear wheel patches, (fx, fz) the car's forward axis and (sx, sz) the unit direction
   * of the slide on the ground (anything when `slide` is 0).
   */
  emit(
    dt: number,
    roll: number,
    slide: number,
    spin: number,
    baseY: number,
    leftX: number,
    leftZ: number,
    rightX: number,
    rightZ: number,
    fx: number,
    fz: number,
    sx: number,
    sz: number,
    carVx: number,
    carVz: number,
  ): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
}

export function createWaterSpray(parent: THREE.Object3D, textures: FxTextures): WaterSpray {
  const pool: ParticlePool = createParticlePool({
    name: 'fx-water-spray',
    capacity: SPRAY_CAPACITY,
    map: textures.spark,
    blending: THREE.NormalBlending,
    baseSize: 1,
    opacity: 0.55,
    accelY: -9,
    drag: 1.6,
    endScale: 2.2,
    fadePower: 1.3,
    fadeIn: 0.08,
    fog: true,
  });
  parent.add(pool.object);

  let rollDue = 0;
  let slideDue = 0;
  let spinDue = 0;
  let wheelToggle = 0;

  /** Cool, slightly blue grey: wet asphalt water under sodium and neon, not white. */
  function spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, shade: number): void {
    pool.spawn(x, y, z, vx, vy, vz, size, life, shade * 0.86, shade * 0.93, shade * 1.06);
  }

  return {
    object: pool.object,
    emit(dt, roll, slide, spin, baseY, leftX, leftZ, rightX, rightZ, fx, fz, sx, sz, carVx, carVz) {
      rollDue = roll > 0 ? Math.min(2, rollDue + roll * ROLL_RATE * dt) : 0;
      slideDue = slide > 0 ? Math.min(2, slideDue + slide * SLIDE_RATE * dt) : 0;
      spinDue = spin > 0 ? Math.min(2, spinDue + spin * SPIN_RATE * dt) : 0;

      let budget = MAX_PER_FRAME;
      const y0 = baseY + 0.08;

      // The drift sheet first: it is the one the player is looking for.
      let n = emissionCount(slideDue, budget);
      slideDue -= n;
      budget -= n;
      for (let i = 0; i < n; i++) {
        wheelToggle ^= 1;
        const cx = wheelToggle === 0 ? leftX : rightX;
        const cz = wheelToggle === 0 ? leftZ : rightZ;
        const mist = Math.random() < 0.3;
        // Out along the slide and a bit behind the tyre, keeping some of the car's own motion.
        const out = (mist ? 1.2 : 2.6) + Math.random() * 2.4 * slide;
        const back = 0.6 + Math.random() * 1.2;
        const vx = carVx * 0.45 + sx * out - fx * back + (Math.random() - 0.5) * 1.2;
        const vz = carVz * 0.45 + sz * out - fz * back + (Math.random() - 0.5) * 1.2;
        // High enough to clear the bumper from the chase camera, or the car hides all of it.
        const vy = mist ? 0.9 + Math.random() * 0.9 : 2.2 + Math.random() * 2 * (0.5 + slide);
        const x = cx + (Math.random() - 0.5) * 0.3;
        const z = cz + (Math.random() - 0.5) * 0.3;
        if (mist) spawn(x, y0 + 0.05, z, vx, vy, vz, 0.7 + Math.random() * 0.4, 0.55 + Math.random() * 0.3, 0.5 + Math.random() * 0.08);
        else spawn(x, y0, z, vx, vy, vz, 0.16 + Math.random() * 0.12, 0.45 + Math.random() * 0.25, 0.72 + Math.random() * 0.15);
      }

      // The burnout's rooster tail: straight back off the spinning rears.
      n = emissionCount(spinDue, budget);
      spinDue -= n;
      budget -= n;
      for (let i = 0; i < n; i++) {
        wheelToggle ^= 1;
        const cx = wheelToggle === 0 ? leftX : rightX;
        const cz = wheelToggle === 0 ? leftZ : rightZ;
        const back = 2.5 + Math.random() * 3 * spin;
        const vx = carVx * 0.5 - fx * back + (Math.random() - 0.5) * 1;
        const vz = carVz * 0.5 - fz * back + (Math.random() - 0.5) * 1;
        const vy = 1.6 + Math.random() * 1.8;
        spawn(cx - fx * 0.35, y0, cz - fz * 0.35, vx, vy, vz, 0.16 + Math.random() * 0.12, 0.4 + Math.random() * 0.2, 0.68 + Math.random() * 0.12);
      }

      // The rolling mist: faint, low, left behind the car.
      n = emissionCount(rollDue, budget);
      rollDue -= n;
      for (let i = 0; i < n; i++) {
        wheelToggle ^= 1;
        const cx = wheelToggle === 0 ? leftX : rightX;
        const cz = wheelToggle === 0 ? leftZ : rightZ;
        // The water leaves the tread slower than the car: it trails behind it.
        const vx = carVx * 0.55 + (Math.random() - 0.5) * 0.9;
        const vz = carVz * 0.55 + (Math.random() - 0.5) * 0.9;
        const vy = 0.8 + Math.random() * 1.1 * (0.5 + roll);
        spawn(cx - fx * 0.4, y0, cz - fz * 0.4, vx, vy, vz, 0.4 + Math.random() * 0.35, 0.35 + Math.random() * 0.2, 0.42 + Math.random() * 0.08);
      }
    },
    update(dt) {
      pool.update(dt);
    },
    reset() {
      rollDue = 0;
      slideDue = 0;
      spinDue = 0;
      pool.reset();
    },
    dispose() {
      parent.remove(pool.object);
      pool.dispose();
    },
  };
}
