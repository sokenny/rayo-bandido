import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CAMERA_SHOTS, CATEGORIES, type CameraShot, type CameraShotKey } from '../src/content/carParts';
import { carBoxExit, createWorkshopCamera, type WorkshopCameraInput, type WorkshopRigState } from '../src/render/workshop/workshopCamera';
import { CAMERA_BOUNDS, TABLE } from '../src/render/workshop/showroomLayout';

const NONE: WorkshopCameraInput = { dragYaw: 0, dragPitch: 0, zoom: 0, dragging: false };
const CAR_BOX = { halfX: 1.05, height: 1.42, halfZ: 2.3 };
const DT = 1 / 60;

function rig(turntableYaw = 0): WorkshopRigState {
  return { originY: TABLE.top, turntableYaw };
}

function make() {
  const cam = createWorkshopCamera({ bounds: CAMERA_BOUNDS, carBox: CAR_BOX });
  cam.camera.aspect = 16 / 9;
  return cam;
}

function run(cam: ReturnType<typeof make>, seconds: number, input = NONE, state = rig()): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) cam.update(DT, input, state);
}

/** Where a shot puts the lens with the table at rest, from the formula in `workshopShots.ts`. */
function expected(s: CameraShot): THREE.Vector3 {
  const cp = Math.cos(s.pitch);
  return new THREE.Vector3(
    s.distance * Math.sin(s.yaw) * cp,
    TABLE.top + s.targetY + s.distance * Math.sin(s.pitch),
    s.targetZ - s.distance * Math.cos(s.yaw) * cp,
  );
}

function inRoom(p: THREE.Vector3): boolean {
  const e = 1e-3;
  const b = CAMERA_BOUNDS;
  return p.x >= b.minX - e && p.x <= b.maxX + e && p.z >= b.minZ - e && p.z <= b.maxZ + e && p.y >= b.minY - e && p.y <= b.maxY + e;
}

function outsideCar(p: THREE.Vector3, table = 0): boolean {
  // Into the car's frame: undo the table's turn about Y.
  const c = Math.cos(table);
  const s = Math.sin(table);
  const x = p.x * c - p.z * s;
  const z = p.x * s + p.z * c;
  const y = p.y - TABLE.top;
  return Math.abs(x) > CAR_BOX.halfX || Math.abs(z) > CAR_BOX.halfZ || y > CAR_BOX.height || y < 0;
}

describe('workshop camera shots', () => {
  it('every shot lands where its numbers say, inside the room and outside the car', () => {
    for (const key of Object.keys(CAMERA_SHOTS) as CameraShotKey[]) {
      const shot = CAMERA_SHOTS[key];
      const cam = make();
      // Orbit shots turn the table, not the camera: with the table held still the lens stays put.
      cam.setShot(key, true);
      run(cam, 1);
      const p = cam.camera.position;
      expect(inRoom(p), `${key} in room`).toBe(true);
      expect(outsideCar(p), `${key} outside the car`).toBe(true);
      // Within the breathing sway (a couple of centimetres of arc per metre of distance).
      expect(p.distanceTo(expected(shot)), `${key} on its mark`).toBeLessThan(0.05 * shot.distance + 0.05);
      expect(cam.camera.fov).toBeCloseTo(shot.fov, 0);
    }
  });

  it('every category eases to a shot the room can hold', () => {
    const cam = make();
    for (const c of CATEGORIES) {
      cam.setCategory(c.id);
      run(cam, 2.5);
      expect(cam.shotKey).toBe(c.cameraShot);
      expect(inRoom(cam.camera.position), c.id).toBe(true);
      expect(outsideCar(cam.camera.position), c.id).toBe(true);
    }
  });

  it('travels to a new shot in well under a second, starting smoothly', () => {
    const cam = make();
    cam.setShot('front34Low', true);
    run(cam, 0.5);
    cam.setShot('rear34Low');
    const start = cam.camera.position.clone();
    cam.update(DT, NONE, rig());
    // Critically damped: the first frame barely moves (no jump cut)…
    expect(cam.camera.position.distanceTo(start)).toBeLessThan(0.2);
    run(cam, 0.8);
    // …and by 0.8 s it has all but arrived.
    expect(cam.camera.position.distanceTo(expected(CAMERA_SHOTS.rear34Low))).toBeLessThan(0.35);
  });

  it('turns the short way round', () => {
    const cam = make();
    const a: CameraShot = { ...CAMERA_SHOTS.sideLow, yaw: 2.9 };
    const b: CameraShot = { ...CAMERA_SHOTS.sideLow, yaw: -2.9 };
    cam.setShot(a, true);
    run(cam, 0.3);
    cam.setShot(b);
    let closestToNose = Math.PI;
    for (let i = 0; i < 120; i++) {
      cam.update(DT, NONE, rig());
      closestToNose = Math.min(closestToNose, Math.abs(cam.state.carYaw));
    }
    // Through the tail (|yaw| near π), never round past the nose (yaw 0).
    expect(closestToNose).toBeGreaterThan(2.5);
    expect(Math.abs(Math.abs(cam.state.carYaw) - 2.9)).toBeLessThan(0.08);
  });

  it('never goes under the floor, through a wall, or into the car when dragged', () => {
    const cam = make();
    cam.setShot('wheelFront', true);
    run(cam, 0.2);
    // Drag hard down and round, then zoom all the way out and all the way in.
    for (let i = 0; i < 200; i++) {
      cam.update(DT, { dragYaw: 0.05, dragPitch: -0.05, zoom: i < 100 ? -3 : 3, dragging: true }, rig());
      expect(inRoom(cam.camera.position)).toBe(true);
      expect(outsideCar(cam.camera.position)).toBe(true);
    }
    for (let i = 0; i < 200; i++) {
      cam.update(DT, { dragYaw: 0, dragPitch: 0.08, zoom: -4, dragging: true }, rig());
      expect(inRoom(cam.camera.position)).toBe(true);
    }
  });

  it('eases back to the shot a few seconds after the player lets go', () => {
    const cam = make();
    cam.setShot('front34Low', true);
    run(cam, 0.2);
    cam.update(DT, { dragYaw: 1.2, dragPitch: 0.2, zoom: -3, dragging: true }, rig());
    cam.update(DT, { dragYaw: 0, dragPitch: 0, zoom: 0, dragging: false }, rig());
    const home = expected(CAMERA_SHOTS.front34Low);
    run(cam, 2);
    // Still where the player left it…
    expect(cam.camera.position.distanceTo(home)).toBeGreaterThan(1.5);
    run(cam, 3.5);
    // …then back on the mark.
    expect(cam.camera.position.distanceTo(home)).toBeLessThan(0.35);
  });

  it('rides with the table for part shots and stays in the room for orbit shots', () => {
    const cam = make();
    cam.setShot('front34Low', true);
    run(cam, 1, NONE, rig(Math.PI / 2));
    // In the car's frame, the shot's own yaw, whatever the table did.
    expect(Math.abs(cam.state.carYaw - CAMERA_SHOTS.front34Low.yaw)).toBeLessThan(0.06);

    const orbit: CameraShot = { ...CAMERA_SHOTS.overview, targetZ: 0, orbitSpeed: 0.2 };
    cam.setShot(orbit, true);
    run(cam, 0.5, NONE, rig(0));
    expect(cam.orbitSpeed).toBeCloseTo(0.2);
    const before = cam.camera.position.clone();
    // The table turns a quarter; the camera does not follow it.
    for (let i = 0; i < 90; i++) cam.update(DT, NONE, rig((i / 90) * (Math.PI / 2)));
    expect(cam.camera.position.distanceTo(before)).toBeLessThan(0.3);
  });

  it('swoops in from wide and high on intro, and pulls back on outro', () => {
    const cam = make();
    cam.setShot('front34Low', true);
    cam.update(DT, NONE, rig());
    cam.intro();
    cam.update(DT, NONE, rig());
    const home = expected(CAMERA_SHOTS.front34Low);
    expect(cam.camera.position.distanceTo(home)).toBeGreaterThan(2);
    run(cam, 2.6);
    expect(cam.camera.position.distanceTo(home)).toBeLessThan(0.3);
    cam.outro();
    run(cam, 1.5);
    expect(cam.state.distance).toBeGreaterThan(CAMERA_SHOTS.front34Low.distance * 1.3);
    expect(inRoom(cam.camera.position)).toBe(true);
  });

  it('widens the lens on a screen narrower than 16:9', () => {
    const cam = make();
    cam.camera.aspect = 4 / 3;
    cam.setShot('sideLow', true);
    cam.update(DT, NONE, rig());
    expect(cam.camera.fov).toBeGreaterThan(CAMERA_SHOTS.sideLow.fov + 5);
  });

  it('shifts the picture with the lens, not the aim', () => {
    const cam = make();
    cam.setShot('front34Low', true);
    cam.setFraming(0, 0);
    cam.update(DT, NONE, rig());
    const centred = cam.camera.projectionMatrix.elements.slice();
    cam.setFraming(0.1, -0.2);
    cam.update(DT, NONE, rig());
    const e = cam.camera.projectionMatrix.elements;
    expect(e[8] - centred[8]).toBeCloseTo(-0.1, 2);
    expect(e[9] - centred[9]).toBeCloseTo(0.2, 2);
  });
});

describe('carBoxExit', () => {
  it('measures how far a ray from inside the car travels to leave it', () => {
    // Straight out of the right flank from the centreline.
    expect(carBoxExit(0.5, 0, 1, 0, 0, CAR_BOX)).toBeCloseTo(1.05);
    // Straight back from the plate, 15 cm inside the tail.
    expect(carBoxExit(0.5, 2.15, 0, 0, 1, CAR_BOX)).toBeCloseTo(0.15);
    // Up through the roof.
    expect(carBoxExit(1.0, 0, 0, 1, 0, CAR_BOX)).toBeCloseTo(0.42);
    // A target outside the box needs no push.
    expect(carBoxExit(0.5, 3, 0, 0, 1, CAR_BOX)).toBe(0);
  });
});
