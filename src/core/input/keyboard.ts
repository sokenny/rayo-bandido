import type { PlayerCommand } from '../types';

/**
 * Keyboard input -> PlayerCommand. Edge-triggered actions (restart, cruise, pov) are latched
 * between polls so a short tap is never lost, and cleared after `poll()` reads them once.
 * `fire` is not one of them: it reports the button's held state, because the lightning charges
 * while it is down and the simulation owns that timing (`src/sim/lightning.ts`).
 *
 * Bindings (docs/DECISIONS.md): WASD / arrows drive, Space (or `/` or numpad 0) handbrake, Shift nitro,
 * E held (or a held mouse button) charges and throws the lightning, R restarts, C toggles
 * cruise mode, P cycles camera view, X / Z shift up / down on a manual box, T toggles automatic / manual, F takes up (and
 * afterwards dismisses) a free-world activity — the Rayo Rush marker.
 */
export interface InputSource {
  /** Fill `out` with the current command. Edge-triggered flags are consumed. */
  poll(out: PlayerCommand): void;
  dispose(): void;
}

export function createPlayerCommand(): PlayerCommand {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    nitro: false,
    fire: false,
    restart: false,
    cruise: false,
    pov: false,
    shiftUp: false,
    shiftDown: false,
    transmission: false,
    activate: false,
  };
}

export function createKeyboardInput(target: Window | HTMLElement = window): InputSource {
  const down = new Set<string>();
  /** Pointer ids currently held down on the world (not on a control), for the mouse binding. */
  const firingPointers = new Set<number>();
  let restartLatched = false;
  let cruiseLatched = false;
  let povLatched = false;
  let shiftUpLatched = false;
  let shiftDownLatched = false;
  let transmissionLatched = false;
  let activateLatched = false;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) {
      if (isGameKey(e.code)) e.preventDefault();
      return;
    }
    down.add(e.code);
    if (e.code === 'KeyR') restartLatched = true;
    if (e.code === 'KeyC') cruiseLatched = true;
    if (e.code === 'KeyP') povLatched = true;
    if (e.code === 'KeyX') shiftUpLatched = true;
    if (e.code === 'KeyZ') shiftDownLatched = true;
    if (e.code === 'KeyT') transmissionLatched = true;
    if (e.code === 'KeyF') activateLatched = true;
    if (isGameKey(e.code)) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    down.delete(e.code);
  };
  const onBlur = (): void => {
    down.clear();
    firingPointers.clear();
  };
  /**
   * Holding the mouse — or a finger — charges the lightning, exactly as holding E does. This
   * listens for `pointerdown` rather than `mousedown` so a phone charges from the touch
   * itself: the compatibility mouse event a tap would otherwise be waiting for is synthesised
   * only after `touchend`, and is dropped entirely when the double-tap-zoom guard in
   * `src/ui/mobileShell.ts` swallows a fast second tap. Touches on a control — the thumb pad,
   * a menu, any button — are that control's, not the gun's.
   */
  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest('.rb-touch, #menu-root, button, input, select, textarea, a')) return;
    firingPointers.add(e.pointerId);
  };
  /** Any end of the pointer releases the shot; a lost `pointerup` would leave the gun stuck on. */
  const onPointerUp = (e: PointerEvent): void => {
    firingPointers.delete(e.pointerId);
  };

  target.addEventListener('keydown', onKeyDown as EventListener);
  target.addEventListener('keyup', onKeyUp as EventListener);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  return {
    poll(out) {
      const forward = down.has('KeyW') || down.has('ArrowUp');
      const back = down.has('KeyS') || down.has('ArrowDown');
      const left = down.has('KeyA') || down.has('ArrowLeft');
      const right = down.has('KeyD') || down.has('ArrowRight');
      out.throttle = forward ? 1 : 0;
      out.brake = back ? 1 : 0;
      out.steer = (right ? 1 : 0) - (left ? 1 : 0);
      // Space is the handbrake, but on a membrane keyboard the arrow cluster and Space can
      // share matrix lines, and the third key of Up + Left + Space is then never delivered to
      // the browser at all - the classic ghosting failure, and it is the hardware's, not ours.
      // `/` and numpad 0 sit far enough away on every layout we have seen to survive it, and
      // both fall under the right hand that is already on the arrows. Neither is a modifier,
      // so holding one cannot turn a throttle press into a browser shortcut the way Ctrl+W
      // would.
      out.handbrake = down.has('Space') || down.has('Slash') || down.has('Numpad0');
      out.nitro = down.has('ShiftLeft') || down.has('ShiftRight');
      out.fire = down.has('KeyE') || firingPointers.size > 0;
      out.restart = restartLatched;
      out.cruise = cruiseLatched;
      out.pov = povLatched;
      out.shiftUp = shiftUpLatched;
      out.shiftDown = shiftDownLatched;
      out.transmission = transmissionLatched;
      out.activate = activateLatched;
      restartLatched = false;
      cruiseLatched = false;
      povLatched = false;
      shiftUpLatched = false;
      shiftDownLatched = false;
      transmissionLatched = false;
      activateLatched = false;
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown as EventListener);
      target.removeEventListener('keyup', onKeyUp as EventListener);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
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
    case 'Slash':
    case 'Numpad0':
    case 'ShiftLeft':
    case 'ShiftRight':
    case 'KeyE':
    case 'KeyR':
    case 'KeyC':
    case 'KeyP':
    case 'KeyX':
    case 'KeyZ':
    case 'KeyT':
      return true;
    default:
      return false;
  }
}
