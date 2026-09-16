import type { ArenaLayout, BusRoute, ObstacleBox, ObstacleWall, SpawnPoint } from '../core/types';
import { BUSES } from '../config/tuning';
import { HAZE } from '../render/scene/env/haze';
import type { World } from './arenaWorld';
import {
  BUS_STOP,
  inRect,
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
import { buildRails, generateBlocks, hash01, onRibbonAtLevel, pathBox, pointRectDistance, railBounds, streetShoulder, type BlockOptions } from './cityGen';
import { meetColliders } from './carMeet';
import { clipBlocksToLots, stationColliders } from './gasStation';
import { garageColliders, garageParts, garageSite } from './garage';
import type { CitySpec } from './cityDef';
import { BAY_SPEC } from './citySpec';
import { reserveMegastructurePlots } from './cityMegastructures';
import { createKerbField } from './kerbs';
import { createRectIndex } from './spatialIndex';
import { createSurfaceField } from './surface';
import { createTerrain } from './terrain';
import { buildTrackPath, createProjection, isElevated, isOnPath, offsetAtStation, pointAtStation, projectOntoPath, type TrackPath } from './track';

/**
 * The big city, generated from a `CitySpec` (`cityDef.ts`): Bandido Bay (`citySpec.ts`,
 * "OPEN WORLD" in the main menu) by default, The Stack (`stackSpec.ts`) when handed that one.
 * The assembler knows neither city by name; everything below reads the spec.
 *
 *  - every road is a ribbon: the ground network, the alleys, the viaducts, their ramps and
 *    the skyways. The elevated ones carry heights in their samples; the surface field built
 *    from them is what the simulation reads the car's height from,
 *  - blocks grow in the grid between the roads (`cityGen.ts`); a viaduct only clears the
 *    narrow corridor under itself, so the towers stand right up against the deck,
 *  - the elevated roads get guardrails as wall colliders bounded in height, and pillars as
 *    ground colliders wherever the deck is not over a street or another deck,
 *  - a city with a shore ends in water behind a quay wall, and a viaduct out over it is a
 *    bridge; one without ends in the perimeter band on all four sides,
 *  - traffic: rectangles of streets driven clockwise, plus cars lapping every elevated loop.
 *
 * Collision and art come from the same segments, rectangles and points, as everywhere else.
 */

/** Deck heights below this are an embankment, not a bridge: no pillars, nothing drives under. */
const PILLAR_MIN_Y = 4.5;
/** Column spacing (m), unless the spec says otherwise. Close, so the underside reads as a structure, not a table on stilts. */
const PILLAR_STEP = 12;
/** Half size of a column's ground collider (m): the column plus the barrier ring at its foot. */
const PILLAR_HALF = 1.3;
/** Right-hand lane offset for the traffic (m from the centreline). */
const LANE = 3.5;
/** Quay wall segment length (m). */
const QUAY_STEP = 8;

/** Least distance between stops on one route (m), and where the first one may stand. */
const BUS_STOP_SPACING = 130;
const BUS_STOP_FIRST = 60;
/** How finely the route is searched for somewhere a stop fits (m). */
const BUS_STOP_PROBE = 6;
/** A stop needs this much road either side of the centreline (m): see `placeBusStops`. */
const BUS_STOP_MIN_HALF_WIDTH = 8;
/** And this much pavement behind the kerb (m), or the shelter would stand in a facade. */
const BUS_STOP_MIN_PAVEMENT = 2.6;
/** Gap between the kerb and the shelter's near face (m). */
const BUS_STOP_KERB_GAP = 0.35;
/** Nothing parked within this of the player's spawn (m). */
const BUS_STOP_SPAWN_CLEAR = 34;

/**
 * Assemble a city. Called with no argument this is Bandido Bay, exactly as it was before the
 * spec existed: the circuit, the street race and every mission instance it that way.
 */
export function createCityWorld(spec: CitySpec = BAY_SPEC): World {
  const bounds: Rect = { ...spec.bounds };
  const wallBand = spec.wallBand;
  const quayZ = spec.water ? spec.water.quayZ : null;
  const inner: Rect = {
    minX: bounds.minX + wallBand,
    maxX: bounds.maxX - wallBand,
    minZ: bounds.minZ + wallBand,
    maxZ: quayZ ?? bounds.maxZ - wallBand,
  };
  const blockOptions = spec.blockOptions;
  const pillarStep = spec.pillarStep ?? PILLAR_STEP;

  /* ---------------------------------------------------------- roads */

  const ground: RibbonDef[] = spec.roads.map((r, i) => ({
    path: buildTrackPath(r.spec),
    kind: r.kind,
    tag: r.tag,
    // Roads crossing at grade get their own lift each, so their slabs never z-fight.
    lift: i * 0.004 + (r.kind === 'alley' ? 0.002 : 0),
  }));
  const elevated: RibbonDef[] = spec.elevated.map((r) => ({ path: buildTrackPath(r.spec), kind: 'track', tag: r.tag, elevated: true, lift: r.lift }));
  for (const rb of elevated) if (!isElevated(rb.path)) throw new Error(`${spec.name}: ${rb.tag} is meant to be elevated`);
  const ribbons: RibbonDef[] = [...ground, ...elevated];

  /* ---------------------------------------------------------- land, water, walls */

  // The perimeter band: three sides when the fourth is water, otherwise all four.
  const perimeter: WallRect[] = [
    { tag: 'wall-n', minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: inner.minZ },
    { tag: 'wall-w', minX: bounds.minX, maxX: inner.minX, minZ: inner.minZ, maxZ: inner.maxZ },
    { tag: 'wall-e', minX: inner.maxX, maxX: bounds.maxX, minZ: inner.minZ, maxZ: inner.maxZ },
  ];
  if (quayZ === null) perimeter.push({ tag: 'wall-s', minX: bounds.minX, maxX: bounds.maxX, minZ: inner.maxZ, maxZ: bounds.maxZ });
  const water = quayZ !== null ? { rect: { minX: bounds.minX - 400, maxX: bounds.maxX + 400, minZ: quayZ, maxZ: bounds.maxZ + 500 }, quayZ } : null;

  /**
   * Zone of the nearest street: the city follows the road it stands on. A road is only
   * projected onto when its bounding box is nearer than the best road found so far — the
   * nearest box first, so that on a map of sixty streets the answer costs two or three
   * projections rather than sixty.
   */
  const proj = createProjection();
  const groundBoxes = ground.map((rb) => pathBox(rb.path));
  const boxDist = new Float64Array(ground.length);
  const zoneAt = (x: number, z: number): ZoneId => {
    let best = Infinity;
    let zone: ZoneId = 'urban';
    let first = 0;
    for (let i = 0; i < ground.length; i++) {
      boxDist[i] = pointRectDistance(x, z, groundBoxes[i]);
      if (boxDist[i] < boxDist[first]) first = i;
    }
    for (let k = -1; k < ground.length; k++) {
      const i = k < 0 ? first : k;
      if (k === first) continue;
      if (boxDist[i] >= best) continue;
      const rb = ground[i];
      projectOntoPath(rb.path, x, z, proj);
      if (proj.dist < best) {
        best = proj.dist;
        zone = rb.path.samples[proj.index].zone;
      }
    }
    return zone;
  };

  const megastructures = spec.planMegastructures ? spec.planMegastructures(ribbons) : [];
  // A car meet takes its block whole: every plot the generator put on the lot is given up.
  const meets = spec.meets ?? [];
  const meetLots = meets.map((m) => m.lot);
  // A gas station takes only a corner: the plots it touches are cut back to its edge.
  const gasStations = spec.gasStations ?? [];
  // Loco Mustang's garage takes a corner the same way.
  const garage = spec.garage ?? null;
  const cornerLots = [...gasStations.map((g) => g.lot), ...(garage ? [garage.lot] : [])];
  const lots = [...meetLots, ...cornerLots];
  const inLot = (x: number, z: number, pad = 0): boolean => lots.some((l) => inRect(l, x, z, pad));
  // The lie of the land (`terrain.ts`): the relief the spec draws, held level under every
  // elevated road, on every lot, along the shore and wherever else the spec says. Everything
  // below is laid out on flat ground the way it always was — the blocks, the kerbs, the rails,
  // the pillars — and the ground roads are draped over the terrain last of all, so nothing at
  // build time mistakes a street on a hill for a ramp. Flat, in a spec that draws no relief.
  const terrain = createTerrain(spec.terrain, bounds, elevated.map((rb) => rb.path), lots, quayZ);
  const touchesLot = (r: Rect): boolean => meetLots.some((l) => r.maxX > l.minX && r.minX < l.maxX && r.maxZ > l.minZ && r.minZ < l.maxZ);
  const blocks = clipBlocksToLots(
    reserveMegastructurePlots(generateBlocks(inner, ribbons, zoneAt, blockOptions), megastructures).filter((blk) => !touchesLot(blk)),
    cornerLots,
  );
  const rails = buildRails(ribbons, (rb) => !!rb.elevated);
  const groundMasses: BlockRect[] = megastructures.flatMap((m) => m.volumes.filter((v) => v.y0 === 0).map((v) => ({
    ...v, tag: m.tag, zone: 'urban' as const, massing: 4 as const,
  })));
  const solids: Rect[] = [...blocks, ...groundMasses, ...perimeter];
  const solidIndex = createRectIndex(solids);
  const isSolid = (x: number, z: number, pad = 0): boolean => {
    const near = solidIndex.at(x, z);
    for (let i = 0; i < near.length; i++) if (inRect(near[i], x, z, -pad)) return true;
    return false;
  };
  const shoulders = { ...blockOptions.shoulder, alley: blockOptions.alleyShoulder };
  // The pavement beside the streets: flush with them, so this is art and nothing the car feels.
  // A lot stands in for the block it replaced, so the pavement still runs to its edge.
  const kerbs = createKerbField(ribbons, shoulders, [...blocks, ...groundMasses, ...lots], blockOptions.shoulderAt);

  const onGroundRoad = (x: number, z: number, pad: number): boolean => {
    for (const rb of ground) if (isOnPath(rb.path, x, z, pad)) return true;
    return false;
  };

  /* ---------------------------------------------------------- pillars */

  const pillars: PillarDef[] = [];
  for (const rb of elevated) {
    const path = rb.path;
    for (let s = pillarStep / 2; s < path.length; s += pillarStep) {
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
      pillars.push({ x: c.x, z: c.z, tx: c.tx, tz: c.tz, y: c.y, halfWidth: c.halfWidth, wet: quayZ !== null && c.z > quayZ, zone: c.zone });
    }
  }

  /* ---------------------------------------------------------- fences */

  // Between consecutive columns of one ribbon, on both sides, two bays out of three (or one,
  // when the spec is saving triangles): the space under the deck is fenced off the street,
  // and entered through the open bays.
  const fences: FenceDef[] = [];
  {
    let last: PillarDef | null = null;
    let bay = 0;
    const fenced = spec.fenceBays === 'few' ? (k: number): boolean => k % 3 === 0 : (k: number): boolean => k % 3 !== 2;
    for (const p of pillars) {
      if (last && !last.wet && !p.wet && Math.hypot(p.x - last.x, p.z - last.z) < pillarStep * 1.5) {
        // A lot the deck crosses is open underneath: its columns stand on the lot.
        if (fenced(bay) && !inLot((last.x + p.x) / 2, (last.z + p.z) / 2, 2)) {
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
  if (quayZ !== null) {
    for (let x = inner.minX; x < inner.maxX; x += QUAY_STEP) {
      const bx = Math.min(inner.maxX, x + QUAY_STEP);
      const mx = (x + bx) / 2;
      // A ramp that comes ashore here opens the wall; its own rails keep the car on it.
      let open = false;
      for (const rb of ribbons) {
        if (onRibbonAtLevel(rb, mx, quayZ, 0, 2.5)) {
          open = true;
          break;
        }
      }
      if (open) continue;
      quay.push({ ax: x, az: quayZ, bx, bz: quayZ, maxY: 4, tag: 'quay' });
    }
  }

  /* ---------------------------------------------------------- skybridges */

  // The megastructures' ground masses count as buildings to land a bridge in. A world may
  // bridge different streets by different rules (`skybridgeSets`); the Bay and the Stack
  // each have one.
  const skybridgeSets = spec.skybridgeSets ?? [{ streets: spec.skybridgeStreets, style: spec.skybridges }];
  const skybridges = skybridgeSets
    .flatMap((set) => findSkybridges(ground, elevated, [...blocks, ...groundMasses], zoneAt, set.streets, spec.downtown, set.style, set.within))
    // A bridge's tier is a height over the street; the street may be on a hill.
    .map((sb) => ({ ...sb, y: sb.y + terrain.heightAt((sb.ax + sb.bx) / 2, (sb.az + sb.bz) / 2) }));

  /* ---------------------------------------------------------- bus stops */

  // The routes are laid out first: a shelter is put on the kerb a bus drives along wherever
  // both kerbs would do, so the network is a network and not two unrelated things.
  const lanes = busLanes(ground, spec.busRouteLoops);
  const busStops = placeBusStops(
    ground,
    elevated,
    kerbs,
    shoulders,
    (x, z, pad) => isSolid(x, z, -pad),
    lanes,
    spec.busRoutes,
    spec.spawn,
    blockOptions.shoulderAt,
    spec.busStopSpacing ?? BUS_STOP_SPACING,
  );
  // A shelter stands on the ground it was placed on.
  for (const st of busStops) st.y = terrain.heightAt(st.x, st.z);
  const busRoutes: BusRoute[] = lanes.map((points) => ({ points, stops: callingPoints(points, busStops) }));


  /* ---------------------------------------------------------- traffic, cruise */

  // Built here rather than at the layout: a ground spawn at the foot of a ramp sits a few
  // centimetres above zero, and the car has to start on the road, not under it.
  const surface = createSurfaceField(elevated.map((rb) => rb.path), 1.5, terrain);
  const GROUND_SAMPLE = { y: 0, gx: 0, gz: 0 };

  const targetSpawns: SpawnPoint[] = [];
  const targetPatrols: Array<Array<{ x: number; z: number }>> = [];
  // Every road carries traffic both ways: half the cars of a loop drive it clockwise in the
  // inner lane, half anticlockwise in the outer one, so each file keeps to its own side of
  // the centreline and the player meets oncoming headlights.
  for (const loop of spec.trafficLoops) {
    for (const dir of [1, -1]) {
      const corners = dir > 0 ? loopWaypoints(loop.rect, LANE) : loopWaypoints(loop.rect, -LANE).reverse();
      const cars = dir > 0 ? Math.ceil(loop.cars / 2) : Math.floor(loop.cars / 2);
      for (let k = 0; k < cars; k++) {
        // Spread the cars evenly round the rectangle: car k starts k/n of the way round.
        const at = placeAlongLoop(corners, (k + 0.5) / cars);
        const rotated = [...corners.slice(at.next), ...corners.slice(0, at.next)];
        surface.sample(at.x, at.z, 0, GROUND_SAMPLE);
        targetSpawns.push({ x: at.x, z: at.z, y: GROUND_SAMPLE.y, heading: at.heading });
        targetPatrols.push(rotated);
      }
    }
  }
  for (const deck of spec.deckTraffic) {
    // The elevated loops the same way: lanes each side of the centreline, the oncoming files
    // driven round the loop backwards. Lanes are offset half a gap from each other so the
    // files interleave rather than driving in pairs. Each waypoint carries the deck's height
    // there, so a car on a loop that climbs (or on one merged from a ramp) spawns on it.
    const rb = elevated.find((e) => e.tag === deck.tag);
    if (!rb || !rb.path.closed) throw new Error(`${spec.name}: deck traffic wants a closed elevated loop tagged ${deck.tag}`);
    const samples = rb.path.samples;
    const lanes: Array<Array<{ x: number; z: number; y: number }>> = [];
    for (const dir of [1, -1]) {
      for (const offset of deck.lanes) {
        const lane: Array<{ x: number; z: number; y: number }> = [];
        for (let i = 0; i < samples.length; i += 3) {
          const s = samples[i];
          lane.push({ x: s.x + -s.tz * offset * dir, z: s.z + s.tx * offset * dir, y: s.y });
        }
        lanes.push(dir > 0 ? lane : lane.reverse());
      }
    }
    const perLane = Math.floor(deck.cars / lanes.length);
    for (let l = 0; l < lanes.length; l++) {
      const lane = lanes[l];
      for (let k = 0; k < perLane; k++) {
        const start = Math.floor(((k + (l % 2) * 0.5) * lane.length) / perLane) % lane.length;
        const rotated = [...lane.slice(start), ...lane.slice(0, start)];
        const ahead = rotated[1] ?? rotated[0];
        targetSpawns.push({
          x: rotated[0].x,
          z: rotated[0].z,
          y: rotated[0].y,
          heading: Math.atan2(ahead.x - rotated[0].x, -(ahead.z - rotated[0].z)),
        });
        targetPatrols.push(rotated.map((w) => ({ x: w.x, z: w.z })));
      }
    }
  }

  const cruiseRoute = loopWaypoints(spec.cruiseLoop, LANE);

  /* ---------------------------------------------------------- layout */

  const colliders: ObstacleBox[] = [];
  for (const m of megastructures) for (const v of m.volumes) {
    colliders.push({ ...v, minY: v.y0, maxY: v.y1, tag: m.tag });
  }
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
    colliders.push({ minX: st.x - hx, maxX: st.x + hx, minZ: st.z - hz, maxZ: st.z + hz, maxY: st.y + BUS_STOP.height, tag: 'bus-stop' });
  }
  const walls: ObstacleWall[] = rails.map((r) => ({ ax: r.ax, az: r.az, bx: r.bx, bz: r.bz, ...railBounds(r), tag: r.kind }));
  walls.push(...quay);
  for (const f of fences) walls.push({ ax: f.ax, az: f.az, bx: f.bx, bz: f.bz, maxY: f.y - 1.4, tag: 'fence' });
  // The meets: the lot's edges, and the parked cars, people and props, from the same boxes
  // the art is drawn from (`carMeet.ts`). Before the buses, which have to stay last.
  for (const m of meets) {
    const c = meetColliders(m);
    colliders.push(...c.boxes);
    walls.push(...c.walls);
  }
  // The gas stations: islands, columns, the shop, the pylon and the low walls (`gasStation.ts`).
  for (const g of gasStations) {
    const c = stationColliders(g);
    colliders.push(...c.boxes);
    walls.push(...c.walls);
  }
  // The garage: the block round its mouth and the van backed into it (`garage.ts`).
  if (garage) colliders.push(...garageColliders(garage));
  // Four segments per bus, LAST in the list and in bus order, rewritten in place every tick
  // by `src/sim/buses.ts` as the bus moves. Parked off the map until the first tick writes
  // them, so nothing that reads a freshly built layout finds a bus in the middle of a road.
  const PARKED = bounds.minZ - 1000;
  for (let i = 0; i < busRoutes.length * BUSES.perRoute * 4; i++) {
    walls.push({ ax: 0, az: PARKED, bx: 0, bz: PARKED, maxY: BUSES.height, tag: 'bus' });
  }

  /** A site on the ground, at the ground's height there: the spec writes them at y 0. */
  const onGround = <T extends { x: number; z: number; y: number }>(site: T): T => ({ ...site, y: terrain.heightAt(site.x, site.z) });

  const layout: ArenaLayout = {
    bounds,
    playerSpawn: { ...spec.spawn, y: terrain.heightAt(spec.spawn.x, spec.spawn.z) },
    targetSpawns,
    targetPatrols,
    cruiseRoute,
    colliders,
    walls,
    surface,
    groundY: (x, z) => terrain.heightAt(x, z),
    race: null,
    // The free-world activity markers, one per mission and in mission order. Points and
    // headings; the rules read them (`src/sim/rush.ts`) and the art stands on whichever is
    // current (`env/rushMarker.ts`). No colliders — the streets under them are still streets.
    rushSites: spec.rushSites.map((site) => onGround(site)),
    // Where passengers wait. Points on roads; the rules and the art both read this list.
    passengerStops: spec.passengerStops.map((stop) => ({ ...onGround(stop), tags: stop.tags.slice() })),
    passengerTrip: spec.passengerTrip ? { ...spec.passengerTrip } : null,
    // The streets, as centrelines, for `src/world/roadGraph.ts` to route a passenger home over.
    // Ground only: the viaduct and its ramps are left out because every stop is a kerb, and a
    // deck crossing over a street is not a turning off it.
    roadNetwork: ground.map((rb) => ({ points: rb.path.samples.map((sm) => ({ x: sm.x, z: sm.z })) })),
    // Where El Búho stands. A point under the deck; the rules and the figure both read it.
    buhoSite: spec.buhoSite ? onGround(spec.buhoSite) : null,
    // The ring on the garage's apron, where Loco Mustang talks to whoever pulls up.
    garageSite: garage ? onGround(garageSite(garage)) : null,
    busRoutes,
    minimap: {
      bounds: { minX: inner.minX, maxX: inner.maxX, minZ: inner.minZ, maxZ: quayZ !== null ? bounds.maxZ - 20 : inner.maxZ },
      // A lot reads on the map as ground you can drive, like the streets into it.
      // The garage's is only its apron: the rest of its lot is the building.
      rects: [...meetLots, ...gasStations.map((g) => g.lot), ...(garage ? [garageParts(garage).apron] : [])].map((l) => ({ ...l })),
      ribbons: ribbons.map((rb) => ({
        points: rb.path.samples.filter((_, i) => i % 2 === 0 || !rb.path.closed).map((s) => ({ x: s.x, z: s.z })),
        width: rb.path.samples.reduce((sum, s) => sum + s.halfWidth * 2, 0) / rb.path.samples.length,
        closed: rb.path.closed,
        hidden: false,
        elevated: !!rb.elevated,
      })),
      ...(quayZ !== null ? { water: { minX: inner.minX, maxX: inner.maxX, minZ: quayZ, maxZ: bounds.maxZ - 20 } } : {}),
      // The FIRST site only: the map marks where the marker actually is, and the marker is
      // only ever at one of these at a time. `Minimap.setActivities` moves the mark when a
      // cleared mission moves the marker, so the map cannot send the player somewhere it is not.
      activities: spec.rushSites.length > 0 ? [{ x: spec.rushSites[0].x, z: spec.rushSites[0].z }] : [],
    },
  };

  /* ---------------------------------------------------------- plan */

  const towers: TowerDef[] = spec.radioTowers.map((t) => ({ ...t, kind: 'radio' as const }));
  const powerLines: Array<[number, number]> = [];
  const line = spec.powerLine;
  if (line) {
    for (let i = 0; i < line.xs.length; i++) {
      towers.push({ x: line.xs[i], z: line.z, height: line.height, base: line.base, kind: 'pylon', tx: 1, tz: 0 });
      if (i > 0) powerLines.push([towers.length - 2, towers.length - 1]);
    }
  }

  const plan: CityPlan = {
    bounds,
    palette: spec.palette ?? 'bay',
    // Exponential haze rather than a linear curtain: the far towers stay towers, read
    // through blue air, and their windows keep burning (see `env/haze.ts`).
    fog: { density: spec.fogDensity ?? HAZE.cityDensity },
    downtown: spec.downtown ? { ...spec.downtown } : null,
    roads: [],
    ribbons,
    rails,
    blocks,
    megastructures,
    walls: perimeter,
    barriers: [],
    gates: routeGates(ground, spec.gates()),
    billboards: spec.billboards(bounds),
    // Nothing is strung into a lot: there is no building on it to anchor the far end.
    cableRuns: cableRuns(ground, blockOptions, spec.art?.finish === 'concrete', spec.finishAt, spec.densityAt).filter(
      ([ax, az, bx, bz]) => !inLot(ax, az) && !inLot(bx, bz),
    ),
    pylons: [],
    pillars,
    fences,
    towers,
    powerLines,
    ringBillboards: spec.ringBillboards.map((r) => ({ ...r })),
    skybridges,
    busStops,
    neonDistricts: spec.neonDistricts.map((r) => ({ ...r })),
    screens: (spec.screens ?? []).map((z) => ({ ...z, within: { ...z.within } })),
    shoulders,
    kerbs,
    water,
    plaza: null,
    wantedBoard: null,
    rushMarkers: spec.rushSites.map((site) => onGround(site)),
    startLine: null,
    checkpoints: [],
    // Roads inside the buildings, and the frames over the open ones (Phase 2 of the Stack).
    passages: megastructures.flatMap((m) => m.passages ?? []),
    ...(meets.length > 0 ? { meets: meets.map((m) => ({ ...m })) } : {}),
    ...(gasStations.length > 0 ? { gasStations: gasStations.map((g) => ({ ...g })) } : {}),
    ...(garage ? { garage: { ...garage, streets: garage.streets.slice() } } : {}),
    ...(spec.portalFrames ? { portalFrames: spec.portalFrames.slice() } : {}),
    ...(spec.landmarks ? { landmarkAnchors: spec.landmarks.map((l) => ({ ...l })) } : {}),
    ...(spec.art ?? {}),
    // A world built of more than one city (Bandido Metro) says where each rule applies.
    ...(spec.finishAt ? { finishAt: spec.finishAt } : {}),
    ...(spec.setbackAt ? { setbackAt: spec.setbackAt } : {}),
    ...(spec.densityAt ? { densityAt: spec.densityAt } : {}),
    ...(blockOptions.shoulderAt ? { shoulderAt: blockOptions.shoulderAt } : {}),
    ...(spec.render ? { render: { ...spec.render } } : {}),
    ...(terrain.flat ? {} : { terrain }),
    zoneAt,
    isRoad(x, z, pad = 0) {
      for (const rb of ribbons) if (isOnPath(rb.path, x, z, pad)) return true;
      return false;
    },
    isSolid,
    padY(x, z) {
      return terrain.heightAt(x, z);
    },
  };

  // LAST: the ground roads are draped over the terrain, centreline sample by sample. Everything
  // above was laid out with them flat, which is what the block generator, the kerb field and
  // the rail gaps assume of a street; from here on whoever reads a sample's `y` — recovery, the
  // marker paint, the gutters' grates — gets the road's real height. The renderer drapes their
  // slabs vertex by vertex off `padY` and only reads these for the level a lamp stands at.
  if (!terrain.flat) for (const rb of ground) for (const s of rb.path.samples) s.y = terrain.heightAt(s.x, s.z);

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
  /**
   * The streets with shelters: the wide, straight, axis-aligned boulevards, which are the only
   * streets with both a deep enough pavement for a shelter and enough asphalt to park a
   * 13.6 m bus at the kerb without standing in the traffic's lane (`LANE` m off the centreline).
   */
  routes: readonly string[],
  spawn: { x: number; z: number },
  shoulderAt?: (x: number, z: number, zone: ZoneId) => number,
  spacing = BUS_STOP_SPACING,
): BusStopDef[] {
  const stops: BusStopDef[] = [];
  const station = createProjection();
  /** Half the bus's length: the reach of every clearance test below. */
  const reach = BUSES.length / 2;
  let route = 0;
  for (const tag of routes) {
    const rb = ground.find((g) => g.tag === tag);
    if (!rb) continue;
    const path = rb.path;
    let side = 1;
    let last = -Infinity;
    // Searched finely and taken greedily rather than stepped at a fixed stride: a fixed
    // stride lands a third of its stops in a junction and simply loses them.
    for (let s = BUS_STOP_FIRST; s < path.length - BUS_STOP_FIRST; s += BUS_STOP_PROBE) {
      if (s - last < spacing) continue;
      const c = offsetAtStation(path, s, 0);
      if (c.halfWidth < BUS_STOP_MIN_HALF_WIDTH) continue;
      // Axis-aligned only: a fattened box round a shelter on the diagonal would be a wall
      // across the pavement that nothing on screen accounts for.
      if (Math.abs(c.tx) < 0.999 && Math.abs(c.tz) < 0.999) continue;
      const pave = shoulderAt ? shoulderAt(c.x, c.z, c.zone) : shoulders[c.zone];
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
          if (Math.hypot(a.x - spawn.x, a.z - spawn.z) < BUS_STOP_SPAWN_CLEAR) ok = false;
          // A crossing road reaches out over the pavement: no shelter in a junction.
          for (const other of ground) if (isOnPath(other.path, a.x, a.z, 1)) ok = false;
          if (isSolid(a.x, a.z, 0.4)) ok = false;
          // No pavement wide enough to hold the shelter means a junction mouth, whatever
          // the roads say.
          const at = pointAtStation(path, s + d, station);
          if (!kerbs.paved(rb, at.index, trySide) || kerbs.widthAt(rb, at.index, trySide, at.t) < shelterOut - at.halfWidth) ok = false;
          // A deck overhead swallows the shelter's roof, and its pillars stand under it.
          for (const e of elevated) if (isOnPath(e.path, a.x, a.z, 10)) ok = false;
          if (!ok) break;
        }
        if (!ok) continue;
        const p = offsetAtStation(path, s, trySide * shelterOut);
        stops.push({
          x: p.x,
          z: p.z,
          y: 0,
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
 * The bus routes: each rectangle in `spec.busRouteLoops` turned into a closed loop of waypoints
 * in the kerb lane, plus the stations along it where a shelter stands on that kerb.
 *
 * The lane is worked out per leg from the street's own width rather than set once for the
 * rectangle, because the boulevards are not all the same width: the bus hugs the kerb of
 * whichever street it is on, which is both what a bus does and what keeps it outboard of the
 * electric cars' lane (they run `LANE` m off the centreline and steer round nothing).
 */
function busLanes(ground: RibbonDef[], loops: readonly Rect[]): Array<Array<{ x: number; z: number }>> {
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
  for (const rect of loops) {
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

/** Neon route gates over the boulevards, at fixed stations: [street, station, left colour, right colour]. */
function routeGates(ground: RibbonDef[], wanted: ReadonlyArray<[string, number, number, number]>): GateDef[] {
  const out: GateDef[] = [];
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
function cableRuns(
  ground: RibbonDef[],
  opts: BlockOptions,
  everywhere = false,
  finishAt?: (x: number, z: number) => 'glass' | 'concrete',
  densityAt?: (x: number, z: number) => number,
): Array<[number, number, number, number]> {
  const runs: Array<[number, number, number, number]> = [];
  for (const rb of ground) {
    // A street that runs from one finish into the other (Bandido Metro) is strung at the
    // Stack's spacing along its whole length; where the cables fall is decided per run.
    const concreteRoad = everywhere || (!!finishAt && rb.path.samples.some((s) => finishAt(s.x, s.z) === 'concrete'));
    const step = rb.kind === 'alley' ? 18 : concreteRoad ? 22 : 30;
    for (let s = step / 2; s < rb.path.length; s += step) {
      const c = offsetAtStation(rb.path, s, 0);
      const concrete = everywhere || (!!finishAt && finishAt(c.x, c.z) === 'concrete');
      // The Bay keeps its corporate highway clean; the Stack strings cables over every street.
      if (rb.kind === 'track' && c.zone === 'corporate' && !concrete) continue;
      // A thinned district (Bandido Metro's outskirts) keeps a share of its cables.
      if (densityAt && hash01(c.x, c.z) > densityAt(c.x, c.z)) continue;
      const reach = c.halfWidth + (rb.kind === 'alley' ? opts.alleyShoulder : streetShoulder(opts, c.x, c.z, c.zone)) + 2.2;
      runs.push([c.x + -c.tz * -reach, c.z + c.tx * -reach, c.x + -c.tz * reach, c.z + c.tx * reach]);
    }
  }
  return runs;
}

/**
 * Enclosed bridges between buildings across a street: wherever a mid-rise or a tower stands
 * on both sides of one of the big streets, a few metres into each block so the ends vanish
 * inside the facades. Nothing under a viaduct or the skyway. Higher and more often inside
 * `downtown`.
 */
const SKY_PROJ = createProjection();

function findSkybridges(
  ground: RibbonDef[],
  elevated: RibbonDef[],
  blocks: BlockRect[],
  zoneAt: (x: number, z: number) => ZoneId,
  wanted: readonly string[],
  downtownRect: Rect | null,
  style?: CitySpec['skybridges'],
  /** Only stations inside this are tried: a set of streets that run on past the district its rule is for. */
  within?: Rect,
): SkybridgeDef[] {
  const out: SkybridgeDef[] = [];
  const max = style?.max ?? 22;
  const step = style?.step ?? 55;
  const index = createRectIndex(blocks);
  const blockAt = (x: number, z: number): BlockRect | null => {
    const near = index.at(x, z);
    for (let i = 0; i < near.length; i++) if (inRect(near[i], x, z)) return near[i];
    return null;
  };
  for (const tag of wanted) {
    const rb = ground.find((g) => g.tag === tag);
    if (!rb) continue;
    const path = rb.path;
    for (let s0 = 50; s0 < path.length - 50; s0 += step) {
      // The Bay thins its bridges by chance; a spec with its own tiers wants them over every
      // avenue and is bounded by `max` instead.
      if (!style && hash01(s0, path.length) > (downtownRect !== null && inRect(downtownRect, offsetAtStation(path, s0, 0).x, offsetAtStation(path, s0, 0).z) ? 0.75 : 0.5)) continue;
      // A station that lands on a crossing has no building either side of it; a spec with
      // tiers tries a little way along before giving the station up.
      const tries = style ? [0, 14, -14] : [0];
      let placed = false;
      for (const shift of tries) {
      if (placed) break;
      const s = s0 + shift;
      if (s < 50 || s > path.length - 50) continue;
      const c = offsetAtStation(path, s, 0);
      if (within && !inRect(within, c.x, c.z)) continue;
      const downtown = downtownRect !== null && inRect(downtownRect, c.x, c.z);
      const zone = zoneAt(c.x, c.z);
      if (zone === 'jdm') continue;
      const nx = -c.tz;
      const nz = c.tx;
      // The Bay's rule: higher inside downtown. A spec with tiers takes one of them, and its
      // share of the bridges are bare concrete rather than lit.
      const roll = hash01(s * 3, path.length);
      const y = style ? style.heights[Math.floor(roll * style.heights.length) % style.heights.length] : downtown ? 22 + roll * 30 : 12 + roll * 8;
      // Nothing overhead: a bridge under a deck reads as a mistake — unless the deck is a
      // whole building's height above it, which is the Stack's ring over an avenue bridge.
      let overhead = false;
      for (const e of elevated) {
        if (!isOnPath(e.path, c.x, c.z, 8)) continue;
        projectOntoPath(e.path, c.x, c.z, SKY_PROJ);
        if (!style || SKY_PROJ.y < y + 14) overhead = true;
      }
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
      const concrete = !!style && hash01(s * 7, path.length) < style.concreteShare;
      out.push({
        ax: c.x - nx * left.reach,
        az: c.z - nz * left.reach,
        bx: c.x + nx * right.reach,
        bz: c.z + nz * right.reach,
        y,
        width: concrete ? 5.2 : 3.6,
        height: concrete ? 4.4 : 3.2,
        zone,
        ...(style ? { kind: concrete ? ('concrete' as const) : ('lit' as const) } : {}),
      });
      placed = true;
      if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/** Test/tool helper: the elevated paths of a spec, for tests that walk them. */
export function cityElevatedPaths(spec: CitySpec = BAY_SPEC): TrackPath[] {
  return spec.elevated.map((r) => buildTrackPath(r.spec));
}
