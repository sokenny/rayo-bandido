import { groundGlow, type EnvBuilders } from './builders';
import { PAL } from './palette';

/**
 * The versus circuit's barrier: the holographic edge of the track
 * (`src/world/circuitSpec.ts`, `src/world/circuitWorld.ts`).
 *
 * It is deliberately LOW and mostly light. The whole point of racing here rather than on the
 * Bandido Loop is that it is the city out there, so the barrier has to hold the car in without
 * standing between the player and any of it. Nothing in it rises above a car's waistline:
 *
 *   - a dark kerb unit at the track edge, knee high, one per span,
 *   - a chevron on the face of it, pointing the way the lap goes: the thing you actually read
 *     at speed, and the reason a corner is legible before its geometry is,
 *   - a hairline of light along the top of the run, and a red marker on the unit between the
 *     chevrons, which is what the edge looks like at two hundred metres,
 *   - a low holographic curtain above it — additive, thin, see-through — so the line reads as
 *     a barrier and not as a painted stripe, and the city reads straight through it.
 *
 * Amber on the outside of a corner, cyan everywhere else: the one thing the barrier says
 * besides "edge" is "this one is tightening".
 *
 * The spans are the same segments the simulation collides with, and they carry the height of
 * the road at both ends, so the run climbs the on-ramp and rides the viaduct with the car.
 */

/** The kerb unit: how tall, how deep, and how much of a span it fills. */
const UNIT_Y = 0.42;
const UNIT_DEPTH = 0.5;
/** The holographic curtain over it, and the hairline along the top of that. */
const VEIL_Y = 1.15;
/** Chevrons and markers are placed at this spacing along the run (m). */
const MARK_STEP = 5.5;
/** Light on the road: pieces this long, reaching this far in (m). */
const GLOW_STEP = 14;
const GLOW_REACH = 4.5;
/** Curvature (1/m) above which a barrier on the outside of the corner turns amber. */
const CORNER_CURVATURE = 1 / 60;

export function buildNeonWalls(b: EnvBuilders): void {
  const walls = b.plan.neonWalls;
  if (!walls || walls.length === 0) return;

  for (const w of walls) {
    let dx = w.bx - w.ax;
    let dz = w.bz - w.az;
    const len = Math.hypot(dx, dz);
    if (len < 0.15) continue;
    dx /= len;
    dz /= len;
    const cx = (w.ax + w.bx) / 2;
    const cz = (w.az + w.bz) / 2;
    const ay = w.ay;
    const by = w.by;
    const my = (ay + by) / 2;
    // The outside of a corner is the side the lap turns away from: a right-hand turn
    // (positive curvature) leans on the barrier to its left.
    const outside = w.curvature * w.side < -CORNER_CURVATURE * Math.abs(w.side);
    const tone = outside ? PAL.neonAmber : PAL.neonCyan;

    // The kerb unit. `slopedBox` so it climbs the ramp instead of stepping up it, and a hair
    // long so consecutive spans on a curve leave no notch.
    b.props.color(PAL.metalDark, 0.85);
    b.props.slopedBox(w.ax - dx * 0.05, w.az - dz * 0.05, w.bx + dx * 0.05, w.bz + dz * 0.05, ay, by, UNIT_DEPTH, UNIT_Y);

    // Hairline along the top of the unit, and the curtain's own edge above it.
    b.neon.color(tone, 0.75);
    b.neon.tube(w.ax, ay + UNIT_Y + 0.03, w.az, w.bx, by + UNIT_Y + 0.03, w.bz, 0.055);
    b.neonPulse.color(tone, 0.9);
    b.neonPulse.tube(w.ax, ay + VEIL_Y, w.az, w.bx, by + VEIL_Y, w.bz, 0.05);

    // The curtain: one thin additive panel per span, standing on the unit. Cheap, and the
    // only thing here with any area — which is why it is the only thing that is transparent.
    b.glow.color(tone, outside ? 0.2 : 0.13);
    b.glow.panel(cx + w.nx * 0.05, my + (UNIT_Y + VEIL_Y) / 2, cz + w.nz * 0.05, len, VEIL_Y - UNIT_Y, Math.atan2(w.nx, w.nz));

    // Chevrons on the face, pointing the way the lap goes, and a red marker between them.
    const faceRot = Math.atan2(w.nx, w.nz);
    for (let s = MARK_STEP / 2; s < len; s += MARK_STEP) {
      const t = s / len;
      const px = w.ax + dx * s + w.nx * (UNIT_DEPTH / 2 + 0.02);
      const pz = w.az + dz * s + w.nz * (UNIT_DEPTH / 2 + 0.02);
      const py = ay + (by - ay) * t;
      // Two short bars at an angle to each other read as an arrow head from any distance and
      // cost four triangles; a textured chevron would cost a material.
      for (const arm of [-1, 1]) {
        b.neon.color(tone, 1.15);
        b.neon.panel(px - dx * 0.16 * arm, py + UNIT_Y * 0.55 + arm * 0.075, pz - dz * 0.16 * arm, 0.34, 0.1, faceRot);
      }
      b.neon.color(PAL.neonMagenta, 1);
      b.neon.panel(px + dx * (MARK_STEP / 2), py + UNIT_Y * 0.55, pz + dz * (MARK_STEP / 2), 0.12, 0.12, faceRot);
    }

    // Light on the asphalt, on the track side only.
    const alongX = Math.abs(dx) > Math.abs(dz);
    for (let s = 0; s < len; s += GLOW_STEP) {
      const run = Math.min(GLOW_STEP, len - s);
      if (run < 1.5) break;
      const t = (s + run / 2) / len;
      const gx = w.ax + dx * (s + run / 2) + w.nx * GLOW_REACH * 0.5;
      const gz = w.az + dz * (s + run / 2) + w.nz * GLOW_REACH * 0.5;
      groundGlow(b, gx, gz, alongX ? run : GLOW_REACH, alongX ? GLOW_REACH : run, tone, 0.09, ay + (by - ay) * t + 0.04);
    }
  }
}
