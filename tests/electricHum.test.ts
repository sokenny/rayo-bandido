import { describe, expect, it } from 'vitest';
import { selectHumTargets } from '../src/audio/electricHum';
import { AUDIO } from '../src/config/tuning';
import type { TargetState, TargetStatus } from '../src/core/types';

/**
 * A hum voice is thirteen Web Audio nodes that run for the life of the page. One per car is
 * fine for a race's twelve; the open world holds 126, which was sixteen hundred nodes almost
 * all of them rendering silence, since `humFar` puts an exact zero on anything past 55 m.
 * These are the rules the voice pool hands itself by.
 */

function target(id: number, x: number, z: number, status: TargetStatus = 'active'): TargetState {
  return {
    id,
    x,
    z,
    y: 0,
    heading: 0,
    prevX: x,
    prevZ: z,
    prevY: 0,
    prevHeading: 0,
    vx: 0,
    vz: 0,
    status,
    hitTime: -1,
    patrolIndex: 0,
    patrolSpeed: 8,
    speed: 8,
    rewarded: false,
  };
}

describe('electric hum voice pool', () => {
  const listener = { x: 0, z: 0, heading: 0 };

  function pool(size: number): { out: Int32Array; scratch: Float64Array } {
    return { out: new Int32Array(size), scratch: new Float64Array(size) };
  }

  it('picks the nearest cars first', () => {
    const targets = [target(0, 40, 0), target(1, 5, 0), target(2, 20, 0)];
    const { out, scratch } = pool(3);
    const n = selectHumTargets(targets, listener, AUDIO.humFar, out, scratch);
    expect(n).toBe(3);
    expect([...out.slice(0, n)]).toEqual([1, 2, 0]);
  });

  it('never picks a car that would be silent anyway', () => {
    // `distanceGain` is exactly zero at `humFar`, so a voice out there is a wasted voice.
    const targets = [target(0, AUDIO.humFar, 0), target(1, AUDIO.humFar + 50, 0), target(2, 10, 0)];
    const { out, scratch } = pool(4);
    const n = selectHumTargets(targets, listener, AUDIO.humFar, out, scratch);
    expect(n).toBe(1);
    expect(out[0]).toBe(2);
  });

  it('never picks a destroyed car', () => {
    const targets = [target(0, 5, 0, 'destroyed'), target(1, 9, 0)];
    const { out, scratch } = pool(4);
    const n = selectHumTargets(targets, listener, AUDIO.humFar, out, scratch);
    expect(n).toBe(1);
    expect(out[0]).toBe(1);
  });

  it('measures distance from the listener, not from the origin', () => {
    const targets = [target(0, 0, 0)];
    const { out, scratch } = pool(4);
    const far = { x: AUDIO.humFar + 10, z: 0, heading: 0 };
    expect(selectHumTargets(targets, far, AUDIO.humFar, out, scratch)).toBe(0);
    const near = { x: 5, z: 0, heading: 0 };
    expect(selectHumTargets(targets, near, AUDIO.humFar, out, scratch)).toBe(1);
  });

  it('keeps the nearest ones when a whole city of cars is in range', () => {
    // Every car inside `humFar`, far more of them than there are voices.
    const targets = Array.from({ length: 126 }, (_, i) => target(i, (i % 50) + 1, 0));
    const { out, scratch } = pool(AUDIO.humVoices);
    const n = selectHumTargets(targets, listener, AUDIO.humFar, out, scratch);
    expect(n).toBe(AUDIO.humVoices);
    const picked = [...out.slice(0, n)].map((i) => targets[i].x);
    // Sorted nearest-first, starting with the nearest car in the fleet.
    expect(picked).toEqual([...picked].sort((a, b) => a - b));
    expect(picked[0]).toBe(1);
    // Nothing sneaks in ahead of a car that is closer than it.
    const everyDistance = targets.map((t) => t.x).sort((a, b) => a - b);
    expect(picked).toEqual(everyDistance.slice(0, AUDIO.humVoices));
  });

  it('asks for no voices when there is nothing to hear', () => {
    const { out, scratch } = pool(AUDIO.humVoices);
    expect(selectHumTargets([], listener, AUDIO.humFar, out, scratch)).toBe(0);
    const gone = [target(0, 5, 0, 'destroyed')];
    expect(selectHumTargets(gone, listener, AUDIO.humFar, out, scratch)).toBe(0);
  });
});
