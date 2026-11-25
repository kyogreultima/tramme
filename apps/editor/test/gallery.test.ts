// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canPublishExport, galleryNeeds, myFilms, publishedAs } from '../src/gallery.ts';

afterEach(() => vi.unstubAllGlobals());

describe('gallery publishing', () => {
  it('offers the real publish action for a signed-in MP4 export on web or desktop', () => {
    expect(canPublishExport('film.mp4', true)).toBe(true);
    expect(canPublishExport('film.MP4', true)).toBe(true);
    expect(canPublishExport('film.gif', true)).toBe(false);
    expect(canPublishExport('film.mp4', false)).toBe(false);
  });

  it('says what is missing before the export, the first thing first', () => {
    expect(galleryNeeds('unavailable', 'mp4', null)).toBeNull();
    expect(galleryNeeds('out', 'gif', null)).toBe('account');
    expect(galleryNeeds('in', 'gif', null)).toBe('mp4');
    expect(galleryNeeds('in', 'mp4', null)).toBe('export');
    expect(galleryNeeds('in', 'gif', 'film.mp4')).toBe('ready');
    expect(galleryNeeds('in', 'gif', 'film.gif')).toBe('mp4');
  });

  it('publishes a project under one name from the desktop app and the web', () => {
    expect(publishedAs('cloud--film-a1b2c3')).toBe('film-a1b2c3');
    expect(publishedAs('film-a1b2c3')).toBe('film-a1b2c3');
  });

  it('reports an unavailable publication list instead of pretending it is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'gallery offline' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })));
    await expect(myFilms()).rejects.toThrow('gallery offline');
  });
});
