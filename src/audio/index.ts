import type { GameEvent, PoliceUnit, TargetState } from '../core/types';
import { createAudioCore } from './core';
import { createEngine, type EngineInput } from './engine';
import { createElectricHums, type Listener } from './electricHum';
import { createTireScreech } from './tireScreech';
import { createOneShots } from './oneShots';
import { createPoliceAudio } from './police';
import { skidIntensity } from './dsp';

/** Slide state for the tire scrub, read each frame. */
export interface SkidInput {
  lateralSpeed: number;
  speed: number;
  drifting: boolean;
  /** Rear wheels spinning (0..1): a burnout scrubs even at a standstill. */
  wheelspin: number;
}

/**
 * The game's audio, driven entirely by synthesis (no asset files).
 *
 * CONTRACT (called from `src/game.ts`)
 * - `update(dt, engine, listener, targets, skid)` every render frame: drives the continuous
 *   voices — the player's gas engine (+ turbo), the tire scrub while sliding, and each electric
 *   car's hover hum, spatialized to the listener.
 * - `onEvent(ev)` for every `GameEvent`: fires one-shots (lightning zap, nitro whoosh, the
 *   electric-car power-down when a target is destroyed, and the pickup chime when the car rolls
 *   onto an activity marker).
 * - `backfire(strength)` whenever the exhaust pops. The caller owns the trigger (see
 *   `audio/backfire.ts`) so the bang and the flame at the tailpipes land on the same frame.
 * - `reset()` on restart.
 *
 * Browsers block audio until a user gesture, so the context stays suspended until the first
 * keydown/pointer/touch, then resumes. `setMuted` is exposed for QA/automation; the game itself
 * only wires `M` to the background theme song (`audio/theme.ts`), not to these engine/SFX voices.
 */
/** The police cars on the road this frame, and whether a chase is on (siren). */
export interface PoliceAudioInput {
  units: readonly PoliceUnit[];
  siren: boolean;
}

export interface AudioSystem {
  update(
    dt: number,
    engine: EngineInput,
    listener: Listener,
    targets: readonly TargetState[],
    skid: SkidInput,
    /** Absent in worlds without police. */
    police?: PoliceAudioInput | null,
  ): void;
  onEvent(ev: GameEvent): void;
  /** One exhaust pop/bang (0..1), fired from `createBackfireTrigger` in the composition root. */
  backfire(strength: number): void;
  reset(): void;
  setMuted(muted: boolean): void;
  /** AudioContext state for QA/automation: 'suspended' | 'running' | 'closed' | 'unavailable'. */
  status(): string;
  dispose(): void;
}

/** A no-op used when Web Audio is unavailable (headless QA, unsupported browsers). */
const SILENT: AudioSystem = {
  update() {},
  onEvent() {},
  backfire() {},
  reset() {},
  setMuted() {},
  status: () => 'unavailable',
  dispose() {},
};

export function createAudio(targetCount: number): AudioSystem {
  const core = createAudioCore();
  if (!core) return SILENT;

  const engine = createEngine(core);
  const tires = createTireScreech(core);
  const hums = createElectricHums(core, targetCount);
  const oneShots = createOneShots(core);
  const police = createPoliceAudio(core);

  // Resume on the first real user gesture (browser autoplay policy). A context can also be
  // suspended again later — the tab is hidden, or the OS takes audio focus — so `update` re-arms
  // it every frame as well, and coming back to the tab counts as another chance to resume.
  const resume = (): void => core.resume();
  const gestures: Array<keyof WindowEventMap> = ['keydown', 'pointerdown', 'touchstart'];
  for (const g of gestures) window.addEventListener(g, resume, { passive: true });
  document.addEventListener('visibilitychange', resume);

  return {
    update(dt, engineInput, listener, targets, skid, policeInput = null) {
      // Cheap no-op once running; the one case that matters is a context that fell back to
      // 'suspended' while the game kept rendering, which is silence with no other symptom.
      core.resume();
      engine.update(dt, engineInput);
      tires.update(dt, skidIntensity(skid.lateralSpeed, skid.speed, skid.drifting, skid.wheelspin), skid.speed);
      hums.update(dt, listener, targets);
      if (policeInput) police.update(dt, listener, policeInput.units, policeInput.siren);
    },

    onEvent(ev) {
      switch (ev.type) {
        case 'lightningFired':
          oneShots.lightning();
          break;
        case 'targetDestroyed':
          oneShots.shutdown();
          break;
        case 'nearMiss':
          oneShots.nearMiss(ev.quality);
          break;
        case 'nitroStart':
          engine.nitroWhoosh();
          break;
        case 'raceCountdown':
          oneShots.countdown(false);
          break;
        case 'raceStart':
          oneShots.countdown(true);
          break;
        case 'rushPrompt':
        case 'circuitPrompt':
        case 'passengerPrompt':
        case 'passengerDropPrompt':
          // Every free-world marker gets the same chime: RAYO RUSH's circle, the circuit's start
          // line and a passenger's ring are the same gesture — you have rolled onto something
          // you can act on — and one sound for it is what makes each new activity read as part
          // of the same game rather than as a thing bolted onto it.
          // Only on the way in; rolling off a marker is not an event worth a sound.
          if (ev.on) oneShots.pickup();
          break;
        case 'flair':
          // The phrases (`src/sim/flair.ts`). The big ones borrow the marker chime — a short
          // rising figure the kit already has, and already means "that was the good one" — and
          // the small ones say nothing at all: a sound on every DE COSTADO would be a rattle.
          // The crash line is silent too; the crash itself was loud enough.
          if (ev.tier === 'special' || ev.tier === 'peak') oneShots.pickup();
          break;
        case 'rushLevelUp':
          // A mission cleared gets the GO beat, which is the one sound in the kit that already
          // means "this is the good one" — and it lands on the flag, a beat before the results
          // card, so the player hears it before they read it.
          oneShots.countdown(true);
          break;
        case 'wantedStars':
          // A star newly lit is the scanner crackling into life. The outlined kind — the same
          // count fading after an escape — is not news.
          if (ev.stars > ev.prev && !ev.cooldown) oneShots.scanner();
          break;
        case 'pursuitStart':
          police.setChase(true);
          break;
        case 'pursuitEnd':
          police.setChase(false);
          if (ev.reason === 'escaped') oneShots.escaped();
          break;
        case 'policeBusted':
          oneShots.busted();
          break;
        case 'policeShielded':
          oneShots.shield();
          break;
        case 'introCall':
          // The phone on the dash, ringing. Connecting and hanging up are silent on purpose.
          if (ev.phase === 'ringing') oneShots.ring();
          break;
        case 'policeCleared':
          police.setChase(false);
          police.reset();
          break;
        case 'restart':
          engine.reset();
          tires.reset();
          hums.reset();
          police.reset();
          break;
        default:
          break;
      }
    },

    backfire(strength) {
      engine.backfire(strength);
    },

    reset() {
      engine.reset();
      tires.reset();
      hums.reset();
      police.reset();
    },

    setMuted(muted) {
      core.setMuted(muted);
    },

    status() {
      return core.ctx.state;
    },

    dispose() {
      for (const g of gestures) window.removeEventListener(g, resume);
      document.removeEventListener('visibilitychange', resume);
      engine.dispose();
      tires.dispose();
      hums.dispose();
      police.dispose();
      core.dispose();
    },
  };
}
