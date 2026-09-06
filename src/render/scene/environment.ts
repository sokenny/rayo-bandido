import * as THREE from 'three';
import { RENDER } from '../../config/tuning';
import type { CityPlan } from '../../world/cityPlan';
import { applyPalette, PAL } from './env/palette';
import { createBuilders } from './env/builders';
import { buildCity } from './env/cityBuilder';
import { buildLandmarks } from './env/landmarksBuilder';
import { buildProps } from './env/propsBuilder';
import { buildTransit } from './env/transitBuilder';
import { buildTrack } from './env/trackBuilder';
import { createWantedBillboard } from './env/wantedBillboard';
import { createBadkalaPoster } from './env/badkalaPoster';
import { makeAsphaltTexture, makeBillboardTexture, makeEnvTexture, makeGlowTexture, makeSignAtlas, makeSkyTexture, makeTransitAtlas } from './env/textures';
import { createFacadeMaterial, makeFacadeAtlas } from './env/facadeAtlas';
import { applyHaze, HAZE } from './env/haze';
import type { MeshBuilder } from './env/meshBuilder';
import { createWindowActivity } from './env/windowActivity';
import { attachTexture } from '../textures/load';
import { createLampFaults } from './env/lampFaults';

/**
 * The Rayo Bandido city: a nocturnal block of city built entirely from a `CityPlan`
 * (`src/world/cityPlan.ts`), which the test arena and the racing circuit both produce from the
 * same rectangles and paths their simulation collides with, so what you can see and what you
 * can crash into are the same data. This module also owns the scene background, fog and the
 * only two lights in the game.
 *
 * HOW IT STAYS CHEAP
 * - Everything is merged into thirteen BufferGeometries, one per material: thirteen draw
 *   calls for the whole city (see `env/builders.ts`). Every facade in the city is one of
 *   them: one atlas of window patterns, tint and pattern chosen per wall (`env/facadeAtlas.ts`).
 * - All lighting is baked into emissive textures and unlit neon. One hemisphere light and one
 *   directional light do the rest; there are no point lights and no shadow maps.
 * - Textures are drawn procedurally into small canvases at start-up. The few that are art
 *   files instead (the street surface, the two posters) are declared in
 *   `render/textures/manifest.ts`, load in the background and fall back to the procedural
 *   version, so nothing in the frame waits on the network.
 * - `update()` only nudges a handful of material colours and two texture offsets. No allocation.
 *
 * THE THREE ZONES (docs/VISUAL_DIRECTION.md)
 * - Corporate highway, west: 20 m of clean asphalt, guardrails, cold white towers, neon route
 *   gates and a holographic billboard. This is the long straight the player spawns on.
 * - Urban streets, north and centre: modular mid-rise with emissive window grids, cyan and
 *   magenta kanji signs, overhead cables and a 50 x 50 m plaza to drift in.
 * - JDM alley, south-east: low garages in acid green, containers, drums, pipes, AC units,
 *   graffiti panels and a 10 m service alley you can cut through.
 */
export interface EnvironmentVisual {
  root: THREE.Group;
  /** Resolves when every texture that loads asynchronously (the WANTED portrait) is drawn. */
  ready: Promise<void>;
  /** Called once per render frame for cheap animation (blinking signs, holograms). */
  update(frameDt: number, time: number): void;
  dispose(): void;
}

export function createEnvironment(scene: THREE.Scene, plan: CityPlan): EnvironmentVisual {
  // Every builder and texture below reads `PAL`; the world chooses which script fills it.
  applyPalette(plan.palette ?? 'arena');
  const root = new THREE.Group();
  root.name = 'environment';
  scene.add(root);

  /* ---------------------------------------------------------------- atmosphere + light */

  const skyTex = makeSkyTexture();
  const envTex = makeEnvTexture();
  scene.background = skyTex;
  scene.backgroundIntensity = 1;
  scene.environment = envTex;
  // Enough to give the wet asphalt a sheen and to keep the blue in the shadows.
  scene.environmentIntensity = 0.95;
  // Distance dissolves into blue, never into black. Small worlds use linear fog, which is
  // cheap to reason about at arena scale; a world with a skyline asks for exponential haze
  // instead (`{ density }`), which thickens gradually and never clamps to flat fog colour,
  // so the far side of the bay stays a skyline instead of a card. What keeps the lights in
  // it visible through that haze is the per-material patch in `env/haze.ts`.
  const fogPlan = plan.fog;
  scene.fog =
    fogPlan && 'density' in fogPlan
      ? new THREE.FogExp2(PAL.fog, fogPlan.density)
      : new THREE.Fog(PAL.fog, fogPlan?.near ?? RENDER.fogNear, fogPlan?.far ?? RENDER.fogFar);

  // Deep teal sky bounce over a blue-grey ground bounce. This is the "not pitch dark" light:
  // it never goes to black underneath anything, so shadowed geometry still reads as blue.
  const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, PAL.hemiIntensity);
  root.add(hemi);
  // A single cold key from high north-west; no shadows, they are not worth the frame time.
  const key = new THREE.DirectionalLight(PAL.keyColor, PAL.keyIntensity);
  key.position.set(-70, 110, -50);
  root.add(key);

  /* ---------------------------------------------------------------- textures */

  const asphaltTex = makeAsphaltTexture(PAL.asphalt, 7);
  // Every facade pattern in the city on one atlas (`env/facadeAtlas.ts`): ribbons, strips,
  // clusters, service bands, sparse groups, lit corners, inset panels, dark towers. Which
  // pattern a wall shows and what colour its glass is are per-vertex, so one texture and one
  // material draw every building in the city.
  const facadeTex = makeFacadeAtlas();
  const signTex = makeSignAtlas();
  // Every printed and back-lit surface the bus network carries, on one atlas.
  const transitTex = makeTransitAtlas();
  const glowTex = makeGlowTexture();
  const billTexA = makeBillboardTexture(0);
  const billTexB = makeBillboardTexture(1);
  // The one texture in the city that loads an image. It disposes itself, so it stays out of
  // the `textures` list below.
  const badkala = createBadkalaPoster();
  const textures = [skyTex, envTex, asphaltTex, facadeTex, signTex, transitTex, glowTex, billTexA, billTexB];

  /* ---------------------------------------------------------------- materials */

  const roadMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    // Wetter than before: a low roughness smears the sky and the neon into long reflections,
    // which is what carries the mood in the reference instead of individual light sources.
    roughness: 0.24,
    metalness: 0.5,
  });
  // The street surface is the one ground texture that is art rather than canvas work: a
  // photographic asphalt tile out of `public/textures/road/`, graded into the night palette by
  // the manifest. The procedural asphalt above stays as the fallback and is what is drawn
  // while the file is in flight, so the road is never untextured and never blocks start-up.
  const roadArt = attachTexture(roadMat, 'road/asphalt', asphaltTex);
  const laneMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const concreteMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.04 });
  // Rooms behind the panes: each window drifts, and now and then one goes dark or comes back.
  const windows = createWindowActivity();
  const facadeMat = createFacadeMaterial(facadeTex, windows, 0.85 * PAL.windowGain);
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const propsMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.18 });
  // Greenery: leaves and bark, each its own material so the art on one never lands on a
  // shipping container. Both are dry and matte — nothing in a hedge reflects the neon — and
  // both start untextured, which is exactly how the palms looked before the art existed, so a
  // missing file costs nothing but the detail. The vertex colours stay: they carry the palette
  // tint and the per-frond shading the geometry was built around, and the map multiplies into
  // them rather than replacing them.
  const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const barkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const foliageArt = attachTexture(foliageMat, 'nature/foliage', null);
  const barkArt = attachTexture(barkMat, 'nature/bark', null);
  const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const neonPulseMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const neonFlickerMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    // Fogged, but additively: `applyHaze` below attenuates these halos towards black with
    // distance instead of mixing them towards the fog colour, which on an additive blend
    // would paint haze-coloured light onto the sky behind every far-off lamp.
    fog: true,
  });
  // Roughly a third of the street lamps are broken. The heads live in `neon` and their halos
  // and light pools in `glow`, so both materials read the per-vertex fault seed.
  const lampFaults = createLampFaults();
  lampFaults.apply(neonMat);
  lampFaults.apply(glowMat);
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false });
  const transitMat = new THREE.MeshBasicMaterial({ map: transitTex, toneMapped: false });
  const billMatA = new THREE.MeshBasicMaterial({ map: billTexA, toneMapped: false });
  const billMatB = new THREE.MeshBasicMaterial({ map: billTexB, toneMapped: false });
  const badkalaMat = new THREE.MeshBasicMaterial({ map: badkala.texture, toneMapped: false });
  signMat.color.setScalar(PAL.screenGain);
  transitMat.color.setScalar(PAL.screenGain);
  billMatA.color.setScalar(PAL.screenGain);
  billMatB.color.setScalar(PAL.screenGain);
  badkalaMat.color.setScalar(PAL.screenGain);
  neonMat.color.setScalar(PAL.neonGain);
  glowMat.color.setScalar(PAL.glowGain);

  // Aerial perspective, per material family: walls fade first, lights fade last. Must come
  // after every other patch above — the window activity and the lamp faults each install
  // their own `onBeforeCompile`, and `applyHaze` composes with whatever it finds.
  applyHaze(facadeMat, { lightKeep: HAZE.facadeLightKeep });
  for (const m of [neonMat, neonPulseMat, neonFlickerMat, signMat, transitMat, billMatA, billMatB, badkalaMat]) {
    applyHaze(m, { strength: HAZE.neonStrength, lightKeep: HAZE.neonLightKeep });
  }
  applyHaze(glowMat, { strength: HAZE.glowStrength, additive: true });
  const materials = [
    roadMat,
    laneMat,
    concreteMat,
    facadeMat,
    roofMat,
    propsMat,
    foliageMat,
    barkMat,
    neonMat,
    neonPulseMat,
    neonFlickerMat,
    glowMat,
    signMat,
    transitMat,
    billMatA,
    billMatB,
    badkalaMat,
  ];

  /* ---------------------------------------------------------------- geometry */

  const b = createBuilders(plan);
  buildCity(b);
  buildProps(b);
  buildTransit(b);
  buildTrack(b);
  buildLandmarks(b);

  const geometries: THREE.BufferGeometry[] = [];
  const add = (builder: MeshBuilder, material: THREE.Material, name: string, order = 0): void => {
    if (builder.empty) return;
    const geo = builder.build();
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.renderOrder = order;
    // Each mesh spans the whole arena, so a frustum test can never reject one.
    mesh.frustumCulled = false;
    root.add(mesh);
  };

  add(b.concrete, concreteMat, 'env-concrete');
  add(b.road, roadMat, 'env-road');
  add(b.lane, laneMat, 'env-lanes');
  add(b.facade, facadeMat, 'env-facade');
  add(b.roof, roofMat, 'env-roofs');
  add(b.props, propsMat, 'env-props');
  add(b.bark, barkMat, 'env-bark');
  add(b.foliage, foliageMat, 'env-foliage');
  add(b.signs, signMat, 'env-signs', 1);
  add(b.transit, transitMat, 'env-transit', 1);
  add(b.billA, billMatA, 'env-billboard-a', 1);
  add(b.billB, billMatB, 'env-billboard-b', 1);
  add(b.badkala, badkalaMat, 'env-badkala', 1);
  add(b.neon, neonMat, 'env-neon', 1);
  add(b.neonPulse, neonPulseMat, 'env-neon-pulse', 1);
  add(b.neonFlicker, neonFlickerMat, 'env-neon-flicker', 1);
  add(b.glow, glowMat, 'env-glow', 2);

  /* ------------------------------------------------- water */

  // One flat, glossy plane: the sky and the environment map do the reflecting, the additive
  // streaks the landmarks builder lays on it do the neon. Its own material, one draw call.
  if (plan.water) {
    const r = plan.water.rect;
    const geo = new THREE.PlaneGeometry(r.maxX - r.minX, r.maxZ - r.minZ);
    geo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: PAL.water,
      roughness: 0.16,
      metalness: 0.6,
      envMapIntensity: 1.5,
    });
    const water = new THREE.Mesh(geo, waterMat);
    water.name = 'env-water';
    water.position.set((r.minX + r.maxX) / 2, -0.55, (r.minZ + r.maxZ) / 2);
    water.frustumCulled = false;
    root.add(water);
    geometries.push(geo);
    materials.push(waterMat);
  }

  /* ------------------------------------------------- wanted billboard */

  const wantedBoard = createWantedBillboard(plan.wantedBoard ?? { x: 0, z: -10_000, rotY: 0 });
  if (plan.wantedBoard) root.add(wantedBoard.group);

  /* ---------------------------------------------------------------- animation */

  let flickerSlot = -1;
  let flickerValue = 1;
  // The BADKALA panels keep their own, lazier stutter, so the ad never blinks in time with
  // the broken street tubes.
  let adSlot = -1;
  let adValue = 1;

  return {
    root,
    ready: Promise.all([wantedBoard.ready, badkala.ready, roadArt.ready, foliageArt.ready, barkArt.ready]).then(() => undefined),
    update(frameDt: number, time: number) {
      // The rooms behind the windows and the failing street lamps keep their own clocks.
      windows.update(time);
      lampFaults.update(time);

      // Breathing neon: vertical signs, gate bars, hanging tubes. Its own slow sine breath.
      neonPulseMat.color.setScalar(PAL.neonGain * (0.68 + 0.32 * Math.sin(time * 1.7)));

      // Stuttering neon: broken alley tubes and aircraft beacons on the towers. Lazy, slot-based
      // stutter (fast stutter is the quickest way to make a night scene feel busy).
      const slot = Math.floor(time * 2.2);
      if (slot !== flickerSlot) {
        flickerSlot = slot;
        const h = Math.abs(Math.sin(slot * 12.9898) * 43758.5453) % 1;
        flickerValue = h < 0.1 ? 0.45 : h < 0.2 ? 0.75 : 1;
      }
      neonFlickerMat.color.setScalar(PAL.neonGain * flickerValue);

      // Wet reflections and light pools: a gentle shimmer in opacity.
      glowMat.opacity = Math.min(1, 0.86 + 0.1 * Math.sin(time * 0.8));
      // Holographic billboards scroll in opposite directions.
      billTexA.offset.y = (billTexA.offset.y + frameDt * 0.035) % 1;
      billTexB.offset.y = (billTexB.offset.y - frameDt * 0.026 + 1) % 1;
      // The BADKALA ad: a slow breath with the occasional dropped frame.
      const ad = Math.floor(time * 3.1);
      if (ad !== adSlot) {
        adSlot = ad;
        const h = Math.abs(Math.sin(ad * 78.233) * 43758.5453) % 1;
        adValue = h < 0.05 ? 0.5 : h < 0.11 ? 0.82 : 1;
      }
      badkalaMat.color.setScalar(PAL.screenGain * adValue * (0.93 + 0.07 * Math.sin(time * 1.3)));

      // The plaza WANTED board strobes subtly.
      wantedBoard.update(time);
    },
    dispose() {
      wantedBoard.dispose();
      badkala.dispose();
      roadArt.dispose();
      foliageArt.dispose();
      barkArt.dispose();
      scene.remove(root);
      if (scene.background === skyTex) scene.background = null;
      if (scene.environment === envTex) scene.environment = null;
      scene.fog = null;
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      hemi.dispose();
      key.dispose();
    },
  };
}
