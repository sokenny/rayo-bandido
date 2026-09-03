import * as THREE from 'three';
import { CAMERA } from '../../config/tuning';
import {
  angleDelta,
  clamp,
  clamp01,
  damp,
  forwardX,
  forwardZ,
  lerpAngle,
  rightX,
  rightZ,
  wrapAngle,
} from '../../core/math';

/**
 * Low, close, centered third-person chase camera (docs/VISUAL_DIRECTION.md).
 * - Sits ~6.4 m behind and 2.5 m above the car and aims at a point ahead of it, so the car
 *   lands in the lower-center quarter of the frame with plenty of road visible.
 * - Follows the velocity direction partially while drifting (`driftFollow`) so the corner
 *   stays on screen, clamped by `maxFollowOffset` so the car never leaves the frame.
 * - Small lateral lag while sliding, look-ahead that grows with speed, FOV easing toward
 *   `fovNitro` while boosting, and decaying shake for nitro / impacts / lightning.
 * - While reversing the camera keeps the car's own heading (it never swings around the car)
 *   and shortens the look-ahead so the car stays readable.
 *
 * The camera receives an already-interpolated car pose each frame from `src/game.ts`.
 * Allocation-free per frame: only the two scratch vectors below are ever written.
 */
export interface CameraPose {
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  speed: number;
  slipAngle: number;
  /** 0..1 nitro intensity. */
  nitro: number;
  drifting: boolean;
}

export interface ChaseCamera {
  camera: THREE.PerspectiveCamera;
  /** Jump to the ideal position immediately (spawn / restart). */
  snap(pose: CameraPose): void;
  update(pose: CameraPose, frameDt: number): void;
  /** Add camera shake (meters of amplitude). Decays automatically. */
  shake(amount: number): void;
  resize(aspect: number): void;
}

export function createChaseCamera(aspect: number): ChaseCamera {
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.3, 400);
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  let followHeading = 0;
  let fov = CAMERA.fov;
  let shakeAmp = 0;
  let shakeT = 0;
  let lag = 0;

  /** Sideways speed in the car's own frame (m/s). Positive = sliding toward its right. */
  function lateralOf(pose: CameraPose): number {
    return pose.vx * rightX(pose.heading) + pose.vz * rightZ(pose.heading);
  }

  function idealHeading(pose: CameraPose): number {
    // Stopped or reversing: stay behind the nose. Never orbit the car.
    if (pose.speed < 2) return pose.heading;
    const vmag = Math.sqrt(pose.vx * pose.vx + pose.vz * pose.vz);
    if (vmag < 2) return pose.heading;
    const velHeading = Math.atan2(pose.vx, -pose.vz);
    const blend = pose.drifting ? CAMERA.driftFollow : CAMERA.followBlend;
    const offset = clamp(
      angleDelta(pose.heading, lerpAngle(pose.heading, velHeading, blend)),
      -CAMERA.maxFollowOffset,
      CAMERA.maxFollowOffset,
    );
    return pose.heading + offset;
  }

  function place(pose: CameraPose, h: number, lagOffset: number): void {
    const fx = forwardX(h);
    const fz = forwardZ(h);
    const rx = rightX(h);
    const rz = rightZ(h);
    const ahead =
      pose.speed < 0
        ? CAMERA.reverseLookAhead
        : Math.min(CAMERA.lookAhead + pose.speed * CAMERA.lookAheadPerSpeed, CAMERA.lookAheadMax);
    const dist = CAMERA.distance + CAMERA.nitroPullback * clamp01(pose.nitro);
    pos.set(pose.x - fx * dist + rx * lagOffset, CAMERA.height, pose.z - fz * dist + rz * lagOffset);
    look.set(pose.x + fx * ahead, CAMERA.lookHeight, pose.z + fz * ahead);
  }

  return {
    camera,
    snap(pose) {
      followHeading = pose.heading;
      lag = 0;
      place(pose, followHeading, 0);
      camera.position.copy(pos);
      camera.lookAt(look);
      fov = CAMERA.fov;
      camera.fov = fov;
      camera.updateProjectionMatrix();
      shakeAmp = 0;
    },
    update(pose, dt) {
      // Smooth follow, plus a hard rad/s cap so a violent flick can never whip the camera.
      const step = angleDelta(followHeading, idealHeading(pose)) * (1 - Math.exp(-CAMERA.rotationDamping * dt));
      const maxStep = CAMERA.maxYawRate * dt;
      followHeading = wrapAngle(followHeading + clamp(step, -maxStep, maxStep));

      // The camera trails the sideways motion instead of sticking to the car.
      const lagTarget = clamp(
        -lateralOf(pose) * CAMERA.lateralLag,
        -CAMERA.lateralLagMax,
        CAMERA.lateralLagMax,
      );
      lag = damp(lag, lagTarget, CAMERA.lateralLagDamping, dt);

      place(pose, followHeading, lag);
      camera.position.x = damp(camera.position.x, pos.x, CAMERA.positionDamping, dt);
      camera.position.y = damp(camera.position.y, pos.y, CAMERA.positionDamping, dt);
      camera.position.z = damp(camera.position.z, pos.z, CAMERA.positionDamping, dt);
      if (shakeAmp > 0.0005) {
        shakeT += dt * 40;
        camera.position.x += Math.sin(shakeT * 1.3) * shakeAmp;
        camera.position.y += Math.cos(shakeT * 1.7) * shakeAmp;
        shakeAmp = damp(shakeAmp, 0, CAMERA.shakeDecay, dt);
      }
      camera.lookAt(look);
      const targetFov = CAMERA.fov + (CAMERA.fovNitro - CAMERA.fov) * clamp01(pose.nitro);
      fov = damp(fov, targetFov, CAMERA.fovDamping, dt);
      if (Math.abs(fov - camera.fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },
    shake(amount) {
      shakeAmp = Math.max(shakeAmp, amount);
    },
    resize(a) {
      camera.aspect = a;
      camera.updateProjectionMatrix();
    },
  };
}
