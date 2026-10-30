import { afterEach, describe, expect, it, vi } from 'vitest';
import { claude } from '../src/claude.ts';
import type { Keys } from '../src/keys.ts';

const keys = (have = true): Keys => ({
  get: (p) => (have && p === 'anthropic' ? 'sk-ant-test' : undefined),
  field: () => undefined,
  how: () => 'connect it in Settings, Providers',
  custom: () => undefined,
  status: () => ({ providers: {} as never, custom: [] }),
});

const out = (input: string, init?: RequestInit) => fetch(input, init);
const ask = (path: string, init?: RequestInit, have = true) => claude(new Request(`http://localhost/api/claude/${path}`, init), { keys: keys(have), fetch: out }, path.split('?')[0]);

function stubFetch(answer: () => Response = () => Response.json({ data: [] })) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(answer());
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('the Claude route', () => {
  it('lists the models of the key: the Anthropic listing, with the query of the request, the key added and no body', async () => {
    const calls = stubFetch(() => Response.json({ data: [{ id: 'claude-opus-5-5' }], has_more: false }));
    const res = await ask('v1/models?limit=1000', { method: 'GET', headers: { 'anthropic-version': '2023-06-01' } });
    expect(await res.json()).toEqual({ data: [{ id: 'claude-opus-5-5' }], has_more: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.body).toBeUndefined();
    expect((calls[0].init?.headers as Headers).get('x-api-key')).toBe('sk-ant-test');
    expect((calls[0].init?.headers as Headers).get('anthropic-version')).toBe('2023-06-01');
  });

  it('asks the version itself when the request does not', async () => {
    const calls = stubFetch();
    await ask('v1/models', { method: 'GET' });
    expect((calls[0].init?.headers as Headers).get('anthropic-version')).toBe('2023-06-01');
  });

  it('still sends a message as it did, the body kept', async () => {
    const calls = stubFetch(() => Response.json({ ok: true }));
    await ask('v1/messages', { method: 'POST', body: JSON.stringify({ model: 'm' }) });
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].init?.method).toBe('POST');
  });

  it('refuses what it never carried: another listing route, another verb, no key', async () => {
    const calls = stubFetch();
    await expect(ask('v1/models/claude-opus-5-5', { method: 'GET' })).rejects.toMatchObject({ status: 404 });
    await expect(ask('v1/models', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 404 });
    await expect(ask('v1/files', { method: 'GET' })).rejects.toMatchObject({ status: 404 });
    await expect(ask('v1/models', { method: 'GET' }, false)).rejects.toMatchObject({ status: 503, message: /no Anthropic key/ });
    expect(calls).toHaveLength(0);
  });
});
