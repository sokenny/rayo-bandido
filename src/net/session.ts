import type { RaceState, RivalCar, TargetState, VehicleState } from '../core/types';
import {
  C2S,
  S2C,
  SNAPSHOT_HZ,
  TRAFFIC_HZ,
  packCarFlags,
  type GoMessage,
  type BumpMessage,
  type HitMessage,
  type LobbyMessage,
  type MatchMessage,
  type ResultsMessage,
  type RoomEntry,
  type RoomInfo,
  type RoomPhase,
  type SnapshotMessage,
  type TrafficMessage,
  type WelcomeMessage,
  type WireCar,
  type WirePlayer,
  type WireRace,
} from './protocol';
import { createConnection, type Connection, type ConnectionStatus } from './connection';
import { createRivalSet, type RivalSet } from './rivals';
import { TRAFFIC_STRIDE } from '../sim/traffic';

/**
 * The multiplayer session: one object that owns the socket, the room as this client sees it,
 * and the rival cars.
 *
 * It is the whole of the network as far as the rest of the game is concerned. `src/main.ts`
 * drives the lobby through it, `src/ui/lobby.ts` renders it, and `src/game.ts` publishes the
 * local car into it and reads `rivals` back out. Nothing else imports anything from
 * `src/net/`, which keeps multiplayer a layer that can be absent: with no session, `createGame`
 * behaves exactly as it did before any of this existed.
 *
 * Publishing is throttled here rather than at the call site, so the game can simply hand over
 * the car every simulation tick and let the session decide what actually goes on the wire.
 */

export type SessionPhase = 'connecting' | RoomPhase | 'refused' | 'closed';

export interface NetPlayer extends WirePlayer {}

export interface NetMatch {
  raceId: number;
  laps: number;
  /** This client's grid slot. */
  slot: number;
  hostId: string;
  players: Array<{ id: string; name: string; slot: number }>;
}

/** What the game hands over each tick. One long-lived object; the session never keeps it. */
export interface CarPublish {
  vehicle: VehicleState;
  drifting: boolean;
  nitro: boolean;
  /** Lightning charge, 0..1. */
  charge: number;
  race: RaceState | null;
  /** Seconds into the current lap. The race state cannot derive this without the sim clock. */
  lapTime: number;
  money: number;
}

export interface NetSession {
  readonly status: ConnectionStatus;
  readonly problem: string;
  readonly rtt: number;
  readonly selfId: string;
  /** The room this session is in, known once the server has welcomed us. Null until then. */
  readonly room: RoomInfo | null;
  readonly phase: SessionPhase;
  readonly players: NetPlayer[];
  readonly self: NetPlayer | null;
  /** True for the player who starts matches and owns the electric-car traffic. */
  readonly isHost: boolean;
  readonly match: NetMatch | null;
  readonly results: ResultsMessage['order'] | null;
  /** Remote cars in the current match, in grid order. Empty until a match starts. */
  readonly rivals: RivalCar[];

  setName(name: string): void;
  setReady(ready: boolean): void;
  /** Host only; ignored by the server otherwise. */
  start(): void;
  /** The circuit is built and warmed up. */
  notifyLoaded(): void;

  /** Hand over the local car. Throttled to `SNAPSHOT_HZ` internally. */
  publishCar(input: CarPublish): void;
  /** Host only: hand over the electric cars. Throttled to `TRAFFIC_HZ`. */
  publishTraffic(targets: readonly TargetState[]): void;
  /** Non-host: tell the host an electric car was destroyed. */
  reportHit(targetId: number): void;
  /** Non-host: tell the host this car shoved an electric car, and by how much. */
  reportBump(targetId: number, kx: number, kz: number): void;
  reportFinish(total: number, bestLap: number): void;

  /** Best estimate of the server clock, in server ms. What every timestamp on the wire is in. */
  serverNow(): number;

  /**
   * Seconds from now until GO, on this client's clock. -1 until the server has announced it.
   * The race countdown is seeded from this so every grid launches together.
   */
  countdownSeconds(): number;

  onLobby(handler: () => void): () => void;
  onMatch(handler: (match: NetMatch) => void): () => void;
  onGo(handler: (seconds: number) => void): () => void;
  onResults(handler: (results: ResultsMessage['order']) => void): () => void;
  /**
   * Non-host: the host's authoritative traffic (flat, `TRAFFIC_STRIDE` numbers per car) and
   * the server time the host sampled it at.
   */
  onTraffic(handler: (data: number[], at: number) => void): () => void;
  /** Host: another player claims an electric car. */
  onHit(handler: (targetId: number) => void): () => void;
  /** Host: another player shoved an electric car. */
  onBump(handler: (bump: { target: number; kx: number; kz: number; at: number }) => void): () => void;

  /** Advance rival interpolation. Call once per simulation tick, before collision. */
  update(dt: number): void;
  /**
   * Re-place the rivals for a rendered frame and roll their wheels by `frameDt`. Rendering
   * can run faster than the simulation; without this a rival would only move on sim ticks.
   */
  interpolateRivals(frameDt: number): void;
  dispose(): void;
}

type Listener<T> = (value: T) => void;

function emitter<T>() {
  const set = new Set<Listener<T>>();
  return {
    add(handler: Listener<T>): () => void {
      set.add(handler);
      return () => set.delete(handler);
    },
    emit(value: T): void {
      for (const handler of set) handler(value);
    },
    clear(): void {
      set.clear();
    },
  };
}

export function createSession(name: string, entry: RoomEntry): NetSession {
  const connection: Connection = createConnection(name, entry);
  const lobbyEvents = emitter<void>();
  const matchEvents = emitter<NetMatch>();
  const goEvents = emitter<number>();
  const resultEvents = emitter<ResultsMessage['order']>();
  const trafficEvents = emitter<{ data: number[]; at: number }>();
  const hitEvents = emitter<number>();
  const bumpEvents = emitter<{ target: number; kx: number; kz: number; at: number }>();
  const unsubscribe: Array<() => void> = [];

  let selfId = '';
  let room: RoomInfo | null = null;
  let roomPhase: RoomPhase = 'lobby';
  let players: NetPlayer[] = [];
  let hostId = '';
  let match: NetMatch | null = null;
  let results: ResultsMessage['order'] | null = null;
  let rivalSet: RivalSet | null = null;
  let goAt = -1;
  /**
   * The tick length the publish throttles count in. Set by `update`, which the game calls once
   * per simulation tick just before it publishes, so the throttles advance on simulation time
   * like everything else rather than on a wall clock of their own.
   */
  let lastDt = 1 / 60;

  /** Publish accumulators, in seconds. */
  const carInterval = 1 / SNAPSHOT_HZ;
  const trafficInterval = 1 / TRAFFIC_HZ;
  let sinceCar = carInterval;
  let sinceTraffic = trafficInterval;

  // One wire object each, refilled in place: these are written 20 and 10 times a second.
  const wireCar: WireCar = { x: 0, z: 0, h: 0, vx: 0, vz: 0, sp: 0, sa: 0, la: 0, ga: 0, f: 0, ch: 0 };
  const wireRace: WireRace = { lap: 1, prog: 0, lapT: 0, best: -1, fin: -1, money: 0 };
  const trafficData: number[] = [];
  /** One object per traffic report, handed to `onTraffic` handlers and dropped. */
  const trafficReport = { data: trafficData, at: 0 };

  /** Two decimals is ~1 cm, far below anything visible, and keeps the JSON small. */
  const q = (value: number): number => Math.round(value * 100) / 100;
  /** Angles get one more digit: a hundredth of a radian is half a degree and would show. */
  const qa = (value: number): number => Math.round(value * 1000) / 1000;

  unsubscribe.push(
    connection.on<LobbyMessage>(S2C.lobby, (message) => {
      roomPhase = message.phase;
      players = message.players;
      hostId = message.hostId;
      if (roomPhase === 'lobby') {
        // Back in the lobby: the previous match's cars are gone.
        match = null;
        rivalSet = null;
        goAt = -1;
      }
      lobbyEvents.emit();
    }),
  );

  unsubscribe.push(
    connection.on<MatchMessage>(S2C.match, (message) => {
      const mine = message.players.find((p) => p.id === selfId);
      match = {
        raceId: message.raceId,
        laps: message.laps,
        slot: mine ? mine.slot : 0,
        hostId: message.hostId,
        players: message.players,
      };
      results = null;
      goAt = -1;
      rivalSet = createRivalSet(message.players.filter((p) => p.id !== selfId));
      sinceCar = carInterval;
      sinceTraffic = trafficInterval;
      matchEvents.emit(match);
    }),
  );

  unsubscribe.push(
    connection.on<GoMessage>(S2C.go, (message) => {
      goAt = message.goAt;
      goEvents.emit(Math.max(0, (goAt - connection.serverNow()) / 1000));
    }),
  );

  unsubscribe.push(
    connection.on<SnapshotMessage>(S2C.snapshot, (message) => {
      if (!rivalSet) return;
      for (const row of message.p) {
        if (row.id === selfId) continue;
        // Interpolate against when the car's state reached the server, not when this
        // snapshot left it; see `SnapshotMessage`.
        rivalSet.apply(row.id, row.at || message.now, row.c, row.r ?? null);
      }
    }),
  );

  unsubscribe.push(
    connection.on<TrafficMessage>(S2C.traffic, (message) => {
      trafficReport.data = message.d;
      trafficReport.at = message.at || message.now;
      trafficEvents.emit(trafficReport);
    }),
  );
  unsubscribe.push(connection.on<HitMessage>(S2C.hit, (message) => hitEvents.emit(message.target)));
  unsubscribe.push(
    connection.on<BumpMessage>(S2C.bump, (message) =>
      bumpEvents.emit({ target: message.target, kx: message.kx, kz: message.kz, at: message.at }),
    ),
  );

  unsubscribe.push(
    connection.on<ResultsMessage>(S2C.results, (message) => {
      results = message.order;
      resultEvents.emit(message.order);
    }),
  );

  unsubscribe.push(
    connection.on<WelcomeMessage>(S2C.welcome, (message) => {
      selfId = message.id;
      room = message.room ?? null;
      lobbyEvents.emit();
    }),
  );

  unsubscribe.push(connection.onStatus(() => lobbyEvents.emit()));

  const session: NetSession = {
    get status() {
      return connection.status;
    },
    get problem() {
      return connection.problem;
    },
    get rtt() {
      return connection.rtt;
    },
    get selfId() {
      return selfId;
    },
    get room() {
      return room;
    },
    get phase() {
      if (connection.status === 'refused') return 'refused';
      if (connection.status === 'closed') return 'closed';
      if (connection.status === 'connecting' || !selfId) return 'connecting';
      return roomPhase;
    },
    get players() {
      return players;
    },
    get self() {
      return players.find((p) => p.id === selfId) ?? null;
    },
    get isHost() {
      return selfId !== '' && selfId === hostId;
    },
    get match() {
      return match;
    },
    get results() {
      return results;
    },
    get rivals() {
      return rivalSet ? rivalSet.all : EMPTY_RIVALS;
    },

    setName(next) {
      connection.send({ t: C2S.name, name: next });
    },
    setReady(ready) {
      connection.send({ t: C2S.ready, ready });
    },
    start() {
      connection.send({ t: C2S.start });
    },
    notifyLoaded() {
      if (!match) return;
      connection.send({ t: C2S.loaded, raceId: match.raceId });
    },

    publishCar(input) {
      sinceCar += lastDt;
      if (sinceCar < carInterval) return;
      sinceCar = 0;
      const v = input.vehicle;
      wireCar.x = q(v.x);
      wireCar.z = q(v.z);
      wireCar.h = qa(v.heading);
      wireCar.vx = q(v.vx);
      wireCar.vz = q(v.vz);
      wireCar.sp = q(v.speed);
      wireCar.sa = qa(v.steerAngle);
      wireCar.la = q(v.latAccel);
      wireCar.ga = q(v.longAccel);
      wireCar.f = packCarFlags(input.drifting, input.nitro, v.brakeApplied > 0 && v.speed > 0.5, v.speed < -0.5);
      wireCar.ch = q(input.charge);

      const race = input.race;
      wireRace.lap = race ? race.lap : 1;
      wireRace.prog = race ? q(race.progress) : 0;
      wireRace.lapT = q(input.lapTime);
      wireRace.best = race ? q(race.bestLap) : -1;
      wireRace.fin = race ? q(race.finishTime) : -1;
      wireRace.money = input.money;
      connection.send({ t: C2S.car, c: wireCar, r: wireRace });
    },

    publishTraffic(targets) {
      sinceTraffic += lastDt;
      if (sinceTraffic < trafficInterval) return;
      sinceTraffic = 0;
      trafficData.length = 0;
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        trafficData.push(q(t.x), q(t.z), qa(t.heading), t.status === 'active' ? 0 : 1, t.patrolIndex, q(t.vx), q(t.vz));
      }
      if (trafficData.length !== targets.length * TRAFFIC_STRIDE) throw new Error('traffic stride mismatch');
      connection.send({ t: C2S.traffic, at: Math.round(connection.serverNow()), d: trafficData });
    },

    reportHit(targetId) {
      connection.send({ t: C2S.hit, target: targetId });
    },

    reportBump(targetId, kx, kz) {
      connection.send({ t: C2S.bump, target: targetId, kx: q(kx), kz: q(kz), at: Math.round(connection.serverNow()) });
    },

    serverNow() {
      return connection.serverNow();
    },

    reportFinish(total, bestLap) {
      if (!match) return;
      connection.send({ t: C2S.finish, raceId: match.raceId, total, best: bestLap });
    },

    countdownSeconds() {
      if (goAt < 0) return -1;
      return Math.max(0, (goAt - connection.serverNow()) / 1000);
    },

    onLobby: lobbyEvents.add,
    onMatch: matchEvents.add,
    onGo: goEvents.add,
    onResults: resultEvents.add,
    onTraffic(handler) {
      return trafficEvents.add((report) => handler(report.data, report.at));
    },
    onHit: hitEvents.add,
    onBump: bumpEvents.add,

    update(dt) {
      lastDt = dt;
      if (rivalSet) rivalSet.interpolate(connection.serverNow());
    },

    interpolateRivals(frameDt) {
      if (!rivalSet) return;
      rivalSet.interpolate(connection.serverNow());
      rivalSet.spin(frameDt);
    },

    dispose() {
      for (const off of unsubscribe) off();
      unsubscribe.length = 0;
      lobbyEvents.clear();
      matchEvents.clear();
      goEvents.clear();
      resultEvents.clear();
      trafficEvents.clear();
      hitEvents.clear();
      bumpEvents.clear();
      connection.close();
    },
  };

  return session;
}

const EMPTY_RIVALS: RivalCar[] = [];
