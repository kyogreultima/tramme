import { describe, expect, it } from 'vitest';
import type { Host } from '@tramme/core';
import { video } from '../src/video.ts';

/** what the node asks of a 2D context: the picture's rectangle and the clip */
function draw(props: Record<string, unknown>, file: { width: number; height: number }, t = 0) {
  const drawn: number[][] = [], clips: number[][] = [], asked: number[] = [];
  const ctx = {
    beginPath() {}, clip() {},
    rect: (...r: number[]) => clips.push(r),
    drawImage: (_img: unknown, ...r: number[]) => drawn.push(r),
  } as unknown as CanvasRenderingContext2D;
  const host = {
    t, layerIn: 0,
    asset: () => ({ width: file.width, height: file.height, frameAt: (at: number) => { asked.push(at); return { image: {}, exact: true }; } }),
  } as unknown as Host;
  const p = { video: 'clip', start: 0, rate: 1, loop: false, loopEnd: 0, size: [640, 360], fit: 'cover', focus: [0.5, 0.5], ...props };
  video.render.canvas2d!(ctx, p as never, host);
  return { drawn, clips, asked };
}

describe('a video layer', () => {
  it('draws its picture centred on the layer, inside its frame', () => {
    // a file of the frame's own shape (an imported video): exactly over its frame
    const { drawn, clips } = draw({}, { width: 640, height: 360 });
    expect(drawn).toEqual([[-320, -180, 640, 360]]);
    expect(clips).toEqual([[-320, -180, 640, 360]]);
    // a wider file, cropped: centred, its sides past the frame
    const [[x, y, w, h]] = draw({}, { width: 1920, height: 720 }).drawn;
    expect(x + w / 2).toBeCloseTo(0);
    expect(y).toBeCloseTo(-180);
    expect(h).toBeCloseTo(360);
  });

  it('plays its file at its own clock: start, speed, loop', () => {
    expect(draw({ start: 2, rate: 2 }, { width: 640, height: 360 }, 3).asked).toEqual([8]);
    expect(draw({ start: 1, loop: true, loopEnd: 3 }, { width: 640, height: 360 }, 5).asked[0]).toBeCloseTo(2);
  });

  it('moves its picture back by its stabilisation, zoomed to keep the edges out', () => {
    const calls: string[] = [];
    const ctx = {
      beginPath() {}, clip() {}, rect() {}, drawImage() { calls.push('draw'); },
      scale: (x: number, y: number) => calls.push(`scale ${x} ${y}`),
      translate: (x: number, y: number) => calls.push(`translate ${+x.toFixed(2)} ${+y.toFixed(2)}`),
      rotate: (a: number) => calls.push(`rotate ${a}`),
    } as unknown as CanvasRenderingContext2D;
    const stab = { version: 1, kind: 'stabilize', width: 640, height: 360, zoom: 1.1, frames: [{ t: 0, x: 0.1, y: 0, a: 0.02, s: 1 }, { t: 2, x: 0.1, y: 0, a: 0.02, s: 1 }] };
    const host = {
      t: 1, layerIn: 0,
      asset: (id: string) => (id === 'stab' ? stab : { width: 640, height: 360, frameAt: () => ({ image: {}, exact: true }) }),
    } as unknown as Host;
    const p = { video: 'clip', stabilize: 'stab', start: 0, rate: 1, loop: false, loopEnd: 0, size: [640, 360], fit: 'cover', focus: [0.5, 0.5] };
    video.render.canvas2d!(ctx, p as never, host);
    // the zoom, then the picture moved by 10 % of its width and turned about its centre
    expect(calls).toEqual(['scale 1.1 1.1', 'translate 64 0', 'rotate 0.02', 'scale 1 1', 'translate 0 0', 'draw']);
  });
});
