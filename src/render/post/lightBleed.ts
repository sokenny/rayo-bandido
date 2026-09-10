import * as THREE from 'three';

/**
 * HALATION: every light in the city, spread.
 *
 * The Moogul's other half. `moogulSurface.ts` turns the walls' colours and `moogulTrip.ts`
 * turns the sky's; this turns the *light* — the lit panes, the barrier hairlines, the lamps,
 * the tail lights, the wet road under them — from points into diffuse blooms with a colour of
 * their own. It is the thing that makes the city look SOFT rather than merely purple: sober,
 * a window is a crisp bright rectangle; here it is a rectangle sitting in a haze of its own
 * light that is not quite the colour the window is.
 *
 * HOW. Three small draws on the frame the game already finished, then one line in the
 * finishing pass that adds the result back (`speedBlur.ts` owns that pass and this rides it):
 *
 *  1. BRIGHT PASS, straight to a quarter of the frame's width and height. Four bilinear taps
 *     placed on the centres of the four quadrants of the 4x4 block a quarter-res texel covers,
 *     which is an EXACT average of all sixteen: nothing is skipped, so no light can flicker as
 *     the camera moves — the one thing that would give the whole effect away. What comes out
 *     is what is above the threshold, turned round the hue wheel and pushed off white.
 *  2. HALVE IT AGAIN, the same four-tap box, to an eighth. Cheap, and it is the pre-blur that
 *     turns a lit pane into a soft blob before the gaussian ever runs.
 *  3. BLUR, separable, nine taps each way at that eighth resolution, the stride set from the
 *     radius asked for as a fraction of the frame height — so the halo is the same size on any
 *     screen — and stretched a little sideways, the way city lights smear on glass.
 *
 * WHY IT IS CHEAP. The bright pass is a sixteenth of the frame's pixels, everything after it a
 * sixty-fourth; all four draws together are about half the texture reads of a single full-frame
 * pass. Nothing is allocated and nothing runs when the trip is not on, and the whole chain is
 * skipped the moment the amount reaches zero.
 *
 * WHY NOT A REAL HDR BLOOM. The same reason the speed blur does not grade: the scene draws
 * straight to the canvas with its own tone mapping and its own additive blending, and moving it
 * into a float buffer changes every neon edge in the game whether the trip is on or not. This
 * works on display-ready pixels, so with the trip cold the picture is byte-identical to what it
 * always was.
 */
export interface BleedAmounts {
  /** How much of the halo is added back into the frame. At 0 the whole chain is skipped. */
  amount: number;
  /** Brightness a pixel must reach to bleed at all, and the width of the knee above it. */
  threshold: number;
  knee: number;
  /** The halo's own colour: turned this far round the grey axis (rad), pushed this far off white. */
  hue: number;
  saturation: number;
  /** How wide the halo is, as a fraction of the frame's height, and how much wider across. */
  radius: number;
  stretch: number;
  /** How far the halo's channels are pulled apart along the radius (fraction of the frame). */
  fringe: number;
  /** How much of the halo survives in the sharp middle of the frame, where the car and the road are. */
  centre: number;
}

export interface LightBleed {
  /**
   * Draw the halo for this frame from `frame` — the finished picture, already copied — and
   * return it. Leaves the renderer's target as it found it.
   */
  build(frame: THREE.Texture, width: number, height: number, bleed: BleedAmounts): THREE.Texture;
  /** What the finishing pass should sample. Black until the first `build`. */
  readonly texture: THREE.Texture;
  dispose(): void;
}

/** The bright pass' resolution, and the blur's, as divisors of the drawing buffer. */
const BRIGHT_DIV = 4;
const BLUR_DIV = 8;
/** Lobes either side of centre in the separable blur, which is what the stride is divided by. */
const LOBES = 4;

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * `tFrame` is display-encoded — the frame as the canvas holds it — so the threshold is read
 * against display brightness and nothing here decodes, tone maps or encodes anything.
 */
const BRIGHT_SHADER = /* glsl */ `
uniform sampler2D tFrame;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
uniform float uHue;
uniform float uSaturation;
varying vec2 vUv;

/** A turn round the grey axis: the halo keeps its brightness and loses its allegiance. */
vec3 rbHue( vec3 c, float a ) {
  const vec3 k = vec3( 0.57735027 );
  float cs = cos( a );
  float sn = sin( a );
  return c * cs + cross( k, c ) * sn + k * dot( k, c ) * ( 1.0 - cs );
}

void main() {
  // The four quadrant centres of the 4x4 block this texel covers: an exact sixteen-texel box.
  vec3 c = texture2D( tFrame, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb
         + texture2D( tFrame, vUv + uTexel * vec2(  1.0, -1.0 ) ).rgb
         + texture2D( tFrame, vUv + uTexel * vec2( -1.0,  1.0 ) ).rgb
         + texture2D( tFrame, vUv + uTexel * vec2(  1.0,  1.0 ) ).rgb;
  c *= 0.25;
  // What is above the threshold, on a knee rather than a step: a pane drifting past it fades in.
  float lum = max( c.r, max( c.g, c.b ) );
  float w = clamp( ( lum - uThreshold ) / max( 1e-4, uKnee ), 0.0, 1.0 );
  vec3 lit = c * ( w * w );
  vec3 grey = vec3( dot( lit, vec3( 0.2126, 0.7152, 0.0722 ) ) );
  gl_FragColor = vec4( rbHue( mix( grey, lit, uSaturation ), uHue ), 1.0 );
}
`;

/** Halve again, same four-tap box: the pre-blur that costs one draw at a sixteenth of the frame. */
const DOWN_SHADER = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D( tSrc, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb
         + texture2D( tSrc, vUv + uTexel * vec2(  1.0, -1.0 ) ).rgb
         + texture2D( tSrc, vUv + uTexel * vec2( -1.0,  1.0 ) ).rgb
         + texture2D( tSrc, vUv + uTexel * vec2(  1.0,  1.0 ) ).rgb;
  gl_FragColor = vec4( c * 0.25, 1.0 );
}
`;

/** Nine-tap gaussian along `uStep`. Run twice, across then down. */
const BLUR_SHADER = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec3 c = texture2D( tSrc, vUv ).rgb * 0.227027;
  c += ( texture2D( tSrc, vUv + uStep ).rgb + texture2D( tSrc, vUv - uStep ).rgb ) * 0.1945946;
  c += ( texture2D( tSrc, vUv + 2.0 * uStep ).rgb + texture2D( tSrc, vUv - 2.0 * uStep ).rgb ) * 0.1216216;
  c += ( texture2D( tSrc, vUv + 3.0 * uStep ).rgb + texture2D( tSrc, vUv - 3.0 * uStep ).rgb ) * 0.0540540;
  c += ( texture2D( tSrc, vUv + 4.0 * uStep ).rgb + texture2D( tSrc, vUv - 4.0 * uStep ).rgb ) * 0.0162162;
  gl_FragColor = vec4( c, 1.0 );
}
`;

function target(width: number, height: number, name: string): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    // No colour space: these are the canvas' own display-ready pixels, moved about and no more.
    colorSpace: THREE.NoColorSpace,
  });
  rt.texture.name = name;
  rt.texture.generateMipmaps = false;
  rt.texture.wrapS = THREE.ClampToEdgeWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  return rt;
}

/**
 * `geometry` is the finishing pass' screen-covering triangle, handed over rather than made
 * again: one primitive serves every draw here.
 */
export function createLightBleed(renderer: THREE.WebGLRenderer, geometry: THREE.BufferGeometry): LightBleed {
  const brightUniforms = {
    tFrame: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2() },
    uThreshold: { value: 0.7 },
    uKnee: { value: 0.3 },
    uHue: { value: 0 },
    uSaturation: { value: 1 },
  };
  const downUniforms = {
    tSrc: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2() },
  };
  const blurUniforms = {
    tSrc: { value: null as THREE.Texture | null },
    uStep: { value: new THREE.Vector2() },
  };

  function pass(name: string, uniforms: Record<string, THREE.IUniform>, fragmentShader: string): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      name,
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  const brightMat = pass('lightBleed.bright', brightUniforms, BRIGHT_SHADER);
  const downMat = pass('lightBleed.down', downUniforms, DOWN_SHADER);
  const blurMat = pass('lightBleed.blur', blurUniforms, BLUR_SHADER);

  const quad = new THREE.Mesh(geometry, brightMat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.Camera();

  /** One black texel, bound while there is no halo so the sampler always has something valid. */
  const idle = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  idle.name = 'lightBleed.idle';
  idle.needsUpdate = true;

  let bright: THREE.WebGLRenderTarget | null = null;
  let ping: THREE.WebGLRenderTarget | null = null;
  let pong: THREE.WebGLRenderTarget | null = null;
  let builtWidth = 0;
  let builtHeight = 0;
  let out: THREE.Texture = idle;

  function ensure(width: number, height: number): void {
    if (bright && ping && pong && builtWidth === width && builtHeight === height) return;
    if (bright) bright.dispose();
    if (ping) ping.dispose();
    if (pong) pong.dispose();
    const bw = Math.max(1, Math.ceil(width / BRIGHT_DIV));
    const bh = Math.max(1, Math.ceil(height / BRIGHT_DIV));
    const sw = Math.max(1, Math.ceil(width / BLUR_DIV));
    const sh = Math.max(1, Math.ceil(height / BLUR_DIV));
    bright = target(bw, bh, 'lightBleed.bright');
    ping = target(sw, sh, 'lightBleed.ping');
    pong = target(sw, sh, 'lightBleed.pong');
    builtWidth = width;
    builtHeight = height;
  }

  function draw(material: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget): void {
    quad.material = material;
    renderer.setRenderTarget(to);
    renderer.render(quadScene, quadCamera);
  }

  return {
    get texture() {
      return out;
    },

    build(frame, width, height, bleed) {
      ensure(width, height);
      const brightRt = bright!;
      const pingRt = ping!;
      const pongRt = pong!;
      const was = renderer.getRenderTarget();

      brightUniforms.tFrame.value = frame;
      brightUniforms.uTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
      brightUniforms.uThreshold.value = bleed.threshold;
      brightUniforms.uKnee.value = bleed.knee;
      brightUniforms.uHue.value = bleed.hue;
      brightUniforms.uSaturation.value = bleed.saturation;
      draw(brightMat, brightRt);

      downUniforms.tSrc.value = brightRt.texture;
      downUniforms.uTexel.value.set(1 / brightRt.width, 1 / brightRt.height);
      draw(downMat, pingRt);

      // The stride the gaussian's lobes sit on: the radius is asked for as a fraction of the
      // frame's height, so a halo covers the same part of any screen at any resolution.
      const stride = Math.max(0.5, (bleed.radius * pongRt.height) / LOBES);
      blurUniforms.tSrc.value = pingRt.texture;
      blurUniforms.uStep.value.set((stride * bleed.stretch) / pongRt.width, 0);
      draw(blurMat, pongRt);

      blurUniforms.tSrc.value = pongRt.texture;
      blurUniforms.uStep.value.set(0, stride / pingRt.height);
      draw(blurMat, pingRt);

      renderer.setRenderTarget(was);
      out = pingRt.texture;
      return out;
    },

    dispose() {
      out = idle;
      if (bright) bright.dispose();
      if (ping) ping.dispose();
      if (pong) pong.dispose();
      bright = ping = pong = null;
      builtWidth = 0;
      builtHeight = 0;
      brightMat.dispose();
      downMat.dispose();
      blurMat.dispose();
      idle.dispose();
      quadScene.clear();
    },
  };
}
