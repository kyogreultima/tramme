import { describe, expect, it } from 'vitest';
import { countsToImage, histogram, histogramToImage, parade, vectorscope, waveform } from '../src/scopes.ts';

/** a 2 × 2 frame: black, white, pure red, transparent */
const FRAME = [0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 9, 9, 9, 0];

describe('the scopes', () => {
  it('place each column’s pixels by brightness, white at the top', () => {
    const w = waveform(FRAME, 2, 2, 8);
    // column 0: black (bottom row) and red (luma 0.21: second row from the bottom)
    expect([w[7 * 2], w[6 * 2]]).toEqual([1, 1]);
    // column 1: white (top row); its transparent pixel left out
    expect(w[1]).toBe(1);
    expect(Array.from(w).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('place colours by hue and saturation, grey at the centre, red up and left', () => {
    const v = vectorscope(FRAME, 2, 2, 8);
    // black and white at the centre
    expect(v[4 * 8 + 4]).toBe(2);
    // red: Cb negative (left), Cr positive (up)
    const red = Array.from(v).findIndex((c, i) => c && i !== 4 * 8 + 4);
    expect(red % 8).toBeLessThan(4);
    expect(Math.floor(red / 8)).toBeLessThan(4);
  });

  it('parade each colour apart: red, green, blue side by side', () => {
    const p = parade(FRAME, 2, 2, 8), w = 2;
    // pure red: high in the red third, at the bottom of green and blue
    expect(p[0 * 3 * w + 0 * w + 0]).toBe(1);
    expect(p[7 * 3 * w + 1 * w + 0]).toBe(2);
    expect(Array.from(p).reduce((a, b) => a + b, 0)).toBe(9);
  });

  it('counts each level for the histogram, the transparent pixel left out', () => {
    const h = histogram(FRAME, 2, 2);
    expect(h.r[255]).toBe(2);
    expect(h.r[0]).toBe(1);
    expect(h.luma[255]).toBe(1);
    expect(h.luma[54]).toBe(1);
    expect(histogramToImage(h, 64, 16).length).toBe(64 * 16 * 4);
  });

  it('draw counts on a log scale, empty cells clear', () => {
    const img = countsToImage(new Uint32Array([0, 1, 100]), 3, 1);
    expect(img[3]).toBe(0);
    expect(img[7]).toBe(255);
    expect(img[8]).toBeGreaterThan(img[4]);
  });
});
