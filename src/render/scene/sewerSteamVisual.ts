import * as THREE from 'three';
import type { SewerVentDef } from '../../core/types';
import { SEWER_STEAM } from '../../config/tuning';
import { createParticlePool, type ParticlePool } from '../fx/particlePool';
import { MeshBuilder } from './env/meshBuilder';
import { applyHaze } from './env/haze';

/**
 * THE SEWERS, drawn (`src/world/streetProps.ts` places them).
 *
 * The grates are one static mesh — a quad per vent on a small canvas texture — so every grate in
 * the city is one draw call. The steam is one pooled `THREE.Points` (`fx/particlePool.ts`): only
 * the nearest few steaming vents within `SEWER_STEAM.distance` emit, fewer puffs the farther they
 * are, and a car tearing across a column drags a burst of it along. The nearest vents are chosen
 * again only when the camera has moved a few metres.
 */
export interface SewerSteamVisual {
  root: THREE.Group;
  update(frameDt: number, camX: number, camZ: number, carX: number, carZ: number, carVx: number, carVz: number): void;
  /** Covers drawn, vents steaming now, and live steam particles. For the debug readout. */
  stats(): { covers: number; active: number; particles: number };
  reset(): void;
  dispose(): void;
}

/** Above the asphalt and its paint (`cityBuilder.PAINT_Y` is 0.014). */
const COVER_Y = 0.02;
/** Metres the camera may move before the nearest vents are chosen again. */
const RESELECT_MOVE = 6;

export function createSewerSteamVisual(vents: readonly SewerVentDef[], quality: 'low' | 'medium' | 'high'): SewerSteamVisual {
  const root = new THREE.Group();
  root.name = 'sewer-vents';
  root.userData.probeIgnore = true;

  /* ------------------------------------------------------------ the covers */

  const atlas = makeCoverAtlas();
  const coverMat = new THREE.MeshStandardMaterial({
    map: atlas,
    roughness: 0.42,
    metalness: 0.35,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  // Like the street props: a little of its own colour as light, or cast iron on wet asphalt at
  // night is not there at all from the driving camera.
  coverMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.35;',
    );
  };
  applyHaze(coverMat);

  const mb = new MeshBuilder();
  const hx = SEWER_STEAM.grateLength / 2;
  const hz = SEWER_STEAM.grateWidth / 2;
  for (const v of vents) {
    const c = Math.cos(v.yaw);
    const s = Math.sin(v.yaw);
    // Local (lx, lz) to world: +X -> (cos, -sin), +Z -> (sin, cos).
    const wx = (lx: number, lz: number): number => v.x + lx * c + lz * s;
    const wz = (lx: number, lz: number): number => v.z - lx * s + lz * c;
    const y = v.y + COVER_Y;
    mb.quad(wx(-hx, hz), y, wz(-hx, hz), wx(hx, hz), y, wz(hx, hz), wx(hx, -hz), y, wz(hx, -hz), wx(-hx, -hz), y, wz(-hx, -hz));
  }
  let covers: THREE.Mesh | null = null;
  if (!mb.empty) {
    const geometry = mb.build();
    covers = new THREE.Mesh(geometry, coverMat);
    covers.name = 'sewer-covers';
    covers.receiveShadow = false;
    covers.castShadow = false;
    covers.matrixAutoUpdate = false;
    root.add(covers);
  }

  /* ------------------------------------------------------------ the steam */

  const steamers: SewerVentDef[] = vents.filter((v) => v.steam > 0);
  const maxActive = SEWER_STEAM.maxActive[quality];
  const distance = SEWER_STEAM.distance[quality];
  const puffTex = makePuffTexture();
  const pool: ParticlePool = createParticlePool({
    name: 'sewer-steam',
    capacity: Math.ceil(maxActive * SEWER_STEAM.rate * SEWER_STEAM.life * 1.2) + 40,
    map: puffTex,
    blending: THREE.NormalBlending,
    baseSize: 1,
    opacity: SEWER_STEAM.opacity,
    // Buoyant: it keeps climbing as it spreads, so the column stands up instead of pooling.
    accelY: 0.35,
    drag: 0.25,
    endScale: SEWER_STEAM.endScale,
    fadePower: 1.3,
    fadeIn: 0.08,
    fog: true,
  });
  root.add(pool.object);

  const active = new Int32Array(maxActive).fill(-1);
  const accum = new Float32Array(maxActive);
  const lastGust = new Float32Array(steamers.length).fill(-1e3);
  const bestD = new Float32Array(maxActive);
  let activeCount = 0;
  let clock = 0;
  let lastX = Infinity;
  let lastZ = Infinity;

  function reselect(camX: number, camZ: number): void {
    // The nearest `maxActive` within range, by insertion into a short sorted list.
    const d2max = distance * distance;
    let n = 0;
    const prev = active.slice(0, activeCount);
    const prevAcc = accum.slice(0, activeCount);
    for (let i = 0; i < steamers.length; i++) {
      const dx = steamers[i].x - camX;
      const dz = steamers[i].z - camZ;
      const d2 = dx * dx + dz * dz;
      if (d2 > d2max) continue;
      if (n === maxActive && d2 >= bestD[n - 1]) continue;
      let j = n < maxActive ? n++ : n - 1;
      while (j > 0 && bestD[j - 1] > d2) {
        bestD[j] = bestD[j - 1];
        active[j] = active[j - 1];
        j--;
      }
      bestD[j] = d2;
      active[j] = i;
    }
    // A vent that stays chosen keeps its half-made puff.
    for (let j = 0; j < n; j++) {
      const k = prev.indexOf(active[j]);
      accum[j] = k >= 0 ? prevAcc[k] : Math.random();
    }
    activeCount = n;
  }

  const puff = (v: SewerVentDef, vx: number, vy: number, vz: number, size: number, life: number): void => {
    // Anywhere over the bars, a little in from the frame.
    const along = (Math.random() - 0.5) * SEWER_STEAM.grateLength * 0.8;
    const across = (Math.random() - 0.5) * SEWER_STEAM.grateWidth * 0.6;
    const x = v.x + along * Math.cos(v.yaw) + across * Math.sin(v.yaw);
    const z = v.z - along * Math.sin(v.yaw) + across * Math.cos(v.yaw);
    // Cool grey with a little blue: it takes the street's neon from the fog and the lights round it.
    const shade = 0.66 + Math.random() * 0.16;
    pool.spawn(x, v.y + 0.08, z, vx, vy, vz, size, life, shade * 0.95, shade, shade * 1.06);
  };

  return {
    root,
    update(frameDt, camX, camZ, carX, carZ, carVx, carVz) {
      if (steamers.length === 0) return;
      clock += frameDt;
      if (Math.hypot(camX - lastX, camZ - lastZ) > RESELECT_MOVE) {
        reselect(camX, camZ);
        lastX = camX;
        lastZ = camZ;
      }
      const carSpeed = Math.hypot(carVx, carVz);
      for (let j = 0; j < activeCount; j++) {
        const i = active[j];
        const v = steamers[i];
        const dx = v.x - camX;
        const dz = v.z - camZ;
        // Thinner the farther it is: a far column is a wisp, not a wall.
        const near = 1 - Math.min(1, Math.sqrt(dx * dx + dz * dz) / distance);
        const rate = SEWER_STEAM.rate * v.steam * (0.35 + 0.65 * near);
        accum[j] += rate * frameDt;
        let count = 0;
        while (accum[j] >= 1 && count < 4) {
          accum[j] -= 1;
          count++;
          const rise = SEWER_STEAM.rise * (0.7 + Math.random() * 0.6) * (0.7 + 0.3 * v.steam);
          puff(
            v,
            SEWER_STEAM.windX + (Math.random() - 0.5) * 0.5,
            rise,
            SEWER_STEAM.windZ + (Math.random() - 0.5) * 0.5,
            SEWER_STEAM.size * (0.8 + Math.random() * 0.4),
            SEWER_STEAM.life * (0.75 + Math.random() * 0.5),
          );
        }
        if (accum[j] > 1) accum[j] = 1;

        // A car ripping through the column drags a burst of it along.
        if (carSpeed > SEWER_STEAM.gustSpeed && clock - lastGust[i] > 0.6) {
          const gx = carX - v.x;
          const gz = carZ - v.z;
          if (gx * gx + gz * gz < 2.2 * 2.2) {
            lastGust[i] = clock;
            for (let k = 0; k < 10; k++) {
              puff(
                v,
                carVx * (0.2 + Math.random() * 0.25) + (Math.random() - 0.5) * 2,
                0.6 + Math.random() * 1.2,
                carVz * (0.2 + Math.random() * 0.25) + (Math.random() - 0.5) * 2,
                SEWER_STEAM.size * (1 + Math.random() * 0.6),
                SEWER_STEAM.life * (0.4 + Math.random() * 0.3),
              );
            }
          }
        }
      }
      pool.update(frameDt);
    },
    stats() {
      return { covers: vents.length, active: activeCount, particles: pool.live };
    },
    reset() {
      pool.reset();
      lastGust.fill(-1e3);
    },
    dispose() {
      if (covers) covers.geometry.dispose();
      coverMat.dispose();
      atlas.dispose();
      pool.dispose();
      puffTex.dispose();
    },
  };
}

/** A storm grate, as drawn along the kerb: a heavy frame, bars across the flow over a black drop. */
function makeCoverAtlas(): THREE.CanvasTexture {
  const W = 256;
  const H = 112;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;

  // The frame, worn lighter along its edges.
  g.fillStyle = '#44474a';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#5a5e61';
  g.fillRect(0, 0, W, 5);
  g.fillRect(0, H - 5, W, 5);
  // The drop, with a faint wet glint deep down.
  const drop = g.createLinearGradient(0, 14, 0, H - 14);
  drop.addColorStop(0, '#050506');
  drop.addColorStop(0.7, '#0b0c0e');
  drop.addColorStop(1, '#16191c');
  g.fillStyle = drop;
  g.fillRect(14, 14, W - 28, H - 28);
  // Bars across the flow, a stiffener down the middle, bevelled with a light top edge.
  const bars = 16;
  const barW = 7;
  for (let i = 0; i <= bars; i++) {
    const x = 14 + ((W - 28 - barW) * i) / bars;
    g.fillStyle = '#5b5f62';
    g.fillRect(x, 14, barW, H - 28);
    g.fillStyle = '#7b8084';
    g.fillRect(x, 14, 2, H - 28);
  }
  g.fillStyle = '#5b5f62';
  g.fillRect(14, H / 2 - 4, W - 28, 8);
  g.fillStyle = '#7b8084';
  g.fillRect(14, H / 2 - 4, W - 28, 2);
  // Rust run-off and grime from the kerb side.
  g.fillStyle = 'rgba(120,70,40,0.32)';
  g.fillRect(0, 0, W, 12);
  g.fillStyle = 'rgba(120,70,40,0.2)';
  g.fillRect(30, H - 24, 90, 14);
  g.fillRect(170, 10, 60, 20);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.name = 'sewer-grate';
  return tex;
}

/** A soft, slightly lumpy puff for the steam. */
function makePuffTexture(): THREE.CanvasTexture {
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d')!;
  const blob = (x: number, y: number, r: number, a: number): void => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.5, `rgba(240,242,248,${a * 0.45})`);
    grad.addColorStop(1, 'rgba(230,232,240,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  };
  blob(32, 32, 30, 0.6);
  blob(24, 28, 16, 0.35);
  blob(40, 36, 14, 0.3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.name = 'sewer-steam';
  return tex;
}
