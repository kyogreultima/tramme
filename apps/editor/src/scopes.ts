// Scopes (docs/editing-roadmap.md, step 6): what a colourist reads beside the
// picture. The waveform: for each column of the frame, how many of its
// pixels sit at each brightness (black at the bottom). The vectorscope: the
// pixels' colour placed by hue (the angle) and saturation (the distance from
// the centre), BT.709 Cb and Cr. Both from the frame as drawn, counted here,
// drawn by the panel.

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

/** the effects a colourist reads the scopes for */
export const GRADING_EFFECTS = ['fx.lut', 'fx.curves', 'fx.wheels', 'fx.color', 'fx.key'];
