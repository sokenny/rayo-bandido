import type { GameEvent, PassengerHudSnapshot } from '../core/types';
import { PASSENGER } from '../config/tuning';
import { portraitFor } from './portraits';

/**
 * The passenger's screen furniture: the pickup / drop-off prompt, the ride panel (portrait,
 * name, mood, the two rules and the destination), the subtitle strip, and the fare card.
 *
 * A HUD SUB-COMPONENT, built by `createHud` and composed like the RAYO RUSH overlay: the DOM is
 * built once, `update` writes only what changed, nothing reads geometry back, and flashes go
 * to the Web Animations API. The subtitles are driven by the SIMULATION's clock — a line is on
 * screen for exactly as long as `src/sim/passenger.ts` says it is — so this file never owns a
 * timer, and a stopped simulation stops the talking with it.
 *
 * THE LAYOUT, after the general shape of Cloudpunk's dialogue: a face in a compact panel that
 * stays up for the whole ride, the name over it, and a strip of readable text along the bottom
 * while a line is active. Adapted to this game's skin — the notched panel, mono for what the
 * machine states and display type for a name — in the chrome's violet, which is what the pin
 * on the road and the mark on the map are already painted in. The panel sits at the right
 * edge, mid-height, where nothing else lives; the strip sits low and centred, above the RUSH
 * prompt's spot and clear of the tacho. The portrait brightens while its owner is speaking.
 */
export interface PassengerOverlayOptions {
  onActivate(): void;
}

export interface PassengerOverlay {
  root: HTMLElement;
  update(p: PassengerHudSnapshot): void;
  onEvent(event: GameEvent): void;
  dispose(): void;
}

/** Steps the mood bar is quantised to, so it is written a few dozen times a ride, not per frame. */
const MOOD_STEPS = 50;
/** Milliseconds the mood delta pop stays up. */
const DELTA_LIFE = 1300;

const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

function pick<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Rayo Bandido passenger overlay: missing element "${selector}"`);
  return el as T;
}

/** `240` -> `240 m`, `1240` -> `1.2 km`. */
export function formatDistance(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.max(0, Math.round(metres / 10) * 10)} m`;
}

/** `1234` -> `1,234`. The same grouping the money counter uses. */
export function formatYen(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** The word under the mood bar. Five bands, so it reads as a mood and not as a percentage. */
export function moodLabel(mood: number): string {
  if (mood >= 85) return 'DELIGHTED';
  if (mood >= PASSENGER.mood.highTier) return 'HAPPY';
  if (mood >= PASSENGER.mood.mediumTier) return 'FINE';
  if (mood >= 20) return 'UNHAPPY';
  return 'FURIOUS';
}

export function createPassengerOverlay(options: PassengerOverlayOptions): PassengerOverlay {
  const root = document.createElement('div');
  root.className = 'rb-pax';
  root.innerHTML =
    // The prompt: pick up, or drop off. A real <button> so a tap works on a phone.
    `<button type="button" class="rb-pax__prompt">` +
    `<span class="rb-pax__prompt-title"></span>` +
    `<span class="rb-pax__prompt-sub"></span>` +
    `<span class="rb-pax__prompt-key"><span class="rb-key">F</span> <span class="rb-pax__prompt-verb">PICK UP</span></span>` +
    `</button>` +
    // The cancel arm: one press asked, a second ends the ride.
    `<div class="rb-pax__cancel">PRESS <span class="rb-key">F</span> AGAIN TO END THE RIDE · NO FARE</div>` +
    // The ride panel.
    `<div class="rb-pax__panel">` +
    `<div class="rb-pax__portrait"></div>` +
    `<div class="rb-pax__who"><b class="rb-pax__name"></b><span class="rb-pax__tag"></span></div>` +
    `<div class="rb-pax__mood">` +
    `<span class="rb-pax__mood-word">FINE</span>` +
    `<span class="rb-pax__mood-bar"><i></i></span>` +
    `<span class="rb-pax__mood-delta"></span>` +
    `</div>` +
    `<ul class="rb-pax__prefs"><li class="rb-pax__pref"></li><li class="rb-pax__pref"></li></ul>` +
    `<div class="rb-pax__dest"><span class="rb-pax__dest-to">TO</span><b class="rb-pax__dest-name"></b><span class="rb-pax__dest-dist"></span></div>` +
    `</div>` +
    // The subtitle strip.
    `<div class="rb-pax__subtitle"><span class="rb-pax__speaker"></span><span class="rb-pax__text"></span></div>` +
    // The fare card.
    `<div class="rb-pax__results">` +
    `<div class="rb-pax__results-head">RIDE COMPLETE</div>` +
    `<div class="rb-pax__results-total"><span class="rb-pax__results-yen">¥</span><span class="rb-pax__results-value">0</span></div>` +
    `<div class="rb-pax__results-mood"></div>` +
    `<dl class="rb-pax__results-rows">` +
    `<div><dt>FARE</dt><dd class="rb-pax__r-fare">0</dd></div>` +
    `<div><dt>TIP</dt><dd class="rb-pax__r-tip">0</dd></div>` +
    `<div><dt>MOOD</dt><dd class="rb-pax__r-mood">0</dd></div>` +
    `<div><dt>GOOD MOMENTS / BAD</dt><dd class="rb-pax__r-events">0 / 0</dd></div>` +
    `</dl>` +
    `<button type="button" class="rb-pax__dismiss"><span class="rb-key">F</span> BACK TO FREE ROAM</button>` +
    `</div>`;

  const promptEl = pick<HTMLButtonElement>(root, '.rb-pax__prompt');
  const promptTitleEl = pick<HTMLElement>(root, '.rb-pax__prompt-title');
  const promptSubEl = pick<HTMLElement>(root, '.rb-pax__prompt-sub');
  const promptVerbEl = pick<HTMLElement>(root, '.rb-pax__prompt-verb');
  const cancelEl = pick<HTMLElement>(root, '.rb-pax__cancel');
  const panelEl = pick<HTMLElement>(root, '.rb-pax__panel');
  const portraitEl = pick<HTMLElement>(root, '.rb-pax__portrait');
  const nameEl = pick<HTMLElement>(root, '.rb-pax__name');
  const tagEl = pick<HTMLElement>(root, '.rb-pax__tag');
  const moodWordEl = pick<HTMLElement>(root, '.rb-pax__mood-word');
  const moodBarEl = pick<HTMLElement>(root, '.rb-pax__mood-bar i');
  const moodDeltaEl = pick<HTMLElement>(root, '.rb-pax__mood-delta');
  const prefEls = Array.from(root.querySelectorAll<HTMLElement>('.rb-pax__pref'));
  const destNameEl = pick<HTMLElement>(root, '.rb-pax__dest-name');
  const destDistEl = pick<HTMLElement>(root, '.rb-pax__dest-dist');
  const subtitleEl = pick<HTMLElement>(root, '.rb-pax__subtitle');
  const speakerEl = pick<HTMLElement>(root, '.rb-pax__speaker');
  const textEl = pick<HTMLElement>(root, '.rb-pax__text');
  const resultsEl = pick<HTMLElement>(root, '.rb-pax__results');
  const resultsHeadEl = pick<HTMLElement>(root, '.rb-pax__results-head');
  const resultsValueEl = pick<HTMLElement>(root, '.rb-pax__results-value');
  const resultsMoodEl = pick<HTMLElement>(root, '.rb-pax__results-mood');
  const rFareEl = pick<HTMLElement>(root, '.rb-pax__r-fare');
  const rTipEl = pick<HTMLElement>(root, '.rb-pax__r-tip');
  const rMoodEl = pick<HTMLElement>(root, '.rb-pax__r-mood');
  const rEventsEl = pick<HTMLElement>(root, '.rb-pax__r-events');
  const dismissEl = pick<HTMLButtonElement>(root, '.rb-pax__dismiss');

  const onClick = (e: Event): void => {
    e.preventDefault();
    options.onActivate();
  };
  promptEl.addEventListener('click', onClick);
  dismissEl.addEventListener('click', onClick);

  // Displayed-value cache. Sentinels guarantee a first write for every field.
  let shownPhase = '';
  let shownPrompt: 'none' | 'board' | 'drop' = 'none';
  let shownPromptWho = '';
  let shownCancel = false;
  let shownPassenger = '';
  let shownMoodStep = -1;
  let shownMoodWord = '';
  let shownDest = '';
  let shownDist = -1;
  let shownLineId = -1;
  let shownResults: object | null = null;
  const shownPrefs = ['', ''];
  const shownPrefStatus = ['', ''];

  const animations = new Map<Element, Animation>();
  function play(el: Element, keyframes: Keyframe[], duration: number): void {
    if (!canAnimate) return;
    const previous = animations.get(el);
    if (previous) previous.cancel();
    animations.set(el, el.animate(keyframes, { duration, easing: 'ease-out' }));
  }

  return {
    root,

    update(p) {
      /* ------------------------------------------------------------ phase */

      if (p.phase !== shownPhase) {
        shownPhase = p.phase;
        const riding = p.phase === 'riding';
        panelEl.classList.toggle('is-on', riding || p.phase === 'results');
        resultsEl.classList.toggle('is-on', p.phase === 'results');
        if (!riding) {
          cancelEl.classList.remove('is-on');
          shownCancel = false;
        }
        if (p.phase === 'idle') {
          // Nothing of the last ride survives into free roam: the strip, the card, the face.
          subtitleEl.classList.remove('is-on');
          portraitEl.classList.remove('is-talking');
          shownLineId = -1;
          shownResults = null;
        }
      }

      /* ------------------------------------------------------------ who */

      if (p.passengerId !== shownPassenger) {
        shownPassenger = p.passengerId;
        if (p.passengerId) {
          portraitEl.innerHTML = portraitFor(p.portrait);
          nameEl.textContent = p.name.toUpperCase();
          tagEl.textContent = p.tagline;
          speakerEl.textContent = p.name.toUpperCase();
          for (let i = 0; i < prefEls.length; i++) {
            const label = p.prefLabels[i] ?? '';
            shownPrefs[i] = label;
            shownPrefStatus[i] = '';
            prefEls[i].textContent = label;
            prefEls[i].hidden = label === '';
          }
          shownMoodStep = -1;
          shownMoodWord = '';
          shownDest = '';
          shownDist = -1;
        }
      }

      /* ------------------------------------------------------------ the prompt */

      const prompt = p.canBoard ? 'board' : p.canDropOff ? 'drop' : 'none';
      if (prompt !== shownPrompt || (prompt !== 'none' && p.name !== shownPromptWho)) {
        shownPrompt = prompt;
        shownPromptWho = p.name;
        promptEl.classList.toggle('is-on', prompt !== 'none');
        if (prompt === 'board') {
          promptTitleEl.textContent = `${p.name.toUpperCase()} NEEDS A RIDE`;
          promptSubEl.textContent = `${p.tagline} · TO ${p.destinationLabel} · FARE ¥${formatYen(p.fare)}`;
          promptVerbEl.textContent = 'PICK UP';
        } else if (prompt === 'drop') {
          promptTitleEl.textContent = p.destinationLabel;
          promptSubEl.textContent = `DROP ${p.name.toUpperCase()} OFF HERE`;
          promptVerbEl.textContent = 'DROP OFF';
        }
        if (prompt !== 'none') {
          play(
            promptEl,
            [
              { opacity: 0, transform: 'translate(-50%, 10px)' },
              { opacity: 1, transform: 'translate(-50%, 0)' },
            ],
            260,
          );
        }
      }
      const cancelOn = p.phase === 'riding' && p.cancelArm > 0;
      if (cancelOn !== shownCancel) {
        shownCancel = cancelOn;
        cancelEl.classList.toggle('is-on', cancelOn);
      }

      /* ------------------------------------------------------------ the ride panel */

      if (p.phase === 'riding' || p.phase === 'results') {
        const step = Math.round((p.mood / 100) * MOOD_STEPS);
        if (step !== shownMoodStep) {
          shownMoodStep = step;
          moodBarEl.style.transform = `scaleX(${step / MOOD_STEPS})`;
        }
        const word = moodLabel(p.mood);
        if (word !== shownMoodWord) {
          shownMoodWord = word;
          moodWordEl.textContent = word;
          moodWordEl.dataset.mood = word.toLowerCase();
        }
        for (let i = 0; i < prefEls.length; i++) {
          const status = p.prefStatus[i] ?? 'neutral';
          if (status !== shownPrefStatus[i]) {
            shownPrefStatus[i] = status;
            prefEls[i].dataset.status = status;
          }
        }
        if (p.destinationLabel !== shownDest) {
          shownDest = p.destinationLabel;
          destNameEl.textContent = p.destinationLabel;
        }
        const dist = Math.round(p.distance / 10) * 10;
        if (dist !== shownDist) {
          shownDist = dist;
          destDistEl.textContent = formatDistance(dist);
        }
      }

      /* ------------------------------------------------------------ the subtitle */

      if (p.lineId !== shownLineId) {
        shownLineId = p.lineId;
        const on = p.line !== '';
        subtitleEl.classList.toggle('is-on', on);
        portraitEl.classList.toggle('is-talking', on);
        if (on) {
          textEl.textContent = p.line;
          play(
            subtitleEl,
            [
              { opacity: 0, transform: 'translate(-50%, 6px)' },
              { opacity: 1, transform: 'translate(-50%, 0)' },
            ],
            180,
          );
        }
      } else if (p.line === '' && subtitleEl.classList.contains('is-on')) {
        // The line's time ran out with no new one behind it.
        subtitleEl.classList.remove('is-on');
        portraitEl.classList.remove('is-talking');
      }

      /* ------------------------------------------------------------ the fare card */

      const results = p.results;
      if (results && results !== shownResults) {
        shownResults = results;
        resultsHeadEl.textContent = `RIDE COMPLETE · ${results.passengerName.toUpperCase()}`;
        resultsValueEl.textContent = formatYen(results.fare + results.tip);
        resultsMoodEl.textContent = results.tier === 'high' ? 'A GREAT RIDE' : results.tier === 'medium' ? 'A FAIR RIDE' : 'A BAD RIDE';
        resultsMoodEl.dataset.tier = results.tier;
        rFareEl.textContent = `¥${formatYen(results.fare)}`;
        rTipEl.textContent = results.tip > 0 ? `+¥${formatYen(results.tip)}` : 'NOTHING';
        rMoodEl.textContent = `${results.mood} / 100 · ${moodLabel(results.mood)}`;
        rEventsEl.textContent = `${results.bonuses} / ${results.penalties}`;
        play(
          resultsEl,
          [
            { opacity: 0, transform: 'translate(-50%, -50%) scale(0.94)' },
            { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
          ],
          320,
        );
      }
    },

    onEvent(event) {
      switch (event.type) {
        case 'passengerMood': {
          // The step, over the bar, in the colour of its sign — then gone.
          const up = event.delta > 0;
          moodDeltaEl.textContent = `${up ? '+' : '−'}${Math.round(Math.abs(event.delta))}`;
          moodDeltaEl.classList.toggle('is-up', up);
          moodDeltaEl.classList.toggle('is-down', !up);
          play(
            moodDeltaEl,
            [
              { opacity: 0, transform: 'translateY(4px)' },
              { opacity: 1, transform: 'translateY(0)', offset: 0.15 },
              { opacity: 1, transform: 'translateY(-4px)', offset: 0.7 },
              { opacity: 0, transform: 'translateY(-10px)' },
            ],
            DELTA_LIFE,
          );
          play(
            portraitEl,
            [
              { transform: 'scale(1)' },
              { transform: up ? 'scale(1.06)' : 'translateX(-3px)', offset: 0.3 },
              { transform: 'scale(1)' },
            ],
            360,
          );
          break;
        }
        case 'passengerBoard':
          // A fresh ride: the caches are cleared so the first frame writes everything.
          shownMoodStep = -1;
          shownMoodWord = '';
          shownLineId = -1;
          shownResults = null;
          play(
            panelEl,
            [
              { opacity: 0, transform: 'translateX(16px)' },
              { opacity: 1, transform: 'translateX(0)' },
            ],
            320,
          );
          break;
        case 'passengerCancel':
        case 'passengerDismissed':
        case 'restart':
          shownResults = null;
          shownLineId = -1;
          shownPassenger = '';
          subtitleEl.classList.remove('is-on');
          portraitEl.classList.remove('is-talking');
          panelEl.classList.remove('is-on');
          resultsEl.classList.remove('is-on');
          cancelEl.classList.remove('is-on');
          shownCancel = false;
          shownPhase = '';
          break;
        default:
          break;
      }
    },

    dispose() {
      promptEl.removeEventListener('click', onClick);
      dismissEl.removeEventListener('click', onClick);
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
      root.remove();
    },
  };
}
