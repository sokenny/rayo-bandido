import * as THREE from 'three';
import { ATMOSPHERE } from '../../../config/tuning';

/**
 * Rain: one `LineSegments`, one draw call, entirely animated on the GPU.
 *
 * Every drop is a two-vertex streak whose base position is a fixed point in a box that
 * follows the camera. The vertex shader falls it, wraps it with a `mod`, and stretches the
 * tail along the direction of travel. Nothing is written back to the buffer, so the CPU cost
 * of the whole storm is four uniforms a frame.
 *
 * The wrap includes the camera's own world position, which is the detail that makes this
 * read as rain rather than as a screensaver bolted to the windscreen: because `mod` is
 * periodic, adding the camera position leaves the field anchored in the world, so drops
 * stream past a moving car and stand still around a parked one — with no jump when the box
 * moves, which a snapped-to-grid box would have every `boxWidth` metres. The field repeats
 * every box, which nothing about falling water can reveal.
 *
 * The streak is also raked backwards by the camera's motion, so at speed the rain leans into
 * the windscreen the way it does through a real one, and it brightens during a lightning
 * flash — the moment a downpour is actually visible at night.
 *
 * Depth-tested but not depth-writing: drops behind a building are correctly hidden, and two
 * drops never fight each other.
 */
export interface Rain {
  mesh: THREE.LineSegments;
  /** Drops currently drawn (after intensity and the quality preset). 0 means nothing is drawn. */
  readonly count: number;
  refresh(): void;
  /** `flash` 0..1 from the storm; `time` is the same clock the sky drifts on. */
  update(time: number, flash: number): void;
  /** Called from `onBeforeRender`: box origin and the camera's motion for the streak rake. */
  place(camera: THREE.Camera, motionX: number, motionY: number, motionZ: number): void;
  dispose(): void;
}

const VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uBox;
uniform vec3 uOrigin;
uniform vec3 uFall;
uniform vec3 uMotion;
uniform float uLength;

attribute float aEnd;
attribute float aRand;

varying float vFade;

void main() {
  // 'position' is the drop's fixed seed inside the box. Adding the camera's own world
  // position before the wrap is what anchors the field to the world instead of to the car.
  vec3 p = position + uOrigin + uFall * uTime * ( 0.75 + 0.5 * aRand );
  p = mod( p, uBox );
  vec3 rel = p - uBox * 0.5;

  // The streak: down the direction of travel, seen from a camera that is itself moving.
  vec3 dir = normalize( uFall * ( 0.75 + 0.5 * aRand ) - uMotion );
  rel += dir * ( aEnd * uLength * ( 0.6 + 0.8 * aRand ) );

  vec4 mv = modelViewMatrix * vec4( rel, 1.0 );
  gl_Position = projectionMatrix * mv;

  // The tail is the faint end of the streak, and the whole box fades out at its own edge so
  // drops are never seen to pop in.
  float edge = 1.0 - smoothstep( 0.34, 0.5, length( rel.xz ) / uBox.x );
  vFade = ( 1.0 - aEnd * 0.7 ) * edge;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;

void main() {
  gl_FragColor = vec4( uColor, vFade * uOpacity );

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createRain(maxDrops: number): Rain {
  const R = ATMOSPHERE.rain;
  const drops = Math.max(0, Math.floor(maxDrops));

  const uniforms = {
    uTime: { value: 0 },
    uBox: { value: new THREE.Vector3(R.boxWidth, R.boxHeight, R.boxWidth) },
    uOrigin: { value: new THREE.Vector3() },
    uFall: { value: new THREE.Vector3(R.windX, -R.speed, R.windZ) },
    uMotion: { value: new THREE.Vector3() },
    uLength: { value: R.length },
    uColor: { value: new THREE.Color(R.color) },
    uOpacity: { value: 0 },
  };

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(drops * 6);
  const ends = new Float32Array(drops * 2);
  const rands = new Float32Array(drops * 2);
  // Deterministic, so two runs of the QA capture get the same rain in the same places.
  let seed = 0x9e37 >>> 0;
  const rnd = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < drops; i++) {
    const x = rnd() * R.boxWidth;
    const y = rnd() * R.boxHeight;
    const z = rnd() * R.boxWidth;
    const r = rnd();
    for (let v = 0; v < 2; v++) {
      const o = (i * 2 + v) * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
      ends[i * 2 + v] = v;
      rands[i * 2 + v] = r;
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  geometry.setAttribute('aRand', new THREE.BufferAttribute(rands, 1));
  // The shader places every vertex itself, so the bounds Three would compute are meaningless.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R.boxWidth);

  const material = new THREE.ShaderMaterial({
    name: 'rain',
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    // Rain is water, not neon: it is lit by the city, so it mixes rather than adds.
    blending: THREE.NormalBlending,
    fog: false,
  });

  const mesh = new THREE.LineSegments(geometry, material);
  mesh.name = 'rain';
  mesh.frustumCulled = false;
  // After the world, before nothing in particular: it is transparent and depth-tested.
  mesh.renderOrder = 3;
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;
  mesh.visible = drops > 0;

  function refresh(): void {
    uniforms.uBox.value.set(R.boxWidth, R.boxHeight, R.boxWidth);
    uniforms.uFall.value.set(R.windX, -R.speed, R.windZ);
    uniforms.uLength.value = R.length;
    uniforms.uColor.value.set(R.color);
  }

  return {
    mesh,
    get count() {
      return mesh.visible ? drops : 0;
    },
    refresh,

    update(time: number, flash: number) {
      const intensity = Math.max(0, Math.min(1, R.intensity));
      const opacity = R.opacity * intensity * (1 + flash * ATMOSPHERE.storm.rainLift);
      uniforms.uTime.value = time;
      uniforms.uOpacity.value = opacity;
      mesh.visible = drops > 0 && opacity > 0.002;
    },

    place(camera: THREE.Camera, motionX: number, motionY: number, motionZ: number) {
      const p = camera.position;
      // The box hangs a little above the eye so the ceiling of it is never in frame.
      uniforms.uOrigin.value.set(p.x, p.y + ATMOSPHERE.rain.boxHeight * 0.35, p.z);
      uniforms.uMotion.value.set(
        motionX * ATMOSPHERE.rain.motionTilt,
        motionY * ATMOSPHERE.rain.motionTilt,
        motionZ * ATMOSPHERE.rain.motionTilt,
      );
      mesh.matrixWorld.setPosition(p.x, p.y + ATMOSPHERE.rain.boxHeight * 0.35, p.z);
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
