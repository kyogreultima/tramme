// The browser exporters' asset reads: an isolated conversion reads the
// project's own files only, and no file past its ceiling.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';
import { fetchAssetFiles } from '../src/index.ts';

describe('asset reads for a conversion', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads approved files only, and leaves out a file over its limit before buffering it', async () => {
    const doc = newProject({ name: 'Reads', width: 10, height: 10, fps: 1, duration: 1 }).doc;
    doc.assets.own = { type: 'font', src: 'assets/own.woff2' };
    doc.assets.big = { type: 'font', src: 'assets/big.woff2' };
    doc.assets.secret = { type: 'json', src: '/api/private' };
    const asked: string[] = [];
    let pulled = 0;
    vi.stubGlobal('fetch', async (url: URL) => {
      asked.push(url.pathname);
      if (url.pathname.endsWith('big.woff2')) {
        // an endless body: only the bytes up to the limit are ever pulled
        return new Response(new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } }));
      }
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const root = '/p/1/';
    const files = await fetchAssetFiles(doc, 'https://tramme.test/p/1/document.tramme.json', {
      approve: (url) => url.origin === 'https://tramme.test' && url.pathname.startsWith(root), limit: 4096,
    });
    expect([...files.keys()]).toEqual(['own']);
    expect(asked.sort()).toEqual(['/p/1/assets/big.woff2', '/p/1/assets/own.woff2']);
    expect(pulled).toBeLessThan(10);
  });
});
