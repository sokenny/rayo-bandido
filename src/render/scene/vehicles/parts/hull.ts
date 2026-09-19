import { loft, part, type LoftSection } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';

/**
 * The hull's cross-sections, front to rear. Exported so the parts that sit ON the hull (hood
 * scoops, carbon skins, ducktails, wing stanchions) can follow its surface instead of guessing
 * it: `hullAt(z)` in `./kit.ts` interpolates them.
 */
export const HULL_SECTIONS: readonly LoftSection[] = [
  { z: -2.1, bottomY: 0.28, topY: 0.6, bottomHalfWidth: 0.66, topHalfWidth: 0.74 },
  { z: -1.86, bottomY: 0.15, topY: 0.68, bottomHalfWidth: 0.82, topHalfWidth: 0.88 },
  { z: -1.3, bottomY: 0.12, topY: 0.79, bottomHalfWidth: 0.86, topHalfWidth: 0.9 },
  { z: -0.72, bottomY: 0.12, topY: 0.86, bottomHalfWidth: 0.88, topHalfWidth: 0.89 },
  { z: 0.3, bottomY: 0.12, topY: 0.89, bottomHalfWidth: 0.89, topHalfWidth: 0.87 },
  { z: 1.3, bottomY: 0.13, topY: 0.89, bottomHalfWidth: 0.9, topHalfWidth: 0.88 },
  { z: 1.9, bottomY: 0.19, topY: 0.86, bottomHalfWidth: 0.86, topHalfWidth: 0.82 },
  { z: 2.12, bottomY: 0.34, topY: 0.77, bottomHalfWidth: 0.76, topHalfWidth: 0.72 },
];

/** Main hull: wide low nose, long hood, rising beltline, tucked tail. Fixed: not sold. */
export const hullSlot: SlotModule = {
  slot: 'hull',
  variants: ['hull.stock'],
  build() {
    return [part(loft(HULL_SECTIONS.map((s) => ({ ...s }))), BODY_COLORS.PAINT)];
  },
};
