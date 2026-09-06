import type { SurfaceField, SurfaceSample } from '../core/types';
import type { KerbField } from './cityPlan';
import { createProjection, projectOntoPath, segmentCount, type TrackPath } from './track';

/**
 * The drivable heights of a world, built from its elevated ribbons (viaducts, ramps, the
 * skyway). The ground at y 0 is always a candidate; every elevated path the point lies on
 * adds another, at that path's height there. Of the candidates, the HIGHEST one the body can
 * step onto wins — anything up to `STEP_UP` above the height it already has — so a car on
 * the deck stays on the deck over the street below, a car on the street stays under the deck
 * (15 m is no step), and a car at the foot of a ramp is carried up it: the ramp is always a
 * few centimetres above where the car was a tick ago. The same rule brings it down again,
 * since the ramp is then the highest surface still under the car.
 *
 * `pad` widens each ribbon a little past its guardrails, so a car pressed into a rail still
 * stands on the deck rather than dropping to the ground beside it.
 *
 * At ground level the world is not quite flat either: `kerbs` raises the pavement beside the
 * streets by a step, so a car that strays off the asphalt climbs the kerb and tips on its
 * face. It is asked only when no elevated road won — the pavement is a ground-level thing.
 *
 * Allocation-free: one scratch projection, one bounding box per ribbon computed up front.
 */
/** Largest rise a body takes in its stride (m). A ramp climbs a few centimetres per tick. */
export const STEP_UP = 0.6;

export function createSurfaceField(paths: readonly TrackPath[], pad = 1.5, kerbs: KerbField | null = null): SurfaceField {
  const proj = createProjection();
  const kerbGrade = { gx: 0, gz: 0 };
  const layers = paths.map((path) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let reach = 0;
    for (const s of path.samples) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.z < minZ) minZ = s.z;
      if (s.z > maxZ) maxZ = s.z;
      if (s.halfWidth > reach) reach = s.halfWidth;
    }
    reach += pad;
    return { path, minX: minX - reach, maxX: maxX + reach, minZ: minZ - reach, maxZ: maxZ + reach };
  });

  return {
    sample(x: number, z: number, yHint: number, out: SurfaceSample): void {
      let bestY = 0;
      let bestGx = 0;
      let bestGz = 0;
      const ceiling = yHint + STEP_UP;
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (x < layer.minX || x > layer.maxX || z < layer.minZ || z > layer.maxZ) continue;
        const path = layer.path;
        projectOntoPath(path, x, z, proj);
        if (proj.dist > proj.halfWidth + pad) continue;
        const y = proj.y;
        if (y > ceiling || y <= bestY) continue;
        bestY = y;
        // Grade of this segment along its tangent, as a gradient on the XZ plane.
        const samples = path.samples;
        const n = samples.length;
        const a = samples[proj.index];
        const b = samples[(proj.index + 1) % n];
        const run = Math.hypot(b.x - a.x, b.z - a.z);
        const grade = run > 1e-6 && proj.index < segmentCount(path) ? (b.y - a.y) / run : 0;
        bestGx = proj.tx * grade;
        bestGz = proj.tz * grade;
      }
      if (kerbs && bestY === 0) {
        bestY = kerbs.heightAt(x, z, kerbGrade);
        bestGx = kerbGrade.gx;
        bestGz = kerbGrade.gz;
      }
      out.y = bestY;
      out.gx = bestGx;
      out.gz = bestGz;
    },
  };
}
