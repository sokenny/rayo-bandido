import * as THREE from 'three';
import { AMBIENT_VOICE, CROWD } from '../../config/tuning';
import type { BusStopCrowd } from '../../world/busStopCrowds';
import type { CrowdSubject } from './env/humanActs';
import { createHumanCrowd, type HumanCrowd } from './env/humanRig';
import { meetLook } from './meetVisual';

/**
 * THE PEOPLE WAITING FOR THE BONDI (`world/busStopCrowds.ts`). Each populated stop is one small
 * skinned crowd (`env/humanRig.ts`) — two draw calls for the lot of them — built the first time
 * the camera comes within `spawnWithin`, drawn within `showWithin`, and stepped on the crowd LOD
 * (`CROWD.fullWithin` / `animateWithin` / `farStride`). They stand, shift their weight, look about
 * or at a phone; the rig's own reactions already turn their heads to a car going past.
 *
 * Nothing allocated per frame once a stop is built.
 */
export interface BusStopCrowdVisual {
  root: THREE.Group;
  update(camX: number, camZ: number, time: number, dt: number, subject: CrowdSubject | null): void;
  dispose(): void;
}

export function createBusStopCrowdVisual(stops: readonly BusStopCrowd[]): BusStopCrowdVisual {
  const root = new THREE.Group();
  root.name = 'bus-stop-people';
  const crowds: Array<HumanCrowd | null> = stops.map(() => null);
  const owed = new Float32Array(stops.length);
  const cfg = AMBIENT_VOICE.stop;
  let stride = 0;

  function build(i: number): HumanCrowd {
    const s = stops[i];
    const crowd = createHumanCrowd(
      s.waiters.map((w) => ({
        look: meetLook({ x: w.x, z: w.z, heading: w.heading, kind: w.kind, seed: w.seed }),
        x: w.x,
        y: s.y + 0.03,
        z: w.z,
        heading: w.heading,
        act: w.act,
        seed: w.seed,
      })),
      `bus-stop-people-${s.stop}`,
    );
    root.add(crowd.group);
    return crowd;
  }

  return {
    root,
    update(camX, camZ, time, dt, subject) {
      stride = (stride + 1) % CROWD.farStride;
      let built = false;
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        const d = Math.hypot(s.x - camX, s.z - camZ);
        let crowd = crowds[i];
        if (!crowd) {
          // One stop built a frame at most, so driving into a street of them never hitches.
          if (d >= cfg.spawnWithin || built) continue;
          crowd = crowds[i] = build(i);
          built = true;
        }
        crowd.group.visible = d < cfg.showWithin;
        owed[i] += dt;
        if (!crowd.group.visible || d > CROWD.animateWithin) continue;
        if (d > CROWD.fullWithin && stride !== 0) continue;
        crowd.update(time, Math.min(owed[i], 0.25), subject);
        owed[i] = 0;
      }
    },
    dispose() {
      for (const c of crowds) c?.dispose();
      root.removeFromParent();
      root.clear();
    },
  };
}
