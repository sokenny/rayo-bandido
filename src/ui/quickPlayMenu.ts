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
const ROOMS_LABEL = 'SALAS';

/** `160` -> `2:40`. A target time the way a pit board would write it. */
function lapTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The street circuit every event of the series runs on, as the dossier writes it. */
const CURVA_LINE = 'LA CURVA · 3.8 KM · 01 VUELTA';
const GRID_LINE = 'BANDIDO GRID · 1.5 KM · 02 VUELTAS';

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
        ? `LAS ${rushLevelCount()} COMPLETAS`
        : `${rushLevel + 1}/${rushLevelCount()}`,
      target: `${rushTargetScore(rush.cleared).toLocaleString('en-US')} PTS EN ${RUSH.durationSeconds} S`,
    },
    street: {
      mission:
        street.cleared >= streetEventCount()
          ? `LAS ${streetEventCount()} GANADAS · ${event.name}`
          : `${event.name} · ${event.difficulty}`,
      target: `GANALE A ${event.rivals} RIVAL${event.rivals === 1 ? '' : 'ES'}`,
    },
    circuit: {
      mission: timeAttackAllClear(ta.cleared)
        ? `LAS ${timeAttackLevelCount()} COMPLETAS · ${taSpec.name}`
        : `${timeAttackLevelIndex(ta.cleared) + 1}/${timeAttackLevelCount()} · ${taSpec.name}`,
      target: `${lapTime(taSpec.seconds)} · ${taSpec.crashes === 0 ? 'SIN CONTACTO' : `MÁX. ${taSpec.crashes} CHOQUE${taSpec.crashes === 1 ? '' : 'S'}`}`,
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
  const line = (count: number): string => (count === 0 ? 'NINGUNA ABIERTA · ABRÍ UNA' : `${pad2(count)} ABIERTA${count === 1 ? '' : 'S'}`);
  try {
    const rooms = (await fetchRooms()).filter((room) => room.mode !== 'world');
    const count = (game: RoomGame): number => rooms.filter((room) => room.game === game).length;
    return { rush: line(count('rush')), street: line(count('street')), circuit: line(count('circuit')) };
  } catch {
    return { rush: 'SIN SERVIDOR', street: 'SIN SERVIDOR', circuit: 'SIN SERVIDOR' };
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
      kicker: 'A PUNTOS',
      name: GAME_NAMES.rush,
      desc: `${RUSH.durationSeconds} segundos sueltos en Bandido Metro. Derrapá para cargar el Rayo y apagá autos eléctricos: cada uno suma puntos, más si disparás en plena derrapada. Chocar o errar te los resta.`,
      spec: [
        ['MISIÓN', lines.rush.mission],
        ['OBJETIVO', lines.rush.target],
        ['ZONA', 'BANDIDO METRO'],
        [ROOMS_LABEL, 'BUSCANDO'],
      ],
    },
    {
      id: 'street',
      kicker: 'LA CURVA',
      name: GAME_NAMES.street,
      desc: `La Curva: subí a la autopista sobre el car meet, cruzá el deck de The Stack y volvé a bajar. Solo, es la serie contra los rivales de la IA; online, sos vos y hasta ${MAX_PLAYERS - 1} amigos en la misma grilla.`,
      spec: [
        ['EVENTO', lines.street.mission],
        ['CIRCUITO', CURVA_LINE],
        ['SOLO', lines.street.target],
        [ROOMS_LABEL, 'BUSCANDO'],
      ],
    },
    {
      id: 'circuit',
      kicker: 'BANDIDO GRID',
      name: GAME_NAMES.circuit,
      desc: `Dos vueltas al Bandido Grid contra un tiempo objetivo y un límite de choques, en tres misiones. Online son las mismas dos vueltas con hasta ${MAX_PLAYERS} autos, y decide la bandera.`,
      spec: [
        ['MISIÓN', lines.circuit.mission],
        ['OBJETIVO', lines.circuit.target],
        ['CIRCUITO', GRID_LINE],
        [ROOMS_LABEL, 'BUSCANDO'],
      ],
    },
  ];

  let done = false;
  const screen: MenuScreen<RoomGame> = createMenuScreen<RoomGame>(root, {
    screen: 'QUICK PLAY',
    sub: 'QUICK PLAY · ELEGÍ TU VENENO',
    hint: '<b>←</b> <b>→</b> elegir · <b>ENTER</b> aceptar · <b>ESC</b> volver al menú',
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
          kicker: 'SOLO · CADENA DE MISIONES',
          name: 'SOLO',
          desc: `Aparecés en el marcador con la cuenta regresiva ya en marcha: ${RUSH.durationSeconds} segundos, todos los eléctricos a tiro y el objetivo de la misión para superar. Con R la corrés de nuevo desde el marcador.`,
          spec: [
            ['MISIÓN', lines.mission],
            ['OBJETIVO', lines.target],
            ['RANKING', 'TODA CORRIDA CUENTA'],
          ],
        }
      : game === 'street'
        ? {
            id: 'offline',
            kicker: 'SOLO · VS RIVALES IA',
            name: 'SOLO',
            desc: 'El último evento de la serie al que llegaste, contra sus rivales de la IA. Ganalo y en la misma grilla te espera el siguiente, más difícil.',
            spec: [
              ['EVENTO', lines.mission],
              ['META', lines.target],
              ['CIRCUITO', CURVA_LINE],
            ],
          }
        : {
            id: 'offline',
            kicker: 'SOLO · CADENA DE MISIONES',
            name: 'SOLO',
            desc: 'El Bandido Grid para vos solo. Dos vueltas a la ciudad contra un tiempo objetivo Y un límite de choques: primero completala, después llevá velocidad, y al final hacelo sin tocar nada.',
            spec: [
              ['MISIÓN', lines.mission],
              ['OBJETIVO', lines.target],
              ['CIRCUITO', GRID_LINE],
            ],
          };

  const online: MenuScreenEntry<QuickPlayChoice> = {
    id: 'online',
    kicker: 'SALA · JUGÁ CON AMIGOS',
    name: 'CON AMIGOS',
    desc:
      game === 'rush'
        ? `Una sala para hasta ${MAX_PLAYERS}. Todos aparecen en el mismo marcador, la corrida arranca en el mismo GO y cuando se acaba el reloj gana el puntaje más alto. Abrí una y mandá el link, o entrá con un código.`
        : `Una sala para hasta ${MAX_PLAYERS}. Abrí una y pasales a tus amigos el link o el código, o sumate a una que ya esté abierta. Misma grilla, mismas luces, sin dónde esconderse.`,
    spec: [
      ['GRILLA', `HASTA ${pad2(MAX_PLAYERS)} AUTOS`],
      [game === 'rush' ? 'GANADOR' : 'CIRCUITO', game === 'rush' ? 'MAYOR PUNTAJE' : game === 'street' ? CURVA_LINE : GRID_LINE],
      ['ENTRADA', 'CÓDIGO O LINK'],
      [ROOMS_LABEL, 'BUSCANDO'],
    ],
  };

  let done = false;
  const screen: MenuScreen<QuickPlayChoice> = createMenuScreen<QuickPlayChoice>(root, {
    screen: name,
    sub: `QUICK PLAY · ${name} · SOLO O CON AMIGOS`,
    hint: '<b>←</b> <b>→</b> elegir · <b>ENTER</b> aceptar · <b>ESC</b> volver a quick play',
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
