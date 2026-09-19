import { describe, expect, it } from 'vitest';
import { builderStats, createBuilders } from '../src/render/scene/env/builders';
import { buildGarage } from '../src/render/scene/env/garageBuilder';
import { LOCO_MUSTANG_LOOK } from '../src/render/scene/env/garageFigure';
import { buildHumanParts } from '../src/render/scene/env/humanFigure';
import { LOCO_MUSTANG, validateGarage } from '../src/content/garage';
import { hasPortrait } from '../src/ui/portraits';
import { inRect, type Rect } from '../src/world/cityPlan';
import { GARAGE, garageColliders, garageParts } from '../src/world/garage';
import { METRO_GARAGE, METRO_MEET_LOT } from '../src/world/metroSpec';
import { createOpenWorld } from '../src/world/openWorld';
import { createGarageState, garageWantsWorkshop, garageWorkshopLine, stepGarage } from '../src/sim/garage';
import type { GameEvent, PlayerCommand, VehicleState } from '../src/core/types';

/**
 * Loco Mustang's garage (`src/world/garage.ts`, `src/sim/garage.ts`): a corner lot across from
 * the car meet, not open yet. The rules are a station's for fitting in, plus a man who says so.
 */
const { layout, plan } = createOpenWorld();
const spec = plan.garage!;
const overlaps = (a: Rect, b: Rect, e = 0): boolean => a.maxX > b.minX + e && a.minX < b.maxX - e && a.maxZ > b.minZ + e && a.minZ < b.maxZ - e;

describe("Loco Mustang's garage", () => {
  it('is in the open world, across st-w3 from the car meet', () => {
    expect(spec).toEqual(METRO_GARAGE);
    expect(layout.garageSite).toBeTruthy();
    expect(spec.lot.minX - METRO_MEET_LOT.maxX).toBeLessThan(25);
  });

  it('stands off the streets, with a street on its front and its corner, and nothing built on it', () => {
    const l = spec.lot;
    for (let x = l.minX + 0.5; x < l.maxX; x += 2) {
      for (let z = l.minZ + 0.5; z < l.maxZ; z += 2) expect(plan.isRoad(x, z), `(${x}, ${z})`).toBe(false);
    }
    expect(plan.isRoad((l.minX + l.maxX) / 2, l.minZ - 6)).toBe(true);
    expect(plan.isRoad(l.minX - 6, (l.minZ + l.maxZ) / 2)).toBe(true);
    for (const blk of plan.blocks) expect(overlaps(blk, l, 0.01), blk.tag).toBe(false);
    for (const g of plan.gasStations ?? []) expect(overlaps(g.lot, l)).toBe(false);
  });

  it('keeps clear of every door, marker, shelter and street prop', () => {
    const points = [
      { ...layout.playerSpawn, what: 'spawn' },
      ...(layout.rushSites ?? []).map((p) => ({ ...p, what: 'rush' })),
      ...(layout.passengerStops ?? []).map((p) => ({ ...p, what: 'passenger' })),
      ...(layout.streetSites ?? []).map((p) => ({ ...p, what: 'street race' })),
      ...(layout.circuitSite ? [{ ...layout.circuitSite, what: 'circuit' }] : []),
      ...(plan.busStops ?? []).map((p) => ({ ...p, what: 'bus stop' })),
      ...(layout.streetProps ?? []).map((p) => ({ x: p.x, z: p.z, what: `prop ${p.kind}` })),
    ];
    for (const pt of points) expect(inRect(spec.lot, pt.x, pt.z, 3), `${pt.what} at (${pt.x.toFixed(0)}, ${pt.z.toFixed(0)})`).toBe(false);
  });

  it('is solid where it is drawn, with the ring and the man on open apron', () => {
    const p = garageParts(spec);
    for (const box of garageColliders(spec)) {
      expect(layout.colliders.some((k) => k.tag === box.tag && k.minX === box.minX && k.maxZ === box.maxZ), box.tag).toBe(true);
      for (const [x, z] of [[box.minX, box.minZ], [box.maxX, box.maxZ]]) expect(inRect(spec.lot, x, z, 0.01)).toBe(true);
    }
    const site = layout.garageSite!;
    const solid = (x: number, z: number, pad: number): boolean =>
      layout.colliders.some((c) => (c.maxY === undefined || c.maxY > 0.3) && x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad);
    expect(solid(site.x, site.z, 2)).toBe(false);
    expect(solid(p.stand.x, p.stand.z, 0.4)).toBe(false);
    expect(inRect(p.apron, site.x, site.z)).toBe(true);
    // He stands outside the ring, so the car pulling up never drives through him.
    expect(Math.hypot(p.stand.x - site.x, p.stand.z - site.z)).toBeGreaterThan(GARAGE.marker.promptRadius - 1.2);
    expect(layout.minimap?.rects).toContainEqual(p.apron);
  });

  it('draws into the city batches', () => {
    const b = createBuilders(plan);
    buildGarage(b);
    const stats = builderStats(b);
    expect(stats.triangles).toBeGreaterThan(800);
    expect(stats.triangles).toBeLessThan(60000);
  });

  it('gives Loco Mustang a body, a face and things to say', () => {
    expect(validateGarage(LOCO_MUSTANG)).toEqual([]);
    expect(hasPortrait(LOCO_MUSTANG.portrait)).toBe(true);
    const parts = buildHumanParts(LOCO_MUSTANG_LOOK);
    expect(parts.body.getAttribute('position').count).toBeGreaterThan(0);
  });
});

describe('the garage rules', () => {
  const site = { x: 0, z: 0, y: 0, heading: 0, label: 'G' };
  const cmd = (activate = false): PlayerCommand => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, fire: false, restart: false, cruise: false, pov: false, shiftUp: false, shiftDown: false, transmission: false, activate });
  const car = (x: number): VehicleState => ({ x, z: 0 }) as VehicleState;

  it('says it is not open yet as the car pulls up, and answers the key', () => {
    const s = createGarageState();
    const events: GameEvent[] = [];
    stepGarage(s, site, car(40), cmd(), 1 / 60, events);
    expect(s.atSite).toBe(false);
    expect(events).toHaveLength(0);
    stepGarage(s, site, car(2), cmd(), 1 / 60, events);
    expect(s.atSite).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['garagePrompt', 'garageLine']);
    expect(LOCO_MUSTANG.greetings).toContain(s.line);
    events.length = 0;
    stepGarage(s, site, car(2), cmd(true), 1 / 60, events);
    expect(events.map((e) => e.type)).toEqual(['garageLine']);
    expect(LOCO_MUSTANG.soon).toContain(s.line);
    // Nothing while something else has the car.
    s.locked = true;
    events.length = 0;
    stepGarage(s, site, car(2), cmd(true), 1 / 60, events);
    expect(events).toHaveLength(0);
    // Leaving lets him greet again next time.
    stepGarage(s, site, car(30), cmd(), 1 / 60, events);
    expect(s.atSite).toBe(false);
    expect(s.greeted).toBe(false);
  });

  it('with the workshop wired: greets as open, leaves the key to the door, and reacts to the visit', () => {
    const rules = { workshop: true };
    const s = createGarageState();
    const events: GameEvent[] = [];
    stepGarage(s, site, car(2), cmd(), 1 / 60, events, LOCO_MUSTANG, rules);
    expect(LOCO_MUSTANG.openGreetings).toContain(s.line);
    events.length = 0;
    stepGarage(s, site, car(2), cmd(true), 1 / 60, events, LOCO_MUSTANG, rules);
    expect(events).toHaveLength(0);
    expect(garageWantsWorkshop(s, cmd(true))).toBe(true);
    expect(garageWantsWorkshop(s, cmd(false))).toBe(false);
    s.locked = true;
    expect(garageWantsWorkshop(s, cmd(true))).toBe(false);

    const said = (list: GameEvent[]): string => {
      const before = list.length;
      garageWorkshopLine(s, list);
      return list.length > before ? s.line : '';
    };
    expect(LOCO_MUSTANG.welcome).toContain(said([{ type: 'workshopEnter', shopId: 'loco-mustang' }]));
    expect(LOCO_MUSTANG.installed).toContain(said([{ type: 'workshopPurchase', shopId: 'loco-mustang', category: 'hood', value: 'hood.x', price: 900, balance: 0 }]));
    expect(said([{ type: 'workshopPurchase', shopId: 'loco-mustang', category: 'hood', value: 'hood.stock', price: 0, balance: 0 }])).toBe('');
    expect(LOCO_MUSTANG.broke).toContain(said([{ type: 'workshopDenied', reason: 'funds', category: 'hood' }]));
    expect(LOCO_MUSTANG.doorShut).toContain(said([{ type: 'workshopDenied', reason: 'police', category: null }]));
    expect(said([{ type: 'workshopDenied', reason: 'invalid', category: null }])).toBe('');
    expect(LOCO_MUSTANG.goodbye).toContain(said([{ type: 'workshopExit', shopId: 'loco-mustang', purchases: 1 }]));
  });

  it('puts OPEN on the sign', () => {
    expect(LOCO_MUSTANG.sign.sub).toMatch(/OPEN/);
    expect(LOCO_MUSTANG.sign.sub).not.toMatch(/NOT OPEN|SOON/);
    expect(LOCO_MUSTANG.tagline).not.toMatch(/SOON/);
  });
});
