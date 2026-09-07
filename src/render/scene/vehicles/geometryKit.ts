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

/**
 * The section's ring of points, counter-clockwise looking toward +Z, into `out`.
 *
 * With no chamfer that is the four corners — bottom-left, bottom-right, top-right, top-left —
 * and the hull has one hard edge running the length of each of them. A chamfer replaces every
 * corner with the two points a cut of that size lands on, so the ring is an octagon and the
 * shoulder and rocker lines become two soft creases instead of one sharp one. The cut is
 * clamped to just under half of the shortest edge it touches, so a section can never fold
 * through itself however small it is.
 */
function sectionRing(s: LoftSection, chamfer: number, out: Float32Array): number {
  // 0 bottom-left, 1 bottom-right, 2 top-right, 3 top-left (looking toward +Z).
  const cx = [-s.bottomHalfWidth, s.bottomHalfWidth, s.topHalfWidth, -s.topHalfWidth];
  const cy = [s.bottomY, s.bottomY, s.topY, s.topY];
  if (chamfer <= 0) {
    for (let i = 0; i < 4; i++) {
      out[i * 3] = cx[i];
      out[i * 3 + 1] = cy[i];
      out[i * 3 + 2] = s.z;
    }
    return 4;
  }

  // Half the shortest edge is the most any corner can eat without meeting the cut next to it.
  let shortest = Infinity;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    shortest = Math.min(shortest, Math.hypot(cx[j] - cx[i], cy[j] - cy[i]));
  }
  const cut = Math.min(chamfer, shortest * 0.45);

  let p = 0;
  for (let i = 0; i < 4; i++) {
    const prev = (i + 3) % 4;
    const next = (i + 1) % 4;
    // Two points per corner: the one the cut reaches coming in along the previous edge, then
    // the one it reaches leaving along the next. Emitting them in that order keeps the ring
    // counter-clockwise, so face 1 is the floor, 3 the right flank, 5 the roof, 7 the left.
    for (const other of [prev, next]) {
      const dx = cx[other] - cx[i];
      const dy = cy[other] - cy[i];
      const len = Math.hypot(dx, dy);
      const t = len > 1e-6 ? cut / len : 0;
      out[p] = cx[i] + dx * t;
      out[p + 1] = cy[i] + dy * t;
      out[p + 2] = s.z;
      p += 3;
    }
  }
  return 8;
}

/** How a lofted hull is closed up. */
export interface LoftOptions {
  /** Cap the first and last cross-sections. Default true. */
  caps?: boolean;
  /**
   * Indices of segments (0 for the one between sections 0 and 1) whose TOP face is left out.
   * That turns a panel into an aperture: it is how the coupe's fastback gets a real backlight
   * opening to see the cabin through instead of paint with a pane of glass laid over it.
   * Anything behind an opening has to supply its own inward-facing surfaces — a lofted hull
   * is single-sided, so from inside, the rest of the shell is not there at all.
   */
  openTop?: readonly number[];
  /**
   * Cuts every longitudinal corner back by this many metres, turning each quad cross-section
   * into an octagon. 0 (the default) is the hard-edged hull everything was built with; a small
   * value is how a shape reads as rounded rather than folded out of sheet metal, at the cost
   * of doubling the hull's triangles.
   *
   * `openTop` still names the roof: face 2 without a chamfer, face 5 with one.
   */
  chamfer?: number;
}

/**
 * Lofts a closed hull through a list of quad cross-sections ordered front (-Z) to rear (+Z).
 * Flat-shaded, outward facing, with optional end caps. 8 tris per segment + 4 for the caps,
 * less 2 for every segment left open — doubled when `chamfer` rounds the corners off.
 */
export function loft(sections: LoftSection[], options: LoftOptions | boolean = true): THREE.BufferGeometry {
  if (sections.length < 2) throw new Error('loft() needs at least two sections');
  const opts: LoftOptions = typeof options === 'boolean' ? { caps: options } : options;
  const caps = opts.caps ?? true;
  const openTop = opts.openTop ?? [];
  const chamfer = opts.chamfer ?? 0;
  const segs = sections.length - 1;
  const ringSize = chamfer > 0 ? 8 : 4;
  const triCount = segs * ringSize * 2 + (caps ? (ringSize - 2) * 2 : 0) - openTop.length * 2;
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);

  const a = new Float32Array(24);
  const b = new Float32Array(24);
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

  // Face k of a segment is the quad along the edge from ring point k to point k + 1: with the
  // four corners in the order above that puts the top at face 2, and with a chamfer's eight
  // points it moves to face 5. See `sectionRing`.
  const TOP_FACE = chamfer > 0 ? 5 : 2;
  for (let i = 0; i < segs; i++) {
    sectionRing(sections[i], chamfer, a);
    sectionRing(sections[i + 1], chamfer, b);
    for (let k = 0; k < ringSize; k++) {
      if (k === TOP_FACE && openTop.includes(i)) continue;
      const k0 = k * 3;
      const k1 = ((k + 1) % ringSize) * 3;
      emit(a[k0], a[k0 + 1], a[k0 + 2], a[k1], a[k1 + 1], a[k1 + 2], b[k1], b[k1 + 1], b[k1 + 2]);
      emit(a[k0], a[k0 + 1], a[k0 + 2], b[k1], b[k1 + 1], b[k1 + 2], b[k0], b[k0 + 1], b[k0 + 2]);
    }
  }

  if (caps) {
    // A fan from ring point 0 across the rest, wound to face out at each end.
    sectionRing(sections[0], chamfer, a);
    for (let k = 1; k < ringSize - 1; k++) {
      const k0 = k * 3;
      const k1 = (k + 1) * 3;
      emit(a[0], a[1], a[2], a[k1], a[k1 + 1], a[k1 + 2], a[k0], a[k0 + 1], a[k0 + 2]);
    }
    sectionRing(sections[sections.length - 1], chamfer, b);
    for (let k = 1; k < ringSize - 1; k++) {
      const k0 = k * 3;
      const k1 = (k + 1) * 3;
      emit(b[0], b[1], b[2], b[k0], b[k0 + 1], b[k0 + 2], b[k1], b[k1 + 1], b[k1 + 2]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

/**
 * Turns a shell inside out: the same surface, wound and normalled the other way.
 *
 * Everything here is single-sided, so a hull built by `loft()` simply is not there when you
 * are inside it. Flipping a copy of one gives the inward-facing surface a cabin needs — and
 * being inward-facing, it also cannot be seen from outside however far it pokes through the
 * bodywork, which a box standing in for the same panel very much can.
 */
export function flipFaces(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const position = g.getAttribute('position') as THREE.BufferAttribute;
  const normal = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const swap = (attr: THREE.BufferAttribute): void => {
    const a = attr.array as Float32Array;
    for (let i = 0; i < a.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const b = a[i + 3 + k];
        a[i + 3 + k] = a[i + 6 + k];
        a[i + 6 + k] = b;
      }
    }
    attr.needsUpdate = true;
  };
  swap(position);
  if (normal) {
    swap(normal);
    const n = normal.array as Float32Array;
    for (let i = 0; i < n.length; i++) n[i] = -n[i];
    normal.needsUpdate = true;
  }
  return g;
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
