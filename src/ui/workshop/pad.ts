import { STICK_DEADZONE, applyDeadzone, buttonDown, readActiveGamepad } from '../../core/input/gamepad';
import type { WorkshopKeyAction } from './model';

/**
 * The pad in the workshop. `gamepadMenu.ts`'s pattern — its own animation-frame poll, discrete
 * steps on edges — with what a two-axis NFSU2 menu needs and a flat menu does not: left/right
 * kept apart from up/down, the shoulders for the category carousel, a held direction that
 * repeats after a beat (thirty colours are a long walk one press at a time), and the right
 * stick as a continuous camera orbit.
 *
 *   d-pad / left stick   move            A / Start   confirm (open, install)
 *   LB / RB              category        B           back
 *   LT / RT              layer colour    X / Y       remove / add a layer
 *   right stick          orbit camera    View        leave the workshop
 */
export interface WorkshopPadHandlers {
  onAction(action: WorkshopKeyAction): void;
  /** Right stick, per frame while deflected: already dead-zoned, scaled to radians-ish per frame. */
  onOrbit(dYaw: number, dPitch: number): void;
}

export interface WorkshopPad {
  dispose(): void;
}

const BTN_A = 0;
const BTN_B = 1;
const BTN_X = 2;
const BTN_Y = 3;
const BTN_LB = 4;
const BTN_RB = 5;
const BTN_LT = 6;
const BTN_RT = 7;
const BTN_VIEW = 8;
const BTN_START = 9;
const BTN_UP = 12;
const BTN_DOWN = 13;
const BTN_LEFT = 14;
const BTN_RIGHT = 15;

const MOVE_THRESHOLD = 0.6;
/** A held direction repeats after this long, then every `REPEAT_EVERY`. Milliseconds. */
const REPEAT_AFTER = 380;
const REPEAT_EVERY = 110;
/** Right stick at full throw turns the camera this much per frame. */
const ORBIT_RATE = 0.045;

const BUTTONS: ReadonlyArray<[number, WorkshopKeyAction]> = [
  [BTN_A, 'confirm'],
  [BTN_START, 'confirm'],
  [BTN_B, 'back'],
  [BTN_X, 'layerRemove'],
  [BTN_Y, 'layerAdd'],
  [BTN_LB, 'prevCategory'],
  [BTN_RB, 'nextCategory'],
  [BTN_LT, 'colorPrev'],
  [BTN_RT, 'colorNext'],
  [BTN_VIEW, 'exit'],
];

export function createWorkshopPad(handlers: WorkshopPadHandlers): WorkshopPad {
  let frame = 0;
  let disposed = false;
  const held = new Uint8Array(16);
  let heldDir: WorkshopKeyAction | null = null;
  let heldSince = 0;
  let lastRepeat = 0;

  const tick = (now: number): void => {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    const pad = readActiveGamepad();
    if (!pad) {
      held.fill(0);
      heldDir = null;
      return;
    }

    for (const [index, action] of BUTTONS) {
      const down = buttonDown(pad, index);
      if (down && !held[index]) handlers.onAction(action);
      held[index] = down ? 1 : 0;
    }

    const x = applyDeadzone(pad.axes[0] ?? 0, STICK_DEADZONE);
    const y = applyDeadzone(pad.axes[1] ?? 0, STICK_DEADZONE);
    let dir: WorkshopKeyAction | null = null;
    if (buttonDown(pad, BTN_UP)) dir = 'up';
    else if (buttonDown(pad, BTN_DOWN)) dir = 'down';
    else if (buttonDown(pad, BTN_LEFT)) dir = 'left';
    else if (buttonDown(pad, BTN_RIGHT)) dir = 'right';
    else if (Math.max(Math.abs(x), Math.abs(y)) >= MOVE_THRESHOLD) {
      dir = Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : y < 0 ? 'up' : 'down';
    }
    if (dir !== heldDir) {
      heldDir = dir;
      heldSince = now;
      lastRepeat = now;
      if (dir) handlers.onAction(dir);
    } else if (dir && now - heldSince >= REPEAT_AFTER && now - lastRepeat >= REPEAT_EVERY) {
      lastRepeat = now;
      handlers.onAction(dir);
    }

    const rx = applyDeadzone(pad.axes[2] ?? 0, STICK_DEADZONE);
    const ry = applyDeadzone(pad.axes[3] ?? 0, STICK_DEADZONE);
    if (rx !== 0 || ry !== 0) handlers.onOrbit(rx * ORBIT_RATE, -ry * ORBIT_RATE);
  };

  frame = requestAnimationFrame(tick);

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
    },
  };
}
