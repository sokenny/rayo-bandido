import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCityWorld } from '../src/world/cityWorld';
import { createBuilders } from '../src/render/scene/env/builders';
import { buildCity } from '../src/render/scene/env/cityBuilder';
import { applyPalette } from '../src/render/scene/env/palette';
import { ARCHETYPES, buildBuilding, KIT, rngForPlot, skylineField, subdividePlot, type Archetype, type BuildingSpec } from '../src/render/scene/env/buildingKit';
import { createFacadeMaterial, FACADE_CELL_UV, FACADE_GRID, FACADE_STYLES, facadeCell, type FacadeStyle } from '../src/render/scene/env/facadeAtlas';
import { createWindowActivity } from '../src/render/scene/env/windowActivity';

/**
 * The building kit: the promises the city's variety rests on. Every archetype can be drawn,
 * the same plot always gives the same building, the city as a whole uses many silhouettes and
 * many facade patterns, and the facade material's shader patch finds the chunks it splices.
 */

applyPalette('bay');

const PLOT = { minX: 0, maxX: 24, minZ: 0, maxZ: 18 };

function specFor(massing: 1 | 2 | 3 | 4, extra: Partial<BuildingSpec> = {}): BuildingSpec {
  return { zone: 'urban', massing, height: massing === 4 ? 100 : massing === 3 ? 48 : massing === 2 ? 24 : 10, base: 0.22, detail: 'near', ...extra };
}

describe('building kit', () => {
  it('draws every archetype from shared boxes, each with a roof and at least one band', () => {
    for (const archetype of ARCHETYPES) {
      const b = createBuilders(createCityWorld().plan);
      const spec = specFor(archetype === 'low' || archetype === 'shabby' ? 1 : 3, { archetype, ...(archetype === 'landmark' ? { landmark: 0 } : {}) });
      const bld = buildBuilding(b, PLOT, spec, rngForPlot(12, 9));
      expect(bld.archetype, archetype).toBe(archetype);
      expect(bld.volumes.length, archetype).toBeGreaterThan(0);
      for (const v of bld.volumes) expect(v.bands.length, `${archetype} volume bands`).toBeGreaterThan(0);
      expect(b.facade.triangles, `${archetype} facade triangles`).toBeGreaterThan(0);
      expect(b.roof.triangles, `${archetype} roof triangles`).toBeGreaterThan(0);
      expect(bld.top, archetype).toBeGreaterThan(spec.base);
      // A building never leaves its plot sideways by more than a cantilever's reach.
      for (const v of bld.volumes) {
        expect(v.minX).toBeGreaterThan(PLOT.minX - 6);
        expect(v.maxX).toBeLessThan(PLOT.maxX + 6);
      }
    }
  });

  it('is deterministic: the same plot, seed and spec give the same geometry twice', () => {
    const plan = createCityWorld().plan;
    const draw = (): number[] => {
      const b = createBuilders(plan);
      buildBuilding(b, PLOT, specFor(3), rngForPlot(12, 9));
      return [...b.facade.positions, ...b.facade.colors, ...b.facade.cells, ...b.props.positions, ...b.neon.positions];
    };
    expect(draw()).toEqual(draw());
  });

  it('snaps every band edge to a whole floor so roofs never cut a window in half', () => {
    const b = createBuilders(createCityWorld().plan);
    for (const massing of [2, 3, 4] as const) {
      const bld = buildBuilding(b, PLOT, specFor(massing), rngForPlot(massing * 7, 3));
      for (const v of bld.volumes) {
        for (const band of v.bands) {
          const floors = (band.y1 - band.y0) / 3;
          if (v.role === 'link') continue;
          expect(Math.abs(floors - Math.round(floors)), `${bld.archetype} band`).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('cuts a block into plots of uneven size, none thinner than the minimum', () => {
    const inner = { minX: -40, maxX: 40, minZ: -30, maxZ: 30 };
    const plots = subdividePlot(inner, rngForPlot(1, 2), { minPlot: 9, bigStop: 0.3, emptyChance: 0 });
    expect(plots.length).toBeGreaterThan(3);
    const widths = new Set(plots.map((p) => Math.round(p.maxX - p.minX)));
    expect(widths.size, 'plots come in several widths').toBeGreaterThan(2);
    for (const p of plots) {
      expect(p.minX).toBeGreaterThanOrEqual(inner.minX);
      expect(p.maxX).toBeLessThanOrEqual(inner.maxX);
      expect(Math.min(p.maxX - p.minX, p.maxZ - p.minZ)).toBeGreaterThan(3);
    }
  });

  it('has a smooth skyline field in 0..1', () => {
    let lo = 1;
    let hi = 0;
    for (let x = -300; x <= 300; x += 7) {
      for (let z = -300; z <= 300; z += 7) {
        const v = skylineField(x, z);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        // Smooth: a 7 m step never jumps more than a fifth of the range.
        expect(Math.abs(skylineField(x + 7, z) - v)).toBeLessThan(0.2);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    expect(hi - lo).toBeGreaterThan(0.5);
  });
});

describe('the city as a whole', () => {
  const world = createCityWorld();
  const b = createBuilders(world.plan);
  buildCity(b);

  it('draws at least six archetypes and ten facade styles across the city', () => {
    const archetypes = new Set<Archetype>();
    const styles = new Set<FacadeStyle>();
    for (const blk of world.plan.blocks) {
      // Re-run the kit on a plot of each block to count what the city picks; the block's own
      // plot subdivision is inside buildCity, so sample its centre plot here.
      const w = blk.maxX - blk.minX;
      const d = blk.maxZ - blk.minZ;
      if (w < 12 || d < 12) continue;
      const bb = createBuilders(world.plan);
      const bld = buildBuilding(bb, { minX: blk.minX + 3, maxX: blk.maxX - 3, minZ: blk.minZ + 3, maxZ: blk.maxZ - 3 }, specFor(blk.massing, { zone: blk.zone }), rngForPlot((blk.minX + blk.maxX) / 2, (blk.minZ + blk.maxZ) / 2));
      archetypes.add(bld.archetype);
      for (const s of bld.styles) styles.add(s);
    }
    expect(archetypes.size, [...archetypes].join(', ')).toBeGreaterThanOrEqual(6);
    expect(styles.size, [...styles].join(', ')).toBeGreaterThanOrEqual(10);
  });

  it('uses many atlas cells and many tints on the built facades', () => {
    const cells = new Set<string>();
    const tints = new Set<string>();
    const c = b.facade.cells;
    const col = b.facade.colors;
    for (let i = 0; i < c.length; i += 3) cells.add(`${c[i].toFixed(3)},${c[i + 1].toFixed(3)}`);
    for (let i = 0; i < col.length; i += 3) tints.add(`${col[i].toFixed(2)},${col[i + 1].toFixed(2)},${col[i + 2].toFixed(2)}`);
    expect(cells.size, 'atlas cells in use').toBeGreaterThanOrEqual(12);
    expect(tints.size, 'window tints in use').toBeGreaterThan(20);
    // The wall brightness rides along in the third component and never leaves its range.
    for (let i = 2; i < c.length; i += 3) {
      expect(c[i]).toBeGreaterThan(0.5);
      expect(c[i]).toBeLessThan(1.5);
    }
  });

  it('is the same city twice', () => {
    const again = createBuilders(createCityWorld().plan);
    buildCity(again);
    expect(again.facade.positions.length).toBe(b.facade.positions.length);
    expect(again.facade.positions.slice(0, 3000)).toEqual(b.facade.positions.slice(0, 3000));
    expect(again.facade.cells.slice(0, 3000)).toEqual(b.facade.cells.slice(0, 3000));
  });

  it('keeps its draw calls: every facade in the city is one builder', () => {
    expect('facade' in b).toBe(true);
    expect('corp' in b).toBe(false);
  });
});

describe('facade atlas', () => {
  it('names a cell for every style, inside the texture, each on its own', () => {
    const seen = new Set<string>();
    for (const style of FACADE_STYLES) {
      const c = facadeCell(style);
      expect(c.u0).toBeGreaterThanOrEqual(0);
      expect(c.u0 + FACADE_CELL_UV).toBeLessThanOrEqual(1 + 1e-9);
      expect(c.v0).toBeGreaterThanOrEqual(0);
      expect(c.v0 + FACADE_CELL_UV).toBeLessThanOrEqual(1 + 1e-9);
      seen.add(`${c.u0},${c.v0}`);
    }
    expect(seen.size).toBe(FACADE_STYLES.length);
  });

  it('splices the atlas lookup and the tint into the stock shader, after the window activity', () => {
    const atlas = new THREE.Texture();
    const material = createFacadeMaterial(atlas, createWindowActivity(), 1);
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {} as Record<string, unknown>,
    };
    expect(shader.fragmentShader).toContain('#include <map_fragment>');
    expect(shader.fragmentShader).toContain('#include <color_fragment>');
    material.onBeforeCompile(shader as never, null as never);
    const fs = shader.fragmentShader;
    expect(shader.vertexShader).toContain('attribute vec3 aFacadeCell;');
    expect(fs).toContain('fract(rbTileUv)');
    expect(fs).toContain('texture2DGradEXT( map, rbAtlasUv');
    expect(fs).toContain('texture2DGradEXT( emissiveMap, rbAtlasUv');
    expect(fs).toContain('totalEmissiveRadiance *= emissiveColor.rgb * vColor;');
    // The stock chunks it replaces are gone; the window activity's patch is still there.
    expect(fs).not.toContain('#include <map_fragment>');
    expect(fs).not.toContain('#include <color_fragment>');
    expect(fs).not.toContain('#include <emissivemap_fragment>');
    expect(fs).toContain('vec2 winUv = vEmissiveMapUv * uWinGrid;');
    expect(fs.indexOf('texture2DGradEXT( emissiveMap')).toBeLessThan(fs.indexOf('vec2 winUv'));
    expect(shader.uniforms.uWinGrid).toEqual({ value: new THREE.Vector2(FACADE_GRID.cols, FACADE_GRID.rows) });
    expect(material.vertexColors).toBe(true);
  });

  it('exposes the tuning knobs the brief asks for', () => {
    expect(KIT.darkChance.urban).toBeGreaterThan(0);
    expect(Object.keys(KIT.archetypes[3] ?? {}).length).toBeGreaterThanOrEqual(6);
  });
});
