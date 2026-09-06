import type { ArenaLayout, BusRoute, BusState, ObstacleWall } from '../core/types';
import { wrapAngle } from '../core/math';
import { BUSES } from '../config/tuning';

/**
 * The city's buses: big, slow, immovable things that drive a fixed loop of streets in the
 * kerb lane and pull in at the shelters along it.
 *
 * WHY THEY ARE NOT TARGETS. An electric car is a target: it can be shot, shoved and
 * destroyed, which is why the traffic needs a host to be authoritative about it over the
 * wire. A bus is the opposite — nothing the player does moves it, so its position is a pure
 * function of how long the world has been running, every screen agrees about it for free,
 * and it never needs a byte on the wire.
 *
 * HOW IT IS SOLID. Four wall segments per bus, reserved once in `ArenaLayout.walls` by the
 * world builder and rewritten in place as the bus moves (`writeBusWalls`). Segments rather
 * than a box because a bus rounds corners: an axis-aligned box round a bus at 45 degrees is
 * a wall across half the street that nothing on screen accounts for. Nothing here allocates.
 *
 * The route's waypoints are street centrelines offset into the kerb lane, and its `stops`
 * are the stations of the shelters that stand on that side of the street — so a bus only
 * ever pulls in where there is somewhere to pull in at, and the near side of the bus is the
 * side the shelter is on.
 */

/**
 * How close to a stop counts as arrived (m). The easing curve approaches it asymptotically,
 * so the last half metre is called rather than crept over — and on leaving, the bus steps
 * this far past the stop it just served, so that stop is behind it and a route with a single
 * calling point cannot serve the same one twice and stand there for ever.
 */
const ARRIVE = 0.4;

/** Scratch for the corner walk, so stepping the buses allocates nothing. */
const LEG = { x: 0, z: 0, tx: 0, tz: 1, len: 0 };

export function createBuses(layout: ArenaLayout): BusState[] {
  const routes = layout.busRoutes ?? [];
  const buses: BusState[] = [];
  for (let r = 0; r < routes.length; r++) {
    const length = routeLength(routes[r]);
    for (let k = 0; k < BUSES.perRoute; k++) {
      // Spread evenly round the loop, so a route reads as a service and not as one bus.
      const station = (length * (k + 0.5)) / BUSES.perRoute;
      const bus: BusState = {
        id: buses.length,
        route: r,
        x: 0,
        z: 0,
        heading: 0,
        prevX: 0,
        prevZ: 0,
        prevHeading: 0,
        station,
        speed: BUSES.cruiseSpeed,
        dwell: 0,
        nextStop: 0,
        doors: 0,
      };
      placeOnRoute(bus, routes[r], Infinity);
      bus.prevX = bus.x;
      bus.prevZ = bus.z;
      bus.prevHeading = bus.heading;
      bus.nextStop = firstStopAfter(routes[r], station);
      buses.push(bus);
    }
  }
  return buses;
}

export function resetBuses(buses: BusState[], layout: ArenaLayout): void {
  const routes = layout.busRoutes ?? [];
  const fresh = createBuses(layout);
  for (let i = 0; i < buses.length && i < fresh.length; i++) Object.assign(buses[i], fresh[i]);
  for (const b of buses) if (routes[b.route]) placeOnRoute(b, routes[b.route], Infinity);
}

/**
 * Advance every bus and rewrite the wall segments that make it solid.
 *
 * The whole behaviour is one scalar: `station`, how far round the loop it has driven. Speed
 * eases down over `brakeDistance` into the next stop, the bus stands for `dwell` seconds
 * with its doors open, then eases back up. Position and heading are read off the loop.
 */
export function stepBuses(buses: BusState[], layout: ArenaLayout, dt: number): void {
  const routes = layout.busRoutes ?? [];
  if (routes.length === 0) return;
  for (let i = 0; i < buses.length; i++) {
    const bus = buses[i];
    const route = routes[bus.route];
    if (!route) continue;
    bus.prevX = bus.x;
    bus.prevZ = bus.z;
    bus.prevHeading = bus.heading;
    const length = routeLength(route);

    if (bus.dwell > 0) {
      // Standing at a stop: doors open, then closing over the last of the wait.
      bus.dwell -= dt;
      bus.speed = 0;
      bus.doors = Math.min(1, bus.dwell > BUSES.doorTime ? bus.doors + dt / BUSES.doorTime : bus.dwell / BUSES.doorTime);
      if (bus.dwell <= 0) {
        bus.dwell = 0;
        bus.doors = 0;
        bus.nextStop = route.stops.length > 0 ? (bus.nextStop + 1) % route.stops.length : 0;
        // Step off the stop just served, so it lies behind and the next target is ahead.
        bus.station = (bus.station + ARRIVE + 0.01) % length;
      }
    } else {
      // How far to the stop it is driving at, ALWAYS forward round the loop: a stop that is
      // behind is nearly a lap ahead, not zero away.
      let toStop = Infinity;
      if (route.stops.length > 0) {
        toStop = route.stops[bus.nextStop % route.stops.length] - bus.station;
        while (toStop < 0) toStop += length;
      }
      if (toStop <= Math.max(ARRIVE, bus.speed * dt)) {
        bus.station = route.stops[bus.nextStop % route.stops.length];
        bus.dwell = BUSES.dwell;
        bus.speed = 0;
      } else {
        // Ease down into the stop and back up out of it, never faster than the route allows.
        const target = toStop < BUSES.brakeDistance ? BUSES.cruiseSpeed * (toStop / BUSES.brakeDistance) : BUSES.cruiseSpeed;
        const rate = target < bus.speed ? BUSES.brake : BUSES.accel;
        bus.speed += Math.max(-rate * dt, Math.min(rate * dt, target - bus.speed));
        bus.speed = Math.max(0, bus.speed);
        bus.station = (bus.station + bus.speed * dt) % length;
      }
    }
    placeOnRoute(bus, route, dt);
    writeBusWalls(layout, bus);
  }
}

/** Where the four walls of bus `id` live in `layout.walls`. Reserved by the world builder. */
export function busWallIndex(layout: ArenaLayout, id: number): number {
  return layout.walls.length - (countBuses(layout) - id) * 4;
}

function countBuses(layout: ArenaLayout): number {
  return (layout.busRoutes ?? []).length * BUSES.perRoute;
}

/** The four sides of the bus, in place, as the segments the car is pushed off. */
function writeBusWalls(layout: ArenaLayout, bus: BusState): void {
  const base = busWallIndex(layout, bus.id);
  if (base < 0 || base + 4 > layout.walls.length) return;
  const fx = Math.sin(bus.heading);
  const fz = -Math.cos(bus.heading);
  const rx = Math.cos(bus.heading);
  const rz = Math.sin(bus.heading);
  const hl = BUSES.length / 2;
  const hw = BUSES.width / 2;
  // Corners: front-left, front-right, rear-right, rear-left.
  const cx = [bus.x + fx * hl - rx * hw, bus.x + fx * hl + rx * hw, bus.x - fx * hl + rx * hw, bus.x - fx * hl - rx * hw];
  const cz = [bus.z + fz * hl - rz * hw, bus.z + fz * hl + rz * hw, bus.z - fz * hl + rz * hw, bus.z - fz * hl - rz * hw];
  for (let i = 0; i < 4; i++) {
    const w = layout.walls[base + i] as ObstacleWall;
    w.ax = cx[i];
    w.az = cz[i];
    w.bx = cx[(i + 1) % 4];
    w.bz = cz[(i + 1) % 4];
  }
}

/* ------------------------------------------------------------------ the loop */

/** Total length of a route's closed loop (m). */
export function routeLength(route: BusRoute): number {
  let total = 0;
  const p = route.points;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    total += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return total;
}

/** The first stop at or after `station`, wrapping round the loop. */
function firstStopAfter(route: BusRoute, station: number): number {
  for (let i = 0; i < route.stops.length; i++) if (route.stops[i] >= station) return i;
  return 0;
}

/**
 * Writes the bus's position and heading from its station along the loop. An infinite `dt`
 * snaps the heading, which is what placing a bus for the first time wants — a fresh bus
 * starts pointing at nothing and must not spend its first seconds swinging round to its leg.
 */
function placeOnRoute(bus: BusState, route: BusRoute, dt: number): void {
  legAt(route, bus.station);
  bus.x = LEG.x;
  bus.z = LEG.z;
  // Corners are turned rather than snapped: a bus that pivots in one tick reads as a glitch.
  const want = Math.atan2(LEG.tx, -LEG.tz);
  const delta = wrapAngle(want - bus.heading);
  const maxTurn = BUSES.turnRate * dt;
  bus.heading = wrapAngle(bus.heading + Math.max(-maxTurn, Math.min(maxTurn, delta)));
}

/** Point and unit direction at `station` metres round the loop, into the module scratch. */
function legAt(route: BusRoute, station: number): void {
  const p = route.points;
  const total = routeLength(route);
  let left = ((station % total) + total) % total;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    if (left <= len || i === p.length - 1) {
      const t = Math.min(1, left / len);
      LEG.x = a.x + (b.x - a.x) * t;
      LEG.z = a.z + (b.z - a.z) * t;
      LEG.tx = (b.x - a.x) / len;
      LEG.tz = (b.z - a.z) / len;
      LEG.len = len;
      return;
    }
    left -= len;
  }
}
