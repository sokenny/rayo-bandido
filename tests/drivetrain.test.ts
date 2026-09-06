import { describe, expect, it } from 'vitest';
import { createInitialGameState, createVehicleState, stepGame } from '../src/sim/gameState';
import { createArenaLayout } from '../src/world/arenaLayout';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { stepVehicle } from '../src/sim/vehicle';
import {
  GEAR_COUNT,
  REF_SPEED,
  autoGear,
  bandEntrySpeed,
  gearTopSpeed,
  roadRpm01,
  shiftKickStrength,
  spinAuthority,
  lugFactor,
  stepDrivetrain,
  torqueGate,
} from '../src/sim/drivetrain';
import { DRIVETRAIN } from '../src/config/tuning';

/**
 * Drivetrain contract: an automatic that reads like a car (rpm linear through zero, shifts
 * that land mid-range), an engine that can only rev above road speed under throttle, in
 * proportion to the gear's torque, and a gear lock that holds through a slide.
 */

const DT = 1 / 60;

describe('automatic gearbox', () => {
  it('reads rpm linear through zero and reaches redline at the gear top', () => {
    expect(roadRpm01(0, 0)).toBe(0);
    expect(roadRpm01(gearTopSpeed(0) / 2, 0)).toBeCloseTo(0.5, 5);
    expect(roadRpm01(gearTopSpeed(2), 2)).toBeCloseTo(1, 5);
    expect(roadRpm01(REF_SPEED * 2, GEAR_COUNT - 1)).toBe(1);
  });

  it('shifts up at the gear top and lands the note mid-range, never at idle', () => {
    for (let g = 0; g < GEAR_COUNT - 1; g++) {
      const top = gearTopSpeed(g);
      expect(autoGear(top - 1e-3, g)).toBe(g);
      expect(autoGear(top, g)).toBe(g + 1);
      const landed = roadRpm01(top, g + 1);
      expect(landed).toBeGreaterThan(0.4);
      expect(landed).toBeLessThan(0.9);
    }
  });

  it('shifts down with hysteresis: not at the same speed it shifted up', () => {
    const top1 = gearTopSpeed(0);
    expect(autoGear(top1 - 1e-3, 1)).toBe(1);
    expect(autoGear(top1 * DRIVETRAIN.downshiftRpm, 1)).toBe(0);
  });

  it('finds the right gear from any starting gear', () => {
    expect(autoGear(0, 5)).toBe(0);
    expect(autoGear(REF_SPEED, 0)).toBe(GEAR_COUNT - 1);
  });
});

describe('torque and wheelspin', () => {
  it('has the most authority in first and none in top; sliding adds some', () => {
    for (let g = 1; g < GEAR_COUNT; g++) expect(spinAuthority(g, 0)).toBeLessThan(spinAuthority(g - 1, 0));
    expect(spinAuthority(0, 0)).toBe(1);
    expect(spinAuthority(GEAR_COUNT - 1, 1)).toBe(0);
    expect(spinAuthority(2, 1)).toBeGreaterThan(spinAuthority(2, 0));
  });

  it('gates torque to the band: nothing well below it, everything inside it', () => {
    expect(torqueGate(0)).toBe(0);
    expect(torqueGate(DRIVETRAIN.bandLow - DRIVETRAIN.bandRamp)).toBe(0);
    expect(torqueGate(DRIVETRAIN.bandLow)).toBe(1);
    expect(torqueGate(1)).toBe(1);
  });

  it('needs more road speed to reach the band with every gear', () => {
    expect(bandEntrySpeed(0)).toBe(0);
    for (let g = 1; g < GEAR_COUNT; g++) expect(bandEntrySpeed(g)).toBeGreaterThan(bandEntrySpeed(g - 1));
  });

  it('revs up under throttle in first at a standstill and falls back when it lifts', () => {
    const v = createVehicleState(0, 0, 0);
    for (let i = 0; i < 60; i++) stepDrivetrain(v, 1, 0, true, 1, false, 0, DT);
    expect(v.rpm01).toBeCloseTo(1, 5);
    expect(v.wheelspin).toBe(1);
    for (let i = 0; i < 60; i++) stepDrivetrain(v, 0, 0, true, 1, false, 0, DT);
    expect(v.rpm01).toBe(0);
    expect(v.wheelspin).toBe(0);
  });

  it('never spins the wheels without throttle, however fast the road rpm falls', () => {
    const v = createVehicleState(0, 0, 0);
    // Hard braking in first: road rpm collapses in a few ticks.
    for (let i = 0; i < 30; i++) stepDrivetrain(v, 0, gearTopSpeed(0) * (1 - i / 30), true, 1, false, 0, DT);
    expect(v.wheelspin).toBe(0);
    expect(v.rpm01).toBeCloseTo(roadRpm01(gearTopSpeed(0) * (1 - 29 / 30), 0), 5);
  });

  it('cannot reach the band in top gear at cruising speed, but can in first', () => {
    const top = createVehicleState(0, 0, 0);
    top.gear = GEAR_COUNT - 1;
    top.slide = 1;
    const speed = gearTopSpeed(GEAR_COUNT - 1) * 0.5;
    // Manual, so the box holds top gear: the automatic would pick a lower one at this speed.
    for (let i = 0; i < 120; i++) stepDrivetrain(top, 1, speed, true, 1, true, 0, DT);
    expect(top.wheelspin).toBe(0);
    expect(top.rpm01).toBeCloseTo(0.5, 5);

    const first = createVehicleState(0, 0, 0);
    for (let i = 0; i < 120; i++) stepDrivetrain(first, 1, 2, true, 1, false, 0, DT);
    expect(first.gear).toBe(0);
    expect(first.wheelspin).toBe(1);
  });
});

describe('manual box', () => {
  it('moves only on the player\'s shifts, clamped to the gear range', () => {
    const v = createVehicleState(0, 0, 0);
    const speed = gearTopSpeed(2) * 0.5;
    for (let i = 0; i < 30; i++) stepDrivetrain(v, 1, speed, true, 0, true, 0, DT);
    expect(v.gear).toBe(0); // the automatic would be in third; the manual stays where it was put
    stepDrivetrain(v, 1, speed, true, 0, true, 1, DT);
    stepDrivetrain(v, 1, speed, true, 0, true, 1, DT);
    expect(v.gear).toBe(2);
    stepDrivetrain(v, 1, speed, true, 0, true, -1, DT);
    expect(v.gear).toBe(1);
    for (let i = 0; i < 10; i++) stepDrivetrain(v, 1, speed, true, 0, true, -1, DT);
    expect(v.gear).toBe(0);
    for (let i = 0; i < 10; i++) stepDrivetrain(v, 1, speed, true, 0, true, 1, DT);
    expect(v.gear).toBe(GEAR_COUNT - 1);
  });

  it('ignores shift requests on the automatic', () => {
    const v = createVehicleState(0, 0, 0);
    const speed = gearTopSpeed(2) * 0.5;
    for (let i = 0; i < 30; i++) stepDrivetrain(v, 1, speed, true, 0, false, 1, DT);
    expect(v.gear).toBe(autoGear(speed, 0));
  });

  it('reads redline when the road is past the gear\'s top, and lugs at low revs in a tall gear', () => {
    const v = createVehicleState(0, 0, 0);
    v.gear = 1;
    stepDrivetrain(v, 0, gearTopSpeed(1) * 1.3, true, 0, true, 0, DT);
    expect(v.rpm01).toBe(1);
    expect(lugFactor(0, 3)).toBeCloseTo(DRIVETRAIN.lugDrive, 5);
    expect(lugFactor(DRIVETRAIN.lugRpm, 3)).toBeCloseTo(1, 5);
    expect(lugFactor(0, 0)).toBe(1); // first gear pulls from idle
  });

  it('holds first gear at the limiter instead of shifting, so a drift can stay in the band', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    let peak = 0;
    for (let i = 0; i < 60 * 4; i++) {
      stepVehicle(v, cmd, false, DT, false, true);
      peak = Math.max(peak, v.speed);
    }
    expect(v.gear).toBe(0);
    expect(peak).toBeLessThanOrEqual(gearTopSpeed(0) + 0.5);
  });

  it('is dragged down to the gear\'s top after a downshift the road was too fast for', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    for (let i = 0; i < 60 * 4; i++) stepVehicle(v, cmd, false, DT); // automatic, up to ~third
    expect(v.gear).toBeGreaterThanOrEqual(2);
    v.gear = 1;
    const before = v.speed;
    for (let i = 0; i < 60 * 2; i++) stepVehicle(v, cmd, false, DT, false, true);
    expect(v.speed).toBeLessThan(before);
    expect(v.speed).toBeLessThanOrEqual(gearTopSpeed(1) + 0.5);
    expect(v.rpm01).toBeGreaterThan(0.95);
  });
});

describe('the gearbox does not change how the car handles', () => {
  /**
   * The premise of keeping the manual box while reverting the realistic drift model: the
   * drivetrain reads `slide` and gives nothing back to it. Same entry, same inputs, either
   * box — the slide has to be identical, even with the manual pinned against the limiter.
   */
  it('produces the same slide on either box, limiter included', () => {
    const slideAfterFlick = (manual: boolean): { slip: number; rpm: number; gear: number } => {
      const layout = createArenaLayout();
      layout.colliders.length = 0;
      layout.bounds.minX = -100000;
      layout.bounds.maxX = 100000;
      layout.bounds.minZ = -100000;
      layout.bounds.maxZ = 100000;
      const state = createInitialGameState(layout);
      state.vehicle.x = 0;
      state.vehicle.z = 0;
      state.vehicle.heading = 0;
      const go = createPlayerCommand();
      go.throttle = 1;
      // Both runs reach 60 km/h on the automatic, so they enter the flick identically.
      let guard = 0;
      while (state.vehicle.speed * 3.6 < 60 && guard++ < 60 * 30) stepGame(state, go, layout, DT);
      // Hand the gear over only now: the manual box then holds this gear through the slide.
      if (manual) state.transmission = 'manual';
      const flick = createPlayerCommand();
      flick.steer = 1;
      flick.handbrake = true;
      for (let i = 0; i < Math.round(0.4 / DT); i++) stepGame(state, flick, layout, DT);
      const held = createPlayerCommand();
      held.throttle = 1;
      held.steer = 1;
      for (let i = 0; i < Math.round(2 / DT); i++) stepGame(state, held, layout, DT);
      const v = state.vehicle;
      return { slip: Math.abs(v.slipAngle), rpm: v.rpm01, gear: v.gear };
    };
    const auto = slideAfterFlick(false);
    const manual = slideAfterFlick(true);
    // The boxes really are in different states: the manual is sitting on the limiter.
    expect(manual.rpm).toBeGreaterThan(auto.rpm + 0.2);
    // ...and the car slides exactly the same anyway.
    expect(manual.slip).toBeCloseTo(auto.slip, 6);
  });
});

describe('reason to spin', () => {
  it('does not spin the rear on a straight, only with a reason', () => {
    const v = createVehicleState(0, 0, 0);
    for (let i = 0; i < 60; i++) stepDrivetrain(v, 1, 2, true, 0, false, 0, DT);
    expect(v.wheelspin).toBe(0);
    expect(v.rpm01).toBeCloseTo(roadRpm01(2, 0), 5);
    for (let i = 0; i < 60; i++) stepDrivetrain(v, 1, 2, true, 1, false, 0, DT);
    expect(v.wheelspin).toBe(1);
  });
});

describe('automatic reads the revs', () => {
  it('shifts up from under a free-revving engine, but never from a standstill nor on road speed alone', () => {
    const standing = createVehicleState(0, 0, 0);
    for (let i = 0; i < 60; i++) stepDrivetrain(standing, 1, 0, true, 1, false, 0, DT);
    expect(standing.gear).toBe(0);
    expect(standing.rpm01).toBeCloseTo(1, 5);

    const rolling = createVehicleState(0, 0, 0);
    const speed = gearTopSpeed(0) * 0.5;
    for (let i = 0; i < 60; i++) stepDrivetrain(rolling, 1, speed, true, 1, false, 0, DT);
    expect(rolling.gear).toBe(1);
    expect(rolling.shiftHold).toBeGreaterThan(0);

    const gripping = createVehicleState(0, 0, 0);
    for (let i = 0; i < 60; i++) stepDrivetrain(gripping, 1, speed, true, 0, false, 0, DT);
    expect(gripping.gear).toBe(0);
  });

  it('holds the taller gear for a moment instead of hunting back down', () => {
    const v = createVehicleState(0, 0, 0);
    const speed = gearTopSpeed(0) * 0.5;
    for (let i = 0; i < 30; i++) stepDrivetrain(v, 1, speed, true, 1, false, 0, DT);
    expect(v.gear).toBe(1);
    for (let i = 0; i < 30; i++) stepDrivetrain(v, 0, speed, true, 0, false, 0, DT);
    expect(v.gear).toBe(1);
    for (let i = 0; i < 60; i++) stepDrivetrain(v, 0, speed, true, 0, false, 0, DT);
    expect(v.gear).toBe(0);
  });
});

describe('gear-change body kick', () => {
  it('is signed by the shift, sized by the ratio step, and silent at a standstill', () => {
    const v = createVehicleState(0, 0, 0);
    v.throttleApplied = 1;

    v.speed = gearTopSpeed(0);
    v.gear = 1;
    const low = shiftKickStrength(v, 0);
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThanOrEqual(1);

    // The same shift the other way is a downshift: same size, opposite sign.
    v.gear = 0;
    expect(shiftKickStrength(v, 1)).toBeCloseTo(-low, 6);

    // The tall gears step far less, so they shove the body far less.
    const tall = createVehicleState(0, 0, 0);
    tall.throttleApplied = 1;
    tall.speed = gearTopSpeed(4);
    tall.gear = 5;
    const high = shiftKickStrength(tall, 4);
    expect(high).toBeGreaterThan(0);
    expect(high).toBeLessThan(low);

    // Stopped, or in the gear it is already in, nothing moves.
    const parked = createVehicleState(0, 0, 0);
    parked.throttleApplied = 1;
    parked.gear = 2;
    expect(shiftKickStrength(parked, 0)).toBe(0);
    expect(shiftKickStrength(v, v.gear)).toBe(0);
  });

  it('still moves the body off the throttle, but less than a shift taken flat out', () => {
    const v = createVehicleState(0, 0, 0);
    v.speed = gearTopSpeed(1);
    v.gear = 2;
    v.throttleApplied = 1;
    const flat = shiftKickStrength(v, 1);
    v.throttleApplied = 0;
    const lifted = shiftKickStrength(v, 1);
    expect(lifted).toBeGreaterThan(0);
    expect(lifted).toBeLessThan(flat);
    expect(lifted).toBeCloseTo(flat * DRIVETRAIN.shiftKickIdle, 6);
  });
});

describe('banging off the limiter', () => {
  /** Hold a gear at its top speed on the manual box for `seconds` and log the fuel cut. */
  const pinned = (seconds: number, gear = 2, throttle = 1) => {
    const v = createVehicleState();
    v.gear = gear;
    const go = createPlayerCommand();
    go.throttle = throttle;
    const dt = 1 / 120;
    const cuts: number[] = [];
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      v.speed = gearTopSpeed(gear);
      stepDrivetrain(v, throttle, v.speed, true, 0, true, 0, dt);
      cuts.push(v.limiterCut);
    }
    return { v, cuts };
  };

  it('square-waves the fuel at the limiter rate, flat out in a manual gear', () => {
    const { cuts } = pinned(1);
    let edges = 0;
    for (let i = 1; i < cuts.length; i++) if (cuts[i] > 0 && cuts[i - 1] === 0) edges++;
    // One second of it: roughly `limiterCutHz` cuts, allowing for where the window falls.
    expect(edges).toBeGreaterThanOrEqual(DRIVETRAIN.limiterCutHz - 1);
    expect(edges).toBeLessThanOrEqual(DRIVETRAIN.limiterCutHz + 1);
    // It really is intermittent: fuel on for most of the cycle, off for the rest.
    const off = cuts.filter((c) => c > 0).length / cuts.length;
    expect(off).toBeCloseTo(DRIVETRAIN.limiterCutDuty, 1);
  });

  it('bounces the needle off redline instead of pinning it there', () => {
    const v = createVehicleState();
    v.gear = 2;
    const dt = 1 / 120;
    const rpms: number[] = [];
    for (let i = 0; i < 120; i++) {
      v.speed = gearTopSpeed(2);
      stepDrivetrain(v, 1, v.speed, true, 0, true, 0, dt);
      rpms.push(v.rpm01);
    }
    // Pinned in gear the needle would sit flat at 1; the cut drops it and lets it back up.
    expect(Math.max(...rpms)).toBeCloseTo(1, 6);
    expect(Math.min(...rpms)).toBeCloseTo(1 - DRIVETRAIN.limiterCutDip, 6);
  });

  it('stays quiet off the throttle and on the automatic', () => {
    expect(pinned(1, 2, 0).cuts.every((c) => c === 0)).toBe(true);
    const v = createVehicleState();
    v.gear = 2;
    const dt = 1 / 120;
    for (let i = 0; i < 120; i++) {
      v.speed = gearTopSpeed(2);
      stepDrivetrain(v, 1, v.speed, true, 0, false, 0, dt);
      expect(v.limiterCut).toBe(0);
    }
  });
});
