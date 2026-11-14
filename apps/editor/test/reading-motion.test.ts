import { describe, expect, it } from 'vitest';
import { cameraMove, crop, shotCamera } from '../src/reading/motion.ts';
import type { Pixels } from '../src/flow.ts';

/** a plaid texture with no repeat a block could mistake: stripes of two periods on each axis */
const plaid = (x: number, y: number) => ((x % 24 < 12 ? 160 : 40) + (x % 10 < 5 ? 40 : 0) + (y % 18 < 9 ? 30 : 0) + (y % 7 < 3 ? 20 : 0));
const paint = (w: number, h: number, v: (x: number, y: number) => number): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, g = v(x, y);
    data[i] = data[i + 1] = data[i + 2] = g;
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
};
const W = 160, H = 160;
/** the texture seen through a camera at a scale around the centre, shifted by (sx, sy) */
const view = (scale: number, sx = 0, sy = 0) => paint(W, H, (x, y) => plaid(Math.round((x - W / 2) / scale + W / 2 + 400 + sx), Math.round((y - H / 2) / scale + H / 2 + 400 + sy)));

describe('the camera of a reference, from its pixels', () => {
  it('crops a picture', () => {
    const p = paint(4, 2, (x, y) => x + 10 * y);
    expect([...crop(p, 1, 1, 2, 1).data].filter((_, i) => i % 4 === 0)).toEqual([11, 12]);
  });

  it('reads a push-in and a pull-out', () => {
    expect(cameraMove(view(1), view(1.08), 0.2, 1920)).toMatchObject({ kind: 'push-in', direction: 'in' });
    expect(cameraMove(view(1.08), view(1), 0.2, 1920)).toMatchObject({ kind: 'pull-out', direction: 'out' });
  });

  it('reads a pan and a tilt, the camera going against the pixels', () => {
    expect(cameraMove(view(1), view(1, 8), 0.2, 1920)).toMatchObject({ kind: 'pan', direction: 'right' });
    expect(cameraMove(view(1), view(1, 0, -8), 0.2, 1920)).toMatchObject({ kind: 'tilt', direction: 'up' });
  });

  // flat graphics: a ground, an outline near the frame's edge, a block in the middle
  const graphic = (scale: number, box = { x: 70, y: 60, s: 20 }) => paint(W, H, (x, y) => {
    // the whole picture seen through the camera's zoom: its outline and its block
    const u = (x - W / 2) / scale + W / 2, v = (y - H / 2) / scale + H / 2;
    const edge = (Math.abs(u - 16) < 3 || Math.abs(u - 144) < 3) && v > 13 && v < 147 || (Math.abs(v - 16) < 3 || Math.abs(v - 144) < 3) && u > 13 && u < 147;
    if (edge) return 120;
    if (u >= box.x && u < box.x + box.s && v >= box.y && v < box.y + box.s) return 230;
    return 20;
  });

  it('reads a push-in on flat graphics, where blocks find nothing', () => {
    expect(cameraMove(graphic(1), graphic(1.1), 0.6, 1920)).toMatchObject({ kind: 'push-in' });
  });

  it('takes an element moving over a still ground for no camera', () => {
    expect(cameraMove(graphic(1, { x: 50, y: 60, s: 20 }), graphic(1, { x: 62, y: 60, s: 20 }), 0.1, 1920)).toBeNull();
  });

  it('prefers a zoom read on the wide pair, a pan on the close one', () => {
    expect(shotCamera([view(1), view(1.1), 0.6], [view(1), view(1.01), 0.1], 1920)).toMatchObject({ kind: 'push-in' });
    expect(shotCamera([view(1), view(1, 20), 0.6], [view(1), view(1, 4), 0.1], 1920)).toMatchObject({ kind: 'pan', direction: 'right' });
    expect(shotCamera(null, null, 1920)).toBeNull();
  });

  it('says nothing of a camera that holds', () => {
    expect(cameraMove(view(1), view(1), 0.2, 1920)).toBeNull();
    expect(cameraMove(view(1), view(1), 0, 1920)).toBeNull();
  });
});
