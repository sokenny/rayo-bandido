// `.ts` so Node can load this module straight; see `registry.ts`.
import { MICRO_SCENES as CFG } from '../../config/tuning.ts';
import type { MicroSceneDefinition } from '../types';

/**
 * THE BUDGET. What the whole system is allowed to add to the frame, and whether one more scene
 * would break it.
 *
 * The numbers are the global ones (`MICRO_SCENES` in `src/config/tuning.ts`); a scene declares
 * what IT costs in its own `performanceBudget`, and the two are compared here. So a scene that
 * asks for four animated people is refused by arithmetic rather than by review, and a scene that
 * declares more than the global ceiling is caught by validation before it ever runs.
 *
 * Counters only. Nothing here allocates, and nothing here knows what a draw call is.
 */
export interface MicroSceneBudget {
  scenes: number;
  actors: number;
  animatedActors: number;
  particles: number;
  talking: number;
}

export function createBudget(): MicroSceneBudget {
  return { scenes: 0, actors: 0, animatedActors: 0, particles: 0, talking: 0 };
}

export function clearBudget(b: MicroSceneBudget): void {
  b.scenes = b.actors = b.animatedActors = b.particles = b.talking = 0;
}

/** Add what a scene costs, as its own definition declares it. */
export function chargeBudget(b: MicroSceneBudget, scene: MicroSceneDefinition): void {
  const p = scene.performanceBudget;
  b.scenes += 1;
  b.actors += p.maxActors;
  b.animatedActors += p.maxAnimatedActors;
  b.particles += p.maxParticles;
}

/** Whether one more of `scene` fits inside the global ceilings. */
export function budgetAllows(b: MicroSceneBudget, scene: MicroSceneDefinition): boolean {
  const p = scene.performanceBudget;
  if (b.scenes + 1 > CFG.maxActive) return false;
  if (b.animatedActors + p.maxAnimatedActors > CFG.maxAnimatedActors) return false;
  if (b.particles + p.maxParticles > CFG.maxParticles) return false;
  // Nothing in the city may ask for a dynamic light or a physics body through this system.
  return !p.allowsDynamicLights && !p.allowsPhysics;
}

/** Whether a scene's own declaration is inside the global ceilings at all. Validation asks this. */
export function budgetWithinGlobal(scene: MicroSceneDefinition): string[] {
  const p = scene.performanceBudget;
  const out: string[] = [];
  if (p.maxAnimatedActors > CFG.maxAnimatedActors) {
    out.push(`maxAnimatedActors ${p.maxAnimatedActors} exceeds the global ${CFG.maxAnimatedActors}`);
  }
  if (p.maxParticles > CFG.maxParticles) out.push(`maxParticles ${p.maxParticles} exceeds the global ${CFG.maxParticles}`);
  if (p.maxActors > 3) out.push(`maxActors ${p.maxActors}: a micro-scene is two or three people`);
  if (p.maxAnimatedActors > p.maxActors) out.push('maxAnimatedActors is above maxActors');
  if (p.allowsDynamicLights) out.push('allowsDynamicLights: micro-scenes never add a dynamic light');
  if (p.allowsPhysics) out.push('allowsPhysics: micro-scene props stay out of physics');
  return out;
}
