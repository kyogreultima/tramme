import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_ROUTES, providersAnswer, type Reach } from '../src/providers.ts';
import { KEYED_PROVIDERS } from '../src/keys.ts';
import type { Keys } from '../src/keys.ts';

/** a Keys with a key for Pexels (or none when told so) */
const keys = (have = true): Keys => ({
  get: (p) => (have && p === 'pexels' ? 'px-test' : undefined),
  field: () => undefined,
  how: (p) => `connect ${p.join(', ')} in Settings, Providers`,
  custom: () => undefined,
  status: () => ({ providers: {} as never, custom: [] }),
});

/** what was asked of the (stubbed) library, and what it answered */
function stubFetch(answer: Response = new Response(JSON.stringify({ photos: [] }), { headers: { 'content-type': 'application/json' } })) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchOut = (url: string, init?: RequestInit) => { calls.push({ url: String(url), init }); return Promise.resolve(answer); };
  return { calls, reach: (have = true): Reach => ({ keys: keys(have), fetch: fetchOut }) };
}
const ask = (reach: Reach, path: string) => providersAnswer(new Request(`https://tramme.test/api/${path}`), reach);

afterEach(() => vi.unstubAllGlobals());

describe('the stock route', () => {
  it('is a provider route, and Pexels is a keyed provider', () => {
    expect(PROVIDER_ROUTES).toContain('stock');
    expect(KEYED_PROVIDERS.pexels.origin).toBe('https://api.pexels.com');
  });

  it('asks Pexels for photos with the key in the Authorization header', async () => {
    const s = stubFetch();
    const res = await ask(s.reach(), 'stock/pexels/photos?query=bowl&per_page=8');
    expect(res.status).toBe(200);
    expect(s.calls[0].url).toBe('https://api.pexels.com/v1/search?query=bowl&per_page=8');
    expect((s.calls[0].init?.headers as Record<string, string>).Authorization).toBe('px-test');
    expect(await res.json()).toEqual({ photos: [] });
  });

  it('asks for clips from the videos search', async () => {
    const s = stubFetch();
    await ask(s.reach(), 'stock/pexels/videos?query=city%20night&per_page=4');
    expect(s.calls[0].url).toBe('https://api.pexels.com/videos/search?query=city+night&per_page=4');
  });

  it('says to connect Pexels when there is no key', async () => {
    const s = stubFetch();
    const res = await ask(s.reach(false), 'stock/pexels/photos?query=bowl');
    expect(res!.status).toBe(401);
    expect(((await res!.json()) as { error: string }).error).toMatch(/pexels/i);
    expect(s.calls).toEqual([]);
  });

  it('answers 404 to any kind but photos and videos', async () => {
    const s = stubFetch();
    expect((await ask(s.reach(), 'stock/pexels/music?query=x')).status).toBe(404);
    expect((await ask(s.reach(), 'stock/unsplash/photos?query=x')).status).toBe(404);
    expect(s.calls).toEqual([]);
  });

  it('passes on what Pexels says when it refuses', async () => {
    const s = stubFetch(new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: { 'content-type': 'application/json' } }));
    const res = await ask(s.reach(), 'stock/pexels/photos?query=bowl');
    expect(res!.status).toBe(429);
    expect(((await res!.json()) as { error: string }).error).toMatch(/pexels/i);
  });
});
