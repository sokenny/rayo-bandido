import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { C2S, MAX_PLAYERS, PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LEN, S2C } from '../src/net/protocol';

/**
 * The match server, end to end: a real `node server/index.mjs` on a real port with real
 * WebSocket clients driving it.
 *
 * Black box on purpose. The server is plain JavaScript outside the TypeScript project (it has
 * to be — it runs under Node, not Vite), so instead of importing it this test starts it the
 * way a player does and only ever speaks the wire protocol to it. That also means it is
 * testing the thing that actually ships, including the HTTP side and the `/ws` upgrade.
 *
 * `--port 0` lets the OS pick, so the suite never collides with a dev server somebody has
 * running.
 */

const ENTRY = fileURLToPath(new URL('../server/index.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

let server: ChildProcessWithoutNullStreams;
let port = 0;

/** Start the server and wait for it to say which port it bound. */
function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [ENTRY, '--port', '0'], { cwd: ROOT });
    const timer = setTimeout(() => reject(new Error('the match server did not start in time')), 10_000);
    server.stdout.on('data', (chunk: Buffer) => {
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    server.on('error', reject);
  });
}

/** A player: a socket plus every message it has been sent, so a test can wait on one. */
interface Client {
  socket: WebSocket;
  inbox: Array<Record<string, unknown>>;
  send(message: Record<string, unknown>): void;
  /** Resolve with the next message of this type to arrive, or the newest already waiting. */
  expect<T = Record<string, unknown>>(type: string, timeoutMs?: number): Promise<T>;
  /** Like `expect`, but ignores the backlog: only a message that arrives from now counts. */
  next<T = Record<string, unknown>>(type: string, timeoutMs?: number): Promise<T>;
  /** Every message of a type received so far. */
  all(type: string): Array<Record<string, unknown>>;
  close(): void;
}

const clients: Client[] = [];

/**
 * The room every `connect` in the current test lands in. A server now holds many rooms, so
 * each test gets its own code and `resetRoom` mints the next one: two tests can no longer see
 * each other's cars, and the first client of a test opens the room the rest join.
 */
let roomCode = '';
let roomCounter = 0;

/** A code from the legal alphabet, distinct per test. */
function nextRoomCode(): string {
  roomCounter++;
  let code = '';
  let n = roomCounter;
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    code = ROOM_CODE_ALPHABET[n % ROOM_CODE_ALPHABET.length] + code;
    n = Math.floor(n / ROOM_CODE_ALPHABET.length);
  }
  return code;
}

/**
 * Connect and say hello. `room` defaults to the current test's room, asked for with `create`
 * as well as `join`, so whoever gets there first opens it and everyone after joins it.
 */
async function connect(
  name: string,
  version = PROTOCOL_VERSION,
  room: { join?: string; create?: { label: string; listed: boolean } } = {
    join: roomCode,
    create: { label: `${roomCode} TEST`, listed: false },
  },
): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox: Array<Record<string, unknown>> = [];
  const waiters: Array<{ type: string; resolve: (message: Record<string, unknown>) => void }> = [];

  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as Record<string, unknown>;
    inbox.push(message);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].type === message.t) {
        waiters[i].resolve(message);
        waiters.splice(i, 1);
      }
    }
  });

  const client: Client = {
    socket,
    inbox,
    send(message) {
      socket.send(JSON.stringify(message));
    },
    expect(type, timeoutMs = 5000) {
      const waiting = inbox.filter((m) => m.t === type);
      if (waiting.length > 0) return Promise.resolve(waiting[waiting.length - 1] as never);
      return client.next(type, timeoutMs);
    },
    next(type, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no "${type}" arrived within ${timeoutMs} ms`)), timeoutMs);
        waiters.push({
          type,
          resolve: (message) => {
            clearTimeout(timer);
            resolve(message as never);
          },
        });
      });
    },
    all(type) {
      return inbox.filter((m) => m.t === type);
    },
    close() {
      socket.close();
    },
  };

  await new Promise<void>((resolve, reject) => {
    socket.on('open', resolve);
    socket.on('error', reject);
  });
  client.send({ t: C2S.hello, v: version, name, room: room.join ?? '', create: room.create });
  clients.push(client);
  return client;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Drop every client and move on to a fresh room, so each test starts from an empty lobby. */
async function resetRoom(): Promise<void> {
  for (const client of clients) client.close();
  clients.length = 0;
  roomCode = nextRoomCode();
  await sleep(120);
}

beforeAll(async () => {
  port = await startServer();
  roomCode = nextRoomCode();
}, 15_000);

afterAll(async () => {
  await resetRoom();
  server?.kill();
});

describe('joining', () => {
  it('welcomes a player and makes the first one the host', async () => {
    const juan = await connect('JUAN');
    const welcome = await juan.expect<{ id: string; now: number }>(S2C.welcome);
    expect(welcome.id).toBeTruthy();
    expect(welcome.now).toBeGreaterThan(0);

    const lobby = await juan.expect<{ phase: string; players: Array<{ name: string; host: boolean }> }>(S2C.lobby);
    expect(lobby.phase).toBe('lobby');
    expect(lobby.players).toHaveLength(1);
    expect(lobby.players[0]).toMatchObject({ name: 'JUAN', host: true, ready: false });
    await resetRoom();
  });

  it('tells everyone about everyone, and keeps the host as the first to arrive', async () => {
    const juan = await connect('JUAN');
    await juan.expect(S2C.welcome);
    const romeo = await connect('ROMEO');
    await romeo.expect(S2C.welcome);

    const lobby = await romeo.expect<{ players: Array<{ name: string; host: boolean }> }>(S2C.lobby);
    expect(lobby.players.map((p) => p.name)).toEqual(['JUAN', 'ROMEO']);
    expect(lobby.players.map((p) => p.host)).toEqual([true, false]);
    await resetRoom();
  });

  it('refuses a fifth car rather than silently overfilling the grid', async () => {
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const client = await connect(`DRIVER${i}`);
      await client.expect(S2C.welcome);
    }
    const extra = await connect('LATE');
    const refused = await extra.expect<{ reason: string; detail: string }>(S2C.refused);
    expect(refused.reason).toBe('full');
    expect(refused.detail).toContain(`${MAX_PLAYERS}/${MAX_PLAYERS}`);
    await resetRoom();
  });

  it('refuses a page speaking a different protocol', async () => {
    const stale = await connect('OLD', PROTOCOL_VERSION + 1);
    const refused = await stale.expect<{ reason: string }>(S2C.refused);
    expect(refused.reason).toBe('version');
    await resetRoom();
  });

  it('promotes the next player when the host leaves', async () => {
    const juan = await connect('JUAN');
    await juan.expect(S2C.welcome);
    const romeo = await connect('ROMEO');
    await romeo.expect(S2C.welcome);

    juan.close();
    await sleep(150);
    const lobby = romeo.all(S2C.lobby).pop() as { players: Array<{ name: string; host: boolean }> };
    expect(lobby.players).toHaveLength(1);
    expect(lobby.players[0]).toMatchObject({ name: 'ROMEO', host: true });
    await resetRoom();
  });
});

describe('starting a race', () => {
  it('only lets the host start it', async () => {
    const juan = await connect('JUAN');
    await juan.expect(S2C.welcome);
    const romeo = await connect('ROMEO');
    await romeo.expect(S2C.welcome);

    romeo.send({ t: C2S.start });
    await sleep(150);
    expect(romeo.all(S2C.match)).toHaveLength(0);

    juan.send({ t: C2S.start });
    const match = await romeo.expect<{ players: unknown[] }>(S2C.match);
    expect(match.players).toHaveLength(2);
    await resetRoom();
  });

  it('gives every car its own grid slot, in join order', async () => {
    const juan = await connect('JUAN');
    await juan.expect(S2C.welcome);
    const romeo = await connect('ROMEO');
    await romeo.expect(S2C.welcome);

    juan.send({ t: C2S.start });
    const match = await juan.expect<{
      raceId: number;
      laps: number;
      hostId: string;
      players: Array<{ name: string; slot: number }>;
    }>(S2C.match);

    expect(match.laps).toBeGreaterThan(0);
    expect(match.players.map((p) => p.name)).toEqual(['JUAN', 'ROMEO']);
    expect(match.players.map((p) => p.slot)).toEqual([0, 1]);
    // Both clients are told the same thing, or they would not agree about the grid.
    const theirs = await romeo.expect<{ raceId: number }>(S2C.match);
    expect(theirs.raceId).toBe(match.raceId);
    await resetRoom();
  });

  it('waits for every car to be built, then names one instant for GO', async () => {
    const juan = await connect('JUAN');
    await juan.expect(S2C.welcome);
    const romeo = await connect('ROMEO');
    await romeo.expect(S2C.welcome);

    juan.send({ t: C2S.start });
    const match = await juan.expect<{ raceId: number }>(S2C.match);
    await romeo.expect(S2C.match);

    // One client ready is not enough: the other is still building the circuit.
    juan.send({ t: C2S.loaded, raceId: match.raceId });
    await sleep(200);
    expect(juan.all(S2C.go)).toHaveLength(0);

    romeo.send({ t: C2S.loaded, raceId: match.raceId });
    const mine = await juan.expect<{ goAt: number; now: number; raceId: number }>(S2C.go);
    const theirs = await romeo.expect<{ goAt: number }>(S2C.go);

    expect(mine.raceId).toBe(match.raceId);
    // The same instant for both, in the future, and close enough to feel like a countdown.
    expect(theirs.goAt).toBe(mine.goAt);
    expect(mine.goAt - mine.now).toBeGreaterThan(1000);
    expect(mine.goAt - mine.now).toBeLessThan(10_000);
    await resetRoom();
  });
});

describe('racing', () => {
  /** Get two connected clients all the way to the green light. */
  async function grid(): Promise<{ host: Client; guest: Client; raceId: number }> {
    const host = await connect('JUAN');
    await host.expect(S2C.welcome);
    const guest = await connect('ROMEO');
    await guest.expect(S2C.welcome);
    host.send({ t: C2S.start });
    const match = await host.expect<{ raceId: number }>(S2C.match);
    await guest.expect(S2C.match);
    host.send({ t: C2S.loaded, raceId: match.raceId });
    guest.send({ t: C2S.loaded, raceId: match.raceId });
    await host.expect(S2C.go);
    await guest.expect(S2C.go);
    return { host, guest, raceId: match.raceId };
  }

  const car = { x: 12, z: -4, h: 1.2, vx: 20, vz: 0, sp: 20, sa: 0.1, la: 2, ga: 1, f: 1, ch: 0.5 };
  const race = { lap: 1, prog: 0.4, lapT: 20, best: -1, fin: -1, money: 300 };

  it('fans every car out to everyone on one timestamp', async () => {
    const { host, guest } = await grid();
    host.send({ t: C2S.car, c: car, r: race });
    guest.send({ t: C2S.car, c: { ...car, x: 40 }, r: { ...race, prog: 0.6 } });

    const snapshot = await guest.expect<{
      now: number;
      p: Array<{ id: string; c: typeof car; r: typeof race; at: number }>;
    }>(S2C.snapshot);
    expect(snapshot.now).toBeGreaterThan(0);
    // Every row says when that car's state reached the server, which is what the receivers
    // interpolate against; it can never be later than the snapshot itself.
    for (const row of snapshot.p) {
      expect(row.at).toBeGreaterThan(0);
      expect(row.at).toBeLessThanOrEqual(snapshot.now);
    }
    // A snapshot carries the whole field, this client included; the client drops its own row.
    await sleep(120);
    const latest = guest.all(S2C.snapshot).pop() as { p: Array<{ c: { x: number } }> };
    expect(latest.p).toHaveLength(2);
    expect(latest.p.map((row) => row.c.x).sort((a, b) => a - b)).toEqual([12, 40]);
    await resetRoom();
  });

  it('relays the host traffic to everyone else, and nobody else can publish it', async () => {
    const { host, guest } = await grid();
    host.send({ t: C2S.traffic, at: 123456, d: [1, 2, 3, 0, 4, 0, 0] });
    const traffic = await guest.expect<{ d: number[]; at: number }>(S2C.traffic);
    expect(traffic.d).toEqual([1, 2, 3, 0, 4, 0, 0]);
    // The host's own stamp of when the sample was taken rides along untouched.
    expect(traffic.at).toBe(123456);
    // The host is not sent its own traffic back.
    expect(host.all(S2C.traffic)).toHaveLength(0);

    guest.send({ t: C2S.traffic, at: 1, d: [9, 9, 9, 1, 0, 0, 0] });
    await sleep(150);
    expect(host.all(S2C.traffic)).toHaveLength(0);
    await resetRoom();
  });

  it('sends a claimed kill to the host, and only the host', async () => {
    const { host, guest } = await grid();
    guest.send({ t: C2S.hit, target: 7 });
    const hit = await host.expect<{ target: number }>(S2C.hit);
    expect(hit.target).toBe(7);
    expect(guest.all(S2C.hit)).toHaveLength(0);
    await resetRoom();
  });

  it('sends a reported shove to the host with the knock and when it happened', async () => {
    const { host, guest } = await grid();
    guest.send({ t: C2S.bump, target: 3, kx: 12.5, kz: -4, at: 777 });
    const bump = await host.expect<{ target: number; kx: number; kz: number; at: number }>(S2C.bump);
    expect(bump).toMatchObject({ target: 3, kx: 12.5, kz: -4, at: 777 });
    expect(guest.all(S2C.bump)).toHaveLength(0);
    // The host shoving its own traffic needs no relay: nothing comes back.
    host.send({ t: C2S.bump, target: 3, kx: 1, kz: 1, at: 778 });
    await sleep(120);
    expect(host.all(S2C.bump)).toHaveLength(1);
    await resetRoom();
  });

  it('classifies by finishing time once everyone is in', async () => {
    const { host, guest, raceId } = await grid();
    // Progress reports first, so the loser has something to be ranked on.
    host.send({ t: C2S.car, c: car, r: { ...race, prog: 1.9 } });
    guest.send({ t: C2S.car, c: car, r: { ...race, prog: 1.8 } });
    await sleep(100);

    guest.send({ t: C2S.finish, raceId, total: 91.5, best: 44.1 });
    await sleep(100);
    // One car home is not the end of the race.
    expect(host.all(S2C.results)).toHaveLength(0);

    host.send({ t: C2S.finish, raceId, total: 88.2, best: 43.0 });
    const results = await host.expect<{
      order: Array<{ name: string; total: number; best: number; finished: boolean }>;
    }>(S2C.results);
    expect(results.order.map((r) => r.name)).toEqual(['JUAN', 'ROMEO']);
    expect(results.order[0]).toMatchObject({ total: 88.2, best: 43, finished: true });
    await resetRoom();
  });

  it('ranks a car that never finished behind one that did, by how far it got', async () => {
    const { host, guest, raceId } = await grid();
    guest.send({ t: C2S.car, c: car, r: { ...race, prog: 1.2 } });
    await sleep(100);
    host.send({ t: C2S.finish, raceId, total: 90, best: 44 });
    // The only other car leaves without finishing: the race can be classified now.
    guest.close();

    const results = await host.expect<{ order: Array<{ name: string; finished: boolean }> }>(S2C.results);
    expect(results.order[0]).toMatchObject({ name: 'JUAN', finished: true });
    await resetRoom();
  });

  it('ignores a finish claimed for a race that is over', async () => {
    const { host, raceId } = await grid();
    host.send({ t: C2S.finish, raceId: raceId + 99, total: 1, best: 1 });
    await sleep(150);
    expect(host.all(S2C.results)).toHaveLength(0);
    await resetRoom();
  });

  it('goes back to the grid when the host asks for another race', async () => {
    const { host, guest, raceId } = await grid();
    host.send({ t: C2S.finish, raceId, total: 90, best: 44 });
    guest.send({ t: C2S.finish, raceId, total: 95, best: 46 });
    await host.expect(S2C.results);

    // `next`, not `expect`: the match that is already in the inbox is the one just finished.
    const pending = guest.next<{ raceId: number }>(S2C.match);
    host.send({ t: C2S.start });
    const again = await pending;
    expect(again.raceId).toBe(raceId + 1);
    await resetRoom();
  });
});

describe('the clock', () => {
  it('answers a ping with the stamp it was sent and the server time', async () => {
    const juan = await connect('JUAN');
    await juan.expect(S2C.welcome);
    juan.send({ t: C2S.ping, c: 1234.5 });
    const pong = await juan.expect<{ c: number; s: number }>(S2C.pong);
    expect(pong.c).toBe(1234.5);
    expect(Math.abs(pong.s - Date.now())).toBeLessThan(5000);
    await resetRoom();
  });
});

describe('http', () => {
  it('reports how many rooms are open', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; rooms: number };
    expect(body.ok).toBe(true);
    expect(body.rooms).toBeGreaterThanOrEqual(0);
  });

  it('refuses to serve anything outside the build directory', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/../package.json`);
    // Either a refusal or the game's own entry document — never the file that was asked for.
    const body = await response.text();
    expect(body).not.toContain('"devDependencies"');
  });
});

/**
 * Rooms. The point of the whole registry: two groups of friends on one server never see each
 * other, and a code is what gets you through a door rather than being first to the URL.
 */
describe('rooms', () => {
  interface Welcome {
    id: string;
    room: { code: string; label: string; listed: boolean };
  }

  it('opens the room the first player asked for and names it back', async () => {
    const code = nextRoomCode();
    const juan = await connect('JUAN', PROTOCOL_VERSION, {
      join: code,
      create: { label: 'JUAN ROOM', listed: false },
    });
    const welcome = await juan.expect<Welcome>(S2C.welcome);
    expect(welcome.room).toMatchObject({ code, label: 'JUAN ROOM', listed: false });
    await resetRoom();
  });

  it('refuses a code nobody is hosting instead of quietly opening it', async () => {
    const stranger = await connect('LOST', PROTOCOL_VERSION, { join: nextRoomCode() });
    const refused = await stranger.expect<{ reason: string; detail: string }>(S2C.refused);
    expect(refused.reason).toBe('missing');
    await resetRoom();
  });

  it('keeps two rooms apart: separate rosters, separate hosts', async () => {
    const mine = nextRoomCode();
    const theirs = nextRoomCode();
    const juan = await connect('JUAN', PROTOCOL_VERSION, { join: mine, create: { label: 'MINE', listed: false } });
    const romeo = await connect('ROMEO', PROTOCOL_VERSION, { join: mine });
    const stranger = await connect('STRANGER', PROTOCOL_VERSION, {
      join: theirs,
      create: { label: 'THEIRS', listed: false },
    });
    await Promise.all([juan.expect(S2C.welcome), romeo.expect(S2C.welcome), stranger.expect(S2C.welcome)]);
    await sleep(150);

    const ours = juan.all(S2C.lobby).pop() as { players: Array<{ name: string; host: boolean }> };
    expect(ours.players.map((p) => p.name)).toEqual(['JUAN', 'ROMEO']);
    // Being alone in another room makes you its host, not a guest in ours.
    const other = stranger.all(S2C.lobby).pop() as { players: Array<{ name: string; host: boolean }> };
    expect(other.players.map((p) => p.name)).toEqual(['STRANGER']);
    expect(other.players[0].host).toBe(true);

    // A race in one room is not a race in the other.
    juan.send({ t: C2S.start });
    await juan.expect(S2C.match);
    await sleep(150);
    expect(stranger.all(S2C.match)).toHaveLength(0);
    await resetRoom();
  });

  it('re-opens a room under the code a stale link names, rather than stranding the link', async () => {
    const code = nextRoomCode();
    const create = { label: 'REUSABLE', listed: false };
    const first = await connect('JUAN', PROTOCOL_VERSION, { join: code, create });
    await first.expect(S2C.welcome);
    // The same link again lands in the room that already exists, not in a second one.
    const second = await connect('ROMEO', PROTOCOL_VERSION, { join: code, create });
    const welcome = await second.expect<Welcome>(S2C.welcome);
    expect(welcome.room.code).toBe(code);
    const lobby = await second.expect<{ players: Array<{ name: string }> }>(S2C.lobby);
    expect(lobby.players.map((p) => p.name)).toEqual(['JUAN', 'ROMEO']);
    await resetRoom();
  });

  it('lists a public room and never a private one', async () => {
    const open = nextRoomCode();
    const hidden = nextRoomCode();
    const a = await connect('HOSTA', PROTOCOL_VERSION, { join: open, create: { label: 'OPEN HOUSE', listed: true } });
    const b = await connect('HOSTB', PROTOCOL_VERSION, { join: hidden, create: { label: 'BY INVITE', listed: false } });
    await Promise.all([a.expect(S2C.welcome), b.expect(S2C.welcome)]);

    const response = await fetch(`http://127.0.0.1:${port}/rooms`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rooms: Array<{ code: string; label: string; players: number; max: number; phase: string }>;
    };
    const listed = body.rooms.find((room) => room.code === open);
    expect(listed).toMatchObject({ label: 'OPEN HOUSE', players: 1, max: MAX_PLAYERS, phase: 'lobby' });
    // The private room is absent entirely: the list cannot leak a code.
    expect(body.rooms.some((room) => room.code === hidden)).toBe(false);
    await resetRoom();
  });
});
