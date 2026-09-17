import { CROWD, HUSTLERS } from '../../../config/tuning';
import type { HustlerMood, HustlerPhase } from '../../../core/types';
import type { HumanPose } from './humanFigure';

/**
 * WHAT PEOPLE DO. A person in this city (`humanFigure.ts`) is rigged; this file is what moves
 * the rig: a short list of things a person at a car meet or a kerb does, and how every one of
 * them notices the player's car.
 *
 * AN ACT is chosen once, in data (`world/carMeet.ts`, the passenger and El Búho figures), for
 * where the person is: somebody by the speakers moves to the music, somebody by the drum warms
 * their hands at it, somebody with a camera films. It is written as a function of time and the
 * person's own seed, with a few deterministic "spells" — now talking, now listening; now
 * filming, now checking the shot — so a crowd never moves in step and nothing needs a timer.
 *
 * REACTIONS are the same for everyone, laid over whatever the act made:
 *   attention - a moving car nearby turns their head, then their shoulders, then (for someone
 *               filming or flagging it down) the rest of them;
 *   hype      - a drift nearby puts arms in the air and phones up;
 *   flinch    - a car coming at them fast makes them throw their arms up and step back.
 * Those three are the only state a person keeps, besides where a pacer is on their beat.
 *
 * PURE ARITHMETIC. No Three, no document, nothing allocated per step: a `BodyPose` is a flat
 * record of joint angles that `humanRig.ts` writes into bones, and a test can step an actor and
 * read the numbers (`tests/humanActs.test.ts`).
 *
 * CONVENTIONS. Angles in radians. The person faces local -z; `turn`, `twist` and `look` are
 * positive to their right; `lean` and `nod` are positive forwards and down; `legL/legR` swing
 * forward; `raise` swings an arm forward, `spread` swings it out to the side, `bend` bends the
 * elbow forward and `cross` swings the forearm in across the body. `x`/`z` are metres in the
 * space the actor's own `x`/`z` are in.
 */

/** Things a person does. */
export type HumanAct =
  /** Waits, shifts their weight, looks about. */
  | 'stand'
  /** Talks to whoever is at `focus`, and listens. */
  | 'chat'
  /** Films with the camera in their hand, and follows anything worth filming. */
  | 'film'
  /** Head down in the phone, looking up now and then. */
  | 'phone'
  /** Paces from where they stand to `to` and back, on the phone. */
  | 'pace'
  /** Moves to the music from the speakers at `focus`. */
  | 'vibe'
  /** Hands out over the fire in the drum at `focus`. */
  | 'warm'
  /** Sells out of the cooler at their feet: bends to it, hands something over. */
  | 'vendor'
  /** Leans on the bonnet of the car at `focus`, points at something, straightens up. */
  | 'inspect'
  /** Flags down the car coming for them. */
  | 'hail'
  /**
   * A trapito: waits with his rag, and — cued by the rules (`src/sim/hustlers.ts`) — calls a car
   * into a space, points at it, waves it in, and grumbles when it drives off. Needs `Actor.cue`.
   */
  | 'trapito'
  /** A windshield washer: watches his light, offers, walks to the car, cleans, walks back. Needs `Actor.cue`. */
  | 'washer'
  /**
   * A sock seller: walks his beat with the box round his neck, holds a pair up at the street from
   * either end, and — cued — stops for a car, pitches it, shrugs when it goes. Needs `Actor.cue`.
   */
  | 'medias'
  /**
   * A travesti: waits on her kerb with a hand on her hip, the bag on her arm, and — cued — turns to
   * a car, steps to the kerb, beckons it over and blows it a kiss. Needs `Actor.cue`.
   */
  | 'travesti';

export interface ActorSpec {
  act: HumanAct;
  /** Where they stand and which way they face. */
  x: number;
  z: number;
  heading: number;
  /** What their arms do when the act leaves them alone. */
  arms?: HumanPose;
  /** Any integer. Two seeds never move in step. */
  seed: number;
  /** What they attend to: a partner, the drum, the speakers, the car. */
  focus?: { x: number; z: number } | null;
  /** The far end of a `pace` beat. */
  to?: { x: number; z: number };
}

/** The player's car, as the people see it: in the same space as their `x`/`z`. */
export interface CrowdSubject {
  x: number;
  z: number;
  /** m/s, unsigned. */
  speed: number;
  drifting: boolean;
}

/**
 * What a street hustler is doing this frame, written onto his actor by whoever drives him
 * (`scene/hustlersVisual.ts`) from the rules' state. Everything is in the actor's own space — the
 * space his `x`/`z` are in — and `t` is seconds into `phase`.
 */
export interface HustlerCue {
  phase: HustlerPhase;
  t: number;
  mood: HustlerMood;
  /** The player's car. */
  carX: number;
  carZ: number;
  /** A trapito's imaginary space at the kerb. */
  spaceX: number;
  spaceZ: number;
  /** A walk to or from a car: where it starts and ends, and 0..1 along it. */
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  walk: number;
  /** A clean: the middle of the windscreen, the unit direction across it (the car's right), and the squeegee on it. */
  glassX: number;
  glassZ: number;
  acrossX: number;
  acrossZ: number;
  u: number;
  v: number;
  wiping: number;
  /** A washer's light is red. */
  red: boolean;
  /** A sock seller: where he is on his beat, which way it has him face, how far into his stride, and metres walked. */
  atX: number;
  atZ: number;
  facing: number;
  striding: number;
  stride: number;
}

export function createHustlerCue(): HustlerCue {
  return {
    phase: 'idle', t: 0, mood: 'plain', carX: 0, carZ: 0, spaceX: 0, spaceZ: 0, fromX: 0, fromZ: 0, toX: 0, toZ: 0,
    walk: 0, glassX: 0, glassZ: 0, acrossX: 1, acrossZ: 0, u: 0, v: 0, wiping: 0, red: false,
    atX: 0, atZ: 0, facing: 0, striding: 0, stride: 0,
  };
}

/** One person's joint angles and offsets. See the file's conventions. */
export interface BodyPose {
  x: number;
  z: number;
  turn: number;
  lift: number;
  lean: number;
  twist: number;
  tilt: number;
  nod: number;
  look: number;
  legL: number;
  legR: number;
  raiseL: number;
  spreadL: number;
  bendL: number;
  crossL: number;
  raiseR: number;
  spreadR: number;
  bendR: number;
  crossR: number;
  /** 0 hides what is held in the hand (the phone), 1 shows it. */
  item: number;
}

export function createPose(): BodyPose {
  return {
    x: 0, z: 0, turn: 0, lift: 0, lean: 0, twist: 0, tilt: 0, nod: 0, look: 0, legL: 0, legR: 0,
    raiseL: 0, spreadL: 0, bendL: 0, crossL: 0, raiseR: 0, spreadR: 0, bendR: 0, crossR: 0, item: 0,
  };
}

function clearPose(p: BodyPose): void {
  p.x = p.z = p.turn = p.lift = p.lean = p.twist = p.tilt = p.nod = p.look = p.legL = p.legR = 0;
  p.raiseL = p.spreadL = p.bendL = p.crossL = p.raiseR = p.spreadR = p.bendR = p.crossR = p.item = 0;
}

/** A person's state between steps. Build with `createActor`; step with `stepActor`. */
export interface Actor {
  readonly spec: ActorSpec;
  /** Offsets every clock, from the seed. */
  readonly phase: number;
  /** Which way their act has them face, absolute. */
  readonly face: number;
  attention: number;
  hype: number;
  flinch: number;
  /** How far the reaction has turned their whole body towards the car (rad). */
  track: number;
  lastDist: number;
  /** `pace`: metres along the beat, which way, seconds left standing at an end, gait and stride. */
  along: number;
  dir: number;
  rest: number;
  gait: number;
  stride: number;
  facing: number;
  /** A street hustler's cue, or null for everyone else. Written from outside every frame. */
  cue: HustlerCue | null;
}

export function createActor(spec: ActorSpec): Actor {
  const faceFocus = spec.focus && (spec.act === 'warm' || spec.act === 'inspect' || spec.act === 'vibe');
  const face = faceFocus ? bearing(spec.x, spec.z, spec.focus!.x, spec.focus!.z) : spec.heading;
  const toward = spec.to ? bearing(spec.x, spec.z, spec.to.x, spec.to.z) : face;
  const cue = spec.act === 'trapito' || spec.act === 'washer' || spec.act === 'medias' || spec.act === 'travesti' ? createHustlerCue() : null;
  if (cue) {
    // Where he stands until anybody says otherwise, so the first pose is never at the origin.
    cue.atX = spec.x;
    cue.atZ = spec.z;
    cue.facing = spec.heading;
  }
  return {
    spec,
    phase: hash(spec.seed, 7.3) * 20,
    face,
    attention: 0,
    hype: 0,
    flinch: 0,
    track: 0,
    lastDist: Infinity,
    along: 0,
    dir: 1,
    rest: hash(spec.seed, 2.1) * 2,
    gait: 0,
    stride: 0,
    facing: toward,
    cue,
  };
}

/**
 * Where the actor is this step, and every joint of them, into `out`. `dt` is the seconds since
 * this actor was last stepped (a far crowd is stepped less often and passes the sum).
 */
export function stepActor(a: Actor, time: number, dt: number, subject: CrowdSubject | null, out: BodyPose): void {
  clearPose(out);
  const t = time + a.phase;
  settle(a, t, out);
  switch (a.spec.act) {
    case 'chat':
      chat(a, t, out);
      break;
    case 'film':
      film(a, t, out);
      break;
    case 'phone':
      phone(a, t, out);
      break;
    case 'pace':
      pace(a, t, dt, out);
      break;
    case 'vibe':
      vibe(a, time, t, out);
      break;
    case 'warm':
      warm(a, t, out);
      break;
    case 'vendor':
      vendor(t, out);
      break;
    case 'inspect':
      inspect(a, t, out);
      break;
    case 'hail':
      hail(a, t, out);
      break;
    case 'trapito':
      trapito(a, t, out);
      break;
    case 'washer':
      washer(a, t, out);
      break;
    case 'medias':
      medias(a, t, dt, out);
      break;
    case 'travesti':
      travesti(a, t, out);
      break;
    default:
      break;
  }
  react(a, t, dt, subject, out);
}

/* ================================================================== clocks */

const TAU = Math.PI * 2;

function hash(i: number, salt: number): number {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function ease(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrap(a: number): number {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

/** The heading from one point to another: 0 north (-z), + clockwise. */
function bearing(fx: number, fz: number, tx: number, tz: number): number {
  return Math.atan2(tx - fx, -(tz - fz));
}

/** -1..1: holds a value for most of each `period`, then eases to the next over the last `move` of it. */
function wander(t: number, period: number, salt: number, move = 0.3): number {
  const u = t / period;
  const i = Math.floor(u);
  const a = hash(i, salt) * 2 - 1;
  const b = hash(i + 1, salt) * 2 - 1;
  return a + (b - a) * ease((u - i - (1 - move)) / move);
}

/** 0..1: whether they are doing a thing this `period` (with odds `chance`), eased across the change. */
function spell(t: number, period: number, chance: number, salt: number, move = 0.2): number {
  const u = t / period;
  const i = Math.floor(u);
  const a = hash(i, salt) < chance ? 1 : 0;
  const b = hash(i + 1, salt) < chance ? 1 : 0;
  return a + (b - a) * ease((u - i - (1 - move)) / move);
}

/** 0..1 inside a repeating cycle: up across [a, b], held, down across [c, d]. */
function envelope(u: number, a: number, b: number, c: number, d: number): number {
  return ease((u - a) / (b - a)) * (1 - ease((u - c) / (d - c)));
}

/** Move one arm towards a pose by `w`. */
function arm(p: BodyPose, right: boolean, raise: number, spread: number, bend: number, cross: number, w: number): void {
  if (w <= 0) return;
  if (right) {
    p.raiseR += (raise - p.raiseR) * w;
    p.spreadR += (spread - p.spreadR) * w;
    p.bendR += (bend - p.bendR) * w;
    p.crossR += (cross - p.crossR) * w;
  } else {
    p.raiseL += (raise - p.raiseL) * w;
    p.spreadL += (spread - p.spreadL) * w;
    p.bendL += (bend - p.bendL) * w;
    p.crossL += (cross - p.crossL) * w;
  }
}

/** How far to turn from the act's facing to look at a point. */
function toward(a: Actor, p: BodyPose, x: number, z: number): number {
  return wrap(bearing(a.spec.x + p.x, a.spec.z + p.z, x, z) - (a.spec.heading + p.turn));
}

/* ================================================================== the acts */

/** Everyone, underneath whatever they are doing: weight, breath, a glance about, arms at rest. */
function settle(a: Actor, t: number, p: BodyPose): void {
  const s = a.spec.seed * 13;
  const weight = Math.sin(t * 0.33);
  p.turn = wrap(a.face - a.spec.heading) + 0.035 * Math.sin(t * 0.19);
  p.tilt = 0.035 * weight;
  p.lift = -0.012 * Math.abs(weight);
  p.lean = 0.018 * Math.sin(t * 1.4);
  // Weight on one leg, the other a touch forward.
  p.legL = 0.06 * Math.max(0, weight);
  p.legR = 0.06 * Math.max(0, -weight);
  p.look = 0.55 * wander(t, 4.2, s + 1);
  p.nod = 0.06 + 0.07 * wander(t, 5.5, s + 2);
  const sway = 0.025 * Math.sin(t * 0.8);
  switch (a.spec.arms ?? 'idle') {
    case 'folded':
      arm(p, false, 0.62, -0.12, 1.55, 1.12, 1);
      arm(p, true, 0.52, -0.1, 1.62, 1.2, 1);
      break;
    case 'pocket':
      arm(p, false, 0.04 + sway, 0.07, 0.12, 0, 1);
      arm(p, true, 0.18, 0.02, 0.7, 0.45, 1);
      break;
    default:
      arm(p, false, 0.04 + sway, 0.07, 0.14, 0, 1);
      arm(p, true, 0.04 - sway, 0.07, 0.14, 0, 1);
      break;
  }
}

function chat(a: Actor, t: number, p: BodyPose): void {
  const s = a.spec.seed * 13;
  const focus = a.spec.focus;
  if (focus) {
    // Most of the way with the head, a little with the shoulders, and still glancing about.
    const rel = toward(a, p, focus.x, focus.z);
    p.look = clamp(rel * 0.75, -1.1, 1.1) + 0.2 * wander(t, 3.1, s + 3);
    p.twist = clamp(rel * 0.25, -0.45, 0.45);
  }
  const talking = spell(t, 3.2, 0.5, s + 4);
  const right = a.spec.seed % 2 === 0;
  arm(
    p,
    right,
    0.32 + 0.22 * Math.sin(t * 2.1),
    0.12,
    1.05 + 0.42 * Math.sin(t * 3.1 + 1.3),
    0.3 + 0.22 * Math.sin(t * 1.3),
    talking,
  );
  p.nod += 0.05 * Math.sin(t * 4.3) * talking;
  // Listening: a nod now and then.
  p.nod += (1 - talking) * 0.14 * Math.pow(Math.max(0, Math.sin(t * 2.6)), 6);
  // And the odd laugh: back, shoulders shaking.
  const laugh = spell(t, 2.2, 0.1, s + 5, 0.35);
  if (laugh > 0) {
    p.lean -= 0.1 * laugh;
    p.nod -= 0.18 * laugh;
    p.tilt += 0.05 * Math.sin(t * 17) * laugh;
    p.lift += 0.014 * Math.abs(Math.sin(t * 17)) * laugh;
  }
}

function film(a: Actor, t: number, p: BodyPose): void {
  const s = a.spec.seed * 13;
  // Now and then the camera comes down and they check what they got.
  const check = spell(t, 6, 0.25, s + 6, 0.25);
  const rec = 1 - check;
  p.item = 1;
  // The camera in the right hand, forearm out level and in towards the middle; the left hand
  // across to steady it. Held like that the lens looks a little left of straight on, so the
  // shoulders turn right to put it back in front of them.
  arm(p, true, 0.45, -0.05, 1.15, 0.6, rec);
  arm(p, false, 0.55, -0.3, 1.25, 1.35, rec);
  arm(p, true, 0.12, 0.02, 1.55, 0.55, check);
  // Panning across whatever is in front of them.
  p.twist = (0.45 + 0.32 * Math.sin(t * 0.21)) * rec;
  p.turn += 0.22 * Math.sin(t * 0.09);
  p.look = 0.08 * wander(t, 3, s + 7) - 0.4 * rec + 0.25 * check;
  p.nod = 0.04 + 0.42 * check;
}

function phone(a: Actor, t: number, p: BodyPose): void {
  const s = a.spec.seed * 13;
  const up = spell(t, 5, 0.3, s + 8);
  const both = spell(t, 7, 0.4, s + 9) * (1 - up);
  p.item = 1;
  arm(p, true, 0.3, 0.05, 1.75 - 0.3 * up + 0.04 * Math.sin(t * 9) * (1 - up), 0.55, 1);
  arm(p, false, 0.3, -0.05, 1.7, 1.0, both);
  p.nod = 0.5 - 0.42 * up;
  p.look = (0.05 + 0.6 * wander(t, 2.5, s + 10)) * up;
}

/** A short beat walked back and forth, on the phone. The walk is the only state an act keeps. */
function pace(a: Actor, t: number, dt: number, p: BodyPose): void {
  const s = a.spec;
  const to = s.to ?? { x: s.x, z: s.z };
  const lx = to.x - s.x;
  const lz = to.z - s.z;
  const len = Math.hypot(lx, lz);
  // A car coming at them stops them in their tracks.
  const hold = a.flinch > 0.2 || len < 0.01;
  if (a.rest > 0) {
    a.rest -= dt;
  } else if (!hold) {
    a.along += a.dir * CROWD.paceSpeed * dt;
    if (a.along >= len || a.along <= 0) {
      a.along = clamp(a.along, 0, len);
      a.dir = -a.dir;
      a.rest = 1.2 + 2.4 * hash(Math.floor(t), s.seed);
    }
  }
  const walking = a.rest > 0 || hold ? 0 : 1;
  const k = Math.min(1, dt * 6);
  a.gait += (walking - a.gait) * k;
  const want = a.dir > 0 ? Math.atan2(lx, -lz) : Math.atan2(-lx, lz);
  const turnStep = 3 * dt;
  a.facing += clamp(wrap(want - a.facing), -turnStep, turnStep);
  a.stride += (dt * CROWD.paceSpeed * Math.PI * a.gait) / 0.7;

  if (len > 0.01) {
    p.x = (lx / len) * a.along;
    p.z = (lz / len) * a.along;
  }
  p.turn = wrap(a.facing - s.heading);
  const swing = Math.sin(a.stride) * 0.42 * a.gait;
  p.legL = swing;
  p.legR = -swing;
  p.lift += a.gait * (-0.02 + 0.03 * Math.abs(Math.cos(a.stride)));
  p.lean += 0.05 * a.gait;
  p.tilt *= 1 - a.gait;
  arm(p, false, -swing * 0.7, 0.07, 0.25, 0, 1);
  // The phone at the ear: elbow up in front, forearm folded back to the side of the head.
  p.item = 1;
  arm(p, true, 1.4, 0.3, 2.4, 0.55, 1);
  p.tilt += 0.08;
  p.nod = 0.12 + 0.08 * wander(t, 2, s.seed * 13 + 11);
  p.look *= 0.5;
}

function vibe(a: Actor, clock: number, t: number, p: BodyPose): void {
  const s = a.spec.seed * 13;
  // Everyone near the speakers hears the same music, so the beat is on the shared clock.
  const beat = (clock * CROWD.bpm) / 60;
  const swing = Math.sin(Math.PI * beat);
  const down = 1 - Math.abs(swing);
  p.lift += -0.04 * down;
  p.nod = 0.06 + 0.14 * down;
  p.twist = 0.1 * swing;
  p.tilt += 0.04 * swing;
  p.legL = 0.05 * swing;
  p.legR = -0.05 * swing;
  p.look = 0.3 * wander(t, 6, s + 12);
  arm(p, false, 0.12 * swing, 0.1, 0.5, 0.1, 1);
  arm(p, true, -0.12 * swing, 0.1, 0.5, 0.1, 1);
  // A fist in the air for a few bars.
  const pump = spell(t, (16 * 60) / CROWD.bpm, 0.35, s + 13);
  arm(p, true, 2.3 + 0.3 * down, 0.12, 0.55, 0.1, pump);
}

function warm(a: Actor, t: number, p: BodyPose): void {
  const s = a.spec.seed * 13;
  // Mostly at the fire; now and then a step back, hands in pockets, looking about.
  const away = spell(t, 7, 0.3, s + 14, 0.3);
  const w = 1 - away;
  const rub = Math.sin(t * 5.5);
  arm(p, false, 0.85, 0.06, 0.6 + 0.06 * rub, 0.4 + 0.1 * rub, w);
  arm(p, true, 0.85, 0.06, 0.6 - 0.06 * rub, 0.4 - 0.1 * rub, w);
  arm(p, false, 0.15, 0.02, 0.7, 0.45, away);
  arm(p, true, 0.15, 0.02, 0.7, 0.45, away);
  p.lean += 0.12 * w;
  p.nod = 0.3 * w + p.nod * away;
  p.look *= away + 0.25;
}

function vendor(t: number, p: BodyPose): void {
  const u = t % 15;
  // Bending to the cooler at their left...
  const bend = envelope(u, 5, 6, 8, 9);
  p.twist += -0.55 * bend;
  p.lean += 0.8 * bend;
  p.nod += 0.3 * bend;
  p.look *= 1 - bend;
  arm(p, false, 1.2, 0.15, 0.15, 0, bend);
  arm(p, true, 0.9, 0.05, 0.3, 0.2, bend);
  // ...and holding what they fished out across to whoever is in front.
  const offer = envelope(u, 9.2, 10, 12, 12.8);
  arm(p, true, 1.2, 0.05, 0.25, 0.15, offer);
  p.nod += 0.1 * offer;
  p.look *= 1 - offer;
}

function inspect(a: Actor, t: number, p: BodyPose): void {
  const s = a.spec.seed * 13;
  const up = spell(t, 5, 0.35, s + 15, 0.3);
  const point = spell(t, 3.5, 0.35, s + 16) * (1 - up);
  const lean = 0.5 + 0.06 * wander(t, 3, s + 17);
  const bent = 1 - up;
  p.lean += (lean - p.lean) * bent;
  p.nod += (0.4 - p.nod) * bent;
  p.look = (0.35 * bent + 0.7 * up) * wander(t, 2.2, s + 18);
  // Both hands on the bonnet, which is why they stand a step off the bumper.
  arm(p, false, lean + 0.75, 0.1, 0.1, 0, bent);
  arm(p, true, lean + 0.75, 0.1, 0.1, 0, bent);
  arm(p, true, lean + 1.0, 0.05, 0.12, 0.25, point);
}

function hail(a: Actor, t: number, p: BodyPose): void {
  const s = a.spec.seed * 13;
  // At a car coming for them, and now and then at one that might be.
  const w = Math.max(a.attention, 0.7 * spell(t, 6, 0.25, s + 19));
  const flap = Math.sin(t * 7);
  arm(p, true, 0.25, 2.5 + 0.28 * flap, 0.5 + 0.35 * Math.sin(t * 7 + 0.8), 0, w);
  p.lean -= 0.04 * w;
}

/* ================================================================== the hustlers */

/** Turn the whole body towards a point by `w` (the rest of the way stays the act's), and step up to `step` metres at it. */
function faceAndStep(a: Actor, p: BodyPose, x: number, z: number, w: number, step: number): void {
  const rel = toward(a, p, x, z);
  p.turn += clamp(rel, -2.9, 2.9) * w;
  if (step > 0) {
    const dx = x - (a.spec.x + p.x);
    const dz = z - (a.spec.z + p.z);
    const d = Math.hypot(dx, dz);
    if (d > 0.01) {
      const k = Math.min(step, Math.max(0, d - 2.5)) / d;
      p.x += dx * k;
      p.z += dz * k;
    }
  }
}

/** Walking from `from` to `to`, 0..1 along: where they are, facing the way, legs and free arm swinging. */
function walkAlong(a: Actor, c: HustlerCue, p: BodyPose, fromHome: boolean): void {
  const x = c.fromX + (c.toX - c.fromX) * c.walk;
  const z = c.fromZ + (c.toZ - c.fromZ) * c.walk;
  p.x = x - a.spec.x;
  p.z = z - a.spec.z;
  const len = Math.hypot(c.toX - c.fromX, c.toZ - c.fromZ);
  const moving = len > 0.2 && c.walk < 1 ? 1 : 0;
  if (moving) {
    p.turn = wrap(bearing(c.fromX, c.fromZ, c.toX, c.toZ) - a.spec.heading);
    const swing = Math.sin(c.walk * len * 2.6) * 0.5;
    p.legL = swing;
    p.legR = -swing;
    p.lift += -0.02 + 0.035 * Math.abs(Math.cos(c.walk * len * 2.6));
    p.lean += 0.12;
    p.tilt = 0;
    arm(p, false, -swing * 0.7, 0.08, 0.35, 0, 1);
  } else if (!fromHome) {
    p.turn = wrap(bearing(a.spec.x + p.x, a.spec.z + p.z, c.carX, c.carZ) - a.spec.heading);
  }
}

/** A shrug with the palms up and a shake of the head: "bueno, yo ofrecí". */
function shrug(p: BodyPose, t: number, w: number): void {
  arm(p, false, 0.35, 0.45, 1.35, 0, w);
  arm(p, true, 0.35, 0.45, 1.35, 0, w);
  p.lift += 0.02 * w;
  p.look += 0.28 * Math.sin(t * 9) * w;
  p.nod += -0.06 * w;
}

function trapito(a: Actor, t: number, p: BodyPose): void {
  const s = a.spec.seed * 13;
  const c = a.cue;
  p.item = 1;
  if (!c || c.phase === 'idle') {
    // The rag hanging from the fist, swinging a little; now and then a lazy flick of it at the street.
    arm(p, true, 0.08 + 0.05 * Math.sin(t * 1.3), 0.14, 0.3, 0, 1);
    arm(p, false, 0.15, 0.02, 0.7, 0.45, 1);
    const flick = spell(t, 6.5, 0.3, s + 30);
    arm(p, true, 1.05 + 0.25 * Math.sin(t * 6), 0.35, 0.8 + 0.3 * Math.sin(t * 6 + 1), 0, flick * 0.7);
    return;
  }
  const k = c.t;
  if (c.phase === 'grumble') {
    // Turns back to his spot, flicks the rag down at the car that left, shrugs.
    const off = ease(k / 1.2);
    faceAndStep(a, p, c.carX, c.carZ, 0.6 * (1 - off), 0);
    const flick = envelope(k, 0, 0.25, 0.6, 0.9);
    arm(p, true, 0.9 - 0.8 * ease(k / 0.7), 0.3, 0.6, 0, flick);
    shrug(p, t, envelope(k, 0.7, 1.0, 2.0, 2.4));
    return;
  }

  // Calling, or waiting on the car to take the space: face it, a step or so off his patch towards it.
  const turnIn = c.phase === 'call' ? ease(k / 0.6) : 1;
  const step = (c.phase === 'call' ? ease((k - 3.5) / 1.2) * 0.9 : 0.9);
  faceAndStep(a, p, c.carX, c.carZ, 0.85 * turnIn, step);

  if (c.phase === 'wait') {
    // Talking the car in: one hand going, the rag pointed at the space now and then.
    const talking = spell(t, 2.4, 0.6, s + 31);
    arm(p, false, 0.55 + 0.25 * Math.sin(t * 2.3), 0.15, 1.1 + 0.45 * Math.sin(t * 3.3 + 1.1), 0.25, talking);
    const point = spell(t, 3.1, 0.4, s + 32);
    const relSpace = toward(a, p, c.spaceX, c.spaceZ);
    p.twist += clamp(relSpace, -0.8, 0.8) * 0.6 * point;
    arm(p, true, 1.4, 0.1 + clamp(relSpace, 0, 0.9) * 0.6, 0.12, clamp(-relSpace, 0, 0.9) * 0.5, point);
    arm(p, true, 0.1, 0.14, 0.3, 0, 1 - point);
    return;
  }

  // THE CALL, beat by beat.
  const startle = envelope(k, 0, 0.3, 1.0, 1.4);
  if (c.mood === 'damaged') {
    // Both hands to his head at the state of it.
    arm(p, false, 2.1, 0.55, 2.2, 0.5, startle);
    arm(p, true, 2.1, 0.55, 2.2, 0.5, startle);
    p.lean -= 0.12 * startle;
  } else if (c.mood === 'clean') {
    // Arms out: "apa, mirá esa nave".
    arm(p, false, 0.45, 1.1, 0.35, 0, startle);
    arm(p, true, 0.45, 1.1, 0.35, 0, startle);
    p.lean -= 0.08 * startle;
    p.nod -= 0.1 * startle;
  } else {
    // One arm up to get the driver's eye.
    arm(p, true, 0.3, 2.6, 0.3, 0, startle);
  }
  // The rag waved over his head.
  const wave = envelope(k, 1.1, 1.4, 2.6, 2.9);
  const flap = Math.sin(t * 8);
  arm(p, true, 0.25, 2.45 + 0.3 * flap, 0.45 + 0.35 * Math.sin(t * 8 + 0.8), 0, wave);
  // Pointing at the space, shoulders round to it.
  const point = envelope(k, 2.7, 3.0, 3.9, 4.2);
  const relSpace = toward(a, p, c.spaceX, c.spaceZ);
  p.twist += clamp(relSpace, -0.9, 0.9) * 0.7 * point;
  p.look += (clamp(relSpace, -1.1, 1.1) - p.look) * point;
  arm(p, true, 1.45, 0.1 + clamp(relSpace, 0, 0.9) * 0.7, 0.1, clamp(-relSpace, 0, 0.9) * 0.6, point);
  // "Dale, dale, seguí": the free hand beckoning the car on, the rag still out at the space.
  const beckon = envelope(k, 4.0, 4.3, 6, 7);
  arm(p, false, 0.85, 0.25, 1.15 + 0.6 * Math.sin(t * 7.5), 0.15, beckon);
  arm(p, true, 1.2, 0.35, 0.3, 0, beckon * 0.7);
}

function washer(a: Actor, t: number, p: BodyPose): void {
  const s = a.spec.seed * 13;
  const c = a.cue;
  p.item = 1;
  // The squeegee down by his leg, the bottle in the other hand. Everything below starts from here.
  arm(p, true, 0.12, 0.1, 0.35, 0, 1);
  arm(p, false, 0.15, 0.1, 0.45, 0, 1);
  if (!c || c.phase === 'idle') {
    // On the balls of his feet while his light is red, tapping the squeegee on his palm; loose otherwise.
    const tap = c && c.red ? 1 : spell(t, 5, 0.3, s + 40);
    arm(p, true, 0.75, -0.05, 1.2 + 0.18 * Math.max(0, Math.sin(t * 6)), 0.55, tap);
    arm(p, false, 0.55, -0.05, 1.2, 0.7, tap);
    if (c && c.red) p.lift += 0.012 * Math.abs(Math.sin(t * 3.2));
    return;
  }
  const k = c.t;
  switch (c.phase) {
    case 'offer': {
      // A step off the kerb at the car, squeegee up, the other hand out: "¿te lo limpio?"
      faceAndStep(a, p, c.carX, c.carZ, ease(k / 0.4), 0.9 * ease(k / 0.6));
      const up = ease(k / 0.35);
      arm(p, true, 2.0 + 0.12 * Math.sin(t * 5), 0.25, 0.65, 0, up);
      arm(p, false, 0.75, 0.2, 0.9 + 0.2 * Math.sin(t * 3), 0, up);
      p.nod -= 0.05 * up;
      return;
    }
    case 'approach':
    case 'retreat':
      walkAlong(a, c, p, c.phase === 'retreat');
      if (c.phase === 'retreat' && c.walk >= 1) shrug(p, t, 0);
      return;
    case 'clean': {
      p.x = c.toX - a.spec.x;
      p.z = c.toZ - a.spec.z;
      p.turn = wrap(bearing(c.toX, c.toZ, c.glassX, c.glassZ) - a.spec.heading);
      p.legL = 0.18;
      p.legR = -0.05;
      if (c.wiping < 0.5) {
        // The bottle up and pumping at the glass.
        p.lean += 0.22;
        arm(p, false, 1.35, 0.1, 0.35 + 0.18 * Math.max(0, Math.sin(t * 16)), 0.2, 1);
        arm(p, true, 0.6, 0.1, 0.9, 0.2, 1);
        p.nod += 0.2;
        return;
      }
      // Wiping: the squeegee drawn across the glass, and the body going with it — shoulders round
      // to where the blade is, the reach higher on the top strokes, weight over the bonnet.
      const tx = c.glassX + c.acrossX * (c.u - 0.5) * 1.05;
      const tz = c.glassZ + c.acrossZ * (c.u - 0.5) * 1.05;
      const rel = toward(a, p, tx, tz);
      p.lean += 0.42 + 0.1 * c.v;
      p.twist += clamp(rel, -0.9, 0.9) * 0.65;
      p.look += (clamp(rel * 0.5, -0.6, 0.6) - p.look) * 0.8;
      p.nod += 0.28;
      p.x += c.acrossX * (c.u - 0.5) * 0.18;
      p.z += c.acrossZ * (c.u - 0.5) * 0.18;
      const reach = 1.45 - 0.35 * c.v;
      arm(p, true, reach, 0.1 + clamp(rel, 0, 0.9) * 0.9, 0.35, clamp(-rel, 0, 0.9) * 0.9, 1);
      // The other hand braced on the bonnet, bottle and all.
      arm(p, false, 1.0, 0.25, 0.25, 0.1, 1);
      return;
    }
    case 'thanks': {
      p.x = c.toX - a.spec.x;
      p.z = c.toZ - a.spec.z;
      p.turn = wrap(bearing(c.toX, c.toZ, c.glassX, c.glassZ) - a.spec.heading);
      // Squeegee up like a salute, a nod, done.
      const up = envelope(k, 0, 0.25, 1.1, 1.4);
      arm(p, true, 2.2, 0.35, 1.0, 0, up);
      p.nod -= 0.12 * up;
      p.lean -= 0.05 * up;
      return;
    }
    case 'refused':
      faceAndStep(a, p, c.carX, c.carZ, 0.7, 0);
      shrug(p, t, envelope(k, 0, 0.3, 1.6, 2.1));
      return;
    case 'waveOff': {
      // Both arms sweeping the car on, a step back from it.
      faceAndStep(a, p, c.carX, c.carZ, 0.85, 0);
      const go = envelope(k, 0, 0.2, 1.7, 2.1);
      const sweep = Math.sin(t * 9);
      arm(p, false, 0.8 + 0.5 * sweep, 0.35, 0.7 - 0.4 * sweep, 0, go);
      arm(p, true, 0.8 + 0.5 * sweep, 0.35, 0.7 - 0.4 * sweep, 0, go);
      p.lean -= 0.1 * go;
      return;
    }
    default:
      return;
  }
}

/** Her weight on one leg and the hip out, the bag arm bent at the elbow and the other hand on her hip. */
function hipOut(p: BodyPose, t: number, w: number): void {
  const sway = Math.sin(t * 0.9);
  p.tilt += (0.1 + 0.03 * sway) * w;
  p.legL += 0.06 * w;
  p.legR -= 0.12 * w;
  p.twist += 0.08 * sway * w;
  arm(p, false, 0.35, 0.12, 1.45, 0.35, w);
  arm(p, true, -0.1, 0.55, 1.6, 0.9, w);
}

function travesti(a: Actor, t: number, p: BodyPose): void {
  const s = a.spec.seed * 13;
  const c = a.cue;
  if (!c || c.phase === 'idle' || c.phase === 'grumble') {
    hipOut(p, t, 1);
    // Now and then a hand through her hair, or a look down the road for the next car.
    const hair = spell(t, 7, 0.35, s + 60);
    arm(p, true, 2.3, 0.6, 2.3, 0.2, hair);
    p.tilt -= 0.08 * hair;
    const look = spell(t, 5.5, 0.4, s + 61);
    p.look += 0.7 * Math.sin(t * 0.4 + s) * look;
    return;
  }
  const k = c.t;
  // Round to the car and a step out to the kerb at it.
  const turnIn = c.phase === 'call' ? ease(k / 0.5) : 1;
  faceAndStep(a, p, c.carX, c.carZ, 0.9 * turnIn, c.phase === 'call' ? 1.1 * ease((k - 0.4) / 1.2) : 1.1);
  hipOut(p, t, 0.6);

  if (c.phase === 'wait') {
    // Leaning at the window, one finger calling it closer now and then.
    p.lean += 0.14;
    const come = spell(t, 2.6, 0.55, s + 62);
    arm(p, true, 1.25, 0.1, 1.2 + 0.5 * Math.sin(t * 9), 0.1, come);
    return;
  }

  // THE CALL: a lean, the finger — "vení, papi" — and a kiss blown off the palm at the driver.
  p.lean += 0.12 * ease(k / 0.8);
  const beckon = envelope(k, 0.5, 0.8, 3.0, 3.3);
  arm(p, true, 1.3, 0.15, 1.1 + 0.55 * Math.sin(t * 9), 0.1, beckon);
  const kiss = envelope(k, 3.2, 3.5, 4.3, 4.7);
  arm(p, true, 1.2 - 0.9 * ease((k - 3.9) / 0.4), 0.1, 2.3 - 1.8 * ease((k - 3.9) / 0.4), 0.3, kiss);
  p.nod -= 0.05 * kiss;
}

/** Both hands on the sides of the box hung at his belly. */
function holdBox(p: BodyPose, t: number, w: number): void {
  const sway = 0.04 * Math.sin(t * 1.1);
  arm(p, false, 0.42 + sway, -0.05, 1.05, 0.45, w);
  arm(p, true, 0.42 - sway, -0.05, 1.05, 0.45, w);
}

function medias(a: Actor, t: number, dt: number, p: BodyPose): void {
  const s = a.spec.seed * 13;
  const c = a.cue;
  if (!c) return;
  p.x = c.atX - a.spec.x;
  p.z = c.atZ - a.spec.z;
  const k = c.t;
  const selling = c.phase === 'call' || c.phase === 'wait' || c.phase === 'waveOff';
  // Round to the car while he sells it something, and otherwise the way his beat has him face.
  const want = selling ? bearing(c.atX, c.atZ, c.carX, c.carZ) : c.facing;
  const turnStep = (selling ? 5 : 2.6) * dt;
  a.facing += clamp(wrap(want - a.facing), -turnStep, turnStep);
  p.turn = wrap(a.facing - a.spec.heading);
  holdBox(p, t, 1);

  if (c.phase === 'idle') {
    const gait = c.striding;
    const swing = Math.sin(c.stride * 4.5) * 0.42 * gait;
    p.legL = p.legL * (1 - gait) + swing;
    p.legR = p.legR * (1 - gait) - swing;
    p.lift += gait * (-0.02 + 0.03 * Math.abs(Math.cos(c.stride * 4.5)));
    p.lean += 0.05 * gait;
    p.tilt *= 1 - gait;
    p.look *= 1 - 0.6 * gait;
    // Standing at an end of his beat: a pair held up at the street, now and then.
    const show = spell(t, 3.2, 0.55, s + 50) * (1 - gait);
    p.item = show;
    arm(p, true, 0.85 + 0.08 * Math.sin(t * 5), 0.3, 1.55 + 0.12 * Math.sin(t * 5 + 0.6), 0.1, show);
    return;
  }

  if (c.phase === 'grumble') {
    // Turns off the car, shrugs, and gets back to it.
    p.item = 0;
    shrug(p, t, envelope(k, 0.15, 0.45, 1.7, 2.2));
    p.nod += 0.08 * envelope(k, 1.2, 1.6, 2.0, 2.4);
    return;
  }

  if (c.phase === 'waveOff') {
    // Palms out at the car and a shake of the head: nothing to do with him.
    p.item = 0;
    const go = envelope(k, 0, 0.2, 1.7, 2.1);
    arm(p, false, 1.25, 0.45, 0.85, 0, go);
    arm(p, true, 1.25, 0.45, 0.85, 0, go);
    p.look += 0.32 * Math.sin(t * 10) * go;
    p.lean -= 0.12 * go;
    return;
  }

  // Pitching: a step off his line towards the car, a pair held up at it, the other hand talking.
  faceAndStep(a, p, c.carX, c.carZ, 0, c.phase === 'call' ? 0.8 * ease(k / 1.1) : 0.8);
  const startle = c.phase === 'call' ? envelope(k, 0, 0.3, 1.0, 1.4) : 0;
  if (c.mood === 'damaged') {
    // A hand to his head at the state of it.
    arm(p, false, 2.1, 0.55, 2.2, 0.5, startle);
  } else if (c.mood === 'clean') {
    // "Mirá vos, qué nave."
    arm(p, false, 0.45, 1.0, 0.35, 0, startle);
    p.lean -= 0.06 * startle;
  }
  const up = c.phase === 'call' ? ease((k - 0.3) / 0.4) : spell(t, 2.8, 0.6, s + 51);
  p.item = up;
  // Forearm up, so the pair stands up out of his fist at the driver, shaken a little.
  arm(p, true, 0.95 + 0.08 * Math.sin(t * 7), 0.2, 1.5 + 0.15 * Math.sin(t * 7 + 0.6), 0.1, up);
  const talk = c.phase === 'wait' ? spell(t, 2.2, 0.6, s + 52) : envelope(k, 1.3, 1.6, 3.8, 4.3);
  arm(p, false, 0.6 + 0.2 * Math.sin(t * 2.7), 0.2, 1.1 + 0.4 * Math.sin(t * 3.4 + 1), 0.2, talk * (1 - startle));
  p.nod -= 0.05;
}

/* ================================================================== the car */

/** How much of an act's head the car may take: bent over a cooler, they do not look up. */
function gazeWeight(a: Actor): number {
  // A hustler at work already looks where his work is: at the car, the space, the glass.
  if (a.cue && a.cue.phase !== 'idle') return 0.3;
  return a.spec.act === 'pace' ? 0.6 : a.spec.act === 'vendor' ? 0.7 : 1;
}

function react(a: Actor, t: number, dt: number, subject: CrowdSubject | null, p: BodyPose): void {
  const act = a.spec.act;
  let rel = 0;
  let dx = 0;
  let dz = 0;
  let dist = Infinity;
  if (subject) {
    dx = subject.x - (a.spec.x + p.x);
    dz = subject.z - (a.spec.z + p.z);
    dist = Math.hypot(dx, dz);
    rel = toward(a, p, subject.x, subject.z);
  }
  const closing = subject && dt > 0 && Number.isFinite(a.lastDist) ? (a.lastDist - dist) / dt : 0;
  a.lastDist = dist;

  const noticed = subject !== null && dist < (subject.speed > CROWD.noticeSpeed ? CROWD.noticeRadius : CROWD.noticeStill) ? 1 : 0;
  const hyped = subject !== null && subject.drifting && dist < CROWD.hypeRadius ? 1 : 0;
  const flinched = subject !== null && dist < CROWD.flinchRadius && closing > CROWD.flinchClosing ? 1 : 0;
  a.attention += (noticed - a.attention) * Math.min(1, dt * (noticed > a.attention ? 2.5 : 0.7));
  a.hype += (hyped - a.hype) * Math.min(1, dt * (hyped > a.hype ? 3 : 0.45));
  a.flinch += (flinched - a.flinch) * Math.min(1, dt * (flinched > a.flinch ? 10 : 1.2));

  // Turning the whole body: someone filming follows the car, someone waving it down faces it,
  // and a drift worth cheering brings everyone round most of the way.
  const follow = act === 'film' || act === 'hail' ? a.attention : act === 'pace' || act === 'vendor' ? 0 : a.hype * 0.85;
  const trackTarget = subject ? clamp(rel, -2.6, 2.6) * follow : 0;
  a.track += (trackTarget - a.track) * Math.min(1, dt * 1.8);
  p.turn += a.track;

  const gaze = a.attention * gazeWeight(a);
  if (gaze > 0.001) {
    const lookRel = wrap(rel - a.track);
    const head = clamp(lookRel, -1.15, 1.15);
    const shoulders = clamp(lookRel - head, -0.5, 0.5);
    p.look += (head - p.look) * gaze;
    p.twist += (shoulders - p.twist) * gaze;
    if (act !== 'phone' || a.hype > 0.5) p.nod += (0.02 - p.nod) * gaze * 0.7;
  }

  if (a.hype > 0.001) {
    const h = a.hype;
    if (act === 'phone' || act === 'pace') {
      // Phones up.
      arm(p, true, 1.3, 0.1, 0.45, 0.25, h);
    } else if (act !== 'film' && act !== 'hail' && act !== 'washer' && !(a.cue && a.cue.phase !== 'idle')) {
      const pump = Math.sin(t * 8.5);
      arm(p, false, 0.3, 2.45 + 0.25 * pump, 0.35 + 0.25 * pump, 0, h);
      arm(p, true, 0.3, 2.45 - 0.25 * pump, 0.35 - 0.25 * pump, 0, h);
      p.lift += 0.05 * Math.max(0, pump) * h;
      p.lean += (-0.05 - p.lean) * h;
    }
  }

  if (a.flinch > 0.001 && dist > 0.01) {
    const f = a.flinch;
    // Nobody here is solid, so a hustler gets properly out of the way instead of flinching in place.
    const step = a.cue ? HUSTLERS.dodgeStep : CROWD.flinchStep;
    p.x -= (dx / dist) * step * f;
    p.z -= (dz / dist) * step * f;
    arm(p, false, 1.0, 0.25, 1.4, 0.6, f);
    arm(p, true, 1.0, 0.25, 1.4, 0.6, f);
    p.lean += (-0.3 - p.lean) * f;
    p.nod += (-0.12 - p.nod) * f;
  }
}
