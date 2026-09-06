import * as THREE from 'three';
import { createArenaWorld } from './world/arenaWorld';
import { createCityWorld } from './world/cityWorld';
import { createRaceWorld } from './world/raceWorld';
import type { GameEvent, GameMode, GameState, HudSnapshot, PlayerCommand, RaceHudSnapshot, Transmission } from './core/types';
import { AUDIO, SIM_STEP, CAMERA, LIGHTNING, NITRO, RENDER, VEHICLE } from './config/tuning';
import { createTrafficSync } from './sim/traffic';
import { createRivalCarVisual, disposeRivalCarResources, type RivalCarVisual } from './render/scene/rivalCarVisual';
import { createNameTags, type NameTags } from './render/nameTags';
import { createStandings, rankStandings, type Standings, type StandingsRow } from './ui/standings';
import type { CarPublish, NetSession } from './net/session';
import { createGameLoop, type GameLoop } from './core/loop';
import { createKeyboardInput, createPlayerCommand } from './core/input/keyboard';
import { createGamepadInput } from './core/input/gamepad';
import { combineInputs } from './core/input/combine';
import { createInitialGameState, stepGame, type StepOptions } from './sim/gameState';
import { createCruiseController } from './sim/cruise';
import { shiftKickStrength } from './sim/drivetrain';
import { createRenderer } from './render/renderer';
import { createSpeedBlur, speedBlurStrength } from './render/post/speedBlur';
import { createEnvironment } from './render/scene/environment';
import { createCarVisual } from './render/scene/carVisual';
import { createElectricCarVisual, disposeElectricCarResources, type ElectricCarVisual } from './render/scene/electricCarVisual';
import { createBusVisual, type BusVisual } from './render/scene/busVisual';
import { createChaseCamera, type CameraPose, type CameraView } from './render/camera/chaseCamera';
import { createEffects } from './render/fx';
import { interpolateVehicle, syncBuses, syncCar, syncTargets, type InterpolatedPose } from './render/sync';
import { createGpuTimer } from './render/gpuTimer';
import { createResolutionGovernor } from './render/adaptiveResolution';
import { compileScene, warmRender } from './render/warmup';
import { createHud } from './ui/hud';
import { createTouchControls } from './ui/touchControls';
import { installLandscapeLock, isTouchDevice, viewportHeight, viewportWidth } from './ui/viewport';
import { createMinimap } from './ui/minimap';
import { createDebugOverlay, type DebugFrameInput } from './ui/debugOverlay';
import type { LoadingScreen } from './ui/loadingScreen';
import { createThemeAudio } from './audio/theme';
import { createAudio } from './audio';
import { createBackfireTrigger } from './audio/backfire';
import { msToKmh } from './core/math';
import { slotCss } from './core/playerColors';

/**
 * Composition root. Wires input -> simulation -> presentation without letting any of
 * those layers know about each other. Exposes `window.__rb` for browser automation/QA.
 *
 * START-UP (see `src/main.ts`): `createGame` builds everything synchronously, `warmUp` then
 * pays every one-time GPU cost behind the loading screen (shader compiles, texture uploads,
 * the environment cubemaps), and only then does `start` begin the frame loop. Each stage is
 * bracketed with `performance.mark/measure` so `npm run perf` can report where the time went.
 */
export interface Game {
  /**
   * Compile every shader and upload every buffer before the first visible frame. Optional
   * but strongly recommended: without it the first drift, boost and shot each hitch.
   */
  warmUp(loading?: LoadingScreen): Promise<void>;
  start(): void;
  stop(): void;
  dispose(): void;
  readonly state: GameState;
  readonly loop: GameLoop;
}

/**
 * Multiplayer, if this is a networked race. Absent in single player, and every use of it
 * below is guarded: the game runs exactly as it did before multiplayer existed when it is
 * null, which is what keeps one code path for both.
 */
export interface GameOptions {
  net?: NetSession | null;
}

/** Metres past the last gate a multiplayer respawn puts the car (see `respawnAtLastGate`). */
const RESPAWN_AHEAD = 6;

/** `performance.measure` wrapper: start a mark and return a function that closes it. */
function measure(name: string): () => void {
  const startMark = `rb:${name}:start`;
  performance.mark(startMark);
  return () => {
    performance.measure(`rb:${name}`, startMark);
  };
}

export function createGame(
  canvas: HTMLCanvasElement,
  hudRoot: HTMLElement,
  debugRoot: HTMLElement,
  mode: GameMode = 'test',
  options: GameOptions = {},
): Game {
  const endTotal = measure('create');
  const params = new URLSearchParams(location.search);

  // The world: the free-roam test city or the racing circuit. Both give the simulation a
  // layout (colliders, spawns, patrols, the race course) and the renderer a plan (the art).
  // In a match every client must generate the same traffic, so the match id is the seed;
  // alone, `createRaceWorld` picks its own and the traffic is laid out differently each race.
  const world = mode === 'race' ? createRaceWorld(options.net?.match?.raceId) : mode === 'city' ? createCityWorld() : createArenaWorld();
  const layout = world.layout;

  /* ------------------------------------------------------------- multiplayer */

  const net = options.net ?? null;
  const match = net?.match ?? null;
  // The grid slot the server gave us becomes the spawn, so the whole rest of the game — the
  // initial state, the restart, the camera snap — needs to know nothing about multiplayer.
  if (match && layout.race && layout.race.grid.length > 0) {
    const slot = layout.race.grid[match.slot % layout.race.grid.length];
    layout.playerSpawn = { x: slot.x, z: slot.z, heading: slot.heading };
  }
  /** True for the client that owns the electric-car traffic for this match. */
  const ownsTraffic = !!net && net.isHost;

  const state = createInitialGameState(layout, readTransmission());
  const command: PlayerCommand = createPlayerCommand();
  // On a phone the picture is turned sideways for as long as this game lives, so the renderer
  // below is sized for the landscape layer rather than for the portrait window.
  const releaseLandscape = installLandscapeLock();
  // Keyboard, pad and — on a touch screen — the thumb pad are all always live; whichever the
  // player touches drives the car.
  const input = combineInputs(
    createKeyboardInput(window),
    createGamepadInput(),
    ...(isTouchDevice() ? [createTouchControls()] : []),
  );

  let end = measure('renderer');
  const renderer = createRenderer(canvas);
  end();
  // Nitro speed blur. Transparent when the boost is cold: it just calls renderer.render().
  const speedBlur = createSpeedBlur(renderer);
  const gpuTimer = createGpuTimer(renderer);
  const scene = new THREE.Scene();

  end = measure('environment');
  const environment = createEnvironment(scene, world.plan);
  end();

  end = measure('vehicles');
  // In a match the car wears its grid slot's colour, the colour every other screen draws it in.
  const car = createCarVisual(match ? { slot: match.slot } : {});
  scene.add(car.root);
  const targetVisuals: ElectricCarVisual[] = [];
  for (let i = 0; i < state.targets.length; i++) {
    const vis = createElectricCarVisual(i);
    scene.add(vis.root);
    targetVisuals.push(vis);
  }
  // The city's buses. Nothing shoots or shoves them, so unlike the electric cars they are
  // plain scenery that happens to move: no status, no acquisition ring.
  const busVisuals: BusVisual[] = [];
  for (let i = 0; i < state.buses.length; i++) {
    const vis = createBusVisual();
    scene.add(vis.root);
    busVisuals.push(vis);
  }
  // One car per rival, in grid order, added now so the warm-up compiles them too — a rival
  // appearing in your mirrors must not be the frame that compiles its shader.
  const rivals = net ? net.rivals : [];
  const rivalVisuals: RivalCarVisual[] = [];
  for (let i = 0; i < rivals.length; i++) {
    const vis = createRivalCarVisual(rivals[i].slot);
    scene.add(vis.root);
    rivalVisuals.push(vis);
  }
  end();

  const chase = createChaseCamera(viewportWidth() / viewportHeight());

  end = measure('effects');
  const effects = createEffects(scene);
  end();

  end = measure('audio');
  const audio = createAudio(state.targets.length);
  // Background theme song. Loops quietly under the game.
  // Autoplay policy: it stays silent until the first key press / click (see arm()).
  const theme = createThemeAudio();
  theme.arm(window);
  end();

  end = measure('hud');
  const hud = createHud(hudRoot, mode, !!match);
  const minimap = createMinimap(hudRoot, layout.minimap, layout.race, match ? slotCss(match.slot) : undefined);
  const debug = createDebugOverlay(debugRoot, params.has('debug'));
  // Live classification and floating names, only when there is a field to classify.
  const lapLength = layout.race ? layout.race.path.length : 0;
  const standings: Standings | null = match ? createStandings(hudRoot, lapLength, rivals.length + 1) : null;
  const nameTags: NameTags | null = rivals.length > 0 ? createNameTags(hudRoot, rivals) : null;
  end();

  /* ------------------------------------------------------------ render scale */

  // Starts where `createRenderer` put it; the governor only ever moves it from there.
  const startRatio = renderer.getPixelRatio();
  const governor = createResolutionGovernor({
    startRatio,
    minRatio: Math.min(startRatio, RENDER.minPixelRatio),
    stepFactor: RENDER.resolutionStep,
    downMs: RENDER.resolutionDownMs,
    upMs: RENDER.resolutionUpMs,
    gpuUpMs: RENDER.resolutionGpuUpMs,
    gpuIdleMs: RENDER.resolutionGpuIdleMs,
    downWindowSeconds: RENDER.resolutionDownWindow,
    upWindowSeconds: RENDER.resolutionUpWindow,
    settleSeconds: RENDER.resolutionSettle,
    hitchMs: RENDER.resolutionHitchMs,
    enabled: RENDER.adaptiveResolution,
  });

  function applyPixelRatio(ratio: number): void {
    renderer.setPixelRatio(ratio);
    renderer.setSize(viewportWidth(), viewportHeight(), false);
  }

  // `?scale=1` pins the render scale for A/B testing and screenshots.
  const scaleParam = Number(params.get('scale'));
  if (scaleParam > 0) {
    governor.set(scaleParam, true);
    applyPixelRatio(governor.ratio);
  }

  const pose: InterpolatedPose = { x: 0, y: 0, z: 0, heading: 0 };
  const cameraPose: CameraPose = { x: 0, y: 0, z: 0, heading: 0, roadPitch: 0, vx: 0, vz: 0, speed: 0, slipAngle: 0, nitro: 0, drifting: false, roll: 0, pitch: 0 };
  const snapshot: HudSnapshot = {
    speedKmh: 0,
    nitro: 1,
    nitroActive: false,
    charge: 0,
    canFire: false,
    drifting: false,
    driftDuration: 0,
    chain: 0,
    money: 0,
    destroyed: 0,
    nearMisses: 0,
    targetsRemaining: 0,
    targetsTotal: state.targets.length,
    targetAcquired: false,
    lastReward: 0,
    time: 0,
    reversing: false,
    cooldown01: 0,
    chainWindow: 0,
    nitroRecharging: false,
    cruising: false,
    rpm01: 0,
    gear: 0,
    torqueBand: false,
    manual: state.transmission === 'manual',
    steer: 0,
    counterSteer: 0,
    mode,
    race: null,
  };
  const raceSnapshot: RaceHudSnapshot = {
    phase: 'countdown',
    countdown: 0,
    lap: 1,
    laps: 1,
    elapsed: 0,
    lapTime: 0,
    lastLap: -1,
    bestLap: -1,
    finishTime: -1,
    wrongWay: false,
    lapFraction: 0,
  };
  if (state.race) snapshot.race = raceSnapshot;
  const debugInput: DebugFrameInput = { simMs: 0, renderMs: 0, gpuMs: -1, pixelRatio: startRatio, governor: governor.status };
  let lastNitroAmount = state.nitro.amount;
  let nitroVisual = 0;
  /* The gear the body has already been shoved for. A shift is an event, not a state, and the
   * simulation may run several ticks between frames — comparing the gear the body knows about
   * with the one the car is in catches the change whatever the frame rate is doing. */
  let bodyGear = state.vehicle.gear;
  let simTime = 0;
  let ready = false;
  // Exhaust pops. One trigger feeds both the bang and the flame so they land on the same frame.
  const backfire = createBackfireTrigger();
  /** Last frame's `limiterCut`, so each fuel cut cracks the exhaust once on its leading edge. */
  let prevLimiterCut = 0;

  /**
   * Cruise mode (C): the autopilot replaces the keyboard as the command source, so the car is
   * still driven by the same physics - it just stops being driven by a person. Touching any
   * driving control hands it straight back; `armed` makes sure a key that was already held
   * when cruise was switched on does not cancel it on the very next tick.
   */
  const cruiseControl = createCruiseController(layout.cruiseRoute);
  let cruising = false;
  let cruiseArmed = false;

  function setCruise(on: boolean): void {
    if (on === cruising) return;
    cruising = on;
    if (on) {
      cruiseControl.reset(state.vehicle);
      cruiseArmed = false;
    }
  }

  /** The transmission choice outlives the session: a player who learned manual keeps it. */
  function readTransmission(): Transmission {
    try {
      return localStorage.getItem('rb.transmission') === 'manual' ? 'manual' : 'auto';
    } catch {
      return 'auto';
    }
  }
  function saveTransmission(mode: Transmission): void {
    try {
      localStorage.setItem('rb.transmission', mode);
    } catch {
      /* storage unavailable: the choice lasts the session */
    }
  }

  function isDriving(cmd: PlayerCommand): boolean {
    return cmd.throttle > 0 || cmd.brake > 0 || cmd.steer !== 0 || cmd.handbrake || cmd.nitro;
  }

  /* ------------------------------------------------------------- multiplayer */

  const trafficSync = net ? createTrafficSync(state.targets.length) : null;
  /** The newest traffic report from the host, folded in on the next tick, and when it was taken. */
  let pendingTraffic: readonly number[] | null = null;
  let pendingTrafficAt = 0;
  /** Kills other players claim, applied by the host on the next tick. */
  const pendingHits: number[] = [];
  /** Shoves other players report, applied by the host on the next tick. */
  const pendingBumps: Array<{ target: number; kx: number; kz: number; at: number }> = [];
  /** Scratch list for `trafficSync.apply`; reused so a report never allocates. */
  const newlyDestroyed: number[] = [];
  /** What `stepGame` needs to know about the match. One object, never reallocated. */
  const stepOptions: StepOptions = { rivals: net ? net.rivals : null, respawnTraffic: !net || ownsTraffic, cruising: false };
  /**
   * How long a non-host keeps its own kill after the host's reports stop agreeing with it.
   * A round trip plus a couple of traffic intervals covers any connection worth racing on.
   */
  const KILL_HOLD_SECONDS = 1.5;
  /** Same for a shove, sized to the connection: a round trip plus two traffic intervals. */
  const bumpHoldSeconds = (): number => Math.min(0.9, Math.max(0.35, Math.max(0, net?.rtt ?? 0) / 1000 + 0.25));
  const netCleanup: Array<() => void> = [];
  if (net) {
    netCleanup.push(
      net.onTraffic((data, at) => {
        pendingTraffic = data;
        pendingTrafficAt = at;
      }),
    );
    netCleanup.push(
      net.onHit((targetId) => {
        if (ownsTraffic) pendingHits.push(targetId);
      }),
    );
    netCleanup.push(
      net.onBump((bump) => {
        if (ownsTraffic) pendingBumps.push(bump);
      }),
    );
  }

  // One long-lived object handed to the session every tick; it is read and dropped, never kept.
  const publish: CarPublish = {
    vehicle: state.vehicle,
    drifting: false,
    nitro: false,
    charge: 0,
    race: state.race,
    lapTime: 0,
    money: 0,
  };
  /** The flag is reported once; a re-crossing after the finish must not report it again. */
  let reportedFinish = false;

  /**
   * Classification rows, allocated once. `standingsRows` keeps the fixed order the rows were
   * built in — index 0 is the local player, then one per rival — because that is what says
   * which row belongs to whom. `standingsOrder` holds the same objects and is what gets
   * sorted, so ranking never destroys the mapping it was read through.
   */
  const standingsRows: StandingsRow[] = [];
  const standingsOrder: StandingsRow[] = [];
  if (match) {
    standingsRows.push({
      name: net?.self?.name ?? 'YOU',
      slot: match.slot,
      progress: 0,
      gap: 0,
      self: true,
      finished: false,
      finishTime: -1,
    });
    for (const rival of rivals) {
      standingsRows.push({
        name: rival.name,
        slot: rival.slot,
        progress: 0,
        gap: 0,
        self: false,
        finished: false,
        finishTime: -1,
      });
    }
    standingsOrder.push(...standingsRows);
  }

  /** Re-read every car's race progress, rank the field and work out the gaps. */
  function updateStandings(): void {
    if (standingsRows.length === 0) return;
    const race = state.race;
    const mine = standingsRows[0];
    mine.progress = race ? race.progress : 0;
    mine.finished = !!race && race.phase === 'finished';
    mine.finishTime = race ? race.finishTime : -1;
    for (let i = 0; i < rivals.length; i++) {
      const row = standingsRows[i + 1];
      const rival = rivals[i];
      row.progress = rival.progress;
      row.finished = rival.finishTime >= 0;
      row.finishTime = rival.finishTime;
    }
    rankStandings(standingsOrder, lapLength);
  }

  /**
   * Multiplayer respawn (R). A full restart would put this client back on the grid while
   * everyone else kept racing, so in a match R is repurposed rather than removed: it is a
   * rescue from a wall, not a new attempt. The car reappears just past the last gate it
   * cleared, pointing down the lap, with the race clock still running.
   */
  function respawnAtLastGate(): void {
    const race = state.race;
    const course = layout.race;
    if (!race || !course || course.gates.length === 0) return;
    const gate = course.gates[(race.nextGate - 1 + course.gates.length) % course.gates.length];
    const v = state.vehicle;
    // Past the gate rather than on it, so driving away cannot re-trigger the crossing.
    v.x = v.prevX = (gate.ax + gate.bx) / 2 + gate.fx * RESPAWN_AHEAD;
    v.z = v.prevZ = (gate.az + gate.bz) / 2 + gate.fz * RESPAWN_AHEAD;
    v.y = v.prevY = 0;
    v.pitch = 0;
    v.heading = v.prevHeading = Math.atan2(gate.fx, -gate.fz);
    v.vx = 0;
    v.vz = 0;
    v.speed = 0;
    v.lateralSpeed = 0;
    v.yawRate = 0;
    v.slipAngle = 0;
    v.steerAngle = 0;
    car.resetBody();
    bodyGear = v.gear;
    effects.reset();
    backfire.reset();
    prevLimiterCut = 0;
    fillCameraPose(1);
    chase.snap(cameraPose);
  }

  function handleEvent(ev: GameEvent): void {
    if (ev.type === 'transmission') saveTransmission(ev.mode);
    hud.onEvent(ev);
    audio.onEvent(ev);
    switch (ev.type) {
      case 'lightningFired':
        effects.lightning(ev.fromX, ev.fromY, ev.fromZ, ev.toX, ev.toY, ev.toZ);
        chase.shake(CAMERA.shakeLightning);
        break;
      case 'targetDestroyed':
        effects.explosion(ev.x, ev.y, ev.z);
        if (ev.reward > 0) effects.scorePopup(ev.x, ev.y, ev.z, ev.reward);
        // The kill happened here, but the host is the one everybody believes about traffic:
        // tell the host, and do not let its next few reports bring the car back meanwhile.
        if (net && trafficSync && !ownsTraffic) {
          trafficSync.claimKill(ev.targetId, state.time, KILL_HOLD_SECONDS);
          net.reportHit(ev.targetId);
        }
        break;
      case 'raceFinish':
        if (net && !reportedFinish) {
          reportedFinish = true;
          net.reportFinish(ev.total, ev.bestLap);
        }
        break;
      case 'nearMiss':
        effects.nearMissPopup(ev.x, ev.y, ev.z, ev.points);
        break;
      case 'collision':
        effects.collision(ev.x, ev.y, ev.z, ev.impact);
        chase.shake(Math.min(0.3, ev.impact * CAMERA.shakeCollisionPerImpact));
        // Shoved an electric car: the shove is real here now, and the host is asked to
        // repeat it so it is real everywhere. Same hold as a kill, so the host's reports do
        // not slide the car back onto the bonnet before its own copy of the shove lands.
        if (net && trafficSync && !ownsTraffic && ev.targetId !== undefined) {
          trafficSync.claimBump(ev.targetId, state.time, bumpHoldSeconds());
          net.reportBump(ev.targetId, ev.knockX ?? 0, ev.knockZ ?? 0);
        }
        break;
      case 'restart':
        effects.reset();
        backfire.reset();
    prevLimiterCut = 0;
        car.resetBody();
        bodyGear = state.vehicle.gear;
        // The car is back at the spawn: pick up the route from there.
        if (cruising) cruiseControl.reset(state.vehicle);
        interpolateVehicle(state.vehicle, 1, pose);
        fillCameraPose(1);
        chase.snap(cameraPose);
        break;
      default:
        break;
    }
  }

  function fillCameraPose(alpha: number): void {
    const v = state.vehicle;
    interpolateVehicle(v, alpha, pose);
    cameraPose.x = pose.x;
    cameraPose.y = pose.y;
    cameraPose.z = pose.z;
    cameraPose.heading = pose.heading;
    cameraPose.roadPitch = v.pitch;
    cameraPose.vx = v.vx;
    cameraPose.vz = v.vz;
    cameraPose.speed = v.speed;
    cameraPose.slipAngle = v.slipAngle;
    cameraPose.nitro = nitroVisual;
    cameraPose.drifting = state.drift.active;
    // The bolted-on views lean with the bodywork; `chassis` already holds this frame's
    // spring angles because `car.update()` ran before the camera does.
    cameraPose.roll = car.chassis.rotation.z;
    cameraPose.pitch = car.chassis.rotation.x;
  }

  function simulate(dt: number): void {
    input.poll(command);

    if (net && trafficSync) {
      // Rivals first: everything after this — collision, the camera, the standings — should
      // see the same instant of them.
      net.update(dt);
      if (command.restart) {
        // R is a rescue in a match, never a restart. See `respawnAtLastGate`.
        command.restart = false;
        respawnAtLastGate();
      }
      if (pendingTraffic) {
        newlyDestroyed.length = 0;
        trafficSync.apply(state.targets, pendingTraffic, pendingTrafficAt, state.time, newlyDestroyed);
        pendingTraffic = null;
        for (let i = 0; i < newlyDestroyed.length; i++) {
          const t = state.targets[newlyDestroyed[i]];
          effects.explosion(t.x, t.y, t.z);
        }
      }
      while (ownsTraffic && pendingHits.length > 0) {
        const id = pendingHits.shift() as number;
        if (trafficSync.destroy(state.targets, id, state.time)) {
          const t = state.targets[id];
          effects.explosion(t.x, t.y, t.z);
        }
      }
      while (ownsTraffic && pendingBumps.length > 0) {
        const bump = pendingBumps.shift() as { target: number; kx: number; kz: number; at: number };
        trafficSync.bump(state.targets, bump.target, bump.kx, bump.kz, (net.serverNow() - bump.at) / 1000);
      }
    }

    if (command.pov) chase.cycleView();
    if (command.cruise) setCruise(!cruising);
    if (cruising) {
      const driving = isDriving(command);
      if (!driving) cruiseArmed = true;
      if (driving && cruiseArmed) setCruise(false);
      else cruiseControl.step(state.vehicle, command, dt);
    }
    stepOptions.cruising = cruising;
    stepGame(state, command, layout, dt, stepOptions);
    simTime = state.time;
    const events = state.events;
    for (let i = 0; i < events.length; i++) handleEvent(events[i]);

    if (net && trafficSync) {
      // The host publishes the traffic it owns; everyone else eases theirs onto it, and
      // remembers where it stands so the next report can be compared with the right instant.
      if (ownsTraffic) {
        net.publishTraffic(state.targets);
      } else {
        trafficSync.correct(state.targets, dt);
        trafficSync.record(state.targets, net.serverNow());
      }

      // `resetGameState` swaps these objects out, so they are re-read rather than captured.
      publish.vehicle = state.vehicle;
      publish.race = state.race;
      publish.drifting = state.drift.active;
      publish.nitro = state.nitro.active;
      publish.charge = state.lightning.charge / LIGHTNING.capacity;
      publish.lapTime = state.race && state.race.phase === 'racing' ? state.time - state.race.lapStart : 0;
      publish.money = state.economy.money;
      net.publishCar(publish);
    }
  }

  function render(alpha: number, frameDt: number): void {
    // Last frame's main-thread cost; this frame's is not known until it ends.
    const stats = loop.stats;
    const gpuMs = gpuTimer.available ? gpuTimer.ms : -1;
    const next = governor.update(frameDt * 1000, stats.simMs + stats.renderMs, gpuMs);
    if (next !== null) applyPixelRatio(next);

    const v = state.vehicle;
    nitroVisual += ((state.nitro.active ? 1 : 0) - nitroVisual) * Math.min(1, frameDt * 8);
    fillCameraPose(alpha);
    syncCar(car, v, pose);
    car.setNitro(nitroVisual);
    car.setCharge(state.lightning.charge / LIGHTNING.capacity);
    car.setBrakeLights(v.brakeApplied > 0 && v.speed > 0.5);
    car.setReverseLights(v.speed < -0.5);
    car.setBodyAccel(v.latAccel, v.longAccel);
    // The cabin's spectrum display. `theme.spectrum` is one array mutated in place, so this
    // is a reference hand-off, not a copy, and it stays live for every later frame.
    car.setMusic(theme.spectrum);
    if (v.gear !== bodyGear) {
      car.shiftKick(shiftKickStrength(v, bodyGear));
      bodyGear = v.gear;
    }
    car.update(frameDt, simTime);
    syncTargets(targetVisuals, state.targets, alpha, state.lightning.acquiredTargetId, simTime);
    for (let i = 0; i < targetVisuals.length; i++) targetVisuals[i].update(frameDt, simTime);
    syncBuses(busVisuals, state.buses, alpha);
    // Rivals carry their own interpolation (on the network clock), so unlike everything else
    // here they are not blended by `alpha` — they are re-placed for this very frame instead,
    // which is what keeps them moving every frame on a display faster than the simulation.
    if (net) net.interpolateRivals(frameDt);
    for (let i = 0; i < rivalVisuals.length; i++) {
      rivalVisuals[i].sync(rivals[i]);
      rivalVisuals[i].update(frameDt, simTime);
    }
    effects.setCarPose(pose, v, state.drift.active, nitroVisual, frameDt);
    effects.update(frameDt, simTime);
    theme.update(frameDt);
    environment.update(frameDt, simTime);
    chase.update(cameraPose, frameDt);
    audio.update(
      frameDt,
      {
        rpm01: v.rpm01,
        speed: v.speed,
        throttle: v.throttleApplied,
        brake: v.brakeApplied,
        nitro: state.nitro.active,
        limiterCut: v.limiterCut,
      },
      pose,
      state.targets,
      { lateralSpeed: v.lateralSpeed, speed: v.speed, drifting: state.drift.active, wheelspin: v.wheelspin },
    );

    // Pops and bangs: one decision, fired into the audio and the tailpipes together. Banging
    // off the limiter owns the exhaust while it lasts: every fuel cut spits its own crack, on
    // the same frame the note is gated, and the ordinary backfire trigger stays out of the way.
    const cutBang = v.limiterCut > 0 && prevLimiterCut === 0 ? AUDIO.limiterCutBang : 0;
    prevLimiterCut = v.limiterCut;
    // `tick` is still advanced every frame so its lift-off detector never sees a stale throttle.
    const trigger = backfire.tick(frameDt, v.speed, v.rpm01, v.throttleApplied, state.nitro.active);
    const bang = Math.max(cutBang, trigger);
    if (bang > 0) {
      audio.backfire(bang);
      effects.backfire(bang);
    }

    snapshot.speedKmh = Math.abs(msToKmh(v.speed));
    snapshot.nitro = state.nitro.amount / NITRO.capacity;
    snapshot.nitroActive = state.nitro.active;
    snapshot.charge = state.lightning.charge / LIGHTNING.capacity;
    snapshot.canFire = state.lightning.charge >= LIGHTNING.cost;
    snapshot.drifting = state.drift.active;
    snapshot.driftDuration = state.drift.duration;
    snapshot.chain = state.drift.chain;
    snapshot.money = state.economy.money;
    snapshot.destroyed = state.economy.destroyed;
    snapshot.nearMisses = state.nearMiss.count;
    let remaining = 0;
    for (let i = 0; i < state.targets.length; i++) if (state.targets[i].status === 'active') remaining++;
    snapshot.targetsRemaining = remaining;
    snapshot.targetsTotal = state.targets.length;
    snapshot.targetAcquired = state.lightning.acquiredTargetId >= 0;
    snapshot.lastReward = state.economy.lastReward;
    snapshot.time = simTime;
    snapshot.reversing = v.speed < -0.5;
    snapshot.cooldown01 = LIGHTNING.cooldown > 0 ? state.lightning.cooldown / LIGHTNING.cooldown : 0;
    snapshot.chainWindow = state.drift.active ? 0 : state.drift.chainWindow;
    snapshot.nitroRecharging = !state.nitro.active && state.nitro.amount > lastNitroAmount + 1e-6;
    snapshot.cruising = cruising;
    // The tachometer reads the simulation's engine, the same one the exhaust note revs on.
    snapshot.gear = v.gear;
    snapshot.rpm01 = v.rpm01;
    snapshot.torqueBand = state.drift.active;
    snapshot.manual = state.transmission === 'manual';
    snapshot.steer = v.steerAngle / VEHICLE.maxSteerAngle;
    snapshot.counterSteer = v.counterSteer;
    lastNitroAmount = state.nitro.amount;
    const race = state.race;
    if (race) {
      raceSnapshot.phase = race.phase;
      raceSnapshot.countdown = race.countdown;
      raceSnapshot.lap = race.lap;
      raceSnapshot.laps = race.laps;
      raceSnapshot.elapsed = race.elapsed;
      raceSnapshot.lapTime = race.phase === 'racing' ? simTime - race.lapStart : race.phase === 'finished' ? race.lastLap : 0;
      raceSnapshot.lastLap = race.lastLap;
      raceSnapshot.bestLap = race.bestLap;
      raceSnapshot.finishTime = race.finishTime;
      raceSnapshot.wrongWay = race.wrongWay;
      raceSnapshot.lapFraction = race.progress - Math.floor(race.progress);
    }
    hud.update(snapshot);
    minimap.update(pose.x, pose.z, pose.heading, state.targets, rivals);
    if (standings) {
      updateStandings();
      standings.update(standingsOrder);
    }
    if (nameTags) nameTags.update(chase.camera, rivals);

    gpuTimer.begin();
    speedBlur.render(scene, chase.camera, speedBlurStrength(nitroVisual, v.speed));
    gpuTimer.end();

    debugInput.simMs = stats.simMs;
    debugInput.renderMs = stats.renderMs;
    debugInput.gpuMs = gpuMs;
    debugInput.pixelRatio = renderer.getPixelRatio();
    debugInput.governor = governor.status;
    debug.update(frameDt, renderer, debugInput);
  }

  const loop = createGameLoop({ simulate, render }, SIM_STEP);

  function onResize(): void {
    applyPixelRatio(governor.ratio);
    chase.resize(viewportWidth() / viewportHeight());
  }
  window.addEventListener('resize', onResize);

  // Click-and-drag look. Dragging on the canvas orbits the chase camera around the car; the
  // angle is held briefly after release and then recentres (see `chaseCamera.look`). Touch
  // drags are ignored so the on-screen driving controls keep their gestures.
  let lookPointer: number | null = null;
  let lookX = 0;
  let lookY = 0;

  function preventDefault(e: Event): void {
    e.preventDefault();
  }

  function onLookDown(e: PointerEvent): void {
    if (lookPointer !== null || e.pointerType === 'touch' || e.button > 1) return;
    lookPointer = e.pointerId;
    lookX = e.clientX;
    lookY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    chase.setDragging(true);
  }

  function onLookMove(e: PointerEvent): void {
    if (e.pointerId !== lookPointer) return;
    chase.look(-(e.clientX - lookX) * CAMERA.dragYawPerPixel, (e.clientY - lookY) * CAMERA.dragPitchPerPixel);
    lookX = e.clientX;
    lookY = e.clientY;
  }

  function onLookUp(e: PointerEvent): void {
    if (e.pointerId !== lookPointer) return;
    lookPointer = null;
    chase.setDragging(false);
  }

  canvas.addEventListener('pointerdown', onLookDown);
  canvas.addEventListener('pointermove', onLookMove);
  canvas.addEventListener('pointerup', onLookUp);
  canvas.addEventListener('pointercancel', onLookUp);
  canvas.addEventListener('contextmenu', preventDefault);

  // Initial camera placement.
  fillCameraPose(1);
  chase.snap(cameraPose);
  endTotal();

  const game: Game = {
    state,
    loop,
    async warmUp(loading) {
      const target = { renderer, scene, camera: chase.camera };
      loading?.set('COMPILING SHADERS', 0.5);
      await loading?.paint();
      let endStage = measure('compile');
      await compileScene(target);
      endStage();

      loading?.set('WARMING UP', 0.8);
      await loading?.paint();
      endStage = measure('portrait');
      await environment.ready;
      endStage();
      endStage = measure('warm-render');
      warmRender(target);
      speedBlur.warm();
      endStage();
      loading?.set('READY', 1);
      ready = true;
    },
    start() {
      // Starting without `warmUp` (the `?nowarm` A/B) is a deliberate cold start: the game is
      // as ready as it is going to get, so automation must not wait any longer.
      ready = true;
      // In a match the countdown is the server's, not ours: it is however long is left until
      // the instant the server picked for GO, so every grid launches together however long
      // each client took to get here.
      if (net && state.race) {
        const remaining = net.countdownSeconds();
        if (remaining >= 0) state.race.countdown = remaining;
      }
      loop.start();
    },
    stop() {
      loop.stop();
    },
    dispose() {
      loop.stop();
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onLookDown);
      canvas.removeEventListener('pointermove', onLookMove);
      canvas.removeEventListener('pointerup', onLookUp);
      canvas.removeEventListener('pointercancel', onLookUp);
      canvas.removeEventListener('contextmenu', preventDefault);
      releaseLandscape();
      for (const off of netCleanup) off();
      netCleanup.length = 0;
      input.dispose();
      theme.dispose();
      hud.dispose();
      minimap.dispose();
      standings?.dispose();
      nameTags?.dispose();
      debug.dispose();
      audio.dispose();
      effects.dispose();
      for (const t of targetVisuals) t.dispose();
      for (const b of busVisuals) b.dispose();
      disposeElectricCarResources();
      for (const r of rivalVisuals) r.dispose();
      disposeRivalCarResources();
      car.dispose();
      environment.dispose();
      speedBlur.dispose();
      gpuTimer.dispose();
      renderer.dispose();
    },
  };

  // Automation / QA hook. Not part of gameplay.
  (window as unknown as { __rb: unknown }).__rb = {
    mode,
    state,
    layout,
    command,
    /** Multiplayer, for automation: the rival cars as this client currently sees them. */
    multiplayer: !!net,
    rivals,
    /** Grid slot and paint of the local car, and the paint of each rival, for the colour QA. */
    selfSlot: match ? match.slot : null,
    selfColour: car.paint,
    rivalColours: rivals.map((r) => ({ id: r.id, slot: r.slot, colour: slotCss(r.slot) })),
    metrics: debug.metrics,
    renderer,
    scene,
    camera: chase.camera,
    audio,
    theme,
    /** True once the warm-up has finished and the loop may run without first-use hitches. */
    ready() {
      return ready && loop.running;
    },
    /** Render scale controls: read with no argument, pin with one. */
    scale(ratio?: number) {
      if (ratio !== undefined) {
        governor.set(ratio, true);
        applyPixelRatio(governor.ratio);
      }
      return { ratio: renderer.getPixelRatio(), status: governor.status };
    },
    /** Override the keyboard for one or more ticks (used by browser automation). */
    inject(partial: Partial<PlayerCommand>, ticks = 1) {
      injectQueue.push({ partial, ticks });
    },
    /** Camera view. Reads the live view with no argument, cuts to one with an argument. */
    view(next?: CameraView) {
      if (next) chase.setView(next);
      return chase.view;
    },
    /** Cruise mode. Reads the flag with no argument, sets it with one. */
    cruise(on?: boolean) {
      if (on !== undefined) setCruise(on);
      return cruising;
    },
    /** Waypoint index cruise mode is currently driving to. */
    cruiseWaypoint() {
      return cruiseControl.waypoint;
    },
    /** Simulation ticks still queued by `inject` (0 when idle). */
    pending() {
      let n = 0;
      for (const q of injectQueue) n += q.ticks;
      return n;
    },
    /**
     * Advance the simulation `ticks` fixed steps and render one frame, independent of the
     * animation loop. For automation in throttled/background tabs and deterministic scripts.
     */
    step(ticks = 1) {
      for (let i = 0; i < ticks; i++) simulate(SIM_STEP);
      render(1, SIM_STEP);
      return state.time;
    },
    /** Put the car at a pose (heading in radians, 0 = north) at rest, and snap the camera to it. */
    teleport(x: number, z: number, heading: number, y = 0) {
      const v = state.vehicle;
      v.x = v.prevX = x;
      v.z = v.prevZ = z;
      v.y = v.prevY = y;
      v.pitch = 0;
      v.heading = v.prevHeading = heading;
      v.vx = v.vz = v.speed = v.lateralSpeed = v.yawRate = v.slipAngle = 0;
      if (cruising) cruiseControl.reset(v);
      fillCameraPose(1);
      chase.snap(cameraPose);
    },
  };
  const injectQueue: Array<{ partial: Partial<PlayerCommand>; ticks: number }> = [];
  const originalPoll = input.poll;
  input.poll = (out) => {
    originalPoll.call(input, out);
    if (injectQueue.length > 0) {
      const head = injectQueue[0];
      Object.assign(out, head.partial);
      head.ticks--;
      if (head.ticks <= 0) injectQueue.shift();
    }
  };

  return game;
}
