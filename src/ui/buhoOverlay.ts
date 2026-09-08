import type { BuhoHudSnapshot, GameEvent } from '../core/types';
import { formatYen } from './passengerOverlay';
import { portraitFor } from './portraits';

/**
 * El Búho's screen furniture: the prompt over his ring (the item, the price, the key, and
 * the confirm the second press needs), a compact card with his face and his name while he is
 * talking, and the subtitle strip his lines go on.
 *
 * THE SAME PIECES AS A PASSENGER'S. The prompt, the portrait box and the subtitle strip are
 * the passenger overlay's own components (`passengerOverlay.ts`, the `.rb-pax__*` rules in
 * `styles.css`) reused as they are, with the accent re-coloured amber under `.rb-buho` so his
 * sign is never mistaken for a pickup; only the confirm and refusal states are his. The card
 * carries no mood, no rules, no destination: he is not going anywhere. It is up only while a
 * line is, so the exchange puts itself away.
 *
 * Built once; `update` writes only what changed; nothing reads geometry back.
 */
export interface BuhoOverlayOptions {
  onActivate(): void;
}

export interface BuhoOverlay {
  root: HTMLElement;
  update(b: BuhoHudSnapshot): void;
  onEvent(event: GameEvent): void;
  dispose(): void;
}

type PromptState = 'none' | 'buy' | 'confirm' | 'funds' | 'active';

const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

function pick<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Rayo Bandido El Búho overlay: missing element "${selector}"`);
  return el as T;
}

export function createBuhoOverlay(options: BuhoOverlayOptions): BuhoOverlay {
  const root = document.createElement('div');
  root.className = 'rb-pax rb-buho';
  root.innerHTML =
    `<button type="button" class="rb-pax__prompt rb-buho__prompt">` +
    `<span class="rb-pax__prompt-title"></span>` +
    `<span class="rb-pax__prompt-sub"></span>` +
    `<span class="rb-pax__prompt-key"><span class="rb-key">F</span> <span class="rb-pax__prompt-verb">BUY</span></span>` +
    `</button>` +
    `<div class="rb-pax__panel rb-buho__panel">` +
    `<div class="rb-pax__portrait"></div>` +
    `<div class="rb-pax__who"><b class="rb-pax__name"></b><span class="rb-pax__tag"></span></div>` +
    `</div>` +
    `<div class="rb-pax__subtitle"><span class="rb-pax__speaker"></span><span class="rb-pax__text"></span></div>`;

  const promptEl = pick<HTMLButtonElement>(root, '.rb-pax__prompt');
  const promptTitleEl = pick<HTMLElement>(root, '.rb-pax__prompt-title');
  const promptSubEl = pick<HTMLElement>(root, '.rb-pax__prompt-sub');
  const promptVerbEl = pick<HTMLElement>(root, '.rb-pax__prompt-verb');
  const panelEl = pick<HTMLElement>(root, '.rb-pax__panel');
  const portraitEl = pick<HTMLElement>(root, '.rb-pax__portrait');
  const nameEl = pick<HTMLElement>(root, '.rb-pax__name');
  const tagEl = pick<HTMLElement>(root, '.rb-pax__tag');
  const subtitleEl = pick<HTMLElement>(root, '.rb-pax__subtitle');
  const speakerEl = pick<HTMLElement>(root, '.rb-pax__speaker');
  const textEl = pick<HTMLElement>(root, '.rb-pax__text');

  const onClick = (e: Event): void => {
    e.preventDefault();
    options.onActivate();
  };
  promptEl.addEventListener('click', onClick);

  let shownWho = '';
  let shownPrompt: PromptState = 'none';
  let shownLineId = -1;
  let shownTalking = false;

  const animations = new Map<Element, Animation>();
  function play(el: Element, keyframes: Keyframe[], duration: number): void {
    if (!canAnimate) return;
    const previous = animations.get(el);
    if (previous) previous.cancel();
    animations.set(el, el.animate(keyframes, { duration, easing: 'ease-out' }));
  }

  function setTalking(on: boolean): void {
    if (on === shownTalking) return;
    shownTalking = on;
    panelEl.classList.toggle('is-on', on);
    subtitleEl.classList.toggle('is-on', on);
    portraitEl.classList.toggle('is-talking', on);
  }

  function clear(): void {
    setTalking(false);
    shownLineId = -1;
    shownPrompt = 'none';
    promptEl.classList.remove('is-on', 'is-confirm', 'is-denied', 'is-mute');
  }

  return {
    root,

    update(b) {
      /* ------------------------------------------------------------ who */

      if (b.portrait !== shownWho) {
        shownWho = b.portrait;
        portraitEl.innerHTML = portraitFor(b.portrait);
        nameEl.textContent = b.name.toUpperCase();
        tagEl.textContent = b.tagline;
        speakerEl.textContent = b.name.toUpperCase();
      }

      /* ------------------------------------------------------------ the prompt */

      let prompt: PromptState = 'none';
      if (b.atSite && (b.canBuy || b.active || b.notice)) {
        if (b.notice === 'funds') prompt = 'funds';
        else if (b.notice === 'active' || b.active) prompt = 'active';
        else if (b.confirmArm > 0) prompt = 'confirm';
        else prompt = 'buy';
      }
      if (prompt !== shownPrompt) {
        const wasOn = shownPrompt !== 'none';
        shownPrompt = prompt;
        promptEl.classList.toggle('is-on', prompt !== 'none');
        promptEl.classList.toggle('is-confirm', prompt === 'confirm');
        promptEl.classList.toggle('is-denied', prompt === 'funds');
        promptEl.classList.toggle('is-mute', prompt === 'active' || prompt === 'funds');
        const item = b.item.toUpperCase();
        const price = `¥${formatYen(b.price)}`;
        promptTitleEl.textContent = b.name.toUpperCase();
        switch (prompt) {
          case 'buy':
            promptSubEl.textContent = `${item} · ${price}`;
            promptVerbEl.textContent = 'BUY';
            break;
          case 'confirm':
            promptSubEl.textContent = `${item} · ${price} · SURE?`;
            promptVerbEl.textContent = 'CONFIRM';
            break;
          case 'funds':
            promptSubEl.textContent = `NOT ENOUGH · ${item} IS ${price}`;
            break;
          case 'active':
            promptSubEl.textContent = `${item} · ONE IS PLENTY · COME BACK LATER`;
            break;
          default:
            break;
        }
        if (prompt !== 'none' && !wasOn) {
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

      /* ------------------------------------------------------------ the line */

      if (b.lineId !== shownLineId) {
        shownLineId = b.lineId;
        const on = b.line !== '';
        if (on) {
          textEl.textContent = b.line;
          play(
            subtitleEl,
            [
              { opacity: 0, transform: 'translate(-50%, 6px)' },
              { opacity: 1, transform: 'translate(-50%, 0)' },
            ],
            180,
          );
        }
        setTalking(on);
      } else if (b.line === '' && shownTalking) {
        // The line's time ran out. The card goes with it: the exchange is over.
        setTalking(false);
      }
    },

    onEvent(event) {
      if (event.type === 'restart') clear();
    },

    dispose() {
      promptEl.removeEventListener('click', onClick);
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
      root.remove();
    },
  };
}
