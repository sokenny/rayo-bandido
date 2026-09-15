import { describe, expect, it } from 'vitest';
import { AUDIO, POLICE_RADIO_CONFIG } from '../src/config/tuning';
import type { GameEvent } from '../src/core/types';
import { createShuffleBag } from '../src/core/shuffleBag';
import { POLICE_RADIO_LINES } from '../src/content/policeRadio';
import { createPoliceRadioDirector, type PoliceRadioBark, type PoliceRadioFrame } from '../src/audio/policeRadio';

/** The police radio's rules (`src/audio/policeRadio.ts`): when a chaser speaks, and which line. */

const RULES = POLICE_RADIO_CONFIG;
const DT = 1 / 60;

const frame = (over: Partial<PoliceRadioFrame> = {}): PoliceRadioFrame => ({
  listener: { x: 0, z: 0, y: 0, heading: 0, vx: 0, vz: 0 },
  speed: 20,
  drifting: false,
  units: [],
  ...over,
});

const pursuit: GameEvent = { type: 'pursuitStart', stars: 2 };
const lostSight: GameEvent = { type: 'policeEscaping', on: true };
const shot = { type: 'lightningFired' } as GameEvent;
const hitPolice: GameEvent = { type: 'collision', x: 0, y: 0, z: 0, impact: 9, police: true };

/** A director on a fake clock, fake timers and a scripted dice. */
function rig(rolls: () => number = () => 0) {
  let clock = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const said: PoliceRadioBark[] = [];
  const dones: (() => void)[] = [];
  let muted = false;
  const d = createPoliceRadioDirector({
    transmit(bark, done) {
      said.push(bark);
      dones.push(done);
    },
    muted: () => muted,
    random: rolls,
    now: () => clock,
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: clock + ms, fn });
      return id;
    },
    clearTimer(id) {
      timers.delete(id as number);
    },
  });
  /** Advance the clock, firing due timers. */
  const advance = (ms: number): void => {
    const end = clock + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].fn();
    }
    clock = end;
  };
  /** An event in its own gameplay update. */
  const moment = (ev: GameEvent): void => {
    d.onEvent(ev);
    d.update(DT, frame());
  };
  const finish = (): void => dones.at(-1)!();
  return { d, said, timers, advance, moment, finish, lastDone: () => dones.at(-1)!, setMuted: (m: boolean) => (muted = m) };
}

describe('police radio catalog', () => {
  it('has no Rayo-charge category, and every category has at least three lines', () => {
    expect(Object.keys(POLICE_RADIO_LINES)).not.toContain('rayCharge');
    expect(Object.keys(AUDIO.policeRadio)).not.toContain('chargeHold');
    for (const lines of Object.values(POLICE_RADIO_LINES)) expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(Object.values(POLICE_RADIO_LINES).flat().join('\n')).not.toContain('Está cargando esa mierda');
  });
});

describe('police radio director', () => {
  it('says nothing outside a pursuit', () => {
    const r = rig();
    r.moment(lostSight);
    expect(r.said).toHaveLength(0);
  });

  it('skips an eligible moment that loses the roll, and does not keep it for later', () => {
    const r = rig(() => RULES.eventProbability); // exactly at the threshold: a miss
    r.d.onEvent(pursuit);
    r.moment(hitPolice);
    expect(r.said).toHaveLength(0);
    expect(r.d.busy).toBe(false);
  });

  it('holds a global cooldown after an accepted line, shared by every category', () => {
    let roll = 0;
    const r = rig(() => roll);
    r.d.onEvent(pursuit);
    r.moment(lostSight);
    expect(r.said.map((b) => b.trigger)).toEqual(['lostSight']);
    r.finish();
    // roll 0 → the global quiet is its minimum.
    r.advance(RULES.globalCooldownMinMs - 1);
    r.moment(hitPolice); // a different category: still inside the global quiet
    expect(r.said).toHaveLength(1);
    r.advance(RULES.sameMomentMs + 2);
    roll = 0;
    r.moment(hitPolice);
    expect(r.said.map((b) => b.trigger)).toEqual(['lostSight', 'hitPolice']);
  });

  it('holds each category to its own cooldown past the global one', () => {
    const r = rig();
    r.d.onEvent(pursuit);
    r.moment(lostSight);
    r.finish();
    r.advance(RULES.globalCooldownMaxMs + 1);
    r.moment(lostSight);
    expect(r.said).toHaveLength(1);
    r.advance(RULES.categoryCooldownMs);
    r.moment(lostSight);
    expect(r.said).toHaveLength(2);
  });

  it('starts the cooldowns when a line is chosen, not when it has played', () => {
    const r = rig();
    r.d.onEvent(pursuit);
    r.moment(lostSight);
    r.advance(RULES.globalCooldownMaxMs); // still fetching all this time
    r.finish();
    r.moment(hitPolice);
    expect(r.said.map((b) => b.trigger)).toEqual(['lostSight', 'hitPolice']);
  });

  it('discards moments while a line is being fetched or heard, and when muted', () => {
    const r = rig();
    r.d.onEvent(pursuit);
    r.moment(lostSight);
    r.advance(RULES.categoryCooldownMs * 2); // every cooldown over, but not finished
    r.moment(hitPolice);
    expect(r.said).toHaveLength(1);
    r.finish();
    r.moment({ ...hitPolice, impact: 10 }); // the held moment was discarded; this is a fresh one…
    expect(r.said).toHaveLength(1); // …inside `sameMomentMs` of it, so the same shove
    r.advance(RULES.sameMomentMs);
    r.setMuted(true);
    r.moment(hitPolice);
    expect(r.said).toHaveLength(1);
    r.setMuted(false);
    r.advance(RULES.sameMomentMs);
    r.moment(hitPolice);
    expect(r.said).toHaveLength(2);
  });

  it('gives the roll to the most important moment of an update', () => {
    const r = rig();
    r.d.onEvent(pursuit);
    r.d.onEvent(shot);
    r.d.onEvent(lostSight);
    r.d.onEvent(hitPolice);
    r.d.update(DT, frame({ drifting: true }));
    expect(r.said.map((b) => b.trigger)).toEqual(['hitPolice']);
  });

  it('rolls once per drift, not once per frame', () => {
    const rolls: number[] = [];
    const r = rig(() => {
      rolls.push(0);
      return 0.99;
    });
    r.d.onEvent(pursuit);
    const before = rolls.length;
    for (let t = 0; t < AUDIO.policeRadio.driftHold + 3; t += DT) r.d.update(DT, frame({ drifting: true }));
    expect(rolls.length - before).toBe(1);
  });

  it('keeps one filler timer per pursuit, never plays filler at the start, and cancels it at the end', () => {
    const r = rig();
    r.d.onEvent(pursuit);
    r.d.onEvent(pursuit);
    expect(r.timers.size).toBe(1);
    expect(r.said).toHaveLength(0);
    r.advance(RULES.activePursuitIntervalMinMs); // roll 0 → the shortest interval
    expect(r.said.map((b) => b.trigger)).toEqual(['activePursuit']);
    expect(r.timers.size).toBe(1);
    r.d.onEvent({ type: 'pursuitEnd', reason: 'escaped', duration: 30 });
    expect(r.timers.size).toBe(0);
  });

  it('ends the pursuit: a line still fetching is invalidated, and chase cooldowns reset', () => {
    const r = rig();
    r.d.onEvent(pursuit);
    r.moment(lostSight);
    const staleDone = r.lastDone();
    const doneBefore = r.said.length;
    r.d.onEvent({ type: 'pursuitEnd', reason: 'escaped', duration: 5 });
    expect(r.d.busy).toBe(false);
    expect(r.d.tryPlay('hitPolice')).toBe(false); // no pursuit, no radio
    r.d.onEvent(pursuit);
    r.moment(lostSight); // same category, same instant: cooldowns were chase-scoped
    expect(r.said).toHaveLength(doneBefore + 1);
    staleDone(); // the first chase's line lands late…
    // …and must not free the new chase's radio: its `done` was from before the end.
    expect(r.d.busy).toBe(true);
  });

  it('never repeats a line back to back, across refills and pursuits', () => {
    let seed = 7;
    const r = rig(() => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    });
    const texts: string[] = [];
    for (let i = 0; i < 40; i++) {
      r.d.onEvent(pursuit);
      for (let tries = 0; tries < 8 && !r.d.tryPlay('drift'); tries++);
      r.d.onEvent({ type: 'pursuitEnd', reason: 'escaped', duration: 5 });
    }
    for (const b of r.said) texts.push(b.text);
    expect(texts.length).toBeGreaterThan(6);
    for (let i = 1; i < texts.length; i++) expect(texts[i]).not.toBe(texts[i - 1]);
  });
});

describe('shuffle bag', () => {
  it('draws every item once before any repeats', () => {
    let s = 3;
    const bag = createShuffleBag(['a', 'b', 'c', 'd'], () => ((s = (s * 48271) % 2147483647) / 2147483647));
    for (let round = 0; round < 5; round++) {
      const drawn = [bag.next(), bag.next(), bag.next(), bag.next()];
      expect([...drawn].sort()).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  it('never starts a refilled bag with the last item of the previous one', () => {
    // A dice that always yields the identity shuffle, so the refill would otherwise start where it ended.
    for (const roll of [0, 0.5, 0.999]) {
      const bag = createShuffleBag(['a', 'b', 'c'], () => roll);
      let last = '';
      for (let i = 0; i < 30; i++) {
        const next = bag.next();
        expect(next).not.toBe(last);
        last = next;
      }
    }
  });
});
