import { describe, expect, it } from 'vitest';
import { correctionAt, corrections, coverZoom, frameMotion, type GrayFrame, type Stabilization } from '../src/index.ts';

/** a textured picture (smooth noise), seen through a frame of w × h moved by (dx, dy) and turned by a about its centre */
function view(w: number, h: number, dx: number, dy: number, a = 0): GrayFrame {
  const data = new Float32Array(w * h), cx = w / 2, cy = h / 2, c = Math.cos(a), s = Math.sin(a);
  const tex = (x: number, y: number) => 0.5 + 0.25 * Math.sin(x * 0.31 + Math.sin(y * 0.17) * 3) * Math.cos(y * 0.23 + Math.sin(x * 0.13) * 2) + 0.1 * Math.sin(x * 0.9 + y * 0.7);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // the point of the scene shown here: undo the frame's move
      const ux = x - cx - dx, uy = y - cy - dy;
      data[y * w + x] = tex(c * ux + s * uy + cx, -s * ux + c * uy + cy);
    }
  }
  return { width: w, height: h, data };
}

describe('stabilisation', () => {
  it('reads how the picture moved between two frames', () => {
    const m = frameMotion(view(160, 90, 0, 0), view(160, 90, 3, -2));
    expect(m.dx).toBeCloseTo(3, 0);
    expect(m.dy).toBeCloseTo(-2, 0);
    expect(m.a).toBeCloseTo(0, 2);
    expect(m.s).toBeCloseTo(1, 2);
  });

  it('reads a small turn', () => {
    const m = frameMotion(view(200, 120, 0, 0), view(200, 120, 0, 0, 0.02));
    expect(m.a).toBeCloseTo(0.02, 2);
  });

  it('locks a shot where it starts, and starts again at a cut', () => {
    const moves = [{ dx: 2, dy: 0, a: 0, s: 1 }, { dx: 2, dy: 1, a: 0, s: 1 }, { dx: 5, dy: 0, a: 0, s: 1 }];
    const c = corrections(moves, 100, 50, null, [false, false, false, true]);
    expect(c.map((x) => [+x.x.toFixed(3), +x.y.toFixed(3)])).toEqual([[0, 0], [-0.02, 0], [-0.04, -0.02], [0, 0]]);
  });

  it('smooths a shake and keeps a steady pan', () => {
    // a pan of 2 px a frame with a shake of ±3 px on top
    const moves = Array.from({ length: 40 }, (_, i) => ({ dx: 2 + (i % 2 ? 6 : -6), dy: 0, a: 0, s: 1 }));
    const c = corrections(moves, 100, 100, 4);
    const middle = c.slice(10, 30).map((x) => Math.abs(x.x * 100));
    // the shake taken out (about 3 px each way), the pan left in (no drift)
    expect(Math.max(...middle)).toBeLessThan(4);
    expect(Math.max(...middle)).toBeGreaterThan(2);
  });

  it('zooms just enough to keep the edges out, for the whole clip', () => {
    expect(coverZoom([{ x: 0, y: 0, a: 0, s: 1 }], 100, 100)).toBe(1);
    // moved 5 % to the right: 10 % of zoom covers it
    expect(coverZoom([{ x: 0.05, y: 0, a: 0, s: 1 }, { x: -0.02, y: 0, a: 0, s: 1 }], 100, 100)).toBeCloseTo(1.111, 2);
    expect(coverZoom([{ x: 0.4, y: 0, a: 0, s: 1 }], 100, 100)).toBe(1.5);
  });

  it('reads the correction between two looks', () => {
    const s: Stabilization = { version: 1, kind: 'stabilize', width: 100, height: 100, zoom: 1.1, frames: [{ t: 0, x: 0, y: 0, a: 0, s: 1 }, { t: 1, x: 0.1, y: -0.1, a: 0.02, s: 1 }] };
    expect(correctionAt(s, 0.5)).toEqual({ x: 0.05, y: -0.05, a: 0.01, s: 1 });
    expect(correctionAt(s, 5)).toEqual({ x: 0, y: 0, a: 0, s: 1 });
  });
});
