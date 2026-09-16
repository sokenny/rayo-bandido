import * as THREE from 'three';
import { CROWD } from '../../config/tuning';
import type { ParkEncounterSpec, ParkPersonSpec } from '../../world/park';
import type { CrowdSubject } from './env/humanActs';
import type { HumanLook } from './env/humanFigure';
import { createHumanCrowd, type CrowdMember } from './env/humanRig';
import { meetMember } from './meetVisual';

/**
 * THE PEOPLE IN THE PARK (`world/park.ts`, `ParkEncounterSpec`): every encounter's cast in one
 * crowd, the meet's own machinery — the same rig, the same acts, two skinned draw calls for
 * everybody — with each named character's look laid over what their seed picked
 * (`ParkPersonSpec.look`), so Yoli is Yoli every night.
 *
 * Level of detail as the meets have it: the crowd is stepped every frame near the camera,
 * every few frames across the lake, and not at all once nobody is more than a few pixels
 * tall; the whole group is hidden past `SHOW_WITHIN`. Nothing is allocated per frame.
 */
export interface ParkPeopleVisual {
  root: THREE.Group;
  update(camX: number, camZ: number, time: number, dt: number, subject: CrowdSubject | null): void;
  dispose(): void;
}

/** Past this (m) from the nearest encounter, the people are not drawn at all. */
const SHOW_WITHIN = 260;

/** One person, as the crowd builds them: the meet's member with the character's own look over it. */
export function parkMember(p: ParkPersonSpec, index: number, people: readonly ParkPersonSpec[]): CrowdMember {
  const m = meetMember(p, index, people);
  if (p.look) {
    const look: HumanLook = { ...m.look, ...p.look };
    // The phone is only lit while they use it; a character who brought one keeps it.
    if (p.look.phone !== undefined) look.phone = p.look.phone;
    m.look = look;
  }
  return m;
}

export function createParkPeopleVisual(encounters: readonly ParkEncounterSpec[]): ParkPeopleVisual {
  const root = new THREE.Group();
  root.name = 'park-people';
  const people = encounters.flatMap((e) => e.people);
  const centres = encounters.map((e) => ({ x: e.x, z: e.z }));
  const crowd = people.length > 0 ? createHumanCrowd(people.map((p, i) => parkMember(p, i, people)), 'park-people') : null;
  if (crowd) root.add(crowd.group);
  let stride = 0;
  let owed = 0;
  return {
    root,
    update(camX, camZ, time, dt, subject) {
      let nearest = Infinity;
      for (let i = 0; i < centres.length; i++) nearest = Math.min(nearest, Math.hypot(centres[i].x - camX, centres[i].z - camZ));
      root.visible = nearest < SHOW_WITHIN;
      if (!crowd || !root.visible) return;
      owed += dt;
      if (nearest > CROWD.animateWithin) return;
      stride = (stride + 1) % CROWD.farStride;
      if (nearest > CROWD.fullWithin && stride !== 0) return;
      crowd.update(time, Math.min(owed, 0.25), subject);
      owed = 0;
    },
    dispose() {
      crowd?.dispose();
      root.removeFromParent();
      root.clear();
    },
  };
}
