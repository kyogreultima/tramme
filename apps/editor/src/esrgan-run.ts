// Real-ESRGAN run in the browser: the graph and its weights from the model
// cache, onnxruntime (wasm), one tile at a time; the picture comes back twice
// as large. A model that cannot load is no reason to stop: the caller falls
// back on the core's Lanczos.

import type { ModelEntry } from './models.ts';
import { hubFile } from './cutout.ts';
import { halve, upscaleTiled, type Rgba } from './esrgan.ts';

type Session = { run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>; inputNames: string[]; outputNames: string[] };
const sessions = new Map<string, Promise<{ session: Session; ort: typeof import('onnxruntime-web/webgpu') }>>();

async function open(entry: ModelEntry) {
  if (entry.adapter.kind !== 'esrgan') throw new Error(`${entry.name} is not a super-resolution model`);
  const a = entry.adapter;
  let s = sessions.get(entry.id);
  if (!s) {
    s = (async () => {
      // transformers.js sets onnxruntime up (where its wasm files are): load it first
      await import('@huggingface/transformers');
      // the build transformers.js configures (where its wasm files are): a second build would look for them in the wrong place
      const ort = await import('onnxruntime-web/webgpu');
      const [graph, ...weights] = await Promise.all([entry.source, ...a.more].map((u) => hubFile(u)));
      const external = a.more.map((u, i) => ({ path: u.split('/').pop()!, data: new Uint8Array(weights[i]) }));
      const open = (ep: 'webgpu' | 'wasm') => ort.InferenceSession.create(new Uint8Array(graph), { executionProviders: [ep], externalData: external } as never);
      const session = await ('gpu' in navigator ? open('webgpu').catch(() => open('wasm')) : open('wasm'));
      return { session: session as unknown as Session, ort };
    })();
    s.catch(() => sessions.delete(entry.id));
    sessions.set(entry.id, s);
  }
  return s;
}

/** a picture twice as large, made by the model: enlarged four times tile by tile, then brought down by the mean of each block (finer than enlarging twice) */
export async function enlargeWithModel(entry: ModelEntry, src: Rgba, progress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<Rgba> {
  const { session, ort } = await open(entry);
  if (entry.adapter.kind !== 'esrgan') throw new Error('not a super-resolution model');
  const { tile, pad } = entry.adapter;
  const big = await upscaleTiled(src, tile, pad, async (input, side) => {
    if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, side, side]) });
    return out[session.outputNames[0]].data;
  }, progress);
  return halve(big);
}
