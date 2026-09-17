import * as THREE from 'three';
import { MeshBuilder } from './meshBuilder';

/**
 * THE PEOPLE OF THIS CITY, as one object.
 *
 * El Búho was the first person in the game with a body (`buhoFigure.ts`): nine boxes out of the
 * city's own `MeshBuilder`, merged, vertex-coloured and lit by the same two lights as the kerb
 * he stands on. He worked, so everyone else is built the same way — but there is no reason for
 * a second character to be a second pile of hand-placed boxes. This file is the body; a
 * character is a `HumanLook`, which is data.
 *
 * WHAT A CHARACTER IS. Boots, legs, a coat, two arms, a head, whatever is on that head, one
 * thing they are carrying, and one thing about them that glows. Every one of those takes a
 * colour and a handful of choices from a short list, so the whole of what makes Vera not Mika
 * fits in a dozen lines you can read at a glance (`passengerFigure.ts`, `buhoFigure.ts`).
 * Nobody edits geometry to add a passenger.
 *
 * PROPORTIONS. One reference body, 1.96 m to the top of the head — hair and hats sit above that,
 * as they do on a person — standing at its own origin, facing local -z, with its feet at y = 0.
 * `height` scales it, `build` widens the shoulders.
 *
 * RIGGED, NOT POSED. Every box belongs to one of `HUMAN_BONES` — hips, spine, head, two legs,
 * two upper arms, two forearms, and the hand that holds a phone or a camera — and the geometry
 * carries that as a per-vertex `aBone` attribute, with each bone's joint in `HumanParts.joints`.
 * The body is built standing straight with its arms at its sides; folded arms, a hand in a
 * pocket, a wave, a walk are all rotations of those bones (`humanActs.ts`), applied on the GPU
 * by a skinned mesh (`humanRig.ts`). Rigid boxes on joints is the whole of it: this city is
 * low-poly and seen from a moving car, and a knee would not be seen.
 *
 * DOM-FREE ON PURPOSE. Everything below is arithmetic and buffers, so a figure can be built and
 * measured in a test (`tests/humanFigure.test.ts`) without a canvas.
 */

/** What the arms do while nothing else is asking for them. The rig poses them; the mesh is the same. */
export type HumanPose =
  /** Both arms hanging. */
  | 'idle'
  /** One hanging, one tucked into the coat. */
  | 'pocket'
  /** Folded across the chest. */
  | 'folded'
  /** Flagging a car down. */
  | 'hail';

/**
 * What is on the head. `crop` is hair alone; the rest add to it. `bucket` is a bucket hat, brim all
 * round; `capBack` is the cap worn with its peak at the back; `long` falls past the shoulders.
 */
export type HumanHead = 'crop' | 'fringe' | 'mop' | 'tied' | 'cap' | 'capBack' | 'hood' | 'bucket' | 'long';

/** The one thing about a face that is visible at night, if anything is. */
export type HumanEyes = 'none' | 'eyes' | 'lenses' | 'visor';

/**
 * What they brought. `camera`, `cloth` (a trapito's fluorescent rag) and `squeegee` are held in the
 * hand; `sockBox` is a sock seller's cardboard box hung from the neck, with a pair of socks for the
 * hand that only shows while he holds it up; `purse` is a small bag hung by its strap from the left
 * forearm; the rest stand on the ground beside them.
 */
export type HumanProp = 'none' | 'cooler' | 'toolbag' | 'case' | 'camera' | 'cloth' | 'squeegee' | 'sockBox' | 'purse';

/**
 * One person's whole appearance. Only the colours are required: everything else has a default
 * that produces a plain figure in a coat.
 */
export interface HumanLook {
  /** 1 is the reference body, 1.96 m to the top of the head. */
  height?: number;
  /** Shoulder width and torso depth. 1 is average; 1.15 is a big coat. */
  build?: number;
  skin: number;
  hair: number;
  /** A fringe, a streak, a dyed front. Falls back to `hair`. */
  hairAccent?: number;
  head?: HumanHead;
  /** The cap's crown or the hood. Falls back to `coat`. */
  headwear?: number;
  coat: number;
  /** How far the coat hangs below the hip: 0 a cropped jacket, 1 a parka to mid-thigh. */
  coatLength?: number;
  legs: number;
  boots: number;
  /** A sleeveless shirt: the arms are bare from the shoulder, in `skin`. */
  sleeveless?: boolean;
  /** Short sleeves, a football shirt's: the arms are bare from above the elbow, in `skin`. */
  shortSleeves?: boolean;
  /** A band of this colour right round the chest, over `coat`: Boca's gold across the blue. */
  shirtBand?: number;
  /** A sash of this colour from the right shoulder to the left hip, front and back: River's red across the white. */
  shirtSash?: number;
  /**
   * A hi-vis vest over whatever `coat` is, open down the front so the shirt shows: a trapito's or a
   * washer's. Pair it with `band` for the reflective strip across it.
   */
  vest?: number;
  /** Shorts: bare from the knee down, in `skin`. */
  shorts?: boolean;
  /** A miniskirt in this colour round the hips, over legs in `legs` (tights, or `skin` for bare). */
  skirt?: number;
  /** High heels in `boots` instead of boots: a pointed toe, a thin heel, a strap round the ankle. */
  heels?: boolean;
  /** A stripe down the outside of each leg, in this colour: track pants. */
  legStripe?: number;
  /** A reused plastic bottle in the left hand, in this colour: a washer's. */
  bottle?: number;
  /** Ink on bare arms, in this colour: a sleeve of it down each upper arm and forearm. */
  tattoo?: number;
  /** A big number printed on the chest (two digits, drawn in blocks), in `print`. Loco Mustang's 99. */
  chestNumber?: string;
  print?: number;
  pose?: HumanPose;
  /**
   * How far to lean the body's normals towards the sky, 0..1. Defaults to `SKY_BIAS`.
   *
   * This city is lit at night by a hemisphere over a very weak key, and a hemisphere gives a
   * vertical surface the midpoint between sky and ground — which is why a person modelled out
   * of upright boxes comes out as a black cutout on a dark street. `MeshBuilder.normalUp` is
   * the same free fix the plants use: it says "some of this is facing up", costs no geometry,
   * and turns a silhouette back into somebody.
   */
  skyBias?: number;
  /**
   * A soft pool of light on the ground under them, in this colour. Nobody standing at a kerb at
   * night is visible from down the street without one; El Búho has had his from the start.
   * Omitted means no pool.
   */
  aura?: number;
  /** How wide that pool is (m). Defaults to `AURA_RADIUS`. */
  auraRadius?: number;
  eyes?: HumanEyes;
  eyeColor?: number;
  /** A lit strip across the chest, front and back: hi-vis, EL wire, a stream light. */
  band?: number;
  prop?: HumanProp;
  propColor?: number;
  /** The lit part of the prop: an amber tube on a cooler lid, the seam of a case. */
  propAccent?: number;
  /**
   * A phone in the right hand, with its screen lit this colour. Only seen while what they are
   * doing takes it out (`HumanPoseState.item`); the rest of the time it is folded away to nothing.
   */
  phone?: number;
}

/** The bones of a person, in skeleton order. `place` is where they stand and is never posed. */
export const HUMAN_BONES = [
  'place',
  'hips',
  'spine',
  'head',
  'legL',
  'legR',
  'upperArmL',
  'foreArmL',
  'upperArmR',
  'foreArmR',
  'hand',
] as const;
export type HumanBone = (typeof HUMAN_BONES)[number];
export const HUMAN_BONE_COUNT = HUMAN_BONES.length;
/** Index of a bone by name. */
export const BONE = Object.fromEntries(HUMAN_BONES.map((name, i) => [name, i])) as Record<HumanBone, number>;
/** Each bone's parent, by index; -1 for `place`, which hangs from whatever holds the person. */
export const HUMAN_BONE_PARENT: readonly number[] = [-1, 0, 1, 2, 1, 1, 2, 6, 2, 8, 9];

/** The geometry of one person, before anything is decided about materials or scene graph. */
export interface HumanParts {
  /** The person and what they hold, with `aBone`. Never null: everyone has a body. */
  body: THREE.BufferGeometry;
  /** What they set down beside them, or null. On `place`, so it has no `aBone`. */
  prop: THREE.BufferGeometry | null;
  /** The unlit accents, vertex-coloured so several colours share one mesh, with `aBone`. Null when unlit. */
  accent: THREE.BufferGeometry | null;
  /** The pool of light on the ground under them, or null. Additive; never lit; never moves. */
  aura: THREE.BufferGeometry | null;
  /** Each bone's joint relative to its parent's, three numbers a bone, in `HUMAN_BONES` order. */
  joints: Float32Array;
}

/* ================================================================== proportions */

/** The reference body, in metres at `height` 1. Everything below is written against these. */
const FOOT = 0.24;
const HIP = 0.88;
const SHOULDER = 1.58;
const NECK_TOP = 1.66;
const HEAD_Y = 1.8;
const HEAD_H = 0.32;
/**
 * Top of the bare head at `height` 1. Hair and headwear sit ON that, so a figure with a mop or
 * a cap measures a little taller — which is the same thing a real one does.
 */
export const HUMAN_CROWN = HEAD_Y + HEAD_H / 2;
const TORSO_W = 0.62;
const TORSO_D = 0.38;
/** The joints: where the head nods, the arms swing, the elbows bend and the legs step. */
const NECK_JOINT = 1.63;
const SHOULDER_JOINT = 1.48;
const ELBOW_JOINT = 1.2;
const WRIST = 0.93;
/** Where a held thing is gripped, at the bottom of the hand. */
const GRIP_JOINT = 0.86;
const LEG_X = 0.15;
/** Where shorts end. */
const KNEE = 0.5;
/** How high a heel lifts the ankle: where the bare leg ends in the shoe. */
const HEEL_TOP = 0.16;
/** A miniskirt: how far it rises above the hip joint and hangs below it. */
const SKIRT_RISE = 0.08;
const SKIRT_DROP = 0.26;
/** A purse on the left forearm: its middle, and its size (thin across the arm, long front to back). */
const PURSE = { y: 1.0, w: 0.08, h: 0.19, d: 0.27 } as const;
/** Where a short sleeve ends. */
const SHORT_SLEEVE = 1.34;
/** A sock seller's box, hung from the neck: its middle, its size, and how far in front of the chest. */
const SOCK_BOX = { y: 1.02, w: 0.56, h: 0.2, d: 0.3, gap: 0.02 } as const;
/** How far a body's normals lean towards the sky by default. See `HumanLook.skyBias`. */
const SKY_BIAS = 0.5;
/**
 * The default pool of light: how wide it is (m), how far off the ground, and how it is drawn.
 *
 * `AURA_Y` sits above the paint the markers are drawn at (0.035), which is itself above the
 * road: lower than that and the tarmac swallows the pool entirely, which is a thing that is
 * easier to see in a screenshot than to work out from the numbers.
 */
const AURA_RADIUS = 2.8;
const AURA_Y = 0.05;
const AURA_RINGS = 7;
const AURA_SEGMENTS = 14;

/** How far out from the middle the arms hang, before `height` scales it. */
function armOffset(build: number): number {
  return (TORSO_W * build) / 2 + 0.085;
}

/**
 * A thin wrapper over `MeshBuilder` that scales everything one figure emits, so the part
 * functions below can be written in the reference body's own numbers and never think about how
 * tall the person is — and that writes down which bone every vertex it emits belongs to.
 */
class Body {
  private current = BONE.spine;
  private readonly bones: number[] = [];

  constructor(
    private readonly b: MeshBuilder,
    private readonly k: number,
  ) {}

  /** Everything emitted from here on belongs to this bone. */
  bone(index: number): void {
    this.current = index;
  }

  color(hex: number, mul = 1): void {
    this.b.color(hex, mul);
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, bottom = false): void {
    const k = this.k;
    this.b.box(cx * k, cy * k, cz * k, sx * k, sy * k, sz * k, { bottom });
    this.tag();
  }

  /** A flat panel on the front (-z) or the back (+z) of the figure: bands, seams, lenses. */
  panel(cx: number, cy: number, cz: number, w: number, h: number, back = false): void {
    const k = this.k;
    this.b.panel(cx * k, cy * k, cz * k, w * k, h * k, back ? 0 : Math.PI);
    this.tag();
  }

  /**
   * A band running up the front (-z) or the back (+z) of the figure at a slant: `hw` either side of
   * `xb` at `y0`, and of `xt` at `y1`. A sash, drawn as one quad instead of a staircase of boxes.
   */
  slant(xb: number, y0: number, xt: number, y1: number, z: number, hw: number, back = false): void {
    const k = this.k;
    const zz = z * k;
    // Wound so the normal faces out of whichever side it is on.
    const s = back ? -1 : 1;
    this.b.quad(
      (xb + s * hw) * k, y0 * k, zz,
      (xb - s * hw) * k, y0 * k, zz,
      (xt - s * hw) * k, y1 * k, zz,
      (xt + s * hw) * k, y1 * k, zz,
    );
    this.tag();
  }

  /**
   * A disc facing the front (-z), as `seg / 2` quads: `MeshBuilder` has no circle, but a quad
   * whose first corner is the centre IS a two-triangle fan wedge, so eight segments cost four
   * quads and no new primitive in the shared builder.
   */
  disc(cx: number, cy: number, cz: number, r: number, seg = 8): void {
    const k = this.k;
    const x = cx * k;
    const y = cy * k;
    const z = cz * k;
    const rr = r * k;
    // Clockwise in XY, which is what puts the normal on -z.
    for (let i = 0; i < seg; i += 2) {
      const a0 = (-i / seg) * Math.PI * 2;
      const a1 = (-(i + 1) / seg) * Math.PI * 2;
      const a2 = (-(i + 2) / seg) * Math.PI * 2;
      this.b.quad(
        x, y, z,
        x + Math.cos(a0) * rr, y + Math.sin(a0) * rr, z,
        x + Math.cos(a1) * rr, y + Math.sin(a1) * rr, z,
        x + Math.cos(a2) * rr, y + Math.sin(a2) * rr, z,
      );
    }
    this.tag();
  }

  /**
   * A pool of light on the ground: concentric rings of quads facing +Y, each dimmer than the
   * one inside it, drawn additively so a dark ring is a transparent one.
   *
   * Rings rather than a texture, because a texture would mean a canvas — and the whole of this
   * file has to keep working in a test with no document. Seven of them over a quadratic falloff
   * is smooth enough on tarmac at the size a person's pool is.
   */
  pool(color: number, radius: number, rings: number, seg: number): void {
    const k = this.k;
    const y = AURA_Y * k;
    const r = radius * k;
    for (let i = 0; i < rings; i++) {
      const t = 1 - (i + 0.5) / rings;
      this.b.color(color, t * t);
      const r0 = (r * i) / rings;
      const r1 = (r * (i + 1)) / rings;
      for (let s = 0; s < seg; s++) {
        const a0 = (s / seg) * Math.PI * 2;
        const a1 = ((s + 1) / seg) * Math.PI * 2;
        const c0 = Math.cos(a0);
        const s0 = Math.sin(a0);
        const c1 = Math.cos(a1);
        const s1 = Math.sin(a1);
        this.b.quad(c0 * r0, y, s0 * r0, c1 * r0, y, s1 * r0, c1 * r1, y, s1 * r1, c0 * r1, y, s0 * r1);
      }
    }
  }

  /** Mark every vertex emitted since the last call as the current bone's. */
  private tag(): void {
    const vertices = this.b.triangles * 3;
    while (this.bones.length < vertices) this.bones.push(this.current);
  }

  /** The builder's geometry, with the bone of every vertex as `aBone`. */
  build(): THREE.BufferGeometry {
    const geo = this.b.build();
    geo.setAttribute('aBone', new THREE.BufferAttribute(Uint8Array.from(this.bones), 1));
    return geo;
  }
}

/* ================================================================== the parts */

/**
 * Digits in blocks, for a number printed on a shirt: each cell of a 3 x 5 grid that is ink.
 * Only what is printed on anybody so far.
 */
const PRINT_DIGITS: Record<string, readonly string[]> = {
  '9': ['###', '#.#', '###', '..#', '###'],
};

/** A number on the chest, over their right breast (the viewer's left), in blocks just proud of the shirt. */
function buildPrint(f: Body, look: HumanLook, d: number): void {
  const text = look.chestNumber;
  if (!text || look.print === undefined) return;
  f.bone(BONE.spine);
  f.color(look.print, 1);
  const cell = 0.034;
  const z = -d / 2 - 0.006;
  const top = 1.43;
  // Facing -z, their right is +x, and someone reading it from in front reads toward -x.
  let pen = 0.14 + ((text.length * 4 - 1) * cell) / 2;
  for (const ch of text) {
    const rows = PRINT_DIGITS[ch];
    rows?.forEach((row, r) => {
      for (let c = 0; c < 3; c++) {
        if (row[c] === '#') f.box(pen - (c + 0.5) * cell, top - (r + 0.5) * cell, z, cell * 1.02, cell * 1.02, 0.012);
      }
    });
    pen -= 4 * cell;
  }
}

/** Boots and legs. Two of everything; the boot is a little longer, so there is a toe. */
function buildLegs(f: Body, look: HumanLook): void {
  for (const side of [-1, 1]) {
    f.bone(side < 0 ? BONE.legL : BONE.legR);
    const x = side * LEG_X;
    const hem = look.heels ? HEEL_TOP : look.shorts ? KNEE : FOOT;
    f.color(look.legs, 1);
    if (look.skirt !== undefined) {
      // Slim legs under the skirt, down into the shoe.
      f.box(x, (hem + HIP) / 2, 0, 0.15, HIP - hem, 0.17);
    } else {
      f.box(x, (hem + HIP) / 2, 0, 0.22, HIP - hem, 0.26);
    }
    if (look.shorts) {
      f.color(look.skin, 1);
      f.box(x, (FOOT + KNEE) / 2, 0, 0.15, KNEE - FOOT, 0.17);
    }
    if (look.legStripe !== undefined) {
      f.color(look.legStripe, 1);
      f.box(x + side * 0.112, (hem + HIP) / 2, 0, 0.012, HIP - hem, 0.06);
    }
    f.color(look.boots, 1);
    if (look.heels) {
      // A pointed toe down on the ground, the heel up on a thin post, and a strap round the ankle.
      f.box(x, 0.035, -0.1, 0.1, 0.07, 0.16, true);
      f.box(x, 0.1, 0.02, 0.11, 0.06, 0.14);
      f.box(x, 0.06, 0.08, 0.035, 0.12, 0.035, true);
      f.box(x, HEEL_TOP - 0.02, 0, 0.14, 0.04, 0.16);
    } else {
      f.box(x, FOOT / 2, -0.02, 0.24, FOOT, 0.3, true);
    }
  }
  if (look.skirt !== undefined) {
    // On the hips, not the legs, so a stride never splits it.
    f.bone(BONE.hips);
    f.color(look.skirt, 1.05);
    f.box(0, HIP - (SKIRT_DROP - SKIRT_RISE) / 2, 0, LEG_X * 2 + 0.24, SKIRT_DROP + SKIRT_RISE, 0.3);
  }
}

/** The coat down to whatever its hem is, the shoulders on top of it, and the neck above that. */
function buildTorso(f: Body, look: HumanLook, w: number, d: number): void {
  f.bone(BONE.spine);
  const hem = HIP - 0.44 * (look.coatLength ?? 0.3);
  f.color(look.coat, 1.04);
  f.box(0, (hem + SHOULDER) / 2, 0, w, SHOULDER - hem, d, true);
  // A shoulder line: wider than the coat, darker, and thin. One box, and it is the difference
  // between a person and a slab — at distance the eye reads the notch under the head, not the
  // face it cannot see yet.
  f.color(look.coat, 0.8);
  f.box(0, SHOULDER - 0.05, 0, look.sleeveless ? w + 0.02 : w + 0.16, 0.12, d + 0.06);
  if (look.vest !== undefined) {
    // Open down the front: two panels and a gap the shirt shows through, the back whole, and the
    // sides. A shade proud of the coat everywhere so it never z-fights it.
    const top = SHOULDER - 0.11;
    const bottom = HIP - 0.08;
    const mid = (top + bottom) / 2;
    const h = top - bottom;
    const panel = w * 0.36;
    f.color(look.vest, 1.1);
    f.box(0, mid, d / 2 + 0.014, w + 0.028, h, 0.026);
    f.box(-(w / 2 - panel / 2) - 0.014, mid, -d / 2 - 0.014, panel, h, 0.026);
    f.box(w / 2 - panel / 2 + 0.014, mid, -d / 2 - 0.014, panel, h, 0.026);
    f.box(-w / 2 - 0.014, mid, 0, 0.026, h, d + 0.028);
    f.box(w / 2 + 0.014, mid, 0, 0.026, h, d + 0.028);
  }
  if (look.shirtBand !== undefined) {
    // Right round the chest, a shade proud of the shirt.
    f.color(look.shirtBand, 1.05);
    f.box(0, 1.25, 0, w + 0.014, 0.15, d + 0.014);
  }
  if (look.shirtSash !== undefined) {
    // Facing -z their right is +x: from the right shoulder down across to the left hip, and the
    // same line across the back.
    f.color(look.shirtSash, 1.05);
    f.slant(-w * 0.3, HIP + 0.02, w * 0.3, SHOULDER - 0.1, -d / 2 - 0.005, 0.075);
    f.slant(-w * 0.3, HIP + 0.02, w * 0.3, SHOULDER - 0.1, d / 2 + 0.005, 0.075, true);
  }
  // A stub of a neck, so the head is not sitting straight on the collar.
  f.color(look.skin, 0.9);
  f.box(0, (SHOULDER + NECK_TOP) / 2, 0, 0.16, NECK_TOP - SHOULDER, 0.16);
}

/**
 * Both arms, hanging: an upper arm, a forearm that tucks a little way up inside it so a bent
 * elbow never opens a gap, and a hand. Whatever the arms are doing is the rig's business.
 */
function buildArms(f: Body, look: HumanLook, armX: number): void {
  for (const side of [-1, 1]) {
    const x = side * armX;
    const sleeve = look.sleeveless ? look.skin : look.coat;
    f.bone(side < 0 ? BONE.upperArmL : BONE.upperArmR);
    if (look.shortSleeves && !look.sleeveless) {
      // The sleeve to a hand's width above the elbow, and the arm bare below it.
      f.color(look.coat, 1);
      f.box(x, (SHORT_SLEEVE + 1.56) / 2, 0, 0.17, 1.56 - SHORT_SLEEVE, 0.2);
      f.color(look.skin, 1);
      f.box(x, (ELBOW_JOINT + SHORT_SLEEVE) / 2, 0, 0.13, SHORT_SLEEVE - ELBOW_JOINT + 0.01, 0.15);
    } else {
      f.color(sleeve, 1);
      f.box(x, (ELBOW_JOINT + 1.56) / 2, 0, look.sleeveless ? 0.14 : 0.17, 1.56 - ELBOW_JOINT, look.sleeveless ? 0.16 : 0.2);
    }
    if (look.sleeveless && look.tattoo !== undefined) {
      // A band of ink round the upper arm, a shade proud of the skin so it never z-fights it.
      f.color(look.tattoo, 1);
      f.box(x, 1.34, 0, 0.15, 0.16, 0.17);
    }
    f.bone(side < 0 ? BONE.foreArmL : BONE.foreArmR);
    const bare = look.sleeveless || look.shortSleeves;
    f.color(bare ? look.skin : sleeve, bare ? 1 : 0.94);
    f.box(x, (WRIST + ELBOW_JOINT + 0.05) / 2, 0, bare ? 0.125 : 0.155, ELBOW_JOINT + 0.05 - WRIST, bare ? 0.15 : 0.185);
    if (look.sleeveless && look.tattoo !== undefined) {
      f.color(look.tattoo, 1);
      f.box(x, 1.06, 0, 0.135, 0.18, 0.16);
    }
    f.color(look.skin, 1);
    f.box(x, WRIST - 0.065, 0, 0.12, 0.13, 0.14);
  }
}

/** The head, the hair, and whatever is over it. */
function buildHead(f: Body, look: HumanLook): void {
  f.bone(BONE.head);
  const head = look.head ?? 'crop';
  const hairAccent = look.hairAccent ?? look.hair;
  const headwear = look.headwear ?? look.coat;
  f.color(look.skin, 1);
  f.box(0, HEAD_Y, 0, 0.3, HEAD_H, 0.3);

  if (head !== 'hood') {
    // A cap of hair over the skull, and down the back of it. The face is left bare.
    f.color(look.hair, 1);
    f.box(0, HEAD_Y + 0.14, 0.01, 0.32, 0.1, 0.32);
    f.box(0, HEAD_Y + 0.02, 0.15, 0.32, 0.28, 0.06);
  }

  switch (head) {
    case 'fringe':
      // A slab of colour over the brow, swept to one side.
      f.color(hairAccent, 1.1);
      f.box(0.03, HEAD_Y + 0.13, -0.09, 0.3, 0.12, 0.16);
      f.box(0.13, HEAD_Y + 0.04, -0.14, 0.1, 0.14, 0.06);
      break;
    case 'mop':
      // A mass of it, out past the ears and up.
      f.color(look.hair, 1);
      f.box(0, HEAD_Y + 0.18, 0.02, 0.42, 0.2, 0.4);
      f.box(-0.2, HEAD_Y + 0.06, 0.04, 0.1, 0.22, 0.3);
      f.box(0.2, HEAD_Y + 0.06, 0.04, 0.1, 0.22, 0.3);
      break;
    case 'long':
      // Down the back past the shoulders, and either side of the face.
      f.color(look.hair, 1);
      f.box(0, HEAD_Y + 0.17, 0.01, 0.35, 0.08, 0.35);
      f.box(0, HEAD_Y - 0.13, 0.15, 0.36, 0.56, 0.1);
      f.color(hairAccent, 1.05);
      f.box(-0.17, HEAD_Y - 0.05, 0.01, 0.06, 0.4, 0.28);
      f.box(0.17, HEAD_Y - 0.05, 0.01, 0.06, 0.4, 0.28);
      break;
    case 'tied':
      f.color(look.hair, 1);
      f.box(0, HEAD_Y + 0.04, 0.22, 0.16, 0.16, 0.14);
      break;
    case 'cap':
      // A crown and a peak, with the hair showing only under the back of it.
      f.color(headwear, 1.05);
      f.box(0, HEAD_Y + 0.19, 0.02, 0.33, 0.12, 0.33);
      f.box(0, HEAD_Y + 0.13, -0.19, 0.3, 0.05, 0.14);
      break;
    case 'capBack':
      // The same cap with the peak round the back of the neck.
      f.color(headwear, 1.05);
      f.box(0, HEAD_Y + 0.19, 0.02, 0.33, 0.12, 0.33);
      f.box(0, HEAD_Y + 0.13, 0.21, 0.3, 0.05, 0.14);
      break;
    case 'bucket':
      // A soft crown and a brim that droops all the way round: Loco Mustang's hat.
      f.color(headwear, 1);
      f.box(0, HEAD_Y + 0.17, 0.01, 0.35, 0.17, 0.35);
      f.color(headwear, 0.85);
      f.box(0, HEAD_Y + 0.08, 0.01, 0.5, 0.04, 0.5);
      break;
    case 'hood':
      // Up, and open at the front: the shape El Búho is known by.
      f.color(headwear, 1);
      f.box(0, HEAD_Y + 0.06, 0.12, 0.42, 0.44, 0.3);
      f.box(0, HEAD_Y + 0.26, 0, 0.42, 0.08, 0.5);
      f.box(-0.21, HEAD_Y + 0.06, -0.04, 0.06, 0.42, 0.24);
      f.box(0.21, HEAD_Y + 0.06, -0.04, 0.06, 0.42, 0.24);
      break;
    default:
      break;
  }
}

/**
 * What they hold, in the right hand, on the `hand` bone. Both are built hanging from the grip
 * with the arm at their side, which is to say sideways: a camera's lens points down the forearm,
 * so it looks where the hand points once the elbow is bent to film; a phone's screen faces
 * forward, so it faces the eyes once it is lifted to read.
 */
function buildHeld(f: Body, look: HumanLook, armX: number): void {
  f.bone(BONE.hand);
  if (look.prop === 'cloth') {
    // A rag hanging from the fist, flat to the front so it reads when it is waved.
    f.color(look.propColor ?? 0xff7a1a, 1.15);
    f.box(armX + 0.04, GRIP_JOINT - 0.25, -0.02, 0.3, 0.42, 0.025);
  } else if (look.prop === 'squeegee') {
    // A handle down from the fist and the blade across the end of it, sponge side to the front.
    f.color(look.propColor ?? 0xe0b020, 1);
    f.box(armX, GRIP_JOINT - 0.22, -0.02, 0.04, 0.44, 0.04);
    f.color(0x1c1d20, 1);
    f.box(armX, GRIP_JOINT - 0.46, -0.02, 0.36, 0.05, 0.05);
    f.color(0x8fd14f, 0.9);
    f.box(armX, GRIP_JOINT - 0.46, -0.06, 0.34, 0.07, 0.035);
  } else if (look.prop === 'sockBox') {
    // A pair of socks hanging from the fist, held up at whoever is in the car.
    f.color(0xe9e6de, 1);
    f.box(armX - 0.03, GRIP_JOINT - 0.17, -0.02, 0.055, 0.3, 0.03);
    f.box(armX + 0.03, GRIP_JOINT - 0.17, -0.02, 0.055, 0.3, 0.03);
    f.color(0x2c3e8c, 1);
    f.box(armX, GRIP_JOINT - 0.06, -0.02, 0.125, 0.04, 0.035);
    buildSockBox(f, look);
  } else if ((look.prop ?? 'none') === 'camera') {
    f.color(look.propColor ?? 0x1a1a22, 1);
    f.box(armX, GRIP_JOINT - 0.1, -0.02, 0.16, 0.24, 0.22);
    f.color(look.propColor ?? 0x1a1a22, 0.7);
    f.box(armX, GRIP_JOINT - 0.26, -0.02, 0.12, 0.08, 0.12);
  } else if (look.phone !== undefined) {
    f.color(0x15161a, 1);
    f.box(armX, GRIP_JOINT - 0.04, -0.02, 0.09, 0.16, 0.03);
  }
  if (look.prop === 'purse') {
    // Hung by its strap from the crook of the left elbow, riding the forearm.
    f.bone(BONE.foreArmL);
    const px = -armX - 0.1;
    f.color(look.propColor ?? 0x111114, 1);
    f.box(px, PURSE.y, 0, PURSE.w, PURSE.h, PURSE.d);
    f.color(look.propColor ?? 0x111114, 0.7);
    f.box(px + 0.04, PURSE.y + PURSE.h / 2 + 0.05, -0.07, 0.02, 0.1, 0.02);
    f.box(px + 0.04, PURSE.y + PURSE.h / 2 + 0.05, 0.07, 0.02, 0.1, 0.02);
  }
  if (look.bottle !== undefined) {
    // Held by the neck in the other hand, on the forearm so it swings with it, never put away.
    f.bone(BONE.foreArmL);
    f.color(look.bottle, 1);
    f.box(-armX, WRIST - 0.24, -0.02, 0.09, 0.22, 0.09);
    f.color(0xe8eef2, 1);
    f.box(-armX, WRIST - 0.11, -0.02, 0.04, 0.05, 0.04);
  }
}

/**
 * The box itself, on the spine so it swings with the body: cardboard, rows of rolled socks on top,
 * a hand-written sign on the front, and the strap up over both shoulders.
 */
function buildSockBox(f: Body, look: HumanLook): void {
  f.bone(BONE.spine);
  const d = TORSO_D * (look.build ?? 1);
  const B = SOCK_BOX;
  const z = -d / 2 - B.gap - B.d / 2;
  f.color(look.propColor ?? 0xb08450, 1);
  f.box(0, B.y, z, B.w, B.h, B.d);
  // Three rows of rolled pairs: white, black, and the loud ones.
  const top = B.y + B.h / 2 + 0.025;
  f.color(0xe9e6de, 1);
  f.box(0, top, z - B.d * 0.3, B.w - 0.06, 0.05, 0.08);
  f.color(0x1b1c20, 1);
  f.box(0, top, z, B.w - 0.06, 0.05, 0.08);
  f.color(0xd2335a, 1);
  f.box(0, top, z + B.d * 0.3, B.w - 0.06, 0.05, 0.08);
  // The sign, and the price scrawled across it.
  f.color(0xf1ece0, 1);
  f.panel(0, B.y - 0.01, z - B.d / 2 - 0.004, 0.34, 0.12);
  f.color(0xc0182a, 1);
  f.panel(0, B.y - 0.01, z - B.d / 2 - 0.007, 0.24, 0.035);
  // The strap: up the chest either side and over the shoulders.
  f.color(0x2a2622, 1);
  for (const side of [-1, 1]) {
    f.box(side * 0.17, (B.y + SHOULDER) / 2 + 0.05, -d / 2 - 0.012, 0.04, SHOULDER - B.y + 0.02, 0.018);
    f.box(side * 0.17, SHOULDER + 0.015, 0, 0.04, 0.02, d + 0.03);
  }
}

/** What they set down beside them. Its own mesh, on `place`, because the ground does not move. */
function buildGrounded(f: Body, look: HumanLook): void {
  switch (look.prop) {
    case 'cooler':
      // The whole shop, at his feet.
      f.color(look.propColor ?? 0x2a3a48, 1.1);
      f.box(-0.95, 0.24, -0.1, 0.7, 0.48, 0.5, true);
      f.color(look.propColor ?? 0x2a3a48, 0.8);
      f.box(-0.95, 0.5, -0.1, 0.74, 0.05, 0.54);
      break;
    case 'toolbag':
      f.color(look.propColor ?? 0x2b2f33, 1);
      f.box(-0.62, 0.17, -0.04, 0.6, 0.34, 0.34, true);
      f.color(look.propColor ?? 0x2b2f33, 0.75);
      f.box(-0.62, 0.4, -0.04, 0.06, 0.14, 0.3);
      break;
    case 'case':
      // A padded flight case standing on end against their leg.
      f.color(look.propColor ?? 0x23281f, 1);
      f.box(-0.62, 0.42, -0.02, 0.22, 0.84, 0.58, true);
      f.color(look.propColor ?? 0x23281f, 0.75);
      f.box(-0.62, 0.86, -0.02, 0.26, 0.06, 0.62);
      break;
    default:
      break;
  }
}

/** Everything that is lit from inside: the face, the band, the screen, the prop's seam. */
function buildAccents(f: Body, look: HumanLook, w: number, d: number, armX: number): void {
  const eyes = look.eyes ?? 'none';
  const eyeColor = look.eyeColor ?? 0xf0b34a;
  const face = -0.16;
  f.bone(BONE.head);
  if (eyes === 'lenses') {
    // Two round lenses where the eyes would be. Owls.
    f.color(eyeColor, 1);
    f.disc(-0.09, HEAD_Y + 0.02, face - 0.02, 0.09);
    f.disc(0.09, HEAD_Y + 0.02, face - 0.02, 0.09);
  } else if (eyes === 'eyes') {
    f.color(eyeColor, 1);
    f.panel(-0.08, HEAD_Y + 0.03, face - 0.01, 0.07, 0.035);
    f.panel(0.08, HEAD_Y + 0.03, face - 0.01, 0.07, 0.035);
  } else if (eyes === 'visor') {
    f.color(eyeColor, 1);
    f.panel(0, HEAD_Y + 0.03, face - 0.01, 0.26, 0.07);
  }

  if (look.band !== undefined) {
    // Across the chest and across the back, so it reads from either side of the street.
    f.bone(BONE.spine);
    f.color(look.band, 1);
    const proud = look.vest !== undefined ? 0.03 : 0.012;
    f.panel(0, 1.3, -d / 2 - proud, w * 0.92, 0.08);
    f.panel(0, 1.3, d / 2 + proud, w * 0.92, 0.08, true);
  }

  f.bone(BONE.hand);
  if (look.phone !== undefined && look.prop !== 'camera') {
    f.color(look.phone, 1);
    f.panel(armX, GRIP_JOINT - 0.04, -0.037, 0.07, 0.13);
  }

  if (look.propAccent === undefined) return;
  f.color(look.propAccent, 1);
  f.bone(BONE.place);
  switch (look.prop) {
    case 'cooler':
      // One warm tube on the lid, the same strip the stalls under the deck run.
      f.box(-0.95, 0.55, -0.36, 0.72, 0.05, 0.05);
      break;
    case 'case':
      f.panel(-0.62, 0.42, -0.32, 0.5, 0.045);
      break;
    case 'toolbag':
      f.panel(-0.62, 0.2, -0.22, 0.44, 0.04);
      break;
    case 'cloth':
      // A reflective strip across the rag: it is the thing a driver sees first.
      f.bone(BONE.hand);
      f.panel(armX + 0.04, GRIP_JOINT - 0.3, -0.036, 0.28, 0.05);
      break;
    case 'sockBox': {
      // A strip of battery LEDs taped along the box's top edge: how anyone sees him after dark.
      f.bone(BONE.spine);
      const d = TORSO_D * (look.build ?? 1);
      f.panel(0, SOCK_BOX.y + SOCK_BOX.h / 2 - 0.02, -d / 2 - SOCK_BOX.gap - SOCK_BOX.d - 0.006, SOCK_BOX.w - 0.04, 0.025);
      break;
    }
    case 'purse':
      // The clasp: a glint of gold on its front edge.
      f.bone(BONE.foreArmL);
      f.panel(-armX - 0.1, PURSE.y + 0.03, -PURSE.d / 2 - 0.004, PURSE.w - 0.02, 0.03);
      break;
    case 'camera':
      // The dot that says it is recording, on the face that is on top while they film.
      f.bone(BONE.hand);
      f.panel(armX + 0.04, GRIP_JOINT - 0.08, -0.135, 0.05, 0.05);
      break;
    default:
      break;
  }
}

/** Each bone's joint relative to its parent, for this body. */
function buildJoints(k: number, armX: number): Float32Array {
  const j = new Float32Array(HUMAN_BONE_COUNT * 3);
  const set = (bone: number, x: number, y: number, z: number): void => {
    j[bone * 3] = x * k;
    j[bone * 3 + 1] = y * k;
    j[bone * 3 + 2] = z * k;
  };
  set(BONE.hips, 0, HIP, 0);
  set(BONE.head, 0, NECK_JOINT - HIP, 0);
  set(BONE.legL, -LEG_X, 0, 0);
  set(BONE.legR, LEG_X, 0, 0);
  set(BONE.upperArmL, -armX, SHOULDER_JOINT - HIP, 0);
  set(BONE.upperArmR, armX, SHOULDER_JOINT - HIP, 0);
  set(BONE.foreArmL, 0, ELBOW_JOINT - SHOULDER_JOINT, 0);
  set(BONE.foreArmR, 0, ELBOW_JOINT - SHOULDER_JOINT, 0);
  set(BONE.hand, 0, GRIP_JOINT - ELBOW_JOINT, 0);
  return j;
}

/** Where each bone's joint is with the body standing at rest, relative to its feet. */
export function restJoints(joints: Float32Array): Float32Array {
  const out = new Float32Array(joints.length);
  for (let i = 0; i < HUMAN_BONE_COUNT; i++) {
    const p = HUMAN_BONE_PARENT[i];
    for (let c = 0; c < 3; c++) out[i * 3 + c] = joints[i * 3 + c] + (p >= 0 ? out[p * 3 + c] : 0);
  }
  return out;
}

/* ================================================================== assembly */

/**
 * One person's geometry, standing at their own origin facing local -z, with every vertex tagged
 * with its bone. Nothing here touches the document, so it can be built and measured in a test.
 */
export function buildHumanParts(look: HumanLook): HumanParts {
  const k = look.height ?? 1;
  const build = look.build ?? 1;
  const w = TORSO_W * build;
  const d = TORSO_D * build;
  const armX = armOffset(build);

  // A small fillet on the shading only: free, and it stops a person reading as a stack of
  // crates. The sky bias is what stops them reading as a black one — see `HumanLook.skyBias`.
  const sky = look.skyBias ?? SKY_BIAS;
  const bodyBuilder = new MeshBuilder(true);
  bodyBuilder.soft(0.06).normalUp(sky);
  const body = new Body(bodyBuilder, k);
  buildLegs(body, look);
  buildTorso(body, look, w, d);
  buildArms(body, look, armX);
  buildPrint(body, look, d);
  buildHead(body, look);
  buildHeld(body, look, armX);

  const propBuilder = new MeshBuilder(true);
  propBuilder.soft(0.05).normalUp(sky);
  buildGrounded(new Body(propBuilder, k), look);

  const accentBuilder = new MeshBuilder(true);
  const accent = new Body(accentBuilder, k);
  buildAccents(accent, look, w, d, armX);

  const auraBuilder = new MeshBuilder(true);
  if (look.aura !== undefined) {
    new Body(auraBuilder, k).pool(look.aura, look.auraRadius ?? AURA_RADIUS, AURA_RINGS, AURA_SEGMENTS);
  }

  return {
    body: body.build(),
    prop: propBuilder.empty ? null : propBuilder.build(),
    accent: accentBuilder.empty ? null : accent.build(),
    aura: auraBuilder.empty ? null : auraBuilder.build(),
    joints: buildJoints(k, armX),
  };
}
