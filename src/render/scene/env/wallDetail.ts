import * as THREE from 'three';

/**
 * THE STREET-LEVEL CONCRETE.
 *
 * The tower facades get their concrete photograph through the facade atlas
 * (`facadeAtlas.ts`), on the atlas's own UVs. That covers the walls above the second storey
 * and nothing else — and the walls above the second storey are the ones a driver never gets
 * within twenty metres of. Everything you actually pass at arm's length — a ground-floor
 * module, a viaduct skirt, a pier, an alley wall, a kerb-side retaining wall — was flat
 * vertex colour, which at night reads as a grey card.
 *
 * This is the material those surfaces share. It is `concreteMat` plus one detail map: the
 * same `buildings/concrete` slot the facades read, multiplied over the vertex colour.
 *
 * WHY THE SAMPLE IS TRIPLANAR RATHER THAN A UV
 * The geometry that lands here is drawn by a dozen call sites across five builders, in every
 * primitive `MeshBuilder` has — `quad` (the viaduct skirts, whose corners are four different
 * heights), `slopedBox` (alley walls climbing a ramp), `box`, `orientedBox`. Only two of
 * those take a world-scaled tile, and `quad` takes raw UVs the callers compute for other
 * reasons. Giving every one of them a correct, consistent concrete UV means editing all of
 * them and getting the maths right at each; projecting in world space means editing none of
 * them, and a wall and the pier beside it line up for free because they are sampling the same
 * field. The cost is three texture fetches instead of one, on a mesh that covers a small
 * fraction of the frame.
 *
 * The projection is per-object rather than per-fragment-normal-map, so nothing here needs a
 * tangent, and the surfaces are near enough axis-aligned that the blend is almost always
 * one plane anyway.
 */

/** Metres of concrete photograph per tile. Sized so the grain reads from the driving seat. */
export const WALL_TILE = 4;

/**
 * How hard the projection favours the dominant axis. High, because these surfaces are walls
 * and slabs: blending three planes evenly on a face that is 99% +X only smears it.
 */
const BLEND_SHARPNESS = 8;

/**
 * The gain to fall back on if the tile's brightness could not be measured. Never used in
 * practice — `setDetailMap` is handed `1 / handle.luma` — and sized for a mid-grey tile.
 */
const FALLBACK_GAIN = 2.6;

/** How much of the multiply lands. 1 is the full photograph; below that fades it towards flat. */
const WALL_MIX = 0.9;

const VERTEX_PARS = `
varying vec3 vRbWallPos;
varying vec3 vRbWallNormal;
`;

const VERTEX_BODY = `
  vRbWallPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vRbWallNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAGMENT_PARS = `
varying vec3 vRbWallPos;
varying vec3 vRbWallNormal;
uniform sampler2D rbWallMap;
uniform float rbWallMix;
uniform float rbWallGain;
`;

const MAP_FRAGMENT = `
  if (rbWallMix > 0.0) {
    vec3 rbW = pow(abs(normalize(vRbWallNormal)), vec3(${BLEND_SHARPNESS.toFixed(1)}));
    rbW /= (rbW.x + rbW.y + rbW.z);
    vec3 rbP = vRbWallPos * ${(1 / WALL_TILE).toFixed(5)};
    vec3 rbC = texture2D(rbWallMap, rbP.zy).rgb * rbW.x
             + texture2D(rbWallMap, rbP.xz).rgb * rbW.y
             + texture2D(rbWallMap, rbP.xy).rgb * rbW.z;
    diffuseColor.rgb *= mix(vec3(1.0), rbC * rbWallGain, rbWallMix);
  }
`;

/** `concreteMat`, plus the one hook: the photograph, which lands some frames after start-up. */
export interface WallMaterial extends THREE.MeshStandardMaterial {
  /**
   * Swap in the concrete photograph, or pass null to go back to flat vertex colour. `luma` is
   * the tile's average brightness in linear light (`TextureHandle.luma`); the map is divided
   * by it, so the photograph adds grain to the wall without darkening it. Passing the wrong
   * one — or the sRGB byte mean the manifest's `normalize` works in — dims every wall in the
   * city by about a third.
   */
  setDetailMap(tex: THREE.Texture | null, luma?: number | null, mix?: number): void;
}

/**
 * The street-level wall material: same roughness, metalness and (stock) fog as the flat
 * `concreteMat` it splits off from, so a wall and the kerb it stands on still read as the
 * same material and fade into the distance together. The detail map is the only difference.
 */
export function createWallMaterial(): WallMaterial {
  // A 1x1 white texel until the file lands: an unbound sampler is undefined behaviour, and
  // white is the identity for the multiply above. `rbWallMix` is 0 until then anyway.
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  const detail: { value: THREE.Texture } = { value: white };
  const mix = { value: 0 };
  const gain = { value: FALLBACK_GAIN };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.04 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rbWallMap = detail;
    shader.uniforms.rbWallMix = mix;
    shader.uniforms.rbWallGain = gain;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      // After `color_fragment`, so the multiply lands on the vertex colour the palette chose.
      .replace('#include <color_fragment>', `#include <color_fragment>\n${MAP_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => 'rb-wall-detail-v1';
  const wall = material as WallMaterial;
  wall.setDetailMap = (tex, luma = null, amount = WALL_MIX) => {
    detail.value = tex ?? white;
    mix.value = tex ? amount : 0;
    gain.value = luma && luma > 0.01 ? 1 / luma : FALLBACK_GAIN;
  };
  material.addEventListener('dispose', () => white.dispose());
  return wall;
}
