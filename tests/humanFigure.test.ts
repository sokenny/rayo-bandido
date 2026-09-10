import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HUMAN_CROWN, buildHumanParts, createHumanFigure, type HumanLook } from '../src/render/scene/env/humanFigure';
import { passengerLook, standAt } from '../src/render/scene/env/passengerFigure';
import { PASSENGERS } from '../src/content/passengers';
import type { PassengerStop } from '../src/core/types';
import { createCityWorld } from '../src/world/cityWorld';
import { PASSENGER } from '../src/config/tuning';

/**
 * The shared body (`src/render/scene/env/humanFigure.ts`) is what every person in this city is
 * made of, so what is worth pinning is the contract the rest of the game leans on rather than
 * the shape of anyone's coat: that a figure stands on the ground at its own origin, that it is
 * as tall as it says it is, that a look's choices actually change the geometry, that a waving
 * arm turns about a real shoulder, and that nobody costs more than a person should.
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

  it('stands where it is put', () => {
    const box = boundsOf(buildHumanParts(PLAIN, { x: 40, y: 3, z: -12 }).body);
    expect(box.min.y).toBeCloseTo(3, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(40, 1);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(-12, 1);
  });

  it('carries what is carried and grounds what is grounded', () => {
    // A camera is held, so it belongs to the body that sways; a case is set down, so it does not.
    const filming = buildHumanParts({ ...PLAIN, pose: 'hail', prop: 'camera' });
    expect(filming.prop).toBeNull();
    const carrying = buildHumanParts({ ...PLAIN, prop: 'case' });
    expect(carrying.prop).not.toBeNull();
    const propBox = boundsOf(carrying.prop!);
    expect(propBox.min.y).toBeCloseTo(0, 5);
    // Beside them rather than through them.
    expect(propBox.max.x).toBeLessThan(boundsOf(carrying.body).min.x + 0.2);
  });

  it('only lights what a look asks to be lit', () => {
    expect(buildHumanParts(PLAIN).accent).toBeNull();
    const lit = buildHumanParts({ ...PLAIN, eyes: 'lenses', eyeColor: 0xf0b34a, band: 0xa8ff3e });
    expect(lit.accent).not.toBeNull();
    // Vertex-coloured, so several colours share one unlit mesh.
    expect(lit.accent!.getAttribute('color')).toBeTruthy();
    const eyesBox = boundsOf(lit.accent!);
    // The lenses are on the face: high up, and in front.
    expect(eyesBox.max.y).toBeGreaterThan(1.6);
    expect(eyesBox.min.z).toBeLessThan(0);
  });

  it('gives a hailing figure an arm that turns about its shoulder', () => {
    const still = buildHumanParts(PLAIN);
    expect(still.arm).toBeNull();
    const waving = buildHumanParts({ ...PLAIN, pose: 'hail' });
    expect(waving.arm).not.toBeNull();
    // The pivot is a shoulder: chest height, out at the side of the torso.
    expect(waving.armPivot.y).toBeGreaterThan(1.2);
    expect(waving.armPivot.y).toBeLessThan(HUMAN_CROWN);
    expect(Math.abs(waving.armPivot.x)).toBeGreaterThan(0.25);
    // The arm's own geometry starts at that shoulder and goes up from it, so placing the mesh
    // at the pivot is all that is needed to hang it on the body.
    const armBox = boundsOf(waving.arm!);
    expect(armBox.min.y).toBeCloseTo(0, 1);
    expect(armBox.max.y).toBeGreaterThan(0.9);
  });

  it('poses change the arms without changing the person', () => {
    const heights = (['idle', 'pocket', 'folded', 'hail'] as const).map((pose) =>
      boundsOf(buildHumanParts({ ...PLAIN, pose }).body).max.y,
    );
    // The raised arm is a mesh of its own, so no pose makes the body itself any taller.
    for (const h of heights) expect(h).toBeCloseTo(heights[0], 5);
    const folded = trianglesOf(buildHumanParts({ ...PLAIN, pose: 'folded' }).body);
    const idle = trianglesOf(buildHumanParts({ ...PLAIN, pose: 'idle' }).body);
    expect(folded).not.toBe(idle);
  });

  it('stays inside a person-sized budget', () => {
    for (const p of PASSENGERS) {
      const look = passengerLook(p.portrait);
      const parts = buildHumanParts(look);
      const total = trianglesOf(parts.body) + trianglesOf(parts.prop) + trianglesOf(parts.accent) + trianglesOf(parts.arm);
      expect(total, `${p.id} is too heavy`).toBeLessThan(500);
    }
  });

  it('builds into a scene, animates without allocating, and lets go of everything', () => {
    const figure = createHumanFigure({ ...PLAIN, pose: 'hail', eyes: 'eyes', prop: 'case', propAccent: 0xa8ff3e });
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
    // Body, prop, accent, arm — and the three lit ones share a single material.
    expect(meshes).toBe(4);
    expect(materials.size).toBe(2);

    const arm = figure.group.getObjectByName('human-arm')!;
    figure.update(0);
    const first = arm.rotation.z;
    figure.update(0.4);
    expect(arm.rotation.z).not.toBeCloseTo(first, 4);

    figure.dispose();
    // Every geometry and both materials, once each: nothing is left on the GPU.
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
