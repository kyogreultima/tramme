// Real-ESRGAN run in the browser: the graph and its weights from the model
// cache, onnxruntime (wasm), one tile at a time; the picture comes back twice
// as large. A model that cannot load is no reason to stop: the caller falls
// back on the core's Lanczos.

import type { ModelEntry } from './models.ts';
import { sessionOf } from './onnx-session.ts';
import { halve, upscaleTiled, type Rgba } from './esrgan.ts';

/** a picture twice as large, made by the model: enlarged four times tile by tile, then brought down by the mean of each block (finer than enlarging twice) */
export async function enlargeWithModel(entry: ModelEntry, src: Rgba, progress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<Rgba> {
  if (entry.adapter.kind !== 'esrgan') throw new Error(`${entry.name} is not a super-resolution model`);
  const { session, ort } = await sessionOf(entry);
  const { tile, pad } = entry.adapter;
  const big = await upscaleTiled(src, tile, pad, async (input, side) => {
    if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, side, side]) });
    return out[session.outputNames[0]].data;
  }, progress);
  return halve(big);
}
