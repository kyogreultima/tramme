// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

const { chunkStarts, transcribeSamples } = await import('../src/speech.ts');

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

describe('transcribeUrl-like runs (chunks of a long sound)', () => {
  const quiet = (n: number) => new Float32Array(n * 16000);

  it('sends the server several chunks at once after the first, and one at a time on this machine', async () => {
    let now = 0, most = 0;
    const words = async (_s: Float32Array, _l: string | undefined, backend: string) => {
      now++; most = Math.max(most, now);
      await new Promise((r) => setTimeout(r, 5));
      now--;
      return { words: [], backend: backend as 'server', language: 'fr' };
    };
    await transcribeSamples(quiet(26 * 9 + 2), 'server', { words });
    expect(most).toBe(4);
    most = 0;
    await transcribeSamples(quiet(26 * 9 + 2), 'local', { words });
    expect(most).toBe(1);
  });

  it('says where a chunk is heard while it waits there, not where it was first sent', async () => {
    const { transcribeChunks } = await import('../src/speech.ts');
    const stages: string[] = [];
    const words = async (_s: Float32Array, _l: string | undefined, _b: string, _local: unknown, way?: { tell?: (b: 'server' | 'companion') => void }) => {
      way?.tell?.('server');
      // the server failed: the companion takes the chunk, and the label says so while it works
      way?.tell?.('companion');
      stages.push('heard');
      return { words: [], backend: 'companion' as const };
    };
    await transcribeChunks(10, async (f, t) => quiet(t - f), { backend: 'server', wordsOf: words as never, onProgress: (_d, _t, stage) => stages.push(stage) });
    const i = stages.indexOf('heard');
    expect(stages[i - 1]).toBe('speech.localCompanion');
    expect(stages.at(-1)).toBe('speech.done');
  });

  it('stops when the user cancels: no chunk is sent after', async () => {
    const { transcribeChunks } = await import('../src/speech.ts');
    const stop = new AbortController();
    let sent = 0;
    const words = async (_s: Float32Array, _l: string | undefined, backend: string) => { sent++; stop.abort(); return { words: [], backend: backend as 'browser' }; };
    await expect(transcribeChunks(26 * 5, async (f, t) => quiet(t - f), { backend: 'browser', wordsOf: words as never, signal: stop.signal })).rejects.toThrow();
    expect(sent).toBe(1);
  });

  it('discards a single chunk cancelled while the model is working', async () => {
    const { transcribeChunks } = await import('../src/speech.ts');
    const stop = new AbortController();
    const words = async () => {
      stop.abort();
      return { words: [{ w: 'discard me', s: 0, e: 1 }], backend: 'browser' as const };
    };
    await expect(transcribeChunks(2, async (f, t) => quiet(t - f), {
      backend: 'browser', wordsOf: words as never, signal: stop.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
