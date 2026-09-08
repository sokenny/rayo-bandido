import { describe, expect, it } from 'vitest';
import { buyMoogul, canBuyMoogul, createBuhoState, layerAmount, moogulIntensity, stepBuho } from '../src/sim/buho';
import { BUHO, validateBuho } from '../src/content/buho';
import { hasPortrait } from '../src/ui/portraits';
import { spendMoney } from '../src/sim/economy';
import { createInitialGameState, createVehicleState, stepGame } from '../src/sim/gameState';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { MOOGUL, PASSENGER, RUSH } from '../src/config/tuning';
import { createCityWorld } from '../src/world/cityWorld';
import { BUHO_SITE, PASSENGER_STOPS, RUSH_SITES } from '../src/world/citySpec';
import type { ActivitySite, EconomyState, GameEvent } from '../src/core/types';

/**
 * El Búho and the Moogul (`src/sim/buho.ts`, `src/content/buho.ts`, `src/world/citySpec.ts`).
 *
 * What is worth pinning: that the purchase charges exactly once and only on the second press;
 * that no money and a Moogul already in the player both buy nothing; that the envelope is a
 * genuine delay followed by a smooth rise and fall; that another activity taking the car ends
 * the trip on the same tick; and that his bay is somewhere a car can actually stand.
 */

const DT = 1 / 60;
const SITE: ActivitySite = { x: 0, z: 0, y: 0, heading: 0 };

function rig(money = 1000) {
  const s = createBuhoState();
  const vehicle = createVehicleState(-200, -200, 0);
  const economy: EconomyState = { money, destroyed: 0, lastReward: 0 };
  const cmd = createPlayerCommand();
  const events: GameEvent[] = [];
  const tick = (activate = false): GameEvent[] => {
    events.length = 0;
    cmd.activate = activate;
    stepBuho(s, SITE, vehicle, economy, cmd, DT, events);
    return events.slice();
  };
  const park = (): void => {
    vehicle.x = 1;
    vehicle.z = 0;
  };
  const leave = (): void => {
    vehicle.x = -200;
    vehicle.z = -200;
  };
  return { s, vehicle, economy, cmd, tick, park, leave };
}

const ofType = (events: readonly GameEvent[], type: GameEvent['type']): GameEvent[] => events.filter((e) => e.type === type);

/* ================================================================== the catalogue */

describe('el búho: the catalogue', () => {
  it('is playable and has a face', () => {
    expect(validateBuho(BUHO)).toEqual([]);
    expect(hasPortrait(BUHO.portrait)).toBe(true);
  });
});

/* ================================================================== the purchase */

describe('el búho: the purchase', () => {
  it('greets on the paint, arms on the first press and charges once on the second', () => {
    const r = rig(1000);
    r.park();
    const arrived = r.tick();
    expect(ofType(arrived, 'buhoPrompt')).toEqual([{ type: 'buhoPrompt', on: true }]);
    expect(ofType(arrived, 'buhoLine').length).toBe(1);
    expect(BUHO.greetings).toContain(r.s.line);
    expect(canBuyMoogul(r.s)).toBe(true);

    const first = r.tick(true);
    expect(ofType(first, 'buhoPurchase')).toHaveLength(0);
    expect(r.s.confirmArm).toBeGreaterThan(0);
    expect(r.economy.money).toBe(1000);
    expect(r.s.moogulActive).toBe(false);

    const second = r.tick(true);
    expect(ofType(second, 'buhoPurchase')).toEqual([{ type: 'buhoPurchase', price: MOOGUL.price }]);
    expect(r.economy.money).toBe(1000 - MOOGUL.price);
    expect(r.s.moogulActive).toBe(true);
    expect(r.s.moogulElapsed).toBe(0);
    expect(BUHO.remarks).toContain(r.s.line);
    expect(canBuyMoogul(r.s)).toBe(false);
  });

  it('never charges twice: a third press, and every press after it, is refused while it lasts', () => {
    const r = rig(1000);
    r.park();
    r.tick();
    r.tick(true);
    r.tick(true);
    expect(r.economy.money).toBe(1000 - MOOGUL.price);
    for (let i = 0; i < 5; i++) {
      const again = r.tick(true);
      expect(ofType(again, 'buhoPurchase')).toHaveLength(0);
      expect(ofType(again, 'buhoDenied')).toEqual([{ type: 'buhoDenied', reason: 'active' }]);
    }
    expect(r.economy.money).toBe(1000 - MOOGUL.price);
    expect(r.s.purchases).toBe(1);
    expect(BUHO.busy).toContain(r.s.line);
  });

  it('refuses without the money and starts nothing', () => {
    const r = rig(MOOGUL.price - 10);
    r.park();
    r.tick();
    r.tick(true);
    const refused = r.tick(true);
    expect(ofType(refused, 'buhoDenied')).toEqual([{ type: 'buhoDenied', reason: 'funds' }]);
    expect(ofType(refused, 'buhoPurchase')).toHaveLength(0);
    expect(r.economy.money).toBe(MOOGUL.price - 10);
    expect(r.s.moogulActive).toBe(false);
    expect(r.s.notice).toBe('funds');
    expect(BUHO.broke).toContain(r.s.line);
    // Exactly the price is enough.
    r.economy.money = MOOGUL.price;
    r.tick(true);
    r.tick(true);
    expect(r.s.moogulActive).toBe(true);
    expect(r.economy.money).toBe(0);
  });

  it('lets the confirm lapse, and lets go of everything on leaving the paint', () => {
    const r = rig(1000);
    r.park();
    r.tick();
    r.tick(true);
    for (let t = 0; t < MOOGUL.confirmSeconds + 0.5; t += DT) r.tick();
    expect(r.s.confirmArm).toBe(0);
    r.tick(true);
    expect(r.s.confirmArm).toBeGreaterThan(0);
    r.leave();
    const gone = r.tick();
    expect(ofType(gone, 'buhoPrompt')).toEqual([{ type: 'buhoPrompt', on: false }]);
    expect(r.s.confirmArm).toBe(0);
    expect(r.economy.money).toBe(1000);
    // Back again: a fresh greeting, a fresh arm.
    r.park();
    expect(ofType(r.tick(), 'buhoLine').length).toBe(1);
  });

  it('sells nothing while another activity has the car', () => {
    const r = rig(1000);
    r.park();
    r.s.locked = true;
    const arrived = r.tick();
    expect(ofType(arrived, 'buhoLine')).toHaveLength(0);
    expect(canBuyMoogul(r.s)).toBe(false);
    r.tick(true);
    r.tick(true);
    expect(r.economy.money).toBe(1000);
    expect(r.s.moogulActive).toBe(false);
  });

  it('wears off after the duration, exactly once, and can be bought again afterwards', () => {
    const r = rig(1000);
    r.park();
    r.tick();
    r.tick(true);
    r.tick(true);
    r.leave();
    let ends = 0;
    for (let t = 0; t < MOOGUL.timeline.duration + 2; t += DT) ends += ofType(r.tick(), 'moogulEnd').length;
    expect(ends).toBe(1);
    expect(r.s.moogulActive).toBe(false);
    expect(r.s.moogulElapsed).toBe(0);
    r.park();
    r.tick();
    r.tick(true);
    r.tick(true);
    expect(r.s.moogulActive).toBe(true);
    expect(r.s.purchases).toBe(2);
    expect(r.economy.money).toBe(1000 - 2 * MOOGUL.price);
  });

  it('buyMoogul and spendMoney are all-or-nothing', () => {
    const e: EconomyState = { money: 50, destroyed: 0, lastReward: 0 };
    expect(spendMoney(e, 60)).toBe(false);
    expect(e.money).toBe(50);
    expect(spendMoney(e, 50)).toBe(true);
    expect(e.money).toBe(0);
    const s = createBuhoState();
    const events: GameEvent[] = [];
    expect(buyMoogul(s, BUHO, e, events)).toBe(false);
    expect(s.moogulActive).toBe(false);
  });
});

/* ================================================================== the envelope */

describe('the moogul: the envelope', () => {
  it('is nothing for the first minute, barely there by two and a half, peaks between 4:30 and 6:00, and is gone at eight', () => {
    expect(moogulIntensity(0)).toBe(0);
    expect(moogulIntensity(30)).toBe(0);
    expect(moogulIntensity(60)).toBe(0);
    expect(moogulIntensity(90)).toBeLessThan(0.05);
    expect(moogulIntensity(150)).toBeLessThanOrEqual(0.13);
    expect(moogulIntensity(150)).toBeGreaterThan(0.08);
    expect(moogulIntensity(270)).toBeGreaterThan(0.45);
    let peak = 0;
    let peakAt = 0;
    for (let t = 0; t <= 480; t += 1) {
      const v = moogulIntensity(t);
      if (v > peak) {
        peak = v;
        peakAt = t;
      }
    }
    expect(peak).toBeGreaterThan(0.98);
    expect(peakAt).toBeGreaterThanOrEqual(270);
    expect(peakAt).toBeLessThanOrEqual(360);
    expect(moogulIntensity(480)).toBe(0);
    expect(moogulIntensity(600)).toBe(0);
  });

  it('rises without a step up to the peak and falls without a step after it', () => {
    let prev = 0;
    let biggest = 0;
    let rising = true;
    for (let t = 0; t <= 480; t += 0.5) {
      const v = moogulIntensity(t);
      biggest = Math.max(biggest, Math.abs(v - prev));
      if (rising && v < prev - 1e-9 && t > 300) rising = false;
      if (!rising) expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    // Half a second never moves it more than a couple of percent: no stage switches.
    expect(biggest).toBeLessThan(0.025);
  });

  it('scales with the duration and keys the layers on their own windows', () => {
    const short = { duration: 60, keys: MOOGUL.timeline.keys };
    expect(moogulIntensity(7, short)).toBe(0);
    expect(moogulIntensity(40, short)).toBeGreaterThan(0.95);
    expect(moogulIntensity(60, short)).toBe(0);
    expect(layerAmount(0.3, [0.4, 0.9])).toBe(0);
    expect(layerAmount(0.9, [0.4, 0.9])).toBe(1);
    expect(layerAmount(0.65, [0.4, 0.9])).toBeCloseTo(0.5, 5);
  });
});

/* ================================================================== in the city */

describe('el búho: in the city', () => {
  const { layout, plan } = createCityWorld();

  it('has a bay the car can stand in, level, on drivable ground, clear of everything else', () => {
    const site = layout.buhoSite!;
    expect(site).toBeTruthy();
    expect(site.x).toBe(BUHO_SITE.x);
    const m = MOOGUL.marker;
    const out = { y: 0, gx: 0, gz: 0 };
    for (const [ox, oz] of [
      [0, 0],
      [m.promptRadius * 0.7, 0],
      [-m.promptRadius * 0.7, 0],
      [0, m.promptRadius * 0.7],
      [0, -m.promptRadius * 0.7],
    ]) {
      const x = site.x + ox;
      const z = site.z + oz;
      expect(plan.isRoad(x, z), `(${x}, ${z}) is not drivable`).toBe(true);
      expect(plan.isSolid(x, z), `(${x}, ${z}) is inside something`).toBe(false);
      layout.surface!.sample(x, z, 0, out);
      expect(out.y).toBeCloseTo(site.y, 3);
    }
    // No ground-level collider inside the ring: the columns stand outside it.
    const reach = m.exitRadius;
    for (const c of layout.colliders) {
      if ((c.minY ?? 0) > 1) continue;
      const dx = site.x < c.minX ? c.minX - site.x : site.x > c.maxX ? site.x - c.maxX : 0;
      const dz = site.z < c.minZ ? c.minZ - site.z : site.z > c.maxZ ? site.z - c.maxZ : 0;
      expect(Math.hypot(dx, dz), `${c.tag} collider inside the ring`).toBeGreaterThan(reach);
    }
    // Under the deck: an elevated ribbon runs over it.
    expect(plan.ribbons.some((rb) => rb.elevated && rb.path.samples.some((s) => Math.hypot(s.x - site.x, s.z - site.z) < s.halfWidth))).toBe(true);
    for (const stop of PASSENGER_STOPS) expect(Math.hypot(stop.x - site.x, stop.z - site.z)).toBeGreaterThan(PASSENGER.marker.exitRadius + reach + 10);
    for (const rush of RUSH_SITES) expect(Math.hypot(rush.x - site.x, rush.z - site.z)).toBeGreaterThan(RUSH.marker.rearmRadius + reach + 10);
  });

  it('ends the moogul on the tick a RAYO RUSH run starts, and sells nothing while one is on', () => {
    const state = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    const site = layout.buhoSite!;
    const v = state.vehicle;
    v.x = v.prevX = site.x;
    v.z = v.prevZ = site.z;
    state.economy.money = 1000;
    stepGame(state, cmd, layout, DT);
    cmd.activate = true;
    stepGame(state, cmd, layout, DT);
    stepGame(state, cmd, layout, DT);
    cmd.activate = false;
    expect(state.buho!.moogulActive).toBe(true);
    expect(state.economy.money).toBe(1000 - MOOGUL.price);

    // Drive (teleport) to the RUSH marker and take up the run: the same tick ends the trip.
    const rushSite = layout.rushSites![0];
    v.x = v.prevX = rushSite.x;
    v.z = v.prevZ = rushSite.z;
    stepGame(state, cmd, layout, DT);
    cmd.activate = true;
    stepGame(state, cmd, layout, DT);
    cmd.activate = false;
    const events = state.events;
    expect(ofType(events, 'rushStart')).toHaveLength(1);
    expect(ofType(events, 'moogulEnd')).toEqual([{ type: 'moogulEnd', reason: 'interrupted' }]);
    expect(state.buho!.moogulActive).toBe(false);

    // Back to the bay with the run on: he sells nothing.
    v.x = v.prevX = site.x;
    v.z = v.prevZ = site.z;
    stepGame(state, cmd, layout, DT);
    expect(state.buho!.locked).toBe(true);
    cmd.activate = true;
    stepGame(state, cmd, layout, DT);
    stepGame(state, cmd, layout, DT);
    cmd.activate = false;
    expect(state.buho!.moogulActive).toBe(false);
    expect(state.economy.money).toBe(1000 - MOOGUL.price);
  });

  it('is cleared by a restart, with the end raised', () => {
    const state = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    const site = layout.buhoSite!;
    state.vehicle.x = site.x;
    state.vehicle.z = site.z;
    state.economy.money = 1000;
    stepGame(state, cmd, layout, DT);
    cmd.activate = true;
    stepGame(state, cmd, layout, DT);
    stepGame(state, cmd, layout, DT);
    cmd.activate = false;
    expect(state.buho!.moogulActive).toBe(true);
    cmd.restart = true;
    stepGame(state, cmd, layout, DT);
    cmd.restart = false;
    expect(ofType(state.events, 'moogulEnd')).toEqual([{ type: 'moogulEnd', reason: 'restart' }]);
    expect(state.buho!.moogulActive).toBe(false);
    expect(state.buho!.atSite).toBe(false);
  });
});
