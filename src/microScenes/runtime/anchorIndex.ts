import type { MicroSceneAnchor } from '../types';

/**
 * WHERE THE ANCHORS ARE, bucketed. Bandido Metro carries a few hundred of them and the director
 * asks "which are near the car" several times a second, so the answer is a grid lookup over the
 * cells the search radius touches rather than a walk of the whole list.
 *
 * Built once per world. Nothing allocates on lookup: the caller hands in the array to fill.
 */
export interface MicroSceneAnchorIndex {
  readonly anchors: readonly MicroSceneAnchor[];
  /** Every anchor within `radius` of (x, z), into `out`. Unordered, each once. */
  near(x: number, z: number, radius: number, out: MicroSceneAnchor[]): MicroSceneAnchor[];
  /** By id, for the debug tools and for `exclusiveWith`. */
  byId(id: string): MicroSceneAnchor | null;
}

/** Cell size (m). A touch wider than the widest scene spacing, so a search rarely spans many. */
const CELL = 64;

export function createAnchorIndex(anchors: readonly MicroSceneAnchor[]): MicroSceneAnchorIndex {
  const cells = new Map<number, MicroSceneAnchor[]>();
  const ids = new Map<string, MicroSceneAnchor>();
  const key = (i: number, j: number): number => (i + 32768) * 65536 + (j + 32768);
  const cellOf = (v: number): number => Math.floor(v / CELL);

  for (const a of anchors) {
    ids.set(a.id, a);
    const k = key(cellOf(a.transform.x), cellOf(a.transform.z));
    const list = cells.get(k);
    if (list) list.push(a);
    else cells.set(k, [a]);
  }

  return {
    anchors,

    near(x, z, radius, out) {
      out.length = 0;
      const r2 = radius * radius;
      const i0 = cellOf(x - radius);
      const i1 = cellOf(x + radius);
      const j0 = cellOf(z - radius);
      const j1 = cellOf(z + radius);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const list = cells.get(key(i, j));
          if (!list) continue;
          for (let k = 0; k < list.length; k++) {
            const a = list[k];
            const dx = a.transform.x - x;
            const dz = a.transform.z - z;
            if (dx * dx + dz * dz <= r2) out.push(a);
          }
        }
      }
      return out;
    },

    byId(id) {
      return ids.get(id) ?? null;
    },
  };
}
