// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { api } from '../src/api.ts';

describe('editor project file URLs', () => {
  it('cancels an oversized plugin library response before decoding it', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(1025)); }, cancel,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    try {
      await expect(api.libraryGet('large.js', 1024)).rejects.toThrow('library file exceeds');
      expect(cancel).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
  it('keeps valid document, chat and version paths inside the file route', () => {
    expect(api.fileUrl('project-123', 'document.tramme.json')).toBe('/api/projects/project-123/files/document.tramme.json');
    expect(api.fileUrl('project-123', '.tramme/chats/index.json')).toBe('/api/projects/project-123/files/.tramme/chats/index.json');
    expect(api.fileUrl('project-123', 'versions/index.json')).toBe('/api/projects/project-123/files/versions/index.json');
  });

  it('refuses traversal and URL-like paths before read, write or upload requests', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      for (const path of ['../export', 'assets/../../private.json', 'https://tramme.test/api/private']) {
        expect(() => api.fileUrl('project-123', path)).toThrow();
        await expect(api.readText('project-123', path)).rejects.toThrow();
        expect(() => api.write('project-123', path, '{}')).toThrow();
        await expect(api.writeAny('project-123', path, new Blob(['x']))).rejects.toThrow();
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
