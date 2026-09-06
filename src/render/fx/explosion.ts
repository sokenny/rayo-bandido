import * as THREE from 'three';
import { ringNext } from './shapes';

/**
 * Ground shockwave rings for destroyed targets.
 *
 * One `InstancedMesh` with a fixed slot count (one draw call) so several targets can pop at
 * once. Fading uses the per-instance color under additive blending - the ring dims to black,
 * which additively is the same as disappearing, and avoids a per-instance opacity uniform.
 */
export const RING_SLOTS = 4;

const RING_LIFE = 0.5;
const RING_START_RADIUS = 1.1;
const RING_END_RADIUS = 8.5;
const RING_Y = 0.06;

export interface ShockRings {
  object: THREE.InstancedMesh;
  spawn(x: number, y: number, z: number): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
}

export function createShockRings(parent: THREE.Object3D): ShockRings {
  // Unit ring, pre-rotated flat so an instance matrix only needs scale + translation.
  const geometry = new THREE.RingGeometry(0.88, 1.0, 36, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const object = new THREE.InstancedMesh(geometry, material, RING_SLOTS);
  object.name = 'fx-shock-rings';
  object.frustumCulled = false;
  object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  object.renderOrder = 3;
  object.visible = false;
  parent.add(object);

  // Scratch objects, allocated once.
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();

  const timers = new Float32Array(RING_SLOTS);
  const posX = new Float32Array(RING_SLOTS);
  const posY = new Float32Array(RING_SLOTS);
  const posZ = new Float32Array(RING_SLOTS);
  let head = 0;

  function writeSlot(i: number, scale: number, x: number, y: number, z: number, brightness: number): void {
    matrix.makeScale(scale, scale, scale);
    matrix.setPosition(x, y + RING_Y, z);
    object.setMatrixAt(i, matrix);
    color.setRGB(brightness * 0.35, brightness * 0.95, brightness);
    object.setColorAt(i, color);
  }

  function hideSlot(i: number): void {
    matrix.makeScale(0, 0, 0);
    matrix.setPosition(0, -1000, 0);
    object.setMatrixAt(i, matrix);
    color.setRGB(0, 0, 0);
    object.setColorAt(i, color);
  }

  for (let i = 0; i < RING_SLOTS; i++) hideSlot(i);
  object.instanceMatrix.needsUpdate = true;
  if (object.instanceColor) object.instanceColor.needsUpdate = true;

  return {
    object,
    spawn(x, y, z) {
      const i = head;
      head = ringNext(head, RING_SLOTS);
      timers[i] = RING_LIFE;
      posX[i] = x;
      posY[i] = y;
      posZ[i] = z;
      writeSlot(i, RING_START_RADIUS, x, y, z, 1);
      object.instanceMatrix.needsUpdate = true;
      if (object.instanceColor) object.instanceColor.needsUpdate = true;
      object.visible = true;
    },
    update(dt) {
      if (!object.visible) return;
      let active = 0;
      for (let i = 0; i < RING_SLOTS; i++) {
        const t = timers[i];
        if (t <= 0) continue;
        const next = t - dt;
        if (next <= 0) {
          timers[i] = 0;
          hideSlot(i);
          continue;
        }
        timers[i] = next;
        const k = next / RING_LIFE; // 1 -> 0
        const grow = 1 - k;
        const radius = RING_START_RADIUS + (RING_END_RADIUS - RING_START_RADIUS) * grow * (2 - grow);
        writeSlot(i, radius, posX[i], posY[i], posZ[i], k * k * 1.6);
        active++;
      }
      object.instanceMatrix.needsUpdate = true;
      if (object.instanceColor) object.instanceColor.needsUpdate = true;
      object.visible = active > 0;
    },
    reset() {
      for (let i = 0; i < RING_SLOTS; i++) {
        timers[i] = 0;
        hideSlot(i);
      }
      head = 0;
      object.instanceMatrix.needsUpdate = true;
      if (object.instanceColor) object.instanceColor.needsUpdate = true;
      object.visible = false;
    },
    dispose() {
      parent.remove(object);
      object.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
