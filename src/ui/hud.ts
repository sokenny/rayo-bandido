import type { GameEvent, GameMode, HudSnapshot, RaceHudSnapshot } from '../core/types';
import { BOLT_ICON, FLAME_ICON, RETICLE_ICON } from './icons';
import { createRingGauge } from './ringGauge';

/**
 * Floating DOM HUD. Receives a `HudSnapshot` every render frame and discrete `GameEvent`s
 * for transient flashes (reward, denied shot, restart).
 *
 * Direction: "interfaz mínima y flotante" (docs/VISUAL_DIRECTION.md). Nothing is boxed into a
 * chrome frame; every element floats in a screen corner over the scene. Lightning is
 * cyan/blue-white, nitro is magenta/violet, money is a yen counter. Original layout only.
 *
 * Reading order the HUD teaches, without a tutorial:
 *   drift (left) -> charges the bolt ring (bottom-left) -> READY -> E destroys the locked
 *   target (centre reticle) -> money goes up (top-right). The chain multiplier survives the
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

/** Same card, pad labels, shown instead of the keys once a controller is plugged in. */
const PAD_CONTROLS = [
  ['RT/LT', 'drive'],
  ['STICK', 'steer'],
  ['LB', 'handbrake'],
  ['RB', 'nitro'],
  ['X', 'lightning'],
  ['START', 'restart'],
  ['Y', 'cruise'],
  ['VIEW', 'camera'],
];

const CONTROLS = [
  ['WASD', 'drive'],
  ['SPACE', 'handbrake'],
  ['SHIFT', 'nitro'],
  ['E', 'lightning'],
  ['R', 'restart'],
  ['C', 'cruise'],
  ['P', 'camera'],
  ['ESC', 'menu'],
  ['F3', 'debug'],
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

export function createHud(root: HTMLElement, mode: GameMode = 'test', multiplayer = false): Hud {
  root.innerHTML = '';

  const hud = document.createElement('div');
  hud.className = `rb-hud${mode === 'race' ? ' is-race' : ''}`;
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
    `<div class="rb-reticle">${RETICLE_ICON}<span class="rb-reticle__label">TARGET LOCKED</span></div>` +
    `<div class="rb-banner">RESTART</div>` +
    `<div class="rb-cruise"><span class="rb-cruise__dot"></span>CRUISE</div>` +
    `<div class="rb-race">` +
    `<div class="rb-race__lap"><span class="rb-race__lap-label">LAP</span><span class="rb-race__lap-value">1/2</span></div>` +
    `<div class="rb-race__time">0:00.00</div>` +
    `<div class="rb-race__laps"><span class="rb-race__last">LAST --:--.--</span><span class="rb-race__best">BEST --:--.--</span></div>` +
    `<div class="rb-race__split"></div>` +
    `</div>` +
    `<div class="rb-countdown"></div>` +
    `<div class="rb-wrongway">WRONG WAY</div>` +
    `<div class="rb-results">` +
    `<div class="rb-results__title">FINISH</div>` +
    `<div class="rb-results__time">0:00.00</div>` +
    `<div class="rb-results__meta"></div>` +
    `<div class="rb-results__keys"><span class="rb-key">R</span> race again <span class="rb-key">ESC</span> menu</div>` +
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
    `<div class="rb-stack rb-stack--right">` +
    `<div class="rb-note rb-note--nitro"></div>` +
    `<div class="rb-slot"></div>` +
    `<div class="rb-keys"><span class="rb-key rb-key--nitro">SHIFT</span><span class="rb-keys__name">nitro</span></div>` +
    `</div>` +
    `<div class="rb-speed"><span class="rb-speed__rev">R</span>` +
    `<span class="rb-speed__value">0</span><span class="rb-speed__unit">km/h</span></div>`;
  root.appendChild(hud);

  const chargeGauge = createRingGauge({ variant: 'rb-gauge--charge', icon: BOLT_ICON, secondaryArc: true });
  const nitroGauge = createRingGauge({ variant: 'rb-gauge--nitro', icon: FLAME_ICON, chargingBadge: true });
  pick<HTMLElement>(hud, '.rb-stack--left .rb-slot').appendChild(chargeGauge.root);
  pick<HTMLElement>(hud, '.rb-stack--right .rb-slot').appendChild(nitroGauge.root);

  const controlsEl = pick<HTMLElement>(hud, '.rb-controls');
  const fireKeyEl = pick<HTMLElement>(hud, '.rb-key--fire');
  const nitroKeyEl = pick<HTMLElement>(hud, '.rb-key--nitro');
  // A pad only becomes visible to the page once it is used, so the card starts on the keys and
  // swaps the moment the player touches a controller.
  const showPadControls = (): void => {
    controlsEl.innerHTML = controlsFor(PAD_CONTROLS);
    // The two gauges carry their own key hint; they name the pad button too.
    for (const [el, label] of [[fireKeyEl, 'X'], [nitroKeyEl, 'RB']] as const) el.textContent = label;
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
  const reticleEl = pick<HTMLElement>(hud, '.rb-reticle');
  const bannerEl = pick<HTMLElement>(hud, '.rb-banner');
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
  const raceEl = pick<HTMLElement>(hud, '.rb-race');
  const raceLapEl = pick<HTMLElement>(hud, '.rb-race__lap-value');
  const raceTimeEl = pick<HTMLElement>(hud, '.rb-race__time');
  const raceLastEl = pick<HTMLElement>(hud, '.rb-race__last');
  const raceBestEl = pick<HTMLElement>(hud, '.rb-race__best');
  const raceSplitEl = pick<HTMLElement>(hud, '.rb-race__split');
  const countdownEl = pick<HTMLElement>(hud, '.rb-countdown');
  const wrongWayEl = pick<HTMLElement>(hud, '.rb-wrongway');
  const resultsEl = pick<HTMLElement>(hud, '.rb-results');
  const resultsTimeEl = pick<HTMLElement>(hud, '.rb-results__time');
  const resultsMetaEl = pick<HTMLElement>(hud, '.rb-results__meta');

  // Displayed-value cache. Sentinels guarantee a first write for every field.
  let shownSpeed = -1;
  let shownMoney = -1;
  let shownDestroyed = -1;
  let shownNearMisses = -1;
  let shownRemaining = -1;
  let shownTotal = -1;
  let shownDriftTenths = -1;
  let shownChain = -1;
  let shownChainStep = -1;
  let drifting = false;
  let locked = false;
  let ready = false;
  let reversing = false;
  let controlsVisible = true;
  let cruising = false;
  let controlsUntil = CONTROLS_INTRO;
  let rewardIndex = 0;
  let lastDriveHint = -DRIVE_HINT_EVERY;
  // Race readout cache.
  let shownLap = -1;
  let shownLaps = -1;
  let shownCentis = -1;
  let shownLastLap = -2;
  let shownBestLap = -2;
  let shownPhase = '';
  let wrongWay = false;

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

  function updateRace(r: RaceHudSnapshot): void {
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
      if (r.phase === 'finished') {
        resultsTimeEl.textContent = formatRaceTime(r.finishTime);
        resultsMetaEl.textContent = `${r.laps} LAPS · BEST LAP ${formatRaceTime(r.bestLap)}`;
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
      if (s.race) updateRace(s.race);

      if (s.cruising !== cruising) {
        cruising = s.cruising;
        cruiseEl.classList.toggle('is-on', s.cruising);
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

      nitroGauge.setValue(s.nitro);
      nitroGauge.setActive(s.nitroActive);
      nitroGauge.setCharging(s.nitroRecharging);
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

      if (s.targetAcquired !== locked) {
        locked = s.targetAcquired;
        reticleEl.classList.toggle('is-on', s.targetAcquired);
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
      if (s.targetsRemaining !== shownRemaining || s.targetsTotal !== shownTotal) {
        shownRemaining = s.targetsRemaining;
        shownTotal = s.targetsTotal;
        remainingEl.textContent = `targets left ${s.targetsRemaining} / ${s.targetsTotal}`;
      }
    },

    onEvent(e) {
      if (e.type === 'nearMiss') {
        // Shares the money flash column with kill rewards, but cyan, labelled, and drifting
        // DOWN instead of up: passes are frequent, and rising past the counters the way a
        // kill does would keep covering them.
        const el = rewardEls[rewardIndex % rewardEls.length];
        rewardIndex++;
        if (el) {
          el.textContent = `NEAR MISS +¥${formatMoney(e.points)}`;
          el.classList.add('rb-reward--near');
          play(
            el,
            [
              { opacity: 0, transform: 'translateY(-4px)' },
              { opacity: 1, transform: 'translateY(2px)', offset: 0.15 },
              { opacity: 1, transform: 'translateY(10px)', offset: 0.65 },
              { opacity: 0, transform: 'translateY(20px)' },
            ],
            1100,
          );
        }
      } else if (e.type === 'targetDestroyed') {
        const el = rewardEls[rewardIndex % rewardEls.length];
        rewardIndex++;
        if (el) {
          el.textContent = `+¥${formatMoney(e.reward)}`;
          el.classList.remove('rb-reward--near');
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
      } else if (e.type === 'lightningDenied') {
        if (e.reason === 'noCharge') showNote(noteEl, 'DRIFT TO CHARGE');
        else if (e.reason === 'noTarget') showNote(noteEl, 'NO TARGET');
        else showNote(noteEl, 'RECHARGING');
      } else if (e.type === 'raceCountdown') {
        showCountdown(String(e.seconds), false);
      } else if (e.type === 'raceStart') {
        showCountdown('GO', true);
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
      } else if (e.type === 'restart') {
        controlsUntil = CONTROLS_REPLAY;
        lastDriveHint = -DRIVE_HINT_EVERY;
        shownPhase = '';
        resultsEl.classList.remove('is-on');
        play(
          bannerEl,
          [
            { opacity: 0, letterSpacing: '0.6em' },
            { opacity: 1, letterSpacing: '0.34em', offset: 0.18 },
            { opacity: 1, letterSpacing: '0.34em', offset: 0.55 },
            { opacity: 0, letterSpacing: '0.44em' },
          ],
          900,
        );
      }
    },

    dispose() {
      window.removeEventListener('gamepadconnected', onPadConnected);
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
      root.innerHTML = '';
    },
  };
}
