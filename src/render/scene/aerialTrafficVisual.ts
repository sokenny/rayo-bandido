import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CityPlan, CityVolume, RibbonDef, ZoneId } from '../../world/cityPlan';
import { createProjection, pointAtStation } from '../../world/track';
import { AERIAL_TRAFFIC } from '../../config/tuning';
import { applyHaze, HAZE } from './env/haze';
import { makeRng } from './env/meshBuilder';

/**
 * AMBIENT AERIAL TRAFFIC: hovercars high over the avenues, a few drones over the pavements.
 *
 * Cosmetic only. Nothing here is simulated, collided, networked or targetable, and nothing in
 * the rules knows it exists. Everything is decided once from the plan and then moved on the
 * frame clock:
 *
 * - CARS fly corridors over the wide ribbons, cut at blocks, tight corners and anything tall
 *   spanning the road (megastructures). Low things over the road (skybridges, billboards) instead
 *   raise the corridor's `floor` a little there, ramped gently both ways, and the cars rise over them — all decided at
 *   build time from the plan. A car's place is analytic, `u0 + speed * (clock - t0)` along its
 *   corridor; near an open corridor's end it is swapped out the moment nobody is looking, or
 *   drawn away into the haze if somebody is. Cars never climb out. Each lane (corridor, direction) has one speed, so the spacing a car was
 *   given when it was placed never closes. Lanes are stacked in altitude by heading and
 *   direction, so corridors that cross at a junction never share a height band.
 * - DRONES shuttle short pavement routes: eased there and back, a pause and a turn at each end,
 *   a little bob. Recycled near the camera when out of view.
 *
 * - LIGHTS carry the mood without a single real light: underglow strips tinted per car out of a
 *   gloomy palette, tail and roof beacons on a staggered double-flash strobe, a share of rigs
 *   with a failing strip, soft additive halos in the wet air, and faint searchlight beams
 *   sweeping under one car in three. All of it is shader time on instanced geometry.
 *
 * Draw calls: two silhouettes of car (body + lights each), a drone (body + lights), the halos,
 * the beams, and on `high` one faint cone under the nearest drone — nine at most, on fixed-size
 * InstancedMeshes whose unused slots are zero-scaled. No lights, no shadows, not on the wet-road
 * mirror layer.
 */
export interface AerialTrafficVisual {
  root: THREE.Group;
  update(frameDt: number, camera: THREE.Camera): void;
  /** Hide and freeze the lot (for A/B captures). */
  enabled: boolean;
  stats(): AerialTrafficStats;
  dispose(): void;
}

export interface AerialTrafficStats {
  corridors: number;
  sites: number;
  cars: number;
  carsDrawn: number;
  carsInView: number;
  drones: number;
  dronesDrawn: number;
  dronesInView: number;
  cone: boolean;
  drawCalls: number;
}

type Quality = 'low' | 'medium' | 'high';

const T = AERIAL_TRAFFIC;
/** Resampling step along a corridor (m). */
const STEP = 5;
/** Lanes per corridor are stacked in four bands: two headings x two directions. */
const BANDS = 4;
/** Metres before an open corridor's end over which a car still in view is drawn away into the haze. */
const END_FADE = 70;
/** Seconds out of view before a car or drone near the camera is handed a better spot. */
const CAR_LINGER = 4;
const DRONE_LINGER = 3;
/** Culling sphere radii (m). */
const CAR_RADIUS = 8;
const DRONE_RADIUS = 1.5;
/** Share of the draw distance where scaling in begins: born out past it, a thing grows in, never pops. */
const CAR_FADE = 0.8;
const DRONE_FADE = 0.6;
/** Share of the draw distance past which a car or drone may be born in view (already half shrunk). */
const CAR_RIM = 0.9;
const DRONE_RIM = 0.78;

interface Corridor {
  xz: Float32Array;
  /** Least altitude (m) per sample: 0 in open sky, ramped up over whatever spans the road. */
  floor: Float32Array;
  /** Samples; the corridor is `(n - 1) * STEP` long (closed: `n * STEP`). */
  n: number;
  length: number;
  closed: boolean;
  /** 0 when it runs mostly along X, 1 along Z: picks its altitude bands. */
  axis: number;
  /** Per-direction lane speed multiplier. */
  speedMul: [number, number];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface CarSlot {
  active: boolean;
  corridor: Corridor | null;
  dir: number;
  u0: number;
  t0: number;
  speed: number;
  alt: number;
  lateral: number;
  hidden: number;
  /** Current travel coordinate (m), for lane spacing. */
  u: number;
  variant: number;
  index: number;
}

interface DroneSlot {
  active: boolean;
  site: number;
  t0: number;
  travel: number;
  pause: number;
  alt: number;
  seed: number;
  hidden: number;
  x: number;
  z: number;
}

export function createAerialTraffic(plan: CityPlan, quality: Quality): AerialTrafficVisual | null {
  const rng = makeRng(0xae71a1);
  const { blocked, ceiling } = makeObstacles(plan);
  const corridors = planCorridors(plan, ceiling, rng);
  const sites = planDroneSites(plan, blocked, rng);
  const carCount = corridors.length > 0 ? T.cars[quality] : 0;
  const droneCount = sites.length > 0 ? T.drones[quality] : 0;
  if (carCount === 0 && droneCount === 0) return null;

  const root = new THREE.Group();
  root.name = 'aerial-traffic';
  root.userData.probeIgnore = true;

  /* ------------------------------------------------------------ materials */

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.45, metalness: 0.55 });
  applyHaze(bodyMat);
  // The frame clock and the strobe settings, shared by every light shader here.
  const uTime = { value: 0 };
  const uStrobeRate = { value: T.strobeRate };
  const uTiredShare = { value: T.tiredShare };
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  glowMat.color.setScalar(T.lightIntensity);
  glowMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uStrobeRate = uStrobeRate;
    shader.uniforms.uTiredShare = uTiredShare;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aTint;\nattribute float aBlink;\nattribute float aPhase;\nuniform float uTime;\nuniform float uStrobeRate;\nuniform float uTiredShare;\n${STROBE_GLSL}`)
      .replace('#include <color_vertex>', GLOW_COLOR_VERTEX);
  };
  glowMat.customProgramCacheKey = () => 'rb-aerial-glow';
  // After the patch above: the haze composes with it.
  applyHaze(glowMat, { strength: HAZE.neonStrength, lightKeep: HAZE.neonLightKeep });

  const additive = (vertexShader: string, fragmentShader: string, side: THREE.Side): THREE.ShaderMaterial => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime, uStrobeRate },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side,
      fog: true,
    });
    applyHaze(mat, { strength: HAZE.glowStrength, additive: true });
    return mat;
  };
  const haloMat = additive(HALO_VERTEX, HALO_FRAGMENT, THREE.FrontSide);
  const beamMat = additive(BEAM_VERTEX, BEAM_FRAGMENT, THREE.DoubleSide);
  const owned: Array<THREE.BufferGeometry | THREE.Material> = [bodyMat, glowMat, haloMat, beamMat];

  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number, name: string, colors: boolean): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    mesh.name = name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, ZERO);
    if (colors) {
      for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, WHITE);
    }
    // Instances span the whole map: bounds would have to be recomputed every frame to be right,
    // and the unused slots are zero-scaled anyway, so the mesh is simply never frustum-culled.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    owned.push(geo);
    root.add(mesh);
    return mesh;
  };

  /** A fixed per-slot phase on a light mesh: its strobe offset, and whether its strip is tired. */
  const phased = (mesh: THREE.InstancedMesh | null, phases: Float32Array): void => {
    if (mesh) mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  };

  const perVariant = [Math.ceil(carCount / 2), Math.floor(carCount / 2)];
  const carBodies = [carCount > 0 ? instanced(coupeBody(), bodyMat, perVariant[0], 'aerial-car-a', true) : null, perVariant[1] > 0 ? instanced(wedgeBody(), bodyMat, perVariant[1], 'aerial-car-b', true) : null];
  const carGlows = [carCount > 0 ? instanced(coupeGlow(), glowMat, perVariant[0], 'aerial-car-a-lights', true) : null, perVariant[1] > 0 ? instanced(wedgeGlow(), glowMat, perVariant[1], 'aerial-car-b-lights', true) : null];
  const droneBody = droneCount > 0 ? instanced(droneBodyGeometry(), bodyMat, droneCount, 'aerial-drones', true) : null;
  const droneGlow = droneCount > 0 ? instanced(droneGlowGeometry(), glowMat, droneCount, 'aerial-drone-lights', false) : null;
  const carPhase = new Float32Array(carCount);
  for (let i = 0; i < carCount; i++) carPhase[i] = rng();
  const variantPhases = [new Float32Array(Math.max(1, perVariant[0])), new Float32Array(Math.max(1, perVariant[1]))];
  for (let i = 0; i < carCount; i++) variantPhases[i % 2][(i - (i % 2)) / 2] = carPhase[i];
  phased(carGlows[0], variantPhases[0]);
  phased(carGlows[1], variantPhases[1]);
  const dronePhase = new Float32Array(Math.max(1, droneCount));
  // Drones never carry a tired strip (they have none): keep them under the tired share.
  for (let i = 0; i < droneCount; i++) dronePhase[i] = rng() * (1 - T.tiredShare);
  phased(droneGlow, dronePhase);

  // Halos: per car an underglow and a tail strobe, per drone a belly light. One draw call.
  const haloCount = carCount * 2 + droneCount;
  const haloGeo = new THREE.PlaneGeometry(2, 2);
  haloGeo.deleteAttribute('normal');
  haloGeo.deleteAttribute('uv');
  const halos = instanced(haloGeo, haloMat, haloCount, 'aerial-halos', true);
  halos.renderOrder = 3;
  const haloAttr = new Float32Array(Math.max(1, haloCount) * 2);
  for (let i = 0; i < carCount; i++) {
    // Tired rigs' underglow sags and swells; the rest hold steady.
    haloAttr[i * 4] = carPhase[i] > 1 - T.tiredShare ? 2 : 0;
    haloAttr[i * 4 + 1] = carPhase[i];
    haloAttr[i * 4 + 2] = 1;
    haloAttr[i * 4 + 3] = carPhase[i];
  }
  for (let j = 0; j < droneCount; j++) {
    haloAttr[(carCount * 2 + j) * 2] = 0;
    haloAttr[(carCount * 2 + j) * 2 + 1] = dronePhase[j];
  }
  haloGeo.setAttribute('aHalo', new THREE.InstancedBufferAttribute(haloAttr, 2));
  for (let j = 0; j < droneCount; j++) halos.setColorAt(carCount * 2 + j, new THREE.Color(CYAN).multiplyScalar(T.halo.intensity * 0.8));

  // Searchlight beams under one car in `every`; none on low.
  const beamCount = quality === 'low' || carCount === 0 ? 0 : Math.ceil(carCount / T.beam.every);
  let beams: THREE.InstancedMesh | null = null;
  if (beamCount > 0) {
    const beamGeo = new THREE.CylinderGeometry(0.35, T.beam.radius, 1, 14, 1, true);
    // Top at the car, hanging one unit down; the instance's Y scale is the beam's length.
    beamGeo.translate(0, -0.5, 0);
    beams = instanced(beamGeo, beamMat, beamCount, 'aerial-beams', true);
    beams.renderOrder = 2;
  }

  let cone: THREE.Mesh | null = null;
  let coneMat: THREE.MeshBasicMaterial | null = null;
  if (droneCount > 0 && quality === 'high' && T.cone.enabled) {
    const coneGeo = new THREE.ConeGeometry(T.cone.radius, T.cone.length, 10, 1, true);
    // Apex at the drone, opening downward.
    coneGeo.translate(0, -T.cone.length / 2, 0);
    coneMat = new THREE.MeshBasicMaterial({ color: 0x3ff0e8, transparent: true, opacity: T.cone.opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    applyHaze(coneMat, { strength: HAZE.glowStrength, additive: true });
    cone = new THREE.Mesh(coneGeo, coneMat);
    cone.name = 'aerial-drone-cone';
    cone.frustumCulled = false;
    cone.matrixAutoUpdate = false;
    cone.visible = false;
    cone.renderOrder = 2;
    owned.push(coneGeo, coneMat);
    root.add(cone);
  }

  /* ------------------------------------------------------------ state */

  const cars: CarSlot[] = [];
  for (let i = 0; i < carCount; i++) {
    const variant = i % 2;
    cars.push({ active: false, corridor: null, dir: 1, u0: 0, t0: 0, speed: 0, alt: 0, lateral: 0, hidden: 0, u: 0, variant, index: (i - variant) / 2 });
  }
  const drones: DroneSlot[] = [];
  for (let i = 0; i < droneCount; i++) drones.push({ active: false, site: -1, t0: 0, travel: 1, pause: 1, alt: 6, seed: rng() * 100, hidden: 0, x: 0, z: 0 });

  let clock = 0;
  let enabled = true;
  let first = true;
  let camX = 0;
  let camZ = 0;
  let camY = 0;
  const frustum = new THREE.Frustum();
  const sphere = new THREE.Sphere();
  const projView = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  const hm = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  const probe = { x: 0, z: 0 };
  const stat: AerialTrafficStats = { corridors: corridors.length, sites: sites.length / SITE, cars: carCount, carsDrawn: 0, carsInView: 0, drones: droneCount, dronesDrawn: 0, dronesInView: 0, cone: false, drawCalls: 0 };

  const inView = (x: number, y: number, z: number, r: number): boolean => {
    sphere.center.set(x, y, z);
    sphere.radius = r;
    return frustum.intersectsSphere(sphere);
  };

  /* ------------------------------------------------------------ cars */

  /** Centreline at station `s` of `c` into `probe`; extrapolated past an open corridor's ends. */
  const at = (c: Corridor, s: number): void => {
    const xz = c.xz;
    if (c.closed) {
      s = ((s % c.length) + c.length) % c.length;
      const f = s / STEP;
      const i = Math.floor(f);
      const j = (i + 1) % c.n;
      const t = f - i;
      probe.x = xz[i * 2] + (xz[j * 2] - xz[i * 2]) * t;
      probe.z = xz[i * 2 + 1] + (xz[j * 2 + 1] - xz[i * 2 + 1]) * t;
      return;
    }
    const last = c.n - 1;
    if (s <= 0 || s >= c.length) {
      const a = s <= 0 ? 0 : last;
      const b = s <= 0 ? 1 : last - 1;
      const over = s <= 0 ? -s : s - c.length;
      probe.x = xz[a * 2] + ((xz[a * 2] - xz[b * 2]) / STEP) * over;
      probe.z = xz[a * 2 + 1] + ((xz[a * 2 + 1] - xz[b * 2 + 1]) / STEP) * over;
      return;
    }
    const f = s / STEP;
    const i = Math.min(last - 1, Math.floor(f));
    const t = f - i;
    probe.x = xz[i * 2] + (xz[i * 2 + 2] - xz[i * 2]) * t;
    probe.z = xz[i * 2 + 1] + (xz[i * 2 + 3] - xz[i * 2 + 1]) * t;
  };

  const altitudeAt = (car: CarSlot, u: number): number => {
    const c = car.corridor!;
    const s = car.dir > 0 ? u : c.length - u;
    // The lane's own height, or the hop's where something spans the road.
    let f = s / STEP;
    let i: number;
    let j: number;
    if (c.closed) {
      f = ((f % c.n) + c.n) % c.n;
      i = Math.floor(f);
      j = (i + 1) % c.n;
    } else {
      f = clamp(f, 0, c.n - 1);
      i = Math.min(c.n - 2, Math.floor(f));
      j = i + 1;
    }
    return smax(car.alt, c.floor[i] + (c.floor[j] - c.floor[i]) * (f - i), 14);
  };

  /** Pose of `car` at travel coordinate `u` (0 at its entry end) into `pose`. */
  const carPose = (car: CarSlot, u: number): void => {
    const c = car.corridor!;
    const d = car.dir;
    const s = d > 0 ? u : c.length - u;
    // Heading off a 16 m chord and the bank off the turn across 40 m: both smooth by construction.
    at(c, s - 8 * d);
    const bx = probe.x;
    const bz = probe.z;
    at(c, s + 8 * d);
    const fx = probe.x - bx;
    const fz = probe.z - bz;
    const yaw = Math.atan2(fx, fz);
    at(c, s - 20 * d);
    const px = probe.x;
    const pz = probe.z;
    at(c, s + 20 * d);
    let turn = Math.atan2(probe.x - px, probe.z - pz) - yaw;
    at(c, s);
    const len = Math.hypot(fx, fz) || 1;
    // Right of travel is (-fz, fx) in this frame's convention (see `offsetAtStation`).
    pose.x = probe.x + (-fz / len) * car.lateral;
    pose.z = probe.z + (fx / len) * car.lateral;
    pose.y = altitudeAt(car, u);
    const dy = altitudeAt(car, u + 4) - altitudeAt(car, u - 4);
    pose.yaw = yaw;
    pose.pitch = -Math.atan2(dy, 8) * 0.8;
    // Fold the two chords' angle difference into -pi..pi, then lean into it.
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    pose.roll = clamp(-turn * 0.9, -0.3, 0.3);
  };

  const laneFree = (car: CarSlot, c: Corridor, dir: number, u: number): boolean => {
    for (const o of cars) {
      if (o === car || !o.active || o.corridor !== c || o.dir !== dir) continue;
      let gap = Math.abs(o.u - u);
      if (c.closed) gap = Math.min(gap, c.length - gap);
      if (gap < T.carSpacing) return false;
    }
    return true;
  };

  const spawnCar = (car: CarSlot, allowVisible: boolean): boolean => {
    const reach = T.carDrawDistance * 0.99;
    const rim = T.carDrawDistance * CAR_RIM;
    const bandH = (T.carAltitude[1] - T.carAltitude[0]) / BANDS;
    for (let attempt = 0; attempt < 30; attempt++) {
      const c = corridors[Math.floor(rng() * corridors.length)];
      if (camX < c.minX - reach || camX > c.maxX + reach || camZ < c.minZ - reach || camZ > c.maxZ + reach) continue;
      const dir = rng() < 0.5 ? 1 : -1;
      const di = dir > 0 ? 0 : 1;
      // Clear of the end it flies toward, so a car is never born already fading out.
      const margin = c.closed ? 0 : END_FADE * 2.5;
      if (!c.closed && c.length < margin + 40) continue;
      // Walk the corridor from a random sample to a station within reach: out at the rim on the
      // even tries (where a car may be born in view, still scaled nearly to nothing), anywhere on
      // the odd ones.
      const rimTry = attempt % 2 === 0;
      const from = Math.floor(rng() * c.n);
      let s = -1;
      for (let k = 0; k < c.n; k += 2) {
        const i = (from + k) % c.n;
        const d2 = (c.xz[i * 2] - camX) ** 2 + (c.xz[i * 2 + 1] - camZ) ** 2;
        if (d2 > reach * reach || (rimTry && d2 < rim * rim)) continue;
        s = i * STEP;
        break;
      }
      if (s < 0) continue;
      const u = dir > 0 ? s : c.length - s;
      if (!c.closed && (u < 10 || u > c.length - margin)) continue;
      car.corridor = c;
      car.dir = dir;
      car.alt = T.carAltitude[0] + (c.axis * 2 + di + 0.2 + rng() * 0.6) * bandH;
      car.lateral = 1 + rng() * 0.8;
      car.speed = T.carSpeed * c.speedMul[di];
      if (!laneFree(car, c, dir, u)) continue;
      carPose(car, u);
      const dx = pose.x - camX;
      const dz = pose.z - camZ;
      const d2 = dx * dx + dz * dz;
      if (d2 > reach * reach) continue;
      const seen = inView(pose.x, pose.y, pose.z, CAR_RADIUS);
      if (seen && !allowVisible && d2 < rim * rim) continue;
      // Prefer a spot in view at the rim, or one the car flies INTO view from within 12 s.
      let good = seen;
      for (let ahead = 4; ahead <= 12 && !good; ahead += 4) {
        carPose(car, u + car.speed * ahead);
        const fx = pose.x - camX;
        const fz = pose.z - camZ;
        good = fx * fx + fz * fz < reach * reach && inView(pose.x, pose.y, pose.z, CAR_RADIUS);
      }
      if (!good && attempt < 22) continue;
      car.active = true;
      car.u0 = u;
      car.u = u;
      car.t0 = clock;
      car.hidden = 0;
      // A few dark paints, mostly near-black, and an underglow out of the gloomy palette.
      const body = carBodies[car.variant]!;
      body.setColorAt(car.index, col.setHex(PAINTS[Math.floor(rng() * PAINTS.length)]));
      body.instanceColor!.needsUpdate = true;
      const tint = STRIP_TINTS[Math.floor(rng() * STRIP_TINTS.length)];
      const glow = carGlows[car.variant]!;
      glow.setColorAt(car.index, col.setHex(tint));
      glow.instanceColor!.needsUpdate = true;
      const slot = car.index * 2 + car.variant;
      halos.setColorAt(slot * 2, col.setHex(tint).multiplyScalar(T.halo.intensity));
      halos.setColorAt(slot * 2 + 1, col.setHex(RED).multiplyScalar(T.halo.intensity * 1.8));
      halos.instanceColor!.needsUpdate = true;
      if (beams && slot % T.beam.every === 0) {
        // Beams run paler than the strip: light in rain, not paint.
        beams.setColorAt(slot / T.beam.every, col.setHex(tint).lerp(WHITE, 0.45).multiplyScalar(T.beam.intensity));
        beams.instanceColor!.needsUpdate = true;
      }
      return true;
    }
    car.active = false;
    return false;
  };

  /** A halo of `size` metres at car-local (lx, ly, lz) under the transform in `m`, widened with distance. */
  const writeHalo = (i: number, lx: number, ly: number, lz: number, size: number): void => {
    pos.set(lx, ly, lz).applyMatrix4(m);
    // Far off, a light blooms wider in the wet air than the rig that carries it.
    const d = Math.hypot(pos.x - camX, pos.y - camY, pos.z - camZ);
    const s = size * (1 + T.halo.farGrow * clamp((d - 60) / 300, 0, 1));
    hm.makeScale(s, s, s).setPosition(pos);
    halos.setMatrixAt(i, hm);
  };

  const writeCar = (car: CarSlot, scale: number, dist: number, seed: number): void => {
    e.set(pose.pitch, pose.yaw, pose.roll, 'YXZ');
    q.setFromEuler(e);
    pos.set(pose.x, pose.y, pose.z);
    scl.setScalar(scale);
    m.compose(pos, q, scl);
    carBodies[car.variant]!.setMatrixAt(car.index, m);
    carGlows[car.variant]!.setMatrixAt(car.index, m);
    const slot = car.index * 2 + car.variant;
    writeHalo(slot * 2, 0, -0.62 * CAR_SCALE, -0.2 * CAR_SCALE, T.halo.underSize * scale);
    if (car.variant === 0) writeHalo(slot * 2 + 1, 0, 0.1 * CAR_SCALE, -2.45 * CAR_SCALE, T.halo.strobeSize * scale);
    else writeHalo(slot * 2 + 1, 0, 0.7 * CAR_SCALE, -2.4 * CAR_SCALE, T.halo.strobeSize * scale);
    if (beams && slot % T.beam.every === 0) {
      const b = slot / T.beam.every;
      if (dist > T.beam.distance) {
        beams.setMatrixAt(b, ZERO);
      } else {
        // Hangs from the belly, sweeping slowly about the car's heading, never quite plumb.
        pos.set(0, -0.3 * CAR_SCALE, 0).applyMatrix4(m);
        const sweep = T.beam.sweep;
        e.set(sweep * Math.sin(clock * 0.43 + seed * 20), pose.yaw, sweep * 0.7 * Math.cos(clock * 0.31 + seed * 13), 'YXZ');
        q.setFromEuler(e);
        const fade = scale * clamp((T.beam.distance - dist) / 60, 0, 1);
        scl.set(fade, T.beam.length * fade, fade);
        hm.compose(pos, q, scl);
        beams.setMatrixAt(b, hm);
      }
    }
  };

  const hideCar = (car: CarSlot): void => {
    carBodies[car.variant]!.setMatrixAt(car.index, ZERO);
    carGlows[car.variant]!.setMatrixAt(car.index, ZERO);
    const slot = car.index * 2 + car.variant;
    halos.setMatrixAt(slot * 2, ZERO);
    halos.setMatrixAt(slot * 2 + 1, ZERO);
    if (beams && slot % T.beam.every === 0) beams.setMatrixAt(slot / T.beam.every, ZERO);
  };

  /* ------------------------------------------------------------ drones */

  const dronePose = (d: DroneSlot): void => {
    const o = d.site * SITE;
    const ax = sites[o];
    const az = sites[o + 1];
    const bx = sites[o + 2];
    const bz = sites[o + 3];
    const yawAB = Math.atan2(bx - ax, bz - az);
    const cycle = 2 * (d.travel + d.pause);
    let tau = (clock - d.t0) % cycle;
    let from = 0;
    let to = 1;
    let yaw = yawAB;
    let speed = 0;
    if (tau >= d.travel + d.pause) {
      tau -= d.travel + d.pause;
      from = 1;
      to = 0;
      yaw = yawAB + Math.PI;
    }
    let f: number;
    if (tau < d.travel) {
      const k = tau / d.travel;
      f = from + (to - from) * smooth(k);
      // Derivative of smoothstep, normalised to 1 at mid-route.
      speed = 4 * k * (1 - k);
    } else {
      // Paused at the far end: a slow turn round to face home.
      f = to;
      yaw += Math.PI * smooth((tau - d.travel) / d.pause);
    }
    const bob = Math.sin(clock * 1.9 + d.seed) * 0.14 + Math.sin(clock * 3.3 + d.seed * 1.7) * 0.05;
    pose.x = ax + (bx - ax) * f;
    pose.z = az + (bz - az) * f;
    pose.y = d.alt + bob;
    pose.yaw = yaw;
    pose.pitch = 0.14 * speed + Math.sin(clock * 2.3 + d.seed) * 0.02;
    pose.roll = Math.sin(clock * 1.7 + d.seed * 2.3) * 0.035;
  };

  const spawnDrone = (d: DroneSlot, allowVisible: boolean): boolean => {
    const count = sites.length / SITE;
    const start = Math.floor(rng() * count);
    const far = T.droneDrawDistance * 0.97;
    const rim = T.droneDrawDistance * DRONE_RIM;
    // Full scans from a random start: the first good site wins. Sites are a flat array, so this
    // is a straight read and it only runs when a drone is actually being re-homed. Pass 0 wants a
    // route in view out at the rim (still scaled nearly to nothing, so it grows in as the car
    // closes on it); pass 1 settles for one just out of view.
    for (let k = 0; k < count * 2; k++) {
      const pass = k < count ? 0 : 1;
      const i = (start + k) % count;
      const o = i * SITE;
      const mx = (sites[o] + sites[o + 2]) / 2;
      const mz = (sites[o + 1] + sites[o + 3]) / 2;
      const dx = mx - camX;
      const dz = mz - camZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < 20 * 20 || d2 > far * far) continue;
      let taken = false;
      for (const other of drones) {
        if (other === d || !other.active) continue;
        if (other.site === i || (other.x - mx) ** 2 + (other.z - mz) ** 2 < 30 * 30) taken = true;
      }
      if (taken) continue;
      if (!allowVisible) {
        const seen = inView(mx, sites[o + 4], mz, Math.hypot(sites[o + 2] - sites[o], sites[o + 3] - sites[o + 1]) / 2 + 2);
        if (seen !== (pass === 0)) continue;
        if (seen) {
          const ax = sites[o] - camX;
          const az = sites[o + 1] - camZ;
          const bx = sites[o + 2] - camX;
          const bz = sites[o + 3] - camZ;
          if (ax * ax + az * az < rim * rim || bx * bx + bz * bz < rim * rim) continue;
        }
      }
      const len = Math.hypot(sites[o + 2] - sites[o], sites[o + 3] - sites[o + 1]);
      d.site = i;
      d.alt = sites[o + 4];
      d.travel = (len / T.droneSpeed) * 1.4;
      d.pause = lerp(T.dronePause[0], T.dronePause[1], rng());
      d.t0 = clock - rng() * 2 * (d.travel + d.pause);
      d.hidden = 0;
      d.active = true;
      d.x = mx;
      d.z = mz;
      droneBody!.setColorAt(drones.indexOf(d), col.setHex(DRONE_PAINTS[Math.floor(rng() * DRONE_PAINTS.length)]));
      droneBody!.instanceColor!.needsUpdate = true;
      return true;
    }
    d.active = false;
    return false;
  };

  const writeDrone = (i: number, scale: number): void => {
    e.set(pose.pitch, pose.yaw, pose.roll, 'YXZ');
    q.setFromEuler(e);
    pos.set(pose.x, pose.y, pose.z);
    scl.setScalar(scale);
    m.compose(pos, q, scl);
    droneBody!.setMatrixAt(i, m);
    droneGlow!.setMatrixAt(i, m);
    writeHalo(carCount * 2 + i, 0, -0.1 * DRONE_SCALE, 0, T.halo.droneSize * scale);
  };

  const hideDrone = (i: number): void => {
    droneBody!.setMatrixAt(i, ZERO);
    droneGlow!.setMatrixAt(i, ZERO);
    halos.setMatrixAt(carCount * 2 + i, ZERO);
  };

  /* ------------------------------------------------------------ frame */

  return {
    root,
    get enabled() {
      return enabled;
    },
    set enabled(v: boolean) {
      enabled = v;
      root.visible = v;
    },
    update(frameDt, camera) {
      if (!enabled) return;
      clock += Math.min(frameDt, 0.1);
      uTime.value = clock;
      camX = camera.position.x;
      camY = camera.position.y;
      camZ = camera.position.z;
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      // Only one re-home per frame per kind, so a teleport refills over a few frames, not in one.
      let carSpawned = false;
      let droneSpawned = false;

      let drawn = 0;
      let seen = 0;
      const carFade = T.carDrawDistance * CAR_FADE;
      for (const car of cars) {
        if (!car.active) {
          if (!carSpawned) {
            carSpawned = true;
            // Held back while the view already carries its share (`maxCarsInView`).
            if (stat.carsInView >= T.maxCarsInView || !spawnCar(car, first)) continue;
          } else continue;
        }
        const c = car.corridor!;
        let u = car.u0 + car.speed * (clock - car.t0);
        if (c.closed) u %= c.length;
        car.u = u;
        carPose(car, u);
        const dx = pose.x - camX;
        const dz = pose.z - camZ;
        const dist = Math.sqrt(dx * dx + dz * dz + (pose.y - camY) * (pose.y - camY));
        const visible = inView(pose.x, pose.y, pose.z, CAR_RADIUS);
        car.hidden = visible && dist < T.carDrawDistance ? 0 : car.hidden + frameDt;
        // Near an open corridor's end: handed a new corridor the moment nobody is looking, and
        // otherwise drawn away into the haze over the last stretch rather than climbing out.
        const toEnd = c.closed ? Infinity : c.length - u;
        const lost = dist > T.carDrawDistance * 1.3 || (car.hidden > CAR_LINGER && dist > 120) || (toEnd < END_FADE * 2 && car.hidden > 0);
        if (toEnd <= 0 || lost) {
          car.active = false;
          hideCar(car);
          continue;
        }
        if (dist >= T.carDrawDistance) {
          hideCar(car);
          continue;
        }
        // Far cars grow a little so their lights stay a pixel or two wide instead of shimmering out.
        const grow = 1 + T.carFarScale * clamp((dist - 100) / 300, 0, 1);
        const endFade = smooth(toEnd / END_FADE);
        writeCar(car, grow * endFade * (dist > carFade ? (T.carDrawDistance - dist) / (T.carDrawDistance - carFade) : 1), dist, carPhase[car.index * 2 + car.variant]);
        drawn++;
        if (visible) seen++;
      }
      stat.carsDrawn = drawn;
      stat.carsInView = seen;

      drawn = 0;
      seen = 0;
      let nearest = -1;
      let nearestD = T.cone.maxDistance;
      const droneFade = T.droneDrawDistance * DRONE_FADE;
      for (let i = 0; i < drones.length; i++) {
        const d = drones[i];
        if (!d.active) {
          const spawned = !droneSpawned && stat.dronesInView < T.maxDronesInView && spawnDrone(d, first);
          droneSpawned = true;
          if (!spawned) {
            hideDrone(i);
            continue;
          }
        }
        dronePose(d);
        const dx = pose.x - camX;
        const dz = pose.z - camZ;
        const dist = Math.sqrt(dx * dx + dz * dz + (pose.y - camY) * (pose.y - camY));
        const visible = inView(pose.x, pose.y, pose.z, DRONE_RADIUS);
        d.hidden = visible && dist < T.droneDrawDistance ? 0 : d.hidden + frameDt;
        if (dist > T.droneDrawDistance * 1.15 || (d.hidden > DRONE_LINGER && dist > 45)) {
          d.active = false;
          hideDrone(i);
          continue;
        }
        if (dist >= T.droneDrawDistance) {
          hideDrone(i);
          continue;
        }
        writeDrone(i, dist > droneFade ? (T.droneDrawDistance - dist) / (T.droneDrawDistance - droneFade) : 1);
        drawn++;
        if (visible) {
          seen++;
          if (dist < nearestD) {
            nearestD = dist;
            nearest = i;
          }
        }
      }
      stat.dronesDrawn = drawn;
      stat.dronesInView = seen;
      first = false;

      let calls = 0;
      for (let v = 0; v < 2; v++) {
        const body = carBodies[v];
        const glow = carGlows[v];
        if (!body || !glow) continue;
        body.instanceMatrix.needsUpdate = true;
        glow.instanceMatrix.needsUpdate = true;
        let any = false;
        for (const car of cars) if (car.variant === v && car.active) any = true;
        body.visible = glow.visible = any;
        if (any) calls += 2;
      }
      if (droneBody && droneGlow) {
        droneBody.instanceMatrix.needsUpdate = true;
        droneGlow.instanceMatrix.needsUpdate = true;
        droneBody.visible = droneGlow.visible = stat.dronesDrawn > 0;
        if (stat.dronesDrawn > 0) calls += 2;
      }
      halos.instanceMatrix.needsUpdate = true;
      halos.visible = stat.carsDrawn + stat.dronesDrawn > 0;
      if (halos.visible) calls++;
      if (beams) {
        beams.instanceMatrix.needsUpdate = true;
        beams.visible = stat.carsDrawn > 0;
        if (beams.visible) calls++;
      }
      if (cone && coneMat) {
        cone.visible = nearest >= 0;
        if (nearest >= 0) {
          dronePose(drones[nearest]);
          m.makeTranslation(pose.x, pose.y - 0.12, pose.z);
          cone.matrix.copy(m);
          cone.matrixWorldNeedsUpdate = true;
          // Fades out with distance; strongest right under the camera's nose.
          coneMat.opacity = T.cone.opacity * (1 - nearestD / T.cone.maxDistance);
          calls++;
        }
        stat.cone = cone.visible;
      }
      stat.drawCalls = calls;
    },
    stats() {
      return { ...stat };
    },
    dispose() {
      root.removeFromParent();
      for (const o of owned) o.dispose();
      for (const mesh of [...carBodies, ...carGlows, droneBody, droneGlow, halos, beams]) if (mesh) mesh.dispose();
    },
  };
}

/* ================================================================== planning */

/** Packed drone site: ax, az, bx, bz, altitude. */
const SITE = 5;

type Blocked = (x: number, z: number, y0: number, y1: number, pad: number) => boolean;
/** Top (m) of the tallest thing over (x, z), grown by `pad`: 0 for open sky, Infinity over a block. */
type Ceiling = (x: number, z: number, pad: number) => number;

/**
 * Everything in the air the plan knows about, as two tests: megastructure volumes, skybridges,
 * masts, the ring billboard, hologram billboards, decks overhead, and the blocks themselves
 * (every height: a block's buildings reach anywhere up to the skyline).
 */
function makeObstacles(plan: CityPlan): { blocked: Blocked; ceiling: Ceiling } {
  const volumes = (plan.megastructures ?? []).flatMap((ms) => ms.volumes);
  // Megastructure volumes by grid cell (grown by the largest pad asked for): there are hundreds.
  const VOL = 40;
  const VOL_PAD = 6;
  const volumeCells = new Map<number, CityVolume[]>();
  for (const v of volumes) {
    for (let i = Math.floor((v.minX - VOL_PAD) / VOL); i <= Math.floor((v.maxX + VOL_PAD) / VOL); i++) {
      for (let j = Math.floor((v.minZ - VOL_PAD) / VOL); j <= Math.floor((v.maxZ + VOL_PAD) / VOL); j++) {
        const k = cellKey(i, j);
        let list = volumeCells.get(k);
        if (!list) volumeCells.set(k, (list = []));
        list.push(v);
      }
    }
  }
  const volumesAt = (x: number, z: number): readonly CityVolume[] => volumeCells.get(cellKey(Math.floor(x / VOL), Math.floor(z / VOL))) ?? NONE;
  const bridges = plan.skybridges ?? [];
  const towers = plan.towers ?? [];
  const rings = plan.ringBillboards ?? [];
  const boards = plan.billboards;
  // Deck samples on a grid, so a pavement probe only reads its own cell.
  const DECK = 16;
  const decks = new Map<number, number[]>();
  for (const rb of plan.ribbons) {
    if (!rb.elevated) continue;
    for (const s of rb.path.samples) {
      if (s.y < 1.5) continue;
      const k = cellKey(Math.floor(s.x / DECK), Math.floor(s.z / DECK));
      let list = decks.get(k);
      if (!list) decks.set(k, (list = []));
      list.push(s.x, s.z, s.halfWidth + 3, s.y);
    }
  }
  const ceiling: Ceiling = (x, z, pad) => {
    if (plan.isSolid(x, z, -pad)) return Infinity;
    let top = 0;
    for (const v of volumesAt(x, z)) {
      if (x > v.minX - pad && x < v.maxX + pad && z > v.minZ - pad && z < v.maxZ + pad) top = Math.max(top, v.y1);
    }
    for (const b of bridges) {
      if (segDist(x, z, b.ax, b.az, b.bx, b.bz) < b.width / 2 + pad + 1) top = Math.max(top, b.y + b.height + 1);
    }
    for (const t of towers) {
      if (Math.hypot(x - t.x, z - t.z) < t.base / 2 + pad + 2) top = Math.max(top, t.height);
    }
    for (const r of rings) {
      if (Math.hypot(x - r.x, z - r.z) < r.radius + pad + 2) top = Math.max(top, r.y + r.height / 2 + 2);
    }
    for (const b of boards) {
      if (Math.hypot(x - b.x, z - b.z) < b.w / 2 + pad + 1) top = Math.max(top, b.y + b.h / 2 + 1);
    }
    return top;
  };
  const blocked: Blocked = (x, z, y0, y1, pad) => {
    if (plan.isSolid(x, z, -pad)) return true;
    for (const v of volumesAt(x, z)) {
      if (v.y1 > y0 && v.y0 < y1 && x > v.minX - pad && x < v.maxX + pad && z > v.minZ - pad && z < v.maxZ + pad) return true;
    }
    for (const b of bridges) {
      if (b.y + b.height + 1 < y0 || b.y - b.height - 1 > y1) continue;
      if (segDist(x, z, b.ax, b.az, b.bx, b.bz) < b.width / 2 + pad + 1) return true;
    }
    for (const t of towers) {
      if (t.height > y0 && Math.hypot(x - t.x, z - t.z) < t.base / 2 + pad + 2) return true;
    }
    for (const r of rings) {
      if (r.y + r.height / 2 + 2 > y0 && Math.hypot(x - r.x, z - r.z) < r.radius + pad + 2) return true;
    }
    for (const b of boards) {
      if (b.y + b.h / 2 + 1 > y0 && b.y - b.h / 2 - 1 < y1 && Math.hypot(x - b.x, z - b.z) < b.w / 2 + pad + 1) return true;
    }
    const ci = Math.floor(x / DECK);
    const cj = Math.floor(z / DECK);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = decks.get(cellKey(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 4) {
          if (list[k + 3] + 1.5 > y0 && list[k + 3] - 2 < y1 && Math.hypot(x - list[k], z - list[k + 1]) < list[k + 2] + pad) return true;
        }
      }
    }
    return false;
  };
  return { blocked, ceiling };
}

/** Clearance (m) a car keeps over anything it hops, and the steepest its hop may climb (m per m). */
const HOP_CLEAR = 8;
const HOP_SLOPE = 0.22;
/** Highest a hop may lift a car over its lane band (m); anything taller ends the corridor instead. */
const HOP_MAX = 10;

/**
 * The flyable stretches of the wide roads, resampled every `STEP` metres. A stretch is cut only
 * where no height will do (a block, a road too narrow, a corner too tight, a landmark over the
 * exit altitude); a megastructure or a skybridge over the road instead raises the corridor's
 * `floor` there, ramped in and out, and the cars hop it.
 */
function planCorridors(plan: CityPlan, ceiling: Ceiling, rng: () => number): Corridor[] {
  const out: Corridor[] = [];
  const proj = createProjection();
  for (const rb of plan.ribbons) {
    if (rb.kind !== 'track') continue;
    const path = rb.path;
    if (path.length < T.minCorridor) continue;
    const n = path.closed ? Math.floor(path.length / STEP) : Math.floor(path.length / STEP) + 1;
    const xs = new Float32Array(n * 2);
    const heading = new Float32Array(n);
    const ok = new Uint8Array(n);
    const floor = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = pointAtStation(path, i * STEP, proj);
      xs[i * 2] = p.x;
      xs[i * 2 + 1] = p.z;
      heading[i] = Math.atan2(p.tx, p.tz);
      // Padded past the widest hull plus its lane offset.
      const top = ceiling(p.x, p.z, 7);
      floor[i] = top > 0 ? top + HOP_CLEAR : 0;
      // Only low things (a skybridge, a deck) are hopped: a car heaving itself over a megastructure
      // reads as a take-off.
      ok[i] = p.halfWidth >= T.minHalfWidth && floor[i] <= T.carAltitude[1] + HOP_MAX ? 1 : 0;
    }
    // Ramp every hop in and out, both ways round (twice round a loop, so the ramps wrap).
    const drop = STEP * HOP_SLOPE;
    const laps = path.closed ? 2 : 1;
    for (let k = 1; k < n * laps; k++) {
      const i = k % n;
      const prev = (k - 1) % n;
      if (ok[i] && ok[prev]) floor[i] = Math.max(floor[i], floor[prev] - drop);
    }
    for (let k = n * laps - 2; k >= 0; k--) {
      const i = k % n;
      const next = (k + 1) % n;
      if (ok[i] && ok[next]) floor[i] = Math.max(floor[i], floor[next] - drop);
    }
    // No tight corners: a hovercar banking round a 20 m fillet at 24 m/s reads as a glitch.
    for (let i = 0; i < n; i++) {
      const a = path.closed ? (i - 8 + n) % n : Math.max(0, i - 8);
      const b = path.closed ? (i + 8) % n : Math.min(n - 1, i + 8);
      let d = Math.abs(heading[b] - heading[a]);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d > 1.2) ok[i] = 0;
    }
    let allOk = true;
    for (let i = 0; i < n; i++) if (!ok[i]) allOk = false;
    if (path.closed && allOk) {
      out.push(corridorOf(xs, floor, n, true, rng));
      continue;
    }
    // Runs of clear samples. On a loop, start scanning at a blocked sample so a run can wrap.
    let start = 0;
    if (path.closed) while (ok[start]) start++;
    let run = -1;
    const total = path.closed ? n + 1 : n + 1;
    for (let k = 0; k < total; k++) {
      const i = path.closed ? (start + k) % n : k;
      const good = k < n && ok[i] === 1;
      if (good && run < 0) run = k;
      if (!good && run >= 0) {
        const count = k - run;
        if ((count - 1) * STEP >= T.minCorridor) {
          const pts = new Float32Array(count * 2);
          const fl = new Float32Array(count);
          for (let r = 0; r < count; r++) {
            const src = path.closed ? (start + run + r) % n : run + r;
            pts[r * 2] = xs[src * 2];
            pts[r * 2 + 1] = xs[src * 2 + 1];
            fl[r] = floor[src];
          }
          out.push(corridorOf(pts, fl, count, false, rng));
        }
        run = -1;
      }
    }
  }
  return out;
}

function corridorOf(xz: Float32Array, floor: Float32Array, n: number, closed: boolean, rng: () => number): Corridor {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xz[i * 2]);
    maxX = Math.max(maxX, xz[i * 2]);
    minZ = Math.min(minZ, xz[i * 2 + 1]);
    maxZ = Math.max(maxZ, xz[i * 2 + 1]);
  }
  const dx = xz[(n - 1) * 2] - xz[0];
  const dz = xz[(n - 1) * 2 + 1] - xz[1];
  // A loop's end-to-end chord says nothing: go by its box.
  const axis = closed ? (maxX - minX > maxZ - minZ ? 0 : 1) : Math.abs(dx) >= Math.abs(dz) ? 0 : 1;
  return {
    xz,
    floor,
    n,
    length: closed ? n * STEP : (n - 1) * STEP,
    closed,
    axis,
    speedMul: [0.85 + rng() * 0.3, 0.85 + rng() * 0.3],
    minX,
    maxX,
    minZ,
    maxZ,
  };
}

/** Short, straight, clear stretches of pavement for the drones, packed `SITE` wide. */
function planDroneSites(plan: CityPlan, blocked: Blocked, rng: () => number): Float32Array {
  const out: number[] = [];
  const proj = createProjection();
  const SPACING = 36;
  for (const rb of plan.ribbons) {
    const path = rb.path;
    if (path.length < 60) continue;
    for (let s = 10 + rng() * SPACING; s < path.length - 50; s += SPACING * (0.8 + rng() * 0.4)) {
      for (const side of SIDES) {
        const len = lerp(T.droneRoute[0], T.droneRoute[1], rng());
        const a = pointAtStation(path, s, proj);
        if (a.y > 0.5) break;
        const width = pavementWidth(plan, rb, a.index, side, a.t, a.x, a.z, path.samples[a.index].zone);
        if (width < 2.8) continue;
        const off = a.halfWidth + clamp(width - 0.9, 2.2, width - 0.5);
        const ax = a.x - a.tz * side * off;
        const az = a.z + a.tx * side * off;
        const h0 = Math.atan2(a.tx, a.tz);
        const b = pointAtStation(path, s + len, proj);
        let dh = Math.abs(Math.atan2(b.tx, b.tz) - h0);
        if (dh > Math.PI) dh = Math.PI * 2 - dh;
        if (dh > 0.2 || b.y > 0.5) continue;
        const offB = b.halfWidth + clamp(width - 0.9, 2.2, width - 0.5);
        const bx = b.x - b.tz * side * offB;
        const bz = b.z + b.tx * side * offB;
        const alt = lerp(T.droneAltitude[0], T.droneAltitude[1], rng());
        let clear = true;
        for (let k = 0; k <= 4 && clear; k++) {
          const x = ax + ((bx - ax) * k) / 4;
          const z = az + ((bz - az) * k) / 4;
          if (blocked(x, z, alt - 1.5, alt + 2.5, 0.4) || plan.isRoad(x, z, 0.3)) clear = false;
        }
        if (clear) out.push(ax, az, bx, bz, alt);
      }
    }
  }
  return new Float32Array(out);
}

function pavementWidth(plan: CityPlan, rb: RibbonDef, i: number, side: number, t: number, x: number, z: number, zone: string): number {
  if (plan.kerbs) return plan.kerbs.widthAt(rb, i, side, t);
  if (rb.kind === 'alley') return plan.shoulders?.alley ?? 0;
  const z3 = zone as ZoneId;
  if (plan.shoulderAt) return plan.shoulderAt(x, z, z3);
  return plan.shoulders?.[z3] ?? 0;
}

/* ================================================================== geometry */

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const NONE: readonly CityVolume[] = [];
const WHITE = new THREE.Color(1, 1, 1);
const SIDES = [-1, 1] as const;
/** Car paint: near-black gunmetal, deep navy, oxblood, graphite. */
const PAINTS = [0x2a2e36, 0x1c2433, 0x33202a, 0x3a3d42, 0x22262b];
const DRONE_PAINTS = [0x3a3f48, 0x2b2f36, 0x4a4238];

const CYAN = 0x3ff0e8;
/** A tinted strip is drawn white and takes its hue from the instance (`STRIP_TINTS`). */
const STRIP = 0xffffff;
/**
 * The underglow palette: gloomy, mostly cold. Cyan and teal carry the city; magenta, sodium, a
 * washed-out blue and a bruised red are the odd rig out.
 */
const STRIP_TINTS = [0x3ff0e8, 0x3ff0e8, 0x28c8d0, 0x1f9fb0, 0xff3fa8, 0xff8a3a, 0x8fa8ff, 0xc02848];
const RED = 0xff2a3a;

/*
 * The nav strobe, shared by the lit geometry and the halos so a tail light and its glow flash
 * together: a double flash once a cycle, dim — never quite out — in between.
 */
const STROBE_GLSL = /* glsl */ `
float rbStrobe( float t, float phase ) {
  float c = fract( t + phase );
  return max( 1.0 - smoothstep( 0.0, 0.035, abs( c - 0.04 ) ), 1.0 - smoothstep( 0.0, 0.035, abs( c - 0.16 ) ) );
}
`;

/**
 * Replaces `color_vertex` on the lights: tinted parts take the instance colour, blinking parts
 * ride the strobe, and a rig whose phase falls in the tired share hums low with its strips
 * dropping out now and then.
 */
const GLOW_COLOR_VERTEX = /* glsl */ `
  vColor = vec3( 1.0 );
  vColor *= color;
  #ifdef USE_INSTANCING_COLOR
    vColor = mix( vColor, vColor * instanceColor, aTint );
  #endif
  vColor *= mix( 1.0, 0.16 + 2.4 * rbStrobe( uTime * uStrobeRate, aPhase ), aBlink );
  float rbTired = step( 1.0 - uTiredShare, aPhase );
  float rbNoise = fract( sin( floor( uTime * 9.0 ) * 12.9898 + aPhase * 78.233 ) * 43758.5453 );
  float rbHum = 0.72 + 0.28 * sin( uTime * 6.0 + aPhase * 40.0 );
  vColor *= mix( 1.0, mix( rbHum, 0.08, step( 0.8, rbNoise ) ), aTint * rbTired );
`;

const HALO_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec2 aHalo;
uniform float uTime;
uniform float uStrobeRate;
varying vec2 vUv;
varying vec3 vGlow;
${STROBE_GLSL}
void main() {
  vUv = position.xy;
  // A camera-facing quad at the instance's position, as wide as its X scale.
  vec4 mvPosition = modelViewMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 );
  mvPosition.xy += position.xy * length( instanceMatrix[ 0 ].xyz );
  float k = aHalo.x < 0.5 ? 1.0 : aHalo.x < 1.5 ? rbStrobe( uTime * uStrobeRate, aHalo.y ) : 0.65 + 0.35 * sin( uTime * 1.7 + aHalo.y * 31.0 );
  vGlow = instanceColor * k;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const HALO_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying vec2 vUv;
varying vec3 vGlow;
void main() {
  float d = length( vUv );
  // A tight core with only a thin skirt of haze: the light itself, barely softened by the wet air.
  float a = 0.35 * pow( max( 0.0, 1.0 - d ), 4.0 ) + pow( max( 0.0, 1.0 - d * 2.5 ), 3.0 );
  gl_FragColor = vec4( vGlow * a, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const BEAM_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying float vAlong;
varying float vEdge;
varying vec3 vGlow;
void main() {
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
  vec3 n = normalize( normalMatrix * mat3( instanceMatrix ) * normal );
  // Face-on is bright, grazing is gone: the cone's hard silhouette dissolves into a shaft.
  vEdge = pow( abs( dot( n, normalize( -mvPosition.xyz ) ) ), 1.6 );
  vAlong = uv.y;
  vGlow = instanceColor;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const BEAM_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying float vAlong;
varying float vEdge;
varying vec3 vGlow;
void main() {
  float a = pow( vAlong, 1.8 ) * vEdge;
  gl_FragColor = vec4( vGlow * a, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
const AMBER = 0xffa23a;
const ICE = 0xbff4ff;

/**
 * One coloured, flat-shaded, non-indexed part at (x, y, z), rotated `ry` about Y. On a light,
 * `tint` 1 lets the instance colour recolour it (the strips) and `blink` 1 puts it on the nav
 * strobe (see `GLOW_COLOR_VERTEX`).
 */
function part(geo: THREE.BufferGeometry, hex: number, x = 0, y = 0, z = 0, ry = 0, mul = 1, tint = 0, blink = 0): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  if (ry !== 0) g.rotateY(ry);
  g.translate(x, y, z);
  g.computeVertexNormals();
  const c = new THREE.Color(hex).multiplyScalar(mul);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
  g.setAttribute('aBlink', new THREE.BufferAttribute(new Float32Array(n).fill(blink), 1));
  return g;
}

const box = (w: number, h: number, l: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, l);

/**
 * A tapered box: bottom `w0` x `l0`, top `w1` x `l1` shifted `zTop` along Z, `h` tall, bottom
 * at y = 0. The angular hull every silhouette here is cut from.
 */
function hull(w0: number, w1: number, l0: number, l1: number, h: number, zTop = 0): THREE.BufferGeometry {
  const b = [
    [-w0 / 2, 0, -l0 / 2],
    [w0 / 2, 0, -l0 / 2],
    [w0 / 2, 0, l0 / 2],
    [-w0 / 2, 0, l0 / 2],
  ];
  const t = [
    [-w1 / 2, h, -l1 / 2 + zTop],
    [w1 / 2, h, -l1 / 2 + zTop],
    [w1 / 2, h, l1 / 2 + zTop],
    [-w1 / 2, h, l1 / 2 + zTop],
  ];
  const tris: number[][] = [
    // bottom, top
    b[0], b[1], b[2], b[0], b[2], b[3],
    t[0], t[2], t[1], t[0], t[3], t[2],
    // sides
    b[0], t[0], t[1], b[0], t[1], b[1],
    b[1], t[1], t[2], b[1], t[2], b[2],
    b[2], t[2], t[3], b[2], t[3], b[3],
    b[3], t[3], t[0], b[3], t[0], b[0],
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
  return g;
}

function merged(parts: THREE.BufferGeometry[], scale: number): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.scale(scale, scale, scale);
  g.computeBoundingSphere();
  return g;
}

const CAR_SCALE = T.carScale;

/** The coupe: a low hull, a set-back cabin with amber glass, thruster pods either side. */
function coupeBody(): THREE.BufferGeometry {
  return merged(
    [
      part(hull(1.9, 1.5, 4.4, 3.5, 0.42, -0.1), 0xffffff, 0, -0.12, 0, 0, 0.75),
      part(hull(1.4, 0.9, 2.1, 1.2, 0.4, -0.25), 0xffffff, 0, 0.3, -0.35, 0, 0.5),
      part(box(0.38, 0.28, 2.5), 0xffffff, -1.08, -0.12, -0.35, 0, 0.6),
      part(box(0.38, 0.28, 2.5), 0xffffff, 1.08, -0.12, -0.35, 0, 0.6),
    ],
    CAR_SCALE,
  );
}

function coupeGlow(): THREE.BufferGeometry {
  return merged(
    [
      // Propulsion strips under the pods, and one across the nose.
      part(box(0.26, 0.05, 2.3), STRIP, -1.08, -0.28, -0.35, 0, 1, 1),
      part(box(0.26, 0.05, 2.3), STRIP, 1.08, -0.28, -0.35, 0, 1, 1),
      part(box(1.0, 0.04, 0.14), STRIP, 0, -0.15, 1.3, 0, 1, 1),
      // Cabin windows, warm.
      part(box(0.03, 0.13, 1.0), AMBER, -0.62, 0.5, -0.4),
      part(box(0.03, 0.13, 1.0), AMBER, 0.62, 0.5, -0.4),
      // Nav lights at the tail corners; a cold running strip at the nose.
      part(box(0.22, 0.12, 0.14), RED, -0.92, 0.06, -2.22, 0, 1, 0, 1),
      part(box(0.22, 0.12, 0.14), RED, 0.92, 0.06, -2.22, 0, 1, 0, 1),
      // A white beacon on the roof, on the same strobe.
      part(box(0.1, 0.06, 0.1), ICE, 0, 0.74, -0.5, 0, 1.2, 0, 1),
      part(box(1.1, 0.05, 0.04), ICE, 0, 0.02, 2.22, 0, 0.7),
    ],
    CAR_SCALE,
  );
}

/** The wedge: one long blade of a hull, a dark canopy, twin tail fins. No lit glass. */
function wedgeBody(): THREE.BufferGeometry {
  return merged(
    [
      part(hull(2.0, 1.1, 4.8, 2.8, 0.5, -0.65), 0xffffff, 0, -0.16, 0, 0, 0.75),
      part(hull(1.05, 0.65, 1.6, 0.9, 0.22, -0.2), 0xffffff, 0, 0.34, -0.5, 0, 0.35),
      part(box(0.08, 0.42, 0.7), 0xffffff, -0.8, 0.46, -1.95, 0, 0.6),
      part(box(0.08, 0.42, 0.7), 0xffffff, 0.8, 0.46, -1.95, 0, 0.6),
    ],
    CAR_SCALE,
  );
}

function wedgeGlow(): THREE.BufferGeometry {
  return merged(
    [
      part(box(0.34, 0.05, 3.6), STRIP, 0, -0.18, 0, 0, 1, 1),
      part(box(1.8, 0.05, 0.2), STRIP, 0, -0.18, -1.6, 0, 1, 1),
      part(box(0.03, 0.05, 1.7), STRIP, -0.97, 0.06, 0.2, 0, 0.8, 1),
      part(box(0.03, 0.05, 1.7), STRIP, 0.97, 0.06, 0.2, 0, 0.8, 1),
      part(box(0.16, 0.12, 0.2), RED, -0.8, 0.7, -2.2, 0, 1, 0, 1),
      part(box(0.16, 0.12, 0.2), RED, 0.8, 0.7, -2.2, 0, 1, 0, 1),
    ],
    CAR_SCALE,
  );
}

const DRONE_SCALE = T.droneScale;
/** Arm tip offset from the centre along each diagonal (m, before scale). */
const TIP = 0.33;

function droneBodyGeometry(): THREE.BufferGeometry {
  const parts = [
    part(box(0.34, 0.12, 0.44), 0xffffff, 0, 0, 0, 0, 0.8),
    part(hull(0.3, 0.2, 0.38, 0.24, 0.07), 0xffffff, 0, 0.06, 0, 0, 0.6),
    part(box(0.12, 0.09, 0.12), 0xffffff, 0, -0.1, 0.13, 0, 0.4),
    // Two crossed arms.
    part(box(0.05, 0.035, 0.94), 0xffffff, 0, 0.02, 0, Math.PI / 4, 0.7),
    part(box(0.05, 0.035, 0.94), 0xffffff, 0, 0.02, 0, -Math.PI / 4, 0.7),
  ];
  for (const sx of SIDES) {
    for (const sz of SIDES) {
      parts.push(part(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 6), 0xffffff, sx * TIP, 0.05, sz * TIP, 0, 0.5));
      // The rotor disc, as a thin pale blur.
      parts.push(part(new THREE.CylinderGeometry(0.19, 0.19, 0.012, 10), 0xffffff, sx * TIP, 0.1, sz * TIP, 0, 1.1));
    }
  }
  return merged(parts, DRONE_SCALE);
}

function droneGlowGeometry(): THREE.BufferGeometry {
  return merged(
    [
      part(box(0.05, 0.035, 0.03), CYAN, -0.09, 0.0, 0.225),
      part(box(0.05, 0.035, 0.03), CYAN, 0.09, 0.0, 0.225),
      part(box(0.12, 0.035, 0.03), RED, 0, 0.0, -0.225, 0, 1, 0, 1),
      part(box(0.08, 0.02, 0.08), CYAN, 0, -0.065, -0.1),
      // Under the motors: cyan forward, red aft, so the heading reads from below.
      part(box(0.05, 0.02, 0.05), CYAN, -TIP, 0.0, TIP),
      part(box(0.05, 0.02, 0.05), CYAN, TIP, 0.0, TIP),
      part(box(0.05, 0.02, 0.05), RED, -TIP, 0.0, -TIP, 0, 1, 0, 1),
      part(box(0.05, 0.02, 0.05), RED, TIP, 0.0, -TIP, 0, 1, 0, 1),
    ],
    DRONE_SCALE,
  );
}

/* ================================================================== helpers */

function smooth(k: number): number {
  const t = k < 0 ? 0 : k > 1 ? 1 : k;
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function cellKey(i: number, j: number): number {
  return (i + 4096) * 8192 + (j + 4096);
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Smooth max: `max(a, b)` with the corner rounded over `k`, so a hop eases in instead of kinking. */
function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
}
