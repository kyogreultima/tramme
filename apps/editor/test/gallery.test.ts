// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canPublishExport, myFilms } from '../src/gallery.ts';

afterEach(() => vi.unstubAllGlobals());

describe('gallery publishing', () => {
  it('offers the real publish action for a signed-in MP4 export on web or desktop', () => {
    expect(canPublishExport('film.mp4', true)).toBe(true);
    expect(canPublishExport('film.MP4', true)).toBe(true);
    expect(canPublishExport('film.gif', true)).toBe(false);
    expect(canPublishExport('film.mp4', false)).toBe(false);
  });

  it('reports an unavailable publication list instead of pretending it is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'gallery offline' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })));
    await expect(myFilms()).rejects.toThrow('gallery offline');
  });
});
