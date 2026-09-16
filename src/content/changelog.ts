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
    date: '2026-09-16',
    items: [
      'Micro-scenes: small moments happening around the city as you drive past — two or three people, one conversation.',
      'Crash penalties and near misses now count toward Rayo Rush scores.',
      'Race barriers are tall holographic chevron walls now, and only close the streets that lead off the course.',
      'The main menu now sits over a live 3D view of La Curva and the car meet, not a flat backdrop.',
      'Rayo Rush now shows a live ladder against other players\' best scores while you run.',
    ],
  },
  {
    date: '2026-09-15',
    items: [
      'Wet roads now really mirror the city\'s neon, signs and lit windows, not just a generic sheen.',
      'BadKala now speaks her intro lines out loud, not just in subtitles.',
      'Hovercars and drones now drift through the sky over the avenues and pavements.',
      'El Búho, Loco Mustang and Trapito now speak too, not just BadKala.',
      'More trapitos working the ring, the market and the quay.',
      'Police chatter over the radio during a chase: your shots, your drifts and your crashes get called in.',
      'Trapitos now work street corners all over the city, not just the landmarks.',
      'Traffic drivers and people at bus stops now yell at you as you drive by — close calls, drifts and crashes.',
      'Bus stops are no longer empty: two to four people wait under every shelter.',
    ],
  },
  {
    date: '2026-09-14',
    items: [
      'Gas stations on street corners around the city: a canopy, pumps, a lit shop and a price sign, in four brands.',
      'Street clutter downtown you can crash through: bags, boxes, cones, chairs, tables, bins and barriers.',
      'Sidewalk EV chargers can be smashed off their post — they spark and short out.',
      'Steaming sewer grates along downtown curbs.',
      'The destination arrow now points straight at where you are going, instead of swinging at the last turn.',
      'The introduction now walks you through the drift and the lightning shot with an on-screen step card.',
      'More traffic on the streets, the ring and the viaduct.',
      'Crashing now costs you: fines and a wrecked-up body in the open world, a stall on the clock in a race.',
      'Street Race I/II/III now all run La Curva\'s circuit at the car meet: one lap, tougher rivals each round.',
      'Loco Mustang\'s garage is up across from the car meet — tuning and mods coming soon.',
      'Sign in with Google or Discord from the main menu: your money and progress now follow your account, not this browser.',
      'Live top-10 leaderboards now stand as hologram boards by Rayo Rush, Time Attack and Street Race.',
      'Trapitos wave you into a space near the garage, car meet, gas stations and chargers, and size up your car.',
      'Windshield washers work certain red lights: pay to get your glass cleaned, or wave them off.',
      'Oncoming cars lean on the horn when you\'re barreling straight at them.',
      'Rain now hits the car with its own sound, harder the faster you drive into it.',
      'Nitro boosts and the Rayo\'s charge and release now have their own recorded sounds.',
      'A close, fast pass by any car, bus, pillar or post now gets a wind-gust whoosh of its own.',
      'QUICK PLAY on the main menu jumps straight into Rayo Rush, Street Race or Time Attack, no drive to the door.',
      'Shooting a car mid-Rayo-Rush now pays a small bounty, with no police to answer for it.',
      'Passenger fares now cross much more of the city; the max tip is down from ¥300 to ¥100.',
      'A car hit by the Rayo now gets thrown clear, harder the fuller the charge, and slides to a stop.',
      'Land a shot mid-drift and hear "DONDE PONE EL OJO, PONE LA BALA."',
      'A downed electric car now powers off with a proper recorded sound instead of a synthesized one.',
      'The Rayo\'s charge-up now starts right on the press, instead of a beat late.',
    ],
  },
  {
    date: '2026-09-13',
    items: [
      'OPEN WORLD is now Bandido Metro: The Stack rebuilt as downtown, with the Bay\'s streets and water around it.',
      'A car meet under the viaduct\'s north-west corner: sixteen tuned cars, a crowd, a kiosk and masts to drive through.',
      'The introduction now starts in The Stack\'s downtown and ends at the car meet.',
      'The meet\'s crowd is alive: chatting, filming, vibing to the music, warming hands by the fire, reacting as you drive by.',
      'Downtown lights up: LED boards, blade signs, tickers and holograms across The Stack.',
      'BADKALA WANTED now shows up on some of downtown\'s big boards and blades, not just bus shelters.',
      'Bandido Grid still runs through Bandido Bay for now.',
    ],
  },
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
