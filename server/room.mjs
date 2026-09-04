import { C2S, MAX_PLAYERS, PROTOCOL_VERSION, S2C, sanitizeName } from './protocol.mjs';

/**
 * A match room: up to `MAX_PLAYERS` cars, one race at a time.
 *
 * A server holds many of these at once — `server/rooms.mjs` owns the registry and hands a
 * socket to one of them at `hello`. Nothing in here knows about any other room, which is the
 * point: a room is the whole world as far as the players inside it are concerned.
 *
 * WHAT THE SERVER OWNS
 *  - the roster, the ready flags and who the host is (the longest-connected player),
 *  - the clock: it decides the instant GO happens and tells every client in server time, so
 *    the grid launches together no matter how far apart the players are,
 *  - the phase machine below, and the classification at the flag.
 *
 * WHAT IT DOES NOT OWN
 *  - any physics. Cars arrive already simulated by the client that drives them and are fanned
 *    back out untouched. See the trust model in `src/net/protocol.ts`.
 *  - the electric-car traffic, which belongs to the host client and is only relayed here, so
 *    the server never needs to know what the circuit looks like.
 *
 * PHASES
 *   lobby -> loading -> countdown -> racing -> results -> lobby | loading
 *
 *   `loading` waits for every racer to report a built and warmed-up circuit (or for
 *   `LOAD_TIMEOUT_MS`, so one broken client cannot hold the grid). `countdown` is the window
 *   between announcing GO and reaching it. `results` stays up until the host starts again.
 */

/** Longest wait for the slowest client to build the circuit before starting without it. */
const LOAD_TIMEOUT_MS = 20_000;
/**
 * From announcing GO to GO itself. The clients' own countdown is `RACE.countdownSeconds`
 * (3 s); the extra 600 ms is slack for the message to land and the frame loop to spin up, and
 * a client that gets it late simply shows a shorter countdown — GO is the same instant for
 * everybody either way.
 */
const COUNTDOWN_LEAD_MS = 3600;
/** After the first car takes the flag, how long the rest have before they are classified. */
const FINISH_GRACE_MS = 60_000;
/** A race with nobody left in it is abandoned rather than left running forever. */
const EMPTY_RACE_MS = 5_000;

export function createRoom({ code = '----', label = 'BANDIDO ROOM', listed = false, laps = 2, log: rawLog = () => {} } = {}) {
  /** Every line a room prints says which room it came from: one process, many rooms. */
  const log = (msg) => rawLog(`${code} · ${msg}`);
  /** @type {Map<string, any>} */
  const players = new Map();
  let phase = 'lobby';
  let nextId = 1;
  let raceId = 0;
  let goAt = 0;
  let loadingSince = 0;
  let firstFinishAt = 0;
  let emptyRaceSince = 0;

  const now = () => Date.now();

  /* --------------------------------------------------------------- plumbing */

  function send(player, message) {
    try {
      player.send(JSON.stringify(message));
    } catch {
      // A socket that cannot be written to is already closing; `leave` will clean it up.
    }
  }

  function broadcast(message, exceptId = null) {
    const encoded = JSON.stringify(message);
    for (const p of players.values()) {
      if (p.id === exceptId) continue;
      try {
        p.send(encoded);
      } catch {
        /* see send() */
      }
    }
  }

  /** Join order decides the host, so the room never argues about who is in charge. */
  function ordered() {
    return [...players.values()].sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
  }

  function hostId() {
    const first = ordered()[0];
    return first ? first.id : '';
  }

  function wirePlayers() {
    const host = hostId();
    return ordered().map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      slot: p.slot,
      host: p.id === host,
      finished: p.finished,
    }));
  }

  function pushLobby() {
    broadcast({ t: S2C.lobby, phase, players: wirePlayers(), hostId: hostId() });
  }

  /* ----------------------------------------------------------------- phases */

  function startMatch() {
    const grid = ordered();
    if (grid.length === 0) return;
    raceId++;
    phase = 'loading';
    loadingSince = now();
    firstFinishAt = 0;
    emptyRaceSince = 0;
    grid.forEach((p, i) => {
      p.slot = i;
      p.loaded = false;
      p.finished = false;
      p.ready = false;
      p.car = null;
      p.carAt = 0;
      p.race = null;
      p.result = null;
    });
    const host = hostId();
    broadcast({
      t: S2C.match,
      raceId,
      laps,
      hostId: host,
      players: grid.map((p) => ({ id: p.id, name: p.name, slot: p.slot })),
    });
    pushLobby();
    log(`match ${raceId} starting with ${grid.length} car(s)`);
  }

  function announceGo() {
    phase = 'countdown';
    goAt = now() + COUNTDOWN_LEAD_MS;
    broadcast({ t: S2C.go, raceId, goAt, now: now() });
    log(`match ${raceId} go in ${COUNTDOWN_LEAD_MS} ms`);
  }

  function classify() {
    const rows = ordered().map((p) => ({
      id: p.id,
      name: p.name,
      total: p.result ? p.result.total : -1,
      best: p.result ? p.result.best : p.race ? p.race.best : -1,
      prog: p.race ? p.race.prog : 0,
      money: p.race ? p.race.money : 0,
      finished: !!p.result,
    }));
    // Whoever took the flag, by time; then whoever got furthest.
    rows.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.total - b.total;
      return b.prog - a.prog;
    });
    return rows;
  }

  function endRace() {
    phase = 'results';
    broadcast({ t: S2C.results, raceId, order: classify() });
    pushLobby();
    log(`match ${raceId} classified`);
  }

  /** Racers still out on the circuit. */
  function running() {
    return ordered().filter((p) => p.slot >= 0 && !p.result);
  }

  /* --------------------------------------------------------------- messages */

  function handle(player, msg) {
    switch (msg.t) {
      case C2S.name:
        if (phase === 'lobby' || phase === 'results') {
          player.name = sanitizeName(msg.name, player.name);
          pushLobby();
        }
        break;

      case C2S.ready:
        player.ready = !!msg.ready;
        pushLobby();
        break;

      case C2S.start:
        // Only the host starts, and only from a screen where nobody is driving.
        if (player.id === hostId() && (phase === 'lobby' || phase === 'results')) startMatch();
        break;

      case C2S.loaded:
        if (phase === 'loading' && msg.raceId === raceId) {
          player.loaded = true;
          if (ordered().every((p) => p.loaded || p.slot < 0)) announceGo();
        }
        break;

      case C2S.car:
        // Kept for the next snapshot rather than relayed, so bandwidth stays flat in the
        // number of players and every rival in a snapshot shares one timestamp.
        if (msg.c) {
          player.car = msg.c;
          player.race = msg.r ?? player.race;
          // When it arrived, which is what the receivers interpolate against: the fan-out
          // timer below is not in step with any client's publish timer.
          player.carAt = now();
        }
        break;

      case C2S.traffic:
        // The host is authoritative for the electric cars; everyone else just receives them.
        if (player.id === hostId() && (phase === 'racing' || phase === 'countdown')) {
          broadcast({ t: S2C.traffic, now: now(), at: Number(msg.at) || now(), d: msg.d }, player.id);
        }
        break;

      case C2S.hit: {
        // A kill claimed by a non-host, forwarded to the host to apply for real.
        const host = players.get(hostId());
        if (host && host.id !== player.id) send(host, { t: S2C.hit, target: msg.target });
        break;
      }

      case C2S.bump: {
        // Same again for a shove: the host owns the traffic, so the host does the shoving.
        const host = players.get(hostId());
        if (host && host.id !== player.id) {
          send(host, { t: S2C.bump, target: msg.target, kx: Number(msg.kx) || 0, kz: Number(msg.kz) || 0, at: Number(msg.at) || now() });
        }
        break;
      }

      case C2S.finish:
        if (msg.raceId !== raceId || player.result) break;
        player.result = { total: Number(msg.total), best: Number(msg.best) };
        player.finished = true;
        if (firstFinishAt === 0) firstFinishAt = now();
        pushLobby();
        if (running().length === 0) endRace();
        break;

      case C2S.ping:
        send(player, { t: S2C.pong, c: msg.c, s: now() });
        break;

      default:
        break;
    }
  }

  /* ------------------------------------------------------------------- room */

  return {
    get code() {
      return code;
    },
    get label() {
      return label;
    },
    get listed() {
      return listed;
    },
    get phase() {
      return phase;
    },
    get size() {
      return players.size;
    },

    /** One row of `GET /rooms`, and what `welcome` says about the room a socket landed in. */
    listing() {
      return { code, label, listed, players: players.size, max: MAX_PLAYERS, phase };
    },

    /**
     * Attach a socket. `sendRaw` writes one already-encoded string. Returns the player, or
     * null when the room refused the connection (it has already been told why).
     */
    join(sendRaw, hello) {
      if (hello.v !== PROTOCOL_VERSION) {
        sendRaw(
          JSON.stringify({
            t: S2C.refused,
            reason: 'version',
            detail: `server speaks protocol ${PROTOCOL_VERSION}, this page speaks ${hello.v}. Reload the page.`,
          }),
        );
        return null;
      }
      if (players.size >= MAX_PLAYERS) {
        sendRaw(
          JSON.stringify({
            t: S2C.refused,
            reason: 'full',
            detail: `the room is full (${MAX_PLAYERS}/${MAX_PLAYERS}). Try again when a race ends.`,
          }),
        );
        return null;
      }

      const player = {
        id: `p${nextId++}`,
        name: sanitizeName(hello.name),
        send: sendRaw,
        joinedAt: now(),
        ready: false,
        slot: -1,
        loaded: false,
        finished: false,
        car: null,
        carAt: 0,
        race: null,
        result: null,
      };
      players.set(player.id, player);
      send(player, { t: S2C.welcome, id: player.id, now: now(), room: { code, label, listed } });
      pushLobby();
      log(`${player.name} (${player.id}) joined — ${players.size}/${MAX_PLAYERS}`);
      return player;
    },

    message(playerId, raw) {
      const player = players.get(playerId);
      if (!player) return;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // Not our protocol; ignore rather than drop the socket.
      }
      if (!msg || typeof msg.t !== 'string') return;
      handle(player, msg);
    },

    leave(playerId) {
      const player = players.get(playerId);
      if (!player) return;
      players.delete(playerId);
      log(`${player.name} (${player.id}) left — ${players.size}/${MAX_PLAYERS}`);
      if (players.size === 0) {
        phase = 'lobby';
        return;
      }
      // A departure can be the last thing a race was waiting for.
      if (phase === 'loading' && ordered().every((p) => p.loaded || p.slot < 0)) announceGo();
      else if ((phase === 'racing' || phase === 'countdown') && running().length === 0) endRace();
      else pushLobby();
    },

    /** Drives the snapshot fan-out and the phase timers. Call at `SNAPSHOT_HZ`. */
    tick() {
      const t = now();

      if (phase === 'loading' && t - loadingSince > LOAD_TIMEOUT_MS) announceGo();
      if (phase === 'countdown' && t >= goAt) {
        phase = 'racing';
        pushLobby();
      }
      if (phase === 'racing') {
        if (running().length === 0) endRace();
        else if (firstFinishAt > 0 && t - firstFinishAt > FINISH_GRACE_MS) endRace();
      }
      // Everyone closed their tab mid-race: do not leave the room stuck in `racing`.
      if (phase === 'racing' || phase === 'countdown') {
        if (players.size === 0) {
          if (emptyRaceSince === 0) emptyRaceSince = t;
          else if (t - emptyRaceSince > EMPTY_RACE_MS) phase = 'lobby';
        } else {
          emptyRaceSince = 0;
        }
      }

      if (phase !== 'racing' && phase !== 'countdown') return;
      const rows = [];
      for (const p of ordered()) {
        if (p.slot < 0 || !p.car) continue;
        rows.push({ id: p.id, c: p.car, r: p.race, at: p.carAt });
      }
      if (rows.length > 0) broadcast({ t: S2C.snapshot, now: t, p: rows });
    },
  };
}
