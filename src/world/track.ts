/**
 * Track geometry. Pure math, no Three.js, no imports: this file is shared by the simulation
 * (wall colliders, checkpoints, race progress), the renderer (asphalt ribbon, guardrails,
 * block placement) and the design tooling (`scripts/track-preview.mjs`).
 *
 * A track is a polygon whose corners are rounded with fillet arcs, the way real circuits are
 * drawn: every vertex carries the radius of the arc that replaces it. The path is then sampled
 * into a dense polyline of cross-sections (position, unit tangent, half width, zone, station),
 * which is the one representation everything downstream consumes.
 *
 * Conventions match `src/core/types.ts`: x east, z south, y up. The RIGHT-hand normal of a
 * tangent (tx, tz) is (-tz, tx). A positive turn angle is a right turn.
 */

export type TrackZone = 'corporate' | 'urban' | 'jdm';

export interface TrackNode {
  x: number;
  z: number;
  /**
   * Height of the road surface at this node (m). A node without one is not an anchor: the
   * height there is interpolated between the nearest anchors either side, so a curved ramp
   * with an unmarked middle node climbs in one smooth run instead of two. All nodes unmarked
   * = a flat road at y 0. Between anchors the grade eases in and out (`GRADE_EASE`).
   */
  y?: number;
  /** Fillet radius at this corner (m). Ignored at the two ends of an open path. */
  r: number;
  /** Full width of the road from here to the next node (m). Interpolated along straights. */
  width: number;
  /** Zone of the road from here to the next node. */
  zone: TrackZone;
  /** Optional name for the section that starts here (debug, tests, HUD). */
  tag?: string;
}

export interface TrackSpec {
  nodes: TrackNode[];
  closed: boolean;
  /** Largest gap between two samples on a straight (m). */
  straightStep?: number;
  /** Largest gap between two samples on an arc (m). */
  arcStep?: number;
}

export interface TrackSample {
  x: number;
  z: number;
  /** Height of the road surface here (m). 0 on a flat road. */
  y: number;
  /** Unit tangent along the direction of travel. */
  tx: number;
  tz: number;
  /** Station: distance along the path from the first sample (m). */
  s: number;
  halfWidth: number;
  zone: TrackZone;
  /** Signed curvature (1/m), positive on a right turn, 0 on a straight. */
  curvature: number;
  /** Index of the node whose section this sample belongs to. */
  node: number;
}

export interface TrackPath {
  samples: TrackSample[];
  closed: boolean;
  /** Total length (m). For a closed path this includes the segment back to sample 0. */
  length: number;
  /** Straights and arcs, in order, for tools and tests. */
  pieces: TrackPiece[];
}

export type TrackPiece =
  | { kind: 'straight'; from: number; to: number; length: number; node: number }
  | { kind: 'arc'; node: number; cx: number; cz: number; r: number; angle: number; length: number };

/** Result of projecting a point onto the path. Reused between calls; never allocated per tick. */
export interface PathProjection {
  /** Segment index (sample i -> i+1). */
  index: number;
  /** Fraction along that segment. */
  t: number;
  /** Station of the projected point (m). */
  s: number;
  /** Signed lateral offset: positive to the right of the direction of travel (m). */
  lateral: number;
  /** Unsigned distance to the centreline (m). */
  dist: number;
  /** Half width of the road at the projected point. */
  halfWidth: number;
  /** Tangent at the projected point. */
  tx: number;
  tz: number;
  /** The projected point itself, on the centreline. */
  x: number;
  z: number;
  /** Height of the road surface at the projected point (m). */
  y: number;
}

export function createProjection(): PathProjection {
  return { index: 0, t: 0, s: 0, lateral: 0, dist: 0, halfWidth: 0, tx: 0, tz: -1, x: 0, z: 0, y: 0 };
}

const DEFAULT_STRAIGHT_STEP = 8;
const DEFAULT_ARC_STEP = 3;
/**
 * Fraction of the run between two height anchors over which the grade builds up and, at the
 * other end, dies away. The grade is a trapezoid: linear in, flat, linear out, so a ramp has
 * no kink at either end and its steepest part is 1 / (1 - GRADE_EASE) times the average.
 */
export const GRADE_EASE = 0.22;

/** Fraction of a rise completed at fraction `u` of the run, with the trapezoid grade profile. */
export function easedRise(u: number, e = GRADE_EASE): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const g = 1 / (1 - e);
  if (u <= e) return (g * u * u) / (2 * e);
  if (u <= 1 - e) return g * (e / 2 + (u - e));
  const r = 1 - u;
  return 1 - (g * r * r) / (2 * e);
}

/**
 * Writes `y` onto every sample from the node heights. Anchors are the nodes that carry a
 * `y`, placed at the station where their section begins; between two anchors the height
 * follows `easedRise`. Open paths hold the first / last anchor's height beyond it; closed
 * paths wrap. No anchors at all is a flat road.
 */
function assignHeights(samples: TrackSample[], nodes: TrackNode[], closed: boolean, length: number): void {
  const n = nodes.length;
  const anchors: Array<{ s: number; y: number }> = [];
  for (let k = 0; k < n; k++) {
    const y = nodes[k].y;
    if (y === undefined) continue;
    // The anchor sits at the sample nearest the node: exactly on a plain node, and in the
    // middle of the turn on a filleted one. The two ends of an open path are its ends.
    let st: number;
    if (!closed && k === 0) st = 0;
    else if (!closed && k === n - 1) st = length;
    else {
      let best = Infinity;
      st = 0;
      for (const s of samples) {
        const d = (s.x - nodes[k].x) ** 2 + (s.z - nodes[k].z) ** 2;
        if (d < best) {
          best = d;
          st = s.s;
        }
      }
    }
    anchors.push({ s: st, y });
  }
  if (anchors.length === 0) {
    for (const s of samples) s.y = 0;
    return;
  }
  anchors.sort((a, b) => a.s - b.s);
  if (anchors.length === 1) {
    for (const s of samples) s.y = anchors[0].y;
    return;
  }
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  for (const smp of samples) {
    const st = smp.s;
    let a: { s: number; y: number };
    let b: { s: number; y: number };
    if (st < first.s) {
      if (!closed) {
        smp.y = first.y;
        continue;
      }
      a = { s: last.s - length, y: last.y };
      b = first;
    } else if (st >= last.s) {
      if (!closed) {
        smp.y = last.y;
        continue;
      }
      a = last;
      b = { s: first.s + length, y: first.y };
    } else {
      let i = 0;
      while (i < anchors.length - 2 && anchors[i + 1].s <= st) i++;
      a = anchors[i];
      b = anchors[i + 1];
    }
    const run = b.s - a.s;
    const u = run > 1e-6 ? (st - a.s) / run : 1;
    smp.y = a.y + (b.y - a.y) * easedRise(u);
  }
}

function pushSample(
  out: TrackSample[],
  x: number,
  z: number,
  tx: number,
  tz: number,
  halfWidth: number,
  zone: TrackZone,
  curvature: number,
  node: number,
): void {
  const prev = out[out.length - 1];
  const s = prev ? prev.s + Math.hypot(x - prev.x, z - prev.z) : 0;
  out.push({ x, z, y: 0, tx, tz, s, halfWidth, zone, curvature, node });
}

/**
 * Builds the sampled path. Throws when two fillets overlap on one edge, naming the edge, so a
 * bad design fails at build time (and in the unit tests) rather than drawing a broken road.
 */
export function buildTrackPath(spec: TrackSpec): TrackPath {
  const nodes = spec.nodes;
  const n = nodes.length;
  if (n < (spec.closed ? 3 : 2)) throw new Error('track: need at least 3 nodes (2 for an open path)');
  const straightStep = spec.straightStep ?? DEFAULT_STRAIGHT_STEP;
  const arcStep = spec.arcStep ?? DEFAULT_ARC_STEP;

  // Per node: the fillet, i.e. where the arc starts and ends, and its centre.
  interface Fillet {
    sx: number;
    sz: number;
    ex: number;
    ez: number;
    cx: number;
    cz: number;
    r: number;
    angle: number;
    /** Tangent length consumed on each adjacent edge. */
    t: number;
    d0x: number;
    d0z: number;
    d1x: number;
    d1z: number;
  }
  const fillets: Array<Fillet | null> = [];
  for (let i = 0; i < n; i++) {
    const isEnd = !spec.closed && (i === 0 || i === n - 1);
    if (isEnd) {
      fillets.push(null);
      continue;
    }
    const a = nodes[(i - 1 + n) % n];
    const v = nodes[i];
    const b = nodes[(i + 1) % n];
    let d0x = v.x - a.x;
    let d0z = v.z - a.z;
    let d1x = b.x - v.x;
    let d1z = b.z - v.z;
    const l0 = Math.hypot(d0x, d0z) || 1;
    const l1 = Math.hypot(d1x, d1z) || 1;
    d0x /= l0;
    d0z /= l0;
    d1x /= l1;
    d1z /= l1;
    const cross = d0x * d1z - d0z * d1x;
    const dot = d0x * d1x + d0z * d1z;
    const angle = Math.atan2(cross, dot);
    if (Math.abs(angle) < 1e-6 || v.r <= 0) {
      fillets.push({ sx: v.x, sz: v.z, ex: v.x, ez: v.z, cx: v.x, cz: v.z, r: 0, angle: 0, t: 0, d0x, d0z, d1x, d1z });
      continue;
    }
    const t = v.r * Math.tan(Math.abs(angle) / 2);
    const sx = v.x - d0x * t;
    const sz = v.z - d0z * t;
    const ex = v.x + d1x * t;
    const ez = v.z + d1z * t;
    const side = angle > 0 ? 1 : -1;
    // Right-hand normal of d0 is (-d0z, d0x); the centre sits on the inside of the turn.
    const cx = sx + -d0z * v.r * side;
    const cz = sz + d0x * v.r * side;
    fillets.push({ sx, sz, ex, ez, cx, cz, r: v.r, angle, t, d0x, d0z, d1x, d1z });
  }

  // Validate: the two fillets on one edge must not eat more than the edge.
  const edgeCount = spec.closed ? n : n - 1;
  for (let i = 0; i < edgeCount; i++) {
    const j = (i + 1) % n;
    const a = nodes[i];
    const b = nodes[j];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ta = fillets[i]?.t ?? 0;
    const tb = fillets[j]?.t ?? 0;
    if (ta + tb > len + 1e-6) {
      throw new Error(
        `track: fillets overlap on edge ${a.tag ?? i} -> ${b.tag ?? j} ` +
          `(${ta.toFixed(1)} + ${tb.toFixed(1)} > ${len.toFixed(1)} m)`,
      );
    }
  }

  const samples: TrackSample[] = [];
  const pieces: TrackPiece[] = [];

  /** Straight from (x0,z0) to (x1,z1) belonging to node `node`; width lerps w0 -> w1. */
  const straight = (x0: number, z0: number, x1: number, z1: number, w0: number, w1: number, zone: TrackZone, node: number, includeStart: boolean): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-6) return;
    const tx = (x1 - x0) / len;
    const tz = (z1 - z0) / len;
    const steps = Math.max(1, Math.ceil(len / straightStep));
    const from = samples.length - (includeStart ? 0 : 1);
    for (let k = includeStart ? 0 : 1; k <= steps; k++) {
      const u = k / steps;
      pushSample(samples, x0 + (x1 - x0) * u, z0 + (z1 - z0) * u, tx, tz, (w0 + (w1 - w0) * u) / 2, zone, 0, node);
    }
    pieces.push({ kind: 'straight', from: Math.max(0, from), to: samples.length - 1, length: len, node });
  };

  /** Arc of fillet `f` (node `node`), starting at its start point (which is already the last sample). */
  const arc = (f: Fillet, width: number, zone: TrackZone, node: number): void => {
    if (f.r <= 0 || Math.abs(f.angle) < 1e-6) return;
    const len = Math.abs(f.angle) * f.r;
    const steps = Math.max(2, Math.ceil(len / arcStep));
    const a0 = Math.atan2(f.sz - f.cz, f.sx - f.cx);
    const sign = f.angle > 0 ? 1 : -1;
    for (let k = 1; k <= steps; k++) {
      const a = a0 + f.angle * (k / steps);
      const x = f.cx + Math.cos(a) * f.r;
      const z = f.cz + Math.sin(a) * f.r;
      pushSample(samples, x, z, -Math.sin(a) * sign, Math.cos(a) * sign, width / 2, zone, sign / f.r, node);
    }
    pieces.push({ kind: 'arc', node, cx: f.cx, cz: f.cz, r: f.r, angle: f.angle, length: len });
  };

  if (spec.closed) {
    // Start at the end of node 0's fillet and walk every edge; the last edge closes the loop.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const fi = fillets[i]!;
      const fj = fillets[j]!;
      const vi = nodes[i];
      const vj = nodes[j];
      straight(fi.ex, fi.ez, fj.sx, fj.sz, vi.width, vj.width, vi.zone, i, i === 0);
      // The arc at node j belongs to node j's section (its width and zone).
      if (j !== 0) arc(fj, vj.width, vj.zone, j);
    }
    // Close: the arc at node 0 ends where sample 0 sits, so append it and drop the duplicate.
    const f0 = fillets[0]!;
    arc(f0, nodes[0].width, nodes[0].zone, 0);
    const last = samples[samples.length - 1];
    const first = samples[0];
    if (samples.length > 1 && Math.hypot(last.x - first.x, last.z - first.z) < 1e-3) samples.pop();
    // Zone/width bookkeeping for the closing piece.
    const closing = samples[samples.length - 1];
    const length = closing.s + Math.hypot(first.x - closing.x, first.z - closing.z);
    assignHeights(samples, nodes, true, length);
    return { samples, closed: true, length, pieces };
  }

  // Open path: node 0 and node n-1 are plain ends.
  for (let i = 0; i < n - 1; i++) {
    const j = i + 1;
    const fi = fillets[i];
    const fj = fillets[j];
    const vi = nodes[i];
    const vj = nodes[j];
    const x0 = fi ? fi.ex : vi.x;
    const z0 = fi ? fi.ez : vi.z;
    const x1 = fj ? fj.sx : vj.x;
    const z1 = fj ? fj.sz : vj.z;
    straight(x0, z0, x1, z1, vi.width, vj.width, vi.zone, i, i === 0);
    if (fj) arc(fj, vj.width, vj.zone, j);
  }
  const last = samples[samples.length - 1];
  assignHeights(samples, nodes, false, last.s);
  return { samples, closed: false, length: last.s, pieces };
}

/** Number of segments in the path (closed paths have one more than open ones). */
export function segmentCount(path: TrackPath): number {
  return path.closed ? path.samples.length : path.samples.length - 1;
}

/**
 * Projects (x, z) onto the path. Exhaustive unless `hint` is given, in which case only the
 * `window` segments around it are searched (the per-tick call site tracks a car that cannot
 * jump). Writes into `out` and returns it; allocation-free.
 */
export function projectOntoPath(
  path: TrackPath,
  x: number,
  z: number,
  out: PathProjection,
  hint = -1,
  window = 12,
): PathProjection {
  const samples = path.samples;
  const n = samples.length;
  const segs = segmentCount(path);
  let best = Infinity;
  let bestI = 0;
  let bestT = 0;
  const from = hint < 0 ? 0 : hint - window;
  const to = hint < 0 ? segs - 1 : hint + window;
  for (let k = from; k <= to; k++) {
    const i = path.closed ? ((k % segs) + segs) % segs : k;
    if (i < 0 || i >= segs) continue;
    const a = samples[i];
    const b = samples[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + dx * t - x;
    const pz = a.z + dz * t - z;
    const d2 = px * px + pz * pz;
    if (d2 < best) {
      best = d2;
      bestI = i;
      bestT = t;
    }
  }
  const a = samples[bestI];
  const b = samples[(bestI + 1) % n];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const tx = dx / len;
  const tz = dz / len;
  const px = a.x + dx * bestT;
  const pz = a.z + dz * bestT;
  // Right-hand normal is (-tz, tx).
  const lateral = (x - px) * -tz + (z - pz) * tx;
  out.index = bestI;
  out.t = bestT;
  out.s = a.s + len * bestT;
  out.lateral = lateral;
  out.dist = Math.sqrt(best);
  out.halfWidth = a.halfWidth + (b.halfWidth - a.halfWidth) * bestT;
  out.tx = tx;
  out.tz = tz;
  out.x = px;
  out.z = pz;
  out.y = a.y + (b.y - a.y) * bestT;
  return out;
}

const SCRATCH = createProjection();

/** Unsigned distance from a point to the centreline. Build-time helper (uses a shared scratch). */
export function distanceToPath(path: TrackPath, x: number, z: number): number {
  return projectOntoPath(path, x, z, SCRATCH).dist;
}

/** True when the point lies on the road, i.e. within half width (+ pad) of the centreline. */
export function isOnPath(path: TrackPath, x: number, z: number, pad = 0): boolean {
  const p = projectOntoPath(path, x, z, SCRATCH);
  return p.dist <= p.halfWidth + pad;
}

/** Position, tangent and half width at station `s` (wrapped on closed paths). Allocation-free. */
export function pointAtStation(path: TrackPath, s: number, out: PathProjection): PathProjection {
  const samples = path.samples;
  const n = samples.length;
  const L = path.length;
  if (path.closed) {
    s = ((s % L) + L) % L;
  } else {
    s = s < 0 ? 0 : s > L ? L : s;
  }
  // Binary search for the segment whose station range contains s.
  let lo = 0;
  let hi = segmentCount(path) - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].s <= s) lo = mid;
    else hi = mid - 1;
  }
  const a = samples[lo];
  const b = samples[(lo + 1) % n];
  const segLen = lo === n - 1 ? L - a.s : b.s - a.s;
  const t = segLen > 0 ? (s - a.s) / segLen : 0;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  out.index = lo;
  out.t = t;
  out.s = s;
  out.lateral = 0;
  out.dist = 0;
  out.halfWidth = a.halfWidth + (b.halfWidth - a.halfWidth) * t;
  out.tx = dx / len;
  out.tz = dz / len;
  out.x = a.x + dx * t;
  out.z = a.z + dz * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
}

/** Largest height on the path (m). 0 for a flat road. */
export function maxHeight(path: TrackPath): number {
  let y = 0;
  for (const s of path.samples) if (s.y > y) y = s.y;
  return y;
}

/** True when any part of the path is off the ground. */
export function isElevated(path: TrackPath): boolean {
  for (const s of path.samples) if (s.y > 0.05) return true;
  return false;
}

/** Steepest grade between two consecutive samples (rise over run). */
export function maxGrade(path: TrackPath): number {
  const samples = path.samples;
  const segs = segmentCount(path);
  let g = 0;
  for (let i = 0; i < segs; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    if (run < 1e-6) continue;
    const grade = Math.abs(b.y - a.y) / run;
    if (grade > g) g = grade;
  }
  return g;
}

/**
 * Convenience for build-time code: the centreline point at station `s` pushed `lateral`
 * metres to the right (negative = left), plus the tangent there. Allocates; not for the loop.
 */
export function offsetAtStation(
  path: TrackPath,
  s: number,
  lateral: number,
): { x: number; z: number; y: number; tx: number; tz: number; halfWidth: number; zone: TrackZone } {
  const p = pointAtStation(path, s, SCRATCH);
  return {
    x: p.x + -p.tz * lateral,
    z: p.z + p.tx * lateral,
    y: p.y,
    tx: p.tx,
    tz: p.tz,
    halfWidth: p.halfWidth,
    zone: path.samples[p.index].zone,
  };
}

/** Sharpest corner (smallest fillet radius) on the path, for tests and the design tool. */
export function minCornerRadius(path: TrackPath): number {
  let r = Infinity;
  for (const p of path.pieces) if (p.kind === 'arc' && p.r < r) r = p.r;
  return r;
}

/** Largest single-arc heading change on the path, in radians. */
export function maxCornerAngle(path: TrackPath): number {
  let a = 0;
  for (const p of path.pieces) if (p.kind === 'arc' && Math.abs(p.angle) > a) a = Math.abs(p.angle);
  return a;
}

/** Longest straight on the path (m). */
export function longestStraight(path: TrackPath): number {
  let l = 0;
  for (const p of path.pieces) if (p.kind === 'straight' && p.length > l) l = p.length;
  return l;
}
