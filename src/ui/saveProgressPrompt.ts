import { track } from '../analytics';
import type { Account } from '../net/account';

/**
 * THE SAVE-YOUR-PROGRESS PROMPT: a modal that asks a guest to attach Google to their account.
 *
 * Shown once per call to `show`, and only when it can actually do something: the server is
 * up, the player is still a guest, and the server offers Google (`GET /api/me`). Anyone else —
 * signed in, offline, a server with no OAuth app — never sees it, so callers can ask freely.
 *
 * BadKala's face, because the first place it is asked is the end of her call; the magenta is
 * hers and the button is the system's yellow. Nothing here pauses the simulation (a networked
 * city keeps running). The buttons never take keyboard focus, so Space and Enter keep driving
 * the car; the choice is a click or a tap.
 */
export interface SaveProgressPromptOptions {
  /** Small line over the title: where the ask comes from. */
  kicker?: string;
  title?: string;
  text?: string;
  /** Milliseconds before it appears. */
  delayMs?: number;
}

export interface SaveProgressPrompt {
  show(options?: SaveProgressPromptOptions): void;
  dispose(): void;
}

const PORTRAIT = '/badkala.webp';

function eligible(acct: Account): boolean {
  const { online, user, providers } = acct.state;
  return online && !!user && user.guest && providers.includes('google');
}

export function createSaveProgressPrompt(root: HTMLElement, acct: Account): SaveProgressPrompt {
  const el = document.createElement('div');
  el.className = 'rb-saveprompt';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'rb-saveprompt-title');
  el.innerHTML =
    `<div class="rb-saveprompt__card">` +
    `<button type="button" tabindex="-1" class="rb-saveprompt__close" data-action="close" aria-label="Cerrar">✕</button>` +
    `<div class="rb-saveprompt__portrait"><span>BK</span><img alt="" decoding="async" src="${PORTRAIT}"></div>` +
    `<div class="rb-saveprompt__body">` +
    `<div class="rb-saveprompt__kicker"></div>` +
    `<div class="rb-saveprompt__title" id="rb-saveprompt-title"></div>` +
    `<div class="rb-saveprompt__text"></div>` +
    `<div class="rb-saveprompt__actions">` +
    `<button type="button" tabindex="-1" class="rb-saveprompt__google" data-action="google">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.1z"/><path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z"/></svg>` +
    `<span>GUARDAR CON GOOGLE</span></button>` +
    `</div>` +
    `</div>` +
    `</div>`;
  el.hidden = true;
  root.appendChild(el);

  const kickerEl = el.querySelector('.rb-saveprompt__kicker') as HTMLElement;
  const titleEl = el.querySelector('.rb-saveprompt__title') as HTMLElement;
  const textEl = el.querySelector('.rb-saveprompt__text') as HTMLElement;
  const googleEl = el.querySelector('.rb-saveprompt__google') as HTMLButtonElement;
  const portraitEl = el.querySelector('.rb-saveprompt__portrait') as HTMLElement;
  const img = portraitEl.querySelector('img') as HTMLImageElement;
  img.addEventListener('load', () => portraitEl.classList.add('has-art'), { once: true });
  img.addEventListener('error', () => img.remove(), { once: true });

  let timer = 0;
  let disposed = false;
  /** The kicker it was last shown with: which ask it was, for analytics. */
  let shownWhere = '';

  function close(): void {
    el.classList.remove('is-on');
    window.setTimeout(() => {
      if (!el.classList.contains('is-on')) el.hidden = true;
    }, 220);
  }

  // Pressed, not clicked: the canvas under the HUD turns a pointer-down into a camera drag.
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = (e.target as HTMLElement).closest('button');
    // Only the ✕ closes it: a click on the dimmed street around the card does nothing.
    if (!target) return;
    if (target.dataset.action === 'google') {
      track('save_prompt_google_click', { where: shownWhere });
      googleEl.disabled = true;
      (googleEl.querySelector('span') as HTMLElement).textContent = 'CONECTANDO…';
      void acct.signIn('google');
    } else if (target.dataset.action === 'close') {
      track('save_prompt_close', { where: shownWhere });
      close();
    }
  });

  return {
    show(options = {}) {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await acct.ready();
        if (disposed || !eligible(acct)) return;
        kickerEl.textContent = options.kicker ?? 'BADKALA · MENSAJE';
        titleEl.textContent = options.title ?? 'NO PIERDAS LO QUE GANASTE';
        textEl.textContent =
          options.text ??
          'Ahora tu progreso vive solo en este navegador. Conectá Google y tus ¥, misiones y récords te siguen a cualquier dispositivo.';
        shownWhere = options.kicker ?? 'intro_end';
        track('save_prompt_shown', { where: shownWhere });
        el.hidden = false;
        // A layout read first, so the transition runs from the hidden state (rAF can be paused).
        void el.offsetWidth;
        el.classList.add('is-on');
      }, options.delayMs ?? 0);
    },
    dispose() {
      disposed = true;
      window.clearTimeout(timer);
      el.remove();
    },
  };
}
