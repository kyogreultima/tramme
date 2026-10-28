// Real-ESRGAN, the geometry around the model: a picture cut in tiles the
// model's size, each enlarged four times by it, the interiors put back
// together (a tile's border, where the model sees too little, is dropped
// except at the edges of the picture), and the result brought down to twice
// the size by the mean of each block. The model itself is esrgan-run.ts.

export interface Rgba { width: number; height: number; data: Uint8ClampedArray }

/** where each tile starts (the top left, in source pixels): the whole picture covered, the last tile of a row or column set back against the edge */
export function tilesOf(width: number, height: number, tile: number, pad: number): { x: number; y: number }[] {
  const starts = (n: number) => {
    const out: number[] = [], step = tile - 2 * pad;
    for (let p = 0; ; p += step) {
      if (p + tile >= n) { out.push(Math.max(0, n - tile)); break; }
      out.push(p);
    }
    return out;
  };
  const xs = starts(width), ys = starts(height);
  return ys.flatMap((y) => xs.map((x) => ({ x, y })));
}

/** the model run on one tile: red, green, blue planes in 0..1, `side` × `side`; the answer four times as large each way */
export type TileModel = (tile: Float32Array, side: number) => Promise<Float32Array>;

/** a picture enlarged four times by the model, tile by tile; `progress` is called after each tile */
export async function upscaleTiled(src: Rgba, tile: number, pad: number, model: TileModel, progress?: (done: number, total: number) => void): Promise<Rgba> {
  const { width: W, height: H } = src, S = 4, out = new Uint8ClampedArray(W * S * H * S * 4), tiles = tilesOf(W, H, tile, pad);
  let done = 0;
  for (const { x: tx, y: ty } of tiles) {
    // the crop, the edges of the picture repeated where the tile reaches past them
    const input = new Float32Array(3 * tile * tile);
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
      const sx = Math.min(W - 1, tx + x), sy = Math.min(H - 1, ty + y), i = (sy * W + sx) * 4;
      for (let c = 0; c < 3; c++) input[(c * tile + y) * tile + x] = src.data[i + c] / 255;
    }
    const big = await model(input, tile), side = tile * S;
    // the interior of the tile: its border is dropped, unless the border is the picture's own edge
    const x0 = tx === 0 ? 0 : pad, x1 = tx + tile >= W ? tile : tile - pad, y0 = ty === 0 ? 0 : pad, y1 = ty + tile >= H ? tile : tile - pad;
    for (let y = y0; y < y1 && ty + y < H; y++) for (let x = x0; x < x1 && tx + x < W; x++) {
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
        const o = (((ty + y) * S + dy) * W * S + (tx + x) * S + dx) * 4, m = (y * S + dy) * side + x * S + dx;
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(Math.min(1, Math.max(0, big[c * side * side + m])) * 255);
        out[o + 3] = 255;
      }
    }
    progress?.(++done, tiles.length);
  }
  return { width: W * S, height: H * S, data: out };
}

/** a picture brought to half its size: the mean of each 2×2 block */
export function halve(src: Rgba): Rgba {
  const w = src.width >> 1, h = src.height >> 1, out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    const a = ((y * 2) * src.width + x * 2) * 4 + c, b = a + 4, d = a + src.width * 4, e = d + 4;
    out[(y * w + x) * 4 + c] = Math.round((src.data[a] + src.data[b] + src.data[d] + src.data[e]) / 4);
  }
  return { width: w, height: h, data: out };
}
