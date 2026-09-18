import * as THREE from 'three';
import { VEHICLE } from '../../config/tuning';
import { clamp01 } from '../../core/math';
import { createMetalSparks } from './metalSparks';
import type { SparkFx } from './sparks';

/**
 * What the car's bodywork throws when it meets something hard. Two ways in:
 *
 *  - `impact`: a hit. A shower out of the contact point, fanned along the wall (the car's
 *    along-the-wall speed is what tears the steel off, so that is where the sparks go), kicked
 *    back off the surface and up, plus a white flash and a few fat slow chunks that bounce
 *    round on the road glowing. Harder hits throw more, faster, hotter.
 *  - `scrape`: every frame while the car is grinding along a barrier, a steady stream from the
 *    side it is touching. The sparks leave with only a share of the car's own velocity (the
 *    wall holds them back), so in the chase camera they peel off and trail behind — which is
 *    exactly what a wall scrape looks like from a car-mounted camera.
 *
 * With no contact normal (a landing, a prop the sim does not orient) the sparks come from
 * under the car and spray along its travel: the belly on the tarmac.
 */
export interface CrashSparks {
  impact(x: number, y: number, z: number, impact: number, nx: number | undefined, nz: number | undefined, vx: number, vz: number): void;
  /**
   * Called every frame with the car's pose and its wall contact (`VehicleState.wallScrape`,
   * `wallNx`, `wallNz`). A short hold bridges the ticks the sim loses contact for.
   */
  scrape(frameDt: number, x: number, y: number, z: number, vx: number, vz: number, slide: number, nx: number, nz: number): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
}

/** Height of the bodywork that hits: bumper to sill (m above the road). */
const BODY_LOW = 0.22;
const BODY_HIGH = 0.62;
/** Impact (m/s into the surface) that throws the biggest shower. */
const IMPACT_FULL = 16;
/** Sparks in a light touch and in a full-speed hit. */
const IMPACT_MIN_COUNT = 10;
const IMPACT_MAX_COUNT = 90;
/** Slide speed (m/s) along a wall where the stream starts, and where it is heaviest. */
const SCRAPE_START = 3;
const SCRAPE_FULL = 30;
/** Sparks per second at a full-speed scrape. */
const SCRAPE_RATE = 340;
/** Seconds a lost contact still counts as grinding. */
const SCRAPE_HOLD = 0.09;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export function createCrashSparks(parent: THREE.Object3D, flashes: SparkFx): CrashSparks {
  const pool = createMetalSparks(parent);
  const reach = VEHICLE.collisionRadius;

  let hold = 0;
  let holdSlide = 0;
  let holdNx = 0;
  let holdNz = 0;
  let owed = 0;

  /**
   * One spark leaving a contact whose outward normal is (nx, nz), torn along the tangent
   * (tx, tz) at up to `along` m/s. `s` is the hit's strength 0..1.
   */
  function throwSpark(
    x: number,
    y: number,
    z: number,
    floorY: number,
    nx: number,
    nz: number,
    tx: number,
    tz: number,
    along: number,
    carVx: number,
    carVz: number,
    carry: number,
    s: number,
  ): void {
    // Mostly along the tear, some back off the surface, some up; a wide jitter on top so the
    // fan is a fan and not a line.
    const a = along * rand(0.35, 1.05);
    const out = rand(0.6, 3.5) * (0.6 + s);
    const up = rand(0.4, 3.8) * (0.7 + 0.6 * s);
    const j = 1.6 + 2.5 * s;
    const vx = tx * a + nx * out + carVx * carry + rand(-j, j);
    const vz = tz * a + nz * out + carVz * carry + rand(-j, j);
    const vy = up + rand(-0.4, 0.8);
    const heat = rand(0.75, 1) * (0.8 + 0.2 * s);
    // Most flecks are fine, a few are fat and burn long.
    const fat = Math.random() < 0.12;
    const w = fat ? rand(0.035, 0.05) : rand(0.012, 0.024);
    const life = fat ? rand(0.6, 1.1) : rand(0.25, 0.7) * (0.8 + 0.4 * s);
    pool.spawn(x, y, z, vx, vy, vz, life, heat, w, floorY);
  }

  return {
    impact(x, y, z, impact, nx, nz, carVx, carVz) {
      const s = clamp01(impact / IMPACT_FULL);
      const count = Math.round(IMPACT_MIN_COUNT + (IMPACT_MAX_COUNT - IMPACT_MIN_COUNT) * s * s + 10 * s);
      const speed = Math.hypot(carVx, carVz);
      let ox: number;
      let oz: number;
      let tx: number;
      let tz: number;
      let along: number;
      let carry: number;
      if (nx !== undefined && nz !== undefined && (nx !== 0 || nz !== 0)) {
        ox = nx;
        oz = nz;
        // Tangent in the direction the car is sliding along the surface.
        tx = -nz;
        tz = nx;
        let vt = carVx * tx + carVz * tz;
        if (vt < 0) {
          tx = -tx;
          tz = -tz;
          vt = -vt;
        }
        // Even a square hit sprays: the crumple throws flecks sideways both ways.
        along = Math.max(vt, 3 + 6 * s);
        carry = 0.15;
        if (Math.random() < 0.5 && vt < 2) {
          tx = -tx;
          tz = -tz;
        }
      } else {
        // Under the car: sprayed along its travel, kicked off in every direction.
        const inv = speed > 0.5 ? 1 / speed : 0;
        tx = carVx * inv;
        tz = carVz * inv;
        ox = 0;
        oz = 0;
        along = Math.max(2, speed * 0.3);
        carry = 0.45;
      }

      for (let i = 0; i < count; i++) {
        // A metre of contact patch along the surface, at bodywork height.
        const spread = rand(-0.45, 0.45);
        const sy = nx === undefined ? y + rand(0.05, 0.2) : y + rand(BODY_LOW, BODY_HIGH);
        throwSpark(x + tx * spread, sy, z + tz * spread, y, ox, oz, tx, tz, along, carVx, carVz, carry, s);
      }
      // A split-second white-hot bloom where it hit, and for a real hit a second, redder one.
      const fy = y + 0.45;
      flashes.flash(x, fy, z, 0.9 + 1.6 * s, 0.07 + 0.05 * s, 1, 0.86, 0.6);
      if (s > 0.35) flashes.flash(x + ox * 0.2, fy, z + oz * 0.2, 1.6 + 2 * s, 0.12 + 0.06 * s, 1, 0.45, 0.12);
    },

    scrape(frameDt, x, y, z, carVx, carVz, slide, nx, nz) {
      if (slide > 0) {
        hold = SCRAPE_HOLD;
        holdSlide = slide;
        holdNx = nx;
        holdNz = nz;
      } else if (hold > 0) {
        hold -= frameDt;
      }
      if (hold <= 0 || holdSlide < SCRAPE_START) {
        owed = 0;
        return;
      }
      const k = clamp01((holdSlide - SCRAPE_START) / (SCRAPE_FULL - SCRAPE_START));
      // Flickers in bursts, like a real grind: the rate wanders frame to frame.
      owed += SCRAPE_RATE * (0.15 + 0.85 * k) * frameDt * rand(0.4, 1.6);
      if (owed > 24) owed = 24;
      // The side of the body in the wall.
      const px = x - holdNx * reach;
      const pz = z - holdNz * reach;
      let tx = -holdNz;
      let tz = holdNx;
      if (carVx * tx + carVz * tz < 0) {
        tx = -tx;
        tz = -tz;
      }
      while (owed >= 1) {
        owed -= 1;
        const along = rand(-1.1, 1.1);
        throwSpark(
          px + tx * along,
          y + rand(BODY_LOW, BODY_HIGH),
          pz + tz * along,
          y,
          holdNx,
          holdNz,
          tx,
          tz,
          // Torn off the body, the wall holds a fleck back: it leaves slower than the car and
          // falls behind it. Nothing extra along the wall.
          0,
          carVx,
          carVz,
          rand(0.15, 0.8),
          0.25 + 0.5 * k,
        );
      }
      // Now and then a pop of light off the grind.
      if (Math.random() < frameDt * (4 + 10 * k)) {
        flashes.flash(px, y + 0.45, pz, 0.5 + 0.7 * k, 0.05, 1, 0.75, 0.4);
      }
    },

    update(dt) {
      pool.update(dt);
    },
    reset() {
      hold = 0;
      owed = 0;
      pool.reset();
    },
    dispose() {
      pool.dispose();
    },
  };
}
