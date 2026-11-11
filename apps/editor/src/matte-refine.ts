// From a network's matte to a clean edge. A matte network sees the picture
// small (320 to 1024 px square) and answers with soft, slightly displaced
// edges; the colours of those edge pixels are still the old background's, so
// on another ground the cut shows its outline. The steps here, pure
// functions on planes of numbers (no canvas), make the edge exact:
//   1. snap it to the picture's own edges (a guided filter, colour guide);
//   2. make the transition one or two pixels wide (a contrast curve);
//   3. take it in by a pixel, where the old ground still bleeds (choke);
//   4. drop specks and fill pinholes (connected components);
//   5. give the edge pixels the colour of the subject next to them, not of
//      the old ground (foreground estimation), so no fringe shows.
// All of it is O(pixels) and keeps the memory of a large picture bounded by
// working small where the result is smooth (the filter's coefficients, the
// propagated colours) and full-size only where the edge is.

/** the sliding mean of a plane over a (2r+1)² window, the window cut at the edges */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return Float32Array.from(src);
  const mid = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let sum = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) sum += src[o + x];
    for (let x = 0; x < w; x++) {
      mid[o + x] = sum / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
      if (x + r + 1 < w) sum += src[o + x + r + 1];
      if (x - r >= 0) sum -= src[o + x - r];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) sum += mid[y * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1);
      if (y + r + 1 < h) sum += mid[(y + r + 1) * w + x];
      if (y - r >= 0) sum -= mid[(y - r) * w + x];
    }
  }
  return out;
}

/** a plane reduced by a whole factor, each pixel the mean of its block */
export function shrink(src: Float32Array, w: number, h: number, s: number): { data: Float32Array; w: number; h: number } {
  if (s <= 1) return { data: src, w, h };
  const lw = Math.ceil(w / s), lh = Math.ceil(h / s), out = new Float32Array(lw * lh);
  for (let ly = 0; ly < lh; ly++) for (let lx = 0; lx < lw; lx++) {
    let sum = 0, n = 0;
    for (let y = ly * s; y < Math.min(h, ly * s + s); y++) for (let x = lx * s; x < Math.min(w, lx * s + s); x++) { sum += src[y * w + x]; n++; }
    out[ly * lw + lx] = sum / n;
  }
  return { data: out, w: lw, h: lh };
}

/** where a full-size pixel falls in a reduced plane: the two neighbours and the weight of the second, per column or row */
function taps(n: number, ln: number, s: number): { a: Int32Array; b: Int32Array; t: Float32Array } {
  const a = new Int32Array(n), b = new Int32Array(n), t = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = Math.min(ln - 1, Math.max(0, (i + 0.5) / s - 0.5)), i0 = Math.floor(f);
    a[i] = i0; b[i] = Math.min(ln - 1, i0 + 1); t[i] = f - i0;
  }
  return { a, b, t };
}

/** the planes of a picture's channels in 0..1 */
function channels(rgba: Uint8ClampedArray, n: number): Float32Array[] {
  const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) { out[0][i] = rgba[i * 4] / 255; out[1][i] = rgba[i * 4 + 1] / 255; out[2][i] = rgba[i * 4 + 2] / 255; }
  return out;
}

/** the factor that brings the longer side to about 1024: what the smooth steps work at */
export const workFactor = (w: number, h: number) => Math.max(1, Math.ceil(Math.max(w, h) / 1024));

/**
 * The guided filter of He et al. with a colour guide, in its fast form: the
 * coefficients that say "this matte is a linear function of the picture's
 * colours, locally" are found on a reduced picture and applied at full size.
 * Where the picture has an edge the matte follows it; where it is flat the
 * network's matte is kept as it is (a filter there would only blur it). `radius` is the window's, in pixels of the full picture.
 */
export function guidedFilter(rgba: Uint8ClampedArray, p: Float32Array, w: number, h: number, radius: number, eps: number): Float32Array {
  const s = workFactor(w, h), I = channels(rgba, w * h);
  const lo = I.map((c) => shrink(c, w, h, s)), lw = lo[0].w, lh = lo[0].h, ln = lw * lh, pl = shrink(p, w, h, s).data;
  const r = Math.max(1, Math.round(radius / s));
  const mean = (x: Float32Array) => boxBlur(x, lw, lh, r);
  const prod = (x: Float32Array, y: Float32Array) => { const o = new Float32Array(ln); for (let i = 0; i < ln; i++) o[i] = x[i] * y[i]; return o; };
  const [R, G, B] = lo.map((c) => c.data);
  const mR = mean(R), mG = mean(G), mB = mean(B), mp = mean(pl);
  const cR = mean(prod(R, pl)), cG = mean(prod(G, pl)), cB = mean(prod(B, pl));
  const vRR = mean(prod(R, R)), vRG = mean(prod(R, G)), vRB = mean(prod(R, B)), vGG = mean(prod(G, G)), vGB = mean(prod(G, B)), vBB = mean(prod(B, B));
  const aR = new Float32Array(ln), aG = new Float32Array(ln), aB = new Float32Array(ln), b0 = new Float32Array(ln), trust = new Float32Array(ln);
  for (let i = 0; i < ln; i++) {
    const s00 = vRR[i] - mR[i] * mR[i] + eps, s01 = vRG[i] - mR[i] * mG[i], s02 = vRB[i] - mR[i] * mB[i];
    const s11 = vGG[i] - mG[i] * mG[i] + eps, s12 = vGB[i] - mG[i] * mB[i], s22 = vBB[i] - mB[i] * mB[i] + eps;
    const gR = cR[i] - mR[i] * mp[i], gG = cG[i] - mG[i] * mp[i], gB = cB[i] - mB[i] * mp[i];
    const c00 = s11 * s22 - s12 * s12, c01 = s02 * s12 - s01 * s22, c02 = s01 * s12 - s02 * s11;
    const c11 = s00 * s22 - s02 * s02, c12 = s01 * s02 - s00 * s12, c22 = s00 * s11 - s01 * s01;
    // how much the picture has to say here: its colour variance in the window (a flat ground says nothing, an edge says a lot)
    trust[i] = Math.min(1, Math.max(0, ((s00 + s11 + s22 - 3 * eps) / 3 - 2e-4) / 2e-3));
    const det = s00 * c00 + s01 * c01 + s02 * c02 || 1e-12;
    aR[i] = (c00 * gR + c01 * gG + c02 * gB) / det;
    aG[i] = (c01 * gR + c11 * gG + c12 * gB) / det;
    aB[i] = (c02 * gR + c12 * gG + c22 * gB) / det;
    b0[i] = mp[i] - aR[i] * mR[i] - aG[i] * mG[i] - aB[i] * mB[i];
  }
  const kR = mean(aR), kG = mean(aG), kB = mean(aB), kb = mean(b0), kt = mean(trust);
  const col = taps(w, lw, s), row = taps(h, lh, s), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = row.a[y] * lw, yb = row.b[y] * lw, ty = row.t[y];
    for (let x = 0; x < w; x++) {
      const xa = col.a[x], xb = col.b[x], tx = col.t[x];
      const at = (m: Float32Array) => (m[ya + xa] * (1 - tx) + m[ya + xb] * tx) * (1 - ty) + (m[yb + xa] * (1 - tx) + m[yb + xb] * tx) * ty;
      // where the picture is flat the filter would only blur the matte: there the network's own is kept
      const i = y * w + x, g = Math.min(1, Math.max(0, at(kR) * I[0][i] + at(kG) * I[1][i] + at(kB) * I[2][i] + at(kb))), c = at(kt);
      out[i] = p[i] + (g - p[i]) * c;
    }
  }
  return out;
}

/** the transition made narrow: a smooth step over `width` either side of one half, in place */
export function sharpen(a: Float32Array, width: number): Float32Array {
  const lo = 0.5 - width, span = 2 * width;
  for (let i = 0; i < a.length; i++) { const t = Math.min(1, Math.max(0, (a[i] - lo) / span)); a[i] = t * t * (3 - 2 * t); }
  return a;
}

/** the matte taken in by `r` pixels (the darkest of the neighbours), then softened by a pixel so the edge stays smooth */
export function choke(a: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return a;
  const mid = new Float32Array(a.length), out = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 1;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.min(m, a[y * w + k]);
    mid[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 1;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.min(m, mid[k * w + x]);
    out[y * w + x] = m;
  }
  return boxBlur(out, w, h, 1);
}

/** the connected regions of a mask (4 neighbours): a label per pixel (0 outside the mask) and each region's area, index 0 unused */
export function regions(mask: Uint8Array, w: number, h: number): { label: Int32Array; area: number[]; touchesEdge: boolean[] } {
  const label = new Int32Array(w * h), area = [0], touchesEdge = [false], stack = new Int32Array(w * h);
  for (let start = 0; start < label.length; start++) {
    if (!mask[start] || label[start]) continue;
    const id = area.length; let top = 0, n = 0, edge = false;
    stack[top++] = start; label[start] = id;
    while (top) {
      const i = stack[--top], x = i % w, y = (i - x) / w;
      n++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = id; stack[top++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = id; stack[top++] = i + 1; }
      if (y > 0 && mask[i - w] && !label[i - w]) { label[i - w] = id; stack[top++] = i - w; }
      if (y < h - 1 && mask[i + w] && !label[i + w]) { label[i + w] = id; stack[top++] = i + w; }
    }
    area.push(n); touchesEdge.push(edge);
  }
  return { label, area, touchesEdge };
}

/**
 * The specks of the matte removed (regions of the subject far smaller than
 * its largest) and its pinholes filled (regions of ground enclosed by the
 * subject and far smaller than it), in place. `share` is "far smaller" as a
 * share of the largest region.
 */
export function tidy(a: Float32Array, w: number, h: number, share: number): Float32Array {
  const inside = new Uint8Array(a.length), outside = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) { inside[i] = a[i] > 0.02 ? 1 : 0; outside[i] = a[i] < 0.98 ? 1 : 0; }
  const sub = regions(inside, w, h);
  let largest = 1;
  for (const n of sub.area) if (n > largest) largest = n;
  const floor = Math.max(8, share * largest);
  for (let i = 0; i < a.length; i++) if (inside[i] && sub.area[sub.label[i]] < floor) a[i] = 0;
  const gap = regions(outside, w, h);
  for (let i = 0; i < a.length; i++) { const g = gap.label[i]; if (g && !gap.touchesEdge[g] && gap.area[g] < floor) a[i] = 1; }
  return a;
}

export interface Refinement {
  /** the guided filter's window, in pixels: it must reach across the network's uncertain edge */ radius: number;
  /** the guided filter's regularisation: lower follows the picture's edges more closely */ eps: number;
  /** half the width of the transition kept, in alpha (0 keeps the filter's own) */ contrast: number;
  /** pixels the matte is taken in by */ choke: number;
  /** specks and pinholes under this share of the subject are removed; 0 keeps them */ specks: number;
}

/** the steps' strength for a picture: the edge's width follows the picture's size */
export function refinementFor(w: number, h: number): Refinement {
  const m = Math.max(w, h);
  return { radius: Math.max(8, Math.round(m * 0.012)), eps: 1e-4, contrast: 0.22, choke: m >= 900 ? Math.max(1, Math.round(m * 0.0007)) : 0, specks: 0.004 };
}

/** the matte (0..255 or 0..1 per pixel) as an exact alpha (0..1): the edge on the picture's edge, a pixel or two wide, without specks */
export function refineAlpha(rgba: Uint8ClampedArray, matte: ArrayLike<number>, w: number, h: number, o: Refinement = refinementFor(w, h)): Float32Array {
  const scale = matte instanceof Float32Array ? 1 : 1 / 255, p = new Float32Array(w * h);
  for (let i = 0; i < p.length; i++) p[i] = matte[i] * scale;
  // a wide window first (the network's edge is uncertain over several pixels), then a narrow one on the narrowed edge
  let a = guidedFilter(rgba, p, w, h, o.radius, o.eps);
  if (o.contrast > 0) a = guidedFilter(rgba, sharpen(a, o.contrast), w, h, Math.max(2, Math.round(o.radius / 4)), o.eps);
  if (o.contrast > 0) a = sharpen(a, o.contrast);
  a = choke(a, w, h, o.choke);
  return o.specks > 0 ? tidy(a, w, h, o.specks) : a;
}

/**
 * The picture's colours with the old ground taken out of the edge: where the
 * subject is not whole (alpha under 0.99) the colour is the subject's own,
 * carried out from the pixels that are whole (a mean over growing windows, so
 * the nearest subject colour wins). On any new ground the edge then has the
 * subject's colour, not a halo of the old one. Straight (not premultiplied)
 * RGBA out.
 */
export function decontaminate(rgba: Uint8ClampedArray, alpha: Float32Array, w: number, h: number): Uint8ClampedArray {
  const n = w * h, s = workFactor(w, h), I = channels(rgba, n);
  // the pixels that are the subject through and through, a little in from the edge: a pixel the matte took in by mistake (white ground) must not lend its colour
  const inner = choke(alpha, w, h, Math.max(1, Math.round(Math.max(w, h) * 0.001))), weight = new Float32Array(n);
  for (let i = 0; i < n; i++) weight[i] = inner[i] >= 0.97 ? 1 : 0;
  const lw0 = shrink(weight, w, h, s), lw = lw0.w, lh = lw0.h, ln = lw * lh;
  let num = I.map((c) => { const m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = c[i] * weight[i]; return shrink(m, w, h, s).data; });
  let den = lw0.data;
  const F = [new Float32Array(ln), new Float32Array(ln), new Float32Array(ln)], filled = new Uint8Array(ln);
  const take = (bn: Float32Array[], bd: Float32Array, need: number) => {
    for (let i = 0; i < ln; i++) if (!filled[i] && bd[i] >= need) { filled[i] = 1; for (let c = 0; c < 3; c++) F[c][i] = bn[c][i] / bd[i]; }
  };
  take(num, den, 0.5);
  for (let r = 1; r <= 2 * Math.max(lw, lh); r *= 2) {
    if (filled.every((f) => f)) break;
    take(num.map((c) => boxBlur(c, lw, lh, r)), boxBlur(den, lw, lh, r), 0.05);
  }
  // nothing whole at all (an empty matte): the picture's own colours stay
  const any = filled.some((f) => f);
  const col = taps(w, lw, s), row = taps(h, lh, s), out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < h; y++) {
    const ya = row.a[y] * lw, yb = row.b[y] * lw, ty = row.t[y];
    for (let x = 0; x < w; x++) {
      const i = y * w + x, a = alpha[i], keep = a >= 0.99 || !any ? 1 : Math.min(1, Math.max(0, (a - 0.9) / 0.09));
      for (let c = 0; c < 3; c++) {
        let v = I[c][i];
        if (keep < 1) {
          const m = F[c], xa = col.a[x], xb = col.b[x], tx = col.t[x];
          const f = (m[ya + xa] * (1 - tx) + m[ya + xb] * tx) * (1 - ty) + (m[yb + xa] * (1 - tx) + m[yb + xb] * tx) * ty;
          v = f + (v - f) * keep * keep * (3 - 2 * keep);
        }
        out[i * 4 + c] = Math.round(v * 255);
      }
      out[i * 4 + 3] = Math.round(a * 255);
    }
  }
  return out;
}

/** a picture's matte mirrored left to right (what the network saw mirrored, put back) */
export function mirrored(m: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = m[y * w + (w - 1 - x)];
  return out;
}

/** the mean of two mattes of the same picture: the network's noise on a weak edge cancels */
export function averaged(a: Uint8ClampedArray, b: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) >> 1;
  return out;
}
