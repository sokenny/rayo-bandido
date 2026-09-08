import * as THREE from 'three';
import { MOOGUL } from '../../../config/tuning';
import { FACADE_GRID } from './facadeAtlas';

/**
 * The Moogul on the walls: the one shader hook the city's surfaces give the trip.
 *
 * Two materials are patched at build time — the facade atlas and the graffiti decals — and
 * both read the same two uniforms, which stay at zero for the whole life of a normal session.
 * Nothing is compiled, swapped or allocated when the trip begins: the controller
 * (`render/scene/moogulTrip.ts`) writes four numbers a frame and the walls do the rest.
 *
 * WHAT MOVES. Not the geometry. The facade's window grid is drawn by tiling one atlas cell
 * over the wall (`facadeAtlas.ts`), so shifting the tiled UV by a slow wave of world position
 * and time makes every pane slide and swell across the concrete while the wall itself, its
 * silhouette and everything the car collides with stay exactly where they are. The wave is
 * long (`MOOGUL.surface.warpWavelength`) and slow, so a facade breathes rather than shivers.
 * On top of that the window tints and the paint turn round the hue wheel, each wall on its
 * own phase, and the paint pulses — "alive", not "flickering".
 *
 * Cost: a few sines per fragment on two materials, behind an `if` on a uniform that is zero
 * outside a trip, so the city pays nothing for the feature when it is not in use.
 */
export interface MoogulSurface {
  /** x: window drift (tile UV units). y: facade hue (rad). z: paint hue (rad). w: paint pulse (0..1). */
  readonly uniforms: { uMoogul: { value: THREE.Vector4 }; uMoogulTime: { value: number } };
  applyFacade(material: THREE.Material): void;
  applyDecal(material: THREE.Material): void;
  /** Write this frame's amounts. Every argument 0 puts the walls exactly as they were. */
  set(warpPanes: number, facadeHue: number, decalHue: number, decalPulse: number, time: number): void;
}

const CACHE_KEY = 'rb-moogul-v1';

function f(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

const VERTEX_PARS = `
varying vec3 vMoogulPos;
`;

/** World position, computed here rather than borrowed: the stock `worldPosition` only exists under an env map or a shadow. */
const VERTEX_BODY = `
  vMoogulPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const FRAGMENT_PARS = `
varying vec3 vMoogulPos;
uniform vec4 uMoogul;
uniform float uMoogulTime;
// A turn round the grey axis: cheap, and it keeps the brightness the window activity set.
vec3 rbMoogulHue( vec3 c, float a ) {
  const vec3 k = vec3( 0.57735027 );
  float cs = cos( a );
  float sn = sin( a );
  return c * cs + cross( k, c ) * sn + k * dot( k, c ) * ( 1.0 - cs );
}
`;

/** The facade's tiled UV, drifted. Replaces the line the atlas patch starts with. */
function facadeWarp(): string {
  const k = (Math.PI * 2) / MOOGUL.surface.warpWavelength;
  const rate = MOOGUL.surface.warpRate;
  return `
  vec2 rbTileUv = vMapUv;
  if ( uMoogul.x > 0.0 ) {
    float mt = uMoogulTime * ${f(rate)};
    vec3 mp = vMoogulPos * ${f(k)};
    rbTileUv += uMoogul.x * vec2(
      sin( mp.y * 1.7 + mp.x * 0.35 + mp.z * 0.31 + mt ),
      sin( ( mp.x + mp.z ) * 0.8 + mp.y * 0.5 + mt * 0.8 + 1.9 ) );
  }
`;
}

/** The window tints, turned. Ahead of the lighting so the emissive goes into the frame already coloured. */
const FACADE_HUE = `
  if ( uMoogul.y > 0.0 ) {
    float mAng = uMoogul.y * sin( uMoogulTime * 0.21 + vMoogulPos.x * 0.023 + vMoogulPos.z * 0.019 + vMoogulPos.y * 0.05 );
    totalEmissiveRadiance = rbMoogulHue( totalEmissiveRadiance, mAng );
  }
  #include <lights_physical_fragment>
`;

/** The paint, turned and pulsing. Diffuse and emissive together, so the piece keeps one colour. */
const DECAL_HUE = `
  if ( uMoogul.z > 0.0 || uMoogul.w > 0.0 ) {
    float mAng = uMoogul.z * sin( uMoogulTime * 0.17 + vMoogulPos.x * 0.11 + vMoogulPos.z * 0.09 + vMoogulPos.y * 0.2 );
    float mPulse = 1.0 + uMoogul.w * sin( uMoogulTime * 0.9 + vMoogulPos.x * 0.31 + vMoogulPos.z * 0.27 );
    diffuseColor.rgb = rbMoogulHue( diffuseColor.rgb, mAng );
    totalEmissiveRadiance = rbMoogulHue( totalEmissiveRadiance, mAng ) * mPulse;
  }
  #include <lights_physical_fragment>
`;

export function createMoogulSurface(): MoogulSurface {
  const uniforms = {
    uMoogul: { value: new THREE.Vector4(0, 0, 0, 0) },
    uMoogulTime: { value: 0 },
  };

  function patch(material: THREE.Material, fragment: (src: string) => string): void {
    const inner = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      inner.call(material, shader, renderer);
      shader.uniforms.uMoogul = uniforms.uMoogul;
      shader.uniforms.uMoogulTime = uniforms.uMoogulTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
      shader.fragmentShader = fragment(shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`));
    };
    const innerKey = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${innerKey()}|${CACHE_KEY}`;
  }

  return {
    uniforms,
    applyFacade(material) {
      patch(material, (src) =>
        src.replace('vec2 rbTileUv = vMapUv;', facadeWarp()).replace('#include <lights_physical_fragment>', FACADE_HUE),
      );
    },
    applyDecal(material) {
      patch(material, (src) => src.replace('#include <lights_physical_fragment>', DECAL_HUE));
    },
    set(warpPanes, facadeHue, decalHue, decalPulse, time) {
      // The warp is asked for in panes and written in tile units: eight panes to a tile.
      uniforms.uMoogul.value.set(warpPanes / FACADE_GRID.cols, facadeHue, decalHue, decalPulse);
      uniforms.uMoogulTime.value = time;
    },
  };
}
