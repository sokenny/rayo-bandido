import * as THREE from 'three';
import { VEHICLE } from '../../../config/tuning';
import { STOCK_LOADOUT, type CarLoadout } from '../../../core/loadout';
import { buildWheelGeometry } from './wheel';

/**
 * THE WHEELS AND THE STANCE: the four wheels as one `InstancedMesh`, the transform carriers the
 * simulation's sync writes into, and the visual-only stance (ride height, camber, track, wheel
 * width). OWNED BY agent B (`docs/GARAGE_PLAN.md` §2.7, Ola 1). Extracted from `carVisual.ts`.
 *
 * CONTRACT (unchanged from `CarVisual`)
 * - `wheels` are ordered [front-left, front-right, rear-left, rear-right], each a `steer`
 *   carrier on `root` with a `spin` child. `src/render/sync.ts` writes `steer.rotation.y` (front
 *   only) and `spin.rotation.x`; `spin.parent === steer` always (`tests/vehicleVisual.test.ts`).
 * - `steer.position.y === VEHICLE.wheelRadius`. The tyre's outer radius never changes with any
 *   option: a cosmetic never touches `VEHICLE`, and the car must still sit on the road.
 * - `sync()` runs once per frame after the sync and allocates nothing: it bakes, per wheel,
 *   `steer.matrix · camber · spin.matrix` into the instance matrix. Camber is NOT a node in the
 *   carrier chain — the chain stays steer → spin — it is a fixed tilt about the car's length
 *   multiplied in between, identity (and skipped) at 0.
 * - `rideHeight` (m, negative = lower) is read by `CarVisual.update` and added to the sprung
 *   body's `chassis.position.y`. The wheels themselves never move up or down.
 * - `applyLoadout(loadout)` is workshop-time: repositions the carriers, recomputes the camber
 *   tilts and rebuilds the wheel geometry when the wheel choice changed (disposing the old one).
 *
 * WHAT A STEP MEANS lives here (`STANCE_STEP`), not in the loadout, so a step can be retuned
 * without touching a save. WAVE 0 STATE: ride height, camber, track and width steps are
 * implemented with first-guess sizes; rim designs, rim colour and wheel size (rim vs sidewall)
 * are agent B's — `buildLoadoutWheelGeometry` ignores them until then.
 */
export interface WheelRig {
  readonly mesh: THREE.InstancedMesh;
  readonly wheels: Array<{ steer: THREE.Object3D; spin: THREE.Object3D }>;
  /** Metres added to the chassis' height; 0 for stock. */
  readonly rideHeight: number;
  sync(): void;
  applyLoadout(loadout: CarLoadout): void;
  dispose(): void;
}

/** Today's tyre width (m). */
export const WHEEL_WIDTH = 0.26;
const SEGMENTS = 16;

/** What one step of each stance setting is worth. First guesses; agent B tunes by eye. */
export const STANCE_STEP = {
  /** m per ride-height step (negative steps lower the body). */
  rideHeight: 0.012,
  /** rad of negative camber per step. */
  camber: THREE.MathUtils.degToRad(1.5),
  /** m per side per track step. */
  track: 0.012,
  /** m of tyre width per width step. */
  width: 0.025,
} as const;

/** The stance as the renderer uses it, in metres and radians. */
export interface StanceParams {
  rideHeight: number;
  camberFront: number;
  camberRear: number;
  frontHalfTrack: number;
  rearHalfTrack: number;
  wheelWidth: number;
}

/** Steps to metres and radians. Stock gives exactly today's numbers. */
export function stanceParams(l: CarLoadout): StanceParams {
  return {
    rideHeight: l.stance.rideHeight * STANCE_STEP.rideHeight,
    camberFront: l.stance.camberFront * STANCE_STEP.camber,
    camberRear: l.stance.camberRear * STANCE_STEP.camber,
    frontHalfTrack: VEHICLE.trackWidth / 2 + l.stance.trackFront * STANCE_STEP.track,
    rearHalfTrack: VEHICLE.trackWidth / 2 + 0.02 + l.stance.trackRear * STANCE_STEP.track,
    wheelWidth: WHEEL_WIDTH + l.wheels.width * STANCE_STEP.width,
  };
}

/**
 * The wheel mesh for a loadout's wheel choice. Stock: today's five-spoke dish at today's width.
 * Agent B adds rim designs (`l.wheels.rim`), rim colour and the size step here or in `wheel.ts`.
 */
export function buildLoadoutWheelGeometry(l: CarLoadout, segments = SEGMENTS): THREE.BufferGeometry {
  return buildWheelGeometry(VEHICLE.wheelRadius, stanceParams(l).wheelWidth, segments);
}

/** What in a loadout changes the wheel GEOMETRY (as opposed to where the wheels stand). */
function wheelKey(l: CarLoadout): string {
  return `${l.wheels.rim}|${l.wheels.rimColor}|${l.wheels.size}|${l.wheels.width}`;
}

export function createWheelRig(root: THREE.Object3D, loadout: CarLoadout = STOCK_LOADOUT): WheelRig {
  let key = wheelKey(loadout);
  const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.45 });
  const mesh = new THREE.InstancedMesh(buildLoadoutWheelGeometry(loadout), wheelMat, 4);
  mesh.name = 'player-car-wheels';
  root.add(mesh);

  const wheels: Array<{ steer: THREE.Object3D; spin: THREE.Object3D }> = [];
  for (let i = 0; i < 4; i++) {
    const steer = new THREE.Object3D();
    const spin = new THREE.Object3D();
    steer.add(spin);
    root.add(steer);
    wheels.push({ steer, spin });
  }

  /** Per wheel: the camber tilt, or null when upright (the common case: skip the multiply). */
  const camber: Array<THREE.Matrix4 | null> = [null, null, null, null];
  let rideHeight = 0;

  function place(l: CarLoadout): void {
    const s = stanceParams(l);
    const halfBase = VEHICLE.wheelbase / 2;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const side = i % 2 === 0 ? -1 : 1; // left wheels are at -X
      const halfTrack = front ? s.frontHalfTrack : s.rearHalfTrack;
      wheels[i].steer.position.set(side * halfTrack, VEHICLE.wheelRadius, front ? -halfBase : halfBase);
      // Negative camber: the top of the wheel leans in toward the car. For a right wheel (+X)
      // that is a positive rotation about Z (+Y toward -X), mirrored for the left.
      const angle = front ? s.camberFront : s.camberRear;
      camber[i] = angle === 0 ? null : new THREE.Matrix4().makeRotationZ(side * angle);
    }
    rideHeight = s.rideHeight;
  }

  const wheelMatrix = new THREE.Matrix4();
  function sync(): void {
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      w.steer.updateMatrix();
      w.spin.updateMatrix();
      const tilt = camber[i];
      if (tilt) wheelMatrix.multiplyMatrices(w.steer.matrix, tilt).multiply(w.spin.matrix);
      else wheelMatrix.multiplyMatrices(w.steer.matrix, w.spin.matrix);
      mesh.setMatrixAt(i, wheelMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  place(loadout);
  sync();
  mesh.computeBoundingSphere();

  return {
    mesh,
    wheels,
    get rideHeight() {
      return rideHeight;
    },
    sync,
    applyLoadout(l) {
      place(l);
      const next = wheelKey(l);
      if (next !== key) {
        key = next;
        const old = mesh.geometry;
        mesh.geometry = buildLoadoutWheelGeometry(l);
        old.dispose();
      }
      sync();
      mesh.computeBoundingSphere();
    },
    dispose() {
      mesh.geometry.dispose();
      wheelMat.dispose();
      mesh.dispose();
    },
  };
}
