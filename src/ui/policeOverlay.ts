import type { GameEvent, PoliceHudSnapshot, PolicePhase } from '../core/types';

/**
 * The wanted level on screen (`src/sim/police.ts`): three stars, the heat between them, one
 * line of status — POLICE ALERTED, PURSUIT, ESCAPING with its count — the BUSTED warning that
 * builds before an arrest, and the arrest card itself.
 *
 * A HUD SUB-COMPONENT, under the same contract as the rush overlay: the DOM is built once,
 * `update` writes only what changed, transient flashes go to the Web Animations API, nothing
 * reads geometry back. It is invisible until there is something to say, and it says it in the
 * chrome's red: the police are the one voice in the city that is not the system's yellow.
 *
 * Top centre, under the top edge: the only spot nothing else in Free Roam uses. The card, like
 * every other results card, takes the middle of the screen once the driving has stopped.
 */
export interface PoliceOverlay {
  root: HTMLElement;
  update(s: PoliceHudSnapshot): void;
  onEvent(event: GameEvent): void;
  dispose(): void;
}

/** Steps the heat bar and the bust bar are quantised to. */
const HEAT_STEPS = 40;
const BUST_STEPS = 20;
/** Seconds POLICE ALERTED stays up after a patrol saw the offence. */
const ALERT_HOLD = 2.6;

const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

const STAR_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17.4l-6 3.3 1.3-6.6L2.4 9.5l6.7-.8z"/></svg>';

function formatMoney(value: number): string {
  return String(Math.max(0, Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function createPoliceOverlay(): PoliceOverlay {
  const root = document.createElement('div');
  root.className = 'rb-wanted';
  root.innerHTML =
    `<div class="rb-wanted__panel">` +
    `<div class="rb-wanted__stars">` +
    `<span class="rb-wanted__star">${STAR_SVG}</span>` +
    `<span class="rb-wanted__star">${STAR_SVG}</span>` +
    `<span class="rb-wanted__star">${STAR_SVG}</span>` +
    `</div>` +
    `<div class="rb-wanted__heat"><span class="rb-wanted__heat-fill"></span></div>` +
    `<div class="rb-wanted__status"></div>` +
    `<div class="rb-wanted__bust"><span class="rb-wanted__bust-label">BUSTED</span>` +
    `<span class="rb-wanted__bust-bar"><span class="rb-wanted__bust-fill"></span></span></div>` +
    `</div>` +
    `<div class="rb-wanted__shield">SHIELDED</div>` +
    `<div class="rb-wanted__card">` +
    `<div class="rb-wanted__card-head">BUSTED</div>` +
    `<div class="rb-wanted__card-stars"></div>` +
    `<div class="rb-wanted__card-fine">FINE ¥0</div>` +
    `<div class="rb-wanted__card-note">HEAT CLEARED · CAR RELEASED</div>` +
    `</div>`;

  const panel = root.querySelector<HTMLElement>('.rb-wanted__panel')!;
  const stars = Array.from(root.querySelectorAll<HTMLElement>('.rb-wanted__star'));
  const heatFill = root.querySelector<HTMLElement>('.rb-wanted__heat-fill')!;
  const status = root.querySelector<HTMLElement>('.rb-wanted__status')!;
  const bust = root.querySelector<HTMLElement>('.rb-wanted__bust')!;
  const bustFill = root.querySelector<HTMLElement>('.rb-wanted__bust-fill')!;
  const shield = root.querySelector<HTMLElement>('.rb-wanted__shield')!;
  const card = root.querySelector<HTMLElement>('.rb-wanted__card')!;
  const cardStars = root.querySelector<HTMLElement>('.rb-wanted__card-stars')!;
  const cardFine = root.querySelector<HTMLElement>('.rb-wanted__card-fine')!;

  let shownOn = false;
  let shownStars = -1;
  let shownCooldown = false;
  let shownHeatStep = -1;
  let shownStatus = '';
  let shownBustStep = -1;
  let shownShield = false;
  let shownCard = false;
  let shownPhase: PolicePhase = 'calm';
  /** Sim-time until which POLICE ALERTED is held up; -1 when it is not. */
  let alertUntil = -1;
  let lastTime = 0;

  function flashStar(index: number): void {
    const el = stars[index];
    if (!el || !canAnimate) return;
    el.animate(
      [
        { transform: 'scale(1.9)', filter: 'brightness(2.4)' },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ],
      { duration: 420, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' },
    );
  }

  return {
    root,

    update(s) {
      lastTime = Math.max(lastTime, 0);
      const chasing = s.phase === 'pursuit' || s.phase === 'escaping';
      const on = s.heat01 > 0 || s.stars > 0 || chasing || s.phase === 'busted';
      if (on !== shownOn) {
        shownOn = on;
        panel.classList.toggle('is-on', on);
      }

      const cooldown = s.phase === 'cooldown';
      if (s.stars !== shownStars || cooldown !== shownCooldown) {
        const rising = s.stars > shownStars && shownStars >= 0;
        shownStars = s.stars;
        shownCooldown = cooldown;
        for (let i = 0; i < stars.length; i++) {
          stars[i].classList.toggle('is-lit', i < s.stars);
          stars[i].classList.toggle('is-cooldown', cooldown && i < s.stars);
        }
        if (rising) flashStar(s.stars - 1);
      }
      if (s.phase !== shownPhase) {
        panel.classList.toggle('is-pursuit', chasing);
        panel.classList.toggle('is-escaping', s.phase === 'escaping');
        shownPhase = s.phase;
      }

      const heatStep = Math.round(s.heat01 * HEAT_STEPS);
      if (heatStep !== shownHeatStep) {
        shownHeatStep = heatStep;
        heatFill.style.transform = `scaleX(${(heatStep / HEAT_STEPS).toFixed(3)})`;
      }

      // One line: what the police are doing about you right now.
      let text = '';
      if (s.phase === 'escaping') text = `ESCAPING ${Math.ceil(s.escapeLeft)}`;
      else if (s.phase === 'pursuit') text = 'PURSUIT';
      else if (s.phase === 'busted') text = 'BUSTED';
      else if (alertUntil >= 0) text = 'POLICE ALERTED';
      else if (s.phase === 'cooldown') text = 'LAYING LOW';
      if (text !== shownStatus) {
        shownStatus = text;
        status.textContent = text;
        status.classList.toggle('is-on', text !== '');
      }

      const bustStep = s.phase === 'busted' ? BUST_STEPS : Math.round(s.bust01 * BUST_STEPS);
      const bustOn = chasing && bustStep > 0;
      if (bustStep !== shownBustStep) {
        shownBustStep = bustStep;
        bust.classList.toggle('is-on', bustOn);
        bustFill.style.transform = `scaleX(${(bustStep / BUST_STEPS).toFixed(2)})`;
      }

      if (s.shielded !== shownShield) {
        shownShield = s.shielded;
        shield.classList.toggle('is-on', s.shielded);
      }

      const showCard = s.phase === 'busted';
      if (showCard !== shownCard) {
        shownCard = showCard;
        card.classList.toggle('is-on', showCard);
        if (showCard) {
          cardStars.textContent = '★'.repeat(Math.max(1, s.bustedStars)) + '☆'.repeat(Math.max(0, 3 - Math.max(1, s.bustedStars)));
          cardFine.textContent = s.bustedCharged < s.bustedFine ? `FINE ¥${formatMoney(s.bustedFine)} · PAID ¥${formatMoney(s.bustedCharged)}` : `FINE ¥${formatMoney(s.bustedFine)}`;
          if (canAnimate) {
            card.animate(
              [
                { opacity: 0, transform: 'translate(-50%, -50%) scale(0.92)' },
                { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
              ],
              { duration: 240, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' },
            );
          }
        }
      }
    },

    onEvent(e) {
      if (e.type === 'policeWitness') {
        alertUntil = 1;
        // Held on a wall-clock timer, like the other transient labels: it is a flash, not state.
        window.setTimeout(() => {
          alertUntil = -1;
        }, ALERT_HOLD * 1000);
      } else if (e.type === 'policeCleared') {
        alertUntil = -1;
      }
    },

    dispose() {
      root.remove();
    },
  };
}
