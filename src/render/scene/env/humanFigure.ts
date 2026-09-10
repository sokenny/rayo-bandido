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
 * `height` scales it, `build` widens the shoulders. Poses are axis-aligned boxes rather than a
 * rig: this city is low-poly and seen from a moving car.
 *
 * A FEW MESHES, THREE MATERIALS, NOTHING PER FRAME:
 *   `body`   - everything attached to the person, including what they carry. Sways.
 *   `prop`   - what they set on the ground. Does NOT sway, because a cooler does not.
 *   `accent` - the unlit bits: lenses, an LED, a hi-vis band, the seam of a glowing case.
 *   `aura`   - the pool of light they stand in, so they can be seen at all on a dark street.
 *   `arm`    - the one raised arm, when a look hails. The only thing animated by more than a
 *              scalar write.
 * The lit meshes share one `MeshStandardMaterial`, and every optional mesh is skipped entirely
 * when a look does not ask for it — a plain figure is one mesh.
 *
 * DOM-FREE ON PURPOSE. Everything below is arithmetic and buffers, so a figure can be built and
 * measured in a test (`tests/humanFigure.test.ts`) without a canvas.
 */

/** What the arms are doing. Poses are static box arrangements; only `hail` moves. */
export type HumanPose =
  /** Both arms hanging. */
  | 'idle'
  /** One hanging, one tucked into the coat. */
  | 'pocket'
  /** Folded across the chest. */
  | 'folded'
  /** One hanging, one raised and waving the car down. */
  | 'hail';

/** What is on the head. `crop` is hair alone; the rest add to it. */
export type HumanHead = 'crop' | 'fringe' | 'mop' | 'tied' | 'cap' | 'hood';

/** The one thing about a face that is visible at night, if anything is. */
export type HumanEyes = 'none' | 'eyes' | 'lenses' | 'visor';

/** What they brought. `camera` is carried; the rest stand on the ground beside them. */
export type HumanProp = 'none' | 'cooler' | 'toolbag' | 'case' | 'camera';

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
}

/** The geometry of one person, before anything is decided about materials or scene graph. */
export interface HumanParts {
  /** The person and what they carry. Never null: everyone has a body. */
  body: THREE.BufferGeometry;
  /** What they set down beside them, or null. Built in the same space as `body`. */
  prop: THREE.BufferGeometry | null;
  /** The unlit accents, vertex-coloured so several colours share one mesh. Null when unlit. */
  accent: THREE.BufferGeometry | null;
  /** The raised arm, built about its own shoulder. Null unless the pose is `hail`. */
  arm: THREE.BufferGeometry | null;
  /** Where that shoulder is, in the same space as `body`. */
  armPivot: THREE.Vector3;
  /** The pool of light on the ground under them, or null. Additive; never lit. */
  aura: THREE.BufferGeometry | null;
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
/** Where the hailing arm turns. */
const SHOULDER_PIVOT_Y = 1.5;
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

/**
 * A thin wrapper over `MeshBuilder` that scales and offsets everything one figure emits, so the
 * part functions below can be written in the reference body's own numbers and never think about
 * where the person is standing or how tall they are.
 */
class Body {
  constructor(
    private readonly b: MeshBuilder,
    private readonly k: number,
    private readonly ox = 0,
    private readonly oy = 0,
    private readonly oz = 0,
  ) {}

  color(hex: number, mul = 1): void {
    this.b.color(hex, mul);
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, bottom = false): void {
    const k = this.k;
    this.b.box(this.ox + cx * k, this.oy + cy * k, this.oz + cz * k, sx * k, sy * k, sz * k, { bottom });
  }

  /** A flat panel on the front (-z) or the back (+z) of the figure: bands, seams, lenses. */
  panel(cx: number, cy: number, cz: number, w: number, h: number, back = false): void {
    const k = this.k;
    this.b.panel(this.ox + cx * k, this.oy + cy * k, this.oz + cz * k, w * k, h * k, back ? 0 : Math.PI);
  }

  /**
   * A disc facing the front (-z), as `seg / 2` quads: `MeshBuilder` has no circle, but a quad
   * whose first corner is the centre IS a two-triangle fan wedge, so eight segments cost four
   * quads and no new primitive in the shared builder.
   */
  disc(cx: number, cy: number, cz: number, r: number, seg = 8): void {
    const k = this.k;
    const x = this.ox + cx * k;
    const y = this.oy + cy * k;
    const z = this.oz + cz * k;
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
    const cx = this.ox;
    const y = this.oy + AURA_Y * k;
    const cz = this.oz;
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
        this.b.quad(
          cx + c0 * r0, y, cz + s0 * r0,
          cx + c1 * r0, y, cz + s1 * r0,
          cx + c1 * r1, y, cz + s1 * r1,
          cx + c0 * r1, y, cz + s0 * r1,
        );
      }
    }
  }
}

/* ================================================================== the parts */

/** Boots and legs. Two of everything; the boot is a little longer, so there is a toe. */
function buildLegs(f: Body, look: HumanLook): void {
  for (const side of [-1, 1]) {
    const x = side * 0.15;
    // The far leg stands a touch back, which is the whole of "standing" rather than "at attention".
    const z = side * 0.04;
    f.color(look.legs, 1);
    f.box(x, (FOOT + HIP) / 2, z, 0.22, HIP - FOOT, 0.26);
    f.color(look.boots, 1);
    f.box(x, FOOT / 2, z - 0.02, 0.24, FOOT, 0.3, true);
  }
}

/** The coat down to whatever its hem is, the shoulders on top of it, and the neck above that. */
function buildTorso(f: Body, look: HumanLook, w: number, d: number): void {
  const hem = HIP - 0.44 * (look.coatLength ?? 0.3);
  f.color(look.coat, 1.04);
  f.box(0, (hem + SHOULDER) / 2, 0, w, SHOULDER - hem, d, true);
  // A shoulder line: wider than the coat, darker, and thin. One box, and it is the difference
  // between a person and a slab — at distance the eye reads the notch under the head, not the
  // face it cannot see yet.
  f.color(look.coat, 0.8);
  f.box(0, SHOULDER - 0.05, 0, w + 0.16, 0.12, d + 0.06);
  // A stub of a neck, so the head is not sitting straight on the collar.
  f.color(look.skin, 0.9);
  f.box(0, (SHOULDER + NECK_TOP) / 2, 0, 0.16, NECK_TOP - SHOULDER, 0.16);
}

/**
 * The arms, in whatever the pose is. Everything here is axis-aligned: a raised arm is an L of
 * two boxes rather than a rotated one, which is the same trick the rest of the city's geometry
 * uses and reads identically at the distance a car sees it from.
 *
 * Returns the shoulder of the raised arm, when there is one, for the caller to pivot on.
 */
function buildArms(f: Body, look: HumanLook, w: number, d: number): { x: number } | null {
  const pose = look.pose ?? 'idle';
  const armX = w / 2 + 0.085;
  f.color(look.coat, 1);
  if (pose === 'folded') {
    // Two bars across the chest, one in front of the other: arms folded, waiting, cold.
    f.box(-0.02, 1.28, -d / 2 - 0.06, w + 0.12, 0.17, 0.19);
    f.box(0.02, 1.12, -d / 2 - 0.02, w + 0.06, 0.16, 0.18);
    // The upper arms still have to come off the shoulders, or the coat has no sleeves.
    f.box(-armX, 1.4, 0, 0.17, 0.3, 0.2);
    f.box(armX, 1.4, 0, 0.17, 0.3, 0.2);
    return null;
  }
  // The hanging arm, on the figure's left. Everyone has one.
  f.box(-armX, 1.22, 0, 0.17, 0.66, 0.2);
  if (pose === 'pocket') {
    // The other is shorter and forward: the hand is inside the coat.
    f.box(armX, 1.28, -0.06, 0.17, 0.58, 0.22);
    return null;
  }
  if (pose === 'hail') return { x: armX };
  f.box(armX, 1.22, 0.02, 0.17, 0.66, 0.2);
  return null;
}

/** The raised arm, built about its own shoulder so the mesh can be swung from it. */
function buildHailArm(f: Body, look: HumanLook): void {
  f.color(look.coat, 1);
  // Up out of the shoulder, then the forearm, then a hand.
  f.box(0, 0.24, 0, 0.17, 0.48, 0.2);
  f.box(0, 0.66, -0.02, 0.16, 0.42, 0.18);
  f.color(look.skin, 1);
  f.box(0, 0.93, -0.02, 0.15, 0.16, 0.16);
}

/** The head, the hair, and whatever is over it. */
function buildHead(f: Body, look: HumanLook): void {
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

/** What they hold: part of the person, so it sways with them. */
function buildCarried(f: Body, look: HumanLook, w: number): void {
  if ((look.prop ?? 'none') !== 'camera') return;
  const x = -(w / 2 + 0.085);
  f.color(look.propColor ?? 0x1a1a22, 1);
  // Held up at the chest, pointing at whoever is in front of them.
  f.box(x + 0.02, 1.16, -0.26, 0.22, 0.16, 0.24);
  f.color(look.propColor ?? 0x1a1a22, 0.7);
  f.box(x + 0.02, 1.16, -0.4, 0.12, 0.12, 0.06);
}

/** What they set down beside them. Its own mesh, because the ground does not sway. */
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

/** Everything that is lit from inside: the face, the band, the prop's seam. */
function buildAccents(f: Body, look: HumanLook, w: number, d: number): void {
  const eyes = look.eyes ?? 'none';
  const eyeColor = look.eyeColor ?? 0xf0b34a;
  const face = -0.16;
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
    f.color(look.band, 1);
    f.panel(0, 1.3, -d / 2 - 0.012, w * 0.92, 0.08);
    f.panel(0, 1.3, d / 2 + 0.012, w * 0.92, 0.08, true);
  }

  if (look.propAccent === undefined) return;
  f.color(look.propAccent, 1);
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
    case 'camera':
      // The dot that says it is recording, on the front of the lens housing.
      f.panel(-(w / 2 + 0.065), 1.22, -0.44, 0.05, 0.05);
      break;
    default:
      break;
  }
}

/* ================================================================== assembly */

/**
 * One person's geometry, standing at (`x`, `y`, `z`) facing local -z. Nothing here touches the
 * document, so it can be built and measured in a test.
 */
export function buildHumanParts(look: HumanLook, at?: { x?: number; y?: number; z?: number }): HumanParts {
  const k = look.height ?? 1;
  const build = look.build ?? 1;
  const w = TORSO_W * build;
  const d = TORSO_D * build;
  const ox = at?.x ?? 0;
  const oy = at?.y ?? 0;
  const oz = at?.z ?? 0;

  // A small fillet on the shading only: free, and it stops a person reading as a stack of
  // crates. The sky bias is what stops them reading as a black one — see `HumanLook.skyBias`.
  const sky = look.skyBias ?? SKY_BIAS;
  const bodyBuilder = new MeshBuilder(true);
  bodyBuilder.soft(0.06).normalUp(sky);
  const body = new Body(bodyBuilder, k, ox, oy, oz);
  buildLegs(body, look);
  buildTorso(body, look, w, d);
  const hail = buildArms(body, look, w, d);
  buildHead(body, look);
  buildCarried(body, look, w);

  const propBuilder = new MeshBuilder(true);
  propBuilder.soft(0.05).normalUp(sky);
  buildGrounded(new Body(propBuilder, k, ox, oy, oz), look);

  const accentBuilder = new MeshBuilder(true);
  buildAccents(new Body(accentBuilder, k, ox, oy, oz), look, w, d);

  const auraBuilder = new MeshBuilder(true);
  if (look.aura !== undefined) {
    new Body(auraBuilder, k, ox, oy, oz).pool(look.aura, look.auraRadius ?? AURA_RADIUS, AURA_RINGS, AURA_SEGMENTS);
  }

  // The raised arm is built about its own shoulder, so the mesh carrying it can be placed there
  // and simply rotated. Nothing else in a figure moves relative to anything else.
  let arm: THREE.BufferGeometry | null = null;
  const armPivot = new THREE.Vector3();
  if (hail) {
    const armBuilder = new MeshBuilder(true);
    armBuilder.soft(0.06);
    buildHailArm(new Body(armBuilder, k), look);
    arm = armBuilder.build();
    armPivot.set(ox + hail.x * k, oy + SHOULDER_PIVOT_Y * k, oz);
  }

  return {
    body: bodyBuilder.build(),
    prop: propBuilder.empty ? null : propBuilder.build(),
    accent: accentBuilder.empty ? null : accentBuilder.build(),
    arm,
    armPivot,
    aura: auraBuilder.empty ? null : auraBuilder.build(),
  };
}

/** A person in the scene: the meshes, the idle, and the one call that throws it all away. */
export interface HumanFigureVisual {
  /** Positioned and turned by the caller. The figure stands at its origin, facing local -z. */
  group: THREE.Group;
  /** Drives the idle. Cheap: a handful of scalar writes, nothing allocated. */
  update(time: number): void;
  dispose(): void;
}

export interface HumanFigureOptions {
  /**
   * Offsets the idle, so two people standing near each other do not breathe in time. Any
   * number will do; a character's own hash is as good as anything.
   */
  phase?: number;
  /** Name given to the group, for anyone reading a scene graph in the debugger. */
  name?: string;
}

/**
 * Builds one person and the small amount of life they have: a shift of weight, and — for
 * someone flagging a car down — the arm.
 *
 * Two to four meshes, two materials. The lit meshes share one `MeshStandardMaterial`, so a
 * person takes the street's own light like the kerb they stand on rather than looking like
 * something out of a cutscene.
 */
export function createHumanFigure(look: HumanLook, options: HumanFigureOptions = {}): HumanFigureVisual {
  const parts = buildHumanParts(look);
  const phase = options.phase ?? 0;
  const group = new THREE.Group();
  group.name = options.name ?? 'human';

  const litMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
  const body = new THREE.Mesh(parts.body, litMat);
  body.name = `${group.name}-body`;
  group.add(body);

  if (parts.prop) {
    const prop = new THREE.Mesh(parts.prop, litMat);
    prop.name = `${group.name}-prop`;
    group.add(prop);
  }

  let arm: THREE.Mesh | null = null;
  if (parts.arm) {
    arm = new THREE.Mesh(parts.arm, litMat);
    arm.name = `${group.name}-arm`;
    arm.position.copy(parts.armPivot);
    group.add(arm);
  }

  let auraMat: THREE.MeshBasicMaterial | null = null;
  if (parts.aura) {
    auraMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const aura = new THREE.Mesh(parts.aura, auraMat);
    aura.name = `${group.name}-aura`;
    aura.renderOrder = 2;
    group.add(aura);
  }

  let accentMat: THREE.MeshBasicMaterial | null = null;
  if (parts.accent) {
    accentMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      transparent: true,
      opacity: 0.95,
    });
    const accent = new THREE.Mesh(parts.accent, accentMat);
    accent.name = `${group.name}-accent`;
    group.add(accent);
  }

  return {
    group,
    update(time) {
      // A shift of weight, about their own axis: two slow sines that never quite line up.
      body.rotation.y = 0.05 * Math.sin(time * 0.37 + phase) + 0.02 * Math.sin(time * 1.3 + phase);
      // The raised arm swings from the shoulder, and turns with the body under it.
      if (arm) {
        arm.rotation.y = body.rotation.y;
        arm.rotation.z = -0.18 + 0.22 * Math.sin(time * 3.6 + phase);
      }
      // The lit parts breathe a little rather than sitting at one brightness, and the pool
      // under them breathes with them.
      if (accentMat) accentMat.color.setScalar(0.85 + 0.15 * Math.sin(time * 0.9 + phase));
      if (auraMat) auraMat.opacity = 0.64 + 0.1 * Math.sin(time * 0.9 + phase);
    },
    dispose() {
      group.clear();
      parts.body.dispose();
      parts.prop?.dispose();
      parts.accent?.dispose();
      parts.arm?.dispose();
      parts.aura?.dispose();
      litMat.dispose();
      accentMat?.dispose();
      auraMat?.dispose();
    },
  };
}
