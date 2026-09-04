/**
 * Server-side mirror of the wire protocol.
 *
 * `src/net/protocol.ts` is the source of truth; this file exists only because the server runs
 * plain JavaScript under Node and cannot import a TypeScript module. `tests/protocol.test.ts`
 * parses both files and fails if the message names or the shared constants drift apart, so
 * the duplication cannot rot silently. Change one, change the other.
 */

export const PROTOCOL_VERSION = 3;
export const MAX_PLAYERS = 4;
export const SNAPSHOT_HZ = 20;
export const TRAFFIC_HZ = 10;
export const NAME_MAX = 14;

/* Rooms. See the block comment in `src/net/protocol.ts` for what a room is. */
export const ROOM_CODE_LEN = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_LABEL_MAX = 20;
export const MAX_ROOMS = 64;
export const EMPTY_ROOM_TTL_MS = 120000;

/** Client -> server. */
export const C2S = {
  hello: 'hello',
  name: 'name',
  ready: 'ready',
  start: 'start',
  loaded: 'loaded',
  car: 'car',
  traffic: 'traffic',
  hit: 'hit',
  bump: 'bump',
  finish: 'finish',
  ping: 'ping',
};

/** Server -> client. */
export const S2C = {
  welcome: 'welcome',
  lobby: 'lobby',
  refused: 'refused',
  match: 'match',
  go: 'go',
  snapshot: 'snapshot',
  traffic: 'traffic',
  hit: 'hit',
  bump: 'bump',
  results: 'results',
  pong: 'pong',
};

/** Trim and clamp a name. Mirrors `sanitizeName` in `src/net/protocol.ts`. */
export function sanitizeName(raw, fallback = 'BANDIDO') {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Mirrors `sanitizeRoomCode`: '' for anything that is not a full, legal code. */
export function sanitizeRoomCode(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let out = '';
  for (const char of cleaned) {
    if (ROOM_CODE_ALPHABET.includes(char)) out += char;
    if (out.length === ROOM_CODE_LEN) break;
  }
  return out.length === ROOM_CODE_LEN ? out : '';
}

/** Mirrors `sanitizeRoomLabel`. */
export function sanitizeRoomLabel(raw, fallback = 'BANDIDO ROOM') {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.replace(/\s+/g, ' ').trim().slice(0, ROOM_LABEL_MAX);
  return trimmed.length > 0 ? trimmed : fallback;
}
