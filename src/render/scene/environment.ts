import * as THREE from 'three';
import { RENDER, STREET_RACE, WET_ROAD } from '../../config/tuning';
import type { CityPlan } from '../../world/cityPlan';
import { applyPalette, PAL } from './env/palette';
import { createBuilders } from './env/builders';
import { buildCity } from './env/cityBuilder';
import { buildLandmarks } from './env/landmarksBuilder';
import { buildProps } from './env/propsBuilder';
import { buildTransit } from './env/transitBuilder';
import { buildTrack } from './env/trackBuilder';
import { buildNeonWalls } from './env/neonWalls';
import { buildReclamation } from './env/reclaimBuilder';
import { buildCarMeets } from './env/meetBuilder';
import { buildGasStations } from './env/gasStationBuilder';
import { buildGarage } from './env/garageBuilder';
import { buildParks } from './env/parkBuilder';
import { buildVillas } from './env/villaBuilder';
import { buildObelisco } from './env/obeliscoBuilder';
import { createParkPeopleVisual } from './parkPeopleVisual';
import { createParkDucksVisual } from './parkDucksVisual';
import { LAKE, triangulate } from '../../world/park';
import { buildScreens } from './env/screenBuilder';
import { createMeetVisual } from './meetVisual';
import { createBusStopCrowdVisual } from './busStopCrowdVisual';
import { busStopCrowds } from '../../world/busStopCrowds';
import type { CrowdSubject } from './env/humanActs';
import { createDecalMaterial, makeGraffitiAtlas } from './env/graffiti';
import { createWantedBillboard } from './env/wantedBillboard';
import { createActivityMarker, CIRCUIT_MARKER, RUSH_MARKER, STREET_MARKER, type ActivityMarkerVisual, type MarkerGround } from './env/activityMarker';
import { createLeaderboardHologram, type LeaderboardHologramVisual } from './env/leaderboardHologram';
import { LEADERBOARDS, type LeaderboardKind } from '../../content/leaderboards';
import { pathBox } from '../../world/cityGen';
import { createProjection, projectOntoPath } from '../../world/track';
import { createBadkalaPoster } from './env/badkalaPoster';
import { makeAsphaltTexture, makeEnvTexture, makeGlowTexture, makeSignAtlas, makeTransitAtlas } from './env/textures';
import { createScreenAtlas, screenLayout } from './env/screenAtlas';
import { createScreenMaterials } from './env/screenMaterial';
import { createFacadeMaterial, makeFacadeAtlas } from './env/facadeAtlas';
import { createWallMaterial } from './env/wallDetail';
import { applyHaze, HAZE } from './env/haze';
import { createAtmosphere, type AtmosphereVisual } from './env/atmosphere';
import type { MeshBuilder } from './env/meshBuilder';
import { createWindowActivity } from './env/windowActivity';
import { createMoogulSurface, type MoogulSurface } from './env/moogulSurface';
import type { WallIndex } from './env/builders';
import { attachTexture, loadTexture } from '../textures/load';
import { createLampFaults } from './env/lampFaults';
import { isTouchDevice } from '../../ui/viewport';
import { createWetRoad, resolveWetTier, type WetRoad } from './env/wetRoad';

/**
 * The Rayo Bandido city: a nocturnal block of city built entirely from a `CityPlan`
 * (`src/world/cityPlan.ts`), which the test arena and the racing circuit both produce from the
 * same rectangles and paths their simulation collides with, so what you can see and what you
 * can crash into are the same data. This module also owns the sky (`env/atmosphere.ts`), the
 * fog and the only two lights in the game.
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
  /** The sky, the rain and the storm (`env/atmosphere.ts`). Exposed for live tuning. */
  atmosphere: AtmosphereVisual;
  /**
   * The RAYO RUSH marker, in a world that carries one; null everywhere else. Exposed because
   * it is the one piece of scenery that answers the player: `src/game.ts` tells it how close
   * the car is and whether a run is under way.
   */
  rushMarker: ActivityMarkerVisual | null;
  /**
   * The circuit missions' marker, on the Bandido Grid's start line in the open world; null
   * everywhere else, the circuit included. Same object, same contract — a second activity is a
   * second spec (`env/activityMarker.ts`), not a second kind of marker.
   */
  circuitMarker: ActivityMarkerVisual | null;
  /** The STREET RACE ring (one) in the open world; empty everywhere else. */
  streetMarkers: ActivityMarkerVisual[];
  /** The high-score holograms beside the rings, by board; only the ones this world stands. */
  leaderboards: Partial<Record<LeaderboardKind, LeaderboardHologramVisual>>;
  /** The neon sign atlas (`env/textures.ts`), shared with the pavement signs (`streetPropsVisual.ts`). Owned here. */
  signAtlas: THREE.Texture;
  /**
   * What the Moogul may touch (`render/scene/moogulTrip.ts`): the two scene lights, the
   * surface uniforms patched into the facade and graffiti materials, and the index of every
   * wall the city built. The trip writes through these and through `atmosphere`, and nothing
   * else in the environment knows it exists.
   */
  moogul: {
    hemi: THREE.HemisphereLight;
    key: THREE.DirectionalLight;
    surface: MoogulSurface;
    walls: WallIndex;
  };
  /**
   * The mirror in the wet asphalt (`env/wetRoad.ts`). The game renders it once per frame before
   * the scene; anything else that should show in the road can be put on it with `tag`.
   */
  wetRoad: WetRoad;
  /** Resolves when every texture that loads asynchronously (the WANTED portrait) is drawn. */
  ready: Promise<void>;
  /**
   * Called once per render frame for cheap animation (blinking signs, holograms). A world
   * drawn in chunks (`CityPlan.render`) also takes the camera's ground position here, and
   * switches off every chunk the haze has already taken. `people` is the player's car as the
   * people standing about the city notice it (`env/humanActs.ts`).
   */
  update(frameDt: number, time: number, camX?: number, camZ?: number, people?: CrowdSubject | null): void;
  dispose(): void;
}

/** How much of the wet road's mirror the lawn gets: glints of the lamps, not a puddle. */
const GRASS_WET_SCALE = 0.16;

/** Value noise for the lawn's patches, in world metres. */
const GRASS_NOISE = /* glsl */ `
// Dave Hoskins' hash: no sin() of a large argument, which some GPUs flatten to a constant at metro coordinates.
float gHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float gNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

export function createEnvironment(scene: THREE.Scene, plan: CityPlan, options: { wet?: string | null } = {}): EnvironmentVisual {
  // Every builder and texture below reads `PAL`; the world chooses which script fills it.
  applyPalette(plan.palette ?? 'arena');
  const root = new THREE.Group();
  root.name = 'environment';
  scene.add(root);

  /* ---------------------------------------------------------------- atmosphere + light */

  const envTex = makeEnvTexture();
  // No background texture any more: the sky is geometry now — one inverted dome with a
  // procedural storm on it (`env/atmosphere.ts`), drawn before everything with the depth
  // test off, which is the background in the only sense that matters. The environment map
  // stays: it is what the wet road and the car paint reflect, and it is also the channel a
  // lightning flash uses to make every wet surface flare.
  scene.background = null;
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

  // Everything above the skyline, and everything a lightning strike touches: the dome, the
  // rain, the storm clock, and the lifts it puts on the fog, on these two lights and on the
  // environment map. Built last of the atmosphere block so it reads the fog and the light
  // intensities the world actually settled on.
  const atmosphere = createAtmosphere({
    scene,
    fogColor: PAL.fog,
    hemi,
    key,
    touch: isTouchDevice(),
    ...(PAL.sky ? { sky: PAL.sky } : {}),
  });
  root.add(atmosphere.root);

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
  // Every frame every screen in the city can show, on one atlas (`env/screenAtlas.ts`). It
  // disposes itself, like the poster, because it owns the images it draws in.
  const screenAtlas = createScreenAtlas();
  // Every tag, piece, damp streak and crack in the city on one atlas: twelve cells of real
  // graffiti art out of `public/textures/graffiti/`, loaded in the background behind a
  // procedural fallback, and four procedural cells of dirt. One material for all of it.
  const graffiti = makeGraffitiAtlas();
  // The one texture in the city that loads an image. It disposes itself, so it stays out of
  // the `textures` list below.
  const badkala = createBadkalaPoster();
  // The graffiti atlas disposes itself (it owns the images it composites), so it stays out
  // of this list, exactly as the BADKALA poster does.
  const textures = [envTex, asphaltTex, facadeTex, signTex, transitTex, glowTex];

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
  // The lights, mirrored in it: one small extra render of the emissive families below.
  const wetRoad = createWetRoad(resolveWetTier(options.wet ?? null, isTouchDevice()));
  wetRoad.patch(roadMat);
  // The mirror must see the same lights as the main camera, not for how they shade (almost
  // nothing it draws is lit) but because three bumps its lights-state version whenever two
  // renders of one scene see different light sets, and that sends every lit material in the
  // world through `getProgram` again on the next frame: +5 ms of main thread in the metro.
  wetRoad.tag(hemi);
  wetRoad.tag(key);
  const laneMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const concreteMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.04 });
  // Rooms behind the panes: each window drifts, and now and then one goes dark or comes back.
  const windows = createWindowActivity();
  const facadeMat = createFacadeMaterial(facadeTex, windows, 0.85 * PAL.windowGain);
  // The concrete between the panes: a photographed wall out of `public/textures/buildings/`,
  // multiplied over the atlas's flat grey so every facade in the city carries real stain and
  // grain. It lands after start-up and the glass is masked out of it; until then (or if the
  // file is missing) the facades are exactly the flat concrete they were.
  // Street-level concrete: the ground-floor modules, viaduct skirts and piers, alley walls
  // and retaining walls, all sharing one material that projects the same photograph in world
  // space (`env/wallDetail.ts`). These are the surfaces the car actually drives past, and
  // until this existed they were the only big concrete in the city with nothing on them.
  const wallMat = createWallMaterial();
  const concreteArt = loadTexture('buildings/concrete');
  void concreteArt.ready.then(() => {
    facadeMat.setConcreteMap(concreteArt.texture, concreteArt.luma);
    wallMat.setDetailMap(concreteArt.texture, concreteArt.luma);
  });
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  // Double-sided, and this is what stops a lamp from half-vanishing when you drive past it.
  // `MeshBuilder.tube` draws a strut as two crossed quads — the lamp's boom and cable
  // conduit, and every cable, branch and railing built the same way — and a quad has exactly
  // one face. Culled, a crossed pair only exists in the half of the world its two fronts
  // point into: from the other side the boom was simply not drawn, and the head hung in the
  // air over a pole it was no longer joined to. Dropping the cull is free in triangles
  // (emitting both windings instead would add ~11k, past the ceiling `cityWorld.test.ts`
  // holds) and it closes the open-bottomed boxes too: an overhang seen from underneath now
  // shows its inside rather than a hole. Three flips the normal on a back face, so the
  // shading stays right.
  const propsMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0.18,
    side: THREE.DoubleSide,
  });
  // Greenery: leaves and bark, each its own material so the art on one never lands on a
  // shipping container. Both are dry and matte — nothing in a canopy reflects the neon — and
  // both start untextured, which is exactly how the palms looked before the art existed, so a
  // missing file costs nothing but the detail. The vertex colours stay: they carry the palette
  // tint and the per-plant shading the geometry was built around, and the map multiplies into
  // them rather than replacing them.
  const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const barkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const foliageArt = attachTexture(foliageMat, 'nature/foliage', null);
  const barkArt = attachTexture(barkMat, 'nature/bark', null);
  // The parks' lawns: the photograph multiplied into the palette's grass tint, darkened in
  // patches metres across so the turf still reads at driving distance (the photograph's blades
  // mip away to one flat green past a few metres), and damp after the drizzle: a sheen that
  // varies from patch to patch, wetter patches darker, and a weak share of the wet road's mirror
  // so the lamps and the neon glint in it.
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, envMapIntensity: 0.16 });
  grassMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGrassWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGrassWorld;\n${GRASS_NOISE}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 gP = vGrassWorld.xz;
        float gPatch = gNoise(gP / 11.0) * 0.6 + gNoise(gP / 3.1 + 7.0) * 0.4;
        float gClump = gNoise(gP / 0.8 + 3.0);
        float gWet = smoothstep(0.38, 0.78, gNoise(gP / 7.0 + 19.0));
        diffuseColor.rgb *= mix(0.35, 1.45, smoothstep(0.2, 0.8, gPatch)) * mix(0.72, 1.18, gClump) * mix(1.0, 0.8, gWet);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.92, 0.62, gWet);');
  };
  grassMat.customProgramCacheKey = () => 'park-grass';
  wetRoad.patch(grassMat, { scale: GRASS_WET_SCALE });
  const grassArt = attachTexture(grassMat, 'nature/grass', null);
  // Graffiti and grime: lit like the concrete it sits on, blended without writing depth and
  // pushed off the surface behind it, so a tag can never z-fight a wall.
  const decalMat = createDecalMaterial(graffiti.texture);
  // Double-sided for the reason `propsMat` is: the light itself is tubes and single quads —
  // the lamp lens, the accent strips up the column, sign bars — so a cull took the light off
  // one side of every fixture in the city. These are unlit, so a back face shades identically
  // to a front one; the cull was pure loss.
  const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
  const neonPulseMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
  const neonFlickerMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
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
    // A halo is one quad and a spark is a crossed pair, so the cull decided which side of a
    // lamp got a glow at all: approach a working lamp from behind and the head was lit but
    // the air around it was not. Nothing gets brighter than it was from its good side — it is
    // simply that brightness from every side now.
    side: THREE.DoubleSide,
    // One draw per quad. Without this, three draws a transparent double-sided material twice
    // (back faces, then front) and marks it `needsUpdate` on each pass, so every visible glow
    // chunk cost two draw calls and two shader-program lookups a frame. Additive blending is
    // order-independent, so the two passes and the one pass are the same pixels.
    forceSinglePass: true,
  });
  // Roughly a third of the street lamps are broken. The heads live in `neon` and their halos
  // and light pools in `glow`, so both materials read the per-vertex fault seed.
  const lampFaults = createLampFaults();
  lampFaults.apply(neonMat);
  lampFaults.apply(glowMat);
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false });
  const transitMat = new THREE.MeshBasicMaterial({ map: transitTex, toneMapped: false });
  // The LED boards and the holograms: two materials, one clock, every screen in the city.
  const screenMats = createScreenMaterials(screenAtlas.texture, screenLayout(), PAL.screenGain);
  const badkalaMat = new THREE.MeshBasicMaterial({ map: badkala.texture, toneMapped: false });
  signMat.color.setScalar(PAL.screenGain);
  transitMat.color.setScalar(PAL.screenGain);
  badkalaMat.color.setScalar(PAL.screenGain);
  neonMat.color.setScalar(PAL.neonGain);
  glowMat.color.setScalar(PAL.glowGain);

  // The Moogul's hook into the walls: two uniforms on the facades and the paint, zero for the
  // life of a normal session (`env/moogulSurface.ts`). Patched here, at build, so the trip
  // never compiles a shader; composed with the atlas and window patches already on them.
  const moogulSurface = createMoogulSurface();
  moogulSurface.applyFacade(facadeMat);
  moogulSurface.applyDecal(decalMat);

  // Aerial perspective, per material family: walls fade first, lights fade last. Must come
  // after every other patch above — the window activity and the lamp faults each install
  // their own `onBeforeCompile`, and `applyHaze` composes with whatever it finds.
  applyHaze(facadeMat, { lightKeep: HAZE.facadeLightKeep });
  for (const m of [neonMat, neonPulseMat, neonFlickerMat, signMat, transitMat, screenMats.boards, badkalaMat]) {
    applyHaze(m, { strength: HAZE.neonStrength, lightKeep: HAZE.neonLightKeep });
  }
  applyHaze(glowMat, { strength: HAZE.glowStrength, additive: true });
  applyHaze(screenMats.holograms, { strength: HAZE.glowStrength, additive: true });
  // Paint fades into the haze exactly as the wall under it does.
  applyHaze(decalMat);
  const materials = [
    roadMat,
    laneMat,
    concreteMat,
    wallMat,
    facadeMat,
    roofMat,
    propsMat,
    foliageMat,
    barkMat,
    grassMat,
    decalMat,
    neonMat,
    neonPulseMat,
    neonFlickerMat,
    glowMat,
    signMat,
    transitMat,
    screenMats.boards,
    screenMats.holograms,
    badkalaMat,
  ];

  /* ---------------------------------------------------------------- geometry */

  const b = createBuilders(plan);
  buildCity(b);
  buildProps(b);
  buildTransit(b);
  buildTrack(b);
  // After the track, before the landmarks: the versus circuit's barriers sit on top of the
  // streets the city has already drawn, and nothing else in the world is allowed to be
  // brighter than they are.
  buildNeonWalls(b);
  buildLandmarks(b);
  // The LED boards, blades and holograms, on the walls the city has registered by now
  // (`env/screenBuilder.ts`), clear of every deck and skybridge.
  // What went up, on the root, for the QA scripts to find (`scripts/` read `userData.screens`).
  root.userData.screens = buildScreens(b);
  // The car meets' lots, paint, edges and the light off the parked cars (`env/meetBuilder.ts`).
  buildCarMeets(b);
  // The gas stations' forecourts, canopies, pumps, shops and pylons (`env/gasStationBuilder.ts`).
  buildGasStations(b);
  // Loco Mustang's garage: the whitewashed block, the dark mouth and the van in it (`env/garageBuilder.ts`).
  buildGarage(b);
  // The parks: grass, lake beds, trees, paths, walls, the planetarium (`env/parkBuilder.ts`).
  buildParks(b);
  // La bajada: Villa 31's houses, and the Obelisco with its island, the McDonald's and the signs
  // (`env/villaBuilder.ts`, `env/obeliscoBuilder.ts`).
  buildVillas(b);
  buildObelisco(b);
  // Last, so it can read everything the other builders placed: the reclamation pass — the
  // plants, the paint and the decay, all from the one deterministic field in `env/reclaim.ts`.
  buildReclamation(b);

  const geometries: THREE.BufferGeometry[] = [];
  /**
   * The chunks of a world too big to draw whole (`CityPlan.render`): every material's
   * geometry cut into a grid, one mesh per cell, frustum-culled by Three and switched off
   * by distance in `update` once the haze has taken the cell. The Bay and the Stack are
   * one mesh per material, never culled, as they always were.
   */
  const chunks: Array<{ mesh: THREE.Mesh; x: number; z: number; radius: number }> = [];
  const chunked = plan.render ?? null;
  // What the wet road mirrors: the light, and the walls the lit windows are set into. Nothing
  // unlit and nothing lying on the ground. Not the halos either: in the metro they are the
  // biggest family by draw calls (40 of ~160 at the spawn) and the reflection's blur already
  // softens every tube it mirrors. The facades only on tiers that ask for them.
  const reflected = new Set<THREE.Material>([
    ...(wetRoad.tier !== 'off' && WET_ROAD.tiers[wetRoad.tier].facades ? [facadeMat] : []),
    neonMat,
    neonPulseMat,
    neonFlickerMat,
    signMat,
    transitMat,
    screenMats.boards,
    screenMats.holograms,
    badkalaMat,
  ]);
  const add = (builder: MeshBuilder, material: THREE.Material, name: string, order = 0): void => {
    if (builder.empty) return;
    const geo = builder.build();
    if (!chunked) {
      geometries.push(geo);
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = name;
      mesh.renderOrder = order;
      // Each mesh spans the whole arena, so a frustum test can never reject one.
      mesh.frustumCulled = false;
      if (reflected.has(material)) wetRoad.tag(mesh);
      root.add(mesh);
      return;
    }
    for (const part of splitGeometry(geo, chunked.chunk)) {
      geometries.push(part);
      const mesh = new THREE.Mesh(part, material);
      mesh.name = name;
      mesh.renderOrder = order;
      mesh.frustumCulled = true;
      if (reflected.has(material)) wetRoad.tag(mesh);
      root.add(mesh);
      const sphere = part.boundingSphere!;
      chunks.push({ mesh, x: sphere.center.x, z: sphere.center.z, radius: sphere.radius });
    }
    geo.dispose();
    // The builder's own arrays are the biggest thing in memory once the geometry exists.
    builder.release();
  };

  add(b.concrete, concreteMat, 'env-concrete');
  add(b.wall, wallMat, 'env-walls');
  add(b.road, roadMat, 'env-road');
  add(b.lane, laneMat, 'env-lanes');
  add(b.facade, facadeMat, 'env-facade');
  add(b.roof, roofMat, 'env-roofs');
  add(b.props, propsMat, 'env-props');
  add(b.bark, barkMat, 'env-bark');
  add(b.foliage, foliageMat, 'env-foliage');
  add(b.grass, grassMat, 'env-grass');
  // After every opaque surface it might sit on, before the lights.
  add(b.decal, decalMat, 'env-decals', 1);
  add(b.signs, signMat, 'env-signs', 1);
  add(b.transit, transitMat, 'env-transit', 1);
  add(b.screens, screenMats.boards, 'env-screens', 1);
  add(b.badkala, badkalaMat, 'env-badkala', 1);
  add(b.neon, neonMat, 'env-neon', 1);
  add(b.neonPulse, neonPulseMat, 'env-neon-pulse', 1);
  add(b.neonFlicker, neonFlickerMat, 'env-neon-flicker', 1);
  add(b.glow, glowMat, 'env-glow', 2);
  // After the halos: a projection is the brightest thing in the air it stands in.
  add(b.holo, screenMats.holograms, 'env-holograms', 3);

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
    // Half a metre under the streets, which the mirror's height mask still mostly lets through.
    wetRoad.patch(waterMat);
    const water = new THREE.Mesh(geo, waterMat);
    water.name = 'env-water';
    water.position.set((r.minX + r.maxX) / 2, -0.55, (r.minZ + r.maxZ) / 2);
    water.frustumCulled = false;
    root.add(water);
    geometries.push(geo);
    materials.push(waterMat);
  }

  /* ------------------------------------------------- lakes */

  // The parks' lakes (`world/park.ts`): every shore's triangles in one mesh, the bay's own
  // material with a slow ripple on its normal, so the reflection of the sky and the
  // environment map moves a little. One draw call for all the water on the land.
  const lakeShores = (plan.parks ?? []).flatMap((p) => p.lakes.map((l) => l.shore));
  const lakeTime = { value: 0 };
  if (lakeShores.length > 0) {
    const positions: number[] = [];
    const indices: number[] = [];
    for (const shore of lakeShores) {
      const base = positions.length / 3;
      for (const p of shore) positions.push(p.x, 0, p.z);
      const tris = triangulate(shore);
      // The contour is wound to face up in x-z (`windUp`), which is clockwise seen from +Y: swap.
      for (let i = 0; i < tris.length; i += 3) indices.push(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const lakeMat = new THREE.MeshStandardMaterial({
      color: PAL.water,
      roughness: 0.14,
      metalness: 0.62,
      envMapIntensity: 1.6,
      // A touch of its own light: a lake under a night sky is never black, and the streaks the
      // park lays on it need something to sit on.
      emissive: 0x0c2230,
      emissiveIntensity: 0.55,
    });
    const previous = lakeMat.onBeforeCompile;
    lakeMat.onBeforeCompile = (shader, renderer) => {
      previous.call(lakeMat, shader, renderer);
      shader.uniforms.uLakeTime = lakeTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLakePos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLakePos = (modelMatrix * vec4( transformed, 1.0 )).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLakeTime;\nvarying vec3 vLakePos;')
        .replace(
          '#include <normal_fragment_maps>',
          '#include <normal_fragment_maps>\n{ float t = uLakeTime; vec2 p = vLakePos.xz; float wx = sin(p.x * 0.55 + p.y * 0.21 + t * 1.1) * 0.5 + sin(p.x * 1.7 - p.y * 0.9 + t * 1.9) * 0.5; float wz = sin(p.y * 0.62 - p.x * 0.17 + t * 0.9) * 0.5 + sin(p.y * 1.9 + p.x * 0.8 - t * 1.6) * 0.5; normal = normalize( normal + vec3( wx * 0.035, 0.0, wz * 0.035 ) ); }',
        );
    };
    lakeMat.customProgramCacheKey = () => 'lake-ripple';
    // The mirror lands on the lakes as it does on the bay, half a metre under the mirror plane.
    wetRoad.patch(lakeMat);
    const lakesMesh = new THREE.Mesh(geo, lakeMat);
    lakesMesh.name = 'env-lakes';
    lakesMesh.position.y = LAKE.surfaceY;
    lakesMesh.frustumCulled = true;
    root.add(lakesMesh);
    geometries.push(geo);
    materials.push(lakeMat);
  }

  /* ------------------------------------------------- wanted billboard */

  const wantedBoard = createWantedBillboard(plan.wantedBoard ?? { x: 0, z: -10_000, rotY: 0 });
  if (plan.wantedBoard) root.add(wantedBoard.group);

  /* ------------------------------------------------- activity markers */

  // Built at the first mission's site; the game moves it to whichever one the player has
  // actually reached (`ActivityMarkerVisual.moveTo`) as soon as it knows their progress.
  // Every marker's paint is laid on the asphalt that is really under it (`markerGround`).
  const ground = markerGround(plan);
  const rushMarker = plan.rushMarkers && plan.rushMarkers.length > 0 ? createActivityMarker(plan.rushMarkers[0], RUSH_MARKER, ground) : null;
  if (rushMarker) root.add(rushMarker.group);

  // The circuit missions' door. It never moves: the start line is where the start line is.
  const circuitMarker = plan.circuitMarker ? createActivityMarker(plan.circuitMarker, CIRCUIT_MARKER, ground) : null;
  if (circuitMarker) root.add(circuitMarker.group);

  // The Street Race ring: one, on La Curva's lot. It offers whichever event the player has reached.
  const streetMarkers = (plan.streetMarkers ?? []).map((site) => createActivityMarker(site, STREET_MARKER, ground));
  for (const m of streetMarkers) root.add(m.group);

  // A hologram of high scores beside each ring, in the ring's own neon (`env/leaderboardHologram.ts`).
  // Each follows its marker off the street whenever the marker is taken off it.
  const boards: Array<{ kind: LeaderboardKind; board: LeaderboardHologramVisual; marker: ActivityMarkerVisual }> = [];
  if (rushMarker && plan.rushMarkers) boards.push({ kind: 'rush', board: createLeaderboardHologram(plan.rushMarkers[0], LEADERBOARDS.rush, RUSH_MARKER.tint, ground), marker: rushMarker });
  if (circuitMarker && plan.circuitMarker) boards.push({ kind: 'circuit', board: createLeaderboardHologram(plan.circuitMarker, LEADERBOARDS.circuit, CIRCUIT_MARKER.tint, ground), marker: circuitMarker });
  if (streetMarkers[0] && plan.streetMarkers) boards.push({ kind: 'street', board: createLeaderboardHologram(plan.streetMarkers[0], LEADERBOARDS.street, STREET_RACE.icon.tint, ground), marker: streetMarkers[0] });
  for (const b of boards) root.add(b.board.group);
  // By kind, for the game to paint the boards' rows from the server into.
  const leaderboards: Partial<Record<LeaderboardKind, LeaderboardHologramVisual>> = {};
  for (const b of boards) leaderboards[b.kind] = b.board;

  /* ------------------------------------------------- car meets */

  // The parked cars and the people round them, instanced (`meetVisual.ts`): the lots and the
  // light on them are in the batches above.
  const meets = plan.meets && plan.meets.length > 0 ? createMeetVisual(plan.meets) : null;
  if (meets) root.add(meets.root);

  // People waiting under some of the bus shelters (`busStopCrowdVisual.ts`), built as the camera nears.
  const stopPeople = plan.busStops && plan.busStops.length > 0 ? createBusStopCrowdVisual(busStopCrowds(plan.busStops)) : null;
  if (stopPeople) root.add(stopPeople.root);

  // The people in the parks (`parkPeopleVisual.ts`): the encounters' casts, one crowd.
  const parkEncounters = (plan.parks ?? []).flatMap((p) => p.encounters);
  const parkPeople = parkEncounters.length > 0 ? createParkPeopleVisual(parkEncounters) : null;
  if (parkPeople) root.add(parkPeople.root);
  // The ducks and swans on the parks' lakes and the grass round them (`parkDucksVisual.ts`).
  const parkDucks = plan.parks && plan.parks.length > 0 ? createParkDucksVisual(plan.parks, plan) : null;
  if (parkDucks) root.add(parkDucks.root);

  /* ---------------------------------------------------------------- animation */

  let flickerSlot = -1;
  let flickerValue = 1;
  // The BADKALA panels keep their own, lazier stutter, so the ad never blinks in time with
  // the broken street tubes.
  let adSlot = -1;
  let adValue = 1;

  return {
    root,
    atmosphere,
    rushMarker,
    circuitMarker,
    streetMarkers,
    leaderboards,
    signAtlas: signTex,
    wetRoad,
    moogul: { hemi, key, surface: moogulSurface, walls: b.walls },
    ready: Promise.all([wantedBoard.ready, badkala.ready, screenAtlas.ready, roadArt.ready, foliageArt.ready, barkArt.ready, grassArt.ready, concreteArt.ready, graffiti.ready]).then(() => undefined),
    update(frameDt: number, time: number, camX?: number, camZ?: number, people: CrowdSubject | null = null) {
      if (chunks.length > 0 && camX !== undefined && camZ !== undefined) {
        const far = chunked!.cullDistance;
        for (let i = 0; i < chunks.length; i++) {
          const c = chunks[i];
          c.mesh.visible = Math.hypot(c.x - camX, c.z - camZ) - c.radius < far;
        }
      }
      // The sky, the rain and the storm. First, because a strike rewrites the fog colour and
      // the two scene lights that everything below is then drawn with.
      atmosphere.update(frameDt, time);
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
      // Every screen's frame, scroll, wipe and glitch reads this one clock (`env/screenMaterial.ts`).
      screenMats.time.value = time;
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
      // The activity markers breathe, and quicken as the player closes on one.
      rushMarker?.update(time);
      circuitMarker?.update(time);
      for (let i = 0; i < streetMarkers.length; i++) streetMarkers[i].update(time);
      for (let i = 0; i < boards.length; i++) {
        const b = boards[i];
        b.board.setHidden(!b.marker.group.visible);
        b.board.update(time, camX, camZ);
      }
      // The people at the meets notice the car (`people`); the cars parked there do not move.
      meets?.update(camX, camZ, time, frameDt, people);
      if (stopPeople && camX !== undefined && camZ !== undefined) stopPeople.update(camX, camZ, time, frameDt, people);
      if (parkPeople && camX !== undefined && camZ !== undefined) parkPeople.update(camX, camZ, time, frameDt, people);
      if (parkDucks && camX !== undefined && camZ !== undefined) parkDucks.update(camX, camZ, time, frameDt, people);
      // The lakes' ripple keeps the world's clock.
      lakeTime.value = time;
    },
    dispose() {
      atmosphere.dispose();
      wantedBoard.dispose();
      rushMarker?.dispose();
      circuitMarker?.dispose();
      for (const m of streetMarkers) m.dispose();
      for (const b of boards) b.board.dispose();
      meets?.dispose();
      stopPeople?.dispose();
      parkPeople?.dispose();
      parkDucks?.dispose();
      badkala.dispose();
      screenAtlas.dispose();
      graffiti.dispose();
      roadArt.dispose();
      concreteArt.dispose();
      foliageArt.dispose();
      grassArt.dispose();
      barkArt.dispose();
      wetRoad.dispose();
      scene.remove(root);
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

/** How far off a site's level a ribbon can be and still count as the road it stands on (m). */
const MARKER_SAME_LEVEL = 1;
/** The shoulders are drawn this far over their ribbon's own lift (`trackBuilder.ts`). */
const SHOULDER_LIFT = 0.012;

/**
 * THE TOP OF THE ASPHALT UNDER A MARKER. A site's `y` is the road's level, but no at-grade ribbon
 * is drawn at it: each one carries its own lift so crossings never z-fight (`cityWorld.ts` gives
 * the i-th road `i * 0.004`), which on the metro's long road list reaches well over a decimetre.
 * A ring painted 3.5 cm over `y` was therefore under the tarmac on every road late in the list and
 * only showed on the early ones. So the paint stands on the highest slab any ribbon at the site's
 * level draws within the paint's reach — a crossing that clips the ring lifts it too, rather than
 * cutting a bite out of it.
 */
function markerGround(plan: CityPlan): MarkerGround {
  const proj = createProjection();
  return (x, z, y, reach) => {
    let top = y;
    for (const rb of plan.ribbons) {
      const box = pathBox(rb.path);
      if (x < box.minX - reach || x > box.maxX + reach || z < box.minZ - reach || z > box.maxZ + reach) continue;
      const p = projectOntoPath(rb.path, x, z, proj);
      if (p.dist > p.halfWidth + reach || Math.abs(p.y - y) > MARKER_SAME_LEVEL) continue;
      const lift = rb.lift ?? (rb.kind === 'alley' ? 0.006 : 0);
      top = Math.max(top, p.y + lift + (rb.elevated ? 0 : SHOULDER_LIFT));
    }
    return top;
  };
}

/**
 * Cut a non-indexed geometry into a grid of `cell` metres by triangle centroid, every
 * attribute carried across. Each piece gets its own bounding sphere, which is what the
 * frustum test and the distance cull read. Pieces come back in no particular order.
 */
function splitGeometry(geo: THREE.BufferGeometry, cell: number): THREE.BufferGeometry[] {
  const names = Object.keys(geo.attributes);
  const position = geo.getAttribute('position') as THREE.BufferAttribute;
  const triangles = position.count / 3;
  // Which cell each triangle belongs to, then how many triangles each cell holds.
  const cellOf = new Int32Array(triangles);
  const counts = new Map<number, number>();
  const p = position.array as Float32Array;
  for (let t = 0; t < triangles; t++) {
    const i = t * 9;
    const x = (p[i] + p[i + 3] + p[i + 6]) / 3;
    const z = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
    // Fits an Int32 with room to spare: cells are hundreds of metres, maps a few kilometres.
    const key = (Math.floor(x / cell) + 2048) * 4096 + (Math.floor(z / cell) + 2048);
    cellOf[t] = key;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // One geometry per cell, filled attribute by attribute.
  const parts = new Map<number, { geo: THREE.BufferGeometry; arrays: Float32Array[]; fill: number }>();
  const sizes = names.map((n) => (geo.getAttribute(n) as THREE.BufferAttribute).itemSize);
  for (const [key, n] of counts) {
    const part = new THREE.BufferGeometry();
    const arrays = names.map((_, k) => new Float32Array(n * 3 * sizes[k]));
    names.forEach((name, k) => part.setAttribute(name, new THREE.BufferAttribute(arrays[k], sizes[k])));
    parts.set(key, { geo: part, arrays, fill: 0 });
  }
  const sources = names.map((n) => (geo.getAttribute(n) as THREE.BufferAttribute).array as Float32Array);
  for (let t = 0; t < triangles; t++) {
    const part = parts.get(cellOf[t])!;
    for (let k = 0; k < names.length; k++) {
      const size = sizes[k] * 3;
      part.arrays[k].set(sources[k].subarray(t * size, t * size + size), part.fill * size);
    }
    part.fill++;
  }
  const out: THREE.BufferGeometry[] = [];
  for (const part of parts.values()) {
    part.geo.computeBoundingSphere();
    out.push(part.geo);
  }
  return out;
}
