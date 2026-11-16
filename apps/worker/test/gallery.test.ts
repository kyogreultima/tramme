import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryRecords, recordBucket, signEdge } from '@tramme/api';
import worker from '../src/index.ts';
import type { Env } from '../src/http.ts';

const APP = 'https://app.example';
const SECRET = 'edge-secret';
const A = { userId: 'ua', workspaceId: 'aaaaaaaaaaaa', sessionVersion: 1 };
const B = { userId: 'ub', workspaceId: 'bbbbbbbbbbbb', sessionVersion: 1 };

function setup(over: Record<string, string> = {}) {
  const files = recordBucket(memoryRecords());
  const env = {
    MODE: 'personal', APP_ORIGIN: APP, VAULT_ORIGIN: 'https://vault.example',
    ASSETS: { fetch: async () => new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html' } }) },
    ACCOUNTS_URL: 'http://backend.test', FILES: files, EDGE_SECRET: SECRET, INTERNAL_SECRET: 'i', KEYS_SECRET: 'k', ...over,
  } as unknown as Env;
  return { env, files };
}
const as = async (who: typeof A, plan: 'basic' | 'plus' = 'basic') => `__Host-tramme-edge=${await signEdge({ ...who, plan }, SECRET)}`;
const call = (env: Env, path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  return worker.fetch(new Request(`${APP}${path}`, { ...init, headers }), env);
};

/** the backend's profile route, the only one the gallery asks */
const backend = () => vi.stubGlobal('fetch', async (input: Request) => {
  const { userId } = await input.json() as { userId: string };
  return Response.json({ name: userId === 'ua' ? 'Ada' : 'Bea', handle: userId === 'ua' ? 'ada' : 'bea' });
});

async function publish(env: Env, cookie: string, project: string, meta: Record<string, unknown> = {}) {
  await call(env, `/api/gallery/mine/${project}/video.mp4`, { method: 'PUT', body: new Uint8Array(1000).fill(7), cookie });
  await call(env, `/api/gallery/mine/${project}/poster.webp`, { method: 'PUT', body: 'still', cookie });
  await call(env, `/api/gallery/mine/${project}/project.tramme`, { method: 'PUT', body: 'zip', cookie });
  return call(env, `/api/gallery/mine/${project}`, { method: 'POST', body: JSON.stringify({ title: 'Film', description: 'Words', width: 1920, height: 1080, duration: 12, reusable: true, ...meta }), cookie });
}

afterEach(() => vi.unstubAllGlobals());

describe('worker: the gallery', () => {
  it('publishes a film, signed by its author, and shows it to everyone, signed in or not', async () => {
    const { env } = setup();
    backend();
    const res = await publish(env, await as(A), 'my-film-123');
    expect(res.status).toBe(201);
    const film = await res.json() as { id: string; author: { handle: string }; video: { mp4: string } };
    expect(film.author).toEqual({ name: 'Ada', handle: 'ada' });
    const list = await (await call(env, '/api/gallery')).json() as { id: string }[];
    expect(list.map((p) => p.id)).toEqual([film.id]);
    expect(((await (await call(env, `/api/gallery/${film.id}`)).json()) as { title: string }).title).toBe('Film');
    // the film is read in parts, as a video element asks
    const part = await call(env, `/api/gallery/${film.id}/video.mp4`, { headers: { range: 'bytes=0-99' } });
    expect(part.status).toBe(206);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    expect((await call(env, `/api/gallery/${film.id}/project.tramme`)).status).toBe(200);
  });

  it('keeps an unlisted film out of the listing, reachable by its link', async () => {
    const { env } = setup();
    backend();
    const film = await (await publish(env, await as(A), 'quiet-film', { visibility: 'unlisted' })).json() as { id: string };
    expect(await (await call(env, '/api/gallery')).json()).toEqual([]);
    expect((await call(env, `/api/gallery/${film.id}`)).status).toBe(200);
  });

  it('gives the archive only when the author allows copying', async () => {
    const { env } = setup();
    backend();
    const film = await (await publish(env, await as(A), 'kept-film', { reusable: false })).json() as { id: string };
    expect((await call(env, `/api/gallery/${film.id}/project.tramme`)).status).toBe(404);
  });

  it('refuses a film without its video or still, and lists what one published', async () => {
    const { env } = setup();
    backend();
    const cookie = await as(A);
    expect((await call(env, '/api/gallery/mine/empty-one', { method: 'POST', body: JSON.stringify({ title: 'X', width: 1, height: 1, duration: 1 }), cookie })).status).toBe(400);
    await publish(env, cookie, 'my-film-123');
    const mine = await (await call(env, '/api/gallery/mine', { cookie })).json() as { project: string }[];
    expect(mine.map((m) => m.project)).toEqual(['my-film-123']);
    expect(await (await call(env, '/api/gallery/mine', { cookie: await as(B) })).json()).toEqual([]);
  });

  it('unpublishes: the film and its files go', async () => {
    const { env, files } = setup();
    backend();
    const cookie = await as(A);
    const film = await (await publish(env, cookie, 'my-film-123')).json() as { id: string };
    expect((await call(env, '/api/gallery/mine/my-film-123', { method: 'DELETE', cookie })).status).toBe(204);
    expect((await call(env, `/api/gallery/${film.id}`)).status).toBe(404);
    expect((await files.list({ prefix: 'gallery/' })).objects).toEqual([]);
  });

  it('takes reports', async () => {
    const { env, files } = setup();
    backend();
    const film = await (await publish(env, await as(A), 'my-film-123')).json() as { id: string };
    expect((await call(env, `/api/gallery/${film.id}/report`, { method: 'POST', body: JSON.stringify({ reason: 'not mine' }) })).status).toBe(204);
    expect((await files.list({ prefix: `gallery/reports/${film.id}/` })).objects).toHaveLength(1);
  });

  it('keeps unlisted films to the plans with private projects, once the limits are on', async () => {
    const { env } = setup({ PLAN_LIMITS: 'on' });
    backend();
    const refused = await publish(env, await as(A, 'basic'), 'quiet-film', { visibility: 'unlisted' });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: 'plan_limit', limit: 'privateProjects' });
    expect((await publish(env, await as(B, 'plus'), 'quiet-film', { visibility: 'unlisted' })).status).toBe(201);
  });

  it('asks a signed-out page to sign in for its own films', async () => {
    const { env } = setup();
    expect((await call(env, '/api/gallery/mine')).status).toBe(401);
  });
});
