import * as THREE from 'three';
import { RENDER } from '../../config/tuning';
import type { CityPlan } from '../../world/cityPlan';
import { applyPalette, PAL } from './env/palette';
import { createBuilders } from './env/builders';
import { buildCity } from './env/cityBuilder';
import { buildLandmarks } from './env/landmarksBuilder';
import { buildProps } from './env/propsBuilder';
import { buildTrack } from './env/trackBuilder';
import { createWantedBillboard } from './env/wantedBillboard';
import {
  makeAsphaltTexture,
  makeBillboardTexture,
  makeEnvTexture,
  makeGlowTexture,
  makeSignAtlas,
  makeSkyTexture,
  makeWindowTexture,
} from './env/textures';
import type { MeshBuilder } from './env/meshBuilder';
import { createWindowActivity } from './env/windowActivity';
import { createLampFaults } from './env/lampFaults';

/**
 * The Rayo Bandido city: a nocturnal block of city built entirely from a `CityPlan`
 * (`src/world/cityPlan.ts`), which the test arena and the racing circuit both produce from the
 * same rectangles and paths their simulation collides with, so what you can see and what you
 * can crash into are the same data. This module also owns the scene background, fog and the
 * only two lights in the game.
 *
 * HOW IT STAYS CHEAP
 * - Everything is merged into fifteen BufferGeometries, one per material: fifteen draw calls
 *   for the whole city (see `env/builders.ts`).
 * - All lighting is baked into emissive textures and unlit neon. One hemisphere light and one
 *   directional light do the rest; there are no point lights and no shadow maps.
 * - Textures are drawn procedurally into small canvases at start-up. Nothing is loaded.
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
  // The haze starts close and closes fast: distance should dissolve into blue, not into black.
  // A world may ask for more reach (the big city has a skyline to see across the bay).
  scene.fog = new THREE.Fog(PAL.fog, plan.fog?.near ?? RENDER.fogNear, plan.fog?.far ?? RENDER.fogFar);

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
  // Fewer, larger, softer windows. A tower should read as a couple of glowing bands seen
  // through haze, not as a hundred individual pixels fighting each other for attention.
  // The grids are shared with `windowActivity` below, which needs the same cells to find one
  // window in the shader; they must not drift apart.
  const corpGrid = { cols: 5, rows: 5 };
  const urbanGrid = { cols: 4, rows: 4 };
  const jdmGrid = { cols: 4, rows: 3 };
  const winCorp = makeWindowTexture({
    facade: PAL.facadeCorp,
    lights: PAL.windowsCorp,
    ...corpGrid,
    lit: 0.2 * PAL.litGain,
    seed: 11,
  });
  const winUrban = makeWindowTexture({
    facade: PAL.facadeUrban,
    lights: PAL.windowsUrban,
    ...urbanGrid,
    lit: 0.26 * PAL.litGain,
    seed: 23,
  });
  const winJdm = makeWindowTexture({
    facade: PAL.facadeJdm,
    lights: PAL.windowsJdm,
    ...jdmGrid,
    lit: 0.18 * PAL.litGain,
    seed: 37,
  });
  const signTex = makeSignAtlas();
  const glowTex = makeGlowTexture();
  const billTexA = makeBillboardTexture(0);
  const billTexB = makeBillboardTexture(1);
  const textures = [skyTex, envTex, asphaltTex, winCorp, winUrban, winJdm, signTex, glowTex, billTexA, billTexB];

  /* ---------------------------------------------------------------- materials */

  const facade = (map: THREE.Texture, intensity: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({
      map,
      emissive: 0xffffff,
      emissiveMap: map,
      emissiveIntensity: intensity,
      roughness: 0.82,
      metalness: 0.08,
    });

  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTex,
    vertexColors: true,
    // Wetter than before: a low roughness smears the sky and the neon into long reflections,
    // which is what carries the mood in the reference instead of individual light sources.
    roughness: 0.24,
    metalness: 0.5,
  });
  const laneMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const concreteMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.04 });
  const corpMat = facade(winCorp, 0.85 * PAL.windowGain);
  const urbanMat = facade(winUrban, 0.9 * PAL.windowGain);
  const jdmMat = facade(winJdm, 0.75 * PAL.windowGain);
  // Rooms behind the panes: each window drifts, and now and then one goes dark or comes back.
  const windows = createWindowActivity();
  windows.apply(corpMat, corpGrid.cols, corpGrid.rows, 2.7);
  windows.apply(urbanMat, urbanGrid.cols, urbanGrid.rows, 8.3);
  windows.apply(jdmMat, jdmGrid.cols, jdmGrid.rows, 14.9);
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const propsMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.18 });
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
    // `fog` is left at its default (on) on purpose: far-off halos take the haze colour and
    // sink into the horizon instead of punching through it as bright specks.
    fog: true,
  });
  // Roughly a third of the street lamps are broken. The heads live in `neon` and their halos
  // and light pools in `glow`, so both materials read the per-vertex fault seed.
  const lampFaults = createLampFaults();
  lampFaults.apply(neonMat);
  lampFaults.apply(glowMat);
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false });
  const billMatA = new THREE.MeshBasicMaterial({ map: billTexA, toneMapped: false });
  const billMatB = new THREE.MeshBasicMaterial({ map: billTexB, toneMapped: false });
  signMat.color.setScalar(PAL.screenGain);
  billMatA.color.setScalar(PAL.screenGain);
  billMatB.color.setScalar(PAL.screenGain);
  neonMat.color.setScalar(PAL.neonGain);
  glowMat.color.setScalar(PAL.glowGain);
  const materials = [
    roadMat,
    laneMat,
    concreteMat,
    corpMat,
    urbanMat,
    jdmMat,
    roofMat,
    propsMat,
    neonMat,
    neonPulseMat,
    neonFlickerMat,
    glowMat,
    signMat,
    billMatA,
    billMatB,
  ];

  /* ---------------------------------------------------------------- geometry */

  const b = createBuilders(plan);
  buildCity(b);
  buildProps(b);
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
  add(b.corp, corpMat, 'env-facade-corporate');
  add(b.urban, urbanMat, 'env-facade-urban');
  add(b.jdm, jdmMat, 'env-facade-jdm');
  add(b.roof, roofMat, 'env-roofs');
  add(b.props, propsMat, 'env-props');
  add(b.signs, signMat, 'env-signs', 1);
  add(b.billA, billMatA, 'env-billboard-a', 1);
  add(b.billB, billMatB, 'env-billboard-b', 1);
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

  return {
    root,
    ready: wantedBoard.ready,
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
      // The plaza WANTED board strobes subtly.
      wantedBoard.update(time);
    },
    dispose() {
      wantedBoard.dispose();
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
