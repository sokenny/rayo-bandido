import * as THREE from 'three';
import { ATMOSPHERE } from '../../../config/tuning';

/**
 * The sky.
 *
 * One inverted sphere, centred on the camera, drawn first with the depth test off, so it is
 * the background in the only sense that matters: everything else paints over it. It replaces
 * a 512 x 256 canvas gradient that could not do any of the things the storm needs — it could
 * not move, it could not be lit by a flash, and any cloud drawn into it would visibly tile.
 *
 * HOW THE CLOUDS WORK
 *
 * Not volumetrics, and not a texture. Each cloud layer is a plane at a notional height, and a
 * view ray is projected onto it: `p = d.xz / d.y`. That single divide is where the depth in
 * this sky comes from — straight up the projection is 1:1 and a formation reads at its true
 * size, and towards the horizon it stretches without limit, so the same noise compresses into
 * the long, layered banks a storm ceiling actually shows. Two layers at different heights,
 * different scales and different (very slow) drifts then move against each other, which is
 * the parallax that stops a sky looking painted on.
 *
 * The shape itself is fbm value noise evaluated in the fragment shader from a hash — no
 * texture, no period, nothing to repeat — with the near layer's domain bent by the far
 * layer's, so even the noise lattice cannot show through. Coverage is one smoothstep against
 * the fbm, which makes `ATMOSPHERE.coverage` behave like a weather dial rather than a fade.
 *
 * Detail is flattened towards the horizon in step with the projection stretch. That is both
 * the anti-aliasing (the noise would otherwise run far past a pixel per cell down there and
 * crawl) and the art: distance is meant to dissolve into haze.
 *
 * LIGHTING
 * - The city under the cloud base: a magenta wash that falls off with height, strongest
 *   where the layers are thin, so it reads as light coming up through them.
 * - A strike: `uFlash` times a lobe around `uFlashDir`, multiplied by the RAW fbm rather
 *   than by the thresholded cloud mask, so the flash reveals the structure inside a bank
 *   instead of merely brightening its silhouette.
 *
 * COST
 * One extra draw call. Per sky pixel: `octavesFar + octavesNear` value-noise taps, four
 * hashes each, and no texture fetch at all. Nothing is allocated per frame; every value the
 * game changes is a uniform, and the quality preset is `#define`s so an octave that is not
 * drawn is not compiled.
 */
export interface SkyDome {
  mesh: THREE.Mesh;
  uniforms: SkyUniforms;
  /** Re-read `ATMOSPHERE`'s colours and numbers into the uniforms. Cheap; call after a tweak. */
  refresh(): void;
  dispose(): void;
}

export interface SkyQuality {
  /** fbm octaves in the far layer and in the near one. */
  octavesFar: number;
  octavesNear: number;
  /** Draw the second (near) cloud layer at all. */
  twoLayers: boolean;
  /** Dome tessellation. It only has to be round enough that the gradient has no facets. */
  segments: number;
}

interface SkyUniforms {
  uTime: { value: number };
  uZenith: { value: THREE.Color };
  uMiddle: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uFog: { value: THREE.Color };
  uCloudDark: { value: THREE.Color };
  uCloudLight: { value: THREE.Color };
  uPollutionColor: { value: THREE.Color };
  uFlashColor: { value: THREE.Color };
  uFlashDir: { value: THREE.Vector3 };
  /** middleBand, horizonGlow, horizonFalloff, cloudOpacity */
  uGradient: { value: THREE.Vector4 };
  /** coverage, edgeSoftness, contrast, warp */
  uShape: { value: THREE.Vector4 };
  /** scaleFar, scaleNear, driftFar, driftNear */
  uLayers: { value: THREE.Vector4 };
  /** pollution, pollutionHeight, flashFocus, flash */
  uLight: { value: THREE.Vector4 };
  /** zenithSpan, pollutionFocus, hazeStart, hazeEnd */
  uDetail: { value: THREE.Vector4 };
  /** How much darker a layer reads when it is seen from underneath. */
  uUnderside: { value: number };
}

const VERTEX_SHADER = /* glsl */ `
varying vec3 vDir;
void main() {
  // The dome is never rotated and never scaled, so its local position is already the world
  // direction from the camera it is centred on. Normalising is left to the fragment stage.
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uZenith;
uniform vec3 uMiddle;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uCloudDark;
uniform vec3 uCloudLight;
uniform vec3 uPollutionColor;
uniform vec3 uFlashColor;
uniform vec3 uFlashDir;
uniform vec4 uGradient;
uniform vec4 uShape;
uniform vec4 uLayers;
uniform vec4 uLight;
uniform vec4 uDetail;
uniform float uUnderside;

varying vec3 vDir;

float hash21( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}

float vnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = hash21( i );
  float b = hash21( i + vec2( 1.0, 0.0 ) );
  float c = hash21( i + vec2( 0.0, 1.0 ) );
  float d = hash21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

// A rotation between octaves, so the lattice of one never lines up with the next.
const mat2 ROT = mat2( 0.804, 0.595, -0.595, 0.804 );

float fbmFar( vec2 p ) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for ( int i = 0; i < OCTAVES_FAR; i ++ ) {
    sum += amp * vnoise( p );
    norm += amp;
    p = ROT * p * 2.07;
    amp *= 0.5;
  }
  return sum / norm;
}

#if NEAR_LAYER
float fbmNear( vec2 p ) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for ( int i = 0; i < OCTAVES_NEAR; i ++ ) {
    sum += amp * vnoise( p );
    norm += amp;
    p = ROT * p * 2.11;
    amp *= 0.5;
  }
  return sum / norm;
}
#endif

void main() {
  vec3 d = normalize( vDir );
  float h = d.y;
  float up = clamp( h, 0.0, 1.0 );

  // Horizon -> middle -> zenith. Two smoothsteps, so the band the eye spends most time in
  // (just above the skyline) can be widened or narrowed without touching the other two.
  float band = max( uGradient.x, 0.001 );
  vec3 sky = mix( uHorizon, uMiddle, smoothstep( 0.0, band, up ) );
  // The navy is the last thing to arrive, over its own span, or the teal body of the sky is
  // gone by the time the eye is a third of the way up and the whole ceiling reads as black.
  sky = mix( sky, uZenith, smoothstep( band, band + max( uDetail.x, 0.05 ), up ) );

  // The industrial lift in the last few degrees: the city's own light in the air over it.
  float glowFall = max( uGradient.z, 0.001 );
  float glow = 1.0 - clamp( up / glowFall, 0.0, 1.0 );
  sky += uHorizon * ( glow * glow * glow * uGradient.y );

  float flash = uLight.w;
  float lobe = pow( max( dot( d, uFlashDir ), 0.0 ), uLight.z );
  // Even a distant strike lifts the whole ceiling a little; the lobe is what makes it local.
  float lit = flash * ( 0.22 + 0.78 * lobe );

  // Clouds live in the upper hemisphere only, and fade out before the projection below
  // diverges. The band this fades over is also where the aerial haze eats them anyway.
  float mask = smoothstep( 0.012, 0.20, h );

  if ( mask > 0.002 ) {
    // The projection: a view ray onto a plane overhead. Clamped, or the horizon divides by
    // zero and the noise turns to static a long way before it gets there.
    float t = min( 1.0 / max( h, 0.055 ), 22.0 );
    vec2 base = d.xz * t;
    // Detail is flattened towards the mean in step with how fast the projection is running
    // past a pixel, which is 't' times the layer's own scale — so a coarse layer keeps its
    // shape closer to the skyline than a fine one, exactly as real cloud does. This is both
    // the anti-aliasing and the aerial haze; below it the sky is meant to be a wash.
    float flatFar = smoothstep( uDetail.z, uDetail.w, t * uLayers.x ) * 0.85;

    vec2 pFar = base * uLayers.x + vec2( uLayers.z, uLayers.z * 0.6 ) * uTime;
    float nFar = mix( fbmFar( pFar ), 0.5, flatFar );
    float dFar = smoothstep( 1.0 - uShape.x, 1.0 - uShape.x + uShape.y, nFar );
    dFar = pow( dFar, uShape.z );

    // Thick core dark, thin edge bright: the storm lining, from the same sample. On top of
    // that, how much of a layer's UNDERSIDE is in view: overhead a bank is seen from below
    // and is nearly black, and towards the skyline its flank is turned to the city and
    // catches its light. That single term is what keeps the ceiling dark without flattening
    // the bright, layered banks along the horizon that carry the whole mood.
    float underside = uUnderside * smoothstep( 0.05, 0.55, h );
    vec3 colFar = mix( uCloudLight, uCloudDark, clamp( smoothstep( 0.34, 0.78, nFar ) + underside, 0.0, 1.0 ) );

    // The city under the base. Falls off with height and is strongest through thin cloud,
    // which is what makes it read as light coming up rather than as a tinted cloud.
    // Falls off with height, and is pushed into the dense parts of the layer by
    // 'pollutionFocus', so it lights the underside of a few banks rather than painting a
    // flat pink band right across the skyline.
    float pollute = uLight.x * pow( 1.0 - clamp( h / max( uLight.y, 0.001 ), 0.0, 1.0 ), 2.0 );
    colFar += uPollutionColor * pollute * 0.5 * pow( nFar, uDetail.y );
    // Lit by the RAW noise, so a strike shows what is inside the bank, not just its outline.
    colFar += uFlashColor * lit * mix( 0.25, 1.0, nFar );

    float aFar = dFar * mask * uGradient.w;
    sky += uFlashColor * lit * 0.3;
    vec3 col = mix( sky, colFar, aFar );

    #if NEAR_LAYER
      // The near layer is bent by the far one, so neither lattice can survive into the image.
      float flatNear = smoothstep( uDetail.z, uDetail.w, t * uLayers.y ) * 0.85;
      vec2 pNear = base * uLayers.y + vec2( -uLayers.w, uLayers.w * 0.42 ) * uTime + nFar * uShape.w;
      float nNear = mix( fbmNear( pNear ), 0.5, flatNear );
      float dNear = smoothstep( 1.0 - uShape.x, 1.0 - uShape.x + uShape.y, nNear );
      dNear = pow( dNear, uShape.z );
      vec3 colNear = mix( uCloudLight, uCloudDark, clamp( smoothstep( 0.30, 0.74, nNear ) + underside, 0.0, 1.0 ) );
      colNear += uPollutionColor * pollute * pow( nNear, uDetail.y );
      colNear += uFlashColor * lit * mix( 0.25, 1.0, nNear );
      col = mix( col, colNear, dNear * mask * uGradient.w );
    #endif

    sky = col;
  } else {
    sky += uFlashColor * lit * 0.3;
  }

  // Under the skyline the dome simply becomes the haze the world fades into, so the join
  // between the far buildings, the fog and the sky is one colour and never a seam.
  sky = mix( uFog, sky, smoothstep( -0.07, 0.02, h ) );

  gl_FragColor = vec4( sky, 1.0 );

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Radius. Well inside the camera's far plane (`CAMERA.far`) but otherwise arbitrary: the
 * depth test is off and the dome draws first, so its distance decides nothing.
 */
const RADIUS = 500;

export function createSkyDome(quality: SkyQuality): SkyDome {
  const A = ATMOSPHERE;
  const uniforms: SkyUniforms = {
    uTime: { value: 0 },
    uZenith: { value: new THREE.Color(A.zenith) },
    uMiddle: { value: new THREE.Color(A.middle) },
    uHorizon: { value: new THREE.Color(A.horizon) },
    uFog: { value: new THREE.Color(A.fogColor) },
    uCloudDark: { value: new THREE.Color(A.cloudDark) },
    uCloudLight: { value: new THREE.Color(A.cloudLight) },
    uPollutionColor: { value: new THREE.Color(A.pollutionColor) },
    uFlashColor: { value: new THREE.Color(A.storm.color) },
    uFlashDir: { value: new THREE.Vector3(0, 1, 0) },
    uGradient: { value: new THREE.Vector4() },
    uShape: { value: new THREE.Vector4() },
    uLayers: { value: new THREE.Vector4() },
    uLight: { value: new THREE.Vector4() },
    uDetail: { value: new THREE.Vector4() },
    uUnderside: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    name: 'skyDome',
    uniforms: uniforms as unknown as { [key: string]: THREE.IUniform },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    defines: {
      OCTAVES_FAR: Math.max(1, Math.round(quality.octavesFar)),
      OCTAVES_NEAR: Math.max(1, Math.round(quality.octavesNear)),
      NEAR_LAYER: quality.twoLayers ? 1 : 0,
    },
    side: THREE.BackSide,
    // Drawn before everything with no depth of its own: the background, by construction.
    depthTest: false,
    depthWrite: false,
    // The dome IS where the fog goes; fogging it would haze the haze.
    fog: false,
  });

  const geometry = new THREE.SphereGeometry(RADIUS, quality.segments, Math.max(6, quality.segments >> 1));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky-dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  // The dome is placed straight into `matrixWorld` from the camera every frame (see
  // `atmosphere.ts`), which is both cheaper than a scene-graph update and the only way to
  // move an object from inside `onBeforeRender`, where the matrices have already been built.
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;

  function refresh(): void {
    uniforms.uZenith.value.set(A.zenith);
    uniforms.uMiddle.value.set(A.middle);
    uniforms.uHorizon.value.set(A.horizon);
    uniforms.uCloudDark.value.set(A.cloudDark);
    uniforms.uCloudLight.value.set(A.cloudLight);
    uniforms.uPollutionColor.value.set(A.pollutionColor);
    uniforms.uFlashColor.value.set(A.storm.color);
    uniforms.uGradient.value.set(A.middleBand, A.horizonGlow, A.horizonFalloff, A.cloudOpacity);
    uniforms.uShape.value.set(A.coverage, A.edgeSoftness, A.contrast, A.warp);
    uniforms.uLayers.value.set(A.scaleFar, A.scaleNear, A.driftFar, A.driftNear);
    // `uLight.w` is the live flash and is written per frame; the rest are art direction.
    const light = uniforms.uLight.value;
    light.set(A.pollution, A.pollutionHeight, A.storm.focus, light.w);
    uniforms.uDetail.value.set(A.zenithSpan, A.pollutionFocus, A.hazeStart, A.hazeEnd);
    uniforms.uUnderside.value = A.cloudUnderside;
  }

  refresh();

  return {
    mesh,
    uniforms,
    refresh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
