// A layer turned around its horizontal (X) or vertical (Y) axis, seen from the
// composition camera's perspective: where its box lands on screen (a quad),
// and the homography between two quads (a picture pinned on four corners).
// Pure functions: the render draws what they say, the checks read the same.

import type { EvaluatedLayer, EvaluatedTransform } from './evaluate.ts';
import { applyMat, layerMatrix, matMul, type Mat2D } from './math.ts';
import type { Rect } from './registry.ts';
import type { Vec2 } from './types.ts';

/** top left, top right, bottom right, bottom left */
export type Quad = [Vec2, Vec2, Vec2, Vec2];

/** the perspective distance, in px, of a composition without a camera */
export const DEFAULT_PERSPECTIVE = 1000;

/** whether a layer is turned: an angle above a hundredth of a degree */
export const isTilted = (t: { rotationX?: number; rotationY?: number }) => Math.abs(t.rotationX ?? 0) > 0.01 || Math.abs(t.rotationY ?? 0) > 0.01;

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Where a layer's local box lands: turned around its anchor by rotationX then
 * rotationY (positive: the bottom comes toward the viewer, the right side goes
 * away), projected at `perspective` px around the layer's own position, then
 * carried by its 2D scale, rotation and position and the parent's matrix.
 * Null when a corner sits at or behind the eye.
 */
export function tiltQuad(box: Rect, t: EvaluatedTransform, parent: Mat2D, perspective: number): Quad | null {
  const corners: Vec2[] = [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]];
  const out: Vec2[] = [];
  for (const p of corners) {
    const q = tiltPoint(p, t, parent, perspective);
    if (!q) return null;
    out.push(q);
  }
  return out as Quad;
}

/** where one point of a layer's local space lands (see tiltQuad); null at or behind the eye */
export function tiltPoint([px, py]: Vec2, t: EvaluatedTransform, parent: Mat2D, perspective: number): Vec2 | null {
  const cx = Math.cos(rad(t.rotationX ?? 0)), sx = Math.sin(rad(t.rotationX ?? 0));
  const cy = Math.cos(rad(t.rotationY ?? 0)), sy = Math.sin(rad(t.rotationY ?? 0));
  const x0 = px - t.anchor[0], y0 = py - t.anchor[1];
  // z is positive away from the viewer
  const y1 = y0 * cx, z1 = -y0 * sx;
  const x2 = x0 * cy - z1 * sy, z2 = x0 * sy + z1 * cy;
  const d = perspective + z2;
  if (d <= 1) return null;
  const k = perspective / d;
  // the 2D part, without the anchor (the turn already happened around it)
  return applyMat(matMul(parent, layerMatrix({ ...t, anchor: [0, 0] })), [x2 * k, y1 * k]);
}

/** the quad of a layer's box: the turned and projected one when it is tilted, else the box through the 2D matrix */
export function layerQuad(L: EvaluatedLayer, box: Rect, parent: Mat2D, perspective: number): Quad {
  if (isTilted(L.transform)) {
    const q = tiltQuad(box, L.transform, parent, perspective);
    if (q) return q;
  }
  const m = matMul(parent, layerMatrix(L.transform));
  return [applyMat(m, [box.x, box.y]), applyMat(m, [box.x + box.w, box.y]), applyMat(m, [box.x + box.w, box.y + box.h]), applyMat(m, [box.x, box.y + box.h])];
}

/** the smallest box holding a quad */
export function quadBounds(q: Quad): Rect {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * The projective map of one quad onto another: 9 numbers, row major, the last
 * one 1 (a point (x, y) goes to (h0 x + h1 y + h2, h3 x + h4 y + h5) over
 * h6 x + h7 y + h8). Throws on a degenerate quad (three corners on a line).
 */
export function homography(from: Quad, to: Quad): number[] {
  // eight equations, eight unknowns: each corner gives two
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-9) throw new Error('homography: degenerate quad (three corners on a line)');
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k];
    }
  }
  return [...a.map((row, i) => row[8] / row[i]), 1];
}

export function applyHomography(h: number[], [x, y]: Vec2): Vec2 {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** the inverse of a homography (its adjugate, scaled so the last number is 1) */
export function invertHomography(h: number[]): number[] {
  const [a, b, c, d, e, f, g, i, j] = h;
  const inv = [e * j - f * i, c * i - b * j, b * f - c * e, f * g - d * j, a * j - c * g, c * d - a * f, d * i - e * g, b * g - a * i, a * e - b * d];
  if (Math.abs(inv[8]) < 1e-12) throw new Error('homography: not invertible');
  return inv.map((v) => v / inv[8]);
}
