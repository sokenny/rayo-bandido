import type { BlockRect, RailDef, Rect, RibbonDef, ZoneId } from './cityPlan';
import { inRect } from './cityPlan';
import { createProjection, projectOntoPath, segmentCount, type TrackPath, type TrackZone } from './track';

/**
 * City generation shared by the circuit and the big city: the block grid that grows around a
 * set of road ribbons, and the rail segments along their edges. Pure geometry, no Three.js.
 *
 * - `generateBlocks`: a grid of cells, each split in four wherever a ribbon (plus a shoulder)
 *   cuts through it, until the cell is clear or too small to matter. What survives is the
 *   city, with stepped building fronts along diagonal and curved roads.
 * - `buildRails`: the edge segments of every ribbon asked for, with a gap wherever another
 *   ribbon runs through at the same level — which is how alleys, ramps and merges join.
 *
 * Elevation: a segment of ribbon that is off the ground (`elevatedAbove`) needs only a narrow
 * corridor under it for its pillars, not a street's shoulder, and a rail on it only counts
 * as crossed by roads at its own height, never by the street it flies over.
 */

/** mulberry32: small, fast, and the same sequence for the same seed on every machine. */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ geometry helpers */

export function segmentRectDistance(ax: number, az: number, bx: number, bz: number, r: Rect): number {
  // Any endpoint inside, or the segment crossing an edge, means contact.
  if (inRect(r, ax, az) || inRect(r, bx, bz)) return 0;
  const corners: Array<[number, number]> = [
    [r.minX, r.minZ],
    [r.maxX, r.minZ],
    [r.maxX, r.maxZ],
    [r.minX, r.maxZ],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx, cz] = corners[i];
    const [dx, dz] = corners[(i + 1) % 4];
    if (segmentsIntersect(ax, az, bx, bz, cx, cz, dx, dz)) return 0;
  }
  let best = Infinity;
  best = Math.min(best, pointRectDistance(ax, az, r), pointRectDistance(bx, bz, r));
  for (const [cx, cz] of corners) best = Math.min(best, pointSegmentDistance(cx, cz, ax, az, bx, bz));
  return best;
}

export function segmentsIntersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function pointRectDistance(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

export function pointSegmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

/* ------------------------------------------------------------------ blocks */

export interface BlockOptions {
  /** Coarsest / finest block cell (m). */
  cell: number;
  minCell: number;
  /** Shoulder between a road edge and the first building, per zone (m). */
  shoulder: Record<TrackZone, number>;
  alleyShoulder: number;
  /** Corridor either side of a viaduct's footprint (m); the pillars live in it. */
  elevatedShoulder: number;
  /** Height above which a ribbon segment counts as flying over, not running through. */
  elevatedAbove: number;
  /** Height band of a surviving cell. */
  massingFor(rect: Rect, zone: ZoneId): 1 | 2 | 3 | 4;
  /**
   * When a straight, axis-aligned road cuts a cell, split the cell along that road (the
   * road strip is dropped, the two sides are kept whole) instead of quartering it. Grid
   * cities get real blocks this way; the circuit's sweepers still get the stepped fronts.
   */
  axisSplit?: boolean;
  /**
   * Glue neighbouring cells back together when their union is a rectangle no bigger than
   * this (m). The quartering along a diagonal leaves a staircase of tiny cells; merged, they
   * become the strips of row buildings a diagonal cuts through a grid.
   */
  mergeUpTo?: number;
}

export const RACE_BLOCK_OPTIONS: BlockOptions = {
  cell: 46,
  minCell: 11,
  shoulder: { corporate: 9, urban: 3.6, jdm: 3 },
  alleyShoulder: 1.2,
  elevatedShoulder: 1.5,
  elevatedAbove: 2.5,
  massingFor(rect, zone) {
    const w = rect.maxX - rect.minX;
    const d = rect.maxZ - rect.minZ;
    const small = w < 20 || d < 20;
    return small ? 1 : zone === 'corporate' ? 3 : zone === 'urban' ? 2 : 1;
  },
};

/** A straight, axis-aligned stretch of road: the constant coordinate and the half extent to clear. */
interface StraightRun {
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  clear: number;
}

interface RibbonBox {
  rb: RibbonDef;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  runs: StraightRun[];
}

/** Shortest stretch of straight road worth splitting a cell along (m). */
const MIN_RUN = 20;

/**
 * Maximal stretches of consecutive samples sharing one x (or one z) and one zone. A closed
 * loop yields its legs; a ramp its straight climb; a curve nothing.
 */
function straightRuns(rb: RibbonDef, opts: BlockOptions): StraightRun[] {
  const runs: StraightRun[] = [];
  const samples = rb.path.samples;
  const shoulderOf = (i: number): number => {
    const s = samples[i];
    const flying = s.y > opts.elevatedAbove;
    return flying ? opts.elevatedShoulder : rb.kind === 'alley' ? opts.alleyShoulder : opts.shoulder[s.zone];
  };
  for (const axis of ['x', 'z'] as const) {
    let start = 0;
    while (start < samples.length) {
      const a = samples[start];
      let end = start;
      let clear = a.halfWidth + shoulderOf(start);
      while (end + 1 < samples.length) {
        const n = samples[end + 1];
        const same = axis === 'z' ? Math.abs(n.x - a.x) < 0.05 : Math.abs(n.z - a.z) < 0.05;
        if (!same || n.zone !== a.zone || (n.y > opts.elevatedAbove) !== (a.y > opts.elevatedAbove)) break;
        end++;
        clear = Math.max(clear, n.halfWidth + shoulderOf(end));
      }
      const b = samples[end];
      const from = axis === 'z' ? Math.min(a.z, b.z) : Math.min(a.x, b.x);
      const to = axis === 'z' ? Math.max(a.z, b.z) : Math.max(a.x, b.x);
      if (to - from >= MIN_RUN) runs.push({ axis, at: axis === 'z' ? a.x : a.z, from, to, clear });
      start = end + 1;
    }
  }
  return runs;
}

/** Bounding box of a ribbon grown by its widest cross-section and the widest shoulder. */
function ribbonBoxes(ribbons: readonly RibbonDef[], opts: BlockOptions): RibbonBox[] {
  const maxShoulder = Math.max(opts.shoulder.corporate, opts.shoulder.urban, opts.shoulder.jdm, opts.alleyShoulder, opts.elevatedShoulder);
  return ribbons.map((rb) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let reach = 0;
    for (const s of rb.path.samples) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.z < minZ) minZ = s.z;
      if (s.z > maxZ) maxZ = s.z;
      if (s.halfWidth > reach) reach = s.halfWidth;
    }
    reach += maxShoulder + 1;
    return { rb, minX: minX - reach, maxX: maxX + reach, minZ: minZ - reach, maxZ: maxZ + reach, runs: opts.axisSplit ? straightRuns(rb, opts) : [] };
  });
}

/**
 * A straight road that runs through the cell (at least half its span, so a dead-end alley
 * still splits the block it enters) and cuts it with something left on at least one side.
 * Null when there is none.
 */
function axisSplitter(r: Rect, boxes: readonly RibbonBox[], minCell: number): StraightRun | null {
  for (const box of boxes) {
    if (r.maxX < box.minX || r.minX > box.maxX || r.maxZ < box.minZ || r.minZ > box.maxZ) continue;
    for (const st of box.runs) {
      const lo = st.at - st.clear;
      const hi = st.at + st.clear;
      // The cell's extent along the road and across it.
      const alongMin = st.axis === 'z' ? r.minZ : r.minX;
      const alongMax = st.axis === 'z' ? r.maxZ : r.maxX;
      const acrossMin = st.axis === 'z' ? r.minX : r.minZ;
      const acrossMax = st.axis === 'z' ? r.maxX : r.maxZ;
      const overlap = Math.min(st.to, alongMax) - Math.max(st.from, alongMin);
      if (overlap < (alongMax - alongMin) * 0.5) continue;
      // The road must actually cross the cell, not just graze a corner.
      if (hi <= acrossMin + 1e-3 || lo >= acrossMax - 1e-3) continue;
      const leftW = lo - acrossMin;
      const rightW = acrossMax - hi;
      const leftOk = leftW >= minCell * 0.6;
      const rightOk = rightW >= minCell * 0.6;
      if (!leftOk && !rightOk) continue;
      return st;
    }
  }
  return null;
}

/** Smallest clearance between the rect and any ribbon, minus that ribbon's width and shoulder. */
function rectClearance(r: Rect, boxes: readonly RibbonBox[], opts: BlockOptions): number {
  let best = Infinity;
  for (const box of boxes) {
    if (r.maxX < box.minX || r.minX > box.maxX || r.maxZ < box.minZ || r.minZ > box.maxZ) continue;
    const rb = box.rb;
    const samples = rb.path.samples;
    const segs = segmentCount(rb.path);
    for (let i = 0; i < segs; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % samples.length];
      const flying = a.y > opts.elevatedAbove && b.y > opts.elevatedAbove;
      const shoulder = flying ? opts.elevatedShoulder : rb.kind === 'alley' ? opts.alleyShoulder : opts.shoulder[a.zone];
      const d = segmentRectDistance(a.x, a.z, b.x, b.z, r) - Math.max(a.halfWidth, b.halfWidth) - shoulder;
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Recursive grid: a cell that a road runs through is split in four until it is clear or too
 * small to matter. What survives is the city.
 */
export function generateBlocks(
  inner: Rect,
  ribbons: readonly RibbonDef[],
  zoneAt: (x: number, z: number) => ZoneId,
  opts: BlockOptions = RACE_BLOCK_OPTIONS,
  keep: (r: Rect) => boolean = () => true,
): BlockRect[] {
  const blocks: BlockRect[] = [];
  const cells: Rect[] = [];
  const boxes = ribbonBoxes(ribbons, opts);
  const CELL = opts.cell;
  const MIN_CELL = opts.minCell;
  const cols = Math.max(1, Math.round((inner.maxX - inner.minX) / CELL));
  const rows = Math.max(1, Math.round((inner.maxZ - inner.minZ) / CELL));
  const cw = (inner.maxX - inner.minX) / cols;
  const ch = (inner.maxZ - inner.minZ) / rows;
  let n = 0;

  const visit = (r: Rect, depth: number): void => {
    if (!keep(r)) {
      // Something else owns this ground (water): split it down so the shore follows the edge.
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      if (w <= MIN_CELL && d <= MIN_CELL) return;
    } else {
      const clear = rectClearance(r, boxes, opts);
      if (clear >= 0) {
        const w = r.maxX - r.minX;
        const d = r.maxZ - r.minZ;
        if (w < MIN_CELL * 0.6 || d < MIN_CELL * 0.6) return;
        cells.push({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ });
        return;
      }
    }
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    if (w <= MIN_CELL && d <= MIN_CELL) return;
    if (opts.axisSplit) {
      const st = axisSplitter(r, boxes, MIN_CELL);
      if (st) {
        const lo = st.at - st.clear;
        const hi = st.at + st.clear;
        const small = MIN_CELL * 0.6;
        if (st.axis === 'z') {
          if (lo - r.minX >= small) visit({ minX: r.minX, maxX: lo, minZ: r.minZ, maxZ: r.maxZ }, depth + 1);
          if (r.maxX - hi >= small) visit({ minX: hi, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ }, depth + 1);
        } else {
          if (lo - r.minZ >= small) visit({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: lo }, depth + 1);
          if (r.maxZ - hi >= small) visit({ minX: r.minX, maxX: r.maxX, minZ: hi, maxZ: r.maxZ }, depth + 1);
        }
        return;
      }
    }
    // Split the longer axis (both when the cell is still big).
    const splitX = w > MIN_CELL && (w >= d || d <= MIN_CELL);
    const splitZ = d > MIN_CELL && (d >= w || w <= MIN_CELL);
    const mx = (r.minX + r.maxX) / 2;
    const mz = (r.minZ + r.maxZ) / 2;
    const xs = splitX ? [r.minX, mx, r.maxX] : [r.minX, r.maxX];
    const zs = splitZ ? [r.minZ, mz, r.maxZ] : [r.minZ, r.maxZ];
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < zs.length - 1; j++) {
        visit({ minX: xs[i], maxX: xs[i + 1], minZ: zs[j], maxZ: zs[j + 1] }, depth + 1);
      }
    }
  };

  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      visit(
        { minX: inner.minX + cw * i, maxX: inner.minX + cw * (i + 1), minZ: inner.minZ + ch * j, maxZ: inner.minZ + ch * (j + 1) },
        0,
      );
    }
  }
  const merged = opts.mergeUpTo ? mergeCells(cells, opts.mergeUpTo) : cells;
  for (const r of merged) {
    const zone = zoneAt((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2);
    blocks.push({ tag: `blk-${n++}`, minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, zone, massing: opts.massingFor(r, zone) });
  }
  return blocks;
}

const EPS = 1e-4;

/** Two rects whose union is a rectangle: side by side with the same span across. */
function unionRect(a: Rect, b: Rect): Rect | null {
  const sameZ = Math.abs(a.minZ - b.minZ) < EPS && Math.abs(a.maxZ - b.maxZ) < EPS;
  const sameX = Math.abs(a.minX - b.minX) < EPS && Math.abs(a.maxX - b.maxX) < EPS;
  if (sameZ && (Math.abs(a.maxX - b.minX) < EPS || Math.abs(b.maxX - a.minX) < EPS)) {
    return { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: a.minZ, maxZ: a.maxZ };
  }
  if (sameX && (Math.abs(a.maxZ - b.minZ) < EPS || Math.abs(b.maxZ - a.minZ) < EPS)) {
    return { minX: a.minX, maxX: a.maxX, minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) };
  }
  return null;
}

/** Greedy: keep gluing pairs whose union is a rectangle within `maxSize` until nothing joins. */
export function mergeCells(cells: readonly Rect[], maxSize: number): Rect[] {
  let list = cells.map((c) => ({ ...c }));
  let changed = true;
  while (changed) {
    changed = false;
    const next: Rect[] = [];
    const used = new Array<boolean>(list.length).fill(false);
    // Smallest first, so the dust along a diagonal gets swept into its neighbours.
    const order = list.map((_, i) => i).sort((i, j) => area(list[i]) - area(list[j]));
    for (const i of order) {
      if (used[i]) continue;
      const a = list[i];
      let merged: Rect | null = null;
      let partner = -1;
      let best = Infinity;
      for (let j = 0; j < list.length; j++) {
        if (j === i || used[j]) continue;
        const u = unionRect(a, list[j]);
        if (!u) continue;
        if (u.maxX - u.minX > maxSize || u.maxZ - u.minZ > maxSize) continue;
        // Prefer the join that keeps the block squarest.
        const shape = Math.max(u.maxX - u.minX, u.maxZ - u.minZ) / Math.min(u.maxX - u.minX, u.maxZ - u.minZ);
        if (shape < best) {
          best = shape;
          merged = u;
          partner = j;
        }
      }
      if (merged) {
        used[i] = true;
        used[partner] = true;
        next.push(merged);
        changed = true;
      } else {
        used[i] = true;
        next.push(a);
      }
    }
    list = next;
  }
  return list;
}

function area(r: Rect): number {
  return (r.maxX - r.minX) * (r.maxZ - r.minZ);
}

/* ------------------------------------------------------------------ rails */

/** Height difference under which two roads at a point count as the same level (m). */
export const SAME_LEVEL = 3;

const RAIL_PROJ = createProjection();

interface PathBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
const PATH_BOXES = new WeakMap<TrackPath, PathBox>();

/** Bounding box of a path grown by its widest half width, cached per path. */
export function pathBox(path: TrackPath): PathBox {
  let box = PATH_BOXES.get(path);
  if (box) return box;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let reach = 0;
  for (const s of path.samples) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.z < minZ) minZ = s.z;
    if (s.z > maxZ) maxZ = s.z;
    if (s.halfWidth > reach) reach = s.halfWidth;
  }
  box = { minX: minX - reach, maxX: maxX + reach, minZ: minZ - reach, maxZ: maxZ + reach };
  PATH_BOXES.set(path, box);
  return box;
}

/**
 * True when (x, z) at height `y` lies on `rb`'s road at that level: the gap test for rails
 * and paint. A street under a viaduct does not cut the viaduct's rail.
 */
export function onRibbonAtLevel(rb: RibbonDef, x: number, z: number, y: number, pad: number): boolean {
  const box = pathBox(rb.path);
  if (x < box.minX - pad || x > box.maxX + pad || z < box.minZ - pad || z > box.maxZ + pad) return false;
  const p = projectOntoPath(rb.path, x, z, RAIL_PROJ);
  if (p.dist > p.halfWidth + pad) return false;
  return Math.abs(p.y - y) < SAME_LEVEL;
}

/**
 * Edge segments of every ribbon `wants` accepts, with gaps wherever another ribbon runs
 * through at the same level.
 */
export function buildRails(ribbons: readonly RibbonDef[], wants: (rb: RibbonDef) => boolean = () => true): RailDef[] {
  const rails: RailDef[] = [];
  for (const rb of ribbons) {
    if (!wants(rb)) continue;
    const samples = rb.path.samples;
    const segs = segmentCount(rb.path);
    for (const side of [-1, 1]) {
      for (let i = 0; i < segs; i++) {
        const a = samples[i];
        const b = samples[(i + 1) % samples.length];
        const ax = a.x + -a.tz * a.halfWidth * side;
        const az = a.z + a.tx * a.halfWidth * side;
        const bx = b.x + -b.tz * b.halfWidth * side;
        const bz = b.z + b.tx * b.halfWidth * side;
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        const my = (a.y + b.y) / 2;
        let open = false;
        for (const other of ribbons) {
          if (other === rb) continue;
          // The gap is a little wider than the other road so the corner posts stay clear of it.
          if (onRibbonAtLevel(other, mx, mz, my, 1.6)) {
            open = true;
            break;
          }
        }
        if (open) continue;
        rails.push({ ax, az, bx, bz, ay: a.y, by: b.y, kind: rb.kind === 'alley' ? 'wall' : 'rail', zone: a.zone });
      }
    }
  }
  return rails;
}

/** Height bounds of the collider a rail becomes: solid for its own level, open to the ones above and below. */
export function railBounds(r: RailDef): { minY: number; maxY: number } {
  const lo = Math.min(r.ay, r.by);
  const hi = Math.max(r.ay, r.by);
  // A deck lower than a car's roof plus its own thickness still blocks the street: the
  // bottom bound only clears the ground once the slab is high enough to drive under.
  return { minY: lo - 3.2, maxY: hi + 4 };
}
