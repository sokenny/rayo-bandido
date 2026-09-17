import type { RoundaboutSpec } from '../../../world/metroSouth';
import { GRASS_TILE, groundGlow, halo, type EnvBuilders } from './builders';
import type { MeshBuilder } from './meshBuilder';
import { PAL } from './palette';
import { screenPanel } from './screenBuilder';

/**
 * THE ROUNDABOUTS, drawn (`world/metroSouth.ts`): the islands of the south's three plazas.
 *
 * Each is a kerb, a ring of lawn, a paved ring walk with its lamps and a lawn inside it, laid
 * over the hill it stands on (La Loma and El Bajo roll under two of them), and in the middle:
 *
 *   - PLAZA ESTRELLA: the pool and floodlights under the giant steel flower, which is not static
 *     scenery (`render/scene/floralisVisual.ts`: it opens when struck by lightning),
 *   - LAS PANTALLAS: a four-sided tower on the corner of the screens district, BADKALA WANTED
 *     on two faces and LED screens on the other two,
 *   - EL PUERTO: a short lighthouse, white and red, its lamp going round over the water.
 *
 * Only the island's kerb is solid (`cityWorld.ts`); nothing on it is in reach of a car.
 */

/** Sides of the rings. */
const SIDES = 40;

export function buildRoundabouts(b: EnvBuilders): void {
  for (const r of b.plan.roundabouts ?? []) {
    const top = buildIsland(b, r);
    if (r.monument === 'flower') buildFlower(b, r, top);
    else if (r.monument === 'screens') buildScreens(b, r, top);
    else buildBeacon(b, r, top);
  }
}

/* ------------------------------------------------------------------ the island */

/** A flat ring from radius `r0` in to `r1` (0: a disc), each vertex `lift` over the ground under it. */
function drapedRing(b: EnvBuilders, mb: MeshBuilder, x: number, z: number, r0: number, r1: number, lift: number, tile = 0): void {
  const y = (px: number, pz: number): number => b.plan.padY(px, pz) + lift;
  const uv = (px: number, pz: number): [number, number] => (tile > 0 ? [px / tile, pz / tile] : [0, 0]);
  for (let i = 0; i < SIDES; i++) {
    const a0 = (i / SIDES) * Math.PI * 2;
    const a1 = ((i + 1) / SIDES) * Math.PI * 2;
    const ox0 = x + Math.cos(a0) * r0;
    const oz0 = z + Math.sin(a0) * r0;
    const ox1 = x + Math.cos(a1) * r0;
    const oz1 = z + Math.sin(a1) * r0;
    const ix0 = x + Math.cos(a0) * r1;
    const iz0 = z + Math.sin(a0) * r1;
    const ix1 = x + Math.cos(a1) * r1;
    const iz1 = z + Math.sin(a1) * r1;
    const [u0, v0] = uv(ox0, oz0);
    const [u1, v1] = uv(ix1, iz1);
    // Facing up: outer a0, inner a0, inner a1, outer a1 (as `obeliscoBuilder.ovalRing`).
    mb.quad(ox0, y(ox0, oz0), oz0, ix0, y(ix0, iz0), iz0, ix1, y(ix1, iz1), iz1, ox1, y(ox1, oz1), oz1, u0, v0, u1, v1);
  }
}

/** Returns the height of the lawn at the island's centre. */
function buildIsland(b: EnvBuilders, r: RoundaboutSpec): number {
  const R = r.island;
  const kerb = 0.3;
  // The kerb's face, from under the road to the lawn, following the ground round the ring.
  b.wall.color(PAL.curb, 1.1);
  for (let i = 0; i < SIDES; i++) {
    const a0 = (i / SIDES) * Math.PI * 2;
    const a1 = ((i + 1) / SIDES) * Math.PI * 2;
    const px = r.x + Math.cos(a0) * R;
    const pz = r.z + Math.sin(a0) * R;
    const qx = r.x + Math.cos(a1) * R;
    const qz = r.z + Math.sin(a1) * R;
    const pg = b.plan.padY(px, pz);
    const qg = b.plan.padY(qx, qz);
    b.wall.quad(qx, qg - 0.1, qz, px, pg - 0.1, pz, px, pg + kerb, pz, qx, qg + kerb, qz, 0, 0, 1, 1);
  }
  b.concrete.color(PAL.sidewalk, 1.1);
  drapedRing(b, b.concrete, r.x, r.z, R, R - 0.8, kerb + 0.004);
  // Outer lawn, ring walk, inner lawn.
  const walkOut = R * 0.62;
  const walkIn = walkOut - 3.2;
  b.grass.color(PAL.foliage, 0.95);
  drapedRing(b, b.grass, r.x, r.z, R - 0.8, walkOut, kerb, GRASS_TILE);
  b.concrete.color(PAL.sidewalk, 1.25);
  drapedRing(b, b.concrete, r.x, r.z, walkOut, walkIn, kerb + 0.01);
  b.grass.color(PAL.foliage, 0.9);
  drapedRing(b, b.grass, r.x, r.z, walkIn, 0, kerb, GRASS_TILE);
  // Lamps round the walk.
  const lamps = Math.max(6, Math.round((walkOut * Math.PI * 2) / 16));
  for (let k = 0; k < lamps; k++) {
    const a = (k / lamps) * Math.PI * 2 + 0.2;
    const lx = r.x + Math.cos(a) * (walkOut - 1.6);
    const lz = r.z + Math.sin(a) * (walkOut - 1.6);
    const ly = b.plan.padY(lx, lz) + kerb;
    b.props.color(0x22252a, 1);
    b.props.tube(lx, ly, lz, lx, ly + 4.2, lz, 0.14);
    b.neon.color(0xffe2b0, 0.85);
    b.neon.box(lx, ly + 4.3, lz, 0.45, 0.2, 0.45);
    groundGlow(b, lx, lz, 9, 9, 0xffd9a0, 0.06, kerb + 0.03);
  }
  return b.plan.padY(r.x, r.z) + kerb;
}

/* ------------------------------------------------------------------ Plaza Estrella */

/**
 * Under LA FLOR (`render/scene/floralisVisual.ts`, which draws the flower itself and answers the
 * lightning): its pool, and the floodlights round it aimed up at the petals.
 */
function buildFlower(b: EnvBuilders, r: RoundaboutSpec, top: number): void {
  const { x, z } = r;
  // The pool: a low kerb and dark water under the flower.
  const pool = 17;
  b.wall.color(PAL.curb, 1);
  for (let i = 0; i < SIDES; i++) {
    const a0 = (i / SIDES) * Math.PI * 2;
    const a1 = ((i + 1) / SIDES) * Math.PI * 2;
    b.wall.quad(
      x + Math.cos(a1) * pool, top, z + Math.sin(a1) * pool,
      x + Math.cos(a0) * pool, top, z + Math.sin(a0) * pool,
      x + Math.cos(a0) * pool, top + 0.6, z + Math.sin(a0) * pool,
      x + Math.cos(a1) * pool, top + 0.6, z + Math.sin(a1) * pool,
      0, 0, 1, 1,
    );
  }
  b.concrete.color(PAL.sidewalk, 1.2);
  flatRing(b.concrete, x, z, pool, pool - 0.8, top + 0.6);
  b.road.color(0x0a141d, 0.55);
  flatRing(b.road, x, z, pool - 0.8, 0, top + 0.4);
  const hubY = top + 9;
  // Floodlights round the pool, up at the petals.
  const lights = 10;
  for (let k = 0; k < lights; k++) {
    const a = (k / lights) * Math.PI * 2 + 0.3;
    const fx = x + Math.cos(a) * (pool + 3);
    const fz = z + Math.sin(a) * (pool + 3);
    const fy = b.plan.padY(fx, fz) + 0.3;
    b.props.color(0x1c1f24, 1);
    b.props.box(fx, fy + 0.3, fz, 0.8, 0.6, 0.8);
    b.glow.color(k % 2 === 0 ? 0xdfeaff : 0xffd9a8, 0.05);
    b.glow.tube(fx, fy + 0.6, fz, x + (fx - x) * 0.4, hubY + 16, z + (fz - z) * 0.4, 3.5);
  }
  groundGlow(b, x, z, pool * 2.2, pool * 2.2, 0xdfeaff, 0.05, 0.62);
}

/** A flat ring at one height (the pool: level, whatever the hill does). */
function flatRing(mb: MeshBuilder, x: number, z: number, r0: number, r1: number, y: number): void {
  for (let i = 0; i < SIDES; i++) {
    const a0 = (i / SIDES) * Math.PI * 2;
    const a1 = ((i + 1) / SIDES) * Math.PI * 2;
    mb.quad(
      x + Math.cos(a0) * r0, y, z + Math.sin(a0) * r0,
      x + Math.cos(a0) * r1, y, z + Math.sin(a0) * r1,
      x + Math.cos(a1) * r1, y, z + Math.sin(a1) * r1,
      x + Math.cos(a1) * r0, y, z + Math.sin(a1) * r0,
      0, 0, 1, 1,
    );
  }
}

/* ------------------------------------------------------------------ Las Pantallas */

function buildScreens(b: EnvBuilders, r: RoundaboutSpec, top: number): void {
  const { x, z } = r;
  const half = 3.4;
  const h = 16;
  b.concrete.color(PAL.sidewalk, 0.95);
  b.concrete.box(x, top + 0.6, z, half * 2 + 2, 1.2, half * 2 + 2);
  b.props.color(0x16181c, 1);
  b.props.box(x, top + 1.2 + h / 2 + 1, z, half * 2 - 0.2, h + 2, half * 2 - 0.2);
  // A screen on each face, two tiers: a tall one and a ticker over it.
  for (let k = 0; k < 4; k++) {
    const rotY = (k * Math.PI) / 2;
    const nx = Math.sin(rotY);
    const nz = Math.cos(rotY);
    const px = x + nx * (half + 0.02);
    const pz = z + nz * (half + 0.02);
    // Two opposite faces carry the BADKALA WANTED poster (`badkalaPoster.ts`), the other two a screen.
    if (k % 2 === 0) b.badkala.panel(px, top + 1.2 + 1 + (h - 3) / 2, pz, half * 2 - 0.6, h - 3, rotY);
    else screenPanel(b.screens, 'holo-column', px, top + 1.2 + 1 + (h - 3) / 2, pz, half * 2 - 0.6, h - 3, rotY);
    b.neon.color(k % 2 === 0 ? PAL.neonMagenta : PAL.neonCyan, 1);
    b.neon.box(px, top + 1.2 + h, pz, half * 2 - 0.4, 0.5, 0.12);
    halo(b, x + nx * (half + 1.5), top + 1.2 + h / 2, z + nz * (half + 1.5), half * 3, h * 1.2, rotY, k % 2 === 0 ? PAL.neonMagenta : PAL.neonCyan, 0.06);
  }
  groundGlow(b, x, z, r.island * 1.4, r.island * 1.4, PAL.neonMagenta, 0.07, 0.34);
}

/* ------------------------------------------------------------------ El Puerto */

function buildBeacon(b: EnvBuilders, r: RoundaboutSpec, top: number): void {
  const { x, z } = r;
  b.concrete.color(PAL.sidewalk, 0.95);
  b.concrete.box(x, top + 0.5, z, 6, 1, 6);
  // The tower, in bands: white, red, white, tapering.
  const bands = [0xe8e4dc, 0xb8121b, 0xe8e4dc, 0xb8121b, 0xe8e4dc];
  let y = top + 1;
  for (let i = 0; i < bands.length; i++) {
    const w = 3.6 - i * 0.35;
    b.props.color(bands[i], 1);
    b.props.box(x, y + 1.3, z, w, 2.6, w);
    y += 2.6;
  }
  // The lantern: a gallery, the glass, the lamp.
  b.props.color(0x1c1f24, 1);
  b.props.box(x, y + 0.15, z, 3.4, 0.3, 3.4);
  b.neonFlicker.color(0xfff1c0, 1);
  b.neonFlicker.box(x, y + 1.2, z, 1.6, 1.8, 1.6);
  b.props.color(0x1c1f24, 1);
  b.props.box(x, y + 2.4, z, 2.2, 0.6, 2.2);
  halo(b, x, y + 1.2, z, 12, 6, 0, 0xffe6a0, 0.12);
  halo(b, x, y + 1.2, z, 12, 6, Math.PI / 2, 0xffe6a0, 0.12);
  groundGlow(b, x, z, 18, 18, 0xffe6a0, 0.05, 0.34);
}
