import type * as THREE from 'three';
import { part, wheelArch } from '../geometryKit';
import { BODY_COLORS, CAR_DIMS, type SlotModule } from './common';

/**
 * Wide-body over-fenders, one arch over each wheel. Fixed: not sold on its own, but it is the
 * slot to widen if a pushed-out track (`ctx.loadout.stance.trackFront/Rear`) ever pokes the
 * tyres out past the arch — read the stance, never `VEHICLE`, for that.
 */
export const fendersSlot: SlotModule = {
  slot: 'fenders',
  variants: ['fenders.stock'],
  build() {
    const out: THREE.BufferGeometry[] = [];
    for (const z of [-CAR_DIMS.halfBase, CAR_DIMS.halfBase]) {
      for (const sign of [-1, 1]) {
        const arch = wheelArch(CAR_DIMS.wheelRadius + 0.07, 0.07, 0.22, 7);
        arch.translate(sign * 0.9, CAR_DIMS.wheelRadius, z);
        out.push(part(arch, BODY_COLORS.PAINT));
      }
    }
    return out;
  },
};
