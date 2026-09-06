import { onRibbonAtLevel } from './cityGen';
import { SIDEWALK_Y, type CityPlan, type KerbField, type RibbonDef } from './cityPlan';
import { createProjection, projectOntoPath, segmentCount } from './track';

/**
 * The kerb: the pavement beside every ground-level street, standing a step above the asphalt.
 *
 * It exists twice over — as the quads `trackBuilder.ts` lays beside a ribbon, and as the
 * height `src/sim/surface.ts` reads under a car — so both read the same object here:
 *
 *  - which segments are paved is decided once, at build time, by the same junction test the
 *    renderer used to do inline: no pavement across the mouth of a crossing road. The
 *    renderer asks by (ribbon, segment, side); the simulation asks by point and lands on the
 *    same flag, so a car is never lifted where nothing is drawn,
 *  - the asphalt always wins: a point on any street is at road level whatever pavement runs
 *    beside it, and the alleys are paved flush: a kerb in a lane that narrow is a trap, not
 *    a landmark,
 *  - the kerb face is a short ramp rather than a wall, so a car crossing it climbs (and noses
 *    up on the grade) in a few frames instead of teleporting upward.
 *
 * Allocation-free on the query path: one scratch projection, one bounding box per ribbon.
 */

/** Height of the pavement above the road (m). The same slab the city blocks stand on. */
export const KERB_HEIGHT = SIDEWALK_Y;
/** Lateral run over which the kerb face rises (m): a chamfer a car can mount, not a wall. */
export const KERB_RAMP = 0.6;
/** Shoulders narrower than this are not worth paving. */
const MIN_SHOULDER = 0.8;

type Shoulders = NonNullable<CityPlan['shoulders']>;

interface Layer {
  rb: RibbonDef;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Two flags per segment: [i * 2] is the left side, [i * 2 + 1] the right. */
  paved: Uint8Array;
}

export function createKerbField(ribbons: readonly RibbonDef[], shoulders: Shoulders): KerbField {
  const proj = createProjection();

  const widthOf = (rb: RibbonDef, i: number): number => {
    const s = rb.path.samples[i];
    const w = rb.kind === 'alley' ? shoulders.alley : shoulders[s.zone];
    return w < MIN_SHOULDER ? 0 : w;
  };

  const layers = new Map<RibbonDef, Layer>();
  for (const rb of ribbons) {
    if (rb.elevated) continue;
    const samples = rb.path.samples;
    const segs = segmentCount(rb.path);
    const paved = new Uint8Array(segs * 2);
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
      const r = s.halfWidth + widthOf(rb, i);
      if (r > reach) reach = r;
    }
    for (let i = 0; i < segs; i++) {
      const a = samples[i];
      const c = samples[(i + 1) % samples.length];
      const width = widthOf(rb, i);
      if (width === 0) continue;
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? -1 : 1;
        // The middle of this stretch of pavement. Another road through it is a junction.
        const mx = (a.x + c.x) / 2 + -a.tz * (a.halfWidth + width / 2) * side;
        const mz = (a.z + c.z) / 2 + a.tx * (a.halfWidth + width / 2) * side;
        let crossing = false;
        for (const other of ribbons) {
          if (other !== rb && onRibbonAtLevel(other, mx, mz, a.y, 0.6)) {
            crossing = true;
            break;
          }
        }
        if (!crossing) paved[i * 2 + k] = 1;
      }
    }
    layers.set(rb, { rb, minX: minX - reach, maxX: maxX + reach, minZ: minZ - reach, maxZ: maxZ + reach, paved });
  }

  const list = [...layers.values()];

  return {
    widthAt(rb, i) {
      return layers.has(rb) ? widthOf(rb, i) : 0;
    },
    paved(rb, i, side) {
      const layer = layers.get(rb);
      return !!layer && layer.paved[i * 2 + (side < 0 ? 0 : 1)] === 1;
    },
    heightAt(x, z, out) {
      out.gx = 0;
      out.gz = 0;
      let best = 0;
      for (let n = 0; n < list.length; n++) {
        const layer = list[n];
        if (x < layer.minX || x > layer.maxX || z < layer.minZ || z > layer.maxZ) continue;
        projectOntoPath(layer.rb.path, x, z, proj);
        const over = proj.dist - proj.halfWidth;
        // On the asphalt of any street: road level, whatever else runs nearby.
        if (over <= 0) {
          out.gx = 0;
          out.gz = 0;
          return 0;
        }
        const width = widthOf(layer.rb, proj.index);
        if (width === 0 || over > width) continue;
        if (layer.rb.kind === 'alley') continue;
        const side = proj.lateral >= 0 ? 1 : -1;
        if (layer.paved[proj.index * 2 + (side < 0 ? 0 : 1)] !== 1) continue;
        const t = over < KERB_RAMP ? over / KERB_RAMP : 1;
        const y = KERB_HEIGHT * t;
        if (y <= best) continue;
        best = y;
        if (t < 1) {
          // Uphill is the outward normal on this side; the face rises at this rate.
          const g = (KERB_HEIGHT / KERB_RAMP) * side;
          out.gx = -proj.tz * g;
          out.gz = proj.tx * g;
        } else {
          out.gx = 0;
          out.gz = 0;
        }
      }
      return best;
    },
  };
}
