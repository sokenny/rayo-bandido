import type * as THREE from 'three';
import { box, loft, part, type LoftSection } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';
import { boxPart, mirrored } from './kit';

/**
 * Side skirts. Sold (`skirts.*`). The underglow's rocker strips (`../underglow.ts`) run just
 * outside them at x = ±0.995, y = 0.11: a deeper skirt should not bury them.
 *
 * The aftermarket skirts are ONE loft across the car rather than two boxes: a section is
 * symmetric about x = 0, and everything inboard of the hull's flank (x ≈ 0.88) is hidden inside
 * the body, so the loft shows exactly two skirts — with tapered ends for free. Their outer lower
 * edge stays at x ≤ 0.98 below the neon strip's top, and they end at |z| = 0.9, clear of the
 * front tyres at full lock and of the rear tyres at the lowest ride height. Keep-out: `./kit.ts`.
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

/** A section of a skirt loft. */
function s(z: number, bottomY: number, topY: number, bottomHalfWidth: number, topHalfWidth: number): LoftSection {
  return { z, bottomY, topY, bottomHalfWidth, topHalfWidth };
}

/**
 * A skirt pair whose full-depth run is |z| ≤ `run`, tapering to `end` over the last few cm:
 * `full` is its section in the middle, `tip` at the ends.
 */
function skirtLoft(
  run: number,
  end: number,
  full: Omit<LoftSection, 'z'>,
  tip: Omit<LoftSection, 'z'>,
  color: number,
  chamfer = 0,
): THREE.BufferGeometry {
  return part(
    loft([{ z: -end, ...tip }, { z: -run, ...full }, { z: run, ...full }, { z: end, ...tip }], { chamfer }),
    color,
  );
}

/** Subtle: a slim painted blade with tapered ends. */
function slim(): THREE.BufferGeometry[] {
  return [skirtLoft(0.84, 0.9, s(0, 0.125, 0.25, 0.955, 0.905), s(0, 0.155, 0.22, 0.915, 0.9), BODY_COLORS.PAINT)];
}

/** Flared at the bottom, with three cooling slots ahead of the rear tyre and one intake up front. */
function flareDuct(): THREE.BufferGeometry[] {
  const out = [skirtLoft(0.8, 0.9, s(0, 0.115, 0.28, 0.978, 0.895), s(0, 0.14, 0.26, 0.93, 0.89), BODY_COLORS.PAINT)];
  // The flank of the flare leans in by this angle; the slots lie flat on it.
  const lean = Math.atan2(0.978 - 0.895, 0.28 - 0.115);
  const onFace = (y: number): number => 0.978 - (y - 0.115) * ((0.978 - 0.895) / (0.28 - 0.115)) + 0.004;
  out.push(
    ...mirrored((sign) => [
      ...[0.52, 0.6, 0.68].map((z) => boxPart(0.014, 0.075, 0.04, BODY_COLORS.GRILLE, sign * onFace(0.19), 0.19, z, 0, 0, -sign * lean)),
      boxPart(0.014, 0.06, 0.16, BODY_COLORS.GRILLE, sign * onFace(0.2), 0.2, -0.66, 0, 0, -sign * lean),
    ]),
  );
  return out;
}

/** Carbon skirt with a side blade along it and a winglet flicked up at each end. */
function winglet(): THREE.BufferGeometry[] {
  const out = [skirtLoft(0.82, 0.9, s(0, 0.115, 0.26, 0.975, 0.9), s(0, 0.14, 0.24, 0.93, 0.895), BODY_COLORS.CARBON)];
  out.push(
    ...mirrored((sign) => [
      // Blade: rests on the skirt's face, its edge no further out than the neon strip's centre.
      boxPart(0.06, 0.012, 1.46, BODY_COLORS.CARBON_DARK, sign * 0.955, 0.205, 0),
      // Winglets at both ends, swept and canted outward.
      boxPart(0.014, 0.16, 0.12, BODY_COLORS.CARBON_DARK, sign * 0.99, 0.23, 0.83, 0, -sign * 0.3, sign * 0.12),
      boxPart(0.014, 0.12, 0.1, BODY_COLORS.CARBON_DARK, sign * 0.985, 0.21, -0.79, 0, sign * 0.3, sign * 0.12),
    ]),
  );
  return out;
}

/** Aggressive: a deep, rounded rocker in paint with a carbon insert along its face. */
function aeroBox(): THREE.BufferGeometry[] {
  const out = [skirtLoft(0.84, 0.9, s(0, 0.112, 0.3, 0.976, 0.9), s(0, 0.13, 0.28, 0.95, 0.9), BODY_COLORS.PAINT, 0.03)];
  const lean = Math.atan2(0.976 - 0.9, 0.3 - 0.112);
  const y = 0.19;
  const x = 0.976 - (y - 0.112) * ((0.976 - 0.9) / (0.3 - 0.112)) + 0.004;
  out.push(...mirrored((sign) => [boxPart(0.012, 0.045, 1.5, BODY_COLORS.CARBON_DARK, sign * x, y, 0, 0, 0, -sign * lean)]));
  return out;
}

export const skirtsSlot: SlotModule = {
  slot: 'skirts',
  variants: ['skirts.stock', 'skirts.slim', 'skirts.flare-duct', 'skirts.winglet', 'skirts.aero-box'],
  build(partId) {
    switch (partId) {
      case 'skirts.slim':
        return slim();
      case 'skirts.flare-duct':
        return flareDuct();
      case 'skirts.winglet':
        return winglet();
      case 'skirts.aero-box':
        return aeroBox();
      default:
        return stock();
    }
  },
};
