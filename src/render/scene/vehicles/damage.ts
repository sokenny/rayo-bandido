import * as THREE from 'three';

/**
 * Crash damage on the player's car (`src/sim/crashDamage.ts` decides it; this draws it).
 *
 * Scrapes, scuffs, gouges and creased panels, laid over the bodywork as thin decals just proud of
 * the paint and revealed a few at a time as crashes are charged — the rear and the flanks first,
 * because that is what the chase camera sees. One merged mesh, one draw call, and nothing per
 * frame: `setMarks` rewrites the vertex alphas, and only when the count changes. The garage
 * setting the count back to 0 is the whole of the repair.
 *
 * The body is one merged geometry with no separate bumper to bend, so the "damaged body" is the
 * decals plus a little grime on the paint (`CarVisual.setDamage`), not a deformed mesh.
 *
 * Returns a mesh that never shows anything when there is no DOM (unit tests run under Node):
 * without the canvas atlas a decal would be a solid quad.
 */
export interface CarDamage {
  readonly mesh: THREE.Mesh;
  /** How many decals are showing: 0 is a clean car. */
  setMarks(marks: number): void;
  dispose(): void;
}

/** Atlas cells, 2 x 2, each twice as wide as tall. */
const SCRAPE = 0;
const GOUGE = 1;
const SCUFF = 2;
const CREASE = 3;

const CELL_W = 256;
const CELL_H = 128;

interface Decal {
  /** Centre, chassis-local (m). */
  x: number;
  y: number;
  z: number;
  /** Outward normal (unit-ish; normalised here). */
  nx: number;
  ny: number;
  nz: number;
  /** Size along the surface (m): width runs along the car where it can, height across. */
  w: number;
  h: number;
  cell: number;
  /** In-plane rotation (rad), so no two marks sit square. */
  roll: number;
}

/**
 * In the order they appear — what the chase camera sees first: the rear deck between the wing
 * and the tail lights, the roof, then the flanks, the tail and the nose. Positions sit a
 * centimetre or two outside the hull lofted in `buildBodyGeometry` (sides at |x| ~0.89, the deck
 * falling from 0.86 at z 1.9 to 0.77 at the tail, roof at 1.31) and clear of the over-fenders,
 * the skirts, the wing and a match's roof marker.
 */
const DECK_NY = 0.93;
const DECK_NZ = 0.38;
const DECALS: readonly Decal[] = [
  // The deck is shallow along the car, so these two are turned a quarter to run across it.
  { x: 0.38, y: 0.835, z: 2.0, nx: 0, ny: DECK_NY, nz: DECK_NZ, w: 0.5, h: 0.24, cell: GOUGE, roll: Math.PI / 2 + 0.1 },
  { x: -0.26, y: 1.325, z: 0.02, nx: 0, ny: 1, nz: 0, w: 0.56, h: 0.3, cell: SCRAPE, roll: 0.35 },
  { x: -0.918, y: 0.53, z: 0.12, nx: -1, ny: 0, nz: 0, w: 1.0, h: 0.26, cell: SCRAPE, roll: -0.05 },
  { x: -0.4, y: 0.835, z: 2.0, nx: 0, ny: DECK_NY, nz: DECK_NZ, w: 0.44, h: 0.22, cell: SCUFF, roll: Math.PI / 2 - 0.1 },
  { x: 0.918, y: 0.5, z: -0.22, nx: 1, ny: 0, nz: 0, w: 0.8, h: 0.28, cell: CREASE, roll: 0.07 },
  { x: -0.5, y: 0.42, z: 2.2, nx: 0, ny: 0, nz: 1, w: 0.4, h: 0.22, cell: GOUGE, roll: 0.12 },
  { x: 0.76, y: 0.45, z: -2.0, nx: 0.62, ny: 0, nz: -0.78, w: 0.4, h: 0.28, cell: CREASE, roll: 0.2 },
  { x: -0.76, y: 0.44, z: -2.0, nx: -0.62, ny: 0, nz: -0.78, w: 0.4, h: 0.28, cell: GOUGE, roll: -0.1 },
  { x: -0.16, y: 0.86, z: -1.02, nx: 0, ny: 1, nz: -0.12, w: 0.52, h: 0.32, cell: SCUFF, roll: 0.5 },
  { x: 0.918, y: 0.6, z: 0.6, nx: 1, ny: 0, nz: 0, w: 0.42, h: 0.24, cell: GOUGE, roll: 0.15 },
];

/** Tiny deterministic PRNG, so the marks are the same scratches every session. */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Long strokes of bare metal and dark gouge. Deliberately fat: a decal is a few dozen pixels
 * across in the chase view, so the atlas is mipmapped four or five levels down and anything
 * thinner than ~4 px here averages away to nothing.
 */
function scratches(ctx: CanvasRenderingContext2D, rand: () => number, ox: number, oy: number, count: number, spread: number): void {
  for (let i = 0; i < count; i++) {
    const y = oy + CELL_H * 0.5 + (rand() - 0.5) * CELL_H * spread;
    const x0 = ox + 22 + rand() * 40;
    const x1 = ox + CELL_W - 22 - rand() * 40;
    const bow = (rand() - 0.5) * 16;
    const light = rand() < 0.55;
    ctx.strokeStyle = light ? `rgba(214, 220, 232, ${0.8 + rand() * 0.2})` : `rgba(6, 6, 9, ${0.85 + rand() * 0.15})`;
    ctx.lineWidth = light ? 3 + rand() * 3 : 4 + rand() * 4;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.quadraticCurveTo((x0 + x1) * 0.5, y + bow, x1, y + (rand() - 0.5) * 8);
    ctx.stroke();
  }
}

function blotch(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, inner: string, outer: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function createAtlas(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * 2;
  canvas.height = CELL_H * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rand = makeRandom(0x0dead5);
  ctx.lineCap = 'round';
  const cell = (i: number): [number, number] => [(i % 2) * CELL_W, Math.floor(i / 2) * CELL_H];

  // A scrape: a band of grime with long scratches through it, paint sanded to primer.
  {
    const [ox, oy] = cell(SCRAPE);
    blotch(ctx, ox + CELL_W * 0.5, oy + CELL_H * 0.5, CELL_W * 0.46, CELL_H * 0.34, 'rgba(12, 12, 16, 0.75)', 'rgba(12, 12, 16, 0)');
    blotch(ctx, ox + CELL_W * 0.48, oy + CELL_H * 0.5, CELL_W * 0.36, CELL_H * 0.16, 'rgba(150, 156, 168, 0.55)', 'rgba(150, 156, 168, 0)');
    scratches(ctx, rand, ox, oy, 12, 0.5);
  }
  // A gouge: a dark bruise where the panel took it, cuts radiating out of it.
  {
    const [ox, oy] = cell(GOUGE);
    const cx = ox + CELL_W * 0.5;
    const cy = oy + CELL_H * 0.5;
    blotch(ctx, cx, cy, CELL_W * 0.44, CELL_H * 0.46, 'rgba(5, 5, 7, 0.95)', 'rgba(5, 5, 7, 0)');
    for (let i = 0; i < 12; i++) {
      const a = rand() * Math.PI * 2;
      const r0 = 8 + rand() * 10;
      const r1 = r0 + 22 + rand() * 36;
      ctx.strokeStyle = rand() < 0.55 ? `rgba(214, 220, 232, ${0.8 + rand() * 0.2})` : 'rgba(3, 3, 5, 0.95)';
      ctx.lineWidth = 3 + rand() * 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0 * 1.6, cy + Math.sin(a) * r0 * 0.8);
      ctx.lineTo(cx + Math.cos(a) * r1 * 1.6, cy + Math.sin(a) * r1 * 0.8);
      ctx.stroke();
    }
  }
  // A scuff: a ragged patch of rubbed-off paint in a ring of grime, scratches through it.
  {
    const [ox, oy] = cell(SCUFF);
    blotch(ctx, ox + CELL_W * 0.5, oy + CELL_H * 0.5, CELL_W * 0.44, CELL_H * 0.44, 'rgba(12, 12, 16, 0.7)', 'rgba(12, 12, 16, 0)');
    for (let i = 0; i < 7; i++) {
      blotch(
        ctx,
        ox + CELL_W * (0.32 + rand() * 0.36),
        oy + CELL_H * (0.38 + rand() * 0.24),
        22 + rand() * 30,
        14 + rand() * 14,
        `rgba(170, 176, 188, ${0.45 + rand() * 0.25})`,
        'rgba(170, 176, 188, 0)',
      );
    }
    scratches(ctx, rand, ox, oy, 7, 0.55);
  }
  // A crease: a buckled panel — dark folds with the light catching the lip of each.
  {
    const [ox, oy] = cell(CREASE);
    blotch(ctx, ox + CELL_W * 0.5, oy + CELL_H * 0.5, CELL_W * 0.46, CELL_H * 0.42, 'rgba(8, 8, 12, 0.8)', 'rgba(8, 8, 12, 0)');
    for (let f = 0; f < 3; f++) {
      const baseY = oy + CELL_H * (0.3 + f * 0.2);
      const pts: number[] = [];
      for (let k = 0; k <= 6; k++) pts.push(ox + 30 + k * ((CELL_W - 60) / 6), baseY + (rand() - 0.5) * 22);
      for (const [style, width, dy] of [
        ['rgba(3, 3, 5, 0.95)', 8, 0],
        ['rgba(214, 220, 232, 0.85)', 3, -5],
      ] as const) {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1] + dy);
        for (let k = 1; k <= 6; k++) ctx.lineTo(pts[k * 2], pts[k * 2 + 1] + dy);
        ctx.stroke();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** One quad per decal, non-indexed: position, normal, uv and an RGBA colour whose alpha is the switch. */
function buildGeometry(): THREE.BufferGeometry {
  const n = DECALS.length;
  const positions = new Float32Array(n * 18);
  const normals = new Float32Array(n * 18);
  const uvs = new Float32Array(n * 12);
  const colors = new Float32Array(n * 24);
  const normal = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const up = new THREE.Vector3();
  const corner = new THREE.Vector3();
  // Two triangles: (0,0) (1,0) (1,1) and (0,0) (1,1) (0,1), in the quad's own (s, t) square.
  const S = [0, 1, 1, 0, 1, 0];
  const T = [0, 0, 1, 0, 1, 1];
  for (let i = 0; i < n; i++) {
    const d = DECALS[i];
    normal.set(d.nx, d.ny, d.nz).normalize();
    // Width runs along the car (Z) on a flank or the deck, across it (X) on the nose and tail.
    up.set(0, 1, 0);
    if (Math.abs(normal.y) > 0.9) up.set(1, 0, 0);
    u.crossVectors(up, normal).normalize();
    v.crossVectors(normal, u).normalize();
    const c = Math.cos(d.roll);
    const s = Math.sin(d.roll);
    const ux = u.x * c + v.x * s;
    const uy = u.y * c + v.y * s;
    const uz = u.z * c + v.z * s;
    const vx = v.x * c - u.x * s;
    const vy = v.y * c - u.y * s;
    const vz = v.z * c - u.z * s;
    const col = d.cell % 2;
    const row = Math.floor(d.cell / 2);
    for (let k = 0; k < 6; k++) {
      const ss = S[k] - 0.5;
      const tt = T[k] - 0.5;
      corner.set(d.x + ux * ss * d.w + vx * tt * d.h, d.y + uy * ss * d.w + vy * tt * d.h, d.z + uz * ss * d.w + vz * tt * d.h);
      positions.set([corner.x, corner.y, corner.z], i * 18 + k * 3);
      normals.set([normal.x, normal.y, normal.z], i * 18 + k * 3);
      // Canvas row 0 is the top of the image; flipY puts it at v = 1.
      uvs.set([(col + S[k]) * 0.5, 1 - (row + 1 - T[k]) * 0.5], i * 12 + k * 2);
      colors.set([1, 1, 1, 0], i * 24 + k * 4);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geo.computeBoundingSphere();
  return geo;
}

export function createCarDamage(): CarDamage {
  const atlas = createAtlas();
  const geometry = buildGeometry();
  const material = new THREE.MeshStandardMaterial({
    map: atlas,
    // The livery glows a touch (`carVisual.ts`); the bare metal in a scratch catches the same.
    emissive: 0xffffff,
    emissiveMap: atlas,
    emissiveIntensity: 0.3,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    roughness: 0.9,
    metalness: 0.15,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'player-car-damage';
  // Over the paint, under the glass that is drawn after the cabin.
  mesh.renderOrder = 1;
  mesh.visible = false;
  const color = geometry.getAttribute('color') as THREE.BufferAttribute;
  let shown = 0;

  return {
    mesh,
    setMarks(marks) {
      const next = Math.max(0, Math.min(DECALS.length, Math.floor(marks)));
      if (next === shown) return;
      shown = next;
      const alphas = color.array as Float32Array;
      for (let i = 0; i < DECALS.length; i++) {
        const a = i < next ? 1 : 0;
        for (let k = 0; k < 6; k++) alphas[i * 24 + k * 4 + 3] = a;
      }
      color.needsUpdate = true;
      mesh.visible = next > 0 && atlas !== null;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      atlas?.dispose();
    },
  };
}
