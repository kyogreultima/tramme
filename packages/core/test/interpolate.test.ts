import { describe, expect, it } from 'vitest';
import { between, enlarge, flowField, type Rgba } from '../src/index.ts';

/** a textured square on a grey ground, its left edge at x */
function frame(x: number, w = 160, h = 96): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
    const inside = i >= x && i < x + 40 && y >= 28 && y < 68;
    // a texture of its own on the square (moving with it), another on the ground: nothing periodic to mistake
    const h1 = (((i - x) * 73856093) ^ (y * 19349663)) >>> 0, h2 = ((i * 83492791) ^ (y * 2654435761)) >>> 0;
    const v = inside ? 190 + (h1 % 60) : 50 + (h2 % 30);
    const k = (y * w + i) * 4;
    data[k] = v; data[k + 1] = inside ? 40 : v; data[k + 2] = inside ? 40 : v; data[k + 3] = 255;
  }
  return { width: w, height: h, data };
}
const redAt = (p: Rgba, x: number, y: number) => p.data[(y * p.width + x) * 4] > 150 && p.data[(y * p.width + x) * 4 + 1] < 100;
const leftEdge = (p: Rgba, y = 48) => { for (let x = 0; x < p.width; x++) if (redAt(p, x, y)) return x; return -1; };

describe('frames made up between two frames', () => {
  it('finds the motion of a square', () => {
    const f = flowField(frame(40), frame(52));
    // the block at the square's middle moved 12 px right
    const i = Math.floor(48 / f.cell) * f.cols + Math.floor(60 / f.cell);
    expect(f.dx[i]).toBeCloseTo(12, 0);
    expect(Math.abs(f.dy[i])).toBeLessThan(1);
  });

  it('puts the square halfway at the middle moment, where it was and will be at the ends', () => {
    const a = frame(40), b = frame(52);
    expect(leftEdge(between(a, b, 0.5))).toBeGreaterThanOrEqual(44);
    expect(leftEdge(between(a, b, 0.5))).toBeLessThanOrEqual(48);
    expect(leftEdge(between(a, b, 0))).toBe(40);
    expect(leftEdge(between(a, b, 1))).toBeGreaterThanOrEqual(51);
  });
});

describe('a picture enlarged', () => {
  it('is twice its size and keeps its edges where they were', () => {
    const p = frame(20, 80, 48), big = enlarge(p);
    expect([big.width, big.height]).toEqual([160, 96]);
    expect(redAt(big, 80, 70)).toBe(true);
    expect(redAt(big, 30, 70)).toBe(false);
    // the square's left edge at twice its place
    expect(Math.abs(leftEdge(big, 70) - 40)).toBeLessThanOrEqual(1);
  });
});
