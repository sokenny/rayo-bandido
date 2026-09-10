import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/world/arenaLayout';
import { createInitialGameState, stepGame } from '../src/sim/gameState';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { rayTarget } from '../src/sim/targeting';
import { canAffordShot, lightningCost, maxAffordableHold } from '../src/sim/lightning';
import { LIGHTNING, NITRO, TARGETS } from '../src/config/tuning';
import type { TargetState } from '../src/core/types';

const DT = 1 / 60;

function makeTarget(id: number, x: number, z: number, status: TargetState['status'] = 'active'): TargetState {
  return { id, x, z, y: 0, heading: 0, prevX: x, prevZ: z, prevY: 0, prevHeading: 0, vx: 0, vz: 0, status, hitTime: -1, patrolIndex: 0, patrolSpeed: 0, speed: 0, rewarded: false };
}

describe('beam aim', () => {
  it('hits the nearest active target on the line of fire', () => {
    const targets = [makeTarget(0, 0, -25), makeTarget(1, 0, -12), makeTarget(2, 20, 0), makeTarget(3, 0, -6, 'destroyed')];
    expect(rayTarget(0, 0, 0, targets, LIGHTNING.range)).toBe(1);
  });

  it('ignores targets behind the car, off the line, or past the charged reach', () => {
    expect(rayTarget(0, 0, 0, [makeTarget(0, 0, 12)], LIGHTNING.range)).toBe(-1);
    expect(rayTarget(0, 0, 0, [makeTarget(0, 6, -12)], LIGHTNING.range)).toBe(-1);
    expect(rayTarget(0, 0, 0, [makeTarget(0, 0, -20)], 10)).toBe(-1);
  });
});

describe('game rules', () => {
  it('starts with full nitro, no charge, no money and >= 3 active targets', () => {
    const layout = createArenaLayout();
    const s = createInitialGameState(layout);
    expect(s.nitro.amount).toBe(NITRO.capacity);
    expect(s.lightning.charge).toBe(0);
    expect(s.economy.money).toBe(0);
    expect(s.targets.filter((t) => t.status === 'active').length).toBeGreaterThanOrEqual(3);
  });

  it('charge does not increase while driving straight without drifting', () => {
    const layout = createArenaLayout();
    const s = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    for (let i = 0; i < 60 * 5; i++) stepGame(s, cmd, layout, DT);
    expect(s.vehicle.speed).toBeGreaterThan(10);
    expect(s.drift.active).toBe(false);
    expect(s.lightning.charge).toBe(0);
  });

  it('nitro drains while boosting and recharges gradually while moving', () => {
    const layout = createArenaLayout();
    const s = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    cmd.nitro = true;
    for (let i = 0; i < 60; i++) stepGame(s, cmd, layout, DT);
    const afterBoost = s.nitro.amount;
    expect(afterBoost).toBeLessThan(NITRO.capacity);
    cmd.nitro = false;
    for (let i = 0; i < 60 * 3; i++) stepGame(s, cmd, layout, DT);
    expect(s.nitro.amount).toBeGreaterThan(afterBoost);
    expect(s.nitro.amount).toBeLessThanOrEqual(NITRO.capacity);
  });

  it('nitro does not recharge while stationary', () => {
    const layout = createArenaLayout();
    const s = createInitialGameState(layout);
    s.nitro.amount = 10;
    const cmd = createPlayerCommand();
    for (let i = 0; i < 120; i++) stepGame(s, cmd, layout, DT);
    expect(s.nitro.amount).toBe(10);
  });

  /** Parks the car `distance` metres behind the first target, aimed at it, with full charge. */
  function aimedAtFirstTarget(distance: number) {
    const layout = createArenaLayout();
    const s = createInitialGameState(layout);
    const t = s.targets[0];
    // A patrolling target would wander off the line during a long hold; park them all, and
    // leave only this one shootable so nothing else can wander onto the line of fire.
    for (const other of s.targets) {
      other.patrolSpeed = 0;
      if (other !== t) other.status = 'disabled';
    }
    layout.targetPatrols.length = 0;
    s.vehicle.x = s.vehicle.prevX = t.x;
    s.vehicle.z = s.vehicle.prevZ = t.z + distance;
    s.vehicle.heading = s.vehicle.prevHeading = 0;
    s.lightning.charge = LIGHTNING.capacity;
    return { layout, s, t };
  }

  /** Holds fire for `hold` seconds, then releases it. */
  function holdFire(s: ReturnType<typeof createInitialGameState>, layout: ReturnType<typeof createArenaLayout>, hold: number) {
    const cmd = createPlayerCommand();
    cmd.fire = true;
    for (let i = 0; i < Math.round(hold / DT); i++) stepGame(s, cmd, layout, DT);
    cmd.fire = false;
    stepGame(s, cmd, layout, DT);
  }

  it('a held shot released with enough reach destroys the target once and pays one reward', () => {
    const { layout, s, t } = aimedAtFirstTarget(LIGHTNING.range * 0.6);
    // Six tenths of the range needs six tenths of the hold; give it three quarters.
    holdFire(s, layout, LIGHTNING.maxHold * 0.75);
    // Three quarters of a hold costs three quarters of the way from the down payment to the
    // full price — the meter pays for the reach it bought and not for the reach it did not.
    expect(s.lightning.charge).toBeCloseTo(LIGHTNING.capacity - lightningCost(LIGHTNING.maxHold * 0.75), 1);
    expect(t.status).toBe('destroyed');
    expect(s.economy.money).toBe(TARGETS.reward);
    expect(s.economy.destroyed).toBe(1);
    // A second shot at the same spot must not double pay or pick the dead target.
    s.lightning.cooldown = 0;
    holdFire(s, layout, LIGHTNING.maxHold * 0.75);
    expect(s.economy.money).toBe(TARGETS.reward);
  });

  it('a short hold falls short of a target that a long hold reaches', () => {
    const short = aimedAtFirstTarget(LIGHTNING.range * 0.8);
    holdFire(short.s, short.layout, LIGHTNING.maxHold * 0.5);
    expect(short.t.status).toBe('active');
    // The shot still left, and still cost what the half hold drew.
    expect(short.s.lightning.charge).toBeCloseTo(LIGHTNING.capacity - lightningCost(LIGHTNING.maxHold * 0.5), 1);
    expect(short.s.events.some((e) => e.type === 'lightningFired' && e.targetId < 0)).toBe(true);

    const full = aimedAtFirstTarget(LIGHTNING.range * 0.8);
    holdFire(full.s, full.layout, LIGHTNING.maxHold);
    expect(full.t.status).toBe('destroyed');
  });

  it('a shot off the line of fire misses however long it is held', () => {
    const { layout, s, t } = aimedAtFirstTarget(LIGHTNING.range * 0.5);
    s.vehicle.x = s.vehicle.prevX = t.x + 6;
    holdFire(s, layout, LIGHTNING.maxHold);
    expect(t.status).toBe('active');
  });

  it('a hold past the maximum waits at full reach and only throws on the release', () => {
    const { layout, s, t } = aimedAtFirstTarget(LIGHTNING.range * 0.95);
    const cmd = createPlayerCommand();
    cmd.fire = true;
    for (let i = 0; i < Math.round((LIGHTNING.maxHold * 2) / DT); i++) stepGame(s, cmd, layout, DT);
    // Still held, so nothing has left — but the load is paid for as it is loaded, so a full
    // hold has already drawn the full price and holding longer draws nothing more.
    expect(t.status).toBe('active');
    expect(s.lightning.charging).toBe(true);
    expect(s.lightning.hold).toBeCloseTo(LIGHTNING.maxHold);
    expect(s.lightning.charge).toBeCloseTo(LIGHTNING.capacity - LIGHTNING.cost, 1);
    cmd.fire = false;
    stepGame(s, cmd, layout, DT);
    expect(t.status).toBe('destroyed');
    // The release takes nothing further: the shot was paid for on the way up.
    expect(s.lightning.charge).toBeCloseTo(LIGHTNING.capacity - LIGHTNING.cost, 1);
  });

  it('a longer hold costs more charge than a shorter one', () => {
    const snap = aimedAtFirstTarget(5);
    holdFire(snap.s, snap.layout, LIGHTNING.minHold * 1.5);
    const snapSpent = LIGHTNING.capacity - snap.s.lightning.charge;

    const full = aimedAtFirstTarget(5);
    holdFire(full.s, full.layout, LIGHTNING.maxHold);
    const fullSpent = LIGHTNING.capacity - full.s.lightning.charge;

    expect(snapSpent).toBeGreaterThan(0);
    expect(fullSpent).toBeCloseTo(LIGHTNING.cost, 1);
    expect(fullSpent).toBeGreaterThan(snapSpent * 2);
    // Both hit: the near target is inside even the shortest reach, so what separates them here
    // is only what they cost.
    expect(snap.t.status).toBe('destroyed');
    expect(full.t.status).toBe('destroyed');
  });

  it('an empty meter stops the reach growing instead of throwing the shot', () => {
    const { layout, s, t } = aimedAtFirstTarget(LIGHTNING.range * 0.9);
    // Enough for the down payment and a little of the hold, and no drift to top it up.
    s.lightning.charge = LIGHTNING.minCost + (LIGHTNING.cost - LIGHTNING.minCost) * 0.25;
    holdFire(s, layout, LIGHTNING.maxHold);
    expect(s.lightning.charge).toBeCloseTo(0, 3);
    // The bolt left — it simply could not reach a car three quarters of the range away.
    expect(t.status).toBe('active');
    expect(s.events.some((e) => e.type === 'lightningFired')).toBe(true);
  });

  it('a tap too short to aim throws nothing and hands the charge back', () => {
    const { layout, s, t } = aimedAtFirstTarget(5);
    holdFire(s, layout, LIGHTNING.minHold * 0.5);
    expect(t.status).toBe('active');
    expect(s.lightning.charge).toBeCloseTo(LIGHTNING.capacity, 6);
    expect(s.events.some((e) => e.type === 'lightningDenied' && e.reason === 'short')).toBe(true);
  });

  it('firing without charge is denied', () => {
    const layout = createArenaLayout();
    const s = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    cmd.fire = true;
    stepGame(s, cmd, layout, DT);
    expect(s.events.some((e) => e.type === 'lightningDenied' && e.reason === 'noCharge')).toBe(true);
    expect(s.economy.money).toBe(0);
  });

  it('prices a shot by its hold, and says how far the meter can still reach', () => {
    // The published curve: the down payment at the bottom, the full price at the top, straight
    // in between. Nothing here is a threshold, so no hold is ever worth skipping past.
    expect(lightningCost(0)).toBe(LIGHTNING.minCost);
    expect(lightningCost(LIGHTNING.maxHold)).toBeCloseTo(LIGHTNING.cost, 6);
    expect(lightningCost(LIGHTNING.maxHold * 2)).toBeCloseTo(LIGHTNING.cost, 6);
    expect(lightningCost(LIGHTNING.maxHold * 0.5)).toBeCloseTo((LIGHTNING.minCost + LIGHTNING.cost) / 2, 6);
    expect(lightningCost(0.6)).toBeGreaterThan(lightningCost(0.3));

    // And the inverse: what is in the meter is a reach, and a full meter buys the full hold.
    expect(maxAffordableHold(LIGHTNING.capacity)).toBe(LIGHTNING.maxHold);
    expect(maxAffordableHold(lightningCost(0.4))).toBeCloseTo(0.4, 6);
    expect(maxAffordableHold(LIGHTNING.minCost * 0.5)).toBe(0);

    // A meter that cannot buy even the shortest hold cannot fire at all.
    expect(canAffordShot(LIGHTNING.capacity)).toBe(true);
    expect(canAffordShot(lightningCost(LIGHTNING.minHold))).toBe(true);
    expect(canAffordShot(LIGHTNING.minCost)).toBe(false);
  });

  it('refuses a press that could only ever end in a fumble', () => {
    const { layout, s } = aimedAtFirstTarget(5);
    // The down payment alone, which buys no hold at all: not a shot, so not offered as one.
    s.lightning.charge = LIGHTNING.minCost;
    const cmd = createPlayerCommand();
    cmd.fire = true;
    stepGame(s, cmd, layout, DT);
    expect(s.events.some((e) => e.type === 'lightningDenied' && e.reason === 'noCharge')).toBe(true);
    expect(s.lightning.charging).toBe(false);
    expect(s.lightning.charge).toBe(LIGHTNING.minCost);
  });

  it('restart restores the initial state immediately', () => {
    const layout = createArenaLayout();
    const s = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    for (let i = 0; i < 120; i++) stepGame(s, cmd, layout, DT);
    s.economy.money = 500;
    s.targets[0].status = 'destroyed';
    const restart = createPlayerCommand();
    restart.restart = true;
    stepGame(s, restart, layout, DT);
    expect(s.time).toBe(0);
    expect(s.economy.money).toBe(0);
    expect(s.vehicle.speed).toBe(0);
    expect(s.vehicle.x).toBe(layout.playerSpawn.x);
    expect(s.targets.every((t) => t.status === 'active')).toBe(true);
    expect(s.events.some((e) => e.type === 'restart')).toBe(true);
  });
});
