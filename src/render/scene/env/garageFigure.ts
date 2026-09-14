import * as THREE from 'three';
import type { CrowdSubject } from './humanActs';
import type { HumanLook } from './humanFigure';
import { createHumanFigure, type HumanFigureVisual } from './humanRig';
import { GARAGE, garageParts, type GarageSpec } from '../../../world/garage';

/**
 * Loco Mustang, standing out front of his garage, and the ring on the apron where he talks to
 * you. The same shorthand as El Búho's (`buhoFigure.ts`): the ring IS the zone, its radius is
 * `GARAGE.marker`'s, and it warms as the car closes. The building itself is city geometry
 * (`garageBuilder.ts`); only he and the paint live here, because only they change.
 */
export interface GarageFigureVisual {
  group: THREE.Group;
  /** How close the player is, 0 (far) .. 1 (in the ring). Brightens the ring. */
  setProximity(value: number): void;
  /** `subject` is the player's car, in world space: he watches it come. */
  update(time: number, subject?: CrowdSubject | null): void;
  dispose(): void;
}

const RED = 0xff5a3c;
/** Above the apron's slab and its stains. */
const PAINT_Y = 0.07;

/**
 * The man, from Juan's photograph: a black bucket hat, a sleeveless navy shirt with a red 99,
 * both arms inked, khaki cords, white trainers. Arms hanging, weight on one leg, grinning at
 * whatever you drove up in. A warm pool under him so he reads from the boulevard at night.
 */
export const LOCO_MUSTANG_LOOK: HumanLook = {
  height: 0.94,
  build: 0.98,
  skin: 0xc79672,
  hair: 0x1e1a17,
  head: 'bucket',
  headwear: 0x1b1c1f,
  coat: 0x1d2437,
  coatLength: 0,
  legs: 0xb3a47f,
  boots: 0xeeeeea,
  sleeveless: true,
  tattoo: 0x3b4a4e,
  chestNumber: '99',
  print: 0xd8262a,
  pose: 'idle',
  eyes: 'none',
  aura: 0xffb070,
  auraRadius: 2.4,
};

export function createGarageFigure(spec: GarageSpec): GarageFigureVisual {
  const parts = garageParts(spec);
  const group = new THREE.Group();
  group.name = 'loco-mustang';

  /* ---------------------------------------------------------------- the ring */

  const outer = GARAGE.marker.promptRadius;
  const inner = outer - 0.6;
  const backingGeo = new THREE.RingGeometry(inner - 0.4, outer + 0.4, 40);
  const backingMat = new THREE.MeshBasicMaterial({ color: 0x05070c, transparent: true, opacity: 0.35, depthWrite: false });
  const backing = new THREE.Mesh(backingGeo, backingMat);
  backing.rotation.x = -Math.PI / 2;
  backing.position.set(parts.marker.x, PAINT_Y, parts.marker.z);
  backing.renderOrder = 1;
  group.add(backing);

  const ringGeo = new THREE.RingGeometry(inner, outer, 40, 1);
  const ringMat = new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(parts.marker.x, PAINT_Y + 0.002, parts.marker.z);
  ring.renderOrder = 2;
  group.add(ring);

  /* ---------------------------------------------------------------- the man */

  const man: HumanFigureVisual = createHumanFigure(LOCO_MUSTANG_LOOK, { name: 'loco-mustang-man', phase: 0.99 });
  man.group.position.set(parts.stand.x, 0, parts.stand.z);
  man.group.rotation.y = parts.stand.rotY;
  group.add(man.group);

  let proximity = 0;

  return {
    group,
    setProximity(value) {
      proximity = value < 0 ? 0 : value > 1 ? 1 : value;
    },
    update(time, subject) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 1.4);
      ringMat.opacity = 0.2 + proximity * 0.3 + pulse * 0.06;
      backingMat.opacity = 0.28 + proximity * 0.18;
      man.update(time, subject);
    },
    dispose() {
      group.clear();
      man.dispose();
      backingGeo.dispose();
      backingMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
    },
  };
}
