import type * as THREE from 'three';
import { box, loft, part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';
import { boxPart, mirrored } from './kit';

/**
 * Rear bumper: the diffuser with its strakes and the valance above it. Sold (`rearBumper.*`).
 *
 * Keep clear of three things other modules own: the number plate (`PLATE_MOUNT` in
 * `../plate.ts`, centred at (0, 0.53, 2.145)), the exhaust outlets (`exhaustOutlets` in
 * `./exhaustTips.ts`) and the tail/reverse lamps (`../lights.ts`, z ≈ 2.11–2.16).
 *
 * Aftermarket bumpers share one lower body under the tail (`rearApron`): its face stops at
 * y = 0.345 under the reverse lamps and its lower edge lifts to y = 0.178 at z = 2.115, just
 * ahead of the rear neon strip (y 0.13–0.17, z 2.12–2.14), which keeps glowing behind it.
 * Diffuser floors run below the strip and their fins stay out of every exhaust layout's x band (|x| 0.2–0.49 and the right-hand corner
 * pipe past x = 0.6). Keep-out zones: `./kit.ts`.
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

/** Rear face of the lower bumper. */
const APRON_BACK = 2.115;

/** The lower bumper under the tail, from behind the rear tyres (z 1.7) to the face. 20 tris. */
function rearApron(color: number = BODY_COLORS.PAINT): THREE.BufferGeometry {
  return part(
    loft([
      { z: 1.7, bottomY: 0.13, topY: 0.3, bottomHalfWidth: 0.82, topHalfWidth: 0.84 },
      { z: 1.96, bottomY: 0.135, topY: 0.35, bottomHalfWidth: 0.8, topHalfWidth: 0.8 },
      { z: APRON_BACK, bottomY: 0.178, topY: 0.345, bottomHalfWidth: 0.74, topHalfWidth: 0.745 },
    ]),
    color,
  );
}

/** A flat diffuser floor under the apron, below the neon strip, reaching `back` (z). */
function floor(halfWidth: number, back: number): THREE.BufferGeometry {
  const front = 1.72;
  return boxPart(halfWidth * 2, 0.018, back - front, BODY_COLORS.CARBON_DARK, 0, 0.117, (front + back) / 2);
}

/** Vertical strakes standing on a floor, `top` high, from z 1.74 to `back`. */
function fins(xs: readonly number[], top: number, back: number): THREE.BufferGeometry[] {
  const front = 1.74;
  const bottom = 0.124;
  return xs.map((x) => boxPart(0.028, top - bottom, back - front, BODY_COLORS.CARBON, x, (top + bottom) / 2, (front + back) / 2));
}

/** Subtle: a clean painted valance with a short carbon diffuser lip under it. */
function valanceSlim(): THREE.BufferGeometry[] {
  return [rearApron(), floor(0.46, 2.18), ...fins([-0.16, 0.16], 0.2, 2.18)];
}

/** Four long strakes on a floor that runs out past the bumper. */
function quadFin(): THREE.BufferGeometry[] {
  return [rearApron(), floor(0.62, 2.3), ...fins([-0.53, -0.16, 0.16, 0.53], 0.255, 2.3)];
}

/** Painted bumper with a dark centre channel, two strakes in it and corner reflector slots. */
function touge(): THREE.BufferGeometry[] {
  return [
    rearApron(),
    boxPart(0.5, 0.07, 0.02, BODY_COLORS.GRILLE, 0, 0.215, APRON_BACK + 0.004),
    ...fins([-0.16, 0.16], 0.25, 2.26),
    floor(0.3, 2.26),
    ...mirrored((sign) => [boxPart(0.1, 0.035, 0.02, BODY_COLORS.GRILLE, sign * 0.6, 0.25, APRON_BACK + 0.004)]),
  ];
}

/** Most aggressive: an all-carbon tail with a wide floor and four tall tunnels. */
function bigTunnel(): THREE.BufferGeometry[] {
  return [
    rearApron(BODY_COLORS.CARBON_DARK),
    floor(0.74, 2.38),
    ...fins([-0.14, 0.14], 0.3, 2.38),
    ...fins([-0.55, 0.55], 0.26, 2.38),
  ];
}

export const rearBumperSlot: SlotModule = {
  slot: 'rearBumper',
  variants: [
    'rearBumper.stock',
    'rearBumper.valance',
    'rearBumper.quad-fin',
    'rearBumper.touge',
    'rearBumper.big-tunnel',
  ],
  build(partId) {
    switch (partId) {
      case 'rearBumper.valance':
        return valanceSlim();
      case 'rearBumper.quad-fin':
        return quadFin();
      case 'rearBumper.touge':
        return touge();
      case 'rearBumper.big-tunnel':
        return bigTunnel();
      default:
        return stock();
    }
  },
};
