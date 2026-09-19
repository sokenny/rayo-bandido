import type * as THREE from 'three';
import { BODY_SLOTS, slotPartId, type BodyPartContext, type BodySlot, type SlotModule } from './common';
import { hullSlot } from './hull';
import { greenhouseSlot } from './greenhouse';
import { fendersSlot } from './fenders';
import { frontBumperSlot } from './frontBumper';
import { skirtsSlot } from './skirts';
import { rearBumperSlot } from './rearBumper';
import { spoilerSlot } from './spoiler';
import { mirrorsSlot } from './mirrors';
import { hoodSlot } from './hood';
import { trunkSlot } from './trunk';
import { exhaustTipsSlot } from './exhaustTips';

export * from './common';
export { exhaustOutlets, type ExhaustOutlet } from './exhaustTips';

/**
 * THE SLOT REGISTRY: one `SlotModule` per body slot. A new part is a new `case` (and a new
 * entry in `variants`) inside its slot's file — this table only changes if a whole new slot
 * appears, and then `BODY_SLOTS` in `./common.ts` changes with it.
 */
export const SLOT_MODULES: Readonly<Record<BodySlot, SlotModule>> = {
  hull: hullSlot,
  greenhouse: greenhouseSlot,
  fenders: fendersSlot,
  frontBumper: frontBumperSlot,
  skirts: skirtsSlot,
  rearBumper: rearBumperSlot,
  spoiler: spoilerSlot,
  mirrors: mirrorsSlot,
  hood: hoodSlot,
  trunk: trunkSlot,
  exhaustTips: exhaustTipsSlot,
};

/**
 * Every slot's parts for `ctx.loadout`, in `BODY_SLOTS` order. `insert.parts()` is spliced in
 * right after slot `insert.after`, so the assembler can put the parts it does not take from a
 * slot (the number plate, `../plate.ts`) in their place in the sequence. Unmerged: the caller
 * merges and disposes.
 */
export function buildSlotParts(
  ctx: BodyPartContext,
  insert?: { after: BodySlot; parts: () => THREE.BufferGeometry[] },
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const slot of BODY_SLOTS) {
    const module = SLOT_MODULES[slot];
    for (const g of module.build(slotPartId(slot, ctx.loadout), ctx)) out.push(g);
    if (insert && insert.after === slot) for (const g of insert.parts()) out.push(g);
  }
  return out;
}
