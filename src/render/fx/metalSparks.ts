import * as THREE from 'three';

/**
 * Sparks off metal: what the car throws when it hits something or grinds along a barrier.
 *
 * WHY NOT THE ROUND SPARK POOL. Real grinding sparks are never seen as dots. A fleck of
 * burning steel moves 10-20 m/s and the eye (or a camera shutter) smears it into a thin line,
 * so a spark reads as a STREAK along its own velocity, brightest at the hot head. It is also a
 * temperature, not a colour: it leaves white-yellow, cools through orange, and dies a dull red.
 * And it is heavy enough to fall and skitter: sparks that hit the road bounce low and slide on
 * before going out. All three of those are what sells it; this pool does all three.
 *
 * HOW. One draw call: every spark is a camera-facing quad stretched from its head to where it
 * was a shutter-time ago (`SHUTTER`), built in the vertex shader from two points, so the CPU
 * only integrates a point per spark. The width never drops under about a pixel — a spark
 * thinner than that would shimmer in and out between frames — and a spark widened to meet
 * that floor is dimmed by the same factor, so a distant shower keeps its brightness honest
 * instead of turning into a haze of fat lines.
 *
 * Additive, no fog, no tone mapping: they are light sources, and the city is dark.
 * Everything is allocated once; `spawn` overwrites the oldest spark.
 */
const CAPACITY = 420;
/** Seconds of motion each streak shows: roughly a 1/40 s shutter. */
const SHUTTER = 0.026;
/** Shortest streak (m), so a spark resting on the road still reads as a hot point. */
const MIN_STREAK = 0.02;
const GRAVITY = 9.8;
/** Air drag (1/s). Sparks are tiny and slow down fast, which is what bends their arcs. */
const DRAG = 1.7;
/** What survives a bounce off the road: vertical, then along the road. */
const BOUNCE_UP = 0.28;
const BOUNCE_ALONG = 0.62;
/** Heat a bounce knocks off: the fleck sheds its burning shell on the tarmac. */
const BOUNCE_COOL = 0.12;
/** After this many bounces a spark just slides until it dies. */
const MAX_BOUNCES = 2;

export interface MetalSparks {
  readonly object: THREE.Mesh;
  /**
   * One spark. `floorY` is the road under it, which it bounces on. `heat` 0..1 is how hot it
   * leaves (1 = white), `width` its thickness in metres.
   */
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    heat: number,
    width: number,
    floorY: number,
  ): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
}

const VERTEX = /* glsl */ `
attribute vec3 aHead;
attribute vec3 aTail;
attribute vec2 aCorner;
attribute vec4 aColor;
uniform float uPixel;
varying vec4 vColor;
varying vec2 vCorner;

void main() {
  vec3 h = (modelViewMatrix * vec4(aHead, 1.0)).xyz;
  vec3 t = (modelViewMatrix * vec4(aTail, 1.0)).xyz;
  vec3 d = h - t;
  float len = length(d);
  vec3 dir = len > 1e-5 ? d / len : vec3(0.0, 1.0, 0.0);
  // Across the streak, facing the camera.
  vec3 side = cross(dir, normalize(h + t));
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);

  // Never thinner than ~1.3 px at this depth; pay for the extra width in brightness.
  float depth = max(0.05, -0.5 * (h.z + t.z));
  float minWidth = 1.3 * uPixel * depth;
  float width = max(aColor.a, minWidth);
  float dim = aColor.a / width;

  vec3 p = mix(t, h, aCorner.y);
  // Round the ends out by half a width, so a short streak is a dot and not a sliver.
  p += dir * (aCorner.y * 2.0 - 1.0) * width * 0.5;
  p += side * aCorner.x * width * 0.5;

  vColor = vec4(aColor.rgb * dim, 1.0);
  vCorner = aCorner;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec4 vColor;
varying vec2 vCorner;

void main() {
  // A hot core across the width, and a tail that fades back to the spark's past.
  float across = 1.0 - vCorner.x * vCorner.x;
  float along = 0.25 + 0.75 * vCorner.y * vCorner.y;
  gl_FragColor = vec4(vColor.rgb * across * along, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Colour of steel at `heat` (0..1), times its brightness. Hand-fitted to photos of grinder
 * sparks rather than to a black body: white-hot, a long yellow-orange, a short red death.
 */
function heatColor(heat: number, out: Float32Array, o: number): void {
  let r: number;
  let g: number;
  let b: number;
  if (heat > 0.7) {
    const k = (heat - 0.7) / 0.3;
    r = 1;
    g = 0.72 + 0.23 * k;
    b = 0.3 + 0.45 * k;
  } else if (heat > 0.35) {
    const k = (heat - 0.35) / 0.35;
    r = 1;
    g = 0.26 + 0.46 * k;
    b = 0.03 + 0.27 * k;
  } else {
    const k = heat / 0.35;
    r = 0.6 + 0.4 * k;
    g = 0.05 + 0.21 * k;
    b = 0.005 + 0.025 * k;
  }
  // Brightness falls much faster than the hue shifts: a red spark is a dim one. The hottest
  // overdrive past 1 on purpose, so the head of a fresh spark clips to white.
  const glow = 0.1 + 1.6 * heat * heat + 0.3 * heat;
  out[o] = r * glow;
  out[o + 1] = g * glow;
  out[o + 2] = b * glow;
}

export function createMetalSparks(parent: THREE.Object3D): MetalSparks {
  const verts = CAPACITY * 4;
  const head = new Float32Array(verts * 3);
  const tail = new Float32Array(verts * 3);
  const color = new Float32Array(verts * 4);
  const corner = new Float32Array(verts * 2);
  const index = new Uint16Array(CAPACITY * 6);
  for (let i = 0; i < CAPACITY; i++) {
    const v = i * 4;
    // (side, end): end 0 is the tail, 1 the head.
    corner.set([-1, 0, 1, 0, 1, 1, -1, 1], v * 2);
    index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
  }

  const geometry = new THREE.BufferGeometry();
  const headAttr = new THREE.BufferAttribute(head, 3);
  const tailAttr = new THREE.BufferAttribute(tail, 3);
  const colorAttr = new THREE.BufferAttribute(color, 4);
  headAttr.setUsage(THREE.DynamicDrawUsage);
  tailAttr.setUsage(THREE.DynamicDrawUsage);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aHead', headAttr);
  geometry.setAttribute('aTail', tailAttr);
  geometry.setAttribute('aColor', colorAttr);
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  // Three wants a `position` to count vertices by; the shader never reads it.
  geometry.setAttribute('position', headAttr);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));

  const uniforms = { uPixel: { value: 0.001 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
    // The quad's winding depends on which way the streak crosses the view: never cull it.
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'fx-metal-sparks';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 3;
  // World size of one pixel at unit depth, for the width floor.
  const drawSize = new THREE.Vector2();
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(drawSize);
    const p11 = camera.projectionMatrix.elements[5];
    uniforms.uPixel.value = drawSize.y > 0 && p11 > 0 ? 2 / (p11 * drawSize.y) : 0.001;
  };
  parent.add(mesh);

  // Simulation state.
  const pos = new Float32Array(CAPACITY * 3);
  const vel = new Float32Array(CAPACITY * 3);
  const life = new Float32Array(CAPACITY);
  const invLife = new Float32Array(CAPACITY);
  const heat0 = new Float32Array(CAPACITY);
  const width = new Float32Array(CAPACITY);
  const floor = new Float32Array(CAPACITY);
  const bounces = new Uint8Array(CAPACITY);
  const rgb = new Float32Array(3);

  let next = 0;
  let live = 0;
  let dirty = false;

  function hide(i: number): void {
    const c = i * 16;
    for (let k = 0; k < 16; k++) color[c + k] = 0;
  }

  return {
    object: mesh,
    spawn(x, y, z, vx, vy, vz, lifeSeconds, heat, w, floorY) {
      const i = next;
      next = next + 1 === CAPACITY ? 0 : next + 1;
      const i3 = i * 3;
      pos[i3] = x;
      pos[i3 + 1] = y;
      pos[i3 + 2] = z;
      vel[i3] = vx;
      vel[i3 + 1] = vy;
      vel[i3 + 2] = vz;
      life[i] = lifeSeconds;
      invLife[i] = 1 / lifeSeconds;
      heat0[i] = heat;
      width[i] = w;
      floor[i] = floorY;
      bounces[i] = 0;
      dirty = true;
    },
    update(dt) {
      if (live === 0 && !dirty) return;
      const damp = Math.max(0, 1 - DRAG * dt);
      let alive = 0;
      for (let i = 0; i < CAPACITY; i++) {
        if (life[i] <= 0) continue;
        const remaining = life[i] - dt;
        if (remaining <= 0) {
          life[i] = 0;
          hide(i);
          continue;
        }
        life[i] = remaining;
        const i3 = i * 3;
        let vx = vel[i3] * damp;
        let vy = (vel[i3 + 1] - GRAVITY * dt) * damp;
        let vz = vel[i3 + 2] * damp;
        let x = pos[i3] + vx * dt;
        let y = pos[i3 + 1] + vy * dt;
        let z = pos[i3 + 2] + vz * dt;
        const fy = floor[i] + 0.015;
        if (y < fy) {
          y = fy;
          if (vy < 0) {
            if (bounces[i] < MAX_BOUNCES && vy < -1.2) {
              bounces[i]++;
              vy = -vy * BOUNCE_UP * (0.6 + Math.random() * 0.8);
              heat0[i] *= 1 - BOUNCE_COOL;
            } else {
              vy = 0;
            }
            // Skitter: a bounce throws the fleck a little off its line.
            const kick = (Math.random() - 0.5) * 0.5;
            const ax = vx * BOUNCE_ALONG;
            const az = vz * BOUNCE_ALONG;
            vx = ax - az * kick;
            vz = az + ax * kick;
          }
        }
        pos[i3] = x;
        pos[i3 + 1] = y;
        pos[i3 + 2] = z;
        vel[i3] = vx;
        vel[i3 + 1] = vy;
        vel[i3 + 2] = vz;

        // The streak: head where it is, tail where it was a shutter ago.
        let sx = vx * SHUTTER;
        let sy = vy * SHUTTER;
        let sz = vz * SHUTTER;
        const sl = Math.hypot(sx, sy, sz);
        if (sl < MIN_STREAK) {
          const k = sl > 1e-6 ? MIN_STREAK / sl : 0;
          sx *= k;
          sy = sl > 1e-6 ? sy * k : MIN_STREAK;
          sz *= k;
        }
        const tx = x - sx;
        const ty = Math.max(fy, y - sy);
        const tz = z - sz;

        // Cools as it goes: fast at first, then a long orange glide.
        const t = remaining * invLife[i];
        const heat = heat0[i] * Math.pow(t, 0.7);
        heatColor(heat, rgb, 0);
        // Fade the last sliver of life out so nothing pops off.
        const fade = t < 0.15 ? t / 0.15 : 1;

        const v0 = i * 4;
        for (let k = 0; k < 4; k++) {
          const a = (v0 + k) * 3;
          head[a] = x;
          head[a + 1] = y;
          head[a + 2] = z;
          tail[a] = tx;
          tail[a + 1] = ty;
          tail[a + 2] = tz;
          const c = (v0 + k) * 4;
          color[c] = rgb[0] * fade;
          color[c + 1] = rgb[1] * fade;
          color[c + 2] = rgb[2] * fade;
          color[c + 3] = width[i];
        }
        alive++;
      }
      live = alive;
      headAttr.needsUpdate = true;
      tailAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
      mesh.visible = alive > 0;
      dirty = false;
    },
    reset() {
      life.fill(0);
      color.fill(0);
      colorAttr.needsUpdate = true;
      live = 0;
      next = 0;
      dirty = false;
      mesh.visible = false;
    },
    dispose() {
      parent.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
