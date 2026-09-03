import * as THREE from 'three';
import { box, mergeParts, part } from './geometryKit';

/**
 * JDM dish wheel: dark tyre, gunmetal barrel, polished lip, five graphite spokes and a
 * magenta centre cap. Vertex-coloured so the four wheels share one geometry, one material
 * and (via InstancedMesh) one draw call.
 *
 * The returned geometry is centred on the origin with the axle along X, matching the
 * placeholder convention (`spin.rotation.x` rolls the wheel).
 */
export function buildWheelGeometry(radius: number, width: number, segments = 16): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rimRadius = radius * 0.66;
  const hubRadius = radius * 0.17;
  const halfW = width / 2;

  // Tyre tread (axis Y by default -> rotate to axis Z).
  const tread = new THREE.CylinderGeometry(radius, radius, width * 0.94, segments, 1, true);
  tread.rotateX(Math.PI / 2);
  parts.push(part(tread, 0x0a0a0d));

  // Slightly pinched shoulders so the tyre does not read as a plain cylinder.
  for (const sign of [-1, 1]) {
    const shoulder = new THREE.CylinderGeometry(radius, radius * 0.965, width * 0.03, segments, 1, true);
    shoulder.rotateX(Math.PI / 2);
    if (sign < 0) shoulder.rotateY(Math.PI);
    shoulder.translate(0, 0, sign * (width * 0.485));
    parts.push(part(shoulder, 0x0d0d11));
  }

  for (const sign of [-1, 1]) {
    // Sidewall.
    const sidewall = new THREE.RingGeometry(rimRadius, radius * 0.965, segments, 1);
    if (sign < 0) sidewall.rotateY(Math.PI);
    sidewall.translate(0, 0, sign * halfW);
    parts.push(part(sidewall, 0x131318));

    // Polished lip.
    const lip = new THREE.RingGeometry(rimRadius * 0.9, rimRadius, segments, 1);
    if (sign < 0) lip.rotateY(Math.PI);
    lip.translate(0, 0, sign * (halfW - 0.004));
    parts.push(part(lip, 0xc2cbdb));

    // Recessed rim face.
    const face = new THREE.CircleGeometry(rimRadius * 0.9, segments);
    if (sign < 0) face.rotateY(Math.PI);
    face.translate(0, 0, sign * (halfW - 0.055));
    parts.push(part(face, 0x1a1d24));

    // Five spokes.
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + Math.PI / 10;
      const length = rimRadius * 0.9 - hubRadius;
      const spoke = box(radius * 0.2, length, 0.03);
      spoke.translate(0, hubRadius + length / 2, sign * (halfW - 0.04));
      spoke.rotateZ(angle);
      parts.push(part(spoke, 0x8b93a4));
    }

    // Hub and magenta centre cap.
    const hub = new THREE.CylinderGeometry(hubRadius, hubRadius, 0.05, 10, 1, false);
    hub.rotateX(Math.PI / 2);
    hub.translate(0, 0, sign * (halfW - 0.03));
    parts.push(part(hub, 0x23262f));

    const cap = new THREE.CircleGeometry(hubRadius * 0.55, 8);
    if (sign < 0) cap.rotateY(Math.PI);
    cap.translate(0, 0, sign * (halfW - 0.002));
    parts.push(part(cap, 0xff2fa8));
  }

  // Barrel closing the gap between the two rim faces.
  const barrel = new THREE.CylinderGeometry(rimRadius * 0.9, rimRadius * 0.9, width * 0.9, segments, 1, true);
  barrel.rotateX(Math.PI / 2);
  parts.push(part(barrel, 0x2b2f3a));

  const merged = mergeParts(parts);
  // Axle Z -> axle X.
  merged.rotateY(Math.PI / 2);
  return merged;
}
