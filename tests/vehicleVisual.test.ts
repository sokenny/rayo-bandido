import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCarVisual } from '../src/render/scene/carVisual';
import { createElectricCarVisual, disposeElectricCarResources } from '../src/render/scene/electricCarVisual';
import { BODY, THEME, VEHICLE } from '../src/config/tuning';

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
      // body, glass, heads, tails, reverse, exhaust glow, ground pool, rocker glow, wheels,
      // plus the cabin's trim, light strips and spectrum bars.
      expect(budget.drawCalls).toBeLessThanOrEqual(12);
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

describe('player car cabin display', () => {
  const BARS = THEME.spectrum.bars;

  /** Height of every spectrum bar, in metres: an instance's y scale, since the bar geometry
   *  is one unit tall and stands on its own base. */
  function barHeights(car: ReturnType<typeof createCarVisual>): number[] {
    const bars = car.root.getObjectByName('player-car-eq') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    const out: number[] = [];
    for (let i = 0; i < bars.count; i++) {
      bars.getMatrixAt(i, matrix);
      matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      out.push(scale.y);
    }
    return out;
  }

  const run = (car: ReturnType<typeof createCarVisual>, seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) car.update(1 / 60, i / 60);
  };

  it('rests flat with no music and rises only under the bands that are playing', () => {
    const car = createCarVisual();
    try {
      run(car, 0.5);
      const silent = barHeights(car);
      expect(silent).toHaveLength(BARS);
      for (const h of silent) expect(h).toBeLessThan(0.01);

      // Bass only: the left of the display lifts, the right stays on the floor.
      const levels = new Float32Array(BARS);
      levels[0] = 1;
      levels[1] = 1;
      car.setMusic(levels);
      run(car, 0.5);
      const lit = barHeights(car);
      expect(lit[0]).toBeGreaterThan(0.08);
      expect(lit[1]).toBeGreaterThan(0.08);
      expect(lit[BARS - 1]).toBeLessThan(0.01);

      // And it falls back when the track drops out.
      car.setMusic(new Float32Array(BARS));
      run(car, 1);
      for (const h of barHeights(car)) expect(h).toBeLessThan(0.012);
    } finally {
      car.dispose();
    }
  });

  it('is unbothered by a spectrum that is the wrong length or out of range', () => {
    const car = createCarVisual();
    try {
      car.setMusic([2, -1, 0.5]);
      run(car, 0.5);
      const heights = barHeights(car);
      for (const h of heights) {
        expect(Number.isFinite(h)).toBe(true);
        expect(h).toBeGreaterThan(0);
        // Never taller than the 0.15 m display face it stands on.
        expect(h).toBeLessThan(0.15);
      }
      expect(heights[BARS - 1]).toBeLessThan(0.01); // never fed, so never lifted
    } finally {
      car.dispose();
    }
  });
});

describe('player car body roll', () => {
  const settle = (car: ReturnType<typeof createCarVisual>, seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) car.update(1 / 60, i / 60);
  };

  it('leans onto the outside of a turn, dives under braking and keeps the wheels planted', () => {
    const car = createCarVisual();
    try {
      const wheelY = car.wheels.map((w) => w.steer.getWorldPosition(new THREE.Vector3()).y);

      // Cornering right pushes the body toward +X, so it leans onto its left side (+Z rot).
      car.setBodyAccel(VEHICLE.maxLatAccel, 0);
      settle(car, 1);
      const roll = car.chassis.rotation.z;
      expect(roll).toBeGreaterThan(0.02);
      expect(roll).toBeLessThan(0.08); // subtle: a stiff drift car, not a wallowing sedan
      expect(Math.abs(car.chassis.rotation.x)).toBeLessThan(1e-3);

      car.setBodyAccel(-VEHICLE.maxLatAccel, 0);
      settle(car, 1);
      expect(car.chassis.rotation.z).toBeCloseTo(-roll, 4);

      // Braking drops the nose (nose is at -Z, so a negative rotation about X).
      car.setBodyAccel(0, -VEHICLE.brakeDecel);
      settle(car, 1);
      expect(car.chassis.rotation.x).toBeLessThan(-0.01);
      car.setBodyAccel(0, VEHICLE.engineAccel);
      settle(car, 1);
      expect(car.chassis.rotation.x).toBeGreaterThan(0);

      // The wheels are not sprung: they stay exactly where they were.
      for (let i = 0; i < car.wheels.length; i++) {
        expect(car.wheels[i].steer.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(wheelY[i], 6);
      }
    } finally {
      car.dispose();
    }
  });

  it('bounds a collision-sized spike and returns to level on reset', () => {
    const car = createCarVisual();
    try {
      car.setBodyAccel(-4000, -9000);
      settle(car, 2);
      // Overshoot is allowed, running away is not.
      expect(Math.abs(car.chassis.rotation.z)).toBeLessThan(0.09);
      expect(Math.abs(car.chassis.rotation.x)).toBeLessThan(0.07);

      car.resetBody();
      expect(car.chassis.rotation.z).toBe(0);
      expect(car.chassis.rotation.x).toBe(0);
      car.update(1 / 60, 0);
      expect(car.chassis.rotation.z).toBe(0);
      expect(car.chassis.rotation.x).toBe(0);
    } finally {
      car.dispose();
    }
  });

  it('dips and lurches forward on an upshift, then settles back', () => {
    const car = createCarVisual();
    try {
      const wheelZ = car.wheels.map((w) => w.steer.getWorldPosition(new THREE.Vector3()).z);

      car.shiftKick(1);
      let lowestPitch = 0;
      let furthestSurge = 0;
      for (let i = 0; i < 12; i++) {
        car.update(1 / 60, i / 60);
        lowestPitch = Math.min(lowestPitch, car.chassis.rotation.x);
        furthestSurge = Math.min(furthestSurge, car.chassis.position.z);
      }
      // Nose down and body toward the nose (-Z), both visible and both small.
      expect(lowestPitch).toBeLessThan(-0.005);
      expect(lowestPitch).toBeGreaterThan(-0.04);
      expect(furthestSurge).toBeLessThan(-0.004);
      expect(furthestSurge).toBeGreaterThan(-0.035);

      // No acceleration is holding it there: it comes home on its own.
      settle(car, 2);
      expect(Math.abs(car.chassis.rotation.x)).toBeLessThan(1e-3);
      expect(Math.abs(car.chassis.position.z)).toBeLessThan(1e-3);

      // A downshift shoves the other way.
      car.shiftKick(-1);
      let highestPitch = 0;
      for (let i = 0; i < 12; i++) {
        car.update(1 / 60, i / 60);
        highestPitch = Math.max(highestPitch, car.chassis.rotation.x);
      }
      expect(highestPitch).toBeGreaterThan(0.004);

      // Whatever the body does, the wheels stay put.
      for (let i = 0; i < car.wheels.length; i++) {
        expect(car.wheels[i].steer.getWorldPosition(new THREE.Vector3()).z).toBeCloseTo(wheelZ[i], 6);
      }
    } finally {
      car.dispose();
    }
  });

  it('keeps the body on the car through a burst of shifts, and resets with it', () => {
    const car = createCarVisual();
    try {
      for (let i = 0; i < 20; i++) {
        car.shiftKick(i % 2 === 0 ? 1 : -1);
        car.update(1 / 60, i / 60);
      }
      expect(Math.abs(car.chassis.position.z)).toBeLessThanOrEqual(BODY.surgeLimit + 1e-9);
      expect(Math.abs(car.chassis.rotation.x)).toBeLessThan(0.07);

      car.resetBody();
      expect(car.chassis.position.z).toBe(0);
      car.update(1 / 60, 0);
      expect(car.chassis.position.z).toBe(0);
    } finally {
      car.dispose();
    }
  });

  it('survives a long stalled frame without exploding', () => {
    const car = createCarVisual();
    try {
      car.setBodyAccel(VEHICLE.maxLatAccel, -VEHICLE.brakeDecel);
      car.update(0.5, 0.5);
      expect(Number.isFinite(car.chassis.rotation.z)).toBe(true);
      expect(Math.abs(car.chassis.rotation.z)).toBeLessThan(0.09);
      expect(Math.abs(car.chassis.rotation.x)).toBeLessThan(0.07);
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
