import * as THREE from 'three';
import { QUAD_VERTS, clearQuad, ringNext, writeQuad } from './shapes';

/**
 * Dark tire marks laid by the two rear wheels while the axle slides.
 *
 * One `BufferGeometry` holds both ribbons (one draw call). Each wheel owns half of a fixed
 * quad budget as a ring buffer: once its half is full the oldest quad is overwritten, so the
 * trail length is constant and nothing ever grows. Only the touched vertex range is
 * re-uploaded.
 */
export const SKID_QUADS_PER_WHEEL = 300;
export const SKID_QUADS_TOTAL = SKID_QUADS_PER_WHEEL * 2;

/** Minimum travel before a new segment is laid (m). */
const MIN_STEP = 0.25;
/**
 * Above this the car teleported (restart); re-anchor instead of drawing across the map.
 * Must stay above one clamped frame at top speed (50 m/s * 5/60 s ~= 4.2 m) or fast drifts
 * would silently drop segments.
 */
const MAX_STEP = 8;
const HALF_WIDTH = 0.15;
const MARK_Y = 0.02;

export interface SkidMarks {
  object: THREE.Mesh;
  /** Feed both rear contact patches every frame. `laying` gates whether marks are written; `y` is the road height. */
  track(laying: boolean, y: number, leftX: number, leftZ: number, rightX: number, rightZ: number): void;
  /** Upload whatever `track` touched this frame. */
  flush(): void;
  reset(): void;
  dispose(): void;
}

export function createSkidMarks(parent: THREE.Object3D): SkidMarks {
  const vertexCount = SKID_QUADS_TOTAL * QUAD_VERTS;
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint16Array(SKID_QUADS_TOTAL * 6);
  for (let q = 0; q < SKID_QUADS_TOTAL; q++) {
    const v = q * QUAD_VERTS;
    const o = q * 6;
    indices[o] = v;
    indices[o + 1] = v + 1;
    indices[o + 2] = v + 2;
    indices[o + 3] = v;
    indices[o + 4] = v + 2;
    indices[o + 5] = v + 3;
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttr);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  const material = new THREE.MeshBasicMaterial({
    color: 0x08070c,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    fog: true,
  });

  const object = new THREE.Mesh(geometry, material);
  object.name = 'fx-skid-marks';
  object.frustumCulled = false;
  object.renderOrder = 1;
  parent.add(object);

  // Per-wheel ring cursors and last contact point.
  const heads = [0, 0];
  const lastX = [0, 0];
  const lastZ = [0, 0];
  const anchored = [false, false];

  let dirtyMinVert = Number.POSITIVE_INFINITY;
  let dirtyMaxVert = -1;

  function markDirty(quad: number): void {
    const first = quad * QUAD_VERTS;
    const last = first + QUAD_VERTS - 1;
    if (first < dirtyMinVert) dirtyMinVert = first;
    if (last > dirtyMaxVert) dirtyMaxVert = last;
  }

  function step(wheel: number, y: number, x: number, z: number): void {
    if (!anchored[wheel]) {
      anchored[wheel] = true;
      lastX[wheel] = x;
      lastZ[wheel] = z;
      return;
    }
    const dx = x - lastX[wheel];
    const dz = z - lastZ[wheel];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < MIN_STEP) return;
    if (dist > MAX_STEP) {
      lastX[wheel] = x;
      lastZ[wheel] = z;
      return;
    }
    const inv = 1 / dist;
    // Normal of the travel direction, so the ribbon keeps its width through slides.
    const nx = -dz * inv;
    const nz = dx * inv;
    const quad = wheel * SKID_QUADS_PER_WHEEL + heads[wheel];
    writeQuad(positions, quad, lastX[wheel], lastZ[wheel], x, z, nx, nz, HALF_WIDTH, y + MARK_Y);
    markDirty(quad);
    heads[wheel] = ringNext(heads[wheel], SKID_QUADS_PER_WHEEL);
    lastX[wheel] = x;
    lastZ[wheel] = z;
  }

  return {
    object,
    track(laying, y, leftX, leftZ, rightX, rightZ) {
      if (!laying) {
        anchored[0] = false;
        anchored[1] = false;
        return;
      }
      step(0, y, leftX, leftZ);
      step(1, y, rightX, rightZ);
    },
    flush() {
      if (dirtyMaxVert < 0) return;
      positionAttr.clearUpdateRanges();
      positionAttr.addUpdateRange(dirtyMinVert * 3, (dirtyMaxVert - dirtyMinVert + 1) * 3);
      positionAttr.needsUpdate = true;
      dirtyMinVert = Number.POSITIVE_INFINITY;
      dirtyMaxVert = -1;
    },
    reset() {
      for (let q = 0; q < SKID_QUADS_TOTAL; q++) clearQuad(positions, q);
      heads[0] = 0;
      heads[1] = 0;
      anchored[0] = false;
      anchored[1] = false;
      positionAttr.clearUpdateRanges();
      positionAttr.needsUpdate = true;
      dirtyMinVert = Number.POSITIVE_INFINITY;
      dirtyMaxVert = -1;
    },
    dispose() {
      parent.remove(object);
      geometry.dispose();
      material.dispose();
    },
  };
}
