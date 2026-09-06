import * as THREE from 'three';

/**
 * Aerial perspective.
 *
 * Distance in this city is sold by haze, not by hiding things. Scene fog alone cannot do
 * that job on its own: it is a flat lerp towards one colour applied to every fragment
 * equally, so a lit window and the concrete around it fade at exactly the same rate and the
 * skyline collapses into a single grey card long before the far clip. Real night air does
 * the opposite — the walls go first and the lights are the last thing left, which is why a
 * city across the water reads as a field of sparks rather than as a silhouette.
 *
 * This module patches `fog_fragment` per material so each family fades on its own terms:
 *
 * - STRENGTH scales the fog factor. Emissive materials (neon, signs, billboards) run well
 *   under 1: a light source punches through the same air that swallows a wall.
 * - LIGHT KEEP takes the fog back off the bright end of the pixel. The fog chunk runs after
 *   tone mapping and the colour-space transform, so `gl_FragColor` here is display-referred
 *   0..1 and its max channel is a usable "is this pixel a light?" test. A lit pane sits near
 *   1, night concrete near 0.15, so one smoothstep separates the windows from the wall they
 *   are set into inside a single material.
 * - ADDITIVE materials are attenuated to black instead of mixed towards the fog colour.
 *   Mixing an additive halo towards fog colour *adds* haze-coloured light to the sky behind
 *   it, so distant halos brighten the horizon into a smear; scaling it down instead makes a
 *   far-off lamp simply dimmer, which is what distance does to a small light.
 *
 * Cost is nil: this is a handful of ALU ops in a shader that already ran the fog lerp, no
 * extra draw calls, no extra passes, and — importantly — fog was never culling anything.
 * Every building in the fog was always being submitted and rasterised; the haze only decided
 * what colour it came out. Reaching further costs nothing but the pixels it now paints.
 */
export const HAZE = {
  /**
   * `FogExp2` density for the open world. Exponential-squared never fully saturates, so the
   * far side of the bay keeps a little contrast instead of clamping to flat fog colour the
   * way linear fog does the moment it passes `far`. At 0.0024: ~5% haze at 100 m, ~24% at
   * 200 m, ~47% at 300 m, ~66% at 400 m, ~92% at 600 m.
   */
  cityDensity: 0.0024,
  /** Facades: the wall hazes normally, lit glass keeps most of its punch. */
  facadeLightKeep: 0.6,
  /** Neon, signs and billboards: bright by definition, so the whole material resists. */
  neonStrength: 0.5,
  neonLightKeep: 0.45,
  /** Lamp halos and light pools. Additive, so they dim rather than tint. */
  glowStrength: 0.72,
  /** Where a pixel stops being surface and starts being light source (display-referred). */
  lightLo: 0.35,
  lightHi: 0.9,
};

/** GLSL float literal: `1` is an int in GLSL and will not compile where a float is wanted. */
function f(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

function fogChunk(strength: number, lightKeep: number, additive: boolean): string {
  const keep =
    lightKeep > 0
      ? `  fogFactor *= 1.0 - ${f(lightKeep)} * smoothstep( ${f(HAZE.lightLo)}, ${f(HAZE.lightHi)}, max( gl_FragColor.r, max( gl_FragColor.g, gl_FragColor.b ) ) );\n`
      : '';
  const apply = additive
    ? '  gl_FragColor.rgb *= 1.0 - fogFactor;'
    : '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );';
  return `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
${strength === 1 ? '' : `  fogFactor *= ${f(strength)};\n`}${keep}${apply}
#endif
`;
}

export interface HazeOptions {
  /** Multiplier on the fog factor. 1 leaves the material fading at the scene's rate. */
  strength?: number;
  /** How much fog is taken back off the brightest pixels (0..1). */
  lightKeep?: number;
  /** Additive-blended material: attenuate towards black instead of towards the fog colour. */
  additive?: boolean;
}

/**
 * Patches one material's fog. Composes with any existing `onBeforeCompile` (the facade atlas
 * and the window activity both patch the same materials) and with any existing program cache
 * key — Three appends the custom key to the standard parameter hash, so stacking is safe as
 * long as the key describes the shader text this patch generates.
 */
export function applyHaze(material: THREE.Material, options: HazeOptions = {}): void {
  const strength = options.strength ?? 1;
  const lightKeep = options.lightKeep ?? 0;
  const additive = options.additive ?? false;
  const chunk = fogChunk(strength, lightKeep, additive);

  const inner = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    inner(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', chunk);
  };
  const innerKey = material.customProgramCacheKey.bind(material);
  const key = `rb-haze-${strength}-${lightKeep}-${additive ? 'add' : 'mix'}`;
  material.customProgramCacheKey = () => `${innerKey()}|${key}`;
}
