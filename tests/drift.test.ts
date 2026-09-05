import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/world/arenaLayout';
import { createInitialGameState, stepGame } from '../src/sim/gameState';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { DRIVETRAIN, LIGHTNING } from '../src/config/tuning';
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

/** A player watching the needle: throttle on below the band's middle, off near its top. */
function modulate(state: GameState, cmd: PlayerCommand): void {
  const mid = (DRIVETRAIN.bandLow + DRIVETRAIN.bandHigh) / 2;
  if (state.vehicle.rpm01 < mid) cmd.throttle = 1;
  else if (state.vehicle.rpm01 > DRIVETRAIN.bandHigh - 0.03) cmd.throttle = 0;
}

/** A player watching the angle: arrow held while the slide is shallow, lifted (the wheel self-counters) past it. */
function steerManage(state: GameState, cmd: PlayerCommand, holdBelowDeg = 28): void {
  cmd.steer = Math.abs(state.vehicle.slipAngle) * DEG < holdBelowDeg ? 1 : 0;
}

/** Hand the driver the gear the automatic is in right now. */
function goManual(state: GameState): void {
  state.transmission = 'manual';
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

    // Phase 2: manual, holding the gear; the throttle tapped into the band and the arrow
    // lifted whenever the angle gets big, so the wheel self-counters.
    goManual(state);
    const held = createPlayerCommand();
    let minSlip = Infinity;
    let maxSlip = 0;
    let alwaysActive = true;
    for (let i = 0; i < Math.round(3 / DT); i++) {
      modulate(state, held);
      steerManage(state, held);
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
    expect(state.vehicle.speed * 3.6).toBeGreaterThan(30);
  });

  it('walks out further and bogs when the throttle is pinned instead of modulated', () => {
    const outcome = (pinned: boolean): { maxSlip: number; speedKmh: number; drifting: boolean } => {
      const layout = openArena();
      const state = freshGame(layout);
      accelerateTo(state, layout, 60);
      const flick = createPlayerCommand();
      flick.steer = 1;
      flick.handbrake = true;
      hold(state, layout, flick, 0.4);
      goManual(state);
      const held = createPlayerCommand();
      held.throttle = 1;
      let maxSlip = 0;
      for (let i = 0; i < Math.round(3 / DT); i++) {
        if (!pinned) modulate(state, held);
        steerManage(state, held);
        stepGame(state, held, layout, DT);
        maxSlip = Math.max(maxSlip, Math.abs(state.vehicle.slipAngle) * DEG);
      }
      return { maxSlip, speedKmh: state.vehicle.speed * 3.6, drifting: state.drift.active };
    };
    const tapped = outcome(false);
    const pinned = outcome(true);
    expect(tapped.drifting).toBe(true);
    expect(tapped.maxSlip).toBeLessThan(50);
    // Pinned against the limiter the rear keeps coming round and the car sheds speed.
    expect(pinned.maxSlip).toBeGreaterThan(tapped.maxSlip + 8);
    expect(pinned.speedKmh).toBeLessThan(tapped.speedKmh - 4);
  });

  it('shifts up from under the drift on the automatic; the manual box keeps the gear', () => {
    const gearsAfter = (manual: boolean): { gear: number; entry: number; speedKmh: number } => {
      const layout = openArena();
      const state = freshGame(layout);
      accelerateTo(state, layout, 60);
      const entry = state.vehicle.gear;
      if (manual) goManual(state);
      const flick = createPlayerCommand();
      flick.steer = 1;
      flick.handbrake = true;
      hold(state, layout, flick, 0.4);
      const held = createPlayerCommand();
      for (let i = 0; i < Math.round(3 / DT); i++) {
        modulate(state, held);
        steerManage(state, held);
        stepGame(state, held, layout, DT);
      }
      return { gear: state.vehicle.gear, entry, speedKmh: state.vehicle.speed * 3.6 };
    };
    const auto = gearsAfter(false);
    const manual = gearsAfter(true);
    expect(manual.gear).toBe(manual.entry);
    expect(auto.gear).toBeGreaterThan(auto.entry);
    // The automatic runs away through the gears; the manual drift stays slow and tight.
    expect(auto.speedKmh).toBeGreaterThan(manual.speedKmh + 15);
  });

  it('regrips within 1.5 s once every input is released', () => {
    const layout = openArena();
    const state = freshGame(layout);
    accelerateTo(state, layout, 60);

    const flick = createPlayerCommand();
    flick.steer = 1;
    flick.handbrake = true;
    hold(state, layout, flick, 0.4);
    goManual(state);
    const held = createPlayerCommand();
    for (let i = 0; i < Math.round(1.5 / DT); i++) {
      modulate(state, held);
      steerManage(state, held);
      stepGame(state, held, layout, DT);
    }
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

describe('donut', () => {
  function donut(manual: boolean): { turned: number; box: number; gear: number; drifting: boolean; charge: number } {
    const layout = openArena();
    const state = freshGame(layout);
    if (manual) goManual(state);
    const cmd = createPlayerCommand();
    let turned = 0;
    let minX = 0;
    let maxX = 0;
    let minZ = 0;
    let maxZ = 0;
    for (let i = 0; i < Math.round(8 / DT); i++) {
      modulate(state, cmd);
      steerManage(state, cmd, 30);
      stepGame(state, cmd, layout, DT);
      turned += state.vehicle.yawRate * DT;
      minX = Math.min(minX, state.vehicle.x);
      maxX = Math.max(maxX, state.vehicle.x);
      minZ = Math.min(minZ, state.vehicle.z);
      maxZ = Math.max(maxZ, state.vehicle.z);
    }
    return {
      turned: turned * DEG,
      box: Math.max(maxX - minX, maxZ - minZ),
      gear: state.vehicle.gear,
      drifting: state.drift.active,
      charge: state.lightning.charge,
    };
  }

  it('is a drift in first on the manual box: full lock and a tapped throttle from a standstill', () => {
    const d = donut(true);
    expect(d.turned).toBeGreaterThan(360);
    expect(d.box).toBeLessThan(16);
    expect(d.gear).toBe(0);
    expect(d.drifting).toBe(true);
    expect(d.charge).toBeGreaterThan(20);
  });

  it('runs away through the gears on the automatic: the same inputs make a wide, fast slide', () => {
    const d = donut(false);
    expect(d.gear).toBeGreaterThan(0);
    expect(d.box).toBeGreaterThan(25);
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

    goManual(state);
    const held = createPlayerCommand();
    let chargeAt1s = 0;
    let costTime = -1;
    for (let i = 0; i < Math.round(6 / DT); i++) {
      modulate(state, held);
      steerManage(state, held);
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

  it('pays a throttle held in the band more than one pinned against the limiter', () => {
    const charged = (pinned: boolean): number => {
      const layout = openArena();
      const state = freshGame(layout);
      accelerateTo(state, layout, 60);
      const flick = createPlayerCommand();
      flick.steer = 1;
      flick.handbrake = true;
      hold(state, layout, flick, 0.4);
      goManual(state);
      const held = createPlayerCommand();
      held.throttle = 1;
      for (let i = 0; i < Math.round(4 / DT); i++) {
        if (!pinned) modulate(state, held);
        steerManage(state, held);
        stepGame(state, held, layout, DT);
      }
      return state.lightning.charge;
    };
    expect(charged(false)).toBeGreaterThan(charged(true) * 1.3);
  });
});
