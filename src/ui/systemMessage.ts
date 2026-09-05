/**
 * The one transient centre-screen message in the game.
 *
 * Anything the game needs to say to the player in the middle of the screen — RESTART, the
 * cruise-mode hint — goes through here, so there is a single place that owns the type, the
 * timing and the animation of a system message instead of one bespoke element per caller.
 *
 * It deliberately lives *outside* `.rb-hud`: cruise mode hides the whole HUD for a clean
 * screensaver, and the message that announces cruise mode has to survive that.
 *
 * Performance contract, same as the HUD's: the tree is built once, `show` only writes the two
 * text nodes, and the animation is handed to the Web Animations API (compositor-driven and
 * self-cancelling) rather than a per-frame timer.
 */

/** Tone of the message. `alert` is the yellow display face; `calm` is the quieter cyan one. */
export type SystemMessageTone = 'alert' | 'calm';

export interface SystemMessageOptions {
  /** Small line under the headline. Omit for a one-line message. */
  sub?: string;
  /** Default `alert`. */
  tone?: SystemMessageTone;
  /** Milliseconds on screen, fades included. Default 1600. */
  duration?: number;
}

export interface SystemMessage {
  show(text: string, options?: SystemMessageOptions): void;
  /** Cancel whatever is on screen right now. */
  clear(): void;
  dispose(): void;
}

const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

export function createSystemMessage(root: HTMLElement): SystemMessage {
  const el = document.createElement('div');
  el.className = 'rb-sysmsg';
  el.innerHTML = `<div class="rb-sysmsg__text"></div><div class="rb-sysmsg__sub"></div>`;
  root.appendChild(el);

  const textEl = el.querySelector('.rb-sysmsg__text') as HTMLElement;
  const subEl = el.querySelector('.rb-sysmsg__sub') as HTMLElement;

  let animation: Animation | null = null;

  return {
    show(text, options) {
      const sub = options?.sub ?? '';
      const duration = options?.duration ?? 1600;
      textEl.textContent = text;
      subEl.textContent = sub;
      // `hidden` rather than display:none in a rule, so an empty sub takes no vertical room
      // and a one-line message still sits where a one-line message should.
      subEl.hidden = sub === '';
      el.classList.toggle('rb-sysmsg--calm', options?.tone === 'calm');

      if (animation) animation.cancel();
      if (!canAnimate) return;
      // Letter-spacing settles inward as it arrives: the same move the RESTART banner has
      // always made, now the house style for every system message.
      animation = el.animate(
        [
          { opacity: 0, letterSpacing: '0.6em' },
          { opacity: 1, letterSpacing: '0.34em', offset: 0.16 },
          { opacity: 1, letterSpacing: '0.34em', offset: 0.62 },
          { opacity: 0, letterSpacing: '0.44em' },
        ],
        { duration, easing: 'ease-out' },
      );
    },

    clear() {
      if (animation) {
        animation.cancel();
        animation = null;
      }
    },

    dispose() {
      if (animation) animation.cancel();
      animation = null;
      el.remove();
    },
  };
}
