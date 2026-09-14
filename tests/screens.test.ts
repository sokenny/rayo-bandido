import { describe, expect, it } from 'vitest';
import { SCREEN_CHANNELS } from '../src/content/screens';
import { createBuilders } from '../src/render/scene/env/builders';
import { buildCity } from '../src/render/scene/env/cityBuilder';
import { DECK_THICKNESS } from '../src/render/scene/env/elevatedBuilder';
import { channelsFor, frameRect, layoutScreens, screenAttributes, screenLayout, SCREEN_ATLAS_WIDTH } from '../src/render/scene/env/screenAtlas';
import { BADKALA, buildScreens, SCREENS, type PlacedScreen } from '../src/render/scene/env/screenBuilder';
import { createCityWorld } from '../src/world/cityWorld';
import { STACK_BOUNDS, STACK_SCREENS, STACK_SPEC } from '../src/world/stackSpec';
import { createProjection, projectOntoPath } from '../src/world/track';

/**
 * The LED screens (`env/screenBuilder.ts`, `env/screenAtlas.ts`): the atlas lays every frame out
 * where the shader will look for it, and in the Stack every screen that goes up hangs on
 * something real and stays out of the decks.
 */

describe('screen atlas', () => {
  const layout = screenLayout();

  it('lays out every frame of every channel inside the atlas, none overlapping', () => {
    const rects: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    for (const c of SCREEN_CHANNELS) {
      const pc = layout.channels.get(c.id);
      expect(pc, c.id).toBeDefined();
      c.frames.forEach((_, k) => rects.push({ id: `${c.id}#${k}`, ...frameRect(pc!, k) }));
    }
    for (const r of rects) {
      expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= layout.width && r.y + r.h <= layout.height, r.id).toBe(true);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
    // Today's catalogue fits a square atlas; the ceiling is 4096 tall.
    expect(layout.width).toBe(SCREEN_ATLAS_WIDTH);
    expect(layout.height).toBeLessThanOrEqual(2048);
  });

  it('gives the shader the numbers that find each frame where it was painted', () => {
    for (const c of SCREEN_CHANNELS) {
      const pc = layout.channels.get(c.id)!;
      const { slot } = screenAttributes(c.id, 0.5);
      c.frames.forEach((_, k) => {
        // The arithmetic in `screenMaterial.ts`'s rbScreenFrame, in UV, back to canvas pixels.
        const perRow = Math.floor(1 / slot[1] + 0.5);
        const index = Math.floor(slot[3] + 0.5) + k;
        const col = index % perRow;
        const row = Math.floor(index / perRow);
        const u0 = col * slot[1];
        const vTop = slot[0] - row * slot[2];
        const r = frameRect(pc, k);
        expect(u0 * layout.width, `${c.id}#${k} x`).toBeCloseTo(r.x, 3);
        expect((1 - vTop) * layout.height, `${c.id}#${k} y`).toBeCloseTo(r.y, 3);
        expect(slot[2] * layout.height).toBeCloseTo(r.h, 3);
      });
    }
  });

  it('refuses a catalogue that repeats a channel or has an empty one', () => {
    const one = SCREEN_CHANNELS[2];
    expect(() => layoutScreens([one, one])).toThrow(/twice/);
    expect(() => layoutScreens([{ ...one, frames: [] }])).toThrow(/no frames/);
  });

  it('keeps the holograms and the Bay\'s old columns off the boards', () => {
    for (const shape of ['wide', 'tall', 'strip'] as const) {
      for (const id of channelsFor(shape, 'facade')) {
        const c = SCREEN_CHANNELS.find((ch) => ch.id === id)!;
        expect(c.motion, id).not.toBe('holo');
        expect(id.startsWith('holo-'), id).toBe(false);
      }
    }
    expect(channelsFor('tall', 'holo').length).toBeGreaterThan(0);
    for (const id of channelsFor('tall', 'holo')) expect(SCREEN_CHANNELS.find((ch) => ch.id === id)!.motion).toBe('holo');
  });
});

describe('screens in the Stack', () => {
  const { plan } = createCityWorld(STACK_SPEC);
  const b = createBuilders(plan);
  buildCity(b);
  const placed = buildScreens(b);
  const of = (kind: PlacedScreen['kind']): PlacedScreen[] => placed.filter((p) => p.kind === kind);

  it('puts up every kind of screen, inside the zone and inside its ceilings', () => {
    const counts = Object.fromEntries(['board', 'hero', 'blade', 'roof', 'holo', 'crossing', 'bridge'].map((k) => [k, of(k as PlacedScreen['kind']).length]));
    console.log('stack screens', counts, 'triangles', b.screens.triangles + b.holo.triangles);
    expect(counts.board + counts.hero).toBeGreaterThan(120);
    expect(counts.hero).toBeGreaterThan(5);
    expect(counts.hero).toBeLessThanOrEqual(STACK_SCREENS.heroes);
    expect(counts.blade).toBeGreaterThan(30);
    expect(counts.blade).toBeLessThanOrEqual(STACK_SCREENS.blades);
    expect(counts.roof).toBeGreaterThan(8);
    expect(counts.holo).toBeGreaterThan(3);
    expect(counts.crossing).toBeGreaterThan(10);
    expect(counts.bridge).toBeGreaterThan(3);
    for (const p of placed) {
      expect(p.x >= STACK_BOUNDS.minX - 20 && p.x <= STACK_BOUNDS.maxX + 20 && p.z >= STACK_BOUNDS.minZ - 20 && p.z <= STACK_BOUNDS.maxZ + 20, `${p.kind} at (${p.x}, ${p.z})`).toBe(true);
    }
  });

  it('hangs every wall board on a wall that is really there behind the whole of it', () => {
    for (const p of [...of('board'), ...of('hero')]) {
      const tx = p.nz;
      const tz = -p.nx;
      for (const a of [-0.45, 0, 0.45]) {
        for (const v of [-0.45, 0.45]) {
          const x = p.x - p.nx * 0.3 + tx * a * p.w;
          const z = p.z - p.nz * 0.3 + tz * a * p.w;
          expect(b.walls.inside(x, p.y + v * p.h, z), `${p.kind} ${p.channel} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(true);
        }
      }
    }
  });

  it('keeps every board out of the decks, and the blades over the street lamps', () => {
    const proj = createProjection();
    const elevated = plan.ribbons.filter((rb) => rb.elevated);
    for (const p of placed) {
      if (p.kind === 'holo') continue;
      const off = p.kind === 'board' || p.kind === 'hero' ? SCREENS.standOff : 0;
      const tx = p.kind === 'blade' ? p.nx : p.nz;
      const tz = p.kind === 'blade' ? p.nz : -p.nx;
      for (const a of [-0.5, 0, 0.5]) {
        for (const v of [-0.5, 0, 0.5]) {
          const x = p.x + p.nx * off + tx * a * p.w;
          const z = p.z + p.nz * off + tz * a * p.w;
          const y = p.y + v * p.h;
          for (const rb of elevated) {
            projectOntoPath(rb.path, x, z, proj);
            if (proj.dist > proj.halfWidth) continue;
            const inSlab = y > proj.y - DECK_THICKNESS - 0.95 && y < proj.y + 1.2;
            expect(inSlab, `${p.kind} ${p.channel} through ${rb.tag} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`).toBe(false);
          }
        }
      }
      if (p.kind === 'blade') expect(p.y - p.h / 2).toBeGreaterThanOrEqual(SCREENS.bladeBottom - 0.01);
    }
  });

  it('puts the BADKALA WANTED poster on some of the big portrait boards, well apart', () => {
    const wanted = placed.filter((p) => p.channel === BADKALA);
    console.log('badkala boards', wanted.length, wanted.map((p) => `${p.kind} ${p.w}x${p.h} (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})`));
    const boards = wanted.filter((p) => p.kind !== 'blade');
    const blades = wanted.filter((p) => p.kind === 'blade');
    expect(boards.length).toBeGreaterThanOrEqual(2);
    expect(blades.length).toBeGreaterThanOrEqual(2);
    // A board is one poster; a blade carries it on the top panel of both faces.
    expect(b.badkala.triangles).toBe(boards.length * 2 + blades.length * 4);
    for (const p of boards) {
      expect(p.kind === 'board' || p.kind === 'hero').toBe(true);
      expect(p.h / p.w).toBeGreaterThan(1.9);
      expect(p.h).toBeGreaterThanOrEqual(SCREENS.tall[1] - 0.01);
      expect(p.y).toBeLessThan(SCREENS.badkalaTop);
    }
    for (const p of wanted) {
      for (const q of wanted) if (q !== p) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(SCREENS.badkalaSpacing);
    }
  });

  it('builds the same screens every time', () => {
    const again = createBuilders(plan);
    buildCity(again);
    const second = buildScreens(again);
    expect(second.length).toBe(placed.length);
    expect(second.map((p) => `${p.kind}:${p.channel}:${p.x.toFixed(2)}:${p.z.toFixed(2)}`)).toEqual(placed.map((p) => `${p.kind}:${p.channel}:${p.x.toFixed(2)}:${p.z.toFixed(2)}`));
  });
});
