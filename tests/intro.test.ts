import { afterEach, describe, expect, it } from 'vitest';
import { INTRO, introLine, introLineSeconds } from '../src/content/intro';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { clearIntroProgress, readIntroProgress, writeIntroProgress } from '../src/core/progress';
import type { GameEvent, PlayerCommand } from '../src/core/types';
import { engagedActivity, lockOtherActivities } from '../src/sim/activities';
import { createInitialGameState, resetGameState, stepGame } from '../src/sim/gameState';
import {
  acceptIntroAssist,
  finishIntroCinematic,
  finishIntroOpening,
  installIntroMeetup,
  introHoldsPlayer,
  resetIntroState,
  skipIntro,
  skipIntroLine,
  stepIntro,
} from '../src/sim/intro';
import { isPoliceEnabledForCurrentGameState } from '../src/sim/police';
import { addStreetSites } from '../src/world/cityStreetSites';
import { addCircuitGate } from '../src/world/cityCircuitGate';
import { createCityWorld } from '../src/world/cityWorld';

/**
 * The first-time introduction (`src/sim/intro.ts`): the start and the meet are on the city's
 * ground and clear of its columns, the stages advance on what the player does and not on a
 * clock, the assists arrive once, any electric car counts, nothing else may start while it
 * runs, the clip holds the car at the meet, and both ways out — finishing and skipping — clean
 * up once and are remembered.
 */

const DT = 1 / 60;

/** A fresh city with the intro installed, exactly as `src/game.ts` builds it. */
function rig() {
  const world = addStreetSites(addCircuitGate(createCityWorld()));
  const layout = world.layout;
  installIntroMeetup(layout, INTRO);
  layout.playerSpawn = { ...INTRO.route.start };
  const state = createInitialGameState(layout, 'auto', { police: true, intro: true });
  const cmd: PlayerCommand = createPlayerCommand();
  const intro = state.intro!;
  /** Step the whole simulation `ticks` times and collect every event raised. */
  const tick = (ticks = 1): GameEvent[] => {
    const seen: GameEvent[] = [];
    for (let i = 0; i < ticks; i++) {
      stepGame(state, cmd, layout, DT);
      seen.push(...state.events);
    }
    return seen;
  };
  /** Step the intro's rules alone, with events the rest of the tick supposedly raised. */
  const tickIntro = (ticks = 1, before: (events: GameEvent[]) => void = () => {}): GameEvent[] => {
    const seen: GameEvent[] = [];
    for (let i = 0; i < ticks; i++) {
      state.events.length = 0;
      before(state.events);
      stepIntro(intro, INTRO, state, DT, state.events);
      seen.push(...state.events);
    }
    return seen;
  };
  const put = (x: number, z: number): void => {
    state.vehicle.x = state.vehicle.prevX = x;
    state.vehicle.z = state.vehicle.prevZ = z;
    state.vehicle.vx = state.vehicle.vz = state.vehicle.speed = 0;
  };
  return { world, layout, state, intro, cmd, tick, tickIntro, put };
}

const types = (events: GameEvent[]): string[] => events.map((e) => e.type);
const seconds = (s: number): number => Math.ceil(s / DT) + 1;

/** Ticks until the phone has connected: the opening ended, the delay, the ring. */
function connect(r: ReturnType<typeof rig>): GameEvent[] {
  finishIntroOpening(r.intro);
  return r.tick(seconds(INTRO.call.delaySeconds + INTRO.call.ringSeconds) + 2);
}

/** Let every queued line play out, at the subtitle timing. */
function drain(r: ReturnType<typeof rig>): GameEvent[] {
  const seen: GameEvent[] = [];
  for (let guard = 0; guard < 60 * 180; guard++) {
    const i = r.intro;
    if (!i.active || (i.queue.length === 0 && !i.lineId && i.gapLeft <= 0)) break;
    seen.push(...r.tick());
  }
  return seen;
}

/** Straight to the drift stage: the road driven that asks for it. */
function askDrift(r: ReturnType<typeof rig>): void {
  connect(r);
  r.intro.odometer = INTRO.route.driftAskedAtMetres;
  r.tick(1);
  expect(r.intro.stage).toBe('drift');
}

/** Straight past the drift, by the assist. */
function passDrift(r: ReturnType<typeof rig>): void {
  askDrift(r);
  r.intro.assistOffered = true;
  acceptIntroAssist(r.intro);
  r.tickIntro(1);
  expect(r.intro.stage).toBe('disableEV');
}

/** A kill of an ordinary electric car, as the beam raises it. */
function kill(r: ReturnType<typeof rig>, id = 0): void {
  const t = r.state.targets[id];
  r.tickIntro(1, (events) => {
    t.status = 'destroyed';
    events.push({ type: 'targetDestroyed', targetId: t.id, x: t.x, y: 0, z: t.z, reward: 0, distance: 30 });
  });
}

describe('the places', () => {
  it('starts on a road and meets under the deck, on level drivable ground', () => {
    const { world, layout } = rig();
    const { plan } = world;
    const s = INTRO.route.start;
    expect(plan.isRoad(s.x, s.z, 0)).toBe(true);
    const m = INTRO.route.meetup;
    const out = { y: 0, gx: 0, gz: 0 };
    for (const [ox, oz] of [
      [0, 0],
      [m.radius * 0.5, 0],
      [-m.radius * 0.5, 0],
      [0, m.radius * 0.6],
      [0, -m.radius * 0.6],
    ]) {
      expect(plan.isRoad(m.x + ox, m.z + oz), `(${m.x + ox}, ${m.z + oz}) is not drivable`).toBe(true);
      expect(plan.isSolid(m.x + ox, m.z + oz), `(${m.x + ox}, ${m.z + oz}) is inside something`).toBe(false);
      layout.surface!.sample(m.x + ox, m.z + oz, 0, out);
      expect(out.y).toBeLessThan(0.5);
    }
    // Under the deck: an elevated ribbon runs over it.
    expect(plan.ribbons.some((rb) => rb.elevated && rb.path.samples.some((p) => Math.hypot(p.x - m.x, p.z - m.z) < p.halfWidth))).toBe(true);
  });

  it('parks the cars and stands BadKala clear of the columns, and makes the cars solid', () => {
    const { world, layout } = rig();
    const { plan } = world;
    const h = INTRO.meetup.carHalf;
    const columns = layout.colliders.filter((c) => c.tag !== 'intro-car' && (c.minY ?? 0) <= 1);
    for (const car of INTRO.meetup.cars) {
      expect(car.heading === 0 || car.heading === Math.PI).toBe(true);
      for (const [sx, sz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
        [0, 0],
      ]) {
        const x = car.x + sx * h.x;
        const z = car.z + sz * h.z;
        expect(plan.isRoad(x, z, 0), `car corner (${x}, ${z}) off the ground`).toBe(true);
        expect(plan.isSolid(x, z), `car corner (${x}, ${z}) inside something`).toBe(false);
      }
      for (const c of columns) {
        const overlap = car.x + h.x > c.minX && car.x - h.x < c.maxX && car.z + h.z > c.minZ && car.z - h.z < c.maxZ;
        expect(overlap, `car at (${car.x}, ${car.z}) inside ${c.tag}`).toBe(false);
      }
    }
    const parked = layout.colliders.filter((c) => c.tag === 'intro-car');
    expect(parked).toHaveLength(INTRO.meetup.cars.length);
    const bk = INTRO.meetup.badkala;
    expect(plan.isRoad(bk.x, bk.z, 0)).toBe(true);
    expect(plan.isSolid(bk.x, bk.z, 0.4)).toBe(false);
    for (const c of layout.colliders) {
      if ((c.minY ?? 0) > 1) continue;
      const inside = bk.x > c.minX - 0.4 && bk.x < c.maxX + 0.4 && bk.z > c.minZ - 0.4 && bk.z < c.maxZ + 0.4;
      expect(inside, `BadKala inside ${c.tag}`).toBe(false);
    }
  });

  it('names every line a trigger refers to, with a sane subtitle timing', () => {
    for (const id of ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'b4', 'c1', 'c2', 'c3', 'c-hint', 'd1', 'd2', 'd3', 'd4', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']) {
      const l = introLine(INTRO, id);
      const s = introLineSeconds(INTRO, l);
      expect(s).toBeGreaterThanOrEqual(INTRO.timing.minSeconds);
      expect(s).toBeLessThanOrEqual(INTRO.timing.maxSeconds);
    }
    expect(() => introLine(INTRO, 'nope')).toThrow();
  });
});

describe('the opening and the call', () => {
  it('holds the car until the opening is over, then rings and connects on its own', () => {
    const r = rig();
    expect(r.intro.stage).toBe('opening');
    expect(introHoldsPlayer(r.intro)).toBe(true);
    r.cmd.throttle = 1;
    r.tick(60);
    expect(Math.abs(r.state.vehicle.speed)).toBeLessThan(0.01);
    r.cmd.throttle = 0;

    finishIntroOpening(r.intro);
    r.tick(1);
    expect(r.intro.stage).toBe('incomingCall');
    expect(introHoldsPlayer(r.intro)).toBe(false);
    const before = r.tick(seconds(INTRO.call.delaySeconds) - 5);
    expect(types(before)).not.toContain('introCall');
    const ring = r.tick(10);
    expect(ring.find((e) => e.type === 'introCall' && e.phase === 'ringing')).toBeTruthy();
    const connected = r.tick(seconds(INTRO.call.ringSeconds) + 2);
    expect(connected.find((e) => e.type === 'introCall' && e.phase === 'connected')).toBeTruthy();
    expect(r.intro.stage).toBe('approach');
    expect(r.intro.callConnected).toBe(true);
    // No place to go yet: the objective is a thing to do, not a point.
    expect(r.intro.objective).toBe('approach');
    expect(r.intro.objectiveRadius).toBe(0);
  });

  it('says the first lines one at a time, never two at once', () => {
    const r = rig();
    const opening = connect(r);
    const said: string[] = [];
    let overlapping = 0;
    for (let i = -1; i < 60 * 60 && said.length < 3; i++) {
      const events = i < 0 ? opening : r.tick();
      for (const e of events) if (e.type === 'introLine') said.push(e.id);
      if (events.filter((e) => e.type === 'introLine').length > 1) overlapping++;
    }
    expect(said).toEqual(['a1', 'a2', 'a3']);
    expect(overlapping).toBe(0);
  });
});

describe('the stages', () => {
  it('paces the lore by the road driven and asks for the drift after enough of it', () => {
    const r = rig();
    connect(r);
    r.state.vehicle.speed = 10;
    const lines: string[] = [];
    for (let i = 0; i < 60 * 30 && r.intro.stage === 'approach'; i++) {
      for (const e of r.tickIntro()) if (e.type === 'introLine') lines.push(e.id);
    }
    expect(r.intro.stage).toBe('drift');
    expect(r.intro.odometer).toBeGreaterThanOrEqual(INTRO.route.driftAskedAtMetres);
    expect(r.intro.said.has('b1')).toBe(true);
    expect(r.intro.said.has('b2')).toBe(true);
    expect([...r.intro.queue, ...lines]).toEqual(expect.arrayContaining(['b3', 'c1']));
    expect(r.intro.objective).toBe('drift');
    expect(r.intro.objectiveRadius).toBe(0);
  });

  it('a slide before she asks counts, and the instruction is never said', () => {
    const r = rig();
    connect(r);
    r.state.drift.active = true;
    r.state.drift.duration = INTRO.drift.seconds + 0.01;
    r.state.drift.chargeRate = 8;
    r.tickIntro(2);
    expect(r.intro.driftDone).toBe(true);
    expect(r.intro.stage).toBe('disableEV');
    r.state.drift.active = false;
    const lines = drain(r).filter((e) => e.type === 'introLine').map((e) => (e as { id: string }).id);
    expect(lines).not.toContain('c1');
    expect(lines).toEqual(expect.arrayContaining(['b3', 'c2', 'd1', 'd2']));
  });

  it('counts a brief real drift and tops the meter up once', () => {
    const r = rig();
    askDrift(r);
    r.state.drift.active = true;
    r.state.drift.duration = INTRO.drift.seconds + 0.01;
    r.state.drift.chargeRate = 8;
    r.state.lightning.charge = 3;
    const events = r.tickIntro(1);
    expect(r.intro.driftDone).toBe(true);
    expect(r.intro.driftAssisted).toBe(false);
    expect(r.state.lightning.charge).toBe(INTRO.drift.chargeBonus);
    expect(r.intro.stage).toBe('disableEV');
    expect(r.intro.objective).toBe('disable');
    expect(types(events)).toContain('introStage');
    expect(r.intro.said.has('c2')).toBe(true);
    // The nitro is mentioned once the slide is behind us, on the way to the shot.
    expect(r.intro.said.has('c3')).toBe(true);
  });

  it('skipping the drift instruction does not complete the drift', () => {
    const r = rig();
    askDrift(r);
    for (let i = 0; i < 60 * 90 && r.intro.lineId !== 'c1'; i++) r.tick();
    expect(r.intro.lineId).toBe('c1');
    skipIntroLine(r.intro);
    r.tick(1);
    expect(r.intro.lineId).toBe('');
    expect(r.intro.driftDone).toBe(false);
    expect(r.intro.stage).toBe('drift');
  });

  it('offers the hint once, then CONTINUAR, and the assist counts as done without the praise', () => {
    const r = rig();
    askDrift(r);
    // The lore and the instruction on the way in are not time spent struggling.
    drain(r);
    expect(r.intro.struggleTime).toBeLessThan(1);
    expect(r.intro.hintGiven).toBe(false);
    r.tick(seconds(INTRO.drift.hintAfterSeconds) + 2);
    expect(r.intro.hintGiven).toBe(true);
    expect(r.intro.said.has('c-hint')).toBe(true);
    expect(r.intro.assistOffered).toBe(false);
    r.tick(seconds(INTRO.drift.assistAfterSeconds - INTRO.drift.hintAfterSeconds) + 2);
    expect(r.intro.assistOffered).toBe(true);
    acceptIntroAssist(r.intro);
    r.tick(1);
    expect(r.intro.driftDone).toBe(true);
    expect(r.intro.driftAssisted).toBe(true);
    expect(r.intro.assistOffered).toBe(false);
    expect(r.state.lightning.charge).toBeGreaterThanOrEqual(INTRO.drift.chargeBonus);
    expect(r.intro.said.has('c2')).toBe(false);
    // ...but the nitro is still mentioned: the assist skips the praise, not the lesson.
    expect(r.intro.said.has('c3')).toBe(true);
    expect(r.intro.stage).toBe('disableEV');
  });

  it('any electric car counts, once, and a dry meter is topped up', () => {
    const r = rig();
    passDrift(r);
    // The meter run dry: topped up after the beat, with a note, not a restart.
    r.state.lightning.charge = 0;
    const note = r.tickIntro(seconds(INTRO.ev.rechargeAfterSeconds) + 1);
    expect(types(note)).toContain('introNote');
    expect(r.state.lightning.charge).toBeGreaterThanOrEqual(INTRO.drift.chargeBonus);
    expect(r.intro.rechargeAssists).toBe(1);

    // Any street car shot: the shutdown lines, and no point to drive to while she talks.
    kill(r, 3);
    expect(r.intro.evDone).toBe(true);
    expect(r.intro.stage).toBe('arrival');
    expect(r.intro.objective).toBe(null);
    expect(r.intro.objectiveRadius).toBe(0);
    expect(r.intro.said.has('d3')).toBe(true);
    expect(r.intro.said.has('d4')).toBe(true);
    // The pin goes up only once the last of them has been said and the silence after it is over.
    for (let i = 0; i < 60 * 150 && r.intro.objective === null; i++) {
      r.tick();
      if (r.intro.lineId) expect(r.intro.objective).toBe(null);
    }
    expect(r.intro.said.has('e1')).toBe(true);
    expect(r.intro.objective).toBe('arrival');
    expect(r.intro.objectiveX).toBe(INTRO.route.meetup.x);
    expect(r.intro.objectiveRadius).toBe(INTRO.route.meetup.radius);
    // A second kill changes nothing.
    const stage = r.intro.stage;
    kill(r, 4);
    expect(r.intro.stage).toBe(stage);
  });

  it('holds the car for the clip at the meet, then talks, then ends once', () => {
    const r = rig();
    passDrift(r);
    kill(r);
    expect(r.intro.stage).toBe('arrival');
    for (let i = 0; i < 60 * 150 && r.intro.lineId !== 'e1'; i++) r.tick();
    expect(r.intro.lineId).toBe('e1');
    const m = INTRO.route.meetup;
    r.put(m.x, m.z);
    const arrive = r.tick(1);
    expect(r.intro.arrivalDone).toBe(true);
    expect(r.intro.stage).toBe('meetup');
    expect(r.intro.objective).toBe(null);
    // Whatever she was saying is cut for the picture, and the car waits.
    expect(types(arrive)).toContain('introLineEnd');
    expect(arrive.find((e) => e.type === 'introStage' && e.stage === 'meetup')).toBeTruthy();
    expect(introHoldsPlayer(r.intro)).toBe(true);
    r.cmd.throttle = 1;
    r.tick(60);
    expect(Math.abs(r.state.vehicle.speed)).toBeLessThan(0.01);
    r.cmd.throttle = 0;
    expect(types(r.tick(60))).not.toContain('introLine');

    finishIntroCinematic(r.intro);
    const released = r.tick(1);
    expect(introHoldsPlayer(r.intro)).toBe(false);
    const events = [...released, ...drain(r)];
    const lines = events.filter((e) => e.type === 'introLine').map((e) => (e as { id: string }).id);
    expect(lines).toEqual(['e2', 'e3', 'e4', 'e5', 'e6', 'e7']);
    const tail = r.tick(seconds(introLine(INTRO, 'e7').gap ?? INTRO.timing.gap) + 3);
    const all = [...events, ...tail];
    expect(all.filter((e) => e.type === 'introDone')).toHaveLength(1);
    expect(all.find((e) => e.type === 'introDone')).toEqual({ type: 'introDone', reason: 'completed' });
    expect(all.filter((e) => e.type === 'introCall' && e.phase === 'ended')).toHaveLength(1);
    expect(r.intro.done).toBe('completed');
    expect(r.intro.active).toBe(false);
    expect(types(r.tick(30))).not.toContain('introDone');
    // A restart afterwards is an ordinary restart: the intro stays finished.
    r.cmd.restart = true;
    r.tick(1);
    r.cmd.restart = false;
    expect(r.intro.done).toBe('completed');
    expect(r.intro.active).toBe(false);
  });
});

describe('isolation and the ways out', () => {
  it('has the car: police off, every other activity locked, until it ends', () => {
    const r = rig();
    expect(engagedActivity(r.state)).toBe('intro');
    expect(isPoliceEnabledForCurrentGameState(r.state)).toBe(false);
    lockOtherActivities(r.state);
    expect(r.state.rush!.locked).toBe(true);
    expect(r.state.passenger!.locked).toBe(true);
    expect(r.state.circuitGate!.locked).toBe(true);
    expect(r.state.streetGate!.locked).toBe(true);
    expect(r.state.buho!.locked).toBe(true);
    connect(r);
    r.tick(60 * 5);
    expect(r.state.police!.units.every((u) => u.status !== 'active')).toBe(true);
    expect(r.state.passenger!.phase).toBe('idle');

    skipIntro(r.intro);
    r.tick(1);
    expect(engagedActivity(r.state)).toBe(null);
    expect(isPoliceEnabledForCurrentGameState(r.state)).toBe(true);
    lockOtherActivities(r.state);
    expect(r.state.rush!.locked).toBe(false);
    expect(r.state.passenger!.locked).toBe(false);
  });

  it('skips cleanly from any point: no line, no objective, one done event', () => {
    const r = rig();
    connect(r);
    r.tick(60);
    expect(r.intro.lineId).not.toBe('');
    skipIntro(r.intro);
    const events = r.tick(1);
    expect(r.intro.done).toBe('skipped');
    expect(r.intro.active).toBe(false);
    expect(r.intro.stage).toBe('complete');
    expect(r.intro.lineId).toBe('');
    expect(r.intro.queue).toHaveLength(0);
    expect(r.intro.objective).toBe(null);
    expect(types(events)).toContain('introLineEnd');
    expect(types(events)).toContain('introDone');
    expect(events.filter((e) => e.type === 'introDone')).toHaveLength(1);
    expect(types(r.tick(120))).not.toContain('introLine');
    // A restart after the skip keeps the intro skipped.
    resetGameState(r.state, r.layout);
    expect(r.intro.done).toBe('skipped');
    expect(r.intro.active).toBe(false);
  });

  it('skipping during the clip releases the car', () => {
    const r = rig();
    passDrift(r);
    kill(r);
    r.put(INTRO.route.meetup.x, INTRO.route.meetup.z);
    r.tick(1);
    expect(introHoldsPlayer(r.intro)).toBe(true);
    skipIntro(r.intro);
    r.tick(1);
    expect(r.intro.done).toBe('skipped');
    expect(introHoldsPlayer(r.intro)).toBe(false);
  });

  it('a restart mid-intro goes back to the incoming call without replaying the opening', () => {
    const r = rig();
    askDrift(r);
    resetIntroState(r.intro);
    expect(r.intro.stage).toBe('incomingCall');
    expect(r.intro.openingDone).toBe(true);
    expect(r.intro.cinematicDone).toBe(false);
    expect(r.intro.approachDone).toBe(false);
    expect(r.intro.said.size).toBe(0);
    expect(r.intro.lineId).toBe('');
  });
});

describe('persistence', () => {
  function installStorage(seed: Record<string, string> = {}): Map<string, string> {
    const store = new Map<string, string>(Object.entries(seed));
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    };
    return store;
  }

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('reads as unseen with no storage, remembers both endings, and forgets an older version', () => {
    expect(readIntroProgress().status).toBe(null);
    writeIntroProgress('completed');
    expect(readIntroProgress().status).toBe(null);

    const store = installStorage();
    expect(readIntroProgress().status).toBe(null);
    writeIntroProgress('completed');
    expect(readIntroProgress().status).toBe('completed');
    writeIntroProgress('skipped');
    expect(readIntroProgress().status).toBe('skipped');
    expect(JSON.parse(store.get(INTRO.persistence.key)!).version).toBe(INTRO.persistence.version);

    store.set(INTRO.persistence.key, JSON.stringify({ version: INTRO.persistence.version - 1, status: 'completed' }));
    expect(readIntroProgress().status).toBe(null);
    store.set(INTRO.persistence.key, '{not json');
    expect(readIntroProgress().status).toBe(null);

    writeIntroProgress('completed');
    clearIntroProgress();
    expect(readIntroProgress().status).toBe(null);
  });
});
