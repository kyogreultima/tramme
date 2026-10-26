import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_PROVIDERS, imageConfig, generateImage } from '../src/images.ts';
import type { Keys } from '../src/keys.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** a Keys with a key for every provider (or none when told so) */
const keys = (have = true): Keys => ({
  get: () => (have ? 'k-test' : undefined),
  field: () => undefined,
  how: () => 'connect it in Settings, Providers',
  custom: () => undefined,
  status: () => ({ providers: {} as never, custom: [] }),
});

/** the way out to the providers: the global fetch, stubbed by each test */
const out = (input: string, init?: RequestInit) => fetch(input, init);

/** what was asked of the (stubbed) provider, and what it answered */
function stubFetch(...answers: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let n = 0;
  vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(answers[Math.min(n++, answers.length - 1)]);
  });
  return calls;
}

const asked = (call: { init?: RequestInit }) => JSON.parse(String(call.init?.body) ?? '{}') as Record<string, unknown>;

afterEach(() => vi.unstubAllGlobals());

describe('the picture providers', () => {
  it('openai: the proportions mapped to its three sizes, the picture read from the answer', async () => {
    const calls = stubFetch(jsonRes({ data: [{ b64_json: b64(PNG) }] }));
    const made = await IMAGE_PROVIDERS.openai.make('k', { prompt: 'a lighthouse', ratio: '16:9', quality: 'high' }, out, keys());
    expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
    expect(asked(calls[0])).toMatchObject({ model: 'gpt-image-1', prompt: 'a lighthouse', size: '1536x1024', quality: 'high' });
    expect(made).toMatchObject({ type: 'image/png', model: 'gpt-image-1' });
    expect(new Uint8Array(made.image)).toEqual(PNG);
    for (const [ratio, size] of [['9:16', '1024x1536'], ['1:1', '1024x1024'], ['21:9', '1536x1024']] as const) {
      const more = stubFetch(jsonRes({ data: [{ b64_json: b64(PNG) }] }));
      await IMAGE_PROVIDERS.openai.make('k', { prompt: 'x', ratio }, out, keys());
      expect(asked(more[0]).size).toBe(size);
    }
  });

  it('gemini: the proportions as asked, the picture read from the answer, none named when it holds back', async () => {
    const calls = stubFetch(jsonRes({ candidates: [{ content: { parts: [{ inlineData: { data: b64(PNG), mimeType: 'image/png' } }] } }] }));
    const made = await IMAGE_PROVIDERS.gemini.make('k', { prompt: 'a lighthouse', ratio: '9:16' }, out, keys());
    expect(calls[0].url).toContain('/models/gemini-3.8-flash-image:generateContent');
    expect(asked(calls[0]).generationConfig).toMatchObject({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } });
    expect(made).toMatchObject({ type: 'image/png', model: 'gemini-3.8-flash-image' });
    expect(new Uint8Array(made.image)).toEqual(PNG);
    stubFetch(jsonRes({ candidates: [{ content: { parts: [{ text: 'I cannot' }] } }] }));
    await expect(IMAGE_PROVIDERS.gemini.make('k', { prompt: 'x', ratio: '1:1' }, out, keys())).rejects.toMatchObject({ status: 502, message: /gemini: no picture/ });
  });

  it('zai: reads the picture it names, png when it says nothing better', async () => {
    const calls = stubFetch(jsonRes({ data: [{ url: 'https://cdn.example/img' }] }), new Response(PNG, { headers: { 'content-type': 'image/png' } }));
    const made = await IMAGE_PROVIDERS.zai.make('k', { prompt: 'a lighthouse', ratio: '16:9' }, out, keys());
    expect(calls[0].url).toBe('https://api.z.ai/api/paas/v4/images/generations');
    expect(asked(calls[0])).toMatchObject({ model: 'cogview-4', size: '1280x720' });
    expect(calls[1].url).toBe('https://cdn.example/img');
    expect(made).toMatchObject({ type: 'image/png', model: 'cogview-4' });
    expect(new Uint8Array(made.image)).toEqual(PNG);
    stubFetch(jsonRes({ data: [{ url: 'https://cdn.example/img' }] }), new Response(PNG, { headers: { 'content-type': 'application/octet-stream' } }));
    const again = await IMAGE_PROVIDERS.zai.make('k', { prompt: 'x', ratio: '1:1' }, out, keys());
    expect(again.type).toBe('image/png');
  });

  it('a refusal is read and named', async () => {
    stubFetch(new Response(JSON.stringify({ error: { message: 'billing hard limit reached' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    await expect(IMAGE_PROVIDERS.openai.make('k', { prompt: 'x', ratio: '1:1' }, out, keys())).rejects.toMatchObject({ status: 502, message: 'openai: billing hard limit reached' });
  });
});

describe('generate-image', () => {
  const ask = (body: unknown, have = true) => generateImage(new Request('http://localhost:8787/api/generate-image', { method: 'POST', body: JSON.stringify(body) }), { keys: keys(have), fetch: out });

  it('refuses an empty or overlong prompt, and a server without a key', async () => {
    await expect(ask({})).rejects.toMatchObject({ status: 400, message: /say what to draw/ });
    await expect(ask({ prompt: 'x'.repeat(4001) })).rejects.toMatchObject({ status: 413 });
    await expect(ask({ prompt: 'a lighthouse' }, false)).rejects.toMatchObject({ status: 503, message: /no provider for pictures/ });
  });

  it('the first provider connected, the proportions it takes, the answer named', async () => {
    const calls = stubFetch(jsonRes({ data: [{ b64_json: b64(PNG) }] }));
    const res = await ask({ prompt: 'a lighthouse at dusk', ratio: '16:9' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-tramme-provider')).toBe('openai');
    expect(res.headers.get('x-tramme-model')).toBe('gpt-image-1');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(asked(calls[0]).size).toBe('1536x1024');
  });

  it('a ratio the list does not know falls back to square, an unnamed provider takes the first with a key', async () => {
    const calls = stubFetch(jsonRes({ candidates: [{ content: { parts: [{ inlineData: { data: b64(PNG), mimeType: 'image/png' } }] } }] }));
    const res = await ask({ prompt: 'x', ratio: '5.1:9', provider: 'gemini' });
    expect(asked(calls[0]).generationConfig).toMatchObject({ imageConfig: { aspectRatio: '1:1' } });
    expect(res.headers.get('x-tramme-provider')).toBe('gemini');
  });

  it('the providers connected, in the order the first is taken from', () => {
    expect(imageConfig({ get: (p) => (p === 'zai' ? 'k' : undefined), field: () => undefined, how: () => '', custom: () => undefined, status: () => ({ providers: {} as never, custom: [] }) })).toEqual(['zai']);
  });
});

describe('takes, a picture to change, the size asked', () => {
  const ask = (body: unknown) => generateImage(new Request('http://localhost:8787/api/generate-image', { method: 'POST', body: JSON.stringify(body) }), { keys: keys(true), fetch: out });
  const dataUrl = `data:image/png;base64,${b64(PNG)}`;

  it('takes: the ask drawn n times, answered as JSON with each picture', async () => {
    const one = () => jsonRes({ data: [{ b64_json: b64(PNG) }] });
    const calls = stubFetch(one(), one(), one());
    const res = await ask({ prompt: 'a lighthouse', n: 3 });
    expect(calls).toHaveLength(3);
    expect(res.headers.get('content-type')).toBe('application/json');
    const j = await res.json() as { provider: string; model: string; images: { type: string; data: string }[] };
    expect(j).toMatchObject({ provider: 'openai', model: 'gpt-image-1' });
    expect(j.images.map((i) => i.data)).toEqual([b64(PNG), b64(PNG), b64(PNG)]);
    // never more than four
    stubFetch(one(), one(), one(), one());
    expect(((await (await ask({ prompt: 'x', n: 9 })).json()) as { images: unknown[] }).images).toHaveLength(4);
  });

  it('openai changes a picture through its edits endpoint, the mask beside it', async () => {
    const calls = stubFetch(jsonRes({ data: [{ b64_json: b64(PNG) }] }));
    await ask({ prompt: 'the same street, at night', provider: 'openai', reference: dataUrl, mask: dataUrl, size: 'small' });
    expect(calls[0].url).toBe('https://api.openai.com/v1/images/edits');
    const form = calls[0].init?.body as FormData;
    expect(form.get('prompt')).toBe('the same street, at night');
    expect(form.get('size')).toBe('1024x1024');
    expect(form.get('image')).toBeInstanceOf(Blob);
    expect(form.get('mask')).toBeInstanceOf(Blob);
  });

  it('gemini takes the picture, then its mask, before the words', async () => {
    const calls = stubFetch(jsonRes({ candidates: [{ content: { parts: [{ inlineData: { data: b64(PNG), mimeType: 'image/png' } }] } }] }));
    await ask({ prompt: 'a red door', provider: 'gemini', reference: dataUrl, mask: dataUrl });
    const parts = (asked(calls[0]).contents as { parts: Record<string, unknown>[] }[])[0].parts;
    expect(parts.map((p) => Object.keys(p)[0])).toEqual(['inlineData', 'inlineData', 'text']);
    expect(String(parts[2].text)).toMatch(/mask/);
  });

  it('a provider that draws from words only refuses a picture to change; bad pictures are refused', async () => {
    stubFetch(jsonRes({}));
    await expect(ask({ prompt: 'x', provider: 'zai', reference: dataUrl })).rejects.toMatchObject({ status: 400, message: /words only/ });
    await expect(ask({ prompt: 'x', reference: 'http://example.com/a.png' })).rejects.toMatchObject({ status: 400, message: /data URL/ });
    await expect(ask({ prompt: 'x', mask: dataUrl })).rejects.toMatchObject({ status: 400, message: /goes with the picture/ });
  });

  it('a small picture asks the cheapest size', async () => {
    const calls = stubFetch(jsonRes({ data: [{ url: 'https://cdn.example/img' }] }), new Response(PNG, { headers: { 'content-type': 'image/png' } }));
    await IMAGE_PROVIDERS.zai.make('k', { prompt: 'x', ratio: '16:9', size: 'small' }, out, keys());
    expect(asked(calls[0]).size).toBe('960x544');
  });
});
