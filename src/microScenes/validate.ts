// Explicit `.ts` extensions on this chain so Node can load it straight, the way it loads the
// registry: `scripts/scene-catalog.mjs` and `scripts/generate-scene-voices.mjs` both run it.
import { isSharedBehavior } from './behaviors.ts';
import { MICRO_SCENES, sceneLines } from './registry.ts';
import { budgetWithinGlobal } from './runtime/budget.ts';
import { MAX_ACTORS, MAX_PROPS, MAX_REACTIONS } from './runtime/instance.ts';
import type { MicroSceneAnchor, MicroSceneDefinition } from './types';
import { resolvedVoice, unvoicedProfiles, VOICE_PROFILES, voiceConfigured } from './voices.ts';

/**
 * WHAT WOULD BE WRONG WITH THE CATALOGUE. Run in development at start-up and in the tests, so a
 * scene that references a behaviour that does not exist, a speaker who is not in its own cast, or
 * a voice nobody has recorded, is a line in the console rather than a silence in the city.
 *
 * ERRORS are things that would misbehave: a duplicate id, an unknown anchor type, a dialogue line
 * addressed to nobody, a budget over the global ceiling, a prop pass with no attachment points.
 * WARNINGS are things that are merely not finished: a missing clip, an unvoiced profile.
 *
 * Pure: it reads the catalogue and answers. It never loads a file and never touches the network —
 * whether a CLIP exists on disk is the generator's business (`scripts/generate-scene-voices.mjs`),
 * and what this checks is whether one was ever going to be made.
 */

export interface SceneIssue {
  scene: string;
  severity: 'error' | 'warning';
  message: string;
}

/** Every anchor type a scene is allowed to name. Kept beside the union so the two cannot drift. */
const ANCHOR_TYPES = [
  'bus-stop',
  'roadside',
  'commercial',
  'lay-by',
  'under-bridge',
  'under-highway',
  'dark-corner',
  'industrial-alley',
  'dark-service-road',
];

export function validateScene(scene: MicroSceneDefinition, seenIds: Set<string>, seenClips: Map<string, string>): SceneIssue[] {
  const out: SceneIssue[] = [];
  const error = (message: string): void => void out.push({ scene: scene.id, severity: 'error', message });
  const warn = (message: string): void => void out.push({ scene: scene.id, severity: 'warning', message });

  if (seenIds.has(scene.id)) error('duplicate scene id');
  seenIds.add(scene.id);

  /* ------------------------------------------------------------ anchors */

  if (scene.compatibleAnchorTypes.length === 0) error('no compatible anchor types: it can never stand anywhere');
  for (const type of scene.compatibleAnchorTypes) {
    if (!ANCHOR_TYPES.includes(type)) error(`unknown anchor type "${type}"`);
  }
  if (scene.requiredAnchorTags?.some((t) => scene.forbiddenAnchorTags?.includes(t))) {
    error('a tag is both required and forbidden');
  }

  /* ------------------------------------------------------------ distances */

  if (!(scene.spawnDistance > scene.activationDistance)) error('spawnDistance must be beyond activationDistance');
  if (!(scene.activationDistance > scene.dialogueDistance)) error('activationDistance must be beyond dialogueDistance');
  if (!(scene.despawnDistance > scene.spawnDistance)) {
    error('despawnDistance must be beyond spawnDistance, or a scene is taken down the moment it goes up');
  }

  /* ------------------------------------------------------------ cast and props */

  const actorIds = new Set<string>();
  for (const a of scene.actors) {
    if (actorIds.has(a.id)) error(`duplicate actor id "${a.id}"`);
    actorIds.add(a.id);
    if (a.slot < 0) error(`actor "${a.id}" has a negative anchor slot`);
    for (const b of a.behaviors) if (!isSharedBehavior(b)) error(`actor "${a.id}" uses unknown behaviour "${b}"`);
    if (!VOICE_PROFILES[a.voice]) error(`actor "${a.id}" names unknown voice profile "${a.voice}"`);
    else if (!voiceConfigured(a.voice)) {
      warn(`actor "${a.id}" needs voice profile "${a.voice}", which has no recording and no stand-in`);
    }
    if (a.holds && !scene.props.some((p) => p.id === a.holds)) error(`actor "${a.id}" holds unknown prop "${a.holds}"`);
  }
  if (scene.actors.length > MAX_ACTORS) error(`${scene.actors.length} actors: the instance pool is sized for ${MAX_ACTORS}`);
  const standing = scene.actors.filter((a) => !a.alternate).length;
  if (standing > scene.performanceBudget.maxActors) {
    error(`${standing} actors stand by default, above its own maxActors of ${scene.performanceBudget.maxActors}`);
  }

  const propIds = new Set<string>();
  for (const p of scene.props) {
    if (propIds.has(p.id)) error(`duplicate prop id "${p.id}"`);
    propIds.add(p.id);
  }
  if (scene.props.length > MAX_PROPS) error(`${scene.props.length} props: the instance pool is sized for ${MAX_PROPS}`);

  /* ------------------------------------------------------------ the sequence */

  for (const b of scene.ambientSequence) {
    if (b.behavior && !isSharedBehavior(b.behavior)) error(`beat "${b.id}" cues unknown behaviour "${b.behavior}"`);
    if (b.actor && !actorIds.has(b.actor)) error(`beat "${b.id}" names unknown actor "${b.actor}"`);
    if (b.prop && !propIds.has(b.prop)) error(`beat "${b.id}" names unknown prop "${b.prop}"`);
    if (!b.prop && b.to && !actorIds.has(b.to)) error(`beat "${b.id}" hands to unknown actor "${b.to}"`);
  }
  for (const b of scene.sharedBehaviors) if (!isSharedBehavior(b)) error(`unknown shared behaviour "${b}"`);

  // A PROP TRANSFER NEEDS TWO ENDS: somebody to start with it, and a beat that hands it somewhere.
  for (const p of scene.props) {
    if (!p.transferable) continue;
    const holder = scene.actors.find((a) => a.holds === p.id);
    if (!holder) error(`prop "${p.id}" is transferable but nobody starts holding it`);
    const passes = scene.ambientSequence.filter((b) => b.prop === p.id && b.to);
    if (passes.length === 0) error(`prop "${p.id}" is transferable but no beat ever passes it`);
    for (const beat of passes) {
      const to = scene.actors.find((a) => a.id === beat.to);
      if (!to) error(`beat "${beat.id}" passes "${p.id}" to unknown actor "${beat.to}"`);
      else if (!to.behaviors.includes('passSmallProp')) {
        error(`beat "${beat.id}" passes "${p.id}" to "${to.id}", who does not carry passSmallProp`);
      }
    }
    if (holder && !holder.behaviors.includes('passSmallProp')) {
      error(`"${holder.id}" starts with "${p.id}" but does not carry passSmallProp`);
    }
  }
  for (const p of scene.props) {
    if (!p.dragged) continue;
    const draggers = scene.actors.filter((a) => a.behaviors.includes('dragLargeProp'));
    if (draggers.length < 2) error(`prop "${p.id}" is dragged but fewer than two actors carry dragLargeProp`);
    if (!scene.ambientSequence.some((b) => b.prop === p.id)) error(`prop "${p.id}" is dragged but no beat moves it`);
  }

  /* ------------------------------------------------------------ dialogue */

  if (scene.dialogueVariants.length === 0) error('no dialogue variants');
  const variantIds = new Set<string>();
  for (const v of scene.dialogueVariants) {
    if (variantIds.has(v.id)) error(`duplicate variant id "${v.id}"`);
    variantIds.add(v.id);
    if (v.lines.length === 0) error(`variant "${v.id}" has no lines`);
    if (v.weight <= 0) warn(`variant "${v.id}" has weight ${v.weight}: it will never be drawn`);
    if (v.present) {
      for (const id of v.present) if (!actorIds.has(id)) error(`variant "${v.id}" casts unknown actor "${id}"`);
      if (v.present.length > scene.performanceBudget.maxActors) {
        error(`variant "${v.id}" casts ${v.present.length} actors, above maxActors ${scene.performanceBudget.maxActors}`);
      }
    }
    const cast = v.present ?? scene.actors.filter((a) => !a.alternate).map((a) => a.id);
    for (const line of v.lines) {
      if (!cast.includes(line.speaker)) {
        error(`variant "${v.id}" gives a line to "${line.speaker}", who is not standing there for it`);
      }
    }
    // A VARIANT WHOSE VOICES DO NOT EXIST: written down, kept, and flagged — never quietly recast.
    const missing = new Set<string>();
    for (const line of v.lines) {
      const profile = line.voice ?? scene.actors.find((a) => a.id === line.speaker)?.voice;
      if (profile && !voiceConfigured(profile)) missing.add(profile);
    }
    if (missing.size > 0) warn(`variant "${v.id}" needs voice ${[...missing].join(', ')}: it will not be selected`);
  }

  /* ------------------------------------------------------------ reactions */

  const reactions = scene.reactions ?? [];
  if (reactions.length > MAX_REACTIONS) error(`${reactions.length} reactions: the instance pool is sized for ${MAX_REACTIONS}`);
  const reactionIds = new Set<string>();
  for (const r of reactions) {
    if (reactionIds.has(r.id)) error(`duplicate reaction id "${r.id}"`);
    reactionIds.add(r.id);
    for (const b of r.behaviors) if (!isSharedBehavior(b)) error(`reaction "${r.id}" uses unknown behaviour "${b}"`);
    for (const id of r.actors ?? []) if (!actorIds.has(id)) error(`reaction "${r.id}" names unknown actor "${id}"`);
    for (const line of r.lines ?? []) {
      if (!actorIds.has(line.speaker)) error(`reaction "${r.id}" gives a line to unknown actor "${line.speaker}"`);
    }
    if (r.seconds <= 0) error(`reaction "${r.id}" lasts no time at all`);
  }

  /* ------------------------------------------------------------ clips */

  for (const line of sceneLines(scene)) {
    if (!line.clip) {
      error(`a line by "${line.speaker}" has no clip id`);
      continue;
    }
    const owner = seenClips.get(line.clip);
    if (owner && owner !== scene.id) error(`clip "${line.clip}" is also used by ${owner}`);
    else if (owner === scene.id) error(`clip "${line.clip}" is used twice in this scene`);
    seenClips.set(line.clip, scene.id);
    if (!/^[a-z0-9_]+$/.test(line.clip)) error(`clip "${line.clip}" is not a plain snake_case file name`);
  }

  /* ------------------------------------------------------------ budget */

  for (const message of budgetWithinGlobal(scene)) error(message);

  return out;
}

/** The whole catalogue. What the start-up check and the tests both call. */
export function validateCatalog(): SceneIssue[] {
  const ids = new Set<string>();
  const clips = new Map<string, string>();
  const out: SceneIssue[] = [];
  for (const scene of MICRO_SCENES) out.push(...validateScene(scene, ids, clips));
  for (const profile of unvoicedProfiles()) {
    out.push({
      scene: '(voices)',
      severity: 'warning',
      message: `voice profile "${profile.id}" (${profile.label}, ${profile.presenting}) has no recording and no stand-in`,
    });
  }
  return out;
}

/** Anchors the world laid down, checked against the catalogue: places nothing can ever stand. */
export function validateAnchors(anchors: readonly MicroSceneAnchor[]): SceneIssue[] {
  const out: SceneIssue[] = [];
  const ids = new Set<string>();
  for (const a of anchors) {
    if (ids.has(a.id)) out.push({ scene: '(anchors)', severity: 'error', message: `duplicate anchor id "${a.id}"` });
    ids.add(a.id);
    if (!ANCHOR_TYPES.includes(a.type)) {
      out.push({ scene: '(anchors)', severity: 'error', message: `anchor "${a.id}" has unknown type "${a.type}"` });
    }
    if (!MICRO_SCENES.some((s) => s.compatibleAnchorTypes.includes(a.type))) {
      out.push({ scene: '(anchors)', severity: 'warning', message: `anchor "${a.id}" (${a.type}) fits no scene in the catalogue` });
    }
  }
  for (const a of anchors) {
    for (const other of a.exclusiveWith ?? []) {
      if (!ids.has(other)) {
        out.push({ scene: '(anchors)', severity: 'error', message: `anchor "${a.id}" is exclusive with unknown "${other}"` });
      }
    }
  }
  return out;
}

/**
 * Development only: shout about it once, at start-up. Errors are `console.error` because they are
 * bugs; the unvoiced profiles are a `console.warn` because they are simply work not done yet.
 */
export function reportCatalogIssues(anchors: readonly MicroSceneAnchor[] = [], log = console): void {
  const issues = [...validateCatalog(), ...validateAnchors(anchors)];
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  for (const i of errors) log.error(`[micro-scenes] ${i.scene}: ${i.message}`);
  for (const i of warnings) log.warn(`[micro-scenes] ${i.scene}: ${i.message}`);
  if (warnings.length > 0) {
    const pending = unvoicedProfiles().map((p) => p.id);
    if (pending.length > 0) {
      log.warn(
        `[micro-scenes] MISSING VOICES: ${pending.join(', ')}. Their lines are written and kept; the variants that ` +
          'need them stay unselected until the recordings exist. Add the ids to `server/dialogue/voices.mjs`, point ' +
          'the profiles at them in `src/microScenes/voices.ts`, and run `node scripts/generate-scene-voices.mjs`.',
      );
    }
  }
}

/** Which profile a line will actually be heard in, for the debug list. Null when nobody voices it. */
export function heardAs(profileId: string): string | null {
  const resolved = resolvedVoice(profileId as never);
  return resolved ? resolved.id : null;
}
