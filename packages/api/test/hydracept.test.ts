import { afterEach, describe, expect, it, vi } from 'vitest';
import { generate } from '../src/generate.ts';
import { HYDRACEPT_AUDIO_MP3, hydraceptImage, hydraceptMusic, hydraceptSfx } from '../src/hydracept.ts';
import { generateImage } from '../src/images.ts';
import type { Keys } from '../src/keys.ts';
import type { MediaConfig } from '../src/media.ts';
import { mediaConfig } from '../src/media.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

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
  const calls: { url: string; method?: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url: u, method: init?.method, body });
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

  it('requests MP3 for sfx and uses the artifact mediaType', async () => {
    const calls = stubHydraceptJob(MP3, 'audio/mpeg');
    const run = await hydraceptSfx(media.hydracept, { prompt: 'whoosh', duration: 2 }, out);
    const job = calls.find((c) => c.url.includes('/audio.sfx.generate.v1/jobs') && c.method === 'POST');
    expect((job?.body?.input as Record<string, unknown>)?.outputFormatPreference).toBe(HYDRACEPT_AUDIO_MP3);
    expect(run.model).toBe('eleven_text_to_sound_v2');
    expect(run.type).toBe('audio/mpeg');
    expect(new Uint8Array(run.bytes)).toEqual(MP3);
  });

  it('requests MP3 for music with tramme duration mapped to durationMs', async () => {
    const calls = stubHydraceptJob(MP3, 'audio/mpeg');
    const run = await hydraceptMusic(media.hydracept, { prompt: 'calm piano bed', duration: 20 }, out);
    const job = calls.find((c) => c.url.includes('/audio.music.generate.v1/jobs') && c.method === 'POST');
    const input = job?.body?.input as Record<string, unknown>;
    expect(input?.outputFormatPreference).toBe(HYDRACEPT_AUDIO_MP3);
    expect(input?.forceInstrumental).toBe(true);
    expect(input?.modelId).toBe('music_v2_5');
    expect(input?.durationMs).toBe(20_000);
    expect(run.model).toBe('music_v2_5');
    expect(run.type).toBe('audio/mpeg');
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

  it('generate sfx through Hydracept by default as audio/mpeg', async () => {
    stubHydraceptJob(MP3, 'audio/mpeg');
    const res = await generate(new Request('http://localhost/api/generate', { method: 'POST', body: JSON.stringify({ kind: 'sfx', prompt: 'click' }) }), reach);
    expect(res.headers.get('x-tramme-provider')).toBe('hydracept');
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
  });

  it('generate music through Hydracept without an ElevenLabs key', async () => {
    stubHydraceptJob(MP3, 'audio/mpeg');
    const res = await generate(new Request('http://localhost/api/generate', { method: 'POST', body: JSON.stringify({ kind: 'music', prompt: 'calm piano', duration: 12 }) }), reach);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-tramme-provider')).toBe('hydracept');
    expect(res.headers.get('x-tramme-model')).toBe('music_v2_5');
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
  });
});
