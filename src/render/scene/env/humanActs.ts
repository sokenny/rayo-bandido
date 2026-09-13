import { CROWD } from '../../../config/tuning';
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
  | 'hail';

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
}

export function createActor(spec: ActorSpec): Actor {
  const faceFocus = spec.focus && (spec.act === 'warm' || spec.act === 'inspect' || spec.act === 'vibe');
  const face = faceFocus ? bearing(spec.x, spec.z, spec.focus!.x, spec.focus!.z) : spec.heading;
  const toward = spec.to ? bearing(spec.x, spec.z, spec.to.x, spec.to.z) : face;
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

/* ================================================================== the car */

/** How much of an act's head the car may take: bent over a cooler, they do not look up. */
function gazeWeight(a: Actor): number {
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
    } else if (act !== 'film' && act !== 'hail') {
      const pump = Math.sin(t * 8.5);
      arm(p, false, 0.3, 2.45 + 0.25 * pump, 0.35 + 0.25 * pump, 0, h);
      arm(p, true, 0.3, 2.45 - 0.25 * pump, 0.35 - 0.25 * pump, 0, h);
      p.lift += 0.05 * Math.max(0, pump) * h;
      p.lean += (-0.05 - p.lean) * h;
    }
  }

  if (a.flinch > 0.001 && dist > 0.01) {
    const f = a.flinch;
    p.x -= (dx / dist) * CROWD.flinchStep * f;
    p.z -= (dz / dist) * CROWD.flinchStep * f;
    arm(p, false, 1.0, 0.25, 1.4, 0.6, f);
    arm(p, true, 1.0, 0.25, 1.4, 0.6, f);
    p.lean += (-0.3 - p.lean) * f;
    p.nod += (-0.12 - p.nod) * f;
  }
}
