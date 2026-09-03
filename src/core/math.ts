/** Planar math helpers. Keep allocation-free; these run inside the fixed-step loop. */

export const TAU = Math.PI * 2;

export function forwardX(heading: number): number {
  return Math.sin(heading);
}

export function forwardZ(heading: number): number {
  return -Math.cos(heading);
}

export function rightX(heading: number): number {
  return Math.cos(heading);
}

export function rightZ(heading: number): number {
  return Math.sin(heading);
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Exponential smoothing that is stable regardless of dt. `rate` is roughly 1/seconds. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Shortest signed difference b - a in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Interpolate angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

export function moveToward(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

export function length2(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export function msToKmh(ms: number): number {
  return ms * 3.6;
}

export function kmhToMs(kmh: number): number {
  return kmh / 3.6;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
