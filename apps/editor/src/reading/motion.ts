// The camera's move in a shot of a reference, read from its pixels: which
// zoom or shift of the first look best explains the second. A search over the
// whole frame rather than block matching: motion design is mostly flat
// colour and edges, where blocks find nothing or slide along an edge. The
// frame's border must move too, so an element moving over a still ground is
// never taken for the camera. What the frames alone leave open for the model,
// measured.

import type { Move } from '@tramme/core';
import type { Pixels } from '../flow.ts';

type Field = { w: number; h: number; l: Float32Array };

/** the part of a picture inside a rectangle of its pixels */
export function crop(p: Pixels, x0: number, y0: number, w: number, h: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(p.data.subarray(((y0 + y) * p.width + x0) * 4, ((y0 + y) * p.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, data };
}

/** the luminance of a picture averaged over cells, a field `w` samples wide: a thin line stays (faint), the noise of compression and dithering averages out */
export function field(p: Pixels, w = 80): Field {
  w = Math.min(w, p.width);
  const h = Math.max(2, Math.round((p.height * w) / p.width)), l = new Float32Array(w * h), n = new Float32Array(w * h);
  for (let y = 0; y < p.height; y++) {
    const fy = Math.min(h - 1, Math.floor((y * h) / p.height));
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4, k = fy * w + Math.min(w - 1, Math.floor((x * w) / p.width));
      l[k] += 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
      n[k]++;
    }
  }
  for (let k = 0; k < l.length; k++) l[k] /= n[k] || 1;
  return { w, h, l };
}

/** a field's value between its samples (bilinear); null outside it */
function sample(f: Field, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x > f.w - 1 || y > f.h - 1) return null;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(f.w - 1, x0 + 1), y1 = Math.min(f.h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const v = (xx: number, yy: number) => f.l[yy * f.w + xx];
  return (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy;
}

/** how far b is from a seen through a zoom `s` about the centre and a shift (tx, ty): the mean difference, over all and over the border */
function misfit(a: Field, b: Field, s: number, tx: number, ty: number): { all: number; ring: number } {
  const cx = (a.w - 1) / 2, cy = (a.h - 1) / 2, rx = a.w * 0.18, ry = a.h * 0.18;
  let all = 0, n = 0, ring = 0, m = 0;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const v = sample(a, (x - cx - tx) / s + cx, (y - cy - ty) / s + cy);
    if (v === null) continue;
    const d = Math.abs(v - b.l[y * b.w + x]);
    all += d; n++;
    if (x < rx || x >= b.w - rx || y < ry || y >= b.h - ry) { ring += d; m++; }
  }
  return { all: n ? all / n : Infinity, ring: m ? ring / m : Infinity };
}

/** the share of the difference the best move must explain, over all and at the border */
const EXPLAINS = 0.5;
/** luma units the move must explain at the border at least: below, the border holds or is too plain to tell (noise is never explained by a move) */
const GAIN = 0.15;

/** the camera's move between two looks `dt` s apart, at a picture `width` px wide; null when it holds or when the frame cannot say */
export function cameraMove(a: Pixels, b: Pixels, dt: number, width: number): Pick<Move, 'kind' | 'direction' | 'speed'> | null {
  if (!(dt > 0) || a.width !== b.width || a.height !== b.height) return null;
  const fa = field(a), fb = field(b);
  const still = misfit(fa, fb, 1, 0, 0);
  let best = { s: 1, tx: 0, ty: 0, ...still };
  const consider = (s: number, tx: number, ty: number) => { const f = misfit(fa, fb, s, tx, ty); if (f.all < best.all) best = { s, tx, ty, ...f }; };
  for (let s = 0.8; s <= 1.25 + 1e-9; s += 0.01) if (Math.abs(s - 1) > 1e-9) consider(+s.toFixed(2), 0, 0);
  for (let ty = -10; ty <= 10; ty++) for (let tx = -10; tx <= 10; tx++) if (tx || ty) consider(1, tx, ty);
  // the move must explain the frame and its border: an element moving over a still ground leaves the border unexplained
  if (best.all > still.all * EXPLAINS || best.ring > still.ring * EXPLAINS || still.ring - best.ring < GAIN) return null;
  const k = width / fa.w;
  if (best.s !== 1) {
    const speed = Math.round((Math.abs(best.s - 1) * width) / 2 / dt);
    return best.s > 1 ? { kind: 'push-in', direction: 'in', speed } : { kind: 'pull-out', direction: 'out', speed };
  }
  // the pixels slide left when the camera pans right
  if (Math.abs(best.tx) >= Math.abs(best.ty)) return { kind: 'pan', direction: best.tx < 0 ? 'right' : 'left', speed: Math.round((Math.abs(best.tx) * k) / dt) };
  return { kind: 'tilt', direction: best.ty < 0 ? 'down' : 'up', speed: Math.round((Math.abs(best.ty) * k) / dt) };
}

/**
 * The camera's move in a shot from two pairs of looks: a wide pair, where a
 * slow zoom has grown enough to read, and a close pair, where a fast pan is
 * still within the search's reach. A zoom read on the wide pair wins.
 */
export function shotCamera(wide: [Pixels, Pixels, number] | null, close: [Pixels, Pixels, number] | null, width: number): Pick<Move, 'kind' | 'direction' | 'speed'> | null {
  const zoom = wide ? cameraMove(...wide, width) : null;
  if (zoom && (zoom.kind === 'push-in' || zoom.kind === 'pull-out')) return zoom;
  const pan = close ? cameraMove(...close, width) : null;
  return pan && pan.kind !== 'push-in' && pan.kind !== 'pull-out' ? pan : zoom;
}
