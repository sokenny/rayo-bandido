import type * as THREE from 'three';
import { box, part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';

/** Spoiler. Sold (`spoiler.*`). Stock is today's GT wing: plane, endplates, stanchions. */
function stock(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const wingPlane = box(1.76, 0.05, 0.34);
  wingPlane.rotateX(-0.14);
  wingPlane.translate(0, 1.24, 1.72);
  out.push(part(wingPlane, BODY_COLORS.CARBON));
  for (const sign of [-1, 1]) {
    const endplate = box(0.03, 0.24, 0.42);
    endplate.translate(sign * 0.87, 1.21, 1.72);
    out.push(part(endplate, BODY_COLORS.CARBON_DARK));
    const stanchion = box(0.05, 0.42, 0.14);
    stanchion.translate(sign * 0.55, 1.04, 1.7);
    out.push(part(stanchion, BODY_COLORS.CARBON_DARK));
  }
  return out;
}

export const spoilerSlot: SlotModule = {
  slot: 'spoiler',
  variants: ['spoiler.stock'],
  build(partId) {
    switch (partId) {
      default:
        return stock();
    }
  },
};
