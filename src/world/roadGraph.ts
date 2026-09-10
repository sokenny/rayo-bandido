/**
 * Route-finding over a street network: which way round the block the destination actually is.
 *
 * WHY THIS EXISTS. The passenger drop-off is marked on the map and by a ring of light on the
 * tarmac, but between the car and that ring there are buildings, and an arrow pointing straight
 * through them is an arrow that sends the player into a wall. So the destination arrow
 * (`render/scene/env/destinationArrow.ts`) is aimed along the ROADS, and this is the module
 * that knows where they go.
 *
 * WHAT IT IS. The world hands over its street centrelines as polylines
 * (`ArenaLayout.roadNetwork`). Build finds every place two of them cross, cuts the polylines
 * there, and keeps what is left: junctions as nodes, the stretches between them as edges, each
 * edge remembering which polyline it came from and which slice of it — so a route is not a list
 * of corners but the real curve of the road, sweepers included.
 *
 * HOW IT IS USED. Once per trip: `routeTo(graph, destination)` runs Dijkstra OUTWARD FROM THE
 * DESTINATION and keeps the road distance from every junction to it. Then, every frame,
 * `aimAlong(...)` projects the car onto the nearest road, reads the field to decide which way
 * is shorter, and walks that far along the roads to find the point the arrow should hover over.
 * The per-frame half allocates nothing: one scan of the segments and a walk over at most
 * `MAX_HOPS` junctions.
 *
 * WHAT IT IS NOT. Ground level only — the world decides what goes into the network, and the
 * city leaves out the viaduct and its ramps, because every passenger stop is a kerb on a
 * street. A car up on the deck is routed along the street below it, which still points the
 * right way even though it cannot name the ramp.
 */

/** One street centreline. Same shape as an entry of `ArenaLayout.roadNetwork`. */
export interface RoadPolyline {
  points: ReadonlyArray<{ x: number; z: number }>;
}

/** Two junctions closer than this (m) are the same junction. */
const WELD = 0.75;
/** A stretch of road shorter than this (m) is not worth an edge of its own. */
const MIN_EDGE = 1.5;
/** How many junctions one aim-walk may pass through before it gives up. Lookaheads are short. */
const MAX_HOPS = 24;

interface Poly {
  xs: Float64Array;
  zs: Float64Array;
  /** Station of each point: distance along the polyline from point 0 (m). */
  ss: Float64Array;
  length: number;
  /** Edges lying on this polyline, in station order. */
  edges: number[];
}

interface Junction {
  x: number;
  z: number;
  /** Indices into `edges` of everything that meets here. */
  edges: number[];
}

/** One stretch of one polyline, between two junctions. `sA < sB` always. */
interface RoadEdge {
  poly: number;
  a: number;
  b: number;
  sA: number;
  sB: number;
  /** Length (m), equal to `sB - sA`. */
  w: number;
}

export interface RoadGraph {
  polys: Poly[];
  nodes: Junction[];
  edges: RoadEdge[];
}

/** Where the destination is, and how far every junction is from it along the roads. */
export interface RouteField {
  /** Road distance from each junction to the destination (m). `Infinity` = cannot get there. */
  dist: Float64Array;
  /** The edge the destination itself sits on, and where along that edge's polyline. */
  goalEdge: number;
  goalS: number;
  goalX: number;
  goalZ: number;
}

/** The answer `aimAlong` writes into. Reused frame to frame; never allocated in the loop. */
export interface RouteAim {
  /** Where the arrow should hover. */
  x: number;
  z: number;
  /** Unit direction the road runs there, pointing the way to go. */
  dirX: number;
  dirZ: number;
  /** Road distance from the car to the destination (m). */
  remaining: number;
  /** The lookahead ran past the destination: the aim point IS the destination. */
  atGoal: boolean;
}

export function createRouteAim(): RouteAim {
  return { x: 0, z: 0, dirX: 0, dirZ: -1, remaining: 0, atGoal: false };
}

/* ------------------------------------------------------------------ build */

export function buildRoadGraph(lines: ReadonlyArray<RoadPolyline>): RoadGraph {
  const polys: Poly[] = [];
  for (const line of lines) {
    const n = line.points.length;
    if (n < 2) continue;
    const xs = new Float64Array(n);
    const zs = new Float64Array(n);
    const ss = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = line.points[i].x;
      zs[i] = line.points[i].z;
      if (i > 0) ss[i] = ss[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    }
    polys.push({ xs, zs, ss, length: ss[n - 1], edges: [] });
  }

  const nodes: Junction[] = [];
  const byKey = new Map<string, number>();
  /** A junction at this point, welding anything within `WELD` onto the one already there. */
  const junctionAt = (x: number, z: number): number => {
    const kx = Math.round(x / WELD);
    const kz = Math.round(z / WELD);
    // An earlier junction may have landed the other side of a cell boundary, so the nine cells
    // around this one are all candidates.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const hit = byKey.get(`${kx + dx}:${kz + dz}`);
        if (hit !== undefined && Math.hypot(nodes[hit].x - x, nodes[hit].z - z) <= WELD) return hit;
      }
    }
    const id = nodes.length;
    nodes.push({ x, z, edges: [] });
    byKey.set(`${kx}:${kz}`, id);
    return id;
  };

  /** Stations on each polyline that must become junctions: both ends, plus every crossing. */
  const cuts: Array<Array<{ s: number; node: number }>> = polys.map(() => []);
  for (let i = 0; i < polys.length; i++) {
    const p = polys[i];
    const last = p.xs.length - 1;
    cuts[i].push({ s: 0, node: junctionAt(p.xs[0], p.zs[0]) });
    cuts[i].push({ s: p.length, node: junctionAt(p.xs[last], p.zs[last]) });
  }

  // Every crossing, by brute force over the segment pairs. A few hundred segments, once, at
  // world build: not worth a spatial index, and a wrong index here would silently lose a street.
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const a = polys[i];
      const b = polys[j];
      for (let k = 0; k + 1 < a.xs.length; k++) {
        const ax = a.xs[k];
        const az = a.zs[k];
        const aux = a.xs[k + 1] - ax;
        const auz = a.zs[k + 1] - az;
        for (let m = 0; m + 1 < b.xs.length; m++) {
          const bx = b.xs[m];
          const bz = b.zs[m];
          const bux = b.xs[m + 1] - bx;
          const buz = b.zs[m + 1] - bz;
          const denom = aux * buz - auz * bux;
          if (Math.abs(denom) < 1e-9) continue; // parallel: two streets that never meet
          const t = ((bx - ax) * buz - (bz - az) * bux) / denom;
          const u = ((bx - ax) * auz - (bz - az) * aux) / denom;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const node = junctionAt(ax + aux * t, az + auz * t);
          cuts[i].push({ s: a.ss[k] + Math.hypot(aux, auz) * t, node });
          cuts[j].push({ s: b.ss[m] + Math.hypot(bux, buz) * u, node });
        }
      }
    }
  }

  const edges: RoadEdge[] = [];
  for (let i = 0; i < polys.length; i++) {
    const list = cuts[i];
    list.sort((l, r) => l.s - r.s);
    let prev = list[0];
    for (let c = 1; c < list.length; c++) {
      const cur = list[c];
      // Two crossings within a car's length of each other are one junction as far as a driver
      // is concerned; keeping both would make an edge nobody can steer along.
      if (cur.s - prev.s < MIN_EDGE || cur.node === prev.node) continue;
      const id = edges.length;
      edges.push({ poly: i, a: prev.node, b: cur.node, sA: prev.s, sB: cur.s, w: cur.s - prev.s });
      nodes[prev.node].edges.push(id);
      nodes[cur.node].edges.push(id);
      polys[i].edges.push(id);
      prev = cur;
    }
  }

  return { polys, nodes, edges };
}

/* ------------------------------------------------------------------ geometry */

interface OnPoly {
  x: number;
  z: number;
  tx: number;
  tz: number;
}

/** Position and unit tangent of a polyline at station `s`, written into `out`. */
function pointAt(poly: Poly, s: number, out: OnPoly): void {
  const n = poly.xs.length;
  const clamped = s < 0 ? 0 : s > poly.length ? poly.length : s;
  // A linear scan from the start: these polylines are short and this runs a handful of times a
  // frame. A binary search would be faster in theory and one more thing to get wrong in practice.
  let i = 0;
  while (i + 2 < n && poly.ss[i + 1] < clamped) i++;
  const segLen = poly.ss[i + 1] - poly.ss[i];
  const t = segLen > 1e-6 ? (clamped - poly.ss[i]) / segLen : 0;
  const dx = poly.xs[i + 1] - poly.xs[i];
  const dz = poly.zs[i + 1] - poly.zs[i];
  const inv = segLen > 1e-6 ? 1 / segLen : 0;
  out.x = poly.xs[i] + dx * t;
  out.z = poly.zs[i] + dz * t;
  out.tx = dx * inv;
  out.tz = dz * inv;
}

/** Nearest point on the whole network to (x, z): which polyline, where along it, which edge. */
interface Projection {
  poly: number;
  s: number;
  dist: number;
  edge: number;
}
const scratchProjection: Projection = { poly: -1, s: 0, dist: Infinity, edge: -1 };
const scratchPoint: OnPoly = { x: 0, z: 0, tx: 0, tz: 0 };

function project(graph: RoadGraph, x: number, z: number, out: Projection): boolean {
  out.poly = -1;
  out.edge = -1;
  out.dist = Infinity;
  for (let i = 0; i < graph.polys.length; i++) {
    const p = graph.polys[i];
    if (p.edges.length === 0) continue; // a street nothing ever joined: nowhere to route from
    for (let k = 0; k + 1 < p.xs.length; k++) {
      const ax = p.xs[k];
      const az = p.zs[k];
      const ux = p.xs[k + 1] - ax;
      const uz = p.zs[k + 1] - az;
      const len2 = ux * ux + uz * uz;
      if (len2 < 1e-9) continue;
      let t = ((x - ax) * ux + (z - az) * uz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + ux * t;
      const pz = az + uz * t;
      const d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < out.dist) {
        out.dist = d;
        out.poly = i;
        out.s = p.ss[k] + Math.sqrt(len2) * t;
      }
    }
  }
  if (out.poly < 0) return false;
  out.dist = Math.sqrt(out.dist);
  // Which stretch between two junctions that station falls in. The ends of a street can fall
  // just outside every stretch (a stub too short to have earned an edge), so an exact miss
  // falls back to the nearest stretch rather than reporting no road at all.
  const p = graph.polys[out.poly];
  let bestGap = Infinity;
  for (const id of p.edges) {
    const e = graph.edges[id];
    const gap = out.s < e.sA ? e.sA - out.s : out.s > e.sB ? out.s - e.sB : 0;
    if (gap < bestGap) {
      bestGap = gap;
      out.edge = id;
      if (gap === 0) break;
    }
  }
  if (out.edge < 0) return false;
  const e = graph.edges[out.edge];
  out.s = out.s < e.sA ? e.sA : out.s > e.sB ? e.sB : out.s;
  return true;
}

/* ------------------------------------------------------------------ routing */

/**
 * Road distance from every junction to `target`. Built once when a ride starts; `aimAlong`
 * reads it every frame and never rebuilds it.
 */
export function routeTo(graph: RoadGraph, target: { x: number; z: number }): RouteField | null {
  const p = scratchProjection;
  if (!project(graph, target.x, target.z, p)) return null;
  const goal = graph.edges[p.edge];

  const dist = new Float64Array(graph.nodes.length).fill(Infinity);
  const done = new Uint8Array(graph.nodes.length);
  // The destination is not a junction: it sits somewhere along one edge, so the search starts
  // from the two junctions at that edge's ends, each already the right distance away.
  dist[goal.a] = p.s - goal.sA;
  dist[goal.b] = goal.sB - p.s;
  // Dijkstra, picking the nearest unfinished node by a linear scan. A block network is tens of
  // junctions; a heap would cost more to read than it would ever save to run.
  for (;;) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < dist.length; i++) {
      if (!done[i] && dist[i] < bestDist) {
        bestDist = dist[i];
        best = i;
      }
    }
    if (best < 0) break;
    done[best] = 1;
    for (const id of graph.nodes[best].edges) {
      const e = graph.edges[id];
      const other = e.a === best ? e.b : e.a;
      const via = bestDist + e.w;
      if (via < dist[other]) dist[other] = via;
    }
  }

  pointAt(graph.polys[p.poly], p.s, scratchPoint);
  return { dist, goalEdge: p.edge, goalS: p.s, goalX: scratchPoint.x, goalZ: scratchPoint.z };
}

/** What leaving junction `node` by `id` costs: to the destination if it is on that edge. */
function costVia(graph: RoadGraph, field: RouteField, node: number, id: number): number {
  const e = graph.edges[id];
  if (id === field.goalEdge) return Math.abs(field.goalS - (e.a === node ? e.sA : e.sB));
  const other = e.a === node ? e.b : e.a;
  return e.w + field.dist[other];
}

/**
 * Walk `lookahead` metres along the route from the car and report the point reached.
 *
 * This is the whole arrow: where it hovers, and which way it points. Walking the roads rather
 * than pointing straight at the destination is what makes it swing INTO a side street a block
 * before the junction, the way the NFS Underground 2 arrow did — the player reads the next move
 * off the arrow's angle, not off a line drawn through the buildings.
 *
 * Returns false when the car is nowhere near a road the destination can be reached from; the
 * caller hides the arrow rather than point it somewhere invented.
 */
export function aimAlong(
  graph: RoadGraph,
  field: RouteField,
  x: number,
  z: number,
  lookahead: number,
  out: RouteAim,
): boolean {
  const p = scratchProjection;
  if (!project(graph, x, z, p)) return false;

  let edgeId = p.edge;
  let edge = graph.edges[edgeId];
  let station = p.s;
  /** The junction this stretch is being driven towards, or -1 when it ends at the destination. */
  let node: number;
  let target: number;

  if (edgeId === field.goalEdge) {
    target = field.goalS;
    node = -1;
    out.remaining = Math.abs(field.goalS - station);
  } else {
    const costA = station - edge.sA + field.dist[edge.a];
    const costB = edge.sB - station + field.dist[edge.b];
    if (!isFinite(costA) && !isFinite(costB)) return false;
    if (costA <= costB) {
      target = edge.sA;
      node = edge.a;
      out.remaining = costA;
    } else {
      target = edge.sB;
      node = edge.b;
      out.remaining = costB;
    }
  }

  let left = lookahead;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const span = Math.abs(target - station);
    const forward = target >= station;
    if (left <= span || node < 0) {
      // Stopping inside this stretch: either the lookahead ran out, or the stretch ends at the
      // destination and the lookahead ran past it.
      const stop = left <= span ? station + (forward ? left : -left) : target;
      pointAt(graph.polys[edge.poly], stop, scratchPoint);
      out.x = scratchPoint.x;
      out.z = scratchPoint.z;
      out.dirX = forward ? scratchPoint.tx : -scratchPoint.tx;
      out.dirZ = forward ? scratchPoint.tz : -scratchPoint.tz;
      out.atGoal = left > span;
      return true;
    }
    left -= span;
    // At a junction: leave by whichever road reaches the destination soonest. The stretch just
    // driven is excluded, so a tie can never turn the arrow back on itself.
    let bestEdge = -1;
    let bestCost = Infinity;
    for (const id of graph.nodes[node].edges) {
      if (id === edgeId) continue;
      const cost = costVia(graph, field, node, id);
      if (cost < bestCost) {
        bestCost = cost;
        bestEdge = id;
      }
    }
    if (bestEdge < 0 || !isFinite(bestCost)) {
      // A dead end, or the junction itself is as close as the roads get: stop the arrow on the
      // spot rather than send it back the way it came.
      pointAt(graph.polys[edge.poly], target, scratchPoint);
      out.x = scratchPoint.x;
      out.z = scratchPoint.z;
      out.dirX = forward ? scratchPoint.tx : -scratchPoint.tx;
      out.dirZ = forward ? scratchPoint.tz : -scratchPoint.tz;
      out.atGoal = true;
      return true;
    }
    edgeId = bestEdge;
    edge = graph.edges[edgeId];
    station = edge.a === node ? edge.sA : edge.sB;
    if (edgeId === field.goalEdge) {
      target = field.goalS;
      node = -1;
    } else {
      const other = edge.a === node ? edge.b : edge.a;
      target = edge.a === other ? edge.sA : edge.sB;
      node = other;
    }
  }
  return true;
}
