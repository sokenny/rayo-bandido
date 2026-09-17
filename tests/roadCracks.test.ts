import { describe, expect, it } from 'vitest';
import { createBuilders } from '../src/render/scene/env/builders';
import { buildRoadCracks } from '../src/render/scene/env/roadCracks';
import { createOpenWorld } from '../src/world/openWorld';
import { createProjection, offsetAtStation, projectOntoPath } from '../src/world/track';

/**
 * THE CRACKS IN THE CITY'S ASPHALT (`src/render/scene/env/roadCracks.ts`).
 *
 * They are paint, not damage: flat on the road, hairline-thin, nowhere near the size of the
 * Obelisco's quake fissure, and nothing the car can feel. The contract here is that they stay
 * that way — every crack lies in one horizontal plane, stays on the asphalt it belongs to, and
 * turns up where the city is tired rather than evenly over every street.
 */
const { plan } = createOpenWorld();
const b = createBuilders(plan);
buildRoadCracks(b);
const pos = b.props.positions;

/** One crack quad: the near and far ends of one step of the polyline, and how wide it is. */
interface Quad {
  x: number;
  z: number;
  /** Heights of the two lips at the near end and at the far end. */
  nearY: [number, number];
  farY: number;
  /** Width across the crack (m) and length along it (m). */
  width: number;
  length: number;
}
const quads: Quad[] = [];
// Two triangles per quad, nine floats each: a, b, c and a, c, d.
for (let i = 0; i + 17 < pos.length; i += 18) {
  // Triangle one is the quad's a, b, c: the two lips of the near end and one lip of the far end.
  const a = [pos[i], pos[i + 1], pos[i + 2]];
  const bb = [pos[i + 3], pos[i + 4], pos[i + 5]];
  const c = [pos[i + 6], pos[i + 7], pos[i + 8]];
  quads.push({
    x: (a[0] + c[0]) / 2,
    z: (a[2] + c[2]) / 2,
    nearY: [a[1], bb[1]],
    farY: c[1],
    width: Math.hypot(a[0] - bb[0], a[2] - bb[2]),
    length: Math.hypot((a[0] + bb[0]) / 2 - c[0], (a[2] + bb[2]) / 2 - c[2]),
  });
}

describe('the cracks in the asphalt', () => {
  it('cracks a good part of the city without paving it in them', () => {
    // Enough that a drive crosses them regularly; few enough that the street is not a ruin.
    expect(quads.length).toBeGreaterThan(4000);
    expect(quads.length).toBeLessThan(60000);
  });

  it('keeps every crack hairline and level across: no relief for the car to feel', () => {
    for (const q of quads) {
      // The two lips are always at one height, so a crack is never a step the wheel meets.
      expect(q.nearY[0]).toBe(q.nearY[1]);
      // Along its run it only leans with the road under it (`terrain.ts`, `roadRelief`).
      expect(Math.abs(q.farY - q.nearY[0])).toBeLessThan(0.2 * Math.max(0.05, q.length));
      // The Obelisco's fissure is metres across; a street crack is a hand's width at most.
      expect(q.width).toBeLessThan(0.3);
    }
  });

  it('lays them on the asphalt, never out on the pavement', () => {
    const proj = createProjection();
    let off = 0;
    for (const q of quads) {
      let on = false;
      for (const rb of plan.ribbons) {
        const p = projectOntoPath(rb.path, q.x, q.z, proj);
        if (p.dist <= p.halfWidth) {
          on = true;
          break;
        }
      }
      if (!on) off++;
    }
    // A crack's tip may sit a few centimetres past a curve's inside edge; nothing more.
    expect(off / quads.length).toBeLessThan(0.01);
  });

  it('puts more of them where the city is more far gone', () => {
    // Crack quads per metre of road, over the tired stretches and over the kept ones.
    const tired = { road: 0, cracks: 0 };
    const kept = { road: 0, cracks: 0 };
    const bucket = (x: number, z: number): typeof tired | null => {
      const i = b.reclaim.intensityAt(x, z);
      return i > 0.5 ? tired : i < 0.25 ? kept : null;
    };
    for (const rb of plan.ribbons) {
      for (let s = 0; s < rb.path.length; s += 20) {
        const p = offsetAtStation(rb.path, s, 0);
        const into = bucket(p.x, p.z);
        if (into) into.road += 20;
      }
    }
    for (const q of quads) {
      const into = bucket(q.x, q.z);
      if (into) into.cracks++;
    }
    expect(tired.road).toBeGreaterThan(1000);
    expect(kept.road).toBeGreaterThan(1000);
    expect(tired.cracks / tired.road).toBeGreaterThan((kept.cracks / kept.road) * 1.8);
  });
});
