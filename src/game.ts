import * as THREE from 'three';
import { createArenaWorld } from './world/arenaWorld';
import { createCityWorld } from './world/cityWorld';
import { addCircuitGate } from './world/cityCircuitGate';
import { addStreetSites } from './world/cityStreetSites';
import { createStreetWorld } from './world/streetWorld';
import { spawnForSlot } from './world/arrivals';
import { createCircuitWorld } from './world/circuitWorld';
import { createRaceWorld } from './world/raceWorld';
import type {
  ActivityMarkKind,
  ActivitySite,
  BuhoHudSnapshot,
  GameEvent,
  GameMode,
  GameState,
  HudSnapshot,
  PassengerHudSnapshot,
  PassengerStop,
  PlayerCommand,
  CircuitGateHudSnapshot,
  StreetGateHudSnapshot,
  StreetRaceHudSnapshot,
  RaceHudSnapshot,
  RivalCar,
  RushHudSnapshot,
  TimeAttackHudSnapshot,
  Transmission, PoliceHudSnapshot } from './core/types';
import { ATMOSPHERE, AUDIO, SIM_STEP, CAMERA, FLAIR, LIGHTNING, MOOGUL, NITRO, PASSENGER, RENDER, RUSH, STREET_RACE, TIME_ATTACK, VEHICLE, POLICE } from './config/tuning';
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
import {
  canStartRush,
  markRushTargets,
  rushAllClear,
  rushLevelCount,
  rushLevelIndex,
  rushSiteFor,
  rushTargetScore,
  setRushProgress,
} from './sim/rush';
import {
  readRideProgress,
  readRushProgress,
  readTimeAttackProgress,
  recordRide,
  recordRushRun,
  recordTimeAttackRun,
  writeRideProgress,
  writeRushProgress,
  writeTimeAttackProgress,
} from './core/progress';
import {
  setTimeAttackProgress,
  timeAttackAllClear,
  timeAttackLevel,
  timeAttackLevelCount,
  timeAttackLevelIndex,
} from './sim/timeAttack';
import { canEnterCircuit } from './sim/circuitGate';
import { canEnterStreetRace, streetEventOpen, streetNewestEvent } from './sim/streetGate';
import {
  createStreetRaceState,
  interpolateStreetRivals,
  rankingProgress,
  resetStreetRace,
  snapStreetRivals,
  stepStreetRace,
  streetEvent,
  streetPosition,
  type StreetRaceState,
} from './sim/streetRace';
import { readStreetRaceProgress, recordStreetRace, writeStreetRaceProgress } from './core/progress';
import { readIntroProgress, writeIntroProgress } from './core/progress';
import { activitySuppressed, engagedActivity, introEngaged, type ActivityKind } from './sim/activities';
import { INTRO } from './content/intro';
import { acceptIntroAssist, finishIntroCinematic, finishIntroOpening, installIntroMeetup, skipIntro, skipIntroLine } from './sim/intro';
import { createHumanFigure, type HumanFigureVisual } from './render/scene/env/humanFigure';
import { createIntroOverlay, type IntroOverlay, type IntroOverlaySnapshot } from './ui/introOverlay';
import { canAffordShot } from './sim/lightning';
import { MESSAGES as FLAIR_MESSAGES, flairSeconds } from './sim/flair';
import { canBoard, canDropOff, stopById } from './sim/passenger';
import { PASSENGERS, passengerById, preferenceLabel } from './content/passengers';
import { createPassengerMarker } from './render/scene/env/passengerMarker';
import { createPassengerFigure } from './render/scene/env/passengerFigure';
import { createDestinationArrow } from './render/scene/env/destinationArrow';
import { aimAlong, buildRoadGraph, createRouteAim, routeTo } from './world/roadGraph';
import type { RoadGraph, RouteField } from './world/roadGraph';
import { canBuyMoogul, endMoogul, grantMoogul, moogulIntensity } from './sim/buho';
import { BUHO } from './content/buho';
import { createBuhoFigure } from './render/scene/env/buhoFigure';
import { createMoogulTrip } from './render/scene/moogulTrip';
import { createLeaderboard } from './net/leaderboard';
import { shiftKickStrength } from './sim/drivetrain';
import { createRenderer } from './render/renderer';
import { createSpeedBlur, speedBlurStrength } from './render/post/speedBlur';
import { createEnvironment } from './render/scene/environment';
import { createCarVisual } from './render/scene/carVisual';
import { createElectricCarVisual, disposeElectricCarResources, type ElectricCarVisual } from './render/scene/electricCarVisual';
import { createPoliceCarVisual, disposePoliceCarResources, type PoliceCarVisual } from './render/scene/policeCarVisual';
import { isPoliceEnabledForCurrentGameState } from './sim/police';
import { createBusVisual, type BusVisual } from './render/scene/busVisual';
import { createChaseCamera, type CameraPose, type CameraView } from './render/camera/chaseCamera';
import { createWorldProbe } from './render/probe';
import { createEffects } from './render/fx';
import { interpolateVehicle, syncBuses, syncCar, syncPolice, syncTargets, type InterpolatedPose } from './render/sync';
import { createGpuTimer } from './render/gpuTimer';
import { createResolutionGovernor } from './render/adaptiveResolution';
import { compileScene, warmRender } from './render/warmup';
import { createHud } from './ui/hud';
import { createTouchControls } from './ui/touchControls';
import { installLandscapeLock, isTouchDevice, viewportHeight, viewportWidth } from './ui/viewport';
import { createMinimap } from './ui/minimap';
import { createOnlinePanel, type OnlinePanel } from './ui/onlinePanel';
import { createDebugOverlay, clipboardLine, type DebugFrameInput, type WorldReadout } from './ui/debugOverlay';
import type { LoadingScreen } from './ui/loadingScreen';
import { createThemeAudio } from './audio/theme';
import { createAudio, type PoliceAudioInput } from './audio';
import { createBackfireTrigger } from './audio/backfire';
import { msToKmh } from './core/math';
import { slotCss } from './core/playerColors';
import { MAX_WORLD_PLAYERS } from './net/protocol';

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
  /**
   * Take the player to the circuit missions. Raised when the key is pressed on the start line
   * in the open world (`src/sim/circuitGate.ts`), and left to the caller because leaving one
   * world for another is `src/main.ts`'s business — it is the only thing here that knows what
   * an address is. Omitted in worlds without the door, where it can never fire.
   */
  onEnterCircuit?: () => void;
  /** Take the player to a STREET RACE event. Raised by the rings in the open world. */
  onEnterStreetRace?: (event: number) => void;
}

/** Metres past the last gate a multiplayer respawn puts the car (see `rescue`). */
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
  // `?atmos=low|medium|high` pins the atmosphere quality for a capture or a bug report, the
  // way `?scale=` pins the render scale. Read before the world, because the environment picks
  // its sky preset the moment it is built and never revisits it.
  const atmosParam = params.get('atmos');
  if (atmosParam === 'low' || atmosParam === 'medium' || atmosParam === 'high' || atmosParam === 'auto') {
    ATMOSPHERE.quality = atmosParam;
  }

  const world =
    mode === 'race'
      ? createRaceWorld(options.net?.match?.raceId)
      : mode === 'circuit'
        ? createCircuitWorld(options.net?.match?.raceId)
        : mode === 'street'
          ? // The Street Race's own instance of the city (`src/world/streetWorld.ts`).
            createStreetWorld()
        : mode === 'city'
          ? // The open world, with a way onto the circuit painted on its start line. A layer over
            // the city rather than a part of it (`src/world/cityCircuitGate.ts`), for the same
            // reason the circuit itself is one: the city does not know the race exists.
            addStreetSites(addCircuitGate(createCityWorld()))
          : createArenaWorld();
  const layout = world.layout;

  /* ------------------------------------------------------------- multiplayer */

  const net = options.net ?? null;
  const match = net?.match ?? null;
  /**
   * True in the open world: a room with no match in it. Everything networked below is shared with a
   * race — the same snapshots, the same interpolation, the same host-owned traffic — and the
   * only differences are that the field can change while you drive and that nothing is being
   * timed.
   */
  const roaming = !!net && net.isWorld;
  // The grid slot the server gave us becomes the spawn, so the whole rest of the game — the
  // initial state, the restart, the camera snap — needs to know nothing about multiplayer.
  if (match && layout.race && layout.race.grid.length > 0) {
    const slot = layout.race.grid[match.slot % layout.race.grid.length];
    layout.playerSpawn = { x: slot.x, z: slot.z, heading: slot.heading };
  } else if (roaming && net) {
    // The city has one spawn and no grid, so the slot fans the arrivals out around it —
    // otherwise every car that joins materialises inside the last one.
    layout.playerSpawn = spawnForSlot(layout.playerSpawn, net.slot);
  }
  /**
   * True for the client that owns the electric-car traffic. Read every time rather than
   * captured: in the city the host is whoever has been connected longest, so it changes hands
   * the moment they quit, and the client that inherits it has to start publishing.
   */
  const ownsTraffic = (): boolean => !!net && net.isHost;

  /**
   * THE CIRCUIT MISSION CHAIN, and whether this session is running it at all.
   *
   * Only the solo circuit: the same course is driven as a versus race, where a private mission
   * judging one car has no business existing, so the deciding fact is the one only this caller
   * has — the mode, and whether there is a match. Read before the state is built, because the
   * chain's starting point is part of how the state is created (`GameStateOptions`).
   */
  const hasTimeAttack = mode === 'circuit' && !net;
  let timeAttackProgress = hasTimeAttack ? readTimeAttackProgress() : null;
  /**
   * STREET RACE (`src/sim/streetRace.ts`): the solo race against rivals, in its own world, and
   * the series' record — read here too by the city, whose rings have to know which events are
   * open. Read once; the race that changes it is on the other side of a page load.
   */
  const hasStreetRace = mode === 'street' && !net;
  let streetProgress = hasStreetRace || mode === 'city' ? readStreetRaceProgress() : null;
  /**
   * THE INTRODUCTION (`src/sim/intro.ts`): the first normal entry into the open world, on a
   * browser that has not been through it. Never on a circuit and never in a room — a race
   * invitation is `?mp=`, which never builds the city — so it can only ever stand in front of
   * Free Roam. `?intro=1` replays it (the menu's I key), `?intro=0` keeps it away (QA).
   *
   * It moves the spawn to its own start and makes the meet's parked cars solid BEFORE the
   * state is built, because both are facts the state is created from. The city's own arrival
   * point is kept to be put back when the intro ends, so a later restart is an ordinary one.
   */
  const introParam = params.get('intro');
  const introWanted = mode === 'city' && introParam !== '0' && (introParam === '1' || readIntroProgress().status === null);
  const cityArrival = { ...layout.playerSpawn };
  if (introWanted) {
    installIntroMeetup(layout, INTRO);
    layout.playerSpawn = { x: INTRO.route.start.x, z: INTRO.route.start.z, heading: INTRO.route.start.heading };
  }
  const state = createInitialGameState(layout, readTransmission(), {
    timeAttack: hasTimeAttack,
    timeAttackCleared: timeAttackProgress?.cleared ?? 0,
    streetRaceCleared: streetProgress?.cleared ?? 0,
    intro: introWanted,
    // THE POLICE (`src/sim/police.ts`): Free Roam only, which is the open world and nothing
    // else. Whether they may act on any given tick is the sim's question; whether they exist
    // at all is this one.
    police: mode === 'city',
  });
  // The field: built from the grid, clamped to the events this browser has unlocked.
  const streetRace: StreetRaceState | null =
    hasStreetRace && layout.race ? createStreetRaceState(layout.race, Number(params.get('event') ?? 0), streetProgress?.cleared ?? 0) : null;
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
  // Online the car wears its slot's colour, the colour every other screen draws it in.
  const car = createCarVisual(net ? { slot: net.slot } : {});
  // The chase camera looks straight through the player's own car, so the coordinate probe
  // has to see past it — otherwise every reading would be the bodywork.
  car.root.userData.probeIgnore = true;
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
  // The police pool (`src/render/scene/policeCarVisual.ts`): one visual per slot, hidden while
  // the slot is empty, so a car joining a chase never pays for its own shaders mid-frame.
  const policeVisuals: PoliceCarVisual[] = [];
  if (state.police) {
    for (let i = 0; i < state.police.units.length; i++) {
      const vis = createPoliceCarVisual(i);
      scene.add(vis.root);
      policeVisuals.push(vis);
    }
  }
  /**
   * One car per rival, built now so the warm-up compiles them too — a rival appearing in your
   * mirrors must not be the frame that compiles its shader. `rivals` is the session's own
   * array and its CONTENTS change when the city's roster does, so the visuals are kept by
   * player id and re-aligned with it by `syncRivalVisuals` on every roster event.
   */
  // In a Street Race the rivals are local (`streetRace.cars`), and everything below that reads
  // `rivals` — visuals, tags, map, standings, collision — treats them exactly as it treats a room's.
  const rivals = net ? net.rivals : streetRace ? streetRace.cars : [];
  const rivalPool = new Map<string, RivalCarVisual>();
  /** The same visuals in `rivals` order, so the render loop can walk the two together. */
  let rivalVisuals: RivalCarVisual[] = [];

  function syncRivalVisuals(): void {
    const next: RivalCarVisual[] = [];
    const present = new Set<string>();
    for (const rival of rivals) {
      present.add(rival.id);
      let vis = rivalPool.get(rival.id);
      // A slot is baked into the car's colour, so a player who somehow changed seats gets a
      // new one rather than the wrong paint.
      if (vis && vis.slot !== rival.slot) {
        scene.remove(vis.root);
        vis.dispose();
        rivalPool.delete(rival.id);
        vis = undefined;
      }
      if (!vis) {
        vis = createRivalCarVisual(rival.slot);
        scene.add(vis.root);
        rivalPool.set(rival.id, vis);
      }
      next.push(vis);
    }
    for (const [id, vis] of rivalPool) {
      if (present.has(id)) continue;
      scene.remove(vis.root);
      vis.dispose();
      rivalPool.delete(id);
    }
    rivalVisuals = next;
  }
  syncRivalVisuals();
  end();

  const chase = createChaseCamera(viewportWidth() / viewportHeight());
  // Reads the world coordinate under the crosshair for the debug overlay (and for QA).
  const probe = createWorldProbe(scene, chase.camera);

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

  /* --------------------------------------------------------------- rayo rush */

  /**
   * The free-world activity, in the worlds that carry a marker for it. Everything here is
   * `null` elsewhere, and every use of it below is guarded — the game runs exactly as it did
   * before the activity existed when there is no marker, which is what keeps one code path
   * for both.
   */
  const rushSites = layout.rushSites ?? null;
  const hasRush = !!(rushSites && rushSites.length > 0 && state.rush);
  // The global board and the day's allowance. It never blocks: `standing()` answers from
  // localStorage at once and refreshes behind the frame (`src/net/leaderboard.ts`).
  const leaderboard = hasRush ? createLeaderboard() : null;
  /** One flag per electric car: whether it is drawn as a target this frame. */
  const rushMarks = hasRush ? new Uint8Array(state.targets.length) : null;
  /**
   * How far through the mission chain this browser says the player has got. Read ONCE, here,
   * and then owned by the simulation (`RushState.cleared`) — this variable is only the thing
   * that gets written back, so there is never a moment where the world is showing one mission
   * and storage believes another.
   */
  let rushProgress = hasRush ? readRushProgress() : null;
  if (state.rush && rushProgress) setRushProgress(state.rush, rushProgress.cleared);
  /**
   * Where the marker is standing right now: the site of the mission currently on offer. Asked
   * rather than captured, because it changes the moment a mission is cleared — the same
   * question `stepGame` asks, through the same function, so the art and the rules cannot end
   * up at different corners.
   */
  const rushSite = (): ActivitySite | null => rushSiteFor(rushSites, state.rush?.cleared ?? 0);
  /**
   * A click or a tap on the prompt raises the same intent the F key does. It is queued rather
   * than applied, because the command is only meaningful on a simulation tick.
   */
  let activateQueued = false;
  /** What the last finished run was compared against, frozen before the board is told about it. */
  let rushPreviousBest = -1;
  let rushNewBest = false;
  /**
   * The circuit mission's own version of the same pair: the best time on the mission that just
   * finished, frozen BEFORE the run is folded into the record, so the card can say whether it
   * was beaten. -1 when the mission has never been finished.
   */
  let timeAttackPreviousBest = -1;
  let timeAttackNewBest = false;

  /* --------------------------------------------------------------- passengers */

  /**
   * The side rides, in the worlds that carry stops. Guarded the same way as the rush: null
   * everywhere else, and nothing below runs without it.
   */
  const passengerStops: PassengerStop[] | null = layout.passengerStops ?? null;
  const hasPassengers = !!(passengerStops && passengerStops.length > 0 && state.passenger);
  /** Rides completed and the best tip, this browser's own record. */
  let rideProgress = hasPassengers ? readRideProgress() : null;
  /**
   * The pin over the waiting passenger and the ring at their destination: one marker each,
   * built once and moved. Added to the scene here rather than by the environment, because
   * where they stand is a fact about the ride, not about the city.
   */
  const pickupMarker = hasPassengers ? createPassengerMarker() : null;
  const destinationMarker = hasPassengers ? createPassengerMarker() : null;
  if (pickupMarker) scene.add(pickupMarker.group);
  if (destinationMarker) scene.add(destinationMarker.group);
  /**
   * The arrow over the street ahead while a fare is aboard, and the street network it is aimed
   * along. The graph is built once, here, because it is a fact about the world; the route field
   * is rebuilt per ride, in `placePassengerMarkers`, because it is a fact about the trip. A
   * world with stops but no network still runs — it simply has no arrow.
   */
  const roadGraph: RoadGraph | null =
    (hasPassengers || !!state.intro) && layout.roadNetwork && layout.roadNetwork.length > 0 ? buildRoadGraph(layout.roadNetwork) : null;
  const destinationArrow = roadGraph ? createDestinationArrow() : null;
  if (destinationArrow) scene.add(destinationArrow.group);
  let routeField: RouteField | null = null;
  const routeAim = createRouteAim();
  /**
   * The person under the pin. The marker says a ride is here; this is who is waiting for it,
   * built out of the same body El Búho is (`render/scene/env/humanFigure.ts`) and standing at
   * the kerb rather than in the middle of their own zone — which is why it is handed the
   * world's road test, the one thing that knows where the kerb is.
   */
  const passengerFigure = hasPassengers ? createPassengerFigure((x, z, pad) => world.plan.isRoad(x, z, pad)) : null;
  if (passengerFigure) scene.add(passengerFigure.group);

  /* --------------------------------------------------------------- el búho */

  /**
   * The man under the highway and what he sells, in the world that has his bay. Guarded like
   * the other two: null everywhere else. The figure stands in the scene from the start (he is
   * part of the city); the trip controller owns everything the Moogul does to the picture and
   * is driven once a frame from the rules' clock (`src/sim/buho.ts`), and nothing else.
   */
  const buhoSite: ActivitySite | null = layout.buhoSite ?? null;
  const hasBuho = !!(buhoSite && state.buho);

  /* --------------------------------------------------- the circuit's door */

  /**
   * The start line in the street, in the world that carries it: the open-world city and nothing
   * else. Guarded like the other three.
   *
   * Its sign has to name the mission on offer, and this world has no `TimeAttackState` to ask —
   * the chain is judged on the circuit, on the other side of a page load. So the progress is
   * read from the same storage the circuit reads on boot (`src/core/progress.ts`), once, here.
   * Once is enough BECAUSE of the load: nothing that happens in the city can clear a mission,
   * and coming back from one that did means coming back through `createGame`.
   */
  const circuitSite: ActivitySite | null = layout.circuitSite ?? null;
  const hasCircuitGate = !!(circuitSite && state.circuitGate);
  const circuitProgress = hasCircuitGate ? readTimeAttackProgress() : null;
  /** The Street Race rings, in the world that carries them (the open city). */
  const streetSites: ActivitySite[] | null = layout.streetSites ?? null;
  const hasStreetGate = !!(streetSites && streetSites.length > 0 && state.streetGate);
  const buhoFigure = hasBuho && buhoSite ? createBuhoFigure(buhoSite) : null;
  if (buhoFigure) scene.add(buhoFigure.group);
  const moogul = hasBuho
    ? createMoogulTrip({
        scene,
        atmosphere: environment.atmosphere,
        hemi: environment.moogul.hemi,
        key: environment.moogul.key,
        surface: environment.moogul.surface,
        walls: environment.moogul.walls,
      })
    : null;

  end = measure('hud');
  const hud = createHud(hudRoot, mode, !!net, {
    onActivate:
      hasRush || hasPassengers || hasBuho || hasCircuitGate || hasStreetGate
        ? () => {
            activateQueued = true;
          }
        : undefined,
    rush: hasRush,
    passengers: hasPassengers,
    buho: hasBuho,
    circuitGate: hasCircuitGate,
    streetGate: hasStreetGate,
    police: !!state.police,
  });
  const minimap = createMinimap(hudRoot, layout.minimap, layout.race, net ? slotCss(net.slot) : undefined);
  // `precise` is what F4 copies: one real raycast at the moment the key is pressed, so the
  // line on the clipboard names the surface you were looking at, not just the ground under it.
  const debug = createDebugOverlay(debugRoot, params.has('debug'), { precise: () => sampleProbe(true) });
  // Live classification and floating names, only when there is a field to classify.
  const lapLength = layout.race ? layout.race.path.length : 0;
  const standings: Standings | null = match || streetRace ? createStandings(hudRoot, lapLength, rivals.length + 1) : null;
  // In a race the field is fixed, so tags are only worth making when there is one. In the city
  // somebody can drive up at any moment, so the layer exists from the start and fills in.
  const nameTags: NameTags | null = roaming || rivals.length > 0 ? createNameTags(hudRoot, rivals) : null;
  // Who is online, under the minimap. The city's only multiplayer screen: there is no lobby.
  const onlinePanel: OnlinePanel | null = roaming ? createOnlinePanel(hudRoot) : null;
  end();

  /* ------------------------------------------------------------ the introduction */

  /**
   * Everything the intro puts on screen and on the street, in the session that runs it and
   * nowhere else: the overlay (opening, call, subtitles, objective, the clip at the meet), the
   * ring at the meet — the passenger's destination ring, reused, because it already is "drive
   * here" — a route for the arrow, and the meet itself: the cars parked under the deck and
   * BadKala standing by them. The screen furniture comes down on `introDone`; the meet stays
   * for the session, because the player is standing in it.
   */
  const introOverlay: IntroOverlay | null = state.intro
    ? createIntroOverlay({
        cfg: INTRO,
        hudRoot,
        onOpeningDone: () => {
          if (state.intro) finishIntroOpening(state.intro);
        },
        onCinematicDone: () => {
          if (state.intro) finishIntroCinematic(state.intro);
        },
        onSkipLine: () => {
          if (state.intro) skipIntroLine(state.intro);
        },
        onSkipIntro: () => {
          if (state.intro) skipIntro(state.intro);
        },
        onAssist: () => {
          if (state.intro) acceptIntroAssist(state.intro);
        },
        duckMusic: (level) => theme.duck(level),
      })
    : null;
  if (introOverlay) hudRoot.appendChild(introOverlay.root);
  const introMarker = state.intro ? createPassengerMarker() : null;
  if (introMarker) scene.add(introMarker.group);
  /**
   * THE MEET. The parked cars are the rival car's own visual — a Bandido's car in a slot colour,
   * standing still — fed a static record each, so they cost what three quiet rivals cost. Their
   * colliders were laid with the layout (`installIntroMeetup`). BadKala is the shared body every
   * side-mission figure is built from, in her own look.
   */
  const introParked: Array<{ car: RivalCar; vis: RivalCarVisual }> = [];
  let badkalaFigure: HumanFigureVisual | null = null;
  if (state.intro) {
    for (let i = 0; i < INTRO.meetup.cars.length; i++) {
      const c = INTRO.meetup.cars[i];
      const car: RivalCar = {
        id: `intro-parked-${i}`,
        name: '',
        slot: c.slot,
        present: true,
        x: c.x,
        z: c.z,
        heading: c.heading,
        vx: 0,
        vz: 0,
        speed: 0,
        steerAngle: 0,
        wheelSpin: 0,
        latAccel: 0,
        longAccel: 0,
        drifting: false,
        nitro: false,
        braking: false,
        reversing: false,
        charge: 0.4,
        lap: 0,
        progress: 0,
        lapTime: 0,
        bestLap: -1,
        finishTime: -1,
        money: 0,
      };
      const vis = createRivalCarVisual(c.slot);
      vis.sync(car);
      scene.add(vis.root);
      introParked.push({ car, vis });
    }
    const bk = INTRO.meetup.badkala;
    badkalaFigure = createHumanFigure(INTRO.meetup.badkalaLook, { name: 'badkala', phase: 2.3 });
    badkalaFigure.group.position.set(bk.x, 0.03, bk.z);
    badkalaFigure.group.rotation.y = -bk.heading;
    scene.add(badkalaFigure.group);
  }
  const introSnapshot: IntroOverlaySnapshot = { stage: 'opening', objective: null, assistOffered: false, talking: false };
  /** The road route to the intro's current objective, for the arrow. Rebuilt per objective. */
  let introRoute: RouteField | null = null;
  let introRewarded = false;

  /** Stand the ring at the current objective, and route the arrow to it; nothing while there is no place. */
  function placeIntroMarker(): void {
    const intro = state.intro;
    if (!intro || !introMarker) return;
    if (intro.active && intro.objective && intro.objectiveRadius > 0) {
      const site = { x: intro.objectiveX, z: intro.objectiveZ, y: 0, heading: 0 };
      introMarker.place(site, 'destination');
      introRoute = roadGraph ? routeTo(roadGraph, site) : null;
      if (introRoute && destinationArrow) destinationArrow.snap();
    } else {
      introMarker.hide();
      introRoute = null;
      destinationArrow?.hide();
    }
  }

  /**
   * The intro is over, one way or the other: write it down and put the city back the way a
   * plain visit finds it. The meet stays: it is where the player is standing.
   */
  function endIntro(reason: 'completed' | 'skipped'): void {
    writeIntroProgress(reason);
    if (reason === 'completed' && INTRO.completionReward > 0 && !introRewarded) {
      introRewarded = true;
      state.economy.money += INTRO.completionReward;
    }
    layout.playerSpawn = { ...cityArrival };
    theme.duck(1);
    placeIntroMarker();
    refreshMapMarks();
  }

  /**
   * Stand the marker, and put the map's mark under it, at the site of the mission on offer.
   *
   * Called once at boot and again on every `rushLevelUp`, which is the point of it being a
   * function: a player returning with two missions behind them has to find the marker at the
   * THIRD site, and "where it was built" and "where it belongs" are the same question either
   * way. The art is built at the first site (`env/rushMarker.ts`) because something has to be
   * built somewhere; this is what decides where it actually stands.
   */
  function placeRushMarker(): void {
    const site = rushSite();
    if (!site) return;
    environment.rushMarker?.moveTo(site);
    refreshMapMarks();
  }

  /**
   * Everything the map marks, rebuilt together: the RUSH circle where the chain has it, the
   * circuit's start line, and the passenger pin or their destination, whichever the ride is at.
   * One writer, so no activity can erase another's mark.
   *
   * ONE ACTIVITY AT A TIME (`src/sim/activities.ts`). While one of them has the car, the others
   * are not marked at all: a run, a ride or a Moogul is driven on a map with nothing on it but
   * the thing being driven. It is the same rule the rules themselves run on — the others are
   * `locked`, so a mark on the map would be pointing at something the key would refuse — and it
   * is asked here rather than remembered, because "who has the car" is a question with one
   * answer and one place that answers it.
   */
  const mapMarks: Array<{ x: number; z: number; kind: ActivityMarkKind }> = [];
  function refreshMapMarks(): void {
    mapMarks.length = 0;
    const engaged = engagedActivity(state);
    // The intro's objective, while it is a place. Everything else is suppressed underneath.
    const intro = state.intro;
    if (intro && intro.active && intro.objective && intro.objectiveRadius > 0) {
      mapMarks.push({ x: intro.objectiveX, z: intro.objectiveZ, kind: 'destination' });
    }
    if (!activitySuppressed(engaged, 'rush')) {
      const site = rushSite();
      if (site) mapMarks.push({ x: site.x, z: site.z, kind: 'rush' });
    }
    if (!activitySuppressed(engaged, 'circuit') && circuitSite) {
      mapMarks.push({ x: circuitSite.x, z: circuitSite.z, kind: 'circuit' });
    }
    // Every open Street Race ring: won events stay on the map, the newest one with them.
    if (!activitySuppressed(engaged, 'street') && streetSites && state.streetGate) {
      const open = streetNewestEvent(state.streetGate.cleared);
      for (let i = 0; i <= open && i < streetSites.length; i++) mapMarks.push({ x: streetSites[i].x, z: streetSites[i].z, kind: 'street' });
    }
    const p = state.passenger;
    if (p && p.trip && passengerStops && !activitySuppressed(engaged, 'passenger')) {
      if (p.phase === 'offered') {
        const stop = stopById(passengerStops, p.trip.pickupId);
        if (stop) mapMarks.push({ x: stop.x, z: stop.z, kind: 'passenger' });
      } else if (p.phase === 'riding') {
        const stop = stopById(passengerStops, p.trip.destinationId);
        if (stop) mapMarks.push({ x: stop.x, z: stop.z, kind: 'destination' });
      }
    }
    minimap.setActivities(mapMarks);
  }

  /**
   * Which of the ride's furniture is standing in the street right now: the pin at the pickup
   * while someone waits, the ring at the destination while they are aboard, the person at
   * whichever of the two they are actually at, and none of it while another activity has the
   * car (`src/sim/activities.ts`).
   *
   * SPLIT OUT of `placePassengerMarkers` below because it is asked two different ways. The ride
   * moving on is an event and brings a new route with it; a RAYO RUSH run starting is not an
   * event this cares about beyond "get out of the way", and re-running the route search for it
   * would be paying for a Dijkstra to hide a lamppost.
   *
   * The waiting fare is only HIDDEN, never cancelled: their offer goes on running underneath
   * and they are standing there again the moment the run is over. Being busy is not the same as
   * turning somebody down.
   */
  function showPassengerFurniture(): void {
    const p = state.passenger;
    if (!p || !pickupMarker || !destinationMarker || !passengerStops) return;
    const off = activitySuppressed(engagedActivity(state), 'passenger');
    const pickup = p.trip ? stopById(passengerStops, p.trip.pickupId) : null;
    const destination = p.trip ? stopById(passengerStops, p.trip.destinationId) : null;
    if (!off && p.phase === 'offered' && pickup) pickupMarker.place(pickup, 'pickup');
    else pickupMarker.hide();
    if (!off && p.phase === 'riding' && destination) destinationMarker.place(destination, 'destination');
    else destinationMarker.hide();
    if (passengerFigure) {
      const def = p.trip ? passengerById(PASSENGERS, p.trip.passengerId) : null;
      if (off) passengerFigure.hide();
      else if (def && p.phase === 'offered' && pickup) passengerFigure.show(def.portrait, pickup);
      else if (def && p.phase === 'results' && destination) passengerFigure.show(def.portrait, destination);
      else passengerFigure.hide();
    }
  }

  /**
   * The ride moved on: work out the route home, then stand everything where the new phase wants
   * it. Called on the events that move the ride along, never per frame.
   *
   * The passenger themselves follows the same rule with one more phase to it. They stand at the
   * kerb by the pin while they are waiting, they are in the car for the length of the ride, and
   * they are back on the pavement at the destination for as long as the fare card is up — which
   * is the only moment in a ride when the player can look at the person they just drove.
   */
  /**
   * Aim the arrow along a route. The arrow rides the car and only turns: `follow` is the car's
   * own pose, and the heading is the bearing FROM the car TO a point a fixed distance up the
   * route. So it lies down the street while the street is the way and swings across as the
   * junction comes up, while never leaving the screen. It goes away rather than point at
   * nothing when the walk finds no way — off the network, or nowhere left to go. One arrow for
   * the fare's destination and for the intro's objectives, which never coexist.
   */
  function steerArrow(field: RouteField, frameDt: number): void {
    if (!destinationArrow || !roadGraph) return;
    if (aimAlong(roadGraph, field, pose.x, pose.z, PASSENGER.arrow.lookahead, routeAim)) {
      const toAimX = routeAim.x - pose.x;
      const toAimZ = routeAim.z - pose.z;
      destinationArrow.follow(pose.x, pose.y, pose.z, pose.heading);
      // Standing on the aim point itself there is no bearing to take, so the road's own
      // direction there stands in — which is what the player would do anyway.
      if (toAimX * toAimX + toAimZ * toAimZ > 1) destinationArrow.face(toAimX, toAimZ);
      else destinationArrow.face(routeAim.dirX, routeAim.dirZ);
      destinationArrow.setDive(1 - Math.min(1, routeAim.remaining / PASSENGER.arrow.diveDistance));
      destinationArrow.show();
    } else {
      destinationArrow.hide();
    }
    destinationArrow.update(frameDt, simTime);
  }

  function placePassengerMarkers(): void {
    const p = state.passenger;
    if (!p || !pickupMarker || !destinationMarker || !passengerStops) return;
    const destination = p.trip ? stopById(passengerStops, p.trip.destinationId) : null;
    // The route is worked out once, when the fare gets in: Dijkstra over the street network,
    // outward from the drop-off. Everything the arrow does for the rest of the ride reads that
    // one answer, so a ride costs a single search however far the player wanders inside it.
    routeField = roadGraph && p.phase === 'riding' && destination ? routeTo(roadGraph, destination) : null;
    if (destinationArrow) {
      if (routeField) destinationArrow.snap();
      else destinationArrow.hide();
    }
    showPassengerFurniture();
    refreshMapMarks();
  }
  placeRushMarker();
  placePassengerMarkers();

  /* ------------------------------------------------------------ render scale */

  // Starts where `createRenderer` put it; the governor only ever moves it from there.
  const startRatio = renderer.getPixelRatio();
  const governor = createResolutionGovernor({
    startRatio,
    minRatio: Math.min(startRatio, RENDER.minPixelRatio),
    stepFactor: RENDER.resolutionStep,
    downMs: RENDER.resolutionDownMs,
    downShare: RENDER.resolutionDownShare,
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
    aim01: 0,
    aimRange: 0,
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
    rush: null,
    timeAttack: null,
    passenger: null,
    buho: null,
    circuitGate: null,
    streetGate: null,
    streetRace: null,
    police: null,
  };
  const buhoSnapshot: BuhoHudSnapshot = {
    name: BUHO.name,
    tagline: BUHO.tagline,
    portrait: BUHO.portrait,
    item: BUHO.item,
    price: MOOGUL.price,
    atSite: false,
    canBuy: false,
    confirmArm: 0,
    notice: null,
    active: false,
    intensity: 0,
    line: '',
    lineId: 0,
  };
  if (hasBuho) snapshot.buho = buhoSnapshot;
  const passengerSnapshot: PassengerHudSnapshot = {
    phase: 'idle',
    passengerId: '',
    name: '',
    tagline: '',
    portrait: '',
    canBoard: false,
    canDropOff: false,
    cancelArm: 0,
    destinationLabel: '',
    distance: 0,
    fare: 0,
    mood: 0,
    prefLabels: ['', ''],
    prefStatus: ['neutral', 'neutral'],
    line: '',
    lineKind: 'reaction',
    lineId: 0,
    results: null,
  };
  if (hasPassengers) snapshot.passenger = passengerSnapshot;
  const rushSnapshot: RushHudSnapshot = {
    phase: 'idle',
    level: 0,
    levelCount: rushLevelCount(),
    cleared: 0,
    targetScore: 0,
    levelLabel: '',
    allClear: false,
    countdown: 0,
    timeLeft: 0,
    score: 0,
    disabled: 0,
    chain: 0,
    multiplier: 1,
    chainFraction: 0,
    bestChain: 0,
    styleBonus: 0,
    atMarker: false,
    canStart: false,
    attemptsLeft: -1,
    ranked: true,
    previousBest: -1,
    results: null,
    newBest: false,
  };
  if (state.rush) snapshot.rush = rushSnapshot;
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
  /**
   * The mission readout. Present only in the session that runs the chain, so the HUD strip is
   * decided once, here, rather than re-tested every frame.
   */
  const timeAttackSnapshot: TimeAttackHudSnapshot = {
    level: 0,
    levelCount: timeAttackLevelCount(),
    cleared: 0,
    levelName: '',
    targetTime: 0,
    crashLimit: 0,
    crashes: 0,
    failed: false,
    allClear: false,
    results: null,
    previousBest: -1,
    newBest: false,
  };
  if (state.timeAttack) snapshot.timeAttack = timeAttackSnapshot;
  /**
   * The start line's sign. Everything but `offering` is fixed for the life of the session, for
   * the reason above — the chain cannot move while the player is in the city — so it is filled
   * in once here and only the one live field is written per frame.
   */
  const circuitLevel = circuitProgress ? timeAttackLevelIndex(circuitProgress.cleared) : 0;
  const circuitSpec = circuitProgress ? timeAttackLevel(circuitProgress.cleared) : null;
  const circuitGateSnapshot: CircuitGateHudSnapshot = {
    offering: false,
    level: circuitLevel,
    levelCount: timeAttackLevelCount(),
    levelName: circuitSpec ? circuitSpec.name : '',
    targetTime: circuitSpec ? circuitSpec.seconds : 0,
    crashLimit: circuitSpec ? circuitSpec.crashes : 0,
    allClear: !!circuitProgress && timeAttackAllClear(circuitProgress.cleared),
    placeLabel: circuitSite?.label ?? '',
  };
  if (state.circuitGate) snapshot.circuitGate = circuitGateSnapshot;
  const streetRaceSnapshot: StreetRaceHudSnapshot = {
    event: 0,
    eventCount: STREET_RACE.events.length,
    eventName: '',
    difficulty: '',
    position: 1,
    field: 1,
    shortcut: -1,
    results: null,
  };
  if (streetRace) {
    const spec = streetEvent(streetRace.event);
    streetRaceSnapshot.event = streetRace.event;
    streetRaceSnapshot.eventName = spec.name;
    streetRaceSnapshot.difficulty = spec.difficulty;
    streetRaceSnapshot.field = streetRace.rivals.length + 1;
    snapshot.streetRace = streetRaceSnapshot;
  }
  const streetGateSnapshot: StreetGateHudSnapshot = {
    offering: false,
    event: 0,
    eventCount: STREET_RACE.events.length,
    eventName: '',
    difficulty: '',
    blurb: '',
    rivals: 1,
    completed: false,
    placeLabel: '',
  };
  /** Which event the sign was last written for, so its text is rewritten only when that changes. */
  let streetGateShown = -1;
  if (state.streetGate) snapshot.streetGate = streetGateSnapshot;
  const policeSnapshot: PoliceHudSnapshot = {
    heat01: 0,
    stars: 0,
    phase: 'calm',
    escapeLeft: 0,
    bust01: 0,
    holdLeft: 0,
    shielded: false,
    bustedStars: 0,
    bustedFine: 0,
    bustedCharged: 0,
  };
  if (state.police) snapshot.police = policeSnapshot;
  /** What the siren and the police motor read each frame. The units array is the pool itself. */
  const policeAudio: PoliceAudioInput | null = state.police ? { units: state.police.units, siren: false } : null;
  const debugInput: DebugFrameInput = { simMs: 0, renderMs: 0, gpuMs: -1, pixelRatio: startRatio, governor: governor.status };
  /* World coordinates for the overlay. The car and camera are free; the crosshair costs a
   * scene raycast, so it is only sampled while the overlay is open and only a few times a
   * second — often enough to read while flying around, cheap enough to leave switched on. */
  const readout: WorldReadout = {
    carX: 0, carY: 0, carZ: 0, heading: 0,
    camX: 0, camY: 0, camZ: 0,
    aimX: 0, aimY: 0, aimZ: 0, aimDistance: 0, aimWhat: '', aimValid: false,
    surface: { x: 0, y: 0, z: 0, distance: 0, what: '', valid: false, taken: false },
  };
  debugInput.world = readout;
  let lastNitroAmount = state.nitro.amount;
  let nitroVisual = 0;
  /* The gear the body has already been shoved for. A shift is an event, not a state, and the
   * simulation may run several ticks between frames — comparing the gear the body knows about
   * with the one the car is in catches the change whatever the frame rate is doing. */
  let bodyGear = state.vehicle.gear;
  /**
   * Which activity had the car on the last frame that looked. `undefined` until the first one,
   * so the opening frame always writes — `null` is a real answer here ("nobody"), and a
   * sentinel that collides with a real answer is a first frame that never happens.
   */
  let shownEngaged: ActivityKind | null | undefined = undefined;
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

  /**
   * What to call this player on the global board: the name they gave the lobby, or the same
   * fallback the rest of the game uses. Read fresh each time, because it can change in
   * another tab.
   */
  function playerName(): string {
    if (net?.self?.name) return net.self.name;
    try {
      return localStorage.getItem('rb.name') || 'BANDIDO';
    } catch {
      return 'BANDIDO';
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
  const stepOptions: StepOptions = {
    rivals: net ? net.rivals : streetRace ? streetRace.cars : null,
    respawnTraffic: !net || ownsTraffic(),
    cruising: false,
    policeShoveTraffic: !net,
  };
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
        if (ownsTraffic()) pendingHits.push(targetId);
      }),
    );
    netCleanup.push(
      net.onBump((bump) => {
        if (ownsTraffic()) pendingBumps.push(bump);
      }),
    );
    // The city's field changes under the driver: build the car that just arrived, retire the
    // one that just quit, and re-align the tags and the roster with what is left.
    netCleanup.push(
      net.onRoster(() => {
        syncRivalVisuals();
        nameTags?.sync(rivals);
        refreshOnline();
      }),
    );
    // A name change or a new host does not move a car, but it does change what the panel says.
    netCleanup.push(net.onLobby(() => refreshOnline()));
  }

  /**
   * Why there is nobody else here, when there is nobody else here. '' while the socket is up:
   * an empty city is a fact about the evening, not a fault worth explaining.
   */
  function onlineNote(): string {
    if (!net) return '';
    switch (net.phase) {
      case 'connecting':
        return 'connecting';
      case 'refused':
        return net.problem || 'refused';
      case 'closed':
        return 'offline · driving solo';
      default:
        return '';
    }
  }

  function refreshOnline(): void {
    if (!onlinePanel || !net) return;
    onlinePanel.update(net.players, net.selfId, MAX_WORLD_PLAYERS);
    onlinePanel.setNote(onlineNote());
  }
  refreshOnline();

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
  if (match || streetRace) {
    standingsRows.push({
      name: net?.self?.name ?? 'YOU',
      slot: match ? match.slot : 0,
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
    // Against local rivals the row is ranked the way they are (`rankingProgress`): a car still
    // behind the line on lap 1 must not read as nearly a lap ahead of one that has crossed it.
    mine.progress = race ? (streetRace ? rankingProgress(race) : race.progress) : 0;
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
   * everyone else kept racing — and in the city it would reset money and traffic that other
   * people can see — so online R is repurposed rather than removed: it is a rescue from a wall,
   * not a new attempt.
   *
   * On the circuit the car reappears just past the last gate it cleared, pointing down the lap,
   * with the race clock still running. In the open world there are no gates, so it goes back to
   * where this car came into the city.
   */
  function rescue(): void {
    const race = state.race;
    const course = layout.race;
    const v = state.vehicle;
    let x = layout.playerSpawn.x;
    let z = layout.playerSpawn.z;
    let heading = layout.playerSpawn.heading;
    if (race && course && course.gates.length > 0) {
      const gate = course.gates[(race.nextGate - 1 + course.gates.length) % course.gates.length];
      // Past the gate rather than on it, so driving away cannot re-trigger the crossing.
      x = (gate.ax + gate.bx) / 2 + gate.fx * RESPAWN_AHEAD;
      z = (gate.az + gate.bz) / 2 + gate.fz * RESPAWN_AHEAD;
      heading = Math.atan2(gate.fx, -gate.fz);
    }
    v.x = v.prevX = x;
    v.z = v.prevZ = z;
    v.y = v.prevY = 0;
    v.pitch = 0;
    v.heading = v.prevHeading = heading;
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
    // A passenger does not survive being teleported across the city: they are let out unpaid
    // on the next tick.
    stepOptions.respawned = true;
  }

  function handleEvent(ev: GameEvent): void {
    if (ev.type === 'transmission') saveTransmission(ev.mode);
    hud.onEvent(ev);
    audio.onEvent(ev);
    introOverlay?.onEvent(ev);
    switch (ev.type) {
      case 'lightningFired':
        effects.lightning(ev.fromX, ev.fromY, ev.fromZ, ev.toX, ev.toY, ev.toZ);
        chase.shake(CAMERA.shakeLightning);
        break;
      case 'targetDestroyed':
        effects.powerDown(ev.x, ev.y, ev.z);
        if (ev.reward > 0) effects.scorePopup(ev.x, ev.y, ev.z, ev.reward);
        // The kill happened here, but the host is the one everybody believes about traffic:
        // tell the host, and do not let its next few reports bring the car back meanwhile.
        if (net && trafficSync && !ownsTraffic()) {
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
      case 'rushScore':
        // The run's points, over the wreck, INSTEAD of the ¥ pop the same kill also earned —
        // `targetDestroyed` runs first and has already spawned one, so it is replaced rather
        // than joined. Two numbers over one car is one too many.
        effects.rushPopup(ev.x, ev.y, ev.z, ev.points);
        break;
      case 'rushLevelUp':
        // A mission fell, and the chain has already moved on: the marker packs up and re-paints
        // itself at the next site, and the map points there too. Presentation only — the
        // `rushEnd` immediately behind this event is where the new total is written down, so
        // there is exactly one writer of the record.
        placeRushMarker();
        break;
      case 'rushEnd':
        // The clock has stopped and the card is already on screen; the board is told about it
        // afterwards, and never waited on. A run that cannot be filed is still a run.
        rushPreviousBest = leaderboard ? leaderboard.standing().best : -1;
        rushNewBest = ev.results.score > rushPreviousBest;
        // The per-mission record is this browser's alone and is kept whatever the network is
        // doing, and whether or not the run was one of the day's ranked attempts: clearing a
        // mission is a fact about the driving. `advanced` is false here for a mission already
        // cleared, so a replay updates the score and leaves the chain where it is.
        if (rushProgress) {
          rushProgress = recordRushRun(rushProgress, ev.results.level, ev.results.score, ev.results.advanced);
          writeRushProgress(rushProgress);
        }
        if (leaderboard && ev.results.ranked) {
          const run = {
            score: ev.results.score,
            disabled: ev.results.disabled,
            bestChain: ev.results.bestChain,
            styleBonus: ev.results.styleBonus,
          };
          void leaderboard.submit(run, playerName()).then((result) => {
            // The server may know a better previous best than this browser did (the same
            // player on another machine), so the card is corrected if the answer arrives
            // while it is still up.
            rushPreviousBest = result.previousBest;
            rushNewBest = result.newBest;
          });
        }
        break;
      case 'timeAttackEnd': {
        // The flag has already been shown and the card is up; this is only the record. The
        // chain has moved on by now if it was going to (`timeAttackLevelUp` came first), so
        // `advanced` is what says whether it did, and a replay of a cleared mission updates
        // the time and leaves the chain where it is.
        const best = timeAttackProgress ? timeAttackProgress.best[ev.results.level] ?? -1 : -1;
        timeAttackPreviousBest = best;
        timeAttackNewBest = ev.results.time > 0 && (best < 0 || ev.results.time < best);
        if (timeAttackProgress) {
          timeAttackProgress = recordTimeAttackRun(timeAttackProgress, ev.results.level, ev.results.time, ev.results.advanced);
          writeTimeAttackProgress(timeAttackProgress);
        }
        break;
      }
      case 'collision':
        effects.collision(ev.x, ev.y, ev.z, ev.impact);
        chase.shake(Math.min(0.3, ev.impact * CAMERA.shakeCollisionPerImpact));
        // Shoved an electric car: the shove is real here now, and the host is asked to
        // repeat it so it is real everywhere. Same hold as a kill, so the host's reports do
        // not slide the car back onto the bonnet before its own copy of the shove lands.
        if (net && trafficSync && !ownsTraffic() && ev.targetId !== undefined) {
          trafficSync.claimBump(ev.targetId, state.time, bumpHoldSeconds());
          net.reportBump(ev.targetId, ev.knockX ?? 0, ev.knockZ ?? 0);
        }
        break;
      case 'passengerOffer':
      case 'passengerBoard':
      case 'passengerCancel':
      case 'passengerDismissed':
        placePassengerMarkers();
        break;
      case 'policeShielded':
        // The bolt met a police car: the hex ring flares on it. The sound is the audio's.
        policeVisuals[ev.unit]?.flashShield();
        break;
      case 'policeBusted':
        chase.shake(CAMERA.shakeLightning);
        break;
      case 'streetRaceEnter':
        // The key on a Street Race ring: which event is the caller's to load (`src/main.ts`).
        options.onEnterStreetRace?.(ev.event);
        break;
      case 'streetRaceEnd':
        // The reward was paid by the rules; this is only the record. `advanced` says whether the
        // series moved on, and a lost or replayed race leaves it where it was.
        if (streetProgress) {
          streetProgress = recordStreetRace(streetProgress, ev.results.event, ev.results.placement, ev.results.advanced);
          writeStreetRaceProgress(streetProgress);
        }
        break;
      case 'circuitEnter':
        // The key on the start line. The rules are done — this world is over — and where the
        // player goes next is the caller's to decide (`src/main.ts`), because it is the only
        // thing here that knows what an address is. Nothing else happens on this frame: the
        // car keeps driving until the new page takes over, which is what a load looks like.
        options.onEnterCircuit?.();
        break;
      case 'passengerComplete':
        // Paid by the simulation already (`applyPassengerFare`); this is only the record and
        // the furniture. The fare card reads the frozen results, not the live state.
        placePassengerMarkers();
        if (rideProgress) {
          rideProgress = recordRide(rideProgress, ev.results.tip);
          writeRideProgress(rideProgress);
        }
        break;
      case 'introObjective':
        placeIntroMarker();
        refreshMapMarks();
        break;
      case 'introDone':
        endIntro(ev.reason);
        break;
      case 'restart':
        placeIntroMarker();
        rushPreviousBest = -1;
        rushNewBest = false;
        timeAttackPreviousBest = -1;
        timeAttackNewBest = false;
        placePassengerMarkers();
        // A restart is a cut, not a fade: the city is put back exactly as it was.
        moogul?.stop();
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
        // R is a rescue online, never a restart. See `rescue`.
        command.restart = false;
        rescue();
      }
      if (pendingTraffic) {
        newlyDestroyed.length = 0;
        trafficSync.apply(state.targets, pendingTraffic, pendingTrafficAt, state.time, newlyDestroyed);
        pendingTraffic = null;
        for (let i = 0; i < newlyDestroyed.length; i++) {
          const t = state.targets[newlyDestroyed[i]];
          effects.powerDown(t.x, t.y, t.z);
        }
      }
      while (ownsTraffic() && pendingHits.length > 0) {
        const id = pendingHits.shift() as number;
        if (trafficSync.destroy(state.targets, id, state.time)) {
          const t = state.targets[id];
          effects.powerDown(t.x, t.y, t.z);
        }
      }
      while (ownsTraffic() && pendingBumps.length > 0) {
        const bump = pendingBumps.shift() as { target: number; kx: number; kz: number; at: number };
        trafficSync.bump(state.targets, bump.target, bump.kx, bump.kz, (net.serverNow() - bump.at) / 1000);
      }
    }

    // A tap or a click on the RAYO RUSH prompt is the F key by another route.
    if (activateQueued) {
      command.activate = true;
      activateQueued = false;
    }
    // Asked every tick rather than captured: the day's allowance is spent by finishing runs,
    // and the answer can also change when the board finally reports in.
    if (leaderboard) stepOptions.rushRanked = leaderboard.canRank();

    if (command.pov) chase.cycleView();
    if (command.cruise) setCruise(!cruising);
    if (cruising) {
      const driving = isDriving(command);
      if (!driving) cruiseArmed = true;
      if (driving && cruiseArmed) setCruise(false);
      else cruiseControl.step(state.vehicle, command, dt);
    }
    stepOptions.cruising = cruising;
    // The rivals' public records back on their tick poses, so the player's collision pass sees
    // where they are and not where the last frame drew them.
    if (streetRace) snapStreetRivals(streetRace);
    // The intro's protection from the room: nobody can shove the tutorial player. Their car
    // is still drawn and still published; only this client's collision pass looks away.
    stepOptions.rivals = introEngaged(state.intro) ? null : net ? net.rivals : streetRace ? streetRace.cars : null;
    stepGame(state, command, layout, dt, stepOptions);
    // One tick's worth: the rescue that set it has been seen.
    stepOptions.respawned = false;
    simTime = state.time;
    // The field, after the player: rivals drive, collide and are judged on this same tick.
    if (streetRace && layout.race) {
      if (command.restart) resetStreetRace(streetRace, layout.race);
      else stepStreetRace(streetRace, layout, state, dt, state.events);
    }
    const events = state.events;
    for (let i = 0; i < events.length; i++) handleEvent(events[i]);

    if (net && trafficSync) {
      // The host publishes the traffic it owns; everyone else eases theirs onto it, and
      // remembers where it stands so the next report can be compared with the right instant.
      if (ownsTraffic()) {
        // The host can change hands mid-session in the city, so this is asked every tick.
        stepOptions.respawnTraffic = true;
        net.publishTraffic(state.targets);
      } else {
        stepOptions.respawnTraffic = false;
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
    // Which electric cars wear the rush ring this frame. The nearest few only, and only
    // while a run is on — `markRushTargets` answers with the same rule that decides what
    // actually scores, so the two can never disagree.
    if (state.rush && rushMarks) markRushTargets(state.rush, state.targets, v.x, v.z, rushMarks);
    syncTargets(targetVisuals, state.targets, alpha, simTime, rushMarks);
    for (let i = 0; i < targetVisuals.length; i++) targetVisuals[i].update(frameDt, simTime);
    syncBuses(busVisuals, state.buses, alpha);
    if (state.police) {
      syncPolice(policeVisuals, state.police.units, alpha, state.police.aimedUnit);
      for (let i = 0; i < policeVisuals.length; i++) policeVisuals[i].update(frameDt, simTime);
    }
    // Rivals carry their own interpolation (on the network clock), so unlike everything else
    // here they are not blended by `alpha` — they are re-placed for this very frame instead,
    // which is what keeps them moving every frame on a display faster than the simulation.
    if (net) net.interpolateRivals(frameDt);
    if (streetRace) interpolateStreetRivals(streetRace, alpha, frameDt);
    for (let i = 0; i < rivalVisuals.length; i++) {
      rivalVisuals[i].sync(rivals[i]);
      rivalVisuals[i].update(frameDt, simTime);
    }
    effects.setCarPose(pose, v, state.drift.active, nitroVisual, frameDt);
    effects.update(frameDt, simTime);
    theme.update(frameDt);
    environment.update(frameDt, simTime);
    // After the environment, so the sky and the fog it blends from are this frame's. The
    // envelope is read off the rules' clock: 0 the moment the Moogul is gone, and the
    // controller's own fade takes it from there.
    if (moogul && state.buho) {
      moogul.update(state.buho.moogulActive ? moogulIntensity(state.buho.moogulElapsed) : 0, frameDt, pose.x, pose.z, pose.heading);
    }
    if (buhoFigure && buhoSite) {
      const dx = pose.x - buhoSite.x;
      const dz = pose.z - buhoSite.z;
      const reach = MOOGUL.marker.promptRadius * 4;
      const near = 1 - Math.min(1, Math.sqrt(dx * dx + dz * dz) / reach);
      // He stays where he is while somebody else has the car — a man is not scenery you switch
      // off, and the bay would be a strange empty pocket without him — but his ring stops
      // answering, because it is the part of him that is an offer, and the offer is not open.
      buhoFigure.setProximity(activitySuppressed(engagedActivity(state), 'moogul') ? 0 : near * near);
      buhoFigure.update(simTime);
    }
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
      policeAudio,
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
    // READY means "a shot is possible", which — since the load is paid for as it is held — is
    // the cheapest shot, not a full one. What is in the meter decides how FAR the next bolt
    // reaches, not whether there is one.
    snapshot.canFire = canAffordShot(state.lightning.charge);
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
    snapshot.aim01 = state.lightning.charging ? state.lightning.hold / LIGHTNING.maxHold : 0;
    snapshot.aimRange = LIGHTNING.range * snapshot.aim01;
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
    /**
     * ONE ACTIVITY AT A TIME, on screen (`src/sim/activities.ts`). One question, asked once a
     * frame, and everything the other activities put in front of the player comes off: their
     * marker off the street, their person off the pavement, their mark off the map. The rules
     * already refuse them (`locked`), so this is the picture agreeing with what the key does
     * rather than a second opinion about it.
     */
    const engaged = engagedActivity(state);
    // The EDGE, not the state: taking a run up, or finishing one, is what puts the other
    // activities' furniture away and brings it back. Both of the things it drives repaint
    // something (the minimap's base layer, a marker's transform), so they are paid for when the
    // answer actually changes and never per frame.
    if (engaged !== shownEngaged) {
      shownEngaged = engaged;
      showPassengerFurniture();
      refreshMapMarks();
    }
    const rush = state.rush;
    const site = rush ? rushSite() : null;
    if (rush && site) {
      rushSnapshot.phase = rush.phase;
      rushSnapshot.countdown = rush.countdown;
      rushSnapshot.timeLeft = rush.timeLeft;
      rushSnapshot.score = rush.score;
      rushSnapshot.disabled = rush.disabled;
      rushSnapshot.chain = rush.chain;
      rushSnapshot.multiplier = rush.multiplier;
      rushSnapshot.chainFraction = RUSH.scoring.chainWindow > 0 ? rush.chainWindow / RUSH.scoring.chainWindow : 0;
      rushSnapshot.bestChain = rush.bestChain;
      rushSnapshot.styleBonus = rush.styleBonus;
      rushSnapshot.atMarker = rush.atMarker;
      rushSnapshot.canStart = canStartRush(rush);
      rushSnapshot.ranked = rush.ranked;
      rushSnapshot.results = rush.results;
      rushSnapshot.previousBest = rushPreviousBest;
      rushSnapshot.newBest = rushNewBest;
      // The mission on offer. All four are derived from the one progress count, so the sign
      // over the road, the target on the clock and the site under the wheels always agree.
      rushSnapshot.level = rushLevelIndex(rush.cleared);
      rushSnapshot.cleared = rush.cleared;
      rushSnapshot.targetScore = rushTargetScore(rush.cleared);
      rushSnapshot.levelLabel = site.label ?? '';
      rushSnapshot.allClear = rushAllClear(rush.cleared);
      // The board answers on its own schedule; the prompt shows whatever is known by now.
      rushSnapshot.attemptsLeft = leaderboard ? leaderboard.standing().attemptsLeft : -1;

      // The marker in the world answers the car before the prompt does: it warms and quickens
      // over the last stretch of the approach.
      const marker = environment.rushMarker;
      if (marker) {
        const dx = pose.x - site.x;
        const dz = pose.z - site.z;
        const reach = RUSH.marker.promptRadius * 3;
        const near = 1 - Math.min(1, Math.sqrt(dx * dx + dz * dz) / reach);
        marker.setProximity(near * near);
        marker.setRunning(rush.phase === 'running' || rush.phase === 'countdown');
        marker.setHidden(activitySuppressed(engaged, 'rush'));
      }
    }

    /* ------------------------------------------------- the circuit's door */

    const gate = state.circuitGate;
    if (gate && circuitSite) {
      circuitGateSnapshot.offering = canEnterCircuit(gate);
      const marker = environment.circuitMarker;
      if (marker) {
        const dx = pose.x - circuitSite.x;
        const dz = pose.z - circuitSite.z;
        const reach = TIME_ATTACK.marker.promptRadius * 3;
        const near = 1 - Math.min(1, Math.sqrt(dx * dx + dz * dz) / reach);
        marker.setProximity(near * near);
        marker.setHidden(activitySuppressed(engaged, 'circuit'));
      }
    }

    /* ------------------------------------------------- the street race rings */

    const sgate = state.streetGate;
    if (sgate && streetSites) {
      streetGateSnapshot.offering = canEnterStreetRace(sgate);
      const shown = sgate.atSite >= 0 ? sgate.atSite : streetNewestEvent(sgate.cleared);
      if (shown !== streetGateShown) {
        streetGateShown = shown;
        const spec = streetEvent(shown);
        streetGateSnapshot.event = shown;
        streetGateSnapshot.eventName = spec.name;
        streetGateSnapshot.difficulty = spec.difficulty;
        streetGateSnapshot.blurb = spec.blurb;
        streetGateSnapshot.rivals = spec.rivals;
        streetGateSnapshot.completed = shown < sgate.cleared;
        streetGateSnapshot.placeLabel = streetSites[shown]?.label ?? '';
      }
      const markers = environment.streetMarkers;
      const newest = streetNewestEvent(sgate.cleared);
      for (let i = 0; i < markers.length; i++) {
        const site = streetSites[i];
        if (!site) continue;
        const marker = markers[i];
        const dx = pose.x - site.x;
        const dz = pose.z - site.z;
        const reach = STREET_RACE.marker.promptRadius * 3;
        const near = 1 - Math.min(1, Math.sqrt(dx * dx + dz * dz) / reach);
        marker.setProximity(near * near);
        // Won events stay open but go quiet; the newest one is the loud one.
        marker.setRunning(i < newest);
        marker.setHidden(!streetEventOpen(sgate.cleared, i) || activitySuppressed(engaged, 'street'));
      }
    }
    const pax = state.passenger;
    if (pax && passengerStops && pickupMarker && destinationMarker) {
      const trip = pax.trip;
      const def = trip ? passengerById(PASSENGERS, trip.passengerId) : null;
      const pickup = trip ? stopById(passengerStops, trip.pickupId) : null;
      const destination = trip ? stopById(passengerStops, trip.destinationId) : null;
      passengerSnapshot.phase = pax.phase;
      passengerSnapshot.passengerId = def ? def.id : '';
      passengerSnapshot.name = def ? def.name : '';
      passengerSnapshot.tagline = def ? def.tagline : '';
      passengerSnapshot.portrait = def ? def.portrait : '';
      passengerSnapshot.canBoard = canBoard(pax);
      passengerSnapshot.canDropOff = canDropOff(pax);
      passengerSnapshot.cancelArm = pax.cancelArm;
      passengerSnapshot.destinationLabel = destination ? destination.label : '';
      passengerSnapshot.fare = trip ? trip.fare : 0;
      passengerSnapshot.mood = pax.mood;
      passengerSnapshot.prefLabels[0] = def && def.preferences[0] ? preferenceLabel(def.preferences[0]) : '';
      passengerSnapshot.prefLabels[1] = def && def.preferences[1] ? preferenceLabel(def.preferences[1]) : '';
      passengerSnapshot.prefStatus[0] = pax.prefStatus[0];
      passengerSnapshot.prefStatus[1] = pax.prefStatus[1];
      passengerSnapshot.line = pax.line;
      passengerSnapshot.lineKind = pax.lineKind;
      passengerSnapshot.lineId = pax.lineId;
      passengerSnapshot.results = pax.results;
      // The markers answer the car the way the RUSH one does: warmer and quicker as it closes.
      const reach = PASSENGER.marker.promptRadius * 4;
      if (pax.phase === 'offered' && pickup) {
        const dx = pose.x - pickup.x;
        const dz = pose.z - pickup.z;
        const near = 1 - Math.min(1, Math.sqrt(dx * dx + dz * dz) / reach);
        pickupMarker.setProximity(near * near);
      }
      if (pax.phase === 'riding' && destination) {
        const dx = pose.x - destination.x;
        const dz = pose.z - destination.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        passengerSnapshot.distance = d;
        const near = 1 - Math.min(1, d / reach);
        destinationMarker.setProximity(near * near);
      } else {
        passengerSnapshot.distance = 0;
      }
      // The arrow rides the car and only turns: `follow` is the car's own pose, and the heading
      // is the bearing FROM the car TO a point a fixed distance up the route. So it lies down
      // the street while the street is the way and swings across as the junction comes up,
      // while never leaving the screen. It goes away rather than point at nothing when the walk
      // finds no way — off the network, or nowhere left to go.
      if (routeField) steerArrow(routeField, frameDt);
      pickupMarker.update(simTime);
      destinationMarker.update(simTime);
      passengerFigure?.update(simTime);
    }
    const buho = state.buho;
    if (buho && hasBuho) {
      buhoSnapshot.atSite = buho.atSite;
      buhoSnapshot.canBuy = canBuyMoogul(buho);
      buhoSnapshot.confirmArm = buho.confirmArm;
      buhoSnapshot.notice = buho.notice;
      buhoSnapshot.active = buho.moogulActive;
      buhoSnapshot.intensity = moogul ? moogul.shown : 0;
      buhoSnapshot.line = buho.line;
      buhoSnapshot.lineId = buho.lineId;
    }
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
    const timeAttack = state.timeAttack;
    if (timeAttack) {
      // Which mission is on offer, and what it asks for, are both read off `cleared` through
      // the same helpers the rules use — so the strip and the verdict can never disagree.
      const level = timeAttackLevelIndex(timeAttack.cleared);
      const spec = timeAttackLevel(timeAttack.cleared);
      timeAttackSnapshot.level = level;
      timeAttackSnapshot.cleared = timeAttack.cleared;
      timeAttackSnapshot.levelName = spec.name;
      timeAttackSnapshot.targetTime = spec.seconds;
      timeAttackSnapshot.crashLimit = spec.crashes;
      timeAttackSnapshot.crashes = timeAttack.crashes;
      timeAttackSnapshot.failed = timeAttack.failed;
      timeAttackSnapshot.allClear = timeAttackAllClear(timeAttack.cleared);
      timeAttackSnapshot.results = timeAttack.results;
      timeAttackSnapshot.previousBest = timeAttackPreviousBest;
      timeAttackSnapshot.newBest = timeAttackNewBest;
    }
    if (streetRace && state.race) {
      streetRaceSnapshot.position = streetPosition(streetRace, state.race);
      streetRaceSnapshot.shortcut = state.race.shortcut;
      streetRaceSnapshot.results = streetRace.results;
    }
    const police = state.police;
    if (police) {
      const chasing = police.phase === 'pursuit' || police.phase === 'escaping';
      policeSnapshot.heat01 = POLICE.heat.max > 0 ? police.heat / POLICE.heat.max : 0;
      policeSnapshot.stars = police.stars;
      policeSnapshot.phase = police.phase;
      policeSnapshot.escapeLeft = police.escapeLeft;
      policeSnapshot.bust01 = POLICE.bust.seconds > 0 ? police.pinned / POLICE.bust.seconds : 0;
      policeSnapshot.holdLeft = police.holdLeft;
      policeSnapshot.shielded = police.aimedUnit >= 0;
      policeSnapshot.bustedStars = police.bustedStars;
      policeSnapshot.bustedFine = police.bustedFine;
      policeSnapshot.bustedCharged = police.bustedCharged;
      if (policeAudio) policeAudio.siren = chasing;
    }
    const intro = state.intro;
    if (intro && introOverlay) {
      if (intro.active) {
        if (introMarker && intro.objective && intro.objectiveRadius > 0) {
          const dx = pose.x - intro.objectiveX;
          const dz = pose.z - intro.objectiveZ;
          const near = 1 - Math.min(1, Math.sqrt(dx * dx + dz * dz) / (intro.objectiveRadius * 3));
          introMarker.setProximity(near * near);
        }
        if (introRoute) steerArrow(introRoute, frameDt);
        introSnapshot.stage = intro.stage;
        introSnapshot.objective = intro.objective;
        introSnapshot.assistOffered = intro.assistOffered;
        introSnapshot.talking = intro.lineId !== '';
        introOverlay.update(introSnapshot);
      }
      introMarker?.update(simTime);
    }
    for (let i = 0; i < introParked.length; i++) introParked[i].vis.update(frameDt, simTime);
    badkalaFigure?.update(simTime);
    hud.update(snapshot);
    minimap.update(pose.x, pose.z, pose.heading, state.targets, rivals);
    if (standings) {
      updateStandings();
      standings.update(standingsOrder);
    }
    if (nameTags) nameTags.update(chase.camera, rivals);

    gpuTimer.begin();
    // Not behind the opening clip: an opaque video over a city nobody can see is GPU time spent
    // on nothing. The simulation above ran regardless — a networked city is never paused.
    if (!introOverlay || !introOverlay.opaque) {
      speedBlur.render(scene, chase.camera, speedBlurStrength(nitroVisual, v.speed), moogul ? moogul.finish : null);
    }
    gpuTimer.end();

    readout.carX = pose.x;
    readout.carY = pose.y;
    readout.carZ = pose.z;
    readout.heading = pose.heading;
    readout.camX = chase.camera.position.x;
    readout.camY = chase.camera.position.y;
    readout.camZ = chase.camera.position.z;
    if (debug.visible) sampleProbe(false);

    debugInput.simMs = stats.simMs;
    debugInput.renderMs = stats.renderMs;
    debugInput.gpuMs = gpuMs;
    debugInput.pixelRatio = renderer.getPixelRatio();
    debugInput.governor = governor.status;
    debug.update(frameDt, renderer, debugInput);
  }

  /**
   * One crosshair reading into `readout`. `precise` pays for a scene raycast (about 11 ms in
   * the city) and lands on the visible surface; without it the reading is the ground point
   * under the crosshair, which is free and is the coordinate the world specs are written in.
   */
  function sampleProbe(precise: boolean): WorldReadout {
    const ground = probe.ground();
    readout.aimX = ground.x;
    readout.aimY = ground.y;
    readout.aimZ = ground.z;
    readout.aimDistance = ground.distance;
    readout.aimValid = ground.valid;
    // A collider tag says more than a mesh name: it is the rectangle the world spec declares.
    readout.aimWhat = ground.valid ? colliderTag(ground.x, ground.z) ?? ground.what : ground.what;
    if (precise) {
      const hit = probe.sample();
      const s = readout.surface;
      s.x = hit.x;
      s.y = hit.y;
      s.z = hit.z;
      s.distance = hit.distance;
      s.valid = hit.valid;
      s.what = hit.valid ? colliderTag(hit.x, hit.z) ?? hit.what : hit.what;
      s.taken = true;
    }
    return readout;
  }

  /** Tag of the first collider covering this ground position, if any. */
  function colliderTag(x: number, z: number): string | null {
    for (const c of layout.colliders) {
      if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) {
        return `${c.tag} [${c.minX.toFixed(0)}..${c.maxX.toFixed(0)} x ${c.minZ.toFixed(0)}..${c.maxZ.toFixed(0)}]`;
      }
    }
    return null;
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
      // The opening plays over the first frames; the rules hold the car until it is over.
      introOverlay?.startOpening();
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
      onlinePanel?.dispose();
      introOverlay?.dispose();
      for (const p of introParked) {
        scene.remove(p.vis.root);
        p.vis.dispose();
      }
      introParked.length = 0;
      if (badkalaFigure) {
        scene.remove(badkalaFigure.group);
        badkalaFigure.dispose();
      }
      if (introMarker) {
        scene.remove(introMarker.group);
        introMarker.dispose();
      }
      theme.duck(1);
      debug.dispose();
      audio.dispose();
      effects.dispose();
      for (const t of targetVisuals) t.dispose();
      for (const b of busVisuals) b.dispose();
      for (const p of policeVisuals) p.dispose();
      disposePoliceCarResources();
      disposeElectricCarResources();
      for (const r of rivalPool.values()) {
        scene.remove(r.root);
        r.dispose();
      }
      rivalPool.clear();
      rivalVisuals = [];
      disposeRivalCarResources();
      car.dispose();
      // Before the environment: letting go writes the sky's own colours back through it.
      moogul?.dispose();
      if (buhoFigure) {
        scene.remove(buhoFigure.group);
        buhoFigure.dispose();
      }
      environment.dispose();
      if (pickupMarker) {
        scene.remove(pickupMarker.group);
        pickupMarker.dispose();
      }
      if (destinationMarker) {
        scene.remove(destinationMarker.group);
        destinationMarker.dispose();
      }
      if (passengerFigure) {
        scene.remove(passengerFigure.group);
        passengerFigure.dispose();
      }
      if (destinationArrow) {
        scene.remove(destinationArrow.group);
        destinationArrow.dispose();
      }
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
    /**
     * The Street Race, for automation: the rivals (car, race state, driver) and the results.
     *
     *   __rb.streetRace.status()   // { event, phase, position, rivals: [{ name, lap, progress, station, route }] }
     */
    streetRace: streetRace
      ? {
          state: streetRace,
          status: () => ({
            event: streetRace.event,
            cleared: streetRace.cleared,
            phase: state.race?.phase ?? 'countdown',
            position: state.race ? streetPosition(streetRace, state.race) : 1,
            results: streetRace.results,
            rivals: streetRace.rivals.map((r) => ({
              name: r.car.name,
              lap: r.race.lap,
              progress: r.race.progress,
              station: r.ai.station,
              route: r.ai.route,
              speed: r.v.speed,
              finishTime: r.race.finishTime,
              recovering: r.ai.recovering,
            })),
          }),
        }
      : null,
    /** True in the open world: a networked city rather than a race. */
    openWorld: roaming,
    /** Grid slot and paint of the local car, and the paint of each rival, for the colour QA. */
    get selfSlot() {
      return net ? net.slot : null;
    },
    selfColour: car.paint,
    // A getter, not a snapshot: the city's field changes while the page is open.
    get rivalColours() {
      return rivals.map((r) => ({ id: r.id, slot: r.slot, colour: slotCss(r.slot) }));
    },
    metrics: debug.metrics,
    /** World coordinates right now, crosshair included — the overlay's readout, for scripts. */
    where() {
      return { ...sampleProbe(true), line: clipboardLine(readout) };
    },
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
    /**
     * The sky and the storm, for tuning with the game running. `ATMOSPHERE` in
     * `src/config/tuning.ts` is the source of truth; write to it and call `refresh()`:
     *
     *   __rb.atmosphere.config.coverage = 0.8; __rb.atmosphere.refresh()
     *   __rb.atmosphere.strike()            // fire a bolt now instead of waiting for one
     */
    atmosphere: {
      config: ATMOSPHERE,
      refresh: () => environment.atmosphere.refresh(),
      strike: () => environment.atmosphere.storm.fire(),
      /** Quality level in force, the live flash (0..1) and the rain drop count. */
      status() {
        const a = environment.atmosphere;
        return { quality: a.quality, flash: a.flash, drops: a.rain.count, nextStrikeIn: a.storm.nextIn };
      },
    },
    /** Camera view. Reads the live view with no argument, cuts to one with an argument. */
    view(next?: CameraView) {
      if (next) chase.setView(next);
      return chase.view;
    },
    /**
     * The reactive phrases (`src/sim/flair.ts`), for automation and for looking at them without
     * having to earn one. `state` is the live streak; `say(id)` puts a phrase on the glass right
     * now, presentation only — it goes straight to the HUD and the audio and never touches the
     * streak, so it can neither grant nor spend anything the rules care about.
     *
     *   __rb.flair.state.units        // internal units in the streak under way
     *   __rb.flair.say('auraInfinita')
     *   __rb.flair.messages           // every phrase the game is allowed to say
     */
    flair: {
      get state() {
        return state.flair;
      },
      config: FLAIR,
      messages: FLAIR_MESSAGES.map((m) => m.id),
      say(id: string) {
        const m = FLAIR_MESSAGES.find((x) => x.id === id);
        if (!m) return false;
        handleEvent({ type: 'flair', id: m.id, text: m.text, tier: m.tier, seconds: flairSeconds(m.tier) });
        return true;
      },
    },
    /**
     * RAYO RUSH, for automation and for tuning with the game running. `state.rush` is the live
     * rules state; `activate()` is the F key; `standing()` is what the board currently says.
     *
     *   __rb.rush.activate()        // take up the run (or dismiss the results card)
     *   __rb.rush.state.timeLeft    // seconds on the clock
     *   __rb.rush.progress()        // { cleared, level, target, site } — where in the chain
     *   __rb.rush.setLevel(2)       // jump the chain to mission 3 and move the marker there
     */
    rush: hasRush
      ? {
          /** Where the marker is standing right now, i.e. the site of the mission on offer. */
          get site() {
            return rushSite();
          },
          /** Every site the chain runs through, in mission order. */
          sites: rushSites,
          config: RUSH,
          get state() {
            return state.rush;
          },
          activate() {
            activateQueued = true;
          },
          /** Where the chain has got to, and what the mission on offer is asking for. */
          progress() {
            const cleared = state.rush?.cleared ?? 0;
            return {
              cleared,
              level: rushLevelIndex(cleared),
              levelCount: rushLevelCount(),
              target: rushTargetScore(cleared),
              allClear: rushAllClear(cleared),
              site: rushSite(),
              best: rushProgress ? rushProgress.best.slice() : [],
            };
          },
          /**
           * Put the chain at a given number of cleared missions and move the marker to match.
           * For automation and for looking at a level without first driving the two before it;
           * it writes the record, because a debug jump that unwound itself on reload would be a
           * worse lie than one that sticks.
           */
          setLevel(cleared: number) {
            if (!state.rush) return null;
            setRushProgress(state.rush, cleared);
            if (rushProgress) {
              rushProgress = { ...rushProgress, cleared: state.rush.cleared };
              writeRushProgress(rushProgress);
            }
            placeRushMarker();
            return state.rush.cleared;
          },
          standing: () => leaderboard?.standing() ?? null,
          top: (limit?: number) => leaderboard?.top(limit) ?? Promise.resolve([]),
        }
      : null,

    /**
     * THE CIRCUIT MISSIONS, for automation and for tuning with the game running. Null in every
     * session that is not the solo circuit — including the versus race on the same course.
     *
     *   __rb.timeAttack.state.crashes   // crashes counted in the run under way
     *   __rb.timeAttack.progress()      // { cleared, level, target, crashLimit, best }
     *   __rb.timeAttack.setLevel(2)     // jump the chain to mission 3 (and write it down)
     */
    timeAttack: state.timeAttack
      ? {
          config: TIME_ATTACK,
          get state() {
            return state.timeAttack;
          },
          progress() {
            const cleared = state.timeAttack?.cleared ?? 0;
            const spec = timeAttackLevel(cleared);
            return {
              cleared,
              level: timeAttackLevelIndex(cleared),
              levelCount: timeAttackLevelCount(),
              name: spec.name,
              target: spec.seconds,
              crashLimit: spec.crashes,
              allClear: timeAttackAllClear(cleared),
              best: timeAttackProgress ? timeAttackProgress.best.slice() : [],
            };
          },
          /**
           * Put the chain at a given number of cleared missions. Like the rush's, it writes the
           * record: a debug jump that unwound itself on reload would be the worse lie.
           */
          setLevel(cleared: number) {
            if (!state.timeAttack) return null;
            setTimeAttackProgress(state.timeAttack, cleared);
            if (timeAttackProgress) {
              timeAttackProgress = { ...timeAttackProgress, cleared: state.timeAttack.cleared };
              writeTimeAttackProgress(timeAttackProgress);
            }
            return state.timeAttack.cleared;
          },
        }
      : null,

    /**
     * PASSENGERS, for automation and for tuning with the game running. `state` is the live
     * rules state; `activate()` is the F key; `offerNow()` puts the next pin up at once;
     * `stop(id)` looks a stop up so a script can teleport to it.
     *
     *   __rb.passenger.offerNow()             // skip the wait for the next pin
     *   __rb.passenger.state.trip             // who, from where, to where, for how much
     *   __rb.passenger.stop('the-quay')       // { x, z, ... } to drive to
     */
    passenger: hasPassengers
      ? {
          config: PASSENGER,
          catalog: PASSENGERS,
          stops: passengerStops,
          get state() {
            return state.passenger;
          },
          activate() {
            activateQueued = true;
          },
          offerNow() {
            if (state.passenger && state.passenger.phase === 'idle') state.passenger.offerIn = 0;
            return state.passenger?.phase ?? null;
          },
          stop(id: string) {
            return stopById(passengerStops, id);
          },
          progress() {
            return rideProgress ? { ...rideProgress } : null;
          },
        }
      : null,

    /**
     * EL BÚHO AND THE MOOGUL, for automation and for looking at the trip without waiting eight
     * minutes for it. `state` is the live rules state; `activate()` is the F key; the rest
     * drives the clock directly.
     *
     *   __rb.buho.activate()        // the F key: arm, then buy
     *   __rb.buho.grant(200)        // the Moogul without paying, 200 s in (development only)
     *   __rb.buho.scrub(300)        // jump the clock to 5:00
     *   __rb.buho.timeScale(20)     // run the clock twenty times faster
     *   __rb.buho.status()          // { active, elapsed, intensity, shown, faces, finish }
     *   __rb.buho.end()             // wear it off now
     */
    buho: hasBuho
      ? {
          config: MOOGUL,
          def: BUHO,
          site: buhoSite,
          /** The building index the faces are placed from, for looking at what they had to choose from. */
          walls: environment.moogul.walls,
          get state() {
            return state.buho;
          },
          activate() {
            activateQueued = true;
          },
          grant(elapsed = 0) {
            if (state.buho) grantMoogul(state.buho, state.events, elapsed);
            return state.buho?.moogulElapsed ?? null;
          },
          scrub(seconds: number) {
            const b = state.buho;
            if (!b) return null;
            if (!b.moogulActive) grantMoogul(b, state.events, seconds);
            b.moogulElapsed = Math.max(0, seconds);
            return b.moogulElapsed;
          },
          timeScale(scale?: number) {
            if (scale !== undefined) MOOGUL.debug.timeScale = Math.max(0, scale);
            return MOOGUL.debug.timeScale;
          },
          end() {
            if (state.buho) endMoogul(state.buho, 'debug', state.events);
          },
          status() {
            const b = state.buho;
            return {
              active: !!b && b.moogulActive,
              elapsed: b ? b.moogulElapsed : 0,
              intensity: b && b.moogulActive ? moogulIntensity(b.moogulElapsed) : 0,
              shown: moogul ? moogul.shown : 0,
              faces: moogul ? moogul.faces : 0,
              atSite: !!b && b.atSite,
              purchases: b ? b.purchases : 0,
              money: state.economy.money,
              /** What the finishing pass is being asked for this frame, halo included. */
              finish: moogul ? moogul.finish : null,
            };
          },
        }
      : null,

    /**
     * THE CIRCUIT MISSIONS' DOOR, for automation. Null everywhere but the open world.
     *
     *   __rb.circuitGate.site()      // { x, z, heading, label } — where to drive to
     *   __rb.circuitGate.offering()  // is the sign up right now
     *   __rb.circuitGate.mission()   // which mission the sign is offering, from storage
     *
     * There is deliberately no `enter()`: taking the door loads another page, and a script that
     * wants that should press the key (`__rb.inject({ activate: true })`) the way a player does.
     */
    circuitGate: state.circuitGate
      ? {
          get state() {
            return state.circuitGate;
          },
          site: () => (circuitSite ? { ...circuitSite } : null),
          offering: () => (state.circuitGate ? canEnterCircuit(state.circuitGate) : false),
          mission: () => ({ ...circuitGateSnapshot }),
        }
      : null,

    /**
     * THE INTRODUCTION, for automation. Null in every session that is not running it.
     *
     *   __rb.intro.state            // the live `IntroState`
     *   __rb.intro.status()         // { stage, objective, line, done, ... }
     *   __rb.intro.finishOpening()  // end the opening now
     *   __rb.intro.finishClip()     // end the clip at the meet now
     *   __rb.intro.skipLine()       // end the line on screen
     *   __rb.intro.assist()         // take CONTINUAR, when offered
     *   __rb.intro.skip()           // skip the whole introduction
     */
    intro: state.intro
      ? {
          config: INTRO,
          get state() {
            return state.intro;
          },
          status() {
            const i = state.intro!;
            return {
              stage: i.stage,
              active: i.active,
              objective: i.objective,
              objectiveText: i.objectiveText,
              line: i.lineId,
              lineText: i.lineText,
              queue: i.queue.slice(),
              said: Array.from(i.said),
              ringing: i.ringing,
              connected: i.callConnected,
              assistOffered: i.assistOffered,
              driftDone: i.driftDone,
              evDone: i.evDone,
              done: i.done,
              charge: state.lightning.charge,
              money: state.economy.money,
              cinematicDone: i.cinematicDone,
            };
          },
          finishOpening: () => {
            if (state.intro) finishIntroOpening(state.intro);
          },
          finishClip: () => {
            if (state.intro) finishIntroCinematic(state.intro);
          },
          skipLine: () => {
            if (state.intro) skipIntroLine(state.intro);
          },
          assist: () => {
            if (state.intro) acceptIntroAssist(state.intro);
          },
          skip: () => {
            if (state.intro) skipIntro(state.intro);
          },
        }
      : null,

    /** Which activity has the car right now, or null. The one answer everything else is derived from. */
    engaged: () => engagedActivity(state),

    /**
     * THE POLICE, for automation. Null everywhere but the open world.
     *
     *   __rb.police.state          // the live `PoliceState`
     *   __rb.police.enabled()      // `isPoliceEnabledForCurrentGameState` right now
     *   __rb.police.heat(60)       // set the heat (and read it back with no argument)
     *   __rb.police.units()        // the cars on the road: id, role, position, lights, sight
     *   __rb.police.stats()        // the session's counters
     */
    police: state.police
      ? {
          get state() {
            return state.police;
          },
          enabled: () => isPoliceEnabledForCurrentGameState(state),
          heat(value?: number) {
            const p = state.police!;
            if (value !== undefined) p.heat = Math.max(0, Math.min(POLICE.heat.max, value));
            return p.heat;
          },
          units: () =>
            state.police!.units
              .filter((u) => u.status === 'active')
              .map((u) => ({ id: u.id, role: u.role, x: u.x, z: u.z, heading: u.heading, speed: u.speed, lights: u.lights, sight: u.sight })),
          stats: () => ({ ...state.police!.stats, starsReached: [...state.police!.stats.starsReached] }),
        }
      : null,

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
