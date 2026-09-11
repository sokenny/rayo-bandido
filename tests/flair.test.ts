import { describe, expect, it } from 'vitest';
import { FLAIR } from '../src/config/tuning';
import { createFlairState, flairSeconds, MESSAGES, resetFlairState, stepFlair } from '../src/sim/flair';
import type { DriftState, FlairMessageId, FlairState, GameEvent } from '../src/core/types';

/**
 * The flair rules. Everything here drives the module the way the tick does — a `DriftState` the
 * drift rules would have produced and an event list the collision and near-miss passes would
 * have filled — because that is the whole contract: this module reads what those already
 * decided and never decides any of it itself.
 */

const DT = 1 / 60;

function makeDrift(): DriftState {
  return { active: false, duration: 0, candidateTime: 0, lapseTime: 0, chain: 0, chainWindow: 0, chargeRate: 0 };
}

function nearMiss(): GameEvent {
  return { type: 'nearMiss', targetId: 0, x: 0, y: 0, z: 0, points: 12, quality: 0.4 };
}

function collision(impact: number): GameEvent {
  return { type: 'collision', x: 0, y: 0, z: 0, impact };
}

interface Said {
  id: FlairMessageId;
  at: number;
}

/** One rig: a clock, a drift the caller poses, and every phrase the module said with its time. */
function rig() {
  const f: FlairState = createFlairState();
  const d = makeDrift();
  const said: Said[] = [];
  let time = 0;

  /** Run `seconds` of ticks. `incoming` is injected on the FIRST tick only, like a real event. */
  function run(seconds: number, incoming: GameEvent[] = [], active = true): void {
    const ticks = Math.round(seconds / DT);
    for (let i = 0; i < ticks; i++) {
      const events: GameEvent[] = i === 0 ? [...incoming] : [];
      const before = events.length;
      time += DT;
      if (d.active) d.duration += DT;
      stepFlair(f, d, active, time, DT, events, before);
      for (const ev of events) if (ev.type === 'flair') said.push({ id: ev.id, at: time });
    }
  }

  function startDrift(): void {
    d.active = true;
    d.duration = 0;
  }

  function endDrift(): void {
    d.active = false;
    d.duration = 0;
  }

  return {
    f,
    said,
    run,
    startDrift,
    endDrift,
    get time() {
      return time;
    },
    ids: () => said.map((s) => s.id),
  };
}

describe('the flair phrases', () => {
  it('lists every allowed phrase exactly once, lowest priority first', () => {
    const ids = MESSAGES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'finito',
      'conPermiso',
      'deCostado',
      'conEstilo',
      'puraSeda',
      'auraPlus',
      'laCalleEsTuya',
      'faltandoElRespeto',
      'aPuroBandidaje',
      'auraInfinita',
      'auraMenos',
    ]);
    // The exact eleven strings, and nothing else: these are the only words the game may say.
    expect(MESSAGES.map((m) => m.text)).toEqual([
      'FINITO',
      'CON PERMISO',
      'DE COSTADO',
      'CON ESTILO',
      'PURA SEDA',
      'AURA +1000',
      'LA CALLE ES TUYA',
      'FALTANDO EL RESPETO',
      'A PURO BANDIDAJE',
      'AURA INFINITA',
      '−1000 DE AURA',
    ]);
  });

  it('holds a common phrase for 1.3s and a big one for 1.8s', () => {
    expect(flairSeconds('common')).toBeCloseTo(1.3);
    expect(flairSeconds('special')).toBeCloseTo(1.8);
    expect(flairSeconds('peak')).toBeCloseTo(1.8);
    expect(flairSeconds('crash')).toBeCloseTo(1.3);
  });
});

describe('drift milestones', () => {
  it('walks up the four milestones of one sustained drift, in order and once each', () => {
    const r = rig();
    r.startDrift();
    r.run(12);
    expect(r.ids()).toEqual(['deCostado', 'conEstilo', 'puraSeda', 'laCalleEsTuya']);
    // Each one is said no earlier than the drift second that earned it.
    const at = r.said;
    expect(at[0].at).toBeGreaterThanOrEqual(1.5);
    expect(at[1].at).toBeGreaterThanOrEqual(3.5);
    expect(at[2].at).toBeGreaterThanOrEqual(6);
    expect(at[3].at).toBeGreaterThanOrEqual(10);
  });

  it('never says two phrases closer together than the gap', () => {
    const r = rig();
    r.startDrift();
    r.run(24);
    for (let i = 1; i < r.said.length; i++) {
      expect(r.said[i].at - r.said[i - 1].at).toBeGreaterThanOrEqual(FLAIR.show.gapSeconds - 1e-6);
    }
  });

  it('re-arms the milestones for the next drift, but the repeat guard keeps it quiet', () => {
    const r = rig();
    r.startDrift();
    r.run(2);
    expect(r.ids()).toEqual(['deCostado']);
    r.endDrift();
    r.run(1);
    r.startDrift();
    r.run(2);
    // The drift re-armed its milestone, and the ten-second guard swallowed it anyway.
    expect(r.ids()).toEqual(['deCostado']);
    expect(r.f.driftMilestones & 1).toBe(1);
  });

  it('reaches AURA INFINITA on a drift alone, and says nothing smaller after it', () => {
    const r = rig();
    r.startDrift();
    r.run(30);
    const ids = r.ids();
    expect(ids).toContain('auraInfinita');
    expect(ids[ids.length - 1]).toBe('auraInfinita');
    expect(r.f.peaked).toBe(true);
  });
});

describe('the streak', () => {
  it('opens on the first near miss with one of the two openers, and alternates them', () => {
    const r = rig();
    r.run(0.5, [nearMiss()]);
    expect(r.ids()).toEqual(['finito']);
    // Let the streak lapse, then do it again: the other opener.
    r.run(FLAIR.streak.idleSeconds + 1);
    r.run(0.5, [nearMiss()]);
    expect(r.ids()).toEqual(['finito', 'conPermiso']);
  });

  it('says AURA +1000 at the third near miss of a streak, and only once', () => {
    const r = rig();
    r.run(2.5, [nearMiss()]);
    r.run(2.5, [nearMiss()]);
    r.run(2.5, [nearMiss()]);
    r.run(2.5, [nearMiss()]);
    const ids = r.ids();
    expect(ids).toContain('auraPlus');
    expect(ids.filter((id) => id === 'auraPlus')).toHaveLength(1);
  });

  it('says FALTANDO EL RESPETO for a near miss taken two seconds into a drift', () => {
    const r = rig();
    r.startDrift();
    r.run(2.4); // past DE COSTADO, and the slide is old enough to be disrespectful
    r.run(0.2, [nearMiss()]);
    r.run(2.5);
    expect(r.ids()).toContain('faltandoElRespeto');
  });

  it('does not say it for a near miss taken in a drift that has barely started', () => {
    const r = rig();
    r.startDrift();
    r.run(0.5, [nearMiss()]);
    r.run(3);
    expect(r.ids()).not.toContain('faltandoElRespeto');
  });

  it('wants both manoeuvres for A PURO BANDIDAJE', () => {
    // Drift alone gets to 12 units without ever qualifying: it has no near misses.
    const drifted = rig();
    drifted.startDrift();
    drifted.run(13);
    expect(drifted.ids()).not.toContain('aPuroBandidaje');

    // Near misses alone reach 12 units too, and still do not qualify: no drift seconds.
    const shaved = rig();
    for (let i = 0; i < 6; i++) shaved.run(2.5, [nearMiss()]);
    expect(shaved.ids()).not.toContain('aPuroBandidaje');

    // Both together do.
    const both = rig();
    both.startDrift();
    both.run(4.2);
    both.run(0.2, [nearMiss()]);
    both.run(2.4, [nearMiss()]);
    both.run(3);
    expect(both.ids()).toContain('aPuroBandidaje');
  });

  it('ends after five quiet seconds, and a live drift holds it open', () => {
    const r = rig();
    r.run(0.5, [nearMiss()]);
    expect(r.f.streak).toBe(true);
    r.run(FLAIR.streak.idleSeconds + 0.2);
    expect(r.f.streak).toBe(false);

    const held = rig();
    held.run(0.5, [nearMiss()]);
    held.startDrift();
    held.run(FLAIR.streak.idleSeconds * 2);
    expect(held.f.streak).toBe(true);
  });
});

describe('the crash', () => {
  const HARD = FLAIR.crash.impactSpeed + 1;
  const GRAZE = FLAIR.crash.impactSpeed - 1;

  it('says -1000 DE AURA when a real hit cuts a streak worth losing', () => {
    const r = rig();
    r.run(1.5, [nearMiss()]);
    r.run(1.5, [nearMiss()]); // 4 units
    r.run(0.5, [collision(HARD)]);
    expect(r.ids()[r.ids().length - 1]).toBe('auraMenos');
    expect(r.f.streak).toBe(false);
  });

  it('says nothing for a crash with no streak behind it', () => {
    const r = rig();
    r.run(1, [collision(HARD)]);
    expect(r.ids()).toEqual([]);
  });

  it('says nothing for a streak that had not got going', () => {
    const r = rig();
    r.run(1, [nearMiss()]); // 2 units, under the 4 the line wants
    r.run(0.5, [collision(HARD)]);
    expect(r.ids()).not.toContain('auraMenos');
  });

  it('leaves the streak alone for a soft scrape', () => {
    const r = rig();
    r.run(1.5, [nearMiss()]);
    r.run(1.5, [nearMiss()]);
    r.run(0.5, [collision(GRAZE)]);
    expect(r.f.streak).toBe(true);
    expect(r.ids()).not.toContain('auraMenos');
  });

  it('says it once through a bouncing contact, not once per bounce', () => {
    const r = rig();
    r.run(1.5, [nearMiss()]);
    r.run(1.5, [nearMiss()]);
    r.run(0.2, [collision(HARD)]);
    // Rebuild a streak and hit again, inside the cooldown.
    r.run(1.2, [nearMiss()]);
    r.run(1.2, [nearMiss()]);
    r.run(0.2, [collision(HARD)]);
    expect(r.ids().filter((id) => id === 'auraMenos')).toHaveLength(1);
  });

  it('interrupts a celebration rather than queueing behind it', () => {
    const r = rig();
    r.startDrift();
    // Long enough to be worth losing (4.2 units) and to have just said CON ESTILO.
    r.run(4.2);
    expect(r.ids()).toEqual(['deCostado', 'conEstilo']);
    r.endDrift();
    r.run(0.2, [collision(HARD)]);
    expect(r.ids()).toEqual(['deCostado', 'conEstilo', 'auraMenos']);
    // Said well inside the gap that holds two celebrations apart: the crash does not wait.
    const said = r.said;
    expect(said[2].at - said[1].at).toBeLessThan(FLAIR.show.gapSeconds);
  });
});

describe('arbitration', () => {
  it('shows only the highest phrase of the ones that qualify together, and spends the rest', () => {
    // Four near misses in one breath: the opener and AURA +1000 both qualify on the third.
    const r = rig();
    r.run(0.2, [nearMiss(), nearMiss(), nearMiss()]);
    r.run(6);
    const ids = r.ids();
    expect(ids[0]).toBe('auraPlus');
    // The opener that qualified alongside it was consumed, not deferred.
    expect(ids).not.toContain('finito');
    expect(ids).not.toContain('conPermiso');
  });

  it('never holds more than one candidate, and drops a stale one', () => {
    const r = rig();
    r.startDrift();
    r.run(1.6);
    // Inside the gap now. End the drift: the held milestone loses its drift and is dropped.
    r.endDrift();
    r.run(3);
    expect(r.f.pending).toBe(-1);
  });

  it('says nothing at all while it is switched off, and forgets the streak it had', () => {
    const r = rig();
    r.run(1.5, [nearMiss()]);
    expect(r.f.streak).toBe(true);
    r.startDrift();
    r.run(12, [], false);
    expect(r.ids()).toEqual(['finito']);
    expect(r.f.streak).toBe(false);
    expect(r.f.pending).toBe(-1);
  });

  it('forgets everything on a reset', () => {
    const r = rig();
    r.startDrift();
    r.run(12);
    expect(r.ids().length).toBeGreaterThan(0);
    resetFlairState(r.f);
    expect(r.f.streak).toBe(false);
    expect(r.f.said).toBe(0);
    expect(r.f.pending).toBe(-1);
    expect(r.f.lastOpener).toBe(-1);
    expect(r.f.shownAt).toBe(-Infinity);
  });
});
