import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { compareFiles } from '../src/compare.ts';

/** a small picture with a ramp, shifted: two of them differ everywhere a little */
const make = (shift: number) => {
  const p = new PNG({ width: 40, height: 20 });
  for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) {
    const i = (y * 40 + x) * 4;
    p.data[i] = (x * 6 + shift) & 255; p.data[i + 1] = (y * 12) & 255; p.data[i + 2] = x > 20 ? 200 : 40; p.data[i + 3] = 255;
  }
  return p;
};

describe('compareFiles', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-'));
  const a = path.join(dir, 'a.png'), b = path.join(dir, 'b.png'), c = path.join(dir, 'c.png');
  fs.writeFileSync(a, PNG.sync.write(make(0)));
  fs.writeFileSync(b, PNG.sync.write(make(30)));
  fs.writeFileSync(c, PNG.sync.write(new PNG({ width: 8, height: 8 })));

  it('measures two pictures: PSNR, mean and max channel difference, the share over the threshold', () => {
    const d = compareFiles(a, b);
    // the numbers the code gave before its measure moved to core
    expect(d.psnr).toBeCloseTo(17.576000943951758, 9);
    expect(d).toMatchObject({ mean: 13.266666666666667, max: 226, over: 1, threshold: 16 });
  });

  it('says Infinity for the same picture, and writes a diff image when asked', () => {
    const out = path.join(dir, 'diff.png');
    expect(compareFiles(a, a, { diffOut: out })).toMatchObject({ psnr: Infinity, mean: 0, max: 0, over: 0 });
    const diff = PNG.sync.read(fs.readFileSync(out));
    expect([diff.width, diff.height]).toEqual([40, 20]);
    expect(compareFiles(a, b, { threshold: 40 }).threshold).toBe(40);
  });

  it('refuses pictures of different sizes', () => {
    expect(() => compareFiles(a, c)).toThrow('different sizes: 40x20 and 8x8');
  });
});
