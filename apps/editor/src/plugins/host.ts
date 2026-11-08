// The page's end of the plugin sandbox: it owns the worker and bridges the
// contexts. A tool or check that runs inside asks for the project's files,
// stills and transcripts here, and its operations come back as plain data,
// validated and proposed like any tool's (ai/tools.ts calls the wrappers the
// registry carries — plugins/vocabulary.ts puts them there).

import { toolOutput, type CheckContext, type MotionReport, type NodeType, type PlacedLayer, type QualityIssue, type SoundCue, type ToolContext, type ToolOutput } from '@tramme/core';
import type { Ask, ClockSample, DrawPayload, DrawResult, FramePayload, FromWorker, LayerSample, MotionSample, PlacedSample, PluginDecl, SandboxDoc, ToWorker } from './protocol.ts';

/** the schema of a node without its code: what a check's samples may cross */
const schemaOf = (n: NodeType) => ({ type: n.type, title: n.title, category: n.category, description: n.description, ai: n.ai, props: n.props, ...(n.container ? { container: true } : {}) });
const projectPath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 &&
  !value.includes('\\') && !value.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
  value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
const RESPONSE_LIMIT = 8 * 1024 * 1024;
const OUTBOUND_LIMIT = 64 * 1024 * 1024;
const GRAPHICS_LIMIT = 256 * 1024 * 1024;
const canvasSize = (width: number, height: number, scale = 1) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !Number.isFinite(scale) || scale <= 0) throw new Error('invalid sandbox canvas');
  if (width > 8192 || height > 8192 || width * scale > 8192 || height * scale > 8192) throw new Error('sandbox canvas exceeds 8192 pixels');
};
/** Check nested plain data without serializing a potentially hostile response. */
function responseTooLarge(value: unknown, limit = RESPONSE_LIMIT): boolean {
  const stack = [value], seen = new Set<object>(), encoder = new TextEncoder();
  let bytes = 0, entries = 0;
  while (stack.length) {
    if (++entries > 10000) return true;
    const item = stack.pop();
    if (typeof item === 'string') { if (item.length > limit) return true; bytes += encoder.encode(item).byteLength; }
    else if (!item || typeof item !== 'object') continue;
    else if (seen.has(item)) continue;
    else {
      seen.add(item);
      if (typeof ImageBitmap !== 'undefined' && item instanceof ImageBitmap) {
        if (item.width > 8192 || item.height > 8192 || item.width * item.height > 8192 * 8192) return true;
      } else if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) bytes += item.byteLength;
      else if (typeof Blob !== 'undefined' && item instanceof Blob) bytes += item.size;
      else if (item instanceof Map) { if (item.size > 10000) return true; for (const [key, content] of item) stack.push(key, content); }
      else if (item instanceof Set) { if (item.size > 10000) return true; for (const content of item) stack.push(content); }
      else {
        if (Array.isArray(item) && item.length > 10000) return true;
        const fields = Object.entries(item);
        if (fields.length > 10000) return true;
        for (const [key, content] of fields) { bytes += key.length; stack.push(content); }
      }
    }
    if (bytes > limit) return true;
  }
  return false;
}

/** Bound the decoded bitmap surfaces in one bridge message, separately from plain data. */
function graphicsTooLarge(value: unknown): boolean {
  if (typeof ImageBitmap === 'undefined') return false;
  const stack = [value], seen = new Set<object>();
  let bytes = 0;
  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    if (seen.size >= 10000) return true;
    seen.add(item);
    if (item instanceof ImageBitmap) {
      if (!Number.isSafeInteger(item.width) || !Number.isSafeInteger(item.height) || item.width < 1 || item.height < 1) return true;
      bytes += item.width * item.height * 4;
      if (bytes > GRAPHICS_LIMIT) return true;
    } else if (Array.isArray(item)) stack.push(...item);
    else if (item instanceof Map) for (const [key, content] of item) stack.push(key, content);
    else if (item instanceof Set) for (const content of item) stack.push(content);
    else if (!(item instanceof ArrayBuffer) && !ArrayBuffer.isView(item)) stack.push(...Object.values(item));
  }
  return false;
}

/** Read only approved bytes; cancel a slow or oversized response before it fills memory. */
export async function readLimitedBody(response: Response, max: number, label: string): Promise<Uint8Array> {
  const tooLarge = () => new Error(`${label} exceeds ${max / (1024 * 1024)} MB`);
  const length = response.headers.get('content-length');
  if (length && Number(length) > max) { await response.body?.cancel(); throw tooLarge(); }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) throw tooLarge();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

export interface PluginHost {
  /**
   * the declarations of the loaded plugins, once these ones are (a known url
   * is not loaded again; a load under way is waited for); rejects with the
   * sandbox's reason when one cannot load, which the next call tries again
   */
  ensure(plugins: { id: string; url: string }[]): Promise<Map<string, PluginDecl>>;
  /** run a plugin's tool against the page's context; rejects on error or abort */
  runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutput>;
  /** run a plugin's check against the page's context */
  runCheck(name: string, ctx: CheckContext): Promise<QualityIssue[]>;
  /** the document's side of the sandbox (assets, fonts): sent when it changes */
  setDoc(doc: SandboxDoc): void;
  /** draw a frame's sandboxed layers; resolves with one result per item */
  draw(payload: DrawPayload): Promise<DrawResult[]>;
  /** a node's vector export, computed in the sandbox */
  exportOf(type: string, props: unknown): Promise<{ svg?: string; lottie?: unknown; err?: string }>;
  /** a whole composition evaluated and drawn in the sandbox; one picture comes back */
  renderFrame(payload: FramePayload): Promise<{ bitmap?: unknown; err?: string }>;
  /** an evaluated property, computed in the worker */
  evaluateValue(address: string, t: number, compId: string): Promise<unknown>;
  /** values[address][time], sampled together in one isolated evaluator */
  evaluateSeries(addresses: string[], times: number[], compId: string): Promise<unknown[][]>;
  evaluateLayers(ids: string[], t: number, compId: string): Promise<LayerSample[]>;
  soundCues(compId: string): Promise<SoundCue[]>;
  sampleClock(layerId: string, compId: string, compTimes: number[], fileTimes: number[]): Promise<ClockSample>;
  pictureMotion(compId: string): Promise<MotionSample>;
  motionReport(compId: string, from: number, to: number): Promise<MotionReport>;
  samplePlaced(t: number, compId: string): Promise<PlacedSample[]>;
  /** stop: every call waiting is refused, with `reason` when there is one */
  dispose(reason?: string): void;
  /** disposed (its worker stopped): the next project's or call's sandbox is a new one */
  closed(): boolean;
}

/**
 * The protocol's page side, on any transport (a worker in the editor, a
 * direct pair in tests). `docUrl` is the open document's address, the base
 * the sandbox resolves asset and file urls against.
 */
export function connectHost(send: (m: ToWorker) => void, docUrl: () => string, onTimeout?: (reason: string) => void): { host: PluginHost; receive: (m: FromWorker) => void } {
  let call = 0, closed = false;
  const decls = new Map<string, PluginDecl>();
  const waits = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  /** each plugin's latest load: its url, settled by the sandbox's answer (a failed one is forgotten, to be tried again) */
  const loads = new Map<string, { url: string; done: Promise<PluginDecl> }>();
  /** the answers awaited, by plugin and url (an older url's answer may still come) */
  const answers = new Map<string, { resolve: (d: PluginDecl) => void; reject: (e: Error) => void }>();
  const answerKey = (id: string, url: string) => `${id}\n${url}`;
  const timeout = (reason: string) => (onTimeout ? onTimeout(reason) : host.dispose(reason));
  /** the page context of a running call, asked for files, stills, data */
  const bridges = new Map<number, ToolContext | CheckContext>();
  const pendingAsks = new Map<number, number>();
  let lastAskId = 0;
  /** a node type's schema, computed once (checks ship many samples of the same types) */
  const schemas = new WeakMap<NodeType, unknown>();
  const schemaShipped = (n: NodeType) => {
    let s = schemas.get(n);
    if (!s) { s = schemaOf(n); schemas.set(n, s); }
    return s;
  };

  const answer = (ctx: ToolContext | CheckContext, a: Ask): unknown | Promise<unknown> => {
    if (!a || typeof a !== 'object') throw new Error('unknown worker request');
    if (a.kind === 'readText') {
      if (!projectPath(a.path)) throw new Error('invalid project path');
      return (ctx as ToolContext).readText(a.path);
    }
    if (a.kind === 'packFile') {
      if (!projectPath(a.path)) throw new Error('invalid project path');
      const read = (ctx as ToolContext).packFile;
      if (!read) throw new Error("packFile: only the editor's own packs reach their data here");
      return read(a.path);
    }
    if (a.kind === 'files') return (ctx as ToolContext).files();
    if (a.kind === 'writeFile') {
      if (!projectPath(a.path)) throw new Error('invalid project path');
      const data = a.data;
      if (!data || typeof data !== 'object') throw new Error('invalid file data');
      if ('text' in data && typeof data.text === 'string' && data.text.length <= 64 * 1024 * 1024) return (ctx as ToolContext).writeFile(a.path, data.text);
      if ('bytes' in data && data.bytes instanceof ArrayBuffer && data.bytes.byteLength <= 64 * 1024 * 1024) return (ctx as ToolContext).writeFile(a.path, new Blob([data.bytes]));
      throw new Error('invalid file data');
    }
    if (a.kind === 'renderStill') {
      if (!Number.isFinite(a.t) || a.t < 0 || (a.compId !== undefined && (typeof a.compId !== 'string' || a.compId.length > 128))) throw new Error('invalid still request');
      return (ctx as ToolContext).renderStill(a.t, a.compId);
    }
    if (a.kind === 'transcript') {
      if (typeof a.assetId !== 'string' || a.assetId.length > 128 || typeof a.ask !== 'boolean') throw new Error('invalid transcript request');
      return (ctx as ToolContext).transcript(a.assetId, { ask: a.ask });
    }
    if (a.kind === 'fetch') {
      if (typeof a.url !== 'string' || a.url.length > 2048 || !/^https?:\/\//i.test(a.url)) throw new Error('invalid network request');
      let target: URL;
      try { target = new URL(a.url); } catch { throw new Error('invalid network request'); }
      if (target.username || target.password || (a.method !== undefined && (typeof a.method !== 'string' || !/^[A-Z]{1,12}$/i.test(a.method)))) throw new Error('invalid network request');
      if (a.headers !== undefined) {
        if (!a.headers || typeof a.headers !== 'object' || Array.isArray(a.headers)) throw new Error('invalid network request');
        const entries = Object.entries(a.headers);
        if (entries.length > 32 || entries.some(([key, value]) => key.length > 128 || typeof value !== 'string' || value.length > 4096)) throw new Error('invalid network request');
      }
      if (a.body !== undefined && !((typeof a.body === 'string' && a.body.length <= 64 * 1024 * 1024) || (a.body instanceof ArrayBuffer && a.body.byteLength <= 64 * 1024 * 1024))) throw new Error('invalid network request');
      const go = (ctx as ToolContext).fetch;
      if (!go) throw new Error('this plugin declared no network access (meta.permissions)');
      // the answer as plain data: the worker makes it a Response again
      return go(a.url, { method: a.method, headers: a.headers, body: a.body }).then(async (r) => ({
        status: r.status,
        headers: Object.fromEntries(r.headers),
        body: (await readLimitedBody(r, 64 * 1024 * 1024, 'network response')).buffer,
      }));
    }
    if (a.kind === 'data') {
      if (typeof a.assetId !== 'string' || a.assetId.length > 128 || !('data' in ctx)) throw new Error('invalid data request');
      return ctx.data(a.assetId);
    }
    throw new Error('unknown worker request');
  };

  const receive = (m: FromWorker) => {
    const invalid = () => timeout('invalid sandbox response');
    if (!m || typeof m !== 'object' || typeof m.kind !== 'string') { invalid(); return; }
    if ('call' in m && (!Number.isSafeInteger(m.call) || m.call < 1)) { invalid(); return; }
    if (m.kind === 'loaded') {
      if (!Array.isArray(m.plugins) || !Array.isArray(m.urls) || m.plugins.length !== m.urls.length || m.plugins.length > 64 ||
        m.plugins.some((d) => !d || typeof d !== 'object' || typeof d.id !== 'string' || d.id.length > 128) ||
        m.urls.some((url) => typeof url !== 'string' || url.length > 4 * 1024 * 1024)) { invalid(); return; }
      if (responseTooLarge(m.plugins)) { timeout('sandbox response exceeds 8 MB'); return; }
      m.plugins.forEach((d, i) => {
        const url = m.urls[i];
        // an older url's answer: its waiters have it, the plugin keeps the latest
        if (loads.get(d.id)?.url === url) decls.set(d.id, d);
        answers.get(answerKey(d.id, url))?.resolve(d);
        answers.delete(answerKey(d.id, url));
      });
      return;
    }
    if (m.kind === 'loadFailed') {
      if (typeof m.id !== 'string' || typeof m.url !== 'string' || typeof m.message !== 'string' || m.message.length > 4096) { invalid(); return; }
      if (loads.get(m.id)?.url === m.url) loads.delete(m.id);
      answers.get(answerKey(m.id, m.url))?.reject(new Error(`plugin ${m.id}: ${m.message}`));
      answers.delete(answerKey(m.id, m.url));
      return;
    }
    if (m.kind === 'result') {
      if (m.err !== undefined && typeof m.err !== 'string') { invalid(); return; }
      if (responseTooLarge(m.ok) || responseTooLarge(m.err)) { timeout('sandbox response exceeds 8 MB'); return; }
      const w = waits.get(m.call);
      if (!w) return;
      waits.delete(m.call);
      bridges.delete(m.call);
      if (m.err) w.reject(new Error(m.err));
      else w.resolve(m.ok);
      return;
    }
    if (m.kind === 'drawn') {
      if (!Array.isArray(m.results) || m.results.length > 10000) { invalid(); return; }
      if (responseTooLarge(m.results) || graphicsTooLarge(m.results)) { timeout('sandbox response exceeds its data or graphics budget'); return; }
      const w = waits.get(m.call);
      if (!w) return;
      waits.delete(m.call);
      w.resolve(m.results);
      return;
    }
    if (m.kind === 'exported') {
      if ((m.err !== undefined && typeof m.err !== 'string') || (m.svg !== undefined && typeof m.svg !== 'string')) { invalid(); return; }
      if (responseTooLarge(m.svg) || responseTooLarge(m.lottie) || responseTooLarge(m.err)) { timeout('sandbox response exceeds 8 MB'); return; }
      const w = waits.get(m.call);
      if (!w) return;
      waits.delete(m.call);
      if (m.err) w.reject(new Error(m.err));
      else w.resolve({ svg: m.svg, lottie: m.lottie });
      return;
    }
    if (m.kind === 'rendered') {
      if (m.err !== undefined && typeof m.err !== 'string') { invalid(); return; }
      if (responseTooLarge(m.bitmap) || responseTooLarge(m.err) || graphicsTooLarge(m.bitmap)) { timeout('sandbox response exceeds its data or graphics budget'); return; }
      const w = waits.get(m.call);
      if (!w) return;
      waits.delete(m.call);
      if (m.err) w.reject(new Error(m.err));
      else w.resolve({ bitmap: m.bitmap });
      return;
    }
    if (m.kind === 'evaluated') {
      if (m.err !== undefined && (typeof m.err !== 'string' || m.err.length > 4096)) { invalid(); return; }
      if (responseTooLarge(m.value) || responseTooLarge(m.err)) { timeout('sandbox response exceeds 8 MB'); return; }
      const w = waits.get(m.call);
      if (!w) return;
      waits.delete(m.call);
      if (m.err) w.reject(new Error(m.err));
      else w.resolve(m.value);
      return;
    }
    if (m.kind === 'evaluatedSeries') {
      if (m.err !== undefined && (typeof m.err !== 'string' || m.err.length > 4096)) { invalid(); return; }
      if (responseTooLarge(m.values) || responseTooLarge(m.err)) { timeout('sandbox response exceeds 8 MB'); return; }
      const w = waits.get(m.call);
      if (!w) return;
      waits.delete(m.call);
      if (m.err) w.reject(new Error(m.err));
      else if (!Array.isArray(m.values)) w.reject(new Error('invalid sandbox series'));
      else w.resolve(m.values);
      return;
    }
    if (m.kind === 'evaluatedLayers') {
      if (m.err !== undefined && (typeof m.err !== 'string' || m.err.length > 4096)) { invalid(); return; }
      if (responseTooLarge(m.values) || responseTooLarge(m.err)) { timeout('sandbox response exceeds 8 MB'); return; }
      const w = waits.get(m.call);
      if (!w) return;
      waits.delete(m.call);
      if (m.err) w.reject(new Error(m.err));
      else if (!Array.isArray(m.values)) w.reject(new Error('invalid sandbox layers'));
      else w.resolve(m.values);
      return;
    }
    if (m.kind === 'soundCues') {
      if (m.err !== undefined && (typeof m.err !== 'string' || m.err.length > 4096)) { invalid(); return; }
      if (responseTooLarge(m.values) || responseTooLarge(m.err)) { timeout('sandbox response exceeds 8 MB'); return; }
      const w = waits.get(m.call);
      if (!w) return;
      waits.delete(m.call);
      if (m.err) w.reject(new Error(m.err));
      else w.resolve(m.values);
      return;
    }
    if (m.kind === 'sampledClock') {
      if (m.err !== undefined && (typeof m.err !== 'string' || m.err.length > 4096)) { invalid(); return; }
      if (responseTooLarge(m.value) || responseTooLarge(m.err)) { timeout('sandbox response exceeds 8 MB'); return; }
      const w = waits.get(m.call);
      if (!w) return;
      waits.delete(m.call);
      if (m.err) w.reject(new Error(m.err));
      else w.resolve(m.value);
      return;
    }
    if (m.kind === 'pictureMotion') {
      if (m.err !== undefined && (typeof m.err !== 'string' || m.err.length > 4096)) { invalid(); return; }
      if (responseTooLarge(m.value) || responseTooLarge(m.err)) { timeout('sandbox response exceeds 8 MB'); return; }
      const w = waits.get(m.call);
      if (!w) return;
      waits.delete(m.call);
      if (m.err) w.reject(new Error(m.err));
      else w.resolve(m.value);
      return;
    }
    if (m.kind === 'motionReport') {
      if (m.err !== undefined && (typeof m.err !== 'string' || m.err.length > 4096)) { invalid(); return; }
      if (responseTooLarge(m.value) || responseTooLarge(m.err)) { timeout('sandbox response exceeds 8 MB'); return; }
      const w = waits.get(m.call);
      if (!w) return;
      waits.delete(m.call);
      if (m.err) w.reject(new Error(m.err));
      else w.resolve(m.value);
      return;
    }
    if (m.kind === 'sampledPlaced') {
      if (m.err !== undefined && (typeof m.err !== 'string' || m.err.length > 4096)) { invalid(); return; }
      if (responseTooLarge(m.values) || responseTooLarge(m.err)) { timeout('sandbox response exceeds 8 MB'); return; }
      const w = waits.get(m.call);
      if (!w) return;
      waits.delete(m.call);
      if (m.err) w.reject(new Error(m.err));
      else if (!Array.isArray(m.values)) w.reject(new Error('invalid sandbox placed sample'));
      else w.resolve(m.values);
      return;
    }
    if (m.kind === 'progress') {
      if (!Number.isFinite(m.done) || !Number.isFinite(m.total) || (m.step !== undefined && (typeof m.step !== 'string' || m.step.length > 4096))) { invalid(); return; }
      const ctx = bridges.get(m.call);
      if (ctx && 'progress' in ctx) (ctx as ToolContext).progress?.(m.done, m.total, m.step);
      return;
    }
    if (m.kind === 'ask') {
      const ctx = bridges.get(m.call);
      if (!ctx) { send({ kind: 'answer', id: m.id, err: 'the call is over' }); return; }
      if (!Number.isSafeInteger(m.id) || m.id <= lastAskId) { send({ kind: 'answer', id: m.id, err: 'invalid sandbox request id' }); return; }
      lastAskId = m.id;
      const count = pendingAsks.get(m.call) ?? 0;
      if (count >= 16) { send({ kind: 'answer', id: m.id, err: 'too many pending sandbox requests' }); return; }
      pendingAsks.set(m.call, count + 1);
      void Promise.resolve()
        .then(() => answer(ctx, m.q))
        .then((ok) => {
          if (!bridges.has(m.call) || closed) return;
          const limit = m.q.kind === 'fetch' ? 64 * 1024 * 1024 + 16 * 1024 : RESPONSE_LIMIT;
          if (responseTooLarge(ok, limit)) throw new Error(`sandbox answer exceeds ${m.q.kind === 'fetch' ? 64 : 8} MB`);
          send({ kind: 'answer', id: m.id, ok: ok === undefined ? null : ok });
        })
        .catch((e: Error) => { if (bridges.has(m.call) && !closed) send({ kind: 'answer', id: m.id, err: e.message }); })
        .finally(() => { const left = (pendingAsks.get(m.call) ?? 1) - 1; if (left) pendingAsks.set(m.call, left); else pendingAsks.delete(m.call); });
    }
    else invalid();
  };

  const run = (msg: ToWorker & { call: number }, ctx?: ToolContext | CheckContext, signal?: AbortSignal): Promise<unknown> => {
    if (responseTooLarge(msg, OUTBOUND_LIMIT)) return Promise.reject(new Error('sandbox message exceeds 64 MB'));
    if (graphicsTooLarge(msg)) return Promise.reject(new Error('sandbox graphics exceed 256 MB'));
    if (waits.size >= 64) return Promise.reject(new Error('too many pending sandbox calls'));
    const c = msg.call;
    if (ctx) bridges.set(c, ctx);
    const stop = () => send({ kind: 'abort', call: c });
    signal?.addEventListener('abort', stop, { once: true });
    return new Promise((resolve, reject) => {
      const seconds = msg.kind === 'tool' ? 120 : msg.kind === 'check' ? 30 : 30;
      const timer = setTimeout(() => timeout(`${msg.kind} call timed out after ${seconds} seconds`), seconds * 1000);
      waits.set(c, {
        resolve: (v) => { clearTimeout(timer); signal?.removeEventListener('abort', stop); resolve(v); },
        reject: (e) => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(e); },
      });
      try { send(msg); } catch (error) { waits.get(c)?.reject(error as Error); waits.delete(c); bridges.delete(c); }
    });
  };

  const host: PluginHost = {
    async ensure(plugins) {
      if (new Set([...loads.keys(), ...plugins.map((p) => p.id)]).size > 64) throw new Error('too many project plugins');
      const fresh: { id: string; url: string }[] = [];
      const pending = plugins.map((p) => {
        let load = loads.get(p.id);
        if (load?.url !== p.url) {
          const done = new Promise<PluginDecl>((resolve, reject) => {
            const timer = setTimeout(() => timeout(`plugin ${p.id} load timed out after 15 seconds`), 15_000);
            answers.set(answerKey(p.id, p.url), {
              resolve: (v) => { clearTimeout(timer); resolve(v); },
              reject: (e) => { clearTimeout(timer); reject(e); },
            });
          });
          // refused with the others of a call that stopped at the first refusal: not an unhandled one
          done.catch(() => {});
          loads.set(p.id, load = { url: p.url, done });
          fresh.push(p);
        }
        return load.done;
      });
      if (fresh.length) send({ kind: 'load', plugins: fresh });
      await Promise.all(pending);
      return new Map(decls);
    },
    async runTool(name, input, ctx) {
      const out = await run({ kind: 'tool', name, input, call: ++call, ctx: { doc: ctx.doc, compId: ctx.compId, time: ctx.time, selection: ctx.selection, docUrl: docUrl() } }, ctx, ctx.signal);
      return toolOutput(out);
    },
    async runCheck(name, ctx) {
      // the samples cross as plain data: each layer's node becomes its schema
      const samples = ctx.samples.map((s) => ({ ...s, layers: s.layers.map((p: PlacedLayer) => ({ ...p, node: schemaShipped(p.node) })) }));
      const out = await run({ kind: 'check', name, call: ++call, ctx: { doc: ctx.doc, compId: ctx.compId, comp: ctx.comp, step: ctx.step, samples } }, ctx);
      return Array.isArray(out) ? out as QualityIssue[] : [];
    },
    setDoc(doc) {
      if (responseTooLarge(doc, OUTBOUND_LIMIT)) throw new Error('sandbox message exceeds 64 MB');
      if (graphicsTooLarge(doc)) throw new Error('sandbox graphics exceed 256 MB');
      send({ kind: 'doc', doc });
    },
    async draw(payload) {
      canvasSize(payload.comp.width, payload.comp.height);
      return await run({ kind: 'draw', call: ++call, payload }) as DrawResult[];
    },
    async exportOf(type, props) {
      const r = await run({ kind: 'export', call: ++call, type, props });
      return (r ?? {}) as { svg?: string; lottie?: unknown; err?: string };
    },
    async renderFrame(payload) {
      try {
        canvasSize(payload.width, payload.height, payload.scale);
        const r = await run({ kind: 'render', call: ++call, payload });
        return (r ?? {}) as { bitmap?: unknown; err?: string };
      } finally {
        // the frames shipped were copied by the message: the page's bitmaps are done with
        for (const v of Object.values(payload.videos ?? {})) (v as { close?(): void }).close?.();
      }
    },
    async evaluateValue(address, t, compId) {
      if (address.length > 4096 || compId.length > 4096 || !Number.isFinite(t)) throw new Error('invalid sandbox evaluation request');
      return run({ kind: 'evaluate', call: ++call, address, t, compId });
    },
    async evaluateSeries(addresses, times, compId) {
      if (!Array.isArray(addresses) || !addresses.length || addresses.length > 16 || addresses.some((a) => typeof a !== 'string' || a.length > 256) ||
          !Array.isArray(times) || !times.length || times.length > 512 || times.some((t) => !Number.isFinite(t)) || addresses.length * times.length > 4096 ||
          typeof compId !== 'string' || compId.length > 256) throw new Error('invalid sandbox series');
      const values = await run({ kind: 'evaluateSeries', call: ++call, addresses, times, compId }) as unknown[][];
      if (!Array.isArray(values) || values.length !== addresses.length || values.some((row) => !Array.isArray(row) || row.length !== times.length)) throw new Error('invalid sandbox series response');
      return values;
    },
    async evaluateLayers(ids, t, compId) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 64 || ids.some((id) => typeof id !== 'string' || id.length > 256) ||
          !Number.isFinite(t) || typeof compId !== 'string' || compId.length > 256) throw new Error('invalid sandbox layers');
      const values = await run({ kind: 'evaluateLayers', call: ++call, ids, t, compId }) as LayerSample[];
      if (!Array.isArray(values) || values.length !== ids.length || values.some((value, i) => !value || value.id !== ids[i] ||
          !('err' in value) && (!value.transform || !value.props || !Array.isArray(value.masks)))) throw new Error('invalid sandbox layers response');
      return values;
    },
    async soundCues(compId) {
      if (typeof compId !== 'string' || compId.length > 256) throw new Error('invalid sandbox sound cues');
      const values = await run({ kind: 'soundCues', call: ++call, compId }) as SoundCue[];
      if (!Array.isArray(values) || values.length > 4096 || values.some((v) => !v || !Number.isFinite(v.t) || typeof v.layer !== 'string' || v.layer.length > 256 ||
          !Number.isFinite(v.strength) || !['cut', 'move', 'land', 'appear'].includes(v.kind) || !['hero', 'support'].includes(v.weight))) throw new Error('invalid sandbox sound cues response');
      return values;
    },
    async sampleClock(layerId, compId, compTimes, fileTimes) {
      if (typeof layerId !== 'string' || layerId.length > 256 || typeof compId !== 'string' || compId.length > 256 ||
          !Array.isArray(compTimes) || !Array.isArray(fileTimes) || compTimes.length + fileTimes.length > 512 ||
          compTimes.some((t) => !Number.isFinite(t)) || fileTimes.some((t) => !Number.isFinite(t))) throw new Error('invalid sandbox clock request');
      const value = await run({ kind: 'sampleClock', call: ++call, layerId, compId, compTimes, fileTimes }) as ClockSample;
      const clock = value?.clock;
      if (!value || !clock || typeof clock !== 'object' ||
          !Array.isArray(value.fileTimes) || value.fileTimes.length !== compTimes.length || value.fileTimes.some((t) => !Number.isFinite(t)) ||
          !Array.isArray(value.moments) || value.moments.length !== fileTimes.length || value.moments.some((row) => !Array.isArray(row) || row.some((t) => !Number.isFinite(t))) ||
          value.moments.reduce((sum, row) => sum + row.length, 0) > 4096 ||
          ['start', 'rate', 'loopEnd', 'rateElapsed'].some((key) => key in clock && !Number.isFinite(clock[key as keyof typeof clock])) ||
          ('loop' in clock && typeof clock.loop !== 'boolean')) throw new Error('invalid sandbox clock response');
      return value;
    },
    async pictureMotion(compId) {
      if (typeof compId !== 'string' || compId.length > 256) throw new Error('invalid sandbox picture motion request');
      const value = await run({ kind: 'pictureMotion', call: ++call, compId }) as MotionSample;
      if (!value || !Array.isArray(value.times) || !Array.isArray(value.motion) || value.times.length > 16384 ||
          value.times.length !== value.motion.length || value.times.some((t) => !Number.isFinite(t)) ||
          value.motion.some((v) => !Number.isFinite(v))) throw new Error('invalid sandbox picture motion response');
      return value;
    },
    async motionReport(compId, from, to) {
      if (typeof compId !== 'string' || compId.length > 256 || !Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 5) throw new Error('invalid sandbox motion report request');
      const value = await run({ kind: 'motionReport', call: ++call, compId, from, to }) as MotionReport;
      if (!value || !Array.isArray(value.figures) || value.figures.length > 6 || value.figures.some((entry) => {
        const f = entry?.figures;
        return !entry || typeof entry.address !== 'string' || entry.address.length > 256 || !f ||
          ![f.span, f.change, f.travel, f.peak, f.peakAt, f.evenness, f.turns, f.overshoot].every(Number.isFinite) ||
          (f.settle !== undefined && !Number.isFinite(f.settle));
      })) throw new Error('invalid sandbox motion report response');
      return value;
    },
    async samplePlaced(t, compId) {
      if (!Number.isFinite(t) || typeof compId !== 'string' || compId.length > 256) throw new Error('invalid sandbox placed sample');
      const values = await run({ kind: 'samplePlaced', call: ++call, t, compId }) as PlacedSample[];
      if (!Array.isArray(values) || values.length > 4096 || values.some((v) => !v || typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.type !== 'string' ||
          !Number.isFinite(v.opacity) || (v.box !== null && (!v.box || ![v.box.x, v.box.y, v.box.w, v.box.h].every(Number.isFinite))))) throw new Error('invalid sandbox placed sample response');
      return values;
    },
    dispose(reason) {
      closed = true;
      const e = new Error(reason ? `the plugin sandbox stopped: ${reason}` : 'the plugin sandbox is closed');
      for (const w of [...waits.values(), ...answers.values()]) w.reject(e);
      waits.clear();
      answers.clear();
      loads.clear();
      pendingAsks.clear();
    },
    closed: () => closed,
  };

  return { host, receive };
}

function bitmapsIn(value: unknown): Transferable[] {
  const out: Transferable[] = [], seen = new Set<object>(), stack = [value];
  while (stack.length && seen.size < 10000) {
    const item = stack.pop();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (typeof ImageBitmap !== 'undefined' && item instanceof ImageBitmap) { out.push(item); continue; }
    if (Array.isArray(item)) for (const entry of item) stack.push(entry);
    else for (const entry of Object.values(item)) stack.push(entry);
  }
  return out;
}

/** The editor's sandbox: an opaque iframe owns the worker, never the page. */
export function browserHost(docUrl: string): PluginHost {
  const frame = document.createElement('iframe');
  frame.sandbox.add('allow-scripts');
  frame.hidden = true;
  frame.src = '/project-sandbox.html';
  let started = false;
  const queue: ToWorker[] = [];
  const urls = new Map<string, string>();
  const fontBytes = new Map<string, Promise<ArrayBuffer>>();
  const projectRoot = docUrl ? new URL('./', new URL(docUrl, location.href)).pathname : '';
  const approved = (url: URL) => {
    const projectFile = projectRoot && url.protocol === location.protocol && url.pathname.startsWith(projectRoot);
    const ownedBlob = url.protocol === 'blob:' && url.origin === location.origin;
    return url.origin === location.origin && !!(projectFile || ownedBlob);
  };
  const post = (m: ToWorker) => {
    if (responseTooLarge(m, OUTBOUND_LIMIT)) throw new Error('sandbox message exceeds 64 MB');
    if (graphicsTooLarge(m)) throw new Error('sandbox graphics exceed 256 MB');
    // Document images remain in the trusted page's AssetStore as well as the worker.
    // Structured-clone them; transferring ownership would detach the page's copy.
    frame.contentWindow?.postMessage({ kind: 'send', data: m }, '*', m.kind === 'doc' ? [] : bitmapsIn(m));
  };
  const { host, receive } = connectHost((m) => send(m), () => docUrl, (reason) => dispose(reason));
  const startupTimer = setTimeout(() => dispose('the isolated project worker did not start'), 10_000);
  const dispose = (reason?: string) => {
    if (host.closed()) return;
    clearTimeout(startupTimer);
    host.dispose(reason);
    window.removeEventListener('message', onMessage);
    frame.contentWindow?.postMessage({ kind: 'stop' }, '*');
    frame.remove();
  };
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== 'null') return;
    if (event.data?.kind === 'failed') { dispose(event.data.reason); return; }
    if (event.data?.kind === 'started') {
      clearTimeout(startupTimer);
      started = true;
      for (const m of queue.splice(0)) send(m);
    }
    if (event.data?.kind === 'worker') {
      const message = event.data.data as FromWorker;
      if (message?.kind === 'loaded') message.urls = message.urls.map((url) => urls.get(url) ?? url);
      if (message?.kind === 'loadFailed') message.url = urls.get(message.url) ?? message.url;
      receive(message);
    }
  };
  const deliver = async (m: ToWorker) => {
    if (host.closed()) return;
    if (m.kind === 'load') {
      await Promise.all(m.plugins.map(async (plugin) => {
        try {
          const url = new URL(plugin.url, location.href);
          const shippedPack = plugin.id.startsWith('packs:') && url.origin === location.origin && /^\/plugins\/[a-zA-Z0-9._/-]+\.m?js$/.test(url.pathname);
          if (!approved(url) && !shippedPack) throw new Error('plugin module must belong to this project');
          const response = await fetch(url.href, { credentials: 'same-origin' });
          if (!response.ok) throw new Error(`plugin module: HTTP ${response.status}`);
          const source = new TextDecoder().decode(await readLimitedBody(response, 1024 * 1024, 'plugin module'));
          const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
          urls.set(dataUrl, plugin.url);
          if (!host.closed()) post({ kind: 'load', plugins: [{ id: plugin.id, url: dataUrl }] });
        } catch (error) { if (!host.closed()) receive({ kind: 'loadFailed', id: plugin.id, url: plugin.url, message: (error as Error).message }); }
      }));
      return;
    }
    if (m.kind === 'doc') {
      const fonts = await Promise.all(m.doc.fonts.map(async (font) => {
        const url = new URL(font.url, location.href);
        if (!approved(url)) throw new Error(`font must belong to this project: ${font.url}`);
        let bytes = fontBytes.get(url.href);
        if (!bytes) {
          bytes = fetch(url.href, { credentials: 'same-origin' }).then(async (response) => {
            if (!response.ok) throw new Error(`font: HTTP ${response.status}`);
            return (await readLimitedBody(response, 16 * 1024 * 1024, 'font')).buffer as ArrayBuffer;
          });
          fontBytes.set(url.href, bytes);
        }
        return { ...font, data: await bytes };
      }));
      if (!host.closed()) post({ ...m, doc: { ...m.doc, fonts } });
      return;
    }
    post(m);
  };
  let transport = Promise.resolve();
  const send = (m: ToWorker) => {
    if (host.closed()) return;
    if (!started) {
      if (m.kind === 'doc' && queue.at(-1)?.kind === 'doc') queue[queue.length - 1] = m;
      else if (queue.length >= 128) dispose('too many queued sandbox messages');
      else queue.push(m);
      return;
    }
    transport = transport.then(() => deliver(m)).catch((error: Error) => dispose(error.message));
  };
  window.addEventListener('message', onMessage);
  frame.addEventListener('load', () => {
    void fetch('/plugin-worker.js', { credentials: 'same-origin' }).then(async (response) => {
      if (!response.ok) throw new Error(`worker bundle: HTTP ${response.status}`);
      frame.contentWindow?.postMessage({ kind: 'start', code: await response.text() }, '*');
    }).catch((error: Error) => dispose(error.message));
  }, { once: true });
  document.body.append(frame);
  return { ...host, dispose };
}
