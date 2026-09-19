import type { ActivitySite, GameEvent, GarageLineKind, GarageState, PlayerCommand, VehicleState } from '../core/types';
import { GARAGE } from '../world/garage';
import { LOCO_MUSTANG, type GarageDef } from '../content/garage';
import { lineSeconds } from './passenger';

/**
 * LOCO MUSTANG'S GARAGE: the man on the apron and the ring in front of his workshop.
 *
 * A ring on the apron in front of the garage mouth. Roll onto it and he says hello, and the sign
 * over the ring says what the place is in the HUD's caps. With the workshop wired
 * (`GarageRules.workshop`) the key is the workshop's door — `garageWantsWorkshop` says it was
 * knocked on, `src/sim/workshop.ts` opens it — and he only talks: the hello, and his reactions
 * to what happens inside (`garageWorkshopLine`). Without it (the legacy default) the key gets a
 * "not open yet" line. Either way nothing HERE is bought, moves the car, or holds it: the
 * workshop is the activity that holds it.
 *
 * Like El Búho (`buho.ts`) he is never the activity that has the car, so he goes quiet — no
 * hello, no answer to the key — while something else does (`locked`, from `activities.ts`).
 *
 * Pure data in, pure data out. No Three.js, no DOM, no clock of its own.
 */

export function createGarageState(): GarageState {
  return {
    atSite: false,
    locked: false,
    greeted: false,
    line: '',
    lineKind: 'greeting',
    lineId: 0,
    lineTimeLeft: 0,
    lastText: '',
    seed: 0x5eed9922,
  };
}

/** Nobody on the apron, nothing being said. A restart. */
export function resetGarageState(s: GarageState): void {
  s.atSite = false;
  s.greeted = false;
  s.line = '';
  s.lineTimeLeft = 0;
  s.lastText = '';
}

function nextRandom(s: GarageState): number {
  let x = s.seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.seed = x | 0;
  return ((x >>> 0) % 10_000) / 10_000;
}

/** One of `lines`, never the one just said when there is a choice. */
function pickLine(s: GarageState, lines: readonly string[]): string {
  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0];
  let i = Math.floor(nextRandom(s) * lines.length) % lines.length;
  if (lines[i] === s.lastText) i = (i + 1) % lines.length;
  return lines[i];
}

function say(s: GarageState, text: string, kind: GarageLineKind, events: GameEvent[]): void {
  if (!text) return;
  s.line = text;
  s.lineKind = kind;
  s.lineId += 1;
  s.lineTimeLeft = lineSeconds(text);
  s.lastText = text;
  events.push({ type: 'garageLine', text, kind });
}

/** Whether the car is on the ring with nobody else holding it: the sign is up and the key answers. */
export function garageOpenToTalk(s: GarageState): boolean {
  return s.atSite && !s.locked;
}

/** How the garage behaves: before the workshop was wired into the game, or with its door open. */
export interface GarageRules {
  /**
   * True once the workshop (`src/sim/workshop.ts`) is wired: he greets with `openGreetings`
   * and leaves the key to the workshop's door (`garageWantsWorkshop` → `openWorkshop`), saying
   * nothing to it himself. False (the default until the integrator passes true) is the garage as
   * it was: the legacy `greetings`, and a `soon` line to the key.
   */
  workshop: boolean;
}

const LEGACY_RULES: GarageRules = { workshop: false };

/**
 * Whether this tick's key is a knock on the workshop's door: on the ring, nobody else holding
 * the car, key pressed. The orchestrator then asks `canEnterWorkshop` and calls `openWorkshop`.
 */
export function garageWantsWorkshop(s: GarageState, cmd: PlayerCommand): boolean {
  return cmd.activate && garageOpenToTalk(s);
}

/**
 * Loco Mustang reacts to the workshop: a hello as the showroom comes up, a cheer for a paid
 * INSTALL, a shrug when the money is short or the door stays shut, a goodbye on the way out.
 * Scans `events` from `from` (the length the list had before the workshop ran) and says at most
 * one line — the last worth saying. Free installs, previews and invalid options get nothing.
 *
 * Kinds: GarageLineKind is only `'greeting' | 'soon'` (types.ts, frozen); welcome and goodbye
 * go out as `'greeting'`, the rest as `'soon'` until the integrator widens it.
 */
export function garageWorkshopLine(s: GarageState, events: GameEvent[], from = 0, def: GarageDef = LOCO_MUSTANG): void {
  let pool: readonly string[] | null = null;
  let kind: GarageLineKind = 'greeting';
  const end = events.length;
  for (let i = from; i < end; i++) {
    const ev = events[i];
    if (ev.type === 'workshopEnter') {
      pool = def.welcome;
      kind = 'greeting';
    } else if (ev.type === 'workshopExit') {
      pool = def.goodbye;
      kind = 'greeting';
    } else if (ev.type === 'workshopPurchase' && ev.price > 0) {
      pool = def.installed;
      kind = 'soon';
    } else if (ev.type === 'workshopDenied') {
      if (ev.reason === 'funds') pool = def.broke;
      else if (ev.reason === 'police' || ev.reason === 'locked') pool = def.doorShut;
      else continue;
      kind = 'soon';
    }
  }
  if (pool) say(s, pickLine(s, pool), kind, events);
}

/** One tick. `s.locked` is the orchestrator's and is written before this runs. */
export function stepGarage(
  s: GarageState,
  site: ActivitySite,
  v: VehicleState,
  cmd: PlayerCommand,
  dt: number,
  events: GameEvent[],
  def: GarageDef = LOCO_MUSTANG,
  rules: GarageRules = LEGACY_RULES,
): void {
  const was = s.atSite;
  const dx = v.x - site.x;
  const dz = v.z - site.z;
  const limit = was ? GARAGE.marker.exitRadius : GARAGE.marker.promptRadius;
  s.atSite = dx * dx + dz * dz <= limit * limit;
  if (s.atSite !== was) events.push({ type: 'garagePrompt', on: s.atSite });

  if (!s.atSite) {
    s.greeted = false;
  } else if (!s.greeted && !s.locked) {
    s.greeted = true;
    say(s, pickLine(s, rules.workshop ? def.openGreetings : def.greetings), 'greeting', events);
  }

  // With the workshop wired, the key is the door's (`garageWantsWorkshop`), not his.
  if (!rules.workshop && cmd.activate && garageOpenToTalk(s)) say(s, pickLine(s, def.soon), 'soon', events);

  if (s.lineTimeLeft > 0) {
    s.lineTimeLeft -= dt;
    if (s.lineTimeLeft <= 0) {
      s.lineTimeLeft = 0;
      s.line = '';
    }
  }
}
