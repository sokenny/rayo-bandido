import { describe, expect, it } from 'vitest';
import { createVehicleState } from '../src/sim/gameState';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { stepVehicle } from '../src/sim/vehicle';
import {
  GEAR_COUNT,
  REF_SPEED,
  autoGear,
  bandEntrySpeed,
  gearTopSpeed,
  roadRpm01,
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
