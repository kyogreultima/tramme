// Editing a path by hand: a moved vertex carries its tangents, a tangent
// moves alone or mirrored, a vertex splits or leaves. And the anchor's
// compensation: the layer stays put on screen.

import { describe, expect, it } from 'vitest';
import { anchorShift, insertPathVertex, layerMatrix, movePathVertex, nearestOnPath, pathLength, removePathVertex, setPathTangent, subdividePath, applyMat, type PathValue } from '../src/index.ts';

it('subdivides a square without changing its outline', () => {
  const square: PathValue = { v: [[0, 0], [100, 0], [100, 100], [0, 100]], closed: true };
  const out = subdividePath(square, 4);
  expect(out.v).toHaveLength(16);
  expect(pathLength(out)).toBeCloseTo(400, 0);
});

const square: PathValue = {
  v: [[-100, -100], [100, -100], [100, 100], [-100, 100]],
  i: [[-40, 0], [0, -40], [40, 0], [0, 40]],
  o: [[0, 40], [-40, 0], [0, -40], [40, 0]],
  closed: true,
};

describe('path vertices', () => {
  it('moves one vertex, tangents following', () => {
    const p = movePathVertex(square, 1, [10, -5]);
    expect(p.v[1]).toEqual([110, -105]);
    expect(p.v[0]).toEqual([-100, -100]);
    expect(p.o![1]).toEqual([-40, 0]); // relative to its vertex: unchanged
    expect(square.v[1]).toEqual([100, -100]); // no mutation
  });

  it('sets a tangent, alone or mirrored', () => {
    const p = setPathTangent(square, 2, 'o', [30, 10]);
    expect(p.o![2]).toEqual([30, 10]);
    expect(p.i![2]).toEqual([40, 0]); // the other tangent untouched
    const m = setPathTangent(square, 2, 'o', [30, 10], true);
    expect(m.o![2]).toEqual([30, 10]);
    expect(m.i![2]).toEqual([-30, -10]); // mirrored, same length
  });

  it('removes a vertex and its tangents', () => {
    const p = removePathVertex(square, 1);
    expect(p.v.length).toBe(3);
    expect(p.i!.length).toBe(3);
    expect(p.o![0]).toEqual([0, 40]);
    expect(removePathVertex({ v: [[1, 2]] }, 0).v).toEqual([]);
  });

  it('finds where a click lands on the path', () => {
    const straight: PathValue = { v: [[0, 0], [100, 0]] as [number, number][], closed: false };
    expect(nearestOnPath(straight, [50, 3] as [number, number])).toEqual({ seg: 0, u: 0.5 });
    expect(nearestOnPath(straight, [150, 0] as [number, number])).toEqual({ seg: 0, u: 1 });
    expect(nearestOnPath({ v: [[0, 0]] }, [0, 0] as [number, number])).toBeNull();
  });

  it('splits a segment, the halves keeping the ends of the neighbours', () => {
    const straight: PathValue = { v: [[0, 0], [100, 0], [100, 100]], closed: false };
    const p = insertPathVertex(straight, 0, 0.5);
    expect(p.v.length).toBe(4);
    expect(p.v[1]).toEqual([50, 0]);
    // the first segment now ends at the new vertex, the second starts from it
    expect(p.v[0]).toEqual([0, 0]);
    expect(p.v[2]).toEqual([100, 0]);
    // without tangents, none appear
    expect(p.i).toBeUndefined();
    expect(p.o).toBeUndefined();
  });

  it('splits a segment with tangents, each side keeping its curve', () => {
    const p = insertPathVertex(square, 0, 0.5);
    expect(p.v.length).toBe(5);
    expect(p.o!.length).toBe(5);
    expect(p.i!.length).toBe(5);
    // the out tangent of vertex 0 is shortened to where the split starts
    const o0 = p.o![0];
    expect(Math.hypot(o0[0], o0[1])).toBeLessThan(Math.hypot(square.o![0][0], square.o![0][1]));
    // the far end (vertex 1, now at index 2) keeps an in tangent cut back too
    const i2 = p.i![2];
    expect(Math.hypot(i2[0], i2[1])).toBeLessThan(Math.hypot(square.i![1][0], square.i![1][1]));
    // the new vertex carries both its tangents
    expect(p.i![1]).toBeDefined();
    expect(p.o![1]).toBeDefined();
  });
});

describe('anchor compensation', () => {
  const tr = { anchor: [30, 20] as [number, number], position: [200, 150] as [number, number], scale: [1.5, 0.8] as [number, number], rotation: 30 };

  it('keeps a point of the layer at the same place on screen', () => {
    const d = [10, -6] as [number, number];
    const moved = { ...tr, anchor: [tr.anchor[0] + d[0], tr.anchor[1] + d[1]] as [number, number], position: [tr.position[0] + anchorShift(tr.rotation, tr.scale, d)[0], tr.position[1] + anchorShift(tr.rotation, tr.scale, d)[1]] as [number, number] };
    for (const q of [[0, 0], [50, -20], [110, 7]]) {
      const before = applyMat(layerMatrix(tr), q as [number, number]);
      const after = applyMat(layerMatrix(moved), q as [number, number]);
      expect(after[0]).toBeCloseTo(before[0], 6);
      expect(after[1]).toBeCloseTo(before[1], 6);
    }
  });
});
