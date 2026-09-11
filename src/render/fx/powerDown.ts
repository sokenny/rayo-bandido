import type { SparkFx } from './sparks';
import type { TireSmoke } from './tireSmoke';

/**
 * The sparks, flashes and haze of an electric car losing its power, spread over time.
 *
 * WHY THIS IS A SCHEDULER AND NOT A BURST. Everything a kill used to throw left the car in the
 * same frame, which is the shape of an explosion: one bang, then debris. A power-down is not
 * that — it is an overload that takes a beat to work through the car and then gives up in
 * stages, and the only way the particles can say so is to arrive in those stages. The timings
 * here are the ones `electricCarVisual.ts` lights the car on, so a spark pops out of the hood
 * while the body is still flooded and the last of the haze rises after the beacon has gone.
 *
 * It owns no scene objects and adds no draw calls: it spends the shared spark, flash and smoke
 * pools, and a wreck costs FEWER particles than the old burst did (17 sparks against 40), which
 * is the other half of why this reads as a car going dead rather than a car going up.
 *
 * Everything is pre-allocated. `SLOTS` wrecks can be mid-cascade at once — more than that and
 * the oldest one loses its remaining beats, which at four simultaneous kills is not a thing
 * anyone has ever seen.
 */
export const SLOTS = 4;

/** Cyan-white: the same electricity the bolt is drawn in. */
const ARC_R = 0.55;
const ARC_G = 0.95;
const ARC_B = 1;
/** The last sparks off the wheels, hot metal rather than current. */
const HOT_R = 1;
const HOT_G = 0.82;
const HOT_B = 0.5;

interface Beat {
  /** Seconds after the hit. */
  at: number;
  run(fx: SparkFx, smoke: TireSmoke, x: number, y: number, z: number): void;
}

/**
 * The cascade, in order. Read alongside the phase table in `electricCarVisual.ts`: the surge
 * lands on the first two, the stutter on the third and fourth, and the haze is what is left
 * once the car is dark.
 */
const BEATS: Beat[] = [
  {
    // Impact: the current arriving. A flash over the hood and a spray off it.
    at: 0,
    run(fx, _smoke, x, y, z) {
      fx.flash(x, y + 0.95, z, 2.6, 0.18, 0.9, 1, 1);
      fx.burst(x, y + 0.8, z, 6, 6, 0.34, 0.2, ARC_R, ARC_G, ARC_B);
    },
  },
  {
    // The cabin lighting up: a smaller, higher flash, at the roof rather than the nose.
    at: 0.14,
    run(fx, _smoke, x, y, z) {
      fx.flash(x, y + 1.35, z, 1.5, 0.14, 0.8, 1, 1);
      fx.burst(x, y + 1.1, z, 4, 4.5, 0.3, 0.16, ARC_R, ARC_G, ARC_B);
    },
  },
  {
    // Something lets go at an axle while the lights are still stuttering.
    at: 0.32,
    run(fx, _smoke, x, y, z) {
      const side = Math.random() < 0.5 ? -1 : 1;
      fx.burst(x + side * 0.8, y + 0.35, z + (Math.random() - 0.5) * 2, 4, 3.4, 0.36, 0.13, HOT_R, HOT_G, HOT_B);
    },
  },
  {
    // The last of it, out of the back, with the first of the haze.
    at: 0.55,
    run(fx, smoke, x, y, z) {
      fx.burst(x, y + 0.45, z, 3, 2.8, 0.32, 0.12, ARC_R, ARC_G, ARC_B);
      smoke.puff(x + (Math.random() - 0.5) * 0.8, y + 0.7, z + (Math.random() - 0.5) * 0.8, 0.55, 1.1, 0.3);
    },
  },
  {
    // Dead, and smoking very slightly: two puffs, low and slow, off a car that is simply off.
    at: 0.85,
    run(_fx, smoke, x, y, z) {
      for (let i = 0; i < 2; i++) {
        smoke.puff(
          x + (Math.random() - 0.5) * 1.1,
          y + 0.8 + Math.random() * 0.4,
          z + (Math.random() - 0.5) * 1.1,
          0.6 + Math.random() * 0.35,
          1.3,
          0.28,
        );
      }
    },
  },
  {
    at: 1.25,
    run(_fx, smoke, x, y, z) {
      smoke.puff(x + (Math.random() - 0.5) * 1.2, y + 1.1, z + (Math.random() - 0.5) * 1.2, 0.75, 1.5, 0.22);
    },
  },
];

export interface PowerDownFx {
  /** Start a cascade at a wreck. The first beat lands in this frame. */
  spawn(x: number, y: number, z: number): void;
  update(dt: number): void;
  reset(): void;
}

export function createPowerDown(sparkFx: SparkFx, smoke: TireSmoke): PowerDownFx {
  const age = new Float32Array(SLOTS);
  /** Beats already played for each slot; `BEATS.length` means finished. */
  const played = new Int32Array(SLOTS);
  const posX = new Float32Array(SLOTS);
  const posY = new Float32Array(SLOTS);
  const posZ = new Float32Array(SLOTS);
  let head = 0;
  let live = 0;
  // Every slot starts finished: an untouched pool must not read as four cascades at the origin.
  for (let i = 0; i < SLOTS; i++) played[i] = BEATS.length;

  function advance(i: number): void {
    const t = age[i];
    let next = played[i];
    while (next < BEATS.length && BEATS[next].at <= t) {
      BEATS[next].run(sparkFx, smoke, posX[i], posY[i], posZ[i]);
      next++;
    }
    played[i] = next;
  }

  return {
    spawn(x, y, z) {
      const i = head;
      head = (head + 1) % SLOTS;
      if (played[i] >= BEATS.length) live++;
      age[i] = 0;
      played[i] = 0;
      posX[i] = x;
      posY[i] = y;
      posZ[i] = z;
      advance(i);
    },

    update(dt) {
      if (live <= 0) return;
      for (let i = 0; i < SLOTS; i++) {
        if (played[i] >= BEATS.length) continue;
        age[i] += dt;
        advance(i);
        if (played[i] >= BEATS.length) live--;
      }
    },

    reset() {
      for (let i = 0; i < SLOTS; i++) {
        age[i] = 0;
        played[i] = BEATS.length;
      }
      head = 0;
      live = 0;
    },
  };
}
