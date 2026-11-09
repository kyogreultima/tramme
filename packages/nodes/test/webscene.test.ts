import { describe, expect, it } from 'vitest';
import { setWebScenePlaceholder, webscene } from '../src/webscene.ts';

describe('web scene layer', () => {
  it('reports missing capture instead of drawing a blank layer', () => {
    const draw = webscene.render!.canvas2d!;
    const props = { folder: 'scenes/title', frames: [], fps: 30, size: [320, 180] as [number, number] };
    expect(() => draw({} as CanvasRenderingContext2D, props, { t: 0 } as never)).toThrow('web scene scenes/title has no captured frames');
  });
});

describe('web scene stand-in', () => {
  const props = { folder: 'scenes/title', frames: [], fps: 30, size: [320, 180] as [number, number] };
  it('draws a labelled stand-in only where the editor asked for one, and exports still fail', () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, key) => (typeof key === 'string' && ['fillRect', 'fillText'].includes(key) ? (...args: unknown[]) => calls.push(`${key}:${args.join(',')}`) : undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
    const draw = webscene.render!.canvas2d!;
    setWebScenePlaceholder((folder) => `scene ${folder}`);
    try { draw(ctx, props, { t: 0 } as never); } finally { setWebScenePlaceholder(null); }
    expect(calls).toEqual(['fillRect:-160,-90,320,180', 'fillText:scene scenes/title,0,0,288']);
    expect(() => draw(ctx, props, { t: 0 } as never)).toThrow('has no captured frames');
  });
});
