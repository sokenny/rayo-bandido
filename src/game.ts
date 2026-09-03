import * as THREE from 'three';
import { createArenaLayout } from './world/arenaLayout';
import type { GameEvent, GameState, HudSnapshot, PlayerCommand } from './core/types';
import { SIM_STEP, CAMERA, LIGHTNING, NITRO } from './config/tuning';
import { createGameLoop, type GameLoop } from './core/loop';
import { createKeyboardInput, createPlayerCommand } from './core/input/keyboard';
import { createInitialGameState, stepGame } from './sim/gameState';
import { createCruiseController } from './sim/cruise';
import { createRenderer } from './render/renderer';
import { createSpeedBlur, speedBlurStrength } from './render/post/speedBlur';
import { createEnvironment } from './render/scene/environment';
import { createCarVisual } from './render/scene/carVisual';
import { createElectricCarVisual, disposeElectricCarResources, type ElectricCarVisual } from './render/scene/electricCarVisual';
import { createChaseCamera, type CameraPose } from './render/camera/chaseCamera';
import { createEffects } from './render/fx';
import { interpolateVehicle, syncCar, syncTargets, type InterpolatedPose } from './render/sync';
import { createHud } from './ui/hud';
import { createDebugOverlay } from './ui/debugOverlay';
import { createThemeAudio } from './audio/theme';
import { createAudio } from './audio';
import { createBackfireTrigger } from './audio/backfire';
import { msToKmh } from './core/math';

/**
 * Composition root. Wires input -> simulation -> presentation without letting any of
 * those layers know about each other. Exposes `window.__rb` for browser automation/QA.
 */
export interface Game {
  start(): void;
  stop(): void;
  dispose(): void;
  readonly state: GameState;
  readonly loop: GameLoop;
}

export function createGame(canvas: HTMLCanvasElement, hudRoot: HTMLElement, debugRoot: HTMLElement): Game {
  const layout = createArenaLayout();
  const state = createInitialGameState(layout);
  const command: PlayerCommand = createPlayerCommand();
  const input = createKeyboardInput(window);

  const renderer = createRenderer(canvas);
  // Nitro speed blur. Transparent when the boost is cold: it just calls renderer.render().
  const speedBlur = createSpeedBlur(renderer);
  const scene = new THREE.Scene();
  const environment = createEnvironment(scene, layout);
  const car = createCarVisual();
  scene.add(car.root);
  const targetVisuals: ElectricCarVisual[] = [];
  for (let i = 0; i < state.targets.length; i++) {
    const vis = createElectricCarVisual(i);
    scene.add(vis.root);
    targetVisuals.push(vis);
  }
  const chase = createChaseCamera(window.innerWidth / window.innerHeight);
  const effects = createEffects(scene);
  const audio = createAudio(state.targets.length);
  const hud = createHud(hudRoot);
  const debug = createDebugOverlay(debugRoot, new URLSearchParams(location.search).has('debug'));
  // Background theme song. Loops quietly and feeds a per-band music signal to the arena
  // lighting, so bass, mids and highs each drive a different family of lights.
  // Autoplay policy: it stays silent until the first key press / click (see arm()).
  const theme = createThemeAudio();
  theme.arm(window);

  const pose: InterpolatedPose = { x: 0, z: 0, heading: 0 };
  const cameraPose: CameraPose = { x: 0, z: 0, heading: 0, vx: 0, vz: 0, speed: 0, slipAngle: 0, nitro: 0, drifting: false };
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
  };
  let lastNitroAmount = state.nitro.amount;
  let nitroVisual = 0;
  let simTime = 0;
  // Exhaust pops. One trigger feeds both the bang and the flame so they land on the same frame.
  const backfire = createBackfireTrigger();

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

  function isDriving(cmd: PlayerCommand): boolean {
    return cmd.throttle > 0 || cmd.brake > 0 || cmd.steer !== 0 || cmd.handbrake || cmd.nitro;
  }

  function handleEvent(ev: GameEvent): void {
    hud.onEvent(ev);
    audio.onEvent(ev);
    switch (ev.type) {
      case 'lightningFired':
        effects.lightning(ev.fromX, ev.fromZ, ev.toX, ev.toZ);
        chase.shake(CAMERA.shakeLightning);
        break;
      case 'targetDestroyed':
        effects.explosion(ev.x, ev.z);
        if (ev.reward > 0) effects.scorePopup(ev.x, ev.z, ev.reward);
        break;
      case 'nearMiss':
        effects.nearMissPopup(ev.x, ev.z, ev.points);
        break;
      case 'collision':
        effects.collision(ev.x, ev.z, ev.impact);
        chase.shake(Math.min(0.3, ev.impact * CAMERA.shakeCollisionPerImpact));
        break;
      case 'restart':
        effects.reset();
        backfire.reset();
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
    cameraPose.z = pose.z;
    cameraPose.heading = pose.heading;
    cameraPose.vx = v.vx;
    cameraPose.vz = v.vz;
    cameraPose.speed = v.speed;
    cameraPose.slipAngle = v.slipAngle;
    cameraPose.nitro = nitroVisual;
    cameraPose.drifting = state.drift.active;
  }

  function simulate(dt: number): void {
    input.poll(command);
    if (command.cruise) setCruise(!cruising);
    if (cruising) {
      const driving = isDriving(command);
      if (!driving) cruiseArmed = true;
      if (driving && cruiseArmed) setCruise(false);
      else cruiseControl.step(state.vehicle, command, dt);
    }
    stepGame(state, command, layout, dt);
    simTime = state.time;
    const events = state.events;
    for (let i = 0; i < events.length; i++) handleEvent(events[i]);
  }

  function render(alpha: number, frameDt: number): void {
    const v = state.vehicle;
    nitroVisual += ((state.nitro.active ? 1 : 0) - nitroVisual) * Math.min(1, frameDt * 8);
    fillCameraPose(alpha);
    syncCar(car, v, pose);
    car.setNitro(nitroVisual);
    car.setCharge(state.lightning.charge / LIGHTNING.capacity);
    car.setBrakeLights(v.brakeApplied > 0 && v.speed > 0.5);
    car.setReverseLights(v.speed < -0.5);
    car.update(frameDt, simTime);
    syncTargets(targetVisuals, state.targets, alpha, state.lightning.acquiredTargetId, simTime);
    for (let i = 0; i < targetVisuals.length; i++) targetVisuals[i].update(frameDt, simTime);
    effects.setCarPose(pose, v, state.drift.active, nitroVisual, frameDt);
    effects.update(frameDt, simTime);
    theme.update(frameDt);
    environment.update(frameDt, simTime, theme.bands);
    chase.update(cameraPose, frameDt);
    audio.update(
      frameDt,
      { speed: v.speed, throttle: v.throttleApplied, brake: v.brakeApplied, nitro: state.nitro.active },
      pose,
      state.targets,
      { lateralSpeed: v.lateralSpeed, speed: v.speed, drifting: state.drift.active },
    );

    // Pops and bangs: one decision, fired into the audio and the tailpipes together.
    const bang = backfire.tick(frameDt, v.speed, v.throttleApplied, state.nitro.active);
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
    lastNitroAmount = state.nitro.amount;
    hud.update(snapshot);

    speedBlur.render(scene, chase.camera, speedBlurStrength(nitroVisual, v.speed));
    debug.update(frameDt, renderer);
  }

  const loop = createGameLoop({ simulate, render }, SIM_STEP);

  function onResize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    chase.resize(window.innerWidth / window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  // Initial camera placement.
  fillCameraPose(1);
  chase.snap(cameraPose);

  const game: Game = {
    state,
    loop,
    start() {
      loop.start();
    },
    stop() {
      loop.stop();
    },
    dispose() {
      loop.stop();
      window.removeEventListener('resize', onResize);
      input.dispose();
      theme.dispose();
      hud.dispose();
      debug.dispose();
      audio.dispose();
      effects.dispose();
      for (const t of targetVisuals) t.dispose();
      disposeElectricCarResources();
      car.dispose();
      environment.dispose();
      speedBlur.dispose();
      renderer.dispose();
    },
  };

  // Automation / QA hook. Not part of gameplay.
  (window as unknown as { __rb: unknown }).__rb = {
    state,
    layout,
    command,
    metrics: debug.metrics,
    renderer,
    scene,
    audio,
    theme,
    /** Override the keyboard for one or more ticks (used by browser automation). */
    inject(partial: Partial<PlayerCommand>, ticks = 1) {
      injectQueue.push({ partial, ticks });
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
