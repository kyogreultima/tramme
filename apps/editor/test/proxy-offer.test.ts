import { describe, expect, it } from 'vitest';
import type { TrammeDoc } from '@tramme/core';
import { oversized, readsOf } from '../src/proxy.ts';

const take = (inT: number, outT: number, extra: Record<string, unknown> = {}) => ({ type: 'video', in: inT, out: outT, props: { video: 'take' }, ...extra });

const doc = (layers: Record<string, unknown>, height = 1080) => ({
  schema: 'tramme/1', root: 'main', assets: { take: { type: 'video', src: 'assets/take.mp4' } },
  compositions: { main: { width: 1920, height, fps: 24, duration: 22, layers, order: Object.keys(layers) } },
}) as unknown as TrammeDoc;

describe('when a proxy is offered', () => {
  it('counts the layers reading one video at the same moment: a soft cut reads it twice', () => {
    // cuts end to end: one read at a time
    expect(readsOf(doc({ a: take(0, 2), b: take(2, 4) }), 'take')).toEqual({ reads: 1, filmHeight: 1080 });
    // a soft cut over the cut, and an ungraded copy under the first shot
    expect(readsOf(doc({ a: take(0, 2), b: take(2, 4), soft: take(1.6, 2.2), before: take(0, 1.7) }), 'take').reads).toBe(3);
    // a hidden layer reads nothing
    expect(readsOf(doc({ a: take(0, 2), soft: take(1, 3, { visible: false }) }), 'take').reads).toBe(1);
    // a video no layer shows
    expect(readsOf(doc({}), 'take')).toEqual({ reads: 0, filmHeight: 0 });
  });

  it('finds a 4K take oversized for a 1080p film, not a 1080p one, nor one no film shows', () => {
    expect(oversized(2160, 1080)).toBe(true);
    expect(oversized(1080, 1080)).toBe(false);
    expect(oversized(1440, 1080)).toBe(false);
    expect(oversized(2160, 0)).toBe(false);
  });
});
