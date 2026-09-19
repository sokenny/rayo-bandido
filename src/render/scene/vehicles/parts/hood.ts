import type * as THREE from 'three';
import { box, part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';

/**
 * Hood. Sold (`hood.*`). The hood panel itself is the hull's top between z ≈ -2.1 and -0.74
 * (`./hull.ts`); a hood part is what sits ON it — vents, a bulge, a carbon skin laid a few mm
 * proud of the hull. Stock is today's two carbon vents.
 */
function stock(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const vent = box(0.3, 0.05, 0.22);
    vent.translate(sign * 0.36, 0.78, -1.34);
    out.push(part(vent, BODY_COLORS.CARBON_DARK));
  }
  return out;
}

export const hoodSlot: SlotModule = {
  slot: 'hood',
  variants: ['hood.stock'],
  build(partId) {
    switch (partId) {
      default:
        return stock();
    }
  },
};
