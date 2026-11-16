import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryRecords, recordBucket, signEdge } from '@tramme/api';
import worker from '../src/index.ts';
import type { Env } from '../src/http.ts';

const APP = 'https://app.example';
const SECRET = 'edge-secret';
const AUTHOR = { userId: 'ua', workspaceId: 'aaaaaaaaaaaa', sessionVersion: 1 };
const BOSS = { userId: 'ub', workspaceId: 'bbbbbbbbbbbb', sessionVersion: 1, admin: true };

function setup() {
  const files = recordBucket(memoryRecords());
  const env = {
    MODE: 'personal', APP_ORIGIN: APP, VAULT_ORIGIN: 'https://vault.example',
    ASSETS: { fetch: async () => new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html' } }) },
    ACCOUNTS_URL: 'http://backend.test', FILES: files, EDGE_SECRET: SECRET, INTERNAL_SECRET: 'i', KEYS_SECRET: 'k',
  } as unknown as Env;
  return { env, files };
}
const as = async (who: typeof AUTHOR & { admin?: boolean }) => `__Host-tramme-edge=${await signEdge(who, SECRET)}`;
const call = (env: Env, path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  return worker.fetch(new Request(`${APP}${path}`, { ...init, headers }), env);
};

async function published(env: Env) {
  vi.stubGlobal('fetch', async () => Response.json({ name: 'Ada', handle: 'ada' }));
  const cookie = await as(AUTHOR);
  await call(env, '/api/gallery/mine/film-abc/video.mp4', { method: 'PUT', body: 'v', cookie });
  await call(env, '/api/gallery/mine/film-abc/poster.webp', { method: 'PUT', body: 'p', cookie });
  const film = await (await call(env, '/api/gallery/mine/film-abc', { method: 'POST', body: JSON.stringify({ title: 'F', width: 10, height: 10, duration: 1, visibility: 'unlisted' }), cookie })).json() as { id: string };
  await call(env, `/api/gallery/${film.id}/report`, { method: 'POST', body: JSON.stringify({ reason: 'not theirs' }) });
  return film.id;
}

afterEach(() => vi.unstubAllGlobals());

describe('worker: the moderation', () => {
  it('does not exist for someone who is not an admin', async () => {
    const { env } = setup();
    expect((await call(env, '/api/moderation/reports', { cookie: await as(AUTHOR) })).status).toBe(404);
  });

  it('lists the reported films, takes one down, puts it back as it was, and sets the reports aside', async () => {
    const { env } = setup();
    const id = await published(env);
    const boss = await as(BOSS);
    const reports = await (await call(env, '/api/moderation/reports', { cookie: boss })).json() as { id: string; reports: { reason: string }[] }[];
    expect(reports).toMatchObject([{ id, reports: [{ reason: 'not theirs' }] }]);
    expect((await call(env, `/api/moderation/films/${id}/takedown`, { method: 'POST', cookie: boss })).status).toBe(200);
    expect((await call(env, `/api/gallery/${id}`)).status).toBe(404);
    const back = await (await call(env, `/api/moderation/films/${id}/restore`, { method: 'POST', cookie: boss })).json() as { visibility: string };
    expect(back.visibility).toBe('unlisted');
    expect((await call(env, `/api/gallery/${id}`)).status).toBe(200);
    expect((await call(env, `/api/moderation/films/${id}/reports`, { method: 'DELETE', cookie: boss })).status).toBe(204);
    expect(await (await call(env, '/api/moderation/reports', { cookie: boss })).json()).toEqual([]);
  });

  it('closes an account: the backend lets it go, its films and files go', async () => {
    const { env, files } = setup();
    const id = await published(env);
    await call(env, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'P' }), cookie: await as(AUTHOR) });
    vi.stubGlobal('fetch', async () => Response.json({ workspaces: [AUTHOR.workspaceId] }));
    const res = await call(env, `/api/admin/users/${AUTHOR.userId}`, { method: 'DELETE', cookie: await as(BOSS) });
    expect(res.status).toBe(200);
    expect((await files.list({ prefix: 'w/aaaaaaaaaaaa/' })).objects).toEqual([]);
    expect((await call(env, `/api/gallery/${id}`)).status).toBe(404);
  });
});
