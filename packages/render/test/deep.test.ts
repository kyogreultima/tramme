import { describe, expect, it } from 'vitest';
import { i420p10 } from '../src/deep.ts';

const flat = (r: number, g: number, b: number, w = 4, h = 2) => { const a = new Uint16Array(w * h * 4); for (let i = 0; i < a.length; i += 4) { a[i] = r; a[i + 1] = g; a[i + 2] = b; a[i + 3] = 65535; } return a; };

describe('10-bit planes', () => {
  it('are BT.709 limited range: black 64, white 940, greys without colour at 512', () => {
    const black = i420p10(flat(0, 0, 0), 4, 2), white = i420p10(flat(65535, 65535, 65535), 4, 2);
    expect([...black.subarray(0, 8)]).toEqual(Array(8).fill(64));
    expect([...white.subarray(0, 8)]).toEqual(Array(8).fill(940));
    expect([...white.subarray(8)]).toEqual(Array(4).fill(512));
  });

  it('carry red in V, blue in U, and levels between the 8-bit steps', () => {
    const red = i420p10(flat(65535, 0, 0), 4, 2);
    expect(red[8 + 2]).toBe(960);
    expect(red[8]).toBeLessThan(512);
    // a grey one 16-bit step above black: a level an 8-bit frame cannot hold
    expect(i420p10(flat(256, 256, 256), 4, 2)[0]).toBe(Math.round(64 + 876 * (256 / 65535)));
  });
});
