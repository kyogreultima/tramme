import { describe, expect, it } from 'vitest';
import { busyGrid, deltaE, dominant, likeness, pictureDiff, toLab, type Pixels } from '../src/picture.ts';

/** a picture drawn pixel by pixel */
function draw(width: number, height: number, f: (x: number, y: number) => [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = f(x, y), i = (y * width + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, width, height };
}
const map = (p: Pixels, f: (c: [number, number, number]) => [number, number, number]): Pixels => {
  const out = new Uint8ClampedArray(p.data);
  for (let i = 0; i < out.length; i += 4) { const [r, g, b] = f([out[i], out[i + 1], out[i + 2]]); out[i] = r; out[i + 1] = g; out[i + 2] = b; }
  return { ...p, data: out };
};

/** a dark scene with a bright box in its left third and a mid-tone bar at the bottom */
const scene = (colour: [number, number, number] = [240, 200, 40]) => draw(160, 90, (x, y) => (x > 10 && x < 50 && y > 20 && y < 60 ? colour : y > 75 ? [90, 90, 110] : [20, 24, 36]));

describe('colour in Lab', () => {
  it('white is 100 0 0, and black and white are 100 apart', () => {
    const [l, a, b] = toLab([255, 255, 255]);
    expect(l).toBeCloseTo(100, 1); expect(a).toBeCloseTo(0, 1); expect(b).toBeCloseTo(0, 1);
    expect(deltaE([0, 0, 0], [255, 255, 255])).toBeCloseTo(100, 1);
    expect(deltaE([10, 20, 30], [10, 20, 30])).toBe(0);
  });
});

describe('pictureDiff', () => {
  it('says Infinity and nothing over for two equal pictures', () => {
    const d = pictureDiff(scene(), scene());
    expect(d.psnr).toBe(Infinity);
    expect(d.over).toBe(0);
    expect(d.max).toBe(0);
  });

  it('measures a difference and draws it when asked', () => {
    const d = pictureDiff(scene(), scene([40, 200, 240]), { diff: true });
    expect(d.psnr).toBeLessThan(40);
    expect(d.over).toBeGreaterThan(0);
    expect(d.image).toHaveLength(160 * 90 * 4);
    expect(pictureDiff(scene(), scene()).image).toBeUndefined();
  });

  it('refuses pictures of different sizes', () => {
    expect(() => pictureDiff(scene(), draw(8, 8, () => [0, 0, 0]))).toThrow('different sizes: 160x90 and 8x8');
  });
});

describe('the parts of a picture', () => {
  it('finds its dominant colours, the largest first', () => {
    const d = dominant(scene().data, 3);
    expect(d[0].share).toBeGreaterThan(d.at(-1)!.share);
    expect(d.reduce((n, c) => n + c.share, 0)).toBeCloseTo(1, 5);
  });

  it('finds where it is busy: the box\'s edges, not the flat ground', () => {
    const g = busyGrid(scene().data, 160, 90);
    expect(g.busy).toHaveLength(160 * 90);
    expect(g.busy[40 * 160 + 10]).toBeGreaterThan(g.busy[5 * 160 + 120]);
  });
});

describe('likeness', () => {
  it('a picture with itself is 100 in every part', () => {
    const l = likeness(scene(), scene());
    expect(l).toMatchObject({ score: 100, palette: 100, layout: 100, light: 100 });
    expect(l.words).toEqual([]);
  });

  it('against its luma inverted, the light falls under 30', () => {
    const l = likeness(scene(), map(scene(), ([r, g, b]) => [255 - r, 255 - g, 255 - b]));
    expect(l.light).toBeLessThan(30);
  });

  it('against the same layout in other colours, the layout stays over 80 and the palette falls under 50', () => {
    const l = likeness(scene(), map(scene(), ([r, g, b]) => [b, r, g]));
    expect(l.layout).toBeGreaterThan(80);
    expect(l.palette).toBeLessThan(50);
  });

  it('says the target is darker when it is, and what colour of it is missing', () => {
    const dark = map(scene(), ([r, g, b]) => [r * 0.4, g * 0.4, b * 0.4]);
    expect(likeness(scene(), dark).words.join(' ')).toContain('darker');
    expect(likeness(dark, scene()).words.join(' ')).toContain('brighter');
    const words = likeness(draw(160, 90, () => [20, 24, 36]), scene()).words.join(' ');
    expect(words).toMatch(/missing from the render/);
  });

  it('says where the busy part of the target sits when it is not where the render\'s is', () => {
    const left = draw(160, 90, (x, y) => (x < 40 && y > 20 && y < 70 && (x + y) % 8 < 4 ? [255, 255, 255] : [10, 10, 10]));
    const right = draw(160, 90, (x, y) => (x > 120 && y > 20 && y < 70 && (x + y) % 8 < 4 ? [255, 255, 255] : [10, 10, 10]));
    expect(likeness(right, left).words.join(' ')).toMatch(/target's busy area is in the left third, the render's in the right/);
  });

  it('compares pictures of other sizes on a common grid', () => {
    const small = draw(80, 45, (x, y) => (x > 5 && x < 25 && y > 10 && y < 30 ? [240, 200, 40] : y > 37 ? [90, 90, 110] : [20, 24, 36]));
    expect(likeness(scene(), small).score).toBeGreaterThan(85);
  });
});
