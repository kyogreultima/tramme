import { describe, expect, it } from 'vitest';
import { getProject, listProjects } from '../src/lib/gallery';

describe('the gallery', () => {
  it('lists the seed projects, most recent first', async () => {
    const list = await listProjects();
    expect(list.map((p) => p.id)).toEqual(['launch-film', 'anime', 'showreel']);
    expect(list.every((p) => p.author.name === 'Tramme')).toBe(true);
  });

  it('honours the limit', async () => {
    expect(await listProjects({ limit: 2 })).toHaveLength(2);
    expect(await listProjects({ limit: 0 })).toHaveLength(0);
  });

  it('invents no view count, so the popular sort is the recent one', async () => {
    expect((await listProjects()).every((p) => p.views === undefined)).toBe(true);
    expect(await listProjects({ sort: 'popular' })).toEqual(await listProjects());
  });

  it('finds a project by id, and none for an unknown id', async () => {
    expect((await getProject('anime'))?.title).toBeTruthy();
    expect(await getProject('nope')).toBeUndefined();
  });

  it('gives each project a video and a poster', async () => {
    for (const p of await listProjects()) {
      expect(p.video.webm ?? p.video.mp4, p.id).toBeTruthy();
      expect(p.poster, p.id).toBeTruthy();
    }
  });
});
