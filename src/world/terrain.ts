import type { SurfaceSample } from '../core/types';
import type { Rect } from './cityPlan';
// Spelt with its extension, and nothing else imported at runtime, so `scripts/metro-preview.mjs`
// can load the metro's spec (which draws its relief with this file) under plain Node.
import { pathBounds, type TrackPath } from './track.ts';

/**
 * TOPOGRAPHY. The ground of a city is a height field: a designer's RELIEF (`TerrainSpec.relief`,
 * a few broad hills, metres high, kilometres wide), flattened wherever the city has to stay at
 * y 0 and fenced by a grade limit everywhere else.
 *
 * What stays flat, and why: the elevated roads and their ramps keep their absolute heights, so
 * the ground under a deck, along its columns and round a ramp's foot is level with them (a ramp
 * meets its street at y 0, a pillar's foot is at y 0, drive-under clearance is what it was); the
 * lots (car meets, gas stations, the garage) are laid out flat and everything on them stands at
 * y 0; the quay and the water, because a shore is sea level; and the rectangles the spec names
 * (a downtown built of megastructures carved at absolute floors). From the edge of each of
 * those the ground may rise at no more than `maxGrade`, so a hill that would have run under the
 * viaduct instead dies away toward it in a straight, drivable slope that starts gently. The
 * relief and the fence are joined by a smooth minimum, so there is no crease where one takes
 * over from the other.
 *
 * Everything downstream reads one thing, `heightAt`: the surface field the cars settle on, the
 * ground mesh, the draped roads and pavements, the plinth every building is lifted onto, every
 * lamp, shelter, marker and figure that stands on the ground. Nothing else knows the hills.
 *
 * COST. The clearance from the protected set is computed once, on a grid, and interpolated;
 * the relief is analytic. A height is a handful of flops, and the field is asked for every
 * moving body every tick. A world without a `TerrainSpec` gets `FLAT_TERRAIN`, whose height is
 * a constant 0: those worlds build and behave exactly as they did before this file existed.
 */
export interface TerrainSpec {
  /** The designer's relief (m, never negative), before the world flattens what must stay flat. */
  relief(x: number, z: number): number;
  /** Steepest grade the flattening may impose (rise over run). Missing: `TERRAIN.maxGrade`. */
  maxGrade?: number;
  /** Rectangles kept at y 0 besides the lots and the elevated corridors: a downtown, a district. */
  flat?: Rect[];
}

export interface Terrain {
  /** True when the whole world is at y 0. Builders keep their one-quad fast paths on it. */
  readonly flat: boolean;
  /** Where the ground can be off y 0; it is exactly 0 outside. Null when flat. */
  readonly extent: Rect | null;
  /** Ground height at a point (m). 0 wherever the world is flat, and everywhere on a flat world. */
  heightAt(x: number, z: number): number;
  /** Height and gradient of the ground. Allocation-free; the surface field's ground candidate. */
  sample(x: number, z: number, out: SurfaceSample): void;
}

export const TERRAIN = {
  /** Steepest grade the flattening cone imposes: the hills themselves are drawn gentler than this. */
  maxGrade: 0.045,
  /** Clearance grid step (m). The protected set's edge is only exact at the nodes; `margin` covers the rest. */
  cell: 8,
  /** The ground is exactly level for this far past everything protected (m), before the cone begins. */
  margin: 10,
  /** How far past a deck's guardrail the ground is protected (m): its columns and their footings. */
  ribbonReach: 8,
  /** How far past a lot's edge (m). */
  lotPad: 6,
  /** How far inland from the quay the shore is level (m): the waterfront boulevard and its pavement. */
  shoreBand: 40,
  /**
   * Run over which the cone reaches its grade (m): it starts level and steepens gradually, so
   * crossing from held-level ground onto the slope is a curve, not a corner, and a crease of the
   * clearance field between two protected things a few metres apart raises no bump at all.
   */
  ease: 60,
  /** How far past the bounds the field is kept (m): the skyline stands on it. The relief must be 0 beyond. */
  apron: 320,
  /** Finite-difference step for the gradient (m). */
  gradeStep: 0.5,
} as const;

export const FLAT_TERRAIN: Terrain = {
  flat: true,
  extent: null,
  heightAt: () => 0,
  sample(_x, _z, out) {
    out.y = 0;
    out.gx = 0;
    out.gz = 0;
  },
};

/**
 * Smooth minimum of two heights: the p-norm `(a^-p + b^-p)^(-1/p)`, which is the smaller of the
 * two when they are apart by more than a few per cent, 89 % of either when they are equal, and
 * smooth in between. Its blend scales with the heights themselves, so near the ground it is as
 * tight as the ground is low and never dips below 0: a polynomial blend of fixed width was
 * driving the foot of every slope to 0 early and leaving a corner there. A relief drawn to stay
 * under the fence (`metroTerrain.ts`) hardly ever meets it, and where the two do cross the
 * join is a gentle change of grade rather than a crest.
 */
const SMIN_P = 6;

/** Distance from a point to a rectangle, 0 inside it (`cityGen.pointRectDistance`, repeated so this file imports nothing of it). */
function pointRectDistance(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

function smin(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return lo * Math.pow(1 + Math.pow(lo / hi, SMIN_P), -1 / SMIN_P);
}

/**
 * Build the terrain of a world. `elevated` are the paths the ground stays level under (their
 * absolute heights are kept), `lots` the rectangles laid out flat, `quayZ` where the water begins.
 */
export function createTerrain(
  spec: TerrainSpec | undefined,
  bounds: Rect,
  elevated: readonly TrackPath[],
  lots: readonly Rect[],
  quayZ: number | null,
): Terrain {
  if (!spec) return FLAT_TERRAIN;
  const maxGrade = spec.maxGrade ?? TERRAIN.maxGrade;
  const cell = TERRAIN.cell;
  const extent: Rect = {
    minX: Math.floor((bounds.minX - TERRAIN.apron) / cell) * cell,
    maxX: Math.ceil((bounds.maxX + TERRAIN.apron) / cell) * cell,
    minZ: Math.floor((bounds.minZ - TERRAIN.apron) / cell) * cell,
    maxZ: Math.ceil((bounds.maxZ + TERRAIN.apron) / cell) * cell,
  };
  const nx = Math.round((extent.maxX - extent.minX) / cell) + 1;
  const nz = Math.round((extent.maxZ - extent.minZ) / cell) + 1;

  // The protected rectangles, each with how far past its edge the ground stays level.
  const rects: Array<{ r: Rect; pad: number }> = [
    ...lots.map((r) => ({ r, pad: TERRAIN.lotPad })),
    ...(spec.flat ?? []).map((r) => ({ r, pad: 0 })),
  ];
  const boxes = elevated.map((p) => pathBounds(p));
  const reaches = elevated.map((p) => {
    let reach = 0;
    for (const s of p.samples) if (s.halfWidth > reach) reach = s.halfWidth;
    return reach + TERRAIN.ribbonReach;
  });

  // Clearance from the protected set at every node: 0 inside it, the distance to it outside.
  const clearance = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = extent.minZ + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = extent.minX + i * cell;
      let best = Infinity;
      for (const { r, pad } of rects) {
        const d = pointRectDistance(x, z, r) - pad;
        if (d < best) best = d;
      }
      if (quayZ !== null) {
        const d = quayZ - TERRAIN.shoreBand - z;
        if (d < best) best = d;
      }
      if (best > 0) {
        for (let p = 0; p < elevated.length; p++) {
          // A path whose box (grown by its reach) is further than the best so far cannot improve it.
          if (pointRectDistance(x, z, boxes[p]) - reaches[p] >= best) continue;
          const path = elevated[p];
          // Nearest segment by hand: the projection's own search, without the windowing.
          const samples = path.samples;
          const n = samples.length;
          const segs = path.closed ? n : n - 1;
          let nearest = 0;
          let nearestD2 = Infinity;
          for (let k = 0; k < segs; k++) {
            const a = samples[k];
            const b = samples[(k + 1) % n];
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const len2 = dx * dx + dz * dz;
            let t = len2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / len2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = a.x + dx * t - x;
            const pz = a.z + dz * t - z;
            const d2 = px * px + pz * pz;
            if (d2 < nearestD2) {
              nearestD2 = d2;
              nearest = k;
            }
          }
          const a = samples[nearest];
          const b = samples[(nearest + 1) % n];
          const halfWidth = (a.halfWidth + b.halfWidth) * 0.5;
          const d = Math.sqrt(nearestD2) - (halfWidth + TERRAIN.ribbonReach);
          if (d < best) best = d;
        }
      }
      clearance[j * nx + i] = best > 0 ? best : 0;
    }
  }

  const clearanceAt = (x: number, z: number): number => {
    const fx = (x - extent.minX) / cell;
    const fz = (z - extent.minZ) / cell;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i < 0) i = 0;
    if (j < 0) j = 0;
    if (i > nx - 2) i = nx - 2;
    if (j > nz - 2) j = nz - 2;
    const u = Math.min(1, Math.max(0, fx - i));
    const v = Math.min(1, Math.max(0, fz - j));
    const k = j * nx + i;
    const c00 = clearance[k];
    const c10 = clearance[k + 1];
    const c01 = clearance[k + nx];
    const c11 = clearance[k + nx + 1];
    return (c00 * (1 - u) + c10 * u) * (1 - v) + (c01 * (1 - u) + c11 * u) * v;
  };

  /** The fence: level for `margin`, then a grade easing up to `maxGrade` over `ease`, then straight. */
  const ease = TERRAIN.ease;
  const cone = (clearance: number): number => {
    const d = clearance - TERRAIN.margin;
    if (d <= 0) return 0;
    if (d < ease) return (maxGrade * d * d) / (2 * ease);
    return maxGrade * (d - ease / 2);
  };

  const heightAt = (x: number, z: number): number => {
    if (x <= extent.minX || x >= extent.maxX || z <= extent.minZ || z >= extent.maxZ) return 0;
    const relief = spec.relief(x, z);
    if (relief <= 0) return 0;
    return smin(relief, cone(clearanceAt(x, z)));
  };

  const d = TERRAIN.gradeStep;
  return {
    flat: false,
    extent,
    heightAt,
    sample(x, z, out) {
      out.y = heightAt(x, z);
      out.gx = (heightAt(x + d, z) - heightAt(x - d, z)) / (2 * d);
      out.gz = (heightAt(x, z + d) - heightAt(x, z - d)) / (2 * d);
    },
  };
}

/**
 * A round or elliptical hill for a relief: `height` at the centre, 0 at `rx` / `rz` and beyond,
 * a raised cosine between (its steepest grade is `height * PI / (2 * r)`). Sum a few of these
 * and the city has a topography; keep them clear of what has to stay flat and the fence in
 * `createTerrain` has nothing to do.
 */
export interface HillDef {
  x: number;
  z: number;
  rx: number;
  rz: number;
  height: number;
}

export function hillHeight(h: HillDef, x: number, z: number): number {
  const u = (x - h.x) / h.rx;
  const v = (z - h.z) / h.rz;
  const r = Math.sqrt(u * u + v * v);
  if (r >= 1) return 0;
  return h.height * (0.5 + 0.5 * Math.cos(Math.PI * r));
}

export function reliefOf(hills: readonly HillDef[]): (x: number, z: number) => number {
  return (x, z) => {
    let y = 0;
    for (const h of hills) y += hillHeight(h, x, z);
    return y;
  };
}
