// Stabilisation (docs/editing-roadmap.md, step 7): the camera's shake read
// from the footage at authoring time and saved as a JSON asset timed like
// the file; the video node reads it and moves the picture back. Pure
// functions: the move between two grey frames (points of detail matched
// block by block, then the similarity that best carries them, the outliers
// set aside), the camera's path over a shot, smoothed or locked, the
// correction per frame, and the zoom that keeps the edges out of the frame
// for the whole clip.

import type { GrayFrame } from './track.ts';

/** how the picture moved from one frame to the next, about its centre: p' = s·R(a)·p + (dx, dy), in pixels of the frames read */
export interface Motion { dx: number; dy: number; a: number; s: number }

/** a frame's correction, about the picture's centre: x, y in fractions of its width and height, a in radians, s a factor */
export interface Correction { x: number; y: number; a: number; s: number }

export interface Stabilization {
  version: 1;
  kind: 'stabilize';
  /** the video asset it was read from */
  source?: string;
  width: number;
  height: number;
  /** the zoom that keeps the edges out of the frame over the whole clip */
  zoom: number;
  /** the correction at each look, in the file's time */
  frames: ({ t: number } & Correction)[];
}

export const isStabilization = (x: unknown): x is Stabilization =>
  !!x && typeof x === 'object' && (x as Stabilization).kind === 'stabilize' && Array.isArray((x as Stabilization).frames);

const NONE: Correction = { x: 0, y: 0, a: 0, s: 1 };
const PATCH = 4, SEARCH = 12;

/** the patches with the most detail, a few per cell of a grid: the points to follow */
function pointsOf(f: GrayFrame, cols = 8, rows = 6): [number, number][] {
  const out: [number, number][] = [], m = PATCH + SEARCH + 1;
  const cw = (f.width - 2 * m) / cols, ch = (f.height - 2 * m) / rows;
  if (cw < 2 || ch < 2) return out;
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let best = -1, bx = 0, by = 0;
      for (let y = Math.floor(m + gy * ch); y < m + (gy + 1) * ch; y += 2) {
        for (let x = Math.floor(m + gx * cw); x < m + (gx + 1) * cw; x += 2) {
          const i = y * f.width + x, gxv = f.data[i + 1] - f.data[i - 1], gyv = f.data[i + f.width] - f.data[i - f.width];
          // corners rather than edges: the weaker of the two gradients
          const e = Math.min(Math.abs(gxv), Math.abs(gyv));
          if (e > best) { best = e; bx = x; by = y; }
        }
      }
      if (best > 0.02) out.push([bx, by]);
    }
  }
  return out;
}

/**
 * where the patch at (x, y) of a went in b: the offset of the least
 * difference within SEARCH pixels, refined below the pixel by a parabola
 * through its neighbours; null when another place, more than a pixel away,
 * fits nearly as well (a flat or repeated patch)
 */
function matchPatch(a: GrayFrame, b: GrayFrame, x: number, y: number): [number, number] | null {
  const span = 2 * SEARCH + 1, sad = new Float32Array(span * span);
  let best = Infinity, bx = 0, by = 0;
  for (let oy = -SEARCH; oy <= SEARCH; oy++) {
    for (let ox = -SEARCH; ox <= SEARCH; ox++) {
      let d = 0;
      for (let py = -PATCH; py <= PATCH; py++) {
        const ra = (y + py) * a.width, rb = (y + py + oy) * b.width;
        for (let px = -PATCH; px <= PATCH; px++) d += Math.abs(a.data[ra + x + px] - b.data[rb + x + px + ox]);
      }
      sad[(oy + SEARCH) * span + ox + SEARCH] = d;
      if (d < best) { best = d; bx = ox; by = oy; }
    }
  }
  let second = Infinity;
  for (let oy = -SEARCH; oy <= SEARCH; oy++) for (let ox = -SEARCH; ox <= SEARCH; ox++) {
    if (Math.abs(ox - bx) <= 1 && Math.abs(oy - by) <= 1) continue;
    second = Math.min(second, sad[(oy + SEARCH) * span + ox + SEARCH]);
  }
  if (best > 0 && best >= second * 0.8) return null;
  const at = (ox: number, oy: number) => sad[(oy + SEARCH) * span + ox + SEARCH];
  const sub = (l: number, c: number, r: number) => { const den = l - 2 * c + r; return den > 1e-9 ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * den))) : 0; };
  const fx = Math.abs(bx) < SEARCH ? sub(at(bx - 1, by), best, at(bx + 1, by)) : 0;
  const fy = Math.abs(by) < SEARCH ? sub(at(bx, by - 1), best, at(bx, by + 1)) : 0;
  return [bx + fx, by + fy];
}

/** the similarity (about the frames' centre) that best carries the points p to q, by least squares */
function similarity(p: [number, number][], q: [number, number][], cx: number, cy: number): Motion {
  const n = p.length;
  let pxm = 0, pym = 0, qxm = 0, qym = 0;
  for (let i = 0; i < n; i++) { pxm += p[i][0] - cx; pym += p[i][1] - cy; qxm += q[i][0] - cx; qym += q[i][1] - cy; }
  pxm /= n; pym /= n; qxm /= n; qym /= n;
  let dot = 0, cross = 0, norm = 0;
  for (let i = 0; i < n; i++) {
    const ux = p[i][0] - cx - pxm, uy = p[i][1] - cy - pym, vx = q[i][0] - cx - qxm, vy = q[i][1] - cy - qym;
    dot += ux * vx + uy * vy; cross += ux * vy - uy * vx; norm += ux * ux + uy * uy;
  }
  const c = norm > 0 ? dot / norm : 1, s = norm > 0 ? cross / norm : 0;
  const scale = Math.hypot(c, s) || 1, a = Math.atan2(s, c);
  return { dx: qxm - (c * pxm - s * pym), dy: qym - (s * pxm + c * pym), a, s: scale };
}

/** how the picture moved from frame a to frame b (the same size): points of detail matched, the best similarity, the outliers set aside */
export function frameMotion(a: GrayFrame, b: GrayFrame): Motion {
  const from: [number, number][] = [], to: [number, number][] = [];
  for (const [x, y] of pointsOf(a)) {
    const m = matchPatch(a, b, x, y);
    if (m) { from.push([x, y]); to.push([x + m[0], y + m[1]]); }
  }
  if (from.length < 3) return { dx: 0, dy: 0, a: 0, s: 1 };
  const cx = a.width / 2, cy = a.height / 2;
  let m = similarity(from, to, cx, cy);
  // once more without the points that moved otherwise (something passing in front of the camera)
  const err = from.map(([x, y], i) => {
    const ux = x - cx, uy = y - cy, c = m.s * Math.cos(m.a), s = m.s * Math.sin(m.a);
    return Math.hypot(c * ux - s * uy + m.dx + cx - to[i][0], s * ux + c * uy + m.dy + cy - to[i][1]);
  });
  const limit = Math.max(1, [...err].sort((x, y) => x - y)[Math.floor(err.length * 0.7)]);
  const keep = err.map((e) => e <= limit);
  if (keep.filter(Boolean).length >= 3) m = similarity(from.filter((_, i) => keep[i]), to.filter((_, i) => keep[i]), cx, cy);
  return m;
}

/**
 * The corrections of a run of frames: the camera's path (the moves added up
 * from the start, and from each cut again), then smoothed by a Gaussian of
 * `smooth` frames (null: locked, held where each shot starts), and the
 * correction that takes each frame from its path to the smooth one. The
 * moves are in pixels of frames `width` × `height`; the corrections in
 * fractions of them.
 */
export function corrections(moves: Motion[], width: number, height: number, smooth: number | null, cuts: boolean[] = []): Correction[] {
  const n = moves.length + 1, path: { x: number; y: number; a: number; s: number }[] = [{ x: 0, y: 0, a: 0, s: 0 }];
  const shot: number[] = [0];
  for (let i = 0; i < moves.length; i++) {
    const cut = !!cuts[i + 1], prev = path[i], m = moves[i];
    path.push(cut ? { x: 0, y: 0, a: 0, s: 0 } : { x: prev.x + m.dx, y: prev.y + m.dy, a: prev.a + m.a, s: prev.s + Math.log(m.s || 1) });
    shot.push(cut ? shot[i] + 1 : shot[i]);
  }
  const out: Correction[] = [];
  for (let i = 0; i < n; i++) {
    let target = path[i];
    if (smooth === null) {
      let j = i;
      while (j > 0 && shot[j - 1] === shot[i]) j--;
      target = path[j];
    } else if (smooth > 0) {
      const r = Math.ceil(smooth * 3), acc = { x: 0, y: 0, a: 0, s: 0 };
      let wsum = 0;
      for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) {
        if (shot[j] !== shot[i]) continue;
        const w = Math.exp(-((j - i) ** 2) / (2 * smooth * smooth));
        acc.x += w * path[j].x; acc.y += w * path[j].y; acc.a += w * path[j].a; acc.s += w * path[j].s; wsum += w;
      }
      target = { x: acc.x / wsum, y: acc.y / wsum, a: acc.a / wsum, s: acc.s / wsum };
    }
    const p = path[i];
    out.push({ x: (target.x - p.x) / width, y: (target.y - p.y) / height, a: target.a - p.a, s: Math.exp(target.s - p.s) });
  }
  return out;
}

/** the least zoom (at most `max`) for which every corrected picture still covers the frame */
export function coverZoom(list: Correction[], width: number, height: number, max = 1.5): number {
  const covers = (c: Correction, z: number) => {
    // each corner of the frame, taken back into the picture through the zoom and the correction, must fall inside it
    for (const [fx, fy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      let x = (fx * width) / z - c.x * width, y = (fy * height) / z - c.y * height;
      const cos = Math.cos(-c.a), sin = Math.sin(-c.a);
      [x, y] = [(cos * x - sin * y) / c.s, (sin * x + cos * y) / c.s];
      if (Math.abs(x) > width / 2 + 1e-9 || Math.abs(y) > height / 2 + 1e-9) return false;
    }
    return true;
  };
  let zoom = 1;
  for (const c of list) {
    if (covers(c, zoom)) continue;
    let lo = zoom, hi = max;
    if (!covers(c, hi)) return max;
    for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (covers(c, mid)) hi = mid; else lo = mid; }
    zoom = hi;
  }
  return Math.round(zoom * 1e4) / 1e4;
}

/** the correction at file time t: between the two looks around it; none outside them */
export function correctionAt(s: Stabilization, t: number): Correction {
  const f = s.frames;
  if (!f.length || t < f[0].t - 1e-6 || t > f[f.length - 1].t + 1e-6) return NONE;
  let i = 0;
  while (i < f.length - 2 && f[i + 1].t <= t) i++;
  const a = f[i], b = f[Math.min(i + 1, f.length - 1)], k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: a.a + (b.a - a.a) * k, s: a.s + (b.s - a.s) * k };
}
