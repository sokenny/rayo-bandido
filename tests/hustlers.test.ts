import { describe, expect, it } from 'vitest';
import type { GameEvent, HustlerSpot, PlayerCommand } from '../src/core/types';
import { HUSTLERS } from '../src/config/tuning';
import { HUSTLER_NICKNAMES, HUSTLER_VOICE, MEDIAS_LINES, TRAPITO_LINES, WASHER_LINES, streetPrice, validateHustlerLines } from '../src/content/hustlers';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { createEconomyState, createVehicleState } from '../src/sim/gameState';
import {
  beatAt,
  createHustlerState,
  foamCleared,
  hustlerAt,
  hustlerName,
  signalAt,
  stepHustlers,
  washerRedNeeded,
  type HustlerContext,
} from '../src/sim/hustlers';
import { buildHumanParts } from '../src/render/scene/env/humanFigure';
import { createActor, createPose, stepActor } from '../src/render/scene/env/humanActs';
import { hustlerLook } from '../src/render/scene/hustlersVisual';
import { createOpenWorld } from '../src/world/openWorld';
import { METRO_HUSTLER_SPOTS } from '../src/world/hustlerSpots';

/**
 * The trapitos, the washers and the sock sellers (`src/sim/hustlers.ts`). What is worth pinning is
 * what the player would feel if it broke: a trapito or a sock seller never asks for anything, a
 * washer never takes money without a yes and never twice, a clean the light let start is never cut
 * by the light, driving on is always a way out, a sock seller is found where he has walked to and
 * picks up his walk where he left it, and everybody — the whole of a seller's walk — is on a pavement.
 */

const DT = 1 / 60;
const W = HUSTLERS.washer;
const T = HUSTLERS.trapito;
const M = HUSTLERS.medias;
/** Offset 0: green for `green`, amber for `amber`, then red. */
const RED_AT = W.signal.green + W.signal.amber + 0.25;

const TRAPITO: HustlerSpot = { id: 't', kind: 'trapito', label: 't', x: 0, z: 0, heading: 0, seed: 1, space: { x: -4, z: -3 } };
const WASHER: HustlerSpot = {
  id: 'w',
  kind: 'washer',
  label: 'w',
  x: 200,
  z: 0,
  heading: 0,
  seed: 2,
  approach: { x: 204, z: -6, heading: 0 },
  signal: { x: 201, z: -1, heading: Math.PI, offset: 0 },
};

/** Walks 36 m north-south at x = -400, facing west at the street. */
const SELLER: HustlerSpot = {
  id: 'm',
  kind: 'medias',
  label: 'm',
  x: -400,
  z: 18,
  heading: -Math.PI / 2,
  seed: 3,
  beat: { from: { x: -400, z: 0 }, to: { x: -400, z: 36 } },
};

function world(spots: HustlerSpot[] = [TRAPITO, WASHER]) {
  const s = createHustlerState(spots);
  const v = createVehicleState(1000, 1000, 0);
  const economy = createEconomyState();
  const ctx: HustlerContext = { damaged: false, pursued: false };
  const cmd: PlayerCommand = createPlayerCommand();
  const events: GameEvent[] = [];
  let time = 0;
  const run = (seconds: number, press?: Partial<PlayerCommand>): GameEvent[] => {
    const out: GameEvent[] = [];
    const ticks = Math.max(1, Math.round(seconds / DT));
    for (let i = 0; i < ticks; i++) {
      events.length = 0;
      Object.assign(cmd, { activate: false, decline: false }, i === 0 ? press : undefined);
      time += DT;
      stepHustlers(s, spots, v, cmd, economy, ctx, time, DT, events);
      out.push(...events);
    }
    return out;
  };
  const park = (x: number, z: number, heading = 0): void => {
    v.x = v.prevX = x;
    v.z = v.prevZ = z;
    v.heading = heading;
    v.speed = 0;
  };
  return {
    s,
    v,
    economy,
    ctx,
    run,
    park,
    get time() {
      return time;
    },
    set time(t: number) {
      time = t;
    },
  };
}

const lines = (events: GameEvent[]) => events.filter((e): e is Extract<GameEvent, { type: 'hustlerLine' }> => e.type === 'hustlerLine');

describe('the words', () => {
  it('is all there, never repeats inside a pool, and fits a subtitle', () => {
    expect(validateHustlerLines()).toEqual([]);
    expect(streetPrice(2000)).toBe('$2.000');
  });

  it('never says the same line twice running', () => {
    const w = world([TRAPITO]);
    let last = '';
    for (let k = 0; k < 12; k++) {
      w.s.npcs[0].cooldownUntil = 0;
      w.s.npcs[0].phase = 'idle';
      w.s.lineTimeLeft = 0;
      w.park(6, 0);
      const said = lines(w.run(1));
      expect(said.length).toBe(1);
      expect(said[0].text).not.toBe(last);
      last = said[0].text;
    }
  });
});

describe('a trapito', () => {
  it('calls a car that slows by him, asks for nothing, and grumbles when it goes', () => {
    const w = world([TRAPITO]);
    w.economy.money = 5000;
    w.park(8, 2);
    const called = w.run(1);
    expect(lines(called).length).toBe(1);
    expect(w.s.npcs[0].phase).toBe('call');
    // No button, no price, no offer: the joke is that nobody is parking.
    expect(w.s.offering).toBe(-1);
    expect(called.some((e) => e.type === 'washerOffer' || e.type === 'washerPaid')).toBe(false);
    expect(w.economy.money).toBe(5000);

    w.park(60, 0);
    w.run(0.1);
    expect(['grumble', 'idle']).toContain(w.s.npcs[0].phase);
    expect(w.s.npcs[0].cooldownUntil).toBeGreaterThan(w.time + T.cooldown - 1);
  });

  it('leaves a car driving past at speed alone, and does not call the same car again inside his cooldown', () => {
    const w = world([TRAPITO]);
    w.park(10, 0);
    w.v.speed = 20;
    expect(lines(w.run(0.3)).length).toBe(0);
    w.v.speed = 0;
    w.run(1);
    w.park(80, 0);
    w.run(0.1);
    w.run(T.grumbleSeconds + 0.5);
    w.s.lineTimeLeft = 0;
    w.park(6, 0);
    expect(lines(w.run(5)).length).toBe(0);
  });

  it('talks about the dents before anything else', () => {
    const w = world([TRAPITO]);
    w.ctx.damaged = true;
    w.park(6, 0);
    const said = lines(w.run(1));
    expect(said[0].kind).toBe('damaged');
    expect(TRAPITO_LINES.damaged).toContain(said[0].text);
    expect(w.s.npcs[0].mood).toBe('damaged');
  });

  it('is called by his nickname once he has worked the car a few times', () => {
    const w = world([TRAPITO]);
    expect(hustlerName(w.s, [TRAPITO], 0)).toBe('Trapito');
    w.s.npcs[0].encounters = HUSTLERS.nicknameAfter;
    expect(HUSTLER_NICKNAMES).toContain(hustlerName(w.s, [TRAPITO], 0));
  });

  it('cuts his line clean when the car is out of earshot', () => {
    const w = world([TRAPITO]);
    w.park(6, 0);
    w.run(0.8);
    expect(w.s.line).not.toBe('');
    w.park(HUSTLERS.hearRadius + 10, 0);
    w.run(0.05);
    expect(w.s.line).toBe('');
  });
});

describe('a sock seller', () => {
  /** A seller `walking` seconds into the first leg of his walk, which puts him that many seconds' stroll up it. */
  function walking(seconds: number) {
    const w = world([SELLER]);
    w.s.npcs[0].beat = M.restSeconds + seconds;
    return w;
  }
  const where = (w: ReturnType<typeof world>) => hustlerAt(SELLER, w.s.npcs[0]);

  it('is voiced by the villero, not the trapitos', () => {
    expect(HUSTLER_VOICE.medias).toBe('villero');
    expect(HUSTLER_VOICE.trapito).toBe('trapito');
    expect(HUSTLER_VOICE.washer).toBe('trapito');
  });

  it('walks his beat end to end and back, and never off it', () => {
    const w = world([SELLER]);
    let lo = Infinity;
    let hi = -Infinity;
    let walked = false;
    for (let k = 0; k < 90; k++) {
      w.run(1);
      const at = where(w);
      expect(at.x).toBeCloseTo(-400, 6);
      expect(at.z).toBeGreaterThanOrEqual(-1e-6);
      expect(at.z).toBeLessThanOrEqual(36 + 1e-6);
      lo = Math.min(lo, at.z);
      hi = Math.max(hi, at.z);
      if (at.moving > 0.5) walked = true;
    }
    expect(walked).toBe(true);
    expect(lo).toBeLessThan(1);
    expect(hi).toBeGreaterThan(35);
    // Standing at an end he faces the street; walking, he faces the way he is going.
    const rest = beatAt(SELLER, 1);
    expect(rest.moving).toBe(0);
    expect(rest.heading).toBeCloseTo(SELLER.heading, 6);
    expect(Math.cos(beatAt(SELLER, M.restSeconds + 5).heading - Math.PI)).toBeCloseTo(1, 6);
  });

  it('notices a car by where he has walked to, not by the middle of his beat', () => {
    const far = walking(0);
    far.s.npcs[0].beat = 1;
    far.park(-393, 32);
    expect(lines(far.run(2)).length).toBe(0);

    const near = walking(30);
    const at = where(near);
    near.park(-393, at.z);
    expect(lines(near.run(1.2)).length).toBe(1);
  });

  it('stops for a car that slows by him and pitches it, asking for nothing', () => {
    const w = walking(10);
    w.economy.money = 5000;
    const before = where(w);
    w.park(-393, before.z);
    const events = w.run(1.2);
    const said = lines(events);
    expect(said).toHaveLength(1);
    expect(['pitch', 'clean']).toContain(said[0].kind);
    expect(w.s.npcs[0].phase).toBe('call');
    expect(events.some((e) => e.type === 'washerOffer' || e.type === 'washerPaid')).toBe(false);
    expect(w.s.offering).toBe(-1);
    // Selling, he stands where he stopped.
    const stopped = where(w).z;
    w.run(3);
    expect(where(w).z).toBeCloseTo(stopped, 6);
    expect(w.economy.money).toBe(5000);
  });

  it('tries again while the car stays, gives up if it just sits there, and walks on from where he stopped', () => {
    const w = walking(10);
    const at = where(w);
    w.park(-393, at.z);
    w.run(1.2);
    const stopped = where(w).z;
    const waited = w.run(M.callSeconds + M.waitSeconds + 1);
    const kinds = lines(waited).map((e) => e.kind);
    expect(kinds.filter((k) => k === 'insist').length).toBeGreaterThanOrEqual(1);
    expect(kinds.filter((k) => k === 'insist').length).toBeLessThanOrEqual(M.insists);
    expect(kinds).toContain('ignored');
    expect(['grumble', 'idle']).toContain(w.s.npcs[0].phase);
    w.run(M.grumbleSeconds + 3);
    expect(w.s.npcs[0].phase).toBe('idle');
    // Back on his walk, a few steps on from where he stood — and not again at the same car for a while.
    const on = where(w).z;
    expect(Math.abs(on - stopped)).toBeGreaterThan(0.5);
    expect(Math.abs(on - stopped)).toBeLessThan(6);
    expect(lines(w.run(5)).length).toBe(0);
  });

  it('tells a car that drives off that he is not stealing from anybody, sooner or later', () => {
    const said: string[] = [];
    for (let k = 0; k < 12 && said.length === 0; k++) {
      const w = walking(10);
      w.s.seed = 0x1234 + k * 977;
      const at = where(w);
      w.park(-393, at.z);
      w.run(1.2);
      w.s.lineTimeLeft = 0;
      w.park(-300, at.z);
      const gone = lines(w.run(0.1));
      said.push(...gone.filter((e) => e.kind === 'ignored').map((e) => e.text));
      expect(w.s.npcs[0].cooldownUntil).toBeGreaterThan(w.time + M.cooldown - 1);
    }
    expect(said.length).toBeGreaterThan(0);
    for (const text of said) expect(MEDIAS_LINES.ignored).toContain(text);
  });

  it('wants nothing to do with a car the police are on, and leads with the dents otherwise', () => {
    const chased = walking(10);
    chased.ctx.pursued = true;
    chased.park(-393, where(chased).z);
    const out = lines(chased.run(1.2));
    expect(out[0].kind).toBe('pursuit');
    expect(MEDIAS_LINES.pursuit).toContain(out[0].text);
    expect(chased.s.npcs[0].phase).toBe('waveOff');

    const dented = walking(10);
    dented.ctx.damaged = true;
    dented.park(-393, where(dented).z);
    expect(lines(dented.run(1.2))[0].kind).toBe('damaged');
    expect(dented.s.npcs[0].mood).toBe('damaged');
  });

  it('cuts his line when the car is out of earshot of where he is standing', () => {
    const w = walking(30);
    w.park(-393, where(w).z);
    w.run(1.2);
    expect(w.s.line).not.toBe('');
    w.park(-393, where(w).z + HUSTLERS.hearRadius + 5);
    w.run(0.05);
    expect(w.s.line).toBe('');
  });
});

describe('the light', () => {
  it('runs green, amber, red, and a whole clean fits in what an offer leaves of the red', () => {
    expect(signalAt(0, 1).color).toBe('green');
    expect(signalAt(0, W.signal.green + 1).color).toBe('amber');
    const red = signalAt(0, RED_AT);
    expect(red.color).toBe('red');
    expect(red.left).toBeCloseTo(W.signal.red - 0.25, 5);
    expect(washerRedNeeded() + W.offerMargin + W.noticeSeconds).toBeLessThan(W.signal.red);
  });

  it('takes the foam off as the squeegee passes, row by row', () => {
    let previous = -1;
    for (let t = 0; t <= W.spraySeconds + W.wipeSeconds + 0.01; t += 0.05) {
      let cleared = 0;
      for (let u = 0.05; u < 1; u += 0.1) for (let v = 0.05; v < 1; v += 0.1) if (foamCleared(t, u, v)) cleared++;
      expect(cleared).toBeGreaterThanOrEqual(previous);
      previous = cleared;
    }
    expect(previous).toBe(100);
    expect(foamCleared(W.spraySeconds * 0.5, 0.5, 0.5)).toBe(false);
  });
});

describe('a windshield washer', () => {
  /** A washer's world with the car stopped at his light on red. */
  function atRed(money = 10_000) {
    const w = world([WASHER]);
    w.economy.money = money;
    w.time = RED_AT;
    w.park(204, -6);
    return w;
  }

  it('does nothing on green, and offers on red to a car stopped in his lane', () => {
    const green = world([WASHER]);
    green.park(204, -6);
    expect(green.run(3).some((e) => e.type === 'washerOffer')).toBe(false);

    const w = atRed();
    const events = w.run(1.2);
    expect(events.some((e) => e.type === 'washerOffer' && e.on)).toBe(true);
    expect(w.s.offering).toBe(0);
    expect(WASHER_LINES.offer.concat(WASHER_LINES.regular)).toContain(lines(events)[0].text);
    // Offered is not paid.
    expect(w.economy.money).toBe(10_000);
  });

  it('charges once, on yes, and cleans to the end without the light cutting in', () => {
    const w = atRed();
    w.run(1.2);
    const paid = w.run(0.1, { activate: true });
    expect(paid.filter((e) => e.type === 'washerPaid')).toHaveLength(1);
    expect(w.economy.money).toBe(10_000 - W.price);
    // Pressing again buys nothing more.
    const after = w.run(12, { activate: true });
    expect(after.some((e) => e.type === 'washerPaid')).toBe(false);
    expect(after.some((e) => e.type === 'washerCancelled')).toBe(false);
    const said = lines(after).map((e) => e.kind);
    expect(said).toContain('cleaning');
    expect(said).toContain('thanks');
    expect(w.economy.money).toBe(10_000 - W.price);
    expect(['retreat', 'idle']).toContain(w.s.npcs[0].phase);
  });

  it('never takes the balance below zero', () => {
    const w = atRed(700);
    w.run(1.2);
    const paid = w.run(0.1, { activate: true }).find((e) => e.type === 'washerPaid');
    expect(paid && paid.type === 'washerPaid' && paid.charged).toBe(700);
    expect(w.economy.money).toBe(0);
  });

  it('takes no for an answer, and nothing with it', () => {
    const w = atRed();
    w.run(1.2);
    const events = w.run(0.1, { decline: true });
    expect(events.some((e) => e.type === 'washerRefused')).toBe(true);
    expect(lines(events)[0].kind).toBe('refused');
    expect(w.s.offering).toBe(-1);
    w.run(5, { activate: true });
    expect(w.economy.money).toBe(10_000);
  });

  it('gets out of the way the moment the car drives off mid-clean', () => {
    const w = atRed();
    w.run(1.2);
    w.run(0.1, { activate: true });
    w.run(1.5);
    w.v.speed = 6;
    w.v.z -= 3;
    const events = w.run(0.05);
    const cancel = events.find((e) => e.type === 'washerCancelled');
    expect(cancel && cancel.type === 'washerCancelled' && cancel.reason).toBe('drove');
    expect(w.s.npcs[0].phase).toBe('retreat');
    expect(w.economy.money).toBe(10_000 - W.price);
  });

  it('puts no offer up with the police on the car, or over another prompt', () => {
    const chased = atRed();
    chased.ctx.pursued = true;
    const events = chased.run(1.5);
    expect(events.some((e) => e.type === 'washerOffer')).toBe(false);
    expect(lines(events)[0].kind).toBe('pursuit');

    const busy = atRed();
    busy.s.keyBusy = true;
    busy.run(2);
    expect(busy.s.offering).toBe(-1);

    const locked = atRed();
    locked.s.locked = true;
    expect(locked.run(2).length).toBe(0);
  });

  it('leads with the dents when there are any', () => {
    const w = atRed();
    w.ctx.damaged = true;
    expect(lines(w.run(1.2))[0].kind).toBe('damaged');
  });
});

describe('the open world', () => {
  const { layout, plan } = createOpenWorld();

  const solidAt = (x: number, z: number, r: number): string | null => {
    for (const b of layout.colliders) {
      if (b.maxY !== undefined && b.maxY < 0.5) continue;
      if (b.minY !== undefined && b.minY > 1.8) continue;
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return b.tag ?? 'box';
    }
    return null;
  };

  it('puts every hustler on a pavement, clear of anything solid, and every washer on a lane at his light', () => {
    expect(layout.hustlerSpots?.length).toBe(METRO_HUSTLER_SPOTS.length);
    expect(METRO_HUSTLER_SPOTS.length).toBeLessThanOrEqual(HUSTLER_NICKNAMES.length);
    for (const h of METRO_HUSTLER_SPOTS) {
      expect(plan.isRoad(h.x, h.z, 0), `${h.id} stands in the road`).toBe(false);
      expect(solidAt(h.x, h.z, 0.4), `${h.id} stands in something`).toBeNull();
      if (h.kind === 'trapito') {
        expect(h.space, `${h.id} has no space to point at`).toBeTruthy();
        // Every trapito has a light of his own, on the pavement beside him.
        const s = h.signal!;
        expect(s, `${h.id} has no light`).toBeTruthy();
        expect(plan.isRoad(s.x, s.z, 0), `${h.id}'s light stands in the road`).toBe(false);
        expect(solidAt(s.x, s.z, 0.2), `${h.id}'s light stands in something`).toBeNull();
        expect(Math.hypot(h.x - s.x, h.z - s.z)).toBeLessThan(7);
      } else if (h.kind === 'medias') {
        // His whole walk is pavement and clear, and his spot is the middle of it.
        const b = h.beat!;
        expect(b, `${h.id} has no beat`).toBeTruthy();
        expect(Math.hypot((b.from.x + b.to.x) / 2 - h.x, (b.from.z + b.to.z) / 2 - h.z)).toBeLessThan(0.01);
        const len = Math.hypot(b.to.x - b.from.x, b.to.z - b.from.z);
        expect(len).toBeGreaterThan(20);
        for (let d = 0; d <= len; d += 0.5) {
          const x = b.from.x + ((b.to.x - b.from.x) * d) / len;
          const z = b.from.z + ((b.to.z - b.from.z) * d) / len;
          expect(plan.isRoad(x, z, 0.5), `${h.id} walks into the road at ${d} m`).toBe(false);
          expect(solidAt(x, z, 0.5), `${h.id} walks into something at ${d} m`).toBeNull();
        }
      } else {
        const a = h.approach!;
        const s = h.signal!;
        expect(plan.isRoad(a.x, a.z, 0), `${h.id}'s car waits off the road`).toBe(true);
        expect(plan.isRoad(s.x, s.z, 0), `${h.id}'s light stands in the road`).toBe(false);
        // His corner is at the front of the car on its right-hand side, a few steps away.
        expect(Math.hypot(h.x - a.x, h.z - a.z)).toBeLessThan(10);
      }
    }
  });

  it('keeps the street props off their patch, and off the whole of a sock seller\'s walk', () => {
    for (const h of METRO_HUSTLER_SPOTS) {
      const near = (layout.streetProps ?? []).filter((p) => Math.hypot(p.x - h.x, p.z - h.z) < 5);
      expect(near, h.id).toEqual([]);
      const b = h.beat;
      if (!b) continue;
      for (let k = 0; k <= 12; k++) {
        const x = b.from.x + ((b.to.x - b.from.x) * k) / 12;
        const z = b.from.z + ((b.to.z - b.from.z) * k) / 12;
        const onIt = (layout.streetProps ?? []).filter((p) => Math.hypot(p.x - x, p.z - z) < 2.5);
        expect(onIt, `${h.id} at ${k}/12`).toEqual([]);
      }
    }
  });
});

describe('the look', () => {
  it('dresses every hustler inside a person-sized budget, and moves them through every phase without a NaN', () => {
    for (const spot of METRO_HUSTLER_SPOTS) {
      const parts = buildHumanParts(hustlerLook(spot));
      const tris = [parts.body, parts.prop, parts.accent].reduce((n, g) => n + (g ? g.getAttribute('position').count / 3 : 0), 0);
      expect(tris, spot.id).toBeLessThan(500);

      const actor = createActor({ act: spot.kind, x: spot.x, z: spot.z, heading: spot.heading, seed: spot.seed });
      const pose = createPose();
      const phases =
        spot.kind === 'trapito'
          ? (['idle', 'call', 'wait', 'grumble'] as const)
          : spot.kind === 'medias'
            ? (['idle', 'call', 'wait', 'grumble', 'waveOff'] as const)
            : (['idle', 'offer', 'approach', 'clean', 'thanks', 'retreat', 'refused', 'waveOff'] as const);
      for (const phase of phases) {
        for (const mood of ['plain', 'damaged', 'clean'] as const) {
          const cue = actor.cue!;
          Object.assign(cue, { phase, mood, carX: spot.x + 5, carZ: spot.z + 3, spaceX: spot.x - 3, spaceZ: spot.z + 2, fromX: spot.x, fromZ: spot.z, toX: spot.x + 4, toZ: spot.z + 4, glassX: spot.x + 4.5, glassZ: spot.z + 5 });
          Object.assign(cue, { atX: spot.x + 1, atZ: spot.z - 2, facing: spot.heading + 1, striding: phase === 'idle' ? 1 : 0 });
          for (let k = 0; k < 40; k++) {
            cue.t = k * 0.15;
            cue.walk = Math.min(1, k / 20);
            cue.u = (k % 10) / 10;
            cue.wiping = k % 2;
            cue.stride = k * 0.1;
            stepActor(actor, k * 0.15, 0.15, { x: spot.x + 5, z: spot.z + 3, speed: 2, drifting: false }, pose);
            for (const value of Object.values(pose)) expect(Number.isFinite(value), `${spot.id} ${phase}`).toBe(true);
          }
        }
      }
    }
  });
});
