import { MeshBuilder } from './meshBuilder';
import type { CityPlan } from '../../../world/cityPlan';

export { SIDEWALK_Y } from '../../../world/cityPlan';

/**
 * One MeshBuilder per material. Every piece of the city lands in one of these, so the whole
 * environment renders in roughly twenty draw calls no matter how much clutter we add.
 *
 * The plan rides along: every builder function reads roads, blocks and the three placement
 * predicates (`isRoad`, `isSolid`, `padY`) from `b.plan`, so the same code dresses the test
 * arena and the racing circuit.
 */
export interface EnvBuilders {
  plan: CityPlan;
  /** Wet asphalt, tinted per zone through vertex colours. */
  road: MeshBuilder;
  /** Road paint: lane lines, plaza circle, hazard chevrons, the start line. */
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

export function createBuilders(plan: CityPlan): EnvBuilders {
  return {
    plan,
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

/** Triangle count and non-empty builder (draw call) count, for the budget test. */
export function builderStats(b: EnvBuilders): { triangles: number; drawCalls: number } {
  let triangles = 0;
  let drawCalls = 0;
  for (const [key, value] of Object.entries(b)) {
    if (key === 'plan') continue;
    const mb = value as MeshBuilder;
    triangles += mb.triangles;
    if (!mb.empty) drawCalls++;
  }
  return { triangles, drawCalls };
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
