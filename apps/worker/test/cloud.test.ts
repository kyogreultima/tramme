import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryRecords, recordBucket, signEdge } from '@tramme/api';
import worker from '../src/index.ts';
import type { Env } from '../src/http.ts';

const APP = 'https://app.example';
const SECRET = 'edge-secret';
const A = { userId: 'ua', workspaceId: 'aaaaaaaaaaaa', sessionVersion: 1 };
const B = { userId: 'ub', workspaceId: 'bbbbbbbbbbbb', sessionVersion: 1 };

function setup() {
  const files = recordBucket(memoryRecords());
  const env = {
    MODE: 'personal', APP_ORIGIN: APP, VAULT_ORIGIN: 'https://vault.example',
    ASSETS: { fetch: async () => new Response('<html><head></head><body>editor</body></html>', { headers: { 'content-type': 'text/html' } }) },
    ACCOUNTS_URL: 'http://backend.test', FILES: files, EDGE_SECRET: SECRET, INTERNAL_SECRET: 'internal', KEYS_SECRET: 'keys-secret',
  } as unknown as Env;
  return { env, files };
}

const call = async (env: Env, path: string, init: RequestInit & { cookie?: string } = {}, ctx?: ExecutionContext) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  return worker.fetch(new Request(`${APP}${path}`, { ...init, headers }), env, ctx);
};
const as = async (who: typeof A) => `__Host-tramme-edge=${await signEdge(who, SECRET)}`;

afterEach(() => vi.unstubAllGlobals());

describe('worker: projects in the cloud', () => {
  it('serves a signed-in person their own projects, under their workspace only', async () => {
    const { env, files } = setup();
    const made = await call(env, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Mine' }), cookie: await as(A) });
    expect(made.status).toBe(201);
    expect(await (await call(env, '/api/projects', { cookie: await as(A) })).json()).toHaveLength(1);
    expect(await (await call(env, '/api/projects', { cookie: await as(B) })).json()).toEqual([]);
    expect((await files.list({})).objects.every((o) => o.key.startsWith('w/aaaaaaaaaaaa/'))).toBe(true);
  });

  it('says cloud in its config, and marks the editor page as an account\'s', async () => {
    const { env } = setup();
    const config = await (await call(env, '/api/config', { cookie: await as(A) })).json() as { mode: string };
    expect(config.mode).toBe('cloud');
    const page = await call(env, '/', { cookie: await as(A) });
    expect(await page.text()).toContain('<meta name="tramme-account" content="1">');
    expect(page.headers.get('x-tramme-account')).toBe('1');
  });

  it('never lets the browser keep the page of the other mode: no 304 for a page, no build ETag on it', async () => {
    const { env } = setup();
    (env as { ASSETS: unknown }).ASSETS = {
      fetch: async (r: Request) => (r.headers.has('if-none-match')
        ? new Response(null, { status: 304 })
        : new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html', etag: '"build"' } })),
    };
    const page = { accept: 'text/html', 'if-none-match': '"build"' };
    const signedInPage = await call(env, '/', { headers: page, cookie: await as(A) });
    const signedOutPage = await call(env, '/', { headers: page });
    for (const res of [signedInPage, signedOutPage]) {
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBeNull();
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(await signedInPage.text()).toContain('tramme-account');
    expect(await signedOutPage.text()).toContain('tramme-vault');
  });

  it('keeps the personal mode for a visitor who is not signed in, and tells them the cloud exists', async () => {
    const { env } = setup();
    const config = await (await call(env, '/api/config')).json() as { mode: string; cloud: boolean };
    expect(config).toMatchObject({ mode: 'personal', cloud: true });
    // a page of the cloud whose session ended is told to sign in (its saves wait), never answered as a loss
    const out = await call(env, '/api/projects');
    expect(out.status).toBe(401);
    expect(await out.json()).toMatchObject({ error: 'signed_out' });
    expect(await (await call(env, '/')).text()).toContain('tramme-vault');
  });

  it('renews an expired token from the live session, on any request, and gives the new one back', async () => {
    const { env } = setup();
    const fresh = await signEdge(A, SECRET);
    const seen: Request[] = [];
    vi.stubGlobal('fetch', async (input: Request) => {
      seen.push(input);
      return Response.json({ token: fresh, expiresAt: 0, userId: A.userId, workspaceId: A.workspaceId });
    });
    const expired = `__Host-tramme-edge=${await signEdge(A, SECRET, Date.now() - 3_600_000)}; __Host-tramme-session=s1`;
    const res = await call(env, '/api/projects', { cookie: expired, headers: { range: 'bytes=0-10' } });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`__Host-tramme-edge=${fresh}`))).toBe(true);
    expect(seen[0].url).toBe('http://backend.test/internal/edge');
    expect(seen[0].headers.get('x-tramme-internal')).toBe('internal');
    expect(seen[0].headers.get('cookie')).toContain('__Host-tramme-session=s1');
  });

  it('a session the backend refuses is signed out: the personal mode answers', async () => {
    const { env } = setup();
    vi.stubGlobal('fetch', async () => Response.json({ error: 'signed_out' }, { status: 401 }));
    const res = await call(env, '/api/config', { cookie: '__Host-tramme-session=old' });
    expect(((await res.json()) as { mode: string }).mode).toBe('personal');
  });

  it('keeps a person\'s keys sealed, and shows them to nobody else', async () => {
    const { env, files } = setup();
    const put = await call(env, '/api/keys/anthropic', { method: 'PUT', body: JSON.stringify({ key: 'sk-ant-xyz' }), cookie: await as(A) });
    expect(put.ok).toBe(true);
    const mine = await (await call(env, '/api/config', { cookie: await as(A) })).json() as { keys: { providers: Record<string, unknown> } };
    const theirs = await (await call(env, '/api/config', { cookie: await as(B) })).json() as { keys: { providers: Record<string, unknown> } };
    expect(mine.keys.providers.anthropic).toBe('settings');
    expect(theirs.keys.providers.anthropic).toBeNull();
    const raw = await (await files.get('w/aaaaaaaaaaaa/config/keys.json'))!.arrayBuffer();
    expect(new TextDecoder().decode(raw)).not.toContain('sk-ant');
  });

  it('deletes an account with its files, and ends the visit', async () => {
    const { env, files } = setup();
    await call(env, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Mine' }), cookie: await as(A) });
    await call(env, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Theirs' }), cookie: await as(B) });
    const asked: unknown[] = [];
    vi.stubGlobal('fetch', async (input: Request) => {
      asked.push({ url: input.url, body: await input.json() });
      return Response.json({ workspaces: [A.workspaceId] });
    });
    const waits: Promise<unknown>[] = [];
    const res = await call(env, '/api/account', { method: 'DELETE', body: JSON.stringify({ password: 'pw' }), cookie: await as(A) }, { waitUntil: (p: Promise<unknown>) => waits.push(p) } as unknown as ExecutionContext);
    await Promise.all(waits);
    expect(res.status).toBe(204);
    expect(asked).toEqual([{ url: 'http://backend.test/internal/account/delete', body: { userId: 'ua', password: 'pw' } }]);
    expect(res.headers.getSetCookie().filter((c) => c.includes('Max-Age=0'))).toHaveLength(2);
    expect((await files.list({ prefix: 'w/aaaaaaaaaaaa/' })).objects).toEqual([]);
    expect((await files.list({ prefix: 'w/bbbbbbbbbbbb/' })).objects.length).toBeGreaterThan(0);
  });

  it('keeps everything when the backend refuses the confirmation', async () => {
    const { env, files } = setup();
    await call(env, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Mine' }), cookie: await as(A) });
    vi.stubGlobal('fetch', async () => Response.json({ error: 'confirm' }, { status: 403 }));
    const res = await call(env, '/api/account', { method: 'DELETE', body: JSON.stringify({ email: 'no' }), cookie: await as(A) });
    expect(res.status).toBe(403);
    expect((await files.list({ prefix: 'w/aaaaaaaaaaaa/' })).objects.length).toBeGreaterThan(0);
  });

  it('lets an API token reach the projects and their exports, and nothing else', async () => {
    const { env } = setup();
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (input: Request) => {
      asked.push(input.url);
      const { token } = await input.json() as { token: string };
      return token.endsWith('a') ? Response.json({ userId: 'ua', workspaceId: 'aaaaaaaaaaaa', plan: 'pro', sessionVersion: 1 }) : Response.json({ error: 'invalid_token' }, { status: 401 });
    });
    const good = { authorization: `Bearer tr_${'a'.repeat(43)}` }, bad = { authorization: `Bearer tr_${'b'.repeat(43)}` };
    expect((await call(env, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'By script' }), headers: good })).status).toBe(201);
    expect((await call(env, '/api/projects', { headers: good })).status).toBe(200);
    expect((await call(env, '/api/keys/openai', { method: 'PUT', body: '{"key":"x"}', headers: good })).status).toBe(403);
    expect((await call(env, '/api/projects', { headers: bad })).status).toBe(401);
    // a script's many requests ask the backend once a minute
    expect(asked.filter((u) => u.endsWith('/internal/token'))).toHaveLength(2);
  });

  it('is off without the keys secret: everyone gets the personal mode', async () => {
    const { env } = setup();
    delete (env as { KEYS_SECRET?: string }).KEYS_SECRET;
    expect(((await (await call(env, '/api/config', { cookie: await as(A) })).json()) as { mode: string }).mode).toBe('personal');
  });
});

describe('worker: speech to text for an account', () => {
  const chunk = () => JSON.stringify({ audio: btoa('RIFF....WAVEfmt '), language: 'fr' });

  it('hears a signed-in person on Workers AI, within a rate per account, and says so in its config', async () => {
    const { env } = setup();
    const run = vi.fn(async () => ({ text: 'bonjour', transcription_info: { language: 'fr' }, segments: [{ words: [{ word: 'bonjour', start: 0.1, end: 0.5 }] }] }));
    const limited: string[] = [];
    Object.assign(env, { AI: { run }, RELAY_LIMIT: { limit: async ({ key }: { key: string }) => { limited.push(key); return { success: limited.length < 3 }; } } });
    expect(await (await call(env, '/api/config', { cookie: await as(A) })).json()).toMatchObject({ transcribe: true });
    const heard = await call(env, '/api/transcribe', { method: 'POST', body: chunk(), headers: { 'content-type': 'application/json' }, cookie: await as(A) });
    expect(heard.status).toBe(200);
    expect(await heard.json()).toMatchObject({ words: [{ w: 'bonjour', s: 0.1, e: 0.5 }], language: 'fr' });
    expect(limited).toEqual([`transcribe:${A.workspaceId}`]);
    await call(env, '/api/transcribe', { method: 'POST', body: chunk(), headers: { 'content-type': 'application/json' }, cookie: await as(A) });
    // past the rate: told to wait, Workers AI not asked
    const over = await call(env, '/api/transcribe', { method: 'POST', body: chunk(), headers: { 'content-type': 'application/json' }, cookie: await as(A) });
    expect(over.status).toBe(429);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('is not heard for a visitor who is not signed in', async () => {
    const { env } = setup();
    Object.assign(env, { AI: { run: vi.fn() } });
    const res = await call(env, '/api/transcribe', { method: 'POST', body: chunk(), headers: { 'content-type': 'application/json' } });
    expect(res.status).not.toBe(200);
    expect((env as unknown as { AI: { run: ReturnType<typeof vi.fn> } }).AI.run).not.toHaveBeenCalled();
  });
});
