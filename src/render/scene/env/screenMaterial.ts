import * as THREE from 'three';
import { SCREEN_GUTTER, type ScreenLayout } from './screenAtlas';

/**
 * The two materials every screen in the city is drawn with: BOARDS (opaque LED panels: facade
 * boards, blades, rooftop boards, tickers, the Bay's holographic columns) and HOLOGRAMS
 * (additive projections). Both sample the screen atlas (`screenAtlas.ts`) and both are one
 * merged mesh, so the whole feature is two draw calls whatever the count of screens.
 *
 * WHY IT IS A SHADER
 * A screen has to change what it shows, and hundreds of them cannot be told to from the CPU when
 * they are one mesh. So each vertex carries its channel (where its frames sit in the atlas) and
 * its own seed and motion (`MeshBuilder.screen`), and the fragment shader does everything a
 * screen does from one clock uniform:
 *
 * - CYCLE: frame k of the channel is `floor(time / seconds) mod frames`, the seed staggering
 *   every screen so no two boards on a street change together. A board wipes to its next frame
 *   under a bright scan line; a hologram just cuts, which is what makes a flipbook of it.
 * - MOTION: the Bay's columns scroll, the tickers run sideways, wrapping on themselves.
 * - LED: up close a board resolves into its grid of diodes (one per atlas texel), faded out by
 *   the pixel footprint so it never shimmers at a distance. Black is never quite black.
 * - LIFE: a slow refresh band, and now and then a torn frame. A screen built `faulty` tears far
 *   more often and stutters, the way a board nobody has paid to fix does.
 *
 * Sampling uses explicit gradients (`textureGrad`) taken from the panel's own coordinates, so a
 * frame wrapping or tearing inside its slot never breaks the mip choice into a seam.
 */

export interface ScreenMaterials {
  boards: THREE.MeshBasicMaterial;
  holograms: THREE.MeshBasicMaterial;
  /** Seconds; written once a frame by the environment. */
  time: { value: number };
}

function f(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

const VERTEX_PARS = /* glsl */ `
attribute vec4 aScreenSlot;
attribute vec4 aScreenInfo;
varying vec2 vScreenLocal;
varying vec4 vScreenSlot;
varying vec4 vScreenInfo;
`;

const VERTEX_BODY = /* glsl */ `
vScreenLocal = uv;
vScreenSlot = aScreenSlot;
vScreenInfo = aScreenInfo;
`;

function fragmentPars(layout: ScreenLayout): string {
  return /* glsl */ `
uniform float rbScreenTime;
varying vec2 vScreenLocal;
varying vec4 vScreenSlot;
varying vec4 vScreenInfo;
const vec2 RB_ATLAS = vec2(${f(layout.width)}, ${f(layout.height)});
const float RB_GUTTER = ${f(SCREEN_GUTTER)};

float rbHash11(float n) { return fract(sin(n) * 43758.5453123); }

// Frame k of this vertex's channel at panel coordinates 'local' (0..1), with the panel's own
// derivatives for the mip choice.
vec4 rbScreenFrame(float k, vec2 local, vec2 gx, vec2 gy) {
  vec2 size = vScreenSlot.yz;
  float perRow = floor(1.0 / size.x + 0.5);
  float slot = floor(vScreenSlot.w + 0.5) + k;
  float col = slot - perRow * floor(slot / perRow + 0.0001);
  float row = floor(slot / perRow + 0.0001);
  vec2 gut = vec2(RB_GUTTER) / RB_ATLAS;
  vec2 inner = size - 2.0 * gut;
  vec2 origin = vec2(col * size.x, vScreenSlot.x - (row + 1.0) * size.y) + gut;
  return textureGrad(map, origin + local * inner, gx * inner, gy * inner);
}
`;
}

const MAP_FRAGMENT = /* glsl */ `
float rbFrames = floor(vScreenInfo.x + 0.5);
float rbSeed = vScreenInfo.y;
float rbFaulty = step(9.5, vScreenInfo.z);
float rbMotion = floor(vScreenInfo.z - rbFaulty * 10.0 + 0.5);
float rbSecs = max(vScreenInfo.w, 0.05);
float rbT = rbScreenTime + rbSeed * 97.0;
vec2 rbL = vScreenLocal;
vec2 rbGx = dFdx(vScreenLocal);
vec2 rbGy = dFdy(vScreenLocal);
if (rbMotion == 1.0) rbL.y = fract(rbL.y + rbT * 0.035);
else if (rbMotion == 2.0) rbL.y = fract(rbL.y - rbT * 0.026);
else if (rbMotion == 3.0) rbL.x = fract(rbL.x + rbT * 0.028);

// A torn frame: rows slide sideways for an eighth of a second.
float rbGlitchSlot = floor(rbT * 8.0);
float rbGlitch = step(1.0 - (0.012 + rbFaulty * 0.12), rbHash11(rbGlitchSlot * 1.7 + rbSeed * 13.0));
float rbRow = floor(vScreenLocal.y * 22.0);
rbL.x += rbGlitch * step(0.55, rbHash11(rbRow * 3.1 + rbGlitchSlot)) * (rbHash11(rbRow * 7.3 + rbGlitchSlot * 1.3) - 0.5) * 0.14;
rbL.x = rbMotion == 3.0 ? fract(rbL.x) : clamp(rbL.x, 0.0, 1.0);

float rbCycle = rbT / rbSecs;
float rbK = mod(floor(rbCycle), rbFrames);
vec4 rbTex = rbScreenFrame(rbK, rbL, rbGx, rbGy);

#ifdef RB_HOLO
  float rbScanPos = vScreenLocal.y * 180.0 - rbT * 9.0;
  float rbScan = mix(0.6 + 0.4 * sin(rbScanPos), 0.6, smoothstep(0.7, 2.2, fwidth(rbScanPos)));
  float rbFlick = 0.84 + 0.16 * sin(rbT * 31.0) * sin(rbT * 7.3 + rbSeed);
  float rbDrop = step(0.965, rbHash11(floor(rbT * 5.0) + rbSeed * 3.0));
  float rbBand = 1.0 + 0.7 * exp(-pow((fract(vScreenLocal.y - rbT * 0.3) - 0.5) * 12.0, 2.0));
  float rbEdge = smoothstep(0.0, 0.08, vScreenLocal.x) * smoothstep(1.0, 0.92, vScreenLocal.x)
    * smoothstep(0.0, 0.06, vScreenLocal.y) * smoothstep(1.0, 0.94, vScreenLocal.y);
  diffuseColor.rgb *= rbTex.rgb * rbScan * rbFlick * rbBand * rbEdge * (1.0 - 0.75 * rbDrop);
#else
  if (rbFrames > 1.5) {
    float rbWipe = clamp(fract(rbCycle) * rbSecs / 0.5, 0.0, 1.0);
    if (rbWipe < 1.0) {
      vec4 rbPrev = rbScreenFrame(mod(rbK + rbFrames - 1.0, rbFrames), rbL, rbGx, rbGy);
      float rbFront = 1.0 - rbWipe;
      rbTex = mix(rbPrev, rbTex, step(rbFront, vScreenLocal.y));
      rbTex.rgb += vec3(0.85, 1.0, 1.0) * 0.9 * exp(-pow((vScreenLocal.y - rbFront) * 70.0, 2.0));
    }
  }
  // The diodes, faded out once a texel is smaller than a pixel or so.
  vec2 rbPx = vScreenLocal * (vScreenSlot.yz * RB_ATLAS - 2.0 * RB_GUTTER);
  vec2 rbCell = abs(fract(rbPx) - 0.5);
  float rbDot = 1.0 - smoothstep(0.28, 0.5, max(rbCell.x, rbCell.y));
  float rbLed = 1.0 - smoothstep(0.3, 0.75, max(fwidth(rbPx.x), fwidth(rbPx.y)));
  rbTex.rgb = max(rbTex.rgb, vec3(0.010, 0.014, 0.018));
  rbTex.rgb *= mix(1.0, 0.3 + 0.9 * rbDot, rbLed);
  // A slow refresh band, a stuttering faulty board, and a hot row in a torn frame.
  rbTex.rgb *= 1.0 + 0.09 * exp(-pow((fract(vScreenLocal.y * 0.6 - rbT * 0.13) - 0.5) * 7.0, 2.0));
  float rbStutter = floor(rbT * 11.0);
  rbTex.rgb *= mix(1.0, 0.15 + 0.6 * rbHash11(rbStutter + rbSeed), rbFaulty * step(0.72, rbHash11(rbStutter * 0.37 + rbSeed * 5.0)));
  rbTex.rgb += rbGlitch * step(0.86, rbHash11(rbRow + rbGlitchSlot * 2.0)) * vec3(0.18, 0.02, 0.04);
  diffuseColor.rgb *= rbTex.rgb;
#endif
`;

function patch(material: THREE.MeshBasicMaterial, layout: ScreenLayout, time: { value: number }, holo: boolean): void {
  const pars = fragmentPars(layout);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rbScreenTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      // After the map's own declarations: the frame lookup samples it.
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n${holo ? '#define RB_HOLO\n' : ''}${pars}`)
      .replace('#include <map_fragment>', MAP_FRAGMENT);
  };
  const key = `rb-screen-${holo ? 'holo' : 'board'}-${layout.width}x${layout.height}`;
  material.customProgramCacheKey = () => key;
}

export function createScreenMaterials(atlas: THREE.Texture, layout: ScreenLayout, gain: number): ScreenMaterials {
  const time = { value: 0 };
  const boards = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, toneMapped: false });
  boards.color.setScalar(gain);
  patch(boards, layout, time, false);
  const holograms = new THREE.MeshBasicMaterial({
    map: atlas,
    vertexColors: true,
    toneMapped: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // A projection is light in the air: it is there from behind too.
    side: THREE.DoubleSide,
    forceSinglePass: true,
  });
  holograms.color.setScalar(gain);
  patch(holograms, layout, time, true);
  return { boards, holograms, time };
}
