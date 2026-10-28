import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrammeDoc } from '@tramme/core';
import { AssetStore } from '../src/assets.ts';

const doc = (): TrammeDoc => ({
  schema: 'tramme/1', meta: { title: 't' }, tokens: {}, root: 'main',
  assets: {
    ok: { type: 'json', src: 'data/ok.json' },
    gone: { type: 'json', src: 'data/gone.json' },
    lost: { type: 'json', src: 'data/lost.json' },
    voice: { type: 'audio', src: 'data/voice.wav' },
    here: { type: 'audio', src: 'data/here.wav' },
  },
  compositions: { main: { name: 'Main', width: 64, height: 36, fps: 30, duration: 1, layers: {}, order: [] } },
});

let present: Set<string>;
const fetched: string[] = [];
beforeEach(() => {
  present = new Set(['ok', 'here']);
  fetched.length = 0;
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } });
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    const name = /data\/(\w+)\.\w+/.exec(url)![1];
    return present.has(name) ? { ok: true, status: 200, json: async () => ({ name }) } : { ok: false, status: 404 };
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('media whose file is missing', () => {
  it('in the preview they are listed offline while the others load', async () => {
    const store = new AssetStore(doc(), 'http://host/doc.json');
    await store.sync(doc(), [], true);
    expect(store.has('ok')).toBe(true);
    expect([...store.offline.keys()]).toEqual(['gone', 'lost', 'voice']);
    expect(store.offline.get('gone')).toMatch(/HTTP 404/);
  });

  it('in an export they stop it, all of them named at once', async () => {
    const store = new AssetStore(doc(), 'http://host/doc.json');
    await expect(store.sync(doc())).rejects.toThrow(/"gone".*data\/gone\.json[\s\S]*"lost".*data\/lost\.json/);
  });

  it('are not asked for again at every edit, but are once reloaded, and come back when their file does', async () => {
    const store = new AssetStore(doc(), 'http://host/doc.json');
    await store.sync(doc(), [], true);
    const first = fetched.length;
    await store.sync(doc(), [], true);
    expect(fetched.length).toBe(first);
    present.add('gone');
    await store.sync(doc(), ['gone'], true);
    expect(store.has('gone')).toBe(true);
    expect([...store.offline.keys()]).toEqual(['lost', 'voice']);
  });

  it('leave the list when their asset is removed from the project', async () => {
    const store = new AssetStore(doc(), 'http://host/doc.json'), d = doc();
    await store.sync(d, [], true);
    delete d.assets.lost;
    await store.sync(d, [], true);
    expect([...store.offline.keys()]).toEqual(['gone', 'voice']);
  });

  it('a sound is checked too: its file is asked for in a word, not downloaded', async () => {
    const store = new AssetStore(doc(), 'http://host/doc.json');
    await store.sync(doc(), [], true);
    expect(store.has('here')).toBe(true);
    expect(store.offline.has('voice')).toBe(true);
    expect(store.offline.get('voice')).toMatch(/HTTP 404/);
  });
});
