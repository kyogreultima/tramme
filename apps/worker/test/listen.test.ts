import { describe, expect, it, vi } from 'vitest';
import { listen } from '../src/listen.ts';
import type { Env } from '../src/http.ts';

describe('live transcription', () => {
  it('passes typed Nova-3 options to Workers AI', async () => {
    const run = vi.fn(async () => new Response(null, { status: 200 }));
    const env = { AI: { run } } as unknown as Env;
    const request = new Request('https://app.example/api/listen?language=fr', { headers: { upgrade: 'websocket' } });

    await listen(request, env);

    expect(run).toHaveBeenCalledWith('@cf/deepgram/nova-3', {
      encoding: 'linear16', sample_rate: 16000, channels: 1, language: 'fr',
      interim_results: true, smart_format: true, punctuate: true,
    }, { websocket: true });
  });
});
