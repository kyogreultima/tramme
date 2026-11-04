import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.ts';
import type { Env } from '../src/http.ts';

const env = (over: Partial<Env> = {}) => ({ ASSETS: { fetch: async () => new Response('page') }, DEV_OPEN: '1', ...over }) as unknown as Env;
const call = (path: string, init: RequestInit = {}, e = env({ ACCOUNTS_URL: 'http://127.0.0.1:3333' })) => worker.fetch(new Request(`http://localhost:8787${path}`, init) as never, e);

afterEach(() => vi.unstubAllGlobals());

describe('worker: the accounts backend', () => {
  it('passes an account route on as it came, and gives the answer back with its cookies and status', async () => {
    const seen: Request[] = [];
    vi.stubGlobal('fetch', async (input: Request) => {
      seen.push(input);
      const headers = new Headers({ 'content-type': 'application/json' });
      headers.append('set-cookie', 'a=1; Path=/');
      headers.append('set-cookie', 'b=2; Path=/');
      return new Response('{"user":1}', { status: 201, headers });
    });
    const res = await call('/api/auth/signup?x=1', { method: 'POST', headers: { origin: 'http://localhost:8787', cookie: 'c=3', 'content-type': 'application/json' }, body: '{"email":"a@b.c"}' });

    expect(res.status).toBe(201);
    expect(await res.text()).toBe('{"user":1}');
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('http://127.0.0.1:3333/api/auth/signup?x=1');
    expect(seen[0].method).toBe('POST');
    expect(seen[0].headers.get('origin')).toBe('http://localhost:8787');
    expect(seen[0].headers.get('cookie')).toBe('c=3');
    expect(await seen[0].text()).toBe('{"email":"a@b.c"}');
  });

  it('does not follow a redirect of the backend: the browser does (sign-in with a provider)', async () => {
    vi.stubGlobal('fetch', async (input: Request) => {
      expect(input.redirect).toBe('manual');
      return new Response(null, { status: 302, headers: { location: 'https://github.com/login/oauth/authorize' } });
    });
    const res = await call('/api/auth/github/redirect');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://github.com/login/oauth/authorize');
  });

  it.each(['/api/account', '/api/account/export', '/api/billing', '/api/billing/webhook/fake', '/api/auth/me'])('hands %s to the backend', async (path) => {
    const fetched = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetched);
    await call(path);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it('keeps the other routes, and the look-alikes, to itself', async () => {
    const fetched = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetched);
    for (const path of ['/api/config', '/api/projects', '/api/authority', '/api/accounts', '/internal/edge']) await call(path);
    expect(fetched).not.toHaveBeenCalled();
  });

  it('has no account routes at all without ACCOUNTS_URL', async () => {
    const fetched = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetched);
    const res = await call('/api/auth/me', {}, env());
    expect(fetched).not.toHaveBeenCalled();
    // the route is not the backend's: whatever the Worker answers there, it is not an account
    expect(res.status).not.toBe(200);
  });
});
