/**
 * What shipped, and when. The CHANGELOG tab on the main menu reads this file and nothing else.
 *
 * IT IS WRITTEN BY HAND, AND EVERY DEPLOY WRITES IT. The deploy script refuses to ship a tree
 * with unrecorded changes in it (`.claude/skills/deploy/scripts/deploy.sh`, step 1), so the
 * live game and this list cannot drift apart the way a changelog kept "when we remember to"
 * always does. It is generated from nothing: not from commit subjects, not from branch names.
 * Those describe how the work was done, and this is read by somebody who only wants to know
 * what is different when they get in the car.
 *
 * So: one line per change, in the player's terms, and only the changes a player can find.
 * "Police: heat, stars and short chases out in the city" — not the module that judges them,
 * not the tuning table, not the test that holds it honest. A refactor that changes nothing on
 * screen does not belong here at all; a day with only that in it simply gets no entry.
 *
 * ONE ENTRY PER DAY, newest first. Two deploys on one day add their lines to the same date
 * rather than opening a second block of it — a player reading the tab wants the day's news,
 * not this project's deploy count. `tests/changelog.test.ts` holds the shape.
 */
export interface ChangelogEntry {
  /** The day it went live, `YYYY-MM-DD`. Unique across the list. */
  date: string;
  /** One terse, player-facing line per change. */
  items: string[];
}

/** Newest first. The tab shows them in this order. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-09-11',
    items: [
      'The introduction: a first drive through the city with BadKala on the phone, ending in Free Roam.',
      'Replay the introduction any time with I on the main menu.',
      'The city talks back: PURA SEDA, AURA +1000 and the rest, when the driving earns it.',
      'Downtown is built up: six megablocks in the north, with passages you drive straight through.',
      'The new downtown draws in a quarter of the passes it used to, so the north runs smoother.',
      'R now puts you back on a nearby road at the height you were at, not down at the spawn.',
      'This tab: every change, by the day it went live.',
    ],
  },
  {
    date: '2026-09-10',
    items: [
      'Street Race: three events against AI rivals, on a street circuit through the city.',
      'Police: heat, stars and short chases while you free roam. Get caught and it costs you.',
      'Time Attack: three circuit missions, each asking for a faster lap and fewer crashes.',
      'One thing at a time: the rest of the city gets out of the way while you are on a run.',
    ],
  },
  {
    date: '2026-09-08',
    items: [
      'El Búho: a timed encounter under the viaduct, and a trip to the Moogul.',
      'Rayo Rush: a three-mission chain out in the open world.',
      'Passengers: pick a fare up at the kerb and run them across town for cash.',
      'Race and Versus are one RACE tab now: pick the company after you pick the track.',
    ],
  },
  {
    date: '2026-09-07',
    items: [
      'The Circuit: a neon-lined track, and a new paint kit for the car.',
      'Rush scoring and a leaderboard shared with everyone else driving.',
      'Traffic gets out of your way. Lock-on, lightning and kerbs all tuned.',
    ],
  },
  {
    date: '2026-09-06',
    items: [
      'Open World: Bandido Bay, with viaducts, ramps, the skyway and the water.',
      'A city that looks lived in: varied buildings, buses, lit windows and night haze.',
    ],
  },
  {
    date: '2026-09-05',
    items: [
      'Manual gearbox and counter-steering.',
      'Touch controls on a phone, and the game installs as an app.',
    ],
  },
];
