import * as THREE from 'three';

/**
 * Procedural sprite textures for the effect pools. Everything is generated once from a
 * small canvas so the build ships no image assets and the palette stays in code.
 *
 * Palette (docs/VISUAL_DIRECTION.md): lightning = cyan / blue-white, nitro = magenta/violet
 * with a warm exhaust core, tire smoke = desaturated grey-violet.
 */

type GradientStop = readonly [number, string];

function radialTexture(size: number, stops: readonly GradientStop[], name: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    for (let i = 0; i < stops.length; i++) gradient.addColorStop(stops[i][0], stops[i][1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export interface FxTextures {
  /** Soft wide puff, tinted per particle. Used with normal blending. */
  smoke: THREE.Texture;
  /** Hot white core with a cyan falloff. Used additively for flashes and bolt glow. */
  flare: THREE.Texture;
  /** Tight neutral dot for sparks. Colored per particle. */
  spark: THREE.Texture;
  /** Warm white-orange core fading through magenta to violet: the nitro flame. */
  flame: THREE.Texture;
  dispose(): void;
}

export function createFxTextures(): FxTextures {
  const smoke = radialTexture(
    64,
    [
      [0.0, 'rgba(255,255,255,0.80)'],
      [0.32, 'rgba(226,220,242,0.46)'],
      [0.62, 'rgba(186,180,214,0.16)'],
      [1.0, 'rgba(160,156,190,0.0)'],
    ],
    'fx-smoke',
  );
  const flare = radialTexture(
    64,
    [
      [0.0, 'rgba(255,255,255,1.0)'],
      [0.16, 'rgba(238,252,255,0.85)'],
      [0.42, 'rgba(120,222,255,0.30)'],
      [0.72, 'rgba(60,150,255,0.08)'],
      [1.0, 'rgba(40,90,255,0.0)'],
    ],
    'fx-flare',
  );
  const spark = radialTexture(
    32,
    [
      [0.0, 'rgba(255,255,255,1.0)'],
      [0.30, 'rgba(255,255,255,0.82)'],
      [0.62, 'rgba(255,255,255,0.18)'],
      [1.0, 'rgba(255,255,255,0.0)'],
    ],
    'fx-spark',
  );
  const flame = radialTexture(
    64,
    [
      [0.0, 'rgba(255,246,226,1.0)'],
      [0.15, 'rgba(255,206,150,0.92)'],
      [0.34, 'rgba(255,116,222,0.68)'],
      [0.60, 'rgba(186,78,255,0.28)'],
      [1.0, 'rgba(120,40,255,0.0)'],
    ],
    'fx-flame',
  );
  return {
    smoke,
    flare,
    spark,
    flame,
    dispose() {
      smoke.dispose();
      flare.dispose();
      spark.dispose();
      flame.dispose();
    },
  };
}

/**
 * Program cache key shared by every patched points material. `Material.customProgramCacheKey`
 * defaults to `onBeforeCompile.toString()`, and each material gets its own closure, so
 * without a stable key Three would compile one program per pool.
 */
export const FX_POINTS_CACHE_KEY = 'rb-fx-points-v1';

/**
 * Give a `PointsMaterial` per-particle size and alpha.
 *
 * Three's points shader only exposes one uniform size and one uniform opacity, and
 * `vertexColors` multiplies RGB but not alpha, so particles could not fade under normal
 * blending. This injects two float attributes (`aScale`, `aAlpha`) into the stock shader:
 * cheap, keeps the stock material (fog, tone mapping, color space) and, if a future Three
 * release renames the anchors, degrades to uniform size/alpha rather than breaking.
 *
 * Any geometry rendered with a patched material MUST provide both attributes.
 */
export function patchPointsMaterial(material: THREE.PointsMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        'attribute float aScale;\nattribute float aAlpha;\nvarying float vFxAlpha;\nvoid main() {',
      )
      .replace('gl_PointSize = size;', 'vFxAlpha = aAlpha;\n\tgl_PointSize = size * aScale;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vFxAlpha;\nvoid main() {')
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( diffuse, opacity * vFxAlpha );',
      );
  };
  material.customProgramCacheKey = () => FX_POINTS_CACHE_KEY;
}
