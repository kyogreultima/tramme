import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProject, listProjects, type PublicProject } from '../src/lib/gallery';
import { APP } from '../src/lib/links';

const film = (id: string, publishedAt: string, views?: number): PublicProject => ({
  id, title: id, description: '', author: { name: 'Ada', handle: 'ada' },
  video: { mp4: `/api/gallery/${id}/video.mp4` }, poster: `/api/gallery/${id}/poster.webp`,
  width: 1920, height: 1080, duration: 10, reusable: true, publishedAt, views,
});

/** the app's gallery answering with these films, or failing */
function app(films: PublicProject[] | 'down') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (films === 'down') throw new Error('offline');
    const path = url.slice(APP.length);
    if (path.startsWith('/api/gallery?')) return Response.json(films);
    const one = films.find((f) => path === `/api/gallery/${f.id}`);
    return one ? Response.json(one) : new Response('{}', { status: 404 });
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('the gallery', () => {
  it('lists only what the community published, most recent first', async () => {
    app([film('aaaaaaaaaaaa', '2026-11-01'), film('bbbbbbbbbbbb', '2026-11-20')]);
    expect((await listProjects()).map((p) => p.id)).toEqual(['bbbbbbbbbbbb', 'aaaaaaaaaaaa']);
  });

  it('shows nothing when nothing is published or the app does not answer', async () => {
    app([]);
    expect(await listProjects()).toEqual([]);
    app('down');
    expect(await listProjects()).toEqual([]);
    expect(await getProject('aaaaaaaaaaaa')).toBeUndefined();
  });

  it('honours the limit and sorts by views once they are counted', async () => {
    app([film('aaaaaaaaaaaa', '2026-11-01', 9), film('bbbbbbbbbbbb', '2026-11-20', 2)]);
    expect(await listProjects({ limit: 1 })).toHaveLength(1);
    expect((await listProjects({ sort: 'popular' })).map((p) => p.id)).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
  });

  it('finds a film by id at the app\'s address, and none for an id the gallery cannot give', async () => {
    app([film('aaaaaaaaaaaa', '2026-11-01')]);
    const p = await getProject('aaaaaaaaaaaa');
    expect(p?.video.mp4).toBe(`${APP}/api/gallery/aaaaaaaaaaaa/video.mp4`);
    expect(p?.poster).toBe(`${APP}/api/gallery/aaaaaaaaaaaa/poster.webp`);
    expect(await getProject('anime')).toBeUndefined();
    expect(await getProject('zzzzzzzzzzzz')).toBeUndefined();
  });
});
