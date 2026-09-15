import type {
  EconomyState,
  GameEvent,
  HustlerLineKind,
  HustlerNpcState,
  HustlerPhase,
  HustlerSpot,
  HustlerState,
  PlayerCommand,
  VehicleState,
  WasherCancelReason,
} from '../core/types';
import { HUSTLERS } from '../config/tuning';
import { HUSTLER_NICKNAMES, HUSTLER_TRADE, TRAPITO_LINES, WASHER_LINES } from '../content/hustlers';
import { payStreetService } from './economy';
import { lineSeconds } from './passenger';

/**
 * STREET HUSTLERS: the trapitos and the windshield washers.
 *
 * WHAT IT IS. A handful of people on the pavement at places worth remembering, each working a
 * few metres of it (`src/world/hustlerSpots.ts`). Nobody walks the city, nobody is solid, and
 * nothing here moves, holds or steers the car. Like the other activities this module only WATCHES:
 * the car's pose and speed, the key, whether the police are on it and whether it is dented.
 *
 * A TRAPITO notices a car that slows or lingers near him, calls it into a space it is plainly not
 * going to park in, and — if it drives off — may say so. That is all: no button, no price, no
 * answer waited for, and a generous cooldown so driving past him twice is not a bit.
 *
 * A WASHER works one approach to one signal. His light is a pure function of sim time
 * (`signalAt`), so it needs no state and every screen agrees. A car stopped in his stretch of
 * lane on red gets an offer, which is the one thing in here with a price: F pays it, once, never
 * below zero (`payStreetService`); G or driving on is a no. Paid, he walks to the front of the car,
 * sprays, draws the squeegee across the glass `strokes` times (`squeegeeAt`, which the picture
 * shares), and walks back. An offer only goes up with enough red left for a whole clean, and a yes
 * is only taken while that is still true — so the light never interrupts a clean it let start.
 * The car driving off does, and he gets out of its way at once.
 *
 * ONE VOICE AT A TIME for the whole cast, and never over a passenger, El Búho or Loco Mustang
 * (`othersTalking`). A washer's lines take the strip from a trapito's; nobody else's do. Lines
 * are never the same text twice running, and the strip is cut when the car is out of earshot.
 *
 * Pure data in, pure data out. No Three.js, no DOM, no clock of its own; nothing allocates per tick.
 */

/** Whatever else the tick knows about the car. One long-lived object is fine; nothing here keeps it. */
export interface HustlerContext {
  /** The car wears crash damage anyone could see. */
  damaged: boolean;
  /** The police are chasing it. */
  pursued: boolean;
}

function createNpc(): HustlerNpcState {
  return {
    phase: 'idle',
    since: 0,
    cooldownUntil: 0,
    dwell: 0,
    encounters: 0,
    mood: 'plain',
    fromX: 0,
    fromZ: 0,
    toX: 0,
    toZ: 0,
    carX: 0,
    carZ: 0,
    carHeading: 0,
  };
}

export function createHustlerState(spots: readonly HustlerSpot[]): HustlerState {
  return {
    npcs: spots.map(() => createNpc()),
    locked: false,
    keyBusy: false,
    othersTalking: false,
    speaker: -1,
    line: '',
    lineKind: 'call',
    lineId: 0,
    lineTimeLeft: 0,
    lastText: '',
    offering: -1,
    seed: 0x7a3b19c5,
    stats: { calls: 0, offers: 0, paid: 0, refused: 0, cancelled: 0, charged: 0 },
  };
}

/** Everybody back on their spot with nothing going on. A restart; how well they know you survives it. */
export function resetHustlerState(s: HustlerState): void {
  for (const n of s.npcs) {
    n.phase = 'idle';
    n.since = 0;
    n.cooldownUntil = 0;
    n.dwell = 0;
    n.mood = 'plain';
  }
  s.speaker = -1;
  s.line = '';
  s.lineTimeLeft = 0;
  s.offering = -1;
}

/* ================================================================== the light */

export type SignalColor = 'green' | 'amber' | 'red';

export interface SignalReading {
  color: SignalColor;
  /** Seconds until the colour changes. */
  left: number;
}

/**
 * A washer's light at `time`: green, amber, red, round and round, `offset` seconds into its cycle
 * at time zero. Pure, so the rules, the lamp and a test all read the same light.
 */
export function signalAt(offset: number, time: number, out: SignalReading = { color: 'green', left: 0 }): SignalReading {
  const { green, amber, red } = HUSTLERS.washer.signal;
  const cycle = green + amber + red;
  const t = (((time + offset) % cycle) + cycle) % cycle;
  if (t < green) {
    out.color = 'green';
    out.left = green - t;
  } else if (t < green + amber) {
    out.color = 'amber';
    out.left = green + amber - t;
  } else {
    out.color = 'red';
    out.left = cycle - t;
  }
  return out;
}

/** The seconds a walk from (ax, az) to (bx, bz) takes him. */
export function walkSeconds(ax: number, az: number, bx: number, bz: number): number {
  const W = HUSTLERS.washer;
  return Math.min(W.walkMax, Math.max(W.walkMin, Math.hypot(bx - ax, bz - az) / W.walkSpeed));
}

/** The most red a clean can need once it is paid for: the longest walk, the spray, the strokes. */
export function washerRedNeeded(): number {
  const W = HUSTLERS.washer;
  return W.walkMax + W.spraySeconds + W.wipeSeconds + 0.4;
}

/** Where the squeegee is, `t` seconds into a clean. `u` runs across the glass 0..1, `v` top to bottom. */
export interface SqueegeePose {
  /** 0 while he is still spraying, 1 while he is wiping. */
  wiping: number;
  /** Which stroke (0-based), and where along it. */
  stroke: number;
  u: number;
  v: number;
}

export function squeegeeAt(t: number, out: SqueegeePose = { wiping: 0, stroke: 0, u: 0, v: 0 }): SqueegeePose {
  const W = HUSTLERS.washer;
  if (t < W.spraySeconds) {
    out.wiping = 0;
    out.stroke = 0;
    out.u = 0;
    out.v = 0.5 / W.strokes;
    return out;
  }
  const w = Math.min(W.strokes - 1e-6, ((t - W.spraySeconds) / W.wipeSeconds) * W.strokes);
  const stroke = Math.floor(w);
  const f = w - stroke;
  // Eased at both ends of a stroke, the way an arm actually draws one.
  const e = f * f * (3 - 2 * f);
  out.wiping = t < W.spraySeconds + W.wipeSeconds ? 1 : 0;
  out.stroke = stroke;
  // Back and forth: left to right, then right to left one row down.
  out.u = stroke % 2 === 0 ? e : 1 - e;
  out.v = (stroke + 0.5) / W.strokes;
  return out;
}

/** Whether foam at (u, v) on the glass has been wiped off `t` seconds into a clean. */
export function foamCleared(t: number, u: number, v: number): boolean {
  const W = HUSTLERS.washer;
  if (t < W.spraySeconds) return false;
  if (t >= W.spraySeconds + W.wipeSeconds) return true;
  const row = Math.min(W.strokes - 1, Math.floor(v * W.strokes));
  const q = squeegeeAt(t, SQUEEGEE);
  if (q.stroke > row) return true;
  if (q.stroke < row) return false;
  return row % 2 === 0 ? u <= q.u : u >= q.u;
}

/* ================================================================== who he is */

/** What the subtitle calls npc `i`: his trade, until he has worked your car `nicknameAfter` times. */
export function hustlerName(s: HustlerState, spots: readonly HustlerSpot[], i: number): string {
  const n = s.npcs[i];
  const spot = spots[i];
  if (!n || !spot) return '';
  if (n.encounters >= HUSTLERS.nicknameAfter) return HUSTLER_NICKNAMES[i % HUSTLER_NICKNAMES.length];
  return HUSTLER_TRADE[spot.kind];
}

/** Whether a washer's offer is up, which is what the two buttons are. */
export function washerOfferOpen(s: HustlerState | null): boolean {
  return !!s && s.offering >= 0;
}

/* ================================================================== dialogue */

function nextRandom(s: HustlerState): number {
  let x = s.seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.seed = x | 0;
  return ((x >>> 0) % 10_000) / 10_000;
}

/** One of `lines`, never the one just said when there is a choice. */
function pickLine(s: HustlerState, lines: readonly string[]): string {
  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0];
  let i = Math.floor(nextRandom(s) * lines.length) % lines.length;
  if (lines[i] === s.lastText) i = (i + 1) % lines.length;
  return lines[i];
}

/**
 * Say a line from `lines`, if it may be said: never over somebody else's activity, and — unless
 * `force`, which is a washer's — never over another hustler still talking. True when it was said.
 */
function say(s: HustlerState, npc: number, lines: readonly string[], kind: HustlerLineKind, events: GameEvent[], force = false): boolean {
  if (s.othersTalking) return false;
  if (!force && s.lineTimeLeft > 0 && s.speaker !== npc) return false;
  const text = pickLine(s, lines);
  if (!text) return false;
  s.speaker = npc;
  s.line = text;
  s.lineKind = kind;
  s.lineId += 1;
  s.lineTimeLeft = lineSeconds(text);
  s.lastText = text;
  events.push({ type: 'hustlerLine', npc, text, kind });
  return true;
}

/** Take a line off the strip, if it is this npc's (or anyone's, for -1). */
function hush(s: HustlerState, npc = -1): void {
  if (npc >= 0 && s.speaker !== npc) return;
  s.line = '';
  s.lineTimeLeft = 0;
  s.speaker = -1;
}

function setPhase(n: HustlerNpcState, phase: HustlerPhase, time: number): void {
  n.phase = phase;
  n.since = time;
}

/* ================================================================== the tick */

/** Scratch, reused every tick. */
const LIGHT: SignalReading = { color: 'green', left: 0 };
const SQUEEGEE: SqueegeePose = { wiping: 0, stroke: 0, u: 0, v: 0 };

/**
 * One tick. `s.locked`, `s.keyBusy` and `s.othersTalking` are the orchestrator's and are written
 * before this runs; `events` is appended to, and the only money moved is a washer's price on a yes.
 */
export function stepHustlers(
  s: HustlerState,
  spots: readonly HustlerSpot[],
  v: VehicleState,
  cmd: PlayerCommand,
  economy: EconomyState,
  ctx: HustlerContext,
  time: number,
  dt: number,
  events: GameEvent[],
): void {
  if (s.lineTimeLeft > 0) {
    s.lineTimeLeft -= dt;
    if (s.lineTimeLeft <= 0) hush(s);
  }
  // Somebody else's activity started talking, or the car is out of earshot: the strip is cut clean.
  if (s.speaker >= 0) {
    const sp = spots[s.speaker];
    if (s.othersTalking || !sp || Math.hypot(v.x - sp.x, v.z - sp.z) > HUSTLERS.hearRadius) hush(s);
  }

  const onStreet = v.y < HUSTLERS.streetY;
  for (let i = 0; i < spots.length && i < s.npcs.length; i++) {
    const spot = spots[i];
    const n = s.npcs[i];
    if (spot.kind === 'trapito') stepTrapito(s, i, spot, n, v, onStreet, ctx, time, dt, events);
    else stepWasher(s, i, spot, n, v, onStreet, cmd, economy, ctx, time, dt, events);
  }
}

/* ------------------------------------------------------------------ trapitos */

function stepTrapito(
  s: HustlerState,
  i: number,
  spot: HustlerSpot,
  n: HustlerNpcState,
  v: VehicleState,
  onStreet: boolean,
  ctx: HustlerContext,
  time: number,
  dt: number,
  events: GameEvent[],
): void {
  const T = HUSTLERS.trapito;
  const d = onStreet ? Math.hypot(v.x - spot.x, v.z - spot.z) : Infinity;
  const speed = Math.abs(v.speed);

  switch (n.phase) {
    case 'idle': {
      if (s.locked || time < n.cooldownUntil || d > T.noticeRadius) {
        n.dwell = 0;
        return;
      }
      // Slow and near is a car looking for a space; merely near, for long enough, is one too.
      if (speed < T.slowSpeed) n.dwell += dt;
      else if (d < T.lingerRadius) n.dwell += dt * (T.noticeSeconds / T.lingerSeconds);
      else n.dwell = 0;
      if (n.dwell < T.noticeSeconds) return;
      n.dwell = 0;
      n.encounters += 1;
      s.stats.calls += 1;
      setPhase(n, 'call', time);
      // What he says, by priority: the dents first, then — sometimes — that he knows you, or that
      // the car is worth watching, and otherwise the call itself.
      if (ctx.damaged) {
        n.mood = 'damaged';
        say(s, i, TRAPITO_LINES.damaged, 'damaged', events);
      } else if (n.encounters > HUSTLERS.nicknameAfter && nextRandom(s) < HUSTLERS.regularChance) {
        n.mood = 'plain';
        say(s, i, TRAPITO_LINES.regular, 'regular', events);
      } else if (nextRandom(s) < T.cleanChance) {
        n.mood = 'clean';
        say(s, i, TRAPITO_LINES.clean, 'clean', events);
      } else {
        n.mood = 'plain';
        say(s, i, TRAPITO_LINES.call, 'call', events);
      }
      return;
    }
    case 'call':
    case 'wait': {
      if (s.locked || d > T.leaveRadius) {
        n.cooldownUntil = time + T.cooldown;
        const recent = n.phase === 'call' || time - n.since < T.followWindow - T.callSeconds;
        if (!s.locked && recent && nextRandom(s) < T.followChance && say(s, i, TRAPITO_LINES.ignored, 'ignored', events)) {
          setPhase(n, 'grumble', time);
        } else {
          setPhase(n, 'idle', time);
        }
        return;
      }
      if (n.phase === 'call' && time - n.since >= T.callSeconds) setPhase(n, 'wait', time);
      return;
    }
    case 'grumble':
      if (time - n.since >= T.grumbleSeconds) setPhase(n, 'idle', time);
      return;
    default:
      setPhase(n, 'idle', time);
      return;
  }
}

/* ------------------------------------------------------------------ washers */

function closeOffer(s: HustlerState, i: number, events: GameEvent[]): void {
  if (s.offering !== i) return;
  s.offering = -1;
  events.push({ type: 'washerOffer', npc: i, on: false });
}

/** Walk back to his corner from wherever he is now. */
function retreat(n: HustlerNpcState, spot: HustlerSpot, x: number, z: number, time: number): void {
  n.fromX = x;
  n.fromZ = z;
  n.toX = spot.x;
  n.toZ = spot.z;
  setPhase(n, 'retreat', time);
}

/** Where he is along a walk, `t` seconds in. */
function walkPoint(n: HustlerNpcState, t: number): { x: number; z: number } {
  const u = Math.min(1, Math.max(0, t / walkSeconds(n.fromX, n.fromZ, n.toX, n.toZ)));
  return { x: n.fromX + (n.toX - n.fromX) * u, z: n.fromZ + (n.toZ - n.fromZ) * u };
}

function stepWasher(
  s: HustlerState,
  i: number,
  spot: HustlerSpot,
  n: HustlerNpcState,
  v: VehicleState,
  onStreet: boolean,
  cmd: PlayerCommand,
  economy: EconomyState,
  ctx: HustlerContext,
  time: number,
  dt: number,
  events: GameEvent[],
): void {
  const W = HUSTLERS.washer;
  const ap = spot.approach;
  const sig = spot.signal;
  if (!ap || !sig) return;
  const light = signalAt(sig.offset, time, LIGHT);
  const speed = Math.abs(v.speed);

  // The car in the lane's own frame: along the approach, and across it.
  const fx = Math.sin(ap.heading);
  const fz = -Math.cos(ap.heading);
  const cx = v.x - ap.x;
  const cz = v.z - ap.z;
  const along = cx * fx + cz * fz;
  const across = cx * -fz + cz * fx;
  const aligned = Math.cos(v.heading - ap.heading) > 0.5;
  const inArea = onStreet && aligned && along > -W.area.behind && along < W.area.ahead && Math.abs(across) < W.area.across;
  const need = washerRedNeeded();
  const t = time - n.since;

  switch (n.phase) {
    case 'idle': {
      if (s.locked || time < n.cooldownUntil || light.color !== 'red' || !inArea || speed > W.stopSpeed) {
        n.dwell = 0;
        return;
      }
      n.dwell += dt;
      if (n.dwell < W.noticeSeconds) return;
      n.dwell = 0;
      if (ctx.pursued) {
        // No offer with the police on the car: he waves it on and wants no part of it.
        say(s, i, WASHER_LINES.pursuit, 'pursuit', events, true);
        setPhase(n, 'waveOff', time);
        n.cooldownUntil = time + W.cooldown;
        return;
      }
      // Not while another prompt has the key, not two offers at once, and never one he could not finish.
      if (s.keyBusy || s.offering >= 0 || light.left < need + W.offerMargin) return;
      n.encounters += 1;
      s.stats.offers += 1;
      s.offering = i;
      events.push({ type: 'washerOffer', npc: i, on: true });
      setPhase(n, 'offer', time);
      if (ctx.damaged) {
        n.mood = 'damaged';
        say(s, i, WASHER_LINES.damaged, 'damaged', events, true);
      } else if (n.encounters > HUSTLERS.nicknameAfter && nextRandom(s) < HUSTLERS.regularChance) {
        n.mood = 'plain';
        say(s, i, WASHER_LINES.regular, 'regular', events, true);
      } else {
        n.mood = 'plain';
        say(s, i, WASHER_LINES.offer, 'offer', events, true);
      }
      return;
    }

    case 'offer': {
      if (s.locked) {
        closeOffer(s, i, events);
        hush(s, i);
        retreat(n, spot, spot.x, spot.z, time);
        n.cooldownUntil = time + W.cooldown;
        return;
      }
      if (ctx.pursued) {
        closeOffer(s, i, events);
        say(s, i, WASHER_LINES.pursuit, 'pursuit', events, true);
        setPhase(n, 'waveOff', time);
        n.cooldownUntil = time + W.cooldown;
        return;
      }
      // Driven on, or the light is about to change: the offer comes down and he steps back.
      if (!inArea || speed > W.driveOffSpeed || light.color !== 'red' || light.left < need) {
        closeOffer(s, i, events);
        hush(s, i);
        retreat(n, spot, spot.x, spot.z, time);
        n.cooldownUntil = time + W.cooldown;
        return;
      }
      if (cmd.decline) {
        closeOffer(s, i, events);
        s.stats.refused += 1;
        events.push({ type: 'washerRefused', npc: i });
        say(s, i, WASHER_LINES.refused, 'refused', events, true);
        setPhase(n, 'refused', time);
        n.cooldownUntil = time + W.cooldown;
        return;
      }
      if (cmd.activate && !s.keyBusy) {
        closeOffer(s, i, events);
        const charged = payStreetService(economy, W.price);
        s.stats.paid += 1;
        s.stats.charged += charged;
        events.push({ type: 'washerPaid', npc: i, price: W.price, charged });
        hush(s, i);
        // To the front corner of the car on his own side, so he never crosses in front of it.
        const hx = Math.sin(v.heading);
        const hz = -Math.cos(v.heading);
        const side = (spot.x - v.x) * -hz + (spot.z - v.z) * hx >= 0 ? 1 : -1;
        n.carX = v.x;
        n.carZ = v.z;
        n.carHeading = v.heading;
        n.fromX = spot.x;
        n.fromZ = spot.z;
        n.toX = v.x + hx * W.standForward - hz * side * W.standSide;
        n.toZ = v.z + hz * W.standForward + hx * side * W.standSide;
        n.dwell = 0;
        setPhase(n, 'approach', time);
        return;
      }
      if (t >= W.offerSeconds) {
        closeOffer(s, i, events);
        s.stats.refused += 1;
        say(s, i, WASHER_LINES.refused, 'refused', events, true);
        setPhase(n, 'refused', time);
        n.cooldownUntil = time + W.cooldown;
      }
      return;
    }

    case 'approach':
    case 'clean': {
      const moved = Math.hypot(v.x - n.carX, v.z - n.carZ) > W.driveOffDistance || speed > W.driveOffSpeed;
      const reason: WasherCancelReason | null = s.locked ? 'locked' : ctx.pursued ? 'police' : moved ? 'drove' : light.color === 'green' ? 'light' : null;
      if (reason) {
        // Out of the way at once, from wherever he had got to.
        const at = n.phase === 'approach' ? walkPoint(n, t) : { x: n.toX, z: n.toZ };
        s.stats.cancelled += 1;
        events.push({ type: 'washerCancelled', npc: i, reason });
        hush(s, i);
        if (reason === 'police') say(s, i, WASHER_LINES.pursuit, 'pursuit', events, true);
        retreat(n, spot, at.x, at.z, time);
        n.cooldownUntil = time + W.cooldown;
        return;
      }
      if (n.phase === 'approach') {
        if (t >= walkSeconds(n.fromX, n.fromZ, n.toX, n.toZ)) {
          setPhase(n, 'clean', time);
          say(s, i, WASHER_LINES.cleaning, 'cleaning', events, true);
        }
        return;
      }
      // A second remark halfway, if the first has run out by then. `dwell` is the flag for it.
      if (n.dwell === 0 && t > W.spraySeconds + W.wipeSeconds * 0.5 && s.lineTimeLeft <= 0) {
        n.dwell = 1;
        say(s, i, WASHER_LINES.cleaning, 'cleaning', events, true);
      }
      if (t >= W.spraySeconds + W.wipeSeconds) {
        n.dwell = 0;
        say(s, i, WASHER_LINES.thanks, 'thanks', events, true);
        setPhase(n, 'thanks', time);
      }
      return;
    }

    case 'thanks':
      if (t >= W.thanksSeconds) retreat(n, spot, n.toX, n.toZ, time);
      return;

    case 'retreat':
      if (t >= walkSeconds(n.fromX, n.fromZ, n.toX, n.toZ)) {
        setPhase(n, 'idle', time);
        if (n.cooldownUntil < time + W.cooldown * 0.5) n.cooldownUntil = time + W.cooldown;
      }
      return;

    case 'refused':
    case 'waveOff':
      if (t >= W.refusedSeconds) setPhase(n, 'idle', time);
      return;

    default:
      setPhase(n, 'idle', time);
      return;
  }
}
