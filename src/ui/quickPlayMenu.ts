import { MAX_PLAYERS, type RoomGame } from '../net/protocol';
import { fetchRooms } from '../net/connection';
import { RUSH, STREET_RACE } from '../config/tuning';
import { readRushProgress, readStreetRaceProgress, readTimeAttackProgress } from '../core/progress';
import { rushAllClear, rushLevelCount, rushLevelIndex, rushTargetScore } from '../sim/rush';
import { streetEventCount, streetNewestEvent } from '../sim/streetGate';
import { timeAttackAllClear, timeAttackLevel, timeAttackLevelCount, timeAttackLevelIndex } from '../sim/timeAttack';
import { createMenuScreen, type MenuScreen, type MenuScreenEntry } from './menuScreen';

/**
 * QUICK PLAY: the open world's three activities, straight off the menu, without driving across
 * the city to their doors. Two screens, both built on `menuScreen.ts`:
 *
 *   QUICK PLAY   `?quick=1`                RAYO RUSH · STREET RACE · TIME ATTACK
 *   <GAME>       `?quick=rush|street|circuit`   OFFLINE or ONLINE
 *
 * THE SAME GAMES AS THE STREET. Nothing here is a second version of anything: OFFLINE builds the
 * world the open world's door would have loaded (`?mode=rush`, `?mode=street&event=N`,
 * `?mode=circuit`) and plays the same mission chain against the same progress, so a mission
 * cleared from this menu is cleared in the city too, and the other way round.
 *
 * ONLINE is a room (`?mp=1&game=...`): the room browser, then the lobby, then everybody on the
 * same course — or, for RAYO RUSH, in the same corner of the city with the same clock, where
 * the highest score takes it. Which game a room plays is fixed by whoever opens it
 * (`RoomGame` in `src/net/protocol.ts`).
 *
 * The room count is polled while either screen is up, per game: how many rooms are open is
 * worth knowing before picking ONLINE, not after.
 */
export interface QuickPlayMenu {
  dispose(): void;
}

/** What the second screen hands back: the game alone, or the road into a room. */
export type QuickPlayChoice = 'offline' | 'online';

/** How often the open-room count is re-read while a screen is up. */
const POLL_MS = 5000;
/** The dossier row that carries the room count. */
const ROOMS_LABEL = 'ROOMS';

/** `160` -> `2:40`. A target time the way a pit board would write it. */
function lapTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The street circuit every event of the series runs on, as the dossier writes it. */
const CURVA_LINE = 'LA CURVA · 3.8 KM · 01 LAP';
const GRID_LINE = 'BANDIDO GRID · 1.5 KM · 02 LAPS';

/**
 * What this browser is up to in each chain, read from the same storage the worlds read on boot
 * (`src/core/progress.ts`) and named through the same helpers the rules use, so a card cannot
 * promise a mission the world is not about to run. Read once per screen: nothing can clear a
 * mission while a menu is the thing on screen.
 */
function missionLines(): Record<RoomGame, { mission: string; target: string }> {
  const rush = readRushProgress();
  const rushLevel = rushLevelIndex(rush.cleared);
  const ta = readTimeAttackProgress();
  const taSpec = timeAttackLevel(ta.cleared);
  const street = readStreetRaceProgress();
  const event = STREET_RACE.events[streetNewestEvent(street.cleared)];
  return {
    rush: {
      mission: rushAllClear(rush.cleared)
        ? `ALL ${rushLevelCount()} CLEAR`
        : `${rushLevel + 1}/${rushLevelCount()}`,
      target: `${rushTargetScore(rush.cleared).toLocaleString('en-US')} PTS IN ${RUSH.durationSeconds} S`,
    },
    street: {
      mission:
        street.cleared >= streetEventCount()
          ? `ALL ${streetEventCount()} WON · ${event.name}`
          : `${event.name} · ${event.difficulty}`,
      target: `WIN AGAINST ${event.rivals} RIVAL${event.rivals === 1 ? '' : 'S'}`,
    },
    circuit: {
      mission: timeAttackAllClear(ta.cleared)
        ? `ALL ${timeAttackLevelCount()} CLEAR · ${taSpec.name}`
        : `${timeAttackLevelIndex(ta.cleared) + 1}/${timeAttackLevelCount()} · ${taSpec.name}`,
      target: `${lapTime(taSpec.seconds)} · ${taSpec.crashes === 0 ? 'NO CONTACT' : `${taSpec.crashes} CRASH${taSpec.crashes === 1 ? '' : 'ES'} MAX`}`,
    },
  };
}

/** The player-facing name of each game. */
export const GAME_NAMES: Record<RoomGame, string> = {
  rush: 'RAYO RUSH',
  street: 'STREET RACE',
  circuit: 'TIME ATTACK',
};

/** How many rooms are up for each game, as a dossier row says it. One request for all three. */
async function roomsLines(): Promise<Record<RoomGame, string>> {
  const line = (count: number): string => (count === 0 ? 'NONE OPEN · HOST ONE' : `${pad2(count)} OPEN`);
  try {
    const rooms = (await fetchRooms()).filter((room) => room.mode !== 'world');
    const count = (game: RoomGame): number => rooms.filter((room) => room.game === game).length;
    return { rush: line(count('rush')), street: line(count('street')), circuit: line(count('circuit')) };
  } catch {
    return { rush: 'NO SERVER', street: 'NO SERVER', circuit: 'NO SERVER' };
  }
}

export interface QuickPlayCallbacks<T> {
  onSelect(choice: T): void;
  /** ESC: one screen back. */
  onBack(): void;
}

/* ================================================================== screen one: the games */

export function showQuickPlayMenu(root: HTMLElement, callbacks: QuickPlayCallbacks<RoomGame>): QuickPlayMenu {
  const lines = missionLines();
  const entries: Array<MenuScreenEntry<RoomGame>> = [
    {
      id: 'rush',
      kicker: 'SCORE ATTACK',
      name: GAME_NAMES.rush,
      desc: `${RUSH.durationSeconds} seconds loose in Bandido Metro. Drift to charge the Rayo, bolt the electric cars and keep the streak alive. Alone it is the mission chain; online everybody starts at GO and the biggest score takes it.`,
      spec: [
        ['MISSION', lines.rush.mission],
        ['TARGET', lines.rush.target],
        ['ZONE', 'BANDIDO METRO'],
        [ROOMS_LABEL, 'CHECKING'],
      ],
    },
    {
      id: 'street',
      kicker: 'LA CURVA',
      name: GAME_NAMES.street,
      desc: `La Curva: up the highway over the car meet, across The Stack's deck and back down. Alone it is the series against the AI rivals; online it is you and up to ${MAX_PLAYERS - 1} friends on the same grid.`,
      spec: [
        ['EVENT', lines.street.mission],
        ['CIRCUIT', CURVA_LINE],
        ['OFFLINE', lines.street.target],
        [ROOMS_LABEL, 'CHECKING'],
      ],
    },
    {
      id: 'circuit',
      kicker: 'BANDIDO GRID',
      name: GAME_NAMES.circuit,
      desc: `Two laps of the Bandido Grid against a target time and a crash allowance, three missions deep. Online it is the same two laps with up to ${MAX_PLAYERS} cars in them, and the flag decides.`,
      spec: [
        ['MISSION', lines.circuit.mission],
        ['TARGET', lines.circuit.target],
        ['CIRCUIT', GRID_LINE],
        [ROOMS_LABEL, 'CHECKING'],
      ],
    },
  ];

  let done = false;
  const screen: MenuScreen<RoomGame> = createMenuScreen<RoomGame>(root, {
    screen: 'QUICK PLAY',
    sub: 'QUICK PLAY · PICK YOUR POISON',
    hint: '<b>←</b> <b>→</b> select · <b>ENTER</b> execute · <b>ESC</b> back to the menu',
    entries,
    onSelect(choice) {
      done = true;
      callbacks.onSelect(choice);
    },
    onBack() {
      done = true;
      callbacks.onBack();
    },
  });

  async function poll(): Promise<void> {
    const lines = await roomsLines();
    if (done) return;
    for (const game of ['rush', 'street', 'circuit'] as const) screen.setSpec(game, ROOMS_LABEL, lines[game]);
  }
  void poll();
  const timer = window.setInterval(() => void poll(), POLL_MS);

  return {
    dispose() {
      done = true;
      window.clearInterval(timer);
      screen.dispose();
    },
  };
}

/* ================================================================== screen two: alone or not */

export function showQuickPlayModeMenu(
  root: HTMLElement,
  game: RoomGame,
  callbacks: QuickPlayCallbacks<QuickPlayChoice>,
): QuickPlayMenu {
  const lines = missionLines()[game];
  const name = GAME_NAMES[game];

  const offline: MenuScreenEntry<QuickPlayChoice> =
    game === 'rush'
      ? {
          id: 'offline',
          kicker: 'SOLO · MISSION CHAIN',
          name: 'OFFLINE',
          desc: `Dropped on the marker with the count-in already running: ${RUSH.durationSeconds} seconds, every electric car in reach, and the mission target to beat. R runs it again from the marker.`,
          spec: [
            ['MISSION', lines.mission],
            ['TARGET', lines.target],
            ['BOARD', 'RANKED RUNS COUNT'],
          ],
        }
      : game === 'street'
        ? {
            id: 'offline',
            kicker: 'SOLO · VS AI RIVALS',
            name: 'OFFLINE',
            desc: 'The newest event of the series you have reached, against its AI field. Win it and the next, harder field is waiting on the same grid.',
            spec: [
              ['EVENT', lines.mission],
              ['GOAL', lines.target],
              ['CIRCUIT', CURVA_LINE],
            ],
          }
        : {
            id: 'offline',
            kicker: 'SOLO · MISSION CHAIN',
            name: 'OFFLINE',
            desc: 'The Bandido Grid on your own. Two laps of the city against a target time AND a crash allowance: get round it, then carry speed, then do it without touching a thing.',
            spec: [
              ['MISSION', lines.mission],
              ['TARGET', lines.target],
              ['CIRCUIT', GRID_LINE],
            ],
          };

  const online: MenuScreenEntry<QuickPlayChoice> = {
    id: 'online',
    kicker: 'ROOM · PLAY WITH FRIENDS',
    name: 'ONLINE',
    desc:
      game === 'rush'
        ? `A room for up to ${MAX_PLAYERS}. Everybody is dropped at the same marker, the run starts at the same GO, and when the clock runs out the biggest score wins. Open one and send the link, or join with a code.`
        : `A room for up to ${MAX_PLAYERS}. Open one and send your friends the link or the code, or join a room that is already up. Same grid, same lights, nowhere to run.`,
    spec: [
      ['GRID', `UP TO ${pad2(MAX_PLAYERS)} CARS`],
      [game === 'rush' ? 'WINNER' : 'CIRCUIT', game === 'rush' ? 'HIGHEST SCORE' : game === 'street' ? CURVA_LINE : GRID_LINE],
      ['ENTRY', 'ROOM CODE OR LINK'],
      [ROOMS_LABEL, 'CHECKING'],
    ],
  };

  let done = false;
  const screen: MenuScreen<QuickPlayChoice> = createMenuScreen<QuickPlayChoice>(root, {
    screen: name,
    sub: `QUICK PLAY · ${name} · ALONE OR WITH FRIENDS`,
    hint: '<b>←</b> <b>→</b> select · <b>ENTER</b> execute · <b>ESC</b> back to quick play',
    entries: [offline, online],
    onSelect(choice) {
      done = true;
      callbacks.onSelect(choice);
    },
    onBack() {
      done = true;
      callbacks.onBack();
    },
  });

  async function poll(): Promise<void> {
    const lines = await roomsLines();
    if (done) return;
    screen.setSpec('online', ROOMS_LABEL, lines[game]);
  }
  void poll();
  const timer = window.setInterval(() => void poll(), POLL_MS);

  return {
    dispose() {
      done = true;
      window.clearInterval(timer);
      screen.dispose();
    },
  };
}
