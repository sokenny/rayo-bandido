import type { PlayerCommand } from '../types';

/**
 * Keyboard input -> PlayerCommand. Edge-triggered actions (fire, restart, cruise, pov) are latched
 * between polls so a short tap is never lost, and cleared after `poll()` reads them once.
 *
 * Bindings (docs/DECISIONS.md): WASD / arrows drive, Space handbrake, Shift nitro,
 * E or mouse click fires lightning, R restarts, C toggles cruise mode, P cycles camera view.
 */
export interface InputSource {
  /** Fill `out` with the current command. Edge-triggered flags are consumed. */
  poll(out: PlayerCommand): void;
  dispose(): void;
}

export function createPlayerCommand(): PlayerCommand {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, fire: false, restart: false, cruise: false, pov: false };
}

export function createKeyboardInput(target: Window | HTMLElement = window): InputSource {
  const down = new Set<string>();
  let fireLatched = false;
  let restartLatched = false;
  let cruiseLatched = false;
  let povLatched = false;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) {
      if (isGameKey(e.code)) e.preventDefault();
      return;
    }
    down.add(e.code);
    if (e.code === 'KeyE') fireLatched = true;
    if (e.code === 'KeyR') restartLatched = true;
    if (e.code === 'KeyC') cruiseLatched = true;
    if (e.code === 'KeyP') povLatched = true;
    if (isGameKey(e.code)) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    down.delete(e.code);
  };
  const onBlur = (): void => {
    down.clear();
  };
  const onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) fireLatched = true;
  };

  target.addEventListener('keydown', onKeyDown as EventListener);
  target.addEventListener('keyup', onKeyUp as EventListener);
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousedown', onMouseDown);

  return {
    poll(out) {
      const forward = down.has('KeyW') || down.has('ArrowUp');
      const back = down.has('KeyS') || down.has('ArrowDown');
      const left = down.has('KeyA') || down.has('ArrowLeft');
      const right = down.has('KeyD') || down.has('ArrowRight');
      out.throttle = forward ? 1 : 0;
      out.brake = back ? 1 : 0;
      out.steer = (right ? 1 : 0) - (left ? 1 : 0);
      out.handbrake = down.has('Space');
      out.nitro = down.has('ShiftLeft') || down.has('ShiftRight');
      out.fire = fireLatched;
      out.restart = restartLatched;
      out.cruise = cruiseLatched;
      out.pov = povLatched;
      fireLatched = false;
      restartLatched = false;
      cruiseLatched = false;
      povLatched = false;
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown as EventListener);
      target.removeEventListener('keyup', onKeyUp as EventListener);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousedown', onMouseDown);
    },
  };
}

function isGameKey(code: string): boolean {
  switch (code) {
    case 'KeyW':
    case 'KeyA':
    case 'KeyS':
    case 'KeyD':
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Space':
    case 'ShiftLeft':
    case 'ShiftRight':
    case 'KeyE':
    case 'KeyR':
    case 'KeyC':
    case 'KeyP':
      return true;
    default:
      return false;
  }
}
