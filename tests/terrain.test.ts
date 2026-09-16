import { describe, expect, it } from 'vitest';
import type { SurfaceSample } from '../src/core/types';
import { BUS_STOP, inRect } from '../src/world/cityPlan';
import { createCityWorld } from '../src/world/cityWorld';
import { BAY_SPEC } from '../src/world/citySpec';
import { CURVA_COURSE } from '../src/world/curvaSpec';
import { METRO_GAS_STATIONS, METRO_GARAGE, METRO_MEET_LOT, METRO_QUAY_Z, METRO_SPEC, METRO_VIADUCT_Y, STACK_RECT } from '../src/world/metroSpec';
import { METRO_HILLS, METRO_MEET_DISTRICT } from '../src/world/metroTerrain';
import { createOpenWorld } from '../src/world/openWorld';
import { createBuses, stepBuses } from '../src/sim/buses';
import { TERRAIN, hillHeight } from '../src/world/terrain';
import { buildTrackPath, maxGrade, segmentCount } from '../src/world/track';

/**
 * TOPOGRAPHY (`src/world/terrain.ts`, `src/world/metroTerrain.ts`): Bandido Metro has hills,
 * and everything that has to stay level does. The contract, in the order things could go
 * wrong: the streets really climb (else nothing was done); no street is steeper than a car
 * should feel, and none kinks; the viaducts, their ramps, the lots, downtown, the meet district
 * and the shore are exactly at y 0 (else a ramp's foot floats, a pillar hangs, a race proved on
 * level ground is run on a slope); every site, shelter, spawn and bus stands on the ground at
 * its own height; and a world that draws no relief is untouched.
 */

const t0 = performance.now();
const { layout, plan } = createCityWorld(METRO_SPEC);
const BUILD_MS = performance.now() - t0;
const terrain = plan.terrain!;
const ground = plan.ribbons.filter((rb) => !rb.elevated);
const elevated = plan.ribbons.filter((rb) => rb.elevated);
const SAMPLE: SurfaceSample = { y: 0, gx: 0, gz: 0 };

/** Steepest grade a street may carry (rise over run): felt, never fought. */
const STREET_GRADE = 0.06;
/** Largest change of grade between two consecutive samples of a street: crests a car rides, never a corner it hops. */
const STREET_KINK = 0.02;

describe('the metro has topography', () => {
  it('builds a terrain and drapes every ground road over it', () => {
    expect(terrain).toBeDefined();
    expect(terrain.flat).toBe(false);
    expect(BUILD_MS).toBeLessThan(6000);
    for (const rb of ground) for (const s of rb.path.samples) expect(s.y, `${rb.tag} at (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`).toBeCloseTo(terrain.heightAt(s.x, s.z), 6);
  });

  it('really climbs: several streets rise metres along their length, and the high ground is where the hills were drawn', () => {
    let peak = 0;
    let climbing = 0;
    for (const rb of ground) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const s of rb.path.samples) {
        lo = Math.min(lo, s.y);
        hi = Math.max(hi, s.y);
      }
      if (hi > peak) peak = hi;
      if (hi - lo >= 5) climbing++;
    }
    expect(peak).toBeGreaterThan(8);
    expect(climbing).toBeGreaterThanOrEqual(8);
    // The crest of each hill is where it was drawn, minus whatever the fence took off it.
    for (const h of METRO_HILLS) expect(terrain.heightAt(h.x, h.z)).toBeGreaterThan(h.height * 0.6);
    // Nothing below sea level, anywhere.
    for (let x = -1000; x <= 1000; x += 40) for (let z = -1000; z <= 1600; z += 40) expect(terrain.heightAt(x, z)).toBeGreaterThanOrEqual(0);
  });

  it('keeps every street gentle and smooth', () => {
    const kinks: string[] = [];
    let steepest = 0;
    let sharpest = 0;
    for (const rb of ground) {
      expect(maxGrade(rb.path), rb.tag).toBeLessThanOrEqual(STREET_GRADE);
      steepest = Math.max(steepest, maxGrade(rb.path));
      const samples = rb.path.samples;
      const segs = segmentCount(rb.path);
      let last = NaN;
      for (let i = 0; i < segs; i++) {
        const a = samples[i];
        const b = samples[(i + 1) % samples.length];
        const run = Math.hypot(b.x - a.x, b.z - a.z);
        if (run < 1) continue;
        const grade = (b.y - a.y) / run;
        if (!Number.isNaN(last)) {
          const kink = Math.abs(grade - last);
          sharpest = Math.max(sharpest, kink);
          if (kink > STREET_KINK) kinks.push(`${rb.tag} at (${a.x.toFixed(0)}, ${a.z.toFixed(0)}): ${(kink * 100).toFixed(2)} %`);
        }
        last = grade;
      }
    }
    expect(kinks, `steepest ${(steepest * 100).toFixed(2)} %, sharpest change ${(sharpest * 100).toFixed(2)} %: ${kinks.join("; ")}`).toEqual([]);
  });

  it('leaves the highways exactly as they were: level ground under every deck and ramp, the viaduct at its height', () => {
    const flatSpec = createCityWorld({ ...METRO_SPEC, terrain: undefined });
    const before = flatSpec.plan.ribbons.filter((rb) => rb.elevated);
    expect(before.length).toBe(elevated.length);
    for (let k = 0; k < elevated.length; k++) {
      const rb = elevated[k];
      const was = before[k];
      expect(rb.tag).toBe(was.tag);
      for (let i = 0; i < rb.path.samples.length; i++) {
        const s = rb.path.samples[i];
        expect(s.y, `${rb.tag} sample ${i}`).toBe(was.path.samples[i].y);
        // The ground under the deck, out to its columns and their footings.
        for (const lat of [-1, 0, 1]) {
          const reach = (s.halfWidth + TERRAIN.ribbonReach) * lat;
          expect(terrain.heightAt(s.x + -s.tz * reach, s.z + s.tx * reach), `${rb.tag} under sample ${i}`).toBe(0);
        }
      }
    }
    const viaduct = elevated.find((rb) => rb.tag === 'viaduct')!;
    for (const s of viaduct.path.samples) expect(s.y).toBe(METRO_VIADUCT_Y);
  });

  it('keeps the lots, downtown, the meet district and the shore level', () => {
    const lots = [METRO_MEET_LOT, ...METRO_GAS_STATIONS.map((g) => g.lot), METRO_GARAGE.lot];
    for (const lot of lots) {
      for (const [x, z] of [
        [lot.minX - TERRAIN.lotPad, lot.minZ - TERRAIN.lotPad],
        [lot.maxX + TERRAIN.lotPad, lot.minZ],
        [lot.maxX, lot.maxZ + TERRAIN.lotPad],
        [lot.minX, lot.maxZ],
        [(lot.minX + lot.maxX) / 2, (lot.minZ + lot.maxZ) / 2],
      ]) {
        expect(terrain.heightAt(x, z), `lot at (${x.toFixed(0)}, ${z.toFixed(0)})`).toBe(0);
      }
    }
    for (const r of [STACK_RECT, ...METRO_MEET_DISTRICT]) {
      for (let x = r.minX; x <= r.maxX; x += 20) for (let z = r.minZ; z <= r.maxZ; z += 20) expect(terrain.heightAt(x, z), `(${x}, ${z})`).toBe(0);
    }
    for (let x = -700; x <= 700; x += 20) for (let z = METRO_QUAY_Z - TERRAIN.shoreBand; z <= METRO_QUAY_Z + 200; z += 20) expect(terrain.heightAt(x, z), `shore (${x}, ${z})`).toBe(0);
  });

  it('runs La Curva on level ground: the whole course and its shortcuts, at every sample', () => {
    for (const spec of [CURVA_COURSE.spec, ...CURVA_COURSE.shortcuts]) {
      const path = buildTrackPath(spec);
      for (const s of path.samples) expect(terrain.heightAt(s.x, s.z), `course at (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`).toBe(0);
    }
  });

  it('answers the surface field with the terrain off the roads, and with the deck on it', () => {
    // The crest of the big hill: not a road, the ground at its height, and a gradient the
    // finite difference of the field agrees with.
    const hill = METRO_HILLS[0];
    let best = { x: hill.x, z: hill.z, y: 0 };
    for (const rb of ground) for (const s of rb.path.samples) if (s.y > best.y) best = { x: s.x, z: s.z, y: s.y };
    layout.surface!.sample(best.x, best.z, 0, SAMPLE);
    expect(SAMPLE.y).toBeCloseTo(best.y, 6);
    const half = { x: best.x + 60, z: best.z + 60 };
    layout.surface!.sample(half.x, half.z, 0, SAMPLE);
    const d = 0.5;
    expect(SAMPLE.gx).toBeCloseTo((terrain.heightAt(half.x + d, half.z) - terrain.heightAt(half.x - d, half.z)) / (2 * d), 6);
    expect(SAMPLE.gz).toBeCloseTo((terrain.heightAt(half.x, half.z + d) - terrain.heightAt(half.x, half.z - d)) / (2 * d), 6);
    // Where the viaduct's west leg crosses av-s2, the deck is still the deck and the street the street.
    layout.surface!.sample(-550, 780, 0, SAMPLE);
    expect(SAMPLE.y).toBe(0);
    layout.surface!.sample(-550, 780, METRO_VIADUCT_Y, SAMPLE);
    expect(SAMPLE.y).toBeCloseTo(METRO_VIADUCT_Y, 3);
  });

  it('stands every site, shelter, spawn and bus on the ground at its own height', () => {
    const at = (x: number, z: number): number => terrain.heightAt(x, z);
    expect(layout.playerSpawn.y).toBeCloseTo(at(layout.playerSpawn.x, layout.playerSpawn.z), 6);
    for (const s of layout.rushSites ?? []) expect(s.y).toBeCloseTo(at(s.x, s.z), 6);
    for (const s of layout.passengerStops ?? []) expect(s.y, s.id).toBeCloseTo(at(s.x, s.z), 6);
    expect(layout.buhoSite!.y).toBe(0);
    expect(layout.groundY!(layout.buhoSite!.x, layout.buhoSite!.z)).toBe(0);
    for (const st of plan.busStops ?? []) expect(st.y).toBeCloseTo(at(st.x, st.z), 6);
    // A shelter's collider reaches up from the ground it stands on, not from y 0.
    const shelters = layout.colliders.filter((c) => c.tag === 'bus-stop');
    expect(shelters.length).toBeGreaterThan(0);
    for (const c of shelters) {
      const y = at((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2);
      expect(c.maxY).toBeCloseTo(y + BUS_STOP.height, 3);
    }
    // Traffic spawns on the road at its own height, hills included.
    for (const s of layout.targetSpawns) {
      layout.surface!.sample(s.x, s.z, s.y ?? 0, SAMPLE);
      expect(Math.abs(SAMPLE.y - (s.y ?? 0)), `spawn at (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`).toBeLessThan(0.15);
    }
    // Buses follow the boulevards up and down.
    const buses = createBuses(layout);
    expect(buses.length).toBeGreaterThan(0);
    for (let k = 0; k < 600; k++) stepBuses(buses, layout, 1 / 60);
    let climbed = 0;
    for (const bus of buses) {
      expect(bus.y).toBeCloseTo(at(bus.x, bus.z), 6);
      if (bus.y > 1) climbed++;
    }
    expect(climbed).toBeGreaterThan(0);
    // Skybridges hang their tier over the street they cross.
    for (const sb of plan.skybridges ?? []) expect(sb.y).toBeGreaterThanOrEqual(at((sb.ax + sb.bx) / 2, (sb.az + sb.bz) / 2) + 10);
  });

  it('puts the doors, the hustlers, the props and the micro-scene anchors of the open world on the ground', () => {
    const world = createOpenWorld();
    const at = (x: number, z: number): number => terrain.heightAt(x, z);
    expect(world.layout.circuitSite!.y).toBeCloseTo(at(world.layout.circuitSite!.x, world.layout.circuitSite!.z), 6);
    for (const s of world.layout.streetSites ?? []) expect(s.y).toBeCloseTo(at(s.x, s.z), 6);
    let raised = 0;
    for (const h of world.layout.hustlerSpots ?? []) {
      expect(h.y).toBeCloseTo(at(h.x, h.z), 6);
      if ((h.y ?? 0) > 0.5) raised++;
    }
    for (const p of world.layout.streetProps ?? []) expect(p.y).toBeCloseTo(at(p.x, p.z), 6);
    for (const a of world.layout.microSceneAnchors ?? []) expect(a.transform.y, a.id).toBeCloseTo(at(a.transform.x, a.transform.z), 6);
    // The hills are populated like the flats: some of everything stands up there.
    expect(raised + (world.layout.streetProps ?? []).filter((p) => p.y > 0.5).length).toBeGreaterThan(0);
    expect((world.layout.microSceneAnchors ?? []).filter((a) => (a.transform.y ?? 0) > 0.5).length).toBeGreaterThan(0);
  });
});

describe('a world without relief is flat', () => {
  it('builds Bandido Bay with no terrain, padY 0 and every ground road at y 0', () => {
    const bay = createCityWorld(BAY_SPEC);
    expect(bay.plan.terrain).toBeUndefined();
    expect(bay.plan.padY(100, 100)).toBe(0);
    expect(bay.layout.groundY!(100, 100)).toBe(0);
    for (const rb of bay.plan.ribbons) if (!rb.elevated) for (const s of rb.path.samples) expect(s.y).toBe(0);
  });

  it('draws a hill as a raised cosine that is 0 at its rim', () => {
    const h = { x: 0, z: 0, rx: 100, rz: 50, height: 10 };
    expect(hillHeight(h, 0, 0)).toBe(10);
    expect(hillHeight(h, 100, 0)).toBe(0);
    expect(hillHeight(h, 0, 50)).toBe(0);
    expect(hillHeight(h, 50, 0)).toBeCloseTo(5, 6);
    expect(inRect(STACK_RECT, 0, 0)).toBe(true);
  });
});
