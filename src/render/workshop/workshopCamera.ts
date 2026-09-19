import * as THREE from 'three';
import { CAMERA_SHOTS, categoryDef, type CameraShot, type CameraShotKey, type CategoryId } from '../../content/carParts';

/**
 * THE WORKSHOP'S CAMERA: an orbit rig round the car on the turntable that travels to whatever
 * part the player is choosing (`docs/GARAGE_PLAN.md` §2.5), the way NFSU2's garage does.
 *
 * WHAT IT DOES
 * - Each category names a shot (`CAMERA_SHOTS[categoryDef(cat).cameraShot]`,
 *   `src/content/workshopShots.ts`): spherical coordinates round a target on the car, in the
 *   CAR's frame. The rig eases to it — yaw by the shortest arc — with a critically damped
 *   spring on every channel (yaw, pitch, distance, target height and length, field of view), so
 *   a change of category starts smoothly, travels, and lands in about 0.6 s.
 * - It is never still: a slow sway on yaw, pitch and distance, like a camera operator
 *   breathing. Smaller while the player drags.
 * - Free look: mouse drag, touch or the right stick turn it round the car and tilt it, the wheel
 *   or a pinch zooms. Three seconds after the last touch it eases back to the shot.
 * - It never goes below the floor, through a wall, or into the car: pitch is lifted until the
 *   lens clears the floor, distance is cut at the room's walls and pushed out of the car's box.
 * - A shot with `orbitSpeed` is taken with the camera anchored in the ROOM while the turntable
 *   turns the car under it (the showroom spins the table: `orbitSpeed` is read from here). Every
 *   other shot rides with the car, so whatever angle the table stopped at, bumper shots frame
 *   the bumper.
 * - `intro()` swoops in from high and wide to the current shot; `outro()` pulls back and up
 *   for the fade out.
 * - The picture is shifted with a lens offset (`framing`), not by aiming off the car, so the car
 *   sits in the part of the screen the workshop UI leaves free (carousel on top, rail on the
 *   left, buttons at the bottom) without the orbit going lopsided.
 *
 * ZERO ALLOCATIONS PER FRAME: all state is numbers and preallocated vectors.
 *
 * FRAMES. Car frame as in `workshopShots.ts`: nose toward -Z, +X its right, y = 0 the ground under
 * the wheels. The car sits on the turntable at world (0, originY, 0) turned by `turntableYaw`
 * about +Y (three.js `rotation.y`). A camera yaw `a` in the car's frame is yaw `a - turntableYaw`
 * in the world's.
 */

export interface WorkshopCameraInput {
  /** Radians to turn round the car THIS FRAME, positive = the camera moves toward the car's right. (Mouse: px × ~0.006; stick: axis × ~2.2 × dt.) */
  dragYaw: number;
  /** Radians to tilt THIS FRAME, positive = look down more steeply. */
  dragPitch: number;
  /** Zoom steps THIS FRAME, positive = closer (a wheel notch ≈ 1, a pinch ≈ its scale's log × 10). */
  zoom: number;
  /** True while a pointer is held or the stick is off-centre: holds off the ease back to the shot. */
  dragging: boolean;
}

/** Where the car is this frame: the turntable top's height and the table's turn. */
export interface WorkshopRigState {
  originY: number;
  turntableYaw: number;
}

/** The room the lens must stay inside, world metres. */
export interface WorkshopBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Lowest the lens may go, above the floor (the floor is y = 0). */
  minY: number;
  maxY: number;
}

export interface WorkshopCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** The shot being eased to (what `setShot`/`setCategory` last chose). */
  readonly shot: Readonly<CameraShot>;
  readonly shotKey: CameraShotKey | null;
  /** The current shot's `orbitSpeed`, 0 if none: how fast the showroom should turn the table. */
  readonly orbitSpeed: number;
  /** Ease to `shot` (or the named one). `immediate` jumps there. Allocation-free. */
  setShot(shot: CameraShotKey | CameraShot, immediate?: boolean): void;
  /** Ease to the shot this workshop category names. */
  setCategory(category: CategoryId): void;
  /** A swoop from high and wide down onto the current shot, ~1.8 s. Call right after the first `setShot`/`setCategory`. */
  intro(): void;
  /** Pull back and up, for the exit fade. The next `setShot`/`setCategory`/`intro` cancels it. */
  outro(): void;
  /** Drop the free-look offsets and land on the shot now. */
  snap(): void;
  /**
   * Lens shift, in NDC (−1..1 across the screen): where the car's target lands. `x` > 0 moves
   * the picture right, `y` < 0 moves it down. Default leaves room for the workshop UI.
   */
  setFraming(x: number, y: number): void;
  /** Advance by `dt` seconds and write the camera. */
  update(dt: number, input: WorkshopCameraInput, rig: WorkshopRigState): void;
  /** Read-outs for the harness and the tests (car-frame yaw, world yaw). */
  readonly state: Readonly<{ carYaw: number; worldYaw: number; pitch: number; distance: number; fov: number; idle: number }>;
}

export interface WorkshopCameraOptions {
  bounds: WorkshopBounds;
  /**
   * The car's box in its own frame, for keeping the lens out of it: half width, height, half
   * length (m). Defaults to the coupe with its wide-body and wing.
   */
  carBox?: { halfX: number; height: number; halfZ: number };
}

/** Time for the spring to settle a category change (smooth time; lands in ≈ 3.5×). */
const SMOOTH = 0.17;
/** The intro's much longer glide. */
const SMOOTH_INTRO = 0.5;
const INTRO_S = 2.1;
/** How long without input before free look eases back to the shot, and how fast. */
const IDLE_RETURN_S = 3;
const SMOOTH_RETURN = 0.55;
/** Free-look limits. */
const PITCH_MIN = -0.18;
const PITCH_MAX = 1.0;
const ZOOM_STEP = 0.09;
const ZOOM_IN_LIMIT = Math.log(0.5);
const ZOOM_OUT_LIMIT = Math.log(2.2);
/** Clearance kept between the lens and the car's box, and the walls. */
const CAR_CLEARANCE = 0.3;
/** Breathing: amplitude (rad, rad, fraction) and angular speed (rad/s). */
const SWAY = { yaw: 0.022, yawW: 0.21, pitch: 0.011, pitchW: 0.29, dist: 0.014, distW: 0.17 };
/** Default lens shift: the car a little right of centre (the rail is on the left) and below it (the carousel is on top). */
const FRAMING = { x: 0.07, y: -0.14 };
/** Narrow screens keep the car's length in frame: the vertical fov widens below this aspect. */
const REFERENCE_ASPECT = 16 / 9;
const FOV_MAX = 78;

const TAU = Math.PI * 2;
function wrapPi(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/**
 * Critically damped spring toward `target` (Unity's SmoothDamp): smooth start, no overshoot,
 * frame-rate independent. Writes the new velocity into `vel[i]` and returns the new value.
 */
function damp(current: number, target: number, vel: Float64Array, i: number, smooth: number, dt: number): number {
  const omega = 2 / Math.max(1e-4, smooth);
  const x = omega * dt;
  const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (vel[i] + omega * change) * dt;
  vel[i] = (vel[i] - omega * temp) * k;
  return target + (change + temp) * k;
}

/** Distance from `(0, ty, tz)` along `(dx, dy, dz)` to the surface of the car's box, 0 if outside. */
export function carBoxExit(ty: number, tz: number, dx: number, dy: number, dz: number, box: { halfX: number; height: number; halfZ: number }): number {
  // Slab test for a point that may be inside: the ray leaves at the nearest far-plane crossing.
  const inside = ty >= 0 && ty <= box.height && Math.abs(tz) <= box.halfZ;
  let t = Infinity;
  if (Math.abs(dx) > 1e-6) t = Math.min(t, box.halfX / Math.abs(dx));
  if (dy > 1e-6) t = Math.min(t, (box.height - ty) / dy);
  else if (dy < -1e-6) t = Math.min(t, ty / -dy);
  if (dz > 1e-6) t = Math.min(t, (box.halfZ - tz) / dz);
  else if (dz < -1e-6) t = Math.min(t, (box.halfZ + tz) / -dz);
  return inside && Number.isFinite(t) ? Math.max(0, t) : 0;
}

export function createWorkshopCamera(options: WorkshopCameraOptions): WorkshopCamera {
  const bounds = options.bounds;
  const carBox = options.carBox ?? { halfX: 1.05, height: 1.42, halfZ: 2.3 };
  const camera = new THREE.PerspectiveCamera(42, REFERENCE_ASPECT, 0.05, 80);

  /** The shot being eased to, copied so a caller's object is never held. */
  const shot: CameraShot = { ...CAMERA_SHOTS.overview };
  let shotKey: CameraShotKey | null = 'overview';
  /** For an orbit shot, the table's turn when it began: the camera is anchored to the room from it. */
  let anchor = 0;
  let anchored = false;

  // Channels: 0 world yaw, 1 pitch, 2 distance, 3 target y, 4 target z (car frame), 5 fov.
  const cur = new Float64Array(6);
  const vel = new Float64Array(6);
  const tgt = new Float64Array(6);
  // Free look: yaw, pitch, log-distance. And their spring velocities.
  const off = new Float64Array(3);
  const offVel = new Float64Array(3);
  let idle = IDLE_RETURN_S;
  let clock = 0;
  let introLeft = 0;
  let outro = false;
  let initialised = false;
  let pendingSnap = true;
  let lastTurntable = 0;
  const framing = { x: FRAMING.x, y: FRAMING.y };

  const target = new THREE.Vector3();
  const readout = { carYaw: 0, worldYaw: 0, pitch: 0, distance: 0, fov: 42, idle: 0 };

  function copyShot(s: Readonly<CameraShot>): void {
    shot.yaw = s.yaw;
    shot.pitch = s.pitch;
    shot.distance = s.distance;
    shot.targetY = s.targetY;
    shot.targetZ = s.targetZ;
    shot.fov = s.fov;
    shot.orbitSpeed = s.orbitSpeed;
  }

  function setShot(next: CameraShotKey | CameraShot, immediate = false): void {
    if (typeof next === 'string') {
      shotKey = next;
      copyShot(CAMERA_SHOTS[next]);
    } else {
      shotKey = null;
      copyShot(next);
    }
    outro = false;
    anchored = !!shot.orbitSpeed;
    anchor = lastTurntable;
    if (immediate) pendingSnap = true;
  }

  /** Where the rig wants to be this frame, from the shot and the table. */
  function aim(turntableYaw: number): void {
    const tableYaw = anchored ? anchor : turntableYaw;
    tgt[0] = shot.yaw - tableYaw;
    tgt[1] = shot.pitch;
    tgt[2] = shot.distance;
    tgt[3] = shot.targetY;
    tgt[4] = shot.targetZ;
    tgt[5] = shot.fov;
    if (outro) {
      tgt[0] += 0.5;
      tgt[1] = Math.max(shot.pitch, 0.2) + 0.12;
      tgt[2] = shot.distance * 1.6 + 1.5;
      tgt[3] = 0.7;
      tgt[4] = 0;
      tgt[5] = shot.fov + 8;
    }
  }

  function snapTo(): void {
    for (let i = 0; i < 6; i++) {
      cur[i] = tgt[i];
      vel[i] = 0;
    }
    off[0] = off[1] = off[2] = 0;
    offVel[0] = offVel[1] = offVel[2] = 0;
  }

  function update(dt: number, input: WorkshopCameraInput, rig: WorkshopRigState): void {
    dt = dt > 0.1 ? 0.1 : dt < 0 ? 0 : dt;
    clock += dt;
    lastTurntable = rig.turntableYaw;
    if (!initialised) {
      anchor = rig.turntableYaw;
      initialised = true;
    }
    aim(rig.turntableYaw);
    if (pendingSnap) {
      snapTo();
      pendingSnap = false;
    }

    // Yaw goes the short way round: the target is unwrapped to within half a turn of where we are.
    tgt[0] = cur[0] + wrapPi(tgt[0] - cur[0]);
    const smooth = introLeft > 0 ? SMOOTH_INTRO : SMOOTH;
    if (introLeft > 0) introLeft -= dt;
    for (let i = 0; i < 6; i++) cur[i] = damp(cur[i], tgt[i], vel, i, smooth, dt);
    // Keep the world yaw bounded so it never loses precision over a long session.
    if (cur[0] > Math.PI * 8 || cur[0] < -Math.PI * 8) cur[0] = wrapPi(cur[0]);

    // Free look.
    const touched = input.dragging || input.dragYaw !== 0 || input.dragPitch !== 0 || input.zoom !== 0;
    if (touched) {
      idle = 0;
      off[0] = wrapPi(off[0] + input.dragYaw);
      off[1] += input.dragPitch;
      off[2] -= input.zoom * ZOOM_STEP;
      offVel[0] = offVel[1] = offVel[2] = 0;
    } else {
      idle += dt;
      if (idle > IDLE_RETURN_S) {
        for (let i = 0; i < 3; i++) off[i] = damp(off[i], 0, offVel, i, SMOOTH_RETURN, dt);
      }
    }
    // Free look is bounded where it is stored, so dragging past a limit never winds up slack.
    const basePitch = cur[1];
    if (basePitch + off[1] > PITCH_MAX) off[1] = PITCH_MAX - basePitch;
    if (basePitch + off[1] < PITCH_MIN) off[1] = PITCH_MIN - basePitch;
    if (off[2] < ZOOM_IN_LIMIT) off[2] = ZOOM_IN_LIMIT;
    if (off[2] > ZOOM_OUT_LIMIT) off[2] = ZOOM_OUT_LIMIT;

    // Breathing, damped while the player has hold of it.
    const calm = idle < 1 ? 0.35 : 1;
    const swayYaw = SWAY.yaw * calm * Math.sin(clock * SWAY.yawW);
    const swayPitch = SWAY.pitch * calm * Math.sin(clock * SWAY.pitchW + 1.3);
    const swayDist = 1 + SWAY.dist * calm * Math.sin(clock * SWAY.distW + 2.1);

    const worldYaw = cur[0] + off[0] + swayYaw;
    let pitch = cur[1] + off[1] + swayPitch;
    let dist = cur[2] * Math.exp(off[2]) * swayDist;
    const tY = cur[3];
    const tZ = cur[4];
    const table = rig.turntableYaw;

    // The target, carried round by the table.
    const sT = Math.sin(table);
    const cT = Math.cos(table);
    target.set(tZ * sT, rig.originY + tY, tZ * cT);

    for (let pass = 0; pass < 2; pass++) {
      // Not below the floor: lift the pitch until the lens clears it.
      const lowest = (bounds.minY - target.y) / Math.max(0.05, dist);
      if (lowest > -1 && lowest < 1 && Math.sin(pitch) < lowest) pitch = Math.asin(lowest);
      if (pitch > PITCH_MAX) pitch = PITCH_MAX;
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const dx = Math.sin(worldYaw) * cp;
      const dz = -Math.cos(worldYaw) * cp;
      // Through the walls and the ceiling: cut the distance where the ray leaves the room.
      let far = Infinity;
      if (dx > 1e-6) far = Math.min(far, (bounds.maxX - target.x) / dx);
      else if (dx < -1e-6) far = Math.min(far, (bounds.minX - target.x) / dx);
      if (dz > 1e-6) far = Math.min(far, (bounds.maxZ - target.z) / dz);
      else if (dz < -1e-6) far = Math.min(far, (bounds.minZ - target.z) / dz);
      if (sp > 1e-6) far = Math.min(far, (bounds.maxY - target.y) / sp);
      // Out of the car: in its own frame, the ray from the target leaves the box here.
      const carYaw = worldYaw + table;
      const near = carBoxExit(tY, tZ, Math.sin(carYaw) * cp, sp, -Math.cos(carYaw) * cp, carBox) + CAR_CLEARANCE;
      if (dist < near) dist = near;
      if (dist > far) dist = far;
    }
    // The last word is the floor's: pushing out of the car may have lowered a downward look.
    {
      const lowest = (bounds.minY - target.y) / Math.max(0.05, dist);
      if (lowest > -1 && lowest < 1 && Math.sin(pitch) < lowest) pitch = Math.asin(lowest);
    }

    // Field of view: the shot's, widened on a screen narrower than 16:9 so the car's length still fits.
    let fov = cur[5];
    const aspect = camera.aspect > 0 ? camera.aspect : REFERENCE_ASPECT;
    if (aspect < REFERENCE_ASPECT) {
      const t = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * (REFERENCE_ASPECT / aspect);
      fov = Math.min(FOV_MAX, THREE.MathUtils.radToDeg(2 * Math.atan(t)));
    }

    const cp = Math.cos(pitch);
    camera.position.set(target.x + dist * Math.sin(worldYaw) * cp, target.y + dist * Math.sin(pitch), target.z - dist * Math.cos(worldYaw) * cp);
    camera.lookAt(target);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    // Lens shift (see `setFraming`): adding d to the projection's third column moves the picture by -d.
    const e = camera.projectionMatrix.elements;
    e[8] -= framing.x;
    e[9] -= framing.y;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld();

    readout.carYaw = wrapPi(worldYaw + table);
    readout.worldYaw = worldYaw;
    readout.pitch = pitch;
    readout.distance = dist;
    readout.fov = fov;
    readout.idle = idle;
  }

  return {
    camera,
    get shot() {
      return shot;
    },
    get shotKey() {
      return shotKey;
    },
    get orbitSpeed() {
      return outro ? 0 : (shot.orbitSpeed ?? 0);
    },
    get state() {
      return readout;
    },
    setShot,
    setCategory(category) {
      setShot(categoryDef(category).cameraShot);
    },
    intro() {
      outro = false;
      aim(lastTurntable);
      snapTo();
      // Start high, wide and a quarter turn round, then glide down onto the shot.
      cur[0] = tgt[0] + 1.15;
      cur[1] = Math.min(PITCH_MAX, Math.max(shot.pitch, 0.3) + 0.38);
      cur[2] = Math.max(shot.distance, 5) * 1.75;
      cur[3] = 0.8;
      cur[4] = 0;
      cur[5] = shot.fov + 12;
      introLeft = INTRO_S;
      pendingSnap = false;
    },
    outro() {
      outro = true;
      introLeft = 0;
    },
    snap() {
      pendingSnap = true;
      idle = IDLE_RETURN_S;
    },
    setFraming(x, y) {
      framing.x = x;
      framing.y = y;
    },
    update,
  };
}
