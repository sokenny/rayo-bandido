import type { ArenaLayout, SurfaceSample, TargetState, VehicleState } from '../core/types';
import { forwardX, forwardZ } from '../core/math';

/**
 * Elevation. The handling model is planar; this is the one place a body learns how high the
 * road under it is. After a body has moved for the tick, `settle*` asks the layout's surface
 * field for the surface nearest the height the body already had — that is what keeps a car
 * on a viaduct from being dropped to the street below it, and a car under the viaduct from
 * being lifted onto it — and writes the height back, plus the road grade along the car's
 * heading for the body tilt and for the gravity term in `src/sim/vehicle.ts`.
 *
 * A world with no surface field is flat: every body stays at y 0 and pitch 0. Allocation-free.
 */
const SAMPLE: SurfaceSample = { y: 0, gx: 0, gz: 0 };

export function settleVehicle(v: VehicleState, layout: ArenaLayout): void {
  const field = layout.surface;
  if (!field) {
    v.y = 0;
    v.pitch = 0;
    return;
  }
  field.sample(v.x, v.z, v.y, SAMPLE);
  v.y = SAMPLE.y;
  // Grade along the heading (rise per metre forward), as an angle.
  const grade = SAMPLE.gx * forwardX(v.heading) + SAMPLE.gz * forwardZ(v.heading);
  v.pitch = Math.atan(grade);
}

export function settleTarget(t: TargetState, layout: ArenaLayout): void {
  const field = layout.surface;
  if (!field) {
    t.y = 0;
    return;
  }
  field.sample(t.x, t.z, t.y, SAMPLE);
  t.y = SAMPLE.y;
}
