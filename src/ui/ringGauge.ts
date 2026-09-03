/**
 * Segmented ring gauge used by both bottom-corner HUD meters (lightning charge, nitro).
 *
 * Geometry: a 270 degree arc with the gap centred at the bottom, drawn as a stroked circle
 * clipped by an SVG mask made of evenly spaced dashes. That gives the segmented look of
 * `assets/references/approved-visual-target.png` while the fill level stays a single
 * `stroke-dasharray` write.
 *
 * Optional extras (opt-in per gauge so unused nodes are never created):
 *   - `secondaryArc`: a thin continuous arc inside the ring. The lightning gauge uses it for
 *     the shot cooldown, which shrinks to nothing when the weapon is free again.
 *   - `chargingBadge`: a small "+" sitting in the ring's bottom gap, shown while the resource
 *     is refilling (nitro).
 *
 * Performance contract: the SVG is built once. Every setter quantises to the smallest visible
 * step and returns early when nothing changed, so a steady gauge costs zero DOM writes.
 */

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Visible sweep: 270 degrees, i.e. three quarters of the circle. */
const ARC = CIRCUMFERENCE * 0.75;
const SEGMENTS = 22;
const PERIOD = ARC / SEGMENTS;
const DASH = PERIOD * 0.66;
const GAP = PERIOD - DASH;
/** Inner arc, between the segmented ring and the glyph core. */
const RADIUS_2 = 33;
const CIRCUMFERENCE_2 = 2 * Math.PI * RADIUS_2;
const ARC_2 = CIRCUMFERENCE_2 * 0.75;
/** Start the sweep bottom-left so the 90 degree gap sits at the bottom. */
const ROTATION = 'rotate(135 50 50)';
/** 1/200 of the ring is well below one rendered pixel of arc; smaller changes are invisible. */
const STEP = 200;
const STEP_2 = 100;

let uid = 0;

export interface RingGauge {
  readonly root: HTMLElement;
  /** 0..1 fill level. */
  setValue(value: number): void;
  /** 0..1 inner arc level. No-op unless the gauge was created with `secondaryArc`. */
  setSecondary(value: number): void;
  /** Pulsing halo (lightning charged and free to fire). */
  setReady(on: boolean): void;
  /** Brightened state (nitro currently boosting). */
  setActive(on: boolean): void;
  /** Dimmed state while the weapon is on cooldown. */
  setCooling(on: boolean): void;
  /** Refilling state; reveals the "+" badge. No-op without `chargingBadge`. */
  setCharging(on: boolean): void;
}

export interface RingGaugeOptions {
  /** Modifier class, e.g. `rb-gauge--charge`. */
  variant: string;
  /** Inline SVG string from `./icons`. */
  icon: string;
  secondaryArc?: boolean;
  chargingBadge?: boolean;
}

export function createRingGauge(options: RingGaugeOptions): RingGauge {
  uid++;
  const maskId = `rb-seg-${uid}`;
  const root = document.createElement('div');
  root.className = `rb-gauge ${options.variant}`;
  root.innerHTML =
    `<svg class="rb-gauge__svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
    `<defs><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">` +
    `<circle cx="50" cy="50" r="${RADIUS}" fill="none" stroke="#fff" stroke-width="16"` +
    ` stroke-dasharray="${DASH.toFixed(2)} ${GAP.toFixed(2)}" transform="${ROTATION}"/>` +
    `</mask></defs>` +
    `<g mask="url(#${maskId})">` +
    `<circle class="rb-gauge__track" cx="50" cy="50" r="${RADIUS}" transform="${ROTATION}"` +
    ` stroke-dasharray="${ARC.toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}"/>` +
    `<circle class="rb-gauge__glow" cx="50" cy="50" r="${RADIUS}" transform="${ROTATION}"` +
    ` stroke-dasharray="0 ${CIRCUMFERENCE.toFixed(2)}"/>` +
    `<circle class="rb-gauge__fill" cx="50" cy="50" r="${RADIUS}" transform="${ROTATION}"` +
    ` stroke-dasharray="0 ${CIRCUMFERENCE.toFixed(2)}"/>` +
    `</g>` +
    (options.secondaryArc
      ? `<circle class="rb-gauge__inner" cx="50" cy="50" r="${RADIUS_2}" transform="${ROTATION}"` +
        ` stroke-dasharray="0 ${CIRCUMFERENCE_2.toFixed(2)}"/>`
      : '') +
    `</svg>` +
    `<div class="rb-gauge__halo"></div>` +
    `<div class="rb-gauge__core">${options.icon}</div>` +
    (options.chargingBadge ? `<div class="rb-gauge__plus">+</div>` : '');

  const fill = root.querySelector('.rb-gauge__fill') as SVGCircleElement;
  const glow = root.querySelector('.rb-gauge__glow') as SVGCircleElement;
  const inner = root.querySelector('.rb-gauge__inner') as SVGCircleElement | null;
  const tail = ` ${CIRCUMFERENCE.toFixed(2)}`;
  const tail2 = ` ${CIRCUMFERENCE_2.toFixed(2)}`;

  let lastStep = -1;
  let lastStep2 = -1;
  let ready = false;
  let active = false;
  let cooling = false;
  let charging = false;

  function flag(name: string, on: boolean): void {
    root.classList.toggle(name, on);
  }

  return {
    root,
    setValue(value) {
      const clamped = value <= 0 ? 0 : value >= 1 ? 1 : value;
      const step = Math.round(clamped * STEP);
      if (step === lastStep) return;
      lastStep = step;
      const dash = ((step / STEP) * ARC).toFixed(2) + tail;
      fill.setAttribute('stroke-dasharray', dash);
      glow.setAttribute('stroke-dasharray', dash);
    },
    setSecondary(value) {
      if (!inner) return;
      const clamped = value <= 0 ? 0 : value >= 1 ? 1 : value;
      const step = Math.round(clamped * STEP_2);
      if (step === lastStep2) return;
      lastStep2 = step;
      inner.setAttribute('stroke-dasharray', ((step / STEP_2) * ARC_2).toFixed(2) + tail2);
    },
    setReady(on) {
      if (on === ready) return;
      ready = on;
      flag('is-ready', on);
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      flag('is-active', on);
    },
    setCooling(on) {
      if (on === cooling) return;
      cooling = on;
      flag('is-cooling', on);
    },
    setCharging(on) {
      if (on === charging) return;
      charging = on;
      flag('is-charging', on);
    },
  };
}
