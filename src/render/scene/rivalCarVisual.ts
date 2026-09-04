import * as THREE from 'three';
import type { RivalCar } from '../../core/types';
import { VEHICLE } from '../../config/tuning';
import { slotColor } from '../../core/playerColors';
import { buildBodyGeometry, buildGlassGeometry, buildMarkerGeometry, buildTailGeometry, tintBody } from './carVisual';
import { createBodyAttitude } from './bodyAttitude';
import { buildWheelGeometry } from './vehicles/wheel';

/**
 * Another player's car.
 *
 * It is the same coupe as the player's — same hull, same glass, same tail lights, built from
 * the same functions in `carVisual.ts` — in that player's slot colour, and cut down to the
 * five draw calls that survive being looked at from a car's length back: body, glass, tails,
 * a colour marker, and the wheels. What it drops is everything that only reads on your OWN
 * car and only from the chase camera: the head lights pointing away from you, the reverse
 * lamps, the exhaust flame, the ground light pool. Three rivals therefore cost 15 draw calls
 * instead of 27, which is what keeps a four-car grid inside the same budget as single player.
 *
 * The marker is the part that is not on the player's car at all: a rocker strip and a low
 * roof beacon in the slot colour, additively blended so they read as light. In a dark city
 * at speed that colour is how you tell who just went past.
 *
 * CONTRACT
 * - `root` origin on the ground at the centre of the wheelbase, nose toward local -Z, exactly
 *   like `CarVisual`. `sync(rival)` writes position and rotation, so nothing else has to
 *   know the heading convention.
 * - Geometries and base materials are shared between every rival and released once with
 *   `disposeRivalCarResources()`, the same pattern the electric cars use.
 */
export interface RivalCarVisual {
  root: THREE.Group;
  /** Slot this car belongs to, which fixes its colour. */
  readonly slot: number;
  /** Take one interpolated rival: pose, wheels, lights, and whether it is here at all. */
  sync(rival: RivalCar): void;
  /** Per-frame animation: body attitude and the beacon's flicker. */
  update(frameDt: number, time: number): void;
  dispose(): void;
}

const WHEEL_WIDTH = 0.26;
const HALF_TRACK = VEHICLE.trackWidth / 2;
const HALF_BASE = VEHICLE.wheelbase / 2;

const TAIL_RED = new THREE.Color(0xff1a2e);
const TAIL_MAGENTA = new THREE.Color(0xff33d6);

interface SharedResources {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
  marker: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  bodyMat: THREE.MeshStandardMaterial;
  glassMat: THREE.MeshStandardMaterial;
  tailMat: THREE.MeshStandardMaterial;
  markerMat: THREE.MeshBasicMaterial;
  wheelMat: THREE.MeshStandardMaterial;
}

let shared: SharedResources | null = null;

function getShared(): SharedResources {
  if (!shared) {
    shared = {
      body: buildBodyGeometry(),
      glass: buildGlassGeometry(),
      tail: buildTailGeometry(),
      marker: buildMarkerGeometry(),
      wheel: buildWheelGeometry(VEHICLE.wheelRadius, WHEEL_WIDTH, 12),
      // No livery map: a rival is identified by its slot colour, and a texture that reads
      // only from a metre away is not worth the upload for a car you see from behind.
      bodyMat: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.42, metalness: 0.26 }),
      glassMat: new THREE.MeshStandardMaterial({
        color: 0x0b1c26,
        roughness: 0.06,
        metalness: 0.55,
        transparent: true,
        opacity: 0.68,
        vertexColors: true,
        side: THREE.DoubleSide,
      }),
      tailMat: new THREE.MeshStandardMaterial({
        color: 0x180205,
        emissive: 0xff1a2e,
        emissiveIntensity: 0.9,
        vertexColors: true,
        roughness: 0.3,
      }),
      markerMat: new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      wheelMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.45 }),
    };
  }
  return shared;
}

/** Release the geometries and base materials every rival shares. Call once, on teardown. */
export function disposeRivalCarResources(): void {
  if (!shared) return;
  shared.body.dispose();
  shared.glass.dispose();
  shared.tail.dispose();
  shared.marker.dispose();
  shared.wheel.dispose();
  shared.bodyMat.dispose();
  shared.glassMat.dispose();
  shared.tailMat.dispose();
  shared.markerMat.dispose();
  shared.wheelMat.dispose();
  shared = null;
}

export function createRivalCarVisual(slot: number): RivalCarVisual {
  const s = getShared();
  const root = new THREE.Group();
  root.name = `rival-car-${slot}`;
  root.visible = false;

  const chassis = new THREE.Group();
  root.add(chassis);
  const attitude = createBodyAttitude();

  const colour = new THREE.Color(slotColor(slot));

  const bodyMat = s.bodyMat.clone();
  // The same paint the player's own car gets in a match, so the colour reads the same
  // whichever screen it is on.
  tintBody(bodyMat, colour);
  const glassMat = s.glassMat.clone();
  const tailMat = s.tailMat.clone();
  const markerMat = s.markerMat.clone();
  const wheelMat = s.wheelMat.clone();

  const body = new THREE.Mesh(s.body, bodyMat);
  chassis.add(body);
  const glass = new THREE.Mesh(s.glass, glassMat);
  chassis.add(glass);
  const tail = new THREE.Mesh(s.tail, tailMat);
  chassis.add(tail);
  const marker = new THREE.Mesh(s.marker, markerMat);
  marker.renderOrder = 2;
  chassis.add(marker);
  markerMat.color.copy(colour);

  const wheels = new THREE.InstancedMesh(s.wheel, wheelMat, 4);
  wheels.name = `rival-car-${slot}-wheels`;
  root.add(wheels);

  const wheelPositions: Array<[number, number]> = [
    [-HALF_TRACK, -HALF_BASE],
    [HALF_TRACK, -HALF_BASE],
    [-HALF_TRACK - 0.02, HALF_BASE],
    [HALF_TRACK + 0.02, HALF_BASE],
  ];
  const carriers: Array<{ steer: THREE.Object3D; spin: THREE.Object3D }> = [];
  for (const [x, z] of wheelPositions) {
    const steer = new THREE.Object3D();
    steer.position.set(x, VEHICLE.wheelRadius, z);
    const spin = new THREE.Object3D();
    steer.add(spin);
    root.add(steer);
    carriers.push({ steer, spin });
  }

  const wheelMatrix = new THREE.Matrix4();
  function syncWheelInstances(): void {
    for (let i = 0; i < carriers.length; i++) {
      const w = carriers[i];
      w.steer.updateMatrix();
      w.spin.updateMatrix();
      wheelMatrix.multiplyMatrices(w.steer.matrix, w.spin.matrix);
      wheels.setMatrixAt(i, wheelMatrix);
    }
    wheels.instanceMatrix.needsUpdate = true;
  }
  syncWheelInstances();
  wheels.computeBoundingSphere();

  let nitro = 0;
  let charge = 0;
  let braking = false;

  return {
    root,
    slot,

    sync(rival) {
      root.visible = rival.present;
      if (!rival.present) return;
      root.position.set(rival.x, 0, rival.z);
      // The one heading mapping outside `src/render/sync.ts` follows the same rule it does.
      root.rotation.y = -rival.heading;
      for (let i = 0; i < carriers.length; i++) {
        carriers[i].steer.rotation.y = i < 2 ? -rival.steerAngle : 0;
        carriers[i].spin.rotation.x = -rival.wheelSpin;
      }
      attitude.setAccel(rival.latAccel, rival.longAccel);
      nitro = rival.nitro ? 1 : 0;
      charge = rival.charge;
      braking = rival.braking;

      // Brake lights and the boost tint, read straight off the flags on the wire: the two
      // things you actually watch on the car in front.
      let intensity = 0.85 + nitro * 1.9;
      if (braking) intensity = Math.max(intensity, 3.4);
      tailMat.emissiveIntensity = intensity;
      tailMat.emissive.lerpColors(TAIL_RED, TAIL_MAGENTA, braking ? 0 : Math.min(1, nitro * 0.85));
      // The marker brightens with their lightning charge, so a rival about to fire shows it.
      markerMat.opacity = 0.62 + charge * 0.38 + nitro * 0.2;
    },

    update(frameDt) {
      if (!root.visible) return;
      attitude.update(frameDt);
      chassis.rotation.z = attitude.roll;
      chassis.rotation.x = attitude.pitch;
      syncWheelInstances();
    },

    dispose() {
      bodyMat.dispose();
      glassMat.dispose();
      tailMat.dispose();
      markerMat.dispose();
      wheelMat.dispose();
      wheels.dispose();
    },
  };
}
