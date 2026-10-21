import { afterEach, describe, expect, it, vi } from 'vitest';
import { generate, voices } from '../src/generate.ts';
import { HYDRACEPT_AUDIO_MP3, hydraceptImage, hydraceptMusic, hydraceptSfx, hydraceptVoice, mapHydraceptVoices } from '../src/hydracept.ts';
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
    const job = calls.find((c) => c.url.includes('/capabilities/image.generate.v1/jobs') && c.method === 'POST');
    expect((job?.body?.input as Record<string, unknown>)?.model).toBe('gpt-image-2.5-flare');
    expect((job?.body?.execution as Record<string, unknown>)?.quoteId).toBe('quo_1');
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
    expect(input?.modelId).toBe('music_v2');
    expect(input?.durationMs).toBe(20_000);
    expect(run.model).toBe('music_v2');
    expect(run.type).toBe('audio/mpeg');
  });

  it('clamps Hydracept music to the 300 s contract', async () => {
    const calls = stubHydraceptJob(MP3, 'audio/mpeg');
    await hydraceptMusic(media.hydracept, { prompt: 'long bed', duration: 600 }, out);
    const job = calls.find((c) => c.url.includes('/audio.music.generate.v1/jobs') && c.method === 'POST');
    expect((job?.body?.input as Record<string, unknown>)?.durationMs).toBe(300_000);
  });

  it('rejects SFX prompts over the 450 character Hydracept limit', async () => {
    const calls = stubHydraceptJob(MP3, 'audio/mpeg');
    await expect(
      hydraceptSfx(media.hydracept, { prompt: 'x'.repeat(451) }, out),
    ).rejects.toThrow(/450 characters/);
    expect(calls).toHaveLength(0);
  });

  it('keeps voice on Hydracept-supported models and falls back for others', async () => {
    const calls = stubHydraceptJob(MP3, 'audio/mpeg');
    await hydraceptVoice(
      media.hydracept,
      { prompt: 'hello', voice: 'owner/voice-1', model: 'eleven_flash_v2_5', style: 'whisper' },
      out,
      new Set(['eleven_v4', 'eleven_flash_v2_5']),
      'default-voice',
    );
    let job = calls.find((c) => c.url.includes('/audio.voice.generate.v1/jobs') && c.method === 'POST');
    let input = job?.body?.input as Record<string, unknown>;
    expect(input?.modelId).toBe('eleven_flash_v2_5');
    expect(input?.voiceId).toBe('voice-1');
    expect(input?.text).toBe('[whisper] hello');

    calls.length = 0;
    await hydraceptVoice(
      media.hydracept,
      { prompt: 'hello', model: 'eleven_v3' },
      out,
      new Set(['eleven_v4']),
      'default-voice',
    );
    job = calls.find((c) => c.url.includes('/audio.voice.generate.v1/jobs') && c.method === 'POST');
    input = job?.body?.input as Record<string, unknown>;
    expect(input?.modelId).toBe('eleven_v4');
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
    expect(res.headers.get('x-tramme-model')).toBe('music_v2');
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
  });

  it('lists voices from Hydracept when it is the default voice provider', async () => {
    const calls: { url: string; headers?: HeadersInit }[] = [];
    vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers });
      if (String(url).includes('/audio.voice.generate.v1/voices')) {
        return Promise.resolve(new Response(JSON.stringify({
          capabilityKey: 'audio.voice.generate.v1',
          source: 'curated',
          voices: [
            { voiceId: 'v1', name: 'Alice', description: 'Warm narrator', previewUrl: 'https://cdn.example/p.mp3' },
            { voiceId: 'v2', name: 'Bob' },
          ],
        }), { headers: { 'content-type': 'application/json' } }));
      }
      return Promise.resolve(new Response('unexpected', { status: 500 }));
    });
    const res = await voices(new Request('http://localhost/api/voices?search=ali'), reach);
    expect(res.status).toBe(200);
    expect(calls[0].url).toContain('/v1/capabilities/audio.voice.generate.v1/voices');
    expect(calls[0].url).toContain('projectId=cpr_test');
    expect((calls[0].headers as Record<string, string>).authorization).toBe('Bearer hk-test');
    const body = await res.json() as { voices: { id: string; name: string; provider: string; source: string; preview?: string }[] };
    expect(body.voices).toEqual([{ id: 'v1', name: 'Alice', provider: 'hydracept', source: 'library', description: 'Warm narrator', preview: 'https://cdn.example/p.mp3' }]);
  });
});

describe('mapHydraceptVoices', () => {
  it('maps catalog source curated to library, others to account', () => {
    expect(mapHydraceptVoices({ capabilityKey: 'audio.voice.generate.v1', source: 'byok', voices: [{ voiceId: 'a', name: 'A' }] })[0].source).toBe('account');
    expect(mapHydraceptVoices({ capabilityKey: 'audio.voice.generate.v1', source: 'curated', voices: [{ voiceId: 'a', name: 'A' }] })[0].source).toBe('library');
  });
});
