import { describe, expect, it } from 'vitest';
import { memoryRecords, prefixedBucket, recordBucket, signEdge, storageRoute } from '@tramme/api';
import worker from '../src/index.ts';
import type { Env } from '../src/http.ts';
import { checkJob, nextJob, rendererOf, runJob, SERVER, startJob, tellOwner, type Job, type Renderer } from '../src/renders.ts';

const APP = 'https://app.example';
const SECRET = 'edge-secret';
const WS = 'aaaaaaaaaaaa';

function setup(over: Record<string, unknown> = {}) {
  const files = recordBucket(memoryRecords());
  const queued: { workspaceId: string; job: string; priority: boolean }[] = [];
  const env = {
    MODE: 'personal', APP_ORIGIN: APP, VAULT_ORIGIN: 'https://vault.example',
    ASSETS: { fetch: async () => new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html' } }) },
    ACCOUNTS_URL: 'http://backend.test', FILES: files, EDGE_SECRET: SECRET, INTERNAL_SECRET: 'i', KEYS_SECRET: 'k',
    RENDER_QUEUE: { idFromName: () => 'q', get: () => ({ fetch: async (r: Request) => { queued.push(await r.json()); return new Response(null, { status: 202 }); } }) },
    ...over,
  } as unknown as Env;
  return { env, files, queued };
}
const as = async (plan: 'basic' | 'pro' = 'basic') => `__Host-tramme-edge=${await signEdge({ userId: 'u', workspaceId: WS, sessionVersion: 1, plan }, SECRET)}`;
const call = (env: Env, path: string, cookie: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`${APP}${path}`, { ...init, headers: { cookie } }), env);

/** a renderer whose renders are over as soon as they start: `make` gives the film, or throws why it failed */
function stand(make: (archive: ArrayBuffer, job: Job) => Promise<ArrayBuffer | Response>): Renderer {
  const made = new Map<string, Promise<ArrayBuffer | Response>>();
  return {
    async start(archive, job) { const id = `r${made.size}`; const p = make(archive, job); p.catch(() => {}); made.set(id, p); return id; },
    async state(id) { try { await made.get(id); return { status: 'done' }; } catch (e) { return { status: 'failed', error: (e as Error).message }; } },
    film: async (id) => made.get(id)!,
    async drop(id) { made.delete(id); },
  };
}

async function project(env: Env, cookie: string) {
  return ((await (await call(env, '/api/projects', cookie, { method: 'POST', body: JSON.stringify({ name: 'Film' }) })).json()) as { id: string }).id;
}

describe('export in the cloud', () => {
  it('queues a job for a project, Pro first, and tells where it is', async () => {
    const { env, queued } = setup();
    const cookie = await as('pro');
    const id = await project(env, cookie);
    const res = await call(env, `/api/projects/${id}/renders`, cookie, { method: 'POST', body: JSON.stringify({ quality: '1080p' }) });
    expect(res.status).toBe(202);
    const job = await res.json() as Job;
    expect(job).toMatchObject({ project: id, quality: '1080p', status: 'queued', priority: true });
    expect(queued).toEqual([expect.objectContaining({ workspaceId: WS, job: job.id, priority: true })]);
    expect(((await (await call(env, `/api/renders/${job.id}`, cookie)).json()) as Job).status).toBe('queued');
    expect(((await (await call(env, '/api/renders', cookie)).json()) as Job[]).map((j) => j.id)).toEqual([job.id]);
  });

  it('refuses a project that is not there, and 4K on a plan without it once the limits are on', async () => {
    const { env } = setup({ PLAN_LIMITS: 'on' });
    const cookie = await as('basic');
    expect((await call(env, '/api/projects/nope-123/renders', cookie, { method: 'POST', body: '{}' })).status).toBe(404);
    const big = ((await (await call(env, '/api/projects', cookie, { method: 'POST', body: JSON.stringify({ name: 'Big', width: 3840, height: 2160 }) })).json()) as { id: string }).id;
    expect((await call(env, `/api/projects/${big}/renders`, cookie, { method: 'POST', body: '{}' })).status).toBe(403);
    expect((await call(env, `/api/projects/${big}/renders`, await as('pro'), { method: 'POST', body: '{}' })).status).toBe(202);
  });

  it('renders a job: the project\'s archive in, the film kept with the project', async () => {
    const { env, files } = setup();
    const cookie = await as();
    const id = await project(env, cookie);
    const job = await (await call(env, `/api/projects/${id}/renders`, cookie, { method: 'POST', body: '{}' })).json() as Job;
    let archiveSize = 0;
    const done = await runJob(files, WS, job.id, stand(async (archive) => { archiveSize = archive.byteLength; return new Uint8Array([1, 2, 3]).buffer; }), 1);
    expect(archiveSize).toBeGreaterThan(0);
    expect(done).toMatchObject({ status: 'done', file: `renders/cloud-${job.id}.mp4` });
    const ws = prefixedBucket(files, `w/${WS}/`);
    const url = new URL(`http://x/api/projects/${id}/files/renders/cloud-${job.id}.mp4`);
    expect((await (await storageRoute(new Request(url), ws, url))!.arrayBuffer()).byteLength).toBe(3);
  });

  it('says why a job failed', async () => {
    const { env, files } = setup();
    const cookie = await as();
    const id = await project(env, cookie);
    const job = await (await call(env, `/api/projects/${id}/renders`, cookie, { method: 'POST', body: '{}' })).json() as Job;
    const failed = await runJob(files, WS, job.id, stand(async () => { throw new Error('Chrome stopped'); }), 1);
    expect(failed).toMatchObject({ status: 'failed', error: 'Chrome stopped' });
  });

  it('takes the plans with a priority first, then the oldest', () => {
    const a = { workspaceId: 'a', job: '1', priority: false, at: '1' }, b = { workspaceId: 'b', job: '2', priority: true, at: '2' };
    expect(nextJob([a, b])).toBe(b);
    expect(nextJob([a, { ...b, priority: false }])).toBe(a);
  });
});

describe('export on a server of one', () => {
  function server(over: Record<string, unknown> = {}) {
    const files = recordBucket(memoryRecords());
    const queued: { workspaceId: string; job: string }[] = [];
    const env = {
      FILES: files, DEV_OPEN: '1', RENDERER_URL: 'http://127.0.0.1:8080',
      ASSETS: { fetch: async () => new Response('') },
      RENDER_QUEUE: { idFromName: () => 'q', get: () => ({ fetch: async (r: Request) => { queued.push(await r.json()); return new Response(null, { status: 202 }); } }) },
      ...over,
    } as unknown as Env;
    return { env, files, queued };
  }
  const local = (env: Env, path: string, init: RequestInit = {}) => worker.fetch(new Request(`http://localhost:8787${path}`, init), env);

  it('says it renders, queues a job of its own projects, and renders it with the renderer of the machine', async () => {
    const { env, files, queued } = server();
    expect(((await (await local(env, '/api/config')).json()) as { serverRender: boolean }).serverRender).toBe(true);
    const id = ((await (await local(env, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Film' }) })).json()) as { id: string }).id;
    const job = await (await local(env, `/api/projects/${id}/renders`, { method: 'POST', body: '{}' })).json() as Job;
    expect(queued).toEqual([expect.objectContaining({ workspaceId: SERVER, job: job.id })]);
    const asked: string[] = [];
    const real = globalThis.fetch;
    // the renderer's routes: the render taken at once, rendering at the first question, done at the second, its film, let go
    let questions = 0;
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      asked.push(`${init.method ?? 'GET'} ${url}`);
      if (init.method === 'POST') return Response.json({ id: 'r1' }, { status: 202 });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.endsWith('/film')) return new Response(new Uint8Array([7]));
      return Response.json({ status: ++questions > 1 ? 'done' : 'rendering' });
    }) as typeof fetch;
    try { expect(await runJob(files, SERVER, job.id, rendererOf(env), 1)).toMatchObject({ status: 'done', file: `renders/cloud-${job.id}.mp4` }); } finally { globalThis.fetch = real; }
    expect(asked[0]).toMatch(/^POST http:\/\/127\.0\.0\.1:8080\/render\?quality=1080p/);
    expect(asked.slice(1)).toEqual(['GET http://127.0.0.1:8080/render/r1', 'GET http://127.0.0.1:8080/render/r1', 'GET http://127.0.0.1:8080/render/r1/film', 'DELETE http://127.0.0.1:8080/render/r1']);
    expect(((await (await local(env, `/api/renders/${job.id}`)).json()) as Job).status).toBe('done');
  });

  it('fails a job whose renderer restarted during it, with that reason, and leaves a renderer that does not answer for a while be', async () => {
    const { env, files } = server();
    const id = ((await (await local(env, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Film' }) })).json()) as { id: string }).id;
    const job = await (await local(env, `/api/projects/${id}/renders`, { method: 'POST', body: '{}' })).json() as Job;
    const real = globalThis.fetch;
    let reachable = true;
    globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
      if (!reachable) throw new TypeError('fetch failed');
      if (init.method === 'POST') return Response.json({ id: 'r1' }, { status: 202 });
      return Response.json({ error: 'the renderer stopped during the export' }, { status: 404 });
    }) as typeof fetch;
    try {
      expect(await startJob(files, SERVER, job.id, rendererOf(env))).toMatchObject({ status: 'rendering', renderId: 'r1' });
      reachable = false;
      expect(await checkJob(files, SERVER, job.id, rendererOf(env))).toMatchObject({ status: 'rendering' });
      reachable = true;
      expect(await checkJob(files, SERVER, job.id, rendererOf(env))).toMatchObject({ status: 'failed', error: 'the renderer stopped during the export' });
    } finally { globalThis.fetch = real; }
  });

  it('says nothing of it without a renderer', async () => {
    const { env } = server({ RENDERER_URL: undefined });
    expect(((await (await local(env, '/api/config')).json()) as { serverRender: boolean }).serverRender).toBe(false);
  });

  it('tells the owner of an account\'s job once it is over, and no one on a server of one', async () => {
    const told: unknown[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (r: Request) => { told.push({ url: r.url, body: await r.json() }); return new Response('{}'); }) as typeof fetch;
    try {
      const env = { ACCOUNTS_URL: 'http://backend.test', INTERNAL_SECRET: 'i' } as unknown as Env;
      await tellOwner(env, { id: 'j', project: 'p', status: 'done', userId: 'u' } as Job);
      await tellOwner(env, { id: 'k', project: 'p', status: 'done' } as Job);
      await tellOwner(env, { id: 'l', project: 'p', status: 'rendering', userId: 'u' } as Job);
    } finally { globalThis.fetch = real; }
    expect(told).toEqual([{ url: 'http://backend.test/internal/notify/render', body: { userId: 'u', project: 'p', job: 'j', status: 'done' } }]);
  });
});

describe('the export for Premiere Pro on the server', () => {
  it('asks the renderer for it and keeps the zip with the project', async () => {
    const { env, files } = setup();
    const cookie = await as();
    const id = await project(env, cookie);
    const job = await (await call(env, `/api/projects/${id}/renders`, cookie, { method: 'POST', body: JSON.stringify({ format: 'premiere' }) })).json() as Job;
    expect(job.format).toBe('premiere');
    let asked = '';
    const done = await runJob(files, WS, job.id, stand(async (_a, j) => { asked = j.format ?? 'mp4'; return new Response(new Uint8Array([0x50, 0x4b])); }), 1);
    expect(asked).toBe('premiere');
    expect(done).toMatchObject({ status: 'done', file: `renders/premiere-${job.id}.zip` });
  });
});
