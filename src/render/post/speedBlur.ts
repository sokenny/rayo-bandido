import * as THREE from 'three';
import { clamp01 } from '../../core/math';
import { SPEED_BLUR } from '../../config/tuning';

/**
 * Nitro speed blur: a radial (zoom) smear that opens up from the edges of the frame while the
 * boost is lit, so the world tears past the car instead of merely moving faster.
 *
 * It smears the frame the game already drew, and nothing else. The scene still renders straight
 * to the canvas, with its own tone mapping, its own additive blending and its own antialiasing;
 * the finished image is then copied into a texture and averaged along the radial direction. So
 * the colours never move: the middle of the frame comes out identical to an unboosted frame, and
 * the periphery is the same picture, just smeared.
 *
 * The obvious alternative — render the scene into an HDR buffer and grade it here — is what this
 * deliberately does not do. Three turns tone mapping off when a scene renders into a render
 * target, so the additive neon blending and the multisample resolve would both happen in linear
 * light and be tone mapped afterwards. Every antialiased edge in the scene brightens the moment
 * the boost lights, which reads as an aggressive colour filter rather than as speed.
 *
 * Cheap and optional, per the performance rules:
 * - With the boost cold this is exactly the old `renderer.render` call. No texture is allocated
 *   until the first boost, and nothing extra is drawn afterwards.
 * - While boosting it costs one full-screen copy and one full-screen triangle (8 taps, one draw).
 *
 * Readability first (docs/VISUAL_DIRECTION.md): the smear is masked out of the middle of the
 * frame, so the car, the road ahead and the target it is aiming at always stay sharp.
 */
export interface SpeedBlur {
  /**
   * Draw the frame. `strength` is 0..1; at 0 this is a plain `renderer.render` and neither the
   * copy nor the blur pass happens.
   */
  render(scene: THREE.Scene, camera: THREE.Camera, strength: number): void;
  dispose(): void;
}

/** Below this the pass is not worth a copy and a second draw — the smear would be sub-pixel. */
const MIN_STRENGTH = 0.02;

/**
 * How strongly the blur should be showing for a given boost intensity and speed. Nitro held at
 * a crawl (leaving a wall, say) must not blur: the effect sells speed, so speed has to earn it.
 * Pure function, exported for tests.
 */
export function speedBlurStrength(nitro: number, speed: number): number {
  const ramp = clamp01(
    (speed - SPEED_BLUR.speedStart) / (SPEED_BLUR.speedFull - SPEED_BLUR.speedStart),
  );
  return clamp01(nitro) * ramp;
}

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * `tFrame` holds the finished, already-graded frame, so this shader must not tone map or encode
 * anything: it averages display-ready pixels and writes them straight back out.
 */
const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tFrame;
uniform float uStrength;
uniform float uAspect;
uniform float uMaxShift;
uniform float uCenterClear;
varying vec2 vUv;

/** Taps per pixel. Eight is enough for a smear this short and keeps the pass one cheap draw. */
const int TAPS = 8;

void main() {
  vec2 fromCenter = vUv - 0.5;
  // Aspect-corrected radius so the sharp middle is a circle and not a wide ellipse.
  float radius = length(vec2(fromCenter.x * uAspect, fromCenter.y)) * 2.0;
  float amount = uStrength * smoothstep(uCenterClear, 1.0, radius);

  // Smear along the radial direction, growing with the distance from the center: the classic
  // zoom blur. The kernel is centered on the pixel so the image never slides while it ramps.
  vec2 span = fromCenter * 2.0 * amount * uMaxShift;
  vec2 uv = vUv - span * 0.5;
  vec2 stride = span / float(TAPS - 1);

  vec3 sum = vec3(0.0);
  for (int i = 0; i < TAPS; i++) {
    sum += texture2D(tFrame, uv).rgb;
    uv += stride;
  }
  // In the sharp middle every tap lands on the same texel, so this is an exact copy of the frame
  // the game just drew. The pass smears the image; it never grades it.
  gl_FragColor = vec4(sum / float(TAPS), 1.0);
}
`;

/** Screen-covering triangle. One primitive, no diagonal seam, no overdraw. */
function createFullScreenTriangle(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  // The framebuffer copy has GL's bottom-left origin and so does clip space, so uv (0,0) lands on
  // the same corner as texel (0,0). No flip needed.
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  return geometry;
}

export function createSpeedBlur(renderer: THREE.WebGLRenderer): SpeedBlur {
  const uniforms = {
    tFrame: { value: null as THREE.Texture | null },
    uStrength: { value: 0 },
    uAspect: { value: 1 },
    uMaxShift: { value: SPEED_BLUR.maxShift },
    uCenterClear: { value: SPEED_BLUR.centerClear },
  };

  const geometry = createFullScreenTriangle();
  const material = new THREE.ShaderMaterial({
    name: 'speedBlur',
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
    // The frame is already graded. Anything Three added here would be a second grade.
    toneMapped: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  // The vertex shader writes clip space directly, so this camera only exists to satisfy render().
  const quadCamera = new THREE.Camera();

  const size = new THREE.Vector2();
  let frame: THREE.FramebufferTexture | null = null;
  let frameWidth = 0;
  let frameHeight = 0;

  /** Allocate on the first boost, and follow the drawing buffer when the window is resized. */
  function ensureFrame(width: number, height: number): THREE.FramebufferTexture {
    if (frame && frameWidth === width && frameHeight === height) return frame;
    if (frame) frame.dispose();
    const texture = new THREE.FramebufferTexture(width, height);
    texture.name = 'speedBlur.frame';
    // Linear, so taps landing between texels do not stair-step. No colour space is set: these are
    // already display-encoded pixels and have to be sampled and written back untouched.
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    uniforms.tFrame.value = texture;
    frame = texture;
    frameWidth = width;
    frameHeight = height;
    return texture;
  }

  return {
    render(scene, camera, strength) {
      // The scene always draws to the canvas exactly as it did before this pass existed.
      renderer.render(scene, camera);
      if (!(strength > MIN_STRENGTH)) return;

      renderer.getDrawingBufferSize(size);
      const texture = ensureFrame(size.x, size.y);
      renderer.copyFramebufferToTexture(texture);

      uniforms.uStrength.value = Math.min(strength, 1);
      uniforms.uAspect.value = size.y > 0 ? size.x / size.y : 1;
      // Keep the scene's own draw calls and triangles in `renderer.info` for the debug overlay:
      // the blur pass adds to them instead of resetting them.
      renderer.info.autoReset = false;
      renderer.render(quadScene, quadCamera);
      renderer.info.autoReset = true;
    },

    dispose() {
      geometry.dispose();
      material.dispose();
      if (frame) {
        frame.dispose();
        frame = null;
      }
    },
  };
}
