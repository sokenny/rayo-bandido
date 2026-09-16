import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core/types';
import { MICRO_SCENES as CFG } from '../src/config/tuning';
import { SHARED_BEHAVIORS, SHARED_BEHAVIOR_IDS, createActorDrive, createBehaviorContext, runBehaviors } from '../src/microScenes/behaviors';
import { MICRO_SCENES, behaviorUsage, microScene, sceneBehaviors, sceneLines } from '../src/microScenes/registry';
import { validateAnchors, validateCatalog } from '../src/microScenes/validate';
import { VOICE_PROFILES, resolvedVoice } from '../src/microScenes/voices';
import type { MicroSceneAnchor } from '../src/microScenes/types';
import {
  clearMicroScenes,
  createMicroSceneRuntime,
  createMicroSceneSignals,
  earshotSeconds,
  requestMicroScene,
  stepMicroScenes,
  type MicroSceneRuntime,
  type MicroSceneSignals,
} from '../src/microScenes/runtime/director';
import { onRibbonAtLevel } from '../src/world/cityGen';
import { placeMicroSceneAnchors } from '../src/world/microSceneAnchors';
import { createOpenWorld } from '../src/world/openWorld';

/**
 * THE URBAN MICRO-SCENES. What is pinned here is what the player would feel if it broke: a
 * conversation never starts twice from driving back and forth, a scene never reacts to the player
 * more than once, the joint is never in two hands, a female part is never quietly voiced by the
 * male placeholder, and story dialogue always wins.
 */

const DT = 1 / 60;

function anchorAt(id: string, x: number, z: number, type: MicroSceneAnchor['type'], tags: MicroSceneAnchor['tags']): MicroSceneAnchor {
  return { id, type, tags, transform: { x, y: 0, z, heading: 0 }, actorSlots: [], propSlots: [] };
}

/** A world of one anchor with the car parked beside it, so a named scene can be put up on demand. */
function bench(anchor: MicroSceneAnchor) {
  const rt = createMicroSceneRuntime([anchor]);
  rt.ignoreCooldowns = true;
  const signals = createMicroSceneSignals();
  signals.x = anchor.transform.x;
  signals.z = anchor.transform.z + 12;
  signals.heading = Math.PI;
  signals.session = 1000;
  const events: GameEvent[] = [];
  const run = (seconds: number): GameEvent[] => {
    const out: GameEvent[] = [];
    const ticks = Math.max(1, Math.round(seconds / DT));
    for (let i = 0; i < ticks; i++) {
      events.length = 0;
      stepMicroScenes(rt, signals, DT, events);
      out.push(...events);
    }
    return out;
  };
  return { rt, signals, run };
}

/** Put `sceneId` up at the bench's anchor and run until its loop is going. */
function raise(rt: MicroSceneRuntime, run: (s: number) => GameEvent[], sceneId: string, variantId?: string): GameEvent[] {
  requestMicroScene(rt, sceneId, undefined, variantId);
  return run(CFG.prewarmSeconds + CFG.scan.interval + 0.3);
}

const lines = (events: GameEvent[]): Array<Extract<GameEvent, { type: 'microSceneLine' }>> =>
  events.filter((e): e is Extract<GameEvent, { type: 'microSceneLine' }> => e.type === 'microSceneLine');

/* ================================================================== the catalogue */

describe('the catalogue', () => {
  it('validates with no errors', () => {
    const issues = validateCatalog().filter((i) => i.severity === 'error');
    expect(issues.map((i) => `${i.scene}: ${i.message}`)).toEqual([]);
  });

  it('carries the eight scenes of the initial catalogue, each with a unique id', () => {
    const ids = MICRO_SCENES.map((s) => s.id);
    expect(ids).toEqual([
      'bus-stop-conversation',
      'broken-combustion-car',
      'emissions-checkpoint',
      'double-parking-argument',
      'illegal-parts-stand',
      'tuned-car-photographers',
      'bridge-smoke-circle',
      'bridge-suspicious-body-disposal',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every clip a name of its own across the whole catalogue', () => {
    const clips = MICRO_SCENES.flatMap((s) => sceneLines(s).map((l) => l.clip));
    expect(new Set(clips).size).toBe(clips.length);
  });

  it('keeps every scene inside the global limits', () => {
    for (const scene of MICRO_SCENES) {
      expect(scene.performanceBudget.maxActors).toBeLessThanOrEqual(3);
      expect(scene.performanceBudget.maxAnimatedActors).toBeLessThanOrEqual(CFG.maxAnimatedActors);
      expect(scene.performanceBudget.allowsDynamicLights).toBe(false);
      expect(scene.performanceBudget.allowsPhysics).toBe(false);
    }
  });

  it('shares its behaviours: every block is used, and most by more than one scene', () => {
    const usage = behaviorUsage();
    for (const id of SHARED_BEHAVIOR_IDS) expect(usage.get(id), `${id} is never used`).toBeTruthy();
    const shared = SHARED_BEHAVIOR_IDS.filter((id) => (usage.get(id) ?? []).length > 1);
    expect(shared.length).toBeGreaterThan(SHARED_BEHAVIOR_IDS.length / 2);
  });

  it('references only behaviours that exist', () => {
    for (const scene of MICRO_SCENES) {
      for (const id of sceneBehaviors(scene)) expect(SHARED_BEHAVIORS[id], `${scene.id}: ${id}`).toBeTruthy();
    }
  });

  it('keeps the rare scene rare and alone', () => {
    const rare = microScene('bridge-suspicious-body-disposal');
    const everyday = microScene('bus-stop-conversation');
    expect(rare).toBeTruthy();
    expect(everyday).toBeTruthy();
    expect(rare!.weight * 5).toBeLessThan(everyday!.weight);
    expect(rare!.unique).toBe(true);
    expect(rare!.cooldownSeconds).toBeGreaterThanOrEqual(15 * 60);
    expect(rare!.conditions?.some((c) => c.kind === 'sessionAfter')).toBe(true);
    expect(rare!.keepAwayFrom?.some((k) => k.sceneId === 'bridge-smoke-circle')).toBe(true);
  });

  it('never lets a scene give a line to somebody who is not standing there', () => {
    for (const scene of MICRO_SCENES) {
      for (const variant of scene.dialogueVariants) {
        const cast = variant.present ?? scene.actors.filter((a) => !a.alternate).map((a) => a.id);
        for (const line of variant.lines) expect(cast, `${scene.id}/${variant.id}`).toContain(line.speaker);
      }
    }
  });
});

/* ================================================================== voices */

describe('voice bindings', () => {
  it('never lets a female part fall back to a male voice', () => {
    for (const profile of Object.values(VOICE_PROFILES)) {
      const heard = resolvedVoice(profile.id);
      if (heard) expect(heard.presenting, `${profile.id} is heard as ${heard.id}`).toBe(profile.presenting);
    }
    expect(resolvedVoice('npc-femenina-1')?.characterId).toBe('npc-femenino-1');
    expect(resolvedVoice('npc-femenina-2')?.id).toBe('npc-femenina-1');
    expect(VOICE_PROFILES['npc-femenina-2'].rate).not.toBe(VOICE_PROFILES['npc-femenina-1'].rate);
  });

  it('gives the bus stop two independently configurable female speakers', () => {
    const scene = microScene('bus-stop-conversation')!;
    const variant = scene.dialogueVariants.find((v) => v.id === 'cheating-boyfriend')!;
    const speakers = new Set(variant.lines.map((l) => l.speaker));
    expect(speakers.size).toBe(2);
    const profiles = [...speakers].map((id) => scene.actors.find((a) => a.id === id)!.voice);
    expect(new Set(profiles).size).toBe(2);
    for (const p of profiles) expect(VOICE_PROFILES[p].presenting).toBe('feminine');
  });

  it('voices the placeholder male parts through the one recorded voice, pitched apart', () => {
    expect(resolvedVoice('npc-masculino-2')?.characterId).toBe('npc-masculino-1');
    expect(VOICE_PROFILES['npc-masculino-2'].rate).not.toBe(VOICE_PROFILES['npc-masculino-1'].rate);
  });

  it('selects the infidelity story now that it has voices, and casts the two women for it', () => {
    const anchor = anchorAt('stop', 0, 0, 'bus-stop', ['bus-stop', 'roadside', 'civilian', 'wide-sidewalk']);
    const { rt, run } = bench(anchor);
    const scene = microScene('bus-stop-conversation')!;
    let heard = false;
    for (let i = 0; i < 60 && !heard; i++) {
      clearMicroScenes(rt, []);
      // The first line can start while it is still going up, so everything from the raise counts.
      const said = lines([...raise(rt, run, 'bus-stop-conversation'), ...run(30)]);
      if (said.some((l) => l.clip.startsWith('busstop_d_'))) {
        heard = true;
        const inst = rt.instances.find((x) => x.scene >= 0)!;
        const present = scene.actors.filter((_, k) => inst.present[k]).map((a) => a.id);
        expect(present).toEqual(['vigia', 'celular', 'amiga']);
        expect(said.filter((l) => l.clip.startsWith('busstop_d_')).map((l) => l.voice)).toEqual([
          'npc-femenina-1', 'npc-femenina-2', 'npc-femenina-1', 'npc-femenina-2',
        ]);
      }
    }
    expect(heard).toBe(true);
  });
});

/* ================================================================== the lifecycle */

describe('the lifecycle', () => {
  it('goes up out of sight, warms, and only then starts moving', () => {
    const anchor = anchorAt('kerb', 0, 0, 'roadside', ['roadside', 'civilian', 'wide-sidewalk']);
    const { rt, run } = bench(anchor);
    requestMicroScene(rt, 'tuned-car-photographers');
    run(CFG.scan.interval + DT);
    const inst = rt.instances.find((i) => i.scene >= 0)!;
    expect(inst.state).toBe('prewarming');
    // Fading in, and nobody has taken a step: the loop has not started.
    expect(inst.show).toBeGreaterThan(0);
    expect(inst.beat).toBe(0);
    run(CFG.prewarmSeconds + 0.2);
    expect(inst.state === 'ambient' || inst.state === 'dialoguePlaying').toBe(true);
  });

  it('plays one conversation per appearance, however often the trigger is crossed', () => {
    const anchor = anchorAt('kerb', 0, 0, 'roadside', ['roadside', 'civilian', 'wide-sidewalk']);
    const { rt, signals, run } = bench(anchor);
    raise(rt, run, 'tuned-car-photographers');
    const inst = rt.instances.find((i) => i.scene >= 0)!;
    const first = lines(run(20));
    expect(first.length).toBeGreaterThan(0);
    expect(inst.dialogueDone).toBe(true);

    // Drive out to the edge of earshot and back, several times over.
    for (let i = 0; i < 4; i++) {
      signals.z = 35;
      run(2);
      signals.z = 12;
      run(6);
    }
    expect(lines(run(30)).length).toBe(0);
  });

  it('reacts to the player at most once per appearance', () => {
    const anchor = anchorAt('kerb', 0, 0, 'roadside', ['roadside', 'civilian', 'wide-sidewalk']);
    const { rt, signals, run } = bench(anchor);
    raise(rt, run, 'tuned-car-photographers');
    const inst = rt.instances.find((i) => i.scene >= 0)!;
    const blast = (): GameEvent[] => {
      signals.z = 6;
      signals.speed = CFG.reactions.aggressiveSpeed + 10;
      const out = run(1.5);
      signals.speed = 0;
      signals.z = 12;
      run(1);
      return out;
    };
    const reactions: GameEvent[] = [];
    for (let i = 0; i < 5; i++) reactions.push(...blast().filter((e) => e.type === 'microSceneReaction'));
    expect(reactions.length).toBe(1);
    expect(inst.playerReacted).toBe(true);
  });

  it('remembers nothing once the scene has been taken down and put up again', () => {
    const anchor = anchorAt('kerb', 0, 0, 'roadside', ['roadside', 'civilian', 'wide-sidewalk']);
    const { rt, run } = bench(anchor);
    raise(rt, run, 'tuned-car-photographers');
    expect(lines(run(20)).length).toBeGreaterThan(0);
    clearMicroScenes(rt, []);
    raise(rt, run, 'tuned-car-photographers');
    expect(lines(run(20)).length).toBeGreaterThan(0);
  });

  it('fades out and gives the slot back when the player drives away', () => {
    const anchor = anchorAt('kerb', 0, 0, 'roadside', ['roadside', 'civilian', 'wide-sidewalk']);
    const { rt, signals, run } = bench(anchor);
    raise(rt, run, 'tuned-car-photographers');
    signals.z = 5000;
    const events = run(CFG.fadeSeconds + 0.5);
    expect(events.some((e) => e.type === 'microSceneDespawn')).toBe(true);
    expect(rt.instances.every((i) => i.scene < 0)).toBe(true);
  });
});

/* ================================================================== audio priority */

describe('audio priority', () => {
  it('never has two environmental conversations at once', () => {
    const world = createOpenWorld();
    const anchors = world.layout.microSceneAnchors ?? [];
    const rt = createMicroSceneRuntime(anchors);
    rt.ignoreCooldowns = true;
    const signals = createMicroSceneSignals();
    signals.session = 2000;
    const events: GameEvent[] = [];
    let talking = 0;
    const spawn = world.layout.playerSpawn;
    for (let i = 0; i < 60 * 240; i++) {
      // A slow lap of the spawn area, so anchors come and go.
      const t = i * DT;
      signals.x = spawn.x + Math.cos(t * 0.05) * 120;
      signals.z = spawn.z + Math.sin(t * 0.05) * 120;
      signals.heading = -t * 0.05;
      signals.vx = -Math.sin(t * 0.05) * 6;
      signals.vz = Math.cos(t * 0.05) * 6;
      signals.speed = 6;
      events.length = 0;
      stepMicroScenes(rt, signals, DT, events);
      const speaking = rt.instances.filter((inst) => inst.line >= 0).length;
      talking = Math.max(talking, speaking);
      expect(rt.instances.filter((inst) => inst.scene >= 0 && inst.state !== 'despawning').length).toBeLessThanOrEqual(CFG.maxActive);
    }
    expect(talking).toBeLessThanOrEqual(CFG.maxTalking);
  });

  it('gets out of the way the moment story dialogue starts', () => {
    const anchor = anchorAt('kerb', 0, 0, 'roadside', ['roadside', 'civilian', 'wide-sidewalk']);
    const { rt, signals, run } = bench(anchor);
    raise(rt, run, 'tuned-car-photographers');
    // Wait for a line to be on air.
    let onAir = false;
    for (let i = 0; i < 400 && !onAir; i++) {
      run(DT);
      onAir = rt.instances.some((inst) => inst.line >= 0);
    }
    expect(onAir).toBe(true);
    signals.storyAudio = true;
    const events = run(0.2);
    const end = events.find((e) => e.type === 'microSceneLineEnd');
    expect(end).toBeTruthy();
    expect(end && end.type === 'microSceneLineEnd' && end.cut).toBe(true);
    expect(rt.talking).toBe(-1);
    // And it does not come back when the story finishes.
    signals.storyAudio = false;
    expect(lines(run(30)).length).toBe(0);
  });

  it('will not start a conversation the player would drive out of', () => {
    const anchor = anchorAt('kerb', 0, 0, 'roadside', ['roadside', 'civilian', 'wide-sidewalk']);
    const { rt, signals, run } = bench(anchor);
    // Leaving fast from the moment it goes up: earshot runs out well before three lines could be
    // heard, so the conversation is never started rather than started and clipped. Far enough out
    // that the pass is not close enough to be a reaction — that is a different rule.
    signals.z = 30;
    signals.vz = 40;
    signals.speed = 40;
    raise(rt, run, 'tuned-car-photographers');
    expect(lines(run(4)).length).toBe(0);
    expect(rt.stats.skippedNoTime).toBeGreaterThan(0);
  });

  it('measures earshot from where the car is going, not from where it is', () => {
    const signals = createMicroSceneSignals();
    signals.x = 0;
    signals.z = 10;
    signals.vz = 30;
    expect(earshotSeconds(signals, 0, 0)).toBeCloseTo((CFG.audio.max - 10) / 30, 3);
    signals.vz = -30;
    expect(earshotSeconds(signals, 0, 0)).toBe(Infinity);
  });
});

/* ================================================================== props */

describe('props', () => {
  it('passes the joint between hands and never leaves it in two', () => {
    const anchor = anchorAt('arch', 0, 0, 'under-bridge', ['under-bridge', 'dark', 'hidden', 'civilian']);
    const { rt, run } = bench(anchor);
    raise(rt, run, 'bridge-smoke-circle');
    const inst = rt.instances.find((i) => i.scene >= 0)!;
    expect(inst.propHolder).toBeGreaterThanOrEqual(0);
    const held = new Set<number>();
    for (let i = 0; i < 60 * 90; i++) {
      run(DT);
      // In flight or in a hand — never both, and never nowhere.
      const inFlight = inst.propTo >= 0 && inst.propFrom >= 0;
      expect(inFlight || inst.propHolder >= 0).toBe(true);
      if (inFlight) expect(inst.propFrom).not.toBe(inst.propTo);
      else held.add(inst.propHolder);
    }
    // It went round: more than one person had it.
    expect(held.size).toBeGreaterThan(1);
  });

  it('never hands the bundle to anybody: it is dragged, and it never arrives', () => {
    const anchor = anchorAt('arch', 0, 0, 'under-bridge', ['under-bridge', 'dark', 'hidden', 'civilian']);
    const { rt, run } = bench(anchor);
    raise(rt, run, 'bridge-suspicious-body-disposal');
    const inst = rt.instances.find((i) => i.scene >= 0)!;
    expect(inst.scene).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 60 * 60; i++) {
      run(DT);
      expect(inst.propHolder).toBe(-1);
      expect(inst.dragProgress).toBeGreaterThanOrEqual(0);
      expect(inst.dragProgress).toBeLessThanOrEqual(1);
    }
  });
});

/* ================================================================== the police */

describe('the police', () => {
  it('puts the table away when a patrol comes near, and picks up only after it has gone', () => {
    const anchor = anchorAt('shops', 0, 0, 'commercial', ['commercial', 'roadside', 'civilian', 'wide-sidewalk']);
    const { rt, signals, run } = bench(anchor);
    raise(rt, run, 'illegal-parts-stand');
    const inst = rt.instances.find((i) => i.scene >= 0)!;
    signals.policeX = 0;
    signals.policeZ = 5;
    signals.policeDistance = 5;
    const events = run(2);
    expect(events.some((e) => e.type === 'microSceneReaction' && e.reaction === 'pack-it-up')).toBe(true);
    expect(inst.state).toBe('reacted');
    expect(inst.alarm).toBeGreaterThan(0.5);
    // Still there: nothing picks up.
    run(20);
    expect(inst.state).toBe('reacted');
    // Gone: after the randomized wait they get back to it.
    signals.policeDistance = Infinity;
    run(30);
    expect(inst.state === 'ambient' || inst.state === 'coolingDown').toBe(true);
  });

  it('never touches the wanted level or spawns anything', () => {
    const anchor = anchorAt('avenue', 0, 0, 'lay-by', ['roadside', 'civilian', 'wide-sidewalk', 'police-compatible']);
    const { rt, signals, run } = bench(anchor);
    raise(rt, run, 'emissions-checkpoint');
    signals.speed = 60;
    signals.z = 6;
    const events = run(4);
    for (const e of events) {
      expect(['microSceneSpawn', 'microSceneDespawn', 'microSceneLine', 'microSceneLineEnd', 'microSceneReaction']).toContain(e.type);
    }
    expect(signals.stars).toBe(0);
  });

  it('keeps the checkpoint out of a pursuit', () => {
    const anchor = anchorAt('avenue', 0, 0, 'lay-by', ['roadside', 'civilian', 'wide-sidewalk', 'police-compatible']);
    const { rt, signals, run } = bench(anchor);
    signals.pursuit = true;
    requestMicroScene(rt, 'emissions-checkpoint');
    run(4);
    const inst = rt.instances.find((i) => i.scene >= 0);
    // Forced up by the debug tools, it comes straight back down once its conditions are read.
    if (inst) {
      signals.z = 60;
      run(4);
      expect(inst.state === 'despawning' || inst.scene < 0).toBe(true);
    }
  });
});

/* ================================================================== behaviours */

describe('the shared behaviour blocks', () => {
  it('each write only the drives they advertise', () => {
    const base = createActorDrive();
    for (const spec of Object.values(SHARED_BEHAVIORS)) {
      const ctx = createBehaviorContext();
      ctx.time = 3.4;
      ctx.dt = DT;
      ctx.playerDistance = 5;
      ctx.playerSpeed = 12;
      ctx.playerClosing = 12;
      ctx.policeDistance = 8;
      ctx.alarm = 1;
      ctx.observed = 1;
      ctx.resumeIn = 1;
      ctx.speaker = 0;
      ctx.actor = 0;
      ctx.speaking = true;
      ctx.lineProgress = 0.5;
      ctx.propHolder = 0;
      ctx.propTo = 1;
      ctx.propTransfer = 0.5;
      ctx.beatActive = true;
      const out = createActorDrive();
      spec.run(ctx, out);
      for (const key of Object.keys(base) as Array<keyof typeof base>) {
        if (spec.drives.includes(key)) continue;
        // `lookX`/`lookZ` travel with `lookWeight`.
        if ((key === 'lookX' || key === 'lookZ') && spec.drives.includes('lookWeight')) continue;
        expect(out[key], `${spec.id} wrote ${key}`).toBe(base[key]);
      }
    }
  });

  it('damps everything else when the resume delay is running, whatever order it is written in', () => {
    const ctx = createBehaviorContext();
    ctx.time = 2;
    ctx.speaker = -1;
    ctx.actor = 0;
    ctx.resumeIn = 2.5;
    const out = createActorDrive();
    runBehaviors(['resumeAfterDelay', 'idleConversation'], ctx, out);
    expect(out.speak).toBe(0);
    expect(out.still).toBeGreaterThan(0);
  });

  it('never allocates a look at nothing', () => {
    const ctx = createBehaviorContext();
    ctx.playerDistance = 500;
    ctx.policeDistance = Infinity;
    const out = createActorDrive();
    runBehaviors(['lookAtPlayer', 'lookAtPassingVehicle', 'watchForPolice'], ctx, out);
    expect(out.lookWeight).toBe(0);
  });
});

/* ================================================================== the world */

describe('the anchors Bandido Metro carries', () => {
  const world = createOpenWorld();
  const anchors = world.layout.microSceneAnchors ?? [];

  it('lays down enough places, all of them valid', () => {
    expect(anchors.length).toBeGreaterThan(30);
    expect(validateAnchors(anchors).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('is deterministic: the same city twice gives the same anchors', () => {
    const again = placeMicroSceneAnchors(createOpenWorld());
    expect(again.map((a) => a.id)).toEqual(anchors.map((a) => a.id));
    expect(again.map((a) => Math.round(a.transform.x))).toEqual(anchors.map((a) => Math.round(a.transform.x)));
  });

  it('never stands one on a street or inside a building', () => {
    for (const a of anchors) {
      const { x, z } = a.transform;
      // Ground level only: a deck eight metres overhead is shade, not asphalt, which is the whole
      // point of an under-bridge anchor.
      for (const rb of world.plan.ribbons) {
        expect(onRibbonAtLevel(rb, x, z, 0, 0), `${a.id} is on ${rb.tag ?? rb.kind}`).toBe(false);
      }
      expect(world.plan.isSolid(x, z, 0), `${a.id} is inside something`).toBe(false);
    }
  });

  it('never shares a shelter with the waiting crowd', () => {
    const stops = world.plan.busStops ?? [];
    const stopAnchors = anchors.filter((a) => a.type === 'bus-stop');
    expect(stopAnchors.length).toBeGreaterThan(0);
    for (const a of stopAnchors) {
      const i = Number(a.id.replace('ms-stop-', ''));
      expect(stops[i]).toBeTruthy();
    }
  });

  it('offers a home to every scene in the catalogue', () => {
    for (const scene of MICRO_SCENES) {
      const fits = anchors.filter(
        (a) =>
          scene.compatibleAnchorTypes.includes(a.type) &&
          (scene.requiredAnchorTags ?? []).every((t) => a.tags.includes(t)) &&
          !(scene.forbiddenAnchorTags ?? []).some((t) => a.tags.includes(t)),
      );
      expect(fits.length, `${scene.id} has nowhere to stand`).toBeGreaterThan(0);
    }
  });

  it('keeps the two bridge scenes out of the same arch', () => {
    const dark = anchors.filter((a) => a.tags.includes('dark'));
    expect(dark.length).toBeGreaterThan(0);
    expect(dark.some((a) => (a.exclusiveWith ?? []).length > 0)).toBe(true);
  });
});

/* ================================================================== budgets */

describe('the budget', () => {
  it('never lets the whole system past its global ceilings', () => {
    const world = createOpenWorld();
    const rt = createMicroSceneRuntime(world.layout.microSceneAnchors ?? []);
    rt.ignoreCooldowns = true;
    const signals: MicroSceneSignals = createMicroSceneSignals();
    signals.session = 3000;
    const spawn = world.layout.playerSpawn;
    const events: GameEvent[] = [];
    for (let i = 0; i < 60 * 300; i++) {
      const t = i * DT;
      signals.x = spawn.x + Math.cos(t * 0.08) * 160;
      signals.z = spawn.z + Math.sin(t * 0.08) * 160;
      signals.heading = -t * 0.08;
      signals.speed = 12;
      signals.vx = -Math.sin(t * 0.08) * 12;
      signals.vz = Math.cos(t * 0.08) * 12;
      events.length = 0;
      stepMicroScenes(rt, signals, DT, events);
      expect(rt.budget.animatedActors).toBeLessThanOrEqual(CFG.maxAnimatedActors);
      expect(rt.budget.particles).toBeLessThanOrEqual(CFG.maxParticles);
      expect(rt.budget.scenes).toBeLessThanOrEqual(CFG.maxActive);
    }
    expect(rt.stats.spawned).toBeGreaterThan(0);
  });
});
