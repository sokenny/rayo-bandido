import type { BusState, PoliceUnit, TargetState, VehicleState } from '../core/types';
import { lerp, lerpAngle } from '../core/math';
import type { CarVisual } from './scene/carVisual';
import type { ElectricCarVisual } from './scene/electricCarVisual';
import type { BusVisual } from './scene/busVisual';
import type { PoliceCarVisual } from './scene/policeCarVisual';

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
  // The rim in the cabin turns off the same angle as the road wheels below (`interior.ts`).
  car.setSteering(v.steerAngle);
  const wheels = car.wheels;
  for (let i = 0; i < wheels.length; i++) {
    const w = wheels[i];
    // Positive steer turns right; in Three's frame that is a negative rotation about Y.
    w.steer.rotation.y = i < 2 ? -v.steerAngle : 0;
    // Forward travel (toward -Z) rolls the wheel backward about +X.
    w.spin.rotation.x = -v.wheelSpin;
  }
}

/**
 * The traffic.
 *
 * NOT CULLED BY DISTANCE, and that was measured rather than assumed. The open world holds 126
 * of these against a 60-draw budget, so hiding the far ones looks like free money — but the
 * city's haze is `FogExp2` (`HAZE.cityDensity`), chosen precisely so the far side of the bay
 * keeps some contrast instead of clamping to flat fog. A car at 165 m is only about a fifth
 * hazed, and dropping it there changes pixels by up to 100/255: a visible pop. By the distance
 * the fog really does hide a car there is nothing left within it to cull. The draw calls are
 * real and worth fixing — by instancing the fleet, not by hiding it.
 */
export function syncTargets(
  visuals: ElectricCarVisual[],
  targets: TargetState[],
  alpha: number,
  time: number,
  /**
   * One flag per car, from `markRushTargets`: whether it is worth points in the Rayo Rush run
   * that is under way. Null (the usual case) marks nothing.
   */
  rushMarks: Uint8Array | null = null,
): void {
  for (let i = 0; i < targets.length && i < visuals.length; i++) {
    const t = targets[i];
    const vis = visuals[i];
    vis.root.position.set(lerp(t.prevX, t.x, alpha), lerp(t.prevY, t.y, alpha), lerp(t.prevZ, t.z, alpha));
    vis.root.rotation.y = -lerpAngle(t.prevHeading, t.heading, alpha);
    vis.setStatus(t.status, t.hitTime >= 0 ? time - t.hitTime : 0);
    vis.setRushTarget(!!rushMarks && rushMarks[t.id] === 1);
  }
}

/**
 * The buses. They keep the road's height (the routes are all at street level), so unlike a
 * target there is nothing to settle: position, yaw and how far the doors are open.
 */
export function syncBuses(visuals: BusVisual[], buses: BusState[], alpha: number): void {
  for (let i = 0; i < buses.length && i < visuals.length; i++) {
    const b = buses[i];
    const vis = visuals[i];
    vis.root.position.set(lerp(b.prevX, b.x, alpha), 0, lerp(b.prevZ, b.z, alpha));
    vis.root.rotation.y = -lerpAngle(b.prevHeading, b.heading, alpha);
    vis.setDoors(b.doors);
  }
}

/**
 * The police. One visual per pool slot; a slot that is off the road hides its car. `aimed` is
 * the unit the Rayo is lined up on (`PoliceState.aimedUnit`), or -1.
 */
export function syncPolice(visuals: PoliceCarVisual[], units: readonly PoliceUnit[], alpha: number, aimed: number): void {
  for (let i = 0; i < units.length && i < visuals.length; i++) {
    const u = units[i];
    const vis = visuals[i];
    const active = u.status === 'active';
    vis.setActive(active);
    if (!active) continue;
    vis.root.position.set(lerp(u.prevX, u.x, alpha), lerp(u.prevY, u.y, alpha), lerp(u.prevZ, u.z, alpha));
    vis.root.rotation.y = -lerpAngle(u.prevHeading, u.heading, alpha);
    vis.setLights(u.lights);
    vis.setAimed(aimed === i);
  }
}
