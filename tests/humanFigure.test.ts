import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BONE, HUMAN_BONE_COUNT, HUMAN_CROWN, buildHumanParts, restJoints, type HumanLook } from '../src/render/scene/env/humanFigure';
import { createHumanCrowd, createHumanFigure } from '../src/render/scene/env/humanRig';
import { passengerLook, standAt } from '../src/render/scene/env/passengerFigure';
import { PASSENGERS } from '../src/content/passengers';
import type { PassengerStop } from '../src/core/types';
import { createCityWorld } from '../src/world/cityWorld';
import { PASSENGER } from '../src/config/tuning';

/**
 * The shared body (`src/render/scene/env/humanFigure.ts`) is what every person in this city is
 * made of, so what is worth pinning is the contract the rest of the game leans on rather than
 * the shape of anyone's coat: that a figure stands on the ground at its own origin, that it is
 * as tall as it says it is, that a look's choices actually change the geometry, that every part
 * of it hangs off the joint it should, and that nobody costs more than a person should.
 *
 * And, for the stops: that a passenger waits somewhere a passenger would wait — at the kerb,
 * out of the parking space, looking at the road.
 */

const PLAIN: HumanLook = { skin: 0xb08a6c, hair: 0x241c18, coat: 0x2c3038, legs: 0x24272e, boots: 0x16181c };

function boundsOf(geo: THREE.BufferGeometry): THREE.Box3 {
  geo.computeBoundingBox();
  return geo.boundingBox!.clone();
}

function trianglesOf(geo: THREE.BufferGeometry | null): number {
  if (!geo) return 0;
  return geo.getAttribute('position').count / 3;
}

/** The bounds of just the vertices on one bone. */
function boneBounds(geo: THREE.BufferGeometry, bone: number): THREE.Box3 {
  const pos = geo.getAttribute('position');
  const tag = geo.getAttribute('aBone');
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) if (tag.getX(i) === bone) box.expandByPoint(v.fromBufferAttribute(pos, i));
  return box;
}

describe('the shared body', () => {
  it('stands on the ground at its own origin, the height it claims', () => {
    const parts = buildHumanParts(PLAIN);
    const box = boundsOf(parts.body);
    expect(box.min.y).toBeCloseTo(0, 5);
    // The top of the head is the reference; the hair on it adds the few centimetres hair adds.
    expect(box.max.y).toBeGreaterThanOrEqual(HUMAN_CROWN);
    expect(box.max.y).toBeLessThan(HUMAN_CROWN + 0.25);
    // A person, not a poster: they take up room in both directions on the floor.
    expect(box.max.x - box.min.x).toBeGreaterThan(0.4);
    expect(box.max.z - box.min.z).toBeGreaterThan(0.2);
    // Built facing -z, so the front of them is on the negative side of the origin.
    expect(box.min.z).toBeLessThan(0);
  });

  it('scales by height and widens by build, and nothing else moves', () => {
    const base = boundsOf(buildHumanParts(PLAIN).body);
    const tall = boundsOf(buildHumanParts({ ...PLAIN, height: 2 }).body);
    expect(tall.max.y).toBeCloseTo(base.max.y * 2, 5);
    expect(tall.min.y).toBeCloseTo(0, 5);
    const wide = boundsOf(buildHumanParts({ ...PLAIN, build: 1.4 }).body);
    const plain = boundsOf(buildHumanParts(PLAIN).body);
    expect(wide.max.x - wide.min.x).toBeGreaterThan(plain.max.x - plain.min.x);
    expect(wide.max.y).toBeCloseTo(plain.max.y, 5);
  });

  it('holds what is held and grounds what is grounded', () => {
    // A camera is in the hand, so it moves with the hand; a case is set down, so it does not.
    const filming = buildHumanParts({ ...PLAIN, prop: 'camera' });
    expect(filming.prop).toBeNull();
    expect(boneBounds(filming.body, BONE.hand).isEmpty()).toBe(false);
    const carrying = buildHumanParts({ ...PLAIN, prop: 'case' });
    expect(carrying.prop).not.toBeNull();
    expect(carrying.prop!.getAttribute('aBone')).toBeUndefined();
    const propBox = boundsOf(carrying.prop!);
    expect(propBox.min.y).toBeCloseTo(0, 5);
    // Beside them rather than through them.
    expect(propBox.max.x).toBeLessThan(boundsOf(carrying.body).min.x + 0.2);
    // Nobody holds a phone they were not given.
    expect(boneBounds(buildHumanParts(PLAIN).body, BONE.hand).isEmpty()).toBe(true);
  });

  it('only lights what a look asks to be lit', () => {
    expect(buildHumanParts(PLAIN).accent).toBeNull();
    const lit = buildHumanParts({ ...PLAIN, eyes: 'lenses', eyeColor: 0xf0b34a, band: 0xa8ff3e });
    expect(lit.accent).not.toBeNull();
    // Vertex-coloured, so several colours share one unlit mesh.
    expect(lit.accent!.getAttribute('color')).toBeTruthy();
    // The lenses are on the face: high up, in front, and on the head, so they turn with it.
    const eyesBox = boneBounds(lit.accent!, BONE.head);
    expect(eyesBox.max.y).toBeGreaterThan(1.6);
    expect(eyesBox.min.z).toBeLessThan(0);
    expect(boneBounds(lit.accent!, BONE.spine).isEmpty()).toBe(false);
  });

  it('tags every vertex with a bone, and hangs every part off its joint', () => {
    const parts = buildHumanParts({ ...PLAIN, phone: 0xffffff, eyes: 'eyes' });
    for (const geo of [parts.body, parts.accent!]) {
      const tag = geo.getAttribute('aBone');
      expect(tag.count).toBe(geo.getAttribute('position').count);
      for (let i = 0; i < tag.count; i++) expect(tag.getX(i)).toBeLessThan(HUMAN_BONE_COUNT);
    }
    const rest = restJoints(parts.joints);
    const joint = (bone: number): THREE.Vector3 => new THREE.Vector3(rest[bone * 3], rest[bone * 3 + 1], rest[bone * 3 + 2]);
    // The shoulders are at chest height, out at the sides; the upper arm starts at its shoulder
    // and ends where the forearm's elbow is.
    for (const [upper, fore, side] of [[BONE.upperArmL, BONE.foreArmL, -1], [BONE.upperArmR, BONE.foreArmR, 1]] as const) {
      const shoulder = joint(upper);
      expect(shoulder.y).toBeGreaterThan(1.2);
      expect(shoulder.y).toBeLessThan(HUMAN_CROWN);
      expect(Math.sign(shoulder.x)).toBe(side);
      const arm = boneBounds(parts.body, upper);
      expect(arm.max.y).toBeGreaterThan(shoulder.y);
      expect(arm.min.y).toBeCloseTo(joint(fore).y, 1);
      expect(boneBounds(parts.body, fore).max.y).toBeGreaterThan(joint(fore).y);
    }
    // The legs hang from the hips, the head sits on the neck.
    expect(boneBounds(parts.body, BONE.legL).max.y).toBeCloseTo(joint(BONE.legL).y, 2);
    expect(boneBounds(parts.body, BONE.head).min.y).toBeGreaterThan(joint(BONE.head).y);
    // The phone is held at the hand.
    const phone = boneBounds(parts.body, BONE.hand);
    expect(phone.max.y).toBeCloseTo(joint(BONE.hand).y, 1);
  });

  it('is the same body whatever its arms are doing', () => {
    // Folded, in a pocket or waving is the rig's business: the mesh is identical.
    const counts = (['idle', 'pocket', 'folded', 'hail'] as const).map((pose) => trianglesOf(buildHumanParts({ ...PLAIN, pose }).body));
    for (const c of counts) expect(c).toBe(counts[0]);
  });

  it('stays inside a person-sized budget', () => {
    for (const p of PASSENGERS) {
      const look = passengerLook(p.portrait);
      const parts = buildHumanParts(look);
      const total = trianglesOf(parts.body) + trianglesOf(parts.prop) + trianglesOf(parts.accent);
      expect(total, `${p.id} is too heavy`).toBeLessThan(500);
    }
  });
});

describe('the rig', () => {
  it('draws a whole crowd in two skinned meshes on one skeleton, each person where they stand', () => {
    const looks = [PLAIN, { ...PLAIN, prop: 'cooler' as const, propAccent: 0xffd9a0 }, { ...PLAIN, band: 0x3fe8ff, phone: 0xcfe6ff }];
    const crowd = createHumanCrowd(
      looks.map((look, i) => ({ look, x: i * 5, y: 0, z: -i * 3, heading: i, act: 'stand' as const, seed: i })),
    );
    const skinned = crowd.group.children.filter((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh[];
    expect(skinned).toHaveLength(2);
    expect(skinned[0].skeleton).toBe(skinned[1].skeleton);
    expect(skinned[0].skeleton.bones).toHaveLength(looks.length * HUMAN_BONE_COUNT);

    // Each person's hips are over the spot they were put on.
    crowd.update(1, 1 / 60, null);
    crowd.group.updateMatrixWorld(true);
    const bones = skinned[0].skeleton.bones;
    const at = new THREE.Vector3();
    for (let i = 0; i < looks.length; i++) {
      at.setFromMatrixPosition(bones[i * HUMAN_BONE_COUNT + BONE.hips].matrixWorld);
      expect(Math.hypot(at.x - i * 5, at.z + i * 3)).toBeLessThan(0.1);
      expect(at.y).toBeGreaterThan(0.8);
    }
    // Culling uses a sphere that holds all of them.
    const sphere = skinned[0].boundingSphere!;
    for (let i = 0; i < looks.length; i++) expect(sphere.distanceToPoint(new THREE.Vector3(i * 5, 1, -i * 3))).toBeLessThan(0);
    crowd.dispose();
  });

  it('builds a figure into a scene, moves it without allocating, and lets go of everything', () => {
    const figure = createHumanFigure({ ...PLAIN, pose: 'hail', eyes: 'eyes', prop: 'case', propAccent: 0xa8ff3e, aura: 0xff3df0 });
    let meshes = 0;
    let released = 0;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    figure.group.traverse((o) => {
      const mesh = o as THREE.Mesh & { isMesh?: boolean };
      if (!mesh.isMesh) return;
      meshes++;
      geometries.add(mesh.geometry);
      materials.add(mesh.material as THREE.Material);
    });
    for (const geo of geometries) geo.addEventListener('dispose', () => released++);
    for (const mat of materials) mat.addEventListener('dispose', () => released++);
    // Body and prop in one, the accents, the pool on the ground.
    expect(meshes).toBe(3);
    expect(materials.size).toBe(3);

    // A look that hails waves at a car coming for it: the right hand goes up past the shoulders.
    const hand = (figure.group.getObjectByName('human-body') as THREE.SkinnedMesh).skeleton.bones[BONE.hand];
    const car = { x: 0, z: -30, speed: 12, drifting: false };
    for (let i = 0; i < 90; i++) {
      figure.group.updateMatrixWorld(true);
      figure.update(i / 30, car);
    }
    figure.group.updateMatrixWorld(true);
    expect(new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld).y).toBeGreaterThan(1.7);

    figure.dispose();
    // Every geometry and every material, once each: nothing is left on the GPU.
    expect(released).toBe(geometries.size + materials.size);
    expect(figure.group.children).toHaveLength(0);
  });
});

/* ================================================================== where they wait */

describe('where a passenger waits', () => {
  const stop: PassengerStop = { id: 's', x: 20, z: 0, y: 0, heading: 0, label: 'ST MID', tags: ['market'] };
  /** A 13 m street running north-south through the stop, pavement either side. */
  const street = (x: number, _z: number): boolean => Math.abs(x - 20) <= 6.5;

  it('stands them a step inside the kerb, out of the parking space, facing the road', () => {
    const spot = standAt(stop, street);
    const across = Math.abs(spot.x - stop.x);
    expect(across).toBeGreaterThan(4);
    expect(across).toBeLessThan(6.5);
    // Still on tarmac: nobody is standing inside a wall.
    expect(street(spot.x, spot.z)).toBe(true);
    // Looking back across the road at the car rather than along the street.
    const fx = -Math.sin(spot.yaw);
    const fz = -Math.cos(spot.yaw);
    const toStop = { x: stop.x - spot.x, z: stop.z - spot.z };
    const len = Math.hypot(toStop.x, toStop.z);
    expect((fx * toStop.x + fz * toStop.z) / len).toBeGreaterThan(0.9);
  });

  it('takes the nearer kerb when the road is wider on one side', () => {
    // Tarmac from 13.5 to 32: the west kerb is 6.5 m away, the east one 12.
    const spot = standAt(stop, (x) => x >= 13.5 && x <= 32);
    expect(spot.x).toBeLessThan(stop.x);
    expect(spot.x).toBeGreaterThanOrEqual(13.5);
  });

  it('waits up the street when there is no road test to ask', () => {
    const spot = standAt(stop);
    expect(spot.x).toBeCloseTo(stop.x, 5);
    expect(spot.z).toBeLessThan(stop.z);
    expect(Math.hypot(spot.x - stop.x, spot.z - stop.z)).toBeLessThan(PASSENGER.marker.promptRadius);
  });

  it('steps out of the lane even in the middle of a junction', () => {
    // Road in every direction for a long way: no kerb to be found, so take the safe offset —
    // never the centreline, which is exactly where the car parks.
    const spot = standAt(stop, () => true);
    expect(Math.abs(spot.x - stop.x)).toBeGreaterThanOrEqual(4);
    expect(spot.z).toBeCloseTo(stop.z, 5);
  });

  it('puts everybody on the road and off the mark at every stop in the city', () => {
    const { layout, plan } = createCityWorld();
    for (const s of layout.passengerStops!) {
      const spot = standAt(s, (x, z, pad) => plan.isRoad(x, z, pad));
      expect(plan.isRoad(spot.x, spot.z, 0), `${s.id}: waiting off the road`).toBe(true);
      const off = Math.hypot(spot.x - s.x, spot.z - s.z);
      // Clear of a car parked on the mark, and never so far out that they have left their pin.
      expect(off, `${s.id}: standing on the parking spot`).toBeGreaterThanOrEqual(4);
      expect(off, `${s.id}: standing too far from the pin`).toBeLessThanOrEqual(PASSENGER.marker.exitRadius + 2);
    }
  });
});
