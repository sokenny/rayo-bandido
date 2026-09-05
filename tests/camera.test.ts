import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createChaseCamera, type CameraPose, type CameraView } from '../src/render/camera/chaseCamera';
import { createKeyboardInput, createPlayerCommand } from '../src/core/input/keyboard';
import { CAMERA } from '../src/config/tuning';
import { forwardX, forwardZ, rightX, rightZ } from '../src/core/math';

const DT = 1 / 60;

/** A `keydown` the node test environment can build: the input source only reads `code`. */
function press(target: Window, code: string): void {
  const event = new Event('keydown') as Event & { code: string; repeat: boolean };
  event.code = code;
  event.repeat = false;
  target.dispatchEvent(event);
}

function poseAt(x = 0, z = 0, heading = 0, extra: Partial<CameraPose> = {}): CameraPose {
  return {
    x,
    z,
    heading,
    vx: 0,
    vz: 0,
    speed: 0,
    slipAngle: 0,
    nitro: 0,
    drifting: false,
    roll: 0,
    pitch: 0,
    ...extra,
  };
}

/** Where a mount's offsets say the lens belongs, worked out independently of the rig. */
function expectedMount(pose: CameraPose, mount: (typeof CAMERA.mounts)[keyof typeof CAMERA.mounts]): THREE.Vector3 {
  const h = pose.heading;
  return new THREE.Vector3(
    pose.x + forwardX(h) * mount.ahead + rightX(h) * mount.side,
    mount.height,
    pose.z + forwardZ(h) * mount.ahead + rightZ(h) * mount.side,
  );
}

describe('camera views', () => {
  it('cycles chase -> front -> side and wraps', () => {
    const rig = createChaseCamera(16 / 9);
    expect(rig.view).toBe('chase');
    expect(rig.cycleView()).toBe('front');
    expect(rig.cycleView()).toBe('side');
    expect(rig.cycleView()).toBe('chase');
  });

  it('latches P into the command for exactly one poll', () => {
    // `createKeyboardInput` also hangs blur/mousedown off the global window; this suite runs
    // in node, so it gets the same event target to hang them on.
    const target = new EventTarget() as unknown as Window;
    const previous = (globalThis as { window?: Window }).window;
    (globalThis as { window?: Window }).window = target;
    const input = createKeyboardInput(target);
    const cmd = createPlayerCommand();

    input.poll(cmd);
    expect(cmd.pov).toBe(false);

    press(target, 'KeyP');
    input.poll(cmd);
    expect(cmd.pov).toBe(true);

    // Held down, not tapped again: the edge is spent, so the view must not keep cycling.
    input.poll(cmd);
    expect(cmd.pov).toBe(false);
    input.dispose();
    (globalThis as { window?: Window }).window = previous;
  });

  for (const view of ['front', 'side'] as const) {
    it(`places the ${view} mount at its car-local offset, whatever the heading`, () => {
      const rig = createChaseCamera(16 / 9);
      rig.setView(view);
      const mount = CAMERA.mounts[view];
      for (const heading of [0, Math.PI / 2, -2.3, Math.PI]) {
        const pose = poseAt(12, -40, heading);
        rig.update(pose, DT);
        expect(rig.camera.position.distanceTo(expectedMount(pose, mount))).toBeLessThan(1e-6);
      }
    });

    it(`aims the ${view} mount from the lens toward its look point`, () => {
      const rig = createChaseCamera(16 / 9);
      rig.setView(view);
      const mount = CAMERA.mounts[view];
      const pose = poseAt(0, 0, 0.7);
      rig.update(pose, DT);

      const look = new THREE.Vector3(
        pose.x + forwardX(pose.heading) * mount.lookAhead + rightX(pose.heading) * mount.lookSide,
        mount.lookHeight,
        pose.z + forwardZ(pose.heading) * mount.lookAhead + rightZ(pose.heading) * mount.lookSide,
      );
      const wanted = look.clone().sub(rig.camera.position).normalize();
      const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion);
      expect(facing.dot(wanted)).toBeGreaterThan(0.999);
    });

    it(`gives the ${view} mount a near plane that clears the bodywork`, () => {
      const rig = createChaseCamera(16 / 9);
      rig.setView(view);
      rig.update(poseAt(), DT);
      expect(rig.camera.near).toBe(CAMERA.mountNear);
      expect(rig.camera.fov).toBeCloseTo(CAMERA.mounts[view].fov, 5);
    });
  }

  it('leans the side mount with the body and the front mount against it', () => {
    const roll = 0.05;
    const readRoll = (view: CameraView): number => {
      const rig = createChaseCamera(16 / 9);
      rig.setView(view);
      rig.update(poseAt(0, 0, 0, { roll }), DT);
      rig.camera.updateMatrixWorld(true);
      // World Y of the camera's own right vector: positive means the lens lifted its right side.
      return rig.camera.matrixWorld.elements[1];
    };
    // The body leans onto its left in a right-hand turn. A forward-facing lens sees that lean
    // directly; a rear-facing one sees it mirrored, so the two must come out opposite.
    expect(readRoll('side')).toBeCloseTo(Math.sin(roll * CAMERA.mounts.side.rollFollow), 3);
    expect(readRoll('front')).toBeCloseTo(Math.sin(roll * CAMERA.mounts.front.rollFollow), 3);
    expect(Math.sign(readRoll('side'))).toBe(-Math.sign(readRoll('front')));
  });

  it('cuts back to the chase position instead of damping through the bodywork', () => {
    const rig = createChaseCamera(16 / 9);
    const pose = poseAt(30, 30, 1.2);
    rig.snap(pose);

    rig.setView('side');
    rig.update(pose, DT);
    const mounted = rig.camera.position.clone();

    rig.setView('chase');
    rig.update(pose, DT);
    // One frame, not a slide: the lens is already the full chase distance back.
    const back = Math.hypot(rig.camera.position.x - pose.x, rig.camera.position.z - pose.z);
    expect(back).toBeCloseTo(CAMERA.distance, 3);
    expect(rig.camera.position.distanceTo(mounted)).toBeGreaterThan(1);
    expect(rig.camera.near).toBe(0.3);
  });

  it('keeps a mounted view across a snap, so a respawn does not throw you back to chase', () => {
    const rig = createChaseCamera(16 / 9);
    rig.setView('front');
    const pose = poseAt(-5, 9, 2.1);
    rig.snap(pose);
    expect(rig.view).toBe('front');
    expect(rig.camera.position.distanceTo(expectedMount(pose, CAMERA.mounts.front))).toBeLessThan(1e-6);
  });
});
