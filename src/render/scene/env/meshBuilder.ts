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

/**
 * How far a softened corner normal may lean out of its face, as the tangent of the tilt
 * angle. 0.5 is about 26 degrees: enough to read as a rounded edge, not so much that a face
 * looks inflated.
 */
const SOFT_MAX_BEND = 0.5;

/** Scratch for the four corner normals of one quad (a, b, c, d), 3 floats each. */
const N4 = new Float64Array(12);

export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly colors: number[] = [];
  readonly faults: number[] = [];
  readonly cells: number[] = [];
  private readonly withColor: boolean;
  private readonly withFault: boolean;
  private readonly withCell: boolean;
  private r = 1;
  private g = 1;
  private b = 1;
  private fa = 0;
  private cu = 0;
  private cv = 0;
  private cw = 1;
  private softRadius = 0;
  private chamferSize = 0;

  constructor(withColor = false, withFault = false, withCell = false) {
    this.withColor = withColor;
    this.withFault = withFault;
    this.withCell = withCell;
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

  /**
   * Tags subsequent primitives with a facade atlas cell (see `facadeAtlas`): the cell's
   * origin in the atlas, and how bright the wall between the windows is drawn.
   */
  cell(u0: number, v0: number, wall = 1): this {
    this.cu = u0;
    this.cv = v0;
    this.cw = wall;
    return this;
  }

  /**
   * Turns on edge softening for subsequent boxes, with `radius` the fillet the shading
   * should suggest, in metres. 0 (the default) keeps the hard flat normals.
   *
   * This rounds the *lighting*, not the geometry: no extra vertices, no extra triangles, no
   * change to the silhouette. See `softQuad`.
   */
  soft(radius: number): this {
    this.softRadius = radius;
    return this;
  }

  /**
   * Turns on a real chamfer of `size` metres on every edge of subsequent `box` calls: the
   * corners are cut away, so the silhouette changes and the cut facet catches its own light.
   * 0 (the default) leaves boxes sharp.
   *
   * Unlike `soft`, this costs geometry: 44 triangles a box instead of 12. Reach for it only
   * where the edge is read close up.
   */
  chamfer(size: number): this {
    this.chamferSize = size;
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
    for (let i = 0; i < 12; i += 3) {
      N4[i] = nx;
      N4[i + 1] = ny;
      N4[i + 2] = nz;
    }
    this.emit(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, u0, v0, u1, v1);
  }

  /**
   * Quad a-b-c-d with edge-softened normals: every corner normal leans out of the face
   * towards the two faces that meet it, so light rolls around the edge instead of stopping
   * dead at it. The four leans are symmetric, so they cancel at the face centre and the
   * middle of the face still shades flat.
   *
   * The lean is sized from `softRadius` against the face's own half-extent, one axis at a
   * time: the same fillet radius reads hard on a lamp post and all but disappears on a tower
   * wall, which is what a real chamfer of that size would do. Free — identical vertices and
   * triangles to `quad`, only different normals.
   */
  private softQuad(
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
    u0: number,
    v0: number,
    u1: number,
    v1: number,
  ): void {
    // In-plane axes: u along a->b, v along a->d.
    let ux = bx - ax;
    let uy = by - ay;
    let uz = bz - az;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    let vx = dx - ax;
    let vy = dy - ay;
    let vz = dz - az;
    const vl = Math.hypot(vx, vy, vz) || 1;
    vx /= vl;
    vy /= vl;
    vz /= vl;
    // Face normal = u x v.
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const r = this.softRadius;
    const bu = Math.min(SOFT_MAX_BEND, r / (ul / 2));
    const bv = Math.min(SOFT_MAX_BEND, r / (vl / 2));
    // Corner signs along (u, v): a(-,-) b(+,-) c(+,+) d(-,+).
    for (let i = 0; i < 4; i++) {
      const su = i === 1 || i === 2 ? bu : -bu;
      const sv = i >= 2 ? bv : -bv;
      let x = nx + ux * su + vx * sv;
      let y = ny + uy * su + vy * sv;
      let z = nz + uz * su + vz * sv;
      const l = Math.hypot(x, y, z) || 1;
      x /= l;
      y /= l;
      z /= l;
      N4[i * 3] = x;
      N4[i * 3 + 1] = y;
      N4[i * 3 + 2] = z;
    }
    this.emit(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, u0, v0, u1, v1);
  }

  /** One face of a box: softened when `soft()` is on, hard otherwise. */
  private face(
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
    if (this.softRadius > 0) this.softQuad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, u0, v0, u1, v1);
    else this.quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, u0, v0, u1, v1);
  }

  /** Pushes the two triangles of quad a-b-c-d, taking the corner normals from `N4`. */
  private emit(
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
    u0: number,
    v0: number,
    u1: number,
    v1: number,
  ): void {
    const p = this.positions;
    const n = this.normals;
    const t = this.uvs;
    // a, b, c
    p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    t.push(u0, v0, u1, v0, u1, v1);
    n.push(N4[0], N4[1], N4[2], N4[3], N4[4], N4[5], N4[6], N4[7], N4[8]);
    // a, c, d
    p.push(ax, ay, az, cx, cy, cz, dx, dy, dz);
    t.push(u0, v0, u1, v1, u0, v1);
    n.push(N4[0], N4[1], N4[2], N4[6], N4[7], N4[8], N4[9], N4[10], N4[11]);
    if (this.withColor) {
      const c = this.colors;
      for (let i = 0; i < 6; i++) c.push(this.r, this.g, this.b);
    }
    if (this.withFault) {
      const fl = this.faults;
      for (let i = 0; i < 6; i++) fl.push(this.fa);
    }
    if (this.withCell) {
      const ce = this.cells;
      for (let i = 0; i < 6; i++) ce.push(this.cu, this.cv, this.cw);
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

  /** Triangle a-b-c, counter-clockwise seen from the front face, with one flat normal. */
  private tri(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
  ): void {
    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.uvs.push(0, 0, 1, 0, 1, 1);
    for (let i = 0; i < 3; i++) this.normals.push(nx, ny, nz);
    if (this.withColor) for (let i = 0; i < 3; i++) this.colors.push(this.r, this.g, this.b);
    if (this.withFault) for (let i = 0; i < 3; i++) this.faults.push(this.fa);
    if (this.withCell) for (let i = 0; i < 3; i++) this.cells.push(this.cu, this.cv, this.cw);
  }

  /**
   * `box`, with every edge cut back by `chamferSize`: six inset faces, twelve bevel strips
   * and eight corner triangles, 44 triangles against the sharp box's 12.
   *
   * The chamfer is clamped to a third of the box's smallest side, so a thin box keeps a face
   * instead of collapsing into its own bevel.
   */
  private chamferBox(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    top: boolean,
    bottom: boolean,
    sides: boolean,
    tw: number,
    th: number,
    uo: number,
  ): void {
    const c = Math.min(this.chamferSize, Math.min(sx, Math.min(sy, sz)) / 3);
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    // Inset extents: where a face stops and its bevel begins.
    const ax = hx - c;
    const ay = hy - c;
    const az = hz - c;
    const uX = tw > 0 ? sz / tw : 1;
    const uZ = tw > 0 ? sx / tw : 1;
    const vY = th > 0 ? sy / th : 1;

    // Six inset faces, each spanning its full UV rect: the chamfer stretches the texture by
    // c over the side, a few percent at the sizes this is used for.
    if (sides) {
      this.face(cx + hx, cy - ay, cz + az, cx + hx, cy - ay, cz - az, cx + hx, cy + ay, cz - az, cx + hx, cy + ay, cz + az, uo, 0, uo + uX, vY);
      this.face(cx - hx, cy - ay, cz - az, cx - hx, cy - ay, cz + az, cx - hx, cy + ay, cz + az, cx - hx, cy + ay, cz - az, uo, 0, uo + uX, vY);
      this.face(cx - ax, cy - ay, cz + hz, cx + ax, cy - ay, cz + hz, cx + ax, cy + ay, cz + hz, cx - ax, cy + ay, cz + hz, uo, 0, uo + uZ, vY);
      this.face(cx + ax, cy - ay, cz - hz, cx - ax, cy - ay, cz - hz, cx - ax, cy + ay, cz - hz, cx + ax, cy + ay, cz - hz, uo, 0, uo + uZ, vY);
    }
    if (top) {
      const uT = tw > 0 ? sx / tw : 1;
      const vT = tw > 0 ? sz / tw : 1;
      this.face(cx - ax, cy + hy, cz + az, cx + ax, cy + hy, cz + az, cx + ax, cy + hy, cz - az, cx - ax, cy + hy, cz - az, 0, 0, uT, vT);
    }
    if (bottom) {
      this.face(cx - ax, cy - hy, cz - az, cx + ax, cy - hy, cz - az, cx + ax, cy - hy, cz + az, cx - ax, cy - hy, cz + az, 0, 0, 1, 1);
    }

    // Twelve bevel strips. The four vertical ones join side to side; the eight horizontal
    // ones join a side to the top or the bottom.
    const sgn = [1, -1];
    for (const ix of sgn) {
      for (const iz of sgn) {
        // Vertical corner, between the +/-X face and the +/-Z face.
        const px = cx + ix * hx;
        const pz = cz + iz * az;
        const qx = cx + ix * ax;
        const qz = cz + iz * hz;
        // Wind so the face looks outward: swap ends when the corner's handedness flips.
        if (ix * iz > 0) this.quad(qx, cy - ay, qz, px, cy - ay, pz, px, cy + ay, pz, qx, cy + ay, qz);
        else this.quad(px, cy - ay, pz, qx, cy - ay, qz, qx, cy + ay, qz, px, cy + ay, pz);
      }
    }
    for (const iy of sgn) {
      const py = cy + iy * hy;
      const qy = cy + iy * ay;
      // Horizontal bevel along the +/-X faces, then along the +/-Z faces.
      for (const ix of sgn) {
        const px = cx + ix * ax;
        const qx = cx + ix * hx;
        if (ix * iy > 0) this.quad(px, py, cz - az, px, py, cz + az, qx, qy, cz + az, qx, qy, cz - az);
        else this.quad(px, py, cz + az, px, py, cz - az, qx, qy, cz - az, qx, qy, cz + az);
      }
      for (const iz of sgn) {
        const pz = cz + iz * az;
        const qz = cz + iz * hz;
        if (iz * iy > 0) this.quad(cx + ax, py, pz, cx - ax, py, pz, cx - ax, qy, qz, cx + ax, qy, qz);
        else this.quad(cx - ax, py, pz, cx + ax, py, pz, cx + ax, qy, qz, cx - ax, qy, qz);
      }
    }

    // Eight corner triangles, one per original box corner.
    for (const ix of sgn) {
      for (const iy of sgn) {
        for (const iz of sgn) {
          const px = cx + ix * hx;
          const py = cy + iy * hy;
          const pz = cz + iz * hz;
          const a = [px, cy + iy * ay, cz + iz * az];
          const bb = [cx + ix * ax, py, cz + iz * az];
          const d = [cx + ix * ax, cy + iy * ay, pz];
          // The winding that faces outward flips with the sign of the corner's octant.
          if (ix * iy * iz > 0) this.tri(a[0], a[1], a[2], bb[0], bb[1], bb[2], d[0], d[1], d[2]);
          else this.tri(a[0], a[1], a[2], d[0], d[1], d[2], bb[0], bb[1], bb[2]);
        }
      }
    }
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
    if (this.chamferSize > 0) {
      this.chamferBox(cx, cy, cz, sx, sy, sz, top, bottom, sides, tw, th, uo);
      return;
    }
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
      this.face(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, uo, 0, uo + uX, vY);
      // -X
      this.face(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, uo, 0, uo + uX, vY);
      // +Z
      this.face(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, uo, 0, uo + uZ, vY);
      // -Z
      this.face(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, uo, 0, uo + uZ, vY);
    }
    if (top) {
      const uT = tw > 0 ? sx / tw : 1;
      const vT = tw > 0 ? sz / tw : 1;
      this.face(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 0, uT, vT);
    }
    if (bottom) {
      this.face(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, 0, 1, 1);
    }
  }

  /**
   * Box of length `len` along the unit direction (dx, dz), `thick` across it and from y0 to
   * y1, centred at (cx, cz). Four sides and a top: guardrails, barriers and walls that follow
   * a curved or diagonal road. `bottom` adds the underside, for a box that hangs in the air.
   *
   * `tile` repeats the UVs by world size (metres per tile) instead of mapping each face to
   * 0..1, so a textured run — a hedge, a wall — keeps one texture scale whatever its length.
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
    opts?: { bottom?: boolean; tile?: number },
  ): void {
    const tile = opts?.tile ?? 0;
    // Face extents in texture tiles: along the run, across it, and up it.
    const uL = tile > 0 ? len / tile : 1;
    const uT = tile > 0 ? thick / tile : 1;
    const vY = tile > 0 ? (y1 - y0) / tile : 1;
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
    this.face(bx, y0, bz, ax, y0, az, ax, y1, az, bx, y1, bz, 0, 0, uL, vY);
    this.face(ex, y0, ez, qx, y0, qz, qx, y1, qz, ex, y1, ez, 0, 0, uL, vY);
    this.face(qx, y0, qz, bx, y0, bz, bx, y1, bz, qx, y1, qz, 0, 0, uT, vY);
    this.face(ax, y0, az, ex, y0, ez, ex, y1, ez, ax, y1, az, 0, 0, uT, vY);
    this.face(ax, y1, az, ex, y1, ez, qx, y1, qz, bx, y1, bz, 0, 0, uT, uL);
    // Underside, facing -Y: only worth its triangles where the box is seen from below.
    if (opts?.bottom) this.face(ax, y0, az, bx, y0, bz, qx, y0, qz, ex, y0, ez, 0, 0, uT, uL);
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
    this.face(blx, yb, blz, alx, ya, alz, alx, ya1, alz, blx, yb1, blz);
    this.face(arx, ya, arz, brx, yb, brz, brx, yb1, brz, arx, ya1, arz);
    this.face(alx, ya1, alz, arx, ya1, arz, brx, yb1, brz, blx, yb1, blz);
    this.face(alx, ya, alz, blx, yb, blz, brx, yb, brz, arx, ya, arz);
    this.face(arx, ya, arz, alx, ya, alz, alx, ya1, alz, arx, ya1, arz);
    this.face(blx, yb, blz, brx, yb, brz, brx, yb1, brz, blx, yb1, blz);
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.withColor) geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (this.withFault) geo.setAttribute('aLampFault', new THREE.Float32BufferAttribute(this.faults, 1));
    if (this.withCell) geo.setAttribute('aFacadeCell', new THREE.Float32BufferAttribute(this.cells, 3));
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
