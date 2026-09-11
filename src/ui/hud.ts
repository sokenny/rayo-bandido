import type { GameEvent, GameMode, HudSnapshot, RaceHudSnapshot, StreetRaceHudSnapshot, TimeAttackHudSnapshot } from '../core/types';
import { createStreetOverlay, type StreetOverlay } from './streetOverlay';
import { BOLT_ICON } from './icons';
import { createRingGauge } from './ringGauge';
import { createSystemMessage } from './systemMessage';
import { createWheelIndicator } from './wheelIndicator';
import { createTacho } from './tacho';
import { createRushOverlay, type RushOverlay } from './rushOverlay';
import { createPassengerOverlay, type PassengerOverlay } from './passengerOverlay';
import { createBuhoOverlay, type BuhoOverlay } from './buhoOverlay';
import { NEAR_MISS } from '../config/tuning';
import { createGateOverlay, type GateOverlay } from './gateOverlay';
import { createPoliceOverlay, type PoliceOverlay } from './policeOverlay';

/**
 * Floating DOM HUD. Receives a `HudSnapshot` every render frame and discrete `GameEvent`s
 * for transient flashes (reward, denied shot, restart).
 *
 * Direction: "interfaz mínima y flotante" (docs/VISUAL_DIRECTION.md). Nothing is boxed into a
 * chrome frame; every element floats in a screen corner over the scene. Lightning is
 * cyan/blue-white, nitro is magenta/violet, money is a yen counter. Original layout only.
 *
 * Reading order the HUD teaches, without a tutorial:
 *   drift (left) -> charges the bolt ring (bottom-left) -> READY -> holding E builds the aim
 *   meter (centre) WHILE THE RING DRAINS, because reach is bought with charge, and the bolt
 *   flies down the car's nose -> money goes up (top-right).
 *   The chain multiplier survives the
 *   end of a drift with a draining bar, so linking drifts is discoverable.
 *
 * Performance contract:
 *   - the whole tree is built once; `update` never creates nodes,
 *   - every write is guarded by a diff against the value actually displayed
 *     (integers, one decimal, or a quantised step),
 *   - no geometry is read back, so the HUD cannot force a synchronous layout,
 *   - transient flashes use the Web Animations API (compositor-driven, self-cancelling)
 *     instead of a per-frame timer.
 */
export interface Hud {
  update(snapshot: HudSnapshot): void;
  onEvent(event: GameEvent): void;
  dispose(): void;
}

/**
 * What the HUD needs from the game beyond a snapshot. Today that is only how the RAYO RUSH
 * prompt reaches the simulation when it is clicked or tapped rather than triggered by the key.
 */
export interface HudOptions {
  /** Raise `PlayerCommand.activate` on the next tick. Omitted in worlds with no activity. */
  onActivate?: () => void;
  /** Which activities this world carries. Both default to "whenever `onActivate` is given". */
  rush?: boolean;
  passengers?: boolean;
  /** El Búho's bay. Defaults to off: only the world that has him asks for it. */
  buho?: boolean;
  /**
   * The start line the circuit missions are entered on. Defaults to off: only the open world
   * carries the door, and the circuit itself must never offer a way into the circuit.
   */
  circuitGate?: boolean;
  /** The wanted level and the police's warnings (`src/ui/policeOverlay.ts`). Free Roam only. */
  police?: boolean;
  /** The STREET RACE rings' sign (`src/ui/streetOverlay.ts`). The open world only. */
  streetGate?: boolean;
}

/** Seconds of play after which the controls card fades away. */
const CONTROLS_INTRO = 10;
/** Seconds the controls card comes back for after a restart. */
const CONTROLS_REPLAY = 5;
/** Chain window length the drain bar is normalised against. */
const CHAIN_FADE = 1.5;
/** Minimum seconds between two "drive to recharge" hints. */
const DRIVE_HINT_EVERY = 8;
/** Quantisation of the chain drain bar: 20 steps over the whole window. */
const CHAIN_STEPS = 20;
/** Quantisation of the aim charge bar, in steps over the full hold. */
const AIM_STEPS = 30;
/** Seconds the near-miss tally stays up after the last pass in it. */
const NEAR_MISS_HOLD = 2;

/**
 * Same card, pad labels, shown instead of the keys once a controller is plugged in. The order
 * follows NFS Underground 2's default layout, which is the mapping the pad uses.
 */
export const PAD_CONTROLS = [
  ['RT/LT', 'drive'],
  ['STICK', 'steer'],
  ['A', 'handbrake'],
  ['B', 'nitro'],
  ['X', 'hold: aim'],
  ['Y', 'camera'],
  ['VIEW', 'cruise'],
  ['START', 'restart'],
  ['RB/LB', 'shift'],
  ['R3', 'activity'],
];

export const CONTROLS = [
  ['WASD', 'drive'],
  ['SPACE or /', 'handbrake'],
  ['SHIFT', 'nitro'],
  ['E', 'hold: aim'],
  ['R', 'restart'],
  ['C', 'cruise'],
  ['P', 'camera'],
  ['T', 'auto/manual'],
  ['F', 'activity'],
  ['X/Z', 'shift'],
  ['ESC', 'menu'],
  ['F3', 'debug'],
  ['F4', 'coords'],
];

/** `83.456` -> `1:23.45`. Allocates a short string; only called when the shown value changes. */
export function formatRaceTime(seconds: number): string {
  if (seconds < 0) return '--:--.--';
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = Math.floor(total - m * 60);
  const c = Math.floor((total - m * 60 - s) * 100);
  return `${m}:${s < 10 ? '0' : ''}${s}.${c < 10 ? '0' : ''}${c}`;
}

const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

function pick<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Rayo Bandido HUD: missing element "${selector}"`);
  return el as T;
}

/** `1200` -> `1,200`. Only called when the value actually changed. */
function formatMoney(value: number): string {
  const digits = String(Math.max(0, Math.round(value)));
  if (digits.length <= 3) return digits;
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ',';
  }
  return out;
}

export function createHud(root: HTMLElement, mode: GameMode = 'test', multiplayer = false, options: HudOptions = {}): Hud {
  root.innerHTML = '';

  const hud = document.createElement('div');
  const isRace = mode === 'race' || mode === 'circuit' || mode === 'street';
  hud.className = `rb-hud${isRace ? ' is-race' : ''}`;
  // R restarts on your own; in a match it cannot, because the race belongs to everybody — it
  // puts the car back on the road at the last gate instead, with the clock still running.
  function controlsFor(source: string[][]): string {
    const rows = multiplayer
      ? source.map(([key, action]) => (action === 'restart' ? [key, 'rescue'] : [key, action]))
      : source;
    return rows.map(([key, action]) => `<span><b>${key}</b> ${action}</span>`).join('');
  }
  hud.innerHTML =
    `<div class="rb-controls">${controlsFor(CONTROLS)}</div>` +
    `<div class="rb-money">` +
    `<div class="rb-money__value"><span class="rb-money__yen">¥</span><span class="rb-money__digits">0</span></div>` +
    `<div class="rb-money__meta"><span class="rb-money__destroyed">destroyed 0</span>` +
    `<span class="rb-money__near">near miss 0</span>` +
    `<span class="rb-money__remaining">targets left 0</span></div>` +
    `<div class="rb-money__flashes"><span class="rb-reward"></span><span class="rb-reward"></span>` +
    `<span class="rb-reward"></span></div>` +
    `</div>` +
    // Deliberately not in the money column: a reward nobody looks at is not a reward. This
    // lands over the car, where the eyes already are (see `.rb-nearmiss`).
    `<div class="rb-nearmiss"><span class="rb-nearmiss__label">NEAR MISS` +
    `<span class="rb-nearmiss__chain"></span></span>` +
    `<span class="rb-nearmiss__value">+¥0</span></div>` +
    `<div class="rb-aim">` +
    `<span class="rb-aim__label">ON TARGET</span>` +
    `<div class="rb-aim__bar"><span class="rb-aim__fill"></span></div></div>` +
    `<div class="rb-cruise"><span class="rb-cruise__dot"></span>CRUISE</div>` +
    `<div class="rb-race">` +
    `<div class="rb-race__lap"><span class="rb-race__lap-label">LAP</span><span class="rb-race__lap-value">1/2</span>` +
    // The Street Race's position, on the lap line: `P2 / 3`. Off everywhere else.
    `<span class="rb-race__pos"><span class="rb-race__pos-value">P1</span><span class="rb-race__pos-field">/ 2</span></span></div>` +
    `<div class="rb-race__time">0:00.00</div>` +
    `<div class="rb-race__laps"><span class="rb-race__last">LAST --:--.--</span><span class="rb-race__best">BEST --:--.--</span></div>` +
    `<div class="rb-race__split"></div>` +
    `</div>` +
    // The circuit mission, under the race readout: what this run has to beat, and what it has
    // spent so far. Hidden outside the solo circuit, where there is no mission to report.
    `<div class="rb-mission">` +
    `<div class="rb-mission__head"><span class="rb-mission__level">MISSION 1/3</span>` +
    `<span class="rb-mission__name">SHAKEDOWN</span></div>` +
    `<div class="rb-mission__rules"><span class="rb-mission__target">TARGET --:--.--</span>` +
    `<span class="rb-mission__crashes">CRASHES 0/0</span></div>` +
    `</div>` +
    `<div class="rb-countdown"></div>` +
    `<div class="rb-wrongway">WRONG WAY</div>` +
    `<div class="rb-results">` +
    `<div class="rb-results__title">FINISH</div>` +
    `<div class="rb-results__time">0:00.00</div>` +
    `<div class="rb-results__meta"></div>` +
    `<div class="rb-results__verdict"></div>` +
    `<div class="rb-results__mission"></div>` +
    (mode === 'street'
      ? `<div class="rb-results__keys"><span class="rb-key">R</span> retry <span class="rb-key">ESC</span> free roam</div>`
      : `<div class="rb-results__keys"><span class="rb-key">R</span> race again <span class="rb-key">ESC</span> menu</div>`) +
    `</div>` +
    `<div class="rb-stack rb-stack--left">` +
    `<div class="rb-driftline">` +
    `<div class="rb-drift"><span class="rb-drift__label">DRIFT</span>` +
    `<span class="rb-drift__time">0.0s</span></div>` +
    `<div class="rb-chain"><span class="rb-chain__value"></span><span class="rb-chain__bar"></span></div>` +
    `</div>` +
    `<div class="rb-note"></div>` +
    `<div class="rb-ready">READY</div>` +
    `<div class="rb-slot"></div>` +
    `<div class="rb-keys"><span class="rb-key rb-key--fire">E</span><span class="rb-keys__name">lightning</span></div>` +
    `</div>` +
    `<div class="rb-cluster">` +
    `<div class="rb-note rb-note--nitro"></div>` +
    `<div class="rb-cluster__row">` +
    `<div class="rb-cluster__slot"></div>` +
    `<div class="rb-cluster__readout">` +
    `<div class="rb-gear"><span class="rb-gear__label">GEAR</span><span class="rb-gear__value">1</span><span class="rb-gear__mode">A</span></div>` +
    `<div class="rb-speed"><span class="rb-speed__value">0</span><span class="rb-speed__unit">km/h</span></div>` +
    `<div class="rb-keys"><span class="rb-key rb-key--nitro">SHIFT</span><span class="rb-keys__name">nitro</span></div>` +
    `</div>` +
    `</div>` +
    `</div>`;
  root.appendChild(hud);

  // Centre-screen messages (RESTART, the cruise hint) are a shared component, and they hang
  // off `root` rather than off `hud` so cruise mode can hide the HUD without hiding them.
  const message = createSystemMessage(root);

  const chargeGauge = createRingGauge({ variant: 'rb-gauge--charge', icon: BOLT_ICON, secondaryArc: true });
  // Nitro no longer has a gauge of its own: it rides the outside of the rev counter's sweep,
  // so the whole drivetrain — revs, gear, speed, bottle — reads as one instrument.
  const tacho = createTacho();
  pick<HTMLElement>(hud, '.rb-stack--left .rb-slot').appendChild(chargeGauge.root);
  pick<HTMLElement>(hud, '.rb-cluster__slot').appendChild(tacho.root);

  /**
   * RAYO RUSH's screen furniture, composed in the way the tacho and the gauges are. Built only
   * where the activity exists — `onActivate` is what says so, and it is the game that knows.
   */
  const rush: RushOverlay | null =
    options.onActivate && options.rush !== false ? createRushOverlay({ onActivate: options.onActivate }) : null;
  if (rush) hud.appendChild(rush.root);
  /** The passengers' furniture, the same way. */
  const passengers: PassengerOverlay | null =
    options.onActivate && options.passengers !== false ? createPassengerOverlay({ onActivate: options.onActivate }) : null;
  if (passengers) hud.appendChild(passengers.root);
  /** El Búho's, the same way. */
  const buho: BuhoOverlay | null = options.onActivate && options.buho ? createBuhoOverlay({ onActivate: options.onActivate }) : null;
  if (buho) hud.appendChild(buho.root);
  /** And the circuit missions' sign, which is one prompt and nothing else. */
  const gate: GateOverlay | null =
    options.onActivate && options.circuitGate ? createGateOverlay({ onActivate: options.onActivate }) : null;
  if (gate) hud.appendChild(gate.root);
  /** The police's, only where there are police. */
  const police: PoliceOverlay | null = options.police ? createPoliceOverlay() : null;
  if (police) hud.appendChild(police.root);
  /** The Street Race rings' sign, the same way as the circuit's. */
  const street: StreetOverlay | null =
    options.onActivate && options.streetGate ? createStreetOverlay({ onActivate: options.onActivate }) : null;
  if (street) hud.appendChild(street.root);

  const controlsEl = pick<HTMLElement>(hud, '.rb-controls');
  const fireKeyEl = pick<HTMLElement>(hud, '.rb-key--fire');
  const nitroKeyEl = pick<HTMLElement>(hud, '.rb-key--nitro');
  // A pad only becomes visible to the page once it is used, so the card starts on the keys and
  // swaps the moment the player touches a controller.
  let padActive = false;
  const showPadControls = (): void => {
    padActive = true;
    controlsEl.innerHTML = controlsFor(PAD_CONTROLS);
    // The two gauges carry their own key hint; they name the pad button too.
    for (const [el, label] of [[fireKeyEl, 'X'], [nitroKeyEl, 'B']] as const) el.textContent = label;
  };
  const onPadConnected = (): void => showPadControls();
  window.addEventListener('gamepadconnected', onPadConnected);
  if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
    if (Array.from(navigator.getGamepads()).some((p) => p && p.connected)) showPadControls();
  }
  const moneyValueEl = pick<HTMLElement>(hud, '.rb-money__value');
  const moneyDigitsEl = pick<HTMLElement>(hud, '.rb-money__digits');
  const destroyedEl = pick<HTMLElement>(hud, '.rb-money__destroyed');
  const nearEl = pick<HTMLElement>(hud, '.rb-money__near');
  const remainingEl = pick<HTMLElement>(hud, '.rb-money__remaining');
  const rewardEls = Array.from(hud.querySelectorAll<HTMLElement>('.rb-reward'));
  const nearMissEl = pick<HTMLElement>(hud, '.rb-nearmiss');
  const nearMissChainEl = pick<HTMLElement>(hud, '.rb-nearmiss__chain');
  const nearMissValueEl = pick<HTMLElement>(hud, '.rb-nearmiss__value');
  const aimEl = pick<HTMLElement>(hud, '.rb-aim');
  const aimFillEl = pick<HTMLElement>(hud, '.rb-aim__fill');
  const aimLabelEl = pick<HTMLElement>(hud, '.rb-aim__label');
  const cruiseEl = pick<HTMLElement>(hud, '.rb-cruise');
  const driftEl = pick<HTMLElement>(hud, '.rb-drift');
  const driftTimeEl = pick<HTMLElement>(hud, '.rb-drift__time');
  const chainEl = pick<HTMLElement>(hud, '.rb-chain');
  const chainValueEl = pick<HTMLElement>(hud, '.rb-chain__value');
  const chainBarEl = pick<HTMLElement>(hud, '.rb-chain__bar');
  const noteEl = pick<HTMLElement>(hud, '.rb-note');
  const nitroNoteEl = pick<HTMLElement>(hud, '.rb-note--nitro');
  const readyEl = pick<HTMLElement>(hud, '.rb-ready');
  const speedEl = pick<HTMLElement>(hud, '.rb-speed');
  const speedValueEl = pick<HTMLElement>(hud, '.rb-speed__value');
  const gearEl = pick<HTMLElement>(hud, '.rb-gear');
  const gearValueEl = pick<HTMLElement>(hud, '.rb-gear__value');
  const gearModeEl = pick<HTMLElement>(hud, '.rb-gear__mode');
  let manualShown = false;
  // Front-wheel indicator: sits in the readout so the wheel swinging to counter-steer when the
  // arrow is lifted mid-slide is read next to the gear it happens in.
  const wheels = createWheelIndicator();
  pick<HTMLElement>(hud, '.rb-cluster__readout').insertBefore(wheels.root, gearEl);
  const raceEl = pick<HTMLElement>(hud, '.rb-race');
  const raceLapEl = pick<HTMLElement>(hud, '.rb-race__lap-value');
  const racePosEl = pick<HTMLElement>(hud, '.rb-race__pos');
  const racePosValueEl = pick<HTMLElement>(hud, '.rb-race__pos-value');
  const racePosFieldEl = pick<HTMLElement>(hud, '.rb-race__pos-field');
  const raceTimeEl = pick<HTMLElement>(hud, '.rb-race__time');
  const raceLastEl = pick<HTMLElement>(hud, '.rb-race__last');
  const raceBestEl = pick<HTMLElement>(hud, '.rb-race__best');
  const raceSplitEl = pick<HTMLElement>(hud, '.rb-race__split');
  const missionEl = pick<HTMLElement>(hud, '.rb-mission');
  const missionLevelEl = pick<HTMLElement>(hud, '.rb-mission__level');
  const missionNameEl = pick<HTMLElement>(hud, '.rb-mission__name');
  const missionTargetEl = pick<HTMLElement>(hud, '.rb-mission__target');
  const missionCrashesEl = pick<HTMLElement>(hud, '.rb-mission__crashes');
  const countdownEl = pick<HTMLElement>(hud, '.rb-countdown');
  const wrongWayEl = pick<HTMLElement>(hud, '.rb-wrongway');
  const resultsEl = pick<HTMLElement>(hud, '.rb-results');
  const resultsTimeEl = pick<HTMLElement>(hud, '.rb-results__time');
  const resultsMetaEl = pick<HTMLElement>(hud, '.rb-results__meta');
  const resultsVerdictEl = pick<HTMLElement>(hud, '.rb-results__verdict');
  const resultsMissionEl = pick<HTMLElement>(hud, '.rb-results__mission');

  // Displayed-value cache. Sentinels guarantee a first write for every field.
  let shownSpeed = -1;
  let shownGear = '';
  let shownGearIndex = -1;
  /** Sim time of the previous `update`, so the needle can be given a real delta. */
  let lastFrameTime = -1;
  let shownMoney = -1;
  let shownDestroyed = -1;
  let shownNearMisses = -1;
  let shownRemaining = -1;
  let shownTotal = -1;
  let shownDriftTenths = -1;
  let shownChain = -1;
  let shownChainStep = -1;
  let drifting = false;
  let aimVisible = false;
  let shownCharging = false;
  let shownFullCharge = false;
  let shownAimStep = -1;
  let ready = false;
  let reversing = false;
  let controlsVisible = true;
  let cruising = false;
  let controlsUntil = CONTROLS_INTRO;
  let rewardIndex = 0;
  // Near-miss tally. Held on the glass rather than flown past on a wreck, so a pass scored at
  // 200 km/h can still be read once the corner is over.
  let nearMissOn = false;
  let nearMissCount = 0;
  let nearMissTotal = 0;
  /** Sim time of the last pass, or `-Infinity` before the first one of a session. */
  let nearMissAt = -Infinity;
  let lastDriveHint = -DRIVE_HINT_EVERY;
  // Race readout cache.
  let shownPosition = -1;
  let shownField = -1;
  let posOn = false;
  let shownLap = -1;
  let shownLaps = -1;
  let shownCentis = -1;
  let shownLastLap = -2;
  let shownBestLap = -2;
  let shownPhase = '';
  let wrongWay = false;
  // Circuit mission cache.
  let missionOn = false;
  let shownMissionLevel = -1;
  let shownMissionCrashes = -1;
  let shownMissionLimit = -1;
  let shownMissionFailed = false;

  const animations = new Map<Element, Animation>();

  function play(el: Element, keyframes: Keyframe[], duration: number): void {
    if (!canAnimate) return;
    const previous = animations.get(el);
    if (previous) previous.cancel();
    const animation = el.animate(keyframes, { duration, easing: 'ease-out' });
    animations.set(el, animation);
  }

  /** Short transient caption in one of the bottom columns. */
  function showNote(el: HTMLElement, text: string): void {
    el.textContent = text;
    play(
      el,
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'translateY(0)', offset: 0.12 },
        { opacity: 1, transform: 'translateY(0)', offset: 0.7 },
        { opacity: 0, transform: 'translateY(0)' },
      ],
      1400,
    );
  }

  /**
   * Put a scored pass on the glass, over the car. Inside `NEAR_MISS.chainWindow` of the previous
   * one it adds to the line already up - `NEAR MISS ×3  +¥140` - and re-punches it; outside that
   * window it starts a fresh tally. Either way it holds where it is until `NEAR_MISS_HOLD` runs
   * out in `update`, instead of drifting anywhere. The chime in `audio/oneShots.ts` climbs on
   * the same window, so the number and the note step together.
   */
  function showNearMiss(points: number): void {
    const now = lastFrameTime;
    if (!(now - nearMissAt <= NEAR_MISS.chainWindow)) {
      nearMissCount = 0;
      nearMissTotal = 0;
    }
    nearMissAt = now;
    nearMissCount++;
    nearMissTotal += points;
    nearMissChainEl.textContent = nearMissCount > 1 ? `×${nearMissCount}` : '';
    nearMissValueEl.textContent = `+¥${formatMoney(nearMissTotal)}`;
    if (!nearMissOn) {
      nearMissOn = true;
      nearMissEl.classList.add('is-on');
    }
    // Transform only: the class holds the opacity, so a pass landing mid-fade snaps back to
    // full instead of finishing somebody else's fade out. It overshoots hard on the way in -
    // the overshoot IS the hit, and it re-fires on every pass of a run, so a burst pulses.
    play(
      nearMissEl,
      [
        { transform: 'scale(0.72)' },
        { transform: 'scale(1.22)', offset: 0.26 },
        { transform: 'scale(1)' },
      ],
      380,
    );
  }

  /** Drop the tally, on a restart or once it has been up long enough to read. */
  function clearNearMiss(): void {
    nearMissCount = 0;
    nearMissTotal = 0;
    nearMissAt = -Infinity;
    if (!nearMissOn) return;
    nearMissOn = false;
    nearMissEl.classList.remove('is-on');
  }

  /** `-12.30` / `+3.04`: how a finish time stands against what the mission asked for. */
  function formatDelta(seconds: number): string {
    const sign = seconds < 0 ? '-' : '+';
    return `${sign}${formatRaceTime(Math.abs(seconds)).replace(/^0:/, '')}`;
  }

  /** A target time, which is set in whole seconds: `2:40`, not `2:40.00`. */
  function formatTarget(seconds: number): string {
    return formatRaceTime(seconds).replace(/\.00$/, '');
  }

  /**
   * `CRASHES 2/3` — or, where the allowance is none, what "none" actually reads as: there is no
   * fraction of zero, so the last mission says what it wants and then what it got.
   */
  function crashText(crashes: number, limit: number): string {
    if (limit > 0) return `CRASHES ${crashes}/${limit}`;
    return crashes > 0 ? `CONTACT ×${crashes}` : 'NO CONTACT';
  }

  /**
   * The mission strip under the race readout. Only ever up on the solo circuit: everywhere else
   * — including the versus race on the very same course — the snapshot carries no mission and
   * the strip stays off.
   */
  function updateMission(t: TimeAttackHudSnapshot | null): void {
    if (!!t !== missionOn) {
      missionOn = !!t;
      missionEl.classList.toggle('is-on', missionOn);
    }
    if (!t) return;
    if (t.level !== shownMissionLevel) {
      shownMissionLevel = t.level;
      missionLevelEl.textContent = t.allClear
        ? `MISSION ${t.level + 1}/${t.levelCount} · ALL CLEAR`
        : `MISSION ${t.level + 1}/${t.levelCount}`;
      missionNameEl.textContent = t.levelName;
      missionTargetEl.textContent = `TARGET ${formatTarget(t.targetTime)}`;
    }
    // The allowance changes with the mission, and the count does not have to change with it:
    // clearing one with a clean run leaves 0 crashes against a smaller limit.
    if (t.crashes !== shownMissionCrashes || t.crashLimit !== shownMissionLimit) {
      shownMissionCrashes = t.crashes;
      shownMissionLimit = t.crashLimit;
      missionCrashesEl.textContent = crashText(t.crashes, t.crashLimit);
    }
    if (t.failed !== shownMissionFailed) {
      shownMissionFailed = t.failed;
      missionEl.classList.toggle('is-failed', t.failed);
    }
  }

  /**
   * The two mission lines on the finish card. Written once, on the frame the race finishes,
   * from the results the rules froze at the flag — never from the live state, which by then has
   * already moved the chain on to the next mission.
   */
  function fillMissionResult(t: TimeAttackHudSnapshot | null): void {
    const r = t?.results ?? null;
    resultsEl.classList.toggle('is-cleared', !!r && r.cleared);
    resultsEl.classList.toggle('is-failed', !!r && !r.cleared);
    if (!r) {
      resultsVerdictEl.textContent = '';
      resultsMissionEl.textContent = '';
      return;
    }
    resultsVerdictEl.textContent = r.advanced
      ? `MISSION ${r.level + 1} CLEARED · NEXT ONE UNLOCKED`
      : r.cleared
        ? `MISSION ${r.level + 1} CLEARED`
        : !r.withinCrashes
          ? `MISSION FAILED · ${r.crashLimit > 0 ? 'TOO MANY CRASHES' : 'CONTACT'}`
          : 'MISSION FAILED · TOO SLOW';
    const delta = formatDelta(r.time - r.targetTime);
    const best = t && t.newBest ? ' · NEW BEST' : '';
    resultsMissionEl.textContent =
      `${r.levelName} · TARGET ${formatTarget(r.targetTime)} (${delta}) · ${crashText(r.crashes, r.crashLimit)}${best}`;
  }

  /**
   * The Street Race's verdict on the finish card: the placement, and what winning unlocked.
   * Written once, from the results the rules froze at the flag.
   */
  function fillStreetResult(sr: StreetRaceHudSnapshot | null): void {
    const r = sr?.results ?? null;
    if (!r) return;
    resultsEl.classList.toggle('is-cleared', r.won);
    resultsEl.classList.toggle('is-failed', !r.won);
    const place = `P${r.placement} OF ${r.field}`;
    resultsVerdictEl.textContent = r.won
      ? r.unlockedName
        ? `WINNER · ${r.unlockedName} UNLOCKED`
        : r.allClear && r.advanced
          ? 'WINNER · SERIES COMPLETE'
          : 'WINNER'
      : `${place} · BEATEN`;
    const reward = r.reward > 0 ? ` · +¥${r.reward}` : '';
    resultsMissionEl.textContent = r.won
      ? `${r.eventName} · ${place}${reward}${r.unlockedName ? ' · A NEW RIVAL WAITS IN THE CITY' : ''}`
      : `${r.eventName} · RETRY, OR HEAD BACK TO FREE ROAM`;
  }

  /** The live position on the lap line, Street Race only. */
  function updatePosition(sr: StreetRaceHudSnapshot | null): void {
    if (!!sr !== posOn) {
      posOn = !!sr;
      racePosEl.classList.toggle('is-on', posOn);
    }
    if (!sr) return;
    if (sr.position !== shownPosition) {
      shownPosition = sr.position;
      racePosValueEl.textContent = `P${sr.position}`;
    }
    if (sr.field !== shownField) {
      shownField = sr.field;
      racePosFieldEl.textContent = `/ ${sr.field}`;
    }
  }

  function updateRace(r: RaceHudSnapshot, t: TimeAttackHudSnapshot | null, sr: StreetRaceHudSnapshot | null = null): void {
    if (r.lap !== shownLap || r.laps !== shownLaps) {
      shownLap = r.lap;
      shownLaps = r.laps;
      raceLapEl.textContent = `${r.lap}/${r.laps}`;
    }
    const centis = Math.floor(r.elapsed * 100);
    if (centis !== shownCentis) {
      shownCentis = centis;
      raceTimeEl.textContent = formatRaceTime(r.elapsed);
    }
    if (r.lastLap !== shownLastLap) {
      shownLastLap = r.lastLap;
      raceLastEl.textContent = `LAST ${formatRaceTime(r.lastLap)}`;
    }
    if (r.bestLap !== shownBestLap) {
      shownBestLap = r.bestLap;
      raceBestEl.textContent = `BEST ${formatRaceTime(r.bestLap)}`;
    }
    if (r.wrongWay !== wrongWay) {
      wrongWay = r.wrongWay;
      wrongWayEl.classList.toggle('is-on', r.wrongWay);
    }
    if (r.phase !== shownPhase) {
      shownPhase = r.phase;
      raceEl.classList.toggle('is-finished', r.phase === 'finished');
      resultsEl.classList.toggle('is-on', r.phase === 'finished');
      // Back on the grid: the card's verdict goes with it, so a restart cannot leave last
      // run's colours on a card the next finish is about to fill in.
      if (r.phase !== 'finished') fillMissionResult(null);
      if (r.phase === 'finished') {
        resultsTimeEl.textContent = formatRaceTime(r.finishTime);
        resultsMetaEl.textContent = `${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'} · BEST LAP ${formatRaceTime(r.bestLap)}`;
        fillMissionResult(t);
        fillStreetResult(sr);
        play(
          resultsEl,
          [
            { opacity: 0, transform: 'translate(-50%, -50%) scale(0.92)' },
            { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
          ],
          420,
        );
      }
    }
  }

  /** Big centred number (or GO) that pops and fades. */
  function showCountdown(text: string, hot: boolean): void {
    countdownEl.textContent = text;
    countdownEl.classList.toggle('is-go', hot);
    play(
      countdownEl,
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.5)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.18 },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(0.96)', offset: 0.7 },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.9)' },
      ],
      hot ? 900 : 800,
    );
  }

  return {
    update(s) {
      // A restart rewinds sim time; drop stale throttles so hints work again.
      if (s.time < lastDriveHint) lastDriveHint = -DRIVE_HINT_EVERY;
      updateMission(s.timeAttack);
      updatePosition(s.streetRace);
      if (s.race) updateRace(s.race, s.timeAttack, s.streetRace);
      if (rush && s.rush) rush.update(s.rush);
      if (passengers && s.passenger) passengers.update(s.passenger);
      if (buho && s.buho) buho.update(s.buho);
      if (gate && s.circuitGate) gate.update(s.circuitGate);
      if (street && s.streetGate) street.update(s.streetGate);
      if (police && s.police) police.update(s.police);

      if (s.cruising !== cruising) {
        cruising = s.cruising;
        cruiseEl.classList.toggle('is-on', s.cruising);
        // Cruise mode is meant to be left playing in the background, so it takes every
        // readout off the screen and leaves just the city — see `.is-cruise-clean`.
        root.classList.toggle('is-cruise-clean', s.cruising);
        if (s.cruising) {
          message.show('CRUISE', {
            sub: `Use ${padActive ? 'Y' : 'P'} to switch camera POVs`,
            tone: 'calm',
            duration: 3600,
          });
        } else {
          message.clear();
        }
      }

      const showControls = s.time < controlsUntil;
      if (showControls !== controlsVisible) {
        controlsVisible = showControls;
        controlsEl.classList.toggle('is-hidden', !showControls);
      }

      const speed = Math.min(999, Math.round(s.speedKmh));
      if (speed !== shownSpeed) {
        shownSpeed = speed;
        speedValueEl.textContent = String(speed);
      }
      if (s.reversing !== reversing) {
        reversing = s.reversing;
        speedEl.classList.toggle('is-reverse', s.reversing);
        gearEl.classList.toggle('is-reverse', s.reversing);
      }

      // The needle is given the frame's own delta so its inertia is frame-rate independent; a
      // restart rewinds sim time, and a zero delta makes it snap instead of sweeping back.
      const frameDt = lastFrameTime >= 0 && s.time > lastFrameTime ? Math.min(0.1, s.time - lastFrameTime) : 0;
      lastFrameTime = s.time;
      tacho.setRpm(s.rpm01, frameDt);
      tacho.setTorqueBand(s.torqueBand);
      if (s.manual !== manualShown) {
        manualShown = s.manual;
        gearModeEl.textContent = s.manual ? 'M' : 'A';
        gearEl.classList.toggle('is-manual', s.manual);
      }
      wheels.set(s.steer, s.counterSteer, s.torqueBand);
      const gearText = s.reversing ? 'R' : String(s.gear + 1);
      if (gearText !== shownGear) {
        // Only an upshift pops: downshifts happen constantly under braking and would strobe.
        const upshift = !s.reversing && s.gear > shownGearIndex && shownGearIndex >= 0;
        shownGear = gearText;
        shownGearIndex = s.reversing ? -1 : s.gear;
        gearValueEl.textContent = gearText;
        if (upshift) {
          play(
            gearValueEl,
            [
              { transform: 'scale(1)', opacity: 1 },
              { transform: 'scale(1.22)', opacity: 0.7, offset: 0.18 },
              { transform: 'scale(1)', opacity: 1 },
            ],
            360,
          );
        }
      }

      chargeGauge.setValue(s.charge);
      chargeGauge.setSecondary(s.cooldown01);
      const cooling = s.cooldown01 > 0;
      chargeGauge.setCooling(cooling);
      const canFireNow = s.canFire && !cooling;
      chargeGauge.setReady(canFireNow);
      if (canFireNow !== ready) {
        ready = canFireNow;
        readyEl.classList.toggle('is-on', canFireNow);
      }

      tacho.setNitro(s.nitro);
      tacho.setNitroActive(s.nitroActive);
      tacho.setNitroCharging(s.nitroRecharging);
      if (s.nitro <= 0.005 && !s.nitroRecharging && !s.nitroActive && s.speedKmh < 1) {
        if (s.time - lastDriveHint >= DRIVE_HINT_EVERY) {
          lastDriveHint = s.time;
          showNote(nitroNoteEl, 'DRIVE TO RECHARGE');
        }
      }

      if (s.drifting !== drifting) {
        drifting = s.drifting;
        driftEl.classList.toggle('is-on', s.drifting);
      }
      if (s.drifting) {
        const tenths = Math.min(999, Math.round(s.driftDuration * 10));
        if (tenths !== shownDriftTenths) {
          shownDriftTenths = tenths;
          driftTimeEl.textContent = `${(tenths / 10).toFixed(1)}s`;
        }
      }

      // The chain marker outlives the drift: it drains with the chain window so the
      // player can see how long they have to link the next one.
      if (s.chain !== shownChain) {
        shownChain = s.chain;
        chainValueEl.textContent = s.chain >= 2 ? `x${s.chain}` : '';
      }
      const chainLeft = s.chain < 2 ? 0 : s.drifting ? 1 : Math.min(1, s.chainWindow / CHAIN_FADE);
      const chainStep = Math.round(chainLeft * CHAIN_STEPS);
      if (chainStep !== shownChainStep) {
        shownChainStep = chainStep;
        const f = chainStep / CHAIN_STEPS;
        chainEl.style.opacity = f === 0 ? '0' : (0.35 + 0.65 * f).toFixed(2);
        chainBarEl.style.transform = `scaleX(${f.toFixed(2)})`;
      }

      // The aim meter is up while the shot charges, and the ON TARGET line alone while the
      // beam's line crosses a car. Charging, the bar reads out the reach the hold has bought
      // so far — that number is the whole skill of the gun, since nothing bends to a target.
      const charging = s.aim01 > 0;
      const showAim = charging || s.targetAcquired;
      if (showAim !== aimVisible) {
        aimVisible = showAim;
        aimEl.classList.toggle('is-on', showAim);
      }
      if (charging !== shownCharging) {
        shownCharging = charging;
        aimEl.classList.toggle('is-charging', charging);
      }
      // Full reach, still held: the meter has nothing left to say, so it says so and waits.
      const full = charging && s.aim01 >= 1;
      if (full !== shownFullCharge) {
        shownFullCharge = full;
        aimEl.classList.toggle('is-full', full);
      }
      // Full reach is its own step, so the readout lands on the real maximum rather than on
      // whatever the last quantised step rounded to.
      const aimStep = charging ? (full ? AIM_STEPS : Math.min(AIM_STEPS - 1, Math.floor(s.aim01 * AIM_STEPS))) : -1;
      if (aimStep !== shownAimStep) {
        shownAimStep = aimStep;
        if (aimStep < 0) {
          aimFillEl.style.transform = 'scaleX(0)';
          aimLabelEl.textContent = 'ON TARGET';
        } else {
          aimFillEl.style.transform = `scaleX(${(aimStep / AIM_STEPS).toFixed(2)})`;
          aimLabelEl.textContent = `${Math.round(s.aimRange)}M`;
        }
      }

      if (s.money !== shownMoney) {
        shownMoney = s.money;
        moneyDigitsEl.textContent = formatMoney(s.money);
      }
      if (s.destroyed !== shownDestroyed) {
        shownDestroyed = s.destroyed;
        destroyedEl.textContent = `destroyed ${s.destroyed}`;
      }
      if (s.nearMisses !== shownNearMisses) {
        shownNearMisses = s.nearMisses;
        nearEl.textContent = `near miss ${s.nearMisses}`;
      }
      // Read off sim time, not a timer, so it does not keep counting while the tab is asleep.
      if (nearMissOn && !(s.time - nearMissAt <= NEAR_MISS_HOLD)) clearNearMiss();
      if (s.targetsRemaining !== shownRemaining || s.targetsTotal !== shownTotal) {
        shownRemaining = s.targetsRemaining;
        shownTotal = s.targetsTotal;
        remainingEl.textContent = `targets left ${s.targetsRemaining} / ${s.targetsTotal}`;
      }
    },

    onEvent(e) {
      rush?.onEvent(e);
      passengers?.onEvent(e);
      buho?.onEvent(e);
      police?.onEvent(e);
      if (e.type === 'nearMiss') {
        showNearMiss(e.points);
      } else if (e.type === 'targetDestroyed') {
        const el = rewardEls[rewardIndex % rewardEls.length];
        rewardIndex++;
        if (el) {
          el.textContent = `+¥${formatMoney(e.reward)}`;
          play(
            el,
            [
              { opacity: 0, transform: 'translateY(6px)' },
              { opacity: 1, transform: 'translateY(-2px)', offset: 0.15 },
              { opacity: 1, transform: 'translateY(-12px)', offset: 0.65 },
              { opacity: 0, transform: 'translateY(-24px)' },
            ],
            1200,
          );
        }
        play(
          moneyValueEl,
          [
            { transform: 'scale(1)' },
            { transform: 'scale(1.09)', offset: 0.2 },
            { transform: 'scale(1)' },
          ],
          420,
        );
      } else if (e.type === 'lightningFired') {
        // A miss costs the same charge as a hit: say so, or the shot looks like a bug.
        if (e.targetId < 0) showNote(noteEl, 'MISS');
      } else if (e.type === 'lightningDenied') {
        if (e.reason === 'noCharge') showNote(noteEl, 'DRIFT TO CHARGE');
        else if (e.reason === 'noTarget') showNote(noteEl, 'NO TARGET');
        else if (e.reason === 'short') showNote(noteEl, 'HOLD E TO AIM');
        else showNote(noteEl, 'RECHARGING');
      } else if (e.type === 'raceCountdown') {
        showCountdown(String(e.seconds), false);
      } else if (e.type === 'raceStart') {
        showCountdown('GO', true);
      } else if (e.type === 'rushCountdown') {
        // The same big centred number a race grid counts down on, reused: `3 - 2 - 1` and then
        // the name of the thing, in the hot GO treatment.
        if (e.seconds > 0) showCountdown(String(e.seconds), false);
        else showCountdown('RAYO RUSH', true);
      } else if (e.type === 'timeAttackCrash') {
        // Said on the same line the splits are said on: it is a fact about the run's time, and
        // the player is looking there anyway. The one that spends the allowance shouts.
        showNote(
          raceSplitEl,
          e.fatal
            ? e.allowance > 0
              ? 'MISSION FAILED · CRASHES SPENT'
              : 'MISSION FAILED · CONTACT'
            : crashText(e.crashes, e.allowance),
        );
      } else if (e.type === 'streetRaceShortcut') {
        // Said where the splits are said: a fact about the lap, in the player's glance.
        if (e.shortcut >= 0) showNote(raceSplitEl, 'SHORTCUT');
      } else if (e.type === 'checkpoint') {
        showNote(raceSplitEl, `CHECKPOINT ${e.index} · ${formatRaceTime(e.split)}`);
      } else if (e.type === 'lapComplete') {
        showNote(raceSplitEl, `${e.best ? 'BEST LAP' : 'LAP'} ${formatRaceTime(e.time)}`);
        play(
          raceTimeEl,
          [
            { transform: 'scale(1)' },
            { transform: 'scale(1.12)', offset: 0.2 },
            { transform: 'scale(1)' },
          ],
          480,
        );
      } else if (e.type === 'transmission') {
        message.show(e.mode === 'manual' ? 'MANUAL' : 'AUTOMATIC', {
          sub: e.mode === 'manual' ? (padActive ? 'RB / LB TO SHIFT' : 'X / Z TO SHIFT') : 'THE BOX SHIFTS FOR YOU',
          tone: 'calm',
          duration: 1800,
        });
      } else if (e.type === 'restart') {
        controlsUntil = CONTROLS_REPLAY;
        lastDriveHint = -DRIVE_HINT_EVERY;
        lastFrameTime = -1;
        // Sim time rewinds here, so a tally left up would compare against a future timestamp
        // and never expire.
        clearNearMiss();
        tacho.reset(0);
        shownPhase = '';
        resultsEl.classList.remove('is-on');
        message.show('RESTART', { duration: 900 });
      }
    },

    dispose() {
      window.removeEventListener('gamepadconnected', onPadConnected);
      rush?.dispose();
      passengers?.dispose();
      buho?.dispose();
      gate?.dispose();
      street?.dispose();
      root.classList.remove('is-cruise-clean');
      message.dispose();
      tacho.dispose();
      wheels.dispose();
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
      root.innerHTML = '';
    },
  };
}
