import type { CityPlan } from './cityPlan';
import type { SpawnPoint } from '../core/types';
import { createProjection, projectOntoPath } from './track';

/** Called only on recovery. Weight height so a bridge wins over the street below it. */
export function cityRecovery(plan: CityPlan, x: number, z: number, y: number, heading: number): SpawnPoint {
  const p = createProjection();
  let score = Infinity;
  let best: SpawnPoint = { x, z, y, heading };
  for (const road of plan.ribbons) {
    projectOntoPath(road.path, x, z, p);
    const cost = p.dist + Math.abs(p.y - y) * 5;
    if (cost >= score) continue;
    const forward = Math.sin(heading) * p.tx - Math.cos(heading) * p.tz >= 0 ? 1 : -1;
    score = cost;
    best = { x: p.x, z: p.z, y: p.y, heading: Math.atan2(p.tx * forward, -p.tz * forward) };
  }
  return best;
}
