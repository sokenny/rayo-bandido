import type * as THREE from 'three';
import { box, part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';

/**
 * Rear bumper: the diffuser with its strakes and the valance above it. Sold (`rearBumper.*`).
 *
 * Keep clear of three things other modules own: the number plate (`PLATE_MOUNT` in
 * `../plate.ts`, centred at (0, 0.53, 2.145)), the exhaust outlets (`exhaustOutlets` in
 * `./exhaustTips.ts`) and the tail/reverse lamps (`../lights.ts`, z ≈ 2.11–2.16).
 */
function stock(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  // Rear diffuser with strakes.
  const diffuser = box(1.56, 0.13, 0.54);
  diffuser.translate(0, 0.17, 1.85);
  out.push(part(diffuser, BODY_COLORS.CARBON_DARK));
  for (const x of [-0.58, -0.2, 0.2, 0.58]) {
    const fin = box(0.05, 0.18, 0.54);
    fin.translate(x, 0.16, 1.85);
    out.push(part(fin, BODY_COLORS.CARBON));
  }
  // Rear valance.
  const valance = box(1.34, 0.2, 0.06);
  valance.translate(0, 0.4, 2.11);
  out.push(part(valance, BODY_COLORS.CARBON_DARK));
  return out;
}

export const rearBumperSlot: SlotModule = {
  slot: 'rearBumper',
  variants: ['rearBumper.stock'],
  build(partId) {
    switch (partId) {
      default:
        return stock();
    }
  },
};
