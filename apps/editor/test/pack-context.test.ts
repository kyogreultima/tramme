import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@tramme/core';
import { packAsInstalled, packContext } from '../src/packs.ts';

describe('shipped pack file capability', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reads a pack file and refuses URL escape syntax before any request', async () => {
    const fetch = vi.fn(async () => new Response('pack data'));
    vi.stubGlobal('location', { href: 'https://editor.test/project/document.tramme.json' });
    vi.stubGlobal('fetch', fetch);
    const read = packContext({ file: 'icons.js', name: 'Icons' }, {} as ToolContext).packFile!;
    expect(await read('lucide.json')).toBe('pack data');
    expect(fetch).toHaveBeenCalledWith(new URL('https://editor.test/plugins/icons/lucide.json'));
    for (const path of ['../index.json', '%2e%2e/index.json', 'a?b', 'a#b', '/api/private', 'a//b', 'a/./b', 'a\\b'])
      await expect(read(path)).rejects.toThrow('invalid pack file path');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a forged pack module and cancels oversized data', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); },
      cancel,
    });
    const fetch = vi.fn(async () => new Response(body));
    vi.stubGlobal('location', { href: 'https://editor.test/' });
    vi.stubGlobal('fetch', fetch);
    expect(() => packContext({ file: '../private.js', name: 'Private' }, {} as ToolContext)).toThrow('invalid pack module');
    await expect(packAsInstalled({ file: '../private.js', name: 'Private' })).rejects.toThrow('invalid pack module');
    const read = packContext({ file: 'icons.js', name: 'Icons' }, {} as ToolContext).packFile!;
    await expect(read('lucide.json')).rejects.toThrow('pack file exceeds 8 MB');
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('caps a pack module before decoding it into the trusted editor', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    await expect(packAsInstalled({ file: 'icons.js', name: 'Icons' })).rejects.toThrow('pack module exceeds 1 MB');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
