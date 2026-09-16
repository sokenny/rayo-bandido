import type { CityRoadSpec, ElevatedRoadSpec } from './cityDef';
import type { Rect } from './cityPlan';
// Value imports spelt with their extension, so `scripts/metro-preview.mjs` can load the metro's
// spec under plain Node (see `metroSpec.ts`).
import { blobContour, smoothContour, windUp, type Contour, type LowWallSpec, type ParkEncounterSpec, type ParkReliefSpec, type ParkSpec, type Pt } from './park.ts';
import { buildTrackPath, createProjection, offsetAtStation, projectOntoPath, type TrackNode, type TrackSpec } from './track.ts';

/**
 * EL PARQUE (2026-09-16): Bandido Metro's north edge given up for a park, after the Bosques de
 * Palermo in Buenos Aires — the lakes, the loop road round them, the planetarium on its lawn,
 * the willows at the water, and the people who spend their nights there with the skyline of
 * downtown across the trees to the south.
 *
 * Read with north up (x east, z south). The park runs the whole width of the map, 500 m deep,
 * between the old north wall (now the low wall at `PARK_SOUTH`) and the new one; the city's
 * grid is untouched — its blocks are still generated inside `METRO_CITY` (`CitySpec.blockBounds`)
 * and its streets still stop where they stopped — and three of its avenues run on into the park.
 *
 *   - THE LAKE is one body of water in two lobes joined by a strait: the big western lobe with
 *     two islands, the smaller eastern one with one. The bed falls away from every shore over
 *     five metres (`park.ts`, `LAKE`): a car that leaves the road by the water rolls in.
 *   - THE LOOP (`park-loop`, 12 m, closed) goes clockwise round both lobes: a long west leg
 *     bulging out round the big lobe, a north leg under the trees, an east leg past the
 *     planetarium, and a south leg that swings up between the two lobes to the water's edge —
 *     the curve that reveals the lake. Two lay-bys, one on the south leg by the lake and one on
 *     the east leg, are widenings of the road itself (`layBy`), so they are asphalt the car can
 *     stop on without leaving the lane.
 *   - THE CROSS ROAD (`park-cross-s`, `park-cross-n`) runs north from where the central avenue
 *     meets the loop, over the strait on a short humped bridge (`park-bridge`, an elevated road
 *     like the ramps, so it gets its rails and its slab from the assembler) to the north leg: the
 *     loop becomes two circuits, one round each lobe, and the bridge is on both.
 *   - THREE WAYS IN: st-w3, av-central and st-e3 run on north through gaps in the park's wall and
 *     across the loop (`PARK_ENTRIES` is how far: `metroSpec.ts` reads it when it lays them),
 *     so each junction is a real crossing for the road graph and the lane paint runs through.
 *   - THE PLANETARIUM stands on the east lawn, ringed by palms, its ring lit cyan: the landmark
 *     seen from the east leg, the north leg and across the small lobe.
 *   - THE LAND ROLLS (`PARK_RELIEF`): swells the roads ride, knolls on the lawns, level at the
 *     water. The loop has a pavement on its lake side all the way round, and on both sides of
 *     the south leg, with bollard lamps along it (`sidewalks`).
 *   - THE PEOPLE (`PARK_ENCOUNTERS`): four meeting places, each a few named characters with a
 *     pose and something to do, as ambience — no lines yet. Who they are is written by each one.
 *
 * Everything positional is in world metres. `scripts/metro-preview.mjs` draws it.
 */

/** The old north wall's inner face was z -638; the park's wall stands two metres north of it. */
export const PARK_SOUTH = -640;
/** The map's new north edge. */
export const PARK_NORTH = -1150;
/** Perimeter band of the metro (m), repeated so this module stays clear of `metroSpec.ts`. */
const WALL_BAND = 12;

export const PARK_LAND: Rect = { minX: -700 + WALL_BAND, maxX: 700 - WALL_BAND, minZ: PARK_NORTH + WALL_BAND, maxZ: PARK_SOUTH };

/* ------------------------------------------------------------------ the lake */

/**
 * The shore, drawn by hand as twenty-five control points and smoothed twice: the big lobe west
 * of x -100, the strait 25 m wide at x -45 (where the bridge crosses), the small lobe east of it.
 */
const SHORE_CONTROL: Contour = [
  { x: -372, z: -905 },
  { x: -350, z: -960 },
  { x: -300, z: -1000 },
  { x: -230, z: -1008 },
  { x: -150, z: -985 },
  { x: -108, z: -940 },
  { x: -92, z: -893 },
  { x: -40, z: -889 },
  { x: 14, z: -900 },
  { x: 40, z: -940 },
  { x: 105, z: -955 },
  { x: 170, z: -935 },
  { x: 212, z: -880 },
  { x: 195, z: -820 },
  { x: 130, z: -792 },
  { x: 60, z: -805 },
  { x: 20, z: -840 },
  { x: -10, z: -866 },
  { x: -45, z: -864 },
  { x: -95, z: -868 },
  { x: -130, z: -830 },
  { x: -190, z: -800 },
  { x: -260, z: -798 },
  { x: -320, z: -830 },
  { x: -360, z: -870 },
];

export const PARK_SHORE: Contour = windUp(smoothContour(SHORE_CONTROL, 2));

/** The islands: one big one with the footbridge to it, a small one mid-lake, one in the small lobe. */
export const PARK_ISLANDS: Contour[] = [
  windUp(blobContour(-300, -955, 18, 13, 20, 3)),
  windUp(blobContour(-200, -880, 13, 10, 16, 7)),
  windUp(blobContour(135, -880, 12, 9, 16, 11)),
];

/* ------------------------------------------------------------------ the roads */

const PARK_ROAD_W = 12;
const CROSS_W = 11;

const n = (x: number, z: number, r: number, width: number, y?: number): TrackNode => ({ x, z, r, width, zone: 'urban', ...(y !== undefined ? { y } : {}) });

/**
 * A lay-by: the road widened by `extra` on one side for `len` metres, tapering in and out
 * over `taper`, as four nodes on the straight from `a` to `b`, `at` metres from `a`. The
 * centreline is stepped out by half the extra so the inner edge stays exactly where it was.
 * `side` +1 is the right of travel from `a` to `b`.
 */
function layBy(a: Pt, b: Pt, at: number, len: number, extra: number, side: 1 | -1, width: number, taper = 12): TrackNode[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = Math.hypot(dx, dz);
  const tx = dx / l;
  const tz = dz / l;
  // Right of (tx, tz) is (-tz, tx).
  const nx = -tz * side;
  const nz = tx * side;
  const along = (s: number, out: number): Pt => ({ x: a.x + tx * s + nx * out, z: a.z + tz * s + nz * out });
  const p0 = along(at, 0);
  const p1 = along(at + taper, extra / 2);
  const p2 = along(at + taper + len, extra / 2);
  const p3 = along(at + taper * 2 + len, 0);
  return [n(p0.x, p0.z, 30, width), n(p1.x, p1.z, 30, width + extra), n(p2.x, p2.z, 30, width + extra), n(p3.x, p3.z, 30, width)];
}

/** The loop's corners, clockwise from the south-west. */
const L = {
  sw: { x: -560, z: -690 },
  w: { x: -640, z: -830 },
  nw1: { x: -560, z: -1000 },
  nw2: { x: -380, z: -1090 },
  n1: { x: -150, z: -1050 },
  n2: { x: 80, z: -1105 },
  n3: { x: 380, z: -1085 },
  ne: { x: 600, z: -1010 },
  e1: { x: 620, z: -930 },
  e2: { x: 612, z: -800 },
  se: { x: 520, z: -700 },
  s1: { x: 330, z: -725 },
  s2: { x: 40, z: -790 },
  s3: { x: -150, z: -745 },
  s4: { x: -330, z: -700 },
} as const;

export const PARK_LOOP: CityRoadSpec = {
  tag: 'park-loop',
  kind: 'track',
  spec: {
    closed: true,
    nodes: [
      n(L.sw.x, L.sw.z, 45, PARK_ROAD_W),
      n(L.w.x, L.w.z, 120, PARK_ROAD_W),
      n(L.nw1.x, L.nw1.z, 110, PARK_ROAD_W),
      n(L.nw2.x, L.nw2.z, 90, PARK_ROAD_W),
      n(L.n1.x, L.n1.z, 80, PARK_ROAD_W),
      n(L.n2.x, L.n2.z, 90, PARK_ROAD_W),
      n(L.n3.x, L.n3.z, 90, PARK_ROAD_W),
      n(L.ne.x, L.ne.z, 70, PARK_ROAD_W),
      n(L.e1.x, L.e1.z, 60, PARK_ROAD_W),
      // The east lay-by: 20 m down the straight from the east leg's first corner, lake side.
      ...layBy(L.e1, L.e2, 20, 34, 4.5, 1, PARK_ROAD_W),
      n(L.e2.x, L.e2.z, 60, PARK_ROAD_W),
      n(L.se.x, L.se.z, 60, PARK_ROAD_W),
      n(L.s1.x, L.s1.z, 90, PARK_ROAD_W),
      n(L.s2.x, L.s2.z, 110, PARK_ROAD_W),
      n(L.s3.x, L.s3.z, 100, PARK_ROAD_W),
      // The lake lay-by: on the south leg west of the central avenue, lake side (right, going west).
      ...layBy(L.s3, L.s4, 50, 36, 4.5, 1, PARK_ROAD_W),
      n(L.s4.x, L.s4.z, 80, PARK_ROAD_W),
    ],
  },
};

/** Where the two lay-bys are, for the art (a bench, a lamp) and the tests. */
export const PARK_LAYBYS = [
  { tag: 'laybye-lake', x: -238, z: -722 },
  { tag: 'laybye-east', x: 617, z: -893 },
];

/**
 * How far north the three city streets run into the park: each ends just past the loop's far
 * edge, so it crosses the loop rather than touching it (two roads that only meet end-on are
 * not a junction to the road graph, and their lane paint would stop short of each other).
 */
export const PARK_ENTRIES: Record<string, number> = { 'st-w3': -701, 'av-central': -780, 'st-e3': -713 };

/** The cross road: from inside the central avenue's end, over the loop, to the bridge's south foot; then on from its north foot to the north leg. */
export const PARK_ROADS: CityRoadSpec[] = [
  PARK_LOOP,
  { tag: 'park-cross-s', kind: 'track', spec: { closed: false, nodes: [n(-60, -748, 0, CROSS_W), n(-60, -770, 40, CROSS_W), n(-50, -808, 40, CROSS_W), n(-45, -842, 0, CROSS_W)] } },
  // North of the bridge: up to the north leg, bending west under the trees.
  { tag: 'park-cross-n', kind: 'track', spec: { closed: false, nodes: [n(-45, -912, 0, CROSS_W), n(-45, -965, 60, CROSS_W), n(-90, -1030, 50, CROSS_W), n(-110, -1085, 0, CROSS_W)] } },
];

/** The loop, built once here: the parapets follow its real edge, arcs included. */
const LOOP_PATH = buildTrackPath(PARK_LOOP.spec);
const PROJ = createProjection();

/**
 * A low wall beside a road: `length` metres of it centred on the station nearest `at`, on
 * `side` of the direction of travel (+1 right), its centre `gap` metres outside the asphalt's
 * edge, as segments every six metres so it bends with the road.
 */
function roadsideWall(spec: TrackSpec, at: Pt, length: number, side: 1 | -1, gap: number, wall: Omit<LowWallSpec, 'ax' | 'az' | 'bx' | 'bz'>): LowWallSpec[] {
  const path = spec === PARK_LOOP.spec ? LOOP_PATH : buildTrackPath(spec);
  projectOntoPath(path, at.x, at.z, PROJ);
  const out: LowWallSpec[] = [];
  const step = 6;
  const wrap = (s: number): number => (path.closed ? ((s % path.length) + path.length) % path.length : Math.max(0, Math.min(path.length, s)));
  let prev: Pt | null = null;
  for (let s = PROJ.s - length / 2; s <= PROJ.s + length / 2 + 1e-6; s += step) {
    const c = offsetAtStation(path, wrap(s), 0);
    const p = offsetAtStation(path, wrap(s), side * (c.halfWidth + gap));
    if (prev) out.push({ ...wall, ax: prev.x, az: prev.z, bx: p.x, bz: p.z });
    prev = { x: p.x, z: p.z };
  }
  return out;
}

/**
 * The bridge over the strait: a hump of 2.4 m, feet inside the two halves of the cross road.
 * An elevated road, so the assembler gives it its slab, its skirts and its rails, and the
 * surface field carries the car up and over.
 */
export const PARK_BRIDGE: ElevatedRoadSpec = {
  tag: 'park-bridge',
  lift: 0.08,
  spec: {
    closed: false,
    nodes: [n(-45, -836, 0, CROSS_W, 0), n(-45, -877, 0, CROSS_W, 2.4), n(-45, -918, 0, CROSS_W, 0)],
  },
};

/* ------------------------------------------------------------------ the wall */

/** Gaps in the park's south wall: each way in, the road plus a pavement's worth either side. */
const GAPS: Array<[number, number]> = [
  [-480 - 6.5 - 2.5, -480 + 6.5 + 2.5],
  [-60 - 11 - 2.5, -60 + 11 + 2.5],
  [480 - 6.5 - 2.5, 480 + 6.5 + 2.5],
];

function southWall(): LowWallSpec[] {
  const out: LowWallSpec[] = [];
  let x = PARK_LAND.minX + 2;
  for (const [g0, g1] of GAPS) {
    out.push({ ax: x, az: PARK_SOUTH - 1, bx: g0, bz: PARK_SOUTH - 1, height: 1.0, graffiti: true });
    x = g1;
  }
  out.push({ ax: x, az: PARK_SOUTH - 1, bx: PARK_LAND.maxX - 2, bz: PARK_SOUTH - 1, height: 1.0, graffiti: true });
  return out;
}

/* ------------------------------------------------------------------ the people */

const YOLI = 0xd08fb0;
const BRENDA = 0xff6fd0;

/**
 * Who is in the park at night. Each place is a few people with a name, a look and something
 * they are doing; nothing here speaks yet. Two of them — Mili and El Tano, under the trees on
 * the west side — are the pair everybody in this city knows to go and see when they want a
 * gram: that is theirs alone, part of the game's underworld, and it is only presence for now.
 */
export const PARK_ENCOUNTERS: ParkEncounterSpec[] = [
  {
    // The bench on the south shore of the big lobe, by the lake lay-by: the veterans' bench.
    id: 'banco-del-lago',
    label: 'EL BANCO DEL LAGO',
    x: -214,
    z: -769,
    clear: 14,
    people: [
      // La Yoli: trans, fifty, twenty years of nights in this park, the one who knows everyone.
      { name: 'La Yoli', x: -213.2, z: -770.6, heading: 1.9, kind: 'folded', seed: 501, act: 'chat', look: { height: 1.02, build: 1.08, hair: 0x3a1418, hairAccent: 0x7a2432, coat: 0x4a1f3a, coatLength: 0.8, legs: 0x1b1a22, aura: YOLI } },
      // Brenda: trans, twenty-three, pink hair, never off her phone, Yoli's protégée.
      { name: 'Brenda', x: -210.4, z: -769.2, heading: -1.4, kind: 'phone', seed: 502, act: 'chat', look: { height: 0.99, build: 0.92, hair: 0xff5fc8, hairAccent: 0xffa6e6, head: 'fringe', coat: 0x1a1a1e, coatLength: 0.05, legs: 0x2b2136, shortSleeves: true, phone: 0xfff0f6, band: BRENDA, aura: BRENDA } },
      // Vane: cis, Brenda's friend from the neighbourhood, hands in her pockets against the cold.
      { name: 'Vane', x: -216.6, z: -766.4, heading: 2.5, kind: 'pocket', seed: 503, act: 'stand', look: { hair: 0x1a1210, head: 'tied', coat: 0x2f3b4d, coatLength: 0.55 } },
    ],
    props: [
      { kind: 'bench', x: -214, z: -772.6, heading: 0 },
      { kind: 'bin', x: -207.5, z: -773.2, heading: 0 },
    ],
  },
  {
    // Under the trees between the west leg and the lake's west tip, off the path, no lamp near.
    id: 'bajo-los-arboles',
    label: 'BAJO LOS ÁRBOLES',
    x: -470,
    z: -850,
    clear: 9,
    people: [
      // Mili: trans, thirty-four, tall, the one people come to see. Says little, watches the path.
      { name: 'Mili', x: -470.8, z: -851.6, heading: 2.2, kind: 'pocket', seed: 511, act: 'stand', focus: { x: -430, z: -830 }, look: { height: 1.08, build: 0.96, hair: 0x0e0c10, hairAccent: 0x9a2a6a, head: 'tied', coat: 0x101216, coatLength: 0.95, legs: 0x15151a, boots: 0x0a0a0c, tattoo: 0x6a4a5a, aura: 0x8a5a9a } },
      // El Tano: cis, forty, Mili's partner in the trade, handles the money. Cooler of beers for cover.
      { name: 'El Tano', x: -467.4, z: -849.0, heading: -1.9, kind: 'cooler', seed: 512, act: 'vendor', look: { height: 0.96, build: 1.16, hair: 0x2a2018, head: 'cap', coat: 0x24352a, coatLength: 0.3, legs: 0x2a2a30 } },
      // Lucho: cis, a regular, on the crate with a beer, keeping an eye on the road for them.
      { name: 'Lucho', x: -473.6, z: -846.8, heading: 0.6, kind: 'idle', seed: 513, act: 'chat', focus: { x: -470.8, z: -851.6 }, look: { hair: 0x141210, head: 'hood', coat: 0x1c2230, coatLength: 0.6, legStripe: 0xd8d8d0 } },
    ],
    props: [
      { kind: 'crate', x: -474.6, z: -845.6, heading: 0.4 },
      { kind: 'cooler', x: -466.2, z: -848.2, heading: -1.9 },
      { kind: 'bin', x: -462.5, z: -855, heading: 0 },
    ],
  },
  {
    // The east lay-by: a place cars pull in. Music from a speaker on the grass.
    id: 'el-ensanche',
    label: 'EL ENSANCHE',
    x: 598,
    z: -900,
    clear: 12,
    people: [
      // Romina: trans, twenty-eight, the loudest laugh in the park; leans on the bench back.
      { name: 'Romina', x: 597.2, z: -903.4, heading: 1.2, kind: 'idle', seed: 521, act: 'vibe', focus: { x: 600.5, z: -897.2 }, look: { height: 1.0, build: 0.98, hair: 0x5a1a10, hairAccent: 0xff7a3a, head: 'mop', coat: 0xb0182e, coatLength: 0.1, legs: 0x101014, shortSleeves: true, band: 0xff2fb4, aura: 0xff7a9a } },
      // Sabri: trans, thirty, quieter, filming the cars that pull in for her feed.
      { name: 'Sabri', x: 595.6, z: -898.6, heading: 1.7, kind: 'camera', seed: 522, act: 'film', look: { height: 0.97, build: 0.9, hair: 0x101010, hairAccent: 0x3fe8ff, head: 'fringe', coat: 0x2b1f4a, coatLength: 0.45, legs: 0x1c1c26, aura: 0x9ab8ff } },
      // Nacho: cis, Romina's cousin, brought the speaker, on the phone to whoever is coming.
      { name: 'Nacho', x: 599.6, z: -906.2, heading: 0.2, kind: 'phone', seed: 523, act: 'phone', look: { hair: 0x1a1410, head: 'capBack', coat: 0x0f1c14, coatLength: 0.2, legs: 0x3a3f47, legStripe: 0x39ff6a } },
    ],
    props: [
      { kind: 'speaker', x: 600.5, z: -897.2, heading: -1.2 },
      { kind: 'bench', x: 596, z: -905.6, heading: Math.PI / 2 },
      { kind: 'bin', x: 594.5, z: -910.5, heading: 0 },
    ],
  },
  {
    // The north shore by the footbridge: a couple looking at the water and the skyline behind it.
    id: 'la-pareja-del-puente',
    label: 'LA PAREJA DEL PUENTE',
    x: -292,
    z: -1012,
    clear: 8,
    people: [
      // Ceci: trans, forty-one, a nurse on her night off; Mora's partner of six years.
      { name: 'Ceci', x: -291.2, z: -1012.4, heading: -0.3, kind: 'folded', seed: 531, act: 'stand', focus: { x: -300, z: -960 }, look: { height: 1.01, build: 1.0, hair: 0x2a1a12, head: 'tied', coat: 0x56606a, coatLength: 0.7, legs: 0x2b3444, aura: 0xd8c8a0 } },
      // Mora: cis, thirty-eight, a hand round Ceci's waist, pointing things out across the lake.
      { name: 'Mora', x: -289.9, z: -1012.9, heading: -0.5, kind: 'idle', seed: 532, act: 'chat', focus: { x: -291.2, z: -1012.4 }, look: { hair: 0x0c0c10, head: 'crop', coat: 0x3b1f2b, coatLength: 0.5, legs: 0x121316 } },
    ],
    props: [],
  },
];

/* ------------------------------------------------------------------ the lie of the land */

/**
 * THE HILLS (2026-09-16, second pass): the park was a sheet of grass at y 0, and Palermo's
 * woods are not. Broad swells the loop rides — up through the west woods, over the north
 * leg, up the east leg and down again to the lake — and knolls on the lawns between the roads
 * and the water, a few metres high, that the paths climb over and the benches look out from.
 * Everything falls level to the water, the planetarium's lawn, the meeting places and the wall
 * (`parkRelief.ts`); none of the swells is steeper than about seven per cent where a road
 * crosses it.
 */
export const PARK_RELIEF: ParkReliefSpec = {
  swells: [
    // The west woods, on a rise: the west leg climbs into them from both ends.
    { x: -500, z: -880, rx: 175, rz: 200, height: 7 },
    // Behind the big lobe's north shore, under the north leg.
    { x: -440, z: -1050, rx: 150, rz: 95, height: 4 },
    { x: 130, z: -1040, rx: 190, rz: 95, height: 4.5 },
    // The east leg climbs past the lay-by and comes down to the south-east corner.
    { x: 520, z: -820, rx: 130, rz: 165, height: 6.5 },
    // The south leg's lawns toward the city: a long low swell each side of the central avenue.
    { x: 190, z: -735, rx: 190, rz: 80, height: 3.4 },
    { x: -300, z: -700, rx: 160, rz: 70, height: 3 },
  ],
  knolls: [
    // The west side: hillocks either side of the path Mili watches, and behind the north-west corner.
    { x: -500, z: -790, rx: 48, rz: 36, height: 8.7 },
    { x: -470, z: -965, rx: 50, rz: 40, height: 9.4 },
    { x: -600, z: -1085, rx: 40, rz: 34, height: 6.5 },
    { x: -420, z: -1030, rx: 36, rz: 26, height: 5.8 },
    // Between the lay-by and the big lobe's path.
    { x: -330, z: -752, rx: 34, rz: 26, height: 5.1 },
    // Between the south wall and the loop, either side of the central avenue.
    { x: -170, z: -690, rx: 70, rz: 26, height: 4.3 },
    { x: 200, z: -690, rx: 70, rz: 26, height: 4.3 },
    // North of the small lobe, where the shrubs are.
    { x: 100, z: -1012, rx: 55, rz: 32, height: 7.2 },
    { x: 5, z: -1045, rx: 34, rz: 28, height: 5.8 },
    { x: 250, z: -1020, rx: 60, rz: 38, height: 7.2 },
    // The lawns between the small lobe and the east leg.
    { x: 330, z: -800, rx: 60, rz: 40, height: 8.7 },
    { x: 330, z: -920, rx: 36, rz: 30, height: 5.8 },
    { x: 530, z: -880, rx: 40, rz: 46, height: 6.5 },
    { x: 625, z: -1100, rx: 36, rz: 30, height: 5.1 },
  ],
};

/** The loop's pavement (m): wide enough for a bench and a bollard, like the lake road in Palermo. */
export const PARK_SIDEWALK_W = 3.2;

/* ------------------------------------------------------------------ the spec */

export const METRO_PARK: ParkSpec = {
  tag: 'parque-norte',
  label: 'BOSQUES DEL NORTE',
  land: PARK_LAND,
  relief: PARK_RELIEF,
  sidewalks: [
    // The inside of the whole loop, the lake side: the walk round the water.
    { road: 'park-loop', side: 1, width: PARK_SIDEWALK_W, bollards: 15 },
    // And the city side of the south leg, from the south-east corner to the south-west one.
    { road: 'park-loop', side: -1, width: PARK_SIDEWALK_W, from: { x: 520, z: -700 }, to: { x: -560, z: -690 }, bollards: 15 },
  ],
  lakes: [{ tag: 'lago', shore: PARK_SHORE, islands: PARK_ISLANDS }],
  masses: [
    // The belt along the north wall, so the towers of the perimeter stand behind trees.
    { x: -500, z: -1120, rx: 180, rz: 20, count: 81, kind: 'broad', seed: 1 },
    { x: -100, z: -1123, rx: 220, rz: 18, count: 92, kind: 'broad', seed: 2 },
    { x: 350, z: -1122, rx: 200, rz: 18, count: 81, kind: 'broad', seed: 3 },
    { x: 610, z: -1112, rx: 80, rz: 22, count: 36, kind: 'mixed', seed: 4 },
    // The west woods: the dark side of the park, where Mili and El Tano are.
    { x: -540, z: -880, rx: 62, rz: 110, count: 118, kind: 'mixed', seed: 5, spacing: 6.5 },
    { x: -455, z: -965, rx: 60, rz: 55, count: 56, kind: 'broad', seed: 6 },
    { x: -620, z: -725, rx: 48, rz: 48, count: 34, kind: 'mixed', seed: 7 },
    // Groves between the big lobe's north shore and the north leg.
    { x: -300, z: -1045, rx: 100, rz: 26, count: 56, kind: 'broad', seed: 8 },
    { x: -120, z: -1030, rx: 55, rz: 32, count: 34, kind: 'mixed', seed: 9 },
    // The belt inside the south wall: the city's towers behind it, seen through the trunks.
    { x: -400, z: -664, rx: 250, rz: 13, count: 87, kind: 'broad', seed: 10, spacing: 6 },
    { x: 200, z: -664, rx: 250, rz: 13, count: 87, kind: 'broad', seed: 11, spacing: 6 },
    { x: 600, z: -664, rx: 75, rz: 13, count: 28, kind: 'broad', seed: 12, spacing: 6 },
    // The east woods, and the planetarium's ring of palms on its lawn.
    { x: 560, z: -905, rx: 55, rz: 120, count: 98, kind: 'mixed', seed: 13 },
    { x: 500, z: -1050, rx: 80, rz: 40, count: 50, kind: 'broad', seed: 14 },
    { x: 430, z: -965, rx: 105, rz: 95, count: 36, kind: 'palm', seed: 15, spacing: 11 },
    // Round the small lobe.
    { x: 250, z: -985, rx: 60, rz: 34, count: 36, kind: 'broad', seed: 16 },
    { x: 270, z: -800, rx: 52, rz: 30, count: 22, kind: 'palm', seed: 17, spacing: 9 },
    // Sparse groves between the south leg and the water, so the lake shows through.
    { x: -300, z: -758, rx: 90, rz: 22, count: 17, kind: 'broad', seed: 18, spacing: 10 },
    { x: 250, z: -762, rx: 80, rz: 22, count: 14, kind: 'broad', seed: 19, spacing: 10 },
    // Willows at the water: the north shore, the south shore, the strait's banks.
    { x: -330, z: -985, rx: 60, rz: 28, count: 17, kind: 'willow', seed: 20 },
    { x: -120, z: -960, rx: 42, rz: 26, count: 11, kind: 'willow', seed: 21 },
    { x: 180, z: -932, rx: 50, rz: 22, count: 11, kind: 'willow', seed: 22 },
    { x: -250, z: -805, rx: 80, rz: 20, count: 14, kind: 'willow', seed: 23 },
    { x: 110, z: -800, rx: 60, rz: 18, count: 11, kind: 'willow', seed: 24 },
    { x: -20, z: -880, rx: 62, rz: 34, count: 11, kind: 'willow', seed: 25 },
    // The islands.
    { x: -300, z: -955, rx: 15, rz: 10, count: 7, kind: 'broad', seed: 26, spacing: 5 },
    { x: -200, z: -880, rx: 10, rz: 7, count: 4, kind: 'willow', seed: 27, spacing: 5 },
    { x: 135, z: -880, rx: 9, rz: 6, count: 4, kind: 'broad', seed: 28, spacing: 5 },
    // Filling the lawns that read empty from the road (2026-09-16): stands and bushes in the gaps.
    { x: 90, z: -1025, rx: 95, rz: 38, count: 44, kind: 'broad', seed: 40, spacing: 6.5 },
    { x: 60, z: -975, rx: 75, rz: 14, count: 22, kind: 'shrub', seed: 41, spacing: 3.2 },
    { x: 420, z: -800, rx: 105, rz: 45, count: 46, kind: 'mixed', seed: 42, spacing: 6.5 },
    { x: 380, z: -852, rx: 90, rz: 12, count: 26, kind: 'shrub', seed: 43, spacing: 3.2 },
    { x: 300, z: -925, rx: 32, rz: 45, count: 16, kind: 'broad', seed: 44 },
    { x: -470, z: -748, rx: 72, rz: 34, count: 32, kind: 'mixed', seed: 45 },
    { x: -150, z: -690, rx: 70, rz: 14, count: 22, kind: 'shrub', seed: 46, spacing: 3.2 },
    { x: 150, z: -706, rx: 130, rz: 14, count: 34, kind: 'broad', seed: 47, spacing: 6.5 },
    { x: 400, z: -690, rx: 95, rz: 12, count: 26, kind: 'broad', seed: 48, spacing: 6.5 },
    { x: -420, z: -905, rx: 26, rz: 70, count: 22, kind: 'broad', seed: 49 },
    { x: -250, z: -1036, rx: 85, rz: 10, count: 26, kind: 'shrub', seed: 50, spacing: 3.2 },
    { x: -140, z: -815, rx: 40, rz: 14, count: 14, kind: 'shrub', seed: 51, spacing: 3.2 },
    { x: 160, z: -830, rx: 45, rz: 12, count: 14, kind: 'shrub', seed: 52, spacing: 3.2 },
    // Outside the loop, between it and the park's wall: the edge was bare grass.
    { x: -668, z: -900, rx: 16, rz: 170, count: 44, kind: 'broad', seed: 53, spacing: 6.5 },
    { x: 658, z: -900, rx: 24, rz: 130, count: 38, kind: 'broad', seed: 54, spacing: 6.5 },
    { x: -635, z: -1095, rx: 50, rz: 40, count: 28, kind: 'mixed', seed: 55 },
    { x: 640, z: -735, rx: 40, rz: 55, count: 22, kind: 'mixed', seed: 56 },
  ],
  tunnels: [
    { road: 'park-loop', at: { x: 230, z: -1097 }, length: 150 },
    { road: 'park-loop', at: { x: -610, z: -915 }, length: 120 },
    { road: 'park-cross-n', at: { x: -72, z: -1000 }, length: 70 },
  ],
  paths: [
    // Round the big lobe, from the central avenue's junction to the strait.
    {
      lit: true,
      points: [
        { x: -78, z: -742 },
        { x: -120, z: -772 },
        { x: -200, z: -790 },
        { x: -280, z: -788 },
        { x: -350, z: -820 },
        { x: -395, z: -880 },
        { x: -382, z: -950 },
        { x: -332, z: -1002 },
        { x: -240, z: -1024 },
        { x: -160, z: -1004 },
        { x: -112, z: -956 },
        { x: -96, z: -906 },
      ],
    },
    // Round the small lobe.
    {
      lit: true,
      points: [
        { x: -22, z: -852 },
        { x: 30, z: -830 },
        { x: 100, z: -784 },
        { x: 170, z: -800 },
        { x: 226, z: -852 },
        { x: 222, z: -905 },
        { x: 172, z: -950 },
        { x: 110, z: -970 },
        { x: 50, z: -958 },
        { x: 6, z: -915 },
      ],
    },
    // From the east lay-by to the small lobe, past the planetarium.
    { lit: true, points: [{ x: 590, z: -884 }, { x: 505, z: -880 }, { x: 430, z: -874 }, { x: 330, z: -874 }, { x: 232, z: -872 }] },
    // Up to the footbridge from the north leg.
    { lit: false, points: [{ x: -330, z: -1082 }, { x: -312, z: -1040 }, { x: -300, z: -1006 }] },
    // Under the trees on the west side: the path Mili watches.
    { lit: false, points: [{ x: -600, z: -760 }, { x: -520, z: -800 }, { x: -440, z: -832 }, { x: -400, z: -880 }] },
  ],
  walls: [
    ...southWall(),
    // The parapet on the curve that reveals the lake: the south leg's swing up to the water, lake side.
    ...roadsideWall(PARK_LOOP.spec, { x: 40, z: -790 }, 150, 1, PARK_SIDEWALK_W + 0.5, { height: 0.55, rail: true }),
    // The painted wall behind the veterans' bench.
    { ax: -222, az: -764, bx: -206, bz: -764, height: 0.95, graffiti: true },
    // Behind the east lay-by's bench, facing the road.
    { ax: 591, az: -912, bx: 591, bz: -899, height: 0.95, graffiti: true },
  ],
  footbridges: [{ ax: -300, az: -1004, bx: -300, bz: -967 }],
  lamps: [
    { x: -220.5, z: -775, dx: 1, dz: 0.3 },
    { x: 593.5, z: -906, dx: 1, dz: 0.4 },
    { x: -300.5, z: -1016, dx: 0.3, dz: -1 },
    { x: -55.8, z: -830, dx: 1, dz: 0, tall: true },
    { x: -36.2, z: -924, dx: -1, dz: 0, tall: true },
    // The planetarium's four, on the lawn round its podium, arms toward it.
    { x: 391, z: -926, dx: 1, dz: -1, tall: true },
    { x: 469, z: -926, dx: -1, dz: -1, tall: true },
    { x: 469, z: -1004, dx: -1, dz: 1, tall: true },
    { x: 391, z: -1004, dx: 1, dz: 1, tall: true },
  ],
  planetarium: { x: 430, z: -965, radius: 44, label: 'PLANETARIO' },
  encounters: PARK_ENCOUNTERS,
  furniture: [
    // Benches along the lake paths, facing the water, with a bin by some of them.
    { kind: 'bench', x: -352, z: -824, heading: -1.1 },
    { kind: 'bench', x: -383, z: -946, heading: -2.3 },
    { kind: 'bin', x: -386, z: -943, heading: 0 },
    { kind: 'bench', x: -238, z: -1020, heading: Math.PI + 0.2 },
    { kind: 'bench', x: 170, z: -796, heading: 0.25 },
    { kind: 'bench', x: 224, z: -908, heading: -1.6 },
    { kind: 'bin', x: 221, z: -912, heading: 0 },
    { kind: 'bench', x: 300, z: -878, heading: 0.1 },
    // Facing the planetarium across its lawn.
    { kind: 'bench', x: 418, z: -896, heading: 0 },
    { kind: 'bench', x: 442, z: -896, heading: 0 },
    { kind: 'bench', x: -120, z: -776, heading: -0.4 },
  ],
  clearings: [
    { x: -200, z: -778, r: 34 },
    { x: 430, z: -965, r: 70 },
    { x: 40, z: -815, r: 28 },
    { x: -60, z: -700, r: 30 },
  ],
};
