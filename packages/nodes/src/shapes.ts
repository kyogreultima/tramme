// Vector shapes. Rectangles and ellipses are centred on the layer origin, so
// scale and rotation act around their centre with the default anchor. Their
// trim (start, end, offset, fractions of the outline's length) draws the
// stroke by a window of the path — a stroke that draws itself, chases itself
// around the shape; the fill stays whole.

import type { NodeType, Paint, PathValue, PropSchema, Vec2 } from '@tramme/core';
import { isTrimmed, pathLength } from '@tramme/core';
import type { TrimProps } from '@tramme/core';
import { fillStroke, toPath2D } from './paint.ts';

const PAINT: PropSchema = {
  fill: { type: 'paint', default: '#FFFFFF', label: 'Fill', group: 'Appearance', nullable: true },
  stroke: { type: 'paint', default: null, label: 'Stroke', group: 'Appearance', nullable: true },
  strokeWidth: { type: 'number', default: 2, label: 'Thickness', group: 'Appearance', min: 0, unit: 'px' },
};
interface PaintProps { fill: Paint; stroke: Paint; strokeWidth: number }

const TRIM: PropSchema = {
  trimStart: { type: 'number', default: 0, min: 0, max: 1, step: 0.01, label: 'Trim start', group: 'Trim', description: "the stroke drawn from this fraction of the outline's length; draw it on by animating this from 0, or the end from 0" },
  trimEnd: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, label: 'Trim end', group: 'Trim', description: 'the stroke drawn up to this fraction; under the start, the two swap (as in Lottie)' },
  trimOffset: { type: 'number', default: 0, min: 0, max: 1, step: 0.01, label: 'Trim offset', group: 'Trim', description: 'shifts the window along the outline; keyframed, a run chases itself around the shape' },
};


interface RectProps extends PaintProps, TrimProps { size: Vec2; radius: number }
export const rect: NodeType<RectProps> = {
  type: 'shape.rect', title: 'Rectangle', category: 'Shapes',
  props: {
    size: { type: 'vec2', default: [200, 200], label: 'Size', unit: 'px' },
    radius: { type: 'number', default: 0, label: 'Corner radius', min: 0, unit: 'px' },
    ...PAINT,
    ...TRIM,
  },
  // the outline starts where Lottie's rectangle does (the right side, under the top right corner) and runs
  // clockwise, so a trim draws the same stretch in the preview and in the exports
  path({ size: [w, h], radius }) {
    const p = new Path2D();
    const aw = Math.abs(w), ah = Math.abs(h); // centred: a negative size draws the same box
    const r = Math.max(0, Math.min(radius, aw / 2, ah / 2));
    const x0 = -aw / 2, x1 = aw / 2, y0 = -ah / 2, y1 = ah / 2;
    p.moveTo(x1, y0 + r);
    p.lineTo(x1, y1 - r);
    if (r > 0) p.arc(x1 - r, y1 - r, r, 0, Math.PI / 2);
    p.lineTo(x0 + r, y1);
    if (r > 0) p.arc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI);
    p.lineTo(x0, y0 + r);
    if (r > 0) p.arc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5);
    p.lineTo(x1 - r, y0);
    if (r > 0) p.arc(x1 - r, y0 + r, r, Math.PI * 1.5, Math.PI * 2);
    p.closePath();
    return p;
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  // the corner radius, dragged along the top edge from the corner
  handles: ({ size: [w, h], radius }) => [{ prop: 'radius', kind: 'distance', at: [w / 2 - Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2), -h / 2], from: [w / 2, -h / 2] }],
  render: { canvas2d(ctx, p, host) { fillStroke(ctx, rect.path!(p, host)!, p, trimStrokeOf(p, () => rectLength(p))); } },
};

/** the outline's length of a rounded rectangle, exactly */
function rectLength({ size: [w, h], radius }: RectProps): number {
  const r = Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2);
  if (!(r > 0)) return 2 * (Math.abs(w) + Math.abs(h));
  return 2 * (Math.abs(w) - 2 * r) + 2 * (Math.abs(h) - 2 * r) + 2 * Math.PI * r;
}

interface EllipseProps extends PaintProps, TrimProps { size: Vec2 }
export const ellipse: NodeType<EllipseProps> = {
  type: 'shape.ellipse', title: 'Ellipse', category: 'Shapes',
  props: {
    size: { type: 'vec2', default: [200, 200], label: 'Size', unit: 'px' },
    ...PAINT,
    ...TRIM,
  },
  path({ size: [w, h] }) {
    // from the top, clockwise, as Lottie's ellipse: a trim draws the same stretch in the preview and the exports
    const p = new Path2D();
    p.ellipse(0, 0, Math.abs(w) / 2, Math.abs(h) / 2, 0, -Math.PI / 2, Math.PI * 1.5);
    p.closePath();
    return p;
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  render: { canvas2d(ctx, p, host) { fillStroke(ctx, ellipse.path!(p, host)!, p, trimStrokeOf(p, () => ellipseLength(p))); } },
};

/** the outline's length of an ellipse, by Ramanujan's approximation */
function ellipseLength({ size: [w, h] }: EllipseProps): number {
  const a = Math.abs(w) / 2, b = Math.abs(h) / 2;
  if (!(a > 0 && b > 0)) return 0;
  const q = (a - b) / (a + b);
  return Math.PI * (a + b) * (1 + (3 * q * q) / (10 + Math.sqrt(4 - 3 * q * q)));
}

interface PathProps extends PaintProps, TrimProps { path: PathValue; lineCap: CanvasLineCap; lineJoin: CanvasLineJoin }
export const path: NodeType<PathProps> = {
  type: 'shape.path', title: 'Path', category: 'Shapes',
  props: {
    path: { type: 'path', default: { v: [[-100, -100], [100, -100], [100, 100], [-100, 100]], closed: true }, label: 'Path' },
    ...PAINT,
    lineCap: { type: 'enum', default: 'butt', options: ['butt', 'round', 'square'], label: 'Caps', group: 'Appearance' },
    lineJoin: { type: 'enum', default: 'miter', options: ['miter', 'round', 'bevel'], label: 'Joins', group: 'Appearance' },
    ...TRIM,
  },
  path: (p) => toPath2D(p.path),
  bounds({ path: { v } }) {
    if (!v.length) return null;
    const xs = v.map((q) => q[0]), ys = v.map((q) => q[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  },
  render: {
    canvas2d(ctx, p) {
      ctx.lineCap = p.lineCap; ctx.lineJoin = p.lineJoin;
      fillStroke(ctx, toPath2D(p.path), p, trimStrokeOf(p, () => pathLength(p.path)));
    },
  },
};

/** the trim handed to fillStroke when the shape is trimmed (its length measured only then), undefined when the whole stroke shows */
function trimStrokeOf(p: TrimProps, total: () => number): (TrimProps & { total: number }) | undefined {
  return isTrimmed(p) ? { trimStart: p.trimStart, trimEnd: p.trimEnd, trimOffset: p.trimOffset, total: total() } : undefined;
}
