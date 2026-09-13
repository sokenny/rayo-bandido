import type { Rect } from './cityPlan';

/**
 * A grid of buckets over a set of rectangles, for the "which of these is at (x, z)" questions
 * the city asks millions of times while it is built: the kerb field marching out to the
 * nearest block face, the plan's `isSolid`, a skybridge probing for the building either side
 * of a street. Bandido Bay has a few hundred blocks and answered them by walking the whole
 * list; Bandido Metro has thousands, and the walk is what made it minutes instead of seconds.
 *
 * Pure geometry, no allocation on lookup. A rectangle is filed in every cell it touches once
 * grown by `grow`, so a caller may test each entry grown by up to that much (shrunk or exact
 * tests need nothing); `at` returns the cell's list and the caller applies its own test.
 */
export interface RectIndex<T extends Rect> {
  /** The rectangles that touch the cell containing (x, z). Shared array: do not keep it. */
  at(x: number, z: number): readonly T[];
  /** Every rectangle whose cell-box overlaps the rect [x0, x1] x [z0, z1], each once. */
  within(x0: number, z0: number, x1: number, z1: number, out: T[]): T[];
}

const NONE: never[] = [];

export function createRectIndex<T extends Rect>(rects: readonly T[], cell = 32, grow = 4): RectIndex<T> {
  const cells = new Map<number, T[]>();
  const key = (i: number, j: number): number => (i + 65536) * 131072 + (j + 65536);
  const cellOf = (v: number): number => Math.floor(v / cell);
  for (const r of rects) {
    const i0 = cellOf(r.minX - grow);
    const i1 = cellOf(r.maxX + grow);
    const j0 = cellOf(r.minZ - grow);
    const j1 = cellOf(r.maxZ + grow);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        const list = cells.get(k);
        if (list) list.push(r);
        else cells.set(k, [r]);
      }
    }
  }
  return {
    at(x, z) {
      return cells.get(key(cellOf(x), cellOf(z))) ?? NONE;
    },
    within(x0, z0, x1, z1, out) {
      out.length = 0;
      const seen = new Set<T>();
      for (let i = cellOf(x0); i <= cellOf(x1); i++) {
        for (let j = cellOf(z0); j <= cellOf(z1); j++) {
          const list = cells.get(key(i, j));
          if (!list) continue;
          for (const r of list) {
            if (seen.has(r)) continue;
            seen.add(r);
            out.push(r);
          }
        }
      }
      return out;
    },
  };
}
