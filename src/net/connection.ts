import {
  C2S,
  DEV_MATCH_PORT,
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  S2C,
  type RoomEntry,
  type RoomListing,
  type ServerMessage,
  type S2CType,
} from './protocol';

/**
 * The socket to the match server, plus an estimate of the server's clock.
 *
 * WHERE IT CONNECTS. In production, back to the origin the page came from, at `/ws`. That is
 * what makes one ngrok URL enough: the same Node process serves the game and accepts the
 * socket, so a friend needs no second address and this code needs no configuration.
 *
 * Development is the one case where those two are not the same process — the game comes from
 * Vite on 5173 and the match server is its own process on `DEV_MATCH_PORT` — so a dev build
 * aims at that port on the same host instead. `?server=ws://host:port/ws` overrides both, for
 * pointing a browser at somebody else's server.
 *
 * THE CLOCK. Every time on the wire is server milliseconds. `serverNow()` maps the local
 * monotonic clock onto it, which is what lets the whole grid launch on the same instant and
 * lets rival cars be interpolated against one shared timeline. The offset comes from
 * ping/pong round trips, keeping the estimate from the LOWEST-latency exchange seen recently
 * rather than the most recent one: a delayed packet inflates the estimate, a fast one cannot
 * fake being faster than the wire, so the minimum is the honest sample.
 */

export type ConnectionStatus = 'connecting' | 'open' | 'refused' | 'closed';

export interface Connection {
  readonly status: ConnectionStatus;
  /** Why the connection was refused or closed, for the lobby to show. Empty while healthy. */
  readonly problem: string;
  /** Round trip to the server in ms (-1 until the first pong). */
  readonly rtt: number;
  /** Current best estimate of the server clock, in server ms. */
  serverNow(): number;
  send(message: Record<string, unknown> & { t: string }): void;
  /** Subscribe to one server message type. Returns an unsubscribe function. */
  on<T extends ServerMessage>(type: S2CType, handler: (message: T) => void): () => void;
  /** Called whenever `status` changes. */
  onStatus(handler: (status: ConnectionStatus) => void): () => void;
  close(): void;
}

/** How many round trips to keep when picking the least-delayed one. */
const CLOCK_SAMPLES = 8;

/** Just the parts of `Location` this needs, so the rule can be tested without a browser. */
export interface OriginLike {
  protocol: string;
  host: string;
  hostname: string;
}

/**
 * The socket URL for this page: an explicit `?server=` override, the match server's own port
 * in development, or `/ws` on our own origin once the game is served by that same process.
 */
export function matchServerUrl(
  search: string = location.search,
  origin: OriginLike = location,
  dev: boolean = import.meta.env.DEV,
  devPort: number = DEV_MATCH_PORT,
): string {
  const override = new URLSearchParams(search).get('server');
  if (override) return override;
  const protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
  if (dev) return `${protocol}//${origin.hostname}:${devPort}/ws`;
  return `${protocol}//${origin.host}/ws`;
}

/**
 * The room list on the same server, over plain HTTP: `ws://host/ws` becomes `http://host/rooms`.
 * It is fetched before there is any socket — the browse screen has to show what is there
 * before the player has picked a room to connect to.
 */
export function roomListUrl(wsUrl: string = matchServerUrl()): string {
  const http = wsUrl.replace(/^ws/, 'http');
  return `${http.replace(/\/ws$/, '')}/rooms`;
}

/** Public rooms on this server, newest state each time. Throws if the server cannot be reached. */
export async function fetchRooms(signal?: AbortSignal): Promise<RoomListing[]> {
  const response = await fetch(roomListUrl(), { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`the match server answered ${response.status}`);
  const body = (await response.json()) as { rooms?: RoomListing[] };
  return Array.isArray(body.rooms) ? body.rooms : [];
}

/**
 * Open a socket into one room. `entry` is what `hello` carries: a code to join, a room to
 * create, or both (join that code, create it under that code if it has since been reaped).
 */
export function createConnection(name: string, entry: RoomEntry, url = matchServerUrl()): Connection {
  const socket = new WebSocket(url);
  const handlers = new Map<string, Set<(message: ServerMessage) => void>>();
  const statusHandlers = new Set<(status: ConnectionStatus) => void>();
  const samples: Array<{ rtt: number; offset: number }> = [];

  let status: ConnectionStatus = 'connecting';
  let problem = '';
  let offset = 0;
  let rtt = -1;
  let pingTimer = 0;

  function setStatus(next: ConnectionStatus): void {
    if (status === next) return;
    status = next;
    for (const handler of statusHandlers) handler(next);
  }

  function send(message: Record<string, unknown> & { t: string }): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  function ping(): void {
    send({ t: C2S.ping, c: performance.now() });
  }

  /** Fold one round trip into the clock estimate. */
  function acceptPong(clientStamp: number, serverStamp: number): void {
    const local = performance.now();
    const sampleRtt = local - clientStamp;
    if (sampleRtt < 0) return;
    samples.push({ rtt: sampleRtt, offset: serverStamp + sampleRtt / 2 - local });
    if (samples.length > CLOCK_SAMPLES) samples.shift();
    let best = samples[0];
    for (const s of samples) if (s.rtt < best.rtt) best = s;
    offset = best.offset;
    rtt = sampleRtt;
  }

  socket.addEventListener('open', () => {
    setStatus('open');
    send({ t: C2S.hello, v: PROTOCOL_VERSION, name, room: entry.join ?? '', create: entry.create });
    ping();
    pingTimer = window.setInterval(ping, PING_INTERVAL_MS);
  });

  socket.addEventListener('message', (event) => {
    let message: ServerMessage;
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : '') as ServerMessage;
    } catch {
      return;
    }
    if (!message || typeof message.t !== 'string') return;
    if (message.t === S2C.pong) {
      acceptPong(message.c, message.s);
      return;
    }
    if (message.t === S2C.refused) {
      problem = message.detail;
      setStatus('refused');
      return;
    }
    const set = handlers.get(message.t);
    if (!set) return;
    for (const handler of set) handler(message);
  });

  socket.addEventListener('close', () => {
    window.clearInterval(pingTimer);
    // A refusal already explained itself; anything else is a plain disconnect.
    if (status === 'refused') return;
    if (!problem) problem = 'lost the connection to the match server.';
    setStatus('closed');
  });

  socket.addEventListener('error', () => {
    if (status === 'connecting') problem = 'could not reach the match server. Is it running?';
  });

  return {
    get status() {
      return status;
    },
    get problem() {
      return problem;
    },
    get rtt() {
      return rtt;
    },
    serverNow() {
      return performance.now() + offset;
    },
    send,
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      const cast = handler as (message: ServerMessage) => void;
      set.add(cast);
      return () => set!.delete(cast);
    },
    onStatus(handler) {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },
    close() {
      window.clearInterval(pingTimer);
      statusHandlers.clear();
      handlers.clear();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    },
  };
}
