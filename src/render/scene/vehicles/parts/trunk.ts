import type * as THREE from 'three';
import { type SlotModule } from './common';

/**
 * Trunk lid. Sold (`trunk.*`: plain, ducktail, carbon). Like the hood, the deck itself is the
 * hull's (`./hull.ts`, top between z ≈ 1.58 and 2.12); a trunk part sits on it. Stock adds
 * nothing — today's car has no separate trunk piece — so it returns an empty list, which the
 * assembler merges as nothing at all.
 */
export const trunkSlot: SlotModule = {
  slot: 'trunk',
  variants: ['trunk.stock'],
  build(partId): THREE.BufferGeometry[] {
    switch (partId) {
      default:
        return [];
    }
  },
};
