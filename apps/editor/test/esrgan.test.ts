import { describe, expect, it } from 'vitest';
import { halve, tilesOf, upscaleTiled, type Rgba } from '../src/esrgan.ts';

/** a picture whose every pixel tells where it is, so a misplaced tile shows */
const picture = (w: number, h: number): Rgba => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = x % 256; data[i + 1] = y % 256; data[i + 2] = (x * 7 + y * 3) % 256; data[i + 3] = 255; }
  return { width: w, height: h, data };
};

/** the model stood in for by the nearest pixel ×4: what the tiles should give back whole */
const nearest = async (tile: Float32Array, side: number): Promise<Float32Array> => {
  const out = new Float32Array(3 * side * 4 * side * 4);
  for (let c = 0; c < 3; c++) for (let y = 0; y < side * 4; y++) for (let x = 0; x < side * 4; x++) out[(c * side * 4 + y) * side * 4 + x] = tile[(c * side + (y >> 2)) * side + (x >> 2)];
  return out;
};

describe('a picture cut in tiles for the model', () => {
  it('has tiles that cover it whole, the last one set back against the edge', () => {
    const t = tilesOf(300, 130, 128, 8);
    expect([...new Set(t.map((x) => x.x))]).toEqual([0, 112, 172]);
    expect([...new Set(t.map((x) => x.y))]).toEqual([0, 2]);
    expect(t).toHaveLength(6);
    expect(Math.max(...t.map((x) => x.x)) + 128).toBe(300);
  });

  it('is one tile for a picture the size of a tile or less', () => {
    expect(tilesOf(128, 128, 128, 8)).toHaveLength(1);
    expect(tilesOf(40, 30, 128, 8)).toHaveLength(1);
  });

  it('gives back, through a model that only enlarges, exactly the enlarged picture, at any size', async () => {
    for (const [w, h] of [[300, 130], [128, 128], [40, 30], [131, 257]] as const) {
      const src = picture(w, h), big = await upscaleTiled(src, 128, 8, nearest);
      expect([big.width, big.height]).toEqual([w * 4, h * 4]);
      let wrong = 0;
      for (let y = 0; y < h * 4; y += 5) for (let x = 0; x < w * 4; x += 5) { const a = (y * w * 4 + x) * 4, b = ((y >> 2) * w + (x >> 2)) * 4; for (let c = 0; c < 3; c++) if (big.data[a + c] !== src.data[b + c]) wrong++; }
      expect(wrong, `${w}x${h}`).toBe(0);
    }
  });

  it('reports its progress by tile', async () => {
    const seen: number[] = [];
    await upscaleTiled(picture(300, 130), 128, 8, nearest, (d, n) => seen.push(d / n));
    expect(seen.at(-1)).toBe(1);
    expect(seen.length).toBe(tilesOf(300, 130, 128, 8).length);
  });
});

describe('a picture enlarged four times, brought down to twice', () => {
  it('is the mean of each 2×2 block', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 100, 100, 100, 255]);
    const h = halve({ width: 2, height: 2, data });
    expect([h.width, h.height, Array.from(h.data)]).toEqual([1, 1, [100, 100, 100, 255]]);
  });
});
