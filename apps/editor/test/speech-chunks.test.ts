// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

const { chunkStarts, spokenLanguage, transcribeSamples } = await import('../src/speech.ts');

describe('chunkStarts', () => {
  it('cuts a sound in 28 s chunks, one every 26 s', () => {
    expect(chunkStarts(10)).toEqual([0]);
    expect(chunkStarts(28)).toEqual([0]);
    expect(chunkStarts(30)).toEqual([0, 26]);
    expect(chunkStarts(60)).toEqual([0, 26, 52]);
  });
});

describe('transcribeSamples', () => {
  it('runs each chunk on the chosen backend and counts the overlap once', async () => {
    const word = (w: string, s: number, e: number) => ({ w, s, e });
    // chunk 0 hears "b" at 27.0 s (in the overlap), chunk 1 hears it again at 1.0 s of its own (27.0 s)
    const said = [[word('a', 1, 1.4), word('b', 27, 27.4)], [word('b', 1, 1.4), word('c', 10, 10.4)]];
    const calls: { backend: string; length: number }[] = [];
    const words = vi.fn(async (samples: Float32Array, _language: string | undefined, backend: string) => {
      calls.push({ backend, length: samples.length });
      return { words: said[calls.length - 1], backend: backend as 'browser', language: 'en' };
    });
    const text = await transcribeSamples(new Float32Array(40 * 16000), 'local', { words });
    expect(calls.map((c) => c.backend)).toEqual(['browser', 'browser']);
    // 28 s then 14 s
    expect(calls.map((c) => c.length / 16000)).toEqual([28, 14]);
    expect(text).toBe('a b c');
  });

  it('maps the setting to a backend', async () => {
    const seen: string[] = [];
    const words = async (_s: Float32Array, _l: string | undefined, backend: string) => { seen.push(backend); return { words: [], backend: backend as 'server' }; };
    await transcribeSamples(new Float32Array(16000), 'companion', { words });
    await transcribeSamples(new Float32Array(16000), 'server', { words });
    expect(seen).toEqual(['companion', 'server']);
  });

  it('runs a dictation on the processor, its download told', async () => {
    const seen: unknown[] = [];
    const words = async (_s: Float32Array, _l: string | undefined, backend: string, local?: unknown) => { seen.push(local); return { words: [], backend: backend as 'browser' }; };
    const local = { cpu: true, progress: () => {} };
    await transcribeSamples(new Float32Array(16000), 'local', { words, local });
    expect(seen).toEqual([local]);
  });
});

describe('spokenLanguage', () => {
  it('takes the language Whisper finds most likely after the start of the transcript', async () => {
    const logits = new Float32Array(10);
    logits[3] = 2; logits[4] = 5; logits[5] = 1;
    const asked: unknown[] = [];
    const model = Object.assign(async (inputs: { input_features: unknown; decoder_input_ids: unknown }) => {
      const ids = inputs.decoder_input_ids as { data: BigInt64Array }; asked.push(ids.data[0]); return { logits: { data: logits } }; },
      { generation_config: { decoder_start_token_id: 7, lang_to_id: { '<|en|>': 3, '<|fr|>': 4, '<|de|>': 5 } } });
    const run = { model, processor: async () => ({ input_features: {} }) };
    expect(await spokenLanguage(run, new Float32Array(16000))).toBe('fr');
    expect(asked).toEqual([7n]);
  });
});
