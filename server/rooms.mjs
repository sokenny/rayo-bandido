import {
  EMPTY_ROOM_TTL_MS,
  MAX_ROOMS,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LEN,
  S2C,
  sanitizeRoomCode,
  sanitizeRoomLabel,
} from './protocol.mjs';
import { createRoom } from './room.mjs';

/**
 * The room registry: many independent match rooms in one server process.
 *
 * WHY. Before this there was one room per server, so whoever connected first became the host
 * of the only race there was, and anyone who found the URL was in it. A player who wants to
 * race three particular friends now opens their own room, gets a four-character code, and
 * hands out a link that lands in that room and no other.
 *
 * WHAT A SOCKET SEES. The room is chosen once, at `hello`, and never changes: `join(hello)`
 * below routes the connection into exactly one room and everything after that is the room's
 * business (`server/room.mjs`). Leaving means closing the socket and opening another.
 *
 * LIFETIME. A room is created on demand and reaped `EMPTY_ROOM_TTL_MS` after the last player
 * leaves, not the instant it empties — a host who reloads the page, or a whole grid that
 * quits to the menu together, comes back to the same code. `MAX_ROOMS` caps the whole thing
 * so one server cannot be made to hold rooms forever.
 *
 * LISTED VS UNLISTED. A listed room appears in `GET /rooms` for anyone pointed at the server;
 * an unlisted one is reachable only by its code. Unlisted is the default.
 */

export function createRooms({ laps = 2, log = () => {} } = {}) {
  /** @type {Map<string, { room: ReturnType<typeof createRoom>, emptySince: number }>} */
  const entries = new Map();

  const now = () => Date.now();

  /** A code nobody is using. Random rather than sequential: codes are shared, not guessed. */
  function freshCode() {
    for (let attempt = 0; attempt < 200; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LEN; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!entries.has(code)) return code;
    }
    return '';
  }

  function open(code, label, listed) {
    const room = createRoom({ code, label, listed, laps, log });
    entries.set(code, { room, emptySince: now() });
    log(`room ${code} opened — "${label}"${listed ? ' (public)' : ''} — ${entries.size} open`);
    return room;
  }

  function refuse(sendRaw, reason, detail) {
    sendRaw(JSON.stringify({ t: S2C.refused, reason, detail }));
    return null;
  }

  return {
    get size() {
      return entries.size;
    },

    /** Every room a player may browse to. Unlisted rooms are absent, code and all. */
    listed() {
      const rows = [];
      for (const entry of entries.values()) {
        if (entry.room.listed) rows.push(entry.room.listing());
      }
      // Fullest first: a room with people in it is the one worth joining.
      rows.sort((a, b) => b.players - a.players || (a.code < b.code ? -1 : 1));
      return rows;
    },

    /** The room under this code, or null. Used by the tests and by `/health`. */
    get(code) {
      const entry = entries.get(sanitizeRoomCode(code));
      return entry ? entry.room : null;
    },

    /**
     * Route one connection into a room, creating it if that is what `hello` asked for.
     * Returns `{ room, player }`, or null when the connection was refused (it has already
     * been told why, either here or by the room itself).
     */
    join(sendRaw, hello) {
      if (hello.v !== PROTOCOL_VERSION) {
        return refuse(
          sendRaw,
          'version',
          `server speaks protocol ${PROTOCOL_VERSION}, this page speaks ${hello.v}. Reload the page.`,
        );
      }

      const wanted = sanitizeRoomCode(hello.room);
      const create = hello.create && typeof hello.create === 'object' ? hello.create : null;
      let entry = wanted ? entries.get(wanted) : undefined;

      if (!entry) {
        if (!create) {
          return refuse(
            sendRaw,
            'missing',
            wanted
              ? `no room called ${wanted}. It may have closed — ask for a fresh link.`
              : 'that link does not name a room. Go back and pick one.',
          );
        }
        if (entries.size >= MAX_ROOMS) {
          return refuse(sendRaw, 'busy', `this server is already running ${MAX_ROOMS} rooms. Try again later.`);
        }
        // A link that names a room the server has since reaped re-opens it under the same
        // code, so the link a host handed out yesterday still works today.
        const code = wanted || freshCode();
        if (!code) return refuse(sendRaw, 'busy', 'could not find a free room code. Try again.');
        open(code, sanitizeRoomLabel(create.label), !!create.listed);
        entry = entries.get(code);
      }

      const player = entry.room.join(sendRaw, hello);
      if (!player) return null;
      entry.emptySince = 0;
      return { room: entry.room, player };
    },

    /** A socket closed: tell its room, and start the clock if that was the last player. */
    leave(room, playerId) {
      room.leave(playerId);
      const entry = entries.get(room.code);
      if (entry && room.size === 0) entry.emptySince = now();
    },

    /** Drives every room's timers and reaps the ones nobody came back to. */
    tick() {
      const t = now();
      for (const [code, entry] of entries) {
        entry.room.tick();
        if (entry.room.size > 0) {
          entry.emptySince = 0;
          continue;
        }
        if (entry.emptySince === 0) entry.emptySince = t;
        else if (t - entry.emptySince > EMPTY_ROOM_TTL_MS) {
          entries.delete(code);
          log(`room ${code} closed — empty for ${Math.round(EMPTY_ROOM_TTL_MS / 1000)} s — ${entries.size} open`);
        }
      }
    },
  };
}
