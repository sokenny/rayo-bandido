import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Small procedural geometry kit shared by the vehicle visuals.
 *
 * Everything here produces NON-INDEXED geometry carrying exactly `position`, `normal` and
 * `color`, so any set of parts can be fed to `mergeParts()` and drawn with a single
 * material. UVs are generated once for the merged result by `applyLengthwiseUVs()`.
 *
 * Conventions (identical to the vehicle contract):
 * - Nose points toward local -Z, +X is the car's right, y = 0 is the ground.
 */

const TMP_COLOR = new THREE.Color();

/** One cross-section of a lofted hull, taken on the XY plane at a given z. */
export interface LoftSection {
  z: number;
  bottomY: number;
  topY: number;
  bottomHalfWidth: number;
  topHalfWidth: number;
}

function sectionCorners(s: LoftSection, out: Float32Array): void {
  // 0 bottom-left, 1 bottom-right, 2 top-right, 3 top-left (looking toward +Z).
  out[0] = -s.bottomHalfWidth;
  out[1] = s.bottomY;
  out[2] = s.z;
  out[3] = s.bottomHalfWidth;
  out[4] = s.bottomY;
  out[5] = s.z;
  out[6] = s.topHalfWidth;
  out[7] = s.topY;
  out[8] = s.z;
  out[9] = -s.topHalfWidth;
  out[10] = s.topY;
  out[11] = s.z;
}

/**
 * Lofts a closed hull through a list of quad cross-sections ordered front (-Z) to rear (+Z).
 * Flat-shaded, outward facing, with optional end caps. 8 tris per segment + 4 for the caps.
 */
export function loft(sections: LoftSection[], caps = true): THREE.BufferGeometry {
  if (sections.length < 2) throw new Error('loft() needs at least two sections');
  const segs = sections.length - 1;
  const triCount = segs * 8 + (caps ? 4 : 0);
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);

  const a = new Float32Array(12);
  const b = new Float32Array(12);
  let p = 0;

  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();

  function emit(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    v0.set(ax, ay, az);
    v1.set(bx, by, bz);
    v2.set(cx, cy, cz);
    e1.subVectors(v1, v0);
    e2.subVectors(v2, v0);
    n.crossVectors(e1, e2);
    if (n.lengthSq() > 1e-12) n.normalize();
    else n.set(0, 1, 0);
    positions[p] = ax;
    positions[p + 1] = ay;
    positions[p + 2] = az;
    positions[p + 3] = bx;
    positions[p + 4] = by;
    positions[p + 5] = bz;
    positions[p + 6] = cx;
    positions[p + 7] = cy;
    positions[p + 8] = cz;
    for (let k = 0; k < 3; k++) {
      normals[p + k * 3] = n.x;
      normals[p + k * 3 + 1] = n.y;
      normals[p + k * 3 + 2] = n.z;
    }
    p += 9;
  }

  for (let i = 0; i < segs; i++) {
    sectionCorners(sections[i], a);
    sectionCorners(sections[i + 1], b);
    for (let k = 0; k < 4; k++) {
      const k0 = k * 3;
      const k1 = ((k + 1) % 4) * 3;
      emit(a[k0], a[k0 + 1], a[k0 + 2], a[k1], a[k1 + 1], a[k1 + 2], b[k1], b[k1 + 1], b[k1 + 2]);
      emit(a[k0], a[k0 + 1], a[k0 + 2], b[k1], b[k1 + 1], b[k1 + 2], b[k0], b[k0 + 1], b[k0 + 2]);
    }
  }

  if (caps) {
    sectionCorners(sections[0], a);
    emit(a[0], a[1], a[2], a[6], a[7], a[8], a[3], a[4], a[5]);
    emit(a[0], a[1], a[2], a[9], a[10], a[11], a[6], a[7], a[8]);
    sectionCorners(sections[sections.length - 1], b);
    emit(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8]);
    emit(b[0], b[1], b[2], b[6], b[7], b[8], b[9], b[10], b[11]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

/** Axis-aligned box centred on the origin. 12 tris. */
export function box(width: number, height: number, depth: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(width, height, depth).toNonIndexed();
}

/**
 * Normalizes a geometry so it can be merged: strips every attribute except position/normal,
 * clears groups and bakes a flat vertex color. Consumes and disposes the input when a
 * non-indexed copy has to be made.
 */
export function part(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  let g = geometry;
  if (g.index) {
    const flat = g.toNonIndexed();
    g.dispose();
    g = flat;
  }
  g.clearGroups();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const count = g.getAttribute('position').count;
  TMP_COLOR.set(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = TMP_COLOR.r;
    colors[i * 3 + 1] = TMP_COLOR.g;
    colors[i * 3 + 2] = TMP_COLOR.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Merges normalized parts into one geometry and disposes the inputs. */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('mergeParts(): incompatible geometries');
  return merged;
}

/**
 * Triplanar-ish UV projection where `u` always runs along the car's length on side, top and
 * bottom faces, so a livery painted as lengthwise shards flows continuously over the body.
 */
export function applyLengthwiseUVs(geometry: THREE.BufferGeometry): void {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const ix = 1 / Math.max(1e-4, bb.max.x - bb.min.x);
  const iy = 1 / Math.max(1e-4, bb.max.y - bb.min.y);
  const iz = 1 / Math.max(1e-4, bb.max.z - bb.min.z);
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));
    const x = (position.getX(i) - bb.min.x) * ix;
    const y = (position.getY(i) - bb.min.y) * iy;
    const z = (position.getZ(i) - bb.min.z) * iz;
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = z;
      v = x;
    } else if (nx >= nz) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * Wheel arch / over-fender shell: a half ring swept over the wheel, extruded across the
 * body. Built in the shape plane (shape x -> car z) and rotated into place.
 */
export function wheelArch(innerRadius: number, thickness: number, width: number, segments = 7): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const outer = innerRadius + thickness;
  shape.absarc(0, 0, outer, 0, Math.PI, false);
  shape.lineTo(-innerRadius, 0);
  shape.absarc(0, 0, innerRadius, Math.PI, 0, true);
  shape.lineTo(outer, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: segments, steps: 1 });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

/**
 * Same as `part()` but bakes an RGBA vertex color, which three.js honours as
 * `diffuseColor *= vColor` (alpha included). Used by the additive glow meshes so a single
 * draw call can hold both a soft ground pool and hard-edged rocker strips.
 */
export function partRGBA(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  alpha: number,
): THREE.BufferGeometry {
  const g = part(geometry, color);
  const rgb = g.getAttribute('color');
  const count = rgb.count;
  const rgba = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    rgba[i * 4] = rgb.getX(i);
    rgba[i * 4 + 1] = rgb.getY(i);
    rgba[i * 4 + 2] = rgb.getZ(i);
    rgba[i * 4 + 3] = alpha;
  }
  g.deleteAttribute('color');
  g.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  return g;
}

/**
 * Flat ground "pool" lying on the XZ plane: a subdivided quad whose vertex alpha falls off
 * toward the rim and whose hue slides from `frontColor` (nose) to `backColor` (tail).
 * Soft-edged without needing a texture, so it also builds under Node.
 */
export function glowPool(
  width: number,
  length: number,
  segmentsX: number,
  segmentsZ: number,
  frontColor: THREE.ColorRepresentation,
  backColor: THREE.ColorRepresentation,
): THREE.BufferGeometry {
  const front = new THREE.Color().set(frontColor);
  const back = new THREE.Color().set(backColor);
  const geo = new THREE.PlaneGeometry(width, length, segmentsX, segmentsZ).toNonIndexed();
  geo.rotateX(-Math.PI / 2);
  geo.clearGroups();
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  }
  const position = geo.getAttribute('position');
  const colors = new Float32Array(position.count * 4);
  const halfW = width / 2;
  const halfL = length / 2;
  for (let i = 0; i < position.count; i++) {
    const nx = Math.abs(position.getX(i)) / halfW;
    const nz = Math.abs(position.getZ(i)) / halfL;
    const r = Math.min(1, Math.sqrt(nx * nx * 0.9 + nz * nz * 0.9));
    const falloff = Math.max(0, 1 - r);
    const t = THREE.MathUtils.clamp((position.getZ(i) + halfL) / length, 0, 1);
    colors[i * 4] = THREE.MathUtils.lerp(front.r, back.r, t);
    colors[i * 4 + 1] = THREE.MathUtils.lerp(front.g, back.g, t);
    colors[i * 4 + 2] = THREE.MathUtils.lerp(front.b, back.b, t);
    colors[i * 4 + 3] = falloff * falloff;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return geo;
}
