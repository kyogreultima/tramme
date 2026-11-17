// Text and audio in one shared space: a missing browser model leaves word search intact.

export const CLAP_MODEL = 'Xenova/clap-htsat-unfused';
export const CLAP_REVISION = 'c28f2883575e590e04d3146ff0713c2448d691ba';
const DIM = 512;

function normal(v: ArrayLike<number>): Float32Array {
  const length = Math.sqrt(Array.from(v).reduce((sum, x) => sum + x * x, 0));
  return Float32Array.from(v, (x) => length ? x / length : 0);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

function quantize(v: Float32Array): { scale: number; bytes: Int8Array } {
  if (v.length !== DIM) throw new Error('CLAP vector must have 512 elements');
  const scale = Math.max(...v.map(Math.abs), 1e-9) / 127;
  return { scale, bytes: Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round(x / scale)))) };
}

export function packVector(v: Float32Array): string {
  const { scale, bytes } = quantize(v), raw = new Uint8Array(4 + DIM);
  new DataView(raw.buffer).setFloat32(0, scale, true);
  raw.set(new Uint8Array(bytes.buffer), 4);
  return btoa(String.fromCharCode(...raw));
}

export function unpackVector(s: string): Float32Array {
  const raw = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  if (raw.length !== 4 + DIM) throw new Error('invalid CLAP vector');
  const scale = new DataView(raw.buffer).getFloat32(0, true);
  return Float32Array.from(new Int8Array(raw.buffer, 4), (x) => x * scale);
}

let textModel: Promise<{ tokenizer: any; model: any }> | null = null;
let audioModel: Promise<{ processor: any; model: any }> | null = null;

async function textEngine() {
  if (typeof caches === 'undefined') return null;
  textModel ??= (async () => {
    const { AutoTokenizer, ClapTextModelWithProjection } = await import('@huggingface/transformers');
    const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const options = { revision: CLAP_REVISION, device: gpu ? 'webgpu' : 'wasm', dtype: gpu ? 'fp16' : 'q8' } as const;
    const [tokenizer, model] = await Promise.all([AutoTokenizer.from_pretrained(CLAP_MODEL, options), ClapTextModelWithProjection.from_pretrained(CLAP_MODEL, options)]);
    return { tokenizer, model };
  })();
  return textModel.catch(() => null);
}

async function audioEngine() {
  if (typeof caches === 'undefined') return null;
  audioModel ??= (async () => {
    const { AutoProcessor, ClapAudioModelWithProjection } = await import('@huggingface/transformers');
    const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const options = { revision: CLAP_REVISION, device: gpu ? 'webgpu' : 'wasm', dtype: gpu ? 'fp16' : 'q8' } as const;
    const [processor, model] = await Promise.all([AutoProcessor.from_pretrained(CLAP_MODEL, options), ClapAudioModelWithProjection.from_pretrained(CLAP_MODEL, options)]);
    return { processor, model };
  })();
  return audioModel.catch(() => null);
}

export async function textVector(text: string): Promise<Float32Array | null> {
  const engine = await textEngine();
  if (!engine) return null;
  try {
    const inputs = engine.tokenizer([text], { padding: true, truncation: true });
    const result = await engine.model(inputs);
    return normal(result.text_embeds.data);
  } catch { return null; }
}

export async function audioVector(buffer: AudioBuffer): Promise<Float32Array | null> {
  const engine = await audioEngine();
  if (!engine) return null;
  try {
    const length = Math.max(1, Math.min(480000, Math.round(buffer.duration * 48000)));
    const ctx = new OfflineAudioContext(1, length, 48000);
    const mono = ctx.createBuffer(1, buffer.length, buffer.sampleRate);
    const dst = mono.getChannelData(0);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      for (let i = 0; i < src.length; i++) dst[i] += src[i] / buffer.numberOfChannels;
    }
    const source = ctx.createBufferSource();
    source.buffer = mono;
    source.connect(ctx.destination);
    source.start();
    const inputs = await engine.processor((await ctx.startRendering()).getChannelData(0));
    const result = await engine.model(inputs);
    return normal(result.audio_embeds.data);
  } catch { return null; }
}

export async function catalogVectors(): Promise<Map<string, Float32Array>> {
  const result = new Map<string, Float32Array>();
  try {
    const response = await fetch('/sounds/clap.bin');
    if (!response.ok) return result;
    const raw = await response.arrayBuffer(), view = new DataView(raw), bytes = new Uint8Array(raw);
    let offset = 4;
    for (let i = 0, n = view.getUint32(0, true); i < n; i++) {
      const length = view.getUint16(offset, true); offset += 2;
      const id = new TextDecoder().decode(bytes.subarray(offset, offset + length)); offset += length;
      const scale = view.getFloat32(offset, true); offset += 4;
      result.set(id, Float32Array.from(new Int8Array(raw, offset, DIM), (x) => x * scale));
      offset += DIM;
    }
  } catch { return new Map(); }
  return result;
}
