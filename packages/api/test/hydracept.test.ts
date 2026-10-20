import { afterEach, describe, expect, it, vi } from 'vitest';
import { generate } from '../src/generate.ts';
import { hydraceptImage, hydraceptSfx } from '../src/hydracept.ts';
import { generateImage } from '../src/images.ts';
import type { Keys } from '../src/keys.ts';
import type { MediaConfig } from '../src/media.ts';
import { mediaConfig } from '../src/media.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);

const media: MediaConfig = {
  provider: 'hydracept',
  hydracept: {
    apiKey: 'hk-test',
    apiUrl: 'https://api.hydracept.com',
    productId: 'tramme',
    projectId: 'cpr_test',
    environment: 'development',
  },
};

const keys = (): Keys => ({
  get: () => undefined,
  how: () => 'connect it in Settings, Providers',
  custom: () => undefined,
  status: () => ({ providers: {} as never, custom: [] }),
});

const out = (input: string, init?: RequestInit) => fetch(input, init);

function stubHydraceptJob(artifact: Uint8Array, contentType: string) {
  const calls: { url: string; method?: string }[] = [];
  vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method });
    if (u.includes('/quote')) {
      return Promise.resolve(new Response(JSON.stringify({ quoteId: 'quo_1' }), { headers: { 'content-type': 'application/json' } }));
    }
    if (u.includes('/jobs') && init?.method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify({ jobId: 'job_1', status: 'queued' }), { headers: { 'content-type': 'application/json' } }));
    }
    if (u.endsWith('/jobs/job_1') && !u.includes('/artifacts') && !u.includes('/receipt')) {
      return Promise.resolve(new Response(JSON.stringify({
        jobId: 'job_1', status: 'succeeded', receiptId: 'rcpt_1',
        artifacts: [{ artifactId: 'art_1', mediaType: contentType }],
      }), { headers: { 'content-type': 'application/json' } }));
    }
    if (u.includes('/receipt')) {
      return Promise.resolve(new Response(JSON.stringify({ receiptId: 'rcpt_1' }), { headers: { 'content-type': 'application/json' } }));
    }
    if (u.includes('/artifacts/art_1')) {
      return Promise.resolve(new Response(new Uint8Array(artifact), { headers: { 'content-type': contentType } }));
    }
    return Promise.resolve(new Response('unexpected', { status: 500 }));
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('mediaConfig', () => {
  it('enables Hydracept only when provider, key and project are set', () => {
    expect(mediaConfig({})).toBeUndefined();
    expect(mediaConfig({ MEDIA_PROVIDER: 'hydracept', HYDRACEPT_API_KEY: 'k' })).toBeUndefined();
    expect(mediaConfig({ MEDIA_PROVIDER: 'hydracept', HYDRACEPT_API_KEY: 'k', HYDRACEPT_PROJECT: 'cpr_x' })?.hydracept.projectId).toBe('cpr_x');
  });
});

describe('hydracept jobs', () => {
  it('quotes, submits, polls, and downloads an image', async () => {
    const calls = stubHydraceptJob(PNG, 'image/png');
    const run = await hydraceptImage(media.hydracept, { prompt: 'a lighthouse', ratio: '16:9', quality: 'high' }, out);
    expect(calls[0].url).toContain('/capabilities/image.generate.v1/quote');
    expect(calls.some((c) => c.url.includes('/capabilities/image.generate.v1/jobs') && c.method === 'POST')).toBe(true);
    expect(run.receiptId).toBe('rcpt_1');
    expect(run.quoteId).toBe('quo_1');
    expect(new Uint8Array(run.bytes)).toEqual(PNG);
  });

  it('maps sfx duration to milliseconds', async () => {
    stubHydraceptJob(OGG, 'audio/ogg');
    const run = await hydraceptSfx(media.hydracept, { prompt: 'whoosh', duration: 2 }, out);
    expect(run.model).toBe('eleven_text_to_sound_v2');
    expect(run.type).toBe('audio/ogg');
  });
});

describe('routes with Hydracept', () => {
  const reach = { keys: keys(), fetch: out, media };

  it('generate-image names Hydracept and records receipt ids', async () => {
    stubHydraceptJob(PNG, 'image/png');
    const res = await generateImage(new Request('http://localhost/api/generate-image', { method: 'POST', body: JSON.stringify({ prompt: 'sky' }) }), reach);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-tramme-provider')).toBe('hydracept');
    expect(res.headers.get('x-tramme-hydracept-receipt')).toBe('rcpt_1');
    expect(res.headers.get('x-tramme-hydracept-quote')).toBe('quo_1');
  });

  it('generate sfx through Hydracept by default', async () => {
    stubHydraceptJob(OGG, 'audio/ogg');
    const res = await generate(new Request('http://localhost/api/generate', { method: 'POST', body: JSON.stringify({ kind: 'sfx', prompt: 'click' }) }), reach);
    expect(res.headers.get('x-tramme-provider')).toBe('hydracept');
    // Hydracept catalog contract: audio/ogg until a documented MP3 output option exists
    expect(res.headers.get('content-type')).toBe('audio/ogg');
    expect(res.headers.get('content-type')).not.toBe('audio/mpeg');
  });
});
