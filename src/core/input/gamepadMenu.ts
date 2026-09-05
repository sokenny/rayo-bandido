import { STICK_DEADZONE, applyDeadzone, buttonDown, readActiveGamepad } from './gamepad';

/**
 * Gamepad navigation for DOM menus: the pad has to get you into the game, not just drive the
 * car. Runs its own animation-frame poll (menus have no simulation loop) and reports discrete
 * steps - a held stick moves the cursor once, not every frame.
 */
export interface GamepadMenuHandlers {
  /** -1 = previous entry (up/left), +1 = next entry (down/right). */
  onMove(delta: number): void;
  /** A or Start. */
  onConfirm(): void;
  /** B. Optional: menus without a back action leave it out. */
  onBack?(): void;
}

export interface GamepadMenuNav {
  dispose(): void;
}

const BTN_A = 0;
const BTN_B = 1;
const BTN_START = 9;
const BTN_DPAD_UP = 12;
const BTN_DPAD_DOWN = 13;
const BTN_DPAD_LEFT = 14;
const BTN_DPAD_RIGHT = 15;
/** Stick travel that counts as a direction, above the driving deadzone so it takes intent. */
const MOVE_THRESHOLD = 0.6;

export function createGamepadMenuNav(handlers: GamepadMenuHandlers): GamepadMenuNav {
  let frame = 0;
  let disposed = false;
  // Direction currently held (0 when centred), so a held stick does not scroll the menu away.
  let heldDirection = 0;
  let confirmDown = false;
  let backDown = false;

  const tick = (): void => {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    const pad = readActiveGamepad();
    if (!pad) {
      heldDirection = 0;
      confirmDown = false;
      backDown = false;
      return;
    }

    const x = applyDeadzone(pad.axes[0] ?? 0, STICK_DEADZONE);
    const y = applyDeadzone(pad.axes[1] ?? 0, STICK_DEADZONE);
    const axis = Math.abs(y) > Math.abs(x) ? y : x;
    let direction = 0;
    if (buttonDown(pad, BTN_DPAD_UP) || buttonDown(pad, BTN_DPAD_LEFT)) direction = -1;
    else if (buttonDown(pad, BTN_DPAD_DOWN) || buttonDown(pad, BTN_DPAD_RIGHT)) direction = 1;
    else if (axis <= -MOVE_THRESHOLD) direction = -1;
    else if (axis >= MOVE_THRESHOLD) direction = 1;
    if (direction !== 0 && direction !== heldDirection) handlers.onMove(direction);
    heldDirection = direction;

    const confirm = buttonDown(pad, BTN_A) || buttonDown(pad, BTN_START);
    if (confirm && !confirmDown) handlers.onConfirm();
    confirmDown = confirm;

    const back = buttonDown(pad, BTN_B);
    if (back && !backDown) handlers.onBack?.();
    backDown = back;
  };

  frame = requestAnimationFrame(tick);

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
    },
  };
}
