import { afterEach, describe, expect, it } from 'vitest';
import { applyDeadzone, createGamepadInput } from '../src/core/input/gamepad';
import { combineInputs } from '../src/core/input/combine';
import { createPlayerCommand, type InputSource } from '../src/core/input/keyboard';
import type { PlayerCommand } from '../src/core/types';

/**
 * The pad has to behave exactly like the keyboard from the simulation's point of view: analog
 * where the car wants analog, and one tick per press for the actions that fire something.
 */

interface FakePad {
  axes: number[];
  buttons: Array<{ pressed: boolean; value: number }>;
}

function pad(overrides: Partial<{ axes: number[]; down: number[]; values: Record<number, number> }> = {}): FakePad {
  const down = new Set(overrides.down ?? []);
  const values = overrides.values ?? {};
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: down.has(i),
    value: values[i] ?? (down.has(i) ? 1 : 0),
  }));
  return { axes: overrides.axes ?? [0, 0, 0, 0], buttons };
}

/** Install a fake Gamepad API. `set(null)` unplugs the pad. */
function mockPads(): (p: FakePad | null) => void {
  let current: FakePad | null = null;
  (globalThis as { navigator?: unknown }).navigator = {
    getGamepads: () => [current ? { ...current, connected: true } : null],
  };
  return (p) => {
    current = p;
  };
}

afterEach(() => {
  delete (globalThis as { navigator?: unknown }).navigator;
});

describe('applyDeadzone', () => {
  it('zeroes centre drift and rescales the rest to full travel', () => {
    expect(applyDeadzone(0.1, 0.2)).toBe(0);
    expect(applyDeadzone(-0.1, 0.2)).toBe(0);
    expect(applyDeadzone(1, 0.2)).toBeCloseTo(1);
    expect(applyDeadzone(-1, 0.2)).toBeCloseTo(-1);
    expect(applyDeadzone(0.6, 0.2)).toBeCloseTo(0.5);
  });
});

describe('gamepad input', () => {
  it('reads a neutral command when nothing is plugged in', () => {
    mockPads();
    const input = createGamepadInput();
    const cmd = createPlayerCommand();
    input.poll(cmd);
    expect(cmd).toEqual(createPlayerCommand());
  });

  it('steers analog from the left stick and ignores centre drift', () => {
    const set = mockPads();
    const input = createGamepadInput();
    const cmd = createPlayerCommand();

    set(pad({ axes: [0.05, 0] }));
    input.poll(cmd);
    expect(cmd.steer).toBe(0);

    set(pad({ axes: [-1, 0] }));
    input.poll(cmd);
    expect(cmd.steer).toBeCloseTo(-1);

    set(pad({ axes: [0.59, 0] }));
    input.poll(cmd);
    expect(cmd.steer).toBeGreaterThan(0);
    expect(cmd.steer).toBeLessThan(1);
  });

  it('takes analog throttle and brake from the triggers', () => {
    const set = mockPads();
    const input = createGamepadInput();
    const cmd = createPlayerCommand();
    set(pad({ down: [6, 7], values: { 6: 0.4, 7: 0.75 } }));
    input.poll(cmd);
    expect(cmd.throttle).toBeCloseTo(0.734, 2);
    expect(cmd.brake).toBeCloseTo(0.362, 2);
  });

  it('falls back to the stick when the triggers report nothing analog', () => {
    const set = mockPads();
    const input = createGamepadInput();
    const cmd = createPlayerCommand();
    set(pad({ axes: [0, -1] }));
    input.poll(cmd);
    expect(cmd.throttle).toBeCloseTo(1);
    expect(cmd.brake).toBe(0);
    set(pad({ axes: [0, 1] }));
    input.poll(cmd);
    expect(cmd.brake).toBeCloseTo(1);
    expect(cmd.throttle).toBe(0);
  });

  it('leaves the throttle alone when A and B are pressed: they are the handbrake and the bottle', () => {
    const set = mockPads();
    const input = createGamepadInput();
    const cmd = createPlayerCommand();
    set(pad({ down: [0, 1] }));
    input.poll(cmd);
    expect(cmd.throttle).toBe(0);
    expect(cmd.brake).toBe(0);
  });

  it('fires once per press, not once per tick, while the button is held', () => {
    const set = mockPads();
    const input = createGamepadInput();
    const cmd = createPlayerCommand();

    set(pad({ down: [2] }));
    input.poll(cmd);
    expect(cmd.fire).toBe(true);
    input.poll(cmd);
    expect(cmd.fire).toBe(false);

    set(pad());
    input.poll(cmd);
    set(pad({ down: [2] }));
    input.poll(cmd);
    expect(cmd.fire).toBe(true);
  });

  it('shifts once per bumper press: RB up, LB down', () => {
    const set = mockPads();
    const input = createGamepadInput();
    const cmd = createPlayerCommand();
    set(pad({ down: [5] }));
    input.poll(cmd);
    expect(cmd.shiftUp).toBe(true);
    expect(cmd.shiftDown).toBe(false);
    input.poll(cmd);
    expect(cmd.shiftUp).toBe(false);
    set(pad({ down: [4] }));
    input.poll(cmd);
    expect(cmd.shiftDown).toBe(true);
    expect(cmd.transmission).toBe(false);
  });

  it('cycles the camera once per Y press, the way NFSU2 changes view', () => {
    const set = mockPads();
    const input = createGamepadInput();
    const cmd = createPlayerCommand();
    set(pad({ down: [3] }));
    input.poll(cmd);
    expect(cmd.pov).toBe(true);
    input.poll(cmd);
    expect(cmd.pov).toBe(false);
  });

  it('toggles cruise once per View press', () => {
    const set = mockPads();
    const input = createGamepadInput();
    const cmd = createPlayerCommand();
    set(pad({ down: [8] }));
    input.poll(cmd);
    expect(cmd.cruise).toBe(true);
    input.poll(cmd);
    expect(cmd.cruise).toBe(false);
  });

  it('holds the handbrake on A and the nitro on B, the NFSU2 default', () => {
    const set = mockPads();
    const input = createGamepadInput();
    const cmd = createPlayerCommand();
    set(pad({ down: [0, 1] }));
    input.poll(cmd);
    expect(cmd.handbrake).toBe(true);
    expect(cmd.nitro).toBe(true);
    set(pad({ down: [4, 5] }));
    input.poll(cmd);
    expect(cmd.handbrake).toBe(false);
    expect(cmd.nitro).toBe(false);
  });

  it('releases everything when the pad is unplugged mid-press', () => {
    const set = mockPads();
    const input = createGamepadInput();
    const cmd = createPlayerCommand();
    set(pad({ down: [0, 1], values: { 7: 1 } }));
    input.poll(cmd);
    expect(cmd.throttle).toBe(1);
    expect(cmd.handbrake).toBe(true);
    expect(cmd.nitro).toBe(true);
    set(null);
    input.poll(cmd);
    expect(cmd).toEqual(createPlayerCommand());
  });
});

describe('combineInputs', () => {
  function source(cmd: Partial<PlayerCommand>): InputSource {
    return {
      poll(out) {
        Object.assign(out, createPlayerCommand(), cmd);
      },
      dispose() {},
    };
  }

  it('lets whichever device is pushing hardest win the axes and ORs the flags', () => {
    const combined = combineInputs(
      source({ throttle: 0.2, steer: -0.3, fire: true }),
      source({ throttle: 0.9, steer: 0.8, nitro: true }),
    );
    const cmd = createPlayerCommand();
    combined.poll(cmd);
    expect(cmd.throttle).toBeCloseTo(0.9);
    expect(cmd.steer).toBeCloseTo(0.8);
    expect(cmd.fire).toBe(true);
    expect(cmd.nitro).toBe(true);
  });

  it('keeps an idle second device from cancelling the first', () => {
    const combined = combineInputs(source({ throttle: 1, steer: -1, handbrake: true }), source({}));
    const cmd = createPlayerCommand();
    combined.poll(cmd);
    expect(cmd.throttle).toBe(1);
    expect(cmd.steer).toBe(-1);
    expect(cmd.handbrake).toBe(true);
  });

  it('disposes every source', () => {
    let disposed = 0;
    const s = (): InputSource => ({ poll() {}, dispose() { disposed++; } });
    combineInputs(s(), s(), s()).dispose();
    expect(disposed).toBe(3);
  });
});
