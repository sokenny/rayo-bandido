import type {
  ArenaLayout,
  GameEvent,
  GameState,
  LightningState,
  PoliceOffenseCategory,
  PoliceState,
  PoliceUnit,
  TargetState,
  VehicleState,
} from '../core/types';
import { LIGHTNING, POLICE, TARGETS } from '../config/tuning';
import { forwardX, forwardZ, wrapAngle } from '../core/math';
import { LEVEL_GAP, pushOutOfWorld, resolveTargetCollisions, type Contact, type WallResponse } from './collision';
import { settleTarget } from './surface';
import { rayTarget } from './targeting';
import { engagedActivity } from './activities';
import { aimAlong, buildRoadGraph, createRouteAim, routeTo } from '../world/roadGraph';

/**
 * THE POLICE, and the wanted heat that brings them (MVP).
 *
 * FREE ROAM ONLY. `isPoliceEnabledForCurrentGameState` is the one answer everything here
 * respects — spawning, heat, the patrols' reactions, the pursuit — and the moment it turns
 * false (a race, a RAYO RUSH run, a fare, the circuit's door, a restart) every car is taken
 * off the road and the heat is dropped. They come back only after `POLICE.resumeDelay` of
 * Free Roam, and never on top of the player.
 *
 * TRAFFIC-SHAPED. A police car is a `TargetState` with a role bolted on, driven by position
 * the way the electric cars are (`src/sim/targets.ts`): the same wall push-out, the same road
 * height, the same knock channel when the player bumps it, and the same beam test — which is
 * how the Rayo learns it is lined up on one and refuses. Nothing here touches the player's
 * handling model; the pressure a chaser applies is the ordinary shove of two bodies meeting.
 *
 * THE LOOP. Neutralising a civilian car adds heat by how far the bolt crossed (a close shot is
 * easy to identify, a long one is not). A patrol that saw it happen is alerted at once and
 * chases regardless of the heat. Heat buys stars; two stars is a pursuit; three is a bigger
 * one. Losing every chaser's sight of the car for `loseSightSeconds` starts the ESCAPING
 * countdown, which regaining sight cancels and which running out ends the pursuit. Standing
 * still with a chaser on the bumper for `bust.seconds` is an arrest: the car is held, the fine
 * is taken (`src/sim/economy.ts`), the heat is dropped and the car is handed back.
 *
 * MULTIPLAYER. Every client runs its own police against its own car: the server is a relay
 * that knows no rules, so heat, chasers and arrests are per player by construction and never
 * cross the wire. Other players do not see these cars (deferred: a `PoliceUnit` is plain data
 * and could ride the traffic report). In a shared city the chasers do not shove the host-owned
 * traffic either (`StepPoliceOptions.shoveTraffic`), so nothing here fights the traffic sync.
 *
 * Performance: the pool is allocated once, nothing allocates per tick, and the line-of-sight
 * tests (segment against the world's collider boxes) are spread across ticks.
 */

/** How a wall answers a police car: the electric cars' numbers, they are the same weight. */
const WALL: WallResponse = { restitution: 0.25, slide: 0.7, impactSpeed: 2.5, scrapeDecel: 6 };
const CONTACT: Contact = { nx: 0, nz: 0, count: 0 };
/** Scratch event list for the player-versus-police collision pass. */
const SCRATCH_EVENTS: GameEvent[] = [];

export interface StepPoliceOptions {
  /** `isPoliceEnabledForCurrentGameState`, decided by the caller for this tick. */
  enabled: boolean;
  /** Whether police cars may push civilian cars aside. False when the traffic is host-owned. */
  shoveTraffic: boolean;
}

/* ------------------------------------------------------------------ state */

function makeUnit(id: number): PoliceUnit {
  return {
    id,
    x: 0,
    z: 0,
    y: 0,
    heading: 0,
    prevX: 0,
    prevZ: 0,
    prevY: 0,
    prevHeading: 0,
    vx: 0,
    vz: 0,
    status: 'disabled',
    hitTime: -1,
    patrolIndex: 0,
    patrolSpeed: POLICE.patrol.speed,
    speed: 0,
    rewarded: true,
    role: 'patrol',
    loop: -1,
    goalX: 0,
    goalZ: 0,
    timer: 0,
    stuck: 0,
    sight: false,
    lights: false,
  };
}

export function createPoliceState(layout: ArenaLayout): PoliceState {
  const units: PoliceUnit[] = [];
  for (let i = 0; i < POLICE.maxUnits; i++) units.push(makeUnit(i));
  const network = layout.roadNetwork;
  const nav = network && network.length > 0 ? { graph: buildRoadGraph(network), field: null, aim: createRouteAim() } : null;
  return {
    units,
    heat: 0,
    stars: 0,
    phase: 'calm',
    enabledFor: 0,
    spawnCooldown: 0,
    sinceOffense: Infinity,
    noSight: 0,
    contacted: false,
    escapeLeft: 0,
    pinned: 0,
    holdLeft: 0,
    grace: 0,
    pursuitStart: -1,
    lastOffenseX: 0,
    lastOffenseZ: 0,
    aimedUnit: -1,
    bustedStars: 0,
    bustedFine: 0,
    bustedCharged: 0,
    wasEnabled: false,
    seed: 0x9e3779b9,
    routeTimer: 0,
    losCounter: 0,
    nav,
    stats: {
      offenses: 0,
      offensesClose: 0,
      offensesMedium: 0,
      offensesFar: 0,
      witnessed: 0,
      starsReached: [0, 0, 0, 0],
      pursuits: 0,
      escapes: 0,
      busts: 0,
      pursuitSeconds: 0,
      finesCharged: 0,
    },
  };
}

/** Everything but the pool, the network and the session's counters goes back to zero. */
export function resetPoliceState(p: PoliceState): void {
  for (const u of p.units) retire(u);
  p.heat = 0;
  p.stars = 0;
  p.phase = 'calm';
  p.enabledFor = 0;
  p.spawnCooldown = 0;
  p.sinceOffense = Infinity;
  p.noSight = 0;
  p.contacted = false;
  p.escapeLeft = 0;
  p.pinned = 0;
  p.holdLeft = 0;
  p.grace = 0;
  p.pursuitStart = -1;
  p.aimedUnit = -1;
  p.bustedStars = 0;
  p.bustedFine = 0;
  p.bustedCharged = 0;
  p.wasEnabled = false;
  p.routeTimer = 0;
  if (p.nav) p.nav.field = null;
}

/* ------------------------------------------------------------ eligibility */

/**
 * THE ONE AUTHORITATIVE ANSWER to "may the police exist right now". Free Roam means: a world
 * that has police at all (only the city builds them), no race of any kind on it, and no
 * activity holding the car — a RAYO RUSH run in any phase, a fare aboard or settling up, the
 * circuit's door taken. A lobby, a countdown or a results screen is a race by another name and
 * is covered by `race`. Every spawn, every unit of heat and every chase asks this first.
 */
export function isPoliceEnabledForCurrentGameState(state: GameState): boolean {
  if (!state.police) return false;
  if (state.race) return false;
  return engagedActivity(state) === null;
}

/* ------------------------------------------------------------------ rules */

export function offenseCategory(distance: number): PoliceOffenseCategory {
  if (distance < POLICE.heat.closeRange) return 'close';
  if (distance < POLICE.heat.mediumRange) return 'medium';
  return 'far';
}

export function heatForDistance(distance: number): number {
  const c = offenseCategory(distance);
  return c === 'close' ? POLICE.heat.close : c === 'medium' ? POLICE.heat.medium : POLICE.heat.far;
}

export function starsForHeat(heat: number): number {
  let stars = 0;
  for (let i = 0; i < POLICE.stars.length; i++) if (heat >= POLICE.stars[i]) stars = i + 1;
  return stars;
}

/** Chasers a pursuit may run at `stars`. At least one: a witnessed offence chases at any heat. */
export function chasersAllowed(stars: number): number {
  const table = POLICE.unitsByStars;
  const n = table[Math.min(stars, table.length - 1)] ?? 0;
  return Math.max(1, Math.min(n, POLICE.maxUnits));
}

/** The fine an arrest at `stars` asks for. */
export function fineForStars(stars: number): number {
  const table = POLICE.bust.fineByStars;
  return table[Math.min(Math.max(0, stars), table.length - 1)] ?? 0;
}

/** True while the player's car is held after an arrest. The orchestrator swaps the input out. */
export function policeHoldsPlayer(p: PoliceState | null | undefined): boolean {
  return !!p && p.phase === 'busted';
}

/* -------------------------------------------------------------- geometry */

/**
 * A straight line from (ax,az) to (bx,bz) at height `y`, tested against the world's collider
 * boxes. True when nothing solid is in the way. Boxes wholly below or above the line's height
 * are skipped, so a viaduct overhead does not hide a car on the street.
 */
export function hasLineOfSight(layout: ArenaLayout, ax: number, az: number, bx: number, bz: number, y: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minZ = Math.min(az, bz);
  const maxZ = Math.max(az, bz);
  const eye = y + 1.2;
  const boxes = layout.colliders;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
    if (b.maxY !== undefined && b.maxY < eye) continue;
    if (b.minY !== undefined && b.minY > eye) continue;
    // Slab test on the segment's parameter.
    let t0 = 0;
    let t1 = 1;
    if (dx !== 0) {
      const inv = 1 / dx;
      let ta = (b.minX - ax) * inv;
      let tb = (b.maxX - ax) * inv;
      if (ta > tb) {
        const s = ta;
        ta = tb;
        tb = s;
      }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
    } else if (ax < b.minX || ax > b.maxX) continue;
    if (dz !== 0) {
      const inv = 1 / dz;
      let ta = (b.minZ - az) * inv;
      let tb = (b.maxZ - az) * inv;
      if (ta > tb) {
        const s = ta;
        ta = tb;
        tb = s;
      }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
    } else if (az < b.minZ || az > b.maxZ) continue;
    if (t0 <= t1) return false;
  }
  return true;
}

/** Is (px,pz) in the view of a car at (x,z) facing `heading`: within `radius`, in front of it by `cosLimit`, or inside `nearRadius`? */
function inView(x: number, z: number, heading: number, px: number, pz: number, radius: number, cosLimit: number, nearRadius: number): boolean {
  const dx = px - x;
  const dz = pz - z;
  const d2 = dx * dx + dz * dz;
  if (d2 > radius * radius) return false;
  if (d2 <= nearRadius * nearRadius) return true;
  const d = Math.sqrt(d2);
  if (d < 1e-3) return true;
  const cos = (dx * forwardX(heading) + dz * forwardZ(heading)) / d;
  return cos >= cosLimit;
}

/* ------------------------------------------------------------- spawning */

function nextRandom(p: PoliceState): number {
  // LCG, deterministic per session. Plenty for picking a kerb to appear at.
  p.seed = (Math.imul(p.seed, 1664525) + 1013904223) >>> 0;
  return p.seed / 4294967296;
}

function isGroundLoop(layout: ArenaLayout, k: number): boolean {
  const s = layout.targetSpawns[k];
  const patrol = layout.targetPatrols[k];
  return !!s && !!patrol && patrol.length >= 2 && (s.y ?? 0) < 1;
}

/**
 * Is waypoint (wx,wz) an acceptable place for a car to appear, given where the player is:
 * inside the distance band, and — when `behindOf` is a heading — behind the player, which is
 * outside the chase camera's view.
 */
function spawnable(wx: number, wz: number, px: number, pz: number, minD: number, maxD: number, behindOf: number | null): boolean {
  const dx = wx - px;
  const dz = wz - pz;
  const d2 = dx * dx + dz * dz;
  if (d2 < minD * minD || d2 > maxD * maxD) return false;
  if (behindOf === null) return true;
  return dx * forwardX(behindOf) + dz * forwardZ(behindOf) < 0;
}

/**
 * Pick a civilian patrol loop and a waypoint on it for a new car, uniformly among the ones
 * that satisfy `spawnable`. Two passes — count, then choose — so nothing is allocated. Returns
 * false when no kerb in the world qualifies (a relaxed band is the caller's to try).
 */
function pickSpawn(
  p: PoliceState,
  layout: ArenaLayout,
  px: number,
  pz: number,
  minD: number,
  maxD: number,
  behindOf: number | null,
  out: { loop: number; index: number },
): boolean {
  let count = 0;
  for (let k = 0; k < layout.targetPatrols.length; k++) {
    if (!isGroundLoop(layout, k)) continue;
    const patrol = layout.targetPatrols[k];
    for (let j = 0; j < patrol.length; j++) if (spawnable(patrol[j].x, patrol[j].z, px, pz, minD, maxD, behindOf)) count++;
  }
  if (count === 0) return false;
  let pick = Math.floor(nextRandom(p) * count);
  for (let k = 0; k < layout.targetPatrols.length; k++) {
    if (!isGroundLoop(layout, k)) continue;
    const patrol = layout.targetPatrols[k];
    for (let j = 0; j < patrol.length; j++) {
      if (!spawnable(patrol[j].x, patrol[j].z, px, pz, minD, maxD, behindOf)) continue;
      if (pick === 0) {
        out.loop = k;
        out.index = j;
        return true;
      }
      pick--;
    }
  }
  return false;
}

const SPAWN_PICK = { loop: 0, index: 0 };

function placeOnLoop(u: PoliceUnit, layout: ArenaLayout, loop: number, index: number): void {
  const patrol = layout.targetPatrols[loop];
  const at = patrol[index];
  const next = patrol[(index + 1) % patrol.length];
  u.x = u.prevX = at.x;
  u.z = u.prevZ = at.z;
  u.y = u.prevY = layout.targetSpawns[loop].y ?? 0;
  u.heading = u.prevHeading = Math.atan2(next.x - at.x, -(next.z - at.z));
  u.vx = 0;
  u.vz = 0;
  u.speed = 0;
  u.loop = loop;
  u.patrolIndex = (index + 1) % patrol.length;
  u.stuck = 0;
  u.timer = 0;
  u.sight = false;
  u.status = 'active';
  settleTarget(u, layout);
  u.prevY = u.y;
}

function freeUnit(p: PoliceState): PoliceUnit | null {
  for (const u of p.units) if (u.status !== 'active') return u;
  return null;
}

function retire(u: PoliceUnit): void {
  u.status = 'disabled';
  u.role = 'patrol';
  u.lights = false;
  u.sight = false;
  u.speed = 0;
  u.vx = 0;
  u.vz = 0;
  u.loop = -1;
}

/** Spawn a patrol somewhere in the band around the player. */
function spawnPatrol(p: PoliceState, layout: ArenaLayout, v: VehicleState): boolean {
  const u = freeUnit(p);
  if (!u) return false;
  if (!pickSpawn(p, layout, v.x, v.z, POLICE.spawnMinDistance, POLICE.spawnMaxDistance, null, SPAWN_PICK)) return false;
  placeOnLoop(u, layout, SPAWN_PICK.loop, SPAWN_PICK.index);
  u.role = 'patrol';
  u.lights = false;
  return true;
}

/** Put a chaser on the road behind the player, out of the camera's view. */
function spawnChaser(p: PoliceState, layout: ArenaLayout, v: VehicleState, u: PoliceUnit): boolean {
  const { joinMinDistance, joinMaxDistance } = POLICE.pursuit;
  const ok =
    pickSpawn(p, layout, v.x, v.z, joinMinDistance, joinMaxDistance, v.heading, SPAWN_PICK) ||
    pickSpawn(p, layout, v.x, v.z, joinMinDistance, joinMaxDistance * 1.6, null, SPAWN_PICK);
  if (!ok) return false;
  placeOnLoop(u, layout, SPAWN_PICK.loop, SPAWN_PICK.index);
  u.role = 'pursuit';
  u.lights = true;
  return true;
}

/** Hand a car that was chasing back to the traffic: nearest ground loop, lights off. */
function backToPatrol(u: PoliceUnit, layout: ArenaLayout): void {
  let bestLoop = -1;
  let bestIndex = 0;
  let bestD2 = Infinity;
  for (let k = 0; k < layout.targetPatrols.length; k++) {
    if (!isGroundLoop(layout, k)) continue;
    const patrol = layout.targetPatrols[k];
    for (let j = 0; j < patrol.length; j++) {
      const dx = patrol[j].x - u.x;
      const dz = patrol[j].z - u.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestLoop = k;
        bestIndex = j;
      }
    }
  }
  if (bestLoop < 0) {
    retire(u);
    return;
  }
  u.loop = bestLoop;
  u.patrolIndex = bestIndex;
  u.role = 'patrol';
  u.lights = false;
  u.sight = false;
  u.stuck = 0;
  u.timer = 0;
}

/* ---------------------------------------------------------------- phases */

function setStars(p: PoliceState, stars: number, events: GameEvent[]): void {
  if (stars === p.stars) return;
  const prev = p.stars;
  p.stars = stars;
  if (stars > prev) for (let s = prev + 1; s <= stars && s < p.stats.starsReached.length; s++) p.stats.starsReached[s]++;
  events.push({ type: 'wantedStars', stars, prev, cooldown: p.phase === 'cooldown' });
}

function countActive(p: PoliceState): number {
  let n = 0;
  for (const u of p.units) if (u.status === 'active') n++;
  return n;
}

function countRole(p: PoliceState, role: PoliceUnit['role']): number {
  let n = 0;
  for (const u of p.units) if (u.status === 'active' && u.role === role) n++;
  return n;
}

function startPursuit(p: PoliceState, time: number, events: GameEvent[]): void {
  if (p.phase === 'pursuit' || p.phase === 'escaping') return;
  p.phase = 'pursuit';
  p.pursuitStart = time;
  p.noSight = 0;
  p.contacted = false;
  p.escapeLeft = 0;
  p.pinned = 0;
  p.spawnCooldown = 0;
  p.stats.pursuits++;
  events.push({ type: 'pursuitStart', stars: p.stars });
}

function endPursuit(p: PoliceState, layout: ArenaLayout, reason: 'escaped' | 'busted' | 'cleared', time: number, events: GameEvent[]): void {
  const duration = p.pursuitStart >= 0 ? Math.max(0, time - p.pursuitStart) : 0;
  p.stats.pursuitSeconds += duration;
  if (reason === 'escaped') p.stats.escapes++;
  for (const u of p.units) {
    if (u.status !== 'active' || u.role !== 'pursuit') continue;
    // The escaped-from chasers are out of sight by definition; the ones that made the arrest
    // drive off as patrols, so nothing vanishes in front of the player.
    if (reason === 'busted') backToPatrol(u, layout);
    else retire(u);
  }
  p.pursuitStart = -1;
  p.noSight = 0;
  p.escapeLeft = 0;
  p.pinned = 0;
  events.push({ type: 'pursuitEnd', reason, duration });
}

/** Everything off the road, heat gone. The activity that just began gets an empty city. */
function clearPolice(p: PoliceState, layout: ArenaLayout, time: number, events: GameEvent[]): void {
  if (p.phase === 'pursuit' || p.phase === 'escaping') endPursuit(p, layout, 'cleared', time, events);
  for (const u of p.units) retire(u);
  p.heat = 0;
  p.phase = 'calm';
  setStars(p, 0, events);
  p.pinned = 0;
  p.holdLeft = 0;
  p.escapeLeft = 0;
  p.noSight = 0;
  p.aimedUnit = -1;
  p.enabledFor = 0;
  p.spawnCooldown = 0;
  if (p.nav) p.nav.field = null;
  events.push({ type: 'policeCleared' });
}

/* -------------------------------------------------------------- offences */

function handleOffense(
  p: PoliceState,
  layout: ArenaLayout,
  v: VehicleState,
  wreck: { x: number; z: number } | null,
  distance: number,
  time: number,
  events: GameEvent[],
): void {
  const category = offenseCategory(distance);
  let heat = heatForDistance(distance);
  p.stats.offenses++;
  if (category === 'close') p.stats.offensesClose++;
  else if (category === 'medium') p.stats.offensesMedium++;
  else p.stats.offensesFar++;

  // Did a patrol see it? Within the detection radius of the player or the wreck, the offence in
  // front of or beside the patrol, and nothing solid between it and the player.
  let witness: PoliceUnit | null = null;
  const { radius, forwardCos } = POLICE.detection;
  for (const u of p.units) {
    if (u.status !== 'active' || u.role === 'pursuit') continue;
    if (Math.abs(u.y - v.y) > LEVEL_GAP) continue;
    const seesPlayer = inView(u.x, u.z, u.heading, v.x, v.z, radius, forwardCos, 0);
    const seesWreck = !!wreck && inView(u.x, u.z, u.heading, wreck.x, wreck.z, radius, forwardCos, 0);
    if (!seesPlayer && !seesWreck) continue;
    if (!hasLineOfSight(layout, u.x, u.z, v.x, v.z, u.y)) continue;
    witness = u;
    break;
  }
  if (witness) {
    heat += POLICE.heat.witnessed;
    p.stats.witnessed++;
    events.push({ type: 'policeWitness', unit: witness.id });
  }
  p.heat = Math.min(POLICE.heat.max, p.heat + heat);
  p.sinceOffense = 0;
  p.lastOffenseX = v.x;
  p.lastOffenseZ = v.z;
  events.push({ type: 'policeOffense', distance, category, heat, witnessed: !!witness });

  if (witness) {
    witness.role = 'pursuit';
    witness.lights = true;
    witness.stuck = 0;
    witness.timer = 0;
    // Stars first, so the pursuit's own event reports the level it starts at.
    setStars(p, starsForHeat(p.heat), events);
    if (p.phase === 'cooldown') p.phase = 'calm';
    startPursuit(p, time, events);
  }
}

/* ---------------------------------------------------------------- driving */

/** Steer `u` toward (tx,tz) at up to `turnRate`; returns the remaining angle (rad, signed). */
function steerToward(u: PoliceUnit, tx: number, tz: number, turnRate: number, dt: number): number {
  const dx = tx - u.x;
  const dz = tz - u.z;
  if (dx * dx + dz * dz < 0.01) return 0;
  const desired = Math.atan2(dx, -dz);
  const delta = wrapAngle(desired - u.heading);
  const maxTurn = turnRate * dt;
  u.heading = wrapAngle(u.heading + Math.max(-maxTurn, Math.min(maxTurn, delta)));
  return delta;
}

function easeSpeed(u: PoliceUnit, cruise: number, accel: number, brake: number, dt: number): void {
  const rate = (cruise < u.speed ? brake : accel) * dt;
  u.speed += Math.max(-rate, Math.min(rate, cruise - u.speed));
}

function advance(u: PoliceUnit, dt: number): void {
  u.x += forwardX(u.heading) * u.speed * dt;
  u.z += forwardZ(u.heading) * u.speed * dt;
}

/** The knock a bump left: coast along it, decay it. The walls stop it in the drive pass. */
function applyKnock(u: PoliceUnit, dt: number): void {
  if (u.vx === 0 && u.vz === 0) return;
  u.x += u.vx * dt;
  u.z += u.vz * dt;
  const decay = Math.max(0, 1 - TARGETS.knock.damping * dt);
  u.vx *= decay;
  u.vz *= decay;
  if (Math.abs(u.vx) < 0.05 && Math.abs(u.vz) < 0.05) {
    u.vx = 0;
    u.vz = 0;
  }
}

/**
 * Give way, patrol style: how much of its speed a patrol may use for whatever is in its lane —
 * civilian cars and other police alike. Chasers never yield.
 */
function yieldFor(u: PoliceUnit, targets: readonly TargetState[], units: readonly PoliceUnit[]): number {
  const { lookahead, halfWidth, stopGap } = TARGETS.traffic;
  const span = lookahead - stopGap;
  const fx = forwardX(u.heading);
  const fz = forwardZ(u.heading);
  let best = 1;
  for (let pass = 0; pass < 2; pass++) {
    const list: readonly TargetState[] = pass === 0 ? targets : units;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === u || o.status !== 'active') continue;
      const dx = o.x - u.x;
      const dz = o.z - u.z;
      if (dx > lookahead || dx < -lookahead || dz > lookahead || dz < -lookahead) continue;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > lookahead) continue;
      const lateral = Math.abs(dx * -fz + dz * fx);
      if (lateral >= halfWidth) continue;
      best = Math.min(best, Math.max(0, (ahead - stopGap) / span));
    }
  }
  return best;
}

function drivePatrol(u: PoliceUnit, p: PoliceState, layout: ArenaLayout, targets: readonly TargetState[], dt: number): void {
  const patrol = layout.targetPatrols[u.loop];
  if (!patrol || patrol.length < 2) {
    retire(u);
    return;
  }
  const wp = patrol[u.patrolIndex % patrol.length];
  const dx = wp.x - u.x;
  const dz = wp.z - u.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < TARGETS.waypointRadius) {
    u.patrolIndex = (u.patrolIndex + 1) % patrol.length;
    return;
  }
  steerToward(u, wp.x, wp.z, POLICE.patrol.turnRate, dt);
  easeSpeed(u, POLICE.patrol.speed * yieldFor(u, targets, p.units), POLICE.patrol.accel, POLICE.patrol.brake, dt);
  advance(u, dt);
  // A patrol pushed off its lane by the player is stopped by the walls like any other car.
  if (u.vx !== 0 || u.vz !== 0) pushOutOfWorld(u, POLICE.knock.radius, layout, WALL, dt);
}

function driveInvestigate(u: PoliceUnit, layout: ArenaLayout, dt: number): void {
  u.timer -= dt;
  const dx = u.goalX - u.x;
  const dz = u.goalZ - u.z;
  if (u.timer <= 0 || dx * dx + dz * dz < 100) {
    backToPatrol(u, layout);
    return;
  }
  const delta = steerToward(u, u.goalX, u.goalZ, POLICE.pursuit.turnRate, dt);
  const cruise = POLICE.patrol.speed * 1.8 * (1 - 0.6 * Math.min(1, Math.abs(delta) / 1.2));
  easeSpeed(u, cruise, POLICE.pursuit.accelByStars[2], POLICE.patrol.brake, dt);
  advance(u, dt);
  pushOutOfWorld(u, POLICE.knock.radius, layout, WALL, dt, CONTACT);
  if (CONTACT.count > 0 && u.speed < 2) u.stuck += dt;
  else u.stuck = Math.max(0, u.stuck - dt);
  if (u.stuck > POLICE.pursuit.stuckSeconds) backToPatrol(u, layout);
}

function driveChaser(u: PoliceUnit, p: PoliceState, layout: ArenaLayout, v: VehicleState, dt: number): void {
  const cfg = POLICE.pursuit;
  const stars = Math.max(2, Math.min(p.stars, cfg.speedByStars.length - 1));
  const top = cfg.speedByStars[stars];
  const accel = cfg.accelByStars[stars];

  // Reversing out of a wall.
  if (u.timer > 0) {
    u.timer -= dt;
    u.speed = Math.max(-4, u.speed - accel * dt);
    // Keep the nose on the player while backing off, so the next attempt lines up.
    steerToward(u, v.x, v.z, cfg.turnRate * 0.6, dt);
    advance(u, dt);
    pushOutOfWorld(u, POLICE.knock.radius, layout, WALL, dt, CONTACT);
    return;
  }

  // Where to drive: straight at the car when it is close and in the clear, otherwise along the
  // street network toward it, otherwise straight at it anyway.
  const dxp = v.x - u.x;
  const dzp = v.z - u.z;
  const dist = Math.sqrt(dxp * dxp + dzp * dzp);
  let tx = v.x + v.vx * cfg.lead;
  let tz = v.z + v.vz * cfg.lead;
  const direct = dist < cfg.directRange && u.sight;
  if (!direct && p.nav && p.nav.field && aimAlong(p.nav.graph, p.nav.field, u.x, u.z, cfg.routeLookahead, p.nav.aim) && !p.nav.aim.atGoal) {
    tx = p.nav.aim.x;
    tz = p.nav.aim.z;
  }
  const delta = steerToward(u, tx, tz, cfg.turnRate, dt);
  // Lift for a corner, and do not ram a stopped car at full tilt: ease to a stop on it.
  let cruise = top * (1 - 0.55 * Math.min(1, Math.abs(delta) / 1.4));
  if (dist < 8) cruise = Math.min(cruise, 4 + Math.abs(v.speed));
  easeSpeed(u, cruise, accel, POLICE.patrol.brake, dt);
  advance(u, dt);
  pushOutOfWorld(u, POLICE.knock.radius, layout, WALL, dt, CONTACT);

  // Stuck: pressed on a wall, going nowhere, and not simply parked on the player's bumper.
  if (CONTACT.count > 0 && u.speed < 2.5 && dist > 8) u.stuck += dt;
  else u.stuck = Math.max(0, u.stuck - dt * 2);
  if (u.stuck > cfg.stuckSeconds) {
    u.stuck = 0;
    if (dist > 60 || !u.sight) {
      // Nobody is watching: rejoin from behind rather than fight the wall.
      if (!spawnChaser(p, layout, v, u)) u.timer = cfg.reverseSeconds;
    } else {
      u.timer = cfg.reverseSeconds;
    }
  }
}

/* ----------------------------------------------------------- separation */

/** Police push civilian cars aside (they are the heavier car), and each other apart. */
function separate(p: PoliceState, targets: TargetState[], shoveTraffic: boolean, dt: number): void {
  const { contactDistance, bounce, maxBounce } = TARGETS.traffic;
  for (let i = 0; i < p.units.length; i++) {
    const a = p.units[i];
    if (a.status !== 'active') continue;
    if (shoveTraffic) {
      for (let j = 0; j < targets.length; j++) {
        const b = targets[j];
        if (b.status !== 'active') continue;
        if (Math.abs(b.y - a.y) > LEVEL_GAP) continue;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        if (dx > contactDistance || dx < -contactDistance || dz > contactDistance || dz < -contactDistance) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= contactDistance * contactDistance) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-4) {
          dx = 1;
          dz = 0;
          d = 1;
        }
        const nx = dx / d;
        const nz = dz / d;
        const push = contactDistance - d;
        b.x += nx * push;
        b.z += nz * push;
        const closing = ((a.x - a.prevX) * nx + (a.z - a.prevZ) * nz) / dt;
        if (closing > 0) {
          const impulse = Math.min(closing * bounce, maxBounce);
          b.vx += nx * impulse;
          b.vz += nz * impulse;
        }
      }
    }
    for (let j = i + 1; j < p.units.length; j++) {
      const b = p.units[j];
      if (b.status !== 'active') continue;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      if (dx > contactDistance || dx < -contactDistance || dz > contactDistance || dz < -contactDistance) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 >= contactDistance * contactDistance) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-4) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      const push = (contactDistance - d) * 0.5;
      a.x -= (dx / d) * push;
      a.z -= (dz / d) * push;
      b.x += (dx / d) * push;
      b.z += (dz / d) * push;
    }
  }
}

/* ------------------------------------------------------------------ step */

/**
 * One tick of the police. Runs LAST in `stepGame`, after every activity has said whether it has
 * the car, so an activity that began this very tick already switches the police off on it.
 * Reads the tick's `targetDestroyed` and `lightningFired` events; raises its own after them.
 */
export function stepPolice(
  p: PoliceState,
  layout: ArenaLayout,
  v: VehicleState,
  targets: TargetState[],
  lightning: LightningState,
  time: number,
  dt: number,
  events: GameEvent[],
  options: StepPoliceOptions,
): void {
  for (const u of p.units) {
    u.prevX = u.x;
    u.prevZ = u.z;
    u.prevY = u.y;
    u.prevHeading = u.heading;
  }

  if (!options.enabled) {
    if (p.wasEnabled || p.heat > 0 || p.phase !== 'calm' || countActive(p) > 0) clearPolice(p, layout, time, events);
    p.wasEnabled = false;
    p.aimedUnit = -1;
    return;
  }
  p.wasEnabled = true;
  p.enabledFor += dt;
  p.sinceOffense += dt;
  if (p.grace > 0) p.grace = Math.max(0, p.grace - dt);
  if (p.spawnCooldown > 0) p.spawnCooldown = Math.max(0, p.spawnCooldown - dt);
  p.losCounter++;

  /* ----- what happened this tick */
  const eventsBefore = events.length;
  if (p.phase !== 'busted') {
    for (let i = 0; i < eventsBefore; i++) {
      const ev = events[i];
      if (ev.type === 'targetDestroyed') {
        handleOffense(p, layout, v, ev, ev.distance, time, events);
      } else if (ev.type === 'lightningFired') {
        // The bolt's line crossed a police car before it ran out: shielded, no effect on it.
        const hit = rayTarget(ev.fromX, ev.fromZ, v.heading, p.units, ev.distance, LIGHTNING.hitRadius, ev.fromY);
        if (hit >= 0) {
          const u = p.units[hit];
          events.push({ type: 'policeShielded', unit: hit, x: u.x, y: u.y, z: u.z });
        }
      }
    }
  }

  /* ----- heat: drains only while nobody is chasing and nothing has happened for a while */
  const chasing = p.phase === 'pursuit' || p.phase === 'escaping';
  if (!chasing && p.phase !== 'busted' && p.heat > 0 && p.sinceOffense >= POLICE.heat.decayDelay) {
    p.heat = Math.max(0, p.heat - POLICE.heat.decayPerSecond * dt);
  }
  setStars(p, starsForHeat(p.heat), events);

  /* ----- phases */
  const freshOffense = p.sinceOffense < dt * 1.5;
  switch (p.phase) {
    case 'calm':
    case 'alert':
      if (p.stars >= 2) startPursuit(p, time, events);
      else if (p.stars === 1) p.phase = 'alert';
      else p.phase = 'calm';
      break;
    case 'cooldown':
      // Escaped: the stars are still up but fading, and only a NEW offence brings the police
      // back — the heat that is left is a memory, not a warrant.
      if (freshOffense && p.stars >= 2) {
        p.phase = 'calm';
        startPursuit(p, time, events);
      } else if (p.stars === 0) {
        p.phase = 'calm';
      }
      break;
    case 'busted':
      p.holdLeft = Math.max(0, p.holdLeft - dt);
      if (p.holdLeft === 0) {
        p.phase = 'calm';
        p.heat = 0;
        setStars(p, 0, events);
        p.grace = POLICE.bust.graceSeconds;
        events.push({ type: 'policeReleased' });
      }
      break;
    default:
      break;
  }

  // A fresh offence on a one-star alert sends the nearby patrols to have a look.
  if (p.phase === 'alert' && freshOffense) {
    for (const u of p.units) {
      if (u.status !== 'active' || u.role !== 'patrol') continue;
      const dx = u.x - p.lastOffenseX;
      const dz = u.z - p.lastOffenseZ;
      if (dx * dx + dz * dz > POLICE.alertRadius * POLICE.alertRadius) continue;
      u.role = 'investigate';
      u.goalX = p.lastOffenseX;
      u.goalZ = p.lastOffenseZ;
      u.timer = POLICE.investigateSeconds;
    }
  }

  /* ----- the pursuit: who is chasing, what they can see, the escape and the arrest */
  if (p.phase === 'pursuit' || p.phase === 'escaping') {
    const allowed = chasersAllowed(p.stars);
    let chasers = countRole(p, 'pursuit');
    // Joining is one car at a time: the nearest patrol turns its lights on, or a new car comes
    // in from behind the player — never three at once and never in view.
    if (chasers < allowed && p.spawnCooldown === 0) {
      let recruit: PoliceUnit | null = null;
      let bestD2 = 150 * 150;
      for (const u of p.units) {
        if (u.status !== 'active' || u.role === 'pursuit') continue;
        const dx = u.x - v.x;
        const dz = u.z - v.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          recruit = u;
        }
      }
      if (recruit) {
        recruit.role = 'pursuit';
        recruit.lights = true;
        recruit.stuck = 0;
        recruit.timer = 0;
        chasers++;
      } else {
        const u = freeUnit(p);
        if (u && spawnChaser(p, layout, v, u)) chasers++;
      }
      p.spawnCooldown = 1;
    }
    // More than the stars allow (a witnessed one-star chase never grows): the farthest goes
    // back to patrolling.
    while (chasers > allowed) {
      let far: PoliceUnit | null = null;
      let farD2 = -1;
      for (const u of p.units) {
        if (u.status !== 'active' || u.role !== 'pursuit') continue;
        const dx = u.x - v.x;
        const dz = u.z - v.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > farD2) {
          farD2 = d2;
          far = u;
        }
      }
      if (!far) break;
      backToPatrol(far, layout);
      chasers--;
    }

    // The route the chasers steer by, refreshed on a slow clock: Dijkstra over the junctions.
    if (p.nav) {
      p.routeTimer -= dt;
      if (p.routeTimer <= 0) {
        p.nav.field = routeTo(p.nav.graph, v);
        p.routeTimer = POLICE.pursuit.routeInterval;
      }
    }

    // Sight, and the bumper.
    let anySight = false;
    let pinning = false;
    const cfg = POLICE.pursuit;
    for (const u of p.units) {
      if (u.status !== 'active' || u.role !== 'pursuit') continue;
      const dx = v.x - u.x;
      const dz = v.z - u.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > cfg.recycleDistance * cfg.recycleDistance) {
        // Irrelevant: rejoin from behind the player, out of view — unless the player is in the
        // middle of losing them, in which case a car reappearing would be the police cheating.
        if (p.phase === 'escaping' || !spawnChaser(p, layout, v, u)) retire(u);
        continue;
      }
      // The line-of-sight test is the dear part; each car takes it every fourth tick.
      if ((p.losCounter + u.id) % 4 === 0 || !u.sight) {
        u.sight =
          Math.abs(u.y - v.y) <= LEVEL_GAP &&
          inView(u.x, u.z, u.heading, v.x, v.z, cfg.sightRadius, cfg.sightCos, cfg.sightNearRadius) &&
          hasLineOfSight(layout, u.x, u.z, v.x, v.z, u.y);
      }
      if (u.sight) anySight = true;
      if (d2 <= POLICE.bust.distance * POLICE.bust.distance) pinning = true;
    }

    if (anySight) {
      p.noSight = 0;
      p.contacted = true;
      if (p.phase === 'escaping') {
        p.phase = 'pursuit';
        p.escapeLeft = 0;
        events.push({ type: 'policeEscaping', on: false });
      }
    } else {
      p.noSight += dt;
      // The escape clock runs from the moment a chaser has seen the car; before that the
      // chasers are still on their way, and a pursuit they never catch up with gives up later.
      const patience = p.contacted ? cfg.loseSightSeconds : cfg.firstContactSeconds;
      if (p.phase === 'pursuit' && p.noSight >= patience) {
        p.phase = 'escaping';
        p.escapeLeft = cfg.escapeSeconds;
        events.push({ type: 'policeEscaping', on: true });
      } else if (p.phase === 'escaping') {
        p.escapeLeft = Math.max(0, p.escapeLeft - dt);
        if (p.escapeLeft === 0) {
          endPursuit(p, layout, 'escaped', time, events);
          p.phase = 'cooldown';
          // The stars go to their outlined form: same count, different meaning.
          events.push({ type: 'wantedStars', stars: p.stars, prev: p.stars, cooldown: true });
        }
      }
    }

    // The arrest: stopped, with a chaser on the bumper, for long enough.
    if (p.phase === 'pursuit' || p.phase === 'escaping') {
      const speed = Math.sqrt(v.vx * v.vx + v.vz * v.vz);
      if (pinning && speed < POLICE.bust.speed) p.pinned = Math.min(POLICE.bust.seconds, p.pinned + dt);
      else p.pinned = Math.max(0, p.pinned - dt * 2);
      if (p.pinned >= POLICE.bust.seconds) {
        const stars = p.stars;
        const fine = fineForStars(stars);
        const duration = p.pursuitStart >= 0 ? time - p.pursuitStart : 0;
        endPursuit(p, layout, 'busted', time, events);
        p.phase = 'busted';
        p.holdLeft = POLICE.bust.holdSeconds;
        p.bustedStars = stars;
        p.bustedFine = fine;
        p.bustedCharged = 0;
        p.stats.busts++;
        // `charged` is filled in by the economy pass that reads this event.
        events.push({ type: 'policeBusted', stars, fine, charged: 0, duration });
      }
    }
  }

  /* ----- patrols: keep the ratio, recycle the ones that wandered off */
  if (p.phase !== 'busted' && p.enabledFor >= POLICE.resumeDelay && p.grace === 0) {
    let civilians = 0;
    for (let i = 0; i < targets.length; i++) if (targets[i].status === 'active') civilians++;
    const wanted = Math.min(POLICE.maxPatrols, Math.floor(civilians / Math.max(1, POLICE.patrolRatio)));
    const patrols = countRole(p, 'patrol') + countRole(p, 'investigate');
    if (patrols < wanted && p.spawnCooldown === 0) {
      spawnPatrol(p, layout, v);
      p.spawnCooldown = POLICE.patrolSpawnInterval;
    }
  }
  for (const u of p.units) {
    if (u.status !== 'active' || u.role === 'pursuit') continue;
    const dx = u.x - v.x;
    const dz = u.z - v.z;
    if (dx * dx + dz * dz > POLICE.patrolRecycleDistance * POLICE.patrolRecycleDistance) retire(u);
  }

  /* ----- drive */
  for (const u of p.units) {
    if (u.status !== 'active') continue;
    applyKnock(u, dt);
    if (u.role === 'pursuit') driveChaser(u, p, layout, v, dt);
    else if (u.role === 'investigate') driveInvestigate(u, layout, dt);
    else drivePatrol(u, p, layout, targets, dt);
    if (u.status === 'active') settleTarget(u, layout);
  }
  separate(p, targets, options.shoveTraffic, dt);

  /* ----- the player against the cars: the ordinary shove, without the traffic's ids */
  SCRATCH_EVENTS.length = 0;
  resolveTargetCollisions(v, p.units, SCRATCH_EVENTS);
  for (let i = 0; i < SCRATCH_EVENTS.length; i++) {
    const ev = SCRATCH_EVENTS[i];
    if (ev.type === 'collision') events.push({ type: 'collision', x: ev.x, y: ev.y, z: ev.z, impact: ev.impact });
  }
  SCRATCH_EVENTS.length = 0;

  /* ----- the beam, lined up on a shielded car */
  const preview = lightning.charging ? LIGHTNING.range * (lightning.hold / LIGHTNING.maxHold) : LIGHTNING.range;
  const aimed = rayTarget(v.x, v.z, v.heading, p.units, preview, LIGHTNING.hitRadius, v.y);
  if (aimed >= 0 && lightning.acquiredTargetId >= 0) {
    // Both in the line: the nearer one is what the bolt would meet.
    const u = p.units[aimed];
    const t = targets[lightning.acquiredTargetId];
    const fx = forwardX(v.heading);
    const fz = forwardZ(v.heading);
    const alongU = (u.x - v.x) * fx + (u.z - v.z) * fz;
    const alongT = t ? (t.x - v.x) * fx + (t.z - v.z) * fz : Infinity;
    p.aimedUnit = alongU < alongT ? aimed : -1;
  } else {
    p.aimedUnit = aimed;
  }
}
