import type { ArenaLayout, BusState, TargetState, VehicleState } from '../core/types';
import type { StreetPropsState } from '../sim/streetProps';
import { BUSES, PASS_BY, SIM_STEP } from '../config/tuning';
import { clamp01 } from '../core/math';
import { LEVEL_GAP } from '../sim/collision';

/**
 * Finds the things the player is tearing past, for the wind gust (`audio/windGust.ts`).
 *
 * A pass is judged in the frame of the relative motion: the closing velocity picks the line the
 * object slides along, the perpendicular distance off that line (less both half widths) is the
 * clearance, and the distance along it over the closing speed is the time until the two are
 * abreast. A gust fires on the frame that time drops through `PASS_BY.lead`, so the voice can
 * swell into the moment of passing rather than start after it.
 *
 * Moving things (electric cars, buses, police) are read straight off the state. Static things —
 * small colliders (viaduct pillars, gas-station columns, masts) and street props standing where
 * the city put them — are filed once per layout in a coarse grid. Buildings are not: a street
 * wall is alongside for a whole block, and a wall is not a pass.
 *
 * Presentation only, allocation-free per frame. The caller owns the trigger, like the backfire.
 */

export interface PassByGust {
  /** -1 the object went by on the left, +1 on the right (the player's frame). */
  side: number;
  /** 0..1 from clearance and closing speed. */
  strength: number;
  /** Closing speed (m/s): a faster pass is shorter and brighter. */
  speed: number;
  /** 0..1, how much air the object moves: a cone is 0, a bus or a pillar is 1. */
  size: number;
  /** Seconds until the object is abreast. The voice peaks then. */
  lead: number;
  /** Index into `targets` when the object is a traffic car, else -1 (`audio/ambientVoice.ts`). */
  target: number;
}

export interface PassByDetector {
  /** The gusts that start this frame. Shared array, overwritten on the next call. */
  step(
    v: VehicleState,
    targets: readonly TargetState[],
    buses: readonly BusState[] | null,
    police: readonly TargetState[] | null,
    streetProps: StreetPropsState | null,
  ): readonly PassByGust[];
  reset(): void;
}

interface StaticPoints {
  x: Float32Array;
  z: Float32Array;
  r: Float32Array;
  minY: Float32Array;
  maxY: Float32Array;
  size: Float32Array;
  /** Street prop index, or -1 for a collider. */
  prop: Int32Array;
  cells: Map<number, number[]>;
}

const CELL = 16;
const CAR_RADIUS = 0.95;
const BUS_RADIUS = BUSES.width / 2;
/** Keys for the repeat guard: one band per kind of object. */
const KEY_TARGET = 1 << 20;
const KEY_BUS = 2 << 20;
const KEY_POLICE = 3 << 20;
const RECENT = 16;
const STATICS = new WeakMap<ArenaLayout, StaticPoints>();

const cellKey = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);

function buildStatics(layout: ArenaLayout): StaticPoints {
  const xs: number[] = [];
  const zs: number[] = [];
  const rs: number[] = [];
  const y0: number[] = [];
  const y1: number[] = [];
  const sz: number[] = [];
  const pr: number[] = [];
  for (const b of layout.colliders) {
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    if (w > PASS_BY.maxPostSize || d > PASS_BY.maxPostSize) continue;
    xs.push((b.minX + b.maxX) / 2);
    zs.push((b.minZ + b.maxZ) / 2);
    rs.push(Math.max(w, d) / 2);
    y0.push(b.minY ?? -1e4);
    y1.push(b.maxY ?? 1e4);
    sz.push(clamp01(Math.max(w, d) / 1.5));
    pr.push(-1);
  }
  const props = layout.streetProps ?? [];
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    if (p.kind === 'litter') continue;
    xs.push(p.x);
    zs.push(p.z);
    rs.push(p.kind === 'dumpster' ? 0.9 : 0.35);
    y0.push(p.y - 1);
    y1.push(p.y + 2);
    sz.push(p.kind === 'dumpster' || p.kind === 'charger' ? 0.6 : p.kind === 'barrier' || p.kind === 'sign' ? 0.3 : 0.1);
    pr.push(i);
  }
  const cells = new Map<number, number[]>();
  for (let i = 0; i < xs.length; i++) {
    const k = cellKey(Math.floor(xs[i] / CELL), Math.floor(zs[i] / CELL));
    const list = cells.get(k);
    if (list) list.push(i);
    else cells.set(k, [i]);
  }
  return {
    x: Float32Array.from(xs),
    z: Float32Array.from(zs),
    r: Float32Array.from(rs),
    minY: Float32Array.from(y0),
    maxY: Float32Array.from(y1),
    size: Float32Array.from(sz),
    prop: Int32Array.from(pr),
    cells,
  };
}

export function createPassByDetector(layout: ArenaLayout): PassByDetector {
  let statics = STATICS.get(layout);
  if (!statics) {
    statics = buildStatics(layout);
    STATICS.set(layout, statics);
  }
  const S = statics;

  const out: PassByGust[] = [];
  const pool: PassByGust[] = [];
  for (let i = 0; i < 8; i++) pool.push({ side: 0, strength: 0, speed: 0, size: 0, lead: 0, target: -1 });

  const recentKey = new Int32Array(RECENT).fill(-1);
  const recentAt = new Float64Array(RECENT).fill(-1e9);
  let recentNext = 0;
  let clock = 0;
  let lastX = NaN;
  let lastZ = NaN;

  // Per-call scratch, so `check` needs no closure allocation.
  let px = 0, pz = 0, py = 0, pvx = 0, pvz = 0, rx = 0, rz = 0, elapsed = 0;

  function seen(key: number): boolean {
    for (let i = 0; i < RECENT; i++) {
      if (recentKey[i] === key && clock - recentAt[i] < PASS_BY.repeatGap) return true;
    }
    return false;
  }

  function check(key: number, ox: number, oz: number, ovx: number, ovz: number, radius: number, size: number): void {
    if (out.length >= pool.length) return;
    const wx = pvx - ovx;
    const wz = pvz - ovz;
    const rel = Math.sqrt(wx * wx + wz * wz);
    if (rel < PASS_BY.minSpeed) return;
    const ux = wx / rel;
    const uz = wz / rel;
    const dx = ox - px;
    const dz = oz - pz;
    const along = dx * ux + dz * uz;
    if (along < 0) return;
    const tc = along / rel;
    // Launched on the frame the time-to-abreast falls through the lead.
    if (tc > PASS_BY.lead || tc + elapsed <= PASS_BY.lead) return;
    const off = Math.abs(ux * dz - uz * dx);
    const clearance = off - radius - PASS_BY.halfWidth;
    if (clearance > PASS_BY.maxClearance) return;
    const closeness = 1 - clamp01(clearance / PASS_BY.maxClearance);
    const speed01 = clamp01((rel - PASS_BY.minSpeed) / (PASS_BY.fullSpeed - PASS_BY.minSpeed));
    const strength = Math.pow(closeness, 1.6) * (0.25 + 0.75 * speed01);
    if (strength < PASS_BY.minStrength) return;
    if (seen(key)) return;
    recentKey[recentNext] = key;
    recentAt[recentNext] = clock;
    recentNext = (recentNext + 1) % RECENT;
    const g = pool[out.length];
    g.side = dx * rx + dz * rz >= 0 ? 1 : -1;
    g.strength = strength;
    g.speed = rel;
    g.size = size;
    g.lead = tc;
    g.target = key >= KEY_TARGET && key < KEY_BUS ? key - KEY_TARGET : -1;
    out.push(g);
  }

  return {
    step(v, targets, buses, police, streetProps) {
      out.length = 0;
      // Positions move per sim tick, frames may not: the time since the car last moved is the
      // window a crossing could have happened in. A jump (respawn, teleport) is not a pass.
      const moved = Math.hypot(v.x - lastX, v.z - lastZ);
      const speed = Math.hypot(v.vx, v.vz);
      lastX = v.x;
      lastZ = v.z;
      if (!(moved > 1e-4)) return out;
      elapsed = speed > 0.1 ? moved / speed : 0;
      clock += elapsed;
      if (elapsed > 0.25 || elapsed <= 0) return out;

      px = v.x;
      pz = v.z;
      py = v.y;
      pvx = v.vx;
      pvz = v.vz;
      rx = Math.cos(v.heading);
      rz = Math.sin(v.heading);

      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (t.status !== 'active' || Math.abs(t.y - py) > LEVEL_GAP) continue;
        check(KEY_TARGET + i, t.x, t.z, (t.x - t.prevX) / SIM_STEP, (t.z - t.prevZ) / SIM_STEP, CAR_RADIUS, 0.45);
      }
      if (police) {
        for (let i = 0; i < police.length; i++) {
          const t = police[i];
          if (t.status !== 'active' || Math.abs(t.y - py) > LEVEL_GAP) continue;
          check(KEY_POLICE + i, t.x, t.z, (t.x - t.prevX) / SIM_STEP, (t.z - t.prevZ) / SIM_STEP, CAR_RADIUS, 0.45);
        }
      }
      if (buses && py < LEVEL_GAP) {
        for (let i = 0; i < buses.length; i++) {
          const b = buses[i];
          check(KEY_BUS + i, b.x, b.z, (b.x - b.prevX) / SIM_STEP, (b.z - b.prevZ) / SIM_STEP, BUS_RADIUS, 1);
        }
      }

      if (speed < PASS_BY.minSpeed) return out;
      // Far enough ahead to catch anything whose lead falls inside this frame, plus the widest pass.
      const reach = speed * (PASS_BY.lead + elapsed) + PASS_BY.maxClearance + PASS_BY.maxPostSize;
      const i0 = Math.floor((px - reach) / CELL);
      const i1 = Math.floor((px + reach) / CELL);
      const j0 = Math.floor((pz - reach) / CELL);
      const j1 = Math.floor((pz + reach) / CELL);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const list = S.cells.get(cellKey(i, j));
          if (!list) continue;
          for (let k = 0; k < list.length; k++) {
            const n = list[k];
            if (py < S.minY[n] || py > S.maxY[n]) continue;
            const prop = S.prop[n];
            // A prop already sent flying is not where the city put it.
            if (prop >= 0 && streetProps && streetProps.bodyOf[prop] >= 0) continue;
            check(n, S.x[n], S.z[n], 0, 0, S.r[n], S.size[n]);
          }
        }
      }
      return out;
    },

    reset() {
      out.length = 0;
      recentKey.fill(-1);
      recentAt.fill(-1e9);
      lastX = NaN;
      lastZ = NaN;
    },
  };
}
