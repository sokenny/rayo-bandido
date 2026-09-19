import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBodyGeometry, createCarVisual } from '../src/render/scene/carVisual';
import { DECAL_ZONES, PAINT_FINISHES, STOCK_LOADOUT, cloneLoadout, sanitizeLoadout, type CarLoadout } from '../src/core/loadout';
import { partsOf, validateCatalogue } from '../src/content/carParts';
import {
  DECAL_PAINTERS,
  DECAL_PLACES,
  FINISH_PARAMS,
  VINYL_PAINTERS,
  composePaint,
  createCarPaint,
  paintKey,
} from '../src/render/scene/vehicles/paintShop';
import {
  ATLAS_SIZE,
  FRAME_IDS,
  NEUTRAL_CELL,
  PAINT_FRAMES,
  PLATE_CELL,
  UNDER_CELL,
  type AtlasRect,
} from '../src/render/scene/vehicles/bodyUVs';
import { PLATE_MOUNT, PLATE_STYLES, buildPlateGeometry, formatPlateText } from '../src/render/scene/vehicles/plate';
import { carPaintMaterial } from '../src/render/scene/vehicles/paintEnv';

/** Canvas pixel of a uv (the texture is flipped: v = 1 is the canvas's top row). */
const toPx = (u: number, v: number): [number, number] => [u * ATLAS_SIZE, (1 - v) * ATLAS_SIZE];
const inRect = (r: AtlasRect, [x, y]: [number, number]): boolean => x >= r.x - 1e-3 && x <= r.x + r.w + 1e-3 && y >= r.y - 1e-3 && y <= r.y + r.h + 1e-3;

/** Every triangle of `g`: its three uvs in canvas pixels and its mean normal. */
function triangles(g: THREE.BufferGeometry): Array<{ px: Array<[number, number]>; n: THREE.Vector3; p: THREE.Vector3[] }> {
  const uv = g.getAttribute('uv');
  const normal = g.getAttribute('normal');
  const position = g.getAttribute('position');
  const out = [];
  for (let t = 0; t < position.count; t += 3) {
    const n = new THREE.Vector3();
    const px: Array<[number, number]> = [];
    const p: THREE.Vector3[] = [];
    for (let k = 0; k < 3; k++) {
      n.x += normal.getX(t + k);
      n.y += normal.getY(t + k);
      n.z += normal.getZ(t + k);
      px.push(toPx(uv.getX(t + k), uv.getY(t + k)));
      p.push(new THREE.Vector3(position.getX(t + k), position.getY(t + k), position.getZ(t + k)));
    }
    out.push({ px, n: n.normalize(), p });
  }
  return out;
}

const withPlate = (style: string): CarLoadout => {
  const l = cloneLoadout(STOCK_LOADOUT);
  l.plate.style = style;
  return sanitizeLoadout(l);
};

describe('the paint catalogue and its painters', () => {
  it('has a painter for every vinyl and decal the catalogue sells, and nothing the catalogue does not', () => {
    expect(validateCatalogue()).toEqual([]);
    expect(Object.keys(VINYL_PAINTERS).sort()).toEqual(partsOf('vinyls').map((p) => p.id).sort());
    expect(Object.keys(DECAL_PAINTERS).sort()).toEqual(partsOf('decals').map((p) => p.id).sort());
    expect([...PLATE_STYLES].sort()).toEqual(partsOf('plate').map((p) => p.id).sort());
    expect(partsOf('vinyls').length).toBeGreaterThanOrEqual(8);
    expect(partsOf('plate').length).toBeGreaterThanOrEqual(4);
  });

  it('places every decal zone', () => {
    for (const zone of DECAL_ZONES) expect(DECAL_PLACES[zone], zone).toBeDefined();
  });

  it('keeps the stock finish exactly what the car is built with', () => {
    const built = carPaintMaterial({ color: 0xffffff, roughness: 0.26, metalness: 0.62 });
    const m = FINISH_PARAMS.metallic;
    expect([m.metalness, m.roughness, m.clearcoat, m.clearcoatRoughness, m.iridescence, m.envMapIntensity]).toEqual([
      built.metalness,
      built.roughness,
      built.clearcoat,
      built.clearcoatRoughness,
      built.iridescence,
      built.envMapIntensity,
    ]);
    built.dispose();
  });
});

describe('the body atlas uvs', () => {
  for (const openCabin of [true, false]) {
    it(`puts every stock triangle wholly inside one region (${openCabin ? 'open' : 'closed'} cabin)`, () => {
      const g = buildBodyGeometry(openCabin);
      const regions = [...FRAME_IDS.map((id) => PAINT_FRAMES[id].rect), PLATE_CELL, NEUTRAL_CELL, UNDER_CELL];
      for (const t of triangles(g)) {
        const home = regions.filter((r) => t.px.every((p) => inRect(r, p)));
        expect(home.length).toBe(1);
      }
      g.dispose();
    });
  }

  it('keeps side vinyls off the roof and roof paint off the flanks', () => {
    const g = buildBodyGeometry(true);
    const left = PAINT_FRAMES.left.rect;
    const right = PAINT_FRAMES.right.rect;
    const top = PAINT_FRAMES.top.rect;
    for (const t of triangles(g)) {
      const onFlank = t.px.every((p) => inRect(left, p) || inRect(right, p));
      const onTop = t.px.every((p) => inRect(top, p));
      if (t.n.y > 0.72) expect(onFlank, 'an up-facing face on a flank').toBe(false);
      if (Math.abs(t.n.x) > 0.72) expect(onTop, 'a side-facing face on the top').toBe(false);
      if (t.n.x < -0.72 && !t.px.every((p) => inRect(NEUTRAL_CELL, p))) expect(t.px.every((p) => inRect(left, p))).toBe(true);
      if (t.n.x > 0.72 && !t.px.every((p) => inRect(NEUTRAL_CELL, p))) expect(t.px.every((p) => inRect(right, p))).toBe(true);
    }
    g.dispose();
  });

  it('runs the nose to the left of the left flank and to the right of the right one, so text reads on both', () => {
    const g = buildBodyGeometry(true);
    const noseward = (side: -1 | 1): number => {
      // The canvas x of the frontmost and rearmost vertices of that flank.
      let front = { z: Infinity, x: 0 };
      let back = { z: -Infinity, x: 0 };
      for (const t of triangles(g)) {
        if (Math.sign(t.n.x) !== side || Math.abs(t.n.x) < 0.9) continue;
        t.p.forEach((p, k) => {
          if (p.z < front.z) front = { z: p.z, x: t.px[k][0] };
          if (p.z > back.z) back = { z: p.z, x: t.px[k][0] };
        });
      }
      return Math.sign(back.x - front.x);
    };
    expect(noseward(-1)).toBe(1); // left flank: nose at canvas left, tail to the right
    expect(noseward(1)).toBe(-1); // right flank: mirrored
    g.dispose();
  });

  for (const style of PLATE_STYLES) {
    it(`maps ${style}'s face, and only its face, edge to edge onto the plate cell`, () => {
      const g = buildBodyGeometry(true, withPlate(style));
      const onPlate = triangles(g).filter((t) => t.px.every((p) => inRect(PLATE_CELL, p)));
      expect(onPlate.length).toBe(2);
      const xs = onPlate.flatMap((t) => t.px.map((p) => p[0]));
      const ys = onPlate.flatMap((t) => t.px.map((p) => p[1]));
      expect(Math.min(...xs)).toBeCloseTo(PLATE_CELL.x + 1, 3);
      expect(Math.max(...xs)).toBeCloseTo(PLATE_CELL.x + PLATE_CELL.w - 1, 3);
      expect(Math.min(...ys)).toBeCloseTo(PLATE_CELL.y + 1, 3);
      expect(Math.max(...ys)).toBeCloseTo(PLATE_CELL.y + PLATE_CELL.h - 1, 3);
      // Facing backwards, read from behind: the car's -X end is the cell's left.
      for (const t of onPlate) {
        expect(t.n.z).toBeGreaterThan(0.99);
        t.p.forEach((p, k) => {
          if (p.x < PLATE_MOUNT.x) expect(t.px[k][0]).toBeLessThan(PLATE_CELL.x + PLATE_CELL.w / 2);
        });
      }
      g.dispose();
    });
  }
});

describe('plate', () => {
  it('spaces a Mercosur registration and leaves anything else as typed', () => {
    expect(formatPlateText('AB123CD')).toBe('AB 123 CD');
    expect(formatPlateText('BANDIDO')).toBe('BANDIDO');
    expect(formatPlateText('RAYO 77')).toBe('RAYO 77');
    expect(formatPlateText('AB12')).toBe('AB12');
  });

  it('keeps every style on its mount, and the stock one exactly the old box', () => {
    const stock = buildPlateGeometry(STOCK_LOADOUT.plate);
    expect(stock.length).toBe(1);
    expect(stock[0].getAttribute('position').count).toBe(36);
    for (const g of stock) g.dispose();
    for (const style of PLATE_STYLES) {
      const parts = buildPlateGeometry({ text: 'AB123CD', style });
      let tris = 0;
      for (const g of parts) {
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        expect(bb.min.x).toBeGreaterThanOrEqual(PLATE_MOUNT.x - PLATE_MOUNT.width / 2 - 0.03);
        expect(bb.max.x).toBeLessThanOrEqual(PLATE_MOUNT.x + PLATE_MOUNT.width / 2 + 0.03);
        expect(bb.max.z).toBeLessThanOrEqual(PLATE_MOUNT.z + 0.04);
        expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position']);
        tris += g.getAttribute('position').count / 3;
        g.dispose();
      }
      expect(tris).toBeLessThanOrEqual(80);
    }
  });
});

describe('createCarPaint', () => {
  it('has no texture without a DOM, like the livery it replaces, and still applies the finish', () => {
    const paint = createCarPaint();
    expect(paint.texture).toBeNull();
    const m = carPaintMaterial({ color: 0x141834, roughness: 0.26, metalness: 0.62 });
    const colour = m.color.getHex();
    for (const finish of PAINT_FINISHES) {
      paint.apply(sanitizeLoadout({ ...STOCK_LOADOUT, paint: { base: 'red', finish } }), m);
      expect(m.color.getHex()).toBe(colour);
      expect(m.metalness).toBe(FINISH_PARAMS[finish].metalness);
    }
    paint.apply(sanitizeLoadout({ ...STOCK_LOADOUT, paint: { base: 'purple', finish: 'pearl' } }), m);
    expect(m.iridescence).toBeGreaterThan(0.5);
    paint.apply(sanitizeLoadout({ ...STOCK_LOADOUT, paint: { base: 'black', finish: 'matte' } }), m);
    expect(m.clearcoat).toBe(0);
    expect(m.roughness).toBeGreaterThan(0.6);
    paint.apply(sanitizeLoadout({ ...STOCK_LOADOUT, paint: { base: 'silver', finish: 'chrome' } }), m);
    expect(m.metalness).toBeGreaterThanOrEqual(0.9);
    expect(m.roughness).toBeLessThan(0.15);
    paint.apply(STOCK_LOADOUT, m);
    expect([m.metalness, m.roughness, m.clearcoat, m.clearcoatRoughness, m.iridescence]).toEqual([0.62, 0.26, 1, 0.08, 0]);
    paint.dispose();
    m.dispose();
  });

  it('recomposes only for what the canvas shows', () => {
    const a = cloneLoadout(STOCK_LOADOUT);
    const b = cloneLoadout(STOCK_LOADOUT);
    b.body.spoiler = 'spoiler.stock';
    b.lights.neon = 'off';
    expect(paintKey(a)).toBe(paintKey(b));
    b.plate.text = 'AB123CD';
    expect(paintKey(a)).not.toBe(paintKey(b));
  });

  it('dresses the car in every finish, vinyl, decal and plate without touching draw calls', () => {
    const car = createCarVisual();
    try {
      const count = (): number => {
        let n = 0;
        car.root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && o.visible) n++;
        });
        return n;
      };
      for (const style of PLATE_STYLES) {
        const l = cloneLoadout(STOCK_LOADOUT);
        l.plate.style = style;
        l.paint = { base: 'white', finish: 'pearl', roof: 'black' };
        l.vinyls = partsOf('vinyls').slice(0, 4).map((p) => ({ id: p.id, color: 'cyan' }));
        l.decals = DECAL_ZONES.map((zone, i) => ({ id: partsOf('decals')[i % partsOf('decals').length].id, zone }));
        car.applyLoadout(l);
        expect(count()).toBe(14);
      }
    } finally {
      car.dispose();
    }
  });
});

/**
 * A 2D context that accepts every call and remembers nothing, so the painters can be run under
 * Node: this checks they never throw for any region, zone or colour — not what they draw (the
 * harness screenshots do that).
 */
function fakeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const special: Record<string, unknown> = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: (s: string) => ({ width: s.length * 50 }),
    canvas: { width: ATLAS_SIZE, height: ATLAS_SIZE },
  };
  const store: Record<string | symbol, unknown> = {};
  return new Proxy(store, {
    get: (_t, key) => (key in special ? special[key as string] : key in store ? store[key] : () => {}),
    set: (_t, key, value) => {
      store[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

describe('composePaint', () => {
  it('runs every painter in every region and zone without throwing', () => {
    const ctx = fakeContext();
    const vinyls = partsOf('vinyls');
    const decals = partsOf('decals');
    for (let i = 0; i < vinyls.length; i += 4) {
      const l = cloneLoadout(STOCK_LOADOUT);
      l.vinyls = vinyls.slice(i, i + 4).map((p) => ({ id: p.id, color: 'lime' }));
      l.decals = DECAL_ZONES.map((zone, k) => ({ id: decals[(i + k) % decals.length].id, zone }));
      l.paint = { base: 'gold', finish: 'chrome', roof: 'navy' };
      expect(() => composePaint(ctx, sanitizeLoadout(l))).not.toThrow();
    }
    for (const style of PLATE_STYLES) expect(() => composePaint(ctx, withPlate(style))).not.toThrow();
  });
});
