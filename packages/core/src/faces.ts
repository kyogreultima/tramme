// Faces (docs/editing-roadmap.md, step 12): the skin of a face as a shape,
// from its landmarks (the editor finds them with MediaPipe's Face
// Landmarker): the outline of the face, less the eyes, the brows and the
// mouth, each taken a little wider so they stay sharp. The faces tool draws
// it into a mask video; fx.smooth reads the mask.

import type { Vec2 } from './types.ts';

/** the convex outline of points, counter-clockwise (Andrew's monotone chain) */
export function hull(points: Vec2[]): Vec2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [], upper: Vec2[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** a shape scaled about its centre by k, and pushed out by `pad` (in its units) */
export function grown(points: Vec2[], k: number, pad = 0): Vec2[] {
  if (!points.length) return points;
  const cx = points.reduce((s, q) => s + q[0], 0) / points.length, cy = points.reduce((s, q) => s + q[1], 0) / points.length;
  return points.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
    return [cx + dx * k + (dx / d) * pad, cy + dy * k + (dy / d) * pad] as Vec2;
  });
}

/** a face's landmarks by part */
export interface FaceParts { oval: Vec2[]; eyes: Vec2[][]; brows: Vec2[][]; lips: Vec2[] }

/**
 * The skin of a face: its outline (a little inside it, off the hair and the
 * background), less its features, each widened by a share of the face's
 * size so the lashes, the brows' ends and the lips' edges stay out.
 */
export function skinShape(f: FaceParts): { face: Vec2[]; holes: Vec2[][] } {
  const face = hull(f.oval);
  const xs = face.map((q) => q[0]), size = Math.max(...xs) - Math.min(...xs);
  return {
    face: grown(face, 0.96),
    holes: [
      ...f.eyes.map((e) => grown(hull(e), 1.25, size * 0.025)),
      ...f.brows.map((b) => grown(hull(b), 1.15, size * 0.03)),
      grown(hull(f.lips), 1.1, size * 0.02),
    ],
  };
}
