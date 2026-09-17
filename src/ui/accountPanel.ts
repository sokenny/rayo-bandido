import { NICKNAME_MIN, type Account, type AccountState } from '../net/account';
import { NAME_MAX } from '../net/protocol';

/**
 * THE ACCOUNT PANEL: who you are signed in as, and your nickname.
 *
 * Opened from the menus' account corner (`ui/accountBadge.ts`). It shows the email and the logins
 * the account holds, and lets the player pick the nickname the boards, the HUD and the rooms show.
 * A nickname is a handle: the server gives each one to a single player (`server/accounts.mjs`),
 * so a taken one is refused here rather than silently shared.
 *
 * While it is open it holds the keyboard: the menus listen on `window` for arrows, WASD, Enter,
 * Space and ESC, all of which a player typing a name presses.
 */

const LABEL: Record<string, string> = { google: 'GOOGLE', discord: 'DISCORD' };

/** What the server will store for `raw`: `sanitizeDisplayName` in `server/accounts.mjs`. */
function preview(raw: string): string {
  return raw
    .normalize('NFC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

let open: { close(): void } | null = null;

export function openAccountPanel(root: HTMLElement, acct: Account): void {
  if (open) return;

  const el = document.createElement('div');
  el.className = 'rb-acctpanel';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'rb-acctpanel-title');
  root.appendChild(el);

  let busy = false;
  let message: { text: string; bad: boolean } | null = null;

  function render(state: AccountState): void {
    const user = state.user;
    const signedIn = !!user && !user.guest;
    const current = user?.name ?? null;
    const via = user?.providers.map((p) => LABEL[p] ?? p.toUpperCase()).join(' + ') ?? '';
    const typed = (el.querySelector('.rb-acctpanel__input') as HTMLInputElement | null)?.value;

    const rows = !state.online || !user
      ? `<div class="rb-acctpanel__row"><span>ESTADO</span><b>SIN CONEXIÓN</b></div>`
      : signedIn
        ? `<div class="rb-acctpanel__row"><span>EMAIL</span><b>${escape(user.email ?? '—')}</b></div>` +
          `<div class="rb-acctpanel__row"><span>CONECTADO CON</span><b>${escape(via)}</b></div>`
        : `<div class="rb-acctpanel__row"><span>ESTADO</span><b>INVITADO</b></div>`;

    const guestNote =
      state.online && user?.guest
        ? `<p class="rb-acctpanel__text">Tu progreso está guardado en este navegador. Entrá para llevar tu apodo y tus récords a cualquier dispositivo.</p>` +
          `<div class="rb-acctpanel__actions">${state.providers
            .map((p) => `<button type="button" class="rb-acctpanel__btn" data-provider="${escape(p)}">ENTRAR CON ${escape(LABEL[p] ?? p.toUpperCase())}</button>`)
            .join('')}</div>`
        : '';

    el.innerHTML =
      `<div class="rb-acctpanel__card">` +
      `<button type="button" class="rb-acctpanel__close" data-action="close" aria-label="Cerrar">✕</button>` +
      `<div class="rb-acctpanel__kicker">CUENTA</div>` +
      `<div class="rb-acctpanel__title" id="rb-acctpanel-title">${escape(current ?? 'SIN APODO')}</div>` +
      `<div class="rb-acctpanel__rows">${rows}</div>` +
      (state.online && user
        ? `<form class="rb-acctpanel__form" novalidate>` +
          `<label class="rb-acctpanel__label" for="rb-acctpanel-name">APODO</label>` +
          `<div class="rb-acctpanel__field">` +
          `<input id="rb-acctpanel-name" class="rb-acctpanel__input" type="text" autocomplete="nickname" spellcheck="false" maxlength="${NAME_MAX}" placeholder="TU NOMBRE DE JUEGO">` +
          `<button type="submit" class="rb-acctpanel__btn is-primary"${busy ? ' disabled' : ''}>${busy ? 'GUARDANDO…' : 'GUARDAR'}</button>` +
          `</div>` +
          `<div class="rb-acctpanel__hint${message?.bad ? ' is-bad' : message ? ' is-good' : ''}">${escape(
            message?.text ?? `${NICKNAME_MIN}–${NAME_MAX} letras, números, espacio, _ . - · único: nadie más puede usarlo`,
          )}</div>` +
          `</form>`
        : '') +
      guestNote +
      (signedIn ? `<div class="rb-acctpanel__foot"><button type="button" class="rb-acctpanel__btn is-quiet" data-action="signout">CERRAR SESIÓN</button></div>` : '') +
      `</div>`;

    const input = el.querySelector('.rb-acctpanel__input') as HTMLInputElement | null;
    if (input) {
      input.value = typed ?? current ?? '';
      input.disabled = busy;
    }
  }

  async function submit(): Promise<void> {
    const input = el.querySelector('.rb-acctpanel__input') as HTMLInputElement | null;
    if (!input || busy) return;
    const name = preview(input.value);
    if (name === (acct.state.user?.name ?? '')) {
      message = { text: 'ESE YA ES TU APODO', bad: false };
      render(acct.state);
      return;
    }
    if (name.length < NICKNAME_MIN) {
      message = { text: `MÍNIMO ${NICKNAME_MIN} CARACTERES`, bad: true };
      render(acct.state);
      return;
    }
    busy = true;
    message = null;
    render(acct.state);
    const result = await acct.claimName(name);
    busy = false;
    const field = el.querySelector('.rb-acctpanel__input') as HTMLInputElement | null;
    if (result.ok) {
      if (field) field.value = result.name;
      message = { text: `LISTO · AHORA SOS ${result.name}`, bad: false };
    } else {
      message = {
        text: result.reason === 'taken' ? `${name} YA ES DE OTRO JUGADOR` : result.reason === 'invalid' ? 'ESE APODO NO SE PUEDE USAR' : 'SIN CONEXIÓN · PROBÁ DE NUEVO',
        bad: true,
      };
    }
    render(acct.state);
    (el.querySelector('.rb-acctpanel__input') as HTMLInputElement | null)?.focus();
  }

  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });
  el.addEventListener('input', () => {
    const input = el.querySelector('.rb-acctpanel__input') as HTMLInputElement;
    const hint = el.querySelector('.rb-acctpanel__hint') as HTMLElement;
    const shown = preview(input.value);
    message = null;
    hint.className = 'rb-acctpanel__hint';
    hint.textContent = shown && shown !== input.value.toUpperCase() ? `SE GUARDA COMO: ${shown}` : `${NICKNAME_MIN}–${NAME_MAX} letras, números, espacio, _ . - · único: nadie más puede usarlo`;
  });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = (e.target as HTMLElement).closest('button');
    if (!target) {
      // A click on the dimmed backdrop, outside the card, closes it.
      if (e.target === el) close();
      return;
    }
    if (target.dataset.action === 'close') close();
    else if (target.dataset.action === 'signout') {
      target.disabled = true;
      void acct.signOut();
    } else if (target.dataset.provider) {
      target.disabled = true;
      void acct.signIn(target.dataset.provider);
    }
  });

  // Capture, on window: ahead of every menu's own keydown listener.
  const onKey = (e: KeyboardEvent): void => {
    e.stopImmediatePropagation();
    if (e.code === 'Escape') {
      e.preventDefault();
      close();
    } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && (e.target as HTMLElement).classList?.contains('rb-acctpanel__input')) {
      // Explicitly: the page's other capture listeners may already have eaten the form's own submit.
      e.preventDefault();
      void submit();
    }
  };
  window.addEventListener('keydown', onKey, true);

  const off = acct.onChange(render);

  function close(): void {
    window.removeEventListener('keydown', onKey, true);
    off();
    el.remove();
    open = null;
  }

  render(acct.state);
  open = { close };
  void el.offsetWidth;
  el.classList.add('is-on');
  (el.querySelector('.rb-acctpanel__input') as HTMLInputElement | null)?.focus();
}
