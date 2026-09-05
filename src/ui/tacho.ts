/**
 * Analogue rev counter for the bottom-centre cluster: a swept dial with ticks, numerals, a
 * needle, and the nitro charge riding the outside of the same sweep as a segmented N2O band.
 *
 * Why a needle at all: the gearbox is already there. `audio/dsp.ts:engineTone` maps road speed
 * through `AUDIO.gearBounds` to a note position that climbs to redline and drops on every
 * upshift — that is why the car can be heard shifting. This dial is that same number, drawn,
 * so the shift you hear and the shift you see are the same event and can never disagree.
 *
 * Layout note: the readout (gear, km/h) sits *beside* the dial rather than inside it, the way
 * the arcade clusters this is modelled on do it. Nothing then crosses the needle's path.
 *
 * Performance contract, same as `ringGauge.ts`: the SVG — ticks, numerals, redline band — is
 * built once and never touched again. `setRpm` writes at most one transform and one dash pair
 * per frame, both quantised to a step below one rendered pixel, so a steady needle costs zero
 * DOM writes. No geometry is read back, so the cluster cannot force a synchronous layout.
 */

import { clamp01 } from '../core/math';

/** Dial artwork is authored in this box; CSS scales it to the on-screen width. */
const VIEW_W = 264;
const VIEW_H = 156;
/** Needle pivot, low in the box so the sweep opens upwards over the road. */
const CX = 132;
const CY = 120;
/** Sweep, in degrees anticlockwise from +x: 0 rpm at 195 (lower left) to full scale at -15. */
const START = 195;
const SWEEP = 210;

/** Full scale of the dial, in rpm. Reads x1000, so the numerals run 0..10. */
const MAX_RPM = 10000;
/** Where the red band starts. Kept to the last sixth of the sweep so it reads as a warning. */
const REDLINE_RPM = 8500;
/** rpm shown at engine idle (`rpm01` 0). */
const IDLE_RPM = 900;
/** rpm shown at the top of a gear (`rpm01` 1) — just inside the red, so every shift bites. */
const TOP_RPM = 9200;

/** One tick every 200 rpm; every fifth is a major, every second major carries a numeral. */
const TICKS = 50;
const TICK_R = 96;
const TICK_MAJOR = 14;
const TICK_MINOR = 7;
const NUM_R = 64;
/** Thin arc inside the ticks that fills with the needle: the "how far up the range" trace. */
const TRACE_R = 78;
/** Outermost band: nitro. */
const NITRO_R = 110;
const NITRO_SEGMENTS = 32;

/** Needle inertia (seconds). A real needle lags its input; this also eats frame spikes. */
const NEEDLE_TAU = 0.045;
/** Quantisation: 0.4 degrees of a 96-unit radius is well under one rendered pixel of tip travel. */
const ANGLE_STEP = 0.4;
/** Trace quantisation, in the same spirit: 1/200 of the sweep. */
const TRACE_STEP = 200;

const CIRC_TRACE = 2 * Math.PI * TRACE_R;
const ARC_TRACE = CIRC_TRACE * (SWEEP / 360);
const CIRC_NITRO = 2 * Math.PI * NITRO_R;
const ARC_NITRO = CIRC_NITRO * (SWEEP / 360);
const NITRO_PERIOD = ARC_NITRO / NITRO_SEGMENTS;
const NITRO_DASH = NITRO_PERIOD * 0.62;
/**
 * An SVG circle's dash pattern starts at 3 o'clock and runs clockwise, so rotating the start
 * point back onto the sweep's first degree puts both bands on the same scale as the ticks.
 */
const ROTATION = `rotate(${-START} ${CX} ${CY})`;

const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

let uid = 0;

/** Engine note position (0 idle .. 1 redline) -> the rpm printed on this dial. */
export function tachoRpm(rpm01: number): number {
  return IDLE_RPM + clamp01(rpm01) * (TOP_RPM - IDLE_RPM);
}

/** rpm -> needle angle in degrees, anticlockwise from +x. Off-scale rpm is clamped. */
export function tachoAngle(rpm: number): number {
  const t = rpm <= 0 ? 0 : rpm >= MAX_RPM ? 1 : rpm / MAX_RPM;
  return START - t * SWEEP;
}

/** `rpm01` at which the needle enters the red band. */
export const TACHO_REDLINE01 = (REDLINE_RPM - IDLE_RPM) / (TOP_RPM - IDLE_RPM);

export interface Tacho {
  readonly root: HTMLElement;
  /** Drive the needle. `dt` is the frame's sim delta; pass 0 to snap (restart, first frame). */
  setRpm(rpm01: number, dt: number): void;
  /** 0..1 nitro charge on the outer band. */
  setNitro(value: number): void;
  /** Boosting right now: the band burns brighter. */
  setNitroActive(on: boolean): void;
  /** Refilling: the N2O tag blinks. */
  setNitroCharging(on: boolean): void;
  /** Snap the needle to `rpm01` without inertia (restart). */
  reset(rpm01: number): void;
  dispose(): void;
}

function polar(deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

const f = (n: number): string => n.toFixed(1);

/** Static dial furniture: ticks, numerals, the red band. Built once per gauge. */
function furniture(): string {
  let out = '';
  for (let i = 0; i <= TICKS; i++) {
    const rpm = (i / TICKS) * MAX_RPM;
    const major = i % 5 === 0;
    const angle = tachoAngle(rpm);
    const [x1, y1] = polar(angle, TICK_R);
    const [x2, y2] = polar(angle, TICK_R - (major ? TICK_MAJOR : TICK_MINOR));
    const cls =
      'rb-tacho__tick' +
      (major ? ' rb-tacho__tick--major' : '') +
      (rpm >= REDLINE_RPM ? ' rb-tacho__tick--red' : '');
    out += `<line class="${cls}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
  }
  // 10 is left unlabelled: the needle never reaches it, and the numeral crowded the red band.
  for (let k = 0; k <= 8; k += 2) {
    const [x, y] = polar(tachoAngle(k * 1000), NUM_R);
    const red = k * 1000 >= REDLINE_RPM ? ' rb-tacho__num--red' : '';
    out += `<text class="rb-tacho__num${red}" x="${f(x)}" y="${f(y)}">${k}</text>`;
  }
  const [rx1, ry1] = polar(tachoAngle(REDLINE_RPM), TICK_R + 4);
  const [rx2, ry2] = polar(tachoAngle(MAX_RPM), TICK_R + 4);
  const r = f(TICK_R + 4);
  out += `<path class="rb-tacho__band" d="M ${f(rx1)} ${f(ry1)} A ${r} ${r} 0 0 1 ${f(rx2)} ${f(ry2)}"/>`;
  return out;
}

export function createTacho(): Tacho {
  uid++;
  const maskId = `rb-n2o-${uid}`;
  const root = document.createElement('div');
  root.className = 'rb-tacho__dial';
  root.innerHTML =
    `<svg class="rb-tacho__svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" aria-hidden="true" focusable="false">` +
    `<defs><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${VIEW_W}" height="${VIEW_H}">` +
    `<circle cx="${CX}" cy="${CY}" r="${NITRO_R}" fill="none" stroke="#fff" stroke-width="12"` +
    ` stroke-dasharray="${NITRO_DASH.toFixed(2)} ${(NITRO_PERIOD - NITRO_DASH).toFixed(2)}"` +
    ` transform="${ROTATION}"/></mask></defs>` +
    // Outer band: nitro, on the same sweep as the revs so the two read as one instrument.
    `<g mask="url(#${maskId})">` +
    `<circle class="rb-tacho__n2o-track" cx="${CX}" cy="${CY}" r="${NITRO_R}" transform="${ROTATION}"` +
    ` stroke-dasharray="${ARC_NITRO.toFixed(2)} ${CIRC_NITRO.toFixed(2)}"/>` +
    `<circle class="rb-tacho__n2o-glow" cx="${CX}" cy="${CY}" r="${NITRO_R}" transform="${ROTATION}"` +
    ` stroke-dasharray="0 ${CIRC_NITRO.toFixed(2)}"/>` +
    `<circle class="rb-tacho__n2o-fill" cx="${CX}" cy="${CY}" r="${NITRO_R}" transform="${ROTATION}"` +
    ` stroke-dasharray="0 ${CIRC_NITRO.toFixed(2)}"/>` +
    `</g>` +
    `<text class="rb-tacho__n2o-tag" x="16" y="58">N2O</text>` +
    furniture() +
    // Inner trace: the same value as the needle, drawn as an arc so the rev range reads at a
    // glance even when the needle is somewhere the eye is not.
    `<circle class="rb-tacho__trace-glow" cx="${CX}" cy="${CY}" r="${TRACE_R}" transform="${ROTATION}"` +
    ` stroke-dasharray="0 ${CIRC_TRACE.toFixed(2)}"/>` +
    `<circle class="rb-tacho__trace" cx="${CX}" cy="${CY}" r="${TRACE_R}" transform="${ROTATION}"` +
    ` stroke-dasharray="0 ${CIRC_TRACE.toFixed(2)}"/>` +
    // The needle and its halo share one rotating group: one transform write moves both.
    `<g class="rb-tacho__needle">` +
    `<polygon class="rb-tacho__needle-halo" points="${CX - 18},${CY - 5} ${CX + 90},${CY - 3} ${CX + 90},${CY + 3} ${CX - 18},${CY + 5}"/>` +
    `<polygon class="rb-tacho__needle-blade" points="${CX - 18},${CY - 2.6} ${CX + 90},${CY - 1.1} ${CX + 90},${CY + 1.1} ${CX - 18},${CY + 2.6}"/>` +
    `</g>` +
    `<circle class="rb-tacho__hub" cx="${CX}" cy="${CY}" r="8"/>` +
    `<circle class="rb-tacho__pin" cx="${CX}" cy="${CY}" r="2.6"/>` +
    `<text class="rb-tacho__scale" x="${CX}" y="${CY - 30}">RPM x1000</text>` +
    `</svg>`;

  const needleEl = root.querySelector('.rb-tacho__needle') as SVGGElement;
  const traceEl = root.querySelector('.rb-tacho__trace') as SVGCircleElement;
  const traceGlowEl = root.querySelector('.rb-tacho__trace-glow') as SVGCircleElement;
  const nitroFillEl = root.querySelector('.rb-tacho__n2o-fill') as SVGCircleElement;
  const nitroGlowEl = root.querySelector('.rb-tacho__n2o-glow') as SVGCircleElement;
  const traceTail = ` ${CIRC_TRACE.toFixed(2)}`;
  const nitroTail = ` ${CIRC_NITRO.toFixed(2)}`;

  /** Smoothed needle position, 0..1 in engine-note space. */
  let needle = 0;
  let shownAngleStep = Number.NaN;
  let shownTraceStep = -1;
  let shownNitroStep = -1;
  let redline = false;
  let nitroActive = false;
  let nitroCharging = false;
  const animations: Animation[] = [];

  function paint(): void {
    const angle = tachoAngle(tachoRpm(needle));
    const angleStep = Math.round(angle / ANGLE_STEP);
    if (angleStep !== shownAngleStep) {
      shownAngleStep = angleStep;
      // SVG rotates clockwise for a positive angle; the sweep is measured anticlockwise.
      needleEl.setAttribute('transform', `rotate(${(-angleStep * ANGLE_STEP).toFixed(2)} ${CX} ${CY})`);
    }
    const t = tachoRpm(needle) / MAX_RPM;
    const traceStep = Math.round(t * TRACE_STEP);
    if (traceStep !== shownTraceStep) {
      shownTraceStep = traceStep;
      const dash = ((traceStep / TRACE_STEP) * ARC_TRACE).toFixed(2) + traceTail;
      traceEl.setAttribute('stroke-dasharray', dash);
      traceGlowEl.setAttribute('stroke-dasharray', dash);
    }
    const hot = needle >= TACHO_REDLINE01;
    if (hot !== redline) {
      redline = hot;
      root.classList.toggle('is-redline', hot);
    }
  }

  paint();

  return {
    root,
    setRpm(rpm01, dt) {
      const target = clamp01(rpm01);
      if (dt > 0) {
        needle += (target - needle) * (1 - Math.exp(-dt / NEEDLE_TAU));
        if (Math.abs(target - needle) < 0.0004) needle = target;
      } else {
        needle = target;
      }
      paint();
    },
    setNitro(value) {
      const step = Math.round(clamp01(value) * 100);
      if (step === shownNitroStep) return;
      shownNitroStep = step;
      const dash = ((step / 100) * ARC_NITRO).toFixed(2) + nitroTail;
      nitroFillEl.setAttribute('stroke-dasharray', dash);
      nitroGlowEl.setAttribute('stroke-dasharray', dash);
    },
    setNitroActive(on) {
      if (on === nitroActive) return;
      nitroActive = on;
      root.classList.toggle('is-boosting', on);
      if (on && canAnimate) {
        // One quick flare on the band when the bottle opens; self-cancelling, compositor-driven.
        animations.push(
          nitroGlowEl.animate([{ opacity: 0.75 }, { opacity: 0.22 }], { duration: 420, easing: 'ease-out' }),
        );
      }
    },
    setNitroCharging(on) {
      if (on === nitroCharging) return;
      nitroCharging = on;
      root.classList.toggle('is-charging', on);
    },
    reset(rpm01) {
      needle = clamp01(rpm01);
      paint();
    },
    dispose() {
      for (const a of animations) a.cancel();
      animations.length = 0;
    },
  };
}
