import * as THREE from 'three';

/**
 * THE POLISHED FLOOR'S REFLECTION: one planar mirror pass at reduced resolution, blurred by the
 * mip chain, laid over ordinary `MeshStandardMaterial`s (the floor and the turntable's plate).
 *
 * Why this and not the alternatives: a mirrored copy of the car would double the car's fourteen
 * draw calls AND need its geometry kept in step with every part the player tries on; an env map
 * cannot show the car standing in its own reflection, which is the whole look of NFSU2's
 * turntable. A planar pass renders the scene once more from the camera mirrored in the plate's
 * plane, into a half-float target at `scale` of the drawing buffer (half by default, a quarter of
 * the pixels), so it costs the room's handful of batches plus the car's draw calls, and the
 * reflection is always exactly the car you are building. `reflective(material)` then adds it in
 * the material's own shader: through the roughness map (grout and oil do not reflect), stronger
 * toward grazing angles (Fresnel), sampled from a blurred mip so it reads as polish, not glass.
 *
 * `render()` is called by the showroom before the main pass. It hides the reflective surfaces
 * themselves while it draws. Nothing allocated per frame.
 */
export interface FloorReflection {
  /** Make `material` show the reflection. `strength` 0..1 at grazing; `blur` in mip levels. */
  reflective(material: THREE.MeshStandardMaterial, strength: number, blur: number): void;
  /** Draw the mirrored pass for `camera`. `hide` are drawn in the main pass only. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: readonly THREE.Object3D[]): void;
  /** Turn the pass off (the materials then add nothing) or on. */
  enabled: boolean;
  dispose(): void;
}

export function createFloorReflection(planeY: number, scale = 0.5): FloorReflection {
  const target = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    samples: 0,
  });
  const virtualCamera = new THREE.PerspectiveCamera();
  const textureMatrix = new THREE.Matrix4();
  const uniforms = {
    tReflect: { value: target.texture as THREE.Texture },
    uReflMatrix: { value: textureMatrix },
    uReflOn: { value: 1 },
  };

  const size = new THREE.Vector2();
  const normal = new THREE.Vector3(0, 1, 0);
  const planePoint = new THREE.Vector3(0, planeY, 0);
  const plane = new THREE.Plane();
  const clip = new THREE.Vector4();
  const q = new THREE.Vector4();
  const camPos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const view = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  const materials: THREE.Material[] = [];

  let enabled = true;
  const api: FloorReflection = {
    get enabled() {
      return enabled;
    },
    set enabled(on: boolean) {
      enabled = on;
      uniforms.uReflOn.value = on ? 1 : 0;
    },
    reflective(material, strength, blur) {
      materials.push(material);
      material.onBeforeCompile = (shader) => {
        shader.uniforms.tReflect = uniforms.tReflect;
        shader.uniforms.uReflMatrix = uniforms.uReflMatrix;
        shader.uniforms.uReflOn = uniforms.uReflOn;
        shader.uniforms.uReflStrength = { value: strength };
        shader.uniforms.uReflLod = { value: blur };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform mat4 uReflMatrix;\nvarying vec4 vReflUv;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvReflUv = uReflMatrix * modelMatrix * vec4(transformed, 1.0);');
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform sampler2D tReflect;\nuniform mat4 uReflMatrix;\nuniform float uReflOn;\nuniform float uReflStrength;\nuniform float uReflLod;\nvarying vec4 vReflUv;',
          )
          .replace(
            '#include <opaque_fragment>',
            `if (uReflOn > 0.5) {
  vec2 ruv = vReflUv.xy / vReflUv.w;
  vec2 texel = uReflLod * 1.5 / vec2(textureSize(tReflect, 0));
  vec3 refl = textureLod(tReflect, ruv, uReflLod).rgb * 0.4;
  refl += textureLod(tReflect, ruv + vec2(texel.x, texel.y), uReflLod).rgb * 0.15;
  refl += textureLod(tReflect, ruv + vec2(-texel.x, texel.y), uReflLod).rgb * 0.15;
  refl += textureLod(tReflect, ruv + vec2(texel.x, -texel.y), uReflLod).rgb * 0.15;
  refl += textureLod(tReflect, ruv + vec2(-texel.x, -texel.y), uReflLod).rgb * 0.15;
  float facing = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
  float fres = mix(0.3, 1.0, pow(1.0 - facing, 3.0));
  float polish = clamp(1.0 - roughnessFactor * 1.6, 0.0, 1.0);
  outgoingLight += refl * uReflStrength * fres * polish;
}
#include <opaque_fragment>`,
          );
      };
      material.customProgramCacheKey = () => `rb-showroom-reflect-${strength}-${blur}`;
      material.needsUpdate = true;
    },

    render(renderer, scene, camera, hide) {
      if (!enabled) return;
      // Size: a fraction of what is on screen, re-made only when that changes.
      renderer.getDrawingBufferSize(size);
      const w = Math.max(2, Math.floor(size.x * scale));
      const h = Math.max(2, Math.floor(size.y * scale));
      if (target.width !== w || target.height !== h) target.setSize(w, h);

      camPos.setFromMatrixPosition(camera.matrixWorld);
      view.subVectors(planePoint, camPos);
      if (view.dot(normal) > 0) return; // Below the floor: nothing to see.
      // Mirror the camera and its line of sight in the plane (Reflector's construction).
      view.reflect(normal).negate().add(planePoint);
      rot.extractRotation(camera.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
      tgt.subVectors(planePoint, look).reflect(normal).negate().add(planePoint);
      virtualCamera.position.copy(view);
      virtualCamera.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
      virtualCamera.lookAt(tgt);
      virtualCamera.far = camera.far;
      virtualCamera.near = camera.near;
      virtualCamera.updateMatrixWorld();
      virtualCamera.projectionMatrix.copy(camera.projectionMatrix);
      virtualCamera.layers.mask = 1; // layer 0 only: whatever is on layer 1 is not reflected

      textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      textureMatrix.multiply(virtualCamera.projectionMatrix);
      textureMatrix.multiply(virtualCamera.matrixWorldInverse);

      // Oblique near plane on the mirror, so nothing under the floor leaks into the reflection.
      plane.setFromNormalAndCoplanarPoint(normal, planePoint);
      plane.applyMatrix4(virtualCamera.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const p = virtualCamera.projectionMatrix.elements;
      q.x = (Math.sign(clip.x) + p[8]) / p[0];
      q.y = (Math.sign(clip.y) + p[9]) / p[5];
      q.z = -1;
      q.w = (1 + p[10]) / p[14];
      clip.multiplyScalar(2 / clip.dot(q));
      p[2] = clip.x;
      p[6] = clip.y;
      p[10] = clip.z + 1;
      p[14] = clip.w;
      virtualCamera.projectionMatrixInverse.copy(virtualCamera.projectionMatrix).invert();

      for (let i = 0; i < hide.length; i++) hide[i].visible = false;
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.state.buffers.depth.setMask(true);
      renderer.clear();
      renderer.render(scene, virtualCamera);
      renderer.setRenderTarget(previous);
      for (let i = 0; i < hide.length; i++) hide[i].visible = true;
    },

    dispose() {
      target.dispose();
      for (const m of materials) m.onBeforeCompile = () => {};
    },
  };
  return api;
}
