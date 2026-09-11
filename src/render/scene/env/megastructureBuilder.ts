import { MEGACITY } from '../../../world/cityMegastructures';
import { buildBuilding, plotSeed } from './buildingKit';
import { makeRng } from './meshBuilder';
import type { EnvBuilders } from './builders';
import { paintSurface } from './graffiti';

/** Shared facade atlas and merged static equipment: no lights, textures or physics per prop. */
export function buildMegastructures(b: EnvBuilders): void {
  for (const m of b.plan.megastructures ?? []) {
    const rng = makeRng(plotSeed(m.footprint.minX, m.footprint.minZ));
    buildBuilding(b, m.footprint, {
      volumes: m.volumes, zone: 'urban', massing: 4, base: 0,
      height: Math.max(...m.volumes.map((v) => v.y1)), detail: 'mid', archetype: 'twin',
      street: [true, false, true, false],
    }, rng);
    for (const v of m.volumes) {
      const w = v.maxX - v.minX, d = v.maxZ - v.minZ;
      if (w < 4 || d < 4 || v.y1 - v.y0 < 4) continue;
      const x = (v.minX + v.maxX) / 2;
      // Blank service/ground surfaces deliberately replace windows before any paint or AC.
      if (v.y0 === 0) {
        b.wall.color(0x38434a);
        b.wall.box(x, 2.5, v.maxZ + 0.03, w, 5, 0.12);
        paintSurface(b, { x, y: 2.5, z: v.maxZ + 0.1, nx: 0, nz: 1, tx: 1, tz: 0,
          width: w - 0.4, height: 4.5, out: 0.03 }, b.reclaim.at(x, v.maxZ), plotSeed(x, v.maxZ));
        // A shutter and small warm awning on the quiet side of each substantial wall.
        b.props.color(0x202a30);
        b.props.box(v.minX + 2, 1.5, v.minZ - 0.08, 2.5, 3, 0.12);
        for (let y = 0.3; y < 3; y += 0.35) b.props.box(v.minX + 2, y, v.minZ - 0.17, 2.4, 0.04, 0.06);
        b.props.box(v.minX + 2, 3.2, v.minZ - 0.5, 3.2, 0.18, 1);
      }
      // Deep overhead volumes carry warm soffit fixtures, oriented along the passage.
      if (v.y0 >= 9 && v.y0 < 36) {
        b.neon.color(0xffcc82, 0.8);
        for (let px = v.minX + 3; px < v.maxX - 2; px += 10) {
          b.neon.box(px, v.y0 - 0.1, v.minZ + d * 0.3, 2.2, 0.12, 0.45);
          b.neon.box(px, v.y0 - 0.1, v.minZ + d * 0.7, 2.2, 0.12, 0.45);
        }
      }
      // Ribs stay on real wall surfaces and stop at the cut volume's top/bottom.
      b.props.color(0x263139);
      for (let px = v.minX + 0.6; px < v.maxX; px += 12) {
        b.props.box(px, (v.y0 + v.y1) / 2, v.maxZ + 0.18, 0.6, v.y1 - v.y0, 0.45);
      }
      if (rng() > MEGACITY.detailDensity || v.y0 > 54) continue;
      const y = v.y0 + 3;
      // Equipment uses the opaque service side, with a simple shared grille vocabulary.
      b.wall.color(0x303c43);
      b.wall.box(x, y, v.minZ - 0.03, Math.min(w, 6), 3, 0.12);
      b.props.color(0x6a7476);
      for (const off of [-1.1, 1.1]) {
        b.props.box(x + off, y, v.minZ - 0.5, 1.6, 1.1, 0.8);
        b.props.color(0x182126);
        for (let k = -2; k <= 2; k++) b.props.box(x + off, y + k * 0.15, v.minZ - 0.92, 1.2, 0.07, 0.04);
        b.props.color(0x6a7476);
      }
      // Maintenance ledge and sparse human silhouettes: five boxes, no NPC system.
      if (v.y0 >= 24 && w > 10) {
        b.props.color(0x27323a);
        b.props.box(x, y - 1, v.maxZ + 0.7, 5, 0.25, 1.5);
        b.props.box(x, y, v.maxZ + 1.4, 5, 0.1, 0.1);
        for (const dx of [-2.3, 0, 2.3]) b.props.box(x + dx, y - 0.5, v.maxZ + 1.4, 0.08, 1, 0.08);
        b.props.color(0x141b20);
        b.props.box(x, y + 0.15, v.maxZ + 0.55, 0.48, 0.75, 0.28);
        b.props.box(x, y + 0.72, v.maxZ + 0.55, 0.27, 0.3, 0.27);
        for (const dx of [-0.14, 0.14]) b.props.box(x + dx, y - 0.57, v.maxZ + 0.55, 0.15, 0.68, 0.2);
      }
    }
  }
}
