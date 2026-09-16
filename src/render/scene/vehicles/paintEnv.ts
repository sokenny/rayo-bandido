import * as THREE from 'three';

/**
 * The reflection the car paint sees: a night street lit like a photo studio.
 *
 * The world's environment map (`env/textures.ts` `makeEnvTexture`) is a wet-asphalt sheen —
 * black overhead, neon only at the horizon. Flat-shaded panels facing up (hood, roof, deck,
 * wing) reflect that black and the car melts into one dark silhouette. This map keeps the
 * city's colours but puts light where a car's shape needs it: a band of cool sodium-white
 * streetlight across the upper sky that the hood, roof and deck catch from the chase camera,
 * a thin magenta tube above it, and a bright neon horizon for the flanks. Each facet of the
 * low-poly body picks a different part of it, so the edges between facets read as edges.
 *
 * One texture, shared by every car and never disposed (it is 512x256 and lives as long as the
 * page). Assigned as the material's own `envMap`, it overrides `scene.environment` for the
 * paint only. Returns `null` without a DOM (unit tests), where the paint falls back to the scene's.
 */
let shared: THREE.CanvasTexture | null | undefined;

export function carPaintEnv(): THREE.CanvasTexture | null {
  if (shared !== undefined) return shared;
  if (typeof document === 'undefined') return (shared = null);
  const W = 512;
  const H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  if (!ctx) return (shared = null);

  // Row 0 is the zenith, H/2 the horizon, H the nadir.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#1c2146');
  sky.addColorStop(0.3, '#262a58');
  sky.addColorStop(0.46, '#3a2f6e');
  sky.addColorStop(0.5, '#1a1c38');
  sky.addColorStop(0.62, '#0c1024');
  sky.addColorStop(1, '#05060e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Streetlight band ~35-45 degrees up: the long highlight along hood, roof and deck.
  const band = ctx.createLinearGradient(0, H * 0.2, 0, H * 0.3);
  band.addColorStop(0, 'rgba(210,230,255,0)');
  band.addColorStop(0.5, 'rgba(225,238,255,0.95)');
  band.addColorStop(1, 'rgba(210,230,255,0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, H * 0.2, W, H * 0.1);

  // Broken into lamps so the highlight slides and flickers as the car turns, instead of one ring.
  ctx.fillStyle = 'rgba(255,244,220,1)';
  for (let i = 0; i < 6; i++) {
    const x = (i / 6) * W + 14;
    ctx.fillRect(x, H * 0.235, W / 6 - 40, H * 0.03);
  }

  // Thin magenta tube near the zenith: a coloured line on the roof.
  ctx.fillStyle = 'rgba(255,60,210,0.85)';
  ctx.fillRect(0, H * 0.1, W, 3);

  // Neon horizon for the flanks and the rear panel.
  const neon = ['#22d3ee', '#ff2fa8', '#7c2ff0', '#ffb347', '#22d3ee', '#ff5bd0'];
  let x = 0;
  let k = 0;
  while (x < W) {
    const w = 18 + ((k * 37) % 40);
    const h = 10 + ((k * 23) % 22);
    ctx.fillStyle = neon[k % neon.length];
    ctx.globalAlpha = 0.55 + ((k * 13) % 5) * 0.09;
    ctx.fillRect(x, H * 0.5 - h, w, h);
    x += w + 10 + ((k * 17) % 26);
    k++;
  }
  ctx.globalAlpha = 1;

  // The wet road under the horizon throws a softer copy of the neon back up at the sills.
  const road = ctx.createLinearGradient(0, H * 0.5, 0, H * 0.6);
  road.addColorStop(0, 'rgba(90,70,160,0.5)');
  road.addColorStop(1, 'rgba(90,70,160,0)');
  ctx.fillStyle = road;
  ctx.fillRect(0, H * 0.5, W, H * 0.1);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return (shared = tex);
}

/**
 * Car paint: a metallic base under a lacquer clearcoat, both reflecting `carPaintEnv`. The
 * clearcoat is what makes it paint rather than plastic — a sharp, colourless second highlight
 * that brightens toward grazing angles, so the car's outline glints against the street even
 * where the base colour is dark. `params` sets the base (colour, maps, roughness, metalness).
 */
export function carPaintMaterial(params: THREE.MeshStandardMaterialParameters): THREE.MeshPhysicalMaterial {
  const env = carPaintEnv();
  return new THREE.MeshPhysicalMaterial({
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    ...params,
    envMap: env,
    envMapIntensity: 2.3,
  });
}
