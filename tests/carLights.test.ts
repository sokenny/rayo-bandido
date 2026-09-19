import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCarVisual } from '../src/render/scene/carVisual';
import {
  HEAD_SHAPES,
  TAIL_SHAPES,
  buildHeadGeometry,
  buildTailGeometry,
  createCarLights,
  lampColor,
} from '../src/render/scene/vehicles/lights';
import { CHARGE_COLOR, chargeShift, createUnderglow } from '../src/render/scene/vehicles/underglow';
import { createCabinInterior } from '../src/render/scene/vehicles/interior';
import { PLATE_MOUNT } from '../src/render/scene/vehicles/plate';
import { STOCK_LOADOUT, cloneLoadout, sanitizeLoadout, type CarLoadout } from '../src/core/loadout';
import { PALETTE, partsOf, validateCatalogue } from '../src/content/carParts';

/**
 * Agent G's lamps, neon and cabin light (`docs/GARAGE_PLAN.md` §2.7, D2). The stock car itself
 * is pinned by `carVisualStock.test.ts`; this checks that every other choice is drawn, stays in
 * its envelope, keeps the gameplay readings (tail red/magenta, the neon's charge meter) and
 * comes back to stock exactly.
 */

const withLights = (patch: Partial<CarLoadout['lights']>): CarLoadout => {
  const l = cloneLoadout(STOCK_LOADOUT);
  Object.assign(l.lights, patch);
  return sanitizeLoadout(l);
};

const colours = (g: THREE.BufferGeometry): number[] => Array.from(g.getAttribute('color').array as Float32Array);

describe('lamp shapes against the catalogue', () => {
  it('draws every head and tail part the catalogue sells, and sells every shape it draws', () => {
    expect(validateCatalogue()).toEqual([]);
    expect(HEAD_SHAPES[0]).toBe('headlights.stock');
    expect(TAIL_SHAPES[0]).toBe('taillights.stock');
    expect(partsOf('headlights').map((p) => p.id).sort()).toEqual([...HEAD_SHAPES].sort());
    expect(partsOf('taillights').map((p) => p.id).sort()).toEqual([...TAIL_SHAPES].sort());
    expect(HEAD_SHAPES.length).toBeGreaterThanOrEqual(4);
    expect(TAIL_SHAPES.length).toBeGreaterThanOrEqual(4);
  });

  it('builds stock for an id it does not know', () => {
    const known = buildHeadGeometry('headlights.stock');
    const unknown = buildHeadGeometry('headlights.nope');
    expect(colours(unknown)).toEqual(colours(known));
    const knownTail = buildTailGeometry('taillights.stock');
    const unknownTail = buildTailGeometry('taillights.nope');
    expect(Array.from(unknownTail.getAttribute('position').array)).toEqual(Array.from(knownTail.getAttribute('position').array));
    for (const g of [known, unknown, knownTail, unknownTail]) g.dispose();
  });

  it('keeps every head shape on the nose (the pop-ups on the hood lip), in the body format', () => {
    for (const id of HEAD_SHAPES) {
      const g = buildHeadGeometry(id);
      expect(Object.keys(g.attributes).sort(), id).toEqual(['color', 'normal', 'position']);
      expect(g.getAttribute('color').itemSize, id).toBe(3);
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.x, id).toBeGreaterThan(-0.67);
      expect(b.max.x, id).toBeLessThan(0.67);
      expect(b.min.y, id).toBeGreaterThan(0.33);
      expect(b.max.y, id).toBeLessThan(id === 'headlights.popup' ? 0.8 : 0.6);
      expect(b.min.z, id).toBeGreaterThan(-2.21);
      expect(b.max.z, id).toBeLessThan(id === 'headlights.popup' ? -1.88 : -2.05);
      // Budget: a lamp set is a few hundred triangles at most.
      expect(g.getAttribute('position').count / 3, id).toBeLessThan(600);
      g.dispose();
    }
  });

  it('keeps every tail shape on the tail face and off the number plate', () => {
    const plateTop = PLATE_MOUNT.y + PLATE_MOUNT.height / 2;
    const plateHalf = PLATE_MOUNT.width / 2;
    for (const id of TAIL_SHAPES) {
      const g = buildTailGeometry(id);
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.x, id).toBeGreaterThan(-0.71);
      expect(b.max.x, id).toBeLessThan(0.71);
      expect(b.min.y, id).toBeGreaterThan(0.5);
      expect(b.max.y, id).toBeLessThan(0.72);
      expect(b.min.z, id).toBeGreaterThan(2.07);
      expect(b.max.z, id).toBeLessThan(2.17);
      expect(g.getAttribute('position').count / 3, id).toBeLessThan(600);
      if (id !== 'taillights.stock' && id !== 'taillights.smoked') {
        // No new silhouette reaches down over the plate (smoked is the stock shape, which already does).
        const pos = g.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          if (Math.abs(pos.getX(i)) < plateHalf - 0.01) expect(pos.getY(i), id).toBeGreaterThanOrEqual(plateTop);
        }
      }
      g.dispose();
    }
  });
});

describe('CarLights.applyLoadout', () => {
  it('swaps shapes, disposes what it replaces, and comes back to stock exactly', () => {
    const chassis = new THREE.Group();
    const lights = createCarLights(chassis);
    const stockHead = colours(lights.head.geometry);
    const stockTail = Array.from(lights.tail.geometry.getAttribute('position').array);
    const stockHeadMat = lights.head.material as THREE.MeshStandardMaterial;
    const stockIntensity = stockHeadMat.emissiveIntensity;
    let head = 'headlights.stock';
    let tail = 'taillights.stock';
    for (let i = 1; i < Math.max(HEAD_SHAPES.length, TAIL_SHAPES.length) * 2; i++) {
      const nextHead = HEAD_SHAPES[i % HEAD_SHAPES.length];
      const nextTail = TAIL_SHAPES[i % TAIL_SHAPES.length];
      const oldHead = lights.head.geometry;
      const oldTail = lights.tail.geometry;
      const disposed: string[] = [];
      oldHead.addEventListener('dispose', () => disposed.push('head'));
      oldTail.addEventListener('dispose', () => disposed.push('tail'));
      lights.applyLoadout(withLights({ head: nextHead, tail: nextTail }));
      expect(lights.head.geometry !== oldHead).toBe(nextHead !== head);
      expect(lights.tail.geometry !== oldTail).toBe(nextTail !== tail);
      expect(disposed.includes('head')).toBe(nextHead !== head);
      expect(disposed.includes('tail')).toBe(nextTail !== tail);
      head = nextHead;
      tail = nextTail;
    }
    expect(chassis.children.length).toBe(4);
    lights.applyLoadout(STOCK_LOADOUT);
    expect(colours(lights.head.geometry)).toEqual(stockHead);
    expect(Array.from(lights.tail.geometry.getAttribute('position').array)).toEqual(stockTail);
    expect(lights.head.material).toBe(stockHeadMat);
    expect(stockHeadMat.emissiveIntensity).toBe(stockIntensity);
    expect(stockHeadMat.emissive.getHexString()).toBe('dff2ff');
    lights.dispose();
  });

  it('colours the head lamps from the palette, as a lamp (brightest channel full)', () => {
    const lights = createCarLights(new THREE.Group());
    const mat = lights.head.material as THREE.MeshStandardMaterial;
    lights.applyLoadout(withLights({ headColor: 'magenta' }));
    expect(mat.emissive.getHexString()).toBe('ff2fd0');
    lights.applyLoadout(withLights({ headColor: 'navy' }));
    expect(Math.max(mat.emissive.r, mat.emissive.g, mat.emissive.b)).toBeCloseTo(1, 5);
    expect(mat.emissive.b).toBeGreaterThan(mat.emissive.r);
    lights.applyLoadout(withLights({ headColor: 'xenon' }));
    expect(mat.emissive.getHexString()).toBe('dff2ff');
    lights.dispose();
  });

  it('keeps the tails red on the brakes and magenta on nitro, whatever the shape', () => {
    const lights = createCarLights(new THREE.Group());
    const mat = lights.tail.material as THREE.MeshStandardMaterial;
    const hue = (): string => mat.emissive.getHexString();
    lights.setNitro(1);
    const nitroHue = hue();
    lights.setNitro(0);
    lights.setBraking(true);
    const brakeHue = hue();
    const brakeIntensity = mat.emissiveIntensity;
    lights.setBraking(false);
    const restIntensity = mat.emissiveIntensity;
    expect(brakeHue).toBe('ff1a2e');
    for (const tail of TAIL_SHAPES) {
      lights.applyLoadout(withLights({ tail }));
      lights.setBraking(true);
      expect(hue(), tail).toBe(brakeHue);
      // Braking always reads brighter than running.
      const braked = mat.emissiveIntensity;
      lights.setBraking(false);
      expect(braked, tail).toBeGreaterThan(mat.emissiveIntensity * 3);
      lights.setNitro(1);
      expect(hue(), tail).toBe(nitroHue);
      lights.setNitro(0);
    }
    lights.applyLoadout(STOCK_LOADOUT);
    expect(mat.emissiveIntensity).toBe(restIntensity);
    lights.setBraking(true);
    expect(mat.emissiveIntensity).toBe(brakeIntensity);
    lights.dispose();
  });

  it('rebuilds the exhaust flame when the tips change', () => {
    const lights = createCarLights(new THREE.Group());
    const old = lights.exhaustGlow.geometry;
    let disposed = false;
    old.addEventListener('dispose', () => {
      disposed = true;
    });
    // Unsanitized on purpose: agent A's tip ids do not exist on this branch yet.
    const l = cloneLoadout(STOCK_LOADOUT);
    l.body.exhaustTips = 'exhaustTips.quad';
    lights.applyLoadout(l);
    expect(lights.exhaustGlow.geometry).not.toBe(old);
    expect(disposed).toBe(true);
    lights.dispose();
  });
});

describe('Underglow (D2: the neon is the charge meter)', () => {
  const setup = (neon: CarLoadout['lights']['neon']) => {
    const root = new THREE.Group();
    const chassis = new THREE.Group();
    const glow = createUnderglow(root, chassis, withLights({ neon }));
    const stripMat = glow.strips.material as THREE.MeshBasicMaterial;
    const poolMat = glow.pool.material as THREE.MeshBasicMaterial;
    return { glow, stripMat, poolMat };
  };

  it('stock (rayo) keeps the baked cyan/magenta and a white material, charged or not', () => {
    const { glow, stripMat, poolMat } = setup('rayo');
    for (const c of [0, 0.5, 1]) {
      glow.setCharge(c);
      glow.update(1.3);
      expect(stripMat.color.getHexString()).toBe('ffffff');
      expect(poolMat.color.getHexString()).toBe('ffffff');
    }
    glow.dispose();
  });

  it('a palette colour rests in that colour and swings to the charge colour as it charges', () => {
    const { glow, stripMat, poolMat } = setup('red');
    const red = lampColor('red', new THREE.Color());
    glow.setCharge(0);
    expect(stripMat.color.equals(red)).toBe(true);
    expect(poolMat.color.equals(red)).toBe(true);
    glow.setCharge(1);
    expect(stripMat.color.getHex()).toBe(new THREE.Color(CHARGE_COLOR).getHex());
    // White vertices: the material carries the hue.
    const c = colours(glow.strips.geometry);
    for (let i = 0; i < c.length; i += 4) expect(c[i] + c[i + 1] + c[i + 2]).toBe(3);
    glow.dispose();
  });

  it("'off' is dark at rest but still reads the charge, and flickers above 0.6 like stock", () => {
    const { glow, stripMat } = setup('off');
    glow.setCharge(0);
    expect(stripMat.color.getHex()).toBe(0);
    glow.setCharge(0.4);
    expect(stripMat.color.b).toBeGreaterThan(0.3);
    glow.setCharge(1);
    const opacities = new Set<number>();
    for (let i = 0; i < 12; i++) {
      glow.update(i * 0.037);
      opacities.add(Math.round(stripMat.opacity * 1e4));
    }
    expect(opacities.size).toBeGreaterThan(3);
    expect(Math.max(...opacities) / 1e4).toBeGreaterThan(0.9);
    glow.dispose();
  });

  it('the swing is eased and reaches the charge colour exactly at full charge', () => {
    expect(chargeShift(0)).toBe(0);
    expect(chargeShift(1)).toBe(1);
    expect(chargeShift(0.5)).toBeGreaterThan(0.5);
    expect(chargeShift(-1)).toBe(0);
    expect(chargeShift(2)).toBe(1);
  });

  it('goes back to the stock geometry exactly, disposing what it replaced', () => {
    const { glow, stripMat } = setup('rayo');
    const stockStrips = colours(glow.strips.geometry);
    const stockPool = colours(glow.pool.geometry);
    const old = glow.strips.geometry;
    let disposed = false;
    old.addEventListener('dispose', () => {
      disposed = true;
    });
    glow.applyLoadout(withLights({ neon: 'lime' }));
    expect(disposed).toBe(true);
    glow.applyLoadout(STOCK_LOADOUT);
    expect(colours(glow.strips.geometry)).toEqual(stockStrips);
    expect(colours(glow.pool.geometry)).toEqual(stockPool);
    glow.setCharge(0.7);
    expect(stripMat.color.getHexString()).toBe('ffffff');
    glow.dispose();
  });

  it('allocates no colour per frame', () => {
    const { glow } = setup('violet');
    const before = THREE.Color.prototype.clone;
    let clones = 0;
    THREE.Color.prototype.clone = function (this: THREE.Color) {
      clones++;
      return before.call(this);
    };
    try {
      for (let i = 0; i < 100; i++) {
        glow.setCharge((i % 10) / 9);
        glow.update(i / 60);
      }
    } finally {
      THREE.Color.prototype.clone = before;
    }
    expect(clones).toBe(0);
    glow.dispose();
  });
});

describe('CabinInterior.applyLoadout', () => {
  it('lights the cabin in one colour and comes back to the cyan/magenta cabin exactly', () => {
    const cabin = createCabinInterior();
    const glow = cabin.group.getObjectByName('player-car-interior-glow') as THREE.Mesh;
    const bars = cabin.group.getObjectByName('player-car-eq') as THREE.InstancedMesh;
    const stockGlow = colours(glow.geometry);
    const stockBars = Array.from(bars.instanceColor!.array);
    const old = glow.geometry;
    let disposed = false;
    old.addEventListener('dispose', () => {
      disposed = true;
    });
    cabin.applyLoadout(withLights({ interior: 'lime' }));
    expect(disposed).toBe(true);
    const lime = lampColor('lime', new THREE.Color());
    const c = colours(glow.geometry);
    // Every strip vertex is lime (the display's base line a dimmer lime): proportional channels.
    for (let i = 0; i < c.length; i += 4) {
      expect(c[i] * lime.g).toBeCloseTo(c[i + 1] * lime.r, 5);
      expect(c[i + 2] * lime.g).toBeCloseTo(c[i + 1] * lime.b, 5);
      expect(c[i + 1]).toBeGreaterThan(0.3);
    }
    expect(Array.from(bars.instanceColor!.array)).not.toEqual(stockBars);
    cabin.applyLoadout(STOCK_LOADOUT);
    expect(colours(glow.geometry)).toEqual(stockGlow);
    expect(Array.from(bars.instanceColor!.array)).toEqual(stockBars);
    cabin.dispose();
  });

  it('takes every palette colour', () => {
    const cabin = createCabinInterior();
    for (const colour of PALETTE) cabin.applyLoadout(withLights({ interior: colour.id }));
    cabin.dispose();
  });
});

describe('the whole car in any lamp loadout', () => {
  it('keeps fourteen draw calls and the same materials, and returns to stock exactly', () => {
    const count = (root: THREE.Object3D): number => {
      let n = 0;
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.visible) n++;
      });
      return n;
    };
    const materials = (root: THREE.Object3D): Set<THREE.Material> => {
      const out = new Set<THREE.Material>();
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) out.add((o as THREE.Mesh).material as THREE.Material);
      });
      return out;
    };
    const snapshot = (root: THREE.Object3D): string[] => {
      const out: string[] = [];
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.geometry.getAttribute('color')) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        out.push(`${m.name}:${colours(m.geometry).length}:${colours(m.geometry).reduce((a, b) => a + b, 0).toFixed(4)}:${mat.color.getHexString()}:${mat.emissive?.getHexString() ?? '-'}`);
      });
      return out;
    };
    const fresh = createCarVisual();
    fresh.update(1 / 60, 0);
    const stock = snapshot(fresh.root);
    fresh.dispose();

    const custom = withLights({ head: 'headlights.popup', headColor: 'yellow', tail: 'taillights.led-bar', neon: 'off', interior: 'violet' });
    const car = createCarVisual({ loadout: custom });
    try {
      car.update(1 / 60, 0);
      expect(count(car.root)).toBe(14);
      const mats = materials(car.root);
      expect(snapshot(car.root)).not.toEqual(stock);
      car.applyLoadout(STOCK_LOADOUT);
      car.update(1 / 60, 0);
      expect(count(car.root)).toBe(14);
      expect(materials(car.root)).toEqual(mats);
      expect(snapshot(car.root)).toEqual(stock);
    } finally {
      car.dispose();
    }
  });
});
