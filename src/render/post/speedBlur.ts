import * as THREE from 'three';
import { clamp01 } from '../../core/math';
import { SPEED_BLUR } from '../../config/tuning';
import { createLightBleed, type BleedAmounts } from './lightBleed';

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
/**
 * The Moogul's finishing touches, riding the same pass (`render/scene/moogulTrip.ts` owns the
 * numbers). The separation and the swim are fractions of the frame at its very edge and both
 * are exactly nothing in the sharp middle, for the same reason the blur is. The halo is the
 * one thing here that reaches the whole frame — a city of diffuse lights is the point of it —
 * and it too is turned down in the middle so the road stays readable.
 */
export interface FinishAmounts {
  /** Colour separation: how far red and blue are pulled apart along the radius. */
  chroma: number;
  /** The periphery drifting on slow waves. */
  swim: number;
  /** Seconds, for the waves. */
  time: number;
  /**
   * The lights, spread: `lightBleed.ts` draws the halo off this same copy of the frame and
   * this pass adds it back. Unlike the two above, this one is NOT only at the edge — the
   * whole city softens — though it is held back in the middle by `bleed.centre`.
   */
  bleed: BleedAmounts;
}

export interface SpeedBlur {
  /**
   * Draw the frame. `strength` is 0..1; at 0 — and with no finish asked for — this is a plain
   * `renderer.render` and neither the copy nor the blur pass happens.
   */
  render(scene: THREE.Scene, camera: THREE.Camera, strength: number, finish?: FinishAmounts | null): void;
  /**
   * Pay the pass's one-time costs now (behind the loading screen): allocate the frame texture
   * at the current drawing-buffer size and compile the blur shader, so the first boost does
   * not hitch. Draws the blur at zero strength over whatever is on the canvas.
   */
  warm(): void;
  dispose(): void;
}

/** Below this the pass is not worth a copy and a second draw — the smear would be sub-pixel. */
const MIN_STRENGTH = 0.02;
/** Same for the finish: a separation under a fifth of a pixel at 4K is not one. */
const MIN_FINISH = 0.00005;
/** And for the halo, which costs four draws: below this nobody could tell it was on. */
const MIN_BLEED = 0.002;

/** What `warm` builds the halo chain with. The amount is zero; only the shapes matter. */
const WARM_BLEED: BleedAmounts = {
  amount: 0,
  threshold: 0.7,
  knee: 0.3,
  hue: 0,
  saturation: 1,
  radius: 0.04,
  stretch: 1,
  fringe: 0,
  centre: 1,
};

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
uniform float uChroma;
uniform float uSwim;
uniform float uTime;
uniform sampler2D tBleed;
uniform float uBleed;
uniform float uBleedFringe;
uniform float uBleedCentre;
varying vec2 vUv;

/** Taps per pixel. Eight is enough for a smear this short and keeps the pass one cheap draw. */
const int TAPS = 8;

void main() {
  vec2 fromCenter = vUv - 0.5;
  // Aspect-corrected radius so the sharp middle is a circle and not a wide ellipse.
  float radius = length(vec2(fromCenter.x * uAspect, fromCenter.y)) * 2.0;
  float edge = smoothstep(uCenterClear, 1.0, radius);
  float amount = uStrength * edge;

  // The swim: the periphery drifts on two slow, detuned waves. Exactly nothing in the middle.
  vec2 base = vUv + uSwim * edge * vec2(
    sin(vUv.y * 7.3 + uTime * 0.71) + 0.5 * sin(vUv.x * 4.1 - uTime * 0.37),
    cos(vUv.x * 6.1 + uTime * 0.53) + 0.5 * cos(vUv.y * 3.7 + uTime * 0.29));

  // Smear along the radial direction, growing with the distance from the center: the classic
  // zoom blur. The kernel is centered on the pixel so the image never slides while it ramps.
  vec2 span = fromCenter * 2.0 * amount * uMaxShift;
  vec2 uv = base - span * 0.5;
  vec2 stride = span / float(TAPS - 1);

  vec3 sum = vec3(0.0);
  for (int i = 0; i < TAPS; i++) {
    sum += texture2D(tFrame, uv).rgb;
    uv += stride;
  }
  // In the sharp middle every tap lands on the same texel, so this is an exact copy of the frame
  // the game just drew. The pass smears the image; it never grades it.
  vec3 col = sum / float(TAPS);

  // Colour separation: red pulled a little out along the radius, blue a little in. Only the
  // channels move; the green the eye reads sharpness from stays where it was.
  if (uChroma > 0.0) {
    vec2 split = fromCenter * uChroma * edge;
    col.r = texture2D(tFrame, base + split).r;
    col.b = texture2D(tFrame, base - split).b;
  }

  // The halo, added back. Sampled at the swum uv rather than the plain one, so it drifts with
  // the periphery instead of sitting still behind it. Held back in the middle of the frame,
  // and given less room the brighter the pixel already is — one scalar, so a light haloes
  // without its colour turning to white.
  if (uBleed > 0.0) {
    vec3 halo;
    if (uBleedFringe > 0.0) {
      vec2 split = fromCenter * uBleedFringe;
      halo.r = texture2D(tBleed, base + split).r;
      halo.g = texture2D(tBleed, base).g;
      halo.b = texture2D(tBleed, base - split).b;
    } else {
      halo = texture2D(tBleed, base).rgb;
    }
    float keep = mix(uBleedCentre, 1.0, smoothstep(0.0, 1.0, radius));
    float room = 1.0 - 0.5 * clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    col += halo * (uBleed * keep * room);
  }
  gl_FragColor = vec4(col, 1.0);
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
    uChroma: { value: 0 },
    uSwim: { value: 0 },
    uTime: { value: 0 },
    tBleed: { value: null as THREE.Texture | null },
    uBleed: { value: 0 },
    uBleedFringe: { value: 0 },
    uBleedCentre: { value: 1 },
  };

  const geometry = createFullScreenTriangle();
  // The halo chain, which borrows the triangle above. No render target exists and no shader of
  // it is compiled until the first frame that asks for a halo — or `warm`, which asks for one
  // behind the loading screen so the trip never pays for it mid-drive.
  const bleedChain = createLightBleed(renderer, geometry);
  uniforms.tBleed.value = bleedChain.texture;
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

  function blurPass(strength: number, chroma = 0, swim = 0, time = 0, bleed: BleedAmounts | null = null): void {
    renderer.getDrawingBufferSize(size);
    const texture = ensureFrame(size.x, size.y);
    renderer.copyFramebufferToTexture(texture);

    uniforms.uStrength.value = Math.min(strength, 1);
    uniforms.uAspect.value = size.y > 0 ? size.x / size.y : 1;
    uniforms.uChroma.value = chroma;
    uniforms.uSwim.value = swim;
    uniforms.uTime.value = time;
    // Keep the scene's own draw calls and triangles in `renderer.info` for the debug overlay:
    // the blur pass adds to them instead of resetting them. The halo's four small draws are
    // inside the same guard, so they show up there too.
    renderer.info.autoReset = false;
    if (bleed) {
      uniforms.tBleed.value = bleedChain.build(texture, size.x, size.y, bleed);
      uniforms.uBleed.value = bleed.amount;
      uniforms.uBleedFringe.value = bleed.fringe;
      uniforms.uBleedCentre.value = bleed.centre;
    } else {
      uniforms.uBleed.value = 0;
    }
    renderer.render(quadScene, quadCamera);
    renderer.info.autoReset = true;
  }

  return {
    render(scene, camera, strength, finish = null) {
      // The scene always draws to the canvas exactly as it did before this pass existed.
      renderer.render(scene, camera);
      const chroma = finish && finish.chroma > MIN_FINISH ? finish.chroma : 0;
      const swim = finish && finish.swim > MIN_FINISH ? finish.swim : 0;
      const bleed = finish && finish.bleed.amount > MIN_BLEED ? finish.bleed : null;
      if (!(strength > MIN_STRENGTH) && chroma === 0 && swim === 0 && !bleed) return;
      blurPass(strength > MIN_STRENGTH ? strength : 0, chroma, swim, finish ? finish.time : 0, bleed);
    },

    warm() {
      // With the halo in it, so the trip's first haloed frame neither compiles a shader nor
      // allocates a render target. It is drawn at an amount of zero and changes nothing.
      blurPass(0, 0, 0, 0, WARM_BLEED);
    },

    dispose() {
      bleedChain.dispose();
      uniforms.tBleed.value = null;
      geometry.dispose();
      material.dispose();
      if (frame) {
        frame.dispose();
        frame = null;
      }
    },
  };
}
