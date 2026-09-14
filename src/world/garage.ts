import type { ActivitySite, ObstacleBox } from '../core/types';
import type { MeetSide } from './carMeet';
import type { Rect } from './cityPlan';
import { frameAt, frameBox, lotFrame, type GasBox, type GasFrame } from './gasStation';

/**
 * LOCO MUSTANG'S GARAGE: a corner of a block given up for a workshop, where the car will one
 * day be tuned and modded. Not open yet (2026-09-14): the man out front says so, and that is
 * the whole of what it does (`src/sim/garage.ts`).
 *
 * After Juan's photographs of a street garage: a single-storey whitewashed block with a flat
 * parapet, stained and peeling; the garage mouth open in the middle with a white van backed
 * into the dark; a turquoise steel door either side of it, graffitied over, each with a little
 * rusted louvre in it; a house number and a meter box on the piers. The owner stands out front.
 *
 * Laid out like a gas station (`gasStation.ts`), in the same frame and with the same corner-lot
 * rules — the plots it touches are cut back to its edge (`clipBlocksToLots`) — so the colliders
 * made here and the art (`render/scene/env/garageBuilder.ts`) are the same boxes. `u` runs along
 * the front street, positive toward the corner street; `v` from the front edge into the lot.
 */

export interface GarageSpec {
  tag: string;
  label: string;
  /** The lot: pavement-edge to pavement-edge on its street sides. */
  lot: Rect;
  /** The street the garage mouth faces. */
  front: MeetSide;
  /** The second street, across the front: the apron is open to it too. */
  corner: MeetSide;
  /** Every side of the lot that is a street. Includes `front` and `corner`. */
  streets: MeetSide[];
}

/** Sizes (m). */
export const GARAGE = {
  /** The open concrete in front of the facade, where the car pulls up. */
  apron: 9,
  /** Top of the wall, and the parapet's lip above it. */
  height: 5.2,
  parapet: 0.45,
  /** How far the building stands in from the lot's ends and back. */
  margin: 0.5,
  /** The garage mouth: open, dark, and deep enough for the van at the back of it. */
  mouth: { width: 5.6, height: 3.9, depth: 11 },
  /** The brick piers either side of the mouth, and the turquoise doors past them. */
  pier: 1.5,
  door: { width: 4.4, height: 3.5 },
  /** The van backed in, rear to the street. */
  van: { length: 4.2, width: 1.75, height: 1.95 },
  /** Where Loco Mustang stands: beside the mouth, a step out from the wall. */
  stand: { u: -4.1, v: 7.3 },
  /** The ring on the apron where he talks to you. Like El Búho's: the paint IS the zone. */
  marker: { u: 0, v: 4.3, promptRadius: 5.5, exitRadius: 6.8 },
} as const;

export interface GarageParts {
  frame: GasFrame;
  /** The open concrete between the pavement and the facade: the part of the lot a car can use. */
  apron: Rect;
  /** The whole building, the mouth included, and the three solid blocks round the mouth. */
  building: GasBox;
  left: GasBox;
  right: GasBox;
  back: GasBox;
  /** The empty bay inside the mouth: floor to lintel. */
  bay: GasBox;
  van: GasBox;
  /** Centre of each turquoise door along the front, in `u`. */
  doorsU: [number, number];
  /** Where the man stands, which way he faces (radians about y, the rig's convention), and the ring. */
  stand: { x: number; z: number; rotY: number };
  marker: { x: number; z: number };
}

/** Outward unit normal of the front: the way the facade looks. */
export function garageFacing(f: GasFrame): { x: number; z: number } {
  return { x: -f.dx, z: -f.dz };
}

export function garageParts(s: GarageSpec): GarageParts {
  const f = lotFrame(s);
  const M = GARAGE;
  const L = f.length;
  const D = f.depth;
  const u0 = -L / 2 + M.margin;
  const u1 = L / 2 - M.margin;
  const v0 = M.apron;
  const v1 = D - M.margin;
  const mw = M.mouth.width / 2;
  const box = (ua: number, ub: number, va: number, vb: number, y0: number, y1: number): GasBox =>
    frameBox(f, (ua + ub) / 2, (va + vb) / 2, ub - ua, vb - va, y0, y1);

  const building = box(u0, u1, v0, v1, 0, M.height);
  const left = box(u0, -mw, v0, v1, 0, M.height);
  const right = box(mw, u1, v0, v1, 0, M.height);
  const back = box(-mw, mw, v0 + M.mouth.depth, v1, 0, M.height);
  const bay = box(-mw, mw, v0, v0 + M.mouth.depth, 0, M.mouth.height);
  const vb = v0 + M.mouth.depth - 0.5;
  const van = box(-M.van.width / 2 + 0.25, M.van.width / 2 + 0.25, vb - M.van.length, vb, 0, M.van.height);
  const doorU = mw + M.pier + M.door.width / 2;

  const out = garageFacing(f);
  const at = frameAt(f, M.stand.u, M.stand.v);
  const ring = frameAt(f, M.marker.u, M.marker.v);
  const apronBox = box(-L / 2, L / 2, 0, v0, 0, 0);
  return {
    frame: f,
    apron: { minX: apronBox.minX, maxX: apronBox.maxX, minZ: apronBox.minZ, maxZ: apronBox.maxZ },
    building,
    left,
    right,
    back,
    bay,
    van,
    doorsU: [-doorU, doorU],
    // The rig faces local -z; turned by `rotY` it faces (-sin, -cos), which is to say the street.
    stand: { x: at.x, z: at.z, rotY: Math.atan2(-out.x, -out.z) },
    marker: ring,
  };
}

/** Everything solid on the lot, from the same boxes the art draws. The mouth is open to the van. */
export function garageColliders(s: GarageSpec): ObstacleBox[] {
  const p = garageParts(s);
  const box = (b: GasBox, tag: string): ObstacleBox => ({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, maxY: b.y1, tag });
  return [box(p.left, 'garage-wall'), box(p.right, 'garage-wall'), box(p.back, 'garage-wall'), box(p.van, 'garage-van')];
}

/** The garage as an activity site: the ring on the apron, facing the street, with the lot's name. */
export function garageSite(s: GarageSpec): ActivitySite {
  const p = garageParts(s);
  const out = garageFacing(p.frame);
  // A site's heading is the way it looks: 0 north (-z), increasing toward east.
  return { x: p.marker.x, z: p.marker.z, y: 0, heading: Math.atan2(out.x, -out.z), label: s.label };
}
