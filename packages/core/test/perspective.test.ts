import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { Evaluator, applyHomography, homography, invertHomography, isTilted, layerMatrix, tiltQuad, validate, type EvaluatedTransform, type Layer, type Quad, type TrammeDoc } from '../src/index.ts';

const tr = (o: Partial<EvaluatedTransform> = {}): EvaluatedTransform => ({ anchor: [0, 0], position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1, depth: 0, rotationX: 0, rotationY: 0, ...o });
const IDENT: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
const box = { x: -100, y: -50, w: 200, h: 100 };
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('a layer turned around x and y', () => {
  it('is only tilted above a hundredth of a degree', () => {
    expect(isTilted({})).toBe(false);
    expect(isTilted({ rotationX: 0.005, rotationY: -0.005 })).toBe(false);
    expect(isTilted({ rotationY: -20 })).toBe(true);
  });

  it('gives the box through the 2D matrix when it is not turned', () => {
    const t = tr({ position: [300, 200], rotation: 30, scale: [1.5, 0.8], anchor: [10, 5] });
    const q = tiltQuad(box, t, IDENT, 1000)!;
    const m = layerMatrix(t);
    const corners: [number, number][] = [[-100, -50], [100, -50], [100, 50], [-100, 50]];
    corners.forEach((c, i) => {
      const want: [number, number] = [m[0] * c[0] + m[2] * c[1] + m[4], m[1] * c[0] + m[3] * c[1] + m[5]];
      expect(dist(q[i], want)).toBeLessThan(1e-9);
    });
  });

  it('foreshortens a turn around y: narrower, one edge taller than the other, the centre where it was', () => {
    const q = tiltQuad(box, tr({ position: [500, 400], rotationY: 60 }), IDENT, 1000)!;
    const width = Math.abs((q[1][0] + q[2][0]) / 2 - (q[0][0] + q[3][0]) / 2);
    // about half the 200 px box (cos 60 degrees), the near side a little larger than the far one
    expect(width).toBeGreaterThan(80);
    expect(width).toBeLessThan(110);
    const left = dist(q[0], q[3]), right = dist(q[1], q[2]);
    expect(Math.abs(left - right)).toBeGreaterThan(5);
    // right side away from the viewer: the smaller edge
    expect(right).toBeLessThan(left);
    const centre: [number, number] = [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
    expect(dist(centre, [500, 400])).toBeLessThan(20);
  });

  it('mirrors top and bottom at 180 degrees around x, and is edge on at 90 degrees around y', () => {
    const flip = tiltQuad(box, tr({ rotationX: 180 }), IDENT, 1000)!;
    expect(flip[0][1]).toBeGreaterThan(flip[3][1]);
    const edge = tiltQuad(box, tr({ rotationY: 90 }), IDENT, 1000)!;
    expect(Math.abs(edge[1][0] - edge[0][0])).toBeLessThan(1e-6);
    expect(edge.flat().every(Number.isFinite)).toBe(true);
  });

  it('is nothing when a corner falls behind the eye', () => {
    expect(tiltQuad({ x: -100, y: -400, w: 200, h: 800 }, tr({ rotationX: 80 }), IDENT, 50)).toBeNull();
  });
});

describe('the homography between two quads', () => {
  const unit: Quad = [[0, 0], [1, 0], [1, 1], [0, 1]];

  it('is the identity from a quad onto itself', () => {
    const h = homography(unit, unit);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(h[i]).toBeCloseTo(v, 9));
  });

  it('carries four corners onto four corners, and back', () => {
    const to: Quad = [[100, 100], [500, 120], [480, 400], [90, 380]];
    const h = homography(unit, to);
    unit.forEach((p, i) => expect(dist(applyHomography(h, p), to[i])).toBeLessThan(1e-6));
    const back = invertHomography(h);
    to.forEach((p, i) => expect(dist(applyHomography(back, p), unit[i])).toBeLessThan(1e-6));
  });

  it('refuses a quad with three corners on a line', () => {
    expect(() => homography([[0, 0], [1, 0], [2, 0], [0, 1]], unit)).toThrow(/degenerate/);
  });
});

describe('tilts in the document', () => {
  const doc = (transform: Record<string, unknown>): TrammeDoc => ({
    schema: 'tramme/1', meta: { title: 'Tilt' }, tokens: {}, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 1080, height: 1080, fps: 30, duration: 4, layers: { card: { type: 'shape.rect', transform, props: { size: [300, 200] } } as Layer }, order: ['card'] } },
  } as unknown as TrammeDoc);

  it('are valid, keyframed or not', () => {
    const d = doc({ position: [540, 540], rotationX: { $k: [{ t: 0, v: 0 }, { t: 2, v: 40 }] }, rotationY: 20 });
    expect(validate(d, builtinRegistry())).toEqual([]);
  });

  it('are 0 in a document written before them', () => {
    const f = new Evaluator(doc({ position: [540, 540] }), builtinRegistry()).frame(1, 'main');
    expect(f.layers[0].transform).toMatchObject({ rotationX: 0, rotationY: 0 });
  });

  it('are evaluated at their time', () => {
    const f = new Evaluator(doc({ rotationX: { $k: [{ t: 0, v: 0 }, { t: 2, v: 40 }] } }), builtinRegistry()).frame(1, 'main');
    expect(f.layers[0].transform.rotationX).toBeCloseTo(20, 5);
  });
});
