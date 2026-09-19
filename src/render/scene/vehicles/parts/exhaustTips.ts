import * as THREE from 'three';
import type { PartId } from '../../../../core/loadout';
import { part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';

/**
 * Exhaust tips. Sold (`exhaustTips.*`: single, the stock twin rounds, cannon, quad, side exit).
 *
 * `exhaustOutlets(partId)` is this slot's second export and a CONTRACT with `../lights.ts`:
 * the nitro/exhaust glow discs are drawn at exactly these points, so a new tip layout must list
 * its outlets here or the flame will hang in the air where the old pipes were.
 */
export interface ExhaustOutlet {
  x: number;
  y: number;
  /** The mouth of the pipe, where the glow disc sits (it faces +Z). */
  z: number;
  /** Radius of the glow disc. */
  radius: number;
}

const STOCK_OUTLETS: readonly ExhaustOutlet[] = [
  { x: -0.34, y: 0.33, z: 2.245, radius: 0.072 },
  { x: 0.34, y: 0.33, z: 2.245, radius: 0.072 },
];

/** Where the flame comes out, per tip part. Unknown ids get stock's. */
export function exhaustOutlets(partId: PartId): readonly ExhaustOutlet[] {
  switch (partId) {
    default:
      return STOCK_OUTLETS;
  }
}

/** Dual round tips: a chrome pipe and a dark rim each side. */
function stock(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const tip = new THREE.CylinderGeometry(0.078, 0.078, 0.2, 10, 1, true);
    tip.rotateX(Math.PI / 2);
    tip.translate(sign * 0.34, 0.33, 2.14);
    out.push(part(tip, BODY_COLORS.CHROME));
    const rim = new THREE.RingGeometry(0.05, 0.078, 10, 1);
    rim.translate(sign * 0.34, 0.33, 2.24);
    out.push(part(rim, BODY_COLORS.CARBON_DARK));
  }
  return out;
}

export const exhaustTipsSlot: SlotModule = {
  slot: 'exhaustTips',
  variants: ['exhaustTips.stock'],
  build(partId) {
    switch (partId) {
      default:
        return stock();
    }
  },
};
