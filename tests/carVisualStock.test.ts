import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildBodyGeometry,
  buildGlassGeometry,
  buildMarkerGeometry,
  buildTailGeometry,
  createCarVisual,
} from '../src/render/scene/carVisual';
import { BODY_SLOTS, SLOT_MODULES, exhaustOutlets } from '../src/render/scene/vehicles/parts';
import { STOCK_LOADOUT, sanitizeLoadout, type CarLoadout } from '../src/core/loadout';
import { partsOf } from '../src/content/carParts';
import { VEHICLE } from '../src/config/tuning';

/**
 * THE STOCK CAR IS PINNED. The workshop (`docs/GARAGE_PLAN.md`) split the one-function body of
 * `carVisual.ts` into slot builders; the car it assembles from `STOCK_LOADOUT` must be the car
 * that was drawn before the split, to the vertex. The numbers below were captured from the
 * pre-refactor code (commit 90f2e9d) and are not to be re-snapshotted to make a change pass:
 * a difference here IS a visible change to the player's car, the rivals and the meet.
 *
 * What is compared, per geometry: vertex count, index count (these are non-indexed, so null),
 * triangle count, the bounding box, and a content fingerprint over every triangle's position,
 * normal and colour. The fingerprint is a SUM of per-triangle hashes, so it does not care in
 * which order the slots were merged — only that the same triangles, wound the same way, with
 * the same colours, are all there. (The one reorder the split made — the grille and intake now
 * merge with the splitter as the front bumper — moves parts that overlap nothing they were
 * reordered against, so no two coplanar faces swapped which one is drawn last.)
 *
 * The uvs are pinned by a fingerprint of their own. The paint atlas (agent C in
 * `docs/GARAGE_PLAN.md`) is expected to re-map them on purpose, and when it does, `uv` is the
 * ONE value it may re-baseline — shape, counts and boxes stay.
 */

/** Mix one 32-bit value into a running hash (FNV-1a over the four bytes, unrolled). */
function mix(h: number, v: number): number {
  let x = h;
  for (let s = 0; s < 32; s += 8) {
    x ^= (v >>> s) & 0xff;
    x = Math.imul(x, 0x01000193);
  }
  return x >>> 0;
}

/** Quantize to 1e-5 so a float round-trip through a different merge path cannot flip a bit. */
const q = (value: number): number => Math.round(value * 1e5) | 0;

interface GeometryPrint {
  vertices: number;
  index: number | null;
  triangles: number;
  attributes: string;
  box: number[];
  /** Everything but the uvs: position, normal, colour. */
  fingerprint: string;
  /** The uvs alone, so a deliberate re-mapping (the paint atlas) can move this and nothing else. */
  uv: string;
}

function print(geometry: THREE.BufferGeometry): GeometryPrint {
  const position = geometry.getAttribute('position');
  const names = Object.keys(geometry.attributes).sort();
  const attrs = names.filter((n) => n !== 'uv').map((n) => geometry.getAttribute(n));
  const uvAttr = geometry.getAttribute('uv');
  const index = geometry.getIndex();
  const vertexOf = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const triangles = (index ? index.count : position.count) / 3;
  let sum = 0;
  let sumSq = 0;
  let uvSum = 0;
  for (let t = 0; t < triangles; t++) {
    let h = 0x811c9dc5;
    let hu = 0x811c9dc5;
    for (let k = 0; k < 3; k++) {
      const v = vertexOf(t, k);
      for (const a of attrs) {
        for (let c = 0; c < a.itemSize; c++) h = mix(h, q(a.getComponent(v, c)));
      }
      // The uv hash is keyed by the vertex's position too, so it pins WHICH uv sits WHERE.
      if (uvAttr) {
        for (let c = 0; c < 3; c++) hu = mix(hu, q(position.getComponent(v, c)));
        for (let c = 0; c < 2; c++) hu = mix(hu, q(uvAttr.getComponent(v, c)));
      }
    }
    sum = (sum + h) >>> 0;
    sumSq = (sumSq + Math.imul(h, h)) >>> 0;
    uvSum = (uvSum + hu) >>> 0;
  }
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  return {
    vertices: position.count,
    index: index ? index.count : null,
    triangles,
    attributes: names.map((n) => `${n}:${geometry.getAttribute(n).itemSize}`).join(','),
    box: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map((n) => Math.round(n * 1e6) / 1e6),
    fingerprint: `${sum.toString(16)}:${sumSq.toString(16)}`,
    uv: uvAttr ? uvSum.toString(16) : '-',
  };
}

function materialPrint(material: THREE.Material): string {
  const m = material as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial;
  const bits: string[] = [m.type];
  if (m.color) bits.push(`c${m.color.getHexString()}`);
  if (m.emissive) bits.push(`e${m.emissive.getHexString()}x${m.emissiveIntensity}`);
  if (m.roughness !== undefined) bits.push(`r${m.roughness}`);
  if (m.metalness !== undefined) bits.push(`m${m.metalness}`);
  if (m.clearcoat !== undefined) bits.push(`cc${m.clearcoat}/${m.clearcoatRoughness}`);
  bits.push(`o${m.opacity}`, `t${m.transparent ? 1 : 0}`, `b${m.blending}`, `s${m.side}`, `dw${m.depthWrite ? 1 : 0}`);
  bits.push(`tm${m.toneMapped ? 1 : 0}`, `vc${m.vertexColors ? 1 : 0}`);
  return bits.join(' ');
}

describe('stock car geometry (pinned from before the workshop split)', () => {
  it('builds the same bodywork for the player (open cabin)', () => {
    const g = buildBodyGeometry(true);
    expect(print(g)).toMatchInlineSnapshot(`
      {
        "attributes": "color:3,normal:3,position:3,uv:2",
        "box": [
          -1.07759,
          0.07,
          -2.26,
          1.07759,
          1.33,
          2.24,
        ],
        "fingerprint": "a873a8a6:2af35f62",
        "index": null,
        "triangles": 928,
        "uv": "7e3afef4",
        "vertices": 2784,
      }
    `);
    g.dispose();
  });

  it('builds the same bodywork for the rivals and the meet (closed cabin)', () => {
    const g = buildBodyGeometry();
    expect(print(g)).toMatchInlineSnapshot(`
      {
        "attributes": "color:3,normal:3,position:3,uv:2",
        "box": [
          -1.07759,
          0.07,
          -2.26,
          1.07759,
          1.33,
          2.24,
        ],
        "fingerprint": "b357299b:8f9b96c9",
        "index": null,
        "triangles": 932,
        "uv": "f04c8c16",
        "vertices": 2796,
      }
    `);
    g.dispose();
  });

  it('builds the same glass, tail lights and marker', () => {
    const glass = buildGlassGeometry();
    const glazed = buildGlassGeometry(0.52);
    const tail = buildTailGeometry();
    const marker = buildMarkerGeometry();
    expect({ glass: print(glass), glazed: print(glazed), tail: print(tail), marker: print(marker) }).toMatchInlineSnapshot(`
      {
        "glass": {
          "attributes": "color:4,normal:3,position:3",
          "box": [
            -0.76108,
            0.874151,
            -0.744944,
            0.76108,
            1.330364,
            1.575568,
          ],
          "fingerprint": "9250ce2d:765b88b7",
          "index": null,
          "triangles": 48,
          "uv": "-",
          "vertices": 144,
        },
        "glazed": {
          "attributes": "color:4,normal:3,position:3",
          "box": [
            -0.76108,
            0.874151,
            -0.744944,
            0.76108,
            1.330364,
            1.575568,
          ],
          "fingerprint": "61894c1:a2ce96f3",
          "index": null,
          "triangles": 48,
          "uv": "-",
          "vertices": 144,
        },
        "marker": {
          "attributes": "color:4,normal:3,position:3",
          "box": [
            -1.01,
            0.105,
            -0.95,
            1.01,
            1.375,
            2.14,
          ],
          "fingerprint": "b8f640f8:9daef528",
          "index": null,
          "triangles": 48,
          "uv": "-",
          "vertices": 144,
        },
        "tail": {
          "attributes": "color:3,normal:3,position:3",
          "box": [
            -0.68,
            0.53,
            2.08,
            0.68,
            0.69,
            2.16,
          ],
          "fingerprint": "ad718710:95cafd98",
          "index": null,
          "triangles": 48,
          "uv": "-",
          "vertices": 144,
        },
      }
    `);
    for (const g of [glass, glazed, tail, marker]) g.dispose();
  });

  it('assembles the same player car: every mesh, where it hangs, and what it is drawn with', () => {
    for (const options of [{}, { slot: 2 }]) {
      const car = createCarVisual(options);
      try {
        car.update(1 / 60, 0);
        const meshes: string[] = [];
        let drawCalls = 0;
        car.root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          if (mesh.visible) drawCalls++;
          const p = print(mesh.geometry);
          const where = mesh.parent === car.root ? 'root' : mesh.parent === car.chassis ? 'chassis' : 'nested';
          meshes.push(
            [
              mesh.name || '-',
              where,
              `ro${mesh.renderOrder}`,
              mesh.visible ? 'vis' : 'hid',
              `${p.triangles}t`,
              p.fingerprint,
              `uv:${p.uv}`,
              p.box.join('/'),
              materialPrint(mesh.material as THREE.Material),
            ].join(' | '),
          );
        });
        // Where the four wheels stand and how they are turned, at rest and steered/rolled.
        const wheelsMesh = car.root.getObjectByName('player-car-wheels') as THREE.InstancedMesh;
        const matrix = new THREE.Matrix4();
        const wheelPose = (): string[] => {
          const out: string[] = [];
          for (let i = 0; i < wheelsMesh.count; i++) {
            wheelsMesh.getMatrixAt(i, matrix);
            out.push(matrix.elements.map((e) => Math.round(e * 1e5) / 1e5).join(','));
          }
          return out;
        };
        const atRest = wheelPose();
        car.wheels[0].steer.rotation.y = 0.3;
        car.wheels[1].steer.rotation.y = 0.3;
        for (const w of car.wheels) w.spin.rotation.x = 1.2;
        car.update(1 / 60, 0.1);
        const steered = wheelPose();
        expect({ options, drawCalls, meshes, atRest, steered }).toMatchSnapshot();
      } finally {
        car.dispose();
      }
    }
  });
});

describe('CarVisual.applyLoadout', () => {
  const countDraws = (root: THREE.Object3D): number => {
    let n = 0;
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.visible) n++;
    });
    return n;
  };
  const materialsOf = (root: THREE.Object3D): Set<THREE.Material> => {
    const out = new Set<THREE.Material>();
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) out.add((o as THREE.Mesh).material as THREE.Material);
    });
    return out;
  };

  it('re-dressing the car in stock rebuilds the same body and disposes the one it replaced', () => {
    const car = createCarVisual();
    try {
      const body = car.root.getObjectByName('player-car-body') as THREE.Mesh;
      const before = print(body.geometry);
      const old = body.geometry;
      let disposed = false;
      old.addEventListener('dispose', () => {
        disposed = true;
      });
      const materials = materialsOf(car.root);
      car.applyLoadout(STOCK_LOADOUT);
      expect(body.geometry).not.toBe(old);
      expect(disposed).toBe(true);
      expect(print(body.geometry)).toEqual(before);
      expect(countDraws(car.root)).toBe(14);
      expect(materialsOf(car.root)).toEqual(materials);
      expect(car.loadout).toEqual(STOCK_LOADOUT);
      expect(car.loadout).not.toBe(STOCK_LOADOUT);
    } finally {
      car.dispose();
    }
  });

  it('moves the stance without touching the carrier contract, and comes back to stock exactly', () => {
    const car = createCarVisual();
    try {
      const wheels = car.root.getObjectByName('player-car-wheels') as THREE.InstancedMesh;
      const at = (i: number): THREE.Matrix4 => {
        const m = new THREE.Matrix4();
        wheels.getMatrixAt(i, m);
        return m;
      };
      const stock = [0, 1, 2, 3].map(at);
      const low = sanitizeLoadout({ ...STOCK_LOADOUT, stance: { rideHeight: -3, camberFront: 4, camberRear: 6, trackFront: 2, trackRear: 3 } });
      car.applyLoadout(low);
      car.update(1 / 60, 0);
      for (const w of car.wheels) expect(w.spin.parent).toBe(w.steer);
      // Pushed out, still on the road, tilted top-in.
      expect(car.wheels[0].steer.position.x).toBeLessThan(stock[0].elements[12]);
      expect(car.wheels[1].steer.position.x).toBeGreaterThan(stock[1].elements[12]);
      for (const w of car.wheels) expect(w.steer.position.y).toBe(VEHICLE.wheelRadius);
      // Negative camber: tops in, so each wheel's outer face tips skyward — the right wheel's
      // axle (+X) rises, the left's (whose outer end is -X) the other way.
      expect(at(1).elements[1]).toBeGreaterThan(0);
      expect(at(0).elements[1]).toBeLessThan(0);
      expect(car.chassis.position.y).toBeLessThan(0);
      expect(countDraws(car.root)).toBe(14);

      car.applyLoadout(STOCK_LOADOUT);
      car.resetBody();
      car.update(1 / 60, 0);
      for (let i = 0; i < 4; i++) expect(at(i).elements).toEqual(stock[i].elements);
      expect(car.chassis.position.y).toBe(0);
    } finally {
      car.dispose();
    }
  });

  it('takes an unsanitized loadout at creation and on apply without throwing', () => {
    const car = createCarVisual({ loadout: { garbage: true } as unknown as CarLoadout });
    try {
      expect(car.loadout).toEqual(STOCK_LOADOUT);
      car.applyLoadout(null as unknown as CarLoadout);
      expect(car.loadout).toEqual(STOCK_LOADOUT);
    } finally {
      car.dispose();
    }
  });

  it('keeps a match car in its slot colour whatever the loadout', () => {
    const car = createCarVisual({ slot: 1 });
    try {
      const body = car.root.getObjectByName('player-car-body') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
      const colour = body.material.color.getHex();
      car.applyLoadout(sanitizeLoadout({ ...STOCK_LOADOUT, paint: { base: 'red', finish: 'matte' } }));
      expect(body.material.color.getHex()).toBe(colour);
    } finally {
      car.dispose();
    }
  });
});

describe('body slots against the catalogue', () => {
  it('has a builder variant for every body part the catalogue sells, stock first', () => {
    for (const slot of BODY_SLOTS) {
      const module = SLOT_MODULES[slot];
      expect(module.slot).toBe(slot);
      expect(module.variants[0]).toBe(`${slot}.stock`);
    }
    for (const category of ['frontBumper', 'rearBumper', 'skirts', 'hood', 'trunk', 'spoiler', 'exhaustTips'] as const) {
      for (const p of partsOf(category)) expect(SLOT_MODULES[category].variants, p.id).toContain(p.id);
    }
  });

  it('builds stock for an id a slot does not know, instead of nothing', () => {
    const ctx = { openCabin: false, loadout: STOCK_LOADOUT };
    for (const slot of BODY_SLOTS) {
      const known = SLOT_MODULES[slot].build(`${slot}.stock`, ctx);
      const unknown = SLOT_MODULES[slot].build(`${slot}.no-such-part`, ctx);
      expect(unknown.length).toBe(known.length);
      for (const g of [...known, ...unknown]) g.dispose();
    }
  });

  it('puts the exhaust flame where the stock tips are', () => {
    expect(exhaustOutlets('exhaustTips.stock').map((o) => [o.x, o.y, o.z])).toEqual([
      [-0.34, 0.33, 2.245],
      [0.34, 0.33, 2.245],
    ]);
  });
});
