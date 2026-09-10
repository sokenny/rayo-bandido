import { describe, expect, it } from 'vitest';
import { POLICE } from '../src/config/tuning';
import { createPlayerCommand } from '../src/core/input/keyboard';
import type { ArenaLayout, GameEvent, PoliceState, VehicleState } from '../src/core/types';
import { applyPoliceFine } from '../src/sim/economy';
import { createEconomyState, createInitialGameState, createLightningState, createVehicleState, stepGame } from '../src/sim/gameState';
import {
  chasersAllowed,
  createPoliceState,
  fineForStars,
  heatForDistance,
  isPoliceEnabledForCurrentGameState,
  offenseCategory,
  starsForHeat,
  stepPolice,
  type StepPoliceOptions,
} from '../src/sim/police';
import { createCityWorld } from '../src/world/cityWorld';
import { addCircuitGate } from '../src/world/cityCircuitGate';
import { createCircuitWorld } from '../src/world/circuitWorld';

/**
 * The police (`src/sim/police.ts`): the wanted heat, the stars, the pursuit's start, escape
 * and arrest, and — above all — that none of it exists outside Free Roam.
 */

const DT = 1 / 60;
const { layout } = addCircuitGate(createCityWorld());
const ON: StepPoliceOptions = { enabled: true, shoveTraffic: true };

function rig(): { p: PoliceState; v: VehicleState; events: GameEvent[]; time: { t: number } } {
  const p = createPoliceState(layout);
  const s = layout.playerSpawn;
  const v = createVehicleState(s.x, s.z, s.heading, s.y ?? 0);
  return { p, v, events: [], time: { t: 0 } };
}

function tick(r: ReturnType<typeof rig>, ticks = 1, before: (events: GameEvent[]) => void = () => {}): GameEvent[] {
  const seen: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    r.events.length = 0;
    before(r.events);
    r.time.t += DT;
    stepPolice(r.p, layout, r.v, [], createLightningState(), r.time.t, DT, r.events, ON);
    seen.push(...r.events);
  }
  return seen;
}

/** A kill `distance` metres down the player's nose (heading 0 looks toward -Z). */
function offense(events: GameEvent[], distance: number, v: VehicleState): void {
  events.push({ type: 'targetDestroyed', targetId: 0, x: v.x, y: v.y, z: v.z - distance, reward: 0, distance });
}

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

describe('police eligibility', () => {
  it('exists only in a world built with police, in Free Roam', () => {
    const plain = createInitialGameState(layout);
    expect(plain.police).toBeNull();
    expect(isPoliceEnabledForCurrentGameState(plain)).toBe(false);

    const city = createInitialGameState(layout, 'auto', { police: true });
    expect(city.police).not.toBeNull();
    expect(isPoliceEnabledForCurrentGameState(city)).toBe(true);
  });

  it('is off during a RAYO RUSH run, a fare, and the circuit door', () => {
    const city = createInitialGameState(layout, 'auto', { police: true });
    city.rush!.phase = 'countdown';
    expect(isPoliceEnabledForCurrentGameState(city)).toBe(false);
    city.rush!.phase = 'results';
    expect(isPoliceEnabledForCurrentGameState(city)).toBe(false);
    city.rush!.phase = 'idle';
    expect(isPoliceEnabledForCurrentGameState(city)).toBe(true);

    city.passenger!.phase = 'riding';
    expect(isPoliceEnabledForCurrentGameState(city)).toBe(false);
    city.passenger!.phase = 'offered';
    expect(isPoliceEnabledForCurrentGameState(city)).toBe(true);

    city.circuitGate!.entering = true;
    expect(isPoliceEnabledForCurrentGameState(city)).toBe(false);
  });

  it('is off on any race, whatever the options say', () => {
    const circuit = createInitialGameState(createCircuitWorld(1).layout, 'auto', { police: true, timeAttack: true });
    expect(isPoliceEnabledForCurrentGameState(circuit)).toBe(false);
    circuit.race!.phase = 'racing';
    expect(isPoliceEnabledForCurrentGameState(circuit)).toBe(false);
    circuit.race!.phase = 'finished';
    expect(isPoliceEnabledForCurrentGameState(circuit)).toBe(false);
  });

  it('clears every car, the heat and the stars on the tick an activity begins', () => {
    const state = createInitialGameState(layout, 'auto', { police: true });
    const cmd = createPlayerCommand();
    const p = state.police!;
    // A live situation: heat, a star, a chaser on the road.
    stepGame(state, cmd, layout, DT);
    p.heat = 60;
    const u = p.units[0];
    u.status = 'active';
    u.role = 'pursuit';
    u.lights = true;
    stepGame(state, cmd, layout, DT);
    expect(p.stars).toBe(2);
    expect(p.phase).toBe('pursuit');

    state.rush!.phase = 'countdown';
    state.rush!.countdown = 3;
    stepGame(state, cmd, layout, DT);
    expect(types(state.events)).toContain('policeCleared');
    expect(types(state.events)).toContain('pursuitEnd');
    expect(p.heat).toBe(0);
    expect(p.stars).toBe(0);
    expect(p.phase).toBe('calm');
    expect(p.units.every((unit) => unit.status === 'disabled' && !unit.lights)).toBe(true);

    // Nothing comes back while it is on, and nothing spawns on the player the moment it ends.
    for (let i = 0; i < 60; i++) stepGame(state, cmd, layout, DT);
    expect(p.units.every((unit) => unit.status === 'disabled')).toBe(true);
    state.rush!.phase = 'idle';
    for (let i = 0; i < 60; i++) stepGame(state, cmd, layout, DT);
    expect(p.units.every((unit) => unit.status === 'disabled')).toBe(true);
    expect(p.enabledFor).toBeLessThan(POLICE.resumeDelay);
  });
});

describe('wanted heat', () => {
  it('pays more heat for a close shot than a long one', () => {
    expect(offenseCategory(10)).toBe('close');
    expect(offenseCategory(40)).toBe('medium');
    expect(offenseCategory(70)).toBe('far');
    expect(heatForDistance(10)).toBe(POLICE.heat.close);
    expect(heatForDistance(40)).toBe(POLICE.heat.medium);
    expect(heatForDistance(70)).toBe(POLICE.heat.far);
    expect(heatForDistance(10)).toBeGreaterThan(heatForDistance(40));
    expect(heatForDistance(40)).toBeGreaterThan(heatForDistance(70));
  });

  it('lights the stars at the configured thresholds', () => {
    expect(starsForHeat(0)).toBe(0);
    expect(starsForHeat(POLICE.stars[0] - 1)).toBe(0);
    expect(starsForHeat(POLICE.stars[0])).toBe(1);
    expect(starsForHeat(POLICE.stars[1] - 1)).toBe(1);
    expect(starsForHeat(POLICE.stars[1])).toBe(2);
    expect(starsForHeat(POLICE.stars[2])).toBe(3);
    expect(starsForHeat(100)).toBe(3);
    expect(chasersAllowed(1)).toBe(1);
    expect(chasersAllowed(2)).toBe(POLICE.unitsByStars[2]);
    expect(chasersAllowed(3)).toBe(POLICE.unitsByStars[3]);
    expect(fineForStars(3)).toBe(POLICE.bust.fineByStars[3]);
  });

  it('accumulates over repeated offences, caps, and only decays once things go quiet', () => {
    const r = rig();
    let seen = tick(r, 1, (events) => offense(events, 10, r.v));
    expect(r.p.heat).toBe(POLICE.heat.close);
    expect(r.p.stars).toBe(1);
    expect(r.p.phase).toBe('alert');
    expect(types(seen)).toEqual(expect.arrayContaining(['policeOffense', 'wantedStars']));
    const first = seen.find((e) => e.type === 'policeOffense');
    expect(first && first.type === 'policeOffense' && first.category).toBe('close');
    expect(first && first.type === 'policeOffense' && first.witnessed).toBe(false);

    // Long shots: less heat each, and no decay yet — the delay has not run.
    seen = tick(r, 1, (events) => offense(events, 70, r.v));
    expect(r.p.heat).toBe(POLICE.heat.close + POLICE.heat.far);
    const heatBefore = r.p.heat;
    tick(r, Math.floor((POLICE.heat.decayDelay - 0.5) * 60));
    expect(r.p.heat).toBe(heatBefore);
    tick(r, 120);
    expect(r.p.heat).toBeLessThan(heatBefore);

    for (let i = 0; i < 10; i++) tick(r, 1, (events) => offense(events, 5, r.v));
    expect(r.p.heat).toBe(POLICE.heat.max);
    expect(r.p.stars).toBe(3);
  });

  it('keeps wanted state per player: one car\'s offences never heat another', () => {
    const a = rig();
    const b = rig();
    tick(a, 1, (events) => offense(events, 10, a.v));
    tick(b, 1);
    expect(a.p.heat).toBe(POLICE.heat.close);
    expect(b.p.heat).toBe(0);
    expect(b.p.stars).toBe(0);
  });
});

describe('pursuit', () => {
  it('starts at two stars with one chaser, grows to the cap at three, and never past it', () => {
    const r = rig();
    tick(r, 1, (events) => offense(events, 10, r.v));
    tick(r, 1, (events) => offense(events, 10, r.v));
    expect(r.p.stars).toBe(2);
    expect(r.p.phase).toBe('pursuit');
    const chasers = (): number => r.p.units.filter((u) => u.status === 'active' && u.role === 'pursuit').length;
    expect(chasers()).toBe(1);
    expect(r.p.units.find((u) => u.role === 'pursuit')!.lights).toBe(true);
    // One joins at a time: a couple of seconds on, still no more than the two-star allowance.
    tick(r, 120);
    expect(chasers()).toBe(POLICE.unitsByStars[2]);

    tick(r, 1, (events) => offense(events, 10, r.v));
    expect(r.p.stars).toBe(3);
    tick(r, 60 * 3);
    expect(chasers()).toBe(POLICE.unitsByStars[3]);
    expect(chasers()).toBeLessThanOrEqual(POLICE.maxUnits);
    // Heat does not drain mid-chase — and the chasers do find a car that sits where it is:
    // contact well inside the patience the pursuit is given. (Four seconds, not ten: a car that
    // keeps sitting there is arrested, which is the next spec's business.)
    const heat = r.p.heat;
    tick(r, 60);
    expect(r.p.heat).toBe(heat);
    expect(r.p.phase).toBe('pursuit');
    expect(r.p.contacted).toBe(true);
  });

  it('is started at once by a patrol that saw the offence, whatever the heat', () => {
    const r = rig();
    // A patrol 30 m ahead of the player, facing back at them, in the open.
    const u = r.p.units[0];
    u.status = 'active';
    u.role = 'patrol';
    u.loop = 0;
    u.x = r.v.x;
    u.z = r.v.z - 30;
    u.y = r.v.y;
    u.heading = Math.PI; // facing +Z, toward the player
    const seen = tick(r, 1, (events) => offense(events, 70, r.v));
    expect(types(seen)).toEqual(expect.arrayContaining(['policeWitness', 'policeOffense', 'pursuitStart']));
    expect(r.p.heat).toBe(POLICE.heat.far + POLICE.heat.witnessed);
    expect(r.p.stars).toBe(1);
    expect(r.p.phase).toBe('pursuit');
    expect(u.role).toBe('pursuit');
    expect(u.lights).toBe(true);
  });

  it('does not count a patrol that had its back to it', () => {
    const r = rig();
    const u = r.p.units[0];
    u.status = 'active';
    u.role = 'patrol';
    u.loop = 0;
    u.x = r.v.x;
    u.z = r.v.z + 30;
    u.y = r.v.y;
    u.heading = Math.PI; // facing +Z, away from the player behind it
    const seen = tick(r, 1, (events) => offense(events, 70, r.v));
    expect(types(seen)).not.toContain('policeWitness');
    expect(r.p.heat).toBe(POLICE.heat.far);
    expect(r.p.phase).toBe('calm');
    expect(u.role).toBe('patrol');
  });

  it('is escaped by staying out of sight: ESCAPING after the grace, over after the countdown', () => {
    const r = rig();
    tick(r, 1, (events) => offense(events, 10, r.v));
    tick(r, 1, (events) => offense(events, 10, r.v));
    expect(r.p.phase).toBe('pursuit');
    // The chaser has the car in view, then the car is gone: far outside the city, where no
    // car can be put near the player.
    const chaser = r.p.units.find((unit) => unit.status === 'active' && unit.role === 'pursuit')!;
    chaser.x = r.v.x + 6;
    chaser.z = r.v.z;
    chaser.y = r.v.y;
    tick(r, 8);
    expect(r.p.contacted).toBe(true);
    r.v.x = 5000;
    r.v.z = 5000;
    let seen = tick(r, Math.ceil(POLICE.pursuit.loseSightSeconds * 60) + 2);
    expect(types(seen)).toContain('policeEscaping');
    expect(r.p.phase).toBe('escaping');
    expect(r.p.escapeLeft).toBeGreaterThan(0);
    seen = tick(r, Math.ceil(POLICE.pursuit.escapeSeconds * 60) + 2);
    const end = seen.find((e) => e.type === 'pursuitEnd');
    expect(end && end.type === 'pursuitEnd' && end.reason).toBe('escaped');
    expect(r.p.phase).toBe('cooldown');
    expect(r.p.stars).toBe(2);
    expect(r.p.units.every((u) => u.role !== 'pursuit' || u.status !== 'active')).toBe(true);
    expect(r.p.stats.escapes).toBe(1);
    // The stars are the fading kind now: the heat drains and they go out.
    tick(r, 60 * 40);
    expect(r.p.heat).toBe(0);
    expect(r.p.phase).toBe('calm');
  });

  it('cancels the escape when a chaser sees the car again', () => {
    const r = rig();
    tick(r, 1, (events) => offense(events, 10, r.v));
    tick(r, 1, (events) => offense(events, 10, r.v));
    const first = r.p.units.find((unit) => unit.status === 'active' && unit.role === 'pursuit')!;
    first.x = r.v.x + 6;
    first.z = r.v.z;
    first.y = r.v.y;
    tick(r, 8);
    r.v.x = 5000;
    r.v.z = 5000;
    tick(r, Math.ceil(POLICE.pursuit.loseSightSeconds * 60) + 2);
    expect(r.p.phase).toBe('escaping');
    // A chaser right next to the car.
    const u = r.p.units.find((unit) => unit.status !== 'active')!;
    u.status = 'active';
    u.role = 'pursuit';
    u.lights = true;
    u.x = r.v.x + 6;
    u.z = r.v.z;
    u.y = r.v.y;
    const seen = tick(r, 8);
    const off = seen.find((e) => e.type === 'policeEscaping');
    expect(off && off.type === 'policeEscaping' && off.on).toBe(false);
    expect(r.p.phase).toBe('pursuit');
    expect(r.p.escapeLeft).toBe(0);
  });

  it('arrests a car that sits still on a chaser\'s bumper, fines it, and hands it back', () => {
    const r = rig();
    tick(r, 1, (events) => offense(events, 10, r.v));
    tick(r, 1, (events) => offense(events, 10, r.v));
    expect(r.p.stars).toBe(2);
    const u = r.p.units.find((unit) => unit.status === 'active' && unit.role === 'pursuit')!;
    u.x = r.v.x + 3;
    u.z = r.v.z;
    u.y = r.v.y;
    u.prevX = u.x;
    u.prevZ = u.z;
    // Not yet: the warning builds before the arrest.
    tick(r, Math.floor(POLICE.bust.seconds * 60) - 10);
    expect(r.p.phase).toBe('pursuit');
    expect(r.p.pinned).toBeGreaterThan(0);
    expect(r.p.pinned).toBeLessThan(POLICE.bust.seconds);
    const economy = createEconomyState();
    economy.money = 300;
    const seen = tick(r, 20, () => {});
    const busted = seen.find((e) => e.type === 'policeBusted');
    expect(busted && busted.type === 'policeBusted' && busted.stars).toBe(2);
    expect(busted && busted.type === 'policeBusted' && busted.fine).toBe(POLICE.bust.fineByStars[2]);
    expect(r.p.phase).toBe('busted');
    expect(r.p.stats.busts).toBe(1);
    // The fine is what the counter can pay, never a debt.
    applyPoliceFine(economy, r.p, seen);
    expect(economy.money).toBe(0);
    expect(busted && busted.type === 'policeBusted' && busted.charged).toBe(300);
    expect(r.p.bustedCharged).toBe(300);
    expect(r.p.stats.finesCharged).toBe(300);

    // The hold, then the release: heat gone, stars out, car free.
    const released = tick(r, Math.ceil(POLICE.bust.holdSeconds * 60) + 2);
    expect(types(released)).toContain('policeReleased');
    expect(r.p.phase).toBe('calm');
    expect(r.p.heat).toBe(0);
    expect(r.p.stars).toBe(0);
    expect(r.p.grace).toBeGreaterThan(0);
  });

  it('holds the car under arrest in stepGame and lets it go afterwards', () => {
    const state = createInitialGameState(layout, 'auto', { police: true });
    const cmd = createPlayerCommand();
    cmd.throttle = 1;
    const p = state.police!;
    p.phase = 'busted';
    p.holdLeft = 1;
    for (let i = 0; i < 30; i++) stepGame(state, cmd, layout, DT);
    expect(Math.abs(state.vehicle.speed)).toBeLessThan(0.05);
    for (let i = 0; i < 120; i++) stepGame(state, cmd, layout, DT);
    expect(p.phase).toBe('calm');
    expect(state.vehicle.speed).toBeGreaterThan(1);
  });
});

describe('patrols', () => {
  it('appear at a fraction of the traffic, after the resume delay, never on the player', () => {
    const state = createInitialGameState(layout, 'auto', { police: true });
    const cmd = createPlayerCommand();
    const p = state.police!;
    for (let i = 0; i < Math.ceil(POLICE.resumeDelay * 60) - 5; i++) stepGame(state, cmd, layout, DT);
    expect(p.units.every((u) => u.status === 'disabled')).toBe(true);
    for (let i = 0; i < 60 * 25; i++) stepGame(state, cmd, layout, DT);
    const civilians = state.targets.filter((t) => t.status === 'active').length;
    const expected = Math.min(POLICE.maxPatrols, Math.floor(civilians / POLICE.patrolRatio));
    const patrols = p.units.filter((u) => u.status === 'active');
    expect(patrols.length).toBe(expected);
    expect(patrols.length).toBeGreaterThan(0);
    expect(patrols.length * POLICE.patrolRatio).toBeLessThanOrEqual(civilians);
    for (const u of patrols) {
      expect(u.role).toBe('patrol');
      expect(u.lights).toBe(false);
      // Placed in the band, and on a road it can drive.
      expect(u.loop).toBeGreaterThanOrEqual(0);
    }
    // They drive: none of them is where it started 25 s ago.
    const wasAt = patrols.map((u) => [u.x, u.z]);
    for (let i = 0; i < 120; i++) stepGame(state, cmd, layout, DT);
    let moved = 0;
    patrols.forEach((u, i) => {
      if (u.status === 'active' && (Math.abs(u.x - wasAt[i][0]) > 1 || Math.abs(u.z - wasAt[i][1]) > 1)) moved++;
    });
    expect(moved).toBeGreaterThan(0);
  });
});

describe('the shield', () => {
  it('flags the beam lined up on a police car and reports a bolt that met one', () => {
    const r = rig();
    const u = r.p.units[0];
    u.status = 'active';
    u.role = 'patrol';
    u.loop = 0;
    u.x = r.v.x;
    u.z = r.v.z - 20;
    u.y = r.v.y;
    u.heading = 0;
    tick(r, 1);
    expect(r.p.aimedUnit).toBe(0);
    const seen = tick(r, 1, (events) => {
      events.push({
        type: 'lightningFired',
        targetId: -1,
        fromX: r.v.x,
        fromY: r.v.y,
        fromZ: r.v.z,
        toX: r.v.x,
        toY: r.v.y,
        toZ: r.v.z - 60,
        distance: 60,
        spent: 20,
      });
    });
    expect(types(seen)).toContain('policeShielded');
    expect(u.status).toBe('active');
  });
});

// The layout is what every spec above drives against; assert the assumption it rests on.
describe('the city', () => {
  it('has ground patrol loops for the police to borrow', () => {
    const l: ArenaLayout = layout;
    const ground = l.targetPatrols.filter((patrol, k) => patrol.length >= 2 && (l.targetSpawns[k].y ?? 0) < 1);
    expect(ground.length).toBeGreaterThan(10);
    expect(l.roadNetwork && l.roadNetwork.length).toBeGreaterThan(0);
  });
});
