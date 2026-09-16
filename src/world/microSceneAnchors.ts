import type { ObstacleBox } from '../core/types';
import type { MicroSceneAnchor, MicroSceneAnchorTag, MicroSceneAnchorType, MicroSceneTransform } from '../microScenes/types';
import type { World } from './arenaWorld';
import { busStopCrowds } from './busStopCrowds';
import { BUS_STOP, inRect, type BlockRect, type Rect, type RibbonDef } from './cityPlan';
import { hash01, onRibbonAtLevel, pathBox } from './cityGen';
import { createRectIndex } from './spatialIndex';
import { createProjection, offsetAtStation, pointAtStation, projectOntoPath } from './track';

/**
 * WHERE A MICRO-SCENE MAY STAND, as a LAYER over a city — the same one-way dependency the race
 * doors and the hustlers have (`cityStreetSites.ts`, `hustlerSpots.ts`): the city does not know
 * anybody is ever going to use its pavements for anything.
 *
 * AN ANCHOR DESCRIBES A PLACE, NEVER A SCENE. "A bus shelter." "Six metres of wide kerb outside
 * shops." "A dark arch under the viaduct." Which of the eight scenes may stand there is the
 * director's business (`src/microScenes/runtime/director.ts`), decided from the anchor's type and
 * tags — so a ninth scene finds hundreds of places to happen without a coordinate being typed.
 *
 * WHERE THEY COME FROM, all three derived from what the world already knows:
 *
 *   BUS STOPS       - every shelter the waiting crowds left EMPTY (`busStopCrowds.ts` populates
 *                     about seven in ten). A scene and a crowd never share a shelter, so the bay
 *                     is never six people deep, and the two systems never need to know about each
 *                     other. The shelter dictates the geometry, so these are the one kind of
 *                     anchor that carries its own actor slots.
 *   UNDER THE DECK  - beside the viaduct's columns (`plan.pillars`), out of the lane and in the
 *                     shade. Dark, hidden, and the only anchors the two bridge scenes accept.
 *   THE KERB        - stations walked along every ground street, exactly the way the street props
 *                     are placed (`world/streetProps.ts`): measured pavement, the zone and the
 *                     block behind it, clear of every junction mouth, marker, shelter and lot.
 *
 * EVERY ANCHOR IS CHECKED ON ITS OWN against the streets at all levels, every collider the
 * simulation has, the meets and forecourts, the activity markers, the hustlers' patches, and the
 * other anchors. One that cannot hold three people and a parked car with room to spare is not
 * emitted at all — it is cheaper to have fewer places than to have one inside a wall.
 *
 * Deterministic: `hash01` of positions, like the rest of the generator, so every client and every
 * reload gets the same list.
 *
 * Headings follow the game's convention: 0 faces north (-z), and an anchor FACES THE ROAD, so an
 * actor at local +z stands further from the traffic.
 */

const A = {
  /** Metres between the kerb stations tried. */
  step: 12,
  /** Least distance between two anchors (m). Much wider than the props': these are events. */
  spacing: 70,
  /** Least measured pavement for a kerb anchor, and for one that may carry a parked car (m). */
  minPavement: 2.4,
  minAlleyPavement: 1.5,
  carPavement: 3.2,
  /** Least road half width (m) at a kerb a car may be parked at. Narrower and it is in the lane. */
  carHalfWidth: 8,
  /** Always left clear between an anchor and the kerb (m): the walking line. */
  passage: 0.9,
  /** Nothing within this of another street's edge (m): junction corners stay clear. */
  junctionClear: 9,
  /** A back lane runs close to the streets it joins; it needs a shorter rule or it gives nothing. */
  alleyJunctionClear: 3,
  /** Clear radius round the player's spawn and the activity markers (m). */
  spawnClear: 45,
  markerClear: 26,
  /** Clear radius round a bus shelter and a hustler's patch (m). */
  shelterClear: 14,
  hustlerClear: 16,
  /** Share of eligible kerb stations that become an anchor. The rest are ordinary pavement. */
  chance: 0.34,
  /** The back lanes are scarcer, so more of the eligible ones are kept. */
  alleyChance: 0.8,
  /** Room a scene needs round the anchor origin, clear of solids (m). */
  clearRadius: 3.2,
  /** A back lane is narrow by definition; three people still fit in it. */
  alleyClearRadius: 1.6,
  /**
   * Metres out from a viaduct column to look for standing room, nearest first. A column is
   * usually planted in the block beside the street it spans, so the first few are inside
   * something and the search walks out until it finds shade that is not masonry.
   */
  bridgeOut: [4, 6, 8, 10.5, 13],
  /** Room wanted under a deck (m). Less than the kerb's: the columns are part of the scene. */
  bridgeClearRadius: 2.8,
  /** Deck height (m) under which there is no room for anybody. */
  minDeck: 5,
};

/** Where the waiting bay is in front of a shelter, and how the three slots sit in it. */
const SHELTER_SLOTS: MicroSceneTransform[] = [
  { x: -1.6, z: 0.2, heading: 0 },
  { x: 0.9, z: 1.15, heading: -0.4 },
  { x: 2.3, z: 0.35, heading: 0.25 },
];
const SHELTER_PROP_SLOTS: MicroSceneTransform[] = [
  { x: -2.9, y: 2.15, z: 1.05, heading: 0 },
  { x: 3.3, y: 1.65, z: 1.15, heading: 0 },
];

/**
 * Why candidate places were turned down, from the last run. Authoring support, not a rule: it is
 * how "the alleys give me nothing" gets answered with a number instead of a guess.
 */
export interface AnchorPlacementStats {
  pillars: number;
  pillarWet: number;
  pillarRoad: number;
  pillarSolid: number;
  pillarCrowded: number;
  stations: number;
  stationUnpaved: number;
  stationNarrow: number;
  stationJunction: number;
  stationSolid: number;
  stationCrowded: number;
  stationRolled: number;
}

export const anchorPlacementStats: AnchorPlacementStats = {
  pillars: 0, pillarWet: 0, pillarRoad: 0, pillarSolid: 0, pillarCrowded: 0,
  stations: 0, stationUnpaved: 0, stationNarrow: 0, stationJunction: 0,
  stationSolid: 0, stationCrowded: 0, stationRolled: 0,
};

function resetStats(): void {
  for (const key of Object.keys(anchorPlacementStats) as Array<keyof AnchorPlacementStats>) anchorPlacementStats[key] = 0;
}

export function addMicroSceneAnchors(world: World): World {
  world.layout.microSceneAnchors = placeMicroSceneAnchors(world);
  return world;
}

export function placeMicroSceneAnchors(world: World): MicroSceneAnchor[] {
  const { plan, layout } = world;
  const out: MicroSceneAnchor[] = [];
  const proj = createProjection();
  resetStats();
  const S = anchorPlacementStats;

  /* ---------------------------------------------------------------- what is in the way */

  const boxes = layout.colliders.filter((b) => (b.minY === undefined || b.minY < 1.2) && (b.maxY === undefined || b.maxY > 0.3));
  const boxIndex = createRectIndex<ObstacleBox>(boxes, 32, 4);
  const blockIndex = createRectIndex<BlockRect>(plan.blocks, 32, 4);
  const lots: Rect[] = [...(plan.meets ?? []), ...(plan.gasStations ?? []), ...(plan.garage ? [plan.garage] : [])].map((m) => m.lot);
  const megas: Rect[] = (plan.megastructures ?? []).map((m) => m.footprint);
  const ground = plan.ribbons.filter((rb) => !rb.elevated);
  const elevated = plan.ribbons.filter((rb) => rb.elevated);

  /** Rings of ground nothing may stand in: the spawn, every activity marker, every shelter. */
  const keepOut: Array<{ x: number; z: number; r: number }> = [
    { x: layout.playerSpawn.x, z: layout.playerSpawn.z, r: A.spawnClear },
  ];
  for (const s of layout.rushSites ?? []) keepOut.push({ x: s.x, z: s.z, r: A.markerClear });
  for (const s of layout.passengerStops ?? []) keepOut.push({ x: s.x, z: s.z, r: A.markerClear });
  for (const s of layout.streetSites ?? []) keepOut.push({ x: s.x, z: s.z, r: A.markerClear });
  if (layout.circuitSite) keepOut.push({ x: layout.circuitSite.x, z: layout.circuitSite.z, r: A.markerClear + 10 });
  if (layout.buhoSite) keepOut.push({ x: layout.buhoSite.x, z: layout.buhoSite.z, r: A.markerClear });
  if (layout.garageSite) keepOut.push({ x: layout.garageSite.x, z: layout.garageSite.z, r: A.markerClear });
  for (const h of layout.hustlerSpots ?? []) keepOut.push({ x: h.x, z: h.z, r: A.hustlerClear });

  /** The ground's own height: the streets are draped over the terrain, and so is everything here. */
  const groundY = (x: number, z: number): number => (layout.groundY ? layout.groundY(x, z) : 0);

  const onAnyRoad = (x: number, z: number, pad: number, except: RibbonDef | null): boolean => {
    const y = groundY(x, z);
    for (const rb of plan.ribbons) {
      if (rb === except) continue;
      // A deck overhead is not in the way; its ramp coming down to the ground is.
      if (onRibbonAtLevel(rb, x, z, y, pad)) return true;
    }
    return false;
  };

  const solidNear = (x: number, z: number, radius: number): boolean => {
    for (const b of boxIndex.at(x, z)) if (inRect(b, x, z, radius)) return true;
    for (const m of megas) if (inRect(m, x, z, radius)) return true;
    for (const l of lots) if (inRect(l, x, z, 4)) return true;
    return false;
  };

  const tooClose = (x: number, z: number, metres: number): boolean => {
    for (const a of out) if (Math.hypot(a.transform.x - x, a.transform.z - z) < metres) return true;
    return false;
  };

  const blocked = (x: number, z: number): boolean => {
    for (const k of keepOut) if (Math.hypot(x - k.x, z - k.z) < k.r) return true;
    return false;
  };

  /** Ground level only: nothing stands on a ramp or a deck. */
  const onGround = (x: number, z: number): boolean => {
    if (!layout.surface) return true;
    const sample = { y: 0, gx: 0, gz: 0 };
    layout.surface.sample(x, z, groundY(x, z), sample);
    return sample.y <= groundY(x, z) + 0.05;
  };

  /* ---------------------------------------------------------------- bus shelters */

  const stops = plan.busStops ?? [];
  const populated = new Set(busStopCrowds(stops).map((c) => c.stop));
  for (let i = 0; i < stops.length; i++) {
    // A shelter the waiting crowd already uses is theirs. One system per shelter.
    if (populated.has(i)) continue;
    const st = stops[i];
    // The front of the shelter, a step into the bay, facing the road.
    const x = st.x + st.nx * (BUS_STOP.depth / 2 - 0.3);
    const z = st.z + st.nz * (BUS_STOP.depth / 2 - 0.3);
    if (blocked(x, z) || tooClose(x, z, A.spacing)) continue;
    out.push({
      id: `ms-stop-${i}`,
      type: 'bus-stop',
      tags: ['bus-stop', 'roadside', 'civilian', 'wide-sidewalk'],
      transform: { x, y: groundY(x, z), z, heading: Math.atan2(st.nx, -st.nz) },
      // The shelter dictates where anybody can stand, so this anchor has an opinion about it.
      actorSlots: SHELTER_SLOTS.map((s) => ({ ...s })),
      propSlots: SHELTER_PROP_SLOTS.map((s) => ({ ...s })),
      roadClearance: BUS_STOP.depth / 2,
      visibility: 'open',
    });
  }

  /* ---------------------------------------------------------------- under the deck */

  for (let i = 0; i < (plan.pillars ?? []).length; i++) {
    const p = (plan.pillars ?? [])[i];
    S.pillars++;
    if (p.wet || p.y < A.minDeck) {
      S.pillarWet++;
      continue;
    }
    // Out to one side of the columns, still under the deck's shade. Nearest first, both sides.
    let placed = false;
    for (const out_m of A.bridgeOut) {
      for (const side of [-1, 1]) {
        const nx = -p.tz * side;
        const nz = p.tx * side;
        const x = p.x + nx * out_m;
        const z = p.z + nz * out_m;
        if (!onGround(x, z) || onAnyRoad(x, z, A.bridgeClearRadius, null)) {
          S.pillarRoad++;
          continue;
        }
        if (solidNear(x, z, A.bridgeClearRadius)) {
          S.pillarSolid++;
          continue;
        }
        if (blocked(x, z) || tooClose(x, z, A.spacing)) {
          S.pillarCrowded++;
          continue;
        }
        out.push({
          id: `ms-bridge-${i}-${side > 0 ? 'r' : 'l'}`,
          type: 'under-bridge',
          tags: ['under-bridge', 'dark', 'hidden', 'civilian'],
          // Facing back in towards the columns, which is where the road under the deck runs.
          transform: { x, y: groundY(x, z), z, heading: Math.atan2(-nx, nz) },
          actorSlots: [],
          propSlots: [],
          visibility: 'hidden',
          roadClearance: out_m,
        });
        placed = true;
        break;
      }
      if (placed) break;
    }
  }

  /* ---------------------------------------------------------------- the kerb */

  const overDeck = (x: number, z: number): boolean => {
    for (const e of elevated) {
      const box = pathBox(e.path);
      if (x < box.minX - 4 || x > box.maxX + 4 || z < box.minZ - 4 || z > box.maxZ + 4) continue;
      projectOntoPath(e.path, x, z, proj);
      if (proj.dist < proj.halfWidth + 1 && proj.y > 4.5) return true;
    }
    return false;
  };

  const blockBehind = (x: number, z: number): BlockRect | null => {
    for (const b of blockIndex.at(x, z)) if (inRect(b, x, z, 2)) return b;
    return null;
  };

  const kerbs = plan.kerbs;
  if (kerbs) {
    for (const rb of ground) {
      const path = rb.path;
      for (const side of [-1, 1]) {
        for (let s = A.step; s < path.length - A.step; s += A.step) {
          S.stations++;
          const at = pointAtStation(path, s, proj);
          const c = offsetAtStation(path, s, 0);
          const nx = -c.tz * side;
          const nz = c.tx * side;
          const alley = rb.kind === 'alley';
          const paved =
            kerbs.paved(rb, at.index, side) &&
            kerbs.paved(rb, pointAtStation(path, s - 6, proj).index, side) &&
            kerbs.paved(rb, pointAtStation(path, s + 6, proj).index, side);
          if (!paved) {
            S.stationUnpaved++;
            continue;
          }
          const width = kerbs.widthAt(rb, at.index, side, at.t);
          if (width < (alley ? A.minAlleyPavement : A.minPavement)) {
            S.stationNarrow++;
            continue;
          }

          // Halfway across the walkable band, so a scene has pavement on both sides of it.
          const outward = c.halfWidth + A.passage + Math.min(2.4, (width - A.passage) * 0.5);
          const x = c.x + nx * outward;
          const z = c.z + nz * outward;
          // Never on the asphalt — not another street's, and not a bend of its own.
          if (!onGround(x, z) || onAnyRoad(x, z, 0.4, null)) {
            S.stationJunction++;
            continue;
          }
          // And never in a junction mouth: another street's edge nearby is a corner.
          if (onAnyRoad(x, z, alley ? A.alleyJunctionClear : A.junctionClear, rb)) {
            S.stationJunction++;
            continue;
          }
          if (solidNear(x, z, alley ? A.alleyClearRadius : A.clearRadius)) {
            S.stationSolid++;
            continue;
          }
          if (blocked(x, z) || tooClose(x, z, A.spacing)) {
            S.stationCrowded++;
            continue;
          }
          if (hash01(x * 0.731 + side, z * 1.117) > (alley ? A.alleyChance : A.chance)) {
            S.stationRolled++;
            continue;
          }

          const zone = c.zone;
          const underDeck = overDeck(x, z);
          const downtown = plan.downtown !== null && plan.downtown !== undefined && inRect(plan.downtown, x, z);
          const behind = blockBehind(x + nx * 2, z + nz * 2);
          const wide = width >= A.carPavement;
          // A parked car at this kerb needs pavement to put two wheels on and a road wide enough
          // that the lane beside it is still a lane.
          const carRoom = wide && c.halfWidth >= A.carHalfWidth;
          const shops = zone === 'jdm' || zone === 'urban';
          const industrial = zone === 'corporate' && !!behind && behind.massing >= 3;

          const tags: MicroSceneAnchorTag[] = ['roadside', 'civilian'];
          if (wide) tags.push('wide-sidewalk');
          if (downtown) tags.push('downtown');
          if (underDeck) tags.push('under-bridge', 'dark');
          if (shops) tags.push('commercial');
          if (alley) tags.push('dark', 'hidden');
          if (industrial) tags.push('industrial');
          // A checkpoint needs room for two cars and an officer, and a street wide enough that
          // stopping somebody on it is plausible.
          if (carRoom && !underDeck && !alley) tags.push('police-compatible');

          // The type is what the place IS; the tags are everything else true about it. A scene
          // names several types, because a taxonomy that sorts strictly is one that starves.
          const type: MicroSceneAnchorType = underDeck
            ? 'under-highway'
            : alley
              ? industrial
                ? 'industrial-alley'
                : 'dark-service-road'
              : carRoom
                ? 'lay-by'
                : shops
                  ? 'commercial'
                  : 'roadside';

          out.push({
            id: `ms-kerb-${out.length}`,
            type,
            tags,
            transform: { x, y: groundY(x, z), z, heading: Math.atan2(-nx, nz) },
            actorSlots: [],
            propSlots: [],
            approachDirection: { x: c.tx * side, z: c.tz * side },
            roadClearance: outward - c.halfWidth,
            visibility: underDeck || rb.kind === 'alley' ? 'partially-hidden' : 'open',
          });
        }
      }
    }
  }

  /* ---------------------------------------------------------------- the bridge pair */

  // The two bridge scenes share the underpasses; they never share one at the same time. Every
  // dark anchor within this of another is marked exclusive with it, so one of them standing
  // takes its neighbours out of the draw.
  const DARK_EXCLUSION = 220;
  const dark = out.filter((a) => a.tags.includes('dark'));
  for (const a of dark) {
    const others = dark.filter((b) => b !== a && Math.hypot(b.transform.x - a.transform.x, b.transform.z - a.transform.z) < DARK_EXCLUSION);
    if (others.length > 0) a.exclusiveWith = others.map((b) => b.id);
  }

  return out;
}
