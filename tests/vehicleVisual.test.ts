import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCarVisual } from '../src/render/scene/carVisual';
import { createElectricCarVisual, disposeElectricCarResources } from '../src/render/scene/electricCarVisual';
import { VEHICLE } from '../src/config/tuning';

interface Budget {
  triangles: number;
  drawCalls: number;
}

function measure(root: THREE.Object3D): Budget {
  let triangles = 0;
  let drawCalls = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh & { isMesh?: boolean; isInstancedMesh?: boolean; count?: number };
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    const tris = (index ? index.count : position.count) / 3;
    const instances = mesh.isInstancedMesh ? (mesh.count ?? 1) : 1;
    triangles += tris * instances;
    drawCalls += 1;
  });
  return { triangles, drawCalls };
}

describe('player car visual', () => {
  it('keeps the wheel contract and stays inside the budget', () => {
    const car = createCarVisual();
    try {
      expect(car.wheels).toHaveLength(4);
      for (const wheel of car.wheels) {
        expect(wheel.spin.parent).toBe(wheel.steer);
        expect(wheel.steer.position.y).toBeCloseTo(VEHICLE.wheelRadius, 6);
      }
      const halfTrack = VEHICLE.trackWidth / 2;
      const halfBase = VEHICLE.wheelbase / 2;
      expect(car.wheels[0].steer.position.x).toBeLessThanOrEqual(-halfTrack);
      expect(car.wheels[1].steer.position.x).toBeGreaterThanOrEqual(halfTrack);
      expect(car.wheels[0].steer.position.z).toBeCloseTo(-halfBase, 6);
      expect(car.wheels[2].steer.position.z).toBeCloseTo(halfBase, 6);

      const budget = measure(car.root);
      expect(budget.triangles).toBeLessThan(8000);
      expect(budget.drawCalls).toBeLessThanOrEqual(8);
    } finally {
      car.dispose();
    }
  });

  it('drives its light and glow state without throwing or allocating new materials', () => {
    const car = createCarVisual();
    try {
      car.setNitro(1);
      car.setCharge(1);
      car.setBrakeLights(true);
      car.setReverseLights(true);
      car.update(1 / 60, 3.2);
      car.setNitro(0);
      car.setCharge(0);
      car.setBrakeLights(false);
      car.setReverseLights(false);
      car.update(1 / 60, 3.25);

      // Steering and rolling must reach the instanced wheels.
      car.wheels[0].steer.rotation.y = 0.4;
      car.wheels[0].spin.rotation.x = 1.1;
      car.update(1 / 60, 3.3);
      const wheels = car.root.getObjectByName('player-car-wheels') as THREE.InstancedMesh;
      expect(wheels).toBeTruthy();
      const matrix = new THREE.Matrix4();
      wheels.getMatrixAt(0, matrix);
      const position = new THREE.Vector3().setFromMatrixPosition(matrix);
      expect(position.y).toBeCloseTo(VEHICLE.wheelRadius, 6);
      expect(position.x).toBeLessThan(0);
      expect(matrix.elements[0]).not.toBeCloseTo(1, 3);
    } finally {
      car.dispose();
    }
  });
});

describe('electric car visual', () => {
  it('stays inside the per-target budget and shares geometry between instances', () => {
    const a = createElectricCarVisual(0);
    const b = createElectricCarVisual(1);
    try {
      const budget = measure(a.root);
      expect(budget.triangles).toBeLessThan(2500);
      expect(budget.drawCalls).toBeLessThanOrEqual(4);

      const geometriesA: THREE.BufferGeometry[] = [];
      const geometriesB: THREE.BufferGeometry[] = [];
      a.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) geometriesA.push((o as THREE.Mesh).geometry);
      });
      b.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) geometriesB.push((o as THREE.Mesh).geometry);
      });
      expect(geometriesA).toHaveLength(geometriesB.length);
      for (let i = 0; i < geometriesA.length; i++) expect(geometriesA[i]).toBe(geometriesB[i]);
    } finally {
      a.dispose();
      b.dispose();
      disposeElectricCarResources();
    }
  });

  it('darkens and sags after a hit, and recovers when active again', () => {
    const target = createElectricCarVisual(2);
    try {
      const chassis = target.root.children[0];
      target.setStatus('active', 0);
      target.update(1 / 60, 0.5);
      expect(chassis.rotation.z).toBe(0);

      target.setStatus('destroyed', 0.25);
      target.update(1 / 60, 0.75);
      const midTilt = Math.abs(chassis.rotation.z);
      target.setStatus('destroyed', 2);
      target.update(1 / 60, 2.5);
      expect(Math.abs(chassis.rotation.z)).toBeGreaterThan(midTilt);
      expect(chassis.position.y).toBeLessThan(0);

      target.setAcquired(true);
      target.update(1 / 60, 2.6);
      target.setStatus('active', 0);
      expect(chassis.rotation.z).toBe(0);
      expect(chassis.position.y).toBe(0);
    } finally {
      target.dispose();
      disposeElectricCarResources();
    }
  });
});
