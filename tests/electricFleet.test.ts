import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BEACON_DIM,
  BEACON_FLASH,
  ELECTRIC_CASCADE_END,
  createElectricCarVisual,
  disposeElectricCarResources,
  electricBeaconFlash,
  electricBodyPaint,
  electricChassisPose,
  electricDeadPaint,
  type ElectricCarVisual,
} from '../src/render/scene/electricCarVisual';
import { createElectricFleet, electricFleetMatrix, type ElectricFleet } from '../src/render/scene/electricFleet';

type Std = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
type Basic = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

function parts(vis: ElectricCarVisual): { chassis: THREE.Group; body: Std; bars: Std; beacon: Basic } {
  const chassis = vis.root.children[0] as THREE.Group;
  return { chassis, body: chassis.children[0] as Std, bars: chassis.children[1] as Std, beacon: chassis.children[2] as Basic };
}

function expectMatrixClose(a: THREE.Matrix4, b: THREE.Matrix4): void {
  for (let i = 0; i < 16; i++) expect(a.elements[i]).toBeCloseTo(b.elements[i], 6);
}

function cameraLookingAt(x: number, z: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
  camera.position.set(x, 4, z + 12);
  camera.lookAt(x, 1, z);
  camera.updateMatrixWorld();
  return camera;
}

function mesh(fleet: ElectricFleet, name: string): THREE.InstancedMesh {
  return fleet.root.children.find((o) => o.name === name) as THREE.InstancedMesh;
}

afterEach(() => disposeElectricCarResources());

describe('electric fleet instancing', () => {
  it('builds the same world matrices as the per-car scene graph, alive and at every stage of a hit', () => {
    const pose = { rx: 0, ry: 0, rz: 0, y: 0 };
    const m = new THREE.Matrix4();
    for (const index of [0, 1, 2, 3, 5]) {
      const vis = createElectricCarVisual(index);
      const { body, beacon } = parts(vis);
      try {
        vis.root.position.set(12.5, 0.4, -30);
        vis.root.rotation.y = 2.1 + index;

        // In service, beacon in and out of its flash.
        vis.setStatus('active', 0);
        for (const time of [0.05, 0.6]) {
          vis.update(1 / 60, time);
          vis.root.updateMatrixWorld(true);
          electricChassisPose(index, null, pose);
          expectMatrixClose(electricFleetMatrix(m, 12.5, 0.4, -30, 2.1 + index, pose), body.matrixWorld);
          const look = electricBeaconFlash(index, time) ? BEACON_FLASH : BEACON_DIM;
          expectMatrixClose(electricFleetMatrix(m, 12.5, 0.4, -30, 2.1 + index, pose, look.scale), beacon.matrixWorld);
        }

        // Down: the jerk, the sag, settled.
        for (const age of [0.1, 0.3, 0.7, 2, ELECTRIC_CASCADE_END, 40]) {
          vis.setStatus('destroyed', age);
          vis.root.updateMatrixWorld(true);
          electricChassisPose(index, age, pose);
          expectMatrixClose(electricFleetMatrix(m, 12.5, 0.4, -30, 2.1 + index, pose), body.matrixWorld);
        }
      } finally {
        vis.dispose();
      }
    }
  });

  it('draws nothing past ELECTRIC_CASCADE_END that differs from a settled wreck, for every variant', () => {
    for (const index of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const end = createElectricCarVisual(index);
      const settled = createElectricCarVisual(index);
      try {
        end.setStatus('destroyed', ELECTRIC_CASCADE_END);
        settled.setStatus('destroyed', 0); // no hit time: the end of a cascade nobody saw
        const a = parts(end);
        const b = parts(settled);
        expect(a.body.material.color.getHex()).toBe(b.body.material.color.getHex());
        expect(a.body.material.roughness).toBeCloseTo(b.body.material.roughness, 9);
        expect(a.body.material.metalness).toBeCloseTo(b.body.material.metalness, 9);
        expect(a.body.material.emissiveIntensity).toBe(0);
        expect(b.body.material.emissiveIntensity).toBe(0);
        expect(a.bars.material.emissiveIntensity).toBe(0);
        expect(b.bars.material.emissiveIntensity).toBe(0);
        expect(a.beacon.visible).toBe(false);
        expect(b.beacon.visible).toBe(false);
        for (const k of ['x', 'y', 'z'] as const) expect(a.chassis.rotation[k]).toBeCloseTo(b.chassis.rotation[k], 9);
        expect(a.chassis.position.y).toBeCloseTo(b.chassis.position.y, 9);
        // And the look the fleet gives the wreck is exactly that one.
        expect(electricDeadPaint(index, new THREE.Color()).getHex()).toBe(b.body.material.color.getHex());
      } finally {
        end.dispose();
        settled.dispose();
      }
    }
  });

  it('instances cars in service and settled wrecks, and hands a fresh hit to its own visual until it settles', () => {
    const fleet = createElectricFleet(6);
    try {
      const camera = cameraLookingAt(0, 0);
      const stage = (status: (i: number) => 'active' | 'destroyed', age: (i: number) => number) => {
        for (let i = 0; i < 6; i++) fleet.place(i, (i - 2.5) * 3, 0, 0, 0, status(i), age(i), false);
        fleet.commit(camera, 1, 1 / 60);
      };

      stage(() => 'active', () => 0);
      expect(fleet.stats.alive).toBe(6);
      expect(fleet.stats.beaconsFlash + fleet.stats.beaconsDim).toBe(6);
      expect(fleet.stats.cascading).toBe(0);
      // The paint is the instance colour.
      const colors = mesh(fleet, 'electric-fleet-body').instanceColor!;
      const seen = new Set<number>();
      for (let s = 0; s < 6; s++) seen.add(new THREE.Color().fromArray(colors.array, s * 3).getHex());
      expect(seen).toEqual(new Set([0, 1, 2].map((i) => electricBodyPaint(i).getHex())));

      // Car 1 hit 0.3 s ago, car 4 a wreck from before we arrived.
      stage((i) => (i === 1 || i === 4 ? 'destroyed' : 'active'), (i) => (i === 1 ? 0.3 : 0));
      expect(fleet.stats.alive).toBe(4);
      expect(fleet.stats.dead).toBe(1);
      expect(fleet.stats.cascading).toBe(1);
      const cascade = fleet.root.children.find((o) => o.name === 'electric-car-1')!;
      expect(cascade.position.x).toBeCloseTo(-4.5);
      // Its own visual is mid-cascade: sagging, not settled.
      expect(Math.abs((cascade.children[0] as THREE.Group).rotation.z)).toBeGreaterThan(0);

      // Settled: the visual is released and the wreck joins the instanced dead.
      stage((i) => (i === 1 || i === 4 ? 'destroyed' : 'active'), (i) => (i === 1 ? ELECTRIC_CASCADE_END + 0.01 : 0));
      expect(fleet.stats.cascading).toBe(0);
      expect(fleet.stats.dead).toBe(2);
      expect(fleet.root.children.some((o) => o.name === 'electric-car-1')).toBe(false);

      // Revived mid-cascade: straight back to the clean instanced look.
      stage((i) => (i === 3 ? 'destroyed' : 'active'), () => 0.2);
      expect(fleet.stats.cascading).toBe(1);
      stage(() => 'active', () => 0);
      expect(fleet.stats.cascading).toBe(0);
      expect(fleet.stats.alive).toBe(6);
      expect(fleet.stats.dead).toBe(0);
      expect(mesh(fleet, 'electric-fleet-body-dead').visible).toBe(false);
    } finally {
      fleet.dispose();
    }
  });

  it('rings the Rush targets from a pool, and culls only what the camera cannot see', () => {
    const fleet = createElectricFleet(4);
    try {
      const camera = cameraLookingAt(0, 0);
      fleet.place(0, 0, 0, 0, 0, 'active', 0, true);
      fleet.place(1, 3, 0, 0, 0, 'active', 0, true);
      // Behind the camera, and far off to one side: out of the frustum.
      fleet.place(2, 0, 0, 60, 0, 'active', 0, false);
      // Down the view, 400 m out: in the frustum, and drawn — nothing is culled by distance.
      fleet.place(3, 0, 0, -400, 0, 'active', 0, true);
      fleet.commit(camera, 2, 1 / 60);
      expect(fleet.stats.rings).toBe(3);
      const rings = fleet.root.children.filter((o) => o.name === 'electric-fleet-ring' && o.visible);
      expect(rings).toHaveLength(3);
      expect(rings[0].position.y).toBeCloseTo(0.04);
      expect(fleet.stats.alive).toBe(3);
      expect(fleet.stats.culled).toBe(1);

      fleet.cull = false;
      fleet.commit(camera, 2, 1 / 60);
      expect(fleet.stats.alive).toBe(4);
      expect(fleet.stats.culled).toBe(0);

      // Unmarked, the rings go.
      for (let i = 0; i < 4; i++) fleet.place(i, 0, 0, 0, 0, 'active', 0, false);
      fleet.commit(camera, 2, 1 / 60);
      expect(fleet.root.children.filter((o) => o.name === 'electric-fleet-ring' && o.visible)).toHaveLength(0);
    } finally {
      fleet.dispose();
    }
  });

  it('draws the whole fleet in a handful of meshes whatever its size', () => {
    const fleet = createElectricFleet(614);
    try {
      const instanced = fleet.root.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh);
      expect(instanced.length).toBeLessThanOrEqual(6);
      for (const o of instanced) expect((o as THREE.InstancedMesh).instanceMatrix.count).toBe(614);
    } finally {
      fleet.dispose();
    }
  });
});
