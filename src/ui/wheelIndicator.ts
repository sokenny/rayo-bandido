/**
 * Front-wheel indicator for the cluster: a top-down car glyph whose front wheels turn with the
 * live steering angle. It exists for one moment in particular — the arrow lifted mid-slide,
 * when the wheel self-steers across to counter-steer (`src/sim/vehicle.ts`, step 2) — so the
 * player sees the wheels swing to the other side and learns to tap the arrow to hold an angle.
 *
 * Same performance contract as the tacho: the SVG is built once, and `set` writes at most one
 * transform per front wheel (quantised well under a rendered pixel) plus a class flip when the
 * wheel crosses from into-the-slide to counter-steered.
 */

const VIEW_W = 44;
const VIEW_H = 60;
/** Full lock on the glyph, in degrees. The real car's lock is ~31°; a little more reads better. */
const LOCK_DEG = 34;
/** Quantisation: 1° of a 7-unit wheel is under a rendered pixel at the cluster's scale. */
const STEP_DEG = 1;
/** `counterSteer` beyond which the wheels are shown as counter-steered / steered in. */
const COUNTER_ON = 0.3;

const FRONT_Y = 17;
const REAR_Y = 43;
const WHEEL_X = 9;
const WHEEL_W = 5;
const WHEEL_H = 11;

export interface WheelIndicator {
  readonly root: HTMLElement;
  /**
   * `steer` is the wheel angle as a fraction of full lock (-1..1, positive = right),
   * `counterSteer` is `VehicleState.counterSteer`, `sliding` whether a drift is held.
   */
  set(steer: number, counterSteer: number, sliding: boolean): void;
  dispose(): void;
}

function wheel(cx: number, cy: number, cls: string): string {
  return (
    `<rect class="${cls}" x="${cx - WHEEL_W / 2}" y="${cy - WHEEL_H / 2}" width="${WHEEL_W}" height="${WHEEL_H}" rx="1.4"` +
    ` transform="rotate(0 ${cx} ${cy})"/>`
  );
}

export function createWheelIndicator(): WheelIndicator {
  const root = document.createElement('div');
  root.className = 'rb-wheels';
  root.innerHTML =
    `<svg class="rb-wheels__svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" aria-hidden="true">` +
    `<rect class="rb-wheels__body" x="13" y="8" width="18" height="44" rx="6"/>` +
    `<rect class="rb-wheels__cabin" x="16" y="22" width="12" height="14" rx="3"/>` +
    wheel(WHEEL_X, REAR_Y, 'rb-wheels__wheel rb-wheels__wheel--rear') +
    wheel(VIEW_W - WHEEL_X, REAR_Y, 'rb-wheels__wheel rb-wheels__wheel--rear') +
    wheel(WHEEL_X, FRONT_Y, 'rb-wheels__wheel rb-wheels__wheel--front rb-wheels__front-l') +
    wheel(VIEW_W - WHEEL_X, FRONT_Y, 'rb-wheels__wheel rb-wheels__wheel--front rb-wheels__front-r') +
    `</svg>`;

  const left = root.querySelector('.rb-wheels__front-l') as SVGRectElement;
  const right = root.querySelector('.rb-wheels__front-r') as SVGRectElement;
  let shownStep = 0;
  let state = 0; // 0 neutral, 1 counter-steered, -1 steered into the slide
  let shownSliding = false;

  return {
    root,
    set(steer, counterSteer, sliding) {
      const clamped = steer < -1 ? -1 : steer > 1 ? 1 : steer;
      const step = Math.round((clamped * LOCK_DEG) / STEP_DEG);
      if (step !== shownStep) {
        shownStep = step;
        const deg = (step * STEP_DEG).toFixed(0);
        left.setAttribute('transform', `rotate(${deg} ${WHEEL_X} ${FRONT_Y})`);
        right.setAttribute('transform', `rotate(${deg} ${VIEW_W - WHEEL_X} ${FRONT_Y})`);
      }
      const next = !sliding ? 0 : counterSteer > COUNTER_ON ? 1 : counterSteer < -COUNTER_ON ? -1 : 0;
      if (next !== state) {
        state = next;
        root.classList.toggle('is-counter', next === 1);
        root.classList.toggle('is-into', next === -1);
      }
      if (sliding !== shownSliding) {
        shownSliding = sliding;
        root.classList.toggle('is-sliding', sliding);
      }
    },
    dispose() {},
  };
}
