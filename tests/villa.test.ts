import { describe, expect, it } from 'vitest';
import { builderStats, createBuilders } from '../src/render/scene/env/builders';
import { buildObelisco } from '../src/render/scene/env/obeliscoBuilder';
import { buildVillas } from '../src/render/scene/env/villaBuilder';
import { inRect } from '../src/world/cityPlan';
import { createCityWorld } from '../src/world/cityWorld';
import { METRO_SPEC, STACK_RECT } from '../src/world/metroSpec';
import { barricadeBox, METRO_OBELISCO, METRO_VILLA, NUEVE_DE_JULIO } from '../src/world/metroVilla';
import { createProjection, projectOntoPath } from '../src/world/track';

/**
 * La bajada (`src/world/metroVilla.ts`): Villa 31 round the metro's east ramp, the 9 de Julio
 * widened out of st-e3, and the Obelisco on its island in the crossing with st-s3.
 */
const { layout, plan } = createCityWorld(METRO_SPEC);
const P = createProjection();
const O = METRO_OBELISCO;

describe('the 9 de Julio', () => {
  const avenue = plan.ribbons.find((rb) => rb.tag === NUEVE_DE_JULIO.tag)!;
  const widthAt = (z: number): number => {
    projectOntoPath(avenue.path, NUEVE_DE_JULIO.x, z, P);
    return P.halfWidth * 2;
  };

  it('is the full width from the ring to the ramp, and st-e3 again either side', () => {
    for (const z of [NUEVE_DE_JULIO.fromZ, 300, O.z, 450, NUEVE_DE_JULIO.toZ]) expect(widthAt(z)).toBeCloseTo(NUEVE_DE_JULIO.width, 3);
    expect(widthAt(100)).toBeCloseTo(13, 3);
    expect(widthAt(700)).toBeCloseTo(13, 3);
  });

  it('lands the descent on it, and leaves The Stack alone', () => {
    const ramp = plan.ribbons.find((rb) => rb.tag === 'ramp-e-s')!;
    const foot = ramp.path.samples[0];
    projectOntoPath(avenue.path, foot.x, foot.z, P);
    expect(P.dist).toBeLessThanOrEqual(P.halfWidth);
    expect(inRect(STACK_RECT, NUEVE_DE_JULIO.x, NUEVE_DE_JULIO.fromZ - NUEVE_DE_JULIO.taper)).toBe(false);
    expect(inRect(STACK_RECT, METRO_VILLA.land.minX, METRO_VILLA.land.minZ)).toBe(false);
  });
});

describe('the Obelisco', () => {
  it('stands in a solid oval plaza in the crossing, with the avenue running round it on both sides', () => {
    const kerb = layout.walls.filter((w) => w.tag === 'obelisco');
    expect(kerb.length).toBeGreaterThanOrEqual(24);
    for (const w of kerb) expect(Math.hypot((w.ax - O.x) / O.plaza.rx, (w.az - O.z) / O.plaza.rz)).toBeCloseTo(1, 3);
    // Either side of the plaza, three lanes and more of avenue.
    for (const side of [-1, 1]) {
      const x = O.x + side * (O.plaza.rx + 10);
      expect(plan.isRoad(x, O.z)).toBe(true);
      expect(plan.isSolid(x, O.z, 1)).toBe(false);
    }
  });

  it('keeps every car in the traffic off the plaza', () => {
    for (const patrol of layout.targetPatrols) {
      for (let i = 0; i < patrol.length; i++) {
        const a = patrol[i];
        const c = patrol[(i + 1) % patrol.length];
        const dx = c.x - a.x;
        const dz = c.z - a.z;
        const len2 = dx * dx + dz * dz || 1;
        // Walk the leg, in the plaza's own units, where 1 is its kerb.
        for (let t = 0; t <= 1; t += 1 / Math.max(1, Math.ceil(Math.sqrt(len2)))) {
          const e = Math.hypot((a.x + dx * t - O.x) / (O.plaza.rx + 3), (a.z + dz * t - O.z) / (O.plaza.rz + 3));
          expect(e, `patrol leg (${a.x}, ${a.z}) -> (${c.x}, ${c.z})`).toBeGreaterThan(1);
        }
      }
    }
  });

  it('leaves the protests\' barricades solid, on the avenue, and out of the traffic and the plaza', () => {
    const overhead = (x: number, z: number): boolean =>
      plan.ribbons.some((rb) => {
        if (!rb.elevated) return false;
        projectOntoPath(rb.path, x, z, P);
        return P.dist <= P.halfWidth + 1 && P.y > 5;
      });
    const boxes = layout.colliders.filter((c) => c.tag === 'barricade');
    expect(boxes.length).toBe(O.barricades.length);
    for (const bc of O.barricades) {
      const r = barricadeBox(bc);
      for (const [x, z] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ]]) expect(plan.isRoad(x, z), `${bc.x}, ${bc.z}`).toBe(true);
      expect(Math.hypot((r.minX - O.x) / O.plaza.rx, (bc.z - O.z) / O.plaza.rz)).toBeGreaterThan(1.05);
      expect(Math.hypot((r.maxX - O.x) / O.plaza.rx, (bc.z - O.z) / O.plaza.rz)).toBeGreaterThan(1.05);
      expect(Math.hypot((bc.x - O.x) / O.plaza.rx, (bc.z - O.z) / O.plaza.rz)).toBeGreaterThan(1.1);
      for (const patrol of layout.targetPatrols) {
        for (let i = 0; i < patrol.length; i++) {
          const a = patrol[i];
          const c = patrol[(i + 1) % patrol.length];
          // The viaduct's traffic passes overhead.
          if (overhead((a.x + c.x) / 2, (a.z + c.z) / 2)) continue;
          // A car's half-width and a margin either side of the leg's centreline.
          const minX = Math.min(a.x, c.x) - 2;
          const maxX = Math.max(a.x, c.x) + 2;
          const minZ = Math.min(a.z, c.z) - 2;
          const maxZ = Math.max(a.z, c.z) + 2;
          const r = barricadeBox(bc);
          expect(r.maxX > minX && r.minX < maxX && r.maxZ > minZ && r.minZ < maxZ, `barricade (${bc.x}, ${bc.z}) on a traffic leg`).toBe(false);
        }
      }
    }
  });

  it('gives the McDonald\'s its corner: no block on it, and the building solid', () => {
    const m = O.mcdonalds;
    for (const blk of plan.blocks) expect(blk.maxX <= m.minX || blk.minX >= m.maxX || blk.maxZ <= m.minZ || blk.minZ >= m.maxZ, blk.tag).toBe(true);
    expect(layout.colliders.some((c) => c.tag === 'mcdonalds')).toBe(true);
    expect(plan.isRoad((m.minX + m.maxX) / 2, (m.minZ + m.maxZ) / 2)).toBe(false);
  });
});

describe('the villa', () => {
  const villaBlocks = plan.blocks.filter((blk) => blk.villa === METRO_VILLA.tag);

  it('takes the blocks round the ramp, and only those, and keeps them solid', () => {
    expect(villaBlocks.length).toBeGreaterThan(8);
    for (const blk of villaBlocks) {
      expect(inRect(METRO_VILLA.land, (blk.minX + blk.maxX) / 2, (blk.minZ + blk.maxZ) / 2)).toBe(true);
      expect(plan.isSolid((blk.minX + blk.maxX) / 2, (blk.minZ + blk.maxZ) / 2)).toBe(true);
    }
    // Both sides of the descent.
    const ramp = plan.ribbons.find((rb) => rb.tag === 'ramp-e-s')!;
    const mid = ramp.path.samples[Math.floor(ramp.path.samples.length / 3)];
    expect(villaBlocks.some((blk) => blk.maxX < mid.x)).toBe(true);
    expect(villaBlocks.some((blk) => blk.minX > mid.x)).toBe(true);
  });

  it('draws the villa and the Obelisco in the city\'s own batches, inside a small budget', () => {
    const b = createBuilders(plan);
    const before = builderStats(b);
    buildVillas(b);
    buildObelisco(b);
    const after = builderStats(b);
    // Only materials the city already draws with: nothing here adds a batch of its own.
    expect(after.drawCalls).toBeLessThanOrEqual(12);
    expect(after.triangles - before.triangles).toBeGreaterThan(20_000);
    // About 200k at the time of writing: the villa's walls are dressed floor by floor.
    expect(after.triangles - before.triangles).toBeLessThan(250_000);
  });
});
