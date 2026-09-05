import * as THREE from 'three';
import { RENDER } from '../config/tuning';
import { viewportHeight, viewportWidth } from '../ui/viewport';

/** WebGL renderer setup with a capped pixel ratio for high-DPI laptops. */
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio));
  // Not the window: on a portrait phone the game layer is turned sideways (`src/ui/viewport.ts`).
  renderer.setSize(viewportWidth(), viewportHeight(), false);
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = true;
  return renderer;
}
