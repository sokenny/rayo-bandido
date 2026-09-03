/**
 * Pure geometry helpers for the effects pools.
 *
 * RULES
 * - No Three.js, no DOM, no allocation. Every function writes into caller-owned typed
 *   arrays so it can be called from inside the render loop.
 * - Coordinates are world space (x, y, z) with y up, matching `src/core/types.ts`.
 */

/** Advance a ring-buffer cursor. */
export function ringNext(index: number, capacity: number): number {
  const n = index + 1;
  return n >= capacity ? 0 : n;
}

/** Vertices per skid-mark quad. */
export const QUAD_VERTS = 4;
/** Floats per skid-mark quad (4 verts * 3 components). */
export const QUAD_FLOATS = QUAD_VERTS * 3;

/**
 * Write one flat ground quad spanning a -> b, `halfWidth` to each side along (nx, nz).
 * Vertex order is [a-left, a-right, b-right, b-left]; the shared index buffer triangulates
 * it as (0,1,2) (0,2,3).
 */
export function writeQuad(
  positions: Float32Array,
  quad: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  nx: number,
  nz: number,
  halfWidth: number,
  y: number,
): void {
  const o = quad * QUAD_FLOATS;
  const ox = nx * halfWidth;
  const oz = nz * halfWidth;
  positions[o] = ax - ox;
  positions[o + 1] = y;
  positions[o + 2] = az - oz;
  positions[o + 3] = ax + ox;
  positions[o + 4] = y;
  positions[o + 5] = az + oz;
  positions[o + 6] = bx + ox;
  positions[o + 7] = y;
  positions[o + 8] = bz + oz;
  positions[o + 9] = bx - ox;
  positions[o + 10] = y;
  positions[o + 11] = bz - oz;
}

/** Collapse a quad to a degenerate point so it rasterizes nothing. */
export function clearQuad(positions: Float32Array, quad: number): void {
  const o = quad * QUAD_FLOATS;
  for (let i = 0; i < QUAD_FLOATS; i++) positions[o + i] = 0;
}

/**
 * Fill `out` with `segments + 1` points of a jagged bolt from (x0,y0,z0) to (x1,y1,z1).
 *
 * The endpoints are written exactly; interior points are displaced on the plane
 * perpendicular to the bolt by up to `amplitude` sideways and `amplitude * 0.6` vertically,
 * tapered by a sine envelope so the bolt stays anchored at both ends. `bow` lifts the middle
 * so the arc reads as an upward curve rather than a noisy straight line.
 */
export function buildBoltPoints(
  out: Float32Array,
  segments: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  amplitude: number,
  bow: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const inv = len > 1e-5 ? 1 / len : 0;
  const ux = dx * inv;
  const uy = dy * inv;
  const uz = dz * inv;

  // side = normalize(cross(dir, worldUp)) -> horizontal, perpendicular to the bolt.
  let sx = -uz;
  let sz = ux;
  const sl = Math.sqrt(sx * sx + sz * sz);
  if (sl < 1e-4) {
    sx = 1;
    sz = 0;
  } else {
    sx /= sl;
    sz /= sl;
  }
  // up2 = cross(side, dir), with side.y == 0.
  const px = -sz * uy;
  const py = sz * ux - sx * uz;
  const pz = sx * uy;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let x = x0 + dx * t;
    let y = y0 + dy * t;
    let z = z0 + dz * t;
    if (i > 0 && i < segments) {
      const env = Math.sin(t * Math.PI);
      const j1 = (Math.random() * 2 - 1) * amplitude * env;
      const j2 = (Math.random() * 2 - 1) * amplitude * 0.6 * env + bow * env;
      x += sx * j1 + px * j2;
      y += py * j2;
      z += sz * j1 + pz * j2;
    }
    const o = i * 3;
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
  }
}

/**
 * Expand a polyline of `count` points into LineSegments vertex pairs.
 * Returns the number of vertices written.
 */
export function polylineToSegments(
  src: Float32Array,
  count: number,
  dst: Float32Array,
  dstVertOffset: number,
): number {
  let w = dstVertOffset * 3;
  for (let i = 0; i < count - 1; i++) {
    const a = i * 3;
    const b = a + 3;
    dst[w] = src[a];
    dst[w + 1] = src[a + 1];
    dst[w + 2] = src[a + 2];
    dst[w + 3] = src[b];
    dst[w + 4] = src[b + 1];
    dst[w + 5] = src[b + 2];
    w += 6;
  }
  return Math.max(0, (count - 1) * 2);
}

/** How many particles an accumulator releases this frame, capped so spikes cannot burst a pool. */
export function emissionCount(accum: number, maxPerFrame: number): number {
  if (accum < 1) return 0;
  const n = Math.floor(accum);
  return n > maxPerFrame ? maxPerFrame : n;
}
