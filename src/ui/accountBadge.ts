import type { Account, AccountState } from '../net/account';

/**
 * WHO IS PLAYING, in the main menu's top-right corner, and the way to sign in.
 *
 *   still asking     SAVE LINK · CONNECTING
 *   no server        OFFLINE · SAVED ON THIS DEVICE
 *   a guest          GUEST · PROGRESS SAVED        [GOOGLE] [DISCORD]
 *   signed in        KAITO · GOOGLE                [SIGN OUT]
 *
 * The buttons are only the providers the server actually offers (`GET /api/me`), so a server
 * nobody has registered an OAuth app for simply shows a guest whose progress is saved. A sign-in
 * that has just come back says how it went, once.
 */

const LABEL: Record<string, string> = { google: 'GOOGLE', discord: 'DISCORD' };

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function createAccountBadge(root: HTMLElement, acct: Account): { dispose(): void } {
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
      status = user.name
        ? `<span class="rb-account__who">${escape(user.name)}</span><span class="rb-account__what">GUEST · PROGRESS SAVED</span>`
        : '<span class="rb-account__who">GUEST</span><span class="rb-account__what">PROGRESS SAVED</span>';
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
    dispose() {
      off();
      el.remove();
    },
  };
}
