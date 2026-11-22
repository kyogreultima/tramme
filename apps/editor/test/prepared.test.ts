import { describe, expect, it } from 'vitest';
import type { TrammeDoc } from '@tramme/core';
import { frameKey, overlapFrames, PreparedFrames, prepareOrder, preparedBudget } from '../src/prepared.ts';
import { tapsFor } from '../../../packages/render/src/frame-shrink.ts';

const take = (inT: number, outT: number, extra: Record<string, unknown> = {}) => ({ type: 'video', in: inT, out: outT, props: { video: 'take' }, ...extra });

const doc = (layers: Record<string, unknown>, more: Record<string, unknown> = {}) => ({
  schema: 'tramme/1', root: 'main', assets: { take: { type: 'video', src: 'assets/take.mp4' } },
  compositions: { main: { width: 1920, height: 1080, fps: 10, duration: 4, layers, order: Object.keys(layers) }, ...more },
}) as unknown as TrammeDoc;

/** the document with one layer changed, every other layer the same object (as an edit leaves them) */
const edit = (d: TrammeDoc, id: string, change: Record<string, unknown>): TrammeDoc => {
  const main = d.compositions.main;
  return { ...d, compositions: { ...d.compositions, main: { ...main, layers: { ...main.layers, [id]: { ...main.layers[id], ...change } } } } } as TrammeDoc;
};

/** a picture as the cache holds it */
const picture = (width = 960, height = 540) => {
  const p = { width, height, closed: false, close() { p.closed = true; } };
  return p as unknown as ImageBitmap & { closed: boolean };
};

describe('prepared passages', () => {
  const base = doc({ a: take(0, 2), b: take(1.5, 4), title: { type: 'text', in: 3, out: 4, props: { text: 'End' } } });

  it('keeps a frame prepared when an edit touches another moment, and prepares it again when the edit is there', () => {
    const at = frameKey(base, 'main', 16);
    // the title shows from 3 s: frame 16 (1.6 s) does not show it
    expect(frameKey(edit(base, 'title', { props: { text: 'The end' } }), 'main', 16)).toBe(at);
    // the shot shown at 1.6 s changed
    expect(frameKey(edit(base, 'b', { props: { video: 'take', start: 1 } }), 'main', 16)).not.toBe(at);
    // moved so that it shows there
    expect(frameKey(edit(base, 'title', { in: 1 }), 'main', 16)).not.toBe(at);
    // each frame its own
    expect(frameKey(base, 'main', 17)).not.toBe(at);
  });

  it('follows the layers a shown layer names, even hidden or out of their range, and what lies outside the composition', () => {
    const d = doc({ shot: take(0, 4, { parent: 'rig' }), rig: { type: 'null', in: 3, out: 4, visible: false, props: {} } });
    const at = frameKey(d, 'main', 5);
    expect(frameKey(edit(d, 'rig', { props: { x: 1 } }), 'main', 5)).not.toBe(at);
    // a nested composition, an asset
    expect(frameKey({ ...d, compositions: { ...d.compositions, inner: { width: 10, height: 10, fps: 10, duration: 1, layers: {}, order: [] } } } as unknown as TrammeDoc, 'main', 5)).not.toBe(at);
    expect(frameKey({ ...d, assets: { take: { type: 'video', src: 'assets/other.mp4' } } } as TrammeDoc, 'main', 5)).not.toBe(at);
  });

  it('finds the frames where two visible videos show at once', () => {
    expect(overlapFrames(base, 'main')).toEqual([15, 16, 17, 18, 19]);
    expect(overlapFrames(doc({ a: take(0, 2), b: take(2, 4) }), 'main')).toEqual([]);
    expect(overlapFrames(doc({ a: take(0, 2), b: take(1, 4, { visible: false }) }), 'main')).toEqual([]);
  });

  it('prepares the frames ahead of the playhead first, then those behind, nearest first', () => {
    expect(prepareOrder([1, 9, 5, 6, 2, 5], 5)).toEqual([5, 6, 9, 2, 1]);
  });

  it('gives a picture only for the same document content and the same size, and makes room for no more than its budget', () => {
    const cache = new PreparedFrames(960 * 540 * 4 * 2);
    const p = picture();
    cache.put('main', 16, frameKey(base, 'main', 16), 0.5, p);
    expect(cache.get(base, 'main', 16, 0.5)).toBe(p);
    expect(cache.get(base, 'main', 16, 0.25)).toBeNull();
    expect(cache.get(edit(base, 'b', { out: 3 }), 'main', 16, 0.5)).toBeNull();
    expect(cache.get(edit(base, 'title', { in: 3.5 }), 'main', 16, 0.5)).toBe(p);
    cache.put('main', 17, frameKey(base, 'main', 17), 0.5, picture());
    expect(cache.ahead(base, 'main', 16, 0.5, 5)).toBe(2);
    expect(cache.hasRoom(960 * 540 * 4)).toBe(false);
    // an edit there: the picture goes, its room with it
    cache.prune(edit(base, 'b', { out: 3 }), 0.5);
    expect(p.closed).toBe(true);
    expect(cache.used).toBe(0);
  });

  it('holds a sixteenth of the memory, within 192 and 768 MB', () => {
    expect(preparedBudget(4)).toBe(256 * 1024 * 1024);
    expect(preparedBudget(1)).toBe(192 * 1024 * 1024);
    expect(preparedBudget(32)).toBe(768 * 1024 * 1024);
  });

  it('averages a 4K frame shown at 960 pixels with two taps per axis, each the mean of 2 by 2 texels', () => {
    expect(tapsFor(4)).toBe(2);
    expect(tapsFor(2)).toBe(1);
    expect(tapsFor(3)).toBe(2);
    expect(tapsFor(20)).toBe(4);
  });
});
