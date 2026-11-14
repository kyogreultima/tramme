import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { boxBlur, choke, decontaminate, guidedFilter, refineAlpha, refinementFor, regions, sharpen, tidy } from '../src/matte-refine.ts';
import { encodePng } from '../src/png-encode.ts';

const W = 160, H = 120, CX = 80, CY = 60, R = 36;
/** a red disc on a white ground (hard edge), as RGBA */
function picture(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = Math.hypot(x + 0.5 - CX, y + 0.5 - CY) <= R, i = (y * W + x) * 4;
    px[i] = 220; px[i + 1] = inside ? 30 : 245; px[i + 2] = inside ? 30 : 245; px[i + 3] = 255;
    if (!inside) px[i] = 245;
  }
  return px;
}
/** what a small network gives: the disc a little large, displaced, with a wide soft edge */
function matte(): Float32Array {
  const m = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x + 0.5 - CX - 2, y + 0.5 - CY + 1) - (R + 2);
    m[y * W + x] = Math.min(1, Math.max(0, 0.5 - d / 12));
  }
  return m;
}
const truth = (x: number, y: number) => Math.hypot(x + 0.5 - CX, y + 0.5 - CY) <= R;

describe('box blur', () => {
  it('keeps a flat plane flat, edges included', () => {
    const out = boxBlur(new Float32Array(30 * 20).fill(0.7), 30, 20, 3);
    expect(Math.max(...out.map((v) => Math.abs(v - 0.7)))).toBeLessThan(1e-6);
  });
  it('averages a window', () => {
    const a = new Float32Array(9); a[4] = 9;
    expect(boxBlur(a, 3, 3, 1)[4]).toBeCloseTo(1, 6);
  });
});

describe('the refined edge', () => {
  const px = picture(), m = matte();
  it('lands on the picture\'s own edge, much closer than the network\'s', () => {
    const wrong = (a: ArrayLike<number>) => { let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((a[y * W + x] >= 0.5) !== truth(x, y)) n++; return n; };
    const refined = refineAlpha(px, m, W, H, { ...refinementFor(W, H), choke: 0 });
    expect(wrong(refined)).toBeLessThan(wrong(m) / 3);
  });
  it('makes the transition narrow', () => {
    const a = refineAlpha(px, m, W, H, { ...refinementFor(W, H), choke: 0 });
    let soft = 0, edge = 0;
    for (let i = 0; i < a.length; i++) { if (a[i] > 0.02 && a[i] < 0.98) soft++; }
    const wide = new Float32Array(m); for (let i = 0; i < wide.length; i++) if (wide[i] > 0.02 && wide[i] < 0.98) edge++;
    expect(soft).toBeLessThan(edge / 2);
  });
  it('takes the edge in with the choke', () => {
    const a = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = truth(x, y) ? 1 : 0;
    const sum = (v: Float32Array) => v.reduce((s, x) => s + x, 0);
    expect(sum(choke(Float32Array.from(a), W, H, 2))).toBeLessThan(sum(a));
    expect(choke(a, W, H, 0)).toBe(a);
  });
  it('sharpens around one half only', () => {
    const s = sharpen(Float32Array.of(0, 0.4, 0.5, 0.6, 1), 0.2);
    expect(s[0]).toBe(0); expect(s[4]).toBe(1); expect(s[2]).toBeCloseTo(0.5, 6); expect(s[1]).toBeLessThan(0.4); expect(s[3]).toBeGreaterThan(0.6);
  });
  it('keeps the matte where the guide is flat (no blur)', () => {
    const flat = new Uint8ClampedArray(W * H * 4).fill(128);
    const out = guidedFilter(flat, m, W, H, 6, 1e-4);
    for (let i = 0; i < out.length; i += 97) expect(Math.abs(out[i] - m[i])).toBeLessThan(0.03);
  });
});

describe('specks and pinholes', () => {
  it('removes a small island and fills a small hole, keeps the subject', () => {
    const w = 60, h = 40, a = new Float32Array(w * h);
    for (let y = 8; y < 32; y++) for (let x = 8; x < 40; x++) a[y * w + x] = 1;
    a[20 * w + 20] = 0; // pinhole
    a[3 * w + 50] = 1; a[3 * w + 51] = 1; // speck
    tidy(a, w, h, 0.01);
    expect(a[20 * w + 20]).toBe(1);
    expect(a[3 * w + 50]).toBe(0);
    expect(a[15 * w + 15]).toBe(1);
  });
  it('keeps a large hole (a handle)', () => {
    const w = 60, h = 40, a = new Float32Array(w * h);
    for (let y = 5; y < 35; y++) for (let x = 5; x < 55; x++) a[y * w + x] = 1;
    for (let y = 15; y < 25; y++) for (let x = 20; x < 40; x++) a[y * w + x] = 0;
    tidy(a, w, h, 0.01);
    expect(a[20 * w + 30]).toBe(0);
  });
  it('labels the regions of a mask', () => {
    const mask = Uint8Array.from([1, 1, 0, 0, 0, 0, 0, 1, 1]);
    const r = regions(mask, 3, 3);
    expect(r.area.slice(1)).toEqual([2, 2]);
  });
});

describe('the colour of the edge', () => {
  it('is the subject\'s, not the old ground\'s', () => {
    const px = picture(), a = refineAlpha(px, matte(), W, H, { ...refinementFor(W, H), choke: 1 });
    // the photographed edge pixels blend the red and the white ground: simulate with a soft alpha over the picture
    const soft = new Uint8ClampedArray(px);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - CX, y + 0.5 - CY) - R, t = Math.min(1, Math.max(0, 0.5 - d / 2)), i = (y * W + x) * 4;
      soft[i] = 220 * t + 245 * (1 - t); soft[i + 1] = 30 * t + 245 * (1 - t); soft[i + 2] = 30 * t + 245 * (1 - t);
    }
    const out = decontaminate(soft, a, W, H);
    let worst = 0, n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] > 0.05 && a[i] < 0.95) { n++; worst = Math.max(worst, out[i * 4 + 1]); }
    expect(n).toBeGreaterThan(0);
    // green stays near the disc's 30, never the ground's 245 (a pale fringe)
    expect(worst).toBeLessThan(80);
    // alpha is carried as it is, and whole pixels keep their colour
    expect(out[(CY * W + CX) * 4 + 3]).toBe(255);
    expect(out[(CY * W + CX) * 4 + 1]).toBe(30);
  });
});

describe('the PNG', () => {
  it('carries straight RGBA exactly, faint pixels included', async () => {
    const w = 5, h = 3, px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { px[i * 4] = (i * 17) % 256; px[i * 4 + 1] = (i * 31) % 256; px[i * 4 + 2] = (i * 7) % 256; px[i * 4 + 3] = i === 3 ? 4 : (i * 19) % 256; }
    const bytes = new Uint8Array(await (await encodePng(px, w, h)).arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer);
    let at = 8, idat = new Uint8Array();
    while (at < bytes.length) {
      const len = view.getUint32(at), type = String.fromCharCode(...bytes.slice(at + 4, at + 8));
      if (type === 'IDAT') idat = bytes.slice(at + 8, at + 8 + len);
      at += 12 + len;
    }
    const raw = inflateSync(idat), stride = w * 4, out = new Uint8Array(stride * h);
    for (let y = 0; y < h; y++) {
      expect(raw[y * (stride + 1)]).toBe(1);
      for (let x = 0; x < stride; x++) out[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + (x >= 4 ? out[y * stride + x - 4] : 0)) & 255;
    }
    expect([...out]).toEqual([...px]);
  });
});
