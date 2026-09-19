import type * as THREE from 'three';
import { box, part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';

/** Door mirrors: a stalk and a housing each side. Fixed: not sold. */
export const mirrorsSlot: SlotModule = {
  slot: 'mirrors',
  variants: ['mirrors.stock'],
  build() {
    const out: THREE.BufferGeometry[] = [];
    for (const sign of [-1, 1]) {
      const stalk = box(0.14, 0.04, 0.05);
      stalk.translate(sign * 0.88, 0.92, -0.56);
      out.push(part(stalk, BODY_COLORS.CARBON_DARK));
      const housing = box(0.16, 0.09, 0.12);
      housing.rotateY(sign * 0.14);
      housing.translate(sign * 0.99, 0.95, -0.58);
      out.push(part(housing, BODY_COLORS.CARBON));
    }
    return out;
  },
};
