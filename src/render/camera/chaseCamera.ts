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
 * Besides the chase view the rig carries three rigid mounts (`CAMERA.mounts`): `front`,
 * hanging off the nose and looking back down the car, `side`, a fender cam at the driver's
 * door, and `cabin`, the driver's eyeline behind the wheel. Those are placed exactly rather
 * than damped — a lens bolted to the bodywork does not trail the car — and they inherit a
 * fraction of the body's roll and dive so the horizon leans with the chassis instead of
 * floating level. `cabin` goes further: being inside the shell, its offsets swing with the
 * body too (`ridesBody`), so the dashboard in front of it never moves.
 *
 * `VIEW_ORDER` is what P walks through, and it is deliberately not every view the rig can
 * hold: `cabin` is built and reachable through `setView` (and so through `window.__rb.view`)
 * but sits outside the cycle.
 *
 * All of them drive the one `PerspectiveCamera`, so a view change costs no extra draw calls
 * and nothing downstream (speed blur, name tags) has to know which one is live.
 *
 * The camera receives an already-interpolated car pose each frame from `src/game.ts`.
 * Allocation-free per frame: only the two scratch vectors below are ever written.
 */

/** Every view the rig can hold. `chase` is the default and the one every restart returns to. */
export type CameraView = 'chase' | 'cabin' | 'front' | 'side';

/** What P walks through, in order. `cabin` is left out: reachable, but not in the rotation. */
const VIEW_ORDER: readonly CameraView[] = ['chase', 'front', 'side'];

/** One entry of `CAMERA.mounts`. See the tuning block for what each offset means. */
type Mount = (typeof CAMERA.mounts)[keyof typeof CAMERA.mounts];

export interface CameraPose {
  x: number;
  /** Height of the road under the car (m). Everything below is relative to it. */
  y: number;
  z: number;
  heading: number;
  /** Grade of the road along the heading (rad, positive = climbing). The look point follows it. */
  roadPitch: number;
  vx: number;
  vz: number;
  speed: number;
  slipAngle: number;
  /** 0..1 nitro intensity. */
  nitro: number;
  drifting: boolean;
  /** Body lean about the forward axis (rad), from `carVisual.chassis`. Mounted views only. */
  roll: number;
  /** Body dive/squat about the lateral axis (rad). Mounted views only. */
  pitch: number;
}

export interface ChaseCamera {
  camera: THREE.PerspectiveCamera;
  /** Jump to the ideal position immediately (spawn / restart). */
  snap(pose: CameraPose): void;
  update(pose: CameraPose, frameDt: number): void;
  /** Add camera shake (meters of amplitude). Decays automatically. */
  shake(amount: number): void;
  /**
   * Drag-look: orbit the chase camera by these deltas (rad). Held while `dragging` is true
   * and for `CAMERA.dragHold` after it goes false, then eased back behind the car.
   */
  look(dYaw: number, dPitch: number): void;
  /** Whether a drag is in progress. Freezes the recentring while true. */
  setDragging(active: boolean): void;
  resize(aspect: number): void;
  /** Which view is live. */
  readonly view: CameraView;
  /** Jump to a view. Takes effect on the next `update()`; the switch is deliberately a cut. */
  setView(view: CameraView): void;
  /**
   * Advance one step through `VIEW_ORDER` (`chase -> front -> side`) and wrap. A view held
   * outside that order, like `cabin`, is left where it is: cycling out of it lands on the
   * first entry, and only `setView` can get back to it.
   */
  cycleView(): CameraView;
}

/** Near plane for the chase view. The mounted views pull it in (`CAMERA.mountNear`). */
const CHASE_NEAR = 0.3;

export function createChaseCamera(aspect: number): ChaseCamera {
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CHASE_NEAR, CAMERA.far);
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  let followHeading = 0;
  let fov = CAMERA.fov;
  let shakeAmp = 0;
  let shakeT = 0;
  let lag = 0;
  /** Drag-look orbit offsets around the follow heading (rad) and their recentre timer. */
  let lookYaw = 0;
  let lookPitch = 0;
  let lookHold = 0;
  let dragging = false;
  let view: CameraView = 'chase';
  /** Set by a view change: the next `update()` places the camera outright instead of damping. */
  let cut = false;

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
    // Drag-look orbits the rig: the boom swings to `h + lookYaw` and tilts by `lookPitch`,
    // and the aim slides from the road ahead onto the car itself as the offset grows, so a
    // look to the side shows you the car and what is beside it rather than empty scenery.
    const oh = h + lookYaw;
    const fx = forwardX(oh);
    const fz = forwardZ(oh);
    const rx = rightX(oh);
    const rz = rightZ(oh);
    const ahead =
      pose.speed < 0
        ? CAMERA.reverseLookAhead
        : Math.min(CAMERA.lookAhead + pose.speed * CAMERA.lookAheadPerSpeed, CAMERA.lookAheadMax);
    const dist = CAMERA.distance + CAMERA.nitroPullback * clamp01(pose.nitro);
    const flat = dist * Math.cos(lookPitch);
    pos.set(
      pose.x - fx * flat + rx * lagOffset,
      pose.y + CAMERA.height + dist * Math.sin(lookPitch),
      pose.z - fz * flat + rz * lagOffset,
    );
    // On a ramp the road ahead is higher (or lower) than the car: aim where it is going, so
    // the crest does not fill the frame on the way up and the drop is visible on the way down.
    const rise = Math.tan(pose.roadPitch) * ahead * CAMERA.pitchFollow;
    const offset = Math.hypot(lookYaw, lookPitch);
    const onCar = clamp01(offset / CAMERA.dragLookBlend);
    const aim = ahead * (1 - onCar);
    look.set(
      pose.x + fx * aim,
      pose.y + CAMERA.lookHeight + rise * (1 - onCar),
      pose.z + fz * aim,
    );
  }

  /**
   * Resolve a mount's car-local offsets into the world `pos` / `look` scratch vectors.
   *
   * A `ridesBody` mount has its own offsets swung by the body's roll and dive first, about
   * the car's origin at road level — the same pivot `carVisual`'s sprung chassis turns about.
   * That is what makes a lens inside the cabin move exactly as the cabin does. The two angles
   * are applied one after the other rather than as a single rotation: they never exceed a few
   * degrees, so the cross term is far below anything the eye could pick up in a moving car.
   */
  function placeMount(pose: CameraPose, mount: Mount): void {
    const h = pose.heading;
    const fx = forwardX(h);
    const fz = forwardZ(h);
    const rx = rightX(h);
    const rz = rightZ(h);
    let ahead = mount.ahead;
    let side = mount.side;
    let height = mount.height;
    if (mount.ridesBody) {
      // Roll turns the (right, up) plane; dive turns the (up, back) plane, and `ahead` is the
      // negated local z the body's pitch is measured about.
      const cr = Math.cos(pose.roll);
      const sr = Math.sin(pose.roll);
      const rolledSide = side * cr - height * sr;
      const rolledHeight = side * sr + height * cr;
      const cp = Math.cos(pose.pitch);
      const sp = Math.sin(pose.pitch);
      const back = -ahead;
      side = rolledSide;
      height = rolledHeight * cp - back * sp;
      ahead = -(rolledHeight * sp + back * cp);
    }
    pos.set(
      pose.x + fx * ahead + rx * side,
      pose.y + height,
      pose.z + fz * ahead + rz * side,
    );
    look.set(
      pose.x + fx * mount.lookAhead + rx * mount.lookSide,
      pose.y + mount.lookHeight,
      pose.z + fz * mount.lookAhead + rz * mount.lookSide,
    );
  }

  /**
   * Point the camera from `pos` at `look`, then lean it with the body. The roll goes on the
   * camera's own Z (which is the lens axis after `lookAt`, so it tilts the horizon) and the
   * pitch on its X, both scaled by the mount's follow fractions.
   */
  function aimMount(mount: Mount, pose: CameraPose): void {
    camera.position.copy(pos);
    camera.lookAt(look);
    camera.rotateZ(pose.roll * mount.rollFollow);
    camera.rotateX(pose.pitch * mount.pitchFollow);
  }

  /** Apply a view's near plane and base FOV. Only touches the projection when it changes. */
  function applyLens(near: number, targetFov: number, dt: number, immediate: boolean): void {
    fov = immediate ? targetFov : damp(fov, targetFov, CAMERA.fovDamping, dt);
    if (Math.abs(fov - camera.fov) > 0.01 || camera.near !== near) {
      camera.fov = fov;
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }

  return {
    camera,
    snap(pose) {
      followHeading = pose.heading;
      lag = 0;
      lookYaw = 0;
      lookPitch = 0;
      lookHold = 0;
      shakeAmp = 0;
      cut = false;
      const mount = view === 'chase' ? null : CAMERA.mounts[view];
      if (mount) {
        placeMount(pose, mount);
        aimMount(mount, pose);
        applyLens(CAMERA.mountNear, mount.fov, 0, true);
        return;
      }
      place(pose, followHeading, 0);
      camera.position.copy(pos);
      camera.lookAt(look);
      applyLens(CHASE_NEAR, CAMERA.fov, 0, true);
    },
    update(pose, dt) {
      // A bolted-on lens is placed outright: no damping, no lag, no follow heading. Shake
      // still applies — an impact rattles the mount as much as it rattles a chase camera.
      const mount = view === 'chase' ? null : CAMERA.mounts[view];
      if (mount) {
        placeMount(pose, mount);
        aimMount(mount, pose);
        // The position is placed outright every frame, so only the lens still has to be told
        // this is a cut: easing the FOV across a view change reads as a zoom, not a switch.
        const immediate = cut;
        cut = false;
        if (shakeAmp > 0.0005) {
          shakeT += dt * 40;
          camera.position.x += Math.sin(shakeT * 1.3) * shakeAmp;
          camera.position.y += Math.cos(shakeT * 1.7) * shakeAmp;
          shakeAmp = damp(shakeAmp, 0, CAMERA.shakeDecay, dt);
        }
        applyLens(CAMERA.mountNear, mount.fov + CAMERA.mountFovNitro * clamp01(pose.nitro), dt, immediate);
        return;
      }

      // Drag-look holds its angle while the pointer is down and for a moment after, then
      // eases back behind the car so you are never left driving sideways-on.
      if (dragging) {
        lookHold = CAMERA.dragHold;
      } else if (lookHold > 0) {
        lookHold = Math.max(0, lookHold - dt);
      } else if (lookYaw !== 0 || lookPitch !== 0) {
        lookYaw = damp(lookYaw, 0, CAMERA.dragRecenterDamping, dt);
        lookPitch = damp(lookPitch, 0, CAMERA.dragRecenterDamping, dt);
        if (Math.abs(lookYaw) < 1e-4 && Math.abs(lookPitch) < 1e-4) {
          lookYaw = 0;
          lookPitch = 0;
        }
      }

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
      if (cut) {
        // Just came back from a mount. Damping from there would drag the lens through the
        // bodywork on its way out, so the change of view is a cut, the same as leaving one.
        camera.position.copy(pos);
      } else {
        camera.position.x = damp(camera.position.x, pos.x, CAMERA.positionDamping, dt);
        camera.position.y = damp(camera.position.y, pos.y, CAMERA.positionDamping, dt);
        camera.position.z = damp(camera.position.z, pos.z, CAMERA.positionDamping, dt);
      }
      if (shakeAmp > 0.0005) {
        shakeT += dt * 40;
        camera.position.x += Math.sin(shakeT * 1.3) * shakeAmp;
        camera.position.y += Math.cos(shakeT * 1.7) * shakeAmp;
        shakeAmp = damp(shakeAmp, 0, CAMERA.shakeDecay, dt);
      }
      camera.lookAt(look);
      applyLens(CHASE_NEAR, CAMERA.fov + (CAMERA.fovNitro - CAMERA.fov) * clamp01(pose.nitro), dt, cut);
      cut = false;
    },
    shake(amount) {
      shakeAmp = Math.max(shakeAmp, amount);
    },
    look(dYaw, dPitch) {
      if (view !== 'chase') return;
      lookYaw = wrapAngle(lookYaw + dYaw);
      lookPitch = clamp(lookPitch + dPitch, CAMERA.dragPitchMin, CAMERA.dragPitchMax);
      lookHold = CAMERA.dragHold;
    },
    setDragging(active) {
      dragging = active;
      if (!active) lookHold = CAMERA.dragHold;
    },
    resize(a) {
      camera.aspect = a;
      camera.updateProjectionMatrix();
    },
    get view() {
      return view;
    },
    setView(next) {
      if (next === view) return;
      view = next;
      cut = true;
    },
    cycleView() {
      // `indexOf` is -1 for a view outside the cycle, which steps to entry 0 — the chase view.
      view = VIEW_ORDER[(VIEW_ORDER.indexOf(view) + 1) % VIEW_ORDER.length];
      cut = true;
      return view;
    },
  };
}
