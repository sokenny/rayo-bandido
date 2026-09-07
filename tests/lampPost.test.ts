import { describe, expect, it } from 'vitest';
import { MeshBuilder } from '../src/render/scene/env/meshBuilder';
import type { EnvBuilders } from '../src/render/scene/env/builders';
import { lampPost } from '../src/render/scene/env/propsBuilder';
import { LAMP_SPARKS, lampSparkSeed } from '../src/render/scene/env/lampFaults';

/**
 * The street lamp fixture (`propsBuilder`'s `lampPost` and its `LAMP` proportions).
 *
 * These pin one rule, and it is the rule the fixture is designed around: a broken lamp goes
 * DARK, it never comes APART. Every lamp in the city is the same call with different
 * arguments, so the only thing that can make one look right and the one beside it look
 * half-missing is the fault seed — and the seed reaches the shader as a per-vertex attribute
 * that dims whatever carries it (`lampFaults.ts`). Put a structural piece in an emissive
 * builder and it stops being drawn for seconds at a time: that is how the head ended up
 * hanging in the air over a boom that had vanished from under it.
 *
 * So: metal goes in `props`, which has no fault channel at all and cannot dim; only the lens,
 * its halo and its pool of light on the road may take the seed.
 */

/** Just the three builders a lamp draws into. `lampPost` reads nothing else off `EnvBuilders`. */
function lampBuilders(): EnvBuilders {
  return {
    props: new MeshBuilder(true),
    neon: new MeshBuilder(true, true),
    glow: new MeshBuilder(true, true),
  } as unknown as EnvBuilders;
}

const POLE_H = 7.2;
const Y0 = 0.22;
/** Arm reaching 3.6 m toward -X off a pole at the origin: a plain city street lamp. */
function build(fault: number): EnvBuilders {
  const b = lampBuilders();
  lampPost(b, 0, 0, Y0, -1, 0, 3.6, POLE_H, 0xffd7a0, 8, fault);
  return b;
}

/** The y of every vertex in `mb` whose fault seed is non-zero, i.e. every piece that stutters. */
function faultingHeights(mb: MeshBuilder): number[] {
  const out: number[] = [];
  for (let i = 0; i < mb.faults.length; i++) {
    if (mb.faults[i] !== 0) out.push(mb.positions[i * 3 + 1]);
  }
  return out;
}

describe('the street lamp fixture', () => {
  it('builds exactly the same metal whether or not the lamp is broken', () => {
    // The column, the boot, the collar, the conduit, the boom and the head housing are the
    // lamp's body. A fault is a failing ballast, not a missing post.
    expect(build(0.7).props.positions).toEqual(build(0).props.positions);
    expect(build(0.7).props.colors).toEqual(build(0).props.colors);
  });

  it('puts nothing structural in a builder that can dim: props carries no fault channel', () => {
    // `MeshBuilder(true)` has no `aLampFault` attribute, so a piece drawn into `props` is
    // physically incapable of stuttering. This is the guarantee, not a convention.
    const b = build(0.7);
    expect(b.props.faults).toHaveLength(0);
    expect(b.props.build().getAttribute('aLampFault')).toBeUndefined();
    expect(b.props.triangles).toBeGreaterThan(60);
  });

  it('only lets the lens stutter, never the pole strips or the status pip', () => {
    const b = build(0.7);
    const heights = faultingHeights(b.neon);
    expect(heights.length, 'the lens, and only the lens').toBeGreaterThan(0);
    // The lens hangs off the boom near the top of the pole; the cyan strips run from a fifth
    // of the way up and the pip sits at half height, and none of those may go with the bulb.
    for (const y of heights) expect(y).toBeGreaterThan(Y0 + POLE_H * 0.8);
    // The strips and the pip are in the same builder and must all be un-tagged.
    expect(b.neon.faults.filter((f) => f === 0).length).toBeGreaterThan(0);
    expect(new Set(b.neon.faults)).toEqual(new Set([0, 0.7]));
  });

  it('takes the halo and the road pool down with the lens, so the light goes as one', () => {
    const b = build(0.7);
    const light = b.glow.faults.filter((f) => f >= 0);
    expect(light.length).toBeGreaterThan(0);
    expect(light.every((f) => f === 0.7)).toBe(true);
  });

  it('spits sparks off a broken head, and only off a broken one', () => {
    const b = build(0.7);
    const sparks = new Set(b.glow.faults.filter((f) => f < 0));
    // One seed per speck, each carrying this lamp's own fault seed in its fraction.
    expect(sparks).toEqual(
      new Set(Array.from({ length: LAMP_SPARKS.count }, (_, i) => lampSparkSeed(0.7, i))),
    );
    expect(build(0).glow.faults.some((f) => f < 0)).toBe(false);
  });

  it('hangs the sparks on the head, not on the pole', () => {
    const b = build(0.7);
    const ys: number[] = [];
    for (let i = 0; i < b.glow.faults.length; i++) {
      if (b.glow.faults[i] < 0) ys.push(b.glow.positions[i * 3 + 1]);
    }
    // Under the lens and above head height: a spark falling to the pavement is a different
    // effect, and one the car would drive through.
    for (const y of ys) expect(y).toBeGreaterThan(Y0 + POLE_H * 0.7);
    for (const y of ys) expect(y).toBeLessThan(Y0 + POLE_H);
  });

  it('leaves a healthy lamp untagged everywhere', () => {
    const b = build(0);
    expect(b.neon.faults.every((f) => f === 0)).toBe(true);
    expect(b.glow.faults.every((f) => f === 0)).toBe(true);
  });

  it('scales the whole fixture off the pole, so an alley stub is the same design', () => {
    const short = lampBuilders();
    lampPost(short, 0, 0, 0, -1, 0, 0.9, 4.4, 0xffd7a0, 6, 0);
    const tall = lampBuilders();
    lampPost(tall, 0, 0, 0, -1, 0, 4.6, 8.2, 0xffd7a0, 10, 0);
    // Same piece count either way: one kit, two sizes, never a second silhouette.
    expect(short.props.triangles).toBe(tall.props.triangles);
    expect(short.neon.triangles).toBe(tall.neon.triangles);
  });
});
