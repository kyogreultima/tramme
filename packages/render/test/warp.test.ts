import { describe, expect, it } from 'vitest';
import { warpBox } from '../src/gpu.ts';

describe('the box a warped picture covers', () => {
  it('holds the quad, on whole pixels', () => {
    expect(warpBox([[10.4, 20.6], [100.2, 25], [95, 80.9], [12, 70]], 1)).toEqual({ x: 10, y: 20, w: 91, h: 61 });
  });

  it('follows the scale of the canvas', () => {
    expect(warpBox([[10, 10], [20, 10], [20, 30], [10, 30]], 2)).toEqual({ x: 20, y: 20, w: 20, h: 40 });
  });

  it('holds a quad that is mirrored or turned as well', () => {
    expect(warpBox([[50, 50], [0, 50], [0, 0], [50, 0]], 1)).toEqual({ x: 0, y: 0, w: 50, h: 50 });
  });
});
