import * as THREE from 'three';

/**
 * The destination arrow: a chevron riding over the car's own roof, turning to point the way to
 * the passenger's drop-off. Underground 2's, in this city's colours.
 *
 * WHAT IT IS FOR. The drop-off ring (`env/passengerMarker.ts`) says WHERE, and the minimap says
 * roughly which way, but neither answers the only question a driver has at 90 km/h coming up on
 * a junction: left or right. This does, and it does it without asking the player to look away
 * from the road.
 *
 * WHY IT RIDES THE CAR. It is bolted to the car's own position — a few metres up and a few
 * ahead — and nothing but its HEADING is allowed to move. That is the whole trick, and getting
 * it wrong is what makes this look broken: park the arrow out on the road ahead instead and it
 * slides off the screen the moment the player turns round, spins, or reverses, which is exactly
 * the moment they are lost and need it. Riding the roof, it is on screen in every camera, at
 * every heading, at every speed, and the answer is always in the same place to look for.
 *
 * WHERE THE HEADING COMES FROM. `world/roadGraph.ts` walks the route a fixed distance along the
 * streets and hands back a point; the arrow points from the car AT that point. So it lies down
 * the street while the street is the way, and swings across towards the turn as the junction
 * comes up — the corner is announced before it arrives. It never points through a building,
 * because the point it aims at is never off the road.
 *
 * WHY IT IS PITCHED. The chase camera sits low and looks flat along the road, so an arrow lying
 * level would be seen edge-on, and a shape seen edge-on has no shape. It is tipped a third of a
 * turn towards the car, showing its face; at the drop-off it tips the rest of the way and
 * points down at the kerb, so the last stretch stops being a direction and becomes an address.
 *
 * WHY IT IS VIOLET. The side rides own violet in this city — the pin, the ring and this. The
 * shape is Underground 2's; the colour says which activity is talking.
 *
 * BUDGET. Two draw calls, one extruded shape and its edges, built once and moved. `depthTest`
 * is off: a guide the player cannot see behind a corner tower is a guide that fails exactly
 * when it is needed, and additive blending at this opacity glows over the road rather than
 * hides it. Animation is scalar writes; nothing allocates per frame.
 */
export interface DestinationArrowVisual {
  group: THREE.Group;
  /**
   * Ride this car: `y` is the road under it, `heading` its yaw. Applied rigidly, with no glide
   * — a guide that lags the car it is bolted to is a guide that swims about at speed.
   */
  follow(x: number, y: number, z: number, heading: number): void;
  /** Point along this direction on the ground plane. Need not be normalised. */
  face(dirX: number, dirZ: number): void;
  /**
   * 0 = pitched over the road giving a direction, 1 = nosed right down at the drop-off. Driven
   * by how much road is left.
   */
  setDive(value: number): void;
  /** Take up the heading with no swing, at the start of a ride or after a teleport. */
  snap(): void;
  show(): void;
  hide(): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

/**
 * Where it rides, relative to the car: up (m), and forward along the car's heading (m).
 *
 * Set together, and set by looking at the screen rather than by measuring the city. Too high or
 * too near and the chevron fills the top of the frame and hides the road it is describing; too
 * far out and it stops reading as YOUR arrow. Here it sits just over the bonnet's horizon, a
 * little above the roofline of the car ahead.
 */
const HOVER = 4;
const LEAD = 10;
/** Size against the shape's own units: about 3.2 m nose to tail. */
const SCALE = 0.62;
/**
 * How far the nose is dropped when it is only giving a direction (rad). NOT ZERO: see the note
 * on pitch above — level, it would be seen edge-on from the chase camera and disappear.
 */
const BASE_PITCH = 0.52;
/** How far the nose is dropped when it is standing over the drop-off itself (rad). */
const DIVE_PITCH = 1.38;
/** Half the bob, peak to mean (m). */
const BOB = 0.22;
/** How fast the heading swings round to a new one, and how fast the dive follows (per second). */
const TURN_RATE = 5;
const DIVE_RATE = 3;
/**
 * How fast the arrow's seat swings round to the car's heading (per second).
 *
 * The car's yaw is not the direction it is travelling — sideways is the whole point of this
 * game — so bolting the lead rigidly to the yaw would throw the arrow out to one side every
 * time the back end steps out. Easing it keeps the arrow over the bonnet through a drift and
 * still walks it back round the car within half a second of a spin.
 */
const SEAT_RATE = 4;
/** How far it rolls into a turn, at most (rad). */
const MAX_BANK = 0.5;
const VIOLET = 0x8a45ff;
const VIOLET_EDGE = 0xdcc6ff;

/** The Underground 2 silhouette: a broad head with swept barbs and a notched tail. */
function arrowShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 3.6);
  s.lineTo(2.45, 1.15);
  s.lineTo(0.95, 1.15);
  s.lineTo(0.95, -1.6);
  s.lineTo(0, -0.72);
  s.lineTo(-0.95, -1.6);
  s.lineTo(-0.95, 1.15);
  s.lineTo(-2.45, 1.15);
  s.closePath();
  return s;
}

export function createDestinationArrow(): DestinationArrowVisual {
  const group = new THREE.Group();
  group.name = 'destination-arrow';
  group.visible = false;

  // `inner` carries the lie of the arrow — pitched over the road, nosing down at the end — so
  // the group's own rotation stays a plain compass heading and the two never fight.
  const inner = new THREE.Group();
  inner.scale.setScalar(SCALE);
  group.add(inner);

  const geo = new THREE.ExtrudeGeometry(arrowShape(), {
    // Real thickness, not a decal: pointing straight at the camera or straight away from it the
    // face is foreshortened to nothing, and the side walls are all that is left to read.
    depth: 0.85,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.14,
    bevelSegments: 2,
  });
  // Balanced about its own middle, so heading and bank turn it rather than swing it.
  geo.translate(0, -1, -0.425);
  geo.rotateX(-Math.PI / 2);

  const bodyMat = new THREE.MeshBasicMaterial({
    color: VIOLET,
    transparent: true,
    opacity: 0.4,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const body = new THREE.Mesh(geo, bodyMat);
  body.renderOrder = 12;
  inner.add(body);

  const edgeGeo = new THREE.EdgesGeometry(geo, 45);
  const edgeMat = new THREE.LineBasicMaterial({
    color: VIOLET_EDGE,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);
  edges.renderOrder = 13;
  inner.add(edges);

  /** The car's pose, taken as given: the one thing here that is never smoothed. */
  let carX = 0;
  let carY = 0;
  let carZ = 0;
  /** Which way the lead offset points: the car's heading, eased. */
  let wantSeat = 0;
  let atSeat = 0;
  /** Where the route says to point, and where the arrow has actually swung to. */
  let wantYaw = 0;
  let atYaw = 0;
  let wantDive = 0;
  let atDive = 0;
  let bank = 0;
  let fresh = true;

  /** Nose-down angle for a dive amount: leaning at the player, then right down at the kerb. */
  function pitchFor(dive: number): number {
    return BASE_PITCH + dive * (DIVE_PITCH - BASE_PITCH);
  }

  return {
    group,
    follow(x, y, z, heading) {
      carX = x;
      carY = y;
      carZ = z;
      wantSeat = heading;
    },
    face(dirX, dirZ) {
      if (dirX === 0 && dirZ === 0) return;
      wantYaw = Math.atan2(dirX, -dirZ);
    },
    setDive(value) {
      wantDive = value < 0 ? 0 : value > 1 ? 1 : value;
    },
    snap() {
      fresh = true;
    },
    show() {
      if (!group.visible) {
        group.visible = true;
        fresh = true;
      }
    },
    hide() {
      group.visible = false;
    },
    update(dt, time) {
      if (!group.visible) return;
      if (fresh) {
        fresh = false;
        atYaw = wantYaw;
        atDive = wantDive;
        atSeat = wantSeat;
        bank = 0;
      }
      let seatDelta = wantSeat - atSeat;
      while (seatDelta > Math.PI) seatDelta -= Math.PI * 2;
      while (seatDelta < -Math.PI) seatDelta += Math.PI * 2;
      atSeat += seatDelta * (1 - Math.exp(-SEAT_RATE * dt));
      // Shortest way round, so a route that flips from north to south does not swing the arrow
      // the long way about.
      let delta = wantYaw - atYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const step = delta * (1 - Math.exp(-TURN_RATE * dt));
      atYaw += step;
      atDive += (wantDive - atDive) * (1 - Math.exp(-DIVE_RATE * dt));
      // It rolls INTO whatever it is turning through — right turn, right side down — and rights
      // itself on a straight. Negated because a positive roll about the arrow's own length (its
      // -Z axis) lifts the right barb.
      const wantBank = Math.max(-MAX_BANK, Math.min(MAX_BANK, (dt > 1e-4 ? -step / dt : 0) * 0.22));
      bank += (wantBank - bank) * (1 - Math.exp(-4 * dt));

      // World convention: forward = (sin heading, -cos heading). See `src/core/types.ts`.
      group.position.set(
        carX + Math.sin(atSeat) * LEAD,
        carY + HOVER + Math.sin(time * 1.7) * BOB,
        carZ - Math.cos(atSeat) * LEAD,
      );
      group.rotation.y = -atYaw;
      inner.rotation.set(-pitchFor(atDive), 0, bank);
      // A slow breath on the glow, quicker and brighter once it is nosed at the drop-off.
      const pulse = 0.5 + 0.5 * Math.sin(time * (1.8 + atDive * 1.6));
      bodyMat.opacity = 0.34 + atDive * 0.1 + pulse * 0.12;
      edgeMat.opacity = 0.78 + atDive * 0.08 + pulse * 0.16;
    },
    dispose() {
      inner.clear();
      group.clear();
      geo.dispose();
      bodyMat.dispose();
      edgeGeo.dispose();
      edgeMat.dispose();
    },
  };
}
