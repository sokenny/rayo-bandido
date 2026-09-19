import type * as THREE from 'three';
import { box, loft, part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';
import { boxPart, mirrored } from './kit';
import { deckTopAt } from './trunk';

/**
 * Spoiler. Sold (`spoiler.*`). Stock is today's GT wing: plane, endplates, stanchions.
 *
 * The aftermarket wings stand on `deckTopAt(z, ctx.loadout.body.trunk)` (`./trunk.ts`): the
 * deck, or the top of the trunk part fitted there, so their feet land on a ducktail rather
 * than inside it. A wing's plane is pitched trailing edge up, like the stock one.
 */
function stock(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const wingPlane = box(1.76, 0.05, 0.34);
  wingPlane.rotateX(-0.14);
  wingPlane.translate(0, 1.24, 1.72);
  out.push(part(wingPlane, BODY_COLORS.CARBON));
  for (const sign of [-1, 1]) {
    const endplate = box(0.03, 0.24, 0.42);
    endplate.translate(sign * 0.87, 1.21, 1.72);
    out.push(part(endplate, BODY_COLORS.CARBON_DARK));
    const stanchion = box(0.05, 0.42, 0.14);
    stanchion.translate(sign * 0.55, 1.04, 1.7);
    out.push(part(stanchion, BODY_COLORS.CARBON_DARK));
  }
  return out;
}

type Deck = (z: number) => number;

/** A vertical post from 2 cm inside the deck at `z` up to `top`. */
function post(w: number, d: number, color: number, x: number, z: number, top: number, deck: Deck): THREE.BufferGeometry {
  const bottom = deck(z) - 0.02;
  return boxPart(w, top - bottom, d, color, x, (top + bottom) / 2, z);
}

/** A painted lip along the deck's trailing edge. */
function lip(deck: Deck): THREE.BufferGeometry[] {
  const stations: Array<[number, number, number]> = [
    [1.98, 0.004, 0.72],
    [2.09, 0.04, 0.72],
    [2.14, 0.05, 0.71],
  ];
  return [
    part(
      loft(
        stations.map(([z, lift, hw]) => {
          const y = deck(Math.min(z, 2.1));
          return { z, bottomY: y - 0.012, topY: y + lift, bottomHalfWidth: hw, topHalfWidth: hw - 0.02 };
        }),
      ),
      BODY_COLORS.PAINT,
    ),
  ];
}

/** Low street wing: one plane on two short stanchions. */
function streetWing(deck: Deck): THREE.BufferGeometry[] {
  const z = 1.95;
  const y = deck(z) + 0.15;
  return [
    boxPart(1.5, 0.035, 0.26, BODY_COLORS.PAINT, 0, y, z, -0.1),
    ...mirrored((sign) => [
      boxPart(0.02, 0.09, 0.3, BODY_COLORS.CARBON_DARK, sign * 0.76, y + 0.005, z),
      post(0.04, 0.1, BODY_COLORS.CARBON_DARK, sign * 0.46, z, y, deck),
    ]),
  ];
}

/** Tall time-attack wing: main plane and a slotted upper flap between big endplates. */
function doubleGt(deck: Deck): THREE.BufferGeometry[] {
  const z = 1.78;
  const y = 1.36;
  return [
    boxPart(1.8, 0.045, 0.3, BODY_COLORS.CARBON, 0, y, z, -0.12),
    boxPart(1.8, 0.03, 0.16, BODY_COLORS.CARBON, 0, y + 0.075, z + 0.19, -0.45),
    ...mirrored((sign) => [
      boxPart(0.025, 0.32, 0.5, BODY_COLORS.CARBON_DARK, sign * 0.912, y + 0.02, z + 0.06),
      post(0.05, 0.16, BODY_COLORS.CARBON_DARK, sign * 0.5, z, y, deck),
    ]),
  ];
}

/** Swan-neck wing: the plane hangs from goose-neck mounts that clamp its top surface. */
function swanNeck(deck: Deck): THREE.BufferGeometry[] {
  const planeZ = 1.72;
  const planeY = 1.22;
  const postZ = 1.98;
  const postTop = 1.36;
  // Neck from the post's top forward and down onto the plane's top face.
  const a = { y: postTop - 0.01, z: postZ };
  const b = { y: planeY + 0.03, z: planeZ + 0.06 };
  const neckLen = Math.hypot(a.y - b.y, a.z - b.z);
  const neckTilt = -Math.atan2(a.y - b.y, a.z - b.z);
  return [
    boxPart(1.7, 0.045, 0.32, BODY_COLORS.CARBON, 0, planeY, planeZ, -0.12),
    ...mirrored((sign) => [
      boxPart(0.025, 0.2, 0.42, BODY_COLORS.CARBON_DARK, sign * 0.86, planeY - 0.01, planeZ + 0.01),
      post(0.04, 0.08, BODY_COLORS.CARBON_DARK, sign * 0.42, postZ, postTop, deck),
      boxPart(0.04, 0.05, neckLen + 0.04, BODY_COLORS.CARBON_DARK, sign * 0.42, (a.y + b.y) / 2, (a.z + b.z) / 2, neckTilt),
    ]),
  ];
}

export const spoilerSlot: SlotModule = {
  slot: 'spoiler',
  variants: ['spoiler.stock', 'spoiler.none', 'spoiler.lip', 'spoiler.street', 'spoiler.swan-neck', 'spoiler.double-gt'],
  build(partId, ctx) {
    const deck: Deck = (z) => deckTopAt(z, ctx.loadout.body.trunk);
    switch (partId) {
      case 'spoiler.none':
        return [];
      case 'spoiler.lip':
        return lip(deck);
      case 'spoiler.street':
        return streetWing(deck);
      case 'spoiler.swan-neck':
        return swanNeck(deck);
      case 'spoiler.double-gt':
        return doubleGt(deck);
      default:
        return stock();
    }
  },
};
