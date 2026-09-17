import type { GameEvent, HustlerHudSnapshot } from '../core/types';
import { HUSTLER_VOICE, MEDIAS_LINES, TRAPITO_LINES, TRAVESTI_LINES, WASHER_CHOICES, WASHER_LINES, streetPrice } from '../content/hustlers';
import { prepareDialogue, speakDialogue, stopDialogue } from '../audio/dialogueVoice';

/**
 * The street hustlers' screen furniture (`src/sim/hustlers.ts`): the subtitle strip their lines go
 * on, and — only while a washer is offering — two small buttons, yes with the price on it and no.
 *
 * No portrait, no sign, no card: they are people on a corner, not an activity. The strip is the
 * passenger's (`.rb-pax__subtitle`) re-coloured under `.rb-hustler` in hi-vis orange, and it is
 * the rules that decide when it is up, so it comes down the moment the car is out of earshot.
 * A tap on either button is the same intent as its key (F / G), raised on the next tick.
 */
export interface HustlerOverlayOptions {
  onAccept(): void;
  onDecline(): void;
}

export interface HustlerOverlay {
  root: HTMLElement;
  update(h: HustlerHudSnapshot): void;
  onEvent(event: GameEvent): void;
  dispose(): void;
}

const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

function pick<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Rayo Bandido hustler overlay: missing element "${selector}"`);
  return el as T;
}

export function createHustlerOverlay(options: HustlerOverlayOptions): HustlerOverlay {
  const root = document.createElement('div');
  root.className = 'rb-pax rb-hustler';
  root.innerHTML =
    `<div class="rb-hustler__offer">` +
    `<button type="button" class="rb-hustler__choice rb-hustler__choice--yes"><span class="rb-key">F</span><span class="rb-hustler__yes"></span></button>` +
    `<button type="button" class="rb-hustler__choice rb-hustler__choice--no"><span class="rb-key">G</span><span class="rb-hustler__no"></span></button>` +
    `</div>` +
    `<div class="rb-pax__subtitle"><span class="rb-pax__speaker"></span><span class="rb-pax__text"></span></div>`;

  const offerEl = pick<HTMLElement>(root, '.rb-hustler__offer');
  const yesEl = pick<HTMLButtonElement>(root, '.rb-hustler__choice--yes');
  const noEl = pick<HTMLButtonElement>(root, '.rb-hustler__choice--no');
  const yesText = pick<HTMLElement>(root, '.rb-hustler__yes');
  pick<HTMLElement>(root, '.rb-hustler__no').textContent = WASHER_CHOICES.decline;
  const subtitleEl = pick<HTMLElement>(root, '.rb-pax__subtitle');
  const speakerEl = pick<HTMLElement>(root, '.rb-pax__speaker');
  const textEl = pick<HTMLElement>(root, '.rb-pax__text');

  const onYes = (e: Event): void => {
    e.preventDefault();
    options.onAccept();
  };
  const onNo = (e: Event): void => {
    e.preventDefault();
    options.onDecline();
  };
  yesEl.addEventListener('click', onYes);
  noEl.addEventListener('click', onNo);
  // The whole cast is voiced: trapitos and washers with the one street voice, the sock sellers with the villero one.
  void prepareDialogue('trapito', [...Object.values(TRAPITO_LINES).flat(), ...Object.values(WASHER_LINES).flat()]);
  void prepareDialogue('villero', Object.values(MEDIAS_LINES).flat());
  void prepareDialogue('travesti', Object.values(TRAVESTI_LINES).flat());

  let shownLineId = -1;
  /** Where the line on air is coming from. A fresh one per line, so the last line stays where it was said. */
  let voiceAt = { x: 0, z: 0 };
  let shownTalking = false;
  let shownOffer = false;
  let shownPrice = -1;
  const animations = new Map<Element, Animation>();
  function play(el: Element, keyframes: Keyframe[], duration: number): void {
    if (!canAnimate) return;
    animations.get(el)?.cancel();
    animations.set(el, el.animate(keyframes, { duration, easing: 'ease-out' }));
  }

  function setTalking(on: boolean): void {
    if (on === shownTalking) return;
    shownTalking = on;
    subtitleEl.classList.toggle('is-on', on);
  }

  function setOffer(on: boolean): void {
    if (on === shownOffer) return;
    shownOffer = on;
    offerEl.classList.toggle('is-on', on);
    if (on) {
      play(
        offerEl,
        [
          { opacity: 0, transform: 'translate(-50%, 8px)' },
          { opacity: 1, transform: 'translate(-50%, 0)' },
        ],
        200,
      );
    }
  }

  return {
    root,

    update(h) {
      if (h.price !== shownPrice) {
        shownPrice = h.price;
        yesText.textContent = `${WASHER_CHOICES.accept} — ${streetPrice(h.price)}`;
      }
      setOffer(h.offer);
      root.classList.toggle('is-washer', h.kind === 'washer');

      if (h.lineId !== shownLineId) {
        shownLineId = h.lineId;
        const on = h.line !== '';
        if (on) {
          speakerEl.textContent = h.speaker.toUpperCase();
          textEl.textContent = h.line;
          // Not awaited, and not stopped when the subtitle goes: a short line finishes its sentence —
          // from where he stands, so a car that drives off leaves it behind on the corner.
          voiceAt = { x: h.x, z: h.z };
          void speakDialogue({ characterId: HUSTLER_VOICE[h.kind], text: h.line, interrupt: true, at: voiceAt });
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
      } else if (h.line === '' && shownTalking) {
        setTalking(false);
      } else if (h.line !== '') {
        // Same line, same speaker: a sock seller walking his beat takes his voice with him.
        voiceAt.x = h.x;
        voiceAt.z = h.z;
      }
    },

    onEvent(event) {
      if (event.type === 'restart') {
        setTalking(false);
        setOffer(false);
        shownLineId = -1;
        stopDialogue('trapito');
        stopDialogue('villero');
        stopDialogue('travesti');
      }
    },

    dispose() {
      stopDialogue('trapito');
      stopDialogue('villero');
      stopDialogue('travesti');
      yesEl.removeEventListener('click', onYes);
      noEl.removeEventListener('click', onNo);
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
      root.remove();
    },
  };
}
