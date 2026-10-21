// Speech to text on this machine, for the companion: Whisper run locally with
// transformers.js (no account, no key). The model downloads once, on first
// use, into the user's cache. Same input and output as the Worker's route:
// a WAV chunk (16 kHz mono) in, words with their timing out. The model is
// the one chosen in the editor's settings (Models, Transcription), unless
// TRAMME_WHISPER_MODEL names another for this machine.

import { asrWords } from '@tramme/core';

const DEFAULT_MODEL = 'Xenova/whisper-small';

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;
const loaded = new Map<string, Promise<Asr>>();

/** the model a request runs: the machine's override, else the one the editor asks for (a model hub id), else the default */
export function whisperModel(asked?: unknown, env = process.env.TRAMME_WHISPER_MODEL): string {
  if (env) return env;
  return typeof asked === 'string' && /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/.test(asked) ? asked : DEFAULT_MODEL;
}

function model(id: string): Promise<Asr> {
  if (!loaded.has(id)) {
    const p = import('@huggingface/transformers').then(async ({ pipeline }) => (await pipeline('automatic-speech-recognition', id, { dtype: 'q8' } as never)) as unknown as Asr);
    // a model that failed to load is tried again next time
    loaded.set(id, p.catch((e) => { loaded.delete(id); throw e; }));
  }
  return loaded.get(id)!;
}

/** 16-bit PCM WAV (mono) as samples between -1 and 1 */
function pcm(wav: Buffer): { samples: Float32Array; rate: number } {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAV expected');
  let o = 12, rate = 16000, channels = 1, bits = 16;
  while (o + 8 <= wav.length) {
    const id = wav.toString('ascii', o, o + 4), size = wav.readUInt32LE(o + 4);
    if (id === 'fmt ') { channels = wav.readUInt16LE(o + 10); rate = wav.readUInt32LE(o + 12); bits = wav.readUInt16LE(o + 22); }
    if (id === 'data') {
      if (bits !== 16) throw new Error('16-bit WAV expected');
      const n = Math.floor(size / 2 / channels), out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = wav.readInt16LE(o + 8 + i * 2 * channels) / 32768;
      return { samples: out, rate };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error('WAV without data');
}

export async function transcribeLocal(audioBase64: string, language?: string, asked?: string) {
  const { samples, rate } = pcm(Buffer.from(audioBase64, 'base64'));
  if (rate !== 16000) throw new Error(`16 kHz expected (got ${rate} Hz)`);
  const id = whisperModel(asked);
  const run = await model(id);
  const out = await run(samples, { return_timestamps: 'word', chunk_length_s: 30, ...(language ? { language } : {}), task: 'transcribe' });
  const words = asrWords(out);
  return { words, text: out.text.trim(), language, duration: samples.length / rate, model: id };
}
