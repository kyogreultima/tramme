// Scopes (docs/editing-roadmap.md, step 6): what a colourist reads beside the
// picture. The waveform: for each column of the frame, how many of its
// pixels sit at each brightness (black at the bottom). The vectorscope: the
// pixels' colour placed by hue (the angle) and saturation (the distance from
// the centre), BT.709 Cb and Cr. The parade: a waveform per colour, side by
// side, to balance them. The histogram: how many pixels at each level. All
// from the frame as drawn, counted here, drawn by the panel.

export const WAVE_ROWS = 128;
export const VECTOR_SIZE = 128;

/** a waveform of w columns × WAVE_ROWS rows, row 0 for white: the count of pixels per column at each luma */
export function waveform(rgba: ArrayLike<number>, w: number, h: number, rows = WAVE_ROWS): Uint32Array {
  const out = new Uint32Array(w * rows);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] === 0) continue;
      const luma = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
      const row = rows - 1 - Math.min(rows - 1, Math.floor(luma * rows));
      out[row * w + x]++;
    }
  }
  return out;
}

/** a vectorscope of size × size, its centre neutral grey: the count of pixels at each (Cb, Cr) */
export function vectorscope(rgba: ArrayLike<number>, w: number, h: number, size = VECTOR_SIZE): Uint32Array {
  const out = new Uint32Array(size * size), half = size / 2;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (rgba[i + 3] === 0) continue;
    const r = rgba[i] / 255, g = rgba[i + 1] / 255, b = rgba[i + 2] / 255;
    const cb = -0.1146 * r - 0.3854 * g + 0.5 * b, cr = 0.5 * r - 0.4542 * g - 0.0458 * b;
    // ±0.5 fills the scope; Cr up (red at the top left, as a vectorscope shows it)
    const x = Math.min(size - 1, Math.max(0, Math.floor(half + cb * size))), y = Math.min(size - 1, Math.max(0, Math.floor(half - cr * size)));
    out[y * size + x]++;
  }
  return out;
}

/** counts as an image: the busiest cell at full brightness, a log scale so a few pixels still show, in the colour given */
export function countsToImage(counts: Uint32Array, w: number, h: number, rgb: [number, number, number] = [120, 230, 160]): Uint8ClampedArray<ArrayBuffer> {
  let top = 1;
  for (const c of counts) if (c > top) top = c;
  const k = 1 / Math.log1p(top), out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  for (let i = 0; i < w * h; i++) {
    const v = counts[i] ? 0.25 + 0.75 * Math.log1p(counts[i]) * k : 0;
    out[i * 4] = rgb[0] * v; out[i * 4 + 1] = rgb[1] * v; out[i * 4 + 2] = rgb[2] * v; out[i * 4 + 3] = counts[i] ? 255 : 0;
  }
  return out;
}

/** an RGB parade: the waveform of each colour side by side (red, green, blue), w columns each, rows × 3w counts with red's columns first */
export function parade(rgba: ArrayLike<number>, w: number, h: number, rows = WAVE_ROWS): Uint32Array {
  const out = new Uint32Array(3 * w * rows);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] === 0) continue;
      for (let k = 0; k < 3; k++) {
        const row = rows - 1 - Math.min(rows - 1, Math.floor((rgba[i + k] / 256) * rows));
        out[row * 3 * w + k * w + x]++;
      }
    }
  }
  return out;
}

/** a histogram: per level (0 to 255), how many pixels have it in red, green, blue and brightness */
export function histogram(rgba: ArrayLike<number>, w: number, h: number): { r: Uint32Array; g: Uint32Array; b: Uint32Array; luma: Uint32Array } {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), luma = new Uint32Array(256);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (rgba[i + 3] === 0) continue;
    r[rgba[i]]++; g[rgba[i + 1]]++; b[rgba[i + 2]]++;
    luma[Math.min(255, Math.round(0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]))]++;
  }
  return { r, g, b, luma };
}

/** a parade's counts as an image: each third in its colour */
export function paradeToImage(counts: Uint32Array, w: number, rows: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(3 * w * rows * 4));
  const tints: [number, number, number][] = [[255, 80, 80], [90, 230, 110], [100, 150, 255]];
  for (let k = 0; k < 3; k++) {
    const part = new Uint32Array(w * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) part[y * w + x] = counts[y * 3 * w + k * w + x];
    const img = countsToImage(part, w, rows, tints[k]);
    for (let y = 0; y < rows; y++) out.set(img.subarray(y * w * 4, (y + 1) * w * 4), (y * 3 * w + k * w) * 4);
  }
  return out;
}

/** a histogram as an image of w × h: the three colours added where they overlap, brightness as a grey outline, the busiest level at the top */
export function histogramToImage(hist: ReturnType<typeof histogram>, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  let top = 1;
  for (const ch of [hist.r, hist.g, hist.b, hist.luma]) for (let i = 1; i < 255; i++) top = Math.max(top, ch[i]);
  const level = (ch: Uint32Array, x: number) => {
    const a = Math.floor((x / w) * 256), b = Math.max(a + 1, Math.floor(((x + 1) / w) * 256));
    let m = 0;
    for (let i = a; i < b; i++) m = Math.max(m, ch[i]);
    return Math.min(1, Math.sqrt(m / top));
  };
  for (let x = 0; x < w; x++) {
    const hr = level(hist.r, x) * h, hg = level(hist.g, x) * h, hb = level(hist.b, x) * h, hl = level(hist.luma, x) * h;
    for (let y = 0; y < h; y++) {
      const up = h - y, i = (y * w + x) * 4;
      const r = up <= hr ? 200 : 0, g = up <= hg ? 200 : 0, b = up <= hb ? 200 : 0;
      const edge = Math.abs(up - hl) < 1.2;
      out[i] = edge ? 240 : r; out[i + 1] = edge ? 240 : g; out[i + 2] = edge ? 240 : b;
      out[i + 3] = edge || r || g || b ? 255 : 0;
    }
  }
  return out;
}

/** the effects a colourist reads the scopes for, besides those of the Colour category */
export const GRADING_EFFECTS = ['fx.key'];
