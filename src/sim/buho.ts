import type { ActivitySite, BuhoLineKind, BuhoState, EconomyState, GameEvent, MoogulEndReason, PlayerCommand, VehicleState } from '../core/types';
import { MOOGUL } from '../config/tuning';
import { BUHO, type BuhoDef } from '../content/buho';
import { lineSeconds } from './passenger';
import { spendMoney } from './economy';

/**
 * EL BÚHO: the encounter under the highway, and the Moogul's clock.
 *
 * WHAT IT IS. A ring of paint in one bay under the viaduct with a man standing in it. Roll
 * onto the paint and he says something; press the key and the price is on the sign; press it
 * again inside `confirmSeconds` and the yen counter drops by `MOOGUL.price` once, he says one
 * more thing, and a clock starts. That clock is the only thing this module carries out of the
 * bay: `moogulElapsed`, in simulation seconds, which the renderer turns into a picture
 * (`src/render/scene/moogulTrip.ts`) through `moogulIntensity` below. Nothing here moves a car,
 * touches the traffic, the weapon, another player or the rules of any other activity.
 *
 * WHERE IT SITS IN A TICK. Last, after `stepRush` and `stepPassenger`, so `locked` can be
 * written from what those two decided, and so a run or a ride that began THIS tick has already
 * raised its event when the orchestrator asks this module to end the trip for it.
 *
 * ONE PRESS NEVER PAYS. The first press arms; the second buys. A press with the Moogul already
 * in the player buys nothing and says so; a press without the money buys nothing and says so.
 * `activate` is a per-tick latch (`src/core/input/keyboard.ts`), so a held key is one press.
 *
 * THE CLOCK IS SIMULATION TIME, not wall time and not frames: it advances only inside
 * `stepGame`, so it stops when the tab does and comes back exactly where it left off, and a
 * frame that ran five ticks moves it five ticks — never a burst. `MOOGUL.debug.timeScale`
 * multiplies it for development, nothing else does.
 *
 * Pure data in, pure data out. No Three.js, no DOM, no clock of its own.
 */

export function createBuhoState(): BuhoState {
  return {
    atSite: false,
    locked: false,
    confirmArm: 0,
    greeted: false,
    moogulActive: false,
    moogulElapsed: 0,
    purchases: 0,
    noticeFor: 0,
    notice: null,
    line: '',
    lineKind: 'greeting',
    lineId: 0,
    lineTimeLeft: 0,
    lastText: '',
    seed: 0x2545f491,
  };
}

/** Back to nobody near him and nothing in the player. A restart. */
export function resetBuhoState(s: BuhoState): void {
  s.atSite = false;
  s.confirmArm = 0;
  s.greeted = false;
  s.moogulActive = false;
  s.moogulElapsed = 0;
  s.noticeFor = 0;
  s.notice = null;
  s.line = '';
  s.lineTimeLeft = 0;
  s.lastText = '';
}

/* ================================================================== the envelope */

/**
 * The Moogul's intensity, 0..1, at `elapsed` seconds: the timeline's keys eased between, so it
 * is continuous and has no step anywhere in it. Exactly 0 before the first non-zero key and
 * after the duration. Pure; the renderer and the tests both read it.
 */
export function moogulIntensity(elapsed: number, timeline = MOOGUL.timeline): number {
  const keys = timeline.keys;
  const d = timeline.duration;
  if (keys.length === 0 || d <= 0 || elapsed <= 0) return 0;
  const f = elapsed / d;
  if (f >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
  for (let i = 1; i < keys.length; i++) {
    const [f1, v1] = keys[i];
    if (f > f1) continue;
    const [f0, v0] = keys[i - 1];
    const span = f1 - f0;
    if (span <= 1e-9) return v1;
    const u = (f - f0) / span;
    const s = u * u * (3 - 2 * u);
    return v0 + (v1 - v0) * s;
  }
  return 0;
}

/** Where one layer is, 0..1, given the envelope and the layer's own `[start, full]` window. */
export function layerAmount(intensity: number, window: readonly [number, number]): number {
  const [a, b] = window;
  if (b <= a) return intensity >= b ? 1 : 0;
  const u = (intensity - a) / (b - a);
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u * u * (3 - 2 * u);
}

/* ================================================================== dialogue */

function nextRandom(s: BuhoState): number {
  let x = s.seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.seed = x | 0;
  return ((x >>> 0) % 10_000) / 10_000;
}

/** One of `lines`, never the one just said when there is a choice. */
function pickLine(s: BuhoState, lines: readonly string[]): string {
  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0];
  let i = Math.floor(nextRandom(s) * lines.length) % lines.length;
  if (lines[i] === s.lastText) i = (i + 1) % lines.length;
  return lines[i];
}

/** Say it now. One line at a time; a new one replaces whatever was up. */
function say(s: BuhoState, text: string, kind: BuhoLineKind, events: GameEvent[]): void {
  if (!text) return;
  s.line = text;
  s.lineKind = kind;
  s.lineId += 1;
  s.lineTimeLeft = lineSeconds(text);
  s.lastText = text;
  events.push({ type: 'buhoLine', text, kind });
}

/* ================================================================== the purchase */

/** Whether a press right now would arm or buy: on the paint, nobody else has the car, nothing in the player. */
export function canBuyMoogul(s: BuhoState): boolean {
  return s.atSite && !s.locked && !s.moogulActive;
}

/**
 * The purchase itself. Charges once, or not at all: false — and a refusal on the prompt — when
 * the counter cannot cover it or the last one is still in the player. The remark plays with
 * the money already gone.
 */
export function buyMoogul(s: BuhoState, def: BuhoDef, economy: EconomyState, events: GameEvent[]): boolean {
  s.confirmArm = 0;
  if (s.moogulActive) {
    s.notice = 'active';
    s.noticeFor = MOOGUL.noticeSeconds;
    say(s, pickLine(s, def.busy), 'busy', events);
    events.push({ type: 'buhoDenied', reason: 'active' });
    return false;
  }
  if (!spendMoney(economy, MOOGUL.price)) {
    s.notice = 'funds';
    s.noticeFor = MOOGUL.noticeSeconds;
    say(s, pickLine(s, def.broke), 'broke', events);
    events.push({ type: 'buhoDenied', reason: 'funds' });
    return false;
  }
  s.moogulActive = true;
  s.moogulElapsed = 0;
  s.purchases += 1;
  s.notice = null;
  s.noticeFor = 0;
  say(s, pickLine(s, def.remarks), 'remark', events);
  events.push({ type: 'buhoPurchase', price: MOOGUL.price });
  return true;
}

/** Start the clock without paying: development and automation only. */
export function grantMoogul(s: BuhoState, events: GameEvent[], elapsed = 0): void {
  s.moogulActive = true;
  s.moogulElapsed = Math.max(0, elapsed);
  s.confirmArm = 0;
  events.push({ type: 'buhoPurchase', price: 0 });
}

/** The Moogul wears off, or is cut short. Raises `moogulEnd` once; false when there was none. */
export function endMoogul(s: BuhoState, reason: MoogulEndReason, events: GameEvent[]): boolean {
  if (!s.moogulActive) return false;
  s.moogulActive = false;
  s.moogulElapsed = 0;
  events.push({ type: 'moogulEnd', reason });
  return true;
}

/* ================================================================== the tick */

function inZone(v: VehicleState, site: ActivitySite, was: boolean): boolean {
  const m = MOOGUL.marker;
  const dx = v.x - site.x;
  const dz = v.z - site.z;
  const limit = was ? m.exitRadius : m.promptRadius;
  return dx * dx + dz * dz <= limit * limit;
}

/**
 * One tick. `s.locked` is the orchestrator's (`src/sim/gameState.ts`) and is written before
 * this runs; `events` is appended to. The Moogul's clock runs whether or not the car is
 * anywhere near the bay.
 */
export function stepBuho(
  s: BuhoState,
  site: ActivitySite,
  v: VehicleState,
  economy: EconomyState,
  cmd: PlayerCommand,
  dt: number,
  events: GameEvent[],
  def: BuhoDef = BUHO,
): void {
  /* ------------------------------------------------------------ the clock */

  if (s.moogulActive) {
    s.moogulElapsed += dt * Math.max(0, MOOGUL.debug.timeScale);
    if (s.moogulElapsed >= MOOGUL.timeline.duration) endMoogul(s, 'expired', events);
  }

  /* ------------------------------------------------------------ the bay */

  const was = s.atSite;
  s.atSite = inZone(v, site, was);
  if (s.atSite !== was) events.push({ type: 'buhoPrompt', on: s.atSite });
  if (!s.atSite) {
    s.confirmArm = 0;
    s.greeted = false;
    s.notice = null;
    s.noticeFor = 0;
  } else if (!s.greeted && !s.locked) {
    // Once per visit, as the car rolls onto the paint — and never over a remark or a
    // refusal, only over silence or the last hello.
    s.greeted = true;
    if (s.lineTimeLeft <= 0 || s.lineKind === 'greeting') say(s, pickLine(s, def.greetings), 'greeting', events);
  }

  if (s.confirmArm > 0) s.confirmArm = Math.max(0, s.confirmArm - dt);
  if (s.noticeFor > 0) {
    s.noticeFor = Math.max(0, s.noticeFor - dt);
    if (s.noticeFor === 0) s.notice = null;
  }

  /* ------------------------------------------------------------ one button */

  if (cmd.activate && s.atSite && !s.locked) {
    if (s.moogulActive || s.confirmArm > 0) buyMoogul(s, def, economy, events);
    else s.confirmArm = MOOGUL.confirmSeconds;
  }

  /* ------------------------------------------------------------ the subtitle */

  if (s.lineTimeLeft > 0) {
    s.lineTimeLeft -= dt;
    if (s.lineTimeLeft <= 0) {
      s.lineTimeLeft = 0;
      s.line = '';
    }
  }
}
