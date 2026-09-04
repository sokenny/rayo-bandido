import { MAX_PLAYERS, ROOM_CODE_LEN, ROOM_LABEL_MAX, sanitizeRoomCode, sanitizeRoomLabel } from '../net/protocol';
import type { RoomEntry, RoomListing } from '../net/protocol';
import { fetchRooms } from '../net/connection';
import { frameDecor, menuHeader } from './chrome';

/**
 * The room browser: the screen between VERSUS and the lobby.
 *
 * One server holds many rooms (`server/rooms.mjs`), so arriving at multiplayer is a choice
 * rather than a fact — make your own room and hand out its link, type the code a friend sent,
 * or join one of the rooms that asked to be public. Whichever it is, the screen hands
 * `src/main.ts` a `RoomEntry` and gets out of the way; it never opens a socket itself.
 *
 * The public list is plain HTTP (`GET /rooms`), because it has to be readable before there is
 * any socket to read it over. It is polled while the screen is up: rooms fill and empty while
 * somebody is deciding which one to knock on.
 *
 * DOM only, like the rest of `src/ui`, and dressed as the main menu so the two feel like one
 * screen with two steps.
 */
export interface RoomBrowser {
  dispose(): void;
}

export interface RoomBrowserCallbacks {
  /** A room was chosen or created: connect with this. */
  onEnter(entry: RoomEntry): void;
  /** ESC: back to the main menu. */
  onBack(): void;
}

/** How often the public list is re-read while the screen is up. */
const POLL_MS = 4000;

export function createRoomBrowser(root: HTMLElement, driverName: string, callbacks: RoomBrowserCallbacks): RoomBrowser {
  const wrap = document.createElement('div');
  wrap.className = 'rb-menu rb-rooms';
  wrap.innerHTML =
    frameDecor('ROOMS') +
    menuHeader('MULTIPLAYER · YOUR ROOM, YOUR RULES') +
    `<div class="rb-status rb-lobby__status" data-role="status">LOOKING FOR ROOMS</div>` +
    `<div class="rb-rooms__cols">` +
    `<div class="rb-panel rb-lobby__panel rb-rooms__panel">` +
    `<div class="rb-panel__head rb-rooms__heading"><span>OPEN_A_ROOM</span><span class="rb-panel__id">HOST</span></div>` +
    // `autocomplete` gets a made-up token rather than "off" for the same reason the lobby's
    // name field does: a password manager filling a form is not what anybody wants here.
    `<label class="rb-field rb-lobby__name"><span>ROOM_NAME</span>` +
    `<input type="text" maxlength="${ROOM_LABEL_MAX}" spellcheck="false" autocomplete="rb-room-label"` +
    ` autocapitalize="characters" data-1p-ignore data-lpignore="true" data-role="label" /></label>` +
    `<label class="rb-check rb-rooms__check"><input type="checkbox" data-role="listed" checked />` +
    `<span class="rb-check__box"></span><span>LIST IT PUBLICLY</span></label>` +
    `<div class="rb-rooms__note" data-role="privacy"></div>` +
    `<button class="rb-btn rb-lobby__btn is-primary" type="button" data-role="create">CREATE ROOM</button>` +
    `<div class="rb-panel__head rb-rooms__heading rb-rooms__heading--second"><span>HAVE_A_CODE</span><span class="rb-panel__id">GUEST</span></div>` +
    `<div class="rb-rooms__join">` +
    `<input type="text" maxlength="${ROOM_CODE_LEN}" spellcheck="false" autocomplete="rb-room-code"` +
    ` autocapitalize="characters" placeholder="CODE" data-1p-ignore data-lpignore="true" data-role="code" />` +
    `<button class="rb-btn rb-lobby__btn" type="button" data-role="join" disabled>JOIN</button>` +
    `</div>` +
    `</div>` +
    `<div class="rb-panel rb-lobby__panel rb-rooms__panel">` +
    `<div class="rb-panel__head rb-rooms__heading"><span>PUBLIC_ROOMS</span><span class="rb-panel__id" data-role="listId">SCANNING</span></div>` +
    `<div class="rb-rooms__list" data-role="list"></div>` +
    `</div>` +
    `</div>` +
    `<div class="rb-menu__hint"><b>ENTER</b> create · <b>ESC</b> back to the menu</div>`;
  root.appendChild(wrap);

  const pick = <T extends HTMLElement>(role: string): T => wrap.querySelector<T>(`[data-role="${role}"]`)!;
  const statusEl = pick('status');
  const labelInput = pick<HTMLInputElement>('label');
  const listedInput = pick<HTMLInputElement>('listed');
  const privacyEl = pick('privacy');
  const createBtn = pick<HTMLButtonElement>('create');
  const codeInput = pick<HTMLInputElement>('code');
  const joinBtn = pick<HTMLButtonElement>('join');
  const listEl = pick('list');
  const listIdEl = pick('listId');

  labelInput.value = sanitizeRoomLabel(`${driverName} ROOM`);
  // Public by default: a browser screen whose list is always empty makes multiplayer look dead,
  // and a host who wants a closed room only has to untick one box before creating it.
  listedInput.checked = true;

  let done = false;
  let timer = 0;
  let inFlight: AbortController | null = null;

  function renderPrivacy(): void {
    privacyEl.textContent = listedInput.checked
      ? 'anyone pointed at this server can see it and join'
      : 'invisible to everyone: only the link or the code gets a car in';
  }

  /** Nothing is chosen twice — a double click must not open two rooms. */
  function enter(entry: RoomEntry): void {
    if (done) return;
    done = true;
    stopPolling();
    wrap.classList.add('is-leaving');
    callbacks.onEnter(entry);
  }

  function renderRooms(rooms: RoomListing[]): void {
    listEl.replaceChildren();
    if (rooms.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rb-rooms__empty';
      empty.textContent = 'NO SIGNAL. NOBODY IS HOSTING A PUBLIC ROOM. OPEN ONE.';
      listEl.appendChild(empty);
      listIdEl.textContent = '00 FOUND';
      return;
    }
    listIdEl.textContent = `${String(rooms.length).padStart(2, '0')} FOUND`;
    for (const room of rooms) {
      const full = room.players >= room.max;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'rb-rooms__row';
      row.disabled = full;

      const label = document.createElement('span');
      label.className = 'rb-rooms__rlabel';
      // Room names are typed by other players; `textContent` is what keeps them text.
      label.textContent = room.label;

      const code = document.createElement('span');
      code.className = 'rb-rooms__rcode';
      code.textContent = room.code;

      const count = document.createElement('span');
      count.className = 'rb-rooms__rcount';
      count.textContent = `${room.players}/${room.max}`;

      const phase = document.createElement('span');
      phase.className = 'rb-rooms__rphase';
      phase.textContent = full ? 'FULL' : room.phase === 'lobby' || room.phase === 'results' ? 'OPEN' : 'RACING';

      row.append(label, code, count, phase);
      row.addEventListener('click', () => enter({ join: room.code }));
      listEl.appendChild(row);
    }
  }

  async function poll(): Promise<void> {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    try {
      const rooms = await fetchRooms(controller.signal);
      if (controller.signal.aborted || done) return;
      statusEl.classList.remove('is-bad');
      statusEl.textContent =
        rooms.length === 0
          ? `NO PUBLIC ROOMS · UP TO ${MAX_PLAYERS} CARS EACH`
          : `${rooms.length} PUBLIC ROOM${rooms.length === 1 ? '' : 'S'} · UP TO ${MAX_PLAYERS} CARS EACH`;
      renderRooms(rooms);
    } catch (err) {
      if (controller.signal.aborted || done) return;
      // A server that cannot be reached is worth saying out loud, but it does not stop the
      // screen: creating a room reports the same thing again, and far more usefully.
      statusEl.classList.add('is-bad');
      statusEl.textContent = 'COULD NOT REACH THE MATCH SERVER';
      renderRooms([]);
      listIdEl.textContent = 'OFFLINE';
      console.warn('Rayo Bandido: room list unavailable', err);
    }
  }

  function stopPolling(): void {
    window.clearInterval(timer);
    timer = 0;
    inFlight?.abort();
    inFlight = null;
  }

  /* ------------------------------------------------------------------ input */

  function createRoom(): void {
    enter({ create: { label: sanitizeRoomLabel(labelInput.value), listed: listedInput.checked } });
  }

  function joinTyped(): void {
    const code = sanitizeRoomCode(codeInput.value);
    if (!code) return;
    enter({ join: code });
  }

  labelInput.addEventListener('blur', () => {
    labelInput.value = sanitizeRoomLabel(labelInput.value);
  });
  listedInput.addEventListener('change', renderPrivacy);
  createBtn.addEventListener('click', createRoom);
  joinBtn.addEventListener('click', joinTyped);
  codeInput.addEventListener('input', () => {
    // Typed or pasted, the field only ever holds the code alphabet, in upper case.
    codeInput.value = codeInput.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, ROOM_CODE_LEN);
    joinBtn.disabled = sanitizeRoomCode(codeInput.value) === '';
  });

  const onKey = (e: KeyboardEvent): void => {
    if (done) return;
    if (e.code === 'Escape') {
      callbacks.onBack();
      e.preventDefault();
      return;
    }
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    // Enter does whichever thing the player is looking at: the code field joins, anything
    // else creates. Nobody should have to reach for the mouse to open a room.
    if (document.activeElement === codeInput) joinTyped();
    else createRoom();
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  renderPrivacy();
  void poll();
  timer = window.setInterval(() => void poll(), POLL_MS);

  return {
    dispose() {
      done = true;
      stopPolling();
      window.removeEventListener('keydown', onKey);
      wrap.remove();
    },
  };
}
