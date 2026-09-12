import type { PassageDef, RibbonDef } from '../../../world/cityPlan';
import { onRibbonAtLevel } from '../../../world/cityGen';
import { createProjection, offsetAtStation, projectOntoPath, segmentCount } from '../../../world/track';
import { PAL } from './palette';
import { groundGlow, type EnvBuilders } from './builders';
import { downQuad } from './elevatedBuilder';

/**
 * ROADS INSIDE THE BUILDINGS, and the frames over the ones outside.
 *
 * A PASSAGE (`PassageDef`) is a stretch of road that the megastructure planner found under a
 * building's ceiling. The building's own walls and underside are drawn by the kit; what this
 * adds is what `city-v2-highway.webp` shows on its ceiling and walls, and nothing else:
 *
 *  - a pale soffit strip over the lane, because a downward face under the hemisphere light
 *    comes out black on its own (`elevatedBuilder.ts`, the same fix),
 *  - transverse concrete ribs every `RIB` metres — the ceiling's silhouette, real geometry,
 *  - two service runs along the ceiling's edges,
 *  - a recessed amber strip lamp every `LAMP` metres, its patch of light on the ceiling and
 *    its pool on the asphalt below,
 *  - on a walled side, a vertical amber bar every `WALL_BAR` metres at head height, and ONE
 *    red bar per passage: the single hot accent the brief allows a view.
 *
 * A PORTAL FRAME goes over every open stretch of the ribbons in `plan.portalFrames`, every
 * `FRAME` metres: two concrete piers bolted to the deck's edges, a beam across at lamp
 * height, a strip lamp under the beam with its pool. It is the structure the brief wants
 * within 40 m overhead wherever the L2 driver is not already inside a building.
 *
 * Everything lands in the shared per-material builders; the whole system is a few triangles
 * a metre, and nothing here is a light source the renderer has to visit.
 */

/** Rib, lamp and wall-bar spacing along a passage (m). */
const RIB = 9;
const LAMP = 12;
const WALL_BAR = 14;
/** Portal frame spacing along an open deck (m). */
const FRAME = 30;
/** Height of a frame's beam over the road (m). */
const FRAME_HEIGHT = 7.2;

const PROJ = createProjection();

export function buildPassages(b: EnvBuilders): void {
  for (const pd of b.plan.passages ?? []) {
    const rb = b.plan.ribbons.find((r) => r.tag === pd.tag);
    if (rb) buildPassage(b, rb, pd);
  }
}

function buildPassage(b: EnvBuilders, rb: RibbonDef, pd: PassageDef): void {
  const path = rb.path;
  const samples = path.samples;
  const segs = segmentCount(path);
  // The ceiling follows the road at the passage's clearance: level over a deck, climbing
  // with a ramp under the building's stepped underside.
  const clr = pd.clearance;

  /* ---------------------------------------------------------------- the soffit, the ducts */

  for (let i = 0; i < segs; i++) {
    const a = samples[i];
    const c = samples[(i + 1) % samples.length];
    const s0 = a.s;
    const s1 = i === segs - 1 && path.closed ? path.length : c.s;
    if (s1 <= pd.s0 || s0 >= pd.s1) continue;
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 0.1) continue;
    const dx = (c.x - a.x) / len;
    const dz = (c.z - a.z) / len;
    const nx = -dz;
    const nz = dx;
    const half = a.halfWidth + pd.margin;
    const cyA = a.y + clr;
    const cyC = c.y + clr;
    // Cast in panels like the viaduct soffit, a few percent apart in tone per segment. Faces
    // down: the winding is the mirror of the road's.
    const wear = 0.92 + ((i * 3) % 5) * 0.03;
    b.wall.color(PAL.curb, 5.2 * wear);
    {
      const w = half - 0.15;
      b.wall.quad(
        a.x + nx * w, cyA - 0.03, a.z + nz * w,
        c.x + nx * w, cyC - 0.03, c.z + nz * w,
        c.x - nx * w, cyC - 0.03, c.z - nz * w,
        a.x - nx * w, cyA - 0.03, a.z - nz * w,
      );
    }
    // Service runs down both edges of the ceiling: a rust conduit and a dark pipe.
    b.props.color(PAL.rust, 2.4);
    b.props.tube(a.x + nx * (half - 0.9), cyA - 0.45, a.z + nz * (half - 0.9), c.x + nx * (half - 0.9), cyC - 0.45, c.z + nz * (half - 0.9), 0.2);
    b.props.color(PAL.metalDark, 2.2);
    b.props.tube(a.x - nx * (half - 0.9), cyA - 0.5, a.z - nz * (half - 0.9), c.x - nx * (half - 0.9), cyC - 0.5, c.z - nz * (half - 0.9), 0.26);
  }

  /* ---------------------------------------------------------------- by station */

  const from = Math.max(0, pd.s0 + 1);
  const to = Math.min(path.length, pd.s1 - 1);
  const at = (s: number): { x: number; z: number; y: number; tx: number; tz: number; hw: number } => {
    const p = offsetAtStation(path, s, 0);
    return { x: p.x, z: p.z, y: p.y, tx: p.tx, tz: p.tz, hw: p.halfWidth };
  };

  // Ribs.
  for (let s = Math.ceil(from / RIB) * RIB; s < to; s += RIB) {
    const p = at(s);
    const half = p.hw + pd.margin;
    const cy = p.y + clr;
    b.wall.color(PAL.curb, 2.0 + ((s / RIB) % 3) * 0.3);
    b.wall.orientedBox(p.x, p.z, -p.tz, p.tx, half * 2 - 0.4, 0.7, cy - 1.0, cy - 0.02, { bottom: true });
  }

  // Strip lamps between the ribs, with their light on the ceiling and their pool on the road.
  for (let s = Math.ceil((from - LAMP / 2) / LAMP) * LAMP + LAMP / 2; s < to; s += LAMP) {
    const p = at(s);
    const cy = p.y + clr;
    const level = 0.9 + (((s / LAMP) * 7) % 5) * 0.05;
    // The housing: a dark steel channel let into the soffit, and the lit strip under it.
    b.props.color(PAL.metalDark, 1.6);
    b.props.orientedBox(p.x, p.z, -p.tz, p.tx, 5.2, 1.0, cy - 0.3, cy - 0.01, { bottom: true });
    b.neon.color(PAL.neonAmber, level);
    b.neon.orientedBox(p.x, p.z, -p.tz, p.tx, 4.6, 0.62, cy - 0.34, cy - 0.28, { bottom: true });
    b.glow.color(PAL.lampWarm, 0.5 * level);
    downQuad(b.glow, p.x, cy - 0.05, p.z, p.tx, p.tz, 8, 12);
    groundGlow(b, p.x, p.z, 12, 12, PAL.lampWarm, 0.16 * level, p.y + 0.035);
  }

  // Wall bars: amber up the walls at head height, and one red bar at the passage's middle.
  const mid = (pd.s0 + pd.s1) / 2;
  let redDone = false;
  for (let s = Math.ceil((from - WALL_BAR / 2) / WALL_BAR) * WALL_BAR + WALL_BAR / 2; s < to; s += WALL_BAR) {
    const p = at(s);
    for (const side of [-1, 1]) {
      if (side < 0 ? !pd.left : !pd.right) continue;
      const out = p.hw + pd.margin - 0.35;
      const x = p.x - p.tz * out * side;
      const z = p.z + p.tx * out * side;
      const red = !redDone && Math.abs(s - mid) < WALL_BAR;
      if (red) redDone = true;
      b.neon.color(red ? PAL.neonMagenta : PAL.neonAmber, red ? 0.7 : 0.75);
      b.neon.box(x, p.y + (red ? 3.6 : 3.2), z, 0.16, red ? 3.6 : 2.4, 0.16);
      // A little of it on the wall behind, and a smear of it on the wet lane.
      b.glow.color(red ? PAL.neonMagenta : PAL.neonAmber, 0.12);
      b.glow.panel(x + p.tz * 0.4 * side, p.y + 3.2, z - p.tx * 0.4 * side, 3.2, 5.5, Math.atan2(-p.tz * -side, p.tx * -side) + Math.PI / 2);
      groundGlow(b, p.x - p.tz * (p.hw - 1.5) * side, p.z + p.tx * (p.hw - 1.5) * side, 5, 9, red ? PAL.neonMagenta : PAL.neonAmber, 0.06, p.y + 0.03);
    }
  }
}

/* ------------------------------------------------------------------ portal frames */

export function buildPortalFrames(b: EnvBuilders): void {
  for (const tag of b.plan.portalFrames ?? []) {
    const rb = b.plan.ribbons.find((r) => r.tag === tag);
    if (!rb) continue;
    const passages = (b.plan.passages ?? []).filter((p) => p.tag === tag);
    const path = rb.path;
    let k = 0;
    for (let s = FRAME / 2; s < path.length; s += FRAME, k++) {
      // Not inside or at the mouth of a passage: the building is the frame there.
      if (passages.some((p) => s > p.s0 - 12 && s < p.s1 + 12)) continue;
      const c = offsetAtStation(path, s, 0);
      // Not at a merge: a pier in the mouth of a ramp is a pier in a lane.
      let merge = false;
      for (const other of b.plan.ribbons) {
        if (other === rb || !other.elevated) continue;
        if (onRibbonAtLevel(other, c.x, c.z, c.y, c.halfWidth + 3)) merge = true;
      }
      if (merge) continue;
      // Not under a crossing deck within the frame's own height and a bus.
      let covered = false;
      for (const other of b.plan.ribbons) {
        if (other === rb || !other.elevated) continue;
        projectOntoPath(other.path, c.x, c.z, PROJ);
        if (PROJ.dist <= PROJ.halfWidth + c.halfWidth + 3 && PROJ.y > c.y + 1 && PROJ.y < c.y + FRAME_HEIGHT + 8) covered = true;
      }
      if (covered) continue;
      // Not through a building: a pier standing in a wall is a pier standing in a wall.
      if (inBuilding(b, c.x - c.tz * (c.halfWidth + 1), c.z + c.tx * (c.halfWidth + 1), c.y + 4) || inBuilding(b, c.x + c.tz * (c.halfWidth + 1), c.z - c.tx * (c.halfWidth + 1), c.y + 4)) continue;
      portalFrame(b, c.x, c.y, c.z, c.tx, c.tz, c.halfWidth, k);
    }
  }
}

function inBuilding(b: EnvBuilders, x: number, z: number, y: number): boolean {
  for (const m of b.plan.megastructures ?? []) {
    if (x < m.footprint.minX - 2 || x > m.footprint.maxX + 2 || z < m.footprint.minZ - 2 || z > m.footprint.maxZ + 2) continue;
    for (const v of m.volumes) if (x >= v.minX && x <= v.maxX && z >= v.minZ && z <= v.maxZ && y >= v.y0 && y <= v.y1) return true;
  }
  return false;
}

/**
 * One frame: two piers flush against the slab's edges from under the deck to above the beam,
 * the beam across, the strip lamp under it with its pool, and on every other frame a red bar
 * up one pier.
 */
function portalFrame(b: EnvBuilders, x: number, y: number, z: number, tx: number, tz: number, hw: number, k: number): void {
  const nx = -tz;
  const nz = tx;
  const pierT = 1.6;
  const pierOut = hw + pierT / 2;
  const top = y + FRAME_HEIGHT + 1.2;
  b.wall.color(PAL.curb, 1.35 + (k % 3) * 0.12);
  for (const side of [-1, 1]) {
    b.wall.orientedBox(x + nx * pierOut * side, z + nz * pierOut * side, tx, tz, 1.4, pierT, y - 1.4, top, { bottom: true });
  }
  b.wall.color(PAL.curb, 1.6);
  b.wall.orientedBox(x, z, nx, nz, (hw + pierT) * 2, 1.4, y + FRAME_HEIGHT - 1.4, top, { bottom: true });
  // The lamp: an amber strip let into the beam's underside, its patch of light under the
  // beam and its pool on the asphalt.
  const level = 0.85 + (k % 4) * 0.04;
  b.neon.color(PAL.neonAmber, level);
  b.neon.orientedBox(x, z, nx, nz, 3.6, 0.5, y + FRAME_HEIGHT - 1.52, y + FRAME_HEIGHT - 1.4, { bottom: true });
  b.glow.color(PAL.neonAmber, 0.22 * level);
  downQuad(b.glow, x, y + FRAME_HEIGHT - 1.44, z, nx, nz, 7, 1.3);
  groundGlow(b, x, z, 9, 11, PAL.neonAmber, 0.1 * level, y + 0.035);
  if (k % 2 === 1) {
    const side = k % 4 === 1 ? 1 : -1;
    const px = x + nx * (hw + 0.1) * side;
    const pz = z + nz * (hw + 0.1) * side;
    b.neon.color(PAL.neonMagenta, 0.6);
    b.neon.box(px, y + 3.6, pz, 0.14, 3.2, 0.14);
    groundGlow(b, x + nx * (hw - 2) * side, z + nz * (hw - 2) * side, 4, 8, PAL.neonMagenta, 0.05, y + 0.03);
  }
}
