/**
 * Wire protocol between the browser clients and the match server (`server/`).
 *
 * SOURCE OF TRUTH. The server is plain JavaScript and cannot import this file, so it repeats
 * the same message names in `server/protocol.mjs`. `tests/protocol.test.ts` reads both files
 * and fails if the two lists drift apart — change one, change the other.
 *
 * TRUST MODEL. Every client simulates its own car and reports the result; the server relays
 * and keeps the clock. Nothing here is validated against physics, so a determined player can
 * lie about their position and their lap time. That is a deliberate trade: it keeps the
 * driving feel identical to single player (no input latency, no rollback) for a game meant to
 * be shared with friends over one tunnel. Do not put anything valuable behind these numbers.
 *
 * UNITS. Same as the simulation: metres, seconds, radians, m/s (`src/core/types.ts`). The one
 * exception is time on the wire, which is milliseconds on the SERVER clock — see
 * `src/net/connection.ts` for how a client maps that onto its own `performance.now()`.
 */

/** Bumped whenever a message shape changes. A mismatch is refused at `hello`. */
export const PROTOCOL_VERSION = 3;

/** Players per match. Also the room capacity: a fifth connection is refused. */
export const MAX_PLAYERS = 4;

/**
 * ROOMS. One server process holds many rooms, each identified by a short code that a player
 * either creates or is given. A socket names its room in `hello` and never leaves it: the
 * room is fixed for the life of the connection, which is why nothing below the handshake has
 * to carry a room id.
 *
 * A room is either LISTED — it shows up in `GET /rooms` for anyone to join — or unlisted, in
 * which case the code is the only way in. Unlisted is the default, so "create a room and send
 * the link to three friends" is the path of least resistance.
 */
export const ROOM_CODE_LEN = 4;
/** No I/O/0/1: a code is read off a screen and typed back in by somebody else. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Longest room label. Like names, longer input is truncated rather than refused. */
export const ROOM_LABEL_MAX = 20;
/** Rooms one server will hold at once. The next `create` is refused rather than queued. */
export const MAX_ROOMS = 64;
/** How long an empty room is kept before it is reaped, so a host can reload without losing it. */
export const EMPTY_ROOM_TTL_MS = 120_000;

/** How often a client publishes its car, and how often the server fans snapshots back out. */
export const SNAPSHOT_HZ = 20;
/** How often the host publishes the electric-car traffic it owns. */
export const TRAFFIC_HZ = 10;
/** How often a client pings to keep its estimate of the server clock fresh. */
export const PING_INTERVAL_MS = 2000;

/**
 * Rival cars are drawn this far in the past, so there are always two real samples to
 * interpolate between and one late packet does not stall them. It costs the same again in
 * apparent lag on top of the network's own, which is why it is barely over two send intervals
 * rather than the more usual 100 ms.
 */
export const INTERP_DELAY_MS = 110;
/** How long a rival may be extrapolated past its newest sample before it is left to coast. */
export const EXTRAPOLATE_MS = 250;
/** No car state for this long and a rival stops being drawn (tab closed, connection dropped). */
export const RIVAL_TIMEOUT_MS = 3000;

/** Longest player name accepted. Longer names are truncated, not refused. */
export const NAME_MAX = 14;

/**
 * Where the match server listens in development, when the game is being served by Vite on a
 * different port. In production there is no second port to know about: one Node process
 * serves both the game and the socket. Overridden per page by `?server=ws://host:port/ws`.
 */
export const DEV_MATCH_PORT = 8080;

/* ------------------------------------------------------------------ messages */

/** Client -> server. */
export const C2S = {
  /** First message on the socket: protocol version, the name, and which room to land in. */
  hello: 'hello',
  /** Change the name while in the lobby. */
  name: 'name',
  /** Set the ready flag in the lobby. */
  ready: 'ready',
  /** Host only: put everyone into the next match. */
  start: 'start',
  /** The circuit is built and warmed up; this client can be launched. */
  loaded: 'loaded',
  /** This client's car, published `SNAPSHOT_HZ` times a second while racing. */
  car: 'car',
  /** Host only: the authoritative electric-car traffic. */
  traffic: 'traffic',
  /** A non-host client destroyed an electric car and asks the host to agree. */
  hit: 'hit',
  /** A non-host client drove into an electric car; the host is asked to shove it the same way. */
  bump: 'bump',
  /** Crossed the line for the last time. */
  finish: 'finish',
  /** Clock sync. */
  ping: 'ping',
} as const;

/** Server -> client. */
export const S2C = {
  /** Accepted: here is your id and the server clock. */
  welcome: 'welcome',
  /** The room changed: players, ready flags, host, phase. */
  lobby: 'lobby',
  /** The room is full or the protocol version is wrong; the socket closes after this. */
  refused: 'refused',
  /** A match is starting: build the circuit and take this grid slot. */
  match: 'match',
  /** Everyone is loaded. GO happens at `goAt` on the server clock. */
  go: 'go',
  /** Every racer's car, `SNAPSHOT_HZ` times a second. */
  snapshot: 'snapshot',
  /** The host's authoritative traffic, relayed. */
  traffic: 'traffic',
  /** Host only: another player claims a target kill. */
  hit: 'hit',
  /** Host only: another player shoved an electric car. */
  bump: 'bump',
  /** The match is over; here is the classification. */
  results: 'results',
  /** Clock sync reply. */
  pong: 'pong',
} as const;

export type C2SType = (typeof C2S)[keyof typeof C2S];
export type S2CType = (typeof S2C)[keyof typeof S2C];

/* ------------------------------------------------------------------ payloads */

/** Bit flags packed into `WireCar.f`, so the per-tick booleans cost one number instead of four. */
export const CAR_FLAG = {
  drifting: 1,
  nitro: 2,
  braking: 4,
  reversing: 8,
} as const;

/**
 * One car on the wire. Short keys because this is the only message that repeats at 20 Hz per
 * player; everything else is human-readable. Wheel spin is deliberately absent — every client
 * integrates it from `sp`, which looks identical and saves a field.
 */
export interface WireCar {
  /** Position (m). */
  x: number;
  z: number;
  /** Heading (rad), compass convention as in `src/core/types.ts`. */
  h: number;
  /** World velocity (m/s), used to extrapolate past the newest sample. */
  vx: number;
  vz: number;
  /** Signed longitudinal speed (m/s). */
  sp: number;
  /** Front wheel angle (rad). */
  sa: number;
  /** Lateral acceleration (m/s^2), which becomes body roll on the rival's model. */
  la: number;
  /** Longitudinal acceleration (m/s^2), which becomes dive and squat. */
  ga: number;
  /** `CAR_FLAG` bits. */
  f: number;
  /** Lightning charge, 0..1, for the underglow. */
  ch: number;
}

/** A racer's standing, published alongside the car so everyone can rank the field. */
export interface WireRace {
  /** Current lap, 1-based. */
  lap: number;
  /** Completed laps + fraction of the current one. This is what ranks the field. */
  prog: number;
  /** Seconds into the current lap. */
  lapT: number;
  /** Best lap so far (s), or -1. */
  best: number;
  /** Total time at the flag (s), or -1 while still running. */
  fin: number;
  /** Money earned this race. */
  money: number;
}

export interface WirePlayer {
  id: string;
  name: string;
  ready: boolean;
  /** Grid slot for the current match, or -1 in the lobby. */
  slot: number;
  /** True for the player who may start the match and who owns the traffic. */
  host: boolean;
  /** True once the player has taken the flag in the current race. */
  finished: boolean;
}

/** Where the room is. The client mirrors this in `src/net/session.ts`. */
export type RoomPhase = 'lobby' | 'loading' | 'countdown' | 'racing' | 'results';

/** The room a socket ended up in, as the server describes it back at `welcome`. */
export interface RoomInfo {
  code: string;
  label: string;
  listed: boolean;
}

/** One row of `GET /rooms`: what the browser screen needs to decide whether to knock. */
export interface RoomListing extends RoomInfo {
  players: number;
  max: number;
  phase: RoomPhase;
}

/**
 * How a socket asks for a room. Exactly one of these is put into `hello`:
 *
 *   { join: 'K7QP' }                       join that room; refused if it is gone
 *   { create: { label, listed } }          a new room, the server picks the code
 *   { create: { ... }, join: 'K7QP' }      join K7QP, or create it under that code if it has
 *                                          expired — which is what makes a shared link
 *                                          reusable, and what stops two friends opening the
 *                                          same link at once from ending up in two rooms.
 */
export interface RoomEntry {
  join?: string;
  create?: { label: string; listed: boolean };
}

export interface HelloMessage {
  t: typeof C2S.hello;
  v: number;
  name: string;
  /** Room code to join, or '' when only `create` applies. */
  room: string;
  /** Present when this client may open a room. */
  create?: { label: string; listed: boolean };
}

export interface WelcomeMessage {
  t: typeof S2C.welcome;
  id: string;
  now: number;
  /** The room this socket is in, for the life of the socket. */
  room: RoomInfo;
}

export interface LobbyMessage {
  t: typeof S2C.lobby;
  phase: RoomPhase;
  players: WirePlayer[];
  hostId: string;
}

export interface RefusedMessage {
  t: typeof S2C.refused;
  /**
   * `missing` — no room with that code (nobody is in it any more, or it was mistyped).
   * `busy` — the server is already holding `MAX_ROOMS` and will not open another.
   */
  reason: 'full' | 'version' | 'missing' | 'busy';
  detail: string;
}

export interface MatchMessage {
  t: typeof S2C.match;
  /** Identifies the match, so a late `finish` from the previous one is ignored. */
  raceId: number;
  laps: number;
  /** Every racer with the grid slot they were given, in slot order. */
  players: Array<{ id: string; name: string; slot: number }>;
  /** The id that owns the traffic for this match. */
  hostId: string;
}

export interface GoMessage {
  t: typeof S2C.go;
  raceId: number;
  /** Server-clock ms at which the countdown reaches GO. */
  goAt: number;
  now: number;
}

export interface SnapshotMessage {
  t: typeof S2C.snapshot;
  /** Server-clock ms this snapshot was sent. */
  now: number;
  /**
   * One row per racer. `at` is the server-clock ms at which that car's state ARRIVED at the
   * server — not `now`. The server fans out on its own timer, so a car's state can be up to
   * one interval old by the time it is sent, and stamping every row with `now` would make
   * a rival advance in uneven steps (the same sample twice, then a double one). Interpolate
   * against `at`.
   */
  p: Array<{ id: string; c: WireCar; r: WireRace; at: number }>;
}

/** Numbers per electric car in `TrafficMessage.d`; the layout is documented where it is read. */
export { TRAFFIC_STRIDE } from '../sim/traffic';

/**
 * Traffic from the host. `d` is flat, `TRAFFIC_STRIDE` numbers per electric car in target-id
 * order (`src/sim/traffic.ts`): x, z, heading, status, patrol waypoint index, knock velocity.
 *
 * The waypoint index and the knock velocity are there so a client can run the SAME
 * deterministic patrol as the host between reports: without them a client whose copy had
 * been dragged to the host's position would still steer for its own stale waypoint, and the
 * two simulations would fight over the car's heading.
 *
 * `at` is the host's estimate of the server clock when the sample was taken (see
 * `src/net/connection.ts`), so a receiver can compare it against its own copy AT THAT TIME
 * rather than against a copy that has moved on since.
 */
export interface TrafficMessage {
  t: typeof S2C.traffic;
  now: number;
  at: number;
  d: number[];
}

export interface HitMessage {
  t: typeof S2C.hit;
  /** Target id the shooter destroyed. */
  target: number;
}

/**
 * A shove another player gave an electric car, relayed to the host to apply for real. The
 * knock is the velocity the shover's own simulation added (`TARGETS.knock`), and `at` is when
 * it happened on the server clock, so the host can fast-forward the car by the time the
 * message spent in transit and the two copies land close together.
 */
export interface BumpMessage {
  t: typeof S2C.bump;
  target: number;
  kx: number;
  kz: number;
  at: number;
}

export interface ResultsMessage {
  t: typeof S2C.results;
  raceId: number;
  /** Classification: finishers by time, then everyone else by race progress. */
  order: Array<{
    id: string;
    name: string;
    /** Total time (s), or -1 for a car that never took the flag. */
    total: number;
    /** Best lap (s), or -1. */
    best: number;
    /** Laps completed as a fraction, which ranks whoever did not finish. */
    prog: number;
    money: number;
    finished: boolean;
  }>;
}

export interface PongMessage {
  t: typeof S2C.pong;
  /** Echo of the client stamp from `ping`. */
  c: number;
  /** Server clock when the ping was handled. */
  s: number;
}

export type ServerMessage =
  | WelcomeMessage
  | LobbyMessage
  | RefusedMessage
  | MatchMessage
  | GoMessage
  | SnapshotMessage
  | TrafficMessage
  | HitMessage
  | BumpMessage
  | ResultsMessage
  | PongMessage;

/** Pack the per-tick booleans of a car into `WireCar.f`. */
export function packCarFlags(drifting: boolean, nitro: boolean, braking: boolean, reversing: boolean): number {
  return (
    (drifting ? CAR_FLAG.drifting : 0) |
    (nitro ? CAR_FLAG.nitro : 0) |
    (braking ? CAR_FLAG.braking : 0) |
    (reversing ? CAR_FLAG.reversing : 0)
  );
}

/** Trim and clamp a name typed in the lobby. Empty input becomes `fallback`. */
export function sanitizeName(raw: string, fallback = 'BANDIDO'): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * A room code as typed, pasted or pulled out of a URL: upper-cased, with anything outside the
 * alphabet dropped, clamped to length. Returns '' for input that cannot be a code, which is
 * how every caller tells "no room asked for" from "a room asked for".
 */
export function sanitizeRoomCode(raw: string): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let out = '';
  for (const char of cleaned) {
    if (ROOM_CODE_ALPHABET.includes(char)) out += char;
    if (out.length === ROOM_CODE_LEN) break;
  }
  return out.length === ROOM_CODE_LEN ? out : '';
}

/** Trim and clamp a room label. Mirrors `sanitizeName`, with its own fallback. */
export function sanitizeRoomLabel(raw: string, fallback = 'BANDIDO ROOM'): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.replace(/\s+/g, ' ').trim().slice(0, ROOM_LABEL_MAX);
  return trimmed.length > 0 ? trimmed : fallback;
}
