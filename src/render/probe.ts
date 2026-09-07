import * as THREE from 'three';

/**
 * Screen-centre world probe. Casts a ray straight down the camera's view axis and reports
 * where it lands, so the debug overlay can name the world coordinate of whatever is under
 * the crosshair. That turns "the building on the left looks wrong" into "the building at
 * x -196, z 241 looks wrong", which is a coordinate the world specs (`citySpec.ts`,
 * `cityPlan.ts`, everything in `src/world`) are already written in.
 *
 * Two readings, because they cost wildly different amounts:
 *   - `ground()` intersects the view axis with the y=0 plane. Pure arithmetic, free enough
 *     to run every frame, and it answers the question the specs actually ask - which spot
 *     on the map is that.
 *   - `sample()` raycasts the real scene and lands on the surface you can see, walls and
 *     rooftops included. It costs about 11 ms in the city, so it runs on demand only.
 */
export interface ProbeHit {
  x: number;
  y: number;
  z: number;
  /** Metres from the camera to the hit. */
  distance: number;
  /** Name of the object hit, or 'ground plane' when the ray only met the y=0 fallback. */
  what: string;
  /** False when neither geometry nor the ground plane was in front of the camera. */
  valid: boolean;
}

export interface WorldProbe {
  /** Precise, expensive: the visible surface under the crosshair. On demand only. */
  sample(): ProbeHit;
  /** Cheap: where the view axis crosses the ground plane. Safe every frame. */
  ground(): ProbeHit;
}

/** Longest ray we bother with: past this the coordinate is skyline, not something to edit. */
const MAX_DISTANCE = 1200;

export function createWorldProbe(scene: THREE.Scene, camera: THREE.Camera): WorldProbe {
  const raycaster = new THREE.Raycaster();
  raycaster.far = MAX_DISTANCE;
  const centre = new THREE.Vector2(0, 0);
  const hit: ProbeHit = { x: 0, y: 0, z: 0, distance: 0, what: '', valid: false };
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();

  return {
    sample() {
      raycaster.setFromCamera(centre, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      // Skip anything that is not really world geometry: sprites, helper lines and the
      // sky dome would otherwise swallow every ray.
      for (const h of hits) {
        const o = h.object;
        if (!(o as THREE.Mesh).isMesh) continue;
        if (ignored(o)) continue;
        // Glows, road sheen and light shafts are drawn without depth: they hang in front of
        // the surface you are actually looking at, so they must not answer for it.
        if (seeThrough((o as THREE.Mesh).material)) continue;
        hit.x = h.point.x;
        hit.y = h.point.y;
        hit.z = h.point.z;
        hit.distance = h.distance;
        hit.what = objectLabel(o);
        hit.valid = true;
        return hit;
      }
      // Nothing solid: fall back to where the view axis crosses the ground.
      return groundFrom(raycaster, hit);
    },
    ground() {
      raycaster.setFromCamera(centre, camera);
      return groundFrom(raycaster, hit);
    },
  };

  function groundFrom(ray: THREE.Raycaster, out: ProbeHit): ProbeHit {
    origin.copy(ray.ray.origin);
    dir.copy(ray.ray.direction);
    // Looking at or above the horizon: there is no ground under the crosshair to name.
    if (dir.y >= -1e-4) {
      out.valid = false;
      out.what = 'sky';
      return out;
    }
    const t = -origin.y / dir.y;
    out.x = origin.x + dir.x * t;
    out.y = 0;
    out.z = origin.z + dir.z * t;
    out.distance = t;
    out.what = 'ground';
    out.valid = t <= MAX_DISTANCE;
    return out;
  }
}

/** True for the additive / depth-less materials the effects are drawn with. */
function seeThrough(material: THREE.Material | THREE.Material[]): boolean {
  const list = Array.isArray(material) ? material : [material];
  return list.every((m) => m.depthWrite === false || m.blending === THREE.AdditiveBlending);
}

/** `probeIgnore` on an object hides it and everything under it (the player's own car). */
function ignored(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  for (let depth = 0; node && depth < 8; depth++) {
    if (node.userData && node.userData.probeIgnore) return true;
    node = node.parent;
  }
  return false;
}

/** The nearest useful name up the parent chain — Three leaves most generated meshes unnamed. */
function objectLabel(object: THREE.Object3D): string {
  let node: THREE.Object3D | null = object;
  for (let depth = 0; node && depth < 6; depth++) {
    if (node.name) return node.name;
    node = node.parent;
  }
  return object.type;
}
