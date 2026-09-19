import type * as THREE from 'three';
import type { PartId } from '../../../../core/loadout';
import { loft, part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';
import { boxPart, hullAt, hullTopY, onHullTop } from './kit';

/**
 * Trunk lid. Sold (`trunk.*`). Like the hood, the deck itself is the hull's (`./hull.ts`, top
 * between z ≈ 1.58 and 2.12); a trunk part sits on it. Stock adds nothing — today's car has no
 * separate trunk piece — so it returns an empty list, which the assembler merges as nothing.
 *
 * `deckTopAt(z, trunk)` is what the spoilers (`./spoiler.ts`) stand on: the hull's deck, or the
 * top of whatever trunk part is fitted there, so a wing's stanchions land on a ducktail instead
 * of disappearing into it.
 *
 * `trunk.louver` is the classic JDM backlight louvre: it lies on the fastback's glass (the
 * greenhouse between z 0.62 and 1.58), not on the deck, and leaves `deckTopAt` alone.
 */

/** Ducktail profile: z, bottom, top of its lid at each station (the last one overhangs the tail). */
const DUCKTAIL: ReadonlyArray<readonly [number, number, number]> = [
  [1.6, hullTopY(1.6) - 0.015, hullTopY(1.6) + 0.01],
  [1.9, hullTopY(1.9) - 0.015, hullTopY(1.9) + 0.03],
  [2.06, hullTopY(2.06) - 0.015, 0.93],
  [2.16, 0.8, 0.975],
];

function lerpProfile(z: number, profile: ReadonlyArray<readonly [number, number, number]>): number {
  if (z <= profile[0][0]) return profile[0][2];
  for (let i = 0; i < profile.length - 1; i++) {
    const [z0, , t0] = profile[i];
    const [z1, , t1] = profile[i + 1];
    if (z <= z1) return t0 + ((z - z0) / (z1 - z0)) * (t1 - t0);
  }
  return profile[profile.length - 1][2];
}

/** Top of the rear deck at `z` with `trunkId` fitted: where a spoiler's feet go. */
export function deckTopAt(z: number, trunkId: PartId): number {
  const hull = hullTopY(Math.min(z, 2.12));
  switch (trunkId) {
    case 'trunk.ducktail':
      return z < DUCKTAIL[0][0] ? hull : Math.max(hull, lerpProfile(z, DUCKTAIL));
    case 'trunk.carbon':
      return hull + 0.006;
    default:
      return hull;
  }
}

/** Painted ducktail: the deck kicks up into a lip that overhangs the tail lamps. */
function ducktail(): THREE.BufferGeometry[] {
  const hw = [0.74, 0.79, 0.76, 0.735];
  return [
    part(
      loft(DUCKTAIL.map(([z, bottomY, topY], i) => ({ z, bottomY, topY, bottomHalfWidth: hw[i], topHalfWidth: hw[i] - 0.02 }))),
      BODY_COLORS.PAINT,
    ),
  ];
}

/** Carbon skin over the deck lid. */
function carbonLid(): THREE.BufferGeometry[] {
  return [
    onHullTop([1.6, 1.9, 2.1], (z) => hullAt(z).topHalfWidth - 0.035, () => 0.006, BODY_COLORS.CARBON_DARK, { sink: 0.02 }),
  ];
}

/** A gurney flap: one thin carbon strip standing on the deck's trailing edge. */
function gurney(): THREE.BufferGeometry[] {
  const z = 2.1;
  return [boxPart(1.3, 0.05, 0.014, BODY_COLORS.CARBON_DARK, 0, hullTopY(z) + 0.015, z)];
}

/** Backlight louvre: two rails and seven slats lying on the fastback glass. */
function louver(): THREE.BufferGeometry[] {
  // The fastback's top face from (z 0.62, y 1.31) to (z 1.58, y 0.93), flat across x.
  const z0 = 0.62;
  const y0 = 1.31;
  const dz = 1.58 - z0;
  const dy = 0.93 - y0;
  const len = Math.hypot(dz, dy);
  const slope = Math.atan2(-dy, dz); // rotateX that lays a flat piece on it
  const nY = dz / len; // outward normal (up and back)
  const nZ = -dy / len;
  const at = (t: number, lift: number): [number, number] => [y0 + dy * t + nY * lift, z0 + dz * t + nZ * lift];
  const out: THREE.BufferGeometry[] = [];
  const [ry, rz] = at(0.52, 0.02);
  for (const sign of [-1, 1]) out.push(boxPart(0.035, 0.03, len * 0.84, BODY_COLORS.CARBON_DARK, sign * 0.55, ry, rz, slope));
  for (let i = 0; i < 7; i++) {
    const [y, z] = at(0.16 + i * 0.12, 0.04);
    out.push(boxPart(1.08, 0.01, 0.075, BODY_COLORS.CARBON, 0, y, z, slope + 0.55));
  }
  return out;
}

export const trunkSlot: SlotModule = {
  slot: 'trunk',
  variants: ['trunk.stock', 'trunk.gurney', 'trunk.carbon', 'trunk.ducktail', 'trunk.louver'],
  build(partId): THREE.BufferGeometry[] {
    switch (partId) {
      case 'trunk.gurney':
        return gurney();
      case 'trunk.carbon':
        return carbonLid();
      case 'trunk.ducktail':
        return ducktail();
      case 'trunk.louver':
        return louver();
      default:
        return [];
    }
  },
};
