import * as THREE from 'three';
import { VEHICLE } from '../../../config/tuning';
import { STOCK_LOADOUT, type CarLoadout } from '../../../core/loadout';
import { findColor } from '../../../content/carParts';
import { STOCK_WHEEL_LOOK, buildWheelGeometry, isRimDesign, type WheelLook } from './wheel';

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
 * without touching a save. Tuned by eye (`harness/b-wheels.html`) and by measurement
 * (`tests/wheelRig.test.ts`) against the wide-body arches (`parts/fenders.ts`: inner radius
 * wheelRadius + 0.07, 0.22 wide, centred at x = ±0.9, so the lip ends at |x| = 1.01):
 * - ride height −4 is slammed: 2 cm between the tyre's crown and the arch (whose seven-sided
 *   inner edge is at 0.39 m over the crown, not 0.40), which max camber and max width eat
 *   down to a few millimetres, never through. The skirts sit 3 cm off the road. +2 lifts 2 cm.
 * - camber: front 0..6 and rear 0..8 steps reach −6° and −8°, the stanced-JDM lean. The tilt
 *   is about the wheel centre, so the tread's inner edge dips up to ~2 cm into the road under
 *   the car, where nobody looks; lifting the wheel to hide that would push the outer crown
 *   through a slammed arch instead.
 * - track, OUT (+1..+4, 2 cm a step): +4 takes the front's outer face flush with the arch lip
 *   and the rear's (already 2 cm wider) a touch past it: poke. IN (−1, −2) is a small tuck,
 *   4 mm a step: the hull has no wheel wells (its side runs through the wheels at |x| ≈ 0.87
 *   front / 0.89 rear), so a wheel pulled further in hides its own rim face behind the body.
 * - width: the tyre grows OUTWARD (the carrier moves out by half the extra width, the inner
 *   face stays where it was), so a wide wheel fills the arch instead of the hull.
 * - wheel size trades sidewall for rim at a fixed outer radius (`VEHICLE.wheelRadius`).
 * The physics never sees any of it: nothing in `src/sim/` or `VEHICLE` reads a stance.
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

/** What one step of each stance setting is worth, tuned by eye (see the header). */
export const STANCE_STEP = {
  /** m per ride-height step (negative steps lower the body). */
  rideHeight: 0.01,
  /** rad of negative camber per step. */
  camber: THREE.MathUtils.degToRad(1),
  /** m per side per track step outward (positive steps). */
  track: 0.02,
  /** m per side per track step inward (negative steps): a tuck, kept small (see the header). */
  trackIn: 0.004,
  /** m of tyre width per width step. */
  width: 0.03,
  /** Rim radius over tyre radius per wheel-size step (stock 0.66). */
  rimRatio: 0.06,
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

/**
 * Steps to metres and radians. Stock gives exactly today's numbers. The half tracks are where
 * the wheel CENTRES stand, so they include the outward shift of a wider wheel.
 */
export function stanceParams(l: CarLoadout): StanceParams {
  const extraWidth = l.wheels.width * STANCE_STEP.width;
  const track = (steps: number): number => steps * (steps < 0 ? STANCE_STEP.trackIn : STANCE_STEP.track);
  return {
    rideHeight: l.stance.rideHeight * STANCE_STEP.rideHeight,
    camberFront: l.stance.camberFront * STANCE_STEP.camber,
    camberRear: l.stance.camberRear * STANCE_STEP.camber,
    frontHalfTrack: VEHICLE.trackWidth / 2 + track(l.stance.trackFront) + extraWidth / 2,
    rearHalfTrack: VEHICLE.trackWidth / 2 + 0.02 + track(l.stance.trackRear) + extraWidth / 2,
    wheelWidth: WHEEL_WIDTH + extraWidth,
  };
}

/**
 * What the wheel looks like: the rim design (unknown ids draw stock), the rim colour from the
 * palette (unknown colours draw graphite, the stock one) and the rim-to-tyre ratio.
 */
export function wheelLook(l: CarLoadout): WheelLook {
  const colour = findColor(l.wheels.rimColor);
  return {
    design: isRimDesign(l.wheels.rim) ? l.wheels.rim : STOCK_WHEEL_LOOK.design,
    rimColor: colour ? parseInt(colour.hex.slice(1), 16) : STOCK_WHEEL_LOOK.rimColor,
    rimRatio: STOCK_WHEEL_LOOK.rimRatio + l.wheels.size * STANCE_STEP.rimRatio,
  };
}

/** The wheel mesh for a loadout's wheel choice. Stock: today's five-spoke dish at today's width. */
export function buildLoadoutWheelGeometry(l: CarLoadout, segments = SEGMENTS): THREE.BufferGeometry {
  return buildWheelGeometry(VEHICLE.wheelRadius, stanceParams(l).wheelWidth, segments, wheelLook(l));
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

  /** Per wheel: the camber tilt, used only when `tilted` (upright is the common case: skip it). */
  const camber = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];
  const tilted = [false, false, false, false];
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
      tilted[i] = angle !== 0;
      camber[i].makeRotationZ(side * angle);
    }
    rideHeight = s.rideHeight;
  }

  const wheelMatrix = new THREE.Matrix4();
  function sync(): void {
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      w.steer.updateMatrix();
      w.spin.updateMatrix();
      if (tilted[i]) wheelMatrix.multiplyMatrices(w.steer.matrix, camber[i]).multiply(w.spin.matrix);
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
