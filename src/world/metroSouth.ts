import type { CityRoadSpec } from './cityDef';
import type { Rect } from './cityPlan';
import type { TrackNode } from './track';

/**
 * EL SUR SIN GRILLA (2026-09-17): Juan found the south half of the metro too square — "las
 * ciudades no son tan cuadriculadas" — and asked for diagonals, roundabouts and streets that
 * curve, taking a real city's plan as the model, with The Stack, the Obelisco, Villa 31 and
 * everything else built there left alone. Approved from a plan view before it was built.
 *
 * The model is Buenos Aires' own and La Plata's: a grid kept, and cut across by diagonals that
 * meet at round plazas.
 *
 *   - PLAZA ESTRELLA, the big roundabout where av-central crosses av-s2, on La Loma's flank:
 *     seven streets leave it, as the Étoile's avenues leave the Arc,
 *   - DIAGONAL NORTE, from the star straight at the Obelisco, landing in the 9 de Julio's west
 *     file beside the plaza, as the real Diagonal Norte does,
 *   - DIAGONAL SUR, from the star down to PLAZA DEL PUERTO, a small roundabout on blvd-ring-w
 *     by the water,
 *   - AV. CURVA, an arch from the star over to the ROTONDA DE LAS PANTALLAS on blvd-ring-w at
 *     av-s2, the corner of the screens district (off La Curva's course, which turns a block
 *     north of it),
 *   - PASEO MEDIA LUNA, a long bow between the ring boulevards where st-s5 ran,
 *   - LA COSTANERA, st-s6 swinging toward the water and back, round the harbour plaza and clear
 *     of the Marea station,
 *   - CALLE VIEJA, the old town's crooked street from the star to the quay, where st-oldtown's
 *     south end ran (its last stretch is st-oldtown's, so the Marea's corner is unchanged),
 *   - BAJADA DEL PUERTO, a winding street from blvd-ring-e down to the waterfront.
 *
 * What the grid gives up for them is in `METRO_SOUTH_CUTS`. A road that ends at a roundabout
 * ends on its centreline, so the ribbons overlap and the junction is one piece of asphalt.
 *
 * Data only, with no runtime imports, so `scripts/metro-preview.mjs` can load the metro's spec
 * under plain Node.
 */

export interface RoundaboutSpec {
  tag: string;
  label: string;
  x: number;
  z: number;
  /** Radius of the ring road's centreline (m). */
  radius: number;
  /** Width of the ring road (m). */
  width: number;
  /** Radius of the island's kerb (m): solid, no blocks inside it. */
  island: number;
  /** What stands in the middle (`env/roundaboutBuilder.ts`). */
  monument: 'flower' | 'screens' | 'beacon';
}

const rotonda = (tag: string, label: string, x: number, z: number, radius: number, width: number, monument: RoundaboutSpec['monument']): RoundaboutSpec => ({
  tag,
  label,
  x,
  z,
  radius,
  width,
  island: radius - width / 2 - 1.5,
  monument,
});

export const ESTRELLA = rotonda('rot-estrella', 'PLAZA ESTRELLA', -60, 780, 58, 18, 'flower');
export const PANTALLAS = rotonda('rot-pantallas', 'ROTONDA DE LAS PANTALLAS', -340, 780, 36, 14, 'screens');
export const PUERTO = rotonda('rot-puerto', 'PLAZA DEL PUERTO', -340, 1095, 30, 14, 'beacon');
export const METRO_ROUNDABOUTS: RoundaboutSpec[] = [ESTRELLA, PANTALLAS, PUERTO];

/** A roundabout's ring road: a square round the centre, every corner filleted to its half-side. */
function ringSpec(r: RoundaboutSpec): CityRoadSpec {
  const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  return {
    tag: r.tag,
    kind: 'track',
    spec: { closed: true, nodes: corners.map(([a, b]) => ({ x: r.x + a * r.radius, z: r.z + b * r.radius, r: r.radius - 0.01, width: r.width, zone: 'urban' as const })) },
  };
}

/** The point on a roundabout's centreline at a bearing (degrees, from +x toward +z). */
function onRing(r: RoundaboutSpec, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [r.x + Math.cos(a) * r.radius, r.z + Math.sin(a) * r.radius];
}

type Zoner = (x: number, z: number) => TrackNode['zone'];

/** A road through `points` ([x, z, fillet]), each node zoned where it stands. */
function curved(tag: string, width: number, points: Array<[number, number, number?]>, zoneOf: Zoner): CityRoadSpec {
  return {
    tag,
    kind: 'track',
    spec: { closed: false, nodes: points.map(([x, z, r = 0]) => ({ x, z, r, width, zone: zoneOf(x, z) })) },
  };
}

/** The new roads, ring roads first. `zoneOf` is the metro's (passed in: this module imports nothing). */
export function metroSouthRoads(zoneOf: Zoner, shoreZ: number, eastX: number, westX: number): CityRoadSpec[] {
  return [
    ...METRO_ROUNDABOUTS.map(ringSpec),
    curved('diag-norte', 18, [onRing(ESTRELLA, -37.9), [441, 390]], zoneOf),
    curved('diag-sur', 18, [onRing(ESTRELLA, 132), onRing(PUERTO, -48)], zoneOf),
    curved('av-curva', 16, [onRing(PANTALLAS, -45), [-260, 675, 80], [-170, 655, 70], onRing(ESTRELLA, 225)], zoneOf),
    curved('paseo-luna', 14, [[-340, 870], [-200, 955, 330], [60, 985, 420], [250, 950, 300], [340, 900]], zoneOf),
    curved('costanera', 14, [onRing(PUERTO, 12), [-200, 1128, 160], [-40, 1128, 180], [110, 1090, 160], [250, 1040, 150], [400, 1060, 120], [eastX, 1060]], zoneOf),
    curved('costanera-w', 14, [[westX, 1060], [-470, 1060, 90], onRing(PUERTO, 180)], zoneOf),
    curved('calle-vieja', 12, [onRing(ESTRELLA, 45), [70, 880, 60], [95, 960, 50], [165, 1030, 60], [160, 1100, 40], [160, shoreZ]], zoneOf),
    curved('bajada-puerto', 12, [[340, 830], [410, 870, 45], [385, 960, 45], [440, 1030, 45], [430, shoreZ]], zoneOf),
  ];
}

/**
 * What the grid gives up: stretches of road removed between two coordinates along its run (x for
 * a road that runs east-west, z for north-south). A road cut in the middle is two roads; the
 * first keeps its tag, the rest take `names` in order. `drop` removes the road whole.
 */
export interface RoadCut {
  tag: string;
  ranges?: Array<[number, number]>;
  names?: string[];
  drop?: true;
}

export const METRO_SOUTH_CUTS: RoadCut[] = [
  { tag: 'av-central', ranges: [[ESTRELLA.z - ESTRELLA.radius, ESTRELLA.z + ESTRELLA.radius]], names: ['av-central-s'] },
  { tag: 'av-s2', ranges: [[PANTALLAS.x - PANTALLAS.radius, PANTALLAS.x + PANTALLAS.radius], [ESTRELLA.x - ESTRELLA.radius, ESTRELLA.x + ESTRELLA.radius]], names: ['av-s2-mid', 'av-s2-e'] },
  { tag: 'blvd-ring-w', ranges: [[PANTALLAS.z - PANTALLAS.radius, PANTALLAS.z + PANTALLAS.radius], [PUERTO.z - PUERTO.radius, PUERTO.z + PUERTO.radius]], names: ['blvd-ring-w-s', 'blvd-ring-w-q'] },
  { tag: 'st-s4', ranges: [[-340, 340]], names: ['st-s4-e'] },
  { tag: 'st-s5', ranges: [[-340, 340]], names: ['st-s5-e'] },
  { tag: 'st-oldtown', ranges: [[780, Infinity]] },
  { tag: 'st-s6', drop: true },
  { tag: 'alley-s1', drop: true },
];

/** A road cut as `METRO_SOUTH_CUTS` says. Roads must run monotonically along their axis where they are cut. */
export function cutRoads(roads: readonly CityRoadSpec[], cuts: readonly RoadCut[]): CityRoadSpec[] {
  const out: CityRoadSpec[] = [];
  for (const road of roads) {
    const cut = cuts.find((c) => c.tag === road.tag);
    if (!cut) {
      out.push(road);
      continue;
    }
    if (cut.drop) continue;
    const nodes = road.spec.nodes;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const alongX = Math.abs(last.x - first.x) > Math.abs(last.z - first.z);
    const key = (nd: { x: number; z: number }): number => (alongX ? nd.x : nd.z);
    const ascending = key(last) > key(first);
    const lo = Math.min(key(first), key(last));
    const hi = Math.max(key(first), key(last));
    // The kept intervals, in the order the road runs.
    const ranges = [...(cut.ranges ?? [])].sort((a, b) => a[0] - b[0]);
    const kept: Array<[number, number]> = [];
    let from = lo;
    for (const [a, b] of ranges) {
      if (a > from) kept.push([from, Math.min(a, hi)]);
      from = Math.max(from, b);
    }
    if (from < hi) kept.push([from, hi]);
    if (!ascending) kept.reverse();
    const pieces = kept.map(([a, b]) => slice(nodes, key, ascending ? a : b, ascending ? b : a));
    pieces.forEach((pieceNodes, i) => {
      if (pieceNodes.length < 2) return;
      const tag = i === 0 ? road.tag : (cut.names?.[i - 1] ?? `${road.tag}-${i}`);
      out.push({ tag, kind: road.kind, spec: { ...road.spec, nodes: pieceNodes } });
    });
  }
  return out;
}

/** The nodes of a polyline between two values of `key` (from < to in the road's direction), ends interpolated. */
function slice(nodes: readonly TrackNode[], key: (nd: TrackNode) => number, from: number, to: number): TrackNode[] {
  const dir = Math.sign(key(nodes[nodes.length - 1]) - key(nodes[0]));
  const inside = (v: number): boolean => (dir > 0 ? v > from + 0.01 && v < to - 0.01 : v < from - 0.01 && v > to + 0.01);
  const at = (v: number): TrackNode => {
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      const ka = key(a);
      const kb = key(b);
      if ((v - ka) * (v - kb) <= 0 && ka !== kb) {
        const t = (v - ka) / (kb - ka);
        return { ...a, r: 0, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, width: a.width + (b.width - a.width) * t, y: undefined };
      }
    }
    return { ...(dir > 0 === v <= key(nodes[0]) ? nodes[0] : nodes[nodes.length - 1]), r: 0 };
  };
  const mid = nodes.filter((nd) => inside(key(nd)));
  const out = [at(from), ...mid, at(to)].map((nd) => {
    const { y, ...rest } = nd;
    return y === undefined ? rest : nd;
  });
  // The ends of an open path take no fillet.
  out[0] = { ...out[0], r: 0 };
  out[out.length - 1] = { ...out[out.length - 1], r: 0 };
  return out;
}

/**
 * The traffic the new roads carry. The roundabouts are one-way, anticlockwise seen from above
 * (the metro drives on the right); the open roads are driven out and back, a file each way.
 */
export const METRO_SOUTH_RING_TRAFFIC: Array<{ tag: string; cars: number; lanes: number[]; oneWay: -1 }> = [
  { tag: ESTRELLA.tag, cars: 10, lanes: [-4.5, 0, 4.5], oneWay: -1 },
  { tag: PANTALLAS.tag, cars: 4, lanes: [-3, 3], oneWay: -1 },
  { tag: PUERTO.tag, cars: 4, lanes: [-3, 3], oneWay: -1 },
];

export const METRO_SOUTH_PATH_TRAFFIC: Array<{ tag: string; cars: number; lane: number }> = [
  { tag: 'diag-norte', cars: 8, lane: 3.5 },
  { tag: 'diag-sur', cars: 8, lane: 3.5 },
  { tag: 'av-curva', cars: 6, lane: 3 },
  { tag: 'paseo-luna', cars: 6, lane: 3 },
  { tag: 'costanera', cars: 8, lane: 3 },
  { tag: 'costanera-w', cars: 4, lane: 3 },
  { tag: 'calle-vieja', cars: 6, lane: 2.6 },
  { tag: 'bajada-puerto', cars: 4, lane: 2.6 },
  // What the rectangles lost: the stretches of the old grid between the roundabouts and the water.
  { tag: 'av-central-s', cars: 6, lane: 3.5 },
  { tag: 'blvd-ring-w-s', cars: 4, lane: 3.5 },
  { tag: 'av-s2-mid', cars: 2, lane: 3.5 },
  { tag: 'blvd-water', cars: 12, lane: 3.5 },
];

/** The rectangle round a roundabout's island. */
export function islandRect(r: RoundaboutSpec): Rect {
  return { minX: r.x - r.island, maxX: r.x + r.island, minZ: r.z - r.island, maxZ: r.z + r.island };
}
