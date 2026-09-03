import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/world/arenaLayout';
import { createInitialGameState, stepGame } from '../src/sim/gameState';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { LIGHTNING } from '../src/config/tuning';
import type { ArenaLayout, GameState, PlayerCommand } from '../src/core/types';

/**
 * Drift loop regression tests: straight driving never charges, a handbrake flick starts a
 * drift that can be held on throttle + steering, releasing the inputs regrips, and a held
 * drift charges the lightning to its 50-unit cost quickly.
 *
 * They run the whole simulation through `stepGame`, but on an obstacle-free copy of the
 * arena so the results depend on the vehicle model instead of on the current city layout.
 */

const DT = 1 / 60;
const DEG = 180 / Math.PI;

/** Real arena data with the colliders removed and the bounds pushed far away. */
function openArena(): ArenaLayout {
  const layout = createArenaLayout();
  layout.colliders.length = 0;
  layout.bounds.minX = -100000;
  layout.bounds.maxX = 100000;
  layout.bounds.minZ = -100000;
  layout.bounds.maxZ = 100000;
  return layout;
}

function freshGame(layout: ArenaLayout): GameState {
  const state = createInitialGameState(layout);
  state.vehicle.x = 0;
  state.vehicle.z = 0;
  state.vehicle.heading = 0;
  state.vehicle.prevX = 0;
  state.vehicle.prevZ = 0;
  state.vehicle.prevHeading = 0;
  return state;
}

function accelerateTo(state: GameState, layout: ArenaLayout, targetKmh: number): void {
  const cmd = createPlayerCommand();
  cmd.throttle = 1;
  let guard = 0;
  while (state.vehicle.speed * 3.6 < targetKmh && guard++ < 60 * 30) stepGame(state, cmd, layout, DT);
}

function hold(state: GameState, layout: ArenaLayout, cmd: PlayerCommand, seconds: number): void {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) stepGame(state, cmd, layout, DT);
}

describe('no false positives', () => {
  it('ten seconds of full throttle in a straight line never drifts and never charges', () => {
    const layout = openArena();
    const state = freshGame(layout);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    let maxSlip = 0;
    for (let i = 0; i < 60 * 10; i++) {
      stepGame(state, cmd, layout, DT);
      maxSlip = Math.max(maxSlip, Math.abs(state.vehicle.slipAngle));
      expect(state.drift.active).toBe(false);
    }
    expect(maxSlip * DEG).toBeLessThan(1);
    expect(state.lightning.charge).toBe(0);
    expect(state.drift.chargeRate).toBe(0);
    expect(state.vehicle.speed * 3.6).toBeGreaterThan(150);
  });
});

describe('handbrake drift', () => {
  it('flicks into a drift at 60 km/h and holds it on throttle + steering', () => {
    const layout = openArena();
    const state = freshGame(layout);
    accelerateTo(state, layout, 60);

    // Phase 1: steer + handbrake for 0.4 s.
    const flick = createPlayerCommand();
    flick.steer = 1;
    flick.handbrake = true;
    let activationTime = -1;
    let elapsed = 0;
    for (let i = 0; i < Math.round(0.4 / DT); i++) {
      stepGame(state, flick, layout, DT);
      elapsed += DT;
      if (activationTime < 0 && state.drift.active) activationTime = elapsed;
    }

    // Phase 2: throttle + steer, no handbrake.
    const held = createPlayerCommand();
    held.throttle = 1;
    held.steer = 1;
    let minSlip = Infinity;
    let maxSlip = 0;
    let alwaysActive = true;
    for (let i = 0; i < Math.round(3 / DT); i++) {
      stepGame(state, held, layout, DT);
      elapsed += DT;
      if (activationTime < 0 && state.drift.active) activationTime = elapsed;
      if (activationTime >= 0) {
        const slip = Math.abs(state.vehicle.slipAngle) * DEG;
        minSlip = Math.min(minSlip, slip);
        maxSlip = Math.max(maxSlip, slip);
        if (!state.drift.active) alwaysActive = false;
      }
    }

    expect(activationTime).toBeGreaterThan(0);
    expect(activationTime).toBeLessThanOrEqual(0.8);
    expect(minSlip).toBeGreaterThan(12);
    expect(maxSlip).toBeLessThan(50);
    expect(alwaysActive).toBe(true);
    expect(state.drift.active).toBe(true);
    expect(state.drift.duration).toBeGreaterThanOrEqual(3);
    // A drift still covers ground.
    expect(state.vehicle.speed * 3.6).toBeGreaterThan(35);
  });

  it('regrips within 1.5 s once every input is released', () => {
    const layout = openArena();
    const state = freshGame(layout);
    accelerateTo(state, layout, 60);

    const flick = createPlayerCommand();
    flick.steer = 1;
    flick.handbrake = true;
    hold(state, layout, flick, 0.4);
    const held = createPlayerCommand();
    held.throttle = 1;
    held.steer = 1;
    hold(state, layout, held, 1.5);
    expect(state.drift.active).toBe(true);
    expect(Math.abs(state.vehicle.slipAngle) * DEG).toBeGreaterThan(12);

    const release = createPlayerCommand();
    let settleTime = -1;
    for (let i = 0; i < Math.round(1.5 / DT); i++) {
      stepGame(state, release, layout, DT);
      if (settleTime < 0 && Math.abs(state.vehicle.slipAngle) * DEG < 6) settleTime = (i + 1) * DT;
    }
    expect(settleTime).toBeGreaterThan(0);
    expect(settleTime).toBeLessThan(1.5);
    expect(Math.abs(state.vehicle.slipAngle) * DEG).toBeLessThan(6);
    // No violent snap into an opposite slide.
    expect(Math.abs(state.vehicle.slipAngle) * DEG).toBeLessThan(6);
  });

  it('power oversteer alone (no handbrake) also builds a slide above 70 km/h', () => {
    const layout = openArena();
    const state = freshGame(layout);
    accelerateTo(state, layout, 75);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    cmd.steer = 1;
    let activationTime = -1;
    for (let i = 0; i < Math.round(4 / DT); i++) {
      stepGame(state, cmd, layout, DT);
      if (activationTime < 0 && state.drift.active) activationTime = (i + 1) * DT;
    }
    expect(activationTime).toBeGreaterThan(0.3); // gradual, never twitchy
    expect(activationTime).toBeLessThan(3);
    expect(state.drift.active).toBe(true);
  });
});

describe('lightning charge from drifting', () => {
  it('charges past the shot cost within 6 s of a sustained drift', () => {
    const layout = openArena();
    const state = freshGame(layout);
    accelerateTo(state, layout, 60);

    const flick = createPlayerCommand();
    flick.steer = 1;
    flick.handbrake = true;
    hold(state, layout, flick, 0.4);
    expect(state.lightning.charge).toBeGreaterThanOrEqual(0);

    const held = createPlayerCommand();
    held.throttle = 1;
    held.steer = 1;
    let chargeAt1s = 0;
    let costTime = -1;
    for (let i = 0; i < Math.round(6 / DT); i++) {
      stepGame(state, held, layout, DT);
      if (i === Math.round(1 / DT) - 1) chargeAt1s = state.lightning.charge;
      if (costTime < 0 && state.lightning.charge >= LIGHTNING.cost) costTime = (i + 1) * DT;
    }
    expect(chargeAt1s).toBeGreaterThan(0);
    expect(state.lightning.charge).toBeGreaterThan(chargeAt1s);
    expect(costTime).toBeGreaterThan(0);
    expect(costTime).toBeLessThanOrEqual(6);
    expect(state.drift.chargeRate).toBeGreaterThan(0);
  });
});
