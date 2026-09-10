import { describe, expect, it } from 'vitest';
import { aimAlong, buildRoadGraph, createRouteAim, routeTo } from '../src/world/roadGraph';
import type { RoadPolyline } from '../src/world/roadGraph';
import { createCityWorld } from '../src/world/cityWorld';
import { PASSENGER } from '../src/config/tuning';

/**
 * The destination arrow is only ever as honest as this graph. These tests pin the two things
 * that would make it lie: a route that leaves the roads, and a route that points the long way
 * round. The last block runs both over the real city, because a network that works on a
 * hand-drawn cross and not on the streets the player drives is worth nothing.
 */

/** A plain plus sign: two 200 m streets crossing at the origin. */
const CROSS: RoadPolyline[] = [
  { points: [{ x: -100, z: 0 }, { x: 100, z: 0 }] },
  { points: [{ x: 0, z: -100 }, { x: 0, z: 100 }] },
];

/** A 200 m square block, each side its own street, so there are two ways round to anywhere. */
const BLOCK: RoadPolyline[] = [
  { points: [{ x: -100, z: -100 }, { x: 100, z: -100 }] },
  { points: [{ x: 100, z: -100 }, { x: 100, z: 100 }] },
  { points: [{ x: 100, z: 100 }, { x: -100, z: 100 }] },
  { points: [{ x: -100, z: 100 }, { x: -100, z: -100 }] },
];

describe('road graph', () => {
  it('cuts crossing streets into junctions', () => {
    const graph = buildRoadGraph(CROSS);
    // Four street ends and the crossing in the middle.
    expect(graph.nodes.length).toBe(5);
    // Each street is cut in two by the other.
    expect(graph.edges.length).toBe(4);
    const middle = graph.nodes.filter((n) => n.edges.length === 4);
    expect(middle.length).toBe(1);
    expect(middle[0].x).toBeCloseTo(0, 6);
    expect(middle[0].z).toBeCloseTo(0, 6);
  });

  it('welds the shared ends of streets laid end to end', () => {
    const graph = buildRoadGraph(BLOCK);
    // Four corners, nothing else: the ends meet, so they are one junction each.
    expect(graph.nodes.length).toBe(4);
    expect(graph.edges.length).toBe(4);
    for (const node of graph.nodes) expect(node.edges.length).toBe(2);
  });

  it('measures the road distance to the destination, not the straight line', () => {
    const graph = buildRoadGraph(CROSS);
    const field = routeTo(graph, { x: 0, z: 60 });
    expect(field).not.toBeNull();
    const aim = createRouteAim();
    // 40 m out along the east street: 40 m back to the crossing, then 60 m north.
    expect(aimAlong(graph, field!, 40, 0, 10, aim)).toBe(true);
    expect(aim.remaining).toBeCloseTo(100, 6);
    // Straight line would be 72 m. The graph knows about the corner.
    expect(aim.remaining).toBeGreaterThan(Math.hypot(40, 60));
  });

  it('points down the street the car is on until the junction, then turns', () => {
    const graph = buildRoadGraph(CROSS);
    const field = routeTo(graph, { x: 0, z: 60 })!;
    const aim = createRouteAim();

    // Standing 40 m east with a 10 m lookahead: still heading west, toward the crossing.
    aimAlong(graph, field, 40, 0, 10, aim);
    expect(aim.x).toBeCloseTo(30, 6);
    expect(aim.z).toBeCloseTo(0, 6);
    expect(aim.dirX).toBeCloseTo(-1, 6);
    expect(aim.dirZ).toBeCloseTo(0, 6);

    // Same spot, a 55 m lookahead: it has run through the crossing and turned north, 15 m up
    // the other street. This is the whole point of the thing — the turn is shown early.
    aimAlong(graph, field, 40, 0, 55, aim);
    expect(aim.x).toBeCloseTo(0, 6);
    expect(aim.z).toBeCloseTo(15, 6);
    expect(aim.dirX).toBeCloseTo(0, 6);
    expect(aim.dirZ).toBeCloseTo(1, 6);
  });

  it('stops at the destination rather than run past it', () => {
    const graph = buildRoadGraph(CROSS);
    const field = routeTo(graph, { x: 0, z: 60 })!;
    const aim = createRouteAim();
    // A lookahead far longer than the route that is left.
    aimAlong(graph, field, 0, 40, 400, aim);
    expect(aim.atGoal).toBe(true);
    expect(aim.x).toBeCloseTo(0, 6);
    expect(aim.z).toBeCloseTo(60, 6);
    expect(aim.remaining).toBeCloseTo(20, 6);
  });

  it('goes the short way round a block', () => {
    const graph = buildRoadGraph(BLOCK);
    // Destination on the north side, a little east of the north-west corner.
    const field = routeTo(graph, { x: -60, z: -100 })!;
    const aim = createRouteAim();
    // Car on the west side, 40 m south of that same corner: 40 m north then 40 m east is 80 m,
    // against 560 m the other way round.
    expect(aimAlong(graph, field, -100, -60, 10, aim)).toBe(true);
    expect(aim.remaining).toBeCloseTo(80, 6);
    expect(aim.dirZ).toBeCloseTo(-1, 6); // north, toward the near corner
  });

  it('never leaves the roads', () => {
    const graph = buildRoadGraph(BLOCK);
    const field = routeTo(graph, { x: -60, z: -100 })!;
    const aim = createRouteAim();
    // Walked from a dozen places round the block, at a dozen lookaheads, the aim point is
    // always ON one of the four streets: |x| or |z| is 100.
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const x = Math.cos(angle) * 100;
      const z = Math.sin(angle) * 100;
      for (let look = 5; look <= 200; look += 15) {
        expect(aimAlong(graph, field, x, z, look, aim)).toBe(true);
        const onStreet = Math.abs(Math.abs(aim.x) - 100) < 1e-6 || Math.abs(Math.abs(aim.z) - 100) < 1e-6;
        expect(onStreet).toBe(true);
      }
    }
  });
});

describe('road graph over the city', () => {
  const { layout } = createCityWorld();
  const network = layout.roadNetwork ?? [];
  const graph = buildRoadGraph(network);
  const stops = layout.passengerStops ?? [];

  it('the city ships a network with every street in it', () => {
    expect(network.length).toBeGreaterThan(0);
    expect(graph.nodes.length).toBeGreaterThan(10);
    expect(graph.edges.length).toBeGreaterThan(20);
  });

  it('every passenger stop can be routed to from every other', () => {
    expect(stops.length).toBeGreaterThan(1);
    const aim = createRouteAim();
    for (const to of stops) {
      const field = routeTo(graph, to);
      expect(field, `no route field for ${to.id}`).not.toBeNull();
      for (const from of stops) {
        if (from.id === to.id) continue;
        expect(aimAlong(graph, field!, from.x, from.z, PASSENGER.arrow.lookahead, aim), `${from.id} -> ${to.id}`).toBe(true);
        expect(isFinite(aim.remaining), `${from.id} -> ${to.id} unreachable`).toBe(true);
        // Roads are never shorter than the crow, and never absurdly longer either.
        const crow = Math.hypot(from.x - to.x, from.z - to.z);
        expect(aim.remaining).toBeGreaterThan(crow - 1);
        expect(aim.remaining).toBeLessThan(crow * 2.2 + 120);
      }
    }
  });

  it('the walk closes on the destination from anywhere in the city', () => {
    const to = stops[stops.length - 1];
    const field = routeTo(graph, to)!;
    const aim = createRouteAim();
    for (const from of stops) {
      if (from.id === to.id) continue;
      // Follow the arrow: step to its aim point over and over. It must reach the drop-off,
      // which is the property the player actually relies on.
      let x = from.x;
      let z = from.z;
      let last = Infinity;
      let steps = 0;
      while (steps < 400) {
        expect(aimAlong(graph, field, x, z, PASSENGER.arrow.lookahead, aim)).toBe(true);
        if (aim.remaining < 5) break;
        expect(aim.remaining, `${from.id}: route stopped shortening`).toBeLessThan(last + 1e-6);
        last = aim.remaining;
        x = aim.x;
        z = aim.z;
        steps++;
      }
      expect(aim.remaining, `${from.id} never arrived`).toBeLessThan(5);
    }
  });
});
