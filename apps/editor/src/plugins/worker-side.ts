// The sandbox's logic, written without the Worker API so it runs in a browser
// worker (plugins/worker.ts wires it to postMessage) and in tests alike. It
// imports the project's plugin modules, tells the page what they declare, and
// runs their tools and checks against a context whose every reach into the
// project is a message answered by the page. Nothing here touches the DOM.

import { Registry, type CheckContext, type CheckType, type EffectType, type ModifierType, type NodeType, type PluginModule, type QualityIssue, type ToolContext, type ToolOutput } from '@tramme/core';
import type { Ask, CheckCtxData, DrawPayload, DrawResult, FramePayload, FromWorker, PluginDecl, SandboxDoc, SchemaEffect, SchemaModifier, SchemaNode, ToWorker, ToolCtxData } from './protocol.ts';

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
const schemaModifier = (m: ModifierType): SchemaModifier => ({ type: m.type, title: m.title, ...(m.params ? { params: m.params } : {}) });

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

  const find = (name: string): { kind: 'tool' | 'check'; run: (input: any, ctx: any) => unknown; id: string } | null => {
    // the project's own plugins first: an installed plugin's tool of the same name is not the one the page registered
    for (const [id, mod] of [...modules].sort(([a], [b]) => Number(a.startsWith(INSTALLED)) - Number(b.startsWith(INSTALLED)))) {
      const tool = mod.tools?.find((t) => t.name === name);
      if (tool) return { kind: 'tool', run: tool.run, id };
      const check = mod.checks?.find((c) => c.name === name);
      if (check) return { kind: 'check', run: check.run, id };
    }
    return null;
  };

  const toolContext = (call: number, data: ToolCtxData, registry: Registry, signal: AbortSignal): ToolContext => {
    const doc = data.doc as ToolContext['doc'];
    const base = data.docUrl;
    return {
      doc, compId: data.compId, time: data.time, selection: data.selection, registry,
      assetUrl: (id) => { const src = doc.assets[id]?.src; if (!src) throw new Error(`unknown asset: ${id}`); return new URL(src, base).href; },
      fileUrl: (path) => new URL(path, base).href,
      readText: (path) => ask(call, { kind: 'readText', path }),
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
        const found = find(m.name);
        if (!found) { post({ kind: 'result', call: m.call, err: `unknown ${m.kind}: ${m.name}` }); return; }
        if (found.kind !== m.kind) { post({ kind: 'result', call: m.call, err: `${m.name} is a ${found.kind}, called as a ${m.kind}` }); return; }
        const controller = new AbortController();
        controllers.set(m.call, controller);
        const registry = schemaRegistryOf([...modules.values()]);
        const ctx: ToolContext | CheckContext = m.kind === 'tool'
          ? toolContext(m.call, m.ctx, registry, controller.signal)
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
