import * as THREE from 'three';
import { WET_ROAD, type WetRoadTier } from '../../../config/tuning';

/**
 * THE WET ROAD: real planar reflections of the city's lights in the asphalt, broken up by
 * puddles and rain ripples.
 *
 * Before this the road's "wetness" was `roughness 0.24, metalness 0.5` against the tiny
 * environment map: a sheen with the right mood and no shapes in it. This adds the shapes — the
 * neon, the signs, the screens and the lit windows, mirrored in the tarmac under them.
 *
 * HOW IT STAYS CHEAP (the lesson from the "Neon Rain" study: the reflection is real, nearly
 * everything it reflects is a cheap illusion)
 * - ONE mirror for every road. It is a horizontal plane at the height of the road under the
 *   player, so a deck the car is driving on reflects exactly and the streets under it are
 *   simply not wet-mirrored (the shader masks by height; they keep the old sheen).
 * - A SMALL, FIXED-HEIGHT BUFFER (`WET_ROAD.tiers`), independent of the canvas resolution, no
 *   MSAA, no depth-heavy content. Its width follows the camera aspect.
 * - A SHORT GUEST LIST. The mirror camera sees one layer, `REFLECT_LAYER`, and only the
 *   emissive families are on it: neon, signs, screens, holograms and the facades (their lit
 *   windows), plus the two scene lights (see `environment.ts` for why). No halos, no road, no
 *   props, no rain, no cars, no sky dome — where nothing was
 *   drawn the buffer stays black and the road keeps its environment-map sheen.
 * - CHEAP ROUGHNESS. A 5-tap blur stretched along the screen's vertical (the way a wet street
 *   smears a light towards the viewer) stands in for a rough surface; puddles narrow it.
 * - Puddles are one tiling noise texture sampled in world space; ripples are a jittered grid of
 *   rings with an analytic gradient, faded out past the distance where they would only shimmer.
 *
 * Cost: one extra scene render of the tagged meshes into the small buffer — every frame by default;
 * `WET_ROAD.refresh.every` can skip frames and re-project the last one while the view holds still —
 * plus a few texture reads on road pixels. `?wet=off|low|medium|high` overrides the tier for A/B.
 */
export interface WetRoad {
  /**
   * Adds the reflection to the road material. Call once, before it first compiles. `scale`
   * weakens it for a surface that is damp rather than paved and standing in water (the park's
   * lawn, `environment.ts`): the same mirror, a fraction of the light.
   */
  patch(material: THREE.MeshStandardMaterial, opts?: { scale?: number }): void;
  /**
   * Put a mesh on the mirror's guest list. `emissiveOnly` walks a subtree and tags only the
   * unlit lamp/neon meshes (the car's lights, not its bodywork).
   */
  tag(object: THREE.Object3D, emissiveOnly?: boolean): void;
  /**
   * Render the mirror for this frame. `groundY` is the road level the reflection is exact at
   * (the player's). `scale` (0..1] shrinks the buffer with the resolution governor. Returns
   * true when it drew, which means every world matrix in `scene` is already current for the
   * main pass that follows.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, groundY: number, time: number, scale?: number): boolean;
  /**
   * Compile the guests' render-target programs in parallel, behind the loading screen. Only the
   * tagged materials: `renderer.compileAsync(scene)` alone would build a target variant of
   * every material in the world.
   */
  compile(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Promise<void>;
  readonly tier: WetRoadTier | 'off';
  /** Live switch (A/B, a settings menu): off skips the pass and the shader's reflection branch. */
  enabled: boolean;
  /** Live tuning: how much reflected light lands on the road (starts at `WET_ROAD.strength`). */
  strength: number;
  /** Draw calls the mirror pass issued last frame (the main pass's `renderer.info` excludes them). */
  readonly drawCalls: number;
  dispose(): void;
}

/**
 * The one layer the mirror camera sees. Nothing else in the game uses layers. Whatever is on it
 * must include every light the main pass sees, or three recompiles-checks every lit material.
 */
export const REFLECT_LAYER = 5;

export function resolveWetTier(param: string | null, touch: boolean): WetRoadTier | 'off' {
  const asked = param ?? WET_ROAD.quality;
  if (asked === 'off' || asked === 'low' || asked === 'medium' || asked === 'high') return asked;
  return touch ? 'off' : 'medium';
}

export function createWetRoad(tier: WetRoadTier | 'off'): WetRoad {
  const settings = tier === 'off' ? null : WET_ROAD.tiers[tier];

  const target = new THREE.WebGLRenderTarget(16, 16, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  target.texture.name = 'wet-road-reflection';

  const noise = makeNoiseTexture(128);

  const uniforms = {
    uWetRefl: { value: target.texture as THREE.Texture },
    uWetNoise: { value: noise as THREE.Texture },
    uWetMatrix: { value: new THREE.Matrix4() },
    uWetPlaneY: { value: 0 },
    uWetStrength: { value: 0 },
    uWetTime: { value: 0 },
    uWetTexel: { value: new THREE.Vector2(1 / 16, 1 / 16) },
  };

  const mirror = new THREE.PerspectiveCamera();
  mirror.layers.set(REFLECT_LAYER);
  // Scratch, made once.
  const camPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const clipPlane = new THREE.Vector4();
  const plane = new THREE.Plane();
  const q = new THREE.Vector4();
  const clearColor = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);
  const camDir = new THREE.Vector3();
  /** The view the buffer was last drawn for. A NaN `drawnGroundY` means nothing is reusable. */
  const drawnPos = new THREE.Vector3();
  const drawnDir = new THREE.Vector3();
  let drawnGroundY = Number.NaN;
  let framesSinceDraw = 0;
  const cosMaxTurn = Math.cos(WET_ROAD.refresh.maxTurn);

  let drawCalls = 0;
  let enabled = true;
  /** One mesh per distinct material on the guest list, for `compile`. */
  const guests = new Map<THREE.Material, THREE.Mesh>();
  const remember = (o: THREE.Object3D): void => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
    const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (m && !guests.has(m)) guests.set(m, mesh);
  };

  return {
    tier,
    get drawCalls() {
      return drawCalls;
    },
    get enabled() {
      return enabled;
    },
    set enabled(on: boolean) {
      enabled = on;
    },
    strength: WET_ROAD.strength,

    patch(material, opts) {
      if (!settings) return;
      const scale = opts?.scale ?? 1;
      const previous = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        shader.defines = { ...(shader.defines ?? {}), WET_TAPS: settings.taps, WET_SCALE: scale.toFixed(3) };
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform mat4 uWetMatrix;\nvarying vec3 vWetWorld;\nvarying vec4 vWetRefl;',
          )
          .replace(
            '#include <project_vertex>',
            '#include <project_vertex>\n{ vec4 wp = modelMatrix * vec4( transformed, 1.0 ); vWetWorld = wp.xyz; vWetRefl = uWetMatrix * wp; }',
          );
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
          .replace('#include <opaque_fragment>', `${FRAGMENT_BODY}\n#include <opaque_fragment>`);
      };
      // Distinct from any other patched standard material that happens to share its parameters.
      const key = material.customProgramCacheKey;
      material.customProgramCacheKey = () => `${key.call(material)}|wet${settings.taps}x${scale}`;
      material.needsUpdate = true;
    },

    tag(object, emissiveOnly = false) {
      if (!settings) return;
      if (!emissiveOnly) {
        object.layers.enable(REFLECT_LAYER);
        remember(object);
        return;
      }
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m = mesh.material;
        const mat = Array.isArray(m) ? m[0] : m;
        if (mat && (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
          mesh.layers.enable(REFLECT_LAYER);
          remember(mesh);
        }
      });
    },

    render(renderer, scene, camera, groundY, time, scale = 1) {
      drawCalls = 0;
      if (!settings) return false;
      if (!enabled) {
        uniforms.uWetStrength.value = 0;
        drawnGroundY = Number.NaN;
        return false;
      }
      camera.getWorldPosition(camPos);
      // Under the mirror (a lower street while the player is on a deck, say): nothing to see.
      if (camPos.y <= groundY + 0.05) {
        uniforms.uWetStrength.value = 0;
        drawnGroundY = Number.NaN;
        return false;
      }

      const buffer = renderer.getDrawingBufferSize(SIZE);
      const h = Math.max(90, Math.round(settings.height * Math.min(1, Math.max(0.5, scale))));
      const w = Math.max(160, Math.round((h * buffer.x) / Math.max(1, buffer.y)));
      const resized = target.width !== w || target.height !== h;
      if (resized) {
        target.setSize(w, h);
        uniforms.uWetTexel.value.set(1 / w, 1 / h);
      }

      // Reuse the last buffer while the view has barely changed. `uWetMatrix` and `uWetPlaneY`
      // keep the values it was drawn with, so the road re-projects it from the new camera.
      const { every, maxMove, maxRise } = WET_ROAD.refresh;
      camera.getWorldDirection(camDir);
      framesSinceDraw++;
      if (
        !resized &&
        framesSinceDraw < every &&
        Math.abs(groundY - drawnGroundY) < maxRise &&
        camPos.distanceToSquared(drawnPos) < maxMove * maxMove &&
        camDir.dot(drawnDir) > cosMaxTurn
      ) {
        uniforms.uWetTime.value = time;
        uniforms.uWetStrength.value = this.strength;
        return false;
      }
      framesSinceDraw = 0;
      drawnGroundY = groundY;
      drawnPos.copy(camPos);
      drawnDir.copy(camDir);

      // The mirrored camera (three's `Reflector`, specialised to a horizontal plane).
      mirror.position.set(camPos.x, 2 * groundY - camPos.y, camPos.z);
      rot.extractRotation(camera.matrixWorld);
      lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
      lookAt.y = 2 * groundY - lookAt.y;
      mirror.up.set(0, 1, 0).applyMatrix4(rot);
      mirror.up.y = -mirror.up.y;
      mirror.lookAt(lookAt);
      mirror.updateMatrixWorld();
      // The main camera's lens with a much nearer far plane: past `WET_ROAD.far` a reflection is
      // a few fogged pixels on the road, and in the chunked metro the frustum cull is what keeps
      // the far blocks' neon and facades out of this pass.
      mirror.fov = camera.fov;
      mirror.aspect = camera.aspect;
      mirror.near = camera.near;
      mirror.zoom = camera.zoom;
      mirror.far = Math.min(camera.far, WET_ROAD.far);
      mirror.updateProjectionMatrix();

      uniforms.uWetMatrix.value
        .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
        .multiply(mirror.projectionMatrix)
        .multiply(mirror.matrixWorldInverse);

      // Oblique near plane: nothing under the road (plus a lift, so the per-road z-fight lifts
      // and the light pools lying on the asphalt never reflect themselves) reaches the buffer.
      plane.setFromNormalAndCoplanarPoint(UP, lookAt.set(camPos.x, groundY + WET_ROAD.clipLift, camPos.z));
      plane.applyMatrix4(mirror.matrixWorldInverse);
      clipPlane.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const p = mirror.projectionMatrix.elements;
      q.x = (Math.sign(clipPlane.x) + p[8]) / p[0];
      q.y = (Math.sign(clipPlane.y) + p[9]) / p[5];
      q.z = -1;
      q.w = (1 + p[10]) / p[14];
      clipPlane.multiplyScalar(2 / clipPlane.dot(q));
      p[2] = clipPlane.x;
      p[6] = clipPlane.y;
      p[10] = clipPlane.z + 1;
      p[14] = clipPlane.w;
      mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();

      const prevTarget = renderer.getRenderTarget();
      const prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clearColor);
      const prevAutoReset = renderer.info.autoReset;
      renderer.info.autoReset = false;
      const before = renderer.info.render.calls;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.render(scene, mirror);
      drawCalls = renderer.info.render.calls - before;
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(clearColor, prevAlpha);
      renderer.info.autoReset = prevAutoReset;

      uniforms.uWetPlaneY.value = groundY;
      uniforms.uWetTime.value = time;
      uniforms.uWetStrength.value = this.strength;
      return true;
    },

    async compile(renderer, scene) {
      if (!settings || guests.size === 0) return;
      const proxies = new THREE.Scene();
      for (const [material, mesh] of guests) proxies.add(new THREE.Mesh(mesh.geometry, material));
      // Program parameters are read from the bound target synchronously inside `compileAsync`,
      // so the target only has to be bound for the call itself, not for the wait.
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      const done = renderer.compileAsync(proxies, mirror, scene);
      renderer.setRenderTarget(prev);
      await done;
      proxies.clear();
    },

    dispose() {
      target.dispose();
      noise.dispose();
    },
  };
}

const SIZE = new THREE.Vector2();

/** Two octaves of tiling value noise, one per channel, so puddles and warp read different fields. */
function makeNoiseTexture(n: number): THREE.DataTexture {
  const data = new Uint8Array(n * n * 4);
  const lattice = (seed: number, cells: number): Float32Array => {
    const v = new Float32Array(cells * cells);
    let s = seed;
    for (let i = 0; i < v.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      v[i] = s / 4294967296;
    }
    return v;
  };
  const sample = (v: Float32Array, cells: number, x: number, y: number): number => {
    const fx = (x / n) * cells;
    const fy = (y / n) * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (i: number, j: number) => v[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  const r4 = lattice(17, 4);
  const r8 = lattice(91, 8);
  const r16 = lattice(233, 16);
  const g8 = lattice(517, 8);
  const g16 = lattice(771, 16);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const r = sample(r4, 4, x, y) * 0.5 + sample(r8, 8, x, y) * 0.33 + sample(r16, 16, x, y) * 0.17;
      const g = sample(g8, 8, x, y) * 0.6 + sample(g16, 16, x, y) * 0.4;
      data[i] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  tex.name = 'wet-road-noise';
  return tex;
}

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uWetRefl;
uniform sampler2D uWetNoise;
uniform float uWetPlaneY;
uniform float uWetStrength;
uniform float uWetTime;
uniform vec2 uWetTexel;
varying vec3 vWetWorld;
varying vec4 vWetRefl;

float wetHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// One raindrop ring per cell, analytic gradient. Radius stays inside the cell, so no neighbours.
vec2 wetRipple(vec2 p, float t, float cell) {
  vec2 id = floor(p / cell);
  vec2 c = (id + 0.35 + 0.3 * vec2(wetHash(id), wetHash(id + 7.3))) * cell;
  float life = fract(t * 0.9 + wetHash(id + 3.1));
  vec2 d = p - c;
  float dist = length(d) + 1e-4;
  float r = life * 0.3 * cell;
  float x = (dist - r) * 38.0 / cell;
  float env = exp(-x * x * 0.08) * (1.0 - life) * (1.0 - life);
  return (d / dist) * cos(x) * env;
}
`;

const FRAGMENT_BODY = /* glsl */ `
{
  float wetLevel = uWetStrength * WET_SCALE * (1.0 - smoothstep(0.35, 1.1, abs(vWetWorld.y - uWetPlaneY)));
  // Mipmapped reads stay outside the branch: derivatives are undefined in non-uniform control flow.
  vec2 P = vWetWorld.xz;
  vec2 n1 = texture2D(uWetNoise, P * 0.019).rg;
  float n2 = texture2D(uWetNoise, P * 0.071 + 0.37).r;
  if (wetLevel > 0.001) {
    // 0 = damp asphalt, 1 = standing water.
    float wet = smoothstep(0.42, 0.68, n1.r * 0.72 + n2 * 0.28);

    vec3 V = cameraPosition - vWetWorld;
    float viewDist = length(V);
    float fres = pow(1.0 - clamp(V.y / viewDist, 0.0, 1.0), 3.0);

    // Rain rings, only near enough to resolve; low-frequency warp everywhere.
    float ripFade = 1.0 - smoothstep(9.0, 26.0, viewDist);
    vec2 grad = vec2(0.0);
    if (ripFade > 0.0) {
      grad = (wetRipple(P, uWetTime, 1.1) + wetRipple(P + 0.55, uWetTime * 1.13 + 0.5, 1.1)) * ripFade;
    }
    vec2 warp = (n1 - 0.5) * 0.012 + grad * mix(0.004, 0.0065, wet);

    vec4 uvp = vWetRefl;
    uvp.xy += warp * uvp.w;
    // Rough asphalt smears the light towards the viewer; standing water keeps it tight.
    vec2 texel = uWetTexel * uvp.w;
    vec2 along = vec2(0.0, texel.y * mix(9.0, 2.5, wet));
    vec2 across = vec2(texel.x * mix(1.8, 0.8, wet), 0.0);
    vec3 refl;
    #if WET_TAPS >= 5
      refl = texture2DProj(uWetRefl, uvp).rgb * 0.32
        + texture2DProj(uWetRefl, uvp + vec4(along, 0.0, 0.0)).rgb * 0.2
        + texture2DProj(uWetRefl, uvp - vec4(along, 0.0, 0.0)).rgb * 0.2
        + texture2DProj(uWetRefl, uvp + vec4(across, 0.0, 0.0)).rgb * 0.14
        + texture2DProj(uWetRefl, uvp - vec4(across, 0.0, 0.0)).rgb * 0.14;
    #else
      refl = texture2DProj(uWetRefl, uvp).rgb * 0.4
        + texture2DProj(uWetRefl, uvp + vec4(along, 0.0, 0.0)).rgb * 0.3
        + texture2DProj(uWetRefl, uvp - vec4(along, 0.0, 0.0)).rgb * 0.3;
    #endif

    float amount = wetLevel * mix(0.3, 1.0, wet) * (0.12 + 0.88 * fres);
    // Standing water is darker than the asphalt around it, which is what makes the light in it pop.
    outgoingLight *= 1.0 - 0.28 * wet * wetLevel;
    outgoingLight += refl * amount;
  }
}
`;
