import type { ObstacleWall, RaceCourse, RaceGate, SpawnPoint, SurfaceSample } from '../core/types';
import { BUSES, RACE } from '../config/tuning';
import type { NeonWallDef } from './cityPlan';
import type { World } from './arenaWorld';
import { createCityWorld } from './cityWorld';
import { createRandom } from './cityGen';
import { CIRCUIT_GATES, CIRCUIT_LAPS, CIRCUIT_SPEC } from './circuitSpec';
import { buildTrackPath, createProjection, offsetAtStation, projectOntoPath, segmentCount } from './track';

/**
 * THE CITY CIRCUIT ("VERSUS"): the open world with a race drawn inside it.
 *
 * This builds an INSTANCE of the city — `createCityWorld()` is called unchanged, and nothing
 * in `citySpec.ts` or `cityWorld.ts` knows this file exists — and then edits that instance:
 *
 *  - THE BARRIER goes up along the two edges of the racing ribbon (`circuitSpec.ts`), segment
 *    by segment. Two continuous curves round the whole lap: no branch, no stub, nothing
 *    standing across the road. Every side street the lap passes is closed simply because the
 *    barrier sweeps past its mouth, and the ribbon is checked edge to edge against the city's
 *    own roads, so no span can end up in a building or off the deck.
 *  - THE RACE goes in: the start/finish line on the downtown straight, five checkpoints, the
 *    grid and two laps.
 *  - THE CITY'S STREET TRAFFIC comes out, and the buses with it: both follow fixed routes and
 *    neither steers around anything, so left in they would drive through the barrier. The
 *    VIADUCT keeps its traffic, in the direction the circuit runs — the lap shares the deck
 *    with it for a third of its length, so those cars are the highway's own traffic to thread
 *    through, and the ones on the far side of the loop are the city still being a city.
 *  - NEW TRAFFIC goes on the lap itself, in a lane beside the racing line, as the Bandido
 *    Loop does it: cars to pass, and targets to put the lightning into.
 *
 * Everything else — the blocks, the towers, the viaduct, the water, the weather, the kerbs,
 * the surface field — is the city's, untouched.
 */

/** How far above the road a barrier stops the car (m). Low, but nothing drives over it. */
const BARRIER_HEIGHT = 2.2;
/** How far below it the collider still bites, so a deck above a street is not a wall in it (m). */
const BARRIER_DROP = 3.2;
/** Cars on the lap, and the lane they patrol, offset from the racing line (m). */
const TARGET_COUNT = 10;
const PATROL_LANE = 2.8;
/** Metres of lap either side of the start line kept clear of traffic (see `raceWorld.ts`). */
const TRAFFIC_CLEAR_BEHIND = 60;
const TRAFFIC_CLEAR_AHEAD = 90;
/** How far into its slot a car may be jittered, as a fraction of the slot (0..0.5). */
const TRAFFIC_JITTER = 0.4;
/** A city car spawned above this is on the viaduct, not in the streets (m). */
const VIADUCT_FLOOR = 5;

export const CIRCUIT_RACE_LAPS = CIRCUIT_LAPS;

/**
 * `seed` decides where the traffic starts, and nothing else: same seed, same circuit down to
 * the last car, which is what multiplayer needs since every client builds the world itself.
 * In a match the match's `raceId` is the seed.
 */
export function createCircuitWorld(seed: number = (Math.random() * 0xffffffff) >>> 0): World {
  const { layout, plan } = createCityWorld();
  const path = buildTrackPath(CIRCUIT_SPEC);
  const samples = path.samples;
  const segs = segmentCount(path);

  /* ---------------------------------------------------------- the barrier */

  /**
   * Heights come from the city's own surface field rather than from the ribbon, so a span on
   * the on-ramp sits on the on-ramp however the two paths' grades happen to differ. `sample`
   * takes the ribbon's height as the hint, which is what picks the deck over the street
   * fifteen metres under it.
   */
  const probe: SurfaceSample = { y: 0, gx: 0, gz: 0 };
  const roadY = (x: number, z: number, hint: number): number => {
    if (!layout.surface) return 0;
    layout.surface.sample(x, z, hint, probe);
    return probe.y;
  };

  const neonWalls: NeonWallDef[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < segs; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % samples.length];
      const ax = a.x + -a.tz * a.halfWidth * side;
      const az = a.z + a.tx * a.halfWidth * side;
      const bx = b.x + -b.tz * b.halfWidth * side;
      const bz = b.z + b.tx * b.halfWidth * side;
      neonWalls.push({
        ax,
        az,
        ay: roadY(ax, az, a.y),
        bx,
        bz,
        by: roadY(bx, bz, b.y),
        // In at the track: the inward normal is the outward one flipped by which side this is.
        nx: -side * -a.tz,
        nz: -side * a.tx,
        side,
        curvature: a.curvature,
        zone: a.zone,
      });
    }
  }

  // The buses go first, and their wall slots with them: `src/sim/buses.ts` finds a bus's
  // segments by counting back from the END of the list, so anything appended after them
  // would move them. Nothing is appended until they are gone.
  const busCount = (layout.busRoutes ?? []).length * BUSES.perRoute;
  const walls: ObstacleWall[] = busCount > 0 ? layout.walls.slice(0, layout.walls.length - busCount * 4) : [...layout.walls];
  for (const w of neonWalls) {
    const lo = Math.min(w.ay, w.by);
    const hi = Math.max(w.ay, w.by);
    walls.push({ ax: w.ax, az: w.az, bx: w.bx, bz: w.bz, minY: lo - BARRIER_DROP, maxY: hi + BARRIER_HEIGHT, tag: 'neon-wall' });
  }

  /* ---------------------------------------------------------- the race */

  const line = projectOntoPath(path, CIRCUIT_GATES[0].x, CIRCUIT_GATES[0].z, createProjection());
  const L = path.length;
  const gates: RaceGate[] = CIRCUIT_GATES.map((g) => {
    const p = projectOntoPath(path, g.x, g.z, createProjection());
    const hw = p.halfWidth + 1.5;
    return {
      ax: p.x + -p.tz * -hw,
      az: p.z + p.tx * -hw,
      bx: p.x + -p.tz * hw,
      bz: p.z + p.tx * hw,
      fx: p.tx,
      fz: p.tz,
      s: p.s,
    };
  });
  // Checkpoints in lap order from the line; gates[0] stays first.
  const lapOrder = (s: number): number => (((s - line.s) % L) + L) % L;
  const rest = gates.slice(1).sort((a, b) => lapOrder(a.s) - lapOrder(b.s));
  gates.splice(1, gates.length - 1, ...rest);

  const grid: SpawnPoint[] = [];
  for (let i = 0; i < RACE.gridSlots; i++) {
    const row = Math.floor(i / 2);
    const lateral = (i % 2 === 0 ? -1 : 1) * RACE.gridLateral;
    const p = offsetAtStation(path, line.s + RACE.gridFirstRow + row * RACE.gridRowGap, lateral);
    grid.push({ x: p.x, z: p.z, heading: Math.atan2(p.tx, -p.tz) });
  }

  const course: RaceCourse = { laps: CIRCUIT_LAPS, gates, grid, path, shortcuts: [] };

  /* ---------------------------------------------------------- traffic */

  /**
   * The viaduct's traffic, thinned to the file that runs the way the circuit does. The city
   * drives the deck both ways; a race that borrows a third of it cannot have the other file
   * coming at it. Which way a patrol goes is read off the loop itself — twice the signed area
   * of its polygon — rather than off the order the city happened to build them in.
   */
  const shoelace = (loop: ReadonlyArray<{ x: number; z: number }>): number => {
    let sum = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      sum += a.x * b.z - b.x * a.z;
    }
    return sum;
  };
  const lapSense = Math.sign(shoelace(samples.filter((_, i) => i % 4 === 0)));

  const targetSpawns: SpawnPoint[] = [];
  const targetPatrols: Array<Array<{ x: number; z: number }>> = [];
  for (let i = 0; i < layout.targetSpawns.length; i++) {
    const s = layout.targetSpawns[i];
    const patrol = layout.targetPatrols[i];
    if ((s.y ?? 0) < VIADUCT_FLOOR || !patrol || patrol.length < 3) continue;
    if (Math.sign(shoelace(patrol)) !== lapSense) continue;
    targetSpawns.push(s);
    targetPatrols.push(patrol);
  }

  /** The lap's own traffic, in a lane beside the racing line. */
  const laneWaypoints = (lateral: number): Array<{ x: number; z: number }> => {
    const out: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < samples.length; i += 3) {
      const s = samples[i];
      out.push({ x: s.x + -s.tz * lateral, z: s.z + s.tx * lateral });
    }
    return out;
  };

  const random = createRandom(seed);
  const usable = Math.max(1, L - TRAFFIC_CLEAR_AHEAD - TRAFFIC_CLEAR_BEHIND);
  const slot = usable / TARGET_COUNT;
  for (let i = 0; i < TARGET_COUNT; i++) {
    const lateral = (random() < 0.5 ? 1 : -1) * PATROL_LANE;
    const loop = laneWaypoints(lateral);
    const jitter = (random() * 2 - 1) * TRAFFIC_JITTER * slot;
    const startStation = (line.s + TRAFFIC_CLEAR_AHEAD + (i + 0.5) * slot + jitter + L) % L;
    const start = Math.min(loop.length - 1, Math.floor((startStation / L) * loop.length));
    const rotated = [...loop.slice(start), ...loop.slice(0, start)];
    const s = samples[Math.min(samples.length - 1, start * 3)];
    targetSpawns.push({ x: rotated[0].x, z: rotated[0].z, y: s.y, heading: Math.atan2(s.tx, -s.tz) });
    targetPatrols.push(rotated);
  }

  const cruiseRoute: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < samples.length; i += 4) cruiseRoute.push({ x: samples[i].x, z: samples[i].z });

  /* ---------------------------------------------------------- layout */

  layout.walls = walls;
  layout.busRoutes = [];
  layout.targetSpawns = targetSpawns;
  layout.targetPatrols = targetPatrols;
  layout.cruiseRoute = cruiseRoute;
  layout.playerSpawn = { ...grid[0] };
  layout.race = course;
  /**
   * THE RACE IS JUST THE RACE. The city's own activities come along with the instance it is cut
   * out of — this world is `createCityWorld()` with a ribbon laid over it — and every one of
   * them would be wrong here: a RAYO RUSH ring painted across the racing line, a fare waiting at
   * a kerb the barrier has sealed off, a man under the viaduct selling something to a car on a
   * flying lap, and a sign inviting the player to start the race they are already driving.
   *
   * So they are taken off at the source rather than hidden later. The rules build no state for
   * an activity whose site is missing (`src/sim/gameState.ts`), the art builds no marker for a
   * plan that carries none, and the mission chain the circuit DOES run (`src/sim/timeAttack.ts`)
   * is left with the whole course to itself.
   */
  layout.rushSites = null;
  layout.passengerStops = null;
  layout.buhoSite = null;
  layout.circuitSite = null;
  // The minimap draws the race, not the city it is cut out of.
  layout.minimap = {
    ...layout.minimap,
    rects: [],
    ribbons: [
      {
        points: samples.map((s) => ({ x: s.x, z: s.z })),
        width: samples.reduce((sum, s) => sum + s.halfWidth * 2, 0) / samples.length,
        closed: true,
        hidden: false,
      },
    ],
  };

  /* ---------------------------------------------------------- plan */

  plan.neonWalls = neonWalls;
  // The art side of the same decision: nothing to paint for an activity that is not here.
  plan.rushMarkers = null;
  plan.circuitMarker = null;
  plan.startLine = lineDef(line);
  plan.checkpoints = gates.slice(1).map((g) => {
    const p = projectOntoPath(path, (g.ax + g.bx) / 2, (g.az + g.bz) / 2, createProjection());
    return lineDef(p);
  });

  return { layout, plan };
}

function lineDef(p: { x: number; z: number; tx: number; tz: number; halfWidth: number }): {
  x: number;
  z: number;
  tx: number;
  tz: number;
  halfWidth: number;
} {
  return { x: p.x, z: p.z, tx: p.tx, tz: p.tz, halfWidth: p.halfWidth };
}
