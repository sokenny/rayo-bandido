import type { Account, AccountState } from '../net/account';

/**
 * WHO IS PLAYING, and the way to sign in — on every screen.
 *
 * `createAccountBadge` is the menus' version, in the top-right corner of each of them:
 *
 *   still asking     SAVE LINK · CONNECTING
 *   no server        OFFLINE · SAVED ON THIS DEVICE
 *   a guest          BANDIDO · GUEST · PROGRESS SAVED   [SIGN IN · GOOGLE]
 *   signed in        KAITO · GOOGLE · SYNCED            [SIGN OUT]
 *
 * `createPlayerTag` is the one in the HUD, over every world: the nickname, always, and for a guest
 * a way to sign in without going back to a menu. Signing out is the menu's; a button that ends
 * the session has no business a thumb's slip away from the steering.
 *
 * The buttons are only the providers the server actually offers (`GET /api/me`), so a server
 * nobody has registered an OAuth app for simply shows a guest whose progress is saved. A sign-in
 * that has just come back says how it went, once.
 */

const LABEL: Record<string, string> = { google: 'GOOGLE', discord: 'DISCORD' };

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The name the boards show for this player: the account's, else the one this browser gave the
 * lobby (not yet saved, or saved while offline), else the fallback every board uses.
 */
function nickname(state: AccountState): string {
  if (state.user?.name) return state.user.name;
  try {
    const local = localStorage.getItem('rb.name');
    if (local) return local.toUpperCase();
  } catch {
    /* no storage */
  }
  return 'BANDIDO';
}

export function createAccountBadge(root: HTMLElement, acct: Account): { setHidden(hidden: boolean): void; dispose(): void } {
  const el = document.createElement('div');
  el.className = 'rb-account';
  root.appendChild(el);
  let booted = false;

  function render(state: AccountState): void {
    const user = state.user;
    let status: string;
    let actions = '';
    if (!booted) {
      status = '<span class="rb-account__who">SAVE LINK</span><span class="rb-account__what">CONNECTING</span>';
    } else if (!state.online || !user) {
      status = '<span class="rb-account__who">OFFLINE</span><span class="rb-account__what">SAVED ON THIS DEVICE</span>';
    } else if (user.guest) {
      status = `<span class="rb-account__who">${escape(nickname(state))}</span><span class="rb-account__what">GUEST · PROGRESS SAVED</span>`;
      actions = state.providers
        .map((p) => `<button type="button" class="rb-account__btn" data-provider="${escape(p)}">SIGN IN · ${escape(LABEL[p] ?? p.toUpperCase())}</button>`)
        .join('');
    } else {
      const via = user.providers.map((p) => LABEL[p] ?? p.toUpperCase()).join(' + ');
      status = `<span class="rb-account__who">${escape(user.name || 'BANDIDO')}</span><span class="rb-account__what">${escape(via)} · SYNCED</span>`;
      actions = '<button type="button" class="rb-account__btn" data-action="signout">SIGN OUT</button>';
    }
    const notice =
      state.authResult === 'failed'
        ? '<span class="rb-account__notice is-bad">SIGN-IN FAILED</span>'
        : state.authResult === 'ok' && user && !user.guest
          ? '<span class="rb-account__notice">SIGNED IN</span>'
          : '';
    el.innerHTML = `<div class="rb-account__status"><i class="rb-account__dot${state.online ? ' is-on' : ''}"></i>${status}</div>${notice}${actions ? `<div class="rb-account__actions">${actions}</div>` : ''}`;
  }

  el.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('button');
    if (!target) return;
    // Held off the menu's own keyboard and click handling: this is not a mode card.
    e.stopPropagation();
    target.disabled = true;
    if (target.dataset.action === 'signout') void acct.signOut();
    else if (target.dataset.provider) void acct.signIn(target.dataset.provider);
  });

  render(acct.state);
  const off = acct.onChange(render);
  void acct.ready(10_000).then((state) => {
    booted = true;
    render(state);
  });

  return {
    setHidden(hidden) {
      el.hidden = hidden;
    },
    dispose() {
      off();
      el.remove();
    },
  };
}

/**
 * THE PLAYER TAG in the HUD: who you are, in every world, all the time — and for a guest the one
 * button that turns this browser's progress into an account. Top left, under the controls card,
 * which is the corner nothing else in any mode uses.
 *
 * Signing in leaves the page for Google and comes back to the same address, so the world is built
 * again; the account flushes what is unsent first (`Account.signIn`). The button never takes
 * keyboard focus, so Space and Enter keep driving the car rather than pressing it.
 */
export function createPlayerTag(root: HTMLElement, acct: Account): { dispose(): void } {
  const el = document.createElement('div');
  el.className = 'rb-player';
  root.appendChild(el);

  function render(state: AccountState): void {
    const user = state.user;
    const signedIn = !!user && !user.guest;
    const status = !state.online || !user ? 'SIN CONEXIÓN' : signedIn ? user.providers.map((p) => LABEL[p] ?? p.toUpperCase()).join(' + ') : 'INVITADO';
    const button =
      state.online && user?.guest
        ? state.providers
            .map(
              (p) =>
                `<button type="button" tabindex="-1" class="rb-player__signin" data-provider="${escape(p)}">ENTRAR CON ${escape(LABEL[p] ?? p.toUpperCase())}</button>`,
            )
            .join('')
        : '';
    el.classList.toggle('is-signed-in', signedIn);
    el.innerHTML =
      `<i class="rb-player__dot${state.online ? ' is-on' : ''}"></i>` +
      `<span class="rb-player__name">${escape(nickname(state))}</span>` +
      `<span class="rb-player__status">${escape(status)}</span>` +
      button;
  }

  // Pressed, not clicked: the canvas under the HUD turns a pointer-down into a camera drag.
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('button');
    if (!target?.dataset.provider) return;
    e.stopPropagation();
    target.disabled = true;
    target.textContent = 'CONECTANDO…';
    void acct.signIn(target.dataset.provider);
  });

  render(acct.state);
  const off = acct.onChange(render);
  void acct.ready(10_000).then(render);

  return {
    dispose() {
      off();
      el.remove();
    },
  };
}
