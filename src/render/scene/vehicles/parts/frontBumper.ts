import type * as THREE from 'three';
import { box, loft, part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';

/**
 * Front bumper: the splitter/lip, the grille and the lower intake. Sold (`frontBumper.*` in
 * `src/content/parts/body.ts`). The head lights are NOT here — they are their own mesh
 * (`../lights.ts`), sitting at z ≈ -2.13 either side of x = ±0.44; a bumper must leave them room.
 */
function stock(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  // Front splitter / lip.
  out.push(
    part(
      loft([
        { z: -2.26, bottomY: 0.09, topY: 0.15, bottomHalfWidth: 0.74, topHalfWidth: 0.8 },
        { z: -2.0, bottomY: 0.09, topY: 0.2, bottomHalfWidth: 0.9, topHalfWidth: 0.94 },
        { z: -1.62, bottomY: 0.1, topY: 0.26, bottomHalfWidth: 0.94, topHalfWidth: 0.95 },
      ]),
      BODY_COLORS.CARBON,
    ),
  );
  // Grille and lower intake.
  const grille = box(1.0, 0.18, 0.05);
  grille.translate(0, 0.42, -2.11);
  out.push(part(grille, BODY_COLORS.GRILLE));
  const intake = box(1.24, 0.12, 0.05);
  intake.translate(0, 0.24, -2.16);
  out.push(part(intake, BODY_COLORS.GRILLE));
  return out;
}

export const frontBumperSlot: SlotModule = {
  slot: 'frontBumper',
  variants: ['frontBumper.stock'],
  build(partId) {
    switch (partId) {
      default:
        return stock();
    }
  },
};
