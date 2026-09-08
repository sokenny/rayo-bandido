import * as THREE from 'three';
import { PASSENGER } from '../../../config/tuning';

/**
 * The passenger pin and the destination ring: what the side ride looks like from the road.
 *
 * SUBTLE ON PURPOSE. The brief asks for something the player discovers rather than a quest
 * icon, and the RUSH marker already owns the loud treatment (a hologram over the street). So
 * this is a ring of light on the tarmac and a thin column rising out of it — the kind of thing
 * this city's neon already does — in a violet nothing else on the road uses. The same object,
 * in a second role, is the drop-off: the column is shorter and the ring steadier, so the two
 * cannot be confused, but the player learns one shape.
 *
 * THE RING IS THE ZONE. Its radius is the rules' own `promptRadius`: park inside the paint and
 * the prompt is up. One number, nowhere to drift apart.
 *
 * BUDGET. Three draw calls, `MeshBasicMaterial` throughout, `DoubleSide` on the column (it is
 * an open cylinder) and `depthWrite` off on everything so it never z-fights the road or hides a
 * car. Animation is scalar writes; nothing allocates per frame. Hidden when not in use, which
 * is most of the time.
 */
export interface PassengerMarkerVisual {
  group: THREE.Group;
  /** Stand at a stop, in one of the two roles, and show. */
  place(site: { x: number; z: number; y: number; heading: number }, role: 'pickup' | 'destination'): void;
  /** Put away. */
  hide(): void;
  /** How close the player is, 0 (far) .. 1 (in the ring). Brightens and quickens the pulse. */
  setProximity(value: number): void;
  update(time: number): void;
  dispose(): void;
}

const RING_OUTER = PASSENGER.marker.promptRadius;
const RING_INNER = RING_OUTER - 0.9;
const PAINT_Y = 0.035;
/** The column: radius, and its height in each role (m). */
const COLUMN_RADIUS = 0.32;
const COLUMN_HEIGHT_PICKUP = 12;
const COLUMN_HEIGHT_DESTINATION = 6;
const VIOLET = 0xc9a4ff;
const VIOLET_DEEP = 0x9b5cff;

export function createPassengerMarker(): PassengerMarkerVisual {
  const group = new THREE.Group();
  group.name = 'passenger-marker';
  group.visible = false;

  const backingGeo = new THREE.RingGeometry(RING_INNER - 0.5, RING_OUTER + 0.5, 40);
  const backingMat = new THREE.MeshBasicMaterial({ color: 0x05070c, transparent: true, opacity: 0.45, depthWrite: false });
  const backing = new THREE.Mesh(backingGeo, backingMat);
  backing.rotation.x = -Math.PI / 2;
  backing.position.y = PAINT_Y;
  backing.renderOrder = 1;
  group.add(backing);

  const ringGeo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 40, 1);
  const ringMat = new THREE.MeshBasicMaterial({
    color: VIOLET,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = PAINT_Y + 0.002;
  ring.renderOrder = 2;
  group.add(ring);

  // The column: an open cylinder whose alpha fades to nothing at the top, done with vertex
  // colour rather than a texture — additive, so the darker the top the more transparent.
  const columnGeo = new THREE.CylinderGeometry(COLUMN_RADIUS, COLUMN_RADIUS * 1.35, 1, 12, 1, true);
  const positions = columnGeo.getAttribute('position');
  const colours = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    // y runs -0.5..0.5 on the unit cylinder; bright at the base, dark (invisible) at the top.
    const t = 1 - (positions.getY(i) + 0.5);
    const c = 0.06 + t * t * 0.94;
    colours[i * 3] = c;
    colours[i * 3 + 1] = c;
    colours[i * 3 + 2] = c;
  }
  columnGeo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const columnMat = new THREE.MeshBasicMaterial({
    color: VIOLET_DEEP,
    vertexColors: true,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const column = new THREE.Mesh(columnGeo, columnMat);
  column.renderOrder = 2;
  group.add(column);

  let proximity = 0;
  let height = COLUMN_HEIGHT_PICKUP;
  let pickup = true;

  function setHeight(h: number): void {
    height = h;
    column.scale.y = h;
    column.position.y = h / 2;
  }
  setHeight(height);

  return {
    group,
    place(site, role) {
      group.position.set(site.x, site.y, site.z);
      group.rotation.y = -site.heading;
      pickup = role === 'pickup';
      setHeight(pickup ? COLUMN_HEIGHT_PICKUP : COLUMN_HEIGHT_DESTINATION);
      group.visible = true;
    },
    hide() {
      group.visible = false;
    },
    setProximity(value) {
      proximity = value < 0 ? 0 : value > 1 ? 1 : value;
    },
    update(time) {
      if (!group.visible) return;
      // The pickup breathes and quickens as the car closes; the destination holds steadier, a
      // place rather than a person.
      const rate = pickup ? 1.6 + proximity * 3 : 1.1;
      const pulse = 0.5 + 0.5 * Math.sin(time * rate);
      ringMat.opacity = 0.24 + proximity * 0.3 + pulse * (0.08 + proximity * 0.18);
      backingMat.opacity = 0.32 + proximity * 0.2;
      columnMat.opacity = (pickup ? 0.34 : 0.26) + pulse * 0.1 + proximity * 0.12;
      column.rotation.y = time * 0.4;
      // A slow rise and fall on the column's height reads as a beacon rather than a post.
      column.scale.y = height * (0.94 + pulse * 0.06);
      column.position.y = column.scale.y / 2;
    },
    dispose() {
      group.clear();
      backingGeo.dispose();
      backingMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      columnGeo.dispose();
      columnMat.dispose();
    },
  };
}
