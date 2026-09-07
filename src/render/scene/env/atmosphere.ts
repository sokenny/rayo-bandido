import * as THREE from 'three';
import { ATMOSPHERE } from '../../../config/tuning';
import { createSkyDome, type SkyDome, type SkyQuality } from './skyDome';
import { createRain, type Rain } from './rain';
import { createStorm, type Storm } from './storm';

/**
 * The atmosphere: the sky, the rain, the storm and everything a flash touches.
 *
 * This is the one place that knows a strike is happening, and it spends that knowledge in
 * four places at once, because a flash that only brightens the sky reads as a light box
 * behind the buildings rather than as weather in the same air the city is standing in:
 *
 *  - THE SKY (`skyDome.ts`) is lit from the direction the strike came from, through the raw
 *    cloud noise, so the bank the bolt is behind shows its structure for a moment.
 *  - THE FOG lifts towards the flash colour. This is the one that does the most work: every
 *    distant building is mostly fog by the time it reaches the eye, so brightening the air
 *    in front of them turns the skyline into silhouettes, exactly as a real strike does.
 *  - THE TWO SCENE LIGHTS lift together, which is what puts the flash onto the near
 *    geometry — the kerbs, the car, the wall the player is drifting past.
 *  - THE ENVIRONMENT MAP lifts hardest of all. Nothing else in this game is as sensitive to
 *    it as the wet road (`roughness 0.24, metalness 0.5`) and the car's paint, so raising it
 *    for a tenth of a second is the "everything wet flares" cue, for free, with no new
 *    material, no new pass and no new light.
 *  - THE RAIN brightens with it, since a night downpour is mostly invisible until something
 *    lights it.
 *
 * COST AND BUDGET
 * Two extra draw calls (the dome, the rain) and no extra render pass. Every value written
 * per frame is a uniform or a scalar on an object that already existed. Nothing here
 * allocates after construction: the colours, vectors and the storm's schedule are all made
 * once. When the tab is hidden the whole thing stops stepping — the uniforms simply hold
 * their last values, so the first visible frame back is the sky the player left.
 */
export interface AtmosphereVisual {
  root: THREE.Group;
  storm: Storm;
  sky: SkyDome;
  rain: Rain;
  /** Advance the storm and the drift, and write everything a flash touches. */
  update(frameDt: number, time: number): void;
  /** Re-read `ATMOSPHERE` after a live tweak (colours, coverage, fog, rain). */
  refresh(): void;
  /** What the debug overlay and `__rb.atmosphere` report. */
  readonly flash: number;
  readonly quality: AtmosphereQualityName;
  dispose(): void;
}

export type AtmosphereQualityName = 'low' | 'medium' | 'high';

export interface AtmospherePreset extends SkyQuality {
  /** Fraction of `ATMOSPHERE.rain.count` this level draws. */
  rainScale: number;
}

/**
 * The three levels differ in sampling, never in colour: the same sky at three resolutions.
 * `low` drops the near cloud layer entirely, which is the single biggest saving and still
 * leaves a moving, lit, non-repeating storm overhead.
 */
export const ATMOSPHERE_PRESETS: Record<AtmosphereQualityName, AtmospherePreset> = {
  low: { octavesFar: 3, octavesNear: 2, twoLayers: false, segments: 24, rainScale: 0 },
  medium: { octavesFar: 3, octavesNear: 2, twoLayers: true, segments: 32, rainScale: 0.45 },
  high: { octavesFar: 4, octavesNear: 3, twoLayers: true, segments: 40, rainScale: 1 },
};

/** `auto` follows the same desktop / touch split the rest of the renderer makes. */
export function resolveQuality(
  setting: string = ATMOSPHERE.quality,
  touch = false,
): AtmosphereQualityName {
  if (setting === 'low' || setting === 'medium' || setting === 'high') return setting;
  return touch ? 'medium' : 'high';
}

export interface AtmosphereOptions {
  /** The scene whose fog this owns. Left alone when the world asked for no fog. */
  scene: THREE.Scene;
  /** The world's own haze colour (`PAL.fog`), which `fogTint` mixes towards the storm's. */
  fogColor: number;
  /** The two scene lights, so a strike reaches the near geometry as well as the sky. */
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  /** Touch device: picks `medium` under `quality: 'auto'`. */
  touch?: boolean;
}

export function createAtmosphere(options: AtmosphereOptions): AtmosphereVisual {
  const { scene, hemi, key } = options;
  const quality = resolveQuality(ATMOSPHERE.quality, options.touch ?? false);
  const preset = ATMOSPHERE_PRESETS[quality];

  const root = new THREE.Group();
  root.name = 'atmosphere';

  const sky = createSkyDome(preset);
  const rain = createRain(Math.round(ATMOSPHERE.rain.count * preset.rainScale));
  const storm = createStorm(ATMOSPHERE.storm);
  root.add(sky.mesh);
  root.add(rain.mesh);

  /* ---------------------------------------------------------------- what a flash lifts */

  // Every "base" below is what the scene looks like with no lightning in it. They are read
  // once and never again, so a strike can be a pure offset instead of a stateful ramp.
  const baseFog = new THREE.Color();
  const flashColor = new THREE.Color(ATMOSPHERE.storm.color);
  const liveFog = new THREE.Color();
  const scratch = new THREE.Color();
  /** The world's haze, mixed `fogTint` of the way towards the storm's. Re-derived on tweak. */
  function deriveFog(): void {
    baseFog.set(options.fogColor);
    scratch.set(ATMOSPHERE.fogColor);
    baseFog.lerp(scratch, Math.max(0, Math.min(1, ATMOSPHERE.fogTint)));
  }
  deriveFog();
  const baseHemi = hemi.intensity;
  const baseKey = key.intensity;
  const baseEnv = scene.environmentIntensity;

  // Denser air than the world asked for, if the config wants it. Applied once, here, so the
  // world specs keep saying what they always said.
  const fog = scene.fog;
  if (fog instanceof THREE.FogExp2) {
    fog.density *= ATMOSPHERE.fogDensityScale;
  } else if (fog instanceof THREE.Fog) {
    fog.far *= ATMOSPHERE.fogFarScale;
  }
  if (fog) fog.color.copy(baseFog);
  sky.uniforms.uFog.value.copy(baseFog);

  /* ---------------------------------------------------------------- camera tracking */

  // The dome and the rain both live where the camera is. They cannot be moved from `update`,
  // which has no camera, so each is placed from its own `onBeforeRender` — after the scene
  // graph has been walked, which is exactly why both write `matrixWorld` directly.
  const prevCam = new THREE.Vector3();
  let havePrev = false;
  let motionX = 0;
  let motionY = 0;
  let motionZ = 0;
  let lastDt = 1 / 60;

  sky.mesh.onBeforeRender = (_renderer, _scene, camera) => {
    const p = camera.position;
    if (havePrev && lastDt > 0) {
      // Camera velocity, in metres per second, smoothed towards the measurement so a
      // single long frame cannot snap every rain streak sideways.
      const k = Math.min(1, lastDt * 10);
      motionX += ((p.x - prevCam.x) / lastDt - motionX) * k;
      motionY += ((p.y - prevCam.y) / lastDt - motionY) * k;
      motionZ += ((p.z - prevCam.z) / lastDt - motionZ) * k;
    }
    prevCam.copy(p);
    havePrev = true;
    sky.mesh.matrixWorld.setPosition(p.x, p.y, p.z);
  };

  rain.mesh.onBeforeRender = (_renderer, _scene, camera) => {
    rain.place(camera, motionX, motionY, motionZ);
  };

  /* ---------------------------------------------------------------- the clock */

  /** How much hidden-tab time is batched into one atmosphere step. See `update`. */
  const HIDDEN_INTERVAL = 0.5;
  // The sky keeps its own clock rather than reading the simulation's, so the drift is
  // unaffected by a restart and stops dead when the tab does.
  let skyTime = 0;
  let flash = 0;
  let hiddenAccum = 0;

  function writeFlash(value: number): void {
    flash = value;
    sky.uniforms.uLight.value.w = value;
    sky.uniforms.uFlashDir.value.set(storm.dirX, storm.dirY, storm.dirZ);

    const S = ATMOSPHERE.storm;
    if (fog) {
      liveFog.copy(baseFog).lerp(flashColor, Math.min(1, value * S.fogLift));
      fog.color.copy(liveFog);
      sky.uniforms.uFog.value.copy(liveFog);
    }
    hemi.intensity = baseHemi * (1 + value * S.lightLift);
    key.intensity = baseKey * (1 + value * S.lightLift);
    // The wet road and the car paint both read this, which is where the flare comes from.
    scene.environmentIntensity = baseEnv * (1 + value * S.envLift);
  }

  writeFlash(0);

  return {
    root,
    storm,
    sky,
    rain,
    get flash() {
      return flash;
    },
    get quality() {
      return quality;
    },

    update(frameDt: number, _time: number) {
      let dt = frameDt > 0 ? frameDt : 0;
      if (typeof document !== 'undefined' && document.hidden) {
        // The animation loop has already stopped for a tab nobody is looking at, so the only
        // thing still calling in here is automation driving frames by hand (`__rb.step`, the
        // capture scripts). Batch its work into one coarse step: the storm and the drift keep
        // the rate they would have had, at a fraction of the per-frame cost, and every uniform
        // holds its last value in between, so a screenshot is never of a half-written sky.
        hiddenAccum += dt;
        if (hiddenAccum < HIDDEN_INTERVAL) return;
        dt = hiddenAccum;
        hiddenAccum = 0;
      }
      lastDt = dt > 0 ? dt : lastDt;
      skyTime += dt;
      sky.uniforms.uTime.value = skyTime;
      storm.step(dt);
      writeFlash(storm.intensity);
      rain.update(skyTime, flash);
    },

    refresh() {
      sky.refresh();
      rain.refresh();
      deriveFog();
      flashColor.set(ATMOSPHERE.storm.color);
      writeFlash(flash);
    },

    dispose() {
      sky.mesh.onBeforeRender = () => {};
      rain.mesh.onBeforeRender = () => {};
      hemi.intensity = baseHemi;
      key.intensity = baseKey;
      scene.environmentIntensity = baseEnv;
      sky.dispose();
      rain.dispose();
    },
  };
}
