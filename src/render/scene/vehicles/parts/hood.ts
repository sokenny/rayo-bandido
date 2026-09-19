import type * as THREE from 'three';
import { box, loft, part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';
import { boxPart, hullAt, hullTopY, mirrored, onHullTop } from './kit';

/**
 * Hood. Sold (`hood.*`). The hood panel itself is the hull's top between z ≈ -2.1 and -0.74
 * (`./hull.ts`); a hood part is what sits ON it — vents, a bulge, a carbon skin laid a few mm
 * proud of the hull. Stock is today's two carbon vents.
 *
 * The aftermarket hoods follow the hull's top with `onHullTop` / `hullTopY` (`./kit.ts`), so
 * they sit flush wherever the hood's slope changes, and stop at z = -0.78, short of the
 * windscreen's foot.
 */
function stock(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const vent = box(0.3, 0.05, 0.22);
    vent.translate(sign * 0.36, 0.78, -1.34);
    out.push(part(vent, BODY_COLORS.CARBON_DARK));
  }
  return out;
}

/** The hood's slope at `z` (rad, the angle `rotateX` needs for a flat piece lying on it). */
function slopeAt(z: number): number {
  const d = 0.02;
  return -Math.atan2(hullTopY(z + d) - hullTopY(z - d), 2 * d);
}

/** A flat piece lying on the hood at (x, z), `lift` above the surface. */
function onHood(w: number, h: number, d: number, color: number, x: number, z: number, lift: number): THREE.BufferGeometry {
  return boxPart(w, h, d, color, x, hullTopY(z) + lift, z, slopeAt(z));
}

/** One central scoop, open to the front, fading into the hood toward the windscreen. */
function scoop(): THREE.BufferGeometry[] {
  const h = (z: number): number => (z < -1.3 ? 0.1 - ((z + 1.62) / 0.32) * 0.03 : 0.07 - ((z + 1.3) / 0.35) * 0.058);
  const g = part(
    loft(
      [-1.62, -1.3, -0.95].map((z) => {
        const y = hullTopY(z);
        return { z, bottomY: y - 0.015, topY: y + h(z), bottomHalfWidth: 0.27, topHalfWidth: 0.22 };
      }),
    ),
    BODY_COLORS.PAINT,
  );
  const mouthY = hullTopY(-1.62) + 0.05;
  return [g, boxPart(0.4, 0.065, 0.02, BODY_COLORS.GRILLE, 0, mouthY, -1.627)];
}

/** Two louvred heat extractors, each a dark panel with four slats. */
function twinVent(): THREE.BufferGeometry[] {
  return mirrored((sign) => {
    const out = [onHood(0.34, 0.02, 0.42, BODY_COLORS.CARBON_DARK, sign * 0.4, -1.5, 0.002)];
    for (const z of [-1.64, -1.55, -1.46, -1.37]) out.push(onHood(0.32, 0.018, 0.035, BODY_COLORS.CARBON, sign * 0.4, z, 0.016));
    return out;
  });
}

/** A raised painted bulge down the middle, with a cowl slot facing the windscreen. */
function bulge(): THREE.BufferGeometry[] {
  const lift = (z: number): number => (z <= -1.85 ? 0.01 : z <= -1.45 ? 0.01 + ((z + 1.85) / 0.4) * 0.045 : z <= -0.95 ? 0.055 : 0.055 - ((z + 0.95) / 0.17) * 0.035);
  const g = onHullTop([-1.85, -1.45, -1.3, -0.95, -0.78], () => 0.36, lift, BODY_COLORS.PAINT, { topInset: 0.08 });
  return [g, boxPart(0.4, 0.028, 0.012, BODY_COLORS.GRILLE, 0, hullTopY(-0.785) + 0.012, -0.785)];
}

/** The whole hood skinned in dark carbon, with a vented panel in the middle. */
function carbonVented(): THREE.BufferGeometry[] {
  const skin = onHullTop(
    [-2.03, -1.86, -1.3, -0.78],
    (z) => hullAt(z).topHalfWidth - 0.035,
    () => 0.006,
    BODY_COLORS.CARBON_DARK,
    { sink: 0.02 },
  );
  const out = [skin];
  for (const z of [-1.2, -1.12, -1.04]) out.push(onHood(0.5, 0.014, 0.035, BODY_COLORS.GRILLE, 0, z, 0.006));
  out.push(...mirrored((sign) => [onHood(0.18, 0.014, 0.2, BODY_COLORS.GRILLE, sign * 0.5, -1.6, 0.006)]));
  return out;
}

export const hoodSlot: SlotModule = {
  slot: 'hood',
  variants: ['hood.stock', 'hood.scoop', 'hood.twin-vent', 'hood.bulge', 'hood.carbon'],
  build(partId) {
    switch (partId) {
      case 'hood.scoop':
        return scoop();
      case 'hood.twin-vent':
        return twinVent();
      case 'hood.bulge':
        return bulge();
      case 'hood.carbon':
        return carbonVented();
      default:
        return stock();
    }
  },
};
