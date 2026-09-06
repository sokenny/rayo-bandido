import { describe, expect, it } from 'vitest';
import { MeshBuilder } from '../src/render/scene/env/meshBuilder';

/**
 * Soft edges are a shading trick, not geometry: the contract is that turning them on costs
 * nothing (same vertices, same triangles, same positions) and leaves the face flat in the
 * middle while bending the normal out at the corners.
 */
describe('soft box edges', () => {
  const build = (radius: number) => {
    const b = new MeshBuilder().soft(radius);
    b.box(0, 1, 0, 2, 2, 2, { bottom: true });
    return b;
  };

  it('costs no extra geometry', () => {
    const hard = build(0);
    const soft = build(0.3);
    expect(soft.triangles).toBe(hard.triangles);
    expect(soft.positions).toEqual(hard.positions);
    expect(soft.uvs).toEqual(soft.uvs);
    expect(soft.normals.length).toBe(hard.normals.length);
  });

  it('leaves the normals unit length', () => {
    const n = build(0.3).normals;
    for (let i = 0; i < n.length; i += 3) {
      expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 6);
    }
  });

  it('bends the corners out of the face but keeps its centre flat', () => {
    const hard = build(0);
    const soft = build(0.3);
    // The +X face is the first six vertices; its flat normal is +X.
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let bent = 0;
    for (let i = 0; i < 18; i += 3) {
      sx += soft.normals[i];
      sy += soft.normals[i + 1];
      sz += soft.normals[i + 2];
      expect(soft.normals[i]).toBeLessThan(hard.normals[i]);
      if (Math.hypot(soft.normals[i + 1], soft.normals[i + 2]) > 0.05) bent++;
    }
    // Every corner leans off-axis, and the leans cancel: the average is still +X.
    expect(bent).toBe(6);
    expect(sy / 6).toBeCloseTo(0, 6);
    expect(sz / 6).toBeCloseTo(0, 6);
    expect(sx / 6).toBeGreaterThan(0.9);
  });

  it('scales the bend to the face, so a big wall stays near flat', () => {
    const small = new MeshBuilder().soft(0.3);
    small.box(0, 0.5, 0, 1, 1, 1);
    const large = new MeshBuilder().soft(0.3);
    large.box(0, 20, 0, 40, 40, 40);
    // Off-axis lean of the first corner of the +X face.
    const lean = (b: MeshBuilder) => Math.hypot(b.normals[1], b.normals[2]);
    expect(lean(small)).toBeGreaterThan(0.3);
    // 0.3 m over a 20 m half-width, on both in-plane axes: about 1.2 degrees.
    expect(lean(large)).toBeLessThan(0.03);
  });

  it('leaves flat quads and unlit primitives alone', () => {
    const b = new MeshBuilder().soft(0.3);
    b.planeY(0, 0, 0, 4, 4);
    for (let i = 0; i < b.normals.length; i += 3) {
      expect(b.normals[i + 1]).toBe(1);
    }
  });
});

/**
 * A chamfered box is easy to get subtly wrong: one bevel strip or corner triangle wound the
 * wrong way is invisible in a screenshot but black under light. Check every facet.
 */
describe('chamfered box', () => {
  const build = (c: number) => {
    const b = new MeshBuilder().chamfer(c);
    b.box(3, 5, -2, 4, 6, 2, { bottom: true });
    return b;
  };

  it('costs 44 triangles a box against the sharp box\'s 12', () => {
    const sharp = new MeshBuilder();
    sharp.box(3, 5, -2, 4, 6, 2, { bottom: true });
    expect(sharp.triangles).toBe(12);
    expect(build(0.2).triangles).toBe(44);
  });

  it('faces every triangle outward', () => {
    const b = build(0.2);
    const p = b.positions;
    const n = b.normals;
    for (let t = 0; t < b.triangles; t++) {
      const i = t * 9;
      // Centroid of the triangle, relative to the box centre.
      const ox = (p[i] + p[i + 3] + p[i + 6]) / 3 - 3;
      const oy = (p[i + 1] + p[i + 4] + p[i + 7]) / 3 - 5;
      const oz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3 + 2;
      const dot = ox * n[t * 9] + oy * n[t * 9 + 1] + oz * n[t * 9 + 2];
      expect(dot, `triangle ${t} faces inward`).toBeGreaterThan(0);
    }
  });

  it('stays inside the sharp box it replaces', () => {
    const p = build(0.2).positions;
    for (let i = 0; i < p.length; i += 3) {
      expect(Math.abs(p[i] - 3)).toBeLessThanOrEqual(2 + 1e-9);
      expect(Math.abs(p[i + 1] - 5)).toBeLessThanOrEqual(3 + 1e-9);
      expect(Math.abs(p[i + 2] + 2)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('clamps the chamfer so a thin box keeps its faces', () => {
    const b = new MeshBuilder().chamfer(10);
    b.box(0, 0, 0, 4, 6, 2, { bottom: true });
    // Clamped to a third of the smallest side (2 / 3), so the +X face still has width.
    const p = b.positions;
    let maxAbsY = 0;
    for (let i = 1; i < p.length; i += 3) maxAbsY = Math.max(maxAbsY, Math.abs(p[i]));
    expect(maxAbsY).toBeCloseTo(3, 6);
  });
});
