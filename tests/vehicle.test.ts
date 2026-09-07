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
  it('reaches 100 km/h from a standstill in 2 to 3.5 seconds of full throttle', () => {
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
    expect(time).toBeGreaterThan(2);
    expect(time).toBeLessThan(3.5);
  });

  it('settles near 205 km/h without nitro and goes faster with it', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    run(v, cmd, 40);
    const topKmh = v.speed * 3.6;
    expect(topKmh).toBeGreaterThan(190);
    expect(topKmh).toBeLessThanOrEqual(215);
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

describe('left-foot brake', () => {
  /** Full throttle for 8 s, then a handbrake flick into a settled right-hand slide. */
  function driftEntry(): { v: VehicleState; cmd: PlayerCommand } {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    run(v, cmd, 8);
    cmd.steer = 1;
    cmd.handbrake = true;
    run(v, cmd, 0.4);
    cmd.handbrake = false;
    run(v, cmd, 0.6);
    return { v, cmd };
  }

  it('never sends a moving car backwards, however hard the brake is stabbed mid-drift', () => {
    const { v, cmd } = driftEntry();
    expect(Math.abs(v.slipAngle) * DEG).toBeGreaterThan(15);
    cmd.brake = 1;
    cmd.throttle = 0;
    for (let i = 0; i < 60 * 0.6; i++) {
      stepVehicle(v, cmd, false, DT);
      expect(v.speed).toBeGreaterThan(0);
    }
    // Released, the car is still going forward at a healthy clip - not reversing.
    cmd.brake = 0;
    run(v, cmd, 0.6);
    expect(v.speed).toBeGreaterThan(10);
  });

  it('only engages reverse once the whole car has stopped, sideways speed included', () => {
    const { v, cmd } = driftEntry();
    cmd.brake = 1;
    cmd.throttle = 0;
    for (let i = 0; i < 60 * 4; i++) {
      stepVehicle(v, cmd, false, DT);
      if (v.speed < 0) {
        // The tick reverse engaged, the car was genuinely at rest in every direction.
        expect(Math.hypot(v.speed, v.lateralSpeed)).toBeLessThan(VEHICLE.reverseSpeedWindow);
        break;
      }
    }
    // And a held brake does eventually back the car out.
    run(v, cmd, 2);
    expect(v.speed).toBeLessThan(-3);
  });

  it('tightens the corner instead of opening it: braking turns the car further, on a shorter arc', () => {
    function corner(brake: number): { turn: number; radius: number } {
      const v = createVehicleState(0, 0, 0);
      const cmd = createPlayerCommand();
      cmd.throttle = 1;
      run(v, cmd, 8);
      cmd.steer = 1;
      cmd.brake = brake;
      const h0 = v.heading;
      const x0 = v.x;
      const z0 = v.z;
      run(v, cmd, 2);
      const turn = v.heading - h0;
      return { turn, radius: Math.hypot(v.x - x0, v.z - z0) / Math.max(turn, 1e-6) };
    }

    const free = corner(0);
    const braked = corner(1);
    expect(free.turn).toBeGreaterThan(0);
    expect(braked.turn).toBeGreaterThan(free.turn * 1.5);
    expect(braked.radius).toBeLessThan(free.radius * 0.7);
  });

  it('does not loosen the car when braking in a straight line', () => {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    run(v, cmd, 8);
    cmd.throttle = 0;
    cmd.brake = 1;
    let maxSlip = 0;
    for (let i = 0; i < 60 * 2; i++) {
      stepVehicle(v, cmd, false, DT);
      maxSlip = Math.max(maxSlip, Math.abs(v.slipAngle));
    }
    expect(maxSlip * DEG).toBeLessThan(1);
  });

  it('keeps a drift alive: the pedal scrubs speed without snapping the car straight', () => {
    const { v, cmd } = driftEntry();
    const slipBefore = Math.abs(v.slipAngle);
    const speedBefore = v.speed;
    cmd.brake = 1;
    run(v, cmd, 0.5);
    expect(v.speed).toBeLessThan(speedBefore - 3);
    expect(Math.abs(v.slipAngle)).toBeGreaterThan(slipBefore);
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

describe('breaking traction', () => {
  /** Flat out in a straight line, then the input that breaks the rear away. */
  function atSpeed(): { v: VehicleState; cmd: PlayerCommand } {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    run(v, cmd, 8);
    return { v, cmd };
  }

  /** `slide` sampled once per tick, from the tick the input lands. */
  function slideRamp(cmd: PlayerCommand, v: VehicleState, ticks: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < ticks; i++) {
      stepVehicle(v, cmd, false, DT);
      out.push(v.slide);
    }
    return out;
  }

  it('lets the rear go along a ramp, not in a single tick', () => {
    const { v, cmd } = atSpeed();
    cmd.steer = 1;
    const ramp = slideRamp(cmd, v, 36);
    // The tyres still hold on the tick the wheel is turned.
    expect(ramp[0]).toBeLessThan(0.1);
    // Half gone takes real time, not a frame.
    expect(ramp.findIndex((s) => s > 0.5)).toBeGreaterThan(6);
    // And it does commit: this is a ramp, not a refusal to slide.
    expect(ramp[ramp.length - 1]).toBeGreaterThan(0.85);
    expect(ramp.every((s, i) => i === 0 || s >= ramp[i - 1])).toBe(true);
  });

  it('accelerates into the slide instead of easing off: the loss speeds up as it develops', () => {
    const { v, cmd } = atSpeed();
    cmd.steer = 1;
    const ramp = slideRamp(cmd, v, 20);
    const step = ramp.map((s, i) => s - (i === 0 ? 0 : ramp[i - 1]));
    // A plain first-order lag moves fastest on its very first tick and slows from there.
    // The rear does the opposite early on: the break-out gathers pace before it settles.
    const peak = step.indexOf(Math.max(...step));
    expect(peak).toBeGreaterThan(2);
    expect(step[peak]).toBeGreaterThan(step[0] * 1.3);
  });

  it('still snaps on the handbrake: a yank is not subject to the slow ramp', () => {
    const { v, cmd } = atSpeed();
    cmd.steer = 1;
    cmd.handbrake = true;
    const ramp = slideRamp(cmd, v, 12);
    expect(ramp[0]).toBeGreaterThan(0.25);
    // Fully loose inside ~0.15 s.
    expect(ramp[8]).toBeGreaterThan(0.9);
  });

  it('takes hold again faster than it let go', () => {
    const { v, cmd } = atSpeed();
    cmd.steer = 1;
    const out = slideRamp(cmd, v, 60);
    const toLoose = out.findIndex((s) => s > 0.6);
    // Release everything: the slide target collapses and the tyres bite.
    cmd.steer = 0;
    cmd.throttle = 0;
    const back = slideRamp(cmd, v, 60);
    const toGrip = back.findIndex((s) => s < 0.4);
    expect(toGrip).toBeGreaterThanOrEqual(0);
    expect(toGrip).toBeLessThan(toLoose);
  });
});

/**
 * The handbrake is an angle budget, not an event: how long the button is held decides how far
 * the nose comes round. These lock the three things that makes playable — a flick stays a
 * flick, a held pull buys real angle (enough for a reverse entry), and neither the budget nor
 * the player's hands lose control of it.
 */
describe('handbrake angle', () => {
  /**
   * Accelerate to `target` m/s, then pull the handbrake with full lock for `hold` seconds.
   * Returns the rotation the pull produced, tick by tick and unwrapped, so a swing past half a
   * turn keeps counting up. Only the pull is measured (plus a tick of settle): held on full
   * lock the car goes on cornering afterwards, and that turn is not the handbrake's doing.
   */
  function pull(hold: number, target: number, counterAt = -1): { turn: number[]; minSlide: number } {
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    for (let i = 0; i < 60 * 30 && v.speed < target; i++) stepVehicle(v, cmd, false, DT);

    cmd.throttle = 0;
    cmd.steer = 1;
    cmd.handbrake = true;
    let heading = v.heading;
    let turned = 0;
    let minSlide = 1;
    const turn: number[] = [];
    for (let i = 0; i < Math.round((hold + 0.1) / DT); i++) {
      const t = i * DT;
      if (t >= hold) cmd.handbrake = false;
      if (counterAt >= 0 && t >= counterAt) cmd.steer = -1;
      stepVehicle(v, cmd, false, DT);
      let step = v.heading - heading;
      while (step > Math.PI) step -= 2 * Math.PI;
      while (step < -Math.PI) step += 2 * Math.PI;
      turned += step;
      heading = v.heading;
      turn.push(Math.abs(turned) * DEG);
      if (cmd.handbrake && Math.abs(v.slipAngle) * DEG > 45) minSlide = Math.min(minSlide, v.slide);
    }
    return { turn, minSlide };
  }

  const peak = (r: { turn: number[] }): number => Math.max(...r.turn);

  it('turns a held pull into angle a flick never reaches', () => {
    const flick = peak(pull(0.12, 31));
    const held = peak(pull(1, 31));
    // A tap still just kicks the tail out.
    expect(flick).toBeLessThan(30);
    // A second on the button swings the nose most of the way round: the reverse entry.
    expect(held).toBeGreaterThan(120);
    expect(held).toBeGreaterThan(flick * 4);
  });

  it('gives more angle the longer the button is held', () => {
    const short = peak(pull(0.35, 31));
    const medium = peak(pull(0.7, 31));
    const long = peak(pull(1.1, 31));
    expect(medium).toBeGreaterThan(short + 20);
    expect(long).toBeGreaterThan(medium + 20);
  });

  it('spends a budget: the kick is done long before the button is', () => {
    const { turn } = pull(3, 31);
    const at = (t: number): number => turn[Math.round(t / DT) - 1];
    // Most of the swing is bought in the first second; leaning on the button after that adds
    // little more than the cornering the wheel is asking for anyway.
    expect(at(2.9) - at(2)).toBeLessThan(at(1) * 0.5);
  });

  it('keeps the axle loose while the nose comes past the velocity vector', () => {
    // The old forward-speed gate let the tyres bite again halfway through the rotation.
    expect(pull(1, 31).minSlide).toBeGreaterThan(0.9);
  });

  it('never manufactures speed out of the rotation itself', () => {
    // Turning the body moves velocity between the forward and lateral axes; it cannot add any.
    // Re-projecting only the lateral half used to pump the other one, which at ninety degrees
    // of slip flung the car sideways faster than its own top speed - as if it were swinging
    // around an anchor way outside the car - with the throttle shut and the handbrake on.
    for (const target of [17, 31, 50]) {
      const v = createVehicleState(0, 0, 0);
      const cmd = createPlayerCommand();
      cmd.throttle = 1;
      for (let i = 0; i < 60 * 30 && v.speed < target; i++) stepVehicle(v, cmd, false, DT);

      const entry = Math.hypot(v.vx, v.vz);
      cmd.throttle = 0;
      cmd.steer = 1;
      cmd.handbrake = true;
      for (let i = 0; i < 60 * 2; i++) {
        stepVehicle(v, cmd, false, DT);
        expect(Math.hypot(v.vx, v.vz)).toBeLessThanOrEqual(entry);
      }
    }
  });

  it('pivots about the car, not about some point out in the road', () => {
    // A held pull is a rotation plus a scrub, so the car cannot cover more ground during it
    // than it would have coasting - the old fling made it cover a third more.
    const v = createVehicleState(0, 0, 0);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    for (let i = 0; i < 60 * 30 && v.speed < 31; i++) stepVehicle(v, cmd, false, DT);
    const entry = v.speed;
    const x0 = v.x;
    const z0 = v.z;

    cmd.throttle = 0;
    cmd.steer = 1;
    cmd.handbrake = true;
    run(v, cmd, 1);
    expect(Math.hypot(v.x - x0, v.z - z0)).toBeLessThan(entry * 1);
  });

  it('stops rotating on opposite lock, button still down', () => {
    const free = peak(pull(1.2, 31));
    const caught = peak(pull(1.2, 31, 0.5));
    expect(caught).toBeLessThan(free * 0.7);
  });
});
