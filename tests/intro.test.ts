import { afterEach, describe, expect, it } from 'vitest';
import { INTRO, introLine, introLineSeconds } from '../src/content/intro';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { clearIntroProgress, readIntroProgress, writeIntroProgress } from '../src/core/progress';
import type { ArenaLayout, GameEvent, PlayerCommand } from '../src/core/types';
import { VEHICLE } from '../src/config/tuning';
import { inRect } from '../src/world/cityPlan';
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
import { createOpenWorld } from '../src/world/openWorld';

/**
 * The first-time introduction (`src/sim/intro.ts`): the start and the meet are on the city's
 * ground and clear of its columns, the stages advance on what the player does and not on a
 * clock, the assists arrive once, any electric car counts, nothing else may start while it
 * runs, the clip holds the car at the meet, and both ways out — finishing and skipping — clean
 * up once and are remembered.
 */

const DT = 1 / 60;

/** The tag of whatever solid at ground level comes within `r` of (x, z), or null. `skip` leaves one tag out. */
function blocked(layout: ArenaLayout, x: number, z: number, r: number, skip?: string): string | null {
  for (const b of layout.colliders) {
    if ((b.minY ?? 0) > 1 || b.tag === skip) continue;
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    if (Math.hypot(dx, dz) < r) return b.tag ?? 'box';
  }
  for (const w of layout.walls) {
    if ((w.minY ?? 0) > 1 || w.tag === skip) continue;
    const ex = w.bx - w.ax;
    const ez = w.bz - w.az;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - w.ax) * ex + (z - w.az) * ez) / len2)) : 0;
    if (Math.hypot(w.ax + ex * t - x, w.az + ez * t - z) < r) return w.tag ?? 'wall';
  }
  return null;
}

/** A fresh open world with the intro installed, exactly as `src/game.ts` builds it. */
function rig() {
  const world = createOpenWorld();
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

/** Play on until she has asked for `id` (the line that asks sets the objective). */
function untilObjective(r: ReturnType<typeof rig>, id: string): void {
  for (let i = 0; i < 60 * 180 && r.intro.objective !== id; i++) r.tick();
  expect(r.intro.objective).toBe(id);
}

/** Straight past the drift, by automation's assist. */
function passDrift(r: ReturnType<typeof rig>): void {
  askDrift(r);
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
  it('starts on a road and meets on the car meet\'s lot, on level drivable ground', () => {
    const { world, layout } = rig();
    const { plan } = world;
    const lot = plan.meets![0].lot;
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
      expect(inRect(lot, m.x + ox, m.z + oz, -1), `(${m.x + ox}, ${m.z + oz}) is not on the lot`).toBe(true);
      expect(plan.isSolid(m.x + ox, m.z + oz), `(${m.x + ox}, ${m.z + oz}) is inside something`).toBe(false);
      layout.surface!.sample(m.x + ox, m.z + oz, 0, out);
      expect(out.y).toBeLessThan(0.5);
    }
    // Nothing of the meet's own stands in the circle, and the way in from the avenue is open:
    // straight east from av-w1 through the west gate to the circle's middle.
    for (let x = -620; x <= m.x; x += 0.5) {
      expect(blocked(layout, x, m.z, VEHICLE.collisionRadius), `blocked at (${x}, ${m.z})`).toBeNull();
    }
  });

  it('parks the cars and stands BadKala clear of the columns, and makes the cars solid', () => {
    const { world, layout } = rig();
    const { plan } = world;
    const h = INTRO.meetup.carHalf;
    const lot = plan.meets![0].lot;
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
        expect(inRect(lot, x, z, -1), `car corner (${x}, ${z}) off the lot`).toBe(true);
        expect(plan.isSolid(x, z), `car corner (${x}, ${z}) inside something`).toBe(false);
      }
      // Clear of the lot's own cars and props, which are walls where they stand at an angle.
      expect(blocked(layout, car.x, car.z, Math.hypot(h.x, h.z) + 0.3, 'intro-car'), `car at (${car.x}, ${car.z})`).toBeNull();
      for (const c of columns) {
        const overlap = car.x + h.x > c.minX && car.x - h.x < c.maxX && car.z + h.z > c.minZ && car.z - h.z < c.maxZ;
        expect(overlap, `car at (${car.x}, ${car.z}) inside ${c.tag}`).toBe(false);
      }
    }
    const parked = layout.colliders.filter((c) => c.tag === 'intro-car');
    expect(parked).toHaveLength(INTRO.meetup.cars.length);
    const bk = INTRO.meetup.badkala;
    expect(inRect(lot, bk.x, bk.z, -1)).toBe(true);
    expect(blocked(layout, bk.x, bk.z, 0.4)).toBeNull();
    expect(plan.isSolid(bk.x, bk.z, 0.4)).toBe(false);
    for (const c of layout.colliders) {
      if ((c.minY ?? 0) > 1) continue;
      const inside = bk.x > c.minX - 0.4 && bk.x < c.maxX + 0.4 && bk.z > c.minZ - 0.4 && bk.z < c.maxZ + 0.4;
      expect(inside, `BadKala inside ${c.tag}`).toBe(false);
    }
  });

  it('names every line a trigger refers to, with a sane subtitle timing', () => {
    for (const id of ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'b4', 'c1', 'c2', 'c3', 'c-hint', 'd1', 'd2', 'd3', 'd4', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e6b', 'e7']) {
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
    // Nothing asked for until she says to drive; then a thing to do, not a point.
    expect(r.intro.objective).toBe(null);
    untilObjective(r, 'approach');
    expect(r.intro.lineId).toBe('a3');
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
    // The drift card waits for her to ask for it.
    expect(r.intro.objective).not.toBe('drift');
    untilObjective(r, 'drift');
    expect(r.intro.lineId).toBe('c1');
    expect(r.intro.objectiveRadius).toBe(0);
  });

  it('a slide before she asks for it counts for nothing', () => {
    const r = rig();
    connect(r);
    const slide = (on: boolean): void => {
      r.state.drift.active = on;
      r.state.drift.duration = on ? INTRO.drift.seconds + 0.01 : 0;
      r.state.drift.chargeRate = on ? 8 : 0;
    };
    // On the approach...
    slide(true);
    r.tickIntro(30);
    expect(r.intro.stage).toBe('approach');
    expect(r.intro.driftDone).toBe(false);
    // ...and in the drift stage while she is still on the lore before the instruction.
    r.intro.odometer = INTRO.route.driftAskedAtMetres;
    r.tickIntro(2);
    expect(r.intro.stage).toBe('drift');
    expect(r.intro.objective).not.toBe('drift');
    expect(r.intro.driftDone).toBe(false);
    slide(false);
    untilObjective(r, 'drift');
    slide(true);
    r.tickIntro(1);
    expect(r.intro.driftDone).toBe(true);
    expect(r.intro.stage).toBe('disableEV');
  });

  it('counts a brief real drift and tops the meter up once', () => {
    const r = rig();
    askDrift(r);
    untilObjective(r, 'drift');
    r.state.drift.active = true;
    r.state.drift.duration = INTRO.drift.seconds + 0.01;
    r.state.drift.chargeRate = 8;
    r.state.lightning.charge = 3;
    const events = r.tickIntro(1);
    expect(r.intro.driftDone).toBe(true);
    expect(r.intro.driftAssisted).toBe(false);
    expect(r.state.lightning.charge).toBe(INTRO.drift.chargeBonus);
    expect(r.intro.stage).toBe('disableEV');
    // The shot is not asked for while she praises the slide.
    expect(r.intro.objective).toBe(null);
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

  it('gives the hint once and never lets the player past the drift without one', () => {
    const r = rig();
    askDrift(r);
    // The lore and the instruction on the way in are not time spent struggling.
    drain(r);
    expect(r.intro.struggleTime).toBeLessThan(1);
    expect(r.intro.hintGiven).toBe(false);
    r.tick(seconds(INTRO.drift.hintAfterSeconds) + 2);
    expect(r.intro.hintGiven).toBe(true);
    expect(r.intro.said.has('c-hint')).toBe(true);
    // A long time later: still the drift, nothing about the shot said, no kill counted.
    r.tick(seconds(90));
    expect(r.intro.stage).toBe('drift');
    expect(r.intro.said.has('d1')).toBe(false);
    kill(r, 2);
    expect(r.intro.evDone).toBe(false);
    expect(r.intro.stage).toBe('drift');
  });

  it("automation's assist counts as done without the praise", () => {
    const r = rig();
    askDrift(r);
    drain(r);
    acceptIntroAssist(r.intro);
    r.tick(1);
    expect(r.intro.driftDone).toBe(true);
    expect(r.intro.driftAssisted).toBe(true);
    expect(r.state.lightning.charge).toBeGreaterThanOrEqual(INTRO.drift.chargeBonus);
    expect(r.intro.said.has('c2')).toBe(false);
    // ...but the nitro is still mentioned: the assist skips the praise, not the lesson.
    expect(r.intro.said.has('c3')).toBe(true);
    expect(r.intro.stage).toBe('disableEV');
  });

  it('any electric car counts, once, and a dry meter is topped up', () => {
    const r = rig();
    passDrift(r);
    // A car shot before she asks for it counts for nothing.
    kill(r, 2);
    expect(r.intro.evDone).toBe(false);
    untilObjective(r, 'disable');
    expect(r.intro.lineId).toBe('d1');
    // The meter run dry: topped up after the beat, with a note, not a restart.
    r.state.lightning.charge = 0;
    const note = r.tickIntro(seconds(INTRO.ev.rechargeAfterSeconds) + 1);
    expect(types(note)).toContain('introNote');
    expect(r.state.lightning.charge).toBeGreaterThanOrEqual(INTRO.drift.chargeBonus);
    expect(r.intro.rechargeAssists).toBe(1);

    // Any street car shot: the shutdown lines, and the pin when she says she has marked it.
    kill(r, 3);
    expect(r.intro.evDone).toBe(true);
    expect(r.intro.stage).toBe('arrival');
    expect(r.intro.said.has('d3')).toBe(true);
    expect(r.intro.said.has('d4')).toBe(true);
    expect(r.intro.objective).toBe(null);
    // Driving into the meet before the pin is up is not the arrival.
    r.put(INTRO.route.meetup.x, INTRO.route.meetup.z);
    r.tickIntro(1);
    expect(r.intro.stage).toBe('arrival');
    const s = INTRO.route.start;
    r.put(s.x, s.z);
    untilObjective(r, 'arrival');
    expect(r.intro.lineId).toBe('e1');
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
    untilObjective(r, 'disable');
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
    expect(lines).toEqual(['e2', 'e3', 'e4', 'e5', 'e6', 'e6b', 'e7']);
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
    untilObjective(r, 'disable');
    kill(r);
    untilObjective(r, 'arrival');
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
