import type { ArenaLayout, BusRoute, ObstacleBox, ObstacleWall, SpawnPoint } from '../core/types';
import { BUSES } from '../config/tuning';
import { PAL } from '../render/scene/env/palette';
import { HAZE } from '../render/scene/env/haze';
import type { World } from './arenaWorld';
import {
  BUS_STOP,
  inRect,
  SIDEWALK_Y,
  type BlockRect,
  type BusStopDef,
  type CityPlan,
  type FenceDef,
  type GateDef,
  type KerbField,
  type PillarDef,
  type Rect,
  type RibbonDef,
  type SkybridgeDef,
  type TowerDef,
  type WallRect,
  type ZoneId,
} from './cityPlan';
import { buildRails, generateBlocks, onRibbonAtLevel, railBounds, type BlockOptions } from './cityGen';
import {
  CITY_BOUNDS,
  CITY_QUAY_Z,
  DOWNTOWN,
  BUS_ROUTE_LOOPS,
  CITY_ROADS,
  CITY_SPAWN,
  CITY_WALL_BAND,
  NEON_DISTRICTS,
  POWER_LINE,
  RADIO_TOWERS,
  RAMP_SPECS,
  RING_BILLBOARDS,
  SKYWAY_SPEC,
  TRAFFIC_LOOPS,
  VIADUCT_CARS,
  VIADUCT_SPEC,
  VIADUCT_Y,
} from './citySpec';
import { createKerbField } from './kerbs';
import { createSurfaceField } from './surface';
import { buildTrackPath, createProjection, isElevated, isOnPath, offsetAtStation, projectOntoPath, type TrackPath } from './track';

/**
 * The big city ("City" in the main menu), generated from `citySpec.ts`:
 *
 *  - every road is a ribbon: the ground grid, the diagonal, the alleys, the viaduct, its
 *    ramps and the skyway. The elevated ones carry heights in their samples; the surface
 *    field built from them is what the simulation reads the car's height from,
 *  - blocks grow in the grid between the roads (`cityGen.ts`); a viaduct only clears the
 *    narrow corridor under itself, so the towers stand right up against the deck,
 *  - the elevated roads get guardrails as wall colliders bounded in height, and pillars as
 *    ground colliders wherever the deck is not over a street or another deck,
 *  - the south edge is water behind a quay wall; the viaduct's south leg is a bridge over it,
 *  - traffic: rectangles of streets driven clockwise, plus cars lapping the viaduct.
 *
 * Collision and art come from the same segments, rectangles and points, as everywhere else.
 */

/** Deck heights below this are an embankment, not a bridge: no pillars, nothing drives under. */
const PILLAR_MIN_Y = 4.5;
/** Column spacing (m). Close, so the underside reads as a structure, not a table on stilts. */
const PILLAR_STEP = 12;
/** Half size of a column's ground collider (m): the column plus the barrier ring at its foot. */
const PILLAR_HALF = 1.3;
/** Right-hand lane offset for the traffic (m from the centreline). */
const LANE = 3.5;
/** Quay wall segment length (m). */
const QUAY_STEP = 8;

/**
 * Bus routes: the wide, straight, axis-aligned boulevards, which are the only streets with
 * both a deep enough pavement for a shelter and enough asphalt to park a 13.6 m bus at the
 * kerb without standing in the traffic's lane (which runs `LANE` m off the centreline).
 */
const BUS_ROUTES = ['av-main', 'blvd-north', 'av-east', 'blvd-center', 'blvd-water'];
/** Least distance between stops on one route (m), and where the first one may stand. */
const BUS_STOP_SPACING = 130;
const BUS_STOP_FIRST = 60;
/** How finely the route is searched for somewhere a stop fits (m). */
const BUS_STOP_PROBE = 6;
/** A stop needs this much road either side of the centreline (m): see `BUS_ROUTES`. */
const BUS_STOP_MIN_HALF_WIDTH = 8;
/** And this much pavement behind the kerb (m), or the shelter would stand in a facade. */
const BUS_STOP_MIN_PAVEMENT = 2.6;
/** Gap between the kerb and the shelter's near face (m). */
const BUS_STOP_KERB_GAP = 0.35;
/** Nothing parked within this of the player's spawn (m). */
const BUS_STOP_SPAWN_CLEAR = 34;

const CITY_BLOCK_OPTIONS: BlockOptions = {
  cell: 110,
  minCell: 11,
  axisSplit: true,
  mergeUpTo: 80,
  shoulder: { corporate: 5, urban: 3.2, jdm: 2.6 },
  alleyShoulder: 1.2,
  elevatedShoulder: 1.6,
  elevatedAbove: 2.5,
  massingFor(rect, zone) {
    const w = rect.maxX - rect.minX;
    const d = rect.maxZ - rect.minZ;
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    const h = hash01(cx, cz);
    // Downtown: skyscrapers on every plot that can carry one, pencil towers on the slivers.
    if (inRect(DOWNTOWN, cx, cz)) {
      if (Math.min(w, d) < 7) return 1;
      return Math.min(w, d) >= 12 && h < 0.8 ? 4 : 3;
    }
    // Only a sliver stays low; a narrow plot in the core still carries a tower.
    if (Math.min(w, d) < 11 || w * d < 220) return 1;
    if (zone === 'corporate') return h < 0.15 ? 2 : 3;
    if (zone === 'urban') return h < 0.3 ? 3 : h < 0.85 ? 2 : 1;
    return h < 0.25 ? 2 : 1;
  },
};

/** Deterministic 0..1 from a position, so the city is the same on every machine. */
function hash01(x: number, z: number): number {
  return Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
}

export function createCityWorld(): World {
  const bounds: Rect = { ...CITY_BOUNDS };
  const inner: Rect = {
    minX: bounds.minX + CITY_WALL_BAND,
    maxX: bounds.maxX - CITY_WALL_BAND,
    minZ: bounds.minZ + CITY_WALL_BAND,
    maxZ: CITY_QUAY_Z,
  };

  /* ---------------------------------------------------------- roads */

  const ground: RibbonDef[] = CITY_ROADS.map((r, i) => ({
    path: buildTrackPath(r.spec),
    kind: r.kind,
    tag: r.tag,
    // Roads crossing at grade get their own lift each, so their slabs never z-fight.
    lift: i * 0.004 + (r.kind === 'alley' ? 0.002 : 0),
  }));
  const viaduct: RibbonDef = { path: buildTrackPath(VIADUCT_SPEC), kind: 'track', tag: 'viaduct', elevated: true, lift: 0 };
  const ramps: RibbonDef[] = RAMP_SPECS.map((r) => ({ path: buildTrackPath(r.spec), kind: 'track', tag: r.tag, elevated: true, lift: 0.08 }));
  const skyway: RibbonDef = { path: buildTrackPath(SKYWAY_SPEC.spec), kind: 'track', tag: 'skyway', elevated: true, lift: 0.07 };
  const elevated: RibbonDef[] = [viaduct, ...ramps, skyway];
  for (const rb of elevated) if (!isElevated(rb.path)) throw new Error(`city: ${rb.tag} is meant to be elevated`);
  const ribbons: RibbonDef[] = [...ground, ...elevated];

  /* ---------------------------------------------------------- land, water, walls */

  const perimeter: WallRect[] = [
    { tag: 'wall-n', minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: inner.minZ },
    { tag: 'wall-w', minX: bounds.minX, maxX: inner.minX, minZ: inner.minZ, maxZ: CITY_QUAY_Z },
    { tag: 'wall-e', minX: inner.maxX, maxX: bounds.maxX, minZ: inner.minZ, maxZ: CITY_QUAY_Z },
  ];
  const water = { rect: { minX: bounds.minX - 400, maxX: bounds.maxX + 400, minZ: CITY_QUAY_Z, maxZ: bounds.maxZ + 500 }, quayZ: CITY_QUAY_Z };

  /** Zone of the nearest street: the city follows the road it stands on. */
  const proj = createProjection();
  const zoneAt = (x: number, z: number): ZoneId => {
    let best = Infinity;
    let zone: ZoneId = 'urban';
    for (const rb of ground) {
      projectOntoPath(rb.path, x, z, proj);
      if (proj.dist < best) {
        best = proj.dist;
        zone = rb.path.samples[proj.index].zone;
      }
    }
    return zone;
  };

  const blocks = generateBlocks(inner, ribbons, zoneAt, CITY_BLOCK_OPTIONS);
  const rails = buildRails(ribbons, (rb) => !!rb.elevated);
  const solids: Rect[] = [...blocks, ...perimeter];
  const shoulders = { ...CITY_BLOCK_OPTIONS.shoulder, alley: CITY_BLOCK_OPTIONS.alleyShoulder };
  // The pavement beside the streets stands a step proud of them, for the art and the car alike.
  const kerbs = createKerbField(ribbons, shoulders);
  const kerbGrade = { gx: 0, gz: 0 };

  const onGroundRoad = (x: number, z: number, pad: number): boolean => {
    for (const rb of ground) if (isOnPath(rb.path, x, z, pad)) return true;
    return false;
  };

  /* ---------------------------------------------------------- pillars */

  const pillars: PillarDef[] = [];
  for (const rb of elevated) {
    const path = rb.path;
    for (let s = PILLAR_STEP / 2; s < path.length; s += PILLAR_STEP) {
      const c = offsetAtStation(path, s, 0);
      if (c.y < PILLAR_MIN_Y) continue;
      // Never on a street: the deck spans it. Never on a lower deck either. Both columns are
      // checked, not the centre: a street may run under one edge of the deck only.
      const out = c.halfWidth - 1.6;
      if (onGroundRoad(c.x, c.z, 3.5)) continue;
      if (onGroundRoad(c.x + -c.tz * out, c.z + c.tx * out, PILLAR_HALF + 1.6)) continue;
      if (onGroundRoad(c.x - -c.tz * out, c.z - c.tx * out, PILLAR_HALF + 1.6)) continue;
      let onLowerDeck = false;
      for (const other of elevated) {
        if (other === rb) continue;
        for (const side of [-1, 0, 1]) {
          projectOntoPath(other.path, c.x + -c.tz * out * side, c.z + c.tx * out * side, proj);
          if (proj.dist <= proj.halfWidth + PILLAR_HALF + 0.5 && proj.y < c.y - 2) onLowerDeck = true;
        }
        if (onLowerDeck) break;
      }
      if (onLowerDeck) continue;
      pillars.push({ x: c.x, z: c.z, tx: c.tx, tz: c.tz, y: c.y, halfWidth: c.halfWidth, wet: c.z > CITY_QUAY_Z, zone: c.zone });
    }
  }

  /* ---------------------------------------------------------- fences */

  // Between consecutive columns of one ribbon, on both sides, two bays out of three: the
  // space under the deck is fenced off the street, and entered through the open bays.
  const fences: FenceDef[] = [];
  {
    let last: PillarDef | null = null;
    let bay = 0;
    for (const p of pillars) {
      if (last && !last.wet && !p.wet && Math.hypot(p.x - last.x, p.z - last.z) < PILLAR_STEP * 1.5) {
        if (bay % 3 !== 2) {
          for (const side of [-1, 1]) {
            const oa = last.halfWidth - 1.6;
            const ob = p.halfWidth - 1.6;
            fences.push({
              ax: last.x + -last.tz * oa * side,
              az: last.z + last.tx * oa * side,
              bx: p.x + -p.tz * ob * side,
              bz: p.z + p.tx * ob * side,
              y: Math.min(last.y, p.y),
              zone: p.zone,
            });
          }
        }
        bay++;
      } else {
        bay = 0;
      }
      last = p;
    }
  }

  /* ---------------------------------------------------------- quay */

  const quay: ObstacleWall[] = [];
  for (let x = inner.minX; x < inner.maxX; x += QUAY_STEP) {
    const bx = Math.min(inner.maxX, x + QUAY_STEP);
    const mx = (x + bx) / 2;
    // A ramp that comes ashore here opens the wall; its own rails keep the car on it.
    let open = false;
    for (const rb of ribbons) {
      if (onRibbonAtLevel(rb, mx, CITY_QUAY_Z, 0, 2.5)) {
        open = true;
        break;
      }
    }
    if (open) continue;
    quay.push({ ax: x, az: CITY_QUAY_Z, bx, bz: CITY_QUAY_Z, maxY: 4, tag: 'quay' });
  }

  /* ---------------------------------------------------------- skybridges */

  const skybridges = findSkybridges(ground, elevated, blocks, zoneAt);

  /* ---------------------------------------------------------- bus stops */

  // The routes are laid out first: a shelter is put on the kerb a bus drives along wherever
  // both kerbs would do, so the network is a network and not two unrelated things.
  const lanes = busLanes(ground);
  const busStops = placeBusStops(
    ground,
    elevated,
    kerbs,
    shoulders,
    (x, z, pad) => {
      for (const b of solids) if (inRect(b, x, z, pad)) return true;
      return false;
    },
    lanes,
  );
  const busRoutes: BusRoute[] = lanes.map((points) => ({ points, stops: callingPoints(points, busStops) }));


  /* ---------------------------------------------------------- traffic, cruise */

  const targetSpawns: SpawnPoint[] = [];
  const targetPatrols: Array<Array<{ x: number; z: number }>> = [];
  for (const loop of TRAFFIC_LOOPS) {
    const corners = loopWaypoints(loop.rect, LANE);
    for (let k = 0; k < loop.cars; k++) {
      // Spread the cars evenly round the rectangle: car k starts k/n of the way round.
      const at = placeAlongLoop(corners, (k + 0.5) / loop.cars);
      const rotated = [...corners.slice(at.next), ...corners.slice(0, at.next)];
      targetSpawns.push({ x: at.x, z: at.z, heading: at.heading });
      targetPatrols.push(rotated);
    }
  }
  {
    const samples = viaduct.path.samples;
    const lane: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < samples.length; i += 3) {
      const s = samples[i];
      lane.push({ x: s.x + -s.tz * LANE, z: s.z + s.tx * LANE });
    }
    for (let k = 0; k < VIADUCT_CARS; k++) {
      const start = Math.floor((k * lane.length) / VIADUCT_CARS);
      const rotated = [...lane.slice(start), ...lane.slice(0, start)];
      const s = samples[Math.min(samples.length - 1, start * 3)];
      targetSpawns.push({ x: rotated[0].x, z: rotated[0].z, y: VIADUCT_Y, heading: Math.atan2(s.tx, -s.tz) });
      targetPatrols.push(rotated);
    }
  }
  const cruiseRoute = loopWaypoints(TRAFFIC_LOOPS[0].rect, LANE);

  /* ---------------------------------------------------------- layout */

  const colliders: ObstacleBox[] = [];
  for (const w of perimeter) colliders.push({ minX: w.minX, maxX: w.maxX, minZ: w.minZ, maxZ: w.maxZ, tag: w.tag });
  for (const b of blocks) {
    colliders.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, tag: b.tag, ...(b.maxHeight !== undefined ? { maxY: b.maxHeight } : {}) });
  }
  for (const p of pillars) {
    if (p.wet) continue;
    const out = p.halfWidth - 1.6;
    for (const side of [-1, 1]) {
      const cx = p.x + -p.tz * out * side;
      const cz = p.z + p.tx * out * side;
      colliders.push({ minX: cx - PILLAR_HALF, maxX: cx + PILLAR_HALF, minZ: cz - PILLAR_HALF, maxZ: cz + PILLAR_HALF, maxY: p.y - 1.2, tag: 'pillar' });
    }
  }
  // Shelters: axis-aligned, so one exact box each. `BUS_STOP` is the only place their size is
  // written down, and `transitBuilder.ts` draws them from the same numbers.
  for (const st of busStops) {
    const alongX = Math.abs(st.tx) > 0.5;
    const hx = alongX ? BUS_STOP.length / 2 : BUS_STOP.depth / 2;
    const hz = alongX ? BUS_STOP.depth / 2 : BUS_STOP.length / 2;
    colliders.push({ minX: st.x - hx, maxX: st.x + hx, minZ: st.z - hz, maxZ: st.z + hz, maxY: BUS_STOP.height, tag: 'bus-stop' });
  }
  const walls: ObstacleWall[] = rails.map((r) => ({ ax: r.ax, az: r.az, bx: r.bx, bz: r.bz, ...railBounds(r), tag: r.kind }));
  walls.push(...quay);
  for (const f of fences) walls.push({ ax: f.ax, az: f.az, bx: f.bx, bz: f.bz, maxY: f.y - 1.4, tag: 'fence' });
  // Four segments per bus, LAST in the list and in bus order, rewritten in place every tick
  // by `src/sim/buses.ts` as the bus moves. Parked off the map until the first tick writes
  // them, so nothing that reads a freshly built layout finds a bus in the middle of a road.
  const PARKED = CITY_BOUNDS.minZ - 1000;
  for (let i = 0; i < busRoutes.length * BUSES.perRoute * 4; i++) {
    walls.push({ ax: 0, az: PARKED, bx: 0, bz: PARKED, maxY: BUSES.height, tag: 'bus' });
  }

  const layout: ArenaLayout = {
    bounds,
    playerSpawn: { ...CITY_SPAWN },
    targetSpawns,
    targetPatrols,
    cruiseRoute,
    colliders,
    walls,
    surface: createSurfaceField(elevated.map((rb) => rb.path), 1.5, kerbs),
    race: null,
    busRoutes,
    minimap: {
      bounds: { minX: inner.minX, maxX: inner.maxX, minZ: inner.minZ, maxZ: 270 },
      rects: [],
      ribbons: ribbons.map((rb) => ({
        points: rb.path.samples.filter((_, i) => i % 2 === 0 || !rb.path.closed).map((s) => ({ x: s.x, z: s.z })),
        width: rb.path.samples.reduce((sum, s) => sum + s.halfWidth * 2, 0) / rb.path.samples.length,
        closed: rb.path.closed,
        hidden: false,
        elevated: !!rb.elevated,
      })),
      water: { minX: inner.minX, maxX: inner.maxX, minZ: CITY_QUAY_Z, maxZ: 270 },
    },
  };

  /* ---------------------------------------------------------- plan */

  const towers: TowerDef[] = RADIO_TOWERS.map((t) => ({ ...t, kind: 'radio' as const }));
  const powerLines: Array<[number, number]> = [];
  for (let i = 0; i < POWER_LINE.xs.length; i++) {
    towers.push({ x: POWER_LINE.xs[i], z: POWER_LINE.z, height: POWER_LINE.height, base: POWER_LINE.base, kind: 'pylon', tx: 1, tz: 0 });
    if (i > 0) powerLines.push([towers.length - 2, towers.length - 1]);
  }

  const plan: CityPlan = {
    bounds,
    palette: 'bay',
    // Exponential haze rather than a linear curtain: the far towers stay towers, read
    // through blue air, and their windows keep burning (see `env/haze.ts`).
    fog: { density: HAZE.cityDensity },
    downtown: { ...DOWNTOWN },
    roads: [],
    ribbons,
    rails,
    blocks,
    walls: perimeter,
    barriers: [],
    gates: routeGates(ground),
    billboards: [
      { variant: 0, x: -150, y: 30, z: bounds.minZ + 0.6, w: 30, h: 17, rotY: 0, color: PAL.neonCyan },
      { variant: 1, x: 150, y: 26, z: bounds.minZ + 0.6, w: 26, h: 15, rotY: 0, color: PAL.neonMagenta },
      { variant: 0, x: bounds.minX + 0.6, y: 28, z: -20, w: 30, h: 17, rotY: Math.PI / 2, color: PAL.neonCyan },
      { variant: 1, x: bounds.maxX - 0.6, y: 26, z: 100, w: 26, h: 15, rotY: -Math.PI / 2, color: PAL.neonMagenta },
      // The BADKALA WANTED campaign: portrait boards, so they read as an ad column between
      // the landscape holograms rather than as a fourth data wall.
      { variant: 2, x: 40, y: 30, z: bounds.minZ + 0.6, w: 14, h: 28, rotY: 0, color: PAL.neonMagenta },
      { variant: 2, x: bounds.minX + 0.6, y: 30, z: 150, w: 14, h: 28, rotY: Math.PI / 2, color: PAL.neonMagenta },
      { variant: 2, x: bounds.maxX - 0.6, y: 28, z: -110, w: 13, h: 26, rotY: -Math.PI / 2, color: PAL.neonMagenta },
    ],
    cableRuns: cableRuns(ground, CITY_BLOCK_OPTIONS),
    pylons: [],
    pillars,
    fences,
    towers,
    powerLines,
    ringBillboards: RING_BILLBOARDS.map((r) => ({ ...r })),
    skybridges,
    busStops,
    neonDistricts: NEON_DISTRICTS.map((r) => ({ ...r })),
    shoulders,
    kerbs,
    water,
    plaza: null,
    wantedBoard: null,
    startLine: null,
    checkpoints: [],
    zoneAt,
    isRoad(x, z, pad = 0) {
      for (const rb of ribbons) if (isOnPath(rb.path, x, z, pad)) return true;
      return false;
    },
    isSolid(x, z, pad = 0) {
      for (const b of solids) if (inRect(b, x, z, -pad)) return true;
      return false;
    },
    padY(x, z) {
      for (const b of solids) if (inRect(b, x, z)) return SIDEWALK_Y;
      return kerbs.heightAt(x, z, kerbGrade);
    },
  };

  return { layout, plan };
}

/* ------------------------------------------------------------------ helpers */

/**
 * A point `fraction` of the way round a closed loop of waypoints, the heading along the leg
 * it is on, and the index of the waypoint that leg leads to (the first one to drive at).
 */
function placeAlongLoop(loop: Array<{ x: number; z: number }>, fraction: number): { x: number; z: number; heading: number; next: number } {
  let total = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    total += Math.hypot(b.x - a.x, b.z - a.z);
  }
  let left = ((fraction % 1) + 1) % 1 * total;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= len || i === loop.length - 1) {
      const t = len > 0 ? Math.min(1, left / len) : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(b.x - a.x, -(b.z - a.z)), next: (i + 1) % loop.length };
    }
    left -= len;
  }
  return { x: loop[0].x, z: loop[0].z, heading: 0, next: 1 };
}

/** Corners of a rectangle of streets, clockwise, pulled into the right-hand lane. */
function loopWaypoints(r: Rect, d: number): Array<{ x: number; z: number }> {
  return [
    { x: r.minX + d, z: r.minZ + d },
    { x: r.maxX - d, z: r.minZ + d },
    { x: r.maxX - d, z: r.maxZ - d },
    { x: r.minX + d, z: r.maxZ - d },
  ];
}

/**
 * Bus stops along the boulevards: a shelter on the pavement, and at every other one a bus
 * parked at the kerb in front of it.
 *
 * A stop is placed only where the whole thing is honest. The street must be one of the wide
 * axis-aligned boulevards (so the colliders are exact boxes and the bus clears the traffic
 * lane), the pavement behind the kerb must be deep enough to hold the shelter clear of the
 * facades, and over the bus's whole length there must be no crossing road, no missing kerb
 * (a junction mouth) and nothing solid — checked at three stations, not just the middle,
 * because a 13.6 m bus is longer than most of what could go wrong under it.
 */
function placeBusStops(
  ground: RibbonDef[],
  elevated: RibbonDef[],
  kerbs: KerbField,
  shoulders: NonNullable<CityPlan['shoulders']>,
  isSolid: (x: number, z: number, pad: number) => boolean,
  lanes: Array<Array<{ x: number; z: number }>>,
): BusStopDef[] {
  const stops: BusStopDef[] = [];
  const grade = { gx: 0, gz: 0 };
  /** Half the bus's length: the reach of every clearance test below. */
  const reach = BUSES.length / 2;
  let route = 0;
  for (const tag of BUS_ROUTES) {
    const rb = ground.find((g) => g.tag === tag);
    if (!rb) continue;
    const path = rb.path;
    let side = 1;
    let last = -Infinity;
    // Searched finely and taken greedily rather than stepped at a fixed stride: a fixed
    // stride lands a third of its stops in a junction and simply loses them.
    for (let s = BUS_STOP_FIRST; s < path.length - BUS_STOP_FIRST; s += BUS_STOP_PROBE) {
      if (s - last < BUS_STOP_SPACING) continue;
      const c = offsetAtStation(path, s, 0);
      if (c.halfWidth < BUS_STOP_MIN_HALF_WIDTH) continue;
      // Axis-aligned only: a fattened box round a shelter on the diagonal would be a wall
      // across the pavement that nothing on screen accounts for.
      if (Math.abs(c.tx) < 0.999 && Math.abs(c.tz) < 0.999) continue;
      const pave = shoulders[c.zone];
      if (pave < BUS_STOP_MIN_PAVEMENT || pave < BUS_STOP_KERB_GAP + BUS_STOP.depth) continue;
      // The shelter stands just past the kerb, facing the lane a bus would pull into.
      const shelterOut = c.halfWidth + BUS_STOP_KERB_GAP + BUS_STOP.depth / 2;
      // Alternate sides down the route, so a street reads as served in both directions —
      // but take the other kerb rather than lose the stop, which is what a junction on one
      // side of a street would otherwise do to the whole of that stretch of the route.
      // Prefer whichever kerb a bus route actually drives along: a shelter no bus can pull
      // in at is scenery, and the routes are laid out before the stops for exactly this.
      const served = (trySide: number): boolean => {
        const a = offsetAtStation(path, s, trySide * shelterOut);
        for (const lane of lanes) if (stationOnLane(lane, a.x, a.z, c.tz * trySide, -c.tx * trySide) >= 0) return true;
        return false;
      };
      const order = served(side) && !served(-side) ? [side, -side] : [-side, side];
      let placed = 0;
      for (const trySide of order) {
        let ok = true;
        for (const d of [-reach, 0, reach]) {
          const a = offsetAtStation(path, s + d, trySide * shelterOut);
          if (Math.hypot(a.x - CITY_SPAWN.x, a.z - CITY_SPAWN.z) < BUS_STOP_SPAWN_CLEAR) ok = false;
          // A crossing road reaches out over the pavement: no shelter in a junction.
          for (const other of ground) if (isOnPath(other.path, a.x, a.z, 1)) ok = false;
          if (isSolid(a.x, a.z, 0.4)) ok = false;
          // No pavement here means a junction mouth, whatever the roads say.
          if (kerbs.heightAt(a.x, a.z, grade) <= 0) ok = false;
          // A deck overhead swallows the shelter's roof, and its pillars stand under it.
          for (const e of elevated) if (isOnPath(e.path, a.x, a.z, 10)) ok = false;
          if (!ok) break;
        }
        if (!ok) continue;
        const p = offsetAtStation(path, s, trySide * shelterOut);
        stops.push({
          x: p.x,
          z: p.z,
          y: SIDEWALK_Y,
          tx: c.tx,
          tz: c.tz,
          // The normal points back at the road the bus pulls in from.
          nx: c.tz * trySide,
          nz: -c.tx * trySide,
          zone: c.zone,
          route: route % 3,
        });
        placed = trySide;
        break;
      }
      if (placed === 0) continue;
      side = placed;
      last = s;
    }
    route++;
  }
  return stops;
}

/**
 * The bus routes: each rectangle in `BUS_ROUTE_LOOPS` turned into a closed loop of waypoints
 * in the kerb lane, plus the stations along it where a shelter stands on that kerb.
 *
 * The lane is worked out per leg from the street's own width rather than set once for the
 * rectangle, because the boulevards are not all the same width: the bus hugs the kerb of
 * whichever street it is on, which is both what a bus does and what keeps it outboard of the
 * electric cars' lane (they run `LANE` m off the centreline and steer round nothing).
 */
function busLanes(ground: RibbonDef[]): Array<Array<{ x: number; z: number }>> {
  const proj = createProjection();
  /** How far off the centreline the kerb lane is on the street under (x, z). */
  const laneAt = (x: number, z: number): number => {
    let best = Infinity;
    let halfWidth = 8;
    for (const rb of ground) {
      if (rb.kind === 'alley') continue;
      projectOntoPath(rb.path, x, z, proj);
      if (proj.dist < best) {
        best = proj.dist;
        halfWidth = proj.halfWidth;
      }
    }
    return Math.max(LANE + 1.6, halfWidth - BUSES.width / 2 - 0.7);
  };

  const lanes: Array<Array<{ x: number; z: number }>> = [];
  for (const rect of BUS_ROUTE_LOOPS) {
    // Clockwise: north leg first, and the inset toward the middle of the rectangle is the
    // right-hand side of travel on every leg (see `loopWaypoints`).
    const dN = laneAt((rect.minX + rect.maxX) / 2, rect.minZ);
    const dE = laneAt(rect.maxX, (rect.minZ + rect.maxZ) / 2);
    const dS = laneAt((rect.minX + rect.maxX) / 2, rect.maxZ);
    const dW = laneAt(rect.minX, (rect.minZ + rect.maxZ) / 2);
    lanes.push([
      { x: rect.minX + dW, z: rect.minZ + dN },
      { x: rect.maxX - dE, z: rect.minZ + dN },
      { x: rect.maxX - dE, z: rect.maxZ - dS },
      { x: rect.minX + dW, z: rect.maxZ - dS },
    ]);
  }
  return lanes;
}

/**
 * How far round `lane` a shelter at (x, z) facing (nx, nz) is called at, or -1 if the bus
 * passes it: a shelter on the far kerb belongs to the service coming the other way.
 */
function stationOnLane(lane: Array<{ x: number; z: number }>, x: number, z: number, nx: number, nz: number): number {
  let base = 0;
  for (let i = 0; i < lane.length; i++) {
    const a = lane[i];
    const b = lane[(i + 1) % lane.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1) continue;
    const tx = (b.x - a.x) / len;
    const tz = (b.z - a.z) / len;
    // Heading atan2(tx, -tz) has right = (cos h, sin h) = (-tz, tx).
    const rx = -tz;
    const rz = tx;
    const along = (x - a.x) * tx + (z - a.z) * tz;
    const across = (x - a.x) * rx + (z - a.z) * rz;
    if (
      along >= BUS_STOP.length &&
      along <= len - BUS_STOP.length &&
      across >= 1 &&
      across <= BUS_STOP.depth + BUSES.width + 2 &&
      // Facing back at the lane, and along the street the lane is on.
      nx * rx + nz * rz < -0.9
    ) {
      return base + along;
    }
    base += len;
  }
  return -1;
}

/**
 * Stations round a loop where a shelter stands on the bus's right, in the order it meets
 * them. A shelter on the far kerb is passed, not called at: its bus is the one coming the
 * other way, on the other route or the other side of the same street.
 */
function callingPoints(lane: Array<{ x: number; z: number }>, stops: readonly BusStopDef[]): number[] {
  const found: number[] = [];
  for (const st of stops) {
    const at = stationOnLane(lane, st.x, st.z, st.nx, st.nz);
    if (at >= 0) found.push(at);
  }
  found.sort((p, q) => p - q);
  return found;
}

/** Neon route gates over the boulevards, at fixed stations. */
function routeGates(ground: RibbonDef[]): GateDef[] {
  const out: GateDef[] = [];
  const wanted: Array<[string, number, number, number]> = [
    ['blvd-north', 140, PAL.neonCyan, PAL.neonBlue],
    ['blvd-north', 290, PAL.neonMagenta, PAL.neonCyan],
    ['blvd-center', 110, PAL.neonCyan, PAL.neonMagenta],
    ['blvd-center', 420, PAL.neonPink, PAL.neonMagenta],
    ['blvd-water', 260, PAL.neonMagenta, PAL.neonPink],
    ['av-main', 150, PAL.neonCyan, PAL.neonBlue],
  ];
  for (const [tag, s, left, right] of wanted) {
    const rb = ground.find((g) => g.tag === tag);
    if (!rb) continue;
    const c = offsetAtStation(rb.path, s, 0);
    const hw = c.halfWidth + 1.6;
    out.push({
      x0: c.x + -c.tz * -hw,
      z0: c.z + c.tx * -hw,
      x1: c.x + -c.tz * hw,
      z1: c.z + c.tx * hw,
      height: c.zone === 'corporate' ? 11.5 : 9.5,
      left,
      right,
      trusted: true,
    });
  }
  return out;
}

/** Overhead cables across the streets and the alleys, anchored in the blocks either side. */
function cableRuns(ground: RibbonDef[], opts: BlockOptions): Array<[number, number, number, number]> {
  const runs: Array<[number, number, number, number]> = [];
  for (const rb of ground) {
    const step = rb.kind === 'alley' ? 18 : 30;
    for (let s = step / 2; s < rb.path.length; s += step) {
      const c = offsetAtStation(rb.path, s, 0);
      if (rb.kind === 'track' && c.zone === 'corporate') continue;
      const reach = c.halfWidth + (rb.kind === 'alley' ? opts.alleyShoulder : opts.shoulder[c.zone]) + 2.2;
      runs.push([c.x + -c.tz * -reach, c.z + c.tx * -reach, c.x + -c.tz * reach, c.z + c.tx * reach]);
    }
  }
  return runs;
}

/**
 * Enclosed bridges between buildings across a street: wherever a mid-rise or a tower stands
 * on both sides of one of the big streets, a few metres into each block so the ends vanish
 * inside the facades. Nothing under a viaduct or the skyway.
 */
function findSkybridges(ground: RibbonDef[], elevated: RibbonDef[], blocks: BlockRect[], zoneAt: (x: number, z: number) => ZoneId): SkybridgeDef[] {
  const out: SkybridgeDef[] = [];
  const wanted = ['av-main', 'av-east', 'st-mid', 'blvd-north', 'st-n2', 'blvd-center', 'st-west'];
  const blockAt = (x: number, z: number): BlockRect | null => {
    for (const b of blocks) if (inRect(b, x, z)) return b;
    return null;
  };
  for (const tag of wanted) {
    const rb = ground.find((g) => g.tag === tag);
    if (!rb) continue;
    const path = rb.path;
    for (let s = 50; s < path.length - 50; s += 55) {
      const c = offsetAtStation(path, s, 0);
      const downtown = inRect(DOWNTOWN, c.x, c.z);
      if (hash01(s, path.length) > (downtown ? 0.75 : 0.5)) continue;
      const zone = zoneAt(c.x, c.z);
      if (zone === 'jdm') continue;
      const nx = -c.tz;
      const nz = c.tx;
      // Nothing overhead: a bridge under a deck reads as a mistake.
      let overhead = false;
      for (const e of elevated) if (isOnPath(e.path, c.x, c.z, 8)) overhead = true;
      if (overhead) continue;
      // The first block met walking out from the road edge on each side.
      const probe = (side: number): { blk: BlockRect; reach: number } | null => {
        for (let d = c.halfWidth + 1; d < c.halfWidth + 14; d += 1) {
          const blk = blockAt(c.x + nx * d * side, c.z + nz * d * side);
          if (blk) return { blk, reach: d + 5 };
        }
        return null;
      };
      const left = probe(-1);
      const right = probe(1);
      if (!left || !right) continue;
      const a = left.blk;
      const b = right.blk;
      if (a === b || a.massing < 2 || b.massing < 2) continue;
      if (downtown && (a.massing < 3 || b.massing < 3)) continue;
      // Both blocks must be long enough along the street for the bridge to land in a building.
      const along = (blk: BlockRect): number => (Math.abs(c.tx) > 0.5 ? blk.maxX - blk.minX : blk.maxZ - blk.minZ);
      if (along(a) < 16 || along(b) < 16) continue;
      const y = downtown ? 22 + hash01(s * 3, path.length) * 30 : 12 + hash01(s * 3, path.length) * 8;
      out.push({
        ax: c.x - nx * left.reach,
        az: c.z - nz * left.reach,
        bx: c.x + nx * right.reach,
        bz: c.z + nz * right.reach,
        y,
        width: 3.6,
        height: 3.2,
        zone,
      });
      if (out.length >= 22) return out;
    }
  }
  return out;
}

/** Test/tool helper: the elevated paths, for tests that walk them. */
export function cityElevatedPaths(): TrackPath[] {
  return [buildTrackPath(VIADUCT_SPEC), ...RAMP_SPECS.map((r) => buildTrackPath(r.spec)), buildTrackPath(SKYWAY_SPEC.spec)];
}
