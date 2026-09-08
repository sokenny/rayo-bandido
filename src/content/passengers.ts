import type { PassengerPreferenceKind, PassengerReaction, PassengerStop } from '../core/types';
import { PASSENGER } from '../config/tuning';

/**
 * THE PASSENGER CATALOGUE: who can be picked up, and everything they will say.
 *
 * DATA, NOT LOGIC. The rules (`src/sim/passenger.ts`) know six preference kinds and eight
 * things a passenger can react to, and that is all they know. A character is a bundle of those
 * plus text: adding one means adding an entry here, never touching the rules. Every line a ride
 * can need is authored in advance and chosen before the ride starts — there is no generation at
 * runtime, and the game never waits on anything to say the next thing.
 *
 * IDENTITY VERSUS RIDE. `PassengerDef` is the character: the same person, the same rules, the
 * same voice every time they get in. Where they are picked up and taken, which opening variant
 * plays and how the ride goes are per-ride facts (`PassengerTrip`, `PassengerState`) that leave
 * this file alone. A destination named in a line is written as `{destination}` and resolved
 * from the trip actually chosen, so nobody asks to be taken somewhere they are not going.
 *
 * WHAT A CHARACTER MAY ASK FOR. Two preferences at most, never a contradictory pair, and never
 * anything but the six kinds below — "neutralise an EV" always means the Rayo and never the
 * bumper. `validatePassengerCatalog` enforces every one of those at test time, together with
 * the lines each preference obliges the character to have, so a fourth passenger that forgets
 * their collision line fails a test rather than a ride.
 *
 * VOICE. Subtitles: one or two short sentences, sentence case, read at a glance while driving.
 * The player never answers — nothing here is a question that waits for one.
 */

export interface PassengerPreference {
  kind: PassengerPreferenceKind;
  /** Scales how much this rule moves the mood. 1 is as tuned. */
  weight: number;
  /** For `slow`: the limit. For `fast`: the threshold. km/h. */
  kmh?: number;
}

export interface PassengerFarewells {
  high: readonly string[];
  medium: readonly string[];
  low: readonly string[];
}

export interface PassengerDef {
  /** Stable id: the catalogue's key, and what a ride record names. Never reused. */
  id: string;
  name: string;
  /** Under the name in the HUD ("DEADAIR · UNDERGROUND STREAMER"). */
  tagline: string;
  /** For authors: who this person is. Not shown. */
  personality: string;
  background: string;
  /** Which portrait to draw (`src/ui/portraits.ts`). */
  portrait: string;
  /** For authors: why they need a ride. Not shown; the opening says it in their own words. */
  reason: string;
  /** Stops they may be picked up at / taken to: any stop carrying any of these tags. */
  pickupTags: readonly string[];
  destinationTags: readonly string[];
  /** One or two. See `validatePassengerCatalog` for what may be combined. */
  preferences: readonly PassengerPreference[];
  /** Said on boarding. At least two; one is chosen at the offer. */
  openings: readonly string[];
  /** Said right after the opening: where to, and how. `{destination}` is the stop's label. */
  brief: string;
  /** Incidental lines, by the thing that happened. Each preference obliges some of these. */
  reactions: Partial<Record<PassengerReaction, readonly string[]>>;
  /** Said as the car first reaches the destination zone. */
  arrival: string;
  farewell: PassengerFarewells;
}

/** Longest a subtitle may be. Two short sentences; anything more is a paragraph, not a line. */
export const MAX_LINE_CHARS = 150;

/** The pairs that cannot both be asked for. Checked in both orders. */
const CONTRADICTIONS: ReadonlyArray<readonly [PassengerPreferenceKind, PassengerPreferenceKind]> = [
  ['slow', 'fast'],
  ['noDrift', 'drift'],
  ['noRayo', 'rayo'],
];

/** What each preference obliges a character to be able to say. `collision` is owed by everyone. */
const OBLIGED_REACTIONS: Record<PassengerPreferenceKind, readonly PassengerReaction[]> = {
  slow: ['tooFast', 'goodSpeed'],
  fast: ['goodSpeed', 'tooSlow'],
  noDrift: ['driftBad'],
  drift: ['driftGood'],
  noRayo: ['rayoBad'],
  rayo: ['rayoGood'],
};

const KINDS: readonly PassengerPreferenceKind[] = ['slow', 'fast', 'noDrift', 'drift', 'noRayo', 'rayo'];

/**
 * The compact HUD summary of one rule, in the chrome's shouting case. What the player is held
 * to is never only in the flavour text: this is printed next to the portrait for the whole ride.
 */
export function preferenceLabel(pref: PassengerPreference): string {
  switch (pref.kind) {
    case 'slow':
      return `STAY UNDER ${Math.round(pref.kmh ?? 0)} KM/H`;
    case 'fast':
      return `DRIVE FAST · ${Math.round(pref.kmh ?? PASSENGER.speed.fastKmh)}+ KM/H`;
    case 'noDrift':
      return 'NO DRIFTING';
    case 'drift':
      return 'SHOW ME DRIFTS';
    case 'noRayo':
      return 'NO RAYO ON EVs';
    case 'rayo':
      return 'RAYO THE EVs';
    default:
      return '';
  }
}

/** `{destination}` in a line becomes the label of the stop the trip actually goes to. */
export function resolveLine(text: string, destination: string): string {
  return text.replace(/\{destination\}/g, destination);
}

/**
 * Everything that must hold for the catalogue to be playable, as a list of complaints. Empty
 * means fine. Run at test time (`tests/passenger.test.ts`), so a bad entry fails a test rather
 * than a ride. `stops` is optional: without it the location checks are skipped.
 */
export function validatePassengerCatalog(catalog: readonly PassengerDef[], stops?: readonly PassengerStop[] | null): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const check = (ok: boolean, message: string): void => {
    if (!ok) problems.push(message);
  };
  const lineOk = (text: string, where: string): void => {
    check(text.trim().length > 0, `${where}: empty line`);
    check(text.length <= MAX_LINE_CHARS, `${where}: line over ${MAX_LINE_CHARS} chars`);
  };

  for (const p of catalog) {
    const who = p.id || '(no id)';
    check(!!p.id, `passenger with no id`);
    check(!ids.has(p.id), `${who}: duplicate id`);
    ids.add(p.id);
    check(!!p.name, `${who}: no name`);
    check(!!p.portrait, `${who}: no portrait`);

    /* ---------------------------------------------------------- preferences */

    check(p.preferences.length >= 1 && p.preferences.length <= 2, `${who}: needs one or two preferences`);
    const kinds = p.preferences.map((pref) => pref.kind);
    for (const pref of p.preferences) {
      check(KINDS.includes(pref.kind), `${who}: unknown preference "${pref.kind}"`);
      check(pref.weight > 0, `${who}: preference "${pref.kind}" needs a positive weight`);
      if (pref.kind === 'slow') check((pref.kmh ?? 0) > 0, `${who}: a "slow" preference needs a km/h limit`);
    }
    check(new Set(kinds).size === kinds.length, `${who}: the same preference twice`);
    for (const [a, b] of CONTRADICTIONS) {
      check(!(kinds.includes(a) && kinds.includes(b)), `${who}: asks for both "${a}" and "${b}"`);
    }

    /* ---------------------------------------------------------- lines */

    check(p.openings.length >= 2, `${who}: needs at least two openings`);
    p.openings.forEach((text, i) => lineOk(text, `${who}: opening ${i}`));
    lineOk(p.brief, `${who}: brief`);
    lineOk(p.arrival, `${who}: arrival`);
    for (const tier of ['high', 'medium', 'low'] as const) {
      check(p.farewell[tier].length >= 1, `${who}: needs a ${tier} farewell`);
      p.farewell[tier].forEach((text, i) => lineOk(text, `${who}: ${tier} farewell ${i}`));
    }
    const owed = new Set<PassengerReaction>(['collision']);
    for (const kind of kinds) for (const r of OBLIGED_REACTIONS[kind] ?? []) owed.add(r);
    for (const r of owed) {
      const lines = p.reactions[r];
      check(!!lines && lines.length >= 1, `${who}: preference set obliges a "${r}" reaction`);
    }
    for (const [r, lines] of Object.entries(p.reactions)) {
      (lines ?? []).forEach((text, i) => lineOk(text, `${who}: reaction ${r} ${i}`));
    }

    /* ---------------------------------------------------------- places */

    check(p.pickupTags.length >= 1, `${who}: no pickup tags`);
    check(p.destinationTags.length >= 1, `${who}: no destination tags`);
    if (stops && stops.length > 0) {
      const has = (tag: string): boolean => stops.some((s) => s.tags.includes(tag));
      for (const tag of p.pickupTags) check(has(tag), `${who}: no stop carries pickup tag "${tag}"`);
      for (const tag of p.destinationTags) check(has(tag), `${who}: no stop carries destination tag "${tag}"`);
      // At least one trip of a sensible length has to exist, or the pin would go up for a
      // ride the planner cannot make.
      let trips = 0;
      for (const a of stops) {
        if (!a.tags.some((t) => p.pickupTags.includes(t))) continue;
        for (const b of stops) {
          if (b === a || !b.tags.some((t) => p.destinationTags.includes(t))) continue;
          const d = Math.hypot(b.x - a.x, b.z - a.z);
          if (d >= PASSENGER.offer.minTrip && d <= PASSENGER.offer.maxTrip) trips++;
        }
      }
      check(trips > 0, `${who}: no pickup/destination pair between ${PASSENGER.offer.minTrip} and ${PASSENGER.offer.maxTrip} m apart`);
    }
  }
  return problems;
}

/* ================================================================== the catalogue */

/**
 * Three to start with. Each asks for two things that can be read off the HUD, and none of them
 * asks for a crash: Mika wants speed and slides but flinches at a hit, Vera wants the opposite,
 * Nico wants clean Rayo shots and a steady car. Add a fourth by adding an entry.
 */
export const PASSENGERS: readonly PassengerDef[] = [
  {
    id: 'mika',
    name: 'Mika',
    tagline: 'DEADAIR · UNDERGROUND STREAMER',
    personality: 'Playful, sarcastic, thrill-seeking. The ride is content; the chat is watching.',
    background: 'Streams from the back seats of strangers\' cars under the handle DeadAir. Her audience tips for style, not for wreckage.',
    portrait: 'mika',
    reason: 'Chasing a live segment somewhere with better light.',
    pickupTags: ['downtown', 'market'],
    destinationTags: ['waterfront', 'outskirts', 'downtown'],
    preferences: [
      { kind: 'fast', weight: 1, kmh: 110 },
      { kind: 'drift', weight: 1 },
    ],
    openings: [
      "I'm live. Give them something worth watching — just keep the car in one piece.",
      'Chat says the last driver was boring. Prove them wrong, yeah?',
      'DeadAir, three hundred viewers, one back seat. No pressure.',
    ],
    brief: 'Take me to {destination}. Fast, sideways, and no bodywork on the road. Chat can tell the difference.',
    reactions: {
      goodSpeed: ['Okay, THIS is a segment.', 'Chat is losing it. Keep going.', 'Speed. Finally.'],
      tooSlow: ['We are… cruising. Chat is leaving.', 'Is this the scenic route or the school run?', 'You know the pedal on the right, yeah?'],
      driftGood: ['Clip that. CLIP THAT.', 'Sideways! That one is going on the highlight reel.', 'Okay, you can drive.'],
      collision: ["That's a crash, not content.", 'Clean, I said. Chat is laughing at us.', 'Ow. Style points do not survive that.'],
    },
    arrival: "This is it. Park it somewhere the camera can see the car.",
    farewell: {
      high: ['Best segment all week. Chat wants your handle.', 'That was a show. Tip is from the viewers, honestly.'],
      medium: ['Decent stream. Could use more sideways next time.', 'Fine. A few good bits. Chat gives it a six.'],
      low: ['Dead air, the whole way. Ironic.', 'I have seen more excitement in a lift.'],
    },
  },
  {
    id: 'vera',
    name: 'Vera',
    tagline: 'NIGHT-SHIFT TECHNICIAN',
    personality: 'Dry humour, tired, direct. Wants nothing to happen.',
    background: 'Twelve-hour nights fixing the machines that keep the district lit. Has strong views on things that break.',
    portrait: 'vera',
    reason: 'Going home after a double shift, and wants to arrive asleep.',
    pickupTags: ['industrial', 'downtown'],
    destinationTags: ['residential', 'market'],
    preferences: [
      { kind: 'slow', weight: 1, kmh: 80 },
      { kind: 'noDrift', weight: 1 },
    ],
    openings: [
      "I've spent twelve hours fixing machines. Please don't make me climb out of another broken one.",
      "Home. Slowly. If I fall asleep, that's a compliment.",
      "Twelve hours, four fried inverters, one me. Just get me home.",
    ],
    brief: 'Take me to {destination}. Keep it under eighty and keep the tyres pointing where we are going. No sliding.',
    reactions: {
      goodSpeed: ['This is nice. Keep doing this.', "See, this is how it's done. I could sleep.", 'Smooth. Thank you.'],
      tooFast: ['Slow down. I did not survive a shift to die in a hatchback.', 'Eighty. The number was eighty.', 'Too fast. My coffee agrees.'],
      driftBad: ['No. No sliding. I said that.', 'The car is sideways. Why is the car sideways?', 'That is exactly the thing I asked you not to do.'],
      collision: ['Wonderful. Now something else is broken.', 'I fix machines for a living. I am not fixing this one.', 'Was that necessary?'],
    },
    arrival: "That's my street. Anywhere here is fine. Gently.",
    farewell: {
      high: ['I nearly fell asleep. Highest praise I have. Here.', 'Smooth all the way. You may drive me again.'],
      medium: ['Got here. Mostly in one piece. Thanks.', 'Adequate. That is not sarcasm. I am too tired for sarcasm.'],
      low: ['Next time I take the bus. The bus is slower and it has never drifted.', 'I asked for one thing.'],
    },
  },
  {
    id: 'nico',
    name: 'Nico',
    tagline: 'STATIC · ELECTRONICS SCAVENGER',
    personality: 'Conspiratorial, mischievous, delighted whenever corporate infrastructure goes dark.',
    background: 'Strips dead autonomous EVs for parts and sells what the corporations would rather nobody had. Carries the good stuff in a padded case.',
    portrait: 'nico',
    reason: 'Moving a case of delicate salvage across town before anyone notices it is missing.',
    pickupTags: ['outskirts', 'industrial', 'waterfront'],
    destinationTags: ['market', 'downtown', 'industrial'],
    preferences: [
      { kind: 'rayo', weight: 1 },
      { kind: 'noDrift', weight: 1 },
    ],
    openings: [
      'Corporate EVs? Shut them down if you get a clean shot. But keep it steady — this equipment is worth more than my apartment.',
      'Static. Do not ask what is in the case. Do ask if you see one of their cars.',
      "Every one of those EVs is a camera on wheels. I'd take it kindly if fewer of them were working.",
    ],
    brief: 'Take me to {destination}. Rayo any corporate EV you get a clean line on. No sliding — the case does not like sideways.',
    reactions: {
      rayoGood: ['Ha! Lights out. One less camera.', "Clean hit. Somebody's dashboard just went very quiet.", 'That is what I am talking about.'],
      driftBad: ['Steady! The case! Do you know what is in the case?', 'Sideways is bad for the merchandise.', 'Every slide is a component I cannot sell.'],
      collision: ['Not like that! The bolt, not the bumper!', 'That was a crash, and crashes have witnesses.', 'The case. Think of the case.'],
    },
    arrival: 'This is the spot. Pull in, nice and quiet.',
    farewell: {
      high: ['Steady hands and a good aim. You are on my list. The good list.', 'Two fewer cameras on the streets and not a scratch on the case. Here.'],
      medium: ['Case is intact. Could have used a bit more darkness on the way.', 'Fine. Not memorable. That is a compliment in my line.'],
      low: ['The case is rattling. If anything is broken, I know your plate.', 'I said steady. I said clean.'],
    },
  },
];

/** Look a character up by id. Null for an id the catalogue does not carry. */
export function passengerById(catalog: readonly PassengerDef[], id: string): PassengerDef | null {
  for (let i = 0; i < catalog.length; i++) if (catalog[i].id === id) return catalog[i];
  return null;
}
