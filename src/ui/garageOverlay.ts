import type { GameEvent, GarageHudSnapshot } from '../core/types';
import { LOCO_MUSTANG } from '../content/garage';
import { prepareDialogue, speakDialogue, stopDialogue } from '../audio/dialogueVoice';
import { portraitFor } from './portraits';

/**
 * Loco Mustang's screen furniture: the sign over his ring (the garage's name, TUNING & MODS ·
 * NOT OPEN YET, and the key to talk), his face and name while he is talking, and the subtitle
 * strip his lines go on.
 *
 * El Búho's pieces (`buhoOverlay.ts`), which are the passenger's (`passengerOverlay.ts`): the
 * `.rb-pax__*` components reused as they are, re-coloured under `.rb-garage` in the red of the
 * 99 on his shirt, and laid out by `.rb-buho__panel`'s rules so the card sits where his does.
 * Nothing to confirm and nothing to buy: the sign is up while the car is on the ring.
 */
export interface GarageOverlayOptions {
  onActivate(): void;
}

export interface GarageOverlay {
  root: HTMLElement;
  update(g: GarageHudSnapshot): void;
  onEvent(event: GameEvent): void;
  dispose(): void;
}

const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

function pick<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Rayo Bandido garage overlay: missing element "${selector}"`);
  return el as T;
}

export function createGarageOverlay(options: GarageOverlayOptions): GarageOverlay {
  const sign = LOCO_MUSTANG.sign;
  const root = document.createElement('div');
  root.className = 'rb-pax rb-garage';
  root.innerHTML =
    `<button type="button" class="rb-pax__prompt rb-garage__prompt">` +
    `<span class="rb-pax__prompt-title"></span>` +
    `<span class="rb-pax__prompt-sub"></span>` +
    `<span class="rb-pax__prompt-key"><span class="rb-key">F</span> <span class="rb-pax__prompt-verb"></span></span>` +
    `</button>` +
    `<div class="rb-pax__panel rb-buho__panel rb-garage__panel">` +
    `<div class="rb-pax__portrait"></div>` +
    `<div class="rb-pax__who"><b class="rb-pax__name"></b><span class="rb-pax__tag"></span></div>` +
    `</div>` +
    `<div class="rb-pax__subtitle"><span class="rb-pax__speaker"></span><span class="rb-pax__text"></span></div>`;

  const promptEl = pick<HTMLButtonElement>(root, '.rb-pax__prompt');
  const panelEl = pick<HTMLElement>(root, '.rb-pax__panel');
  const portraitEl = pick<HTMLElement>(root, '.rb-pax__portrait');
  const subtitleEl = pick<HTMLElement>(root, '.rb-pax__subtitle');
  const textEl = pick<HTMLElement>(root, '.rb-pax__text');
  pick<HTMLElement>(root, '.rb-pax__prompt-title').textContent = sign.title;
  pick<HTMLElement>(root, '.rb-pax__prompt-sub').textContent = sign.sub;
  pick<HTMLElement>(root, '.rb-pax__prompt-verb').textContent = sign.verb;

  const onClick = (e: Event): void => {
    e.preventDefault();
    options.onActivate();
  };
  promptEl.addEventListener('click', onClick);
  // Everything he can say, voiced ahead of time (`src/audio/dialogueVoice.ts`).
  void prepareDialogue('loco-mustang', [...LOCO_MUSTANG.greetings, ...LOCO_MUSTANG.soon]);

  let shownWho = '';
  let shownPrompt = false;
  let shownLineId = -1;
  let shownTalking = false;

  const animations = new Map<Element, Animation>();
  function play(el: Element, keyframes: Keyframe[], duration: number): void {
    if (!canAnimate) return;
    animations.get(el)?.cancel();
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
    shownPrompt = false;
    promptEl.classList.remove('is-on');
  }

  return {
    root,

    update(g) {
      if (g.portrait !== shownWho) {
        shownWho = g.portrait;
        portraitEl.innerHTML = portraitFor(g.portrait);
        pick<HTMLElement>(root, '.rb-pax__name').textContent = g.name.toUpperCase();
        pick<HTMLElement>(root, '.rb-pax__tag').textContent = g.tagline;
        pick<HTMLElement>(root, '.rb-pax__speaker').textContent = g.name.toUpperCase();
      }

      const prompt = g.open;
      if (prompt !== shownPrompt) {
        shownPrompt = prompt;
        promptEl.classList.toggle('is-on', prompt);
        if (prompt) {
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

      if (g.lineId !== shownLineId) {
        shownLineId = g.lineId;
        const on = g.line !== '';
        if (on) {
          textEl.textContent = g.line;
          // Not awaited, and not stopped when the subtitle goes: a short line finishes its sentence.
          void speakDialogue({ characterId: 'loco-mustang', text: g.line, interrupt: true });
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
      } else if (g.line === '' && shownTalking) {
        setTalking(false);
      }
    },

    onEvent(event) {
      if (event.type === 'restart') {
        clear();
        stopDialogue('loco-mustang');
      }
    },

    dispose() {
      stopDialogue('loco-mustang');
      promptEl.removeEventListener('click', onClick);
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
      root.remove();
    },
  };
}
