import { describe, expect, it } from 'vitest';
import { mesh, type SolidShape } from '../src/solids.ts';
import { solid } from '../src/solid.ts';

type Mesh = ReturnType<typeof mesh>;

const SHAPES: SolidShape[] = ['box', 'slab', 'sphere', 'torus', 'capsule', 'cylinder'];
const vertexCount = (m: Mesh) => m.positions.length / 3;
const lengthOf = (a: Float32Array, i: number) => Math.hypot(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
const extent = (m: Mesh) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertexCount(m); i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.positions[i * 3 + k]); hi[k] = Math.max(hi[k], m.positions[i * 3 + k]); }
  return { lo, hi, size: hi.map((h, k) => h - lo[k]) };
};

describe('the meshes of the solids', () => {
  it('a box of [100, 50, 20] has 24 vertices with unit normals and 36 indices, and the size for its bounds', () => {
    const m = mesh('box', { size: [100, 50, 20] });
    expect(vertexCount(m)).toBe(24);
    expect(m.indices.length).toBe(36);
    for (let i = 0; i < 24; i++) expect(lengthOf(m.normals, i)).toBeCloseTo(1, 5);
    const { size, lo, hi } = extent(m);
    expect(size).toEqual([100, 50, 20]);
    expect(lo.map((v, k) => v + hi[k])).toEqual([0, 0, 0]);
  });

  it('a sphere of 16 segments has unit normals that point away from its centre', () => {
    const m = mesh('sphere', { size: [80, 80, 80], segments: 16 });
    for (let i = 0; i < vertexCount(m); i++) {
      expect(lengthOf(m.normals, i)).toBeCloseTo(1, 5);
      const dot = (m.positions[i * 3] * m.normals[i * 3] + m.positions[i * 3 + 1] * m.normals[i * 3 + 1] + m.positions[i * 3 + 2] * m.normals[i * 3 + 2]) / lengthOf(m.positions, i);
      expect(dot).toBeCloseTo(1, 4);
    }
    expect(extent(m).size.map((v) => Math.round(v))).toEqual([80, 80, 80]);
  });

  it('a torus is closed: every edge is shared by exactly two triangles', () => {
    const m = mesh('torus', { size: [120, 120, 40], segments: 12 });
    const edges = new Map<string, number>();
    for (let t = 0; t < m.indices.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = m.indices[t + k], b = m.indices[t + (k + 1) % 3];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
  });

  it('a slab with a radius of 8 stays within its size, and its rounding adds vertices', () => {
    const sharp = mesh('slab', { size: [160, 100, 20], radius: 0 });
    const round = mesh('slab', { size: [160, 100, 20], radius: 8 });
    expect(vertexCount(round)).toBeGreaterThan(vertexCount(sharp));
    const { lo, hi } = extent(round);
    for (let k = 0; k < 3; k++) { expect(hi[k]).toBeLessThanOrEqual([80, 50, 10][k] + 1e-4); expect(lo[k]).toBeGreaterThanOrEqual(-[80, 50, 10][k] - 1e-4); }
    // the rounding reaches the edges: the extent is still the size
    expect(extent(round).size.map((v) => Math.round(v))).toEqual([160, 100, 20]);
    for (let i = 0; i < vertexCount(round); i++) expect(lengthOf(round.normals, i)).toBeCloseTo(1, 4);
  });

  it('a radius larger than the solid allows is held to it, never turned inside out', () => {
    const m = mesh('box', { size: [40, 40, 10], radius: 500 });
    const { size } = extent(m);
    expect(size.map((v) => Math.round(v))).toEqual([40, 40, 10]);
  });

  it('every shape points its triangles outward (counter-clockwise from outside) and its indices at its vertices', () => {
    for (const shape of SHAPES) {
      const m = mesh(shape, { size: [90, 70, 50], radius: shape === 'box' || shape === 'slab' ? 6 : undefined, segments: 14 });
      expect(m.indices.length % 3, shape).toBe(0);
      expect(Math.max(...m.indices), shape).toBeLessThan(vertexCount(m));
      let faces = 0;
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
        const p = (i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
        const [pa, pb, pc] = [p(a), p(b), p(c)];
        const u = pb.map((v, k) => v - pa[k]), w = pc.map((v, k) => v - pa[k]);
        const cross = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        if (Math.hypot(...cross) < 1e-6) continue;
        const n = [0, 1, 2].map((k) => m.normals[a * 3 + k] + m.normals[b * 3 + k] + m.normals[c * 3 + k]);
        expect(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2], `${shape} triangle ${t / 3}`).toBeGreaterThan(0);
        faces++;
      }
      expect(faces, shape).toBeGreaterThan(10);
    }
  });

  it('a capsule and a cylinder fill their size, the cylinder with flat caps', () => {
    expect(extent(mesh('capsule', { size: [40, 120, 40], segments: 12 })).size.map((v) => Math.round(v))).toEqual([40, 120, 40]);
    const cyl = mesh('cylinder', { size: [40, 100, 40], segments: 12 });
    expect(extent(cyl).size.map((v) => Math.round(v))).toEqual([40, 100, 40]);
    // some vertices face straight up: the cap
    expect([...Array(vertexCount(cyl)).keys()].some((i) => cyl.normals[i * 3 + 1] > 0.999)).toBe(true);
  });

  it('is the same mesh every time it is made', () => {
    for (const shape of SHAPES) {
      const a = mesh(shape, { size: [60, 60, 60], segments: 10 }), b = mesh(shape, { size: [60, 60, 60], segments: 10 });
      expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
      expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    }
  });
});

describe('solid.3d', () => {
  const props = (extra: Record<string, unknown> = {}) => ({ ...Object.fromEntries(Object.entries(solid.props).map(([k, d]) => [k, d.default])), ...extra });

  it('its bounds are the height square', () => {
    expect(solid.bounds!(props({ height: 300 }) as never, {} as never)).toEqual({ x: -150, y: -150, w: 300, h: 300 });
    expect(solid.bounds!(props({ height: 2 }) as never, {} as never)).toEqual({ x: -4, y: -4, w: 8, h: 8 });
  });

  it('offers the materials and the shapes it draws, with a studio gradient when no environment is given', () => {
    expect(solid.props.material).toMatchObject({ type: 'enum', options: ['matte', 'glossy', 'glass', 'metal'] });
    expect(solid.props.shape).toMatchObject({ type: 'enum', options: ['box', 'slab', 'sphere', 'torus', 'capsule', 'cylinder'] });
    expect(solid.props.env).toMatchObject({ type: 'asset', assetType: 'image', nullable: true, default: null });
    expect(solid.props.envTop.type).toBe('color');
    expect(solid.props.envBottom.type).toBe('color');
  });
});
