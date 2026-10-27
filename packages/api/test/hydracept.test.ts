import { afterEach, describe, expect, it, vi } from 'vitest';
import { generate, voices } from '../src/generate.ts';
import { HYDRACEPT_AUDIO_MP3, HYDRACEPT_VIDEO_MODEL, hydraceptImage, hydraceptMusic, hydraceptSfx, hydraceptVideo, hydraceptVoice, mapHydraceptVoices, videoSecondsOf } from '../src/hydracept.ts';
import { generateImage, imageConfig } from '../src/images.ts';
import { generateVideo, videoConfig, videoSourceOf } from '../src/videos.ts';
import { keysRoute, loadKeys, storedKeys, type KeyStore, type Secrets, type StoredKeys } from '../src/keys.ts';
import { soundConfig } from '../src/generate.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
const MP4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

const media = {
  hydracept: {
    apiKey: 'hk-test',
    apiUrl: 'https://api.hydracept.com',
    productId: 'tramme',
    projectId: 'cpr_test',
    environment: 'development',
  },
};

/** the keys kept in memory, as the settings or the vault keep them */
function memory(initial: Partial<StoredKeys> = {}): KeyStore & { value: StoredKeys } {
  const store = { value: storedKeys(initial), async load() { return store.value; }, async save(v: StoredKeys) { store.value = v; } };
  return store;
}
const HYDRACEPT_ONLY = { keys: { hydracept: 'hk-test' }, fields: { hydracept: { project: 'cpr_test' } } };
const keys = () => loadKeys(memory(HYDRACEPT_ONLY));

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

describe('Hydracept as a provider', () => {
  it('is connected only with its key and its project, from the settings', async () => {
    expect((await loadKeys(memory({ keys: { hydracept: 'hk' } }))).status().providers.hydracept).toBeNull();
    const k = await loadKeys(memory(HYDRACEPT_ONLY));
    expect(k.status().providers.hydracept).toBe('settings');
    expect(k.get('hydracept')).toBe('hk-test');
    expect(k.field('hydracept', 'project')).toBe('cpr_test');
    expect(k.status().fields?.hydracept).toEqual({ project: 'cpr_test' });
  });

  it('is connected from the Worker secrets with HYDRACEPT_PROJECT', async () => {
    const env: Record<string, string> = { HYDRACEPT_API_KEY: 'hk-server', HYDRACEPT_PROJECT: 'cpr_server' };
    const secrets: Secrets = { read: (p) => (p === 'hydracept' ? env.HYDRACEPT_API_KEY : undefined), name: () => 'HYDRACEPT_API_KEY', field: (p, n) => (n === 'project' ? env.HYDRACEPT_PROJECT : undefined) };
    const k = await loadKeys(memory(), secrets);
    expect(k.status().providers.hydracept).toBe('server');
    expect(k.field('hydracept', 'project')).toBe('cpr_server');
  });

  it('Settings, Providers keeps the project with the key, asks for it, and forgets both', async () => {
    const store = memory();
    const put = (body: unknown) => keysRoute(new Request('http://x/api/keys/hydracept', { method: 'PUT', body: JSON.stringify(body) }), store, ['hydracept']);
    await expect(put({ key: 'hk' })).rejects.toMatchObject({ status: 400, message: /project/ });
    await put({ key: 'hk', project: 'cpr_1', environment: 'production' });
    expect(store.value.fields?.hydracept).toEqual({ project: 'cpr_1', environment: 'production' });
    await keysRoute(new Request('http://x/api/keys/hydracept', { method: 'DELETE' }), store, ['hydracept']);
    expect(store.value.keys.hydracept).toBeUndefined();
    expect(store.value.fields?.hydracept).toBeUndefined();
  });

  it('comes after the user\'s own keys in automatic, and first when it is the only one', async () => {
    const both = await loadKeys(memory({ keys: { elevenlabs: 'el', openai: 'oa', hydracept: 'hk' }, fields: { hydracept: { project: 'cpr_1' } } }));
    expect(soundConfig(both)).toEqual({ sfx: ['elevenlabs', 'hydracept'], music: ['elevenlabs', 'hydracept'], voice: ['elevenlabs', 'openai', 'hydracept'] });
    expect(imageConfig(both)).toEqual(['openai', 'hydracept']);
    expect(videoConfig(both)).toEqual(['hydracept']);
    const only = await keys();
    expect(soundConfig(only).sfx).toEqual(['hydracept']);
    expect(imageConfig(only)).toEqual(['hydracept']);
    expect(videoConfig(only)).toEqual(['hydracept']);
  });
});

describe('the routes, without Hydracept', () => {
  const none = () => loadKeys(memory());
  it('an unknown provider is a clean error', async () => {
    await expect(generate(new Request('http://x/api/generate', { method: 'POST', body: JSON.stringify({ kind: 'sfx', prompt: 'x', provider: 'nope' }) }), { keys: await none(), fetch: out }))
      .rejects.toMatchObject({ status: 503, message: /no provider for sfx/ });
  });
  it('no provider names every provider of that kind', async () => {
    const secrets: Secrets = { read: () => undefined, name: (p) => `${p.toUpperCase()}_API_KEY` };
    const k = await loadKeys(memory(), secrets);
    await expect(generate(new Request('http://x/api/generate', { method: 'POST', body: JSON.stringify({ kind: 'voice', prompt: 'x' }) }), { keys: k, fetch: out }))
      .rejects.toMatchObject({ message: /ELEVENLABS_API_KEY or OPENAI_API_KEY or GEMINI_API_KEY or HYDRACEPT_API_KEY/ });
    await expect(generateImage(new Request('http://x/api/generate-image', { method: 'POST', body: JSON.stringify({ prompt: 'x' }) }), { keys: k, fetch: out }))
      .rejects.toMatchObject({ message: /OPENAI_API_KEY or GEMINI_API_KEY or ZAI_API_KEY or HYDRACEPT_API_KEY/ });
    await expect(generateVideo(new Request('http://x/api/generate-video', { method: 'POST', body: JSON.stringify({ prompt: 'x' }) }), { keys: k, fetch: out }))
      .rejects.toMatchObject({ message: /HYDRACEPT_API_KEY/ });
  });
});

describe('hydracept polling', () => {
  it('never sleeps past the deadline, whatever pollAfterSeconds says', async () => {
    vi.useFakeTimers();
    try {
      let polls = 0;
      vi.stubGlobal('fetch', (u: string | URL, init?: RequestInit) => {
        const url = String(u);
        if (url.includes('/quote')) return Promise.resolve(new Response(JSON.stringify({ quoteId: 'q' })));
        if (init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ jobId: 'j' })));
        polls++;
        return Promise.resolve(new Response(JSON.stringify({ jobId: 'j', status: 'running', pollAfterSeconds: 3600 })));
      });
      const run = hydraceptSfx(media.hydracept, { prompt: 'x' }, out);
      const settled = expect(run).rejects.toMatchObject({ status: 504 });
      await vi.advanceTimersByTimeAsync(120_000);
      await settled;
      expect(polls).toBe(2);
    } finally { vi.useRealTimers(); }
  });

  it('a refusal reads as the other providers\' do', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ detail: { message: 'quota exceeded' } }), { status: 402 })));
    await expect(hydraceptSfx(media.hydracept, { prompt: 'x' }, out)).rejects.toMatchObject({ status: 400, message: 'hydracept: quota exceeded' });
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

  it('requests MP3 for music with Tramme duration mapped to durationMs', async () => {
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

  it('quotes and submits a Veo clip with the model in executionConstraints', async () => {
    const calls = stubHydraceptJob(MP4, 'video/mp4');
    const run = await hydraceptVideo(media.hydracept, { prompt: 'a paper boat', ratio: '9:16', duration: 6 }, out);
    const job = calls.find((c) => c.url.includes('/video.generate.v1/jobs') && c.method === 'POST');
    const input = job?.body?.input as Record<string, unknown>;
    const execution = job?.body?.execution as Record<string, unknown>;
    expect(input).toMatchObject({ prompt: 'a paper boat', aspectRatio: '9:16', durationSeconds: 6 });
    expect(input?.sourceImage).toBeUndefined();
    expect(execution?.executionConstraints).toEqual({ preferredModel: HYDRACEPT_VIDEO_MODEL });
    // the quote priced the same model the job runs
    const quote = calls.find((c) => c.url.includes('/video.generate.v1/quote'));
    expect((quote?.body?.execution as Record<string, unknown>)?.executionConstraints).toEqual({ preferredModel: HYDRACEPT_VIDEO_MODEL });
    expect(run.model).toBe(HYDRACEPT_VIDEO_MODEL);
    expect(run.type).toBe('video/mp4');
    expect(new Uint8Array(run.bytes)).toEqual(MP4);
  });

  it('sends a still as the opening frame, and keeps to the lengths Veo takes', async () => {
    const calls = stubHydraceptJob(MP4, 'video/mp4');
    const source = { dataUrl: `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`, mimeType: 'image/png' };
    await hydraceptVideo(media.hydracept, { prompt: 'animate it', duration: 5, source }, out);
    const job = calls.find((c) => c.url.includes('/video.generate.v1/jobs') && c.method === 'POST');
    expect((job?.body?.input as Record<string, unknown>)?.sourceImage).toEqual(source);
    expect((job?.body?.input as Record<string, unknown>)?.durationSeconds).toBe(6);
    expect(videoSecondsOf(3)).toBe(4);
    expect(videoSecondsOf(5)).toBe(6);
    expect(videoSecondsOf(7)).toBe(8);
    expect(videoSecondsOf(undefined)).toBe(8);
  });
});

describe('routes with Hydracept', () => {
  const reach = async () => ({ keys: await keys(), fetch: out });

  it('generate-image names Hydracept and records receipt ids', async () => {
    stubHydraceptJob(PNG, 'image/png');
    const res = await generateImage(new Request('http://localhost/api/generate-image', { method: 'POST', body: JSON.stringify({ prompt: 'sky' }) }), await reach());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-tramme-provider')).toBe('hydracept');
    expect(res.headers.get('x-tramme-hydracept-receipt')).toBe('rcpt_1');
    expect(res.headers.get('x-tramme-hydracept-quote')).toBe('quo_1');
  });

  it('generate-video names Hydracept, returns the clip and records receipt ids', async () => {
    stubHydraceptJob(MP4, 'video/mp4');
    const res = await generateVideo(new Request('http://localhost/api/generate-video', { method: 'POST', body: JSON.stringify({ prompt: 'a paper boat', ratio: '9:16', duration: '4' }) }), await reach());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('x-tramme-provider')).toBe('hydracept');
    expect(res.headers.get('x-tramme-model')).toBe(HYDRACEPT_VIDEO_MODEL);
    expect(res.headers.get('x-tramme-hydracept-receipt')).toBe('rcpt_1');
    expect(res.headers.get('x-tramme-hydracept-quote')).toBe('quo_1');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP4);
  });

  it('generate-video sends a still as the opening frame', async () => {
    const calls = stubHydraceptJob(MP4, 'video/mp4');
    const dataUrl = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;
    const res = await generateVideo(new Request('http://localhost/api/generate-video', { method: 'POST', body: JSON.stringify({ prompt: 'animate it', source: dataUrl }) }), await reach());
    expect(res.status).toBe(200);
    const job = calls.find((c) => c.url.includes('/video.generate.v1/jobs') && c.method === 'POST');
    expect((job?.body?.input as Record<string, unknown>)?.sourceImage).toEqual({ dataUrl, mimeType: 'image/png', filename: 'source.png' });
    expect((job?.body?.input as Record<string, unknown>)?.durationSeconds).toBe(8);
  });

  it('reads a clip source through the pictures parser, including its 12 MB limit', () => {
    const picture = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;
    expect(videoSourceOf(picture)).toEqual({ dataUrl: picture, mimeType: 'image/png', filename: 'source.png' });
    expect(videoSourceOf(undefined)).toBeUndefined();
    expect(() => videoSourceOf(`data:image/png;base64,${'A'.repeat(16_000_001)}`)).toThrow(/about 12 MB/);
  });

  it('generate-video refuses a source that is not a picture data URL', async () => {
    stubHydraceptJob(MP4, 'video/mp4');
    await expect(generateVideo(new Request('http://localhost/api/generate-video', { method: 'POST', body: JSON.stringify({ prompt: 'x', source: 'https://example.com/a.png' }) }), await reach()))
      .rejects.toMatchObject({ status: 400, message: /data URL/ });
  });

  it('generate sfx through Hydracept by default as audio/mpeg', async () => {
    stubHydraceptJob(MP3, 'audio/mpeg');
    const res = await generate(new Request('http://localhost/api/generate', { method: 'POST', body: JSON.stringify({ kind: 'sfx', prompt: 'click' }) }), await reach());
    expect(res.headers.get('x-tramme-provider')).toBe('hydracept');
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
  });

  it('generate music through Hydracept without an ElevenLabs key', async () => {
    stubHydraceptJob(MP3, 'audio/mpeg');
    const res = await generate(new Request('http://localhost/api/generate', { method: 'POST', body: JSON.stringify({ kind: 'music', prompt: 'calm piano', duration: 12 }) }), await reach());
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
    const res = await voices(new Request('http://localhost/api/voices?search=ali'), await reach());
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
