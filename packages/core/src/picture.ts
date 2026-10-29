// What can be measured between two pictures, with no canvas: the difference
// (PSNR, share of pixels off, a diff image), the main colours, where a frame
// is busy, and a likeness of one picture to another in palette, layout and
// light, with a few words on what differs most. The command line and the
// editor read the same measures.

export interface Pixels { data: Uint8ClampedArray; width: number; height: number }

export interface Diff {
  psnr: number;
  mean: number;
  max: number;
  /** share of pixels whose largest channel difference exceeds `threshold` */
  over: number;
  threshold: number;
}

/**
 * How far two pictures of one size are from each other: PSNR, the mean and the
 * largest channel difference, the share of pixels off by more than `threshold`.
 * With `diff`, the picture of it too: the first dimmed, the differences in red
 * with an intensity by their size.
 */
export function pictureDiff(a: Pixels, b: Pixels, { threshold = 16, diff = false } = {}): Diff & { image?: Uint8ClampedArray } {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`different sizes: ${a.width}x${a.height} and ${b.width}x${b.height}`);
  const n = a.width * a.height;
  const image = diff ? new Uint8ClampedArray(n * 4) : undefined;
  let se = 0, sum = 0, max = 0, over = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]);
      se += d * d; sum += d;
      if (d > m) m = d;
    }
    if (m > max) max = m;
    if (m > threshold) over++;
    if (image) {
      const L = (0.2126 * a.data[i * 4] + 0.7152 * a.data[i * 4 + 1] + 0.0722 * a.data[i * 4 + 2]) * 0.25;
      const k = Math.min(1, m / 48);
      image[i * 4] = L + (255 - L) * k;
      image[i * 4 + 1] = L * (1 - k);
      image[i * 4 + 2] = L * (1 - k);
      image[i * 4 + 3] = 255;
    }
  }
  const mse = se / (n * 3);
  return { psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse), mean: sum / (n * 3), max, over: over / n, threshold, ...(image ? { image } : {}) };
}

// ── colour ───────────────────────────────────────────────────

type RGB = [number, number, number];

/** an sRGB colour (0 to 255) in CIE L*a*b*, D65 */
export function toLab([r, g, b]: RGB): RGB {
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047, y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B, z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** the distance between two sRGB colours in Lab (CIE76): 100 between black and white */
export function deltaE(a: RGB, b: RGB): number {
  const p = toLab(a), q = toLab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** the main colours of a picture: k-means on its pixels, the largest groups first */
export function dominant(px: Uint8ClampedArray, k = 5): { rgb: RGB; share: number }[] {
  const pts: RGB[] = [];
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) pts.push([px[i], px[i + 1], px[i + 2]]);
  if (!pts.length) return [];
  // seeds spread along the brightness, then a few rounds of assignment
  const sorted = [...pts].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let centres = Array.from({ length: k }, (_, i) => [...sorted[Math.floor(((i + 0.5) * sorted.length) / k)]] as RGB);
  let counts: number[] = [];
  for (let round = 0; round < 8; round++) {
    const sums = centres.map(() => [0, 0, 0]);
    counts = centres.map(() => 0);
    for (const p of pts) {
      let best = 0, bd = Infinity;
      centres.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } });
      sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2]; counts[best]++;
    }
    centres = centres.map((c, j) => (counts[j] ? [sums[j][0] / counts[j], sums[j][1] / counts[j], sums[j][2] / counts[j]] : c) as RGB);
  }
  return centres.map((c, j) => ({ rgb: c.map(Math.round) as RGB, share: counts[j] / pts.length })).filter((c) => c.share > 0.01).sort((a, b) => b.share - a.share);
}

// ── where a frame is busy ────────────────────────────────────

/** how busy each cell of a small picture is (edge energy, robustly scaled) and its luminance */
export function busyGrid(px: Uint8ClampedArray, w: number, h: number): { busy: number[]; luma: number[] } {
  const luma = new Float32Array(w * h);
  for (let i = 0; i < luma.length; i++) luma[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  /** the luminance at x, y, held at the edges so the border cells are measured too */
  const at = (x: number, y: number) => luma[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const energy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const dx = Math.abs(at(x + 1, y) - at(x - 1, y)) + Math.abs(at(x + 1, y + 1) - at(x - 1, y + 1));
    const dy = Math.abs(at(x, y + 1) - at(x, y - 1)) + Math.abs(at(x + 1, y + 1) - at(x + 1, y - 1));
    energy[i] = dx + dy + (1 - Math.abs(luma[i] * 2 - 1)) * 0.12; // edges, and a little for flat brightness (text lands there well anyway)
  }
  // robust scale: the 95th percentile, so one hot edge does not flatten the rest
  const sorted = [...energy].sort((a, b) => a - b);
  const cap = sorted[Math.floor(sorted.length * 0.95)] || 1;
  return { busy: [...energy].map((e) => Math.min(1, e / cap)), luma: [...luma] };
}

// ── likeness ─────────────────────────────────────────────────

/** a picture on a w × h grid, each cell the mean of the pixels it covers */
function shrink(p: Pixels, w: number, h: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor((x * p.width) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * p.width) / w));
    const y0 = Math.floor((y * p.height) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * p.height) / h));
    const sum = [0, 0, 0, 0];
    let n = 0;
    for (let yy = y0; yy < Math.min(p.height, y1); yy++) for (let xx = x0; xx < Math.min(p.width, x1); xx++) {
      const i = (yy * p.width + xx) * 4;
      for (let c = 0; c < 4; c++) sum[c] += p.data[i + c];
      n++;
    }
    for (let c = 0; c < 4; c++) data[(y * w + x) * 4 + c] = n ? sum[c] / n : 0;
  }
  return { data, width: w, height: h };
}

const lumaOf = (p: Pixels) => { const l: number[] = []; for (let i = 0; i < p.data.length; i += 4) l.push((0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2]) / 255); return l; };
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

/** Pearson's correlation of two series, 0 to 1 (a negative one counts as none); two flat series are alike, a flat one and a varying one are not */
function correlation(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  if (saa < 1e-9 && sbb < 1e-9) return 1;
  if (saa < 1e-9 || sbb < 1e-9) return 0;
  return Math.max(0, sab / Math.sqrt(saa * sbb));
}

/** which third of the width holds the middle of what is busy */
function thirdOf(busy: number[], cols: number): 'left' | 'centre' | 'right' {
  let mass = 0, at = 0;
  busy.forEach((b, i) => { mass += b; at += b * ((i % cols) + 0.5); });
  const x = mass ? at / mass / cols : 0.5;
  return x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'centre';
}

const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export interface Likeness { score: number; palette: number; layout: number; light: number; words: string[] }

/**
 * How much a render looks like a target: palette (the main colours' distance in
 * Lab), layout (the correlation of where each is busy, on 16 × 9) and light
 * (the overlap of their luma histograms), each 0 to 100, and their mean
 * weighted 0.35, 0.4 and 0.25. `words` are up to three sentences on what
 * differs most. A guide: two pictures can look alike and say different things.
 */
export function likeness(render: Pixels, target: Pixels): Likeness {
  const a = shrink(render, 64, 36), b = shrink(target, 64, 36);
  // palette: each colour of the target, the less common ones counting for more than their share, against the nearest of the render
  const ca = dominant(a.data, 5), cb = dominant(b.data, 5);
  const weight = cb.map((c) => Math.sqrt(c.share));
  const total = weight.reduce((s, w) => s + w, 0) || 1;
  const near = cb.map((c) => Math.min(...ca.map((r) => deltaE(c.rgb, r.rgb)), 100));
  const distance = cb.reduce((s, _c, i) => s + (near[i] * weight[i]) / total, 0);
  const palette = Math.round(100 * Math.max(0, 1 - distance / 45));
  // layout
  const ga = busyGrid(shrink(a, 16, 9).data, 16, 9).busy, gb = busyGrid(shrink(b, 16, 9).data, 16, 9).busy;
  const layout = Math.round(100 * correlation(ga, gb));
  // light
  const histogram = (l: number[]) => { const h = new Array(16).fill(0); for (const v of l) h[Math.min(15, Math.floor(v * 16))] += 1 / l.length; return h as number[]; };
  const la = lumaOf(a), lb = lumaOf(b), ha = histogram(la), hb = histogram(lb);
  const light = Math.round(100 * ha.reduce((s, v, i) => s + Math.min(v, hb[i]), 0));
  const score = Math.round(0.35 * palette + 0.4 * layout + 0.25 * light);

  // what differs most, in words
  const said: { severity: number; text: string }[] = [];
  const dl = mean(lb) - mean(la);
  if (Math.abs(dl) > 0.06) said.push({ severity: Math.abs(dl) / 0.25, text: `the target is ${dl < 0 ? 'darker' : 'brighter'}` });
  const ta = thirdOf(ga, 16), tb = thirdOf(gb, 16);
  if (ta !== tb) said.push({ severity: 1 - layout / 100 + 0.2, text: `the target's busy area is in the ${tb} third, the render's in the ${ta} third` });
  cb.forEach((c, i) => {
    const [, A, B] = toLab(c.rgb);
    if (c.share >= 0.02 && Math.hypot(A, B) > 30 && near[i] > 30) said.push({ severity: near[i] / 60, text: `the accent of the target (${hex(c.rgb)}) is missing from the render` });
  });
  const words = said.sort((x, y) => y.severity - x.severity).slice(0, 3).map((s) => s.text);
  return { score, palette, layout, light, words };
}
