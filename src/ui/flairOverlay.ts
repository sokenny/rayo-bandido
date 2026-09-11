import type { FlairTier, GameEvent } from '../core/types';

/**
 * The one line of flair on the glass (`src/sim/flair.ts` decides what it says and when).
 *
 * A HUD SUB-COMPONENT under the same contract as the tacho and the gauges: the tree is built
 * once, nothing here reads geometry back, and there is no per-frame work at all — the overlay
 * has no `update`, because the only thing that can change what is on screen is a new `flair`
 * event. The entrance is handed to the Web Animations API, which is compositor-driven and
 * self-cancelling, so a phrase interrupted by a bigger one simply stops.
 *
 * THE RULES ARE NOT HERE. Priority, the gap, the cooldowns and the anti-repeat all live in the
 * simulation, on simulation time, so they pause when the game does. By the time an event
 * arrives it has already won: this shows it, and that is the whole of its job.
 *
 * WHERE IT SITS. Above the centre, under the aim meter (26%) and well clear of the near-miss
 * pop that lands over the car's roof (52%), so the car, the road immediately ahead and the two
 * things the player actually steers by are never behind a word.
 */
export interface FlairOverlay {
  root: HTMLElement;
  onEvent(event: GameEvent): void;
  /** Take whatever is on screen off it: a restart, or leaving the game. */
  clear(): void;
  dispose(): void;
}

const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

/**
 * Asked once: a player who has turned motion down still gets the phrase, and still gets it for
 * exactly as long, but it arrives by fading rather than by jumping at them.
 */
const reducedMotion =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The entrance, and the same beat without the movement. `-50%` keeps the element centred. */
const ARRIVAL: Keyframe[] = [
  { opacity: 0, transform: 'translate(-50%, 10px) scale(0.86)' },
  { opacity: 1, transform: 'translate(-50%, -2px) scale(1.06)', offset: 0.1 },
  { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.2 },
  { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.72 },
  { opacity: 0, transform: 'translate(-50%, -14px) scale(1)' },
];

const ARRIVAL_STILL: Keyframe[] = [
  { opacity: 0 },
  { opacity: 1, offset: 0.12 },
  { opacity: 1, offset: 0.74 },
  { opacity: 0 },
];

/** Tier -> modifier class. `common` is the base treatment and adds nothing. */
const TIER_CLASS: Record<FlairTier, string> = {
  common: '',
  special: 'rb-flair--special',
  peak: 'rb-flair--peak',
  crash: 'rb-flair--crash',
};

export function createFlairOverlay(): FlairOverlay {
  const root = document.createElement('div');
  root.className = 'rb-flair';
  root.innerHTML = `<div class="rb-flair__text"></div>`;
  const textEl = root.querySelector('.rb-flair__text') as HTMLElement;

  let animation: Animation | null = null;
  let tierClass = '';

  function clear(): void {
    if (animation) {
      animation.cancel();
      animation = null;
    }
  }

  return {
    root,

    onEvent(e) {
      if (e.type === 'restart' || e.type === 'rushEnd' || e.type === 'rushDismissed') {
        clear();
        return;
      }
      if (e.type !== 'flair') return;

      textEl.textContent = e.text;
      const next = TIER_CLASS[e.tier];
      if (next !== tierClass) {
        if (tierClass) root.classList.remove(tierClass);
        if (next) root.classList.add(next);
        tierClass = next;
      }

      if (animation) animation.cancel();
      if (!canAnimate) return;
      // In fast and a touch oversized, settling within a fifth of the time it is up; out slow
      // and upward, so the phrase leaves the way a shout trails off. One compositor-driven
      // animation on transform and opacity: no layout, no paint, no per-frame timer.
      animation = root.animate(reducedMotion ? ARRIVAL_STILL : ARRIVAL, {
        duration: e.seconds * 1000,
        easing: 'cubic-bezier(0.16, 0.9, 0.3, 1)',
      });
      animation.onfinish = () => {
        animation = null;
      };
    },

    clear,

    dispose() {
      clear();
      root.remove();
    },
  };
}
