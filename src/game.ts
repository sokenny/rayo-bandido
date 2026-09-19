import * as THREE from 'three';
import { cityRecovery } from './world/cityRecovery';
import { LAKE } from './world/park';
import { createArenaWorld } from './world/arenaWorld';
import { createCityWorld } from './world/cityWorld';
import { STACK_SPEC } from './world/stackSpec';
import { createOpenWorld } from './world/openWorld';
import { createRushWorld } from './world/rushWorld';
import { createStreetWorld } from './world/streetWorld';
import { createCurvaWorld } from './world/curvaWorld';
import { spawnForSlot } from './world/arrivals';
import { createCircuitWorld } from './world/circuitWorld';
import { createRaceWorld } from './world/raceWorld';
import type {
  ActivityMarkKind,
  ActivitySite,
  BuhoHudSnapshot,
  GarageHudSnapshot,
  HustlerHudSnapshot,
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
  RushRival,
  TimeAttackHudSnapshot,
  Transmission, PoliceHudSnapshot } from './core/types';
import { ATMOSPHERE, AUDIO, SIM_STEP, CAMERA, CRASH_DAMAGE, FLAIR, HUSTLERS, LIGHTNING, MEET_MUSIC, MINIMAP, MOOGUL, NITRO, PASSENGER, RENDER, RUSH, STREET_RACE, STREET_PROPS, SEWER_STEAM, TIME_ATTACK, VEHICLE, POLICE } from './config/tuning';
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
import { restVehicle } from './sim/surface';
import { createCruiseController } from './sim/cruise';
import {
  beginRush,
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
import { canEnterStreetRace, streetNewestEvent } from './sim/streetGate';
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
import { readStreetRaceProgress, readWallet, recordStreetRace, writeStreetRaceProgress, writeWallet } from './core/progress';
import { readIntroProgress, writeIntroProgress } from './core/progress';
import { readGarage } from './core/progress';
import { activitySuppressed, engagedActivity, introEngaged, workshopEngaged, type ActivityKind } from './sim/activities';
import { INTRO } from './content/intro';
import { acceptIntroAssist, finishIntroCinematic, finishIntroOpening, installIntroMeetup, skipIntro, skipIntroLine } from './sim/intro';
import { createHumanFigure, type HumanFigureVisual } from './render/scene/env/humanRig';
import { speakerSong, type CrowdSubject } from './render/scene/env/humanActs';
import { createIntroOverlay, type IntroOverlay, type IntroOverlaySnapshot } from './ui/introOverlay';
import { createSaveProgressPrompt, type SaveProgressPrompt } from './ui/saveProgressPrompt';
import { createPlayAnalytics } from './analyticsPlay';
import { boltLoad, canAffordShot } from './sim/lightning';
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
import { createGarageFigure } from './render/scene/env/garageFigure';
import { GARAGE } from './world/garage';
import { LOCO_MUSTANG } from './content/garage';
import { garageOpenToTalk } from './sim/garage';
import { LOCO_MUSTANG_SHOP } from './content/shops';
import { createWorkshopController, type WorkshopController } from './workshop/controller';
import { hustlerAt, hustlerName, washerOfferOpen } from './sim/hustlers';
import { createHustlersVisual } from './render/scene/hustlersVisual';
import { createMicroSceneVisual } from './render/scene/microSceneVisual';
import { createMicroSceneDebug } from './microScenes/debug';
import { reportCatalogIssues } from './microScenes/validate';
import { createMoogulTrip } from './render/scene/moogulTrip';
import { createLeaderboard, fetchBoard, flushPendingRuns, submitRaceTime } from './net/leaderboard';
import { account } from './net/account';
import { boardToRivals, LADDER_PAGE, placeOnLadder, type LadderPlace } from './ui/rushLadder';
import type { LeaderboardKind } from './content/leaderboards';
import { shiftKickStrength } from './sim/drivetrain';
import { createRenderer } from './render/renderer';
import { createSpeedBlur, speedBlurStrength } from './render/post/speedBlur';
import { createEnvironment } from './render/scene/environment';
import { createStreetPropsVisual, type StreetPropsVisual } from './render/scene/streetPropsVisual';
import { resolveQuality } from './render/scene/env/atmosphere';
import { thinSewerSteam, thinStreetProps } from './world/streetProps';
import { createSewerSteamVisual, type SewerSteamVisual } from './render/scene/sewerSteamVisual';
import { createAerialTraffic, type AerialTrafficVisual } from './render/scene/aerialTrafficVisual';
import { createCarVisual } from './render/scene/carVisual';
import { disposeElectricCarResources } from './render/scene/electricCarVisual';
import { createElectricFleet } from './render/scene/electricFleet';
import { createPoliceCarVisual, disposePoliceCarResources, type PoliceCarVisual } from './render/scene/policeCarVisual';
import { isPoliceEnabledForCurrentGameState } from './sim/police';
import { createBusVisual, type BusVisual } from './render/scene/busVisual';
import { createChaseCamera, type CameraPose, type CameraView } from './render/camera/chaseCamera';
import { createWorldProbe } from './render/probe';
import { createEffects } from './render/fx';
import { BOLT_TO_Y } from './render/fx/lightningArc';
import { interpolateVehicle, syncBuses, syncCar, syncFleet, syncPolice, type InterpolatedPose } from './render/sync';
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
import { configureDialogueVoice, placeDialogueListener, speakDialogue } from './audio/dialogueVoice';
import { busStopCrowds } from './world/busStopCrowds';
import { createAudio, type PoliceAudioInput } from './audio';
import { createBackfireTrigger } from './audio/backfire';
import { createPassByDetector } from './audio/passBy';
import type { Listener } from './audio/electricHum';
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
/** How long a car sits in a lake before the recovery pulls it out (s). */
const LAKE_RESCUE_AFTER = 1.6;

/** How often the hologram high-score boards ask the server for their rows again (ms). */
const BOARD_REFRESH_MS = 60_000;

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
          ? // The Street Race's own instance of the city: the Bay's Quay Circuit
            // (`src/world/streetWorld.ts`), or La Curva on the metro (`src/world/curvaWorld.ts`).
            // In a room the match id is the seed, as it is on the circuit: every client lays the
            // same traffic on the lap.
            streetEvent(Number(params.get('event') ?? 0)).course === 'curva'
            ? createCurvaWorld(options.net?.match?.raceId)
            : createStreetWorld(options.net?.match?.raceId)
        : mode === 'rush'
          ? // RAYO RUSH on its own (`src/world/rushWorld.ts`): the metro with nothing in it but the
            // run, the car put down on the marker — the mission on offer alone, the first in a room.
            createRushWorld(options.net ? 0 : rushLevelIndex(readRushProgress().cleared))
        : mode === 'city'
          ? // The open world: Bandido Metro, with the doors to the races painted on it. Layers
            // over the city rather than parts of it (`src/world/openWorld.ts`), for the same
            // reason the circuit itself is one: the city does not know the race exists.
            createOpenWorld()
          : mode === 'bay'
            ? // Bandido Bay, the first open world, kept by address as it was before the metro
              // took its place: solo, its own activities and police, no doors and no intro.
              createCityWorld()
            : mode === 'stack'
              ? // The Stack (`src/world/stackSpec.ts`): the second city, now the metro's downtown.
                // Kept by address: solo, no police, no missions and no intro.
                createCityWorld(STACK_SPEC)
              : createArenaWorld();
  const layout = world.layout;
  // The street props' decorative density follows the quality preset (`STREET_PROPS.qualityDensity`),
  // decided before the state is built so the rules never collide with a prop that is not drawn.
  const propQuality = resolveQuality(ATMOSPHERE.quality, isTouchDevice());
  if (layout.streetProps) layout.streetProps = thinStreetProps(layout.streetProps, STREET_PROPS.qualityDensity[propQuality]);
  if (layout.sewerVents) layout.sewerVents = thinSewerSteam(layout.sewerVents, SEWER_STEAM.qualityShare[propQuality]);

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
  } else if (match && mode === 'rush') {
    // A rush room has no grid: the slot fans the field out around the marker they all start on.
    layout.playerSpawn = spawnForSlot(layout.playerSpawn, match.slot);
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
  /**
   * LOCO MUSTANG'S WORKSHOP (`docs/GARAGE_PLAN.md`): what the car wears, read once here — the car
   * is dressed in it wherever it drives (in a room the paint gives way to the slot colour, D3,
   * and the parts still show) — and, in the open world outside a match, the save the workshop
   * behind the garage opens with.
   */
  const garageSave = readGarage();
  const state = createInitialGameState(layout, readTransmission(), {
    timeAttack: hasTimeAttack,
    timeAttackCleared: timeAttackProgress?.cleared ?? 0,
    streetRaceCleared: streetProgress?.cleared ?? 0,
    intro: introWanted,
    // THE POLICE (`src/sim/police.ts`): Free Roam only, which is the open world (and the Bay it
    // replaced) and nothing else. Whether they may act on any given tick is the sim's question;
    // whether they exist at all is this one.
    police: mode === 'city' || mode === 'bay',
    workshop: mode === 'city' && !match ? garageSave : null,
  });
  /**
   * THE WALLET (`readWallet`): the money follows the player across the page loads between the
   * open world and the races it opens onto. Not in a versus race, whose counter is the match's.
   */
  const hasWallet = (mode === 'city' || mode === 'street' || mode === 'rush' || hasTimeAttack) && !match;
  let savedMoney = hasWallet ? readWallet() : 0;
  if (hasWallet) state.economy.money = savedMoney;
  let walletEconomy = state.economy;
  // The field: built from the grid, clamped to the events this browser has unlocked. A
  // standalone event (La Curva) also carries whether it has been won here before, for its reward.
  const streetEventAsked = Number(params.get('event') ?? 0);
  const streetRace: StreetRaceState | null =
    hasStreetRace && layout.race
      ? createStreetRaceState(layout.race, streetEventAsked, streetProgress?.cleared ?? 0, streetProgress?.best[streetEventAsked] === 1)
      : null;
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
  const environment = createEnvironment(scene, world.plan, { wet: params.get('wet') });
  // The crashable pavement props (`src/sim/streetProps.ts`), in the worlds that carry them.
  let streetPropsVisual: StreetPropsVisual | null = null;
  if (state.streetProps) {
    streetPropsVisual = createStreetPropsVisual(state.streetProps.defs, environment.signAtlas, propQuality);
    scene.add(streetPropsVisual.root);
  }
  // Manholes and kerb grates, some of them steaming (`src/render/scene/sewerSteamVisual.ts`).
  let sewerVisual: SewerSteamVisual | null = null;
  if (layout.sewerVents && layout.sewerVents.length > 0) {
    sewerVisual = createSewerSteamVisual(layout.sewerVents, propQuality);
    scene.add(sewerVisual.root);
  }
  // Hovercars over the avenues and drones over the pavements, cosmetic only
  // (`src/render/scene/aerialTrafficVisual.ts`). `?aerial=off` leaves them out for an A/B capture.
  let aerialTraffic: AerialTrafficVisual | null = null;
  if (params.get('aerial') !== 'off') {
    aerialTraffic = createAerialTraffic(world.plan, propQuality);
    if (aerialTraffic) scene.add(aerialTraffic.root);
  }
  end();

  end = measure('vehicles');
  // Online the car wears its slot's colour, the colour every other screen draws it in.
  const car = createCarVisual(net ? { slot: net.slot, loadout: garageSave.loadout } : { loadout: garageSave.loadout });
  // The chase camera looks straight through the player's own car, so the coordinate probe
  // has to see past it — otherwise every reading would be the bodywork.
  car.root.userData.probeIgnore = true;
  scene.add(car.root);
  // The electric traffic, instanced (`src/render/scene/electricFleet.ts`): a handful of draws
  // for the whole fleet instead of four per car.
  const targetFleet = createElectricFleet(state.targets.length);
  scene.add(targetFleet.root);
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
  // The speaker stacks at the meets play the meet's song (`audio/meetSpeakers.ts`).
  const meetSpeakerPoints = (world.plan.meets ?? []).flatMap((m) => m.props.filter((p) => p.kind === 'speakers').map((p) => ({ x: p.x, z: p.z })));
  if (meetSpeakerPoints.length > 0) {
    speakerSong.x = meetSpeakerPoints[0].x;
    speakerSong.z = meetSpeakerPoints[0].z;
  }
  const audio = createAudio(state.targets.length, busStopCrowds(world.plan.busStops), meetSpeakerPoints);
  // The exhaust the car wears (`loadout.exhaustSound`); the workshop changes it live.
  audio.setExhaust(car.loadout.exhaustSound);
  // Background theme song. Loops quietly under the game.
  // Autoplay policy: it stays silent until the first key press / click (see arm()).
  const theme = createThemeAudio();
  theme.arm(window);
  // No music while the intro runs: BadKala's call has the room to itself. Held here rather than by
  // each caller, so a line ending (which restores the duck) cannot bring it back early; `endIntro`
  // lets go. Not the player's mute (M): that one would silence the voice too.
  let introHoldsMusic = !!state.intro;
  // Two reasons to lower the radio, multiplied: a voice over it, and the meet's own song in earshot.
  let voiceDuck = 1;
  let meetDuck = 1;
  const applyMusicDuck = (): void => theme.duck(introHoldsMusic ? 0 : voiceDuck * meetDuck);
  const duckMusic = (level: number): void => {
    voiceDuck = level;
    applyMusicDuck();
  };
  duckMusic(1);
  // Spoken dialogue follows the game's mute (M) and sits over the music the way a call does.
  configureDialogueVoice({ isMuted: () => theme.isMuted(), duckMusic, duckLevel: INTRO.call.duck });
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
  // Not in a rush ROOM: a match is a run against the people in it, not an attempt on the board.
  const leaderboard = hasRush && !match ? createLeaderboard() : null;
  // Runs a saturated server could not take last time go out now, behind the frame.
  void flushPendingRuns();
  /** One flag per electric car: whether it is drawn as a target this frame. */
  const rushMarks = hasRush ? new Uint8Array(state.targets.length) : null;
  /**
   * How far through the mission chain this browser says the player has got. Read ONCE, here,
   * and then owned by the simulation (`RushState.cleared`) — this variable is only the thing
   * that gets written back, so there is never a moment where the world is showing one mission
   * and storage believes another.
   */
  // Nor is its run a step of anybody's mission chain: every car in a room plays the first site.
  let rushProgress = hasRush && !match ? readRushProgress() : null;
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
   * The live ladder's board (`src/ui/rushLadder.ts`): the other players' bests, fetched at boot,
   * again as each run starts and once a run lands on the board. Empty offline, which hides it.
   */
  let rushRivals: RushRival[] = [];
  const rushPlace: LadderPlace = { above: null, below: null, rank: -1 };
  function refreshRushRivals(): void {
    if (!leaderboard) return;
    void Promise.all([leaderboard.refresh(), leaderboard.top(LADDER_PAGE)]).then(([standing, rows]) => {
      if (disposed || rows.length === 0) return;
      rushRivals = boardToRivals(rows, standing, account().state.user?.name ?? null);
    });
  }
  /**
   * The circuit mission's own version of the same pair: the best time on the mission that just
   * finished, frozen BEFORE the run is folded into the record, so the card can say whether it
   * was beaten. -1 when the mission has never been finished.
   */
  let timeAttackPreviousBest = -1;
  let timeAttackNewBest = false;
  /**
   * QUICK PLAY'S RAYO RUSH (`?mode=rush`): the run is taken up for the player — on the first tick,
   * and again on every restart — rather than waiting on the F key at the marker the car is
   * already standing on. In a rush ROOM it is taken up once, at the server's GO, and never
   * again: the one run is the match.
   */
  const quickRush = mode === 'rush' && hasRush;
  const rushMatch = quickRush && !!match;
  let rushBeginPending = quickRush;
  /** The room's run has been taken up; the marker offers nothing after it. */
  let rushMatchStarted = false;

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
   * The arrow over the street ahead while a fare is aboard, an intro objective is up or the
   * player has a waypoint of their own, and the street network it is aimed along. The graph is
   * built once, here, because it is a fact about the world; the route field is rebuilt per ride,
   * in `placePassengerMarkers`, because it is a fact about the trip. A world with no network
   * still runs — it simply has no arrow.
   */
  const roadGraph: RoadGraph | null =
    layout.roadNetwork && layout.roadNetwork.length > 0 ? buildRoadGraph(layout.roadNetwork) : null;
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
  /** Loco Mustang's garage, in the world that has it: the man and the ring out front (`src/sim/garage.ts`). */
  const garageSite: ActivitySite | null = layout.garageSite ?? null;
  const hasGarage = !!(garageSite && state.garage && world.plan.garage);
  const garageFigure = hasGarage && world.plan.garage ? createGarageFigure(world.plan.garage) : null;
  if (garageFigure) scene.add(garageFigure.group);
  /**
   * The trapitos and the windshield washers (`src/sim/hustlers.ts`), in the world that carries their
   * spots: the people and the washers' lights in the scene, the foam on this car's own windscreen.
   */
  const hustlerSpots = layout.hustlerSpots ?? null;
  const hasHustlers = !!(hustlerSpots && hustlerSpots.length > 0 && state.hustlers);
  const hustlersVisual = hasHustlers && hustlerSpots ? createHustlersVisual(hustlerSpots) : null;
  if (hustlersVisual) {
    scene.add(hustlersVisual.root);
    car.chassis.add(hustlersVisual.foam);
  }
  /**
   * THE URBAN MICRO-SCENES (`src/microScenes/`), in the world that carries anchors. Scenery and
   * nothing else: the rules are stepped by the orchestrator, the art is one group of pooled
   * bodies and merged props, and the voices go out through the audio system's own priority ladder.
   * Null in every world without anchors, exactly like the hustlers.
   */
  const microSceneAnchors = layout.microSceneAnchors ?? null;
  const hasMicroScenes = !!(microSceneAnchors && microSceneAnchors.length > 0 && state.microScenes);
  const microSceneVisual = hasMicroScenes ? createMicroSceneVisual() : null;
  if (microSceneVisual) scene.add(microSceneVisual.root);
  if (import.meta.env.DEV && hasMicroScenes && microSceneAnchors) reportCatalogIssues(microSceneAnchors);

  /** A tap on the washer's "No, gracias": the G key by another route, like `activateQueued`. */
  let declineQueued = false;
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
      hasRush || hasPassengers || hasBuho || hasGarage || hasCircuitGate || hasStreetGate || hasHustlers
        ? () => {
            activateQueued = true;
          }
        : undefined,
    rush: hasRush,
    passengers: hasPassengers,
    buho: hasBuho,
    garage: hasGarage,
    hustlers: hasHustlers,
    onDecline: hasHustlers
      ? () => {
          declineQueued = true;
        }
      : undefined,
    circuitGate: hasCircuitGate,
    streetGate: hasStreetGate,
    police: !!state.police,
    // The fine's AURA line is the open world's; a race stall is said by the HUD's own message.
    crashDamage: !!state.crash && !state.race && !!layout.garageSite,
    quickRush: mode === 'rush' && !net,
    escToCity: params.get('from') === 'city',
  });
  const minimap = createMinimap(hudRoot, layout.minimap, layout.race, net ? slotCss(net.slot) : undefined);
  /**
   * The player's own waypoint, marked on the full map. With its guide on, the SAME arrow the
   * fares and the intro use takes them there — one arrow, one way of reading it. It only has the
   * arrow while nothing else wants it: an intro objective or a fare's drop-off comes first, and
   * a run, a ride or a race gate going in puts it away until the car is free again. The mark
   * stays on the map through all of that; it is taken down when the car gets there.
   */
  let waypointRoute: RouteField | null = null;
  /** Whether the arrow is showing the waypoint's route right now, so it is put away when it stops. */
  let waypointSteering = false;
  minimap.onWaypoint((wp) => {
    waypointRoute = wp && wp.guide && roadGraph ? routeTo(roadGraph, wp) : null;
    if (waypointRoute && destinationArrow && waypointSteering) destinationArrow.snap();
  });
  // `precise` is what F4 copies: one real raycast at the moment the key is pressed, so the
  // line on the clipboard names the surface you were looking at, not just the ground under it.
  const debug = createDebugOverlay(debugRoot, params.has('debug'), { precise: () => sampleProbe(true) });
  // Live classification and floating names, only when there is a field to classify.
  const lapLength = layout.race ? layout.race.path.length : 0;
  const standings: Standings | null =
    match || streetRace ? createStandings(hudRoot, lapLength, rivals.length + 1, mode === 'rush' ? 'points' : 'distance') : null;
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
          play.introLineSkipped();
          if (state.intro) skipIntroLine(state.intro);
        },
        onSkipIntro: () => {
          if (state.intro) skipIntro(state.intro);
        },
        duckMusic,
      })
    : null;
  if (introOverlay) hudRoot.appendChild(introOverlay.root);
  /** Asks a guest to keep their progress with Google once the intro is over (only a guest, only if offered). */
  const savePrompt: SaveProgressPrompt | null = state.intro ? createSaveProgressPrompt(hudRoot, account()) : null;
  /** What GA hears about this visit (`src/analyticsPlay.ts`): milestones as they happen, play style on the way out. */
  const play = createPlayAnalytics(state, {
    mode,
    online: !!options.net,
    source: params.get('from') === 'city' ? 'world' : 'menu',
    streetEvent: mode === 'street' ? Number(params.get('event') ?? 0) : -1,
    gl: renderer.getContext(),
  });
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
        score: 0,
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
  const introSnapshot: IntroOverlaySnapshot = { stage: 'opening', objective: null, talking: false, time: 0, canShoot: false, moving: false };
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
    introHoldsMusic = false;
    voiceDuck = 1;
    applyMusicDuck();
    placeIntroMarker();
    refreshMapMarks();
    // After the overlay's own INTRO COMPLETADA / OMITIDA note has had the screen.
    savePrompt?.show({ delayMs: reason === 'completed' ? 2800 : 1600 });
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
  const mapMarks: Array<{ x: number; z: number; kind: ActivityMarkKind; label?: string }> = [];
  function refreshMapMarks(): void {
    mapMarks.length = 0;
    const engaged = engagedActivity(state);
    // The intro's objective, while it is a place. Everything else is suppressed underneath.
    const intro = state.intro;
    if (intro && intro.active && intro.objective && intro.objectiveRadius > 0) {
      mapMarks.push({ x: intro.objectiveX, z: intro.objectiveZ, kind: 'destination', label: 'OBJECTIVE' });
    }
    if (!activitySuppressed(engaged, 'rush')) {
      const site = rushSite();
      if (site) mapMarks.push({ x: site.x, z: site.z, kind: 'rush' });
    }
    if (!activitySuppressed(engaged, 'circuit') && circuitSite) {
      mapMarks.push({ x: circuitSite.x, z: circuitSite.z, kind: 'circuit' });
    }
    // The one Street Race ring, named for the event it is offering now.
    if (!activitySuppressed(engaged, 'street') && streetSites && streetSites.length > 0 && state.streetGate) {
      const ring = streetSites[0];
      mapMarks.push({ x: ring.x, z: ring.z, kind: 'street', label: streetEvent(streetNewestEvent(state.streetGate.cleared)).name });
    }
    // El Búho is never "engaged" himself, so he goes quiet whenever anything else has the car.
    if (engaged === null && hasBuho && buhoSite) mapMarks.push({ x: buhoSite.x, z: buhoSite.z, kind: 'buho' });
    // The garage is a place more than an offer, so it stays on the map unless something has the car.
    if (engaged === null && hasGarage && garageSite) mapMarks.push({ x: garageSite.x, z: garageSite.z, kind: 'garage' });
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
   * Aim the arrow at a destination. The arrow rides the car and only turns: `follow` is the car's
   * own pose, and the heading is the straight-line bearing FROM the car TO the destination
   * itself — a compass lock, not turn-by-turn. The player knows which way the streets go; what
   * they want is where the thing IS, steady, so a straight street towards a diagonal target
   * reads as "over there, left", not "straight on… now left". The route is still walked, for the
   * road distance that drives the dive and to hide the arrow rather than point at nothing when
   * the car is off the network. One arrow for the fare's destination and for the intro's
   * objectives, which never coexist.
   */
  function steerArrow(field: RouteField, frameDt: number): void {
    if (!destinationArrow || !roadGraph) return;
    if (aimAlong(roadGraph, field, pose.x, pose.z, PASSENGER.arrow.lookahead, routeAim)) {
      const toGoalX = field.goalX - pose.x;
      const toGoalZ = field.goalZ - pose.z;
      destinationArrow.follow(pose.x, pose.y, pose.z, pose.heading);
      // Standing on the destination itself there is no bearing to take, so the road's own
      // direction there stands in; the arrow is nosed down at the kerb by then anyway.
      if (toGoalX * toGoalX + toGoalZ * toGoalZ > 1) destinationArrow.face(toGoalX, toGoalZ);
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
  /** Where the audio hears from: the car's pose plus its velocity, for the horns' doppler. */
  const hearing: Listener = { x: 0, z: 0, heading: 0, y: 0, vx: 0, vz: 0 };
  /** The car as the people standing about the city see it: where it is, how fast, and whether it is sliding. */
  const crowdSubject: CrowdSubject = { x: 0, z: 0, speed: 0, drifting: false };
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
    garage: null,
    hustlers: null,
    circuitGate: null,
    streetGate: null,
    streetRace: null,
    police: null,
  };
  const garageSnapshot: GarageHudSnapshot = {
    name: LOCO_MUSTANG.name,
    tagline: LOCO_MUSTANG.tagline,
    portrait: LOCO_MUSTANG.portrait,
    atSite: false,
    open: false,
    line: '',
    lineId: 0,
  };
  if (hasGarage) snapshot.garage = garageSnapshot;
  const hustlerSnapshot: HustlerHudSnapshot = { speaker: '', kind: 'trapito', line: '', lineId: 0, offer: false, price: HUSTLERS.washer.price, x: 0, z: 0 };
  const hustlerVoiceAt = { x: 0, z: 0, heading: 0, moving: 0, stride: 0 };
  if (hasHustlers) snapshot.hustlers = hustlerSnapshot;
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
    previousBest: -1,
    results: null,
    newBest: false,
    rivalAbove: null,
    rivalBelow: null,
    liveRank: -1,
    ladderTruncated: false,
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
    circuit: '',
    laps: 0,
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
  /** `CrashDamageState.version` the car's bodywork was last painted for; -1 before the first frame. */
  let shownDamageVersion = -1;
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
  // Wind past whatever the car tears by close and fast. Also presentation-owned, like the pops.
  const passBy = createPassByDetector(layout);
  let passByCount = 0;
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
   * THE HOLOGRAM BOARDS' ROWS (`environment.leaderboards`): each board's top ten from the server,
   * painted in when the world starts, every `BOARD_REFRESH_MS` after, and straight after a run is
   * filed. Never waited on — a board the server cannot answer for keeps what it last showed.
   * Timed boards are kept in milliseconds on the server and drawn in seconds.
   */
  let boardsFetchedAt = -Infinity;
  /** Set by `dispose`, so a board answer arriving after the world is gone paints nothing. */
  let disposed = false;
  function refreshHolograms(only?: LeaderboardKind): void {
    boardsFetchedAt = performance.now();
    for (const kind of Object.keys(environment.leaderboards) as LeaderboardKind[]) {
      if (only && kind !== only) continue;
      const board = environment.leaderboards[kind];
      if (!board) continue;
      void fetchBoard(kind, 10).then((rows) => {
        if (disposed || rows.length === 0) return;
        board.setRows(rows.map((r) => ({ name: r.name, value: kind === 'rush' ? r.value : r.value / 1000 })));
      });
    }
  }

  // Down here, after `disposed` exists: the answer is awaited and its callback reads it.
  refreshRushRivals();

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
    score: 0,
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
    if (mode === 'rush') {
      // A rush room is ranked on points: each car's live score, as its own client reports it.
      mine.progress = state.rush ? state.rush.score : 0;
      mine.finished = false;
      for (let i = 0; i < rivals.length; i++) {
        const row = standingsRows[i + 1];
        row.progress = rivals[i].score;
        row.finished = false;
      }
      rankStandings(standingsOrder, 1);
      return;
    }
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
    let y = layout.playerSpawn.y ?? 0;
    if (mode === 'city' || mode === 'stack' || mode === 'bay') {
      const recovered = cityRecovery(world.plan, v.x, v.z, v.y, v.heading);
      x = recovered.x; z = recovered.z; y = recovered.y ?? 0; heading = recovered.heading;
    }
    v.x = v.prevX = x;
    v.z = v.prevZ = z;
    v.y = v.prevY = y;
    restVehicle(v);
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
    passBy.reset();
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
    play.onEvent(ev);
    switch (ev.type) {
      case 'lightningFired':
        // A bolt that hit no car but crossed la flor in Plaza Estrella goes into its heart, and
        // the flower takes the charge (`render/scene/floralisVisual.ts`). Scenery: the sim's shot is unchanged.
        if (ev.targetId < 0 && environment.floralis?.hits(ev.fromX, ev.fromZ, ev.toX, ev.toZ)) {
          const h = environment.floralis.heart;
          effects.lightning(ev.fromX, ev.fromY, ev.fromZ, h.x, h.y - BOLT_TO_Y, h.z);
          environment.floralis.strike();
        } else effects.lightning(ev.fromX, ev.fromY, ev.fromZ, ev.toX, ev.toY, ev.toZ);
        {
          // A snap shot still kicks; a full-reach bolt kicks the hardest.
          const size = 0.4 + 0.6 * boltLoad(ev.spent);
          chase.tremble(size);
          car.dischargeKick(size);
        }
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
      case 'rushStart':
        // The ladder is climbed against the board as it stands now, not as it stood at boot.
        refreshRushRivals();
        break;
      case 'rushLevelUp':
        // QUICK PLAY puts the car down on the marker, and R puts it back there: the next mission's.
        if (quickRush && !rushMatch) {
          const next = rushSite();
          if (next) layout.playerSpawn = { x: next.x, z: next.z, y: next.y, heading: next.heading };
        }
        // A mission fell, and the chain has already moved on: the marker packs up and re-paints
        // itself at the next site, and the map points there too. Presentation only — the
        // `rushEnd` immediately behind this event is where the new total is written down, so
        // there is exactly one writer of the record.
        placeRushMarker();
        break;
      case 'rushEnd':
        // In a room the run IS the match: its score is this car's classification.
        if (rushMatch && net && !reportedFinish) {
          reportedFinish = true;
          net.reportFinish(-1, -1, ev.results.score);
        }
        // The clock has stopped and the card is already on screen; the board is told about it
        // afterwards, and never waited on. A run that cannot be filed is still a run.
        rushPreviousBest = leaderboard ? leaderboard.standing().best : -1;
        rushNewBest = ev.results.score > rushPreviousBest;
        // The per-mission record is kept whatever the network is doing: clearing a mission is a
        // fact about the driving. `advanced` is false here for a mission already
        // cleared, so a replay updates the score and leaves the chain where it is.
        if (rushProgress) {
          rushProgress = recordRushRun(rushProgress, ev.results.level, ev.results.score, ev.results.advanced);
          writeRushProgress(rushProgress);
        }
        // Every run is filed: the board keeps each player's best, so a worse one changes nothing.
        if (leaderboard) {
          const run = {
            score: ev.results.score,
            disabled: ev.results.disabled,
            bestChain: ev.results.bestChain,
            styleBonus: ev.results.styleBonus,
            crashPenalty: ev.results.crashPenalty,
            nearMissPoints: ev.results.nearMissPoints,
          };
          void leaderboard.submit(run).then((result) => {
            // The server may know a better previous best than this browser did (the same
            // player on another machine), so the card is corrected if the answer arrives
            // while it is still up.
            rushPreviousBest = result.previousBest;
            rushNewBest = result.newBest;
            // The hologram beside the ring shows the run the moment it is on the board.
            if (result.accepted) {
              refreshHolograms('rush');
              refreshRushRivals();
            }
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
        // The TIME ATTACK board: any finished run inside its crash allowance, whichever mission it
        // was for — every mission is the same two laps of the Bandido Grid. Not waited on.
        if (ev.results.time > 0 && ev.results.withinCrashes) {
          void submitRaceTime('circuit', ev.results.time, { crashes: ev.results.crashes, level: ev.results.level });
        }
        break;
      }
      case 'landing':
        // A flight ended (`src/sim/surface.ts`): the body squats onto its springs, the lens
        // takes the thump, and a landing hard enough to bottom out strikes sparks off the road.
        car.dischargeKick(Math.min(1, ev.impact / 9));
        chase.shake(Math.min(0.35, ev.impact * 0.03));
        if (ev.impact > 6) effects.collision(ev.x, ev.y, ev.z, ev.impact * 0.5);
        break;
      case 'collision':
        effects.collision(ev.x, ev.y, ev.z, ev.impact, ev.nx, ev.nz);
        chase.shake(Math.min(0.3, ev.impact * CAMERA.shakeCollisionPerImpact));
        // Shoved an electric car: the shove is real here now, and the host is asked to
        // repeat it so it is real everywhere. Same hold as a kill, so the host's reports do
        // not slide the car back onto the bonnet before its own copy of the shove lands.
        if (net && trafficSync && !ownsTraffic() && ev.targetId !== undefined) {
          trafficSync.claimBump(ev.targetId, state.time, bumpHoldSeconds());
          net.reportBump(ev.targetId, ev.knockX ?? 0, ev.knockZ ?? 0);
        }
        break;
      case 'propHit':
        effects.propImpact(ev.kind, ev.x, ev.y, ev.z, ev.impact, ev.damaged);
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
        // The STREET RACE board: the finish time, whatever the placing — every event is one lap
        // of La Curva, so a time is a time. Not waited on.
        if (ev.results.time > 0) {
          void submitRaceTime('street', ev.results.time, { placement: ev.results.placement, field: ev.results.field, event: ev.results.event });
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
        // QUICK PLAY's R is another run from the marker, not a drive back to it.
        if (quickRush && !rushMatch) rushBeginPending = true;
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
        passBy.reset();
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
    // The body's pitch: on the road the grade, in the air whatever the flight did to it. The
    // lens looks along a road, not down at one, so a nose-dive only tips it so far.
    cameraPose.roadPitch = Math.max(-0.35, Math.min(0.35, v.pitch));
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

  /** Seconds the car has been in a lake (`ArenaLayout.waterDepth`): past `LAKE_RESCUE_AFTER` it is pulled out. */
  let submerged = 0;

  function simulate(dt: number): void {
    input.poll(command);
    // In the workshop the overlay has the keyboard; this is for the pad and the touch buttons,
    // which it does not: nothing may restart, rescue, re-frame or re-gear a car on a turntable.
    if (workshopEngaged(state.workshop)) {
      command.restart = false;
      command.pov = false;
      command.cruise = false;
      command.transmission = false;
    }

    if ((mode === 'city' || mode === 'stack' || mode === 'bay') && command.restart) {
      command.restart = false;
      rescue();
    }
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
    if (declineQueued) {
      command.decline = true;
      declineQueued = false;
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
    // The rivals' public records back on their tick poses, so the player's collision pass sees
    // where they are and not where the last frame drew them.
    if (streetRace) snapStreetRivals(streetRace);
    // The intro's protection from the room: nobody can shove the tutorial player. Their car
    // is still drawn and still published; only this client's collision pass looks away.
    stepOptions.rivals = introEngaged(state.intro) ? null : net ? net.rivals : streetRace ? streetRace.cars : null;
    // A rush room's one run: nothing at the marker may start a second, before GO or after the
    // card. F still puts the card away.
    if (rushMatch && state.rush && state.rush.phase !== 'results') command.activate = false;
    stepGame(state, command, layout, dt, stepOptions);
    // A car in a lake (the parks, `src/world/park.ts`): the surface field has already rolled it
    // down the bank; the water drags it to a stop, and after a moment the recovery puts it back
    // on the nearest road, as R would. There is nothing to do in a lake, and no way to drive out.
    // The depth is the bed's under the car whatever it stands on, so a car crossing a bridge over
    // the water has deep water under it too: it is only in the lake when it is down in it.
    if (layout.waterDepth) {
      const v = state.vehicle;
      if (v.y < -LAKE.swim && layout.waterDepth(v.x, v.z) > LAKE.swim) {
        const drag = Math.exp(-dt * 2.4);
        v.vx *= drag;
        v.vz *= drag;
        v.speed *= drag;
        v.lateralSpeed *= drag;
        submerged += dt;
        if (submerged > LAKE_RESCUE_AFTER) {
          submerged = 0;
          rescue();
        }
      } else submerged = 0;
    }
    // QUICK PLAY's run, taken up for the player. After the tick, so the events it raises are
    // this tick's and reach the HUD and the audio below; a room's count-in ends on the server's GO.
    if (rushBeginPending && state.rush && !command.restart) {
      rushBeginPending = false;
      const countdown = rushMatch && net ? net.countdownSeconds() : RUSH.countdownSeconds;
      if (!rushMatch || !rushMatchStarted) {
        const began = beginRush(state.rush, countdown < 0 ? RUSH.countdownSeconds : countdown, state.events);
        rushMatchStarted = rushMatchStarted || began;
        // The marker offered the run on this same tick, to a car put down on it; the offer was
        // taken before anybody could see it, so its chime is not raised.
        if (began) {
          for (let i = state.events.length - 1; i >= 0; i--) if (state.events[i].type === 'rushPrompt') state.events.splice(i, 1);
        }
      }
    }
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
    if (hasWallet) {
      // A restart swaps the economy for an empty one; the wallet is not the run's to wipe.
      if (state.economy !== walletEconomy) {
        state.economy.money = savedMoney;
        walletEconomy = state.economy;
      }
      if (state.economy.money !== savedMoney) {
        savedMoney = state.economy.money;
        writeWallet(savedMoney);
      }
    }

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
      publish.score = rushMatch && state.rush ? state.rush.score : 0;
      net.publishCar(publish);
    }
  }

  function render(alpha: number, frameDt: number): void {
    play.frame(frameDt);
    // Last frame's main-thread cost; this frame's is not known until it ends.
    const stats = loop.stats;
    const gpuMs = gpuTimer.available ? gpuTimer.ms : -1;
    const next = governor.update(frameDt * 1000, stats.simMs + stats.renderMs, gpuMs);
    if (next !== null) applyPixelRatio(next);

    const v = state.vehicle;
    // Loco Mustang's showroom, when it has the screen: it has already drawn this frame, and owns
    // the car — its transform and its `update` — until it hands it back (`src/workshop/controller.ts`).
    const inShowroom = workshop ? workshop.frame(frameDt) : false;
    nitroVisual += ((state.nitro.active ? 1 : 0) - nitroVisual) * Math.min(1, frameDt * 8);
    fillCameraPose(alpha);
    if (!inShowroom) syncCar(car, v, pose);
    car.setNitro(inShowroom ? 0 : nitroVisual);
    // On the turntable the neon shows the colour picked, not the lightning's charge (D2).
    car.setCharge(inShowroom ? 0 : state.lightning.charge / LIGHTNING.capacity);
    car.setBrakeLights(v.brakeApplied > 0 && v.speed > 0.5);
    car.setReverseLights(v.speed < -0.5);
    // Crash damage (`src/sim/crashDamage.ts`): the marks repainted only when they change, and the
    // bonnet smoking — thick at first, then a wisp — for as long as a heavy crash is carried.
    const crash = state.crash;
    if (crash) {
      if (crash.version !== shownDamageVersion) {
        shownDamageVersion = crash.version;
        car.setDamage(crash.marks);
      }
      const smoke = CRASH_DAMAGE.visual.smoke;
      effects.setDamageSmoke(crash.heavy ? (simTime - crash.heavyAt < smoke.thickSeconds ? smoke.thickRate : smoke.wispRate) : 0);
      // A race stall blinks the car like a respawn, on the sim clock so a paused game holds still.
      car.root.visible = crash.stall <= 0 || Math.floor((crash.stallSeconds - crash.stall) * CRASH_DAMAGE.race.blinkHz * 2) % 2 === 1;
    }
    car.setBodyAccel(v.latAccel, v.longAccel);
    // The cabin's spectrum display. `theme.spectrum` is one array mutated in place, so this
    // is a reference hand-off, not a copy, and it stays live for every later frame.
    car.setMusic(theme.spectrum);
    if (v.gear !== bodyGear) {
      car.shiftKick(shiftKickStrength(v, bodyGear));
      bodyGear = v.gear;
    }
    if (!inShowroom) car.update(frameDt, simTime);
    // Which electric cars wear the rush ring this frame. The nearest few only, and only
    // while a run is on — `markRushTargets` answers with the same rule that decides what
    // actually scores, so the two can never disagree.
    if (state.rush && rushMarks) markRushTargets(state.rush, state.targets, v.x, v.z, rushMarks);
    syncFleet(targetFleet, state.targets, alpha, simTime, rushMarks);
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
    crowdSubject.x = pose.x;
    crowdSubject.z = pose.z;
    crowdSubject.speed = Math.abs(v.speed);
    crowdSubject.drifting = state.drift.active;
    environment.update(frameDt, simTime, chase.camera.position.x, chase.camera.position.z, crowdSubject);
    if (performance.now() - boardsFetchedAt > BOARD_REFRESH_MS) refreshHolograms();
    if (streetPropsVisual && state.streetProps) streetPropsVisual.update(state.streetProps, chase.camera.position.x, chase.camera.position.z, alpha);
    if (sewerVisual) sewerVisual.update(frameDt, chase.camera.position.x, chase.camera.position.z, v.x, v.z, v.vx, v.vz);
    if (aerialTraffic) aerialTraffic.update(frameDt, chase.camera);
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
      buhoFigure.update(simTime, crowdSubject);
    }
    if (garageFigure && garageSite) {
      const dx = pose.x - garageSite.x;
      const dz = pose.z - garageSite.z;
      const near = 1 - Math.min(1, Math.sqrt(dx * dx + dz * dz) / (GARAGE.marker.promptRadius * 4));
      garageFigure.setProximity(engagedActivity(state) !== null ? 0 : near * near);
      garageFigure.update(simTime, crowdSubject);
    }
    if (hustlersVisual && state.hustlers) {
      hustlersVisual.update(state.hustlers, simTime, frameDt, chase.camera.position.x, chase.camera.position.z, crowdSubject);
    }
    if (microSceneVisual && state.microScenes) {
      // What the rules cannot see: whether a voiced line or the radio has the speakers. Read here
      // and carried into the next tick's signals, so the director holds a conversation back for
      // exactly the same reasons the voice fades one out.
      state.microScenes.externalAudio = audio.microScenesBlocked();
      microSceneVisual.update(
        state.microScenes,
        simTime,
        frameDt,
        chase.camera.position.x,
        chase.camera.position.z,
        crowdSubject,
        v.vx,
        v.vz,
      );
    }
    chase.update(cameraPose, frameDt);
    hearing.x = pose.x;
    hearing.z = pose.z;
    hearing.y = pose.y;
    hearing.heading = pose.heading;
    hearing.vx = v.vx;
    hearing.vz = v.vz;
    placeDialogueListener(hearing);
    // The radio steps aside for the song at the meet, in steps coarse enough not to re-ramp every frame.
    const meetHeard = Math.round(audio.meetPresence() * 20) / 20;
    const nextMeetDuck = 1 - meetHeard * (1 - MEET_MUSIC.radioUnder);
    if (nextMeetDuck !== meetDuck) {
      meetDuck = nextMeetDuck;
      applyMusicDuck();
    }
    speakerSong.beats = audio.meetBeats();
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
      hearing,
      state.targets,
      { lateralSpeed: v.lateralSpeed, speed: v.speed, drifting: state.drift.active, wheelspin: v.wheelspin, yawRate: v.yawRate },
      policeAudio,
    );
    audio.lightningCharging(state.lightning.charging);
    const gusts = passBy.step(v, state.targets, state.buses, state.police ? state.police.units : null, state.streetProps);
    for (let i = 0; i < gusts.length; i++) audio.passBy(gusts[i]);
    passByCount += gusts.length;

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

    // The showroom drew the frame, and its overlay is the whole of the screen furniture: the
    // street's HUD, map and picture wait. The city above was still stepped — its traffic, its
    // lamps, its music and the engine's voice go on (D7) — it is only not drawn.
    if (inShowroom) {
      debugInput.simMs = stats.simMs;
      debugInput.renderMs = stats.renderMs;
      debugInput.gpuMs = gpuMs;
      debugInput.pixelRatio = renderer.getPixelRatio();
      debugInput.governor = governor.status;
      debug.update(frameDt, renderer, debugInput);
      return;
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
      rushSnapshot.results = rush.results;
      rushSnapshot.previousBest = rushPreviousBest;
      rushSnapshot.newBest = rushNewBest;
      if (rushRivals.length > 0) {
        placeOnLadder(rushRivals, rush.score, rushPlace);
        rushSnapshot.rivalAbove = rushPlace.above;
        rushSnapshot.rivalBelow = rushPlace.below;
        rushSnapshot.liveRank = rushPlace.rank;
        rushSnapshot.ladderTruncated = rushRivals.length >= LADDER_PAGE - 1;
      } else {
        rushSnapshot.rivalAbove = null;
        rushSnapshot.rivalBelow = null;
        rushSnapshot.liveRank = -1;
      }
      // The mission on offer. All four are derived from the one progress count, so the sign
      // over the road, the target on the clock and the site under the wheels always agree.
      rushSnapshot.level = rushLevelIndex(rush.cleared);
      rushSnapshot.cleared = rush.cleared;
      rushSnapshot.targetScore = rushTargetScore(rush.cleared);
      rushSnapshot.levelLabel = site.label ?? '';
      rushSnapshot.allClear = rushAllClear(rush.cleared);

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
        streetGateSnapshot.circuit = spec.circuit;
        streetGateSnapshot.laps = spec.laps;
        streetGateSnapshot.rivals = spec.rivals;
        streetGateSnapshot.completed = shown < sgate.cleared;
        streetGateSnapshot.placeLabel = streetSites[0]?.label ?? '';
      }
      // One ring: it never goes quiet, because there is always an event on it to drive.
      const marker = environment.streetMarkers[0];
      const ring = streetSites[0];
      if (marker && ring) {
        const dx = pose.x - ring.x;
        const dz = pose.z - ring.z;
        const reach = STREET_RACE.marker.promptRadius * 3;
        const near = 1 - Math.min(1, Math.sqrt(dx * dx + dz * dz) / reach);
        marker.setProximity(near * near);
        marker.setHidden(activitySuppressed(engaged, 'street'));
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
      passengerFigure?.update(simTime, crowdSubject);
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
    const garage = state.garage;
    if (garage && hasGarage) {
      garageSnapshot.atSite = garage.atSite;
      garageSnapshot.open = garageOpenToTalk(garage);
      // What he says inside the workshop is the showroom's to say (`src/workshop/controller.ts`):
      // the street's card is held where it was until the visit is over, and then catches up on
      // the last line only — the goodbye, said as the car rolls out.
      if (!workshopEngaged(state.workshop)) {
        garageSnapshot.line = garage.line;
        garageSnapshot.lineId = garage.lineId;
      }
      // On the ring: fetch the showroom now, so the door opens without a download behind it.
      if (garage.atSite) workshop?.prefetch();
    }
    const hustlers = state.hustlers;
    if (hustlers && hustlerSpots) {
      const speaker = hustlers.speaker >= 0 ? hustlers.speaker : hustlers.offering;
      if (speaker >= 0) {
        hustlerSnapshot.speaker = hustlerName(hustlers, hustlerSpots, speaker);
        hustlerSnapshot.kind = hustlerSpots[speaker].kind;
        hustlerAt(hustlerSpots[speaker], hustlers.npcs[speaker], hustlerVoiceAt);
        hustlerSnapshot.x = hustlerVoiceAt.x;
        hustlerSnapshot.z = hustlerVoiceAt.z;
      }
      hustlerSnapshot.line = hustlers.line;
      hustlerSnapshot.lineId = hustlers.lineId;
      hustlerSnapshot.offer = washerOfferOpen(hustlers);
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
        introSnapshot.talking = intro.lineId !== '';
        introSnapshot.time = state.time;
        introSnapshot.canShoot = canAffordShot(state.lightning.charge);
        introSnapshot.moving = intro.odometer >= INTRO.route.loreAtMetres.batteries;
        introOverlay.update(introSnapshot);
      }
      introMarker?.update(simTime);
    }
    for (let i = 0; i < introParked.length; i++) introParked[i].vis.update(frameDt, simTime);
    badkalaFigure?.update(simTime, crowdSubject);
    // The waypoint's turn with the arrow, when nothing else has it.
    // The intro only holds the arrow while it has a place to send the car (`introRoute`); between
    // objectives the player's own waypoint may have it.
    const holding = engagedActivity(state);
    const arrowFree = !introRoute && !routeField && (holding === null || holding === 'intro');
    if (waypointRoute && arrowFree) {
      const gx = waypointRoute.goalX - pose.x;
      const gz = waypointRoute.goalZ - pose.z;
      if (gx * gx + gz * gz < MINIMAP.waypoint.arriveMeters * MINIMAP.waypoint.arriveMeters) {
        minimap.clearWaypoint();
      } else {
        steerArrow(waypointRoute, frameDt);
        waypointSteering = true;
      }
    }
    if (waypointSteering && (!waypointRoute || !arrowFree)) {
      waypointSteering = false;
      if (!introRoute && !routeField) destinationArrow?.hide();
    }
    hud.update(snapshot);
    minimap.update(pose.x, pose.z, pose.heading, state.targets, rivals);
    if (standings) {
      updateStandings();
      standings.update(standingsOrder);
    }
    if (nameTags) nameTags.update(chase.camera, rivals);

    // The fleet is culled per car against the camera the frame is drawn with, so it is packed
    // here, after the camera has moved, rather than where its poses were staged.
    targetFleet.commit(chase.camera, simTime, frameDt);

    gpuTimer.begin();
    // Not behind the opening clip: an opaque video over a city nobody can see is GPU time spent
    // on nothing. The simulation above ran regardless — a networked city is never paused.
    if (!introOverlay || !introOverlay.opaque) {
      // The mirror in the wet road first: the road samples it in the pass below.
      // When it drew, it has already brought every world matrix up to date this frame, so the
      // main pass skips walking the scene graph a second time for them.
      const mirrored = environment.wetRoad.render(renderer, scene, chase.camera, pose.y, simTime, governor.ratio / startRatio);
      scene.matrixWorldAutoUpdate = !mirrored;
      speedBlur.render(scene, chase.camera, speedBlurStrength(nitroVisual, v.speed), moogul ? moogul.finish : null);
      scene.matrixWorldAutoUpdate = true;
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

  /* ------------------------------------------------------------ loco mustang's workshop */

  /**
   * The workshop behind the garage (`src/workshop/controller.ts`), in the session whose rules
   * carry one (`GameState.workshop`: the open world, outside a match). The controller owns the
   * showroom, the overlay and the cut; the game only hands it the frame, parks the car on the ring
   * when the showroom takes the screen, and puts its own street furniture away meanwhile.
   */
  function parkOnRing(): void {
    if (!garageSite) return;
    const v = state.vehicle;
    v.x = v.prevX = garageSite.x;
    v.z = v.prevZ = garageSite.z;
    v.y = v.prevY = garageSite.y;
    restVehicle(v);
    // The ring's heading is the way the garage looks: out at the street.
    v.heading = v.prevHeading = garageSite.heading;
    v.vx = v.vz = v.speed = v.lateralSpeed = v.yawRate = v.slipAngle = v.steerAngle = 0;
  }
  const workshop: WorkshopController | null = state.workshop
    ? createWorkshopController({
        renderer,
        car,
        audio,
        shop: LOCO_MUSTANG_SHOP,
        workshop: () => state.workshop,
        garage: () => state.garage,
        economy: () => state.economy,
        mount: document.body,
        onEvents: (events) => {
          for (let i = 0; i < events.length; i++) handleEvent(events[i]);
        },
        onShowroom(visible) {
          document.body.classList.toggle('rb-in-workshop', visible);
          minimap.setSuspended(visible);
          if (visible) {
            parkOnRing();
            setCruise(false);
            return;
          }
          // Back on the street: the car settled on its springs where it was parked, the camera
          // behind it rather than swinging round from wherever it was left.
          car.resetBody();
          bodyGear = state.vehicle.gear;
          effects.reset();
          backfire.reset();
          prevLimiterCut = 0;
          fillCameraPose(1);
          chase.snap(cameraPose);
        },
        playerName: () => account().state.user?.name ?? '',
      })
    : null;

  const loop = createGameLoop({ simulate, render }, SIM_STEP);

  function onResize(): void {
    applyPixelRatio(governor.ratio);
    chase.resize(viewportWidth() / viewportHeight());
    workshop?.resize(viewportWidth(), viewportHeight());
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
      await environment.wetRoad.compile(renderer, scene);
      endStage();

      loading?.set('WARMING UP', 0.8);
      await loading?.paint();
      endStage = measure('portrait');
      await environment.ready;
      endStage();
      endStage = measure('warm-render');
      // The mirror pass first: it draws its guests into a render target, which is a different
      // program from the canvas one, and the road samples its buffer in the render after it.
      environment.wetRoad.render(renderer, scene, chase.camera, pose.y, 0);
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
      disposed = true;
      loop.stop();
      play.dispose();
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
      savePrompt?.dispose();
      // Before the car: a visit under way gives the car back to the scene first.
      workshop?.dispose();
      document.body.classList.remove('rb-in-workshop');
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
      if (streetPropsVisual) {
        scene.remove(streetPropsVisual.root);
        streetPropsVisual.dispose();
      }
      if (sewerVisual) {
        scene.remove(sewerVisual.root);
        sewerVisual.dispose();
      }
      if (aerialTraffic) aerialTraffic.dispose();
      scene.remove(targetFleet.root);
      targetFleet.dispose();
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
      if (garageFigure) {
        scene.remove(garageFigure.group);
        garageFigure.dispose();
      }
      hustlersVisual?.dispose();
      microSceneVisual?.dispose();
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
    /** Wind gusts voiced since load (`audio/passBy.ts`), for automation. */
    passByCount: () => passByCount,
    /**
     * Development only: speak a BadKala line through the server's text-to-speech. Call it twice
     * with the same text — the first generates (`cache miss`), the second is `cache hit`.
     *
     *   await __rb.say('Mirá quién decidió volver al radar.')
     */
    say: import.meta.env.DEV
      ? (text = 'Mirá quién decidió volver al radar.') => speakDialogue({ characterId: 'badkala', text, interrupt: true })
      : undefined,
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
    /** The wet-road mirror: `tier` and the extra `drawCalls` it issues (not in `renderer.info`). */
    wetRoad: environment.wetRoad,
    /** Ambient hovercars and drones: `enabled` toggles them live, `stats()` counts what is drawn. */
    aerial: aerialTraffic,
    /**
     * The instanced electric fleet: `stats` counts what was drawn in each look last frame,
     * `cull = false` sends every car to the GPU (A/B), `root.visible` hides the lot.
     */
    fleet: targetFleet,
    /** La flor in Plaza Estrella: `strike()` as a bolt would, `openness()` to watch it open. */
    floralis: environment.floralis,
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
    /**
     * The trapitos and washers (`src/sim/hustlers.ts`). `state` is the live rules state; `spots` is
     * where they work; `goTo(id)` stops the car where that one works — on a washer's lane, at his
     * light — so a script can watch him without driving there.
     *
     *   __rb.hustlers.goTo('washer-downtown')
     *   __rb.hustlers.accept()      // the F key      __rb.hustlers.decline()   // the G key
     */
    hustlers: hasHustlers && hustlerSpots
      ? {
          spots: hustlerSpots,
          get state() {
            return state.hustlers;
          },
          goTo(id: string) {
            const spot = hustlerSpots.find((h) => h.id === id);
            if (!spot) return false;
            const at = spot.approach ?? { x: spot.x + Math.sin(spot.heading) * 8, z: spot.z - Math.cos(spot.heading) * 8, heading: spot.heading + Math.PI / 2 };
            const v = state.vehicle;
            v.x = v.prevX = at.x;
            v.z = v.prevZ = at.z;
            v.y = v.prevY = 0;
            restVehicle(v);
            v.heading = v.prevHeading = at.heading;
            v.vx = v.vz = v.speed = v.lateralSpeed = v.yawRate = v.slipAngle = 0;
            fillCameraPose(1);
            chase.snap(cameraPose);
            return true;
          },
          accept() {
            activateQueued = true;
          },
          decline() {
            declineQueued = true;
          },
        }
      : null,
    /**
     * THE URBAN MICRO-SCENES (`src/microScenes/`), for authoring and QA. Development only, and the
     * whole surface is documented in `src/microScenes/debug.ts`:
     *
     *   __rb.microScenes.list()                      every scene, and how many there are
     *   __rb.microScenes.spawn('bridge-smoke-circle')            force one up on the nearest anchor
     *   __rb.microScenes.spawn('bus-stop-conversation', null, 'cheating-boyfriend')
     *   __rb.microScenes.status()                    what is standing, in what state, at what cost
     *   __rb.microScenes.validate()                  everything the catalogue complains about
     */
    microScenes:
      import.meta.env.DEV && hasMicroScenes && microSceneAnchors
        ? {
            ...createMicroSceneDebug({
              runtime: () => state.microScenes,
              anchors: () => microSceneAnchors,
              events: () => state.events,
              player: () => ({ x: state.vehicle.x, z: state.vehicle.z }),
            }),
            /** What the art is actually drawing this frame. */
            drawn: () => microSceneVisual?.stats() ?? null,
            /** Stop the car beside an anchor, so a scene can be watched without driving there. */
            goTo(id: string, back = 11) {
              const anchor = microSceneAnchors.find((a) => a.id === id);
              if (!anchor) return false;
              const v = state.vehicle;
              // An anchor faces the road, so out along its facing is the lane; the car stands there
              // looking back at it, which is what the player would be doing.
              const h = anchor.transform.heading;
              v.x = v.prevX = anchor.transform.x + Math.sin(h) * back;
              v.z = v.prevZ = anchor.transform.z - Math.cos(h) * back;
              v.y = v.prevY = 0;
              restVehicle(v);
              v.heading = v.prevHeading = h + Math.PI;
              v.vx = v.vz = v.speed = v.lateralSpeed = v.yawRate = v.slipAngle = 0;
              fillCameraPose(1);
              chase.snap(cameraPose);
              return true;
            },
          }
        : null,
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
     * LOCO MUSTANG'S WORKSHOP, for automation. Null outside the open world (and in a match).
     *
     *   __rb.workshop.goToRing()        // the car on his ring, nose to the garage
     *   __rb.workshop.enter()           // the F key
     *   __rb.workshop.intent({ type: 'group', delta: 1 })   // what the overlay would send
     *   __rb.workshop.status()          // { phase, category, showroom, money, installed, owned, ... }
     *   __rb.workshop.setMoney(50000)   // development only
     */
    workshop:
      workshop && garageSite
        ? {
            get state() {
              return state.workshop;
            },
            site: { ...garageSite },
            goToRing() {
              const v = state.vehicle;
              v.x = v.prevX = garageSite.x;
              v.z = v.prevZ = garageSite.z;
              v.y = v.prevY = garageSite.y;
              restVehicle(v);
              v.heading = v.prevHeading = garageSite.heading + Math.PI;
              v.vx = v.vz = v.speed = v.lateralSpeed = v.yawRate = v.slipAngle = 0;
              fillCameraPose(1);
              chase.snap(cameraPose);
            },
            enter() {
              activateQueued = true;
            },
            intent: (i: Parameters<WorkshopController['intent']>[0]) => workshop.intent(i),
            /** Ease the showroom camera to a shot (a key or `{ yaw, pitch, distance, targetY, targetZ, fov }`). */
            shot: (next: Parameters<WorkshopController['shot']>[0]) => workshop.shot(next),
            status: () => ({
              ...workshop.status(),
              money: state.economy.money,
              installed: state.workshop ? { ...state.workshop.installed } : null,
              owned: state.workshop ? state.workshop.owned.slice() : [],
              purchases: state.workshop?.purchases ?? 0,
              lastDenied: state.workshop?.lastDenied ?? null,
            }),
            setMoney: import.meta.env.DEV
              ? (money: number) => {
                  state.economy.money = Math.max(0, Math.round(money));
                  return state.economy.money;
                }
              : undefined,
          }
        : null,

    /**
     * THE STREET PROPS, for automation. Null in worlds without them.
     *
     *   __rb.props.status()          // { props, moving, lying, broken, drawn, stats }
     *   __rb.props.near(x, z, kind?) // the nearest prop (of a kind): { index, kind, x, z, yaw, home, damaged }
     *   __rb.props.state             // the live `StreetPropsState`
     */
    props: state.streetProps
      ? {
          get state() {
            return state.streetProps;
          },
          status: () => {
            const s = state.streetProps!;
            return {
              props: s.defs.length,
              moving: s.moving,
              lying: s.bodies.filter((b) => b.prop >= 0 && !b.moving).length,
              broken: s.chargers.filter((p) => s.damaged[p]).length,
              drawn: streetPropsVisual ? streetPropsVisual.stats() : null,
              sewers: sewerVisual ? sewerVisual.stats() : null,
              stats: { ...s.stats },
            };
          },
          near: (x: number, z: number, kind?: string) => {
            const s = state.streetProps!;
            let best = -1;
            let bestD = Infinity;
            for (let i = 0; i < s.defs.length; i++) {
              const d = s.defs[i];
              if (kind && d.kind !== kind) continue;
              const dd = Math.hypot(d.x - x, d.z - z);
              if (dd < bestD) {
                bestD = dd;
                best = i;
              }
            }
            if (best < 0) return null;
            const d = s.defs[best];
            const b = s.bodyOf[best] >= 0 ? s.bodies[s.bodyOf[best]] : null;
            return { index: best, kind: d.kind, variant: d.variant, x: d.x, z: d.z, yaw: d.yaw, home: !b, at: b ? { x: b.x, y: b.y, z: b.z, moving: b.moving } : null, damaged: !!s.damaged[best], distance: bestD };
          },
        }
      : null,

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

    /**
     * CRASH DAMAGE, for automation. Null in worlds without it.
     *
     *   __rb.crash.state             // the live `CrashDamageState`
     *   __rb.crash.status()          // { marks, heavy, latched, cooldown, stall, money, stats }
     */
    crash: state.crash
      ? {
          get state() {
            return state.crash;
          },
          status: () => {
            const c = state.crash!;
            return { marks: c.marks, heavy: c.heavy, latched: c.latched, cooldown: c.cooldown, stall: c.stall, money: state.economy.money, stats: { ...c.stats } };
          },
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
      restVehicle(v);
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
