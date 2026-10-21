import { describe, expect, it } from 'vitest';
import { grown, hull, skinShape, type Vec2 } from '../src/index.ts';

const ring = (cx: number, cy: number, rx: number, ry: number, n = 24): Vec2[] => Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((2 * Math.PI * i) / n), cy + ry * Math.sin((2 * Math.PI * i) / n)] as Vec2);
const inside = (pts: Vec2[], [x, y]: Vec2) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };

describe('the skin of a face', () => {
  it('outlines points by their hull', () => {
    expect(hull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 0.5]])).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]]);
    expect(grown([[0, 0], [2, 0], [2, 2], [0, 2]], 2)).toEqual([[-1, -1], [3, -1], [3, 3], [-1, 3]]);
  });

  it('is the face less its eyes, brows and mouth, each a little wider', () => {
    const s = skinShape({ oval: ring(100, 100, 60, 80), eyes: [ring(75, 85, 10, 4), ring(125, 85, 10, 4)], brows: [ring(75, 70, 12, 2), ring(125, 70, 12, 2)], lips: ring(100, 140, 18, 6) });
    expect(s.holes).toHaveLength(5);
    // a cheek is skin; an eye's corner, a lip's edge, a brow's end are in their holes
    expect(inside(s.face, [70, 120])).toBe(true);
    expect(s.holes.some((h) => inside(h, [70, 120]))).toBe(false);
    expect(inside(s.holes[0], [85.5, 85])).toBe(true);
    expect(inside(s.holes[4], [118.5, 140])).toBe(true);
    expect(inside(s.holes[2], [87.5, 70])).toBe(true);
    // off the hair and the background: the outline a little inside the face's
    expect(inside(s.face, [100, 21])).toBe(false);
  });
});
