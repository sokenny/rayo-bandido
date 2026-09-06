import type { GameEvent, NearMissPass, NearMissState, TargetState, VehicleState } from '../core/types';
import { NEAR_MISS } from '../config/tuning';
import { clamp01 } from '../core/math';
import { LEVEL_GAP } from './collision';

/**
 * Near miss scoring: points for shaving past an electric car at speed without touching it.
 *
 * A pass opens when the player comes within `NEAR_MISS.radius` of an active target. It is paid
 * at its APEX — the tick the gap stops shrinking and reopens by `apexSlack` — not when the
 * player finally leaves the radius. That matters for presentation: at the apex the shaved car
 * is still alongside the player and on screen, so the "+X" can pop next to it the way a kill
 * pops over a wreck. By the time the player clears the radius it is metres behind the camera.
 * A pass that ends without ever showing an apex is still settled on the way out, and the pass
 * only re-arms once the player leaves `exitRadius` (wider than `radius`, so skimming the edge
 * cannot split one pass into two awards).
 *
 * The pass carries its closest approach and the speed the player was doing at that moment, and
 * the award is a function of exactly those two: fast and close pays, slow or wide pays the
 * floor.
 *
 * Touching the car voids the pass — a near miss has to be a miss. Contact is always at or
 * before the closest approach, so a bump is already known by the time the apex is called.
 *
 * Closest approach is measured over the whole tick, not just at its end. At 50 m/s the car
 * covers 0.8 m per step, so sampling only the end pose would make the closest point the
 * player actually reached a matter of luck; the swept measurement makes a grazing pass
 * repeatable, which is what makes the ceiling worth chasing.
 *
 * Awards are paid by `src/sim/economy.ts` so all money flows through one place.
 */

function createPass(): NearMissPass {
  return { active: false, minDist: Infinity, speedAtClosest: 0, touched: false, scored: false };
}

export function createNearMissState(targetCount: number): NearMissState {
  const passes: NearMissPass[] = [];
  for (let i = 0; i < targetCount; i++) passes.push(createPass());
  return { passes, count: 0, best: 0 };
}

export function resetNearMissState(n: NearMissState): void {
  for (let i = 0; i < n.passes.length; i++) resetPass(n.passes[i]);
  n.count = 0;
  n.best = 0;
}

function resetPass(p: NearMissPass): void {
  p.active = false;
  p.minDist = Infinity;
  p.speedAtClosest = 0;
  p.touched = false;
  p.scored = false;
}

/**
 * Points for a completed pass. `minDist` is centre-to-centre metres at the closest approach
 * and `speed` the player's speed at that moment — deliberately not the peak over the pass,
 * so flooring it once the car is safely behind you does not pay. Returns 0 for a pass that
 * does not qualify (too slow, or never actually close); anything that does qualify pays at
 * least `NEAR_MISS.minPoints`.
 *
 * Both factors are curved and then the product is curved again, so the ceiling belongs to a
 * paint-scraping pass on nitro and nothing else: a comfortable 3 m pass at 145 km/h scores
 * around 17, a tight 2.5 m pass at 160 km/h around 32, and even a graze at the un-boosted top
 * speed only reaches the mid 40s — the ceiling needs a graze *and* nitro.
 */
export function nearMissPoints(minDist: number, speed: number): number {
  if (!(minDist < NEAR_MISS.radius) || speed < NEAR_MISS.minSpeed) return 0;
  const graze = NEAR_MISS.contactDist + NEAR_MISS.grazeClearance;
  const closeness = clamp01((NEAR_MISS.radius - minDist) / (NEAR_MISS.radius - graze));
  const speed01 = clamp01((speed - NEAR_MISS.minSpeed) / (NEAR_MISS.fullSpeed - NEAR_MISS.minSpeed));
  const quality = Math.pow(
    Math.pow(closeness, NEAR_MISS.closenessCurve) * Math.pow(speed01, NEAR_MISS.speedCurve),
    NEAR_MISS.qualityCurve,
  );
  const points = NEAR_MISS.minPoints + (NEAR_MISS.maxPoints - NEAR_MISS.minPoints) * quality;
  return Math.round(Math.min(NEAR_MISS.maxPoints, points));
}

/** Quality 0..1 of a pass, for presentation (popup size, whoosh loudness). */
export function nearMissQuality(points: number): number {
  const span = NEAR_MISS.maxPoints - NEAR_MISS.minPoints;
  return span > 0 ? clamp01((points - NEAR_MISS.minPoints) / span) : 0;
}

/**
 * Smallest distance between two points moving linearly over one tick. `a*`/`b*` are the two
 * start positions, `a*2`/`b*2` the two end positions. Allocation-free.
 */
export function sweptMinDistance(
  ax: number, az: number, ax2: number, az2: number,
  bx: number, bz: number, bx2: number, bz2: number,
): number {
  // Relative position at the start of the tick and how it changed across it.
  const px = bx - ax;
  const pz = bz - az;
  const dx = bx2 - ax2 - px;
  const dz = bz2 - az2 - pz;
  const dd = dx * dx + dz * dz;
  let s = 0;
  if (dd > 1e-12) {
    s = -(px * dx + pz * dz) / dd;
    if (s < 0) s = 0;
    else if (s > 1) s = 1;
  }
  const cx = px + dx * s;
  const cz = pz + dz * s;
  return Math.sqrt(cx * cx + cz * cz);
}

/**
 * Advances every in-flight pass and emits a `nearMiss` event for each one that closed this
 * tick with a qualifying result. Call after positions and collisions have been resolved, so
 * a bump is already visible as contact.
 */
export function stepNearMiss(
  n: NearMissState,
  v: VehicleState,
  targets: TargetState[],
  events: GameEvent[],
): void {
  const speed = Math.sqrt(v.vx * v.vx + v.vz * v.vz);
  const contact = NEAR_MISS.contactDist + NEAR_MISS.contactSlack;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const p = n.passes[i];
    if (!p) continue;

    if (t.status !== 'active' || Math.abs(t.y - v.y) > LEVEL_GAP) {
      // The car is gone mid-pass (shot, or waiting to respawn), or it is on another level
      // altogether — the viaduct overhead is not a near miss: drop it, no award.
      resetPass(p);
      continue;
    }

    const dx = t.x - v.x;
    const dz = t.z - v.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (!p.active) {
      if (dist >= NEAR_MISS.radius) continue;
      p.active = true;
      p.minDist = Infinity;
      p.speedAtClosest = 0;
      p.touched = false;
      p.scored = false;
    }

    const swept = sweptMinDistance(v.prevX, v.prevZ, v.x, v.z, t.prevX, t.prevZ, t.x, t.z);
    const closest = swept < dist ? swept : dist;
    if (closest < p.minDist) {
      p.minDist = closest;
      p.speedAtClosest = speed;
    }
    if (closest <= contact) p.touched = true;

    const leaving = dist >= NEAR_MISS.exitRadius;
    // The apex: the gap has reopened, so the closest approach is behind us and final.
    const pastApex = dist > p.minDist + NEAR_MISS.apexSlack;
    if (!p.scored && (pastApex || leaving)) {
      p.scored = true;
      const points = p.touched ? 0 : nearMissPoints(p.minDist, p.speedAtClosest);
      if (points > 0) {
        n.count++;
        if (points > n.best) n.best = points;
        events.push({
          type: 'nearMiss',
          targetId: t.id,
          x: t.x,
          y: t.y,
          z: t.z,
          points,
          quality: nearMissQuality(points),
        });
      }
    }

    // Only leaving re-arms the pass, so one approach can never pay twice.
    if (leaving) resetPass(p);
  }
}
