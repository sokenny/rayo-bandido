import type { FenceDef, PillarDef, RibbonDef } from '../../../world/cityPlan';
import { isOnPath, segmentCount } from '../../../world/track';
import { PAL } from './palette';
import { groundGlow, halo, type EnvBuilders } from './builders';
import { decal } from './graffiti';
import { rollLampFault } from './lampFaults';
import type { MeshBuilder } from './meshBuilder';
import { OVERHANG_CLEAR, shrub, vine, weedLine } from './plants';
import { signCell } from './textures';

/**
 * Viaducts: the parts of an elevated ribbon that are not the asphalt itself (which
 * `trackBuilder.ts` lays at the samples' own height).
 *
 * Per segment off the ground: a slab skirt either side, banded light-to-dark down its height
 * and capped by a pale fascia with one thin, dim cyan line let into it — that top edge is
 * what keeps a deck from reading as a black cut-out against the towers behind it — and then
 * the underside.
 *
 * THE UNDERSIDE IS THE POINT. It is the only piece of the city a driver spends real time
 * beneath, and what it has to say is: massive, ageing infrastructure that somebody later
 * bolted a little technology onto. So it is built as ageing infrastructure —
 *
 * - a dark, weathered concrete soffit, cast in panels a few percent apart in tone;
 * - transverse structural ribs every `RIB_SPACING` metres, real geometry, because they are
 *   what gives the ceiling depth and a silhouette;
 * - two concrete edge girders under the fascias and two steel longitudinal girders inboard;
 * - a cable tray, a drainage pipe and a conduit run following the curve;
 * - warm-white maintenance lamps every `LAMP_SPACING` metres — not on every module, not all
 *   working — each with its own pool of light on the ceiling and on the ground below;
 * - seams, water stains, repair patches and grime as decals off the shared grime atlas;
 * - hanging growth out of the odd crack, only where the reclamation field says a pocket is.
 *
 * — and NOT as a lightshow. There is no lit strip along the bays, no row of coloured pipes,
 * nothing under here that glows except the maintenance lamps and the one dim cyan line along
 * each outer edge, which itself has dead stretches in it.
 *
 * VARIATION WITHOUT UNIQUE GEOMETRY. Every module is the same handful of primitives; what
 * changes between them is which lamp is fitted, how hard it burns, where the repair patch and
 * the stains fell, whether the cyan line is alive, and whether anything is growing out of the
 * joint. That variation is walked off `vary()` — a hash of the module index — rather than off
 * the shared `rng`, so the underside can be retuned without reshuffling every builder that
 * runs after it.
 *
 * Under it: the columns the plan placed (a pair with a cross beam, a painted hazard collar at
 * the foot), the fences between them, a concrete floor, and stalls leaning on the fences —
 * the ground floor of the highway. Everything lands in the shared per-material builders; no
 * new draw calls.
 *
 * The big slabs down here — the skirts, the soffit and its ribs, the columns and their
 * plinths, the cross beams — go to `b.wall` rather than `b.concrete`, so they carry the
 * concrete photograph (`env/wallDetail.ts`); on a soffit the triplanar projection lands on
 * its top-down plane, which is the one that reads as board-marked casting. The trim that does
 * not (the fascia bands, the edge line, the diagonal braces) is either lit, thin, or only ever
 * read from far enough away that a 4 m tile would be under a pixel.
 */

/** Slab thickness (m). */
export const DECK_THICKNESS = 1.4;
/** Below this deck height nothing drives under: the skirt runs to the ground. */
const EMBANKMENT_BELOW = 4.5;
/** A segment this low is street, not viaduct. */
const GROUND_BELOW = 0.12;

/**
 * Transverse rib spacing (m), which is also the underside's module length: every per-module
 * choice below is indexed by `floor(station / RIB_SPACING)`. Sits in the 8-12 m a real
 * girder bridge uses, and well above the 3 m arc sampling, so the ribs come out evenly
 * spaced round a curve instead of once per sample.
 */
const RIB_SPACING = 10.5;
/** Maintenance lamp spacing (m). Roughly every other rib bay. */
const LAMP_SPACING = 17;
/** Share of lamp bays that actually have a fixture in them. */
const LAMP_FITTED = 0.78;
/** Share of edge-line modules whose section is dead. */
const EDGE_LINE_DEAD = 0.17;

/**
 * Deterministic 0..1 for module `m` under `salt`.
 *
 * Deliberately not `rng`. The underside is walked segment by segment and would take hundreds
 * of numbers off the shared stream; every builder that runs after `buildTrack` would then
 * shift the moment a pipe was retuned. A hash costs nothing and keeps the change local.
 */
function vary(m: number, salt: number): number {
  const n = Math.sin(m * 12.9898 + salt * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * A quad lying flat under the deck, facing DOWN: the soffit's panels and patches, the flat
 * plate of a cable tray, a lamp's lens and the light it throws on the ceiling. Winding is the
 * mirror of the road surface's, or none of it is there from underneath.
 *
 * `(dx, dz)` is the unit direction along the deck; `len` runs along it and `wid` across.
 */
function downQuad(
  mb: MeshBuilder,
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dz: number,
  len: number,
  wid: number,
  u0 = 0,
  v0 = 0,
  u1 = 1,
  v1 = 1,
): void {
  // "Left" is the same side the soffit's own first corner is on: +(dz, -dx).
  const lx = (dz * wid) / 2;
  const lz = (-dx * wid) / 2;
  const hx = (dx * len) / 2;
  const hz = (dz * len) / 2;
  mb.quad(
    cx + lx - hx, cy, cz + lz - hz,
    cx + lx + hx, cy, cz + lz + hz,
    cx - lx + hx, cy, cz - lz + hz,
    cx - lx - hx, cy, cz - lz - hz,
    u0, v0, u1, v1,
  );
}

/** UV rect of one grime cell of the shared decal atlas: 12 streak, 13 stain, 14 crack, 15 soot. */
function grimeUv(cell: number): { u0: number; v0: number; u1: number; v1: number } {
  const col = cell % 4;
  const row = Math.floor(cell / 4);
  const pad = 0.004;
  return { u0: col / 4 + pad, u1: (col + 1) / 4 - pad, v0: 1 - (row + 1) / 4 + pad, v1: 1 - row / 4 - pad };
}

/**
 * One recessed maintenance lamp in the soffit: a shallow steel housing let into the concrete,
 * a warm lens under it, the patch of ceiling it lights, and its pool on the ground below.
 *
 * Only the lens and the two pools carry the fault seed — the housing is metal and is still
 * there when the lamp is out, the same rule the street lamps in `propsBuilder` are built to.
 */
function maintenanceLamp(
  b: EnvBuilders,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  level: number,
  fault: number,
  pool: boolean,
): void {
  b.props.color(PAL.metalDark, 1.9);
  b.props.orientedBox(x, z, dx, dz, 1.7, 0.66, y - 0.2, y + 0.02, { bottom: true });
  b.neon.color(PAL.lampWarm, level).fault(fault);
  downQuad(b.neon, x, y - 0.21, z, dx, dz, 1.25, 0.4);
  b.neon.fault(0);
  // Right at the soffit, so the opaque housing punches its own shadow out of the middle of
  // the patch: a ring of lit concrete round a dark fixture, not a glowing tile.
  b.glow.color(PAL.lampWarm, 0.34 * level).fault(fault);
  downQuad(b.glow, x, y - 0.02, z, dx, dz, 8.5, 6.5);
  b.glow.fault(0);
  if (pool) groundGlow(b, x, z, 9, 9, PAL.lampWarm, 0.12 * level, 0.04, fault);
}

export function buildViaducts(b: EnvBuilders, rng: () => number): void {
  let ribbon = 0;
  for (const rb of b.plan.ribbons) if (rb.elevated) buildDeck(b, rb, rng, ribbon++);
  for (const p of b.plan.pillars ?? []) buildPillar(b, p, rng);
  for (const f of b.plan.fences ?? []) buildFence(b, f, rng);
}

/** True when (x, z) is on a street at ground level (not merely under a deck). */
function onStreet(b: EnvBuilders, x: number, z: number, pad: number): boolean {
  for (const rb of b.plan.ribbons) {
    if (rb.elevated) continue;
    if (isOnPath(rb.path, x, z, pad)) return true;
  }
  return false;
}

function buildDeck(b: EnvBuilders, rb: RibbonDef, rng: () => number, ribbon: number): void {
  const samples = rb.path.samples;
  const segs = segmentCount(rb.path);
  const wet = b.plan.water;
  // Which side of this ribbon the services run down, and how far in. Fixed per ribbon: a
  // drainage pipe that swapped sides at a module boundary would read as a mistake, not as
  // variety, so what varies module to module is the wear and the lamps, never the routing.
  const svc = vary(ribbon, 91) < 0.5 ? -1 : 1;
  let sinceSign = 60;
  for (let i = 0; i < segs; i++) {
    const a = samples[i];
    const c = samples[(i + 1) % samples.length];
    if (a.y < GROUND_BELOW && c.y < GROUND_BELOW) continue;
    const alx = a.x + a.tz * a.halfWidth;
    const alz = a.z - a.tx * a.halfWidth;
    const arx = a.x - a.tz * a.halfWidth;
    const arz = a.z + a.tx * a.halfWidth;
    const clx = c.x + c.tz * c.halfWidth;
    const clz = c.z - c.tx * c.halfWidth;
    const crx = c.x - c.tz * c.halfWidth;
    const crz = c.z + c.tx * c.halfWidth;
    const overWater = !!wet && (a.z > wet.quayZ || c.z > wet.quayZ);
    const groundY = overWater ? -3 : -0.3;
    // The slab bottom; an embankment's skirt goes all the way down.
    const bottomA = a.y < EMBANKMENT_BELOW ? groundY : a.y - DECK_THICKNESS;
    const bottomC = c.y < EMBANKMENT_BELOW ? groundY : c.y - DECK_THICKNESS;
    const topA = a.y;
    const topC = c.y;
    const mx = (a.x + c.x) / 2;
    const mz = (a.z + c.z) / 2;
    const my = (a.y + c.y) / 2;
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const dx = (c.x - a.x) / (len || 1);
    const dz = (c.z - a.z) / (len || 1);
    const nx = -dz;
    const nz = dx;

    // Per-segment wear, walked off the segment index so it does not disturb `rng`: two
    // consecutive casting panels sit a few percent apart in tone, which is what makes the
    // deck's joints — and so its length — legible from the road below.
    const wear = 0.94 + ((i * 5) % 7) * 0.024;
    // The face is read as three tones down its height: a pale fascia at the parapet where
    // the deck's own lighting spills over, the skirt under it, and, on an embankment only,
    // a foot that falls away into the dark. Concrete, not shadow — the slab is the biggest
    // silhouette in the city and has to catch enough light to show its edges.
    const fasciaA = topA - 0.55;
    const fasciaC = topC - 0.55;
    const upperA = Math.max(bottomA, fasciaA - 1.8);
    const upperC = Math.max(bottomC, fasciaC - 1.8);
    // Skirts: left face outward is -normal (the left side), right face outward is +normal.
    if (upperA > bottomA + 0.05 || upperC > bottomC + 0.05) {
      b.wall.color(PAL.concrete, 0.95 * wear);
      b.wall.quad(clx, bottomC, clz, alx, bottomA, alz, alx, upperA, alz, clx, upperC, clz);
      b.wall.quad(arx, bottomA, arz, crx, bottomC, crz, crx, upperC, crz, arx, upperA, arz);
    }
    b.concrete.color(PAL.curb, 1.0 * wear);
    b.concrete.quad(clx, upperC, clz, alx, upperA, alz, alx, fasciaA, alz, clx, fasciaC, clz);
    b.concrete.quad(arx, upperA, arz, crx, upperC, crz, crx, fasciaC, crz, arx, fasciaA, arz);
    // Fascia: a lighter band at the top edge, so the deck edge draws a clean line at night.
    // It stands 2 cm PROUD of the skirt; inset, the slab simply swallows it.
    const fx = a.tz * 0.02;
    const fz = -a.tx * 0.02;
    b.concrete.color(PAL.curb, 1.75 * wear);
    b.concrete.quad(clx + fx, fasciaC, clz + fz, alx + fx, fasciaA, alz + fz, alx + fx, topA + 0.02, alz + fz, clx + fx, topC + 0.02, clz + fz);
    b.concrete.quad(arx - fx, fasciaA, arz - fz, crx - fx, fasciaC, crz - fz, crx - fx, topC + 0.02, crz - fz, arx - fx, topA + 0.02, arz - fz);

    // The ONE lit line on the whole structure: a thin, dim cyan strip let into each fascia,
    // along the outer upper edge. It is what draws the deck's silhouette against the towers,
    // and it is also the only piece of "later technology" the highway wears, so it is kept
    // near the floor of what is visible. Roughly one module in six is a dead section — the
    // channel is still cut, the light in it is not on — which is what stops a 1.7 km run of
    // unbroken cyan from reading as a racetrack rail again.
    const mod = Math.floor(a.s / RIB_SPACING);
    const lx = a.tz * 0.05;
    const lz = -a.tx * 0.05;
    for (const side of [1, -1]) {
      const live = vary(mod, ribbon * 7 + (side > 0 ? 3 : 5)) > EDGE_LINE_DEAD;
      b.neon.color(PAL.neonCyan, live ? 0.19 : 0.012);
      if (side > 0) {
        b.neon.quad(clx + lx, topC - 0.48, clz + lz, alx + lx, topA - 0.48, alz + lz, alx + lx, topA - 0.3, alz + lz, clx + lx, topC - 0.3, clz + lz);
      } else {
        b.neon.quad(arx - lx, topA - 0.48, arz - lz, crx - lx, topC - 0.48, crz - lz, crx - lx, topC - 0.3, crz - lz, arx - lx, topA - 0.3, arz - lz);
      }
    }

    if (a.y < EMBANKMENT_BELOW && c.y < EMBANKMENT_BELOW) continue;
    const bottom = my - DECK_THICKNESS;
    const hw = a.halfWidth;

    /* ---------------------------------------------------------------- the soffit */

    // Cast in panels: each module a few percent off its neighbours, so the ceiling reads as
    // a run of pours with joints between them rather than one flat plane to the horizon.
    // Well above the flat tone it used to carry — the soffit faces straight DOWN, and a
    // downward normal takes only the hemisphere's ground colour, so anything under about
    // 1.3 here comes out as a black lid whatever the palette says.
    const panel = 0.9 + vary(mod, ribbon * 3 + 1) * 0.24;
    b.wall.color(PAL.curb, 4.2 * wear * panel);
    b.wall.quad(alx, bottomA, alz, clx, bottomC, clz, crx, bottomC, crz, arx, bottomA, arz);
    // A repair patch: a plate of newer, paler concrete over part of the width. Two
    // triangles, and it is most of what stops the ceiling looking extruded.
    if (vary(mod, ribbon * 3 + 2) < 0.26) {
      const pw = hw * (0.45 + vary(mod, 41) * 0.55);
      const po = (vary(mod, 42) - 0.5) * hw;
      b.wall.color(PAL.curb, 5.1 * panel);
      downQuad(b.wall, mx + nx * po, bottom - 0.015, mz + nz * po, dx, dz, len, pw);
    }

    /* ------------------------------------------------------------- the structure */

    // Concrete edge girders under the fascias: the deck's own depth, and what a driver on the
    // street below actually sees the highway as.
    b.wall.color(PAL.curb, 1.55 * wear);
    b.wall.orientedBox(mx + nx * (hw - 0.7), mz + nz * (hw - 0.7), dx, dz, len + 0.05, 0.9, bottom - 0.95, bottom, { bottom: true });
    b.wall.orientedBox(mx - nx * (hw - 0.7), mz - nz * (hw - 0.7), dx, dz, len + 0.05, 0.9, bottom - 0.95, bottom, { bottom: true });
    // Two steel longitudinal girders inboard of them, dark against the lit concrete. Real
    // boxes rather than tubes: they have to break the ceiling into three bands from below.
    b.props.color(PAL.metalDark, 2.2);
    for (const side of [-1, 1]) {
      b.props.orientedBox(mx + nx * hw * 0.34 * side, mz + nz * hw * 0.34 * side, dx, dz, len + 0.05, 0.5, bottom - 0.8, bottom - 0.02, { bottom: true });
    }

    /* -------------------------------------------------------------- the services */

    // A drainage pipe and a conduit run down one side, and a flat cable tray down the other,
    // both following the curve because they are drawn per segment off the same samples the
    // deck is. Routing is fixed per ribbon (`svc`); only the grime on it varies.
    b.props.color(PAL.metalDark, 2.4);
    const drainOff = hw * 0.58 * svc;
    b.props.tube(a.x + nx * drainOff, bottomA - 0.55, a.z + nz * drainOff, c.x + nx * drainOff, bottomC - 0.55, c.z + nz * drainOff, 0.42);
    // Rust, and well up off the palette floor: a warm brown line is the one thing under here
    // that is not teal concrete or black steel, and it is what makes the run read as pipework.
    b.props.color(PAL.rust, 2.6);
    const condOff = hw * 0.72 * svc;
    b.props.tube(a.x + nx * condOff, bottomA - 0.36, a.z + nz * condOff, c.x + nx * condOff, bottomC - 0.36, c.z + nz * condOff, 0.21);
    // The tray is a plate seen from below and nothing else, so it is two triangles.
    b.props.color(PAL.metalDark, 3.0);
    downQuad(b.props, mx - nx * hw * 0.68 * svc, bottom - 0.42, mz - nz * hw * 0.68 * svc, dx, dz, len + 0.05, 0.62);

    /* ------------------------------------------- ribs, lamps and wear, by station */

    // Everything from here is placed at an absolute distance along the ribbon rather than
    // once per sample: the path is stepped at 8 m down a straight and 3 m round a bend, and
    // per-sample detail would bunch up in every curve. `a.s` is the station of this segment's
    // start, so each feature station that falls inside it is interpolated into place.
    const s0 = a.s;
    const s1 = s0 + len;

    for (let k = Math.ceil(s0 / RIB_SPACING); k * RIB_SPACING < s1; k++) {
      const st = k * RIB_SPACING;
      const t = (st - s0) / (len || 1);
      const px = a.x + (c.x - a.x) * t;
      const pz = a.z + (c.z - a.z) * t;
      const py = bottomA + (bottomC - bottomA) * t;
      const rw = a.halfWidth + (c.halfWidth - a.halfWidth) * t;
      // The rib: a transverse beam the width of the deck, hanging a little deeper than the
      // girders it crosses. Real geometry, because it is the ceiling's whole silhouette.
      b.wall.color(PAL.curb, 2.2 + vary(k, ribbon * 13 + 4) * 0.8);
      b.wall.orientedBox(px, pz, nx, nz, rw * 2 - 0.4, 0.9, py - 1.12, py, { bottom: true });

      // Everything from here is wear on a ceiling, and a ceiling only exists above a bus.
      // On the low end of a ramp the soffit is within touching distance of the street it
      // crosses: there is nothing to read down there, and a strand of growth off it would
      // hang into the traffic rather than over it.
      if (py < OVERHANG_CLEAR) continue;

      // A casting seam and a stain or two on the panel beside it. Decals, not geometry: the
      // brief for the wear is that it should cost two triangles, not a mesh.
      const decay = b.reclaim.at(px, pz).decay;
      const seam = grimeUv(14);
      b.decal.color(PAL.grime, 0.7);
      downQuad(b.decal, px - dx * 1.2, py - 0.03, pz - dz * 1.2, dx, dz, 2.2, rw * 1.8, seam.u0, seam.v0, seam.u1, seam.v1);
      const vs = vary(k, ribbon * 13 + 6);
      if (vs < 0.35 + decay * 0.45) {
        const stain = grimeUv(vs < 0.16 ? 13 : 12);
        const sw = 1.8 + vary(k, 61) * 3.4;
        const so = (vary(k, 62) - 0.5) * rw * 1.5;
        b.decal.color(PAL.grime, 0.5 + vary(k, 63) * 0.6);
        downQuad(b.decal, px + nx * so + dx * 2.4, py - 0.03, pz + nz * so + dz * 2.4, dx, dz, sw * 1.4, sw, stain.u0, stain.v0, stain.u1, stain.v1);
      }
      // Water running off the deck edge: a streak down the outer face, under the drip line.
      const vw = vary(k, ribbon * 13 + 8);
      if (vw < 0.4 + decay * 0.4) {
        const side = vw < 0.2 ? 1 : -1;
        const face = {
          x: px + nx * rw * side, y: py - 0.05, z: pz + nz * rw * side,
          nx: nx * side, nz: nz * side, tx: dx, tz: dz,
          width: 6, height: 1.35, out: 0.07,
        };
        decal(b, face, (vary(k, 64) - 0.5) * 3, 0.68, 0.9 + vary(k, 65) * 1.3, 1.3, 0, 12, PAL.grime, 0.5 + vary(k, 66) * 0.5, vw < 0.3);
      }
      // Something growing out of the joint, but only where the reclamation field says this is
      // a pocket, and only on a fraction of those: hanging growth on every module is topiary.
      if (!overWater && vary(k, ribbon * 13 + 9) < b.reclaim.at(px, pz).vines * 0.5) {
        const side = vary(k, 71) < 0.5 ? 1 : -1;
        // Clamped the same way the reclamation clamps a vine off a gantry: the tip stays a
        // bus's height above whatever is underneath, so growth is always over the road.
        const drop = Math.min(py - 0.1 - OVERHANG_CLEAR, 2 + vary(k, 73) * 2.6);
        if (drop > 0.8) {
          vine(b, px + nx * rw * side, py - 0.1, pz + nz * rw * side, nx * side, nz * side, dx, dz, 1.6 + vary(k, 72) * 1.8, drop, rng, { dry: 0.3 });
        }
      }
    }

    for (let k = Math.ceil(s0 / LAMP_SPACING); k * LAMP_SPACING < s1; k++) {
      if (vary(k, ribbon * 17 + 2) >= LAMP_FITTED) continue;
      const st = k * LAMP_SPACING;
      const t = (st - s0) / (len || 1);
      const px = a.x + (c.x - a.x) * t;
      const pz = a.z + (c.z - a.z) * t;
      const py = bottomA + (bottomC - bottomA) * t;
      // Off the centreline, between the steel girders, and a different amount each time.
      const off = (vary(k, ribbon * 17 + 3) - 0.5) * a.halfWidth * 0.5;
      // Tired fittings: some burn at half, and the shared lamp-fault shader takes a third of
      // them out altogether for seconds at a time.
      const level = 0.55 + vary(k, ribbon * 17 + 4) * 0.55;
      maintenanceLamp(b, px + nx * off, py, pz + nz * off, dx, dz, level, rollLampFault(rng), !overWater);
    }

    // A sign hanging under the deck, edge-on, every ~110 m: reads along the corridor without
    // becoming another light source. Sparser and cooler than it was — under here the lamps
    // are supposed to be the only warm thing.
    sinceSign += len;
    if (sinceSign > 110 && !overWater) {
      sinceSign = 0;
      const uv = signCell(Math.floor(rng() * 16));
      const rot = Math.atan2(dx, dz);
      const sy = bottom - 2.6;
      const sx = mx + nx * (rng() - 0.5) * hw;
      const sz = mz + nz * (rng() - 0.5) * hw;
      b.props.color(PAL.metalDark, 0.8);
      b.props.box(sx, bottom - 0.9, sz, 0.2, 1.4, 0.2);
      b.signs.panel(sx, sy, sz, 2.4, 2.4, rot, uv.u0, uv.v0, uv.u1, uv.v1);
      b.signs.panel(sx, sy, sz, 2.4, 2.4, rot + Math.PI, uv.u0, uv.v0, uv.u1, uv.v1);
      halo(b, sx, sy, sz, 6, 4.5, rot, PAL.neonCyan, 0.09);
    }

    // The floor under the deck — not on a street, not in the bay. The pools of light on it
    // now come from the maintenance lamps overhead rather than from the bay parity, so a
    // dark stretch of ceiling has dark ground under it.
    if (!overWater && !onStreet(b, mx, mz, 2)) {
      const fw = hw + 1.2;
      b.concrete.color(PAL.ground, 1.25);
      b.concrete.quad(a.x + nx * fw, 0.02, a.z + nz * fw, a.x - nx * fw, 0.02, a.z - nz * fw, c.x - nx * fw, 0.02, c.z - nz * fw, c.x + nx * fw, 0.02, c.z + nz * fw);
    }
  }
}

function buildPillar(b: EnvBuilders, p: PillarDef, rng: () => number): void {
  const nx = -p.tz;
  const nz = p.tx;
  const out = p.halfWidth - 1.6;
  const top = p.y - DECK_THICKNESS;
  const base = p.wet ? -6 : -0.4;
  // Two columns on a plinth. Lighter than the slab, so the forest of columns reads from the
  // road. Nothing here glows: a column is structure, and the coloured tube it used to carry
  // up its face — plus the ring of amber and magenta neon round its foot — is exactly the
  // lightshow the underside is being taken away from. What replaces the ring is PAINT: a
  // hazard collar on the plinth, lit by the scene like any other surface, which is both what
  // a real pier wears and four triangles cheaper than the tubes were.
  const marked = rng() < 0.45;
  for (const side of [-1, 1]) {
    const cx = p.x + nx * out * side;
    const cz = p.z + nz * out * side;
    b.wall.color(PAL.curb, 1.2 + rng() * 0.2);
    b.wall.box(cx, (base + top) / 2, cz, 1.7, top - base, 1.7, { top: false });
    b.wall.color(p.wet ? PAL.night : PAL.curb, 0.95);
    b.wall.box(cx, base + 0.45, cz, 2.6, 0.9, 2.6, { top: true });
    if (!p.wet && marked) {
      b.props.color(PAL.neonAmber, 0.34);
      b.props.box(cx, base + 0.62, cz, 2.66, 0.26, 2.66, { top: false });
    }
  }
  // Cross beam under the slab, the full width of the deck, and a brace to each column.
  b.wall.color(PAL.concrete, 0.72);
  b.wall.orientedBox(p.x, p.z, nx, nz, out * 2 + 1.7, 1.6, top - 1.3, top, { bottom: true });
  b.concrete.color(PAL.concrete, 0.6);
  for (const side of [-1, 1]) {
    const cx = p.x + nx * out * side;
    const cz = p.z + nz * out * side;
    b.concrete.tube(cx + nx * 0.6 * -side, top - 6, cz + nz * 0.6 * -side, cx - nx * 4 * side, top - 1.3, cz - nz * 4 * side, 0.5);
  }
  // The odd pier carries a maintenance lamp on its cross beam rather than the bar of coloured
  // light it used to: the same warm-white fixture as the soffit's, so a column and the
  // ceiling over it are lit by one kind of lamp.
  if (rng() < 0.4) {
    maintenanceLamp(b, p.x, top - 1.32, p.z, p.tx, p.tz, 0.6 + rng() * 0.5, rollLampFault(rng), !p.wet);
  }
}

/**
 * Chain-link between two columns: posts, a dark mesh panel, a top rail, and on some a poster
 * or a stall leaning against it with its own warm light. The stall sits in the fenced bay,
 * on the far side of the wall from the street, so nothing here is ever driven into.
 */
function buildFence(b: EnvBuilders, f: FenceDef, rng: () => number): void {
  let dx = f.bx - f.ax;
  let dz = f.bz - f.az;
  const len = Math.hypot(dx, dz);
  if (len < 3) return;
  dx /= len;
  dz /= len;
  const cx = (f.ax + f.bx) / 2;
  const cz = (f.az + f.bz) / 2;
  const h = 2.2;
  b.props.color(PAL.metalDark, 0.55);
  b.props.orientedBox(cx, cz, dx, dz, len - 2.8, 0.06, 0.05, h);
  b.props.color(PAL.metalDark, 0.9);
  b.props.orientedBox(cx, cz, dx, dz, len - 2.8, 0.14, h, h + 0.14);
  for (const t of [-0.5, 0.5]) {
    b.props.box(cx + dx * len * t * 0.86, h / 2, cz + dz * len * t * 0.86, 0.16, h, 0.16);
  }
  const r = rng();
  // Which side the deck's centre is: the stall goes there, into the bay.
  const nx = -dz;
  const nz = dx;
  if (r < 0.3) {
    // A poster on the mesh.
    const uv = signCell(Math.floor(rng() * 16));
    const rot = Math.atan2(nx, nz);
    b.signs.panel(cx + nx * 0.08, 1.35, cz + nz * 0.08, 2.2, 1.6, rot, uv.u0, uv.v0, uv.u1, uv.v1);
    b.signs.panel(cx - nx * 0.08, 1.35, cz - nz * 0.08, 2.2, 1.6, rot + Math.PI, uv.u0, uv.v0, uv.u1, uv.v1);
    halo(b, cx, 1.35, cz, 6, 4, rot, PAL.neonMagenta, 0.12);
  } else if (r < 0.55) {
    // A stall: a counter box, an awning, an amber tube under it, crates beside it.
    const inward = fenceInward(b, f);
    const sx = cx + nx * 1.6 * inward;
    const sz = cz + nz * 1.6 * inward;
    b.props.color(PAL.rust, 1.05);
    b.props.orientedBox(sx, sz, dx, dz, 3.2, 2.0, 0.05, 2.3);
    b.props.color(PAL.rust, 0.85);
    b.props.orientedBox(sx + nx * 0.6 * inward, sz + nz * 0.6 * inward, dx, dz, 3.8, 3.2, 2.3, 2.45);
    const warm = rng() < 0.7 ? PAL.neonAmber : PAL.neonPink;
    b.neon.color(warm, 0.8);
    b.neon.tube(sx - dx * 1.7 + nx * 1.6 * inward, 2.2, sz - dz * 1.7 + nz * 1.6 * inward, sx + dx * 1.7 + nx * 1.6 * inward, 2.2, sz + dz * 1.7 + nz * 1.6 * inward, 0.14);
    halo(b, sx + nx * 1.8 * inward, 1.5, sz + nz * 1.8 * inward, 5, 3.5, Math.atan2(nx * inward, nz * inward), warm, 0.18);
    groundGlow(b, sx + nx * 2.6 * inward, sz + nz * 2.6 * inward, 9, 9, warm, 0.14, 0.06);
    b.props.color(PAL.metalDark, 0.8);
    b.props.box(sx + dx * 2.4, 0.5, sz + dz * 2.4, 0.9, 0.9, 0.9);
    b.props.box(sx + dx * 2.4, 1.3, sz + dz * 2.4, 0.7, 0.7, 0.7);
  } else if (r < 0.62) {
    // Growth against the fence, on the street side: a clump of shrub and weed rather than the
    // clipped hedge that used to stand here. How much of it there is comes from the
    // reclamation field, so a fence in a clean stretch keeps a single tuft and one in a
    // pocket disappears under it.
    const inward = fenceInward(b, f);
    const profile = b.reclaim.at(cx, cz);
    const hl = Math.min(len - 4, 3 + rng() * 4);
    const px = cx - nx * 0.8 * inward;
    const pz = cz - nz * 0.8 * inward;
    const clumps = 1 + Math.round(profile.vegetation * 3);
    for (let i = 0; i < clumps; i++) {
      const t = (rng() - 0.5) * hl;
      shrub(b, px + dx * t, 0.05, pz + dz * t, rng, { scale: 0.9 + rng() * 0.8, dry: 0.25 + (1 - profile.intensity) * 0.3 });
    }
    weedLine(b, px - dx * hl / 2, pz - dz * hl / 2, px + dx * hl / 2, pz + dz * hl / 2, 0.05, Math.round(hl * 0.6), rng, {
      scale: 0.7 + rng() * 0.6,
      dry: 0.4,
    });
  } else if (r < 0.74) {
    // Junk against the fence.
    const inward = fenceInward(b, f);
    for (let i = 0; i < 3; i++) {
      const t = (rng() - 0.5) * (len - 4);
      b.props.color(rng() < 0.5 ? PAL.rust : PAL.metalDark, 0.7 + rng() * 0.5);
      b.props.box(cx + dx * t + nx * 0.7 * inward, 0.45, cz + dz * t + nz * 0.7 * inward, 0.7, 0.9, 0.7);
    }
  }
  if (rng() < 0.4) {
    b.neon.color(PAL.neonCyan, 0.22);
    b.neon.tube(f.ax + dx * 1.4, h + 0.2, f.az + dz * 1.4, f.bx - dx * 1.4, h + 0.2, f.bz - dz * 1.4, 0.08);
  }
}

/** +1 when the deck's centre is on the fence's +normal side, else -1: which way is "into the bay". */
function fenceInward(b: EnvBuilders, f: FenceDef): number {
  const cx = (f.ax + f.bx) / 2;
  const cz = (f.az + f.bz) / 2;
  const dx = f.bx - f.ax;
  const dz = f.bz - f.az;
  const nx = -dz;
  const nz = dx;
  // Probe both sides: the one under a deck is inward.
  for (const rb of b.plan.ribbons) {
    if (!rb.elevated) continue;
    if (isOnPath(rb.path, cx + nx * 0.2, cz + nz * 0.2, 0)) return 1;
    if (isOnPath(rb.path, cx - nx * 0.2, cz - nz * 0.2, 0)) return -1;
  }
  return 1;
}
