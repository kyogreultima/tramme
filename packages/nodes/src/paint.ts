// Fills and strokes for Canvas2D: a colour string or a gradient in the
// layer's local space (pixels), and Lottie-style paths.

import type { Paint, PathValue } from '@tramme/core';
import { pathD, trimRuns } from '@tramme/core';
import type { TrimProps } from '@tramme/core';

export function canvasPaint(ctx: CanvasRenderingContext2D, paint: Paint): string | CanvasGradient | null {
  if (paint === null || paint === undefined) return null;
  if (typeof paint === 'string') return paint;
  const g = paint.type === 'linear'
    ? ctx.createLinearGradient(paint.from[0], paint.from[1], paint.to[0], paint.to[1])
    : ctx.createRadialGradient(paint.center[0], paint.center[1], 0, paint.center[0], paint.center[1], paint.radius);
  for (const [offset, color] of paint.stops) g.addColorStop(Math.min(1, Math.max(0, offset)), color);
  return g;
}

/** a rounded rectangle as the current path, its radius kept within its size */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
}

/** fill then stroke a path with the node's paint props; a trim draws only the window's part of the stroke */
export function fillStroke(ctx: CanvasRenderingContext2D, path: Path2D, p: { fill: Paint; stroke: Paint; strokeWidth: number }, trim?: TrimProps & { total: number }) {
  const fill = canvasPaint(ctx, p.fill);
  if (fill) { ctx.fillStyle = fill; ctx.fill(path); }
  const stroke = canvasPaint(ctx, p.stroke);
  if (stroke && p.strokeWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = p.strokeWidth;
    if (trim && strokeTrimmed(ctx, path, trim)) return; // stroked inside, the dash set and reset there
    ctx.stroke(path);
  }
}

// ── trim: the stroke that draws itself ───────────────────────
// (isTrimmed and trimRuns live in @tramme/core, shared with the SVG export)

/** stroke only the trimmed window: a dash over the whole length, offset to it. Returns false when nothing is trimmed (a plain stroke, left to the caller). */
export function strokeTrimmed(ctx: CanvasRenderingContext2D, path: Path2D, t: TrimProps & { total: number }): boolean {
  const runs = trimRuns(t);
  if (!runs) return false;
  const L = t.total;
  if (!runs.length || !(L > 0)) return true; // nothing shows (or the path has no length to show)
  const prevDash = ctx.getLineDash(), prevOffset = ctx.lineDashOffset;
  // L is measured on the flattened path, a little shorter than the curve the canvas strokes: the pattern
  // never starts again before the true end (a long last gap), and a run that reaches the end runs past it
  if (runs.length === 1) {
    const [a, b] = runs[0];
    ctx.setLineDash([(b - a) * L + (b >= 1 ? L : 0), 3 * L]);
    ctx.lineDashOffset = -a * L;
  } else {
    const [a] = runs[0], [, b] = runs[1];
    // on over the head, a gap, on over the tail to the end and past it
    ctx.setLineDash([b * L, (a - b) * L, (2 - a) * L, 3 * L]);
    ctx.lineDashOffset = 0;
  }
  ctx.stroke(path);
  ctx.setLineDash(prevDash);
  ctx.lineDashOffset = prevOffset;
  return true;
}

/** Path2D of a path value, from its SVG form (pathD of @tramme/core) */
export function toPath2D(pv: PathValue): Path2D {
  return new Path2D(pathD(pv));
}
