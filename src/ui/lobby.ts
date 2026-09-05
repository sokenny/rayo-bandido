import { MAX_PLAYERS, NAME_MAX, sanitizeName, sanitizeRoomCode } from '../net/protocol';
import type { NetSession } from '../net/session';
import { slotCss } from '../core/playerColors';
import { formatRaceTime } from './hud';
import { createGamepadMenuNav } from '../core/input/gamepadMenu';
import { frameDecor, menuHeader } from './chrome';

/**
 * The multiplayer lobby: everything between opening the link and the lights going out, and
 * the classification afterwards.
 *
 * It is a view of `NetSession` and nothing else — it holds no state of its own beyond the
 * name being typed, and re-reads the session whenever it changes. `src/main.ts` shows it,
 * hides it while a race is running, and shows it again at the flag.
 *
 * DOM only, like the rest of `src/ui`. It shares the menu's look (`.rb-menu__*`) so arriving
 * from the main menu does not feel like arriving at a different game.
 */
export interface Lobby {
  /** Re-read the session and repaint. Cheap; called on every lobby message. */
  refresh(): void;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface LobbyCallbacks {
  /** ESC: leave this room and go back to the room browser. */
  onLeave(): void;
}

/**
 * The link to hand to a friend: this page, straight into THIS room. The code is what makes it
 * a private door — a server holds many rooms and only this link opens ours. `?mp=1` on its
 * own still works and lands on the room browser instead.
 */
export function shareLink(code: string, loc: Location = location): string {
  const room = sanitizeRoomCode(code);
  return `${loc.origin}${loc.pathname}?mp=1${room ? `&room=${room}` : ''}`;
}

export function createLobby(root: HTMLElement, session: NetSession, callbacks: LobbyCallbacks): Lobby {
  const wrap = document.createElement('div');
  wrap.className = 'rb-menu rb-lobby';
  wrap.innerHTML =
    frameDecor('LOBBY') +
    menuHeader('MULTIPLAYER · BANDIDO LOOP', 'room') +
    `<div class="rb-status rb-lobby__status" data-role="status">CONNECTING</div>` +
    `<div class="rb-panel rb-lobby__panel" data-role="panel">` +
    `<div class="rb-panel__head"><span>GRID_ROSTER</span><span class="rb-panel__id">${MAX_PLAYERS} SLOTS</span></div>` +
    // `autocomplete` gets a made-up token rather than "off", which browsers are free to
    // ignore on a plain text field — and a password manager filling a username into the
    // driver name is how you end up racing as your email address.
    `<label class="rb-field rb-lobby__name"><span>DRIVER_NAME</span>` +
    `<input type="text" maxlength="${NAME_MAX}" spellcheck="false" autocomplete="rb-driver-name"` +
    ` autocapitalize="characters" data-1p-ignore data-lpignore="true" data-role="name" /></label>` +
    `<div class="rb-lobby__players" data-role="players"></div>` +
    `</div>` +
    `<div class="rb-panel rb-lobby__results" data-role="results" hidden></div>` +
    `<div class="rb-lobby__actions">` +
    `<button class="rb-btn rb-lobby__btn" type="button" data-role="ready">READY</button>` +
    `<button class="rb-btn rb-lobby__btn is-primary" type="button" data-role="start" hidden>START RACE</button>` +
    `</div>` +
    `<div class="rb-lobby__share" data-role="share"><span data-role="shareLabel">SHARE</span>` +
    `<code data-role="link"></code>` +
    `<button class="rb-lobby__copy" type="button" data-role="copy">COPY</button></div>` +
    `<div class="rb-menu__hint" data-role="hint"></div>`;
  root.appendChild(wrap);

  const pick = <T extends HTMLElement>(role: string): T => wrap.querySelector<T>(`[data-role="${role}"]`)!;
  const statusEl = pick('status');
  const roomEl = pick('room');
  const shareLabelEl = pick('shareLabel');
  const panelEl = pick('panel');
  const nameInput = pick<HTMLInputElement>('name');
  const playersEl = pick('players');
  const resultsEl = pick('results');
  const readyBtn = pick<HTMLButtonElement>('ready');
  const startBtn = pick<HTMLButtonElement>('start');
  const hintEl = pick('hint');
  const linkEl = pick('link');
  const shareEl = pick('share');
  const copyBtn = pick<HTMLButtonElement>('copy');

  /**
   * The room is only known once the server has welcomed us, so the header and the share link
   * are filled in on the first refresh rather than here.
   */
  function renderRoom(): void {
    const room = session.room;
    if (!room) {
      roomEl.textContent = 'MULTIPLAYER · BANDIDO LOOP';
      linkEl.textContent = '';
      return;
    }
    roomEl.textContent = `${room.label} · ${room.code}${room.listed ? ' · PUBLIC' : ' · PRIVATE'}`;
    shareLabelEl.textContent = room.listed ? 'SHARE' : 'INVITE';
    linkEl.textContent = shareLink(room.code);
  }

  /* One row per possible player, built once. */
  interface PlayerRow {
    el: HTMLDivElement;
    chip: HTMLSpanElement;
    name: HTMLSpanElement;
    tag: HTMLSpanElement;
  }
  const rows: PlayerRow[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const el = document.createElement('div');
    el.className = 'rb-lobby__player';
    el.hidden = true;
    const index = document.createElement('span');
    index.className = 'rb-lobby__index';
    index.textContent = String(i + 1).padStart(2, '0');
    const chip = document.createElement('span');
    chip.className = 'rb-lobby__chip';
    const name = document.createElement('span');
    name.className = 'rb-lobby__pname';
    const tag = document.createElement('span');
    tag.className = 'rb-lobby__tag';
    el.append(index, chip, name, tag);
    playersEl.appendChild(el);
    rows.push({ el, chip, name, tag });
  }

  let ready = false;
  let lastResultsKey = '';

  function renderPlayers(): void {
    const players = session.players;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const player = players[i];
      if (!player) {
        row.el.hidden = false;
        row.el.classList.add('is-empty');
        row.chip.style.background = 'transparent';
        row.chip.style.color = 'transparent';
        row.name.textContent = 'AWAITING DRIVER';
        row.tag.textContent = '';
        continue;
      }
      row.el.hidden = false;
      row.el.classList.remove('is-empty');
      row.el.classList.toggle('is-self', player.id === session.selfId);
      row.chip.style.background = slotCss(i);
      // The glow is `currentColor`, so the colour is written twice: once as the chip itself,
      // once as the light it throws.
      row.chip.style.color = slotCss(i);
      row.name.textContent = player.name;
      const tags = [];
      if (player.host) tags.push('HOST');
      if (player.id === session.selfId) tags.push('YOU');
      if (player.ready) tags.push('READY');
      row.tag.textContent = tags.join(' · ');
    }
  }

  function renderResults(): void {
    const results = session.results;
    if (!results || session.phase !== 'results') {
      resultsEl.hidden = true;
      lastResultsKey = '';
      return;
    }
    const key = results.map((r) => `${r.id}:${r.total}`).join('|');
    resultsEl.hidden = false;
    if (key === lastResultsKey) return;
    lastResultsKey = key;
    const order = session.match ? session.match.players : [];
    const slotOf = (id: string): number => order.find((p) => p.id === id)?.slot ?? 0;
    resultsEl.innerHTML =
      `<div class="rb-panel__head rb-lobby__resultsTitle"><span>CLASSIFICATION</span><span class="rb-panel__id">FINAL</span></div>` +
      results
        .map((row, i) => {
          const you = row.id === session.selfId ? ' is-self' : '';
          const time = row.finished ? formatRaceTime(row.total) : 'DNF';
          const best = row.best >= 0 ? `BEST ${formatRaceTime(row.best)}` : '—';
          return (
            `<div class="rb-lobby__result${you}" style="--rb-standings-colour:${slotCss(slotOf(row.id))}">` +
            `<span class="rb-lobby__rpos">P${i + 1}</span>` +
            `<span class="rb-lobby__rname">${escapeHtml(row.name)}</span>` +
            `<span class="rb-lobby__rtime">${time}</span>` +
            `<span class="rb-lobby__rbest">${best}</span>` +
            `<span class="rb-lobby__rcash">¥${row.money}</span>` +
            `</div>`
          );
        })
        .join('');
  }

  function refresh(): void {
    const phase = session.phase;
    const problem = session.problem;
    renderRoom();
    // Nothing to share until there is a room: a refused connection has no link to hand out.
    shareEl.hidden = session.room === null;

    if (phase === 'refused' || phase === 'closed') {
      statusEl.textContent = problem.toUpperCase();
      statusEl.classList.add('is-bad');
      panelEl.hidden = true;
      readyBtn.hidden = true;
      startBtn.hidden = true;
      resultsEl.hidden = true;
      hintEl.innerHTML = `<b>ESC</b> back to the rooms · reload to try again`;
      return;
    }
    statusEl.classList.remove('is-bad');
    panelEl.hidden = false;

    if (phase === 'connecting') {
      statusEl.textContent = 'CONNECTING TO THE MATCH SERVER';
      readyBtn.hidden = true;
      startBtn.hidden = true;
      hintEl.innerHTML = `<b>ESC</b> back to the rooms`;
      return;
    }

    renderPlayers();
    renderResults();

    const count = session.players.length;
    const readyCount = session.players.filter((p) => p.ready).length;
    const isHost = session.isHost;
    const canDrive = phase === 'lobby' || phase === 'results';

    // The name can only change while nobody is driving.
    nameInput.disabled = !canDrive;
    readyBtn.hidden = !canDrive;
    startBtn.hidden = !(canDrive && isHost);
    startBtn.disabled = count === 0;

    if (phase === 'loading') {
      const waiting = count;
      statusEl.textContent = `BUILDING THE CIRCUIT · WAITING FOR ${waiting} CAR${waiting === 1 ? '' : 'S'}`;
      hintEl.innerHTML = `the grid launches when everyone is ready`;
      return;
    }
    if (phase === 'countdown' || phase === 'racing') {
      statusEl.textContent = 'RACE IN PROGRESS';
      hintEl.innerHTML = `you will be pulled into the next race`;
      return;
    }

    const rtt = session.rtt >= 0 ? ` · ${Math.round(session.rtt)} ms` : '';
    statusEl.textContent =
      phase === 'results'
        ? `RACE OVER · ${count}/${MAX_PLAYERS} IN THE ROOM${rtt}`
        : `${count}/${MAX_PLAYERS} IN THE ROOM · ${readyCount} READY${rtt}`;

    ready = session.self?.ready ?? false;
    readyBtn.textContent = ready ? 'NOT READY' : 'READY';
    readyBtn.classList.toggle('is-on', ready);
    startBtn.textContent = phase === 'results' ? 'RACE AGAIN' : 'START RACE';

    hintEl.innerHTML = isHost
      ? `<b>ENTER</b> start the race · <b>ESC</b> leave the room · you are the host, so you start it`
      : `<b>ENTER</b> ready up · <b>ESC</b> leave the room · the host starts the race`;
  }

  /* ------------------------------------------------------------------ input */

  function commitName(): void {
    const next = sanitizeName(nameInput.value);
    nameInput.value = next;
    session.setName(next);
    try {
      localStorage.setItem('rb.name', next);
    } catch {
      // Private browsing, or storage disabled. The name simply is not remembered.
    }
  }

  function toggleReady(): void {
    ready = !ready;
    session.setReady(ready);
    refresh();
  }

  nameInput.addEventListener('change', commitName);
  nameInput.addEventListener('blur', commitName);
  readyBtn.addEventListener('click', toggleReady);
  startBtn.addEventListener('click', () => session.start());
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(shareLink(session.room?.code ?? '')).then(
      () => {
        copyBtn.textContent = 'COPIED';
        window.setTimeout(() => (copyBtn.textContent = 'COPY'), 1400);
      },
      () => {
        copyBtn.textContent = 'SELECT IT';
      },
    );
  });

  const onKey = (e: KeyboardEvent): void => {
    if (wrap.hidden) return;
    if (e.code === 'Escape') {
      callbacks.onLeave();
      e.preventDefault();
      return;
    }
    // While the name field has focus, Enter just commits it; everything else is typing.
    if (document.activeElement === nameInput) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        nameInput.blur();
        e.preventDefault();
      }
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      const canAct = session.phase === 'lobby' || session.phase === 'results';
      if (!canAct) return;
      if (session.isHost) session.start();
      else toggleReady();
      e.preventDefault();
    }
  };
  window.addEventListener('keydown', onKey);
  // The pad's A button does what Enter does: ready up, or drop the flag if you are the host.
  const pad = createGamepadMenuNav({
    onMove: () => {},
    onConfirm: () => {
      if (session.phase !== 'lobby' && session.phase !== 'results') return;
      if (session.isHost) session.start();
      else toggleReady();
    },
  });

  // Start from the name the session actually connected under, so the field always agrees with
  // the roster instead of leaving the player to wonder which of the two is real.
  try {
    nameInput.value = sanitizeName(localStorage.getItem('rb.name') ?? '');
  } catch {
    nameInput.value = sanitizeName('');
  }

  refresh();

  return {
    refresh,
    show() {
      wrap.hidden = false;
      refresh();
    },
    hide() {
      wrap.hidden = true;
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      pad.dispose();
      wrap.remove();
    },
  };
}

/** Names come from other players, so they are escaped before they touch `innerHTML`. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
