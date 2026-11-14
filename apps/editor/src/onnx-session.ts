// A network read with onnxruntime in the browser, opened once per model and
// kept: its graph and the files of its weights from the model cache, on the
// GPU (WebGPU) when the browser has one, on the processor otherwise. A failed
// opening is forgotten, so the next run tries again; a session whose GPU was
// lost is dropped, and one can be asked on the processor alone. Real-ESRGAN
// and RIFE run on it.

import type { ModelEntry } from './models.ts';
import { filesOf } from './models.ts';
import { hubFile } from './cutout.ts';

export type Session = { run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims?: readonly number[] }>>; inputNames: string[]; outputNames: string[]; release?(): Promise<void> };
export type Ort = typeof import('onnxruntime-web/webgpu');

const sessions = new Map<string, Promise<{ session: Session; ort: Ort }>>();
const key = (entry: ModelEntry, cpu: boolean) => (cpu ? `${entry.id}:cpu` : entry.id);

/** the model's session and the onnxruntime that runs it; `cpu` on the processor whatever the browser has */
export function sessionOf(entry: ModelEntry, opts: { cpu?: boolean } = {}): Promise<{ session: Session; ort: Ort }> {
  const k = key(entry, !!opts.cpu);
  let s = sessions.get(k);
  if (!s) {
    s = (async () => {
      // transformers.js sets onnxruntime up (where its wasm files are): load it first
      await import('@huggingface/transformers');
      // the build transformers.js configures (where its wasm files are): a second build would look for them in the wrong place
      const ort = await import('onnxruntime-web/webgpu');
      const [graph, ...weights] = await Promise.all(filesOf(entry).map((u) => hubFile(u)));
      const external = filesOf(entry).slice(1).map((u, i) => ({ path: u.split('/').pop()!, data: new Uint8Array(weights[i]) }));
      const open = (ep: 'webgpu' | 'wasm') => ort.InferenceSession.create(new Uint8Array(graph), { executionProviders: [ep], ...(external.length ? { externalData: external } : {}) } as never);
      const session = await (!opts.cpu && 'gpu' in navigator ? open('webgpu').catch(() => open('wasm')) : open('wasm'));
      return { session: session as unknown as Session, ort };
    })();
    s.catch(() => sessions.delete(k));
    sessions.set(k, s);
  }
  return s;
}

/** the session forgotten (its GPU was lost): the next run opens a new one */
export function dropSession(entry: ModelEntry, opts: { cpu?: boolean } = {}) {
  const k = key(entry, !!opts.cpu), s = sessions.get(k);
  sessions.delete(k);
  void s?.then(({ session }) => session.release?.()).catch(() => {});
}
