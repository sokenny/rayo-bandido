import type { ArenaLayout, GameEvent, GameState, IntroObjectiveId, IntroStage, IntroState } from '../core/types';
import { introLine, introLineSeconds, type IntroConfig, type IntroLine } from '../content/intro';
import { canAffordShot } from './lightning';

/**
 * THE INTRODUCTION'S RULES: a small explicit state machine over `IntroState`, stepped once a
 * tick by `stepGame` like every other activity, and pure in the same way — no DOM, no timers,
 * no Three.js. Presentation reads the state and the events; the five things it has to tell the
 * rules (the opening ended, the clip ended, skip this line, skip the intro, take the assist)
 * are the flag setters at the bottom.
 *
 *   opening → incomingCall → approach → drift → disableEV → arrival → meetup → complete
 *
 * EVENT-DRIVEN, NOT A TIMELINE. A stage ends when the player has done the thing — driven a
 * little way, held a slide, put the bolt in a car, reached the meet — never because a clock
 * ran out. There is no marker to follow until the meet: the drift is anywhere, the electric
 * car is any one on the street. Dialogue is a queue said one line at a time with silence
 * between lines; a line marked `instructional` for an objective is dropped unsaid if that
 * objective is already done by the time it would start, so nobody is told how to do what they
 * just did. Skipping a line ends the line and nothing else.
 *
 * THE CAR SHOT is an ordinary electric car and pays what any kill pays; the whole introduction
 * is an engaged activity (`src/sim/activities.ts`), so there are no police, no run and no fare
 * for its whole length.
 *
 * Allocation: the queue and the said-set grow by a few entries over the whole intro; nothing
 * allocates per tick.
 */

/**
 * The meet's furniture that the RULES know about: the parked cars are solid. Axis-aligned
 * boxes, appended to the layout before the state is built; the art is `src/game.ts`'s.
 */
export function installIntroMeetup(layout: ArenaLayout, cfg: IntroConfig): void {
  const h = cfg.meetup.carHalf;
  for (const c of cfg.meetup.cars) {
    layout.colliders.push({ minX: c.x - h.x, maxX: c.x + h.x, minZ: c.z - h.z, maxZ: c.z + h.z, maxY: 3, tag: 'intro-car' });
  }
}

export function createIntroState(): IntroState {
  return {
    active: true,
    stage: 'opening',
    stageTime: 0,
    openingDone: false,
    cinematicDone: false,
    ringing: false,
    callConnected: false,
    queue: [],
    said: new Set<string>(),
    lineId: '',
    lineText: '',
    lineTimeLeft: 0,
    lineSeq: 0,
    gapLeft: 0,
    objective: null,
    objectiveText: '',
    objectiveX: 0,
    objectiveZ: 0,
    objectiveRadius: 0,
    approachDone: false,
    driftDone: false,
    driftAssisted: false,
    struggleTime: 0,
    hintGiven: false,
    assistOffered: false,
    assistAccepted: false,
    evDone: false,
    noChargeFor: 0,
    rechargeAssists: 0,
    arrivalDone: false,
    odometer: 0,
    skipLineRequested: false,
    skipRequested: false,
    done: null,
  };
}

/**
 * A restart (R) during the intro: back to the safe beginning, without replaying the opening.
 * A finished or skipped intro stays finished — a restart afterwards is an ordinary restart.
 */
export function resetIntroState(intro: IntroState): void {
  if (intro.done !== null) return;
  const fresh = createIntroState();
  fresh.openingDone = intro.openingDone;
  fresh.stage = intro.openingDone ? 'incomingCall' : 'opening';
  Object.assign(intro, fresh);
}

/** The car is held (handbrake on, no throttle) while the opening plays, and while the clip does. */
export function introHoldsPlayer(intro: IntroState | null): boolean {
  if (!intro || !intro.active) return false;
  return intro.stage === 'opening' || (intro.stage === 'meetup' && !intro.cinematicDone);
}

/* ------------------------------------------------------------- presentation → rules */

export function finishIntroOpening(intro: IntroState): void {
  intro.openingDone = true;
}

export function finishIntroCinematic(intro: IntroState): void {
  intro.cinematicDone = true;
}

export function skipIntroLine(intro: IntroState): void {
  intro.skipLineRequested = true;
}

export function skipIntro(intro: IntroState): void {
  intro.skipRequested = true;
}

export function acceptIntroAssist(intro: IntroState): void {
  if (intro.assistOffered) intro.assistAccepted = true;
}

/* ------------------------------------------------------------- internals */

function say(intro: IntroState, id: string): void {
  if (intro.said.has(id)) return;
  intro.said.add(id);
  intro.queue.push(id);
}

function objectiveDone(intro: IntroState, id: IntroObjectiveId): boolean {
  switch (id) {
    case 'approach':
      return intro.approachDone;
    case 'drift':
      return intro.driftDone;
    case 'disable':
      return intro.evDone;
    case 'arrival':
      return intro.arrivalDone;
  }
}

function available(state: GameState, what: IntroLine['requires']): boolean {
  switch (what) {
    case undefined:
      return true;
    case 'rush':
      return !!state.rush;
    case 'circuit':
      return !!state.circuitGate;
    case 'street':
      return !!state.streetGate;
    case 'police':
      return !!state.police;
  }
}

function endLine(intro: IntroState, events: GameEvent[]): void {
  if (!intro.lineId) return;
  const id = intro.lineId;
  intro.lineId = '';
  intro.lineText = '';
  intro.lineTimeLeft = 0;
  events.push({ type: 'introLineEnd', id });
}

/** One line at a time, silence between them, stale instructions dropped. */
function stepDialogue(intro: IntroState, cfg: IntroConfig, state: GameState, dt: number, events: GameEvent[]): void {
  if (intro.lineId) {
    intro.lineTimeLeft -= dt;
    if (intro.skipLineRequested || intro.lineTimeLeft <= 0) {
      const gap = introLine(cfg, intro.lineId).gap ?? cfg.timing.gap;
      endLine(intro, events);
      intro.gapLeft = gap;
    }
    intro.skipLineRequested = false;
    return;
  }
  intro.skipLineRequested = false;
  if (intro.gapLeft > 0) {
    intro.gapLeft -= dt;
    return;
  }
  while (intro.queue.length > 0) {
    const id = intro.queue.shift() as string;
    const l = introLine(cfg, id);
    if (l.instructional && objectiveDone(intro, l.instructional)) continue;
    if (!available(state, l.requires)) continue;
    const seconds = introLineSeconds(cfg, l);
    intro.lineId = id;
    intro.lineText = l.text;
    intro.lineTimeLeft = seconds;
    intro.lineSeq++;
    events.push({ type: 'introLine', id, speaker: l.speaker, text: l.text, voice: l.voice, seconds });
    return;
  }
}

/**
 * The objective on the strip. Only the meet is a place: every other objective is a thing to do
 * wherever the player is, and carries no point (`objectiveRadius` 0) for the marker or the map.
 */
function setObjective(intro: IntroState, cfg: IntroConfig, id: IntroObjectiveId | null, events: GameEvent[]): void {
  if (intro.objective === id) return;
  intro.objective = id;
  intro.objectiveX = 0;
  intro.objectiveZ = 0;
  intro.objectiveRadius = 0;
  if (id === null) {
    intro.objectiveText = '';
    events.push({ type: 'introObjective', id: null, text: '' });
    return;
  }
  intro.objectiveText = cfg.objectives[id];
  if (id === 'arrival') {
    const p = cfg.route.meetup;
    intro.objectiveX = p.x;
    intro.objectiveZ = p.z;
    intro.objectiveRadius = p.radius;
  }
  events.push({ type: 'introObjective', id, text: intro.objectiveText });
}

function setStage(intro: IntroState, stage: IntroStage, events: GameEvent[]): void {
  intro.stage = stage;
  intro.stageTime = 0;
  events.push({ type: 'introStage', stage });
}

function within(state: GameState, x: number, z: number, radius: number): boolean {
  const dx = state.vehicle.x - x;
  const dz = state.vehicle.z - z;
  return dx * dx + dz * dz <= radius * radius;
}

function topUpCharge(state: GameState, cfg: IntroConfig): void {
  state.lightning.charge = Math.max(state.lightning.charge, cfg.drift.chargeBonus);
}

function finish(intro: IntroState, reason: 'completed' | 'skipped', events: GameEvent[]): void {
  if (intro.done !== null) return;
  intro.done = reason;
  intro.active = false;
  intro.queue.length = 0;
  endLine(intro, events);
  intro.ringing = false;
  intro.assistOffered = false;
  if (intro.callConnected) {
    intro.callConnected = false;
    events.push({ type: 'introCall', phase: 'ended' });
  }
  setStage(intro, 'complete', events);
  intro.objective = null;
  intro.objectiveText = '';
  intro.objectiveRadius = 0;
  events.push({ type: 'introObjective', id: null, text: '' });
  events.push({ type: 'introDone', reason });
}

/* ------------------------------------------------------------- the tick */

/**
 * One tick. Called after the lightning has fired, so the tick's own `targetDestroyed` is
 * already on the list for the shutdown stage to see.
 */
export function stepIntro(intro: IntroState, cfg: IntroConfig, state: GameState, dt: number, events: GameEvent[]): void {
  if (!intro.active) return;

  if (intro.skipRequested) {
    intro.skipRequested = false;
    finish(intro, 'skipped', events);
    return;
  }

  intro.stageTime += dt;
  if (intro.callConnected) intro.odometer += Math.abs(state.vehicle.speed) * dt;

  switch (intro.stage) {
    case 'opening':
      if (intro.openingDone) setStage(intro, 'incomingCall', events);
      break;

    case 'incomingCall': {
      const c = cfg.call;
      if (!intro.ringing && !intro.callConnected && intro.stageTime >= c.delaySeconds) {
        intro.ringing = true;
        events.push({ type: 'introCall', phase: 'ringing' });
      }
      if (intro.ringing && intro.stageTime >= c.delaySeconds + c.ringSeconds) {
        intro.ringing = false;
        intro.callConnected = true;
        events.push({ type: 'introCall', phase: 'connected' });
        say(intro, 'a1');
        say(intro, 'a2');
        say(intro, 'a3');
        setObjective(intro, cfg, 'approach', events);
        setStage(intro, 'approach', events);
      }
      break;
    }

    case 'approach': {
      // The lore is paced by the road driven; the drift is asked for once there has been enough
      // of it — or at once, if the player is already sliding.
      const at = cfg.route.loreAtMetres;
      if (intro.odometer >= at.batteries) say(intro, 'b1');
      if (intro.odometer >= at.combustion) say(intro, 'b2');
      const d = state.drift;
      const sliding = d.active && d.duration >= cfg.drift.seconds && d.chargeRate > 0;
      if (intro.odometer >= cfg.route.driftAskedAtMetres || sliding) {
        intro.approachDone = true;
        say(intro, 'b1');
        say(intro, 'b2');
        say(intro, 'b3');
        say(intro, 'b4');
        say(intro, 'c1');
        setObjective(intro, cfg, 'drift', events);
        setStage(intro, 'drift', events);
      }
      break;
    }

    case 'drift': {
      const d = state.drift;
      if (d.active && d.duration >= cfg.drift.seconds && d.chargeRate > 0) {
        intro.driftDone = true;
        intro.assistOffered = false;
        topUpCharge(state, cfg);
        say(intro, 'c2');
      } else if (intro.assistAccepted) {
        intro.driftDone = true;
        intro.driftAssisted = true;
        intro.assistOffered = false;
        topUpCharge(state, cfg);
      } else {
        // The struggle clock runs from the moment the instruction has been given (or dropped),
        // not from the stage: the lore said on the way in is not time spent failing.
        const explained = intro.said.has('c1') && intro.lineId !== 'c1' && intro.queue.indexOf('c1') < 0;
        if (explained) intro.struggleTime += dt;
        if (!intro.hintGiven && intro.struggleTime >= cfg.drift.hintAfterSeconds) {
          intro.hintGiven = true;
          say(intro, 'c-hint');
        }
        if (!intro.assistOffered && intro.struggleTime >= cfg.drift.assistAfterSeconds) intro.assistOffered = true;
        break;
      }
      intro.assistAccepted = false;
      say(intro, 'd1');
      say(intro, 'd2');
      setObjective(intro, cfg, 'disable', events);
      setStage(intro, 'disableEV', events);
      break;
    }

    case 'disableEV': {
      // Any electric car on the street. The police are a separate list and never raise this.
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.type === 'targetDestroyed' && e.targetId >= 0) {
          intro.evDone = true;
          break;
        }
      }
      if (intro.evDone) {
        say(intro, 'd3');
        say(intro, 'd4');
        say(intro, 'e1');
        setObjective(intro, cfg, 'arrival', events);
        setStage(intro, 'arrival', events);
        break;
      }
      // The meter ran dry (a miss, a fumble, a long hold): topped up rather than the intro
      // restarted, after a beat in which a drift could have done it.
      const l = state.lightning;
      if (!l.charging && !canAffordShot(l.charge)) {
        intro.noChargeFor += dt;
        if (intro.noChargeFor >= cfg.ev.rechargeAfterSeconds) {
          intro.noChargeFor = 0;
          intro.rechargeAssists++;
          topUpCharge(state, cfg);
          events.push({ type: 'introNote', text: cfg.notes.recharged });
        }
      } else {
        intro.noChargeFor = 0;
      }
      break;
    }

    case 'arrival': {
      const r = cfg.route.meetup;
      if (within(state, r.x, r.z, r.radius)) {
        intro.arrivalDone = true;
        setObjective(intro, cfg, null, events);
        // The clip plays here; the car is held until it is over (`introHoldsPlayer`). Whatever
        // she was saying is cut: the meet is the picture now.
        endLine(intro, events);
        intro.queue.length = 0;
        intro.gapLeft = 0;
        setStage(intro, 'meetup', events);
      }
      break;
    }

    case 'meetup': {
      if (!intro.cinematicDone) break;
      if (!intro.said.has('e2')) {
        say(intro, 'e2');
        say(intro, 'e3');
        say(intro, 'e4');
        say(intro, 'e5');
        say(intro, 'e6');
        say(intro, 'e7');
      }
      // The call ends when she has finished talking — the silence after the last line included.
      if (intro.queue.length === 0 && !intro.lineId && intro.gapLeft <= 0) {
        finish(intro, 'completed', events);
        return;
      }
      break;
    }

    case 'complete':
      return;
  }

  stepDialogue(intro, cfg, state, dt, events);
}
