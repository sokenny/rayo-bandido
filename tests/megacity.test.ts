import { describe, expect, it } from 'vitest';
import { createCityWorld } from '../src/world/cityWorld';
import { cityRecovery } from '../src/world/cityRecovery';
import { MEGACITY } from '../src/world/cityMegastructures';
import { builderStats, createBuilders } from '../src/render/scene/env/builders';
import { buildCity } from '../src/render/scene/env/cityBuilder';

const { plan, layout } = createCityWorld();
describe('occupied city district', () => {
  it('keeps the road and camera corridor empty at every road height', () => {
    for (const rb of plan.ribbons) for (const s of rb.path.samples) {
      for (const m of plan.megastructures!) for (const v of m.volumes) {
        if (v.y0 >= s.y + MEGACITY.cameraClearance - 0.001 || v.y1 <= s.y - 2 + 0.001) continue;
        const dx = Math.max(v.minX - s.x, 0, s.x - v.maxX);
        const dz = Math.max(v.minZ - s.z, 0, s.z - v.maxZ);
        expect(Math.hypot(dx, dz), `${m.tag} seals ${rb.tag}`).toBeGreaterThanOrEqual(s.halfWidth + MEGACITY.roadMargin - 0.01);
      }
    }
  });
  it('has deep occupied passages on the loop with an exposed bridge between them', () => {
    for (const x of [-150, -25, 60]) {
      const building = plan.megastructures!.find(m => x > m.footprint.minX && x < m.footprint.maxX)!;
      const ceiling = building.volumes.find(v => x > v.minX && x < v.maxX && -205 > v.minZ && -205 < v.maxZ && v.y0 >= 24);
      expect(ceiling).toBeDefined();
      expect(building.footprint.maxX - building.footprint.minX).toBeGreaterThan(40);
      expect(building.volumes.some(v => v.y1 > 75)).toBe(true);
    }
    expect(plan.megastructures!.some(m => -76 > m.footprint.minX && -76 < m.footprint.maxX && -205 > m.footprint.minZ && -205 < m.footprint.maxZ)).toBe(false);
  });
  it('uses the exact occupied volumes as height-bounded colliders', () => {
    for (const m of plan.megastructures!) {
      const boxes = layout.colliders.filter(c => c.tag === m.tag);
      expect(boxes).toHaveLength(m.volumes.length);
      m.volumes.forEach((v, i) => {
        expect(boxes[i].minY).toBe(v.y0); expect(boxes[i].maxY).toBe(v.y1);
        expect(boxes[i].minX).toBe(v.minX); expect(boxes[i].maxZ).toBe(v.maxZ);
      });
    }
  });
  it('recovers above and below the same bridge without changing layers', () => {
    const raised = cityRecovery(plan, -70, -205, 15, Math.PI / 2);
    const ground = cityRecovery(plan, -70, -205, 0, 0);
    expect(raised.y).toBeCloseTo(15); expect(ground.y).toBe(0);
    const skyway = plan.ribbons.find(r => r.tag === 'skyway')!.path.samples.find(s => s.y === 24)!;
    expect(cityRecovery(plan, skyway.x, skyway.z, 24, 0).y).toBeCloseTo(24);
  });
  it('batches the district separately and reports the full geometry cost', () => {
    const b = createBuilders(plan); buildCity(b);
    expect(b.districtChunks).toHaveLength(6);
    const stats = builderStats(b);
    console.log('district-inclusive building budget', stats, 'volumes', plan.megastructures!.map(m => m.volumes.length));
    expect(stats.triangles).toBeLessThan(82000);
  });
});
