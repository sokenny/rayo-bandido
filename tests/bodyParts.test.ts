import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { BODY_PARTS } from '../src/content/parts/body';
import { partsOf, validateCatalogue } from '../src/content/carParts';
import { STOCK_LOADOUT, STEP_RANGES, cloneLoadout, type CarLoadout } from '../src/core/loadout';
import { SLOT_MODULES, exhaustOutlets, type CustomBodySlot } from '../src/render/scene/vehicles/parts';
import { buildBodyGeometry } from '../src/render/scene/vehicles/bodyAssembler';
import { STANCE_STEP } from '../src/render/scene/vehicles/wheelRig';
import { VEHICLE } from '../src/config/tuning';

/**
 * Agent A's bodywork (`docs/GARAGE_PLAN.md` §2.7, §6.3): every sold body part exists in the
 * catalogue and in its slot builder under the same id, builds sane geometry, and the heaviest
 * combination stays inside the +1,500 triangle budget.
 */

const SOLD: readonly CustomBodySlot[] = ['frontBumper', 'rearBumper', 'skirts', 'hood', 'trunk', 'spoiler', 'exhaustTips'];

function withBody(slot: CustomBodySlot, id: string, extra?: Partial<CarLoadout['body']>): CarLoadout {
  const l = cloneLoadout(STOCK_LOADOUT);
  l.body[slot] = id;
  if (extra) Object.assign(l.body, extra);
  return l;
}

function tris(parts: THREE.BufferGeometry[]): number {
  let n = 0;
  for (const g of parts) {
    const index = g.getIndex();
    n += (index ? index.count : g.getAttribute('position').count) / 3;
  }
  return n;
}

function build(slot: CustomBodySlot, id: string, loadout = withBody(slot, id)): THREE.BufferGeometry[] {
  return SLOT_MODULES[slot].build(id, { openCabin: true, loadout });
}

function dispose(parts: THREE.BufferGeometry[]): void {
  for (const g of parts) g.dispose();
}

describe('body parts: catalogue ↔ builders', () => {
  it('the catalogue is clean', () => {
    expect(validateCatalogue()).toEqual([]);
  });

  it.each(SOLD)('%s: every catalogue part has a builder variant and vice versa, 4+ aftermarket', (slot) => {
    const catalogue = partsOf(slot).map((p) => p.id).sort();
    const variants = [...SLOT_MODULES[slot].variants].sort();
    expect(variants).toEqual(catalogue);
    expect(SLOT_MODULES[slot].variants[0]).toBe(`${slot}.stock`);
    expect(catalogue.length - 1).toBeGreaterThanOrEqual(4);
  });

  it('every BODY_PARTS entry is a sold body slot', () => {
    for (const p of BODY_PARTS) expect(SOLD).toContain(p.category);
  });

  it('every aftermarket part builds something different from stock (or deliberately nothing)', () => {
    const shape = (parts: THREE.BufferGeometry[]): string => {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let n = 0;
      for (const g of parts) {
        const a = g.getAttribute('position');
        for (let i = 0; i < a.count; i++, n++) {
          sx += Math.abs(a.getX(i));
          sy += a.getY(i);
          sz += a.getZ(i);
        }
      }
      return `${n}:${sx.toFixed(3)}:${sy.toFixed(3)}:${sz.toFixed(3)}`;
    };
    for (const slot of SOLD) {
      const stock = build(slot, `${slot}.stock`);
      const stockShape = shape(stock);
      dispose(stock);
      const seen = new Set([stockShape]);
      for (const id of SLOT_MODULES[slot].variants) {
        if (id.endsWith('.stock')) continue;
        const parts = build(slot, id);
        if (id !== 'spoiler.none') expect(parts.length, id).toBeGreaterThan(0);
        const s = shape(parts);
        expect(seen.has(s), `${id} looks like another part of its slot`).toBe(false);
        seen.add(s);
        dispose(parts);
      }
    }
  });
});

describe('body parts: geometry', () => {
  const allVariants = SOLD.flatMap((slot) => SLOT_MODULES[slot].variants.map((id) => [slot, id] as const));
  // Spoilers stand on the trunk: build every one on every trunk.
  const trunks = SLOT_MODULES.trunk.variants;

  it.each(allVariants)('%s %s: merge-ready, finite, inside the car envelope', (slot, id) => {
    const loadouts = slot === 'spoiler' ? trunks.map((t) => withBody(slot, id, { trunk: t })) : [withBody(slot, id)];
    for (const loadout of loadouts) {
      const parts = build(slot, id, loadout);
      for (const g of parts) {
        expect(g.getIndex(), id).toBeNull();
        expect(Object.keys(g.attributes).sort(), id).toEqual(['color', 'normal', 'position']);
        const pos = g.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), id).toBe(true);
          expect(Math.abs(x), `${id} x`).toBeLessThanOrEqual(1.05);
          expect(Math.abs(z), `${id} z`).toBeLessThanOrEqual(2.45);
          expect(y, `${id} y`).toBeGreaterThanOrEqual(0.05);
        }
        const nrm = g.getAttribute('normal');
        for (let i = 0; i < nrm.count; i++) expect(Number.isFinite(nrm.getX(i) + nrm.getY(i) + nrm.getZ(i)), id).toBe(true);
      }
      dispose(parts);
    }
  });

  it('new parts keep 6 cm of ground clearance at the lowest ride height', () => {
    const drop = -STEP_RANGES.rideHeight.min * STANCE_STEP.rideHeight;
    for (const [slot, id] of allVariants) {
      if (id.endsWith('.stock')) continue;
      const parts = build(slot, id);
      for (const g of parts) {
        const pos = g.getAttribute('position');
        for (let i = 0; i < pos.count; i++) expect(pos.getY(i) - drop, id).toBeGreaterThanOrEqual(0.058);
      }
      dispose(parts);
    }
  });

  it('new parts stay out of the wheels at full lock and every stance step', () => {
    const r = VEHICLE.wheelRadius;
    const halfBase = VEHICLE.wheelbase / 2;
    const drop = -STEP_RANGES.rideHeight.min * STANCE_STEP.rideHeight;
    // The tyre's swept volume, conservatively: a cylinder of radius r (+1 cm) around the axle,
    // widened in z by the steering sweep up front, from the innermost to the outermost tyre face.
    const halfTrackMin = VEHICLE.trackWidth / 2 + STEP_RANGES.trackFront.min * STANCE_STEP.track;
    const innerX = halfTrackMin - (0.26 + STEP_RANGES.wheelWidth.max * STANCE_STEP.width) / 2 - 0.02;
    const sweep = 0.1; // z the tyre's corner reaches past its radius at 0.55 rad of lock
    for (const [slot, id] of allVariants) {
      if (id.endsWith('.stock') || slot === 'hood' || slot === 'trunk' || slot === 'spoiler') continue;
      const parts = build(slot, id);
      for (const g of parts) {
        const pos = g.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const x = Math.abs(pos.getX(i));
          if (x < innerX) continue;
          const z = pos.getZ(i);
          for (const wz of [-halfBase, halfBase]) {
            // Lowest ride: the body sits `drop` lower relative to the axle.
            const dy = pos.getY(i) - drop - r;
            const dz = Math.abs(z - wz);
            const reach = wz < 0 ? r + sweep : r + 0.01;
            const inside = dz < reach && Math.hypot(dy, Math.max(0, dz - (wz < 0 ? sweep : 0))) < r + 0.01;
            expect(inside, `${id} (${pos.getX(i).toFixed(2)}, ${pos.getY(i).toFixed(2)}, ${z.toFixed(2)})`).toBe(false);
          }
        }
      }
      dispose(parts);
    }
  });
});

describe('body parts: budget', () => {
  it('the heaviest combination adds at most 1,500 triangles over stock', () => {
    let worstDelta = 0;
    const heaviest = cloneLoadout(STOCK_LOADOUT);
    for (const slot of SOLD) {
      const stockParts = build(slot, `${slot}.stock`);
      const stockTris = tris(stockParts);
      dispose(stockParts);
      let max = stockTris;
      for (const id of SLOT_MODULES[slot].variants) {
        const p = build(slot, id);
        const n = tris(p);
        dispose(p);
        if (n > max) {
          max = n;
          heaviest.body[slot] = id;
        }
      }
      worstDelta += max - stockTris;
    }
    expect(worstDelta).toBeLessThanOrEqual(1500);
    const stockBody = buildBodyGeometry(true, STOCK_LOADOUT);
    const heavyBody = buildBodyGeometry(true, heaviest);
    const delta = heavyBody.getAttribute('position').count / 3 - stockBody.getAttribute('position').count / 3;
    expect(delta).toBe(worstDelta);
    stockBody.dispose();
    heavyBody.dispose();
  });
});

describe('exhaust outlets', () => {
  it.each(SLOT_MODULES.exhaustTips.variants)('%s lists outlets at the mouths of its pipes', (id) => {
    const outlets = exhaustOutlets(id);
    expect(outlets.length).toBeGreaterThan(0);
    const parts = build('exhaustTips', id);
    const pos = parts.flatMap((g) => {
      const a = g.getAttribute('position');
      const out: Array<[number, number, number]> = [];
      for (let i = 0; i < a.count; i++) out.push([a.getX(i), a.getY(i), a.getZ(i)]);
      return out;
    });
    for (const o of outlets) {
      expect(o.radius).toBeGreaterThan(0.03);
      expect(o.y - o.radius).toBeGreaterThanOrEqual(0.16);
      // Some vertex of the tip lies on a rim around the outlet, within a few mm of its plane.
      const near = pos.some(([x, y, z]) => Math.abs(z - o.z) < 0.03 && Math.hypot(x - o.x, y - o.y) < o.radius * 1.3);
      expect(near, `${id} outlet at ${o.x},${o.y},${o.z}`).toBe(true);
    }
    dispose(parts);
  });

  it('unknown ids get stock outlets', () => {
    expect(exhaustOutlets('exhaustTips.nope')).toEqual(exhaustOutlets('exhaustTips.stock'));
  });
});
