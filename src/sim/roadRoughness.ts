import { ROAD_ROUGHNESS } from '../config/tuning';

/**
 * The asphalt is not a plane. A few centimetres of long, soft unevenness — settled patches,
 * swells over old trenches, the crown of the road — laid over whatever the surface field says,
 * read by each wheel on its own (`src/sim/surface.ts`). No potholes: nothing here is sharp
 * enough to thump. What it does is make the springs work, and at speed the load on the tyres
 * comes and goes, which is where the car stops feeling like it is on rails (`stepVehicle`).
 *
 * Smooth value noise, a few octaves (`ROAD_ROUGHNESS.octaves`), each on its own rotated and
 * offset lattice so no wave lines up with the street grid. Deterministic in (x, z): the same
 * patch of road always feels the same, for every car, online or not. Allocation-free.
 */
export interface RoadRoughnessSample {
  /** Height over the surface (m). */
  h: number;
  /** Rise per metre of +x / +z travel. */
  gx: number;
  gz: number;
}

function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  // -1 .. 1
  return (h & 0xffff) / 32767.5 - 1;
}

/**
 * Adds one octave at lattice coordinates (u, w) to `out`, with the derivative taken back into
 * world axes through the octave's rotation (cos c, sin s) and scale.
 */
function octave(
  u: number,
  w: number,
  seed: number,
  amp: number,
  inv: number,
  c: number,
  s: number,
  out: RoadRoughnessSample,
): void {
  const iu = Math.floor(u);
  const iw = Math.floor(w);
  const fu = u - iu;
  const fw = w - iw;
  // Quintic fade: the slope is continuous across cells, so the damper never sees a kink.
  const su = fu * fu * fu * (fu * (fu * 6 - 15) + 10);
  const sw = fw * fw * fw * (fw * (fw * 6 - 15) + 10);
  const du = 30 * fu * fu * (fu * (fu - 2) + 1);
  const dw = 30 * fw * fw * (fw * (fw - 2) + 1);
  const a = hash(iu, iw, seed);
  const b = hash(iu + 1, iw, seed);
  const d = hash(iu, iw + 1, seed);
  const e = hash(iu + 1, iw + 1, seed);
  const k1 = b - a;
  const k2 = d - a;
  const k3 = a - b - d + e;
  const n = a + k1 * su + k2 * sw + k3 * su * sw;
  const dnu = (k1 + k3 * sw) * du * inv;
  const dnw = (k2 + k3 * su) * dw * inv;
  out.h += amp * n;
  // u = (c x + s z) * inv, w = (-s x + c z) * inv
  out.gx += amp * (dnu * c - dnw * s);
  out.gz += amp * (dnu * s + dnw * c);
}

const ROT_C: number[] = [];
const ROT_S: number[] = [];
for (let i = 0; i < ROAD_ROUGHNESS.octaves.length; i++) {
  const ang = 0.61 + i * 1.23;
  ROT_C.push(Math.cos(ang));
  ROT_S.push(Math.sin(ang));
}

/** Writes the unevenness at (x, z), times `scale` (0 = a perfect plane), into `out`. */
export function sampleRoadRoughness(x: number, z: number, scale: number, out: RoadRoughnessSample): void {
  out.h = 0;
  out.gx = 0;
  out.gz = 0;
  if (scale <= 0) return;
  const oct = ROAD_ROUGHNESS.octaves;
  for (let i = 0; i < oct.length; i++) {
    const inv = 1 / oct[i].wavelength;
    const c = ROT_C[i];
    const s = ROT_S[i];
    const u = (c * x + s * z) * inv + 17.3 * i;
    const w = (-s * x + c * z) * inv - 5.9 * i;
    octave(u, w, i + 1, oct[i].amplitude * scale, inv, c, s, out);
  }
}
