import * as THREE from 'three';
import { ATMOSPHERE, MOOGUL } from '../../config/tuning';
import { layerAmount } from '../../sim/buho';
import type { AtmosphereVisual } from './env/atmosphere';
import type { MoogulSurface } from './env/moogulSurface';
import type { WallIndex, WallVolume } from './env/builders';
import { FACADE_GRID, FACADE_TILE, FLOOR } from './env/facadeAtlas';
import type { FinishAmounts } from '../post/speedBlur';

/**
 * THE MOOGUL: what the city looks like from inside it.
 *
 * One controller owns the whole experience. It is handed an envelope (0..1, from the rules'
 * clock through `moogulIntensity`) once a frame and turns it into five things, each on its own
 * threshold of the envelope so they arrive one after another rather than all at once
 * (`MOOGUL.layers`):
 *
 *  - THE SKY AND THE AIR. The dome's colours, the fog and the two scene lights are pulled part
 *    of the way towards a pair of moods (violet/turquoise, magenta/amber) that the trip cycles
 *    between over the better part of a minute. Pulled from what the atmosphere wrote THIS
 *    frame, never from a snapshot: a lightning strike still flashes through it, and letting go
 *    is simply not writing any more.
 *  - THE WALLS. Two uniforms on the facade and the graffiti materials (`env/moogulSurface.ts`):
 *    the window grid drifts across the concrete, the tints turn, the paint pulses. Nothing in
 *    the geometry moves and nothing recompiles.
 *  - THE FACES. A pool of `MOOGUL.faces.max` planes stood on real panes of real walls near the
 *    car — the building index says where the walls and their floors are, the atlas says where
 *    a pane sits on a floor — a few centimetres off the glass, depth-tested against everything,
 *    and faded in, held and faded out over several seconds each. They are the one thing here
 *    that is an object rather than a number, and there are never more than four.
 *  - THE LIGHTS. Every light in the frame — lit panes, hairlines, lamps, tail lights, the wet
 *    road under them — grown into a soft halo in a colour that is not quite its own
 *    (`render/post/lightBleed.ts`), widening and reaching further down the brightness range as
 *    the trip deepens. The windows themselves burn a little harder to feed it. This is the one
 *    layer that touches the whole frame rather than its edge, and the reason the city reads as
 *    SOFT rather than merely coloured.
 *  - THE FINISH. A restrained colour separation and a slow swim in the periphery, on the pass
 *    the nitro blur already owns; the middle of the frame — the car, the road — stays exact.
 *
 * SLOW EVERYWHERE. Every modulation inside the envelope is a sine with a period in the tens of
 * seconds; nothing here strobes, flickers or steps. Under `prefers-reduced-motion` the swim is
 * off and the drift and the separation are cut back; the colour, the halo and the faces remain
 * — a diffuse light is not a moving one.
 *
 * LETTING GO. When the envelope falls to zero — naturally, or because the rules cut it short —
 * the shown amount eases down over `stopFadeSeconds`, then the sky re-reads its own config, the
 * lights get their own colours back, the uniforms and the halo go to zero — which is the whole
 * chain in `lightBleed.ts` not running at all — and the faces go dark. Repeating the trip
 * reuses every object; nothing is allocated after construction but the face textures, drawn
 * once, and the halo's three small render targets, kept for the life of the session.
 */
export interface MoogulTripHooks {
  scene: THREE.Scene;
  atmosphere: AtmosphereVisual;
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  surface: MoogulSurface;
  walls: WallIndex;
}

export interface MoogulTrip {
  /**
   * Drive the picture for this frame. `intensity` is the envelope, 0 when there is nothing in
   * the player; called every render frame AFTER `environment.update`, so the sky and the fog
   * it blends from are this frame's.
   */
  update(intensity: number, frameDt: number, carX: number, carZ: number, carHeading: number): void;
  /** Let go now, without the fade: a restart, a teardown. */
  stop(): void;
  /** What the finishing pass should do this frame. One object, rewritten in place. */
  readonly finish: FinishAmounts;
  /** The amount actually on screen (0..1, after the fade), for the debug overlay and QA. */
  readonly shown: number;
  /** How many faces are up. */
  readonly faces: number;
  dispose(): void;
}

/** Wall faces of a box, as the outward normal and the axis. */
const FACES: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Facade styles with no glass to stand a face in. */
const NO_GLASS = new Set(['dark', 'louvre', 'service', 'stripe']);

/** Where a pane sits on its floor (m up from the floor's base): the atlas draws it at 30-70 % of the row, top-down. */
const PANE_CENTRE_Y = FLOOR * 0.5;
const PANE_W = FACADE_TILE / FACADE_GRID.cols;

interface Face {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  active: boolean;
  age: number;
  hold: number;
  /** Where it stands, for the spacing check and the distance cull. */
  x: number;
  z: number;
  peak: number;
}

/** One deterministic-enough generator per controller: which wall, which pane, which face. */
function rng(seed: { s: number }): number {
  let x = seed.s | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  seed.s = x | 0;
  return (x >>> 0) / 4294967296;
}

/**
 * Three ambiguous faces, drawn once into small canvases: a dark shape with two pale glints, a
 * pair of eyes on their own, and someone at the edge of the glass. Soft everywhere, so at a
 * distance they read as a shadow in a lit room and only up close as a face at all.
 */
function makeFaceTextures(): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  if (typeof document === 'undefined') return out;
  const W = 96;
  const H = 128;
  const eye = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, glow: number): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
    g.addColorStop(0, `rgba(255,244,214,${glow})`);
    g.addColorStop(0.35, `rgba(255,230,190,${glow * 0.35})`);
    g.addColorStop(1, 'rgba(255,220,180,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4);
    ctx.fillStyle = `rgba(255,248,230,${Math.min(1, glow + 0.15)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  const shadow = (ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, alpha: number): void => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    g.addColorStop(0, `rgba(4,6,10,${alpha})`);
    g.addColorStop(0.6, `rgba(4,6,10,${alpha * 0.85})`);
    g.addColorStop(1, 'rgba(4,6,10,0)');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  for (let variant = 0; variant < 3; variant++) {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    if (!ctx) continue;
    ctx.clearRect(0, 0, W, H);
    if (variant === 0) {
      // A head and shoulders, dark against the room, eyes catching the light.
      shadow(ctx, W * 0.5, H * 0.42, W * 0.3, H * 0.3, 0.82);
      shadow(ctx, W * 0.5, H * 0.86, W * 0.48, H * 0.26, 0.7);
      eye(ctx, W * 0.4, H * 0.4, 3.2, 0.75);
      eye(ctx, W * 0.6, H * 0.4, 3.2, 0.75);
    } else if (variant === 1) {
      // Only the eyes, and the faintest darkness round them.
      shadow(ctx, W * 0.5, H * 0.45, W * 0.34, H * 0.22, 0.42);
      eye(ctx, W * 0.38, H * 0.45, 2.8, 0.9);
      eye(ctx, W * 0.62, H * 0.45, 2.8, 0.9);
    } else {
      // Someone at the edge of the glass, half out of the frame.
      shadow(ctx, W * 0.86, H * 0.5, W * 0.34, H * 0.34, 0.8);
      shadow(ctx, W * 0.95, H * 0.92, W * 0.4, H * 0.24, 0.65);
      eye(ctx, W * 0.74, H * 0.47, 3, 0.7);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    out.push(tex);
  }
  return out;
}

const TINTS = [0xe8f0ff, 0xffe6c0, 0xd8fff0, 0xf4d8ff];

export function createMoogulTrip(hooks: MoogulTripHooks): MoogulTrip {
  const { scene, atmosphere, hemi, key, surface, walls } = hooks;
  const sky = atmosphere.sky;
  const F = MOOGUL.faces;
  const reduced =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- colours */

  // The moods, and one scratch colour per uniform so no frame allocates.
  const A = MOOGUL.sky.moodA;
  const B = MOOGUL.sky.moodB;
  const mood = {
    zenith: [new THREE.Color(A.zenith), new THREE.Color(B.zenith), new THREE.Color()],
    middle: [new THREE.Color(A.middle), new THREE.Color(B.middle), new THREE.Color()],
    horizon: [new THREE.Color(A.horizon), new THREE.Color(B.horizon), new THREE.Color()],
    cloudDark: [new THREE.Color(A.cloudDark), new THREE.Color(B.cloudDark), new THREE.Color()],
    cloudLight: [new THREE.Color(A.cloudLight), new THREE.Color(B.cloudLight), new THREE.Color()],
    pollution: [new THREE.Color(A.pollution), new THREE.Color(B.pollution), new THREE.Color()],
    fog: [new THREE.Color(A.fog), new THREE.Color(B.fog), new THREE.Color()],
  } as const;
  const base = new THREE.Color();
  // The lights' own colours, which nothing else in the game changes; given back on release.
  const baseHemiSky = hemi.color.clone();
  const baseHemiGround = hemi.groundColor.clone();
  const baseKey = key.color.clone();
  const tintHemiSky = new THREE.Color(MOOGUL.lights.hemiSky);
  const tintHemiGround = new THREE.Color(MOOGUL.lights.hemiGround);
  const tintKey = new THREE.Color(MOOGUL.lights.key);

  /** `base` pulled `amount` of the way to the mood mix, into the uniform. */
  function blendSky(uniform: THREE.Color, config: number, pair: readonly [THREE.Color, THREE.Color, THREE.Color], mix: number, amount: number): void {
    pair[2].copy(pair[0]).lerp(pair[1], mix);
    base.set(config);
    uniform.copy(base).lerp(pair[2], amount);
  }

  /* ---------------------------------------------------------------- faces */

  const textures = makeFaceTextures();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const faces: Face[] = [];
  const group = new THREE.Group();
  group.name = 'moogul-faces';
  for (let i = 0; i < F.max; i++) {
    const material = new THREE.MeshBasicMaterial({
      map: textures[i % Math.max(1, textures.length)] ?? null,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.FrontSide,
      // The room behind is lit glass and the frame is graded already; the face is a shadow
      // with two glints in it, and must not be brightened into a sticker.
      toneMapped: false,
      fog: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `moogul-face-${i}`;
    mesh.renderOrder = 3;
    mesh.visible = false;
    mesh.frustumCulled = true;
    group.add(mesh);
    faces.push({ mesh, material, active: false, age: 0, hold: 0, x: 0, z: 0, peak: 0 });
  }
  scene.add(group);

  const seed = { s: 0x6d2b79f5 };
  const nearby: WallVolume[] = [];
  const normal = new THREE.Vector3();
  const at = new THREE.Vector3();
  let nextFaceIn = 0;

  /**
   * Stand a free face on a real pane of a nearby wall that looks towards the car. Mostly ahead
   * of it — that is where the player is looking — but now and then to the side or behind, so
   * turning round finds one too. False when none was found.
   */
  function spawnFace(face: Face, carX: number, carZ: number, fx: number, fz: number): boolean {
    walls.collect(carX, carZ, F.range, nearby);
    if (nearby.length === 0) return false;
    for (let attempt = 0; attempt < F.attempts; attempt++) {
      const v = nearby[Math.floor(rng(seed) * nearby.length)];
      const [nx, nz] = FACES[Math.floor(rng(seed) * FACES.length)];
      const c = v.chamfer ?? 0;
      // The wall: where it starts (the outline's clockwise start corner, which is where the
      // pane grid begins), which way it runs, and how long it is.
      let sx: number;
      let sz: number;
      let tx: number;
      let tz: number;
      let len: number;
      let wallX: number;
      let wallZ: number;
      if (nx === 1) {
        sx = v.maxX; sz = v.maxZ - c; tx = 0; tz = -1; len = v.maxZ - v.minZ - 2 * c; wallX = v.maxX; wallZ = (v.minZ + v.maxZ) / 2;
      } else if (nx === -1) {
        sx = v.minX; sz = v.minZ + c; tx = 0; tz = 1; len = v.maxZ - v.minZ - 2 * c; wallX = v.minX; wallZ = (v.minZ + v.maxZ) / 2;
      } else if (nz === 1) {
        sx = v.minX + c; sz = v.maxZ; tx = 1; tz = 0; len = v.maxX - v.minX - 2 * c; wallX = (v.minX + v.maxX) / 2; wallZ = v.maxZ;
      } else {
        sx = v.maxX - c; sz = v.minZ; tx = -1; tz = 0; len = v.maxX - v.minX - 2 * c; wallX = (v.minX + v.maxX) / 2; wallZ = v.minZ;
      }
      if (len < PANE_W * 2) continue;
      // Facing the car, or it cannot be seen: the wall's outward normal against the car.
      if ((carX - wallX) * nx + (carZ - wallZ) * nz <= 0) continue;
      // Inside the cone the player is looking down, three times in four.
      const toX = wallX - carX;
      const toZ = wallZ - carZ;
      const toLen = Math.hypot(toX, toZ) || 1;
      if ((toX * fx + toZ * fz) / toLen < F.aheadCos && rng(seed) < F.aheadShare) continue;
      const floors = Math.floor((v.y1 - v.y0) / FLOOR + 1e-6);
      const lo = Math.min(F.minFloor, Math.max(0, floors - 1));
      const hi = Math.min(F.maxFloor, floors - 1);
      if (hi < lo) continue;
      const floor = lo + Math.floor(rng(seed) * (hi - lo + 1));
      const y = v.y0 + floor * FLOOR + PANE_CENTRE_Y;
      // Only where there is glass: the band at that height must be a windowed style.
      if (v.bands) {
        let ok = false;
        for (const bd of v.bands) {
          if (y < bd.y0 || y > bd.y1) continue;
          ok = !NO_GLASS.has(bd.style);
          break;
        }
        if (!ok) continue;
      }
      const cols = Math.floor(len / PANE_W);
      const col = Math.floor(rng(seed) * cols);
      const along = (col + 0.5) * PANE_W;
      const x = sx + tx * along + nx * F.lift;
      const z = sz + tz * along + nz * F.lift;
      const dx = x - carX;
      const dz = z - carZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < F.minDistance * F.minDistance || d2 > F.range * F.range) continue;
      // Not on top of another one.
      let crowded = false;
      for (const other of faces) {
        if (!other.active || other === face) continue;
        const ox = other.x - x;
        const oz = other.z - z;
        if (ox * ox + oz * oz < 16) crowded = true;
      }
      if (crowded) continue;

      const mesh = face.mesh;
      mesh.position.set(x, y, z);
      normal.set(nx, 0, nz);
      at.copy(mesh.position).add(normal);
      mesh.lookAt(at);
      mesh.scale.set(F.width, F.height, 1);
      face.material.map = textures.length > 0 ? textures[Math.floor(rng(seed) * textures.length)] : null;
      face.material.color.set(TINTS[Math.floor(rng(seed) * TINTS.length)]);
      face.material.opacity = 0;
      face.active = true;
      face.age = 0;
      face.hold = F.hold[0] + rng(seed) * (F.hold[1] - F.hold[0]);
      face.peak = F.opacity * (0.75 + rng(seed) * 0.25);
      face.x = x;
      face.z = z;
      mesh.visible = true;
      return true;
    }
    return false;
  }

  function retireFace(face: Face): void {
    face.active = false;
    face.mesh.visible = false;
    face.material.opacity = 0;
  }

  function stepFaces(amount: number, dt: number, carX: number, carZ: number, fx: number, fz: number): void {
    if (amount <= 0) {
      for (const face of faces) if (face.active) retireFace(face);
      nextFaceIn = 0;
      return;
    }
    // The next one comes sooner the deeper in the player is; at the layer's start, rarely. A
    // try that found no pane (open water, the deck overhead, every wall turned away) is asked
    // again shortly rather than after a whole interval, so a bare stretch does not cost the
    // next block its faces.
    nextFaceIn -= dt * amount;
    if (nextFaceIn <= 0) {
      const free = faces.find((face) => !face.active);
      const placed = free ? spawnFace(free, carX, carZ, fx, fz) : false;
      nextFaceIn = placed || !free ? F.interval[0] + rng(seed) * (F.interval[1] - F.interval[0]) : F.retrySeconds;
    }
    for (const face of faces) {
      if (!face.active) continue;
      face.age += dt;
      const total = F.fadeIn + face.hold + F.fadeOut;
      const dx = face.x - carX;
      const dz = face.z - carZ;
      const far = dx * dx + dz * dz > F.range * F.range * 2;
      if (face.age >= total || far) {
        retireFace(face);
        continue;
      }
      let a: number;
      if (face.age < F.fadeIn) a = face.age / F.fadeIn;
      else if (face.age < F.fadeIn + face.hold) a = 1;
      else a = 1 - (face.age - F.fadeIn - face.hold) / F.fadeOut;
      a = a * a * (3 - 2 * a);
      face.material.opacity = a * face.peak * amount;
      // The slightest breath, so it is something in the room and not a poster.
      const breath = 1 + 0.025 * Math.sin(face.age * 1.1);
      face.mesh.scale.set(F.width * breath, F.height * (2 - breath), 1);
    }
  }

  /* ---------------------------------------------------------------- the frame */

  const BLEED = MOOGUL.bleed;
  const finish: FinishAmounts = {
    chroma: 0,
    swim: 0,
    time: 0,
    bleed: {
      amount: 0,
      threshold: BLEED.threshold[0],
      knee: BLEED.knee,
      hue: 0,
      saturation: 1,
      radius: BLEED.radius[0],
      stretch: BLEED.stretch,
      fringe: 0,
      centre: BLEED.centre,
    },
  };
  let shown = 0;
  let tripTime = 0;
  /** True while something has been written that release() must take back. */
  let holding = false;

  function release(): void {
    if (!holding) return;
    holding = false;
    sky.refresh();
    hemi.color.copy(baseHemiSky);
    hemi.groundColor.copy(baseHemiGround);
    key.color.copy(baseKey);
    surface.set(0, 0, 0, 0, 0, 0);
    finish.chroma = 0;
    finish.swim = 0;
    finish.bleed.amount = 0;
    finish.bleed.fringe = 0;
    for (const face of faces) if (face.active) retireFace(face);
    nextFaceIn = 0;
    tripTime = 0;
  }

  return {
    finish,
    get shown() {
      return shown;
    },
    get faces() {
      let n = 0;
      for (const face of faces) if (face.active) n++;
      return n;
    },

    update(intensity, frameDt, carX, carZ, carHeading) {
      const dt = frameDt > 0 ? Math.min(frameDt, 0.1) : 0;
      const target = intensity > 0 ? Math.min(1, intensity) : 0;
      // Rising, the picture follows the envelope exactly (it is already smooth). Falling, it is
      // never allowed to drop faster than the fade — which is what turns a cut into a fade.
      if (target >= shown) shown = target;
      else shown = Math.max(target, shown - dt / Math.max(0.05, MOOGUL.stopFadeSeconds));
      if (shown <= 0) {
        shown = 0;
        release();
        return;
      }
      holding = true;
      tripTime += dt;
      const L = MOOGUL.layers;
      const S = MOOGUL.sky;
      const twoPi = Math.PI * 2;

      /* ------------------------------------------------------------ sky and air */

      const mix = 0.5 + 0.5 * Math.sin((twoPi * tripTime) / S.cyclePeriod);
      const skyAmount = layerAmount(shown, L.sky) * S.blend;
      const u = sky.uniforms;
      blendSky(u.uZenith.value, ATMOSPHERE.zenith, mood.zenith, mix, skyAmount);
      blendSky(u.uMiddle.value, ATMOSPHERE.middle, mood.middle, mix, skyAmount);
      blendSky(u.uHorizon.value, ATMOSPHERE.horizon, mood.horizon, mix, skyAmount);
      blendSky(u.uCloudDark.value, ATMOSPHERE.cloudDark, mood.cloudDark, mix, skyAmount);
      blendSky(u.uCloudLight.value, ATMOSPHERE.cloudLight, mood.cloudLight, mix, skyAmount);
      blendSky(u.uPollutionColor.value, ATMOSPHERE.pollutionColor, mood.pollution, 1 - mix, skyAmount);

      // The fog is blended from what the atmosphere wrote this frame — flash and all — and
      // the dome's copy of it is kept in step, so the skyline and the sky still meet.
      const fogAmount = layerAmount(shown, L.fog) * S.fogBlend;
      const fog = scene.fog;
      if (fog && fogAmount > 0) {
        mood.fog[2].copy(mood.fog[0]).lerp(mood.fog[1], mix);
        fog.color.lerp(mood.fog[2], fogAmount);
        u.uFog.value.copy(fog.color);
      }

      const lightAmount = layerAmount(shown, L.lights) * MOOGUL.lights.blend;
      hemi.color.copy(baseHemiSky).lerp(tintHemiSky, lightAmount);
      hemi.groundColor.copy(baseHemiGround).lerp(tintHemiGround, lightAmount);
      key.color.copy(baseKey).lerp(tintKey, lightAmount);

      /* ------------------------------------------------------------ the walls */

      const breath = 0.8 + 0.2 * Math.sin((twoPi * tripTime) / MOOGUL.surface.breathPeriod);
      const surfaceAmount = layerAmount(shown, L.surface) * breath;
      const paintAmount = layerAmount(shown, L.graffiti);
      surface.set(
        surfaceAmount * MOOGUL.surface.warpPanes * (reduced ? 0.4 : 1),
        surfaceAmount * MOOGUL.surface.hue,
        layerAmount(shown, L.glow) * MOOGUL.surface.glow,
        paintAmount * MOOGUL.surface.hue,
        paintAmount * MOOGUL.surface.pulse,
        tripTime,
      );

      /* ------------------------------------------------------------ the faces */

      // Heading 0 is north (-z), as everywhere in the simulation.
      stepFaces(layerAmount(shown, L.faces), dt, carX, carZ, Math.sin(carHeading), -Math.cos(carHeading));

      /* ------------------------------------------------------------ the finish */

      const chromaAmount = layerAmount(shown, L.chroma) * (0.8 + 0.2 * Math.sin((twoPi * tripTime) / 11));
      finish.chroma = chromaAmount * MOOGUL.post.chroma * (reduced ? 0.5 : 1);
      finish.swim = reduced ? 0 : layerAmount(shown, L.swim) * MOOGUL.post.swim;
      finish.time = (twoPi * tripTime) / MOOGUL.post.swimPeriod;

      // The halo. It comes on with the sky, before anything else is obviously wrong, and it
      // deepens by widening and by asking less of a pixel — so the light creeps outwards from
      // the lamps until the whole city is made of it. Its colour turns on its own slow cycle,
      // independently of the sky's, which is what keeps a halo from ever matching its light.
      const bleedAmount = layerAmount(shown, L.bleed);
      const bleedBreath = 0.82 + 0.18 * Math.sin((twoPi * tripTime) / BLEED.breathPeriod);
      const bleed = finish.bleed;
      bleed.amount = bleedAmount * BLEED.amount * bleedBreath;
      bleed.threshold = BLEED.threshold[0] + (BLEED.threshold[1] - BLEED.threshold[0]) * bleedAmount;
      bleed.radius = BLEED.radius[0] + (BLEED.radius[1] - BLEED.radius[0]) * bleedAmount;
      bleed.hue = BLEED.hue * Math.sin((twoPi * tripTime) / BLEED.huePeriod);
      bleed.saturation = 1 + (BLEED.saturation - 1) * bleedAmount;
      // Read every frame rather than once, so a number changed on the running game
      // (`__rb.buho.config.bleed`) is on screen the next frame like all the others.
      bleed.knee = BLEED.knee;
      bleed.stretch = BLEED.stretch;
      bleed.centre = BLEED.centre;
      // The prismatic split rides the separation's own layer: the halos are diffuse from the
      // start and only come apart into colour late on.
      bleed.fringe = chromaAmount * BLEED.fringe * (reduced ? 0.4 : 1);
    },

    stop() {
      shown = 0;
      release();
    },

    dispose() {
      shown = 0;
      release();
      scene.remove(group);
      group.clear();
      geometry.dispose();
      for (const face of faces) face.material.dispose();
      for (const tex of textures) tex.dispose();
    },
  };
}
