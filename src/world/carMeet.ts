import type { ObstacleBox, ObstacleWall } from '../core/types';
import type { Rect } from './cityPlan';

/**
 * A CAR MEET: a lot the city gives up a block for, where the Bandidos park up at night. The
 * first one is under Bandido Metro's viaduct where its north-west corner swings round
 * (`metroSpec.ts`, `METRO_MEET`), after Daikoku: a flat lot with the curve of the highway
 * sweeping over it on its columns, a few tuned cars not all parked in their bays, people
 * standing around them, paint on everything.
 *
 * Data only, and the one place a meet's numbers are turned into shapes: the assembler
 * (`cityWorld.ts`) makes the colliders from `meetWalls` and `meetSolids`, the static art
 * (`env/meetBuilder.ts`) and the parked cars (`scene/meetVisual.ts`) draw from the same
 * two, so what you can see and what you can hit are the same boxes.
 *
 * Headings follow the game's convention: 0 faces -z (north), π/2 faces east.
 */

export type MeetSide = 'n' | 's' | 'e' | 'w';

/** What stands along a stretch of the lot's edge. Whatever no edge covers is a way in. */
export type MeetEdgeKind =
  /** A solid run of precast panels on posts, 3.4 m: the lot's wall of paint. */
  | 'hoarding'
  /** A low concrete wall with chain-link over it. */
  | 'fence'
  /** Jersey barriers, knee high, pushed together. */
  | 'barrier';

export interface MeetEdgeSpec {
  side: MeetSide;
  /** Along the side: x for 'n' and 's', z for 'e' and 'w'. */
  from: number;
  to: number;
  kind: MeetEdgeKind;
}

export interface MeetCarSpec {
  x: number;
  z: number;
  heading: number;
  /** Body paint. */
  paint: number;
  /** Underglow and sill tubes. */
  glow: number;
  /** Head lamps left on. */
  head?: boolean;
  /** Tail lamps lit. */
  tail?: boolean;
  /** Front wheels left on lock (rad, + to the car's right). */
  steer?: number;
}

export type MeetPersonKind = 'camera' | 'folded' | 'pocket' | 'cooler' | 'case' | 'idle' | 'phone';

/**
 * What a person at a meet is doing (`render/scene/env/humanActs.ts` draws it). Omitted, the kind
 * decides: a camera films, a cooler sells, a case or a phone is looked at, and anyone else talks
 * to whoever is standing nearest.
 */
export type MeetPersonAct = 'stand' | 'chat' | 'film' | 'phone' | 'pace' | 'vibe' | 'warm' | 'vendor' | 'inspect';

export interface MeetPersonSpec {
  x: number;
  z: number;
  heading: number;
  kind: MeetPersonKind;
  /** Picks the clothes, the hair and the skin: any integer. */
  seed: number;
  act?: MeetPersonAct;
  /** What they attend to: the drum they warm their hands at, the speakers, the car they look over. */
  focus?: { x: number; z: number };
  /**
   * `pace` only: the far end of the beat they walk from (x, z) and back. The beat is solid along
   * its whole length (`meetSolids`), so what can be hit is wherever they could be.
   */
  to?: { x: number; z: number };
}

export type MeetPropKind =
  | 'kiosk'
  | 'vending'
  | 'truck'
  | 'container'
  | 'mast'
  | 'barrel'
  | 'speakers'
  | 'tyres'
  | 'cones'
  | 'table'
  | 'sign';

export interface MeetPropSpec {
  kind: MeetPropKind;
  x: number;
  z: number;
  heading: number;
  /** Colour, where the kind has one: a truck's box, a container, a lamp's light. */
  color?: number;
  /** A mast's lamp is one of the failing ones. */
  faulty?: boolean;
}

export interface CarMeetSpec {
  tag: string;
  label: string;
  /** The lot. Every block touching it is cleared and the fences under a deck through it come down. */
  lot: Rect;
  edges: MeetEdgeSpec[];
  cars: MeetCarSpec[];
  people: MeetPersonSpec[];
  props: MeetPropSpec[];
}

/** Half the parked car's footprint (m): the coupe's body with its over-fenders. */
export const MEET_CAR_HALF = { across: 1.0, along: 2.3 } as const;
/** How tall a parked car is solid (m). */
export const MEET_CAR_HEIGHT = 1.5;
/** How far a person is solid round their feet (m). */
export const MEET_PERSON_HALF = 0.35;

/** Edge heights and thickness (m). The wall stands just inside the lot's line, on the lot. */
export const MEET_EDGE = {
  thick: 0.4,
  hoarding: 3.4,
  fenceWall: 0.9,
  fence: 2.6,
  barrier: 1.0,
} as const;

/**
 * Each prop's footprint and height (m): `along` is its length down its heading, `across` its
 * width. A mast is solid at its foot only; `vending` is a row of five machines against a wall.
 */
export const MEET_PROP_SIZE: Record<MeetPropKind, { along: number; across: number; height: number }> = {
  kiosk: { along: 6.5, across: 13, height: 3.9 },
  vending: { along: 0.8, across: 5.3, height: 1.9 },
  truck: { along: 9.2, across: 2.5, height: 4.1 },
  container: { along: 12.2, across: 2.44, height: 2.6 },
  mast: { along: 0.8, across: 0.8, height: 11 },
  barrel: { along: 0.7, across: 0.7, height: 1.0 },
  speakers: { along: 0.9, across: 1.4, height: 1.45 },
  tyres: { along: 0.8, across: 0.8, height: 1.1 },
  cones: { along: 1.6, across: 1.6, height: 0.7 },
  table: { along: 0.9, across: 1.9, height: 0.95 },
  sign: { along: 0.5, across: 0.5, height: 7 },
};

/** A box standing on the ground, turned to `heading`: what everything solid at a meet is. */
export interface MeetSolid {
  x: number;
  z: number;
  /** Unit direction of its length (the heading's forward). */
  fx: number;
  fz: number;
  halfAlong: number;
  halfAcross: number;
  height: number;
  tag: string;
}

/** Forward unit vector of a heading: 0 is north (-z). */
export function headingForward(heading: number): { fx: number; fz: number } {
  return { fx: Math.sin(heading), fz: -Math.cos(heading) };
}

/** The lot's edge runs, as segments on the inner face of the lot's line, with what they are. */
export function meetWalls(meet: CarMeetSpec): Array<MeetEdgeSpec & { ax: number; az: number; bx: number; bz: number; height: number }> {
  const { lot } = meet;
  const inset = MEET_EDGE.thick / 2;
  return meet.edges.map((e) => {
    const height = e.kind === 'hoarding' ? MEET_EDGE.hoarding : e.kind === 'fence' ? MEET_EDGE.fence : MEET_EDGE.barrier;
    const a = Math.min(e.from, e.to);
    const c = Math.max(e.from, e.to);
    switch (e.side) {
      case 'n':
        return { ...e, ax: a, az: lot.minZ + inset, bx: c, bz: lot.minZ + inset, height };
      case 's':
        return { ...e, ax: a, az: lot.maxZ - inset, bx: c, bz: lot.maxZ - inset, height };
      case 'w':
        return { ...e, ax: lot.minX + inset, az: a, bx: lot.minX + inset, bz: c, height };
      default:
        return { ...e, ax: lot.maxX - inset, az: a, bx: lot.maxX - inset, bz: c, height };
    }
  });
}

/** Every solid thing on the lot but its edges: the cars, the people and the props. */
export function meetSolids(meet: CarMeetSpec): MeetSolid[] {
  const out: MeetSolid[] = [];
  for (const c of meet.cars) {
    const { fx, fz } = headingForward(c.heading);
    out.push({ x: c.x, z: c.z, fx, fz, halfAlong: MEET_CAR_HALF.along, halfAcross: MEET_CAR_HALF.across, height: MEET_CAR_HEIGHT, tag: 'meet-car' });
  }
  for (const p of meet.people) {
    if (p.to) {
      // A pacer is solid along the beat: a box from one end to the other, a person wide.
      const dx = p.to.x - p.x;
      const dz = p.to.z - p.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.01) {
        out.push({
          x: (p.x + p.to.x) / 2,
          z: (p.z + p.to.z) / 2,
          fx: dx / len,
          fz: dz / len,
          halfAlong: len / 2 + MEET_PERSON_HALF,
          halfAcross: MEET_PERSON_HALF,
          height: 2,
          tag: 'meet-person',
        });
        continue;
      }
    }
    out.push({ x: p.x, z: p.z, fx: 0, fz: -1, halfAlong: MEET_PERSON_HALF, halfAcross: MEET_PERSON_HALF, height: 2, tag: 'meet-person' });
  }
  for (const p of meet.props) {
    const size = MEET_PROP_SIZE[p.kind];
    const { fx, fz } = headingForward(p.heading);
    out.push({ x: p.x, z: p.z, fx, fz, halfAlong: size.along / 2, halfAcross: size.across / 2, height: size.height, tag: `meet-${p.kind}` });
  }
  return out;
}

/** The four corners of a solid, anticlockwise from its back left. */
export function solidCorners(s: MeetSolid): Array<{ x: number; z: number }> {
  // Right of forward (fx, fz) is (-fz, fx).
  const rx = -s.fz;
  const rz = s.fx;
  const at = (a: number, c: number): { x: number; z: number } => ({ x: s.x + s.fx * a + rx * c, z: s.z + s.fz * a + rz * c });
  return [at(-s.halfAlong, -s.halfAcross), at(s.halfAlong, -s.halfAcross), at(s.halfAlong, s.halfAcross), at(-s.halfAlong, s.halfAcross)];
}

/**
 * The colliders of a meet. A box square to the axes is one `ObstacleBox`; a turned one is its
 * four sides as walls, the way a bus is (`cityWorld.ts`), so a car parked at an angle is solid
 * where it is drawn rather than inside the box round it.
 */
export function meetColliders(meet: CarMeetSpec): { boxes: ObstacleBox[]; walls: ObstacleWall[] } {
  const boxes: ObstacleBox[] = [];
  const walls: ObstacleWall[] = [];
  for (const e of meetWalls(meet)) {
    walls.push({ ax: e.ax, az: e.az, bx: e.bx, bz: e.bz, maxY: e.height, tag: `meet-${e.kind}` });
  }
  for (const s of meetSolids(meet)) {
    const square = Math.abs(s.fx) < 1e-6 || Math.abs(s.fz) < 1e-6;
    if (square) {
      const hx = Math.abs(s.fx) > 0.5 ? s.halfAlong : s.halfAcross;
      const hz = Math.abs(s.fx) > 0.5 ? s.halfAcross : s.halfAlong;
      boxes.push({ minX: s.x - hx, maxX: s.x + hx, minZ: s.z - hz, maxZ: s.z + hz, maxY: s.height, tag: s.tag });
      continue;
    }
    const k = solidCorners(s);
    for (let i = 0; i < 4; i++) {
      const a = k[i];
      const c = k[(i + 1) % 4];
      walls.push({ ax: a.x, az: a.z, bx: c.x, bz: c.z, maxY: s.height, tag: s.tag });
    }
  }
  return { boxes, walls };
}
