// The sandbox's logic, written without the Worker API so it runs in a browser
// worker (plugins/worker.ts wires it to postMessage) and in tests alike. It
// imports the project's plugin modules, tells the page what they declare, and
// runs their tools and checks against a context whose every reach into the
// project is a message answered by the page. Nothing here touches the DOM.

import { Registry, type CheckContext, type CheckType, type EffectType, type ModifierType, type MotionReport, type NodeType, type PluginModule, type Quad, type QualityIssue, type SoundCue, type ToolContext, type ToolOutput } from '@tramme/core';
import type { Ask, CheckCtxData, ClockSample, DrawPayload, DrawResult, FramePayload, FromWorker, LayerSample, MotionSample, PlacedSample, PluginDecl, SandboxDoc, SchemaEffect, SchemaModifier, SchemaNode, ToWorker, ToolCtxData } from './protocol.ts';

/** the sandbox id of an installed plugin (installed:<file>): the project's own plugins have the document's asset ids */
export const INSTALLED = 'installed:';

export interface WorkerSide {
  /** a message from the page */
  receive(m: ToWorker): void;
}

/** the sandboxed drawing of stage 2, injected so the protocol runs (and tests) without a canvas */
export interface SandboxDrawSide {
  /** the document's side: assets, fonts */
  setDoc(d: SandboxDoc): void | Promise<void>;
  /** draw a frame's sandboxed layers; the pictures may be transferred back */
  draw(p: DrawPayload): Promise<{ results: DrawResult[]; transfer?: Transferable[] }>;
  /** a node's vector export, computed from its declarations' code */
  exportOf(type: string, props: unknown): Promise<{ svg?: string; lottie?: unknown; err?: string }>;
  /** a whole composition evaluated and drawn here (the evaluator's move); the picture may be transferred */
  renderFrame(p: FramePayload): Promise<{ bitmap?: unknown; transfer?: Transferable[]; err?: string }>;
  /** evaluate one property without running its expression on the page */
  evaluateValue(address: string, t: number, compId: string): Promise<unknown>;
  evaluateSeries(addresses: string[], times: number[], compId: string): Promise<unknown[][]>;
  evaluateLayers(ids: string[], t: number, compId: string): Promise<LayerSample[]>;
  soundCues(compId: string): Promise<SoundCue[]>;
  sampleClock(layerId: string, compId: string, compTimes: number[], fileTimes: number[]): Promise<ClockSample>;
  pictureMotion(compId: string): Promise<MotionSample>;
  motionReport(compId: string, from: number, to: number): Promise<MotionReport>;
  sampleQuads(layerId: string, compId: string, times: number[]): Promise<Quad[]>;
  qualityChecks(compId: string): Promise<QualityIssue[]>;
  samplePlaced(t: number, compId: string): Promise<PlacedSample[]>;
}

export interface WorkerSideOptions {
  /** speak to the page */
  post(m: FromWorker, transfer?: Transferable[]): void;
  /** import a plugin module (the worker's own import, version-busted by the caller) */
  importModule(url: string): Promise<PluginModule>;
  /** the drawing of sandboxed nodes (the browser worker passes the real raster; tests pass a fake), built with the loaded modules */
  sandbox?: (modules: Map<string, PluginModule>) => SandboxDrawSide;
}

const schemaNode = (n: NodeType): SchemaNode => ({ type: n.type, title: n.title, category: n.category, description: n.description, ai: n.ai, props: n.props, ...(n.container ? { container: true } : {}), ...(n.path ? { hasPath: true } : {}), ...(n.handles ? { hasHandles: true } : {}), ...(n.export ? { hasExport: true } : {}) });
const schemaEffect = (e: EffectType): SchemaEffect => ({ type: e.type, title: e.title, category: e.category, description: e.description, ai: e.ai, props: e.props, stage: e.stage });
const schemaModifier = (m: ModifierType): SchemaModifier => ({ type: m.type, title: m.title, description: m.description, ai: m.ai, params: m.params });

/**
 * The vocabulary as a sandboxed tool may read it: schemas and notes, never
 * code. A node's render is an empty object (the registry asks for one), a
 * modifier's apply refuses: their code does not cross the boundary.
 */
function schemaRegistryOf(mods: PluginModule[]): Registry {
  const reg = new Registry();
  for (const mod of mods) {
    reg.use({
      nodes: (mod.nodes ?? []).map((n) => ({ ...schemaNode(n), render: {} }) as unknown as NodeType),
      effects: (mod.effects ?? []).map((e) => ({ ...schemaEffect(e) }) as unknown as EffectType),
      modifiers: (mod.modifiers ?? []).map((m) => ({ ...schemaModifier(m), apply: () => { throw new Error("a modifier's code does not cross the sandbox"); } }) as unknown as ModifierType),
    }, 'sandbox');
  }
  return reg;
}

export function startWorkerSide({ post, importModule, sandbox: makeSandbox }: WorkerSideOptions): WorkerSide {
  const modules = new Map<string, PluginModule>();
  const sandbox = makeSandbox ? makeSandbox(modules) : undefined;
  /** one abort controller per running tool or check */
  const controllers = new Map<number, AbortController>();
  /** the asks this side is waiting on: id -> settle */
  const asks = new Map<number, { call: number; resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let askId = 0;

  const ask = (call: number, q: Ask): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++askId;
      asks.set(id, { call, resolve, reject });
      post({ kind: 'ask', id, call, q });
    });

  const declare = (id: string, mod: PluginModule): PluginDecl => ({
    id,
    meta: mod.meta,
    tools: (mod.tools ?? []).map(({ run, ...decl }) => decl),
    checks: (mod.checks ?? []).map(({ run, ...decl }) => decl),
    nodes: (mod.nodes ?? []).map(schemaNode),
    effects: (mod.effects ?? []).map(schemaEffect),
    modifiers: (mod.modifiers ?? []).map(schemaModifier),
    tours: (mod.tours ?? []) as unknown[],
    messages: (mod.messages ?? null) as unknown,
    // plain data by contract; copied so a function slipped in fails here, not in postMessage
    prompts: JSON.parse(JSON.stringify(mod.prompts ?? [])),
    kits: JSON.parse(JSON.stringify(mod.kits ?? [])),
    presets: JSON.parse(JSON.stringify(mod.presets ?? [])),
  });

  /** a tool or a check by its name, of the kind asked: a plugin may give a tool and a check the same name (styk-figure) */
  const find = (name: string, kind: 'tool' | 'check'): { run: (input: any, ctx: any) => unknown; id: string } | null => {
    // the project's own plugins first: an installed plugin's tool of the same name is not the one the page registered
    for (const [id, mod] of [...modules].sort(([a], [b]) => Number(a.startsWith(INSTALLED)) - Number(b.startsWith(INSTALLED)))) {
      const entry = (kind === 'tool' ? mod.tools : mod.checks)?.find((x) => x.name === name);
      if (entry) return { run: entry.run, id };
    }
    return null;
  };

  const toolContext = (call: number, data: ToolCtxData, registry: Registry, signal: AbortSignal, metaId: string | null): ToolContext => {
    const doc = data.doc as ToolContext['doc'];
    const base = data.docUrl;
    return {
      doc, compId: data.compId, time: data.time, selection: data.selection, registry,
      assetUrl: (id) => { const src = doc.assets[id]?.src; if (!src) throw new Error(`unknown asset: ${id}`); return new URL(src, base).href; },
      fileUrl: (path) => new URL(path, base).href,
      readText: (path) => ask(call, { kind: 'readText', path }),
      // a shipped pack's data files, from the editor's own origin (the page fetches them)
      ...(metaId && metaId.startsWith('tramme/') ? { packFile: (path: string) => ask(call, { kind: 'packFile', path }) } : {}),
      files: () => ask(call, { kind: 'files' }),
      writeFile: async (path, d) => ask(call, { kind: 'writeFile', path, data: typeof d === 'string' ? { text: d } : { bytes: await d.arrayBuffer() } }),
      renderStill: (t, compId) => ask(call, { kind: 'renderStill', t, compId }),
      transcript: (assetId, opts) => ask(call, { kind: 'transcript', assetId, ask: opts?.ask ?? true }),
      signal,
      progress: (done, total, step) => post({ kind: 'progress', call, done, total, step }),
      // what the plugin declared it reaches, asked to the page, which checks it again
      fetch: async (url, init) => {
        const r = await ask(call, { kind: 'fetch', url: new URL(url, base).href, method: init?.method, headers: init?.headers, body: init?.body }) as { status: number; headers: Record<string, string>; body: ArrayBuffer };
        return new Response(r.status === 204 || r.status === 304 ? null : r.body, { status: r.status, headers: r.headers });
      },
    };
  };

  const checkContext = (call: number, data: CheckCtxData, registry: Registry): CheckContext => ({
    doc: data.doc as CheckContext['doc'],
    compId: data.compId,
    comp: data.comp as CheckContext['comp'],
    registry,
    evaluator: undefined as never,
    samples: data.samples as CheckContext['samples'],
    step: data.step,
    data: (assetId) => ask(call, { kind: 'data', assetId }),
  });

  return {
    receive(m) {
      if (m.kind === 'load') {
        void (async () => {
          const loaded: PluginDecl[] = [], urls: string[] = [];
          for (const { id, url } of m.plugins) {
            try {
              modules.set(id, await importModule(url));
              loaded.push(declare(id, modules.get(id)!));
              urls.push(url);
            } catch (e) { post({ kind: 'loadFailed', id, url, message: (e as Error).message }); }
          }
          if (loaded.length) post({ kind: 'loaded', plugins: loaded, urls });
        })();
        return;
      }
      if (m.kind === 'doc') {
        void sandbox?.setDoc(m.doc);
        return;
      }
      if (m.kind === 'draw') {
        if (!sandbox) { post({ kind: 'drawn', call: m.call, frame: m.payload.frame, results: m.payload.items.map((i) => ({ id: i.id, ok: false, err: 'the sandbox cannot draw here' })) }); return; }
        void (async () => {
          let results: DrawResult[] = [], transfer: Transferable[] | undefined;
          try { ({ results, transfer } = await sandbox.draw(m.payload)); }
          catch (e) { results = m.payload.items.map((i) => ({ id: i.id, ok: false, err: (e as Error).message })); }
          post({ kind: 'drawn', call: m.call, frame: m.payload.frame, results }, transfer);
        })();
        return;
      }
      if (m.kind === 'render') {
        if (!sandbox) { post({ kind: 'rendered', call: m.call, err: 'the sandbox cannot render here' }); return; }
        void (async () => {
          const r: { bitmap?: unknown; transfer?: Transferable[]; err?: string } = await sandbox.renderFrame(m.payload).catch((e: Error) => ({ err: e.message }));
          post({ kind: 'rendered', call: m.call, ...r }, r.transfer);
        })();
        return;
      }
      if (m.kind === 'evaluate') {
        if (!sandbox) { post({ kind: 'evaluated', call: m.call, err: 'the sandbox cannot evaluate here' }); return; }
        void sandbox.evaluateValue(m.address, m.t, m.compId)
          .then((value) => post({ kind: 'evaluated', call: m.call, value }))
          .catch((e: Error) => post({ kind: 'evaluated', call: m.call, err: e.message }));
        return;
      }
      if (m.kind === 'evaluateSeries') {
        if (!sandbox) { post({ kind: 'evaluatedSeries', call: m.call, err: 'the sandbox cannot evaluate here' }); return; }
        if (!Array.isArray(m.addresses) || !m.addresses.length || m.addresses.length > 16 || m.addresses.some((a) => typeof a !== 'string' || a.length > 256) ||
            !Array.isArray(m.times) || !m.times.length || m.times.length > 512 || m.times.some((t) => !Number.isFinite(t)) || m.addresses.length * m.times.length > 4096 ||
            typeof m.compId !== 'string' || m.compId.length > 256) { post({ kind: 'evaluatedSeries', call: m.call, err: 'invalid sandbox series' }); return; }
        void sandbox.evaluateSeries(m.addresses, m.times, m.compId)
          .then((values) => post({ kind: 'evaluatedSeries', call: m.call, values }))
          .catch((e: Error) => post({ kind: 'evaluatedSeries', call: m.call, err: e.message }));
        return;
      }
      if (m.kind === 'evaluateLayers') {
        if (!sandbox) { post({ kind: 'evaluatedLayers', call: m.call, err: 'the sandbox cannot evaluate here' }); return; }
        if (!Array.isArray(m.ids) || !m.ids.length || m.ids.length > 64 || m.ids.some((id) => typeof id !== 'string' || id.length > 256) ||
            !Number.isFinite(m.t) || typeof m.compId !== 'string' || m.compId.length > 256) { post({ kind: 'evaluatedLayers', call: m.call, err: 'invalid sandbox layers' }); return; }
        void sandbox.evaluateLayers(m.ids, m.t, m.compId)
          .then((values) => post({ kind: 'evaluatedLayers', call: m.call, values }))
          .catch((e: Error) => post({ kind: 'evaluatedLayers', call: m.call, err: e.message }));
        return;
      }
      if (m.kind === 'soundCues') {
        if (!sandbox) { post({ kind: 'soundCues', call: m.call, err: 'the sandbox cannot read sound cues here' }); return; }
        if (typeof m.compId !== 'string' || m.compId.length > 256) { post({ kind: 'soundCues', call: m.call, err: 'invalid sandbox sound cues' }); return; }
        void sandbox.soundCues(m.compId)
          .then((values) => post({ kind: 'soundCues', call: m.call, values }))
          .catch((e: Error) => post({ kind: 'soundCues', call: m.call, err: e.message }));
        return;
      }
      if (m.kind === 'sampleClock') {
        if (!sandbox) { post({ kind: 'sampledClock', call: m.call, err: 'the sandbox cannot sample a clock here' }); return; }
        if (typeof m.layerId !== 'string' || m.layerId.length > 256 || typeof m.compId !== 'string' || m.compId.length > 256 ||
            !Array.isArray(m.compTimes) || !Array.isArray(m.fileTimes) || m.compTimes.length + m.fileTimes.length > 512 ||
            m.compTimes.some((t) => !Number.isFinite(t)) || m.fileTimes.some((t) => !Number.isFinite(t))) {
          post({ kind: 'sampledClock', call: m.call, err: 'invalid sandbox clock request' }); return;
        }
        void sandbox.sampleClock(m.layerId, m.compId, m.compTimes, m.fileTimes)
          .then((value) => post({ kind: 'sampledClock', call: m.call, value }))
          .catch((e: Error) => post({ kind: 'sampledClock', call: m.call, err: e.message }));
        return;
      }
      if (m.kind === 'pictureMotion') {
        if (!sandbox) { post({ kind: 'pictureMotion', call: m.call, err: 'the sandbox cannot read picture motion here' }); return; }
        if (typeof m.compId !== 'string' || m.compId.length > 256) { post({ kind: 'pictureMotion', call: m.call, err: 'invalid sandbox picture motion request' }); return; }
        void sandbox.pictureMotion(m.compId)
          .then((value) => post({ kind: 'pictureMotion', call: m.call, value }))
          .catch((e: Error) => post({ kind: 'pictureMotion', call: m.call, err: e.message }));
        return;
      }
      if (m.kind === 'motionReport') {
        if (!sandbox) { post({ kind: 'motionReport', call: m.call, err: 'the sandbox cannot read motion figures here' }); return; }
        if (typeof m.compId !== 'string' || m.compId.length > 256 || !Number.isFinite(m.from) || !Number.isFinite(m.to) || m.to < m.from || m.to - m.from > 5) {
          post({ kind: 'motionReport', call: m.call, err: 'invalid sandbox motion report request' }); return;
        }
        void sandbox.motionReport(m.compId, m.from, m.to)
          .then((value) => post({ kind: 'motionReport', call: m.call, value }))
          .catch((e: Error) => post({ kind: 'motionReport', call: m.call, err: e.message }));
        return;
      }
      if (m.kind === 'sampleQuads') {
        if (!sandbox) { post({ kind: 'sampledQuads', call: m.call, err: 'the sandbox cannot sample quads here' }); return; }
        if (typeof m.layerId !== 'string' || m.layerId.length > 256 || typeof m.compId !== 'string' || m.compId.length > 256 ||
            !Array.isArray(m.times) || !m.times.length || m.times.length > 512 || m.times.some((t) => !Number.isFinite(t))) {
          post({ kind: 'sampledQuads', call: m.call, err: 'invalid sandbox quad request' }); return;
        }
        void sandbox.sampleQuads(m.layerId, m.compId, m.times)
          .then((value) => post({ kind: 'sampledQuads', call: m.call, value }))
          .catch((e: Error) => post({ kind: 'sampledQuads', call: m.call, err: e.message }));
        return;
      }
      if (m.kind === 'qualityChecks') {
        if (!sandbox) { post({ kind: 'qualityChecked', call: m.call, err: 'the sandbox cannot check quality here' }); return; }
        if (typeof m.compId !== 'string' || m.compId.length > 256) { post({ kind: 'qualityChecked', call: m.call, err: 'invalid sandbox quality request' }); return; }
        void sandbox.qualityChecks(m.compId)
          .then((values) => post({ kind: 'qualityChecked', call: m.call, values }))
          .catch((e: Error) => post({ kind: 'qualityChecked', call: m.call, err: e.message }));
        return;
      }
      if (m.kind === 'samplePlaced') {
        if (!sandbox) { post({ kind: 'sampledPlaced', call: m.call, err: 'the sandbox cannot sample here' }); return; }
        if (!Number.isFinite(m.t) || typeof m.compId !== 'string' || m.compId.length > 256) { post({ kind: 'sampledPlaced', call: m.call, err: 'invalid sandbox placed sample' }); return; }
        void sandbox.samplePlaced(m.t, m.compId)
          .then((values) => post({ kind: 'sampledPlaced', call: m.call, values }))
          .catch((e: Error) => post({ kind: 'sampledPlaced', call: m.call, err: e.message }));
        return;
      }
      if (m.kind === 'export') {
        if (!sandbox) { post({ kind: 'exported', call: m.call, err: 'the sandbox cannot export here' }); return; }
        void (async () => {
          const r = await sandbox.exportOf(m.type, m.props).catch((e: Error) => ({ err: e.message }));
          post({ kind: 'exported', call: m.call, ...r });
        })();
        return;
      }
      if (m.kind === 'abort') {
        controllers.get(m.call)?.abort();
        for (const [id, a] of asks) if (a.call === m.call) { asks.delete(id); a.reject(new Error('aborted')); }
        return;
      }
      if (m.kind === 'answer') {
        const a = asks.get(m.id);
        if (!a) return;
        asks.delete(m.id);
        if (m.err) a.reject(new Error(m.err));
        else a.resolve(m.ok);
        return;
      }
      if (m.kind === 'tool' || m.kind === 'check') {
        const found = find(m.name, m.kind);
        if (!found) { post({ kind: 'result', call: m.call, err: `unknown ${m.kind}: ${m.name}` }); return; }
        const controller = new AbortController();
        controllers.set(m.call, controller);
        const registry = schemaRegistryOf([...modules.values()]);
        const ctx: ToolContext | CheckContext = m.kind === 'tool'
          ? toolContext(m.call, m.ctx, registry, controller.signal, modules.get(found.id)?.meta?.id ?? null)
          : checkContext(m.call, m.ctx, registry);
        const input = m.kind === 'tool' ? m.input : ctx;
        void (async () => {
          try {
            const out = await found.run(input, ctx);
            post({ kind: 'result', call: m.call, ok: out === undefined ? null : out });
          } catch (e) {
            post({ kind: 'result', call: m.call, err: controller.signal.aborted ? 'aborted' : (e as Error).message });
          } finally { controllers.delete(m.call); }
        })();
      }
    },
  };
}

/**
 * The sandbox's reduced reach, applied to its own realm before any plugin
 * loads: fetch only the project's origin (the editor's storage and API), no
 * sockets. What stays open — dynamic import of remote modules — is a limit
 * said plainly in the design note, for a CSP to close.
 */
export function guardRealm(realm: { fetch?: typeof fetch; WebSocket?: unknown; location?: { href?: string } }, origin: string) {
  const real = realm.fetch?.bind(realm);
  if (real) {
    realm.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const target = new URL(url, realm.location?.href ?? origin);
      if (target.origin !== origin) return Promise.reject(new Error(`the plugin sandbox reaches its own origin only, not ${target.origin}`));
      return real(input, init);
    }) as typeof fetch;
  }
  realm.WebSocket = undefined;
}

/** a tool's or check's result as plain data (what crosses back) */
export type SandboxResult = ToolOutput | string | void | QualityIssue[];
