import type { PlayerCommand } from '../types';
import type { InputSource } from './keyboard';

/**
 * Gamepad input -> PlayerCommand, for an Xbox-style USB pad (the browser's "standard" mapping).
 * Same contract as the keyboard: edge-triggered actions report true for exactly one poll per
 * press, detected against the previous poll's button state.
 *
 * Bindings (docs/DECISIONS.md): RT/A throttle, LT/B brake, left stick or d-pad steers,
 * LB handbrake, RB nitro, X lightning, Y cruise, Start restart, View cycles the camera.
 *
 * The pad is read fresh on every poll because `navigator.getGamepads()` returns snapshots, not
 * live objects. Browsers hide a pad until the player presses something on it, so a controller
 * plugged in mid-session simply starts working the first time it is used - nothing to connect.
 */

/** Button indices of the standard mapping. */
const BTN_A = 0;
const BTN_B = 1;
const BTN_X = 2;
const BTN_Y = 3;
const BTN_LB = 4;
const BTN_RB = 5;
const BTN_LT = 6;
const BTN_RT = 7;
const BTN_BACK = 8;
const BTN_START = 9;
const BTN_DPAD_LEFT = 14;
const BTN_DPAD_RIGHT = 15;

/** Stick travel ignored around centre, so a worn stick does not steer or creep on its own. */
export const STICK_DEADZONE = 0.18;
/** Analog trigger travel ignored, for triggers that rest slightly off zero. */
const TRIGGER_DEADZONE = 0.06;

/** Remove the deadzone and rescale the rest to a full 0..1 (or -1..1) range. */
export function applyDeadzone(value: number, deadzone: number): number {
  const mag = Math.abs(value);
  if (mag <= deadzone) return 0;
  const scaled = (mag - deadzone) / (1 - deadzone);
  return value < 0 ? -scaled : scaled;
}

/**
 * The pad we drive with: the first connected one. Returns null when the Gamepad API is missing
 * (jsdom, old browsers) or nothing is plugged in.
 */
export function readActiveGamepad(): Gamepad | null {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  if (!nav || typeof nav.getGamepads !== 'function') return null;
  const pads = nav.getGamepads();
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    if (pad && pad.connected) return pad;
  }
  return null;
}

/** Pressed state of a button index, tolerant of pads that report fewer buttons. */
export function buttonDown(pad: Gamepad, index: number): boolean {
  const b = pad.buttons[index];
  return !!b && (b.pressed || b.value > 0.5);
}

/** Analog value of a button index (triggers); falls back to its pressed state. */
function buttonValue(pad: Gamepad, index: number): number {
  const b = pad.buttons[index];
  if (!b) return 0;
  const v = applyDeadzone(b.value, TRIGGER_DEADZONE);
  if (v > 0) return v;
  return b.pressed ? 1 : 0;
}

export function createGamepadInput(): InputSource {
  // Previous frame's pressed state for the edge-triggered buttons, so a held button fires once.
  const wasDown = new Map<number, boolean>();

  /** True on the tick the button goes down. Must be called exactly once per poll per button. */
  function pressed(pad: Gamepad, index: number): boolean {
    const now = buttonDown(pad, index);
    const edge = now && !wasDown.get(index);
    wasDown.set(index, now);
    return edge;
  }

  return {
    poll(out: PlayerCommand) {
      const pad = readActiveGamepad();
      if (!pad) {
        wasDown.clear();
        out.throttle = 0;
        out.brake = 0;
        out.steer = 0;
        out.handbrake = false;
        out.nitro = false;
        out.fire = false;
        out.restart = false;
        out.cruise = false;
        out.pov = false;
        return;
      }

      // Throttle and brake: triggers first, face buttons and the stick as fallbacks for pads
      // whose triggers report nothing useful.
      const stickY = applyDeadzone(pad.axes[1] ?? 0, STICK_DEADZONE);
      out.throttle = Math.max(buttonValue(pad, BTN_RT), buttonDown(pad, BTN_A) ? 1 : 0, Math.max(0, -stickY));
      out.brake = Math.max(buttonValue(pad, BTN_LT), buttonDown(pad, BTN_B) ? 1 : 0, Math.max(0, stickY));

      const stickX = applyDeadzone(pad.axes[0] ?? 0, STICK_DEADZONE);
      const dpad = (buttonDown(pad, BTN_DPAD_RIGHT) ? 1 : 0) - (buttonDown(pad, BTN_DPAD_LEFT) ? 1 : 0);
      out.steer = dpad !== 0 ? dpad : stickX;

      out.handbrake = buttonDown(pad, BTN_LB);
      out.nitro = buttonDown(pad, BTN_RB);

      // Edge-detected here rather than latched: `pressed` compares against the previous poll,
      // so a held button reports true exactly once however many ticks run in a frame.
      out.fire = pressed(pad, BTN_X);
      out.restart = pressed(pad, BTN_START);
      out.cruise = pressed(pad, BTN_Y);
      out.pov = pressed(pad, BTN_BACK);
    },
    dispose() {
      wasDown.clear();
    },
  };
}
