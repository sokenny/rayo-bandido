import * as THREE from 'three';

/**
 * Tiny CPU-side geometry accumulator.
 *
 * The arena is built by merging thousands of small quads and boxes into a handful of
 * BufferGeometries, one per material. Merging (instead of one Mesh per object) is what keeps
 * the whole environment inside ~20 draw calls, and unlike InstancedMesh it lets every piece
 * carry its own UV rect (window tiling, sign atlas cells) and vertex colour.
 *
 * Everything here runs once at scene construction. No allocation happens per frame.
 */

const SCRATCH = new THREE.Color();

export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly colors: number[] = [];
  readonly faults: number[] = [];
  private readonly withColor: boolean;
  private readonly withFault: boolean;
  private r = 1;
  private g = 1;
  private b = 1;
  private fa = 0;

  constructor(withColor = false, withFault = false) {
    this.withColor = withColor;
    this.withFault = withFault;
  }

  /** Sets the vertex colour used by subsequent primitives. `mul` scales brightness. */
  color(hex: number, mul = 1): this {
    SCRATCH.setHex(hex);
    this.r = SCRATCH.r * mul;
    this.g = SCRATCH.g * mul;
    this.b = SCRATCH.b * mul;
    return this;
  }

  /**
   * Tags subsequent primitives with a fault seed (see `lampFaults`). 0, the default, means a
   * piece of light that simply works; every lamp part sharing a seed strobes together.
   */
  fault(seed: number): this {
    this.fa = seed;
    return this;
  }

  get triangles(): number {
    return this.positions.length / 9;
  }

  get empty(): boolean {
    return this.positions.length === 0;
  }

  /** Quad a-b-c-d in counter-clockwise order seen from the front face. */
  quad(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
  ): void {
    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - bx;
    const e2y = cy - by;
    const e2z = cz - bz;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    const p = this.positions;
    const n = this.normals;
    const t = this.uvs;
    // a, b, c
    p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    t.push(u0, v0, u1, v0, u1, v1);
    // a, c, d
    p.push(ax, ay, az, cx, cy, cz, dx, dy, dz);
    t.push(u0, v0, u1, v1, u0, v1);
    for (let i = 0; i < 6; i++) n.push(nx, ny, nz);
    if (this.withColor) {
      const c = this.colors;
      for (let i = 0; i < 6; i++) c.push(this.r, this.g, this.b);
    }
    if (this.withFault) {
      const fl = this.faults;
      for (let i = 0; i < 6; i++) fl.push(this.fa);
    }
  }

  /** Horizontal quad facing +Y (road surface, decals, roofs). */
  planeY(cx: number, y: number, cz: number, sx: number, sz: number, u0 = 0, v0 = 0, u1 = 1, v1 = 1): void {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    this.quad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, u0, v0, u1, v1);
  }

  /**
   * Vertical panel of size w x h centred at (cx, cy, cz), facing +Z rotated by `rotY`
   * radians about Y (rotY 0 faces +Z, PI/2 faces +X).
   */
  panel(
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    rotY: number,
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
  ): void {
    const s = Math.sin(rotY);
    const c = Math.cos(rotY);
    const hx = (w / 2) * c;
    const hz = -(w / 2) * s;
    const y0 = cy - h / 2;
    const y1 = cy + h / 2;
    // a = bottom-left, b = bottom-right, c = top-right, d = top-left.
    this.quad(cx - hx, y0, cz - hz, cx + hx, y0, cz + hz, cx + hx, y1, cz + hz, cx - hx, y1, cz - hz, u0, v0, u1, v1);
  }

  /**
   * A segment drawn as two crossed quads (4 triangles). Reads as a glowing tube from any
   * angle for a fraction of the cost of a cylinder: neon bars, cables, sign frames.
   */
  tube(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w: number): void {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    // Pick any axis not parallel to the segment.
    const ux = Math.abs(dy) > 0.9 ? 1 : 0;
    const uy = Math.abs(dy) > 0.9 ? 0 : 1;
    let ax = dy * 0 - dz * uy;
    let ay = dz * ux - dx * 0;
    let az = dx * uy - dy * ux;
    let al = Math.hypot(ax, ay, az) || 1;
    ax /= al;
    ay /= al;
    az /= al;
    const bx = dy * az - dz * ay;
    const by = dz * ax - dx * az;
    const bz = dx * ay - dy * ax;
    const h = w / 2;
    this.quad(
      x0 - ax * h, y0 - ay * h, z0 - az * h,
      x0 + ax * h, y0 + ay * h, z0 + az * h,
      x1 + ax * h, y1 + ay * h, z1 + az * h,
      x1 - ax * h, y1 - ay * h, z1 - az * h,
    );
    this.quad(
      x0 - bx * h, y0 - by * h, z0 - bz * h,
      x0 + bx * h, y0 + by * h, z0 + bz * h,
      x1 + bx * h, y1 + by * h, z1 + bz * h,
      x1 - bx * h, y1 - by * h, z1 - bz * h,
    );
  }

  /**
   * Axis-aligned box. When `tileW`/`tileH` are given, side UVs repeat by world size so
   * window grids keep a constant scale across differently sized buildings.
   */
  box(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    opts?: { top?: boolean; bottom?: boolean; sides?: boolean; tileW?: number; tileH?: number; uOffset?: number },
  ): void {
    const top = opts?.top !== false;
    const bottom = opts?.bottom === true;
    const sides = opts?.sides !== false;
    const tw = opts?.tileW ?? 0;
    const th = opts?.tileH ?? 0;
    const uo = opts?.uOffset ?? 0;
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;

    if (sides) {
      const uX = tw > 0 ? sz / tw : 1;
      const uZ = tw > 0 ? sx / tw : 1;
      const vY = th > 0 ? sy / th : 1;
      // +X
      this.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, uo, 0, uo + uX, vY);
      // -X
      this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, uo, 0, uo + uX, vY);
      // +Z
      this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, uo, 0, uo + uZ, vY);
      // -Z
      this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, uo, 0, uo + uZ, vY);
    }
    if (top) {
      const uT = tw > 0 ? sx / tw : 1;
      const vT = tw > 0 ? sz / tw : 1;
      this.quad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 0, uT, vT);
    }
    if (bottom) {
      this.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, 0, 1, 1);
    }
  }

  /**
   * Box of length `len` along the unit direction (dx, dz), `thick` across it and from y0 to
   * y1, centred at (cx, cz). Four sides and a top: guardrails, barriers and walls that follow
   * a curved or diagonal road. `bottom` adds the underside, for a box that hangs in the air.
   */
  orientedBox(
    cx: number,
    cz: number,
    dx: number,
    dz: number,
    len: number,
    thick: number,
    y0: number,
    y1: number,
    opts?: { bottom?: boolean },
  ): void {
    // Right-hand normal of the direction.
    const nx = -dz;
    const nz = dx;
    const hl = len / 2;
    const ht = thick / 2;
    // Corners: a = back-left, b = front-left, c = front-right, d = back-right (left = -normal).
    const ax = cx - dx * hl - nx * ht;
    const az = cz - dz * hl - nz * ht;
    const bx = cx + dx * hl - nx * ht;
    const bz = cz + dz * hl - nz * ht;
    const qx = cx + dx * hl + nx * ht;
    const qz = cz + dz * hl + nz * ht;
    const ex = cx - dx * hl + nx * ht;
    const ez = cz - dz * hl + nz * ht;
    // Left face (outward = -normal), right face, front, back, top.
    this.quad(bx, y0, bz, ax, y0, az, ax, y1, az, bx, y1, bz);
    this.quad(ex, y0, ez, qx, y0, qz, qx, y1, qz, ex, y1, ez);
    this.quad(qx, y0, qz, bx, y0, bz, bx, y1, bz, qx, y1, qz);
    this.quad(ax, y0, az, ex, y0, ez, ex, y1, ez, ax, y1, az);
    this.quad(ax, y1, az, ex, y1, ez, qx, y1, qz, bx, y1, bz);
    // Underside, facing -Y: only worth its triangles where the box is seen from below.
    if (opts?.bottom) this.quad(ax, y0, az, bx, y0, bz, qx, y0, qz, ex, y0, ez);
  }

  /**
   * Like `orientedBox`, but the base runs from `ya` at the start to `yb` at the end and the
   * box is `height` tall above it: a guardrail or a kerb that climbs a ramp without steps.
   * Four sides, a top and both end caps.
   */
  slopedBox(ax: number, az: number, bx: number, bz: number, ya: number, yb: number, thick: number, height: number): void {
    let dx = bx - ax;
    let dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const nx = -dz;
    const nz = dx;
    const ht = thick / 2;
    // Left (-normal) and right (+normal) edges at both ends.
    const alx = ax - nx * ht;
    const alz = az - nz * ht;
    const arx = ax + nx * ht;
    const arz = az + nz * ht;
    const blx = bx - nx * ht;
    const blz = bz - nz * ht;
    const brx = bx + nx * ht;
    const brz = bz + nz * ht;
    const ya1 = ya + height;
    const yb1 = yb + height;
    // Left face (outward = -normal), right face, top, and the two caps.
    this.quad(blx, yb, blz, alx, ya, alz, alx, ya1, alz, blx, yb1, blz);
    this.quad(arx, ya, arz, brx, yb, brz, brx, yb1, brz, arx, ya1, arz);
    this.quad(alx, ya1, alz, arx, ya1, arz, brx, yb1, brz, blx, yb1, blz);
    this.quad(alx, ya, alz, blx, yb, blz, brx, yb, brz, arx, ya, arz);
    this.quad(arx, ya, arz, alx, ya, alz, alx, ya1, alz, arx, ya1, arz);
    this.quad(blx, yb, blz, brx, yb, brz, brx, yb1, brz, blx, yb1, blz);
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.withColor) geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (this.withFault) geo.setAttribute('aLampFault', new THREE.Float32BufferAttribute(this.faults, 1));
    geo.computeBoundingSphere();
    return geo;
  }
}

/** Deterministic PRNG so the city looks identical on every run. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rect2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** True when (x, z) lies inside the rect, optionally shrunk/grown by `pad`. */
export function inRect(r: Rect2, x: number, z: number, pad = 0): boolean {
  return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
}

/** a minus b, as up to four disjoint rectangles. Returns [a] when they do not overlap. */
export function subtractRect(a: Rect2, b: Rect2): Rect2[] {
  if (b.minX >= a.maxX || b.maxX <= a.minX || b.minZ >= a.maxZ || b.maxZ <= a.minZ) return [a];
  const out: Rect2[] = [];
  const midMinZ = Math.max(a.minZ, b.minZ);
  const midMaxZ = Math.min(a.maxZ, b.maxZ);
  if (b.minZ > a.minZ) out.push({ minX: a.minX, maxX: a.maxX, minZ: a.minZ, maxZ: b.minZ });
  if (b.maxZ < a.maxZ) out.push({ minX: a.minX, maxX: a.maxX, minZ: b.maxZ, maxZ: a.maxZ });
  if (b.minX > a.minX) out.push({ minX: a.minX, maxX: b.minX, minZ: midMinZ, maxZ: midMaxZ });
  if (b.maxX < a.maxX) out.push({ minX: b.maxX, maxX: a.maxX, minZ: midMinZ, maxZ: midMaxZ });
  return out;
}

/**
 * Turns a set of possibly overlapping rectangles into a disjoint cover of the same area.
 * Used so overlapping road strips never z-fight at intersections.
 */
export function disjointCover(rects: readonly Rect2[]): Rect2[] {
  const out: Rect2[] = [];
  for (const r of rects) {
    let pieces: Rect2[] = [r];
    for (const done of out) {
      const next: Rect2[] = [];
      for (const p of pieces) {
        const sub = subtractRect(p, done);
        for (const s of sub) if (s.maxX - s.minX > 1e-4 && s.maxZ - s.minZ > 1e-4) next.push(s);
      }
      pieces = next;
      if (pieces.length === 0) break;
    }
    for (const p of pieces) out.push(p);
  }
  return out;
}
