import { MeshBuilder } from './meshBuilder';
import { ARENA_BARRIERS, ARENA_BLOCKS, ARENA_ROADS, ARENA_WALLS } from '../../../world/arenaLayout';

/**
 * One MeshBuilder per material. Every piece of the arena lands in one of these, so the whole
 * environment renders in roughly twenty draw calls no matter how much clutter we add.
 */
export interface EnvBuilders {
  /** Wet asphalt, tinted per zone through vertex colours. */
  road: MeshBuilder;
  /** Road paint: lane lines, plaza circle, hazard chevrons. */
  lane: MeshBuilder;
  /** Ground plane, sidewalks, curbs, perimeter walls. */
  concrete: MeshBuilder;
  /** Facades, one builder per window texture. */
  corp: MeshBuilder;
  urban: MeshBuilder;
  jdm: MeshBuilder;
  /** Flat roofs (dark, no windows). */
  roof: MeshBuilder;
  /** Painted metal: barriers, containers, poles, pipes, AC units, roof boxes. */
  props: MeshBuilder;
  /** Unlit neon, always on. */
  neon: MeshBuilder;
  /** Unlit neon that breathes. */
  neonPulse: MeshBuilder;
  /** Unlit neon that stutters (broken tubes, aircraft beacons). */
  neonFlicker: MeshBuilder;
  /** Additive halos, light pools and wet reflections. */
  glow: MeshBuilder;
  /** Sign panels sampling the neon atlas. */
  signs: MeshBuilder;
  /** The two animated holographic billboards. */
  billA: MeshBuilder;
  billB: MeshBuilder;
}

export function createBuilders(): EnvBuilders {
  return {
    road: new MeshBuilder(true),
    lane: new MeshBuilder(true),
    concrete: new MeshBuilder(true),
    corp: new MeshBuilder(false),
    urban: new MeshBuilder(false),
    jdm: new MeshBuilder(false),
    roof: new MeshBuilder(true),
    props: new MeshBuilder(true),
    neon: new MeshBuilder(true),
    neonPulse: new MeshBuilder(true),
    neonFlicker: new MeshBuilder(true),
    glow: new MeshBuilder(true),
    signs: new MeshBuilder(false),
    billA: new MeshBuilder(false),
    billB: new MeshBuilder(false),
  };
}

/** True when the point is on a drivable surface (road, plaza or alley). */
export function isRoad(x: number, z: number, pad = 0): boolean {
  for (const r of ARENA_ROADS) {
    if (x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad) return true;
  }
  return false;
}

/**
 * True when the point sits inside a collider footprint. Every decorative prop is placed
 * through this test, which is what guarantees the player can never drive through scenery.
 */
export function isSolid(x: number, z: number, pad = 0): boolean {
  for (const b of ARENA_BLOCKS) {
    if (x >= b.minX + pad && x <= b.maxX - pad && z >= b.minZ + pad && z <= b.maxZ - pad) return true;
  }
  for (const w of ARENA_WALLS) {
    if (x >= w.minX + pad && x <= w.maxX - pad && z >= w.minZ + pad && z <= w.maxZ - pad) return true;
  }
  for (const b of ARENA_BARRIERS) {
    if (x >= b.minX + pad && x <= b.maxX - pad && z >= b.minZ + pad && z <= b.maxZ - pad) return true;
  }
  return false;
}

/** Height of the walkable surface at a point: sidewalks and the perimeter band are raised. */
export const SIDEWALK_Y = 0.22;

export function padY(x: number, z: number): number {
  for (const b of ARENA_BLOCKS) {
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return SIDEWALK_Y;
  }
  for (const w of ARENA_WALLS) {
    if (x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ) return SIDEWALK_Y;
  }
  return 0;
}

/** Additive pool of light on the ground (lamp spill, wet neon reflection). */
export function groundGlow(
  b: EnvBuilders,
  x: number,
  z: number,
  sx: number,
  sz: number,
  color: number,
  strength: number,
  y = 0.03,
): void {
  b.glow.color(color, strength);
  b.glow.planeY(x, y, z, sx, sz);
}

/** Additive halo standing in front of a sign or lamp. */
export function halo(
  b: EnvBuilders,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  rotY: number,
  color: number,
  strength: number,
): void {
  b.glow.color(color, strength);
  b.glow.panel(x, y, z, w, h, rotY);
}
