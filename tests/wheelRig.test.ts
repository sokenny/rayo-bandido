import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createCarVisual } from '../src/render/scene/carVisual';
import { RIM_DESIGNS, STOCK_WHEEL_LOOK, buildWheelGeometry, type RimDesign } from '../src/render/scene/vehicles/wheel';
import {
  STANCE_STEP,
  WHEEL_WIDTH,
  buildLoadoutWheelGeometry,
  stanceParams,
  wheelLook,
} from '../src/render/scene/vehicles/wheelRig';
import { STEP_RANGES, STOCK_LOADOUT, sanitizeLoadout, type CarLoadout } from '../src/core/loadout';
import { findColor, partsOf, PALETTE } from '../src/content/carParts';
import { VEHICLE } from '../src/config/tuning';

/**
 * Agent B's wheels and stance (`docs/GARAGE_PLAN.md` §6.3). The stock wheel and the stock pose
 * are pinned by `tests/carVisualStock.test.ts`; this file covers what the options do.
 */

type Partial2 = { wheels?: Partial<CarLoadout['wheels']>; stance?: Partial<CarLoadout['stance']> };
const dress = (p: Partial2): CarLoadout =>
  sanitizeLoadout({
    ...STOCK_LOADOUT,
    wheels: { ...STOCK_LOADOUT.wheels, ...(p.wheels ?? {}) },
    stance: { ...STOCK_LOADOUT.stance, ...(p.stance ?? {}) },
  });

const R = VEHICLE.wheelRadius;
const radial = (p: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number): number => Math.hypot(p.getY(i), p.getZ(i));

describe('rim catalogue against the designs', () => {
  it('has a design for every rim the catalogue sells, and sells every design, stock first', () => {
    const sold = partsOf('rims').map((p) => p.id);
    expect(sold[0]).toBe('rims.stock');
    expect([...sold].sort()).toEqual([...RIM_DESIGNS].sort());
    expect(sold.length).toBeGreaterThanOrEqual(7);
  });

  it('draws stock for a rim id it does not know', () => {
    const l = { ...STOCK_LOADOUT, wheels: { ...STOCK_LOADOUT.wheels, rim: 'rims.no-such-rim' } } as CarLoadout;
    expect(wheelLook(l).design).toBe('rims.stock');
  });
});

describe('rim geometry', () => {
  const sizes = [STEP_RANGES.wheelSize.min, 0, STEP_RANGES.wheelSize.max];
  const widths = [0, STEP_RANGES.wheelWidth.max];

  it('builds every design at every size and width: finite, coloured, inside the tyre, on budget', () => {
    for (const rim of RIM_DESIGNS) {
      for (const size of sizes) {
        for (const width of widths) {
          const l = dress({ wheels: { rim, size: size as CarLoadout['wheels']['size'], width: width as CarLoadout['wheels']['width'] } });
          const g = buildLoadoutWheelGeometry(l);
          const pos = g.getAttribute('position');
          const label = `${rim} size ${size} width ${width}`;
          expect(g.getAttribute('color')?.itemSize, label).toBe(3);
          expect(g.getAttribute('normal'), label).toBeTruthy();
          expect(g.index, label).toBeNull();
          expect(pos.count / 3, label).toBeLessThanOrEqual(1000);
          const halfW = stanceParams(l).wheelWidth / 2;
          let maxR = 0;
          for (let i = 0; i < pos.count; i++) {
            expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i)), label).toBe(true);
            // Nothing pokes out past the tyre's outer plane or its tread.
            expect(Math.abs(pos.getX(i)), label).toBeLessThanOrEqual(halfW + 1e-6);
            maxR = Math.max(maxR, radial(pos, i));
          }
          // The outer radius is the physics' radius whatever the rim: the car still sits on the road.
          expect(maxR, label).toBeCloseTo(R, 5);
          g.dispose();
        }
      }
    }
  });

  it('is today\'s wheel exactly for the stock rim in the stock colour', () => {
    const plain = buildWheelGeometry(R, WHEEL_WIDTH, 16);
    const stock = buildLoadoutWheelGeometry(STOCK_LOADOUT);
    expect(wheelLook(STOCK_LOADOUT)).toEqual(STOCK_WHEEL_LOOK);
    expect(stock.getAttribute('position').array).toEqual(plain.getAttribute('position').array);
    expect(stock.getAttribute('color').array).toEqual(plain.getAttribute('color').array);
    // The palette's graphite IS the stock spoke colour.
    expect(parseInt(findColor('graphite')!.hex.slice(1), 16)).toBe(STOCK_WHEEL_LOOK.rimColor);
    plain.dispose();
    stock.dispose();
  });

  it('bakes the rim colour into every design, and nothing else changes with it', () => {
    for (const rim of RIM_DESIGNS) {
      const a = buildLoadoutWheelGeometry(dress({ wheels: { rim, rimColor: 'red' } }));
      const b = buildLoadoutWheelGeometry(dress({ wheels: { rim, rimColor: 'cyan' } }));
      expect(a.getAttribute('position').array, rim).toEqual(b.getAttribute('position').array);
      expect(a.getAttribute('color').array, rim).not.toEqual(b.getAttribute('color').array);
      a.dispose();
      b.dispose();
    }
  });

  it('keeps a black rim readable against the tyre', () => {
    const colours = (rimColor: string): Set<string> => {
      const g = buildLoadoutWheelGeometry(dress({ wheels: { rim: 'rims.steelie', rimColor } }));
      const c = g.getAttribute('color');
      const out = new Set<string>();
      for (let i = 0; i < c.count; i++) out.add(`${c.getX(i).toFixed(4)},${c.getY(i).toFixed(4)},${c.getZ(i).toFixed(4)}`);
      g.dispose();
      return out;
    };
    // A black steelie is still lighter than the tread (linear 0x0a0a0d ≈ 0.003).
    const brightest = Math.max(...[...colours('black')].map((s) => Math.max(...s.split(',').map(Number))));
    expect(brightest).toBeGreaterThan(0.03);
    expect(PALETTE.some((c) => c.id === 'black')).toBe(true);
  });

  it('trades sidewall for rim with the size step, the outer radius fixed', () => {
    let last = 0;
    for (const size of [-1, 0, 1, 2] as const) {
      const l = dress({ wheels: { size } });
      const g = buildLoadoutWheelGeometry(l);
      const pos = g.getAttribute('position');
      const halfW = WHEEL_WIDTH / 2;
      // The sidewall ring is the outermost plane: its inner edge IS the rim's radius.
      let rimR = Infinity;
      for (let i = 0; i < pos.count; i++) if (Math.abs(Math.abs(pos.getX(i)) - halfW) < 1e-6) rimR = Math.min(rimR, radial(pos, i));
      expect(rimR).toBeCloseTo(R * (STOCK_WHEEL_LOOK.rimRatio + size * STANCE_STEP.rimRatio), 5);
      expect(rimR).toBeGreaterThan(last);
      // Some sidewall is always left.
      expect(rimR).toBeLessThan(R * 0.85);
      last = rimR;
      g.dispose();
    }
  });
});

describe('stance', () => {
  const rest = (l: CarLoadout) => {
    const car = createCarVisual({ loadout: l });
    car.resetBody();
    car.update(1 / 60, 0);
    return car;
  };

  it('widens the wheel outward: the inner face stays put, the outer face moves out by all the extra width', () => {
    const base = stanceParams(STOCK_LOADOUT);
    for (const width of [1, 2] as const) {
      const s = stanceParams(dress({ wheels: { width } }));
      const extra = width * STANCE_STEP.width;
      expect(s.wheelWidth).toBeCloseTo(WHEEL_WIDTH + extra, 9);
      expect(s.frontHalfTrack - s.wheelWidth / 2).toBeCloseTo(base.frontHalfTrack - base.wheelWidth / 2, 9);
      expect(s.rearHalfTrack + s.wheelWidth / 2).toBeCloseTo(base.rearHalfTrack + base.wheelWidth / 2 + extra, 9);
    }
  });

  it('pushes the wheels out to flush (front) and a touch of poke (rear) at the top track step', () => {
    const archLip = 0.9 + 0.11;
    const s = stanceParams(dress({ stance: { trackFront: STEP_RANGES.trackFront.max, trackRear: STEP_RANGES.trackRear.max } }));
    const frontOuter = s.frontHalfTrack + s.wheelWidth / 2;
    const rearOuter = s.rearHalfTrack + s.wheelWidth / 2;
    expect(Math.abs(frontOuter - archLip)).toBeLessThan(0.01);
    expect(rearOuter - archLip).toBeGreaterThan(0);
    expect(rearOuter - archLip).toBeLessThan(0.03);
    // Every step in or out moves the wheel, and a tuck is smaller than a push.
    const stock = stanceParams(STOCK_LOADOUT).frontHalfTrack;
    const tuck = stanceParams(dress({ stance: { trackFront: -1 } })).frontHalfTrack;
    const push = stanceParams(dress({ stance: { trackFront: 1 } })).frontHalfTrack;
    expect(tuck).toBeLessThan(stock);
    expect(push).toBeGreaterThan(stock);
    expect(stock - tuck).toBeLessThan(push - stock);
  });

  it('reaches a stanced lean at the top camber steps, in whole degrees', () => {
    const deg = THREE.MathUtils.radToDeg;
    const s = stanceParams(dress({ stance: { camberFront: STEP_RANGES.camberFront.max, camberRear: STEP_RANGES.camberRear.max } }));
    expect(deg(s.camberFront)).toBeCloseTo(6, 6);
    expect(deg(s.camberRear)).toBeCloseTo(8, 6);
  });

  it('keeps the carrier contract and the physics untouched in every extreme', () => {
    const vehicleBefore = JSON.stringify(VEHICLE);
    for (const l of [
      dress({ wheels: { width: 2, size: 2 }, stance: { rideHeight: -4, camberFront: 6, camberRear: 8, trackFront: 4, trackRear: 4 } }),
      dress({ wheels: { rim: 'rims.mesh' }, stance: { rideHeight: 2, trackFront: -2, trackRear: -2 } }),
    ]) {
      const car = rest(l);
      const mesh = car.root.getObjectByName('player-car-wheels') as THREE.InstancedMesh;
      expect(mesh.count).toBe(4);
      for (const w of car.wheels) {
        expect(w.spin.parent).toBe(w.steer);
        expect(w.steer.position.y).toBe(VEHICLE.wheelRadius);
        // Camber is a matrix between steer and spin, never a node in the chain.
        expect(w.steer.children).toEqual([w.spin]);
        expect(w.steer.parent).toBe(car.root);
      }
      expect(car.chassis.position.y).toBeCloseTo(l.stance.rideHeight * STANCE_STEP.rideHeight, 9);
      car.dispose();
    }
    expect(JSON.stringify(VEHICLE)).toBe(vehicleBefore);
  });

  it('never lets the tyre through the arch, down to slammed with every camber, width and track', () => {
    // The wide-body arch (`parts/fenders.ts`): `wheelArch(R + 0.07, 0.07, 0.22, 7)` at x = ±0.9,
    // an inner edge of seven straight segments over the half circle, riding with the body.
    const archR = R + 0.07;
    const seg = Math.PI / 7;
    const archAt = (phi: number): number => {
      const mid = (Math.min(6, Math.floor(phi / seg)) + 0.5) * seg;
      return (archR * Math.cos(seg / 2)) / Math.cos(phi - mid);
    };
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    let worst = Infinity;
    for (const width of [0, 2] as const) {
      for (const track of [-2, 0, 2, 4]) {
        for (const camber of [0, 3, 6, 8]) {
          const l = dress({
            wheels: { width, size: 2 },
            stance: { rideHeight: STEP_RANGES.rideHeight.min, camberFront: Math.min(camber, 6), camberRear: camber, trackFront: track, trackRear: track },
          });
          const car = rest(l);
          const mesh = car.root.getObjectByName('player-car-wheels') as THREE.InstancedMesh;
          const w = stanceParams(l).wheelWidth;
          for (let i = 0; i < 4; i++) {
            mesh.getMatrixAt(i, m);
            const cz = (i < 2 ? -1 : 1) * (VEHICLE.wheelbase / 2);
            const cy = VEHICLE.wheelRadius + car.chassis.position.y;
            // Sample the tread surface (full radius over 94% of the width) densely.
            for (let a = 0; a < 128; a++) {
              const ang = (a / 128) * Math.PI * 2;
              for (let k = 0; k <= 8; k++) {
                const x = (k / 8 - 0.5) * w * 0.94;
                v.set(x, Math.cos(ang) * R, Math.sin(ang) * R).applyMatrix4(m);
                const ax = Math.abs(v.x);
                if (ax < 0.79 || ax > 1.01 || v.y <= cy) continue;
                const dy = v.y - cy;
                const dz = v.z - cz;
                const phi = Math.atan2(dy, dz);
                worst = Math.min(worst, archAt(phi) - Math.hypot(dy, dz));
              }
            }
          }
          car.dispose();
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(0);
    // ...and slammed means slammed: at most a few centimetres of air anywhere.
    expect(worst).toBeLessThan(0.02);
  });

  it('lowers the body visibly per step, slammed to a couple of centimetres of arch gap', () => {
    const s = stanceParams(dress({ stance: { rideHeight: STEP_RANGES.rideHeight.min } }));
    const crownGap = (R + 0.07) * Math.cos(Math.PI / 14) - R + s.rideHeight;
    expect(crownGap).toBeGreaterThan(0.015);
    expect(crownGap).toBeLessThan(0.03);
    expect(STANCE_STEP.rideHeight).toBeGreaterThanOrEqual(0.008);
  });
});

describe('applyLoadout on the rig', () => {
  it('rebuilds the wheel geometry only when the wheel changes, disposing the old one, same mesh and material', () => {
    const car = createCarVisual();
    try {
      const mesh = car.root.getObjectByName('player-car-wheels') as THREE.InstancedMesh;
      const material = mesh.material;
      const first = mesh.geometry;
      car.applyLoadout(dress({ stance: { rideHeight: -2, camberFront: 3 } }));
      expect(mesh.geometry).toBe(first);

      let disposed = false;
      first.addEventListener('dispose', () => {
        disposed = true;
      });
      car.applyLoadout(dress({ wheels: { rim: 'rims.dish-3p', rimColor: 'gold', size: 1, width: 1 } }));
      expect(mesh.geometry).not.toBe(first);
      expect(disposed).toBe(true);
      expect(mesh.material).toBe(material);
      expect(car.root.getObjectByName('player-car-wheels')).toBe(mesh);

      car.applyLoadout(STOCK_LOADOUT);
      const back = buildLoadoutWheelGeometry(STOCK_LOADOUT);
      expect(mesh.geometry.getAttribute('position').array).toEqual(back.getAttribute('position').array);
      back.dispose();
    } finally {
      car.dispose();
    }
  });
});

describe('the physics never reads a stance', () => {
  it('has nothing under src/sim importing the wheel rig, the wheel builder or the loadout stance', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(join(__dirname, '../src/sim'));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/wheelRig|vehicles\/wheel|STANCE_STEP|stanceParams|\.stance\./);
    }
  });
});

// Keep the type import honest for editors: every design id is a RimDesign.
const _designs: readonly RimDesign[] = RIM_DESIGNS;
void _designs;
