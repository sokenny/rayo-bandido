import { describe, expect, it } from 'vitest';
import { CROWD } from '../src/config/tuning';
import { createActor, createPose, speakerSong, stepActor, type ActorSpec, type BodyPose, type CrowdSubject, type HumanAct } from '../src/render/scene/env/humanActs';

/**
 * What people do (`src/render/scene/env/humanActs.ts`). The shapes of the poses are judged by
 * eye in the game; what is pinned here is the behaviour the rest leans on: that a person is
 * deterministic, never in step with the next one, notices the car on the side it is on, cheers a
 * drift, gets out of the way of a car coming at them without leaving their spot, and — if they
 * pace — keeps to their beat.
 */

const DT = 1 / 30;
const ACTS: HumanAct[] = ['stand', 'chat', 'film', 'phone', 'pace', 'vibe', 'warm', 'vendor', 'inspect', 'hail'];

function spec(act: HumanAct, extra: Partial<ActorSpec> = {}): ActorSpec {
  return { act, x: 10, z: 20, heading: 0, seed: 4, focus: { x: 10, z: 18 }, to: act === 'pace' ? { x: 13, z: 20 } : undefined, ...extra };
}

/** Step an actor for `seconds`, with `subject` at each step if given; the last pose. */
function run(s: ActorSpec, seconds: number, subject: (t: number) => CrowdSubject | null = () => null, from = 0): BodyPose {
  const a = createActor(s);
  const pose = createPose();
  for (let t = from; t <= from + seconds; t += DT) stepActor(a, t, DT, subject(t), pose);
  return pose;
}

describe('what people do', () => {
  it('is deterministic, and never in step with the next person', () => {
    const a = run(spec('chat'), 6);
    const b = run(spec('chat'), 6);
    expect(b).toEqual(a);
    const other = run(spec('chat', { seed: 5 }), 6);
    expect(other.look).not.toBeCloseTo(a.look, 3);
  });

  it('keeps every joint finite through every act, with and without a car about', () => {
    const car = (t: number): CrowdSubject => ({ x: 10 + Math.sin(t) * 12, z: 20 + Math.cos(t) * 12, speed: 14, drifting: t % 4 < 2 });
    for (const act of ACTS) {
      for (const subject of [() => null, car]) {
        const s = spec(act);
        const actor = createActor(s);
        const pose = createPose();
        for (let t = 0; t < 30; t += DT) {
          stepActor(actor, t, DT, subject(t), pose);
          for (const [k, v] of Object.entries(pose)) expect(Number.isFinite(v), `${act} ${k} at ${t.toFixed(2)}`).toBe(true);
          // Nobody ever leans or turns their head past what a neck and a back can do.
          expect(Math.abs(pose.look)).toBeLessThan(1.6);
          expect(pose.lean).toBeLessThan(1.1);
        }
      }
    }
  });

  it('looks at a moving car on the side it is on', () => {
    // Facing north (-z); a car passing to the east is on their right.
    const right = run(spec('stand'), 4, () => ({ x: 22, z: 20, speed: 10, drifting: false }));
    expect(right.look + right.twist).toBeGreaterThan(0.8);
    const left = run(spec('stand'), 4, () => ({ x: -2, z: 20, speed: 10, drifting: false }));
    expect(left.look + left.twist).toBeLessThan(-0.8);
    // Too far away to bother with.
    const far = run(spec('stand'), 4, () => ({ x: 10 + CROWD.noticeRadius + 20, z: 20, speed: 10, drifting: false }));
    expect(Math.abs(far.look + far.twist)).toBeLessThan(0.7);
  });

  it('turns the camera round to follow a car behind them', () => {
    const pose = run(spec('film'), 5, () => ({ x: 10, z: 32, speed: 12, drifting: false }));
    // Behind is a half turn: most of it with the whole body.
    expect(Math.abs(pose.turn)).toBeGreaterThan(2);
    expect(pose.item).toBe(1);
  });

  it('puts its arms in the air for a drift, and its phone up', () => {
    const drift = (): CrowdSubject => ({ x: 10, z: 5, speed: 15, drifting: true });
    const cheer = run(spec('stand'), 3, drift);
    expect(cheer.spreadL).toBeGreaterThan(2);
    expect(cheer.spreadR).toBeGreaterThan(2);
    const filming = run(spec('phone'), 3, drift);
    expect(filming.raiseR).toBeGreaterThan(1.1);
    expect(filming.item).toBe(1);
    // A plain drive past is not a show.
    const past = run(spec('stand'), 3, () => ({ x: 10, z: 5, speed: 15, drifting: false }));
    expect(past.spreadL).toBeLessThan(0.5);
  });

  it('steps back from a car coming straight at them, and no further than its spot allows', () => {
    const a = createActor(spec('stand'));
    const pose = createPose();
    let furthest = 0;
    let flinched = false;
    // From 12 m north of them, straight at them at 8 m/s, stopping 2.5 m short.
    for (let t = 0; t < 2; t += DT) {
      const z = Math.min(20 - 2.5, 8 + t * 8);
      stepActor(a, t, DT, { x: 10, z, speed: 8, drifting: false }, pose);
      furthest = Math.max(furthest, Math.hypot(pose.x, pose.z));
      if (pose.z > 0.1 && pose.lean < -0.1) flinched = true;
    }
    expect(flinched).toBe(true);
    expect(furthest).toBeLessThanOrEqual(CROWD.flinchStep + 1e-6);
  });

  it('paces its beat back and forth and never leaves it', () => {
    const s = spec('pace');
    const a = createActor(s);
    const pose = createPose();
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 40; t += DT) {
      stepActor(a, t, DT, null, pose);
      min = Math.min(min, pose.x);
      max = Math.max(max, pose.x);
      expect(Math.abs(pose.z)).toBeLessThan(1e-6);
    }
    // Both ends of a 3 m beat, and nothing past them.
    expect(min).toBeCloseTo(0, 1);
    expect(max).toBeCloseTo(3, 1);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(3);
  });

  it('sells: bends to the cooler every cycle and comes back up', () => {
    const a = createActor(spec('vendor'));
    const pose = createPose();
    let deepest = 0;
    let upright = 0;
    for (let t = 0; t < 16; t += DT) {
      stepActor(a, t, DT, null, pose);
      deepest = Math.max(deepest, pose.lean);
      if (pose.lean < 0.1) upright++;
    }
    expect(deepest).toBeGreaterThan(0.6);
    expect(upright * DT).toBeGreaterThan(6);
  });
  it("nods on the song's own beat by the meet's speakers, and on the clock elsewhere", () => {
    const pose = createPose();
    const nodAt = (s: ActorSpec, beats: number, clock: number): number => {
      speakerSong.beats = beats;
      stepActor(createActor(s), clock, DT, null, pose);
      return pose.nod;
    };
    speakerSong.x = 10;
    speakerSong.z = 18;
    try {
      const near = spec('vibe');
      // Head down on the beat, up between beats, whatever the wall clock says.
      expect(nodAt(near, 12, 3.3)).toBeGreaterThan(nodAt(near, 12.5, 3.3) + 0.2);
      // Speakers somewhere else: the song does not reach them.
      const far = spec('vibe', { x: 500, focus: { x: 500, z: 18 } });
      expect(nodAt(far, 12, 3.3)).toBeCloseTo(nodAt(far, 12.5, 3.3), 6);
      // No song playing: the clock at CROWD.bpm.
      expect(nodAt(near, NaN, 60 / CROWD.bpm)).toBeGreaterThan(nodAt(near, NaN, 30 / CROWD.bpm) + 0.2);
    } finally {
      speakerSong.beats = NaN;
    }
  });
});
