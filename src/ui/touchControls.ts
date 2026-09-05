import type { PlayerCommand } from '../core/types';
import type { InputSource } from '../core/input/keyboard';

/**
 * The on-screen pad: the phone's version of WASD.
 *
 * Deliberately basic — steer, gas, brake, handbrake, nitro, restart — because a thumb pad
 * with a control for everything is a control for nothing. Lightning is not on the pad: a tap
 * anywhere on the screen already fires it (the mouse-click binding in
 * `src/core/input/keyboard.ts` sees the touch's compatibility click), so the big empty middle
 * of the screen *is* the fire button. Camera, cruise and the gearbox stay on the keyboard.
 *
 * It is an `InputSource` like any other, so it is combined with keyboard and pad in
 * `src/game.ts` and the simulation never learns it exists. Steering is digital (-1 / +1) to
 * match the keyboard, which the vehicle already smooths through `steerAngle`.
 *
 * Pointer events, not touch events: `setPointerCapture` means a thumb that slides off a button
 * still releases it (a lost `pointerup` would leave the throttle stuck on), and one pointer per
 * button gives multi-touch — gas and steer together — for free.
 */

/** What a button does while it is held. `restart` is the one edge-triggered action here. */
type PadAction = 'left' | 'right' | 'throttle' | 'brake' | 'handbrake' | 'nitro' | 'restart';

interface PadSpec {
  action: PadAction;
  label: string;
  /** Extra class for size and colour. */
  modifier?: string;
}

const LEFT_CLUSTER: PadSpec[] = [
  { action: 'left', label: '◀', modifier: 'rb-touch__btn--steer' },
  { action: 'right', label: '▶', modifier: 'rb-touch__btn--steer' },
];

const RIGHT_CLUSTER: PadSpec[] = [
  { action: 'nitro', label: 'NOS', modifier: 'rb-touch__btn--nitro' },
  { action: 'handbrake', label: 'HAND', modifier: 'rb-touch__btn--hand' },
  { action: 'brake', label: 'BRAKE', modifier: 'rb-touch__btn--brake' },
  { action: 'throttle', label: 'GAS', modifier: 'rb-touch__btn--gas' },
];

export function createTouchControls(parent: HTMLElement = document.body): InputSource {
  const root = document.createElement('div');
  root.className = 'rb-touch';
  // The HUD's keyboard legend is noise once the pad is on screen: the buttons are the legend.
  document.body.classList.add('rb-touch-pad');

  const held = new Set<PadAction>();
  let restartLatched = false;

  function build(specs: PadSpec[], clusterClass: string): HTMLElement {
    const cluster = document.createElement('div');
    cluster.className = `rb-touch__cluster ${clusterClass}`;
    for (const spec of specs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `rb-touch__btn ${spec.modifier ?? ''}`.trim();
      btn.textContent = spec.label;
      btn.setAttribute('aria-label', spec.action);
      wire(btn, spec.action);
      cluster.appendChild(btn);
    }
    return cluster;
  }

  function wire(btn: HTMLElement, action: PadAction): void {
    const press = (e: PointerEvent): void => {
      // Stops the tap from also scrolling, zooming, or reaching the window as the click that
      // fires lightning — a thumb on GAS should not shoot.
      e.preventDefault();
      // Capture is what makes a thumb that slides off still release the button. It throws for
      // a pointer the browser no longer tracks, which must not cost us the press itself.
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* no capture: `pointerup` on the button is then the only release, which is enough */
      }
      btn.classList.add('is-on');
      if (action === 'restart') restartLatched = true;
      else held.add(action);
    };
    const release = (): void => {
      btn.classList.remove('is-on');
      held.delete(action);
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    // The capture makes this a "thumb left the button" signal rather than a hover-out.
    btn.addEventListener('lostpointercapture', release);
  }

  root.appendChild(build(LEFT_CLUSTER, 'rb-touch__cluster--left'));

  const right = document.createElement('div');
  right.className = 'rb-touch__cluster rb-touch__cluster--right';
  right.appendChild(build(RIGHT_CLUSTER.slice(0, 2), 'rb-touch__cluster--aux'));
  right.appendChild(build(RIGHT_CLUSTER.slice(2), 'rb-touch__cluster--drive'));
  root.appendChild(right);

  root.appendChild(
    build([{ action: 'restart', label: 'R', modifier: 'rb-touch__btn--restart' }], 'rb-touch__cluster--restart'),
  );

  // A held button survives a tab switch as a stuck control; the blur is the only warning.
  const onBlur = (): void => {
    held.clear();
    for (const el of root.querySelectorAll('.is-on')) el.classList.remove('is-on');
  };
  window.addEventListener('blur', onBlur);

  parent.appendChild(root);

  return {
    poll(out: PlayerCommand) {
      out.throttle = held.has('throttle') ? 1 : 0;
      out.brake = held.has('brake') ? 1 : 0;
      out.steer = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
      out.handbrake = held.has('handbrake');
      out.nitro = held.has('nitro');
      out.fire = false;
      out.restart = restartLatched;
      out.cruise = false;
      out.pov = false;
      out.shiftUp = false;
      out.shiftDown = false;
      out.transmission = false;
      restartLatched = false;
    },
    dispose() {
      window.removeEventListener('blur', onBlur);
      document.body.classList.remove('rb-touch-pad');
      root.remove();
    },
  };
}
