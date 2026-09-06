import { describe, expect, it } from 'vitest';
import {
  buildTrackPath,
  createProjection,
  easedRise,
  isElevated,
  isOnPath,
  longestStraight,
  maxCornerAngle,
  maxGrade,
  maxHeight,
  minCornerRadius,
  pointAtStation,
  projectOntoPath,
  type TrackSpec,
} from '../src/world/track';

/** A 100 m square with 10 m fillets, driven clockwise (right turns). */
const square: TrackSpec = {
  closed: true,
  nodes: [
    { x: -50, z: 50, r: 10, width: 10, zone: 'urban' },
    { x: -50, z: -50, r: 10, width: 10, zone: 'urban' },
    { x: 50, z: -50, r: 10, width: 10, zone: 'urban' },
    { x: 50, z: 50, r: 10, width: 10, zone: 'urban' },
  ],
};

describe('track geometry', () => {
  it('replaces each corner with a fillet arc of the requested radius', () => {
    const path = buildTrackPath(square);
    // Four straights of 80 m plus a full circle of r = 10.
    expect(path.length).toBeCloseTo(4 * 80 + 2 * Math.PI * 10, 0);
    expect(path.pieces.filter((p) => p.kind === 'arc')).toHaveLength(4);
    expect(minCornerRadius(path)).toBe(10);
    expect(maxCornerAngle(path)).toBeCloseTo(Math.PI / 2, 5);
    expect(longestStraight(path)).toBeCloseTo(80, 5);
  });

  it('keeps every tangent unit length and every corner a right turn', () => {
    const path = buildTrackPath(square);
    for (const s of path.samples) {
      expect(Math.hypot(s.tx, s.tz)).toBeCloseTo(1, 6);
      expect(s.curvature).toBeGreaterThanOrEqual(0);
    }
    // The first samples head north (heading 0 = -Z) from the south-west corner.
    expect(path.samples[0].tz).toBeLessThan(0);
    expect(Math.abs(path.samples[0].tx)).toBeLessThan(1e-6);
  });

  it('stays on the fillet circle through the arc', () => {
    const path = buildTrackPath(square);
    for (const p of path.pieces) {
      if (p.kind !== 'arc') continue;
      for (const s of path.samples) {
        if (s.node !== p.node || s.curvature === 0) continue;
        expect(Math.hypot(s.x - p.cx, s.z - p.cz)).toBeCloseTo(p.r, 4);
      }
    }
  });

  it('refuses fillets that overlap on one edge', () => {
    const bad: TrackSpec = {
      closed: true,
      nodes: [
        { x: 0, z: 0, r: 30, width: 10, zone: 'urban', tag: 'a' },
        { x: 40, z: 0, r: 30, width: 10, zone: 'urban', tag: 'b' },
        { x: 40, z: 80, r: 5, width: 10, zone: 'urban' },
        { x: 0, z: 80, r: 5, width: 10, zone: 'urban' },
      ],
    };
    expect(() => buildTrackPath(bad)).toThrow(/a -> b/);
  });

  it('projects a point to the right station and lateral offset', () => {
    const path = buildTrackPath(square);
    const p = createProjection();
    // 20 m up the west straight, 3 m to the right (east) of the centreline.
    projectOntoPath(path, -47, 20, p);
    expect(p.s).toBeCloseTo(20, 1);
    expect(p.lateral).toBeCloseTo(3, 3);
    expect(p.dist).toBeCloseTo(3, 3);
    expect(p.halfWidth).toBe(5);
    expect(p.x).toBeCloseTo(-50, 3);
    expect(p.z).toBeCloseTo(20, 3);
    expect(isOnPath(path, -47, 20)).toBe(true);
    expect(isOnPath(path, -40, 20)).toBe(false);
    expect(isOnPath(path, -40, 20, 6)).toBe(true);
  });

  it('finds the same point from a station as from a projection', () => {
    const path = buildTrackPath(square);
    const p = createProjection();
    const q = createProjection();
    for (const s of [0, 12.5, 80, 95.7, 200, path.length - 1]) {
      pointAtStation(path, s, p);
      expect(p.s).toBeCloseTo(s, 6);
      projectOntoPath(path, p.x, p.z, q);
      expect(q.s).toBeCloseTo(s, 3);
      expect(q.dist).toBeLessThan(1e-3);
    }
    // Wraps on a closed path.
    pointAtStation(path, path.length + 5, p);
    expect(p.s).toBeCloseTo(5, 6);
  });

  it('interpolates the width along a straight and honours open ends', () => {
    const open = buildTrackPath({
      closed: false,
      nodes: [
        { x: 0, z: 0, r: 0, width: 8, zone: 'jdm' },
        { x: 0, z: -40, r: 12, width: 16, zone: 'jdm' },
        { x: 40, z: -40, r: 0, width: 16, zone: 'jdm' },
      ],
    });
    expect(open.closed).toBe(false);
    expect(open.samples[0].halfWidth).toBe(4);
    const last = open.samples[open.samples.length - 1];
    expect(last.halfWidth).toBe(8);
    expect(last.x).toBeCloseTo(40, 6);
    expect(last.z).toBeCloseTo(-40, 6);
    // Length: two legs shortened by the tangent length t = 12, plus a quarter circle.
    expect(open.length).toBeCloseTo(28 + 28 + (Math.PI / 2) * 12, 0);
  });
});

describe('heights', () => {
  it('eases a rise in and out and never overshoots', () => {
    expect(easedRise(0)).toBe(0);
    expect(easedRise(1)).toBe(1);
    let last = 0;
    for (let u = 0; u <= 1.0001; u += 0.01) {
      const y = easedRise(u);
      expect(y).toBeGreaterThanOrEqual(last - 1e-9);
      expect(y).toBeLessThanOrEqual(1 + 1e-9);
      last = y;
    }
    // Flat at both ends, steeper than the average in the middle.
    expect(easedRise(0.02)).toBeLessThan(0.02);
    expect(easedRise(0.98)).toBeGreaterThan(0.98);
    expect(easedRise(0.5)).toBeCloseTo(0.5, 6);
  });

  it('interpolates between anchored nodes and holds the ends of an open path', () => {
    const spec: TrackSpec = {
      closed: false,
      nodes: [
        { x: 0, z: 0, r: 0, width: 10, zone: 'urban', y: 0 },
        { x: 0, z: -100, r: 0, width: 10, zone: 'urban' },
        { x: 0, z: -200, r: 0, width: 10, zone: 'urban', y: 20 },
        { x: 0, z: -260, r: 0, width: 10, zone: 'urban' },
      ],
    };
    const path = buildTrackPath(spec);
    expect(path.samples[0].y).toBe(0);
    expect(maxHeight(path)).toBe(20);
    expect(isElevated(path)).toBe(true);
    // One smooth run from the first anchor to the second, no kink at the unmarked node.
    const mid = path.samples.find((s) => Math.abs(s.z + 100) < 1e-6)!;
    expect(mid.y).toBeCloseTo(10, 3);
    // Held at 20 past the last anchor.
    expect(path.samples[path.samples.length - 1].y).toBe(20);
    expect(maxGrade(path)).toBeLessThan(0.14);
    expect(maxGrade(path)).toBeGreaterThan(0.1);
    // Projections carry the height too.
    const p = projectOntoPath(path, 3, -50, createProjection());
    expect(p.y).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(10);
  });

  it('is flat when no node carries a height', () => {
    const path = buildTrackPath({
      closed: true,
      nodes: [
        { x: 0, z: 0, r: 10, width: 8, zone: 'urban' },
        { x: 100, z: 0, r: 10, width: 8, zone: 'urban' },
        { x: 100, z: 100, r: 10, width: 8, zone: 'urban' },
        { x: 0, z: 100, r: 10, width: 8, zone: 'urban' },
      ],
    });
    for (const s of path.samples) expect(s.y).toBe(0);
    expect(isElevated(path)).toBe(false);
  });
});
