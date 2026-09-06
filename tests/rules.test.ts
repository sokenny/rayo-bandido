import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/world/arenaLayout';
import { createInitialGameState, stepGame } from '../src/sim/gameState';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { selectTarget } from '../src/sim/targeting';
import { LIGHTNING, NITRO, TARGETS } from '../src/config/tuning';
import type { TargetState } from '../src/core/types';

const DT = 1 / 60;

function makeTarget(id: number, x: number, z: number, status: TargetState['status'] = 'active'): TargetState {
  return { id, x, z, y: 0, heading: 0, prevX: x, prevZ: z, prevY: 0, prevHeading: 0, vx: 0, vz: 0, status, hitTime: -1, patrolIndex: 0, patrolSpeed: 0, rewarded: false };
}

describe('targeting cone', () => {
  it('picks the nearest active target inside the forward cone', () => {
    const targets = [makeTarget(0, 0, -40), makeTarget(1, 0, -20), makeTarget(2, 30, 0), makeTarget(3, 0, -10, 'destroyed')];
    expect(selectTarget(0, 0, 0, targets)).toBe(1);
  });

  it('ignores targets outside the range or behind the car', () => {
    const targets = [makeTarget(0, 0, 60), makeTarget(1, 0, -80)];
    expect(selectTarget(0, 0, 0, targets)).toBe(-1);
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

  it('firing with enough charge destroys the acquired target once and pays exactly one reward', () => {
    const layout = createArenaLayout();
    const s = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    // Aim the car at the first target and grant charge.
    const t = s.targets[0];
    s.vehicle.x = t.x;
    s.vehicle.z = t.z + 20;
    s.vehicle.heading = 0;
    s.lightning.charge = LIGHTNING.capacity;
    cmd.fire = true;
    stepGame(s, cmd, layout, DT);
    expect(s.lightning.charge).toBeCloseTo(LIGHTNING.capacity - LIGHTNING.cost);
    expect(t.status).toBe('destroyed');
    expect(s.economy.money).toBe(TARGETS.reward);
    expect(s.economy.destroyed).toBe(1);
    // A second immediate shot at the same spot must not double pay or pick the dead target.
    stepGame(s, cmd, layout, DT);
    expect(s.economy.money).toBe(TARGETS.reward);
  });

  it('firing without charge is denied', () => {
    const layout = createArenaLayout();
    const s = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    cmd.fire = true;
    stepGame(s, cmd, layout, DT);
    expect(s.events.some((e) => e.type === 'lightningDenied')).toBe(true);
    expect(s.economy.money).toBe(0);
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
