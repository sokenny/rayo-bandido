import { onRibbonAtLevel } from './cityGen';
import { inRect, type CityPlan, type KerbField, type Rect, type RibbonDef } from './cityPlan';
import { segmentCount } from './track';

/**
 * The pavement beside every ground-level street: which stretches carry it, and how wide each
 * one runs. It is flush with the asphalt — a car crosses onto it without a bump — so this is
 * art only; nothing here answers the simulation, which reads flat ground under the whole city.
 *
 *  - which segments are paved is decided once, at build time, by the same junction test the
 *    renderer used to do inline: no pavement across the mouth of a crossing road,
 *  - how wide each stretch is is measured, not assumed: the zone's shoulder is only a
 *    starting point, and the band is then run out to the face of the block behind it. The
 *    blocks are placed on a grid and only guaranteed to clear the shoulder, so the gap
 *    between the two is often a metre or three wide — pavement you can see and stand on,
 *    which would otherwise be left as bare ground,
 *  - the alleys are paved too: the old town's back lanes are the same flush concrete.
 */

/** Shoulders narrower than this are not worth paving. */
const MIN_SHOULDER = 0.8;
/** How far past the zone's shoulder a band may run to reach the block behind it (m). */
const REACH_MAX = 8;
/** Step of the outward march that finds that block face (m). */
const REACH_STEP = 0.25;

type Shoulders = NonNullable<CityPlan['shoulders']>;

interface Layer {
  rb: RibbonDef;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Two flags per segment: [i * 2] is the left side, [i * 2 + 1] the right. */
  paved: Uint8Array;
  /** Paved width at the segment's near end, per segment and side (m). */
  widthA: Float32Array;
  /** The same at its far end: the band tapers between the two, so it can follow a block face
   *  that a diagonal street meets at an angle instead of stopping short of it. */
  widthC: Float32Array;
}

export function createKerbField(ribbons: readonly RibbonDef[], shoulders: Shoulders, blocks: readonly Rect[] = []): KerbField {
  const shoulderOf = (rb: RibbonDef, i: number): number => {
    const s = rb.path.samples[i];
    const w = rb.kind === 'alley' ? shoulders.alley : shoulders[s.zone];
    return w < MIN_SHOULDER ? 0 : w;
  };

  const solidAt = (x: number, z: number): boolean => {
    for (let i = 0; i < blocks.length; i++) if (inRect(blocks[i], x, z)) return true;
    return false;
  };

  /**
   * How far the pavement can run outward from the road edge under (x, z) before it meets the
   * face of a block — or, past the zone's own shoulder, the asphalt of some other street. -1
   * when it meets neither within reach, which means open ground rather than a kerb to a wall.
   */
  const reachAt = (rb: RibbonDef, y: number, x: number, z: number, nx: number, nz: number, edge: number, base: number): number => {
    const limit = base + REACH_MAX;
    for (let o = REACH_STEP; o <= limit; o += REACH_STEP) {
      const px = x + nx * (edge + o);
      const pz = z + nz * (edge + o);
      if (solidAt(px, pz)) return o - REACH_STEP;
      if (o <= base) continue;
      for (const other of ribbons) {
        if (other !== rb && onRibbonAtLevel(other, px, pz, y, 0)) return o - REACH_STEP;
      }
    }
    return -1;
  };

  const layers = new Map<RibbonDef, Layer>();
  for (const rb of ribbons) {
    if (rb.elevated) continue;
    const samples = rb.path.samples;
    const segs = segmentCount(rb.path);
    const paved = new Uint8Array(segs * 2);
    const widthA = new Float32Array(segs * 2);
    const widthC = new Float32Array(segs * 2);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let reach = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.z < minZ) minZ = s.z;
      if (s.z > maxZ) maxZ = s.z;
      const r = s.halfWidth + shoulderOf(rb, i) + REACH_MAX;
      if (r > reach) reach = r;
    }
    for (let i = 0; i < segs; i++) {
      const a = samples[i];
      const c = samples[(i + 1) % samples.length];
      const base = shoulderOf(rb, i);
      if (base === 0) continue;
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? -1 : 1;
        const nx = -a.tz * side;
        const nz = a.tx * side;
        // The middle of this stretch of pavement. Another road through it is a junction.
        const mx = (a.x + c.x) / 2 + nx * (a.halfWidth + base / 2);
        const mz = (a.z + c.z) / 2 + nz * (a.halfWidth + base / 2);
        let crossing = false;
        for (const other of ribbons) {
          if (other !== rb && onRibbonAtLevel(other, mx, mz, a.y, 0.6)) {
            crossing = true;
            break;
          }
        }
        if (crossing) continue;
        // Measured at both ends and at the middle, and the band tapers between the two ends.
        // An end that reaches nothing (the mouth of a junction, an empty lot) falls back to
        // the zone's own shoulder rather than dragging the whole stretch in with it — one
        // open end is no reason to leave a trench along a stretch that does back onto a
        // block — but never past a face the rays did find, so pavement never enters one. The
        // middle only pulls the band in: a face that bows toward the street still keeps it out.
        const rayA = reachAt(rb, a.y, a.x, a.z, nx, nz, a.halfWidth, base);
        const rayC = reachAt(rb, c.y, c.x, c.z, nx, nz, c.halfWidth, base);
        const rayM = reachAt(rb, a.y, (a.x + c.x) / 2, (a.z + c.z) / 2, nx, nz, a.halfWidth, base);
        let open = base;
        for (const r of [rayA, rayC, rayM]) if (r >= 0 && r < open) open = r;
        let wa = rayA >= 0 ? rayA : open;
        let wc = rayC >= 0 ? rayC : open;
        const mid = (wa + wc) / 2;
        if (rayM >= 0 && mid > rayM && mid > 0) {
          wa *= rayM / mid;
          wc *= rayM / mid;
        }
        if (Math.min(wa, wc) < MIN_SHOULDER) continue;
        paved[i * 2 + k] = 1;
        widthA[i * 2 + k] = wa;
        widthC[i * 2 + k] = wc;
      }
    }
    layers.set(rb, { rb, minX: minX - reach, maxX: maxX + reach, minZ: minZ - reach, maxZ: maxZ + reach, paved, widthA, widthC });
  }

  return {
    widthAt(rb, i, side, t = 0) {
      const layer = layers.get(rb);
      if (!layer) return 0;
      const slot = i * 2 + (side < 0 ? 0 : 1);
      return layer.widthA[slot] + (layer.widthC[slot] - layer.widthA[slot]) * t;
    },
    paved(rb, i, side) {
      const layer = layers.get(rb);
      return !!layer && layer.paved[i * 2 + (side < 0 ? 0 : 1)] === 1;
    },
  };
}
