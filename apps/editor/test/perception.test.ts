import { describe, expect, it } from 'vitest';
import { dominant, paletteOf, paletteOps } from '../src/perception.ts';

describe('the colours of a picture', () => {
  it('finds the main groups, the largest first', () => {
    const px = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) {
      const c = i < 60 ? [10, 20, 40] : i < 90 ? [240, 240, 235] : [230, 60, 30];
      px.set([c[0] + (i % 3), c[1], c[2], 255], i * 4);
    }
    const found = dominant(px, 3);
    expect(found.map((c) => Math.round(c.share * 100))).toEqual([60, 30, 10]);
    expect(found[2].rgb).toEqual([231, 60, 30]);
  });
});

describe('the palette of a picture', () => {
  /** a context whose pixels are given: the left half one colour, the right half another */
  const painted = (left: [number, number, number], right: [number, number, number], w = 10, h = 10) => ({
    getImageData: () => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) data.set([...(i % w < w / 2 ? left : right), 255], i * 4);
      return { data, width: w, height: h };
    },
  }) as unknown as CanvasRenderingContext2D;

  it('takes the plate from the largest group and the accent from the most saturated', () => {
    const p = paletteOf(painted([0x10, 0x18, 0x20], [0xf2, 0xaa, 0x4c]), 10, 10);
    expect(p.plate).toBe('#101820');
    expect(p.accent).toBe('#F2AA4C');
    expect(p.ink).toBe('#F2AA4C');
  });

  it('keeps an ink that reads on a plate of close greys', () => {
    const p = paletteOf(painted([0x80, 0x80, 0x80], [0x88, 0x88, 0x88]), 10, 10);
    expect(['#FFFFFF', '#111111']).toContain(p.ink);
  });

  it('sets the tokens of a picture, naming where they come from', () => {
    const ops = paletteOps(paletteOf(painted([0x10, 0x18, 0x20], [0xf2, 0xaa, 0x4c]), 10, 10), 'frame-a');
    const paths = ops.map((o) => (o as { path: string }).path);
    expect(paths).toEqual(['/tokens/picture1', '/tokens/picture2', '/tokens/plate', '/tokens/ink', '/tokens/accent']);
    expect(JSON.stringify(ops[0])).toContain('of frame-a');
  });
});
