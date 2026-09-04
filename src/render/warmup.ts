import type * as THREE from 'three';

/**
 * GPU warm-up: pays every one-time rendering cost before the game starts, behind the loading
 * screen, so none of it lands on a frame the player is watching.
 *
 * WHAT IS PAID HERE
 * - Shader programs. Three compiles a material's program the first time an object using it is
 *   drawn. Most effects start hidden (smoke, skid marks, nitro flames, the lightning arc, shock
 *   rings, score pops, the lock-on ring), so without this the first drift, the first boost and
 *   the first shot each stalled for a compile. `compileAsync` builds them all up front and, on
 *   drivers with `KHR_parallel_shader_compile`, does so without blocking the main thread.
 * - Everything a real frame does the first time: texture uploads and mipmaps, the sky's
 *   equirect-to-cubemap conversion, the environment map's prefiltered mips (PMREM), vertex
 *   buffer uploads. One render with every object forced visible triggers all of it.
 *
 * The forced-visible render draws hidden pools at zero alpha and with empty buffers; it is
 * not shown (the loading screen covers the canvas) and the game's first real frame follows.
 */
export interface WarmupTarget {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
}

/** Compile every material in the scene, including those on hidden objects. */
export async function compileScene({ renderer, scene, camera }: WarmupTarget): Promise<void> {
  await renderer.compileAsync(scene, camera);
}

/**
 * Draw one frame with every object visible, then restore visibility. Uploads every buffer and
 * texture and builds the background / environment cubemaps.
 */
export function warmRender({ renderer, scene, camera }: WarmupTarget): void {
  const hidden: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (!object.visible) {
      hidden.push(object);
      object.visible = true;
    }
  });
  renderer.render(scene, camera);
  for (let i = 0; i < hidden.length; i++) hidden[i].visible = false;
}
