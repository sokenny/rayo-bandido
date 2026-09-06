import type { GateDef, ZoneId } from '../../../world/cityPlan';
import { PAL } from './palette';
import { makeRng } from './meshBuilder';
import { groundGlow, halo, type EnvBuilders } from './builders';
import { signCell } from './textures';

/**
 * Everything that dresses the streets: guardrails, street lights, the neon route gates from
 * the wet-road reference, holographic billboards and the JDM garage clutter. All of it placed
 * from the plan (`b.plan`), so the test arena and the circuit share every prop.
 *
 * House rule: a prop may only exist where `isSolid()` is true, i.e. inside a collider the
 * simulation already knows about. That single test is what keeps art and collision honest -
 * the player can never drive through a container or clip a lamp post. (The circuit's track
 * builder places its own lamps just outside the guardrails, which the car cannot reach.)
 */
export function buildProps(b: EnvBuilders): void {
  const rng = makeRng(0x7a1ce);
  buildRouteMarkers(b);
  buildPylons(b);
  buildBarriers(b, rng);
  buildStreetLights(b, rng);
  buildGates(b);
  buildBillboards(b);
  buildCables(b, rng);
  buildBladeSigns(b, rng);
  buildBlockClutter(b, rng);
}

/**
 * Projecting shop signs that stick out of the facade and are read along the street - the
 * single most recognisable element of the approved reference. Two back-to-back panels each,
 * hung well above head height so nothing here can ever be driven into.
 */
function buildBladeSigns(b: EnvBuilders, rng: () => number): void {
  const SQUARE = [0, 1, 3, 6, 8, 9, 11, 14];
  const TALL = [13, 4, 7, 5];
  const isRoad = b.plan.isRoad;
  for (const blk of b.plan.blocks) {
    walkLedge(blk, 3.5, 11, (x, z, dx, dz) => {
      if (!isRoad(x + dx * 7, z + dz * 7) && !isRoad(x + dx * 11, z + dz * 11)) return;
      // Rare on purpose. A few blades read as a street; one on every ledge reads as clutter.
      if (rng() > 0.34) return;
      const tall = rng() < 0.4;
      const cell = tall ? TALL[Math.floor(rng() * TALL.length)] : SQUARE[Math.floor(rng() * SQUARE.length)];
      const uv = signCell(cell);
      const w = tall ? 1.9 : 2.6 + rng() * 1.2;
      const h = tall ? 5.5 + rng() * 2 : w;
      const out = 1.4 + w / 2;
      const y = 7 + rng() * 7;
      const px = x + dx * out;
      const pz = z + dz * out;
      // The blade reads edge-on to the wall, so it faces along the street.
      const bladeRot = dx !== 0 ? 0 : Math.PI / 2;
      b.signs.panel(px, y, pz, w, h, bladeRot, uv.u0, uv.v0, uv.u1, uv.v1);
      b.signs.panel(px, y, pz, w, h, bladeRot + Math.PI, uv.u0, uv.v0, uv.u1, uv.v1);
      b.props.color(PAL.metalDark, 0.8);
      if (dx !== 0) b.props.box(x + dx * (out / 2), y + h / 2 - 0.2, z, out, 0.2, 0.2);
      else b.props.box(x, y + h / 2 - 0.2, z + dz * (out / 2), 0.2, 0.2, out);
      // Two families only: the hot cells bloom magenta, everything else blooms cyan.
      const hot = cell === 0 || cell === 3 || cell === 6 || cell === 10 || cell === 11 || cell === 15;
      const c = hot ? PAL.neonMagenta : PAL.neonCyan;
      halo(b, px, y, pz, w * 4.2, h * 2.6, bladeRot, c, 0.15);
      groundGlow(b, x + dx * 9, z + dz * 9, dx !== 0 ? 26 : 12, dx !== 0 ? 12 : 26, c, 0.1, 0.026);
    });
  }
}

/* ------------------------------------------------------------------ guardrails */

/** Continuous low neon line along the inner face of the perimeter band, marking the edge of the world. */
function buildRouteMarkers(b: EnvBuilders): void {
  const bounds = b.plan.bounds;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const colors = [PAL.neonBlue, PAL.neonPink, PAL.neonCyan, PAL.neonMagenta];
  const y = 1.15;
  b.plan.walls.forEach((wall, i) => {
    const horizontal = wall.maxX - wall.minX > wall.maxZ - wall.minZ;
    const c = colors[i % colors.length];
    b.neon.color(c, 0.8);
    if (horizontal) {
      const inner = (wall.minZ + wall.maxZ) / 2 < cz ? wall.maxZ : wall.minZ;
      const glowZ = inner + ((wall.minZ + wall.maxZ) / 2 < cz ? 4 : -4);
      b.neon.tube(wall.minX + 12, y, inner, wall.maxX - 12, y, inner, 0.22);
      groundGlow(b, (wall.minX + wall.maxX) / 2, glowZ, wall.maxX - wall.minX - 24, 16, c, 0.05);
    } else {
      const inner = (wall.minX + wall.maxX) / 2 < cx ? wall.maxX : wall.minX;
      const glowX = inner + ((wall.minX + wall.maxX) / 2 < cx ? 4 : -4);
      b.neon.tube(inner, y, wall.minZ, inner, y, wall.maxZ, 0.22);
      groundGlow(b, glowX, (wall.minZ + wall.maxZ) / 2, 16, wall.maxZ - wall.minZ, c, 0.06);
    }
  });
}

/**
 * Tall light columns (the test arena frames its drift plaza with four). They stand inside the
 * block colliders, so the square itself stays completely empty to slide around in.
 */
function buildPylons(b: EnvBuilders): void {
  for (const { x, z, color: c } of b.plan.pylons) {
    if (!b.plan.isSolid(x, z, 0.6)) continue;
    const h = 15;
    b.props.color(PAL.metalDark, 0.9);
    b.props.box(x, 0.22 + h / 2, z, 1, h, 1);
    b.neonPulse.color(c, 1);
    b.neonPulse.tube(x, 1.4, z, x, 0.22 + h - 0.6, z, 0.42);
    b.neon.color(c, 0.9);
    b.neon.box(x, 0.22 + h + 0.4, z, 1.5, 0.5, 1.5);
    halo(b, x, 0.22 + h * 0.6, z, 9, h * 1.5, 0, c, 0.14);
    halo(b, x, 0.22 + h * 0.6, z, 9, h * 1.5, Math.PI / 2, c, 0.14);
    groundGlow(b, x - Math.sign(x) * 7, z - Math.sign(z) * 7, 34, 34, c, 0.11);
  }
}

function buildBarriers(b: EnvBuilders, rng: () => number): void {
  for (const bar of b.plan.barriers) {
    const along = bar.maxZ - bar.minZ > bar.maxX - bar.minX;
    const min = along ? bar.minZ : bar.minX;
    const max = along ? bar.maxZ : bar.maxX;
    const cross = along ? (bar.minX + bar.maxX) / 2 : (bar.minZ + bar.maxZ) / 2;
    const thick = (along ? bar.maxX - bar.minX : bar.maxZ - bar.minZ) - 0.4;
    const seg = 4;
    let i = 0;
    for (let t = min + 0.3; t + seg < max; t += seg + 0.3, i++) {
      const c = t + seg / 2;
      const px = along ? cross : c;
      const pz = along ? c : cross;
      const striped = bar.zone === 'jdm';
      const shade = striped && i % 2 === 0 ? PAL.neonMagenta : PAL.sidewalk;
      b.props.color(shade, striped && i % 2 === 0 ? 0.5 : 1.15);
      b.props.box(px, 0.34, pz, along ? thick : seg, 0.68, along ? seg : thick);
      b.props.color(shade, striped && i % 2 === 0 ? 0.45 : 0.95);
      b.props.box(px, 0.82, pz, along ? thick * 0.55 : seg, 0.3, along ? seg : thick * 0.55);
      // Reflector strip on top.
      const c2 = bar.zone === 'jdm' ? PAL.neonPink : PAL.neonCyan;
      // Even brightness: the old every-third-segment flash turned each guardrail into a
      // dotted line of bright specks. A guardrail should be one quiet stroke of colour.
      b.neon.color(c2, 0.3);
      if (along) b.neon.tube(px, 1.0, pz - seg * 0.35, px, 1.0, pz + seg * 0.35, 0.14);
      else b.neon.tube(px - seg * 0.35, 1.0, pz, px + seg * 0.35, 1.0, pz, 0.14);
      if (rng() < 0.12) {
        b.props.color(PAL.rust, 1);
        b.props.box(px, 1.15, pz, 0.5, 0.36, 0.5);
      }
    }
  }
}

/* ------------------------------------------------------------------ street lights */

/**
 * Street lamps are the one place the two families sit side by side, so they stay strictly
 * cold-with-an-occasional-rose. No third hue ever enters the street through a lamp head.
 */
export function lampColor(zone: ZoneId, rng: () => number): number {
  if (zone === 'corporate') return rng() < 0.8 ? PAL.winCold : PAL.neonCyan;
  if (zone === 'jdm') return rng() < 0.7 ? PAL.lampWarm : PAL.neonPink;
  return rng() < 0.55 ? PAL.winCold : PAL.lampWarm;
}

/**
 * One lamp post at (x, z) standing on ground height `y0`, with its arm reaching `arm` metres
 * in the unit direction (dx, dz) toward the road. The spill lands `spill` metres out.
 */
export function lampPost(
  b: EnvBuilders,
  x: number,
  z: number,
  y0: number,
  dx: number,
  dz: number,
  arm: number,
  poleH: number,
  color: number,
  spill: number,
): void {
  const alongX = Math.abs(dx) > Math.abs(dz);
  b.props.color(PAL.metalDark, 0.8);
  b.props.box(x, y0 + poleH / 2, z, 0.24, poleH, 0.24);
  const hx = x + dx * arm;
  const hz = z + dz * arm;
  const hy = y0 + poleH;
  b.props.color(PAL.metalDark, 0.7);
  b.props.tube(x, hy - 0.2, z, hx, hy - 0.2, hz, 0.16);
  b.neon.color(color, 1);
  // Lamp head is elongated along the arm; its halo faces down the street at the driver.
  b.neon.box(hx, hy - 0.45, hz, alongX ? 1.5 : 0.6, 0.22, alongX ? 0.6 : 1.5);
  // The arm is perpendicular to the street, so the halo faces along the street (rotY 0 = +Z).
  halo(b, hx, hy - 0.5, hz, 6, 4, alongX ? 0 : Math.PI / 2, color, 0.2);
  // The spill always lands on the asphalt, whatever the pole ended up standing on.
  groundGlow(b, x + dx * spill, z + dz * spill, alongX ? 20 : 30, alongX ? 30 : 20, color, 0.14);
}

function buildStreetLights(b: EnvBuilders, rng: () => number): void {
  const isSolid = b.plan.isSolid;
  for (const road of b.plan.roads) {
    if (road.axis === 'open') continue;
    const along = road.axis === 'z';
    const min = along ? road.minZ : road.minX;
    const max = along ? road.maxZ : road.maxX;
    const lo = along ? road.minX : road.minZ;
    const hi = along ? road.maxX : road.maxZ;
    const alley = road.lanes === 0;
    // Sparser than a real street would be: each pool of light should be its own event.
    const step = alley ? 22 : 38;
    for (let t = min + 8; t < max - 8; t += step) {
      for (const side of [-1, 1]) {
        const edge = side < 0 ? lo : hi;
        // Walk outward from the kerb until we find something solid to bolt the pole to.
        let off = 1.7;
        while (off < 9 && !isSolid(along ? edge + side * off : t, along ? t : edge + side * off, 0.5)) off += 0.7;
        if (off >= 9) continue;
        const ax = along ? edge + side * off : t;
        const az = along ? t : edge + side * off;
        if (!isSolid(ax, az, 0.5)) continue;
        const zone = b.plan.zoneAt(ax, az);
        const c = lampColor(zone, rng);
        const y0 = b.plan.padY(ax, az);
        const poleH = alley ? 4.4 : 7.4;
        // The arm reaches over the kerb, but never grows silly on a deep sidewalk.
        const arm = alley ? 0.9 : Math.min(off + 2.2, 5.2);
        const dx = along ? -side : 0;
        const dz = along ? 0 : -side;
        lampPost(b, ax, az, y0, dx, dz, arm, poleH, c, off + 5);
      }
    }
  }
}

/* ------------------------------------------------------------------ neon route gates */

export function buildGate(b: EnvBuilders, g: GateDef): void {
  const ends: Array<[number, number]> = [
    [g.x0, g.z0],
    [g.x1, g.z1],
  ];
  const colors = [g.left, g.right];
  let dx = g.x1 - g.x0;
  let dz = g.z1 - g.z0;
  const span = Math.hypot(dx, dz) || 1;
  dx /= span;
  dz /= span;
  // The gate spans the road, so its halos face along the road: the span's normal.
  const faceRot = Math.atan2(-dz, dx);
  for (let i = 0; i < 2; i++) {
    const [x, z] = ends[i];
    if (!g.trusted && !b.plan.isSolid(x, z, 0.2)) continue;
    const c = colors[i];
    // Structural pylon.
    b.props.color(PAL.metalDark, 0.9);
    b.props.box(x, g.height / 2, z, 0.9, g.height, 0.9);
    // Angled neon slashes, straight from the wet-road reference.
    const inward = i === 0 ? 1 : -1;
    const ox = dx * inward;
    const oz = dz * inward;
    b.neonPulse.color(c, 1);
    b.neonPulse.tube(x + ox * 0.6, 2.2, z + oz * 0.6, x + ox * 3.4, g.height - 1.4, z + oz * 3.4, 0.34);
    b.neon.color(c, 0.9);
    b.neon.tube(x + ox * 1.9, 1.6, z + oz * 1.9, x + ox * 4.6, g.height - 3.2, z + oz * 4.6, 0.26);
    b.neon.color(i === 0 ? g.right : g.left, 0.9);
    b.neon.tube(x - ox * 0.15, 3.4, z - oz * 0.15, x - ox * 0.15, g.height - 0.6, z - oz * 0.15, 0.3);
    halo(b, x + ox * 2, g.height / 2, z + oz * 2, 11, g.height * 1.3, faceRot, c, 0.16);
    groundGlow(b, x + ox * 5, z + oz * 5, 24, 24, c, 0.15);
  }
  // Top beam.
  const mx = (g.x0 + g.x1) / 2;
  const mz = (g.z0 + g.z1) / 2;
  b.props.color(PAL.metalDark, 0.8);
  b.props.orientedBox(mx, mz, dx, dz, span, 0.8, g.height - 0.8, g.height);
  b.neonPulse.color(g.left, 1);
  b.neonPulse.tube(g.x0, g.height - 1, g.z0, g.x1, g.height - 1, g.z1, 0.2);
}

function buildGates(b: EnvBuilders): void {
  for (const g of b.plan.gates) buildGate(b, g);
}

/* ------------------------------------------------------------------ billboards */

function buildBillboards(b: EnvBuilders): void {
  for (const d of b.plan.billboards) {
    const target = d.variant === 0 ? b.billA : b.billB;
    target.panel(d.x, d.y, d.z, d.w, d.h, d.rotY);
    // Frame + masts.
    const nx = Math.sin(d.rotY);
    const nz = Math.cos(d.rotY);
    const tx = Math.cos(d.rotY);
    const tz = -Math.sin(d.rotY);
    b.props.color(PAL.metalDark, 0.7);
    for (const s of [-1, 1]) {
      b.props.box(d.x + tx * s * (d.w / 2 + 0.6) - nx * 0.4, d.y, d.z + tz * s * (d.w / 2 + 0.6) - nz * 0.4, 1.2, d.h + 1.4, 1.2);
      b.props.box(
        d.x + tx * s * (d.w / 2 - 3) - nx * 0.9,
        (d.y - d.h / 2) / 2,
        d.z + tz * s * (d.w / 2 - 3) - nz * 0.9,
        1,
        d.y - d.h / 2,
        1,
      );
    }
    b.neonPulse.color(d.color, 1);
    b.neonPulse.tube(
      d.x + tx * (d.w / 2) + nx * 0.3,
      d.y - d.h / 2 - 0.5,
      d.z + tz * (d.w / 2) + nz * 0.3,
      d.x - tx * (d.w / 2) + nx * 0.3,
      d.y - d.h / 2 - 0.5,
      d.z - tz * (d.w / 2) + nz * 0.3,
      0.3,
    );
    halo(b, d.x + nx * 0.6, d.y, d.z + nz * 0.6, d.w * 2, d.h * 2.2, d.rotY, d.color, 0.13);
    groundGlow(b, d.x + nx * 18, d.z + nz * 18, Math.abs(nx) > 0.5 ? 52 : d.w * 1.5, Math.abs(nx) > 0.5 ? d.w * 1.5 : 52, d.color, 0.08);
  }
}

/* ------------------------------------------------------------------ cables */

/** Overhead cables strung between facing blocks, as in the approved reference. */
function buildCables(b: EnvBuilders, rng: () => number): void {
  const isSolid = b.plan.isSolid;
  for (const [x0, z0, x1, z1] of b.plan.cableRuns) {
    if (!isSolid(x0, z0, 0.2) || !isSolid(x1, z1, 0.2)) continue;
    const y = 8 + rng() * 2.5;
    const sag = 0.8 + rng() * 0.9;
    b.props.color(PAL.metalDark, 0.35);
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    b.props.tube(x0, y, z0, mx, y - sag, mz, 0.09);
    b.props.tube(mx, y - sag, mz, x1, y, z1, 0.09);
    // One lamp every handful of cables, not one on half of them.
    if (rng() < 0.16) {
      const c = rng() < 0.5 ? PAL.winWarm : PAL.neonCyan;
      b.props.color(PAL.metalDark, 0.4);
      b.props.box(mx, y - sag - 0.5, mz, 0.1, 1, 0.1);
      b.neonFlicker.color(c, 1);
      b.neonFlicker.box(mx, y - sag - 1.1, mz, 0.42, 0.42, 0.42);
      // Face the halo down the street the cable crosses, not along the cable.
      halo(b, mx, y - sag - 1.1, mz, 6, 6, Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 0 : Math.PI / 2, c, 0.2);
      groundGlow(b, mx, mz, 16, 16, c, 0.09);
    }
  }
}

/* ------------------------------------------------------------------ block clutter */

/** Walks the inside edge of a block, calling back with a point and its outward normal. */
function walkLedge(
  blk: { minX: number; maxX: number; minZ: number; maxZ: number },
  inset: number,
  step: number,
  cb: (x: number, z: number, dx: number, dz: number, along: 'x' | 'z') => void,
): void {
  for (let x = blk.minX + inset + 2; x < blk.maxX - inset - 2; x += step) {
    cb(x, blk.minZ + inset, 0, -1, 'x');
    cb(x, blk.maxZ - inset, 0, 1, 'x');
  }
  for (let z = blk.minZ + inset + 2; z < blk.maxZ - inset - 2; z += step) {
    cb(blk.minX + inset, z, -1, 0, 'z');
    cb(blk.maxX - inset, z, 1, 0, 'z');
  }
}

/** Weathered, desaturated, and all inside the two families. Nothing here is a fresh hue. */
const CONTAINER_COLORS = [PAL.rust, 0x27384f, 0x3a2f46, 0x4a2a3a, 0x2d3a48];

function buildBlockClutter(b: EnvBuilders, rng: () => number): void {
  const isRoad = b.plan.isRoad;
  const padY = b.plan.padY;
  for (const blk of b.plan.blocks) {
    walkLedge(blk, 1.4, 7, (x, z, dx, dz, along) => {
      // Only dress ledges that actually face a street.
      if (!isRoad(x + dx * 6, z + dz * 6)) return;
      const zone = blk.zone;
      const y0 = padY(x, z);
      const rotY = dx === 1 ? Math.PI / 2 : dx === -1 ? -Math.PI / 2 : dz === 1 ? 0 : Math.PI;
      const r = rng();
      if (zone === 'jdm') {
        if (r < 0.3) {
          // Shipping container, long side parallel to the street.
          const stack = rng() < 0.25 ? 2 : 1;
          for (let i = 0; i < stack; i++) {
            b.props.color(CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)], 0.8 + rng() * 0.5);
            b.props.box(
              x - dx * 0.2,
              y0 + 1.22 + i * 2.5,
              z - dz * 0.2,
              along === 'x' ? 6.1 : 2.5,
              2.44,
              along === 'x' ? 2.5 : 6.1,
            );
          }
          if (rng() < 0.5) {
            const uv = signCell(rng() < 0.5 ? 10 : 15);
            b.signs.panel(
              x + dx * 1.35,
              y0 + 1.5 + (stack - 1) * 2.5,
              z + dz * 1.35,
              2.4,
              1.8,
              rotY,
              uv.u0,
              uv.v0,
              uv.u1,
              uv.v1,
            );
          }
        } else if (r < 0.5) {
          // Oil drums and crates.
          for (let i = 0; i < 3; i++) {
            b.props.color(rng() < 0.5 ? PAL.rust : PAL.metalDark, 0.7 + rng() * 0.6);
            b.props.box(x + (rng() - 0.5) * 3.4, y0 + 0.46, z + (rng() - 0.5) * 3.4, 0.62, 0.92, 0.62);
          }
        } else if (r < 0.62) {
          // Junk pile.
          b.props.color(PAL.metalDark, 0.6);
          b.props.box(x, y0 + 0.6, z, 2.4, 1.2, 1.8);
          b.props.color(PAL.rust, 0.8);
          b.props.box(x + 0.6, y0 + 1.5, z - 0.3, 1.4, 0.8, 1.2);
        }
      } else if (r < 0.22 && r >= 0.12 && zone === 'urban') {
        // A street stall under an awning, lit warm from underneath: the cosy note.
        const warm = rng() < 0.75 ? PAL.neonAmber : PAL.neonPink;
        b.props.color(PAL.rust, 1.05);
        b.props.box(x, y0 + 1.1, z, along === 'x' ? 3 : 1.8, 2.2, along === 'x' ? 1.8 : 3);
        b.props.color(PAL.rust, 0.8);
        b.props.box(x + dx * 0.7, y0 + 2.35, z + dz * 0.7, along === 'x' ? 3.6 : 3.2, 0.14, along === 'x' ? 3.2 : 3.6);
        b.neon.color(warm, 0.8);
        if (along === 'x') b.neon.tube(x - 1.5, y0 + 2.2, z + dz * 1.5, x + 1.5, y0 + 2.2, z + dz * 1.5, 0.12);
        else b.neon.tube(x + dx * 1.5, y0 + 2.2, z - 1.5, x + dx * 1.5, y0 + 2.2, z + 1.5, 0.12);
        halo(b, x + dx * 1.6, y0 + 1.4, z + dz * 1.6, 5, 3.4, rotY, warm, 0.18);
        groundGlow(b, x + dx * 3.2, z + dz * 3.2, 10, 10, warm, 0.13);
        b.props.color(PAL.metalDark, 0.8);
        b.props.box(x + (along === 'x' ? 2.2 : 0), y0 + 0.45, z + (along === 'x' ? 0 : 2.2), 0.8, 0.9, 0.8);
      } else if (r < 0.12) {
        // Vending machines and kiosks glowing on the sidewalk. Rare enough to be a landmark.
        const c = zone === 'corporate' ? PAL.neonCyan : rng() < 0.5 ? PAL.neonMagenta : PAL.winWarm;
        b.props.color(PAL.metalDark, 1);
        b.props.box(x, y0 + 0.95, z, along === 'x' ? 1.9 : 0.8, 1.9, along === 'x' ? 0.8 : 1.9);
        b.neon.color(c, 1);
        b.neon.panel(x + dx * 0.45, y0 + 1.05, z + dz * 0.45, along === 'x' ? 1.5 : 0.55, 1.3, rotY);
        halo(b, x + dx * 0.7, y0 + 1.05, z + dz * 0.7, 7, 6, rotY, c, 0.17);
        groundGlow(b, x + dx * 3.5, z + dz * 3.5, 13, 13, c, 0.1);
      }
    });

    if (blk.zone !== 'jdm') continue;
    // Pipe runs, AC units and graffiti on the garage walls.
    walkLedge(blk, 3.6, 5.5, (x, z, dx, dz, along) => {
      if (!isRoad(x + dx * 8, z + dz * 8)) return;
      const rotY = dx === 1 ? Math.PI / 2 : dx === -1 ? -Math.PI / 2 : dz === 1 ? 0 : Math.PI;
      const y0 = padY(x, z);
      const r = rng();
      if (r < 0.45) {
        b.props.color(PAL.metalDark, 0.85);
        const py = y0 + 1.2 + rng() * 4;
        if (along === 'x') b.props.box(x, py, z + dz * 0.35, 5.4, 0.24, 0.24);
        else b.props.box(x + dx * 0.35, py, z, 0.24, 0.24, 5.4);
        b.props.box(x + dx * 0.35, (y0 + py) / 2, z + dz * 0.35, 0.22, py - y0, 0.22);
      }
      if (r > 0.4 && r < 0.7) {
        b.props.color(PAL.metalDark, 1.1);
        b.props.box(
          x + dx * 0.6,
          y0 + 3.4 + rng() * 3,
          z + dz * 0.6,
          along === 'x' ? 1.3 : 0.9,
          1,
          along === 'x' ? 0.9 : 1.3,
        );
      }
      if (r > 0.86) {
        const uv = signCell(rng() < 0.5 ? 10 : 11);
        b.signs.panel(x + dx * 0.32, y0 + 2.6, z + dz * 0.32, 3.2, 3.2, rotY, uv.u0, uv.v0, uv.u1, uv.v1);
        halo(b, x + dx * 0.6, y0 + 2.6, z + dz * 0.6, 10, 9, rotY, PAL.neonPink, 0.13);
        groundGlow(b, x + dx * 5.5, z + dz * 5.5, 18, 18, PAL.neonPink, 0.09);
      }
    });
  }
}
