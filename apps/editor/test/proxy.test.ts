import { describe, expect, it } from 'vitest';
import { AssetStore } from '@tramme/render';
import type { TrammeDoc } from '@tramme/core';
import { playsPoorly, proxySize } from '../src/proxy.ts';

describe('proxies', () => {
  it('are 540 lines, in the picture’s proportions, even sides; none for a file already small', () => {
    expect(proxySize(3840, 2160)).toEqual([960, 540]);
    expect(proxySize(2160, 3840)).toEqual([304, 540]);
    expect(proxySize(1080, 1350, 540)).toEqual([432, 540]);
    expect(proxySize(1280, 720)).toEqual([960, 540]);
    expect(proxySize(960, 540)).toBeNull();
  });

  it('are offered when this machine decodes a file slower than it plays', () => {
    expect(playsPoorly(25, 30)).toBe(true);
    expect(playsPoorly(34, 30)).toBe(true);
    expect(playsPoorly(120, 60)).toBe(false);
  });

  it('play in the preview only, and only when the setting asks', () => {
    const doc = { assets: { take: { type: 'video', src: 'take.mp4', proxy: 'small' }, small: { type: 'video', src: 'small.mp4' }, other: { type: 'video', src: 'other.mp4' } } } as unknown as TrammeDoc;
    const store = new AssetStore(doc, 'http://x/project/doc.json') as unknown as { useProxies: boolean; proxyOf(a: unknown): string | null; keyOf(a: unknown): string };
    expect(store.proxyOf(doc.assets.take)).toBeNull();
    store.useProxies = true;
    expect(store.proxyOf(doc.assets.take)).toBe('small');
    expect(store.proxyOf(doc.assets.other)).toBeNull();
    // the switch changes what the asset is kept under: it opens again
    store.useProxies = false;
    const off = store.keyOf(doc.assets.take);
    store.useProxies = true;
    expect(store.keyOf(doc.assets.take)).not.toBe(off);
  });
});
