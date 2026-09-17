import * as THREE from 'three';
import type { StreetPropDef, StreetPropKind } from '../../core/types';
import { STREET_PROPS } from '../../config/tuning';
import type { StreetPropsState } from '../../sim/streetProps';
import { FLAT_BOX_BASE_HY, STREET_PROP_BASE, STREET_PROP_SCALE, STREET_PROP_SHAPES } from '../../world/streetProps';
import { MeshBuilder } from './env/meshBuilder';
import { signCell } from './env/textures';
import { applyHaze, HAZE } from './env/haze';

/**
 * THE STREET PROPS, drawn (`src/sim/streetProps.ts` owns where they are).
 *
 * Three `BatchedMesh`es — painted bodies, sign faces on the city's neon sign atlas, and the
 * chargers' status lights — so every bag, cone, table and charger in view costs three draw
 * calls between them. Each look (a kind, a variant, and intact / broken / flattened) is one
 * small geometry added to its batch once; a prop in view is an instance pointing at it.
 *
 * The instances are handed out afresh whenever the camera has moved a few metres or a prop has
 * left or come home (`StreetPropsState.version`): props at home within `detailDistance` first,
 * each with its yaw, and then every frame the knocked-about ones at the tail, posed from their
 * bodies. A prop carried by a body is never also drawn at home, and a slot left over from last
 * time is switched off — so there is never a duplicate, a ghost at the old spot, or a stale
 * bound: the batches cull per instance against the frustum.
 */
export interface StreetPropsVisual {
  root: THREE.Group;
  update(state: StreetPropsState, camX: number, camZ: number, alpha: number): void;
  /** Instances drawn last frame, per batch. For the debug readout. */
  stats(): { body: number; face: number; glow: number };
  dispose(): void;
}

type BatchName = 'body' | 'face' | 'glow';
type Look = 'intact' | 'broken' | 'flat';

interface Part {
  batch: BatchName;
  geometry: number;
}

/** Faded colours per variant, as instance tints over white-painted geometry. */
const FURNITURE_TINTS: Partial<Record<StreetPropKind, number[]>> = {
  chair: [0xb9544a, 0x4f78a6, 0xd9d6c8],
  table: [0xd7d3c4, 0xb24f45],
};

const CAPACITY = { body: 1600, face: 160, glow: 160 };
/** Metres the camera may move before the home instances are handed out again. */
const REBUILD_MOVE = 8;
/** Coarse grid the visual walks to find props in range (m). */
const GRID = 32;

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3(1, 1, 1);
const C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export function createStreetPropsVisual(defs: readonly StreetPropDef[], signAtlas: THREE.Texture, quality: 'low' | 'medium' | 'high'): StreetPropsVisual {
  const root = new THREE.Group();
  root.name = 'street-props';
  root.userData.probeIgnore = true;

  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.08, side: THREE.DoubleSide });
  // A little of each prop's own colour as light: the street at night is a hemisphere over a weak
  // key, and small dark things on a dark pavement are simply not there from the driving camera.
  bodyMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.28;',
    );
  };
  const faceMat = new THREE.MeshBasicMaterial({ map: signAtlas, toneMapped: false, side: THREE.DoubleSide });
  faceMat.color.setScalar(1.1);
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  applyHaze(faceMat, { strength: HAZE.neonStrength, lightKeep: HAZE.neonLightKeep });
  applyHaze(glowMat, { strength: HAZE.neonStrength, lightKeep: HAZE.neonLightKeep });

  /* ------------------------------------------------------------ the kit */

  const kit = buildKit();
  const batches = {} as Record<BatchName, THREE.BatchedMesh>;
  const mats: Record<BatchName, THREE.Material> = { body: bodyMat, face: faceMat, glow: glowMat };
  const geoIds = new Map<THREE.BufferGeometry, number>();
  for (const name of ['body', 'face', 'glow'] as BatchName[]) {
    const geos = kit.geometries[name];
    let verts = 0;
    for (const g of geos) verts += g.getAttribute('position').count;
    const batch = new THREE.BatchedMesh(CAPACITY[name], Math.max(3, verts), 0, mats[name]);
    batch.name = `street-props-${name}`;
    batch.sortObjects = false;
    batch.perObjectFrustumCulled = true;
    batch.frustumCulled = false;
    for (const g of geos) geoIds.set(g, batch.addGeometry(g));
    for (let i = 0; i < CAPACITY[name]; i++) {
      const id = batch.addInstance(0);
      batch.setVisibleAt(id, false);
    }
    batches[name] = batch;
    root.add(batch);
  }
  const looks = new Map<string, Part[]>();
  for (const [key, parts] of kit.looks) looks.set(key, parts.map((p) => ({ batch: p.batch, geometry: geoIds.get(p.geometry)! })));
  for (const name of ['body', 'face', 'glow'] as BatchName[]) for (const g of kit.geometries[name]) g.dispose();

  /* ------------------------------------------------------------ where the props are */

  const grid = new Map<number, number[]>();
  const gkey = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);
  for (let i = 0; i < defs.length; i++) {
    const k = gkey(Math.floor(defs[i].x / GRID), Math.floor(defs[i].z / GRID));
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  }

  const detail = STREET_PROPS.detailDistance[quality];
  const used: Record<BatchName, number> = { body: 0, face: 0, glow: 0 };
  const homeUsed: Record<BatchName, number> = { body: 0, face: 0, glow: 0 };
  const lastUsed: Record<BatchName, number> = { body: 0, face: 0, glow: 0 };
  let lastVersion = -1;
  let lastX = Infinity;
  let lastZ = Infinity;

  const put = (parts: Part[] | undefined, tint: number, x: number, y: number, z: number, q: THREE.Quaternion): void => {
    if (!parts) return;
    for (const part of parts) {
      const batch = batches[part.batch];
      const i = used[part.batch];
      if (i >= CAPACITY[part.batch]) continue;
      used[part.batch] = i + 1;
      batch.setGeometryIdAt(i, part.geometry);
      P.set(x, y, z);
      M.compose(P, q, S);
      batch.setMatrixAt(i, M);
      batch.setColorAt(i, C.setHex(part.batch === 'body' ? tint : 0xffffff));
      batch.setVisibleAt(i, true);
    }
  };

  const tintOf = (d: StreetPropDef): number => {
    const tints = FURNITURE_TINTS[d.kind];
    return tints ? tints[d.variant % tints.length] : 0xffffff;
  };

  function rebuildHome(state: StreetPropsState, camX: number, camZ: number): void {
    used.body = used.face = used.glow = 0;
    const d2max = detail * detail;
    const i0 = Math.floor((camX - detail) / GRID);
    const i1 = Math.floor((camX + detail) / GRID);
    const j0 = Math.floor((camZ - detail) / GRID);
    const j1 = Math.floor((camZ + detail) / GRID);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = grid.get(gkey(i, j));
        if (!list) continue;
        for (const p of list) {
          if (state.bodyOf[p] >= 0) continue;
          const d = defs[p];
          const dx = d.x - camX;
          const dz = d.z - camZ;
          if (dx * dx + dz * dz > d2max) continue;
          const look: Look = d.kind === 'charger' && state.damaged[p] ? 'broken' : 'intact';
          Q.setFromAxisAngle(UP, d.yaw);
          put(looks.get(`${d.kind}:${d.variant}:${look}`), tintOf(d), d.x, d.y + STREET_PROP_SHAPES[d.kind].hy, d.z, Q);
        }
      }
    }
    homeUsed.body = used.body;
    homeUsed.face = used.face;
    homeUsed.glow = used.glow;
  }

  return {
    root,
    update(state, camX, camZ, alpha) {
      const moved = Math.hypot(camX - lastX, camZ - lastZ) > REBUILD_MOVE;
      if (moved || state.version !== lastVersion) {
        rebuildHome(state, camX, camZ);
        lastVersion = state.version;
        lastX = camX;
        lastZ = camZ;
      }
      used.body = homeUsed.body;
      used.face = homeUsed.face;
      used.glow = homeUsed.glow;
      const d2max = detail * detail;
      for (const b of state.bodies) {
        if (b.prop < 0) continue;
        const d = defs[b.prop];
        const t = b.moving ? alpha : 1;
        const x = b.px + (b.x - b.px) * t;
        const y = b.py + (b.y - b.py) * t;
        const z = b.pz + (b.z - b.pz) * t;
        const dx = x - camX;
        const dz = z - camZ;
        if (dx * dx + dz * dz > d2max) continue;
        Q.set(b.qx, b.qy, b.qz, b.qw);
        const look: Look = b.flat ? 'flat' : 'intact';
        put(looks.get(`${d.kind}:${d.variant}:${look}`), tintOf(d), x, y, z, Q);
      }
      for (const name of ['body', 'face', 'glow'] as BatchName[]) {
        const batch = batches[name];
        for (let i = used[name]; i < lastUsed[name]; i++) batch.setVisibleAt(i, false);
        lastUsed[name] = used[name];
      }
    },
    stats() {
      return { body: lastUsed.body, face: lastUsed.face, glow: lastUsed.glow };
    },
    dispose() {
      for (const name of ['body', 'face', 'glow'] as BatchName[]) batches[name].dispose();
      bodyMat.dispose();
      faceMat.dispose();
      glowMat.dispose();
    },
  };
}

/* ------------------------------------------------------------------ the kit */

interface Kit {
  geometries: Record<BatchName, THREE.BufferGeometry[]>;
  looks: Map<string, Array<{ batch: BatchName; geometry: THREE.BufferGeometry }>>;
}

/**
 * Every look, built once with `MeshBuilder` (vertex colours, flat normals) and centred on the
 * prop's box: y runs from -hy (the ground) to +hy, and +Z is the front that faces the road.
 */
function buildKit(): Kit {
  const geometries: Record<BatchName, THREE.BufferGeometry[]> = { body: [], face: [], glow: [] };
  const looks = new Map<string, Array<{ batch: BatchName; geometry: THREE.BufferGeometry }>>();
  const add = (kind: StreetPropKind, variant: number, look: Look, parts: Partial<Record<BatchName, (mb: MeshBuilder) => void>>): void => {
    const out: Array<{ batch: BatchName; geometry: THREE.BufferGeometry }> = [];
    for (const name of ['body', 'face', 'glow'] as BatchName[]) {
      const draw = parts[name];
      if (!draw) continue;
      const mb = new MeshBuilder(true);
      draw(mb);
      if (mb.empty) continue;
      const g = mb.build();
      const f = STREET_PROP_SCALE[kind];
      if (f !== 1) g.scale(f, f, f);
      geometries[name].push(g);
      out.push({ batch: name, geometry: g });
    }
    looks.set(`${kind}:${variant}:${look}`, out);
  };

  /* bags: lumpy, knotted, in three plastics */
  const bagColors = [0x3a4a40, 0x4a4a52, 0x3e5470];
  for (let v = 0; v < 3; v++) {
    const h = STREET_PROP_BASE.bag.hy;
    add('bag', v, 'intact', {
      body: (mb) => {
        mb.color(bagColors[v], 1).chamfer(0.11);
        mb.box(0, -h + 0.2, 0, 0.58, 0.4, 0.52);
        mb.color(bagColors[v], 1.25).chamfer(0.07);
        mb.box(v === 1 ? 0.06 : -0.04, -h + 0.42, v === 2 ? 0.05 : 0, 0.34, 0.2, 0.3);
        mb.chamfer(0).color(bagColors[v], 1.5);
        mb.box(0.02, h - 0.04, 0, 0.08, 0.1, 0.08);
      },
    });
  }

  /* cardboard boxes, and the one a tyre went over */
  const card = [0xc49660, 0xae8450, 0xd2aa74];
  for (let v = 0; v < 3; v++) {
    const { hx, hy, hz } = STREET_PROP_BASE.box;
    add('box', v, 'intact', {
      body: (mb) => {
        mb.color(card[v], 1);
        mb.box(0, 0, 0, hx * 2, hy * 2, hz * 2, { bottom: true });
        // Tape over the flaps, and a darker printed band.
        mb.color(0xd8c9a0, 1.1);
        mb.box(0, hy + 0.004, 0, 0.1, 0.01, hz * 2 + 0.01);
        mb.color(card[v], 0.7);
        mb.box(0, 0.02, hz + 0.004, hx * 1.4, 0.12, 0.01);
      },
    });
    add('box', v, 'flat', {
      body: (mb) => {
        mb.color(card[v], 0.9);
        mb.box(0, 0, 0, hx * 2.3, FLAT_BOX_BASE_HY * 2, hz * 2.2, { bottom: true });
        mb.color(card[v], 0.65);
        mb.box(0.05, FLAT_BOX_BASE_HY + 0.003, 0, 0.04, 0.006, hz * 2.1);
      },
    });
  }

  /* traffic cone: worn orange, one reflective band */
  {
    const { hy } = STREET_PROP_BASE.cone;
    add('cone', 0, 'intact', {
      body: (mb) => {
        mb.color(0x1a1a1c, 1);
        mb.box(0, -hy + 0.025, 0, 0.4, 0.05, 0.4);
        mb.color(0xe8662a, 1.2);
        frustum(mb, -hy + 0.05, -hy + 0.3, 0.16, 0.12, 8);
        mb.color(0xd6d4c8, 1.25);
        frustum(mb, -hy + 0.3, -hy + 0.42, 0.12, 0.095, 8);
        mb.color(0xe8662a, 1.2);
        frustum(mb, -hy + 0.42, hy, 0.095, 0.025, 8);
      },
    });
  }

  /* construction barriers: a striped sawhorse and a plastic block */
  {
    const { hx, hy } = STREET_PROP_BASE.barrier;
    add('barrier', 0, 'intact', {
      body: (mb) => {
        // Legs: splayed pairs at each end.
        mb.color(0x6a6e74, 1.2);
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) slab(mb, sx * (hx - 0.1), -hy, sz * 0.2, sx * (hx - 0.1), hy - 0.1, 0, 0.05, 0.04);
        }
        // The board, in red and worn white stripes, with a thin reflective lip.
        const n = 5;
        for (let i = 0; i < n; i++) {
          mb.color(i % 2 === 0 ? 0xb3342c : 0xd8d6cc, i % 2 === 0 ? 1 : 1.15);
          mb.box(-hx + (hx * 2 * (i + 0.5)) / n, hy - 0.14, 0.02, (hx * 2) / n, 0.22, 0.04, { bottom: true });
        }
        mb.color(0xf2e9b0, 1.4);
        mb.box(0, hy - 0.02, 0.02, hx * 2, 0.025, 0.045);
      },
    });
    add('barrier', 1, 'intact', {
      body: (mb) => {
        mb.color(0xc2562a, 1).chamfer(0.04);
        mb.box(0, -hy + 0.16, 0, hx * 2, 0.32, 0.44);
        mb.box(0, 0.1, 0, hx * 1.9, 0.62, 0.26);
        mb.chamfer(0).color(0xdcdad0, 1.3);
        mb.box(0, 0.2, 0.135, hx * 1.6, 0.1, 0.01);
        mb.box(0, 0.2, -0.135, hx * 1.6, 0.1, 0.01);
      },
    });
  }

  /* sidewalk signs: an A-frame and a metal board on a foot, faces from the neon atlas */
  {
    const { hx, hy, hz } = STREET_PROP_BASE.sign;
    add('sign', 0, 'intact', {
      body: (mb) => {
        mb.color(0x6a5a4a, 1.2);
        slab(mb, 0, -hy, hz - 0.02, 0, hy, 0.02, hx * 2, 0.04);
        slab(mb, 0, -hy, -hz + 0.02, 0, hy, -0.02, hx * 2, 0.04);
        mb.color(0x8a8680, 1.2);
        mb.box(0, hy - 0.02, 0, hx * 2 + 0.02, 0.05, 0.08);
      },
      face: (mb) => {
        const c = signCell(3);
        const c2 = signCell(9);
        tiltedFace(mb, 0, -hy + 0.12, hz - 0.02 + 0.026, hy - 0.12, 0.02 + 0.026 * 0.2, hx * 1.7, 1, c);
        tiltedFace(mb, 0, -hy + 0.12, -hz + 0.02 - 0.026, hy - 0.12, -0.02 - 0.026 * 0.2, hx * 1.7, -1, c2);
      },
    });
    add('sign', 1, 'intact', {
      body: (mb) => {
        mb.color(0x6a7078, 1.2);
        mb.box(0, -hy + 0.03, 0, hx * 2, 0.06, hz * 2, { bottom: true });
        mb.box(0, -hy + 0.3, 0, 0.05, 0.5, 0.05);
        mb.color(0x8a9098, 1.2);
        mb.box(0, 0.22, 0, hx * 2, 0.6, 0.05, { bottom: true });
      },
      face: (mb) => {
        const c = signCell(6);
        mb.quad(-hx * 0.9, -0.05, 0.03, hx * 0.9, -0.05, 0.03, hx * 0.9, 0.49, 0.03, -hx * 0.9, 0.49, 0.03, c.u0, c.v0, c.u1, c.v1);
        mb.quad(hx * 0.9, -0.05, -0.03, -hx * 0.9, -0.05, -0.03, -hx * 0.9, 0.49, -0.03, hx * 0.9, 0.49, -0.03, c.u0, c.v0, c.u1, c.v1);
      },
    });
  }

  /* plastic cafe chair and table, white under an instance tint */
  for (let v = 0; v < 3; v++) {
    const { hx, hy, hz } = STREET_PROP_BASE.chair;
    add('chair', v, 'intact', {
      body: (mb) => {
        mb.color(0xffffff, 0.95);
        mb.box(0, 0, 0.01, hx * 2, 0.05, hz * 2 - 0.02, { bottom: true });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.box(sx * (hx - 0.04), -hy / 2, sz * (hz - 0.04), 0.04, hy, 0.04);
        mb.color(0xffffff, 0.85);
        mb.box(0, hy / 2 + 0.03, -hz + 0.03, hx * 2, hy - 0.06, 0.04, { bottom: true });
      },
    });
  }
  for (let v = 0; v < 2; v++) {
    const { hx, hy, hz } = STREET_PROP_BASE.table;
    add('table', v, 'intact', {
      body: (mb) => {
        mb.color(0xffffff, 0.95);
        mb.box(0, hy - 0.02, 0, hx * 2, 0.04, hz * 2, { bottom: true });
        mb.color(0xffffff, 0.8);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.box(sx * (hx - 0.06), -0.02, sz * (hz - 0.06), 0.045, hy * 2 - 0.04, 0.045);
      },
    });
  }

  /* EV charger: pedestal, pale casing, dark screen, holstered cable, status light */
  {
    const { hy } = STREET_PROP_BASE.charger;
    const casing = 0xdfe6ee;
    const base = (mb: MeshBuilder): void => {
      mb.color(0x2a2d33, 1);
      mb.box(0, -hy + 0.04, 0, 0.6, 0.08, 0.48, { bottom: true });
    };
    add('charger', 0, 'intact', {
      body: (mb) => {
        base(mb);
        mb.color(casing, 1).chamfer(0.05);
        mb.box(0, -hy + 0.08 + 0.7, 0, 0.46, 1.4, 0.32);
        mb.chamfer(0).color(0x121418, 1);
        mb.box(0, 0.25, 0.165, 0.32, 0.36, 0.02);
        mb.color(0x2d3138, 1);
        mb.box(0, hy - 0.05, 0, 0.52, 0.1, 0.38);
        // The holster and the cable looped down from it and back up into the side.
        mb.box(0.25, -0.1, 0.06, 0.08, 0.18, 0.12);
        mb.color(0x16181c, 1);
        mb.tube(0.25, -0.2, 0.08, 0.3, -0.55, 0.14, 0.05);
        mb.tube(0.3, -0.55, 0.14, 0.26, -0.72, 0.05, 0.05);
        mb.tube(0.26, -0.72, 0.05, 0.24, -0.35, -0.08, 0.05);
      },
      glow: (mb) => {
        mb.color(0x3cf0ff, 1.6);
        mb.box(0, 0.52, 0.166, 0.3, 0.035, 0.02);
        mb.color(0x3cf0ff, 1.2);
        mb.box(0, -0.02, 0.166, 0.05, 0.05, 0.02);
      },
    });
    add('charger', 0, 'broken', {
      body: (mb) => {
        base(mb);
        // The casing knocked over at the foot: a leaning slab instead of an upright box.
        mb.color(casing, 0.85);
        slab(mb, 0, -hy + 0.08, 0, 0.12, hy - 0.3, -0.26, 0.46, 0.32);
        mb.color(0x0b0c0e, 1);
        slab(mb, 0.01, 0.05, 0.13, 0.1, 0.45, 0.02, 0.3, 0.03);
        // The head, torn off and lying beside it; the dead light strip on the casing.
        mb.color(0x2d3138, 1);
        mb.box(-0.36, -hy + 0.06, 0.28, 0.5, 0.1, 0.36);
        mb.color(0x30343a, 1);
        mb.box(0.05, 0.4, 0.05, 0.28, 0.03, 0.02);
        // Cable dragged out of the holster onto the ground.
        mb.color(0x16181c, 1);
        mb.tube(0.2, -0.2, 0.1, 0.42, -hy + 0.04, 0.35, 0.05);
        mb.tube(0.42, -hy + 0.04, 0.35, 0.1, -hy + 0.03, 0.62, 0.05);
        mb.color(0xe0a040, 1.3);
        mb.tube(0.06, 0.02, 0.02, 0.14, 0.12, 0.2, 0.02);
      },
    });
  }

  /* trash cans: a dented galvanised can with its lid, and a green wheelie bin */
  {
    const { hy } = STREET_PROP_BASE.bin;
    add('bin', 0, 'intact', {
      body: (mb) => {
        const steel = 0x464c50;
        mb.color(steel, 1);
        frustum(mb, -hy, hy - 0.08, 0.24, 0.28, 10);
        // Pressed ribs, a shade darker, and a grimy foot.
        mb.color(steel, 0.72);
        for (const y of [-hy + 0.24, 0.02, hy - 0.3]) frustum(mb, y, y + 0.05, 0.255 + (y + hy) * 0.04, 0.26 + (y + hy) * 0.04, 10);
        mb.color(0x3a3a36, 1);
        frustum(mb, -hy, -hy + 0.07, 0.245, 0.25, 10);
        // Lid, a touch skewed, and its handle.
        mb.color(steel, 1.15);
        frustum(mb, hy - 0.08, hy - 0.03, 0.3, 0.3, 10);
        frustum(mb, hy - 0.03, hy - 0.01, 0.3, 0.001, 10);
        mb.color(0x5c6268, 1);
        mb.box(0, hy + 0.02, 0, 0.16, 0.04, 0.04);
        mb.box(-0.29, 0.14, 0, 0.03, 0.05, 0.12);
        mb.box(0.29, 0.14, 0, 0.03, 0.05, 0.12);
      },
    });
    add('bin', 1, 'intact', {
      body: (mb) => {
        const green = 0x2f5a3c;
        mb.color(green, 1).chamfer(0.03);
        mb.box(0, -0.03, 0.01, 0.54, hy * 2 - 0.1, 0.5);
        // Lid overhanging at the front, hinge bar at the back, wheels at the back foot.
        mb.color(green, 1.2);
        mb.box(0, hy - 0.06, 0.03, 0.6, 0.06, 0.58);
        mb.chamfer(0).color(0x1d2a22, 1);
        mb.box(0, hy - 0.1, -0.29, 0.52, 0.06, 0.06);
        mb.color(0x151618, 1);
        mb.box(-0.22, -hy + 0.09, -0.26, 0.07, 0.18, 0.18);
        mb.box(0.22, -hy + 0.09, -0.26, 0.07, 0.18, 0.18);
        // A faded white district number on the front.
        mb.color(0xd8d8cc, 0.9);
        mb.box(0, 0.12, 0.265, 0.2, 0.1, 0.01);
      },
    });
  }

  /* dumpsters: steel skip, long side to the wall, one lid thrown open over a heap of bags */
  {
    const { hx, hy, hz } = STREET_PROP_BASE.dumpster;
    const paint = [0x2c4a3a, 0x2a4260];
    for (let v = 0; v < 2; v++) {
      add('dumpster', v, 'intact', {
        body: (mb) => {
          // Casters and the body lifted off them.
          mb.color(0x141416, 1);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.box(sx * (hx - 0.14), -hy + 0.06, sz * (hz - 0.12), 0.1, 0.12, 0.1);
          mb.color(paint[v], 1);
          mb.box(0, 0.06, 0, hx * 2 - 0.06, hy * 2 - 0.24, hz * 2 - 0.08, { bottom: true });
          // Rust and grime low down, a top rim, side lugs, and the rib stamped down each face.
          mb.color(0x5a3a26, 0.9);
          mb.box(0, -hy + 0.26, 0, hx * 2 - 0.04, 0.16, hz * 2 - 0.06);
          mb.color(paint[v], 0.7);
          mb.box(0, hy - 0.2, 0, hx * 2 + 0.02, 0.06, hz * 2 - 0.02);
          for (const sx of [-1, 1]) mb.box(sx * (hx + 0.02), 0.1, 0, 0.08, 0.14, 0.34);
          for (const x of [-0.45, 0, 0.45]) {
            mb.box(x, 0.02, hz - 0.02, 0.06, hy * 2 - 0.44, 0.03);
            mb.box(x, 0.02, -hz + 0.02, 0.06, hy * 2 - 0.44, 0.03);
          }
          // A stencilled warning band on the road side.
          mb.color(0xc8b050, 0.75);
          mb.box(0.25, 0.2, hz - 0.035, 0.7, 0.1, 0.01);
          // Lids: one shut, the other propped open against the wall.
          mb.color(0x1c1e20, 1);
          mb.box(-hx / 2, hy - 0.14, 0, hx - 0.04, 0.04, hz * 2);
          if (v === 1) {
            slab(mb, hx / 2, hy - 0.16, -hz + 0.02, hx / 2, hy + 0.5, -hz - 0.28, hx - 0.04, 0.04);
            // The bags heaped above the rim.
            mb.color(0x2e3a34, 1.2).chamfer(0.1);
            mb.box(hx / 2 - 0.1, hy - 0.08, 0.02, 0.5, 0.3, 0.46);
            mb.color(0x3a3c46, 1.2);
            mb.box(hx / 2 + 0.28, hy - 0.12, -0.12, 0.4, 0.26, 0.4);
            mb.chamfer(0);
          } else {
            mb.box(hx / 2, hy - 0.11, 0.02, hx - 0.04, 0.04, hz * 2);
          }
        },
      });
    }
  }

  /* litter: newspapers, a flattened takeaway box, crushed cans */
  {
    const y = -STREET_PROP_BASE.litter.hy + 0.012;
    const sheet = (mb: MeshBuilder, cx: number, cz: number, w: number, d: number, a: number, lift: number): void => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const pt = (lx: number, lz: number): [number, number] => [cx + lx * c + lz * s, cz - lx * s + lz * c];
      const p0 = pt(-w / 2, -d / 2);
      const p1 = pt(w / 2, -d / 2);
      const p2 = pt(w / 2, d / 2);
      const p3 = pt(-w / 2, d / 2);
      mb.quad(p0[0], y, p0[1], p3[0], y + lift, p3[1], p2[0], y + lift, p2[1], p1[0], y, p1[1]);
    };
    add('litter', 0, 'intact', {
      body: (mb) => {
        mb.color(0xb9b6aa, 1.1);
        sheet(mb, -0.1, 0, 0.42, 0.3, 0.3, 0.01);
        mb.color(0xa8a498, 1);
        sheet(mb, 0.18, 0.12, 0.3, 0.22, -0.5, 0.03);
        mb.color(0x6e6a62, 1);
        sheet(mb, -0.12, 0.02, 0.3, 0.04, 0.3, 0.012);
      },
    });
    add('litter', 1, 'intact', {
      body: (mb) => {
        mb.color(0xc9c0a6, 1);
        sheet(mb, 0, 0, 0.36, 0.34, 0.6, 0.004);
        mb.color(0xb0402e, 1);
        sheet(mb, 0.02, 0.01, 0.14, 0.14, 0.6, 0.006);
        mb.color(0xa8acb0, 1.2);
        mb.tube(0.26, y + 0.03, -0.18, 0.34, y + 0.03, -0.1, 0.06);
      },
    });
    add('litter', 2, 'intact', {
      body: (mb) => {
        mb.color(0xb73a3a, 1.1);
        mb.tube(-0.2, y + 0.03, 0.05, -0.1, y + 0.03, 0.0, 0.06);
        mb.color(0x3a8a5a, 1.1);
        mb.tube(0.14, y + 0.03, -0.12, 0.2, y + 0.03, -0.02, 0.06);
        mb.color(0xbab6aa, 1);
        sheet(mb, 0.05, 0.16, 0.26, 0.2, 1.1, 0.02);
      },
    });
  }

  return { geometries, looks };
}

/** An n-sided frustum along Y centred on the axis, sides only (a cone's body). */
function frustum(mb: MeshBuilder, y0: number, y1: number, r0: number, r1: number, sides: number): void {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const s0 = Math.sin(a0);
    const c0 = Math.cos(a0);
    const s1 = Math.sin(a1);
    const c1 = Math.cos(a1);
    mb.quad(r0 * s0, y0, r0 * c0, r0 * s1, y0, r0 * c1, r1 * s1, y1, r1 * c1, r1 * s0, y1, r1 * c0);
  }
}

/** A box of `width` (x) and `thick` from the line (x0,y0,z0) to (x1,y1,z1): a leaning board or leg. */
function slab(mb: MeshBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, thick: number): void {
  let dx = x1 - x0;
  let dy = y1 - y0;
  let dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  // Across = x, depth = across x along.
  const ax = 1;
  const ay = 0;
  const az = 0;
  let nx = ay * dz - az * dy;
  let ny = az * dx - ax * dz;
  let nz = ax * dy - ay * dx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  const w = width / 2;
  const t = thick / 2;
  const corner = (ex: number, et: number, end: 0 | 1): [number, number, number] => {
    const bx = end ? x1 : x0;
    const by = end ? y1 : y0;
    const bz = end ? z1 : z0;
    return [bx + ax * ex * w + nx * et * t, by + ay * ex * w + ny * et * t, bz + az * ex * w + nz * et * t];
  };
  const q = (a: number[], b: number[], c: number[], d: number[]): void => mb.quad(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
  const p = {
    l0m: corner(-1, -1, 0), r0m: corner(1, -1, 0), l0p: corner(-1, 1, 0), r0p: corner(1, 1, 0),
    l1m: corner(-1, -1, 1), r1m: corner(1, -1, 1), l1p: corner(-1, 1, 1), r1p: corner(1, 1, 1),
  };
  // Double-sided material: winding only decides the flat normal, so both big faces are emitted outward.
  q(p.l0p, p.r0p, p.r1p, p.l1p);
  q(p.r0m, p.l0m, p.l1m, p.r1m);
  q(p.r0p, p.r0m, p.r1m, p.r1p);
  q(p.l0m, p.l0p, p.l1p, p.l1m);
  q(p.l1p, p.r1p, p.r1m, p.l1m);
  q(p.l0m, p.r0m, p.r0p, p.l0p);
}

/** A sign face on a leaning board, from (y0, z0) at the bottom to (y1, z1) at the top, facing `dir` along Z. */
function tiltedFace(
  mb: MeshBuilder,
  x: number,
  y0: number,
  z0: number,
  y1: number,
  z1: number,
  width: number,
  dir: 1 | -1,
  c: { u0: number; v0: number; u1: number; v1: number },
): void {
  const w = width / 2;
  if (dir > 0) mb.quad(x - w, y0, z0, x + w, y0, z0, x + w, y1, z1, x - w, y1, z1, c.u0, c.v0, c.u1, c.v1);
  else mb.quad(x + w, y0, z0, x - w, y0, z0, x - w, y1, z1, x + w, y1, z1, c.u0, c.v0, c.u1, c.v1);
}
