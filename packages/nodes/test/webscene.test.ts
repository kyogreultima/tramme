import { describe, expect, it } from 'vitest';
import { setWebScenePlaceholder, setWebSceneSource, webscene } from '../src/webscene.ts';

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
    // a scene the editor shows live is drawn as nothing
    calls.length = 0;
    setWebScenePlaceholder(() => null);
    try { draw(ctx, props, { t: 0 } as never); } finally { setWebScenePlaceholder(null); }
    expect(calls).toEqual([]);
  });
});

describe('web scene drawn from its own frame', () => {
  const props = { folder: 'scenes/title', frames: [], fps: 30, size: [320, 180] as [number, number], $params: { tone: 'warm' } };
  it("draws the picture the source gives, defers while it comes, fails with the scene's error, and falls back without a source", () => {
    const calls: unknown[][] = [];
    const ctx = { drawImage: (...args: unknown[]) => calls.push(args) } as unknown as CanvasRenderingContext2D;
    const draw = webscene.render!.canvas2d!;
    const picture = { width: 320 } as unknown as CanvasImageSource, wait = Promise.resolve(), deferred: unknown[] = [];
    const asked: unknown[] = [];
    let give: unknown = picture;
    setWebSceneSource((ask) => { asked.push(ask); return give as never; });
    try {
      draw(ctx, props, { t: 1.5 } as never);
      expect(asked).toEqual([{ folder: 'scenes/title', t: 1.5, size: [320, 180], params: { tone: 'warm' } }]);
      expect(calls).toEqual([[picture, -160, -90, 320, 180]]);
      give = wait;
      draw(ctx, props, { t: 1.5, defer: (p: unknown) => deferred.push(p) } as never);
      expect(deferred).toEqual([wait]);
      give = new Error('the page threw');
      expect(() => draw(ctx, props, { t: 1.5 } as never)).toThrow('web scene scenes/title: the page threw');
      give = null;
      expect(() => draw(ctx, props, { t: 1.5 } as never)).toThrow('has no captured frames');
    } finally { setWebSceneSource(null); }
  });

  it('draws the last picture while the new one comes, and the placeholder before the first', () => {
    const calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_t, key) => (typeof key === 'string' && ['drawImage', 'fillText'].includes(key) ? (...args: unknown[]) => calls.push([key, args[0]]) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D;
    const draw = webscene.render!.canvas2d!;
    const last = { width: 320 } as unknown as CanvasImageSource, wait = Promise.resolve(), deferred: unknown[] = [];
    let give: unknown = { last, wait };
    setWebSceneSource(() => give as never);
    setWebScenePlaceholder((folder) => `${folder} is loading`);
    try {
      draw(ctx, props, { t: 2, defer: (p: unknown) => deferred.push(p) } as never);
      expect(calls).toEqual([['drawImage', last]]);
      give = { last: null, wait };
      draw(ctx, props, { t: 2, defer: (p: unknown) => deferred.push(p) } as never);
      expect(calls[1]).toEqual(['fillText', 'scenes/title is loading']);
      expect(deferred).toEqual([wait, wait]);
    } finally { setWebSceneSource(null); setWebScenePlaceholder(null); }
  });
});
