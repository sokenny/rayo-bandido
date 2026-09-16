import { groundGlow, type EnvBuilders } from './builders';
import { PAL } from './palette';

/**
 * The street race's barrier: holographic closures across the openings the city leaves round a
 * course (`src/world/raceBarriers.ts` decides where; this draws what stands there).
 *
 * The Need for Speed Underground 2 barrier, in the city's own materials: a tall pane of red
 * light rather than a wall, so the street behind it still reads through, with big chevrons
 * burning on it that point the way the race goes. It closes a side street corner to corner and
 * sweeps round the outside of a junction, and wherever it stands it says two things at a
 * distance — "not this way" and "that way".
 *
 *   - a dark footing on the road, one per span, so the light stands on something,
 *   - the pane: one additive quad per span, brightest at the foot and fading up, drawn
 *     double-sided through the glow material, so it costs no draw call and no depth write,
 *   - a neon rail along the top and another along the foot: the outline you see first,
 *   - chevrons every `CHEVRON_STEP`, two thick strokes each, carried from span to span along a
 *     run so they keep their rhythm round a curve,
 *   - dark posts at the ends of a run and between the chevrons: the frame,
 *   - a red wash on the asphalt on the track side.
 *
 * The spans are the same segments the simulation collides with, and they carry the height of
 * the road at both ends, so a closure on a deck or a ramp stands on the deck or the ramp.
 */

/** How tall the pane stands above the road, and its footing (m). */
const PANE_Y = 2.4;
const FOOT_Y = 0.22;
const FOOT_DEPTH = 0.34;
/** The chevrons: spacing along the run, height, reach along the run and stroke width (m). */
const CHEVRON_STEP = 2.6;
const CHEVRON_H = 1.45;
const CHEVRON_REACH = 0.75;
const CHEVRON_STROKE = 0.3;
/** Posts: one every this many chevrons, and at both ends of a run. */
const POST_EVERY = 2;
const POST_SIZE = 0.11;
/** Light on the road: pieces this long, reaching this far in (m). */
const GLOW_STEP = 12;
const GLOW_REACH = 4;

/** The barrier's reds: the pane, the outline, and the chevrons' hotter core. */
const PANE = 0xff2a12;
const RAIL = 0xff3b1c;
const CHEVRON = 0xff5a22;

export function buildNeonWalls(b: EnvBuilders): void {
  const walls = b.plan.neonWalls;
  if (!walls || walls.length === 0) return;

  // Where the last span ended and how far past its last chevron: a run carries both on.
  let lastX = Number.NaN;
  let lastZ = Number.NaN;
  let carry = 0;
  let marks = 0;

  for (let k = 0; k < walls.length; k++) {
    const w = walls[k];
    let dx = w.bx - w.ax;
    let dz = w.bz - w.az;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    dx /= len;
    dz /= len;
    const ay = w.ay;
    const by = w.by;
    const next = walls[k + 1];
    const continues = Math.hypot(w.ax - lastX, w.az - lastZ) < 0.02;
    const endsRun = !next || Math.hypot(next.ax - w.bx, next.az - w.bz) >= 0.02;
    if (!continues) {
      carry = CHEVRON_STEP / 2;
      marks = 0;
    }
    lastX = w.bx;
    lastZ = w.bz;

    // The footing. `slopedBox` so it climbs a ramp instead of stepping up it, and a hair long so
    // consecutive spans on a curve leave no notch.
    b.props.color(PAL.metalDark, 0.8);
    b.props.slopedBox(w.ax - dx * 0.04, w.az - dz * 0.04, w.bx + dx * 0.04, w.bz + dz * 0.04, ay, by, FOOT_DEPTH, FOOT_Y);

    // The pane: the glow texture's centre at the foot out to its rim at the top, so the light
    // is thickest on the road and thins to nothing above a car's roof.
    b.glow.color(PANE, 0.95);
    b.glow.quad(w.ax, ay + FOOT_Y, w.az, w.bx, by + FOOT_Y, w.bz, w.bx, by + PANE_Y, w.bz, w.ax, ay + PANE_Y, w.az, 0.5, 0.5, 0.5, 0.97);

    // The outline.
    b.neon.color(RAIL, 1.2);
    b.neon.tube(w.ax, ay + PANE_Y, w.az, w.bx, by + PANE_Y, w.bz, 0.08);
    b.neon.tube(w.ax, ay + FOOT_Y + 0.03, w.az, w.bx, by + FOOT_Y + 0.03, w.bz, 0.06);

    // Chevrons, pointing along the run (the spans run the way the race does), a few centimetres
    // proud of the pane on the track side.
    const ox = w.nx * 0.05;
    const oz = w.nz * 0.05;
    let s = carry;
    for (; s < len; s += CHEVRON_STEP) {
      const t = s / len;
      const cy = ay + (by - ay) * t + FOOT_Y + (PANE_Y - FOOT_Y) / 2;
      const cx = w.ax + dx * s + ox;
      const cz = w.az + dz * s + oz;
      const half = CHEVRON_H / 2;
      // Back ends of the arms and the tip, along the run; each arm a parallelogram STROKE wide.
      const bx0 = cx - dx * (CHEVRON_REACH / 2);
      const bz0 = cz - dz * (CHEVRON_REACH / 2);
      const tx0 = cx + dx * (CHEVRON_REACH / 2);
      const tz0 = cz + dz * (CHEVRON_REACH / 2);
      const sx = dx * CHEVRON_STROKE;
      const sz = dz * CHEVRON_STROKE;
      b.neon.color(CHEVRON, 1.35);
      b.neon.quad(bx0, cy + half, bz0, bx0 + sx, cy + half, bz0 + sz, tx0 + sx, cy, tz0 + sz, tx0, cy, tz0);
      b.neon.quad(tx0, cy, tz0, tx0 + sx, cy, tz0 + sz, bx0 + sx, cy - half, bz0 + sz, bx0, cy - half, bz0);
      if (marks % POST_EVERY === 1) post(b, w.ax + dx * (s - CHEVRON_STEP / 2), ay + (by - ay) * Math.max(0, t - CHEVRON_STEP / 2 / len), w.az + dz * (s - CHEVRON_STEP / 2));
      marks++;
    }
    carry = s - len;
    if (!continues) post(b, w.ax, ay, w.az);
    if (endsRun) post(b, w.bx, by, w.bz);

    // Light on the asphalt, on the track side only.
    const alongX = Math.abs(dx) > Math.abs(dz);
    for (let g = 0; g < len; g += GLOW_STEP) {
      const run = Math.min(GLOW_STEP, len - g);
      if (run < 1.5) break;
      const t = (g + run / 2) / len;
      const gx = w.ax + dx * (g + run / 2) + w.nx * GLOW_REACH * 0.5;
      const gz = w.az + dz * (g + run / 2) + w.nz * GLOW_REACH * 0.5;
      groundGlow(b, gx, gz, alongX ? run : GLOW_REACH, alongX ? GLOW_REACH : run, PANE, 0.1, ay + (by - ay) * t + 0.04);
    }
  }
}

/** A dark post the height of the pane. */
function post(b: EnvBuilders, x: number, y: number, z: number): void {
  b.props.color(PAL.metalDark, 0.7);
  b.props.box(x, y + (PANE_Y + 0.06) / 2, z, POST_SIZE, PANE_Y + 0.06, POST_SIZE);
}
