import type * as THREE from 'three';
import { box, loft, part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';
import { boxPart, mirrored } from './kit';

/**
 * Front bumper: the splitter/lip, the grille and the lower intake. Sold (`frontBumper.*` in
 * `src/content/parts/body.ts`). The head lights are NOT here — they are their own mesh
 * (`../lights.ts`), sitting at z ≈ -2.13 either side of x = ±0.44; a bumper must leave them room.
 *
 * Aftermarket bumpers share one painted apron under the nose (`apron`), which stops at
 * z = -1.74 so the front tyres can steer to full lock behind it at any stance, and keep their
 * upper grille inside |x| ≤ 0.23 so the lamps are never covered. Keep-out zones: `./kit.ts`.
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

/** Front face of the apron (z) and its top there: the plane intakes and mesh sit on. */
const APRON_FRONT = -2.2;

/**
 * The painted lower bumper that fills under the nose (the hull's own nose stops at y = 0.28).
 * Front face at z = -2.2 from y = 0.13 to `frontTop`, rear edge at z = -1.74 in front of the
 * tyres. 20 tris.
 */
function apron(frontTop = 0.3, color: number = BODY_COLORS.PAINT): THREE.BufferGeometry {
  return part(
    loft([
      { z: APRON_FRONT, bottomY: 0.13, topY: frontTop, bottomHalfWidth: 0.68, topHalfWidth: 0.7 },
      { z: -2.0, bottomY: 0.125, topY: frontTop + 0.03, bottomHalfWidth: 0.84, topHalfWidth: 0.82 },
      { z: -1.74, bottomY: 0.13, topY: 0.3, bottomHalfWidth: 0.92, topHalfWidth: 0.9 },
    ]),
    color,
  );
}

/** The upper grille between the lamps. */
function upperGrille(height = 0.14): THREE.BufferGeometry {
  return boxPart(0.46, height, 0.04, BODY_COLORS.GRILLE, 0, 0.45, -2.12);
}

/** A thin splitter blade under the apron, reaching `front` (z). 20 tris. */
function lip(front: number, halfWidth: number, color: number = BODY_COLORS.CARBON): THREE.BufferGeometry {
  return part(
    loft([
      { z: front, bottomY: 0.112, topY: 0.132, bottomHalfWidth: halfWidth - 0.1, topHalfWidth: halfWidth - 0.1 },
      { z: -2.08, bottomY: 0.112, topY: 0.135, bottomHalfWidth: halfWidth, topHalfWidth: halfWidth },
      { z: -1.78, bottomY: 0.112, topY: 0.135, bottomHalfWidth: halfWidth + 0.02, topHalfWidth: halfWidth + 0.02 },
    ]),
    color,
  );
}

/** Dive planes on the bumper corners: dihedral up and swept back toward the arches. */
function canards(levels: readonly number[], span: number, z: number): THREE.BufferGeometry[] {
  return mirrored((sign) =>
    levels.map((y, i) =>
      boxPart(span, 0.014, 0.13 - i * 0.02, BODY_COLORS.CARBON_DARK, sign * (0.86 + i * 0.01), y, z + i * 0.05, 0, -sign * 0.42, sign * 0.26),
    ),
  );
}

/** Subtle: painted apron, a slim carbon lip and a narrow intake. */
function streetLip(): THREE.BufferGeometry[] {
  return [
    apron(),
    lip(-2.25, 0.8),
    upperGrille(),
    boxPart(0.8, 0.07, 0.02, BODY_COLORS.GRILLE, 0, 0.21, APRON_FRONT - 0.005),
  ];
}

/** The stock-width lip, a wide intake with two corner ducts and two canards a side. */
function canardKit(): THREE.BufferGeometry[] {
  return [
    apron(0.31),
    lip(-2.29, 0.86),
    upperGrille(),
    boxPart(0.9, 0.09, 0.02, BODY_COLORS.GRILLE, 0, 0.22, APRON_FRONT - 0.005),
    ...mirrored((sign) => [boxPart(0.14, 0.07, 0.02, BODY_COLORS.GRILLE, sign * 0.56, 0.22, APRON_FRONT - 0.005)]),
    ...canards([0.2, 0.27], 0.2, -1.97),
  ];
}

/** Aggressive: one wide mesh intake across the whole apron, framed in carbon. */
function meshAggressor(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [apron(0.33), lip(-2.28, 0.84), upperGrille(0.16)];
  const z = APRON_FRONT - 0.006;
  const w = 1.2;
  const bottom = 0.155;
  const top = 0.305;
  const cy = (bottom + top) / 2;
  const h = top - bottom;
  out.push(boxPart(w, h, 0.02, BODY_COLORS.GRILLE, 0, cy, z + 0.004));
  // The mesh: bars proud of the dark backing.
  for (const y of [bottom + h * 0.25, cy, bottom + h * 0.75]) out.push(boxPart(w, 0.01, 0.018, BODY_COLORS.CARBON, 0, y, z - 0.01));
  for (let i = 0; i < 9; i++) {
    const x = -w / 2 + (w / 8) * i;
    out.push(boxPart(0.01, h, 0.018, BODY_COLORS.CARBON, x, cy, z - 0.01));
  }
  // Frame.
  out.push(boxPart(w + 0.06, 0.026, 0.03, BODY_COLORS.CARBON_DARK, 0, top + 0.013, z - 0.006));
  out.push(boxPart(w + 0.06, 0.022, 0.03, BODY_COLORS.CARBON_DARK, 0, bottom - 0.011, z - 0.006));
  return out;
}

/** Most aggressive: a wide splitter plate on rods with end fences, a big intake and canards. */
function timeAttack(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [apron(0.31), upperGrille()];
  // Splitter plate: above the front neon strip (y 0.11), which keeps glowing underneath it.
  out.push(
    part(
      loft([
        { z: -2.42, bottomY: 0.132, topY: 0.15, bottomHalfWidth: 0.74, topHalfWidth: 0.74 },
        { z: -2.24, bottomY: 0.13, topY: 0.155, bottomHalfWidth: 0.93, topHalfWidth: 0.93 },
        { z: -1.76, bottomY: 0.13, topY: 0.155, bottomHalfWidth: 0.95, topHalfWidth: 0.95 },
      ]),
      BODY_COLORS.CARBON_DARK,
    ),
  );
  out.push(
    ...mirrored((sign) => [
      // End fences on the splitter tips.
      boxPart(0.02, 0.1, 0.36, BODY_COLORS.CARBON, sign * 0.935, 0.2, -2.1),
      // Rods from the plate's leading edge up to the apron.
      boxPart(0.016, 0.2, 0.016, BODY_COLORS.CHROME, sign * 0.42, 0.22, -2.29, 0.88),
    ]),
  );
  // Big central intake with two dividers.
  out.push(boxPart(1.08, 0.12, 0.02, BODY_COLORS.GRILLE, 0, 0.225, APRON_FRONT - 0.005));
  for (const x of [-0.18, 0.18]) out.push(boxPart(0.03, 0.12, 0.03, BODY_COLORS.CARBON, x, 0.225, APRON_FRONT - 0.01));
  out.push(...canards([0.26], 0.24, -1.96));
  return out;
}

export const frontBumperSlot: SlotModule = {
  slot: 'frontBumper',
  variants: [
    'frontBumper.stock',
    'frontBumper.street-lip',
    'frontBumper.canard',
    'frontBumper.mesh-aggressor',
    'frontBumper.time-attack',
  ],
  build(partId) {
    switch (partId) {
      case 'frontBumper.street-lip':
        return streetLip();
      case 'frontBumper.canard':
        return canardKit();
      case 'frontBumper.mesh-aggressor':
        return meshAggressor();
      case 'frontBumper.time-attack':
        return timeAttack();
      default:
        return stock();
    }
  },
};
