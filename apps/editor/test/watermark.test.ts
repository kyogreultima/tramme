import { describe, expect, it } from 'vitest';
import { WATERMARK, watermarkBox, watermarkOpening } from '../src/watermark-draw.ts';

describe('the watermark', () => {
  it('is the mark alone in the top left corner, and the whole logo when open, anchored there', () => {
    const shut = watermarkBox(1920, 1080, 0), open = watermarkBox(1920, 1080, 1);
    expect(shut.h).toBe(49);
    expect(Math.round(shut.w)).toBe(46);
    expect(Math.round(open.w)).toBe(196);
    // the left and top edges stay where they are
    for (const b of [shut, open]) expect([b.x, b.y]).toEqual([38, 38]);
    // a vertical film: the same size and margins
    const v = watermarkBox(1080, 1920, 0);
    expect([v.h, v.x, v.y]).toEqual([49, 38, 38]);
  });

  it('opens at regular intervals, holds, and closes back into the mark', () => {
    const { first, every, open, hold, close } = WATERMARK;
    expect(watermarkOpening(0)).toBe(0);
    expect(watermarkOpening(first + open / 2)).toBeCloseTo(0.5);
    expect(watermarkOpening(first + open + hold / 2)).toBe(1);
    expect(watermarkOpening(first + open + hold + close + 0.1)).toBe(0);
    expect(watermarkOpening(first + every + open + 0.1)).toBe(1);
  });
});
