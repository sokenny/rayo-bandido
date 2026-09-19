import type * as THREE from 'three';
import { box, part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';

/**
 * Side skirts. Sold (`skirts.*`). The underglow's rocker strips (`../underglow.ts`) run just
 * outside them at x = ±0.995, y = 0.11: a deeper skirt should not bury them.
 */
function stock(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const skirt = box(0.09, 0.17, 2.24);
    skirt.translate(sign * 0.94, 0.18, 0);
    out.push(part(skirt, BODY_COLORS.CARBON));
  }
  return out;
}

export const skirtsSlot: SlotModule = {
  slot: 'skirts',
  variants: ['skirts.stock'],
  build(partId) {
    switch (partId) {
      default:
        return stock();
    }
  },
};
