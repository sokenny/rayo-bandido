import type { GameEvent, TargetState } from '../core/types';
import { createAudioCore } from './core';
import { createEngine, type EngineInput } from './engine';
import { createElectricHums, type Listener } from './electricHum';
import { createTireScreech } from './tireScreech';
import { createOneShots } from './oneShots';
import { skidIntensity } from './dsp';

/** Slide state for the tire scrub, read each frame. */
export interface SkidInput {
  lateralSpeed: number;
  speed: number;
  drifting: boolean;
}

/**
 * The game's audio, driven entirely by synthesis (no asset files).
 *
 * CONTRACT (called from `src/game.ts`)
 * - `update(dt, engine, listener, targets, skid)` every render frame: drives the continuous
 *   voices — the player's gas engine (+ turbo), the tire scrub while sliding, and each electric
 *   car's hover hum, spatialized to the listener.
 * - `onEvent(ev)` for every `GameEvent`: fires one-shots (lightning zap, nitro whoosh, and the
 *   electric-car power-down when a target is destroyed).
 * - `reset()` on restart.
 *
 * Browsers block audio until a user gesture, so the context stays suspended until the first
 * keydown/pointer/touch, then resumes. `M` toggles mute.
 */
export interface AudioSystem {
  update(
    dt: number,
    engine: EngineInput,
    listener: Listener,
    targets: readonly TargetState[],
    skid: SkidInput,
  ): void;
  onEvent(ev: GameEvent): void;
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

  // Resume on the first real user gesture (browser autoplay policy).
  const resume = (): void => core.resume();
  const gestures: Array<keyof WindowEventMap> = ['keydown', 'pointerdown', 'touchstart'];
  for (const g of gestures) window.addEventListener(g, resume, { passive: true });

  const onMuteKey = (e: KeyboardEvent): void => {
    if (e.code === 'KeyM') core.setMuted(!core.isMuted());
  };
  window.addEventListener('keydown', onMuteKey);

  return {
    update(dt, engineInput, listener, targets, skid) {
      engine.update(dt, engineInput);
      tires.update(dt, skidIntensity(skid.lateralSpeed, skid.speed, skid.drifting), skid.speed);
      hums.update(dt, listener, targets);
    },

    onEvent(ev) {
      switch (ev.type) {
        case 'lightningFired':
          oneShots.lightning();
          break;
        case 'targetDestroyed':
          oneShots.shutdown();
          break;
        case 'nitroStart':
          engine.nitroWhoosh();
          break;
        case 'restart':
          engine.reset();
          tires.reset();
          hums.reset();
          break;
        default:
          break;
      }
    },

    reset() {
      engine.reset();
      tires.reset();
      hums.reset();
    },

    setMuted(muted) {
      core.setMuted(muted);
    },

    status() {
      return core.ctx.state;
    },

    dispose() {
      for (const g of gestures) window.removeEventListener(g, resume);
      window.removeEventListener('keydown', onMuteKey);
      engine.dispose();
      tires.dispose();
      hums.dispose();
      core.dispose();
    },
  };
}
