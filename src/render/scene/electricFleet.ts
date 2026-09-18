import * as THREE from 'three';
import type { TargetStatus } from '../../core/types';
import { RUSH } from '../../config/tuning';
import {
  BEACON_DIM,
  BEACON_FLASH,
  BEACON_OFFSET,
  DEAD_BODY_METALNESS,
  DEAD_BODY_ROUGHNESS,
  ELECTRIC_CASCADE_END,
  ELECTRIC_RUSH_RING,
  createElectricCarVisual,
  electricBeaconFlash,
  electricBodyPaint,
  electricChassisPose,
  electricDeadPaint,
  electricFleetKit,
  electricRushRingOpacity,
  electricRushRingSpin,
  type ElectricCarVisual,
  type ElectricChassisPose,
} from './electricCarVisual';

/**
 * The whole electric fleet, drawn as a handful of instanced meshes instead of 614 scene graphs.
 *
 * WHY. Each car used to be its own group of six objects and four cloned materials: ~3,700 of the
 * metro's ~5,300 objects and ~860 of its ~1,200 draws, and the frame was main-thread bound on
 * walking and drawing them (docs/PROGRESS.md, "Metro frame profiled", 2026-09-16).
 *
 * HOW IT STAYS THE SAME CAR. The look of `electricCarVisual.ts` is its contract, and nothing here
 * re-implements the part of it that moves:
 * - A car in service and a SETTLED wreck are both constant looks: one paint (instance colour),
 *   one roughness, bars on or dead, a beacon in its flash or between flashes. So each look is a
 *   material of its own, with the exact parameters the per-car visual would have reached, and
 *   there is no shader patching at all — three's own instancing chunks do the rest.
 * - A car in the POWER-DOWN CASCADE (hit less than `ELECTRIC_CASCADE_END` seconds ago; a few at
 *   a time) is drawn by the per-car visual itself, created at the hit and released once the
 *   wreck has settled. The cascade is therefore identical by construction.
 * - The Rush ring is a small pool of plain meshes: at most `RUSH.targets.maxMarked` are shown.
 *
 * Draws: body (in service / wreck), bars (lit / dead), beacon (flash / dim), plus the cascades and
 * the rings. Instances are culled against the camera per car on the CPU and packed at the front,
 * so what the GPU is sent is what is on screen; there is still NO culling by distance (see
 * `syncFleet` in `sync.ts`).
 */
export interface ElectricFleet {
  root: THREE.Group;
  /** Stage car `index` for this frame. `rotY` is Three's yaw (`-heading`). */
  place(
    index: number,
    x: number,
    y: number,
    z: number,
    rotY: number,
    status: TargetStatus,
    timeSinceHit: number,
    rushMarked: boolean,
  ): void;
  /** After the camera has moved for the frame: cull, pack and upload. */
  commit(camera: THREE.Camera, time: number, frameDt: number): void;
  /** Per-instance frustum culling (on by default). Off draws every car every frame. */
  cull: boolean;
  readonly stats: ElectricFleetStats;
  dispose(): void;
}

export interface ElectricFleetStats {
  cars: number;
  /** Instances sent to the GPU this frame, per look. */
  alive: number;
  dead: number;
  beaconsFlash: number;
  beaconsDim: number;
  /** Cars playing the power-down cascade on their own visual. */
  cascading: number;
  rings: number;
  /** Cars left out by the frustum test this frame. */
  culled: number;
}

const _root = new THREE.Matrix4();
const _chassis = new THREE.Matrix4();
const _part = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * The world matrix of one of a car's chassis parts, as the per-car scene graph would compute
 * it: root (position, yaw) x chassis (sag, lean, jerk) x the part's own offset. `beaconScale`
 * null is the body and the bars (which sit at the chassis origin); a number is the roof beacon
 * at that scale. Pure.
 */
export function electricFleetMatrix(
  out: THREE.Matrix4,
  x: number,
  y: number,
  z: number,
  rotY: number,
  chassis: ElectricChassisPose,
  beaconScale: number | null = null,
): THREE.Matrix4 {
  out.makeRotationY(rotY).setPosition(x, y, z);
  if (chassis.rx !== 0 || chassis.ry !== 0 || chassis.rz !== 0 || chassis.y !== 0) {
    _q.setFromEuler(_e.set(chassis.rx, chassis.ry, chassis.rz, 'XYZ'));
    _chassis.compose(_p.set(0, chassis.y, 0), _q, _s.set(1, 1, 1));
    out.multiply(_chassis);
  }
  if (beaconScale !== null) {
    _part.makeScale(beaconScale, beaconScale, beaconScale).setPosition(BEACON_OFFSET.x, BEACON_OFFSET.y, BEACON_OFFSET.z);
    out.multiply(_part);
  }
  return out;
}

/** One instanced look: a mesh, how many instances it holds this frame, which car is in each slot. */
interface Look {
  mesh: THREE.InstancedMesh;
  count: number;
  /** The car in each slot last frame, so instance colours are re-sent only when they moved. */
  slotCar: Int32Array;
  colorsDirty: boolean;
}

function makeLook(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  capacity: number,
  name: string,
  colors: boolean,
): Look {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity));
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (colors) {
    // Allocated up front: whether an instanced mesh has colours is part of its shader program,
    // so adding them later would compile a new one mid-game.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  // Culled per instance in `commit`; three's whole-mesh test would only ever see the city.
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, count: 0, slotCar: new Int32Array(Math.max(1, capacity)).fill(-1), colorsDirty: false };
}

export function createElectricFleet(capacity: number): ElectricFleet {
  const kit = electricFleetKit();
  const root = new THREE.Group();
  root.name = 'electric-fleet';

  // THE LOOKS. Each clones the template the per-car visual clones, set to the values that
  // visual holds in that state (see `setStatus` / `update` in `electricCarVisual.ts`).
  const bodyAliveMat = kit.bodyMat.clone();
  bodyAliveMat.color.setRGB(1, 1, 1); // the paint is the instance colour
  const bodyDeadMat = kit.bodyMat.clone();
  bodyDeadMat.color.setRGB(1, 1, 1);
  bodyDeadMat.roughness = DEAD_BODY_ROUGHNESS;
  bodyDeadMat.metalness = DEAD_BODY_METALNESS;
  const barsAliveMat = kit.barMat.clone();
  const barsDeadMat = kit.barMat.clone();
  barsDeadMat.emissiveIntensity = 0;
  const beaconFlashMat = kit.beaconMat.clone();
  beaconFlashMat.opacity = BEACON_FLASH.opacity;
  const beaconDimMat = kit.beaconMat.clone();
  beaconDimMat.opacity = BEACON_DIM.opacity;
  const ringMat = kit.ringMat.clone();
  ringMat.color.copy(ELECTRIC_RUSH_RING);

  // The body art lands asynchronously; the templates carry it once it has.
  let disposed = false;
  if (!bodyAliveMat.map) {
    void kit.bodyArt.ready.then(() => {
      if (disposed || !kit.bodyArt.texture) return;
      for (const m of [bodyAliveMat, bodyDeadMat]) {
        m.map = kit.bodyArt.texture;
        m.needsUpdate = true;
      }
    });
  }

  const bodyAlive = makeLook(kit.body, bodyAliveMat, capacity, 'electric-fleet-body', true);
  const bodyDead = makeLook(kit.body, bodyDeadMat, capacity, 'electric-fleet-body-dead', true);
  const barsAlive = makeLook(kit.bars, barsAliveMat, capacity, 'electric-fleet-bars', false);
  const barsDead = makeLook(kit.bars, barsDeadMat, capacity, 'electric-fleet-bars-dead', false);
  const beaconFlash = makeLook(kit.beacon, beaconFlashMat, capacity, 'electric-fleet-beacon', false);
  const beaconDim = makeLook(kit.beacon, beaconDimMat, capacity, 'electric-fleet-beacon-dim', false);
  // Same draw order as the per-car beacon: after the rest of the transparents.
  beaconFlash.mesh.renderOrder = 2;
  beaconDim.mesh.renderOrder = 2;
  const looks = [bodyAlive, bodyDead, barsAlive, barsDead, beaconFlash, beaconDim];
  for (const look of looks) root.add(look.mesh);

  // The cascade's own programs (per-car body, bars, beacon, ring) must be compiled in the
  // warm-up, not on the first hit: this car is never shown, but it is drawn by the warm-up's
  // forced-visible render wherever the camera is, and it keeps those programs referenced when
  // the last real cascade is disposed.
  const warm = createElectricCarVisual(0);
  warm.setRushTarget(true);
  warm.root.name = 'electric-fleet-warm';
  warm.root.visible = false;
  warm.root.traverse((o) => {
    o.frustumCulled = false;
  });
  root.add(warm.root);

  // The per-instance frustum test: a sphere round the whole car at any sag or lean.
  const bs = kit.body.boundingSphere ?? (kit.body.computeBoundingSphere(), kit.body.boundingSphere!);
  const sphereY = bs.center.y;
  const sphereRadius = bs.radius + Math.hypot(bs.center.x, bs.center.z) + 0.3;
  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  const sphere = new THREE.Sphere();

  // The frame's staged cars.
  const px = new Float32Array(capacity);
  const py = new Float32Array(capacity);
  const pz = new Float32Array(capacity);
  const prot = new Float32Array(capacity);
  const pAge = new Float32Array(capacity);
  const pStatus: TargetStatus[] = new Array(capacity).fill('active');
  const pMarked = new Uint8Array(capacity);
  let placed = 0;

  const cascades = new Map<number, ElectricCarVisual>();
  const rings: THREE.Mesh[] = [];
  const pose: ElectricChassisPose = { rx: 0, ry: 0, rz: 0, y: 0 };
  const REST: ElectricChassisPose = { rx: 0, ry: 0, rz: 0, y: 0 };
  const paint = new THREE.Color();

  const stats: ElectricFleetStats = { cars: capacity, alive: 0, dead: 0, beaconsFlash: 0, beaconsDim: 0, cascading: 0, rings: 0, culled: 0 };

  function push(look: Look, matrix: THREE.Matrix4, car: number, color: THREE.Color | null): void {
    const slot = look.count++;
    matrix.toArray(look.mesh.instanceMatrix.array, slot * 16);
    if (color && look.slotCar[slot] !== car) {
      color.toArray(look.mesh.instanceColor!.array, slot * 3);
      look.colorsDirty = true;
    }
    look.slotCar[slot] = car;
  }

  function flush(look: Look): void {
    const mesh = look.mesh;
    mesh.count = look.count;
    mesh.visible = look.count > 0;
    if (look.count === 0) return;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, look.count * 16);
    mesh.instanceMatrix.needsUpdate = true;
    if (look.colorsDirty && mesh.instanceColor) {
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, look.count * 3);
      mesh.instanceColor.needsUpdate = true;
      look.colorsDirty = false;
    }
  }

  function release(index: number): void {
    const vis = cascades.get(index);
    if (!vis) return;
    root.remove(vis.root);
    vis.dispose();
    cascades.delete(index);
  }

  function ring(slot: number): THREE.Mesh {
    while (rings.length <= slot) {
      const mesh = new THREE.Mesh(kit.ring, ringMat);
      mesh.name = 'electric-fleet-ring';
      mesh.renderOrder = 1;
      mesh.visible = false;
      root.add(mesh);
      rings.push(mesh);
    }
    return rings[slot];
  }
  for (let i = 0; i < RUSH.targets.maxMarked; i++) ring(i);

  const fleet: ElectricFleet = {
    root,
    cull: true,
    stats,
    place(index, x, y, z, rotY, status, timeSinceHit, rushMarked) {
      if (index >= capacity) return;
      px[index] = x;
      py[index] = y;
      pz[index] = z;
      prot[index] = rotY;
      pStatus[index] = status;
      pAge[index] = timeSinceHit;
      pMarked[index] = rushMarked ? 1 : 0;
      if (index + 1 > placed) placed = index + 1;
    },
    commit(camera, time, frameDt) {
      const culling = fleet.cull;
      if (culling) {
        camera.updateMatrixWorld();
        viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(viewProj);
      }
      for (const look of looks) look.count = 0;
      let culled = 0;
      let ringCount = 0;
      const flash = electricBeaconFlash; // hoisted for the hot loop
      for (let i = 0; i < placed; i++) {
        const x = px[i];
        const y = py[i];
        const z = pz[i];
        const rotY = prot[i];
        const status = pStatus[i];

        if (pMarked[i] === 1) {
          const r = ring(ringCount++);
          r.visible = true;
          r.position.set(x, y + 0.04, z);
          r.rotation.y = rotY + electricRushRingSpin(time);
        }

        if (status === 'active') {
          if (cascades.size > 0) release(i);
          if (culling && !frustum.intersectsSphere(sphere.set(sphere.center.set(x, y + sphereY, z), sphereRadius))) {
            culled++;
            continue;
          }
          electricFleetMatrix(_root, x, y, z, rotY, REST);
          push(bodyAlive, _root, i, electricBodyPaint(i));
          push(barsAlive, _root, i, null);
          const look = flash(i, time) ? BEACON_FLASH : BEACON_DIM;
          electricFleetMatrix(_root, x, y, z, rotY, REST, look.scale);
          push(look === BEACON_FLASH ? beaconFlash : beaconDim, _root, i, null);
          continue;
        }

        // Down. Same reading of the age as `setStatus`: no hit time is a wreck from before we
        // arrived, already at the end of its cascade.
        const since = pAge[i];
        if (since > 0 && since < ELECTRIC_CASCADE_END) {
          let vis = cascades.get(i);
          if (!vis) {
            vis = createElectricCarVisual(i);
            cascades.set(i, vis);
            root.add(vis.root);
          }
          vis.root.position.set(x, y, z);
          vis.root.rotation.y = rotY;
          vis.setStatus(status, since);
          vis.update(frameDt, time);
          continue;
        }
        if (cascades.size > 0) release(i);
        if (culling && !frustum.intersectsSphere(sphere.set(sphere.center.set(x, y + sphereY, z), sphereRadius))) {
          culled++;
          continue;
        }
        electricChassisPose(i, since > 0 ? since : ELECTRIC_CASCADE_END, pose);
        electricFleetMatrix(_root, x, y, z, rotY, pose);
        push(bodyDead, _root, i, electricDeadPaint(i, paint));
        push(barsDead, _root, i, null);
      }
      for (const look of looks) flush(look);
      for (let r = ringCount; r < rings.length; r++) rings[r].visible = false;
      if (ringCount > 0) ringMat.opacity = electricRushRingOpacity(time);

      stats.alive = bodyAlive.count;
      stats.dead = bodyDead.count;
      stats.beaconsFlash = beaconFlash.count;
      stats.beaconsDim = beaconDim.count;
      stats.cascading = cascades.size;
      stats.rings = ringCount;
      stats.culled = culled;
    },
    dispose() {
      disposed = true;
      for (const index of [...cascades.keys()]) release(index);
      warm.dispose();
      for (const look of looks) look.mesh.dispose();
      for (const m of [bodyAliveMat, bodyDeadMat, barsAliveMat, barsDeadMat, beaconFlashMat, beaconDimMat, ringMat]) m.dispose();
      root.clear();
    },
  };
  return fleet;
}
