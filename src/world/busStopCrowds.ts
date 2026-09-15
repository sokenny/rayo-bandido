import { AMBIENT_VOICE } from '../config/tuning';
import type { MeetPersonKind } from './carMeet';
import { BUS_STOP, type BusStopDef } from './cityPlan';

/**
 * Who is waiting at which bus stop. One description, read by the people drawn under the shelter
 * (`render/scene/busStopCrowdVisual.ts`) and by the voice that comes out of one of them
 * (`audio/ambientVoice.ts`), so the shout starts from somebody you can see.
 *
 * Deterministic from the stop list alone: every screen and every reload puts the same two to four
 * people at the same stops. No navigation — they stand in the waiting bay and fidget.
 */

export interface BusStopWaiter {
  /** World position and facing (0 is -z, + clockwise, the crowd rig's convention). */
  x: number;
  z: number;
  heading: number;
  act: 'stand' | 'phone';
  /** `MeetPersonSpec.kind` for their clothes. */
  kind: MeetPersonKind;
  seed: number;
}

export interface BusStopCrowd {
  /** Index into `plan.busStops`. */
  stop: number;
  x: number;
  y: number;
  z: number;
  waiters: BusStopWaiter[];
}

/** 0..1 from integers, stable. */
function hash01(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Where the waiting bay is: the open front half of the shelter, clear of the poster bay (m). */
const BAY_FROM = -BUS_STOP.length / 2 + 0.7;
const BAY_TO = BUS_STOP.length / 2 - 3.3;
const ACROSS_FROM = -0.15;
const ACROSS_TO = BUS_STOP.depth / 2 - 0.2;
const KINDS: MeetPersonKind[] = ['phone', 'pocket', 'folded', 'idle'];

const CACHE = new WeakMap<readonly BusStopDef[], BusStopCrowd[]>();

export function busStopCrowds(stops: readonly BusStopDef[] | null | undefined): BusStopCrowd[] {
  if (!stops || stops.length === 0) return [];
  const cached = CACHE.get(stops);
  if (cached) return cached;
  const cfg = AMBIENT_VOICE.stop;
  const out: BusStopCrowd[] = [];
  for (let i = 0; i < stops.length; i++) {
    const st = stops[i];
    if (hash01(i, 1) >= cfg.populated) continue;
    const count = cfg.minWaiting + Math.floor(hash01(i, 2) * (cfg.maxWaiting - cfg.minWaiting + 1));
    const waiters: BusStopWaiter[] = [];
    // Spread along the bay in slots, so nobody stands inside anybody else.
    const slot = (BAY_TO - BAY_FROM) / count;
    const face = Math.atan2(st.nx, -st.nz);
    for (let k = 0; k < count; k++) {
      const along = BAY_FROM + slot * (k + 0.25 + 0.5 * hash01(i, 10 + k));
      const across = ACROSS_FROM + (ACROSS_TO - ACROSS_FROM) * hash01(i, 20 + k);
      const seed = i * 16 + k + 1;
      const phone = hash01(i, 30 + k) < 0.4;
      waiters.push({
        x: st.x + st.tx * along + st.nx * across,
        z: st.z + st.tz * along + st.nz * across,
        // Mostly toward the road, where the bus comes from; a little each way.
        heading: face + (hash01(i, 40 + k) - 0.5) * 1.4,
        act: phone ? 'phone' : 'stand',
        kind: phone ? 'phone' : KINDS[1 + Math.floor(hash01(i, 50 + k) * 3)],
        seed,
      });
    }
    out.push({ stop: i, x: st.x, y: st.y, z: st.z, waiters });
  }
  CACHE.set(stops, out);
  return out;
}
