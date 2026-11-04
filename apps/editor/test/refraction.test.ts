import { describe, expect, it } from 'vitest';
import { bezelOf, canRefract, refractionMap } from '../src/theme/refraction.ts';

const at = (map: Uint8ClampedArray, width: number, x: number, y: number) => ({ r: map[(y * width + x) * 4], g: map[(y * width + x) * 4 + 1] });

describe('liquid glass refraction map', () => {
  const width = 120, height = 60, radius = 20;
  const map = refractionMap(width, height, radius);

  it('leaves the middle of the surface untouched', () => {
    expect(at(map, width, 60, 30)).toEqual({ r: 128, g: 128 });
  });

  it('reads the backdrop from further inside at each edge', () => {
    expect(at(map, width, 0, 30).r).toBeGreaterThan(200);
    expect(at(map, width, width - 1, 30).r).toBeLessThan(56);
    expect(at(map, width, 60, 0).g).toBeGreaterThan(200);
    expect(at(map, width, 60, height - 1).g).toBeLessThan(56);
  });

  it('bends less as it goes inward, and nothing past the bezel', () => {
    const bezel = bezelOf(width, height);
    const edge = at(map, width, 1, 30).r - 128, inner = at(map, width, Math.floor(bezel * 0.7), 30).r - 128;
    expect(edge).toBeGreaterThan(inner);
    expect(at(map, width, Math.ceil(bezel) + 2, 30).r).toBe(128);
  });

  it('keeps the bend off the clipped corners and bounded by the shape', () => {
    expect(map.every((v) => v >= 0 && v <= 255)).toBe(true);
    expect(at(map, width, 0, 0)).toEqual({ r: 128, g: 128 });
  });

  it('narrows the bezel on a thin surface', () => {
    expect(bezelOf(300, 20)).toBeLessThan(bezelOf(300, 200));
  });
});

describe('where it runs', () => {
  it('refracts in Chromium only', () => {
    const win = (brands: string[] | undefined, observer = true) => ({ navigator: { userAgentData: brands && { brands: brands.map((brand) => ({ brand })) } }, ResizeObserver: observer ? class {} : undefined }) as unknown as Window & typeof globalThis;
    expect(canRefract(win(['Chromium', 'Google Chrome']))).toBe(true);
    expect(canRefract(win(undefined))).toBe(false);
    expect(canRefract(win(['Chromium'], false))).toBe(false);
  });
});
