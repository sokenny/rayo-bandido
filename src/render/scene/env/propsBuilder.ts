import { ARENA_BARRIERS, ARENA_BLOCKS, ARENA_ROADS } from '../../../world/arenaLayout';
import { PAL } from './palette';
import { makeRng } from './meshBuilder';
import { groundGlow, halo, isRoad, isSolid, padY, type EnvBuilders } from './builders';
import { signCell } from './textures';
import { zoneAt } from './cityBuilder';

/**
 * Everything that dresses the streets: guardrails, street lights, the neon route gates from
 * the wet-road reference, holographic billboards and the JDM garage clutter.
 *
 * House rule: a prop may only exist where `isSolid()` is true, i.e. inside a collider the
 * simulation already knows about. That single test is what keeps art and collision honest -
 * the player can never drive through a container or clip a lamp post.
 */
export function buildProps(b: EnvBuilders): void {
  const rng = makeRng(0x7a1ce);
  buildRouteMarkers(b);
  buildPlazaPylons(b);
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
  for (const blk of ARENA_BLOCKS) {
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

/** Continuous low neon line along the inner face of the perimeter, marking the circuit. */
function buildRouteMarkers(b: EnvBuilders): void {
  const y = 1.15;
  b.neon.color(PAL.neonCyan, 0.85);
  b.neon.tube(-100, y, -100, -100, y, 100, 0.22);
  groundGlow(b, -96, 0, 16, 200, PAL.neonCyan, 0.06);
  b.neon.color(PAL.neonBlue, 0.8);
  b.neon.tube(-100, y, -100, 100, y, -100, 0.22);
  groundGlow(b, 0, -96, 200, 16, PAL.neonBlue, 0.05);
  b.neon.color(PAL.neonMagenta, 0.75);
  b.neon.tube(100, y, -100, 100, y, 100, 0.22);
  groundGlow(b, 96, 0, 16, 200, PAL.neonMagenta, 0.05);
  b.neon.color(PAL.neonPink, 0.7);
  b.neon.tube(-100, y, 100, 100, y, 100, 0.22);
  groundGlow(b, 0, 96, 200, 16, PAL.neonPink, 0.05);
}

/**
 * Four tall light columns on the block corners that frame the drift plaza. They stand inside
 * the block colliders, so the square itself stays completely empty to slide around in.
 */
function buildPlazaPylons(b: EnvBuilders): void {
  const corners: Array<[number, number, number]> = [
    [-15.4, -32.4, PAL.neonCyan],
    [15.4, -32.4, PAL.neonCyan],
    [-15.4, 32.4, PAL.neonMagenta],
    [15.4, 32.4, PAL.neonMagenta],
  ];
  for (const [x, z, c] of corners) {
    if (!isSolid(x, z, 0.6)) continue;
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
  for (const bar of ARENA_BARRIERS) {
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
function lampColor(zone: string, rng: () => number): number {
  if (zone === 'corporate') return rng() < 0.8 ? PAL.winCold : PAL.neonCyan;
  if (zone === 'jdm') return rng() < 0.6 ? PAL.winWarm : PAL.neonPink;
  return rng() < 0.65 ? PAL.winCold : PAL.winWarm;
}

function buildStreetLights(b: EnvBuilders, rng: () => number): void {
  for (const road of ARENA_ROADS) {
    if (road.axis === 'open') continue;
    const along = road.axis === 'z';
    const min = along ? road.minZ : road.minX;
    const max = along ? road.maxZ : road.maxX;
    const lo = along ? road.minX : road.minZ;
    const hi = along ? road.maxX : road.maxZ;
    // Sparser than a real street would be: each pool of light should be its own event.
    const step = road.tag === 'alley-jdm' ? 22 : 38;
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
        const zone = zoneAt(ax, az);
        const c = lampColor(zone, rng);
        const y0 = padY(ax, az);
        const poleH = road.tag === 'alley-jdm' ? 4.4 : 7.4;
        // The arm reaches over the kerb, but never grows silly on a deep sidewalk.
        const arm = road.tag === 'alley-jdm' ? 0.9 : Math.min(off + 2.2, 5.2);
        b.props.color(PAL.metalDark, 0.8);
        b.props.box(ax, y0 + poleH / 2, az, 0.24, poleH, 0.24);
        const hx = along ? ax - side * arm : ax;
        const hz = along ? az : az - side * arm;
        const hy = y0 + poleH;
        b.props.color(PAL.metalDark, 0.7);
        if (along) b.props.box((ax + hx) / 2, hy - 0.2, az, arm, 0.16, 0.16);
        else b.props.box(ax, hy - 0.2, (az + hz) / 2, 0.16, 0.16, arm);
        b.neon.color(c, 1);
        // Lamp head is elongated along the arm; its halo faces down the street at the driver.
        b.neon.box(hx, hy - 0.45, hz, along ? 1.5 : 0.6, 0.22, along ? 0.6 : 1.5);
        halo(b, hx, hy - 0.5, hz, 6, 4, along ? 0 : Math.PI / 2, c, 0.2);
        // The spill always lands on the asphalt, whatever the pole ended up standing on.
        const gx = along ? edge - side * 5 : t;
        const gz = along ? t : edge - side * 5;
        groundGlow(b, gx, gz, along ? 30 : 20, along ? 20 : 30, c, 0.14);
      }
    }
  }
}

/* ------------------------------------------------------------------ neon route gates */

interface GateDef {
  /** Gate spans along this axis between a and b, sitting at `cross` on the other axis. */
  axis: 'x' | 'z';
  a: number;
  b: number;
  cross: number;
  height: number;
  left: number;
  right: number;
}

const GATES: GateDef[] = [
  // Corporate highway, north and south approaches.
  { axis: 'x', a: -100.8, b: -78.7, cross: -55, height: 11.5, left: PAL.neonCyan, right: PAL.neonBlue },
  { axis: 'x', a: -100.8, b: -78.7, cross: 55, height: 11.5, left: PAL.neonCyan, right: PAL.neonMagenta },
  // Urban north street.
  { axis: 'z', a: -100.8, b: -76, cross: -45, height: 10.5, left: PAL.neonMagenta, right: PAL.neonCyan },
  // East avenue, entering the JDM half.
  { axis: 'x', a: 100.8, b: 78.7, cross: 40, height: 10.5, left: PAL.neonPink, right: PAL.neonMagenta },
  // The garage alley.
  { axis: 'x', a: 49.4, b: 60.6, cross: 40, height: 7.5, left: PAL.neonMagenta, right: PAL.neonCyan },
];

function buildGates(b: EnvBuilders): void {
  for (const g of GATES) {
    const px = (t: number): number => (g.axis === 'x' ? t : g.cross);
    const pz = (t: number): number => (g.axis === 'x' ? g.cross : t);
    const ends = [g.a, g.b];
    const colors = [g.left, g.right];
    for (let i = 0; i < 2; i++) {
      const t = ends[i];
      const x = px(t);
      const z = pz(t);
      if (!isSolid(x, z, 0.2)) continue;
      const c = colors[i];
      // Structural pylon.
      b.props.color(PAL.metalDark, 0.9);
      b.props.box(x, g.height / 2, z, 0.9, g.height, 0.9);
      // Angled neon slashes, straight from the wet-road reference.
      const inward = Math.sign(ends[1 - i] - t);
      const ox = g.axis === 'x' ? inward : 0;
      const oz = g.axis === 'x' ? 0 : inward;
      b.neonPulse.color(c, 1);
      b.neonPulse.tube(x + ox * 0.6, 2.2, z + oz * 0.6, x + ox * 3.4, g.height - 1.4, z + oz * 3.4, 0.34);
      b.neon.color(c, 0.9);
      b.neon.tube(x + ox * 1.9, 1.6, z + oz * 1.9, x + ox * 4.6, g.height - 3.2, z + oz * 4.6, 0.26);
      b.neon.color(i === 0 ? g.right : g.left, 0.9);
      b.neon.tube(x - ox * 0.15, 3.4, z - oz * 0.15, x - ox * 0.15, g.height - 0.6, z - oz * 0.15, 0.3);
      halo(b, x + ox * 2, g.height / 2, z + oz * 2, 11, g.height * 1.3, g.axis === 'x' ? 0 : Math.PI / 2, c, 0.16);
      groundGlow(b, x + ox * 5, z + oz * 5, g.axis === 'x' ? 28 : 20, g.axis === 'x' ? 20 : 28, c, 0.15);
    }
    // Top beam.
    const mid = (g.a + g.b) / 2;
    const span = Math.abs(g.b - g.a);
    b.props.color(PAL.metalDark, 0.8);
    b.props.box(px(mid), g.height - 0.4, pz(mid), g.axis === 'x' ? span : 0.8, 0.8, g.axis === 'x' ? 0.8 : span);
    b.neonPulse.color(g.left, 1);
    if (g.axis === 'x') b.neonPulse.tube(g.a, g.height - 1, g.cross, g.b, g.height - 1, g.cross, 0.2);
    else b.neonPulse.tube(g.cross, g.height - 1, g.a, g.cross, g.height - 1, g.b, 0.2);
  }
}

/* ------------------------------------------------------------------ billboards */

interface BillboardDef {
  variant: 0 | 1;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  rotY: number;
  color: number;
}

const BILLBOARDS: BillboardDef[] = [
  { variant: 0, x: -100.6, y: 27, z: -22, w: 30, h: 17, rotY: Math.PI / 2, color: PAL.neonCyan },
  { variant: 0, x: 26, y: 24, z: -100.6, w: 26, h: 15, rotY: 0, color: PAL.neonCyan },
  { variant: 1, x: 100.6, y: 25, z: -34, w: 26, h: 15, rotY: -Math.PI / 2, color: PAL.neonMagenta },
  { variant: 1, x: -26, y: 21, z: 100.6, w: 24, h: 14, rotY: Math.PI, color: PAL.neonMagenta },
];

function buildBillboards(b: EnvBuilders): void {
  for (const d of BILLBOARDS) {
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
  // Anchors sit just inside the facing blocks so every cable has something to hang from.
  const runs: Array<[number, number, number, number]> = [];
  for (let z = -70; z <= -34; z += 9) runs.push([-14.6, z, 14.6, z]);
  for (let x = -70; x <= -34; x += 9) runs.push([x, -14.6, x, 14.6]);
  for (let z = 20; z <= 74; z += 9) runs.push([49.4, z, 60.6, z]);
  for (let x = 34; x <= 72; x += 9) runs.push([x, 76.6, x, 100.6]);
  for (const [x0, z0, x1, z1] of runs) {
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
  for (const blk of ARENA_BLOCKS) {
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
