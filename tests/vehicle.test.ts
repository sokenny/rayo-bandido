import { describe, expect, it } from 'vitest';
import { createVehicleState } from '../src/sim/gameState';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { stepVehicle } from '../src/sim/vehicle';
import { NITRO, VEHICLE } from '../src/config/tuning';
import type { PlayerCommand, VehicleState } from '../src/core/types';

/**
 * Vehicle feel regression tests. Deterministic, headless, fixed 60 Hz steps.
 * These lock the numbers the design brief asks for: 0-100 in 3-5 s, ~180 km/h top speed,
 * strong brakes that become reverse, speed-sensitive steering and no drift on a straight.
 */

const DT = 1 / 60;
const DEG = 180 / Math.PI;

function run(v: VehicleState, cmd: PlayerCommand, seconds: number, nitro = false): void {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) stepVehicle(v, cmd, nitro, DT);
}

describe('vehicle acceleration', () => {
  it('reaches 100 km/h from a standstill in 3 to 5 seconds of full throttle', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    let time = -1;
    for (let i = 0; i < 60 * 15; i++) {
      stepVehicle(v, cmd, false, DT);
      if (v.speed * 3.6 >= 100) {
        time = (i + 1) * DT;
        break;
      }
    }
    expect(time).toBeGreaterThan(3);
    expect(time).toBeLessThan(5);
  });

  it('settles near 180 km/h without nitro and goes faster with it', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    run(v, cmd, 40);
    const topKmh = v.speed * 3.6;
    expect(topKmh).toBeGreaterThan(165);
    expect(topKmh).toBeLessThanOrEqual(190);
    expect(v.speed).toBeLessThanOrEqual(VEHICLE.maxSpeed + 1e-6);

    const boosted = createVehicleState(0, 0, 0);
    run(boosted, cmd, 40, true);
    expect(boosted.speed).toBeGreaterThan(v.speed + 5);
    expect(boosted.speed).toBeLessThanOrEqual(VEHICLE.maxSpeed + NITRO.boostMaxSpeedBonus + 1e-6);
  });

  it('brakes hard from speed', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    run(v, cmd, 8);
    const entry = v.speed;
    expect(entry).toBeGreaterThan(35);
    cmd.throttle = 0;
    cmd.brake = 1;
    let stopTime = -1;
    for (let i = 0; i < 60 * 5; i++) {
      stepVehicle(v, cmd, false, DT);
      if (v.speed <= 0) {
        stopTime = (i + 1) * DT;
        break;
      }
    }
    expect(stopTime).toBeGreaterThan(0);
    expect(stopTime).toBeLessThan(2.5);
  });
});

describe('reverse', () => {
  it('holding the brake from a standstill reverses at least 3 m/s within 2 s', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.brake = 1;
    run(v, cmd, 2);
    expect(v.speed).toBeLessThanOrEqual(-3);
    // Reverse is capped around 35 km/h.
    run(v, cmd, 5);
    expect(v.speed).toBeGreaterThanOrEqual(-VEHICLE.maxReverseSpeed - 1e-6);
    expect(v.speed * 3.6).toBeLessThan(-25);
  });

  it('steers like a real car in reverse: steering right swings the nose left', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.brake = 1;
    run(v, cmd, 1.5);
    expect(v.speed).toBeLessThan(-5);
    const heading0 = v.heading;
    cmd.steer = 1;
    run(v, cmd, 1);
    expect(v.heading).toBeLessThan(heading0);
    expect(Number.isFinite(v.heading)).toBe(true);
  });
});

describe('steering', () => {
  it('reaches most of the requested angle within two frames', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.steer = 1;
    stepVehicle(v, cmd, false, DT);
    stepVehicle(v, cmd, false, DT);
    expect(v.steerAngle).toBeGreaterThan(0.2 * VEHICLE.maxSteerAngle);
    run(v, cmd, 0.3);
    expect(v.steerAngle).toBeGreaterThan(0.9 * VEHICLE.maxSteerAngle);
  });

  it('tightens the steering angle with speed', () => {
    const slow = createVehicleState(0, 0, 0);
    const cmdSteer = createPlayerCommand();
    cmdSteer.steer = 1;
    run(slow, cmdSteer, 0.5);
    const slowAngle = slow.steerAngle;

    const fast = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    run(fast, cmd, 12);
    cmd.steer = 1;
    stepVehicle(fast, cmd, false, DT);
    const fastLimit = fast.steerAngle;
    run(fast, cmd, 0.5);
    expect(fast.steerAngle).toBeLessThan(slowAngle * 0.6);
    expect(fastLimit).toBeGreaterThan(0);
  });
});

describe('grip', () => {
  it('gentle cornering without throttle stays well below the drift slip threshold', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    run(v, cmd, 4);
    cmd.throttle = 0;
    cmd.steer = 1;
    let maxSlip = 0;
    for (let i = 0; i < 60 * 4; i++) {
      stepVehicle(v, cmd, false, DT);
      maxSlip = Math.max(maxSlip, Math.abs(v.slipAngle));
    }
    expect(maxSlip * DEG).toBeLessThan(10);
  });

  it('re-derives speed and lateral speed from world velocity, so collision impulses stick', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    run(v, cmd, 5);
    expect(v.speed).toBeGreaterThan(20);
    // Simulate a collision impulse: the resolver only writes world velocity.
    v.vx = 0;
    v.vz = 0;
    const idle = createPlayerCommand();
    stepVehicle(v, idle, false, DT);
    expect(Math.abs(v.speed)).toBeLessThan(0.5);
  });

  it('stays perfectly still with no input', () => {
    const v = createVehicleState(3, -7, 1);
    const cmd = createPlayerCommand();
    cmd.steer = 1;
    run(v, cmd, 5);
    expect(v.x).toBeCloseTo(3, 6);
    expect(v.z).toBeCloseTo(-7, 6);
    expect(v.heading).toBeCloseTo(1, 6);
    expect(v.speed).toBeCloseTo(0, 6);
  });
});

describe('body load signals', () => {
  it('reports lateral acceleration toward the inside of the turn and matches v * yawRate', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    run(v, cmd, 4);
    cmd.steer = 0.5;
    run(v, cmd, 1.5);

    // Steering right: the tyres push the body toward its right (+), and in a settled turn
    // that force is the centripetal one.
    expect(v.yawRate).toBeGreaterThan(0);
    expect(v.latAccel).toBeGreaterThan(2);
    expect(v.latAccel).toBeCloseTo(v.speed * v.yawRate, 0);
    expect(Math.abs(v.latAccel)).toBeLessThanOrEqual(VEHICLE.maxLatAccel + 0.5);

    cmd.steer = -0.5;
    run(v, cmd, 1.5);
    expect(v.latAccel).toBeLessThan(-2);
  });

  it('reports braking as negative longitudinal acceleration and throttle as positive', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    run(v, cmd, 3);
    expect(v.longAccel).toBeGreaterThan(1);

    cmd.throttle = 0;
    cmd.brake = 1;
    run(v, cmd, 0.5);
    expect(v.longAccel).toBeLessThan(-VEHICLE.brakeDecel * 0.5);
  });

  it('leaves both signals at zero when the car is parked', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    run(v, cmd, 1);
    expect(v.latAccel).toBe(0);
    expect(v.longAccel).toBe(0);
  });
});
