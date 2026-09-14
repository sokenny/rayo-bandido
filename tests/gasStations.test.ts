import { describe, expect, it } from 'vitest';
import { builderStats, createBuilders } from '../src/render/scene/env/builders';
import { buildGasStations, textWidth } from '../src/render/scene/env/gasStationBuilder';
import { inRect, type Rect } from '../src/world/cityPlan';
import { clipBlocksToLots, GAS, stationColliders, stationParts } from '../src/world/gasStation';
import { METRO_GAS_STATIONS } from '../src/world/metroSpec';
import { createOpenWorld } from '../src/world/openWorld';

/**
 * The gas stations of Bandido Metro (`src/world/gasStation.ts`, `METRO_GAS_STATIONS`): four
 * corners of blocks given up as forecourts. Scenery, so the rules are about fitting in: off the
 * streets, clear of every door, stop and shelter, the plots behind them cut back rather than
 * built through, and everything drawn standing where it is solid.
 */
const { layout, plan } = createOpenWorld();
const stations = plan.gasStations ?? [];

const overlaps = (a: Rect, b: Rect, e = 0): boolean => a.maxX > b.minX + e && a.minX < b.maxX - e && a.maxZ > b.minZ + e && a.minZ < b.maxZ - e;
const corners = (r: Rect): Array<[number, number]> => [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]];

describe('the gas stations of Bandido Metro', () => {
  it('puts four on the map, in four different parts of it, each with its own brand', () => {
    expect(stations).toHaveLength(4);
    expect(new Set(stations.map((s) => s.brand)).size).toBe(4);
    for (let i = 0; i < stations.length; i++) {
      for (let j = i + 1; j < stations.length; j++) {
        const a = stations[i].lot;
        const b = stations[j].lot;
        expect(Math.hypot((a.minX + a.maxX) / 2 - (b.minX + b.maxX) / 2, (a.minZ + a.maxZ) / 2 - (b.minZ + b.maxZ) / 2)).toBeGreaterThan(400);
      }
    }
  });

  it('stands every lot off the streets, and gives it a street on its front and its corner', () => {
    for (const s of stations) {
      const l = s.lot;
      for (let x = l.minX + 0.5; x < l.maxX; x += 2) {
        for (let z = l.minZ + 0.5; z < l.maxZ; z += 2) expect(plan.isRoad(x, z), `${s.tag} at (${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(false);
      }
      // Just past the pavement on the front and corner sides there is road.
      const out = (side: string): [number, number] => {
        const cx = (l.minX + l.maxX) / 2;
        const cz = (l.minZ + l.maxZ) / 2;
        return side === 'n' ? [cx, l.minZ - 6] : side === 's' ? [cx, l.maxZ + 6] : side === 'e' ? [l.maxX + 6, cz] : [l.minX - 6, cz];
      };
      for (const side of s.streets) expect(plan.isRoad(...out(side)), `${s.tag} ${side}`).toBe(true);
      expect(s.streets).toContain(s.front);
      expect(s.streets).toContain(s.corner);
    }
  });

  it('cuts the plots behind a lot back to its edge, and builds nothing on it', () => {
    for (const s of stations) {
      for (const blk of plan.blocks) expect(overlaps(blk, s.lot, 0.01), `${blk.tag} on ${s.tag}`).toBe(false);
    }
    // A plot is cut, not dropped: what is left each side is kept when it is wide enough to build.
    const cut = clipBlocksToLots([{ minX: 0, maxX: 100, minZ: 0, maxZ: 100, tag: 'b', zone: 'urban', massing: 3 }], [{ minX: 60, maxX: 120, minZ: -10, maxZ: 40 }]);
    expect(cut.map((r) => [r.minX, r.maxX, r.minZ, r.maxZ])).toEqual([[0, 60, 0, 100], [60, 100, 40, 100]]);
    expect(cut.every((r) => r.massing === 3 && r.zone === 'urban')).toBe(true);
  });

  it('keeps every part on its lot and every solid part clear of the others', () => {
    for (const s of stations) {
      const p = stationParts(s);
      const solids: Array<{ r: Rect; tag: string }> = [
        ...p.islands.map((i) => ({ r: i.box as Rect, tag: 'island' })),
        { r: p.shop, tag: 'shop' },
        ...(p.bay ? [{ r: p.bay as Rect, tag: 'bay' }] : []),
        { r: p.dumpster, tag: 'dumpster' },
        { r: p.pylon, tag: 'pylon' },
      ];
      for (const { r, tag } of [...solids, { r: p.canopy as Rect, tag: 'canopy' }]) {
        for (const [x, z] of corners(r)) expect(inRect(s.lot, x, z, 0.01), `${s.tag} ${tag}`).toBe(true);
      }
      for (let i = 0; i < solids.length; i++) {
        for (let j = i + 1; j < solids.length; j++) expect(overlaps(solids[i].r, solids[j].r), `${s.tag} ${solids[i].tag}/${solids[j].tag}`).toBe(false);
      }
      // A car's width and a door either side of every island, under the canopy, and room behind it to drive round.
      const gap = p.canopyLength / p.islands.length - GAS.islandWidth;
      expect(gap).toBeGreaterThan(7);
      expect(p.shopV - GAS.shopDepth / 2 - (p.canopyV + GAS.canopyDepth / 2)).toBeGreaterThan(9);
      // The canopy's columns stand on the islands, and the canopy is high enough for a van.
      for (const c of p.columns) expect(p.islands.some((i) => inRect(i.box, (c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2))).toBe(true);
      expect(GAS.canopyY).toBeGreaterThan(4.5);
    }
  });

  it('makes the station solid where it is drawn', () => {
    for (const s of stations) {
      const c = stationColliders(s);
      for (const box of c.boxes) {
        const found = layout.colliders.some((k) => k.tag === box.tag && k.minX === box.minX && k.maxZ === box.maxZ);
        expect(found, `${s.tag} ${box.tag}`).toBe(true);
      }
      expect(c.walls).toHaveLength(4 - s.streets.length);
    }
  });

  it('keeps clear of every door, marker, shelter and street prop', () => {
    const points: Array<{ x: number; z: number; what: string }> = [
      { ...layout.playerSpawn, what: 'spawn' },
      ...(layout.rushSites ?? []).map((p) => ({ ...p, what: 'rush' })),
      ...(layout.passengerStops ?? []).map((p) => ({ ...p, what: 'passenger' })),
      ...(layout.streetSites ?? []).map((p) => ({ ...p, what: 'street race' })),
      ...(layout.circuitSite ? [{ ...layout.circuitSite, what: 'circuit' }] : []),
      ...(plan.busStops ?? []).map((p) => ({ ...p, what: 'bus stop' })),
      ...(layout.streetProps ?? []).map((p) => ({ x: p.x, z: p.z, what: `prop ${p.kind}` })),
    ];
    for (const s of stations) {
      for (const pt of points) expect(inRect(s.lot, pt.x, pt.z, 3), `${pt.what} at (${pt.x.toFixed(0)}, ${pt.z.toFixed(0)}) in ${s.tag}`).toBe(false);
    }
  });

  it('marks the lots on the minimap as ground you can drive', () => {
    for (const s of stations) expect(layout.minimap?.rects).toContainEqual(s.lot);
  });

  it('draws into the city batches, the price board fits its pylon, and it is the spec that says so', () => {
    expect(stations.map((s) => s.tag)).toEqual(METRO_GAS_STATIONS.map((s) => s.tag));
    const b = createBuilders(plan);
    buildGasStations(b);
    const stats = builderStats(b);
    expect(stats.triangles).toBeGreaterThan(4000);
    expect(stats.triangles).toBeLessThan(80000);
    // The widest row on the board: label, gap and price inside the slab.
    for (const s of stations) {
      for (const price of s.prices) expect(textWidth('REG', 0.36) + textWidth(price.toFixed(1), 0.52) + 0.6).toBeLessThan(GAS.pylon.slab - 0.3);
    }
  });
});
