import type { TargetState, VehicleState } from '../core/types';
import { lerp, lerpAngle } from '../core/math';
import type { CarVisual } from './scene/carVisual';
import type { ElectricCarVisual } from './scene/electricCarVisual';

/**
 * Simulation -> Three.js synchronization. This is the only module that maps the sim's
 * compass heading to Three's rotation (`rotation.y = -heading`).
 */
export interface InterpolatedPose {
  x: number;
  /** Height of the road under the car (m). */
  y: number;
  z: number;
  heading: number;
}

export function interpolateVehicle(v: VehicleState, alpha: number, out: InterpolatedPose): void {
  out.x = lerp(v.prevX, v.x, alpha);
  out.y = lerp(v.prevY, v.y, alpha);
  out.z = lerp(v.prevZ, v.z, alpha);
  out.heading = lerpAngle(v.prevHeading, v.heading, alpha);
}

/**
 * Yaw first, then pitch about the car's own axle: 'YXZ' is what makes `rotation.x` tilt the
 * car up a ramp whichever way it is heading. Applied to the root, under the sprung chassis,
 * so the body springs still work in the car's frame.
 */
const ROOT_ORDER = 'YXZ';

export function syncCar(car: CarVisual, v: VehicleState, pose: InterpolatedPose): void {
  car.root.position.set(pose.x, pose.y, pose.z);
  if (car.root.rotation.order !== ROOT_ORDER) car.root.rotation.order = ROOT_ORDER;
  car.root.rotation.y = -pose.heading;
  car.root.rotation.x = v.pitch;
  const wheels = car.wheels;
  for (let i = 0; i < wheels.length; i++) {
    const w = wheels[i];
    // Positive steer turns right; in Three's frame that is a negative rotation about Y.
    w.steer.rotation.y = i < 2 ? -v.steerAngle : 0;
    // Forward travel (toward -Z) rolls the wheel backward about +X.
    w.spin.rotation.x = -v.wheelSpin;
  }
}

export function syncTargets(
  visuals: ElectricCarVisual[],
  targets: TargetState[],
  alpha: number,
  acquiredId: number,
  time: number,
): void {
  for (let i = 0; i < targets.length && i < visuals.length; i++) {
    const t = targets[i];
    const vis = visuals[i];
    vis.root.position.set(lerp(t.prevX, t.x, alpha), lerp(t.prevY, t.y, alpha), lerp(t.prevZ, t.z, alpha));
    vis.root.rotation.y = -lerpAngle(t.prevHeading, t.heading, alpha);
    vis.setStatus(t.status, t.hitTime >= 0 ? time - t.hitTime : 0);
    vis.setAcquired(t.id === acquiredId && t.status === 'active');
  }
}
