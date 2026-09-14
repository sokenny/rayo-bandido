import type { ArenaLayout, GameEvent, ObstacleBox, StreetPropDef, StreetPropKind, SurfaceSample, VehicleState } from '../core/types';
import { STREET_PROPS, VEHICLE } from '../config/tuning';
import { createRectIndex, type RectIndex } from '../world/spatialIndex';
import { DUMPSTER_POSTS, FLAT_BOX_HY, STREET_PROP_SHAPES } from '../world/streetProps';
import { pushOutOfPost } from './collision';

/**
 * CRASHABLE STREET PROPS: what happens when the player's car meets a bag, a cone or a charger.
 *
 * There is no rigid-body engine in the game and this does not add one. Every prop sits at home
 * as data only, filed in a coarse grid, and the car asks the few cells around it each tick.
 * A hit hands the prop a BODY from a small pool — a box with a position, a velocity, an
 * orientation and a spin — and only bodies are integrated: gravity, a ground contact that
 * knows the box's support at any orientation, sliding friction, and a gentle pull onto the
 * nearest face so a prop ends lying on a side and never balanced on a corner. Once it is still
 * it stops being stepped; it keeps its body (so it lies where it fell and can be kicked again)
 * until `cleanupSeconds` have passed with the car well out of sight, and then it is quietly
 * put back.
 *
 * Three answers:
 *  - scatter (bags, boxes, cones, chairs): thrown along the contact with a hop and a tumble,
 *  - tip and slide (signs, tables, barriers): little lift, spun about the horizontal axis
 *    across the push so they fall over away from the car and scrape along,
 *  - fixed (EV chargers): never move. They answer the car with the car's own wall response
 *    (`pushOutOfPost`), and a hard enough hit breaks them — for good, until cleanup or restart.
 *
 * The light props take a sliver of the car's closing speed and nothing else: no `collision`
 * event, so the camera shake, the crash phrase and the passenger's complaint stay for real
 * crashes. Local and cosmetic: nothing here is sent over the network.
 */

export interface PropBody {
  /** Which prop this body is carrying, -1 when the body is free. */
  prop: number;
  x: number;
  y: number;
  z: number;
  /** Last tick's position, for the renderer's blend. */
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  /** Orientation (unit quaternion) and spin (rad/s, world frame). */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  wx: number;
  wy: number;
  wz: number;
  /** Half height in use: a squashed box is lower than a whole one. */
  hy: number;
  flat: boolean;
  moving: boolean;
  /** Seconds in flight since the last hit, and seconds already nearly still. */
  flight: number;
  still: number;
  settledAt: number;
}

export interface StreetPropsState {
  defs: readonly StreetPropDef[];
  /** Per prop: the body carrying it, or -1 while it stands at home. */
  bodyOf: Int16Array;
  damaged: Uint8Array;
  damagedAt: Float32Array;
  lastHit: Float32Array;
  bodies: PropBody[];
  /** Bodies currently being stepped. */
  moving: number;
  /** Bumped whenever a prop leaves or returns home, or a charger breaks or is mended. */
  version: number;
  cells: Map<number, number[]>;
  chargers: number[];
  stats: { hits: number; broken: number; recycled: number; cleaned: number; ignored: number };
  cleanupClock: number;
  seed: number;
}

/** Home grid cell (m). A car (1.1 m) plus the widest prop (0.6 m) is well under it. */
const CELL = 8;
const LEVEL = 2;
const TIP: Record<StreetPropKind, boolean> = { bag: false, box: false, cone: false, chair: false, sign: true, table: true, barrier: true, charger: false, bin: true, dumpster: false, litter: false };
const MATERIAL_BOUNCE = 0.3;
/** Props that cannot come to rest upside down: an A-frame on its peak, a cone on its tip. */
const NO_INVERT: Record<StreetPropKind, boolean> = { bag: false, box: false, cone: true, chair: false, sign: true, table: false, barrier: true, charger: false, bin: false, dumpster: false, litter: false };
/** The kinds that move when struck, and so have an entry in `STREET_PROPS.kinds`. */
type LooseKind = keyof typeof STREET_PROPS.kinds;

const SURFACE: SurfaceSample = { y: 0, gx: 0, gz: 0 };
const NEAR: ObstacleBox[] = [];
/** Static colliders per layout, so a restart does not rebuild them. */
const COLLIDERS = new WeakMap<ArenaLayout, RectIndex<ObstacleBox>>();

const cellKey = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);

export function createStreetPropsState(layout: ArenaLayout): StreetPropsState | null {
  const defs = layout.streetProps;
  if (!defs || defs.length === 0) return null;
  const cells = new Map<number, number[]>();
  const chargers: number[] = [];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    const k = cellKey(Math.floor(d.x / CELL), Math.floor(d.z / CELL));
    const list = cells.get(k);
    if (list) list.push(i);
    else cells.set(k, [i]);
    if (d.kind === 'charger') chargers.push(i);
  }
  const bodies: PropBody[] = [];
  for (let i = 0; i < STREET_PROPS.debrisCap; i++) bodies.push(freeBody());
  if (!COLLIDERS.has(layout)) {
    const boxes = layout.colliders.filter((b) => b.minY === undefined || b.minY < 0.5);
    COLLIDERS.set(layout, createRectIndex(boxes, 32, 2));
  }
  return {
    defs,
    bodyOf: new Int16Array(defs.length).fill(-1),
    damaged: new Uint8Array(defs.length),
    damagedAt: new Float32Array(defs.length),
    lastHit: new Float32Array(defs.length).fill(-1e3),
    bodies,
    moving: 0,
    version: 1,
    cells,
    chargers,
    stats: { hits: 0, broken: 0, recycled: 0, cleaned: 0, ignored: 0 },
    cleanupClock: 0,
    seed: 0x5eed,
  };
}

/** Everything back where the city put it: a restart is a cut. */
export function resetStreetPropsState(s: StreetPropsState): void {
  for (let i = 0; i < s.bodies.length; i++) if (s.bodies[i].prop >= 0) release(s, i);
  s.damaged.fill(0);
  s.lastHit.fill(-1e3);
  s.moving = 0;
  s.cleanupClock = 0;
  s.version++;
}

/** One tick: the car against the props near it, then every moving body, then the tidy-up. */
export function stepStreetProps(s: StreetPropsState, v: VehicleState, layout: ArenaLayout, time: number, dt: number, events: GameEvent[]): void {
  const colliders = COLLIDERS.get(layout);
  const reach = VEHICLE.collisionRadius + 0.7;

  // The car against props still at home.
  const i0 = Math.floor((v.x - reach) / CELL);
  const i1 = Math.floor((v.x + reach) / CELL);
  const j0 = Math.floor((v.z - reach) / CELL);
  const j1 = Math.floor((v.z + reach) / CELL);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const list = s.cells.get(cellKey(i, j));
      if (!list) continue;
      for (let k = 0; k < list.length; k++) {
        const p = list[k];
        if (s.bodyOf[p] >= 0) continue;
        const d = s.defs[p];
        if (Math.abs(d.y - v.y) > LEVEL) continue;
        const shape = STREET_PROP_SHAPES[d.kind];
        if (!shape.solid) continue;
        if (d.kind === 'dumpster') hitDumpster(s, p, v, time, dt, events);
        else if (shape.fixed) hitCharger(s, p, v, time, dt, events);
        else hitHome(s, p, v, time, events);
      }
    }
  }

  // The car against props already knocked about, moving or lying.
  for (let b = 0; b < s.bodies.length; b++) {
    const body = s.bodies[b];
    if (body.prop < 0) continue;
    if (Math.abs(body.y - body.hy - v.y) > LEVEL) continue;
    // Just hit: the car runs on past it rather than catching it again every tick and ploughing
    // it along (which is what makes a bag feel like a wall). It was thrown clear of the car's path.
    if (time - s.lastHit[body.prop] < STREET_PROPS.hitCooldown) continue;
    const r = VEHICLE.collisionRadius + STREET_PROP_SHAPES[s.defs[body.prop].kind].radius;
    const dx = body.x - v.x;
    const dz = body.z - v.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    const dist = Math.sqrt(d2) || 1e-3;
    const nx = dx / dist;
    const nz = dz / dist;
    const approach = (v.vx - body.vx) * nx + (v.vz - body.vz) * nz;
    // Resting against it is not a push; only a car closing on it moves it (and then out of the way).
    if (approach <= 0.2) continue;
    body.x = v.x + nx * r;
    body.z = v.z + nz * r;
    if (!body.moving) {
      if (s.moving >= STREET_PROPS.activeCap) continue;
      body.moving = true;
      body.flight = 0;
      body.still = 0;
      s.moving++;
    }
    kick(s, body, nx, nz, approach, v.vx, v.vz);
    takeFromCar(v, s.defs[body.prop].kind, nx, nz, approach);
    s.lastHit[body.prop] = Math.max(s.lastHit[body.prop], time - STREET_PROPS.hitCooldown + 0.2);
    announce(s, body.prop, body.x, body.y, body.z, approach, false, time, events);
  }

  for (let b = 0; b < s.bodies.length; b++) {
    const body = s.bodies[b];
    if (body.prop >= 0 && body.moving) integrate(s, body, layout, colliders ?? null, time, dt, events);
  }

  s.cleanupClock -= dt;
  if (s.cleanupClock <= 0) {
    s.cleanupClock = 0.5;
    cleanup(s, v, time);
  }
}

/* ------------------------------------------------------------------ hits */

function hitHome(s: StreetPropsState, p: number, v: VehicleState, time: number, events: GameEvent[]): void {
  const d = s.defs[p];
  const shape = STREET_PROP_SHAPES[d.kind];
  const r = VEHICLE.collisionRadius + shape.radius;
  const dx = d.x - v.x;
  const dz = d.z - v.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return;
  const dist = Math.sqrt(d2) || 1e-3;
  const nx = dx / dist;
  const nz = dz / dist;
  const approach = v.vx * nx + v.vz * nz;
  // Leaning on it at a crawl is not a hit: it stays put, and the car noses through a hair.
  if (approach < 0.3) return;
  const b = acquire(s, p);
  if (b < 0) {
    s.stats.ignored++;
    return;
  }
  const body = s.bodies[b];
  body.x = v.x + nx * r;
  body.z = v.z + nz * r;
  body.px = body.x;
  body.pz = body.z;
  kick(s, body, nx, nz, approach, v.vx, v.vz);
  if (d.kind === 'box' && approach > 7 && rand(s) < 0.5) flatten(body);
  takeFromCar(v, d.kind, nx, nz, approach);
  s.stats.hits++;
  if (approach >= STREET_PROPS.minImpact) {
    s.lastHit[p] = time;
    events.push({ type: 'propHit', kind: d.kind, x: body.x, y: d.y, z: body.z, impact: approach, damaged: false });
  } else {
    s.lastHit[p] = time - STREET_PROPS.hitCooldown + 0.2;
  }
}

function hitCharger(s: StreetPropsState, p: number, v: VehicleState, time: number, dt: number, events: GameEvent[]): void {
  const d = s.defs[p];
  const impact = pushOutOfPost(v, d.x, d.z, STREET_PROP_SHAPES.charger.radius, dt);
  if (impact <= 0.5) return;
  // A solid thing: the car's own crash, with everything a crash brings.
  v.collided = true;
  v.collisionImpact = Math.max(v.collisionImpact, impact);
  events.push({ type: 'collision', x: v.x, y: v.y, z: v.z, impact });
  if (!s.damaged[p] && impact >= STREET_PROPS.charger.damageImpact) {
    s.damaged[p] = 1;
    s.damagedAt[p] = time;
    s.version++;
    s.stats.broken++;
    s.lastHit[p] = time;
    events.push({ type: 'propHit', kind: 'charger', x: d.x, y: d.y + 1.1, z: d.z, impact, damaged: true });
    return;
  }
  announce(s, p, d.x, d.y + 0.8, d.z, impact, false, time, events);
}

/** A dumpster: two posts along its long side, a solid crash, and it never moves or breaks. */
function hitDumpster(s: StreetPropsState, p: number, v: VehicleState, time: number, dt: number, events: GameEvent[]): void {
  const d = s.defs[p];
  // Local +X in world: (cos yaw, -sin yaw).
  const ax = Math.cos(d.yaw) * DUMPSTER_POSTS.offset;
  const az = -Math.sin(d.yaw) * DUMPSTER_POSTS.offset;
  const impact = Math.max(
    pushOutOfPost(v, d.x + ax, d.z + az, DUMPSTER_POSTS.radius, dt),
    pushOutOfPost(v, d.x - ax, d.z - az, DUMPSTER_POSTS.radius, dt),
  );
  if (impact <= 0.5) return;
  v.collided = true;
  v.collisionImpact = Math.max(v.collisionImpact, impact);
  events.push({ type: 'collision', x: v.x, y: v.y, z: v.z, impact });
  announce(s, p, d.x, d.y + 0.7, d.z, impact, false, time, events);
}

function announce(s: StreetPropsState, p: number, x: number, y: number, z: number, impact: number, damaged: boolean, time: number, events: GameEvent[]): void {
  if (impact < STREET_PROPS.minImpact) return;
  if (time - s.lastHit[p] < STREET_PROPS.hitCooldown) return;
  s.lastHit[p] = time;
  events.push({ type: 'propHit', kind: s.defs[p].kind, x, y, z, impact, damaged });
}

/** The sliver of the car's closing speed a light prop takes. Never a wall. */
function takeFromCar(v: VehicleState, kind: StreetPropKind, nx: number, nz: number, approach: number): void {
  if (STREET_PROP_SHAPES[kind].fixed || !STREET_PROP_SHAPES[kind].solid) return;
  const loss = approach * STREET_PROPS.kinds[kind as LooseKind].carLoss;
  v.vx -= nx * loss;
  v.vz -= nz * loss;
  const fx = Math.sin(v.heading);
  const fz = -Math.cos(v.heading);
  v.speed = v.vx * fx + v.vz * fz;
  v.lateralSpeed = v.vx * -fz + v.vz * fx;
}

/** Throw a body along (nx, nz), from something closing at `approach` m/s with velocity (cvx, cvz). */
function kick(s: StreetPropsState, body: PropBody, nx: number, nz: number, approach: number, cvx: number, cvz: number): void {
  const kind = s.defs[body.prop].kind;
  if (STREET_PROP_SHAPES[kind].fixed || !STREET_PROP_SHAPES[kind].solid) return;
  const k = STREET_PROPS.kinds[kind as LooseKind];
  const speed = Math.min(STREET_PROPS.maxKick, approach * k.kick + 0.5);
  // Thrown off to the side it was struck on, so it leaves the car's path instead of riding the
  // bumper: the side is the one the contact normal leans to across the striker's motion.
  const tx = -nz;
  const tz = nx;
  const cs = Math.hypot(cvx, cvz);
  const across = cs > 0.5 ? (-cvz * nx + cvx * nz) / cs : 0;
  const side = across > 0.05 ? -1 : across < -0.05 ? 1 : rand(s) < 0.5 ? -1 : 1;
  const along = (cvx * tx + cvz * tz) * 0.2 + side * speed * 0.45 + (rand(s) - 0.5) * 1.0;
  body.vx = nx * speed + tx * along;
  body.vz = nz * speed + tz * along;
  body.vy = Math.min(STREET_PROPS.maxLift, Math.max(body.vy, 0) + approach * k.lift + rand(s) * 0.8);
  const spin = Math.min(TIP[kind] ? 8 : 14, approach * k.spin);
  if (TIP[kind]) {
    // About the horizontal axis across the push: the top goes away from the car.
    body.wx = nz * spin;
    body.wy = (rand(s) - 0.5) * spin * 0.4;
    body.wz = -nx * spin;
  } else {
    body.wx = (rand(s) - 0.5) * 2 * spin;
    body.wy = (rand(s) - 0.5) * 2 * spin;
    body.wz = (rand(s) - 0.5) * 2 * spin;
  }
}

function flatten(body: PropBody): void {
  if (body.flat) return;
  body.flat = true;
  body.y -= body.hy - FLAT_BOX_HY;
  body.hy = FLAT_BOX_HY;
}

/* ------------------------------------------------------------------ the pool */

function freeBody(): PropBody {
  return {
    prop: -1, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0,
    qx: 0, qy: 0, qz: 0, qw: 1, wx: 0, wy: 0, wz: 0,
    hy: 0, flat: false, moving: false, flight: 0, still: 0, settledAt: 0,
  };
}

/** A body for prop `p`, from the free ones, else the longest-lying one. -1 when everything is flying. */
function acquire(s: StreetPropsState, p: number): number {
  if (s.moving >= STREET_PROPS.activeCap) return -1;
  let free = -1;
  let oldest = -1;
  for (let i = 0; i < s.bodies.length; i++) {
    const b = s.bodies[i];
    if (b.prop < 0) {
      free = i;
      break;
    }
    if (!b.moving && (oldest < 0 || b.settledAt < s.bodies[oldest].settledAt)) oldest = i;
  }
  if (free < 0) {
    if (oldest < 0) return -1;
    release(s, oldest);
    s.stats.recycled++;
    free = oldest;
  }
  const d = s.defs[p];
  const shape = STREET_PROP_SHAPES[d.kind];
  const b = s.bodies[free];
  b.prop = p;
  b.hy = shape.hy;
  b.flat = false;
  b.x = b.px = d.x;
  b.y = b.py = d.y + shape.hy;
  b.z = b.pz = d.z;
  b.vx = b.vy = b.vz = 0;
  b.wx = b.wy = b.wz = 0;
  b.qx = 0;
  b.qy = Math.sin(d.yaw / 2);
  b.qz = 0;
  b.qw = Math.cos(d.yaw / 2);
  b.moving = true;
  b.flight = 0;
  b.still = 0;
  s.bodyOf[p] = free;
  s.moving++;
  s.version++;
  return free;
}

function release(s: StreetPropsState, b: number): void {
  const body = s.bodies[b];
  if (body.prop < 0) return;
  if (body.moving) s.moving--;
  s.bodyOf[body.prop] = -1;
  body.prop = -1;
  body.moving = false;
  s.version++;
}

function cleanup(s: StreetPropsState, v: VehicleState, time: number): void {
  const far2 = STREET_PROPS.cleanupDistance * STREET_PROPS.cleanupDistance;
  for (let i = 0; i < s.bodies.length; i++) {
    const b = s.bodies[i];
    if (b.prop < 0 || b.moving) continue;
    if (time - b.settledAt < STREET_PROPS.cleanupSeconds) continue;
    const dx = b.x - v.x;
    const dz = b.z - v.z;
    const hx = s.defs[b.prop].x - v.x;
    const hz = s.defs[b.prop].z - v.z;
    // Both where it lies and where it goes back to have to be out of sight.
    if (dx * dx + dz * dz < far2 || hx * hx + hz * hz < far2) continue;
    release(s, i);
    s.stats.cleaned++;
  }
  for (const p of s.chargers) {
    if (!s.damaged[p] || time - s.damagedAt[p] < STREET_PROPS.cleanupSeconds) continue;
    const dx = s.defs[p].x - v.x;
    const dz = s.defs[p].z - v.z;
    if (dx * dx + dz * dz < far2) continue;
    s.damaged[p] = 0;
    s.version++;
  }
}

/* ------------------------------------------------------------------ motion */

function integrate(s: StreetPropsState, b: PropBody, layout: ArenaLayout, colliders: RectIndex<ObstacleBox> | null, time: number, dt: number, events: GameEvent[]): void {
  const d = s.defs[b.prop];
  const shape = STREET_PROP_SHAPES[d.kind];
  const k = STREET_PROPS.kinds[d.kind as LooseKind];
  const g = STREET_PROPS.gravity;
  b.px = b.x;
  b.py = b.y;
  b.pz = b.z;
  b.vy -= g * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  b.flight += dt;

  // World-Y components of the box's local axes: its support below the centre at any angle.
  const { qx, qy, qz, qw } = b;
  const r10 = 2 * (qx * qy + qw * qz);
  const r11 = 1 - 2 * (qx * qx + qz * qz);
  const r12 = 2 * (qy * qz - qw * qx);
  const support = Math.abs(r10) * shape.hx + Math.abs(r11) * b.hy + Math.abs(r12) * shape.hz;
  let groundY = 0;
  if (layout.surface) {
    layout.surface.sample(b.x, b.z, b.y - support, SURFACE);
    groundY = SURFACE.y;
  }
  const hs = Math.hypot(b.vx, b.vz);
  let grounded = false;
  if (b.y - support <= groundY) {
    grounded = true;
    b.y = groundY + support;
    if (b.vy < 0) b.vy = b.vy < -1.6 ? -b.vy * k.bounce : 0;
    if (hs > 1e-4) {
      const f = Math.max(0, hs - k.friction * g * dt) / hs;
      b.vx *= f;
      b.vz *= f;
    }
    const damp = Math.exp(-3.5 * dt);
    b.wx *= damp;
    b.wy *= damp;
    b.wz *= damp;
    const w = Math.hypot(b.wx, b.wy, b.wz);
    alignToFace(b, Math.min(1, 6 * dt * Math.max(0, 1 - w / 3)), NO_INVERT[d.kind]);
  } else {
    const damp = Math.exp(-0.3 * dt);
    b.wx *= damp;
    b.wy *= damp;
    b.wz *= damp;
  }
  integrateSpin(b, dt);

  // Buildings, pillars, shelters: pushed out the shallow way, and a dull bounce.
  if (colliders) {
    const r = shape.radius * 0.8;
    const list = colliders.at(b.x, b.z);
    NEAR.length = 0;
    for (let i = 0; i < list.length; i++) NEAR.push(list[i]);
    for (let i = 0; i < NEAR.length; i++) {
      const box = NEAR[i];
      if (box.maxY !== undefined && b.y > box.maxY) continue;
      if (b.x < box.minX - r || b.x > box.maxX + r || b.z < box.minZ - r || b.z > box.maxZ + r) continue;
      const toMinX = b.x - (box.minX - r);
      const toMaxX = box.maxX + r - b.x;
      const toMinZ = b.z - (box.minZ - r);
      const toMaxZ = box.maxZ + r - b.z;
      const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
      if (m === toMinX) {
        b.x -= m;
        if (b.vx > 0) b.vx = -b.vx * MATERIAL_BOUNCE;
      } else if (m === toMaxX) {
        b.x += m;
        if (b.vx < 0) b.vx = -b.vx * MATERIAL_BOUNCE;
      } else if (m === toMinZ) {
        b.z -= m;
        if (b.vz > 0) b.vz = -b.vz * MATERIAL_BOUNCE;
      } else {
        b.z += m;
        if (b.vz < 0) b.vz = -b.vz * MATERIAL_BOUNCE;
      }
    }
  }

  // A fast prop knocks over the props it runs into; a charger stops it.
  if (hs > 1.5) knockNeighbours(s, b, shape.radius, hs, time, events);

  const w = Math.hypot(b.wx, b.wy, b.wz);
  if (grounded && hs < 0.2 && w < 0.7 && Math.abs(b.vy) < 0.4) b.still += dt;
  else b.still = 0;
  if (b.still > 0.25 || b.flight > STREET_PROPS.maxFlight || b.y < groundY - 5) settle(s, b, layout, time);
}

function knockNeighbours(s: StreetPropsState, b: PropBody, radius: number, hs: number, time: number, events: GameEvent[]): void {
  const i0 = Math.floor((b.x - 1.5) / CELL);
  const i1 = Math.floor((b.x + 1.5) / CELL);
  const j0 = Math.floor((b.z - 1.5) / CELL);
  const j1 = Math.floor((b.z + 1.5) / CELL);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const list = s.cells.get(cellKey(i, j));
      if (!list) continue;
      for (let k = 0; k < list.length; k++) {
        const p = list[k];
        if (p === b.prop || s.bodyOf[p] >= 0) continue;
        const d = s.defs[p];
        if (!STREET_PROP_SHAPES[d.kind].solid) continue;
        const r = radius + STREET_PROP_SHAPES[d.kind].radius;
        const dx = d.x - b.x;
        const dz = d.z - b.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r || Math.abs(d.y - (b.y - b.hy)) > 1) continue;
        const dist = Math.sqrt(d2) || 1e-3;
        const nx = dx / dist;
        const nz = dz / dist;
        const approach = b.vx * nx + b.vz * nz;
        if (approach <= 0.5) continue;
        if (STREET_PROP_SHAPES[d.kind].fixed) {
          b.x = d.x - nx * r;
          b.z = d.z - nz * r;
          b.vx -= nx * approach * (1 + MATERIAL_BOUNCE);
          b.vz -= nz * approach * (1 + MATERIAL_BOUNCE);
          continue;
        }
        const nb = acquire(s, p);
        if (nb < 0) return;
        const other = s.bodies[nb];
        kick(s, other, nx, nz, approach * 0.6, b.vx, b.vz);
        b.vx -= nx * approach * 0.4;
        b.vz -= nz * approach * 0.4;
        announce(s, p, other.x, d.y, other.z, approach * 0.6, false, time, events);
        if (hs < 1.5) return;
      }
    }
  }
}

function settle(s: StreetPropsState, b: PropBody, layout: ArenaLayout, time: number): void {
  alignToFace(b, 1, NO_INVERT[s.defs[b.prop].kind]);
  const shape = STREET_PROP_SHAPES[s.defs[b.prop].kind];
  const { qx, qy, qz, qw } = b;
  const support =
    Math.abs(2 * (qx * qy + qw * qz)) * shape.hx + Math.abs(1 - 2 * (qx * qx + qz * qz)) * b.hy + Math.abs(2 * (qy * qz - qw * qx)) * shape.hz;
  let groundY = 0;
  if (layout.surface) {
    layout.surface.sample(b.x, b.z, Math.max(b.y - support, 0), SURFACE);
    groundY = SURFACE.y;
  }
  b.y = groundY + support;
  b.py = b.y;
  b.vx = b.vy = b.vz = 0;
  b.wx = b.wy = b.wz = 0;
  b.moving = false;
  b.settledAt = time;
  s.moving--;
}

/** q += 0.5 * (w, 0) * q * dt, renormalised. */
function integrateSpin(b: PropBody, dt: number): void {
  const { wx, wy, wz } = b;
  if (wx === 0 && wy === 0 && wz === 0) return;
  const { qx, qy, qz, qw } = b;
  const h = 0.5 * dt;
  b.qx += h * (wx * qw + wy * qz - wz * qy);
  b.qy += h * (wy * qw + wz * qx - wx * qz);
  b.qz += h * (wz * qw + wx * qy - wy * qx);
  b.qw += h * (-wx * qx - wy * qy - wz * qz);
  normalize(b);
}

/**
 * Turn the box a fraction `t` of the way onto whichever of its faces is nearest to lying flat:
 * the local axis closest to vertical is swung onto vertical by the shortest arc.
 */
function alignToFace(b: PropBody, t: number, noInvert = false): void {
  if (t <= 0) return;
  const { qx, qy, qz, qw } = b;
  // Columns of the rotation matrix: the world directions of local x, y, z. Their Y components:
  const cy = [2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx)];
  let axis = 0;
  if (Math.abs(cy[1]) > Math.abs(cy[axis])) axis = 1;
  if (Math.abs(cy[2]) > Math.abs(cy[axis])) axis = 2;
  // Upside down is not a resting pose for these: lie on the nearer side instead.
  if (noInvert && axis === 1 && cy[1] < 0) axis = Math.abs(cy[0]) > Math.abs(cy[2]) ? 0 : 2;
  let ax: number;
  let az: number;
  if (axis === 0) {
    ax = 1 - 2 * (qy * qy + qz * qz);
    az = 2 * (qx * qz - qw * qy);
  } else if (axis === 1) {
    ax = 2 * (qx * qy - qw * qz);
    az = 2 * (qy * qz + qw * qx);
  } else {
    ax = 2 * (qx * qz + qw * qy);
    az = 1 - 2 * (qx * qx + qy * qy);
  }
  const ay = cy[axis];
  const sign = ay >= 0 ? 1 : -1;
  // Rotation taking (ax, ay, az) onto (0, sign, 0): axis = a x up, angle = acos(|ay|).
  let rx = -az * sign;
  let rz = ax * sign;
  const len = Math.hypot(rx, rz);
  if (len < 1e-5) return;
  rx /= len;
  rz /= len;
  const angle = Math.acos(Math.min(1, Math.abs(ay))) * t;
  const sh = Math.sin(angle / 2);
  const dxq = rx * sh;
  const dzq = rz * sh;
  const dwq = Math.cos(angle / 2);
  // q = d * q, with d = (dxq, 0, dzq, dwq).
  const nx = dwq * qx + dxq * qw + 0 * qz - dzq * qy;
  const ny = dwq * qy - dxq * qz + 0 * qw + dzq * qx;
  const nz = dwq * qz + dxq * qy - 0 * qx + dzq * qw;
  const nw = dwq * qw - dxq * qx - 0 * qy - dzq * qz;
  b.qx = nx;
  b.qy = ny;
  b.qz = nz;
  b.qw = nw;
  normalize(b);
}

function normalize(b: PropBody): void {
  const l = Math.hypot(b.qx, b.qy, b.qz, b.qw) || 1;
  b.qx /= l;
  b.qy /= l;
  b.qz /= l;
  b.qw /= l;
}

/** The props' own little generator, so a stepped QA run repeats itself. */
function rand(s: StreetPropsState): number {
  s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}
