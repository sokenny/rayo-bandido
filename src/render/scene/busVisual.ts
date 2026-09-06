import * as THREE from 'three';
import { BUSES } from '../../config/tuning';
import { MeshBuilder } from './env/meshBuilder';
import { PAL } from './env/palette';
import { makeGlowTexture, makeTransitAtlas, transitCell } from './env/textures';

/**
 * An articulated city bus, drawn where the sim says it is (`src/sim/buses.ts`).
 *
 * CONTRACT (the same one the electric cars keep)
 * - `root` origin on the ground between the wheels, nose toward local -Z. `syncBuses` sets
 *   position and rotation; nothing here reads the world.
 * - Geometry and materials are built once and shared by every bus; the last one to go calls
 *   `disposeBusResources()`.
 *
 * Four merged meshes per bus — body, lit panels, the transit atlas panels, and the additive
 * glow — so a bus costs four draw calls however many boxes it is made of. The one thing that
 * is per instance is the door light: a glow quad on the kerb side scaled by `setDoors`, which
 * is why it lives in its own small mesh rather than in the shared glow geometry.
 *
 * The livery is the bus stops': amber light bars, an amber route plate, a dot-matrix
 * destination roll, and the strip of little ad screens along the roofline. A bus and the
 * shelter it pulls into are meant to read as the same network from across a junction.
 */
export interface BusVisual {
  root: THREE.Group;
  /** 0 = shut, 1 = fully open. Drives the light that spills out of the doors at a stop. */
  setDoors(open: number): void;
  dispose(): void;
}

/** Half the body, and where the two sections and the concertina between them sit (local z). */
const HALF = BUSES.length / 2;
const FRONT_Z = [-HALF, -0.1];
const JOINT_Z = [-0.1, 0.85];
const REAR_Z = [0.85, HALF];
const SKIRT_Y = [0.5, 1.1];
const BODY_Y = [1.1, 3];
const ROOF_Y = [3, 3.15];
const SIGN_Y = [3.15, BUSES.height - 0.1];
const W = BUSES.width;

interface SharedResources {
  body: THREE.BufferGeometry;
  lit: THREE.BufferGeometry;
  panels: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  door: THREE.BufferGeometry;
  bodyMat: THREE.MeshStandardMaterial;
  litMat: THREE.MeshBasicMaterial;
  panelMat: THREE.MeshBasicMaterial;
  glowMat: THREE.MeshBasicMaterial;
  transitTex: THREE.CanvasTexture;
  glowTex: THREE.CanvasTexture;
  users: number;
}

let shared: SharedResources | null = null;

function build(): SharedResources {
  const body = new MeshBuilder(true).soft(0.15);
  const lit = new MeshBuilder(true);
  const panels = new MeshBuilder(false);
  const glow = new MeshBuilder(true);

  /** One rigid section: skirt, body, roof cap, and the glass with the cabin behind it. */
  const section = (z0: number, z1: number): void => {
    const cz = (z0 + z1) / 2;
    const len = z1 - z0;
    body.color(PAL.concrete, 0.85);
    body.box(0, (SKIRT_Y[0] + SKIRT_Y[1]) / 2, cz, W - 0.15, SKIRT_Y[1] - SKIRT_Y[0], len);
    body.color(PAL.metalDark, 1.15);
    body.box(0, (BODY_Y[0] + BODY_Y[1]) / 2, cz, W, BODY_Y[1] - BODY_Y[0], len);
    body.color(PAL.metalDark, 0.75);
    body.box(0, (ROOF_Y[0] + ROOF_Y[1]) / 2, cz, W - 0.25, ROOF_Y[1] - ROOF_Y[0], len - 0.3);
    for (const side of [-1, 1]) {
      const x = (side * W) / 2 + side * 0.02;
      const rot = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      body.color(PAL.metalDark, 0.3);
      body.panel(x, 2.15, cz, len - 0.7, 1.05, rot);
      // A row of lit panes, not one long band. Under a hemisphere light a dark vertical
      // slab is a silhouette and nothing else, so what tells you this is a bus and how long
      // it is are its windows: each one is its own lit rectangle with a pillar of dark
      // between, which is what reads down a street at night.
      const panes = Math.max(4, Math.round((len - 1.2) / 1.1));
      const pitch = (len - 1) / panes;
      for (let i = 0; i < panes; i++) {
        const pz = cz - (len - 1) / 2 + pitch * (i + 0.5);
        // Dim: a lit bus window at night is a grey-green rectangle, not a lamp. Brighter
        // than this and the bus outshines the buildings it drives past.
        lit.color(i % 3 === 1 ? PAL.winWarm : PAL.winCyan, i % 4 === 2 ? 0.12 : 0.2);
        lit.panel(x + side * 0.01, 2.2, pz, pitch - 0.26, 0.78, rot);
      }
      // The line of light the skirt throws down onto the road, the reference's underlights.
      lit.color(PAL.neonAmber, 0.75);
      lit.tube(x, SKIRT_Y[0] + 0.12, cz - len / 2 + 0.4, x, SKIRT_Y[0] + 0.12, cz + len / 2 - 0.4, 0.09);
      glow.color(PAL.neonAmber, 0.12);
      glow.panel(x + side * 0.25, 0.7, cz, len, 2, rot);
    }
  };
  section(FRONT_Z[0], FRONT_Z[1]);
  section(REAR_Z[0], REAR_Z[1]);

  // The concertina between them: a narrower box with three ribs round it.
  const jz = (JOINT_Z[0] + JOINT_Z[1]) / 2;
  body.color(PAL.metalDark, 0.5);
  body.box(0, (SKIRT_Y[0] + BODY_Y[1] - 0.1) / 2, jz, W - 0.3, BODY_Y[1] - 0.1 - SKIRT_Y[0], JOINT_Z[1] - JOINT_Z[0]);
  body.color(PAL.metalDark, 0.9);
  for (let i = 0; i < 3; i++) {
    const z = JOINT_Z[0] + 0.16 + i * 0.32;
    body.tube(-W / 2 + 0.1, 1.4, z, W / 2 - 0.1, 1.4, z, 0.12);
  }

  // The strip of little ad screens along the roofline of each section, both sides.
  const fleet = transitCell('fleet');
  const signY = (SIGN_Y[0] + SIGN_Y[1]) / 2;
  for (const [z0, z1] of [FRONT_Z, REAR_Z]) {
    const adZ = (z0 + z1) / 2;
    const adLen = z1 - z0 - 0.6;
    body.color(PAL.metalDark, 0.9);
    body.box(0, signY, adZ, W - 0.4, SIGN_Y[1] - SIGN_Y[0], adLen);
    for (const side of [-1, 1]) {
      const x = (side * (W - 0.4)) / 2 + side * 0.02;
      panels.panel(x, signY, adZ, adLen - 0.2, 0.44, side > 0 ? Math.PI / 2 : -Math.PI / 2, fleet.u0, fleet.v0, fleet.u1, fleet.v1);
    }
    // The screens light the roofline they sit on.
    glow.color(PAL.neonWhite, 0.1);
    for (const side of [-1, 1]) glow.panel(side * (W / 2 + 0.2), signY, adZ, adLen, 1.6, side > 0 ? Math.PI / 2 : -Math.PI / 2);
  }

  // Nose: screen, destination roll, route plate, and the light bar under them.
  const nose = FRONT_Z[0] - 0.02;
  body.color(PAL.metalDark, 0.3);
  body.panel(0, 2.28, nose, W - 0.25, 1.15, Math.PI);
  const roll = transitCell('roll');
  panels.panel(0, 2.98, nose - 0.02, 2, 0.66, Math.PI, roll.u0, roll.v0, roll.u1, roll.v1);
  const plate = transitCell('plate');
  panels.panel(-0.25, 1.02, nose - 0.02, 1.7, 0.57, Math.PI, plate.u0, plate.v0, plate.u1, plate.v1);
  lit.color(PAL.neonAmber, 1);
  lit.tube(-W / 2 + 0.25, 1.5, nose, W / 2 - 0.25, 1.5, nose, 0.14);
  glow.color(PAL.neonAmber, 0.24);
  glow.panel(0, 1.5, nose - 0.4, 6, 3.4, Math.PI);
  // Two headlights either side of the plate, throwing a pool of light up the street.
  glow.color(PAL.winCold, 0.3);
  for (const side of [-1, 1]) glow.panel(side * (W / 2 - 0.5), 1.0, nose - 0.3, 2.6, 2, Math.PI);
  glow.color(PAL.winCold, 0.13);
  glow.planeY(0, 0.05, nose - 7, 5, 13);

  // Tail: the same bar, dimmer, and the light the bus lays on the road under itself.
  const tail = REAR_Z[1] + 0.02;
  body.color(PAL.metalDark, 0.3);
  body.panel(0, 2.3, tail, W - 0.4, 1, 0);
  panels.panel(0, 1.35, tail + 0.02, 1.7, 0.57, 0, plate.u0, plate.v0, plate.u1, plate.v1);
  lit.color(PAL.neonAmber, 0.8);
  lit.tube(-W / 2 + 0.3, 2.6, tail, W / 2 - 0.3, 2.6, tail, 0.12);
  glow.color(PAL.neonAmber, 0.18);
  glow.panel(0, 2.6, tail + 0.4, 5, 3, 0);
  glow.color(PAL.neonAmber, 0.14);
  glow.planeY(0, 0.04, 0, W + 5, BUSES.length + 3);

  // Three axles, six wheels.
  body.color(PAL.metalDark, 0.3);
  for (const z of [FRONT_Z[0] + 1.7, jz - 0.1, REAR_Z[1] - 1.5]) {
    for (const side of [-1, 1]) {
      const x = (side * W) / 2;
      body.tube(x - side * 0.32, 0.44, z, x - side * 0.02, 0.44, z, 0.86);
    }
  }

  // The door light, its own geometry because it is the one thing that moves per bus. Only on
  // the kerb side: the routes are driven clockwise, so the kerb is always the bus's right.
  const door = new MeshBuilder(true);
  door.color(PAL.neonAmber, 0.5);
  door.panel(W / 2 + 0.3, 1.3, FRONT_Z[1] - 1.4, 5, 2.6, Math.PI / 2);

  const transitTex = makeTransitAtlas();
  const glowTex = makeGlowTexture();
  return {
    body: body.build(),
    lit: lit.build(),
    panels: panels.build(),
    glow: glow.build(),
    door: door.build(),
    bodyMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 }),
    litMat: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    panelMat: new THREE.MeshBasicMaterial({ map: transitTex, toneMapped: false }),
    glowMat: new THREE.MeshBasicMaterial({
      map: glowTex,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    transitTex,
    glowTex,
    users: 0,
  };
}

export function createBusVisual(): BusVisual {
  if (!shared) shared = build();
  const res = shared;
  res.users++;
  const root = new THREE.Group();
  root.name = 'bus';
  const meshes = [
    new THREE.Mesh(res.body, res.bodyMat),
    new THREE.Mesh(res.lit, res.litMat),
    new THREE.Mesh(res.panels, res.panelMat),
    new THREE.Mesh(res.glow, res.glowMat),
  ];
  meshes[1].renderOrder = 1;
  meshes[2].renderOrder = 1;
  meshes[3].renderOrder = 2;
  for (const m of meshes) root.add(m);
  const door = new THREE.Mesh(res.door, res.glowMat);
  door.renderOrder = 2;
  door.visible = false;
  root.add(door);

  return {
    root,
    setDoors(open: number) {
      door.visible = open > 0.02;
      // Grows out of the doorway rather than fading in: a light that swells reads as a door.
      door.scale.set(1, Math.max(0.05, open), Math.max(0.05, open));
    },
    dispose() {
      root.clear();
      res.users--;
      if (res.users <= 0) disposeBusResources();
    },
  };
}

export function disposeBusResources(): void {
  if (!shared) return;
  shared.body.dispose();
  shared.lit.dispose();
  shared.panels.dispose();
  shared.glow.dispose();
  shared.door.dispose();
  shared.bodyMat.dispose();
  shared.litMat.dispose();
  shared.panelMat.dispose();
  shared.glowMat.dispose();
  shared.transitTex.dispose();
  shared.glowTex.dispose();
  shared = null;
}
