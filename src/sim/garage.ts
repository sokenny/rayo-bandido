import type { ActivitySite, GameEvent, GarageLineKind, GarageState, PlayerCommand, VehicleState } from '../core/types';
import { GARAGE } from '../world/garage';
import { LOCO_MUSTANG, type GarageDef } from '../content/garage';
import { lineSeconds } from './passenger';

/**
 * LOCO MUSTANG'S GARAGE: not open yet, and he tells you so.
 *
 * A ring on the apron in front of the garage mouth. Roll onto it and he says hello — the garage
 * is not open, soon it will be where the car gets tuned and modded — and the sign over the ring
 * says the same in the HUD's caps. The key gets another line out of him. That is all: nothing
 * here is bought, moves the car, or holds it.
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

/** One tick. `s.locked` is the orchestrator's and is written before this runs. */
export function stepGarage(
  s: GarageState,
  site: ActivitySite,
  v: VehicleState,
  cmd: PlayerCommand,
  dt: number,
  events: GameEvent[],
  def: GarageDef = LOCO_MUSTANG,
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
    say(s, pickLine(s, def.greetings), 'greeting', events);
  }

  if (cmd.activate && garageOpenToTalk(s)) say(s, pickLine(s, def.soon), 'soon', events);

  if (s.lineTimeLeft > 0) {
    s.lineTimeLeft -= dt;
    if (s.lineTimeLeft <= 0) {
      s.lineTimeLeft = 0;
      s.line = '';
    }
  }
}
