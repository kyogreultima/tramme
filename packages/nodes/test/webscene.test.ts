import { describe, expect, it } from 'vitest';
import { webscene } from '../src/webscene.ts';

describe('web scene layer', () => {
  it('reports missing capture instead of drawing a blank layer', () => {
    const draw = webscene.render!.canvas2d!;
    const props = { folder: 'scenes/title', frames: [], fps: 30, size: [320, 180] as [number, number] };
    expect(() => draw({} as CanvasRenderingContext2D, props, { t: 0 } as never)).toThrow('web scene scenes/title has no captured frames');
  });
});
