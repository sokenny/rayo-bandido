import type { GameEvent, RushHudSnapshot } from '../core/types';
import { RUSH } from '../config/tuning';

/**
 * RAYO RUSH's screen furniture: the marker prompt, the live readout, the kill feed and the
 * results card.
 *
 * A HUD SUB-COMPONENT, not a second HUD. It is built by `createHud` and composed into the same
 * tree as the tacho, the charge gauge and the wheel indicator, and it lives under the same
 * contract as all of them: the DOM is built once, `update` only ever writes values that
 * actually changed, nothing here reads geometry back (so it cannot force a synchronous
 * layout), and transient flashes are handed to the Web Animations API rather than to a
 * per-frame timer. The count-in is not here at all — that is the race countdown's own element,
 * reused, because a big number in the middle of the screen is a thing this game already has.
 *
 * SKIN. The house style of `src/styles.css`: hazard yellow is the system talking, the notched
 * corner is on every surface, condensed display type for anything shouted and mono for
 * anything the machine is stating. The activity is the system talking to the player, so it is
 * yellow throughout, and the game's own cyan/magenta/acid are left to the game.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: cover the road. The prompt sits low, the readout sits in
 * the top-left gutter beside the money, the feed runs up the left edge, and only the results
 * card — shown when the driving no longer matters — takes the middle of the screen.
 */
/**
 * How the overlay reaches the simulation. Both buttons raise the same intent the F key does
 * (`PlayerCommand.activate`), because in the rules taking a run up and putting the card away
 * are the same one button — so the mouse and the thumb get exactly what the keyboard gets.
 */
export interface RushOverlayOptions {
  onActivate(): void;
}

export interface RushOverlay {
  root: HTMLElement;
  update(rush: RushHudSnapshot): void;
  onEvent(event: GameEvent): void;
  dispose(): void;
}

/** Feed rows kept in the pool. Four is more than reads at a glance while driving. */
const FEED_SLOTS = 4;
/** Milliseconds a feed row stays up. */
const FEED_LIFE = 1500;
/** Steps the streak drain bar is quantised to, so it is written ~20 times a window, not 300. */
const CHAIN_STEPS = 20;

const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

/** `95.4` -> `1:35`. The rush clock is read at a glance, so it stops at whole seconds. */
export function formatRushClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** `1` -> `x1`, `2.5` -> `x2.5`. Trailing `.0` is dropped: `x3`, not `x3.0`. */
export function formatMultiplier(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `x${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}`;
}

/** `12400` -> `12,400`. Only called when the value on screen actually changed. */
export function formatScore(value: number): string {
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

/**
 * How the prompt says what is left today. Spelled out rather than a bare number, because
 * "0 RANKED ATTEMPTS LEFT" has to read as "you can still play, it just will not count".
 */
export function attemptsLabel(left: number, total: number): string {
  if (left < 0) return `RANKED ATTEMPTS · CHECKING`;
  if (left === 0) return `NO RANKED ATTEMPTS LEFT TODAY · PRACTICE RUN`;
  return `RANKED ATTEMPTS TODAY · ${left}/${total}`;
}

/**
 * The mission strip on the prompt: which of the chain this is and what the street is called.
 *
 * Once the chain is finished there is no mission left to name, and saying "MISSION 3 / 3"
 * forever would read as a counter stuck rather than as an achievement — so it becomes the
 * achievement, and the run underneath goes on being a run.
 */
export function missionLabel(level: number, count: number, place: string, allClear: boolean): string {
  if (allClear) return place ? `ALL MISSIONS CLEAR · ${place}` : 'ALL MISSIONS CLEAR';
  const numbered = `MISSION ${level + 1} / ${count}`;
  return place ? `${numbered} · ${place}` : numbered;
}

/**
 * What the prompt says the run is for. A target while there is one to hit; once the chain is
 * done the activity has not stopped being worth driving, it has just stopped gating anything,
 * and the sign should say so rather than dangling a number that has already been beaten.
 */
export function targetLabel(target: number, allClear: boolean): string {
  if (allClear) return 'FREE RUN · SCORE GOES TO THE GLOBAL BOARD';
  return `CLEAR IT WITH ${formatScore(target)} PTS`;
}

function pick<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Rayo Bandido rush overlay: missing element "${selector}"`);
  return el as T;
}

export function createRushOverlay(options: RushOverlayOptions): RushOverlay {
  const root = document.createElement('div');
  root.className = 'rb-rush';
  root.innerHTML =
    // The marker prompt. A real <button> so a tap on a phone activates the run rather than
    // firing the lightning — `src/core/input/keyboard.ts` steps around controls on purpose.
    `<button type="button" class="rb-rush__prompt">` +
    `<span class="rb-rush__prompt-title">RAYO RUSH</span>` +
    // Which of the three this is, and what the street is called. The mission is the first
    // thing read after the name, because it is what has changed since the player was last here.
    `<span class="rb-rush__prompt-mission"></span>` +
    `<span class="rb-rush__prompt-lines">` +
    `<span><b></b> ON THE CLOCK</span>` +
    `<span>DISABLE EVERY EV YOU CAN WITH THE RAYO</span>` +
    `<span class="rb-rush__prompt-target"></span>` +
    `</span>` +
    `<span class="rb-rush__prompt-attempts">RANKED ATTEMPTS · CHECKING</span>` +
    `<span class="rb-rush__prompt-key"><span class="rb-key">F</span> START</span>` +
    `</button>` +
    // The live readout: clock, score, streak.
    `<div class="rb-rush__live">` +
    `<div class="rb-rush__clock"></div>` +
    `<div class="rb-rush__score"><span class="rb-rush__score-value">0</span><span class="rb-rush__score-unit">PTS</span></div>` +
    // The bar the run has to clear, under the score it is being compared with — so "am I
    // going to make it" is one glance rather than a sum.
    `<div class="rb-rush__target"><span class="rb-rush__target-label">TARGET</span><span class="rb-rush__target-value">—</span></div>` +
    `<div class="rb-rush__streak"><span class="rb-rush__streak-value">x1</span><span class="rb-rush__streak-bar"></span></div>` +
    `</div>` +
    // The kill feed.
    `<div class="rb-rush__feed">${'<span class="rb-rush__line"></span>'.repeat(FEED_SLOTS)}</div>` +
    // The results card.
    `<div class="rb-rush__results">` +
    `<div class="rb-rush__results-head">RAYO RUSH · TIME</div>` +
    `<div class="rb-rush__results-score">0</div>` +
    // The verdict: whether the mission fell, and what that means for where the player goes
    // next. Above the personal best, because a mission is the thing they were trying to do
    // and a best is the thing they were trying to do it well.
    `<div class="rb-rush__results-mission"><b></b><span></span></div>` +
    `<div class="rb-rush__results-best"></div>` +
    `<dl class="rb-rush__results-rows">` +
    `<div><dt>TARGET</dt><dd class="rb-rush__r-target">0</dd></div>` +
    `<div><dt>EVs DISABLED</dt><dd class="rb-rush__r-disabled">0</dd></div>` +
    `<div><dt>BEST CHAIN</dt><dd class="rb-rush__r-chain">x1</dd></div>` +
    `<div><dt>DRIFT / STYLE BONUS</dt><dd class="rb-rush__r-style">0</dd></div>` +
    `<div><dt>PREVIOUS BEST</dt><dd class="rb-rush__r-prev">—</dd></div>` +
    `</dl>` +
    `<button type="button" class="rb-rush__dismiss"><span class="rb-key">F</span> BACK TO FREE ROAM</button>` +
    `</div>`;

  const promptEl = pick<HTMLButtonElement>(root, '.rb-rush__prompt');
  const promptAttemptsEl = pick<HTMLElement>(root, '.rb-rush__prompt-attempts');
  const promptMissionEl = pick<HTMLElement>(root, '.rb-rush__prompt-mission');
  const promptTargetEl = pick<HTMLElement>(root, '.rb-rush__prompt-target');
  const promptDurationEl = pick<HTMLElement>(root, '.rb-rush__prompt-lines b');
  const liveEl = pick<HTMLElement>(root, '.rb-rush__live');
  const clockEl = pick<HTMLElement>(root, '.rb-rush__clock');
  const scoreEl = pick<HTMLElement>(root, '.rb-rush__score-value');
  const streakEl = pick<HTMLElement>(root, '.rb-rush__streak');
  const streakValueEl = pick<HTMLElement>(root, '.rb-rush__streak-value');
  const streakBarEl = pick<HTMLElement>(root, '.rb-rush__streak-bar');
  const targetEl = pick<HTMLElement>(root, '.rb-rush__target');
  const targetValueEl = pick<HTMLElement>(root, '.rb-rush__target-value');
  const feedEls = Array.from(root.querySelectorAll<HTMLElement>('.rb-rush__line'));
  const resultsEl = pick<HTMLElement>(root, '.rb-rush__results');
  const resultsHeadEl = pick<HTMLElement>(root, '.rb-rush__results-head');
  const resultsScoreEl = pick<HTMLElement>(root, '.rb-rush__results-score');
  const resultsBestEl = pick<HTMLElement>(root, '.rb-rush__results-best');
  const resultsMissionEl = pick<HTMLElement>(root, '.rb-rush__results-mission');
  const resultsMissionHeadEl = pick<HTMLElement>(root, '.rb-rush__results-mission b');
  const resultsMissionNextEl = pick<HTMLElement>(root, '.rb-rush__results-mission span');
  const rTargetEl = pick<HTMLElement>(root, '.rb-rush__r-target');
  const rDisabledEl = pick<HTMLElement>(root, '.rb-rush__r-disabled');
  const rChainEl = pick<HTMLElement>(root, '.rb-rush__r-chain');
  const rStyleEl = pick<HTMLElement>(root, '.rb-rush__r-style');
  const rPrevEl = pick<HTMLElement>(root, '.rb-rush__r-prev');
  const dismissEl = pick<HTMLButtonElement>(root, '.rb-rush__dismiss');

  // Both places the run's length appears are filled from the tuned value rather than typed in,
  // so changing `RUSH.durationSeconds` changes what the sign promises and what the clock starts
  // at, and there is no second copy of the number to go stale.
  promptDurationEl.textContent = formatRushClock(RUSH.durationSeconds);
  clockEl.textContent = formatRushClock(RUSH.durationSeconds);

  const onClick = (e: Event): void => {
    e.preventDefault();
    options.onActivate();
  };
  promptEl.addEventListener('click', onClick);
  dismissEl.addEventListener('click', onClick);

  // Displayed-value cache. Sentinels guarantee a first write for every field.
  let shownPhase = '';
  let shownPrompt = false;
  let shownAttempts = -2;
  let shownSeconds = -1;
  let shownScore = -1;
  let shownMultiplier = -1;
  let shownChainStep = -1;
  let shownResults = -1;
  let shownMission = '';
  let shownTarget = -1;
  let shownPassed = false;
  let feedIndex = 0;

  const animations = new Map<Element, Animation>();

  function play(el: Element, keyframes: Keyframe[], duration: number): void {
    if (!canAnimate) return;
    const previous = animations.get(el);
    if (previous) previous.cancel();
    const animation = el.animate(keyframes, { duration, easing: 'ease-out' });
    animations.set(el, animation);
  }

  /** One line of the kill feed, in the next pool slot. */
  function pushLine(text: string, tone: 'score' | 'chain' | 'style'): void {
    const el = feedEls[feedIndex];
    feedIndex = (feedIndex + 1) % feedEls.length;
    el.textContent = text;
    el.className = `rb-rush__line is-${tone}`;
    play(
      el,
      [
        { opacity: 0, transform: 'translateX(-10px)' },
        { opacity: 1, transform: 'translateX(0)', offset: 0.1 },
        { opacity: 1, transform: 'translateX(0)', offset: 0.68 },
        { opacity: 0, transform: 'translateX(0)' },
      ],
      FEED_LIFE,
    );
  }

  return {
    root,

    update(rush) {
      /* ------------------------------------------------------------ phase */

      if (rush.phase !== shownPhase) {
        shownPhase = rush.phase;
        root.classList.toggle('is-running', rush.phase === 'running');
        liveEl.classList.toggle('is-on', rush.phase === 'running' || rush.phase === 'countdown');
        resultsEl.classList.toggle('is-on', rush.phase === 'results');
      }

      /* ------------------------------------------------------------ the prompt */

      // What the marker is actually offering, not merely where the car is: a prompt that does
      // nothing when pressed is worse than no prompt.
      const promptOn = rush.canStart;
      if (promptOn !== shownPrompt) {
        shownPrompt = promptOn;
        promptEl.classList.toggle('is-on', promptOn);
        if (promptOn) {
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
      if (promptOn && rush.attemptsLeft !== shownAttempts) {
        shownAttempts = rush.attemptsLeft;
        promptAttemptsEl.textContent = attemptsLabel(rush.attemptsLeft, RUSH.dailyRankedAttempts);
        promptAttemptsEl.classList.toggle('is-spent', rush.attemptsLeft === 0);
      }
      // Which mission is on offer here. Cached on the rendered STRING rather than on the level
      // number: the same mission can be re-offered at the same site with nothing to rewrite,
      // and the one case that must rewrite — the chain moving on — changes the string.
      if (promptOn) {
        const mission = missionLabel(rush.level, rush.levelCount, rush.levelLabel, rush.allClear);
        if (mission !== shownMission) {
          shownMission = mission;
          promptMissionEl.textContent = mission;
          promptMissionEl.classList.toggle('is-clear', rush.allClear);
          promptTargetEl.textContent = targetLabel(rush.targetScore, rush.allClear);
        }
      }

      /* ------------------------------------------------------------ the readout */

      if (rush.phase === 'running' || rush.phase === 'countdown') {
        const seconds = Math.ceil(rush.phase === 'countdown' ? RUSH.durationSeconds : rush.timeLeft);
        if (seconds !== shownSeconds) {
          shownSeconds = seconds;
          clockEl.textContent = formatRushClock(seconds);
          // The last ten seconds go red and tick: the clock is the pressure.
          clockEl.classList.toggle('is-urgent', seconds <= 10 && rush.phase === 'running');
        }
        if (rush.score !== shownScore) {
          shownScore = rush.score;
          scoreEl.textContent = formatScore(rush.score);
        }
        if (rush.multiplier !== shownMultiplier) {
          shownMultiplier = rush.multiplier;
          streakValueEl.textContent = formatMultiplier(rush.multiplier);
          streakEl.classList.toggle('is-on', rush.multiplier > 1);
        }
        // The drain bar is the only thing that would otherwise be written every frame.
        const step = Math.round(rush.chainFraction * CHAIN_STEPS);
        if (step !== shownChainStep) {
          shownChainStep = step;
          streakBarEl.style.transform = `scaleX(${step / CHAIN_STEPS})`;
        }
        // The bar to clear, and whether it has been cleared yet. On a free run there is no bar,
        // so the line is not shown at all rather than shown saying nothing.
        if (rush.targetScore !== shownTarget) {
          shownTarget = rush.targetScore;
          targetValueEl.textContent = formatScore(rush.targetScore);
        }
        const passed = !rush.allClear && rush.score >= rush.targetScore;
        if (passed !== shownPassed) {
          shownPassed = passed;
          targetEl.classList.toggle('is-passed', passed);
          // Crossing the line mid-run is the one moment in a run worth a flash of its own:
          // everything after it is bonus, and the player should know the instant it happens.
          if (passed) {
            play(
              targetEl,
              [
                { transform: 'scale(1)', opacity: 1 },
                { transform: 'scale(1.18)', opacity: 1, offset: 0.35 },
                { transform: 'scale(1)', opacity: 1 },
              ],
              480,
            );
          }
        }
        targetEl.classList.toggle('is-on', !rush.allClear);
      }

      /* ------------------------------------------------------------ the results */

      const results = rush.results;
      if (results && results.score !== shownResults) {
        shownResults = results.score;
        resultsHeadEl.textContent = results.ranked ? 'RAYO RUSH · TIME' : 'RAYO RUSH · TIME · PRACTICE';
        resultsScoreEl.textContent = formatScore(results.score);
        // The verdict on the mission this run was FOR — read off the frozen results and not off
        // the live state, which by now is already offering the next one.
        //
        // Three outcomes, not two: cleared it for the first time (and here is where you are
        // going next), cleared a mission that was already behind you (a replay, nothing moves),
        // or missed it (and here is the number again). `rush.levelLabel` is the site the chain
        // has moved ON to, which is exactly what "next" means on the first of those.
        resultsMissionEl.classList.toggle('is-cleared', results.cleared);
        if (results.advanced) {
          resultsMissionHeadEl.textContent = `MISSION ${results.level + 1} COMPLETE`;
          resultsMissionNextEl.textContent = rush.allClear
            ? 'EVERY MISSION CLEAR · THE MARKER IS YOURS'
            : `NEXT · ${rush.levelLabel || `MISSION ${rush.level + 1}`}`;
        } else if (results.cleared) {
          resultsMissionHeadEl.textContent = `MISSION ${results.level + 1} · CLEARED AGAIN`;
          resultsMissionNextEl.textContent = results.levelLabel;
        } else {
          resultsMissionHeadEl.textContent = `MISSION ${results.level + 1} · TARGET MISSED`;
          resultsMissionNextEl.textContent = `${formatScore(results.targetScore - results.score)} PTS SHORT`;
        }
        rTargetEl.textContent = formatScore(results.targetScore);
        rDisabledEl.textContent = String(results.disabled);
        rChainEl.textContent = formatMultiplier(Math.max(1, results.bestChain));
        rStyleEl.textContent = `+${formatScore(results.styleBonus)}`;
        rPrevEl.textContent = rush.previousBest >= 0 ? formatScore(rush.previousBest) : '—';
        resultsBestEl.textContent = rush.newBest ? 'NEW PERSONAL BEST' : '';
        resultsBestEl.classList.toggle('is-on', rush.newBest);
        play(
          resultsEl,
          [
            { opacity: 0, transform: 'translate(-50%, -50%) scale(0.94)' },
            { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
          ],
          320,
        );
      } else if (!results && shownResults !== -1) {
        shownResults = -1;
      }
    },

    onEvent(event) {
      switch (event.type) {
        case 'rushStart':
          // A fresh run: clear the caches so the first frame of it writes everything.
          shownSeconds = -1;
          shownScore = -1;
          shownMultiplier = -1;
          shownChainStep = -1;
          shownResults = -1;
          shownAttempts = -2;
          shownTarget = -1;
          // The class as well as the cache. `is-passed` is only ever written when the flag
          // CHANGES, so a run that can never set it — a free run, once the chain is done —
          // would otherwise inherit the last run's, and be kept invisible only by the fact
          // that the line it is on is hidden too. Cleared here, where the run begins.
          shownPassed = false;
          targetEl.classList.remove('is-passed');
          break;
        case 'rushLevelUp':
          // The chain moved on while the results card was still going up. The prompt behind it
          // is now offering a different mission at a different corner, so the strip it caches
          // has to be rewritten before it is next shown.
          shownMission = '';
          break;
        case 'rushScore': {
          pushLine(`EV DISABLED +${formatScore(event.points)}`, 'score');
          // Only once the streak is actually a streak: "CHAIN x1" says nothing.
          if (event.chain > 1) pushLine(`CHAIN ${formatMultiplier(event.multiplier)}`, 'chain');
          if (event.driftBonus > 0) {
            const label = event.cleanDrift ? 'CLEAN DRIFT CHARGE BONUS' : 'DRIFT CHARGE BONUS';
            pushLine(`${label} +${formatScore(event.driftBonus)}`, 'style');
          }
          break;
        }
        case 'rushDismissed':
        case 'restart':
          shownResults = -1;
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
