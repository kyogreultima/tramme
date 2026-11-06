// The plugin sandbox's protocol, end to end without a browser: the host and
// the worker side wired directly, as the worker's postMessage would. What
// must hold: the page learns what a plugin declares without its code, a tool
// runs with its reaches bridged (files, writes, stills, progress, abort), a
// check receives plain data only, and the sandbox's realm lets no network
// beyond its own origin.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newProject, type Manifest } from '@tramme/project';
import { Registry, toolOutput, type Host, type PluginModule, type ToolContext, type CheckContext, type TrammeDoc } from '@tramme/core';
import { connectHost, readLimitedBody, type PluginHost } from '../src/plugins/host.ts';
import { guardRealm, startWorkerSide, type SandboxDrawSide } from '../src/plugins/worker-side.ts';
import { bindSandbox, declarationsModule, noteSandboxDeclaration, resetSandbox, primeSandboxExports, sandboxDeclaration, sandboxNode } from '../src/plugins/sandbox-draw.ts';
import { RecordingPath2D } from '../src/plugins/recording-path.ts';
import { makeSandboxDraw } from '../src/plugins/worker-draw.ts';
import type { DrawPayload, DrawResult, SandboxDoc } from '../src/plugins/protocol.ts';
import { attachIsolated, filterModule } from '../src/plugins/vocabulary.ts';

const DOC_URL = 'https://tramme.test/p1/document.tramme.json';

/** a plugin module, as the sandbox imports it */
const plugin = (): PluginModule => ({
  meta: { name: 'stars', api: 1 },
  nodes: [{
    type: 'sky.moon', title: 'Moon', category: 'Shapes', props: { radius: { type: 'number', default: 10 } },
    render: { canvas2d: () => {} }, bounds: () => null, simulate: { init: () => 0, step: (s) => s },
    path: () => null, handles: () => [{ prop: 'radius', at: [0, 0] }], export: { svg: (p: unknown) => `<circle r="${(p as { radius: number }).radius}"/>` },
  }],
  tools: [{
    name: 'sky.stars', title: 'Star field', description: 'scatters stars',
    input: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] },
    async run(input: { count: number }, ctx: ToolContext) {
      const text = await ctx.readText('assets/sky.txt');
      await ctx.writeFile('assets/stars.json', `{"count":${input.count},"read":${text === null ? 'null' : `"${text}"`}}`);
      ctx.progress?.(1, 2, 'placing');
      return { text: `${input.count} stars over ${ctx.assetUrl('moon')}`, ops: [{ op: 'add', path: '/compositions/c/layers/x', value: { type: 'sky.moon' } }] };
    },
  }],
  checks: [{
    name: 'sky.cover', description: 'the sky is not empty',
    run({ samples }) {
      const crossed = samples.some((s) => s.layers.some((p) => p.node.render?.canvas2d || p.node.simulate));
      if (crossed) return [{ check: 'sky.cover', severity: 'warning', message: 'a node crossed with its code' }];
      return samples.some((s) => s.layers.some((p) => p.id === 'moon' && p.opacity > 0.5))
        ? [] : [{ check: 'sky.cover', severity: 'info', message: 'the sky is empty' }];
    },
  }],
});

/** the host and the sandbox wired as a pair (what postMessage does) */
function pair(fixtures: Map<string, PluginModule>, onImport?: (url: string) => void, sandbox?: (modules: Map<string, PluginModule>) => SandboxDrawSide) {
  const side = startWorkerSide({
    post: (m) => queueMicrotask(() => receive(m)),
    importModule: async (url) => {
      onImport?.(url);
      const mod = fixtures.get(url);
      if (!mod) throw new Error(`no such module: ${url}`);
      return mod;
    },
    ...(sandbox ? { sandbox } : {}),
  });
  const { host, receive } = connectHost((m) => queueMicrotask(() => side.receive(m)), () => DOC_URL);
  void receive;
  return { host };
}

const doc = (): { doc: TrammeDoc; manifest: Manifest } => newProject({ name: 'T', width: 100, height: 100, fps: 30, duration: 1 });

/** a page context that records what the sandbox asks */
function toolCtx(doc: TrammeDoc, over: Partial<ToolContext> = {}): ToolContext & { wrote: [string, string][] } {
  const wrote: [string, string][] = [];
  const base: ToolContext = {
    doc, compId: doc.root, time: 0, selection: [], registry: new Registry(),
    assetUrl: () => 'https://tramme.test/p1/assets/moon.png',
    readText: async () => 'night',
    files: async () => [{ path: 'assets/sky.txt', size: 5 }],
    fileUrl: (p) => `https://tramme.test/p1/${p}`,
    writeFile: async (path, data) => { wrote.push([path, typeof data === 'string' ? data : await data.text()]); return path; },
    renderStill: async () => 'data:image/jpeg;base64,AAA',
    transcript: async () => { throw new Error('no transcript here'); },
    signal: new AbortController().signal,
    progress: () => {},
    ...over,
  };
  return Object.assign(base, { wrote });
}

describe('the plugin sandbox', () => {
  it('refuses invalid canvas dimensions before sending a render to the worker', async () => {
    const sent: unknown[] = [];
    const { host } = connectHost((message) => sent.push(message), () => DOC_URL);
    await expect(host.renderFrame({ compId: 'main', t: 0, scale: 1, width: 100_000, height: 10 })).rejects.toThrow('sandbox canvas exceeds 8192 pixels');
    await expect(host.renderFrame({ compId: 'main', t: 0, scale: Number.POSITIVE_INFINITY, width: 10, height: 10 })).rejects.toThrow('invalid sandbox canvas');
    await expect(host.draw({ frame: 0, comp: { width: 100_000, height: 10, duration: 1, fps: 30 }, layers: [], items: [] })).rejects.toThrow('sandbox canvas exceeds 8192 pixels');
    expect(sent).toEqual([]);
    host.dispose();
  });
  it('cancels an oversized module stream without waiting for its body to finish', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
      cancel() { cancelled = true; },
    });
    await expect(readLimitedBody(new Response(body), 1024 * 1024, 'plugin module')).rejects.toThrow('plugin module exceeds 1 MB');
    expect(cancelled).toBe(true);
  });
  it('refuses a batch of more than 64 plugin modules before sending it', async () => {
    const sent: unknown[] = [];
    const { host } = connectHost((message) => sent.push(message), () => DOC_URL);
    const plugins = Array.from({ length: 65 }, (_, i) => ({ id: `plugin-${i}`, url: `plugin-${i}.js` }));
    await expect(host.ensure(plugins)).rejects.toThrow('too many project plugins');
    expect(sent).toEqual([]);
    host.dispose();
  });
  it('stops on a malformed worker declaration instead of trusting its shape', async () => {
    const { host, receive } = connectHost(() => {}, () => DOC_URL);
    const pending = host.ensure([{ id: 'bad', url: 'bad.js' }]);
    expect(() => receive({ kind: 'loaded', plugins: null, urls: [] } as never)).not.toThrow();
    await expect(pending).rejects.toThrow('invalid sandbox response');
    expect(host.closed()).toBe(true);
  });
  it('stops on a malformed draw result instead of resolving it as picture data', async () => {
    const { host, receive } = connectHost(() => {}, () => DOC_URL);
    const pending = host.draw({ frame: 0, comp: { width: 10, height: 10, duration: 1, fps: 30 }, layers: [], items: [] });
    receive({ kind: 'drawn', call: 1, frame: 0, results: null } as never);
    await expect(pending).rejects.toThrow('invalid sandbox response');
    expect(host.closed()).toBe(true);
  });
  it('stops on an oversized nested tool result before giving it to the editor', async () => {
    const { host, receive } = connectHost(() => {}, () => DOC_URL);
    const pending = host.runTool('fake', {}, toolCtx(doc().doc));
    receive({ kind: 'result', call: 1, ok: { text: 'x'.repeat(9 * 1024 * 1024) } });
    await expect(pending).rejects.toThrow('sandbox response exceeds 8 MB');
    expect(host.closed()).toBe(true);
  });
  it('limits pending calls before accepting another worker request', async () => {
    const sent: unknown[] = [];
    const { host } = connectHost((message) => sent.push(message), () => DOC_URL);
    const payload: DrawPayload = { frame: 0, comp: { width: 10, height: 10, duration: 1, fps: 30 }, layers: [], items: [] };
    const pending = Array.from({ length: 64 }, () => host.draw(payload).catch(() => {}));
    const overflow = host.draw(payload);
    host.dispose();
    await expect(overflow).rejects.toThrow('too many pending sandbox calls');
    await Promise.all(pending);
    expect(sent).toHaveLength(64);
  });
  it('limits unanswered bridge requests from one running tool', async () => {
    const sent: unknown[] = [];
    const { host, receive } = connectHost((message) => sent.push(message), () => DOC_URL);
    const readText = vi.fn(() => new Promise<string>(() => {}));
    const pending = host.runTool('fake', {}, toolCtx(doc().doc, { readText }));
    for (let id = 1; id <= 17; id++) receive({ kind: 'ask', id, call: 1, q: { kind: 'readText', path: 'assets/sky.txt' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readText).toHaveBeenCalledTimes(16);
    expect(sent).toContainEqual({ kind: 'answer', id: 17, err: 'too many pending sandbox requests' });
    host.dispose();
    await expect(pending).rejects.toThrow('closed');
  });
  it('refuses an oversized file answer before posting it to the sandbox', async () => {
    const sent: unknown[] = [];
    const { host, receive } = connectHost((message) => sent.push(message), () => DOC_URL);
    const pending = host.runTool('fake', {}, toolCtx(doc().doc, { readText: async () => 'x'.repeat(8 * 1024 * 1024 + 1) }));
    receive({ kind: 'ask', id: 1, call: 1, q: { kind: 'readText', path: 'assets/large.txt' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toContainEqual({ kind: 'answer', id: 1, err: 'sandbox answer exceeds 8 MB' });
    expect(sent).not.toContainEqual(expect.objectContaining({ kind: 'answer', id: 1, ok: expect.any(String) }));
    host.dispose();
    await expect(pending).rejects.toThrow('closed');
  });
  it('refuses oversized outbound calls and document snapshots before posting', async () => {
    const sent: unknown[] = [];
    const { host } = connectHost((message) => sent.push(message), () => DOC_URL);
    const huge = new ArrayBuffer(64 * 1024 * 1024 + 1);
    await expect(host.runTool('fake', { huge }, toolCtx(doc().doc))).rejects.toThrow('sandbox message exceeds 64 MB');
    expect(() => host.setDoc({ doc: {}, docUrl: DOC_URL, images: {}, json: { huge }, fonts: [] })).toThrow('sandbox message exceeds 64 MB');
    expect(sent).toHaveLength(0);
  });
  it('bounds bitmap memory separately from plain-data messages in both directions', async () => {
    class Bitmap { width = 8192; height = 8192; }
    vi.stubGlobal('ImageBitmap', Bitmap);
    try {
      const sent: unknown[] = [];
      const { host, receive } = connectHost((message) => sent.push(message), () => DOC_URL);
      const a = new Bitmap() as unknown as ImageBitmap, b = new Bitmap() as unknown as ImageBitmap;
      expect(() => host.setDoc({ doc: {}, docUrl: DOC_URL, images: { a, b }, json: {}, fonts: [] })).toThrow('sandbox graphics exceed 256 MB');
      expect(sent).toHaveLength(0);
      const pending = host.draw({ frame: 0, comp: { width: 64, height: 64, fps: 1, duration: 1 }, layers: [], items: [] });
      receive({ kind: 'drawn', call: 1, frame: 0, results: [
        { id: 'a', ok: true, bitmap: a, area: { x: 0, y: 0, w: 1, h: 1 } },
        { id: 'b', ok: true, bitmap: b, area: { x: 0, y: 0, w: 1, h: 1 } },
      ] });
      await expect(pending).rejects.toThrow('sandbox response exceeds its data or graphics budget');
    } finally { vi.unstubAllGlobals(); }
  });
  it('rejects a replayed bridge request id without repeating the file read', async () => {
    const sent: unknown[] = [];
    const { host, receive } = connectHost((message) => sent.push(message), () => DOC_URL);
    const readText = vi.fn(async () => 'project data');
    const pending = host.runTool('fake', {}, toolCtx(doc().doc, { readText }));
    receive({ kind: 'ask', id: 1, call: 1, q: { kind: 'readText', path: 'assets/sky.txt' } });
    receive({ kind: 'ask', id: 1, call: 1, q: { kind: 'readText', path: 'assets/sky.txt' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readText).toHaveBeenCalledTimes(1);
    expect(sent).toContainEqual({ kind: 'answer', id: 1, err: 'invalid sandbox request id' });
    host.dispose();
    await expect(pending).rejects.toThrow('closed');
  });
  it('rejects an unknown worker request instead of reading check data', async () => {
    const sent: unknown[] = [];
    const { host, receive } = connectHost((message) => sent.push(message), () => DOC_URL);
    const read = vi.fn(() => 'private');
    const ctx = { doc: {}, compId: 'root', comp: {}, registry: new Registry(), evaluator: undefined, samples: [], step: 1, data: read } as unknown as CheckContext;
    const pending = host.runCheck('fake', ctx);
    receive({ kind: 'ask', id: 1, call: 1, q: { kind: 'unknown', assetId: 'secret' } } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(read).not.toHaveBeenCalled();
    expect(sent).toContainEqual({ kind: 'answer', id: 1, err: 'unknown worker request' });
    host.dispose();
    await expect(pending).rejects.toThrow('closed');
  });

  it('rejects paths that leave the project before invoking host file capabilities', async () => {
    const sent: unknown[] = [];
    const { host, receive } = connectHost((message) => sent.push(message), () => DOC_URL);
    const readText = vi.fn(async () => 'private');
    const writeFile = vi.fn(async () => 'written');
    const fetch = vi.fn(async () => new Response('private'));
    const pending = host.runTool('fake', {}, toolCtx(doc().doc, { readText, writeFile, fetch }));
    receive({ kind: 'ask', id: 1, call: 1, q: { kind: 'readText', path: '../secret.txt' } });
    receive({ kind: 'ask', id: 2, call: 1, q: { kind: 'writeFile', path: '/api/keys', data: { text: 'x' } } });
    receive({ kind: 'ask', id: 3, call: 1, q: { kind: 'fetch', url: 'file:///secret.txt' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readText).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(sent).toContainEqual({ kind: 'answer', id: 1, err: 'invalid project path' });
    expect(sent).toContainEqual({ kind: 'answer', id: 2, err: 'invalid project path' });
    expect(sent).toContainEqual({ kind: 'answer', id: 3, err: 'invalid network request' });
    host.dispose();
    await expect(pending).rejects.toThrow('closed');
  });
  it('cancels an oversized approved network response before forwarding it to a tool', async () => {
    const sent: unknown[] = [];
    const { host, receive } = connectHost((message) => sent.push(message), () => DOC_URL);
    let cancelled = false;
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      cancel() { cancelled = true; },
    }), { headers: { 'content-length': String(64 * 1024 * 1024 + 1) } }));
    const pending = host.runTool('fake', {}, toolCtx(doc().doc, { fetch }));
    receive({ kind: 'ask', id: 1, call: 1, q: { kind: 'fetch', url: 'https://service.example.com/data' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toContainEqual({ kind: 'answer', id: 1, err: 'network response exceeds 64 MB' });
    expect(cancelled).toBe(true);
    host.dispose();
    await expect(pending).rejects.toThrow('closed');
  });
  it('keeps the approved network response budget above the ordinary data budget', async () => {
    const sent: unknown[] = [];
    const { host, receive } = connectHost((message) => sent.push(message), () => DOC_URL);
    const body = new Uint8Array(8 * 1024 * 1024 + 1);
    const pending = host.runTool('fake', {}, toolCtx(doc().doc, { fetch: async () => new Response(body) }));
    receive({ kind: 'ask', id: 1, call: 1, q: { kind: 'fetch', url: 'https://service.example.com/data' } });
    for (let i = 0; i < 20 && !sent.some((m) => (m as { kind?: string }).kind === 'answer'); i++) await new Promise((resolve) => setTimeout(resolve, 0));
    const reply = sent.find((m) => (m as { kind?: string }).kind === 'answer') as { ok?: { body: ArrayBuffer }; err?: string } | undefined;
    expect(reply?.err).toBeUndefined();
    expect(reply?.ok?.body.byteLength).toBe(body.byteLength);
    host.dispose();
    await expect(pending).rejects.toThrow('closed');
  });
  it('terminates a plugin load that never answers', async () => {
    vi.useFakeTimers();
    try {
      const { host } = connectHost(() => {}, () => DOC_URL);
      const rejected = expect(host.ensure([{ id: 'slow', url: 'blob:slow' }])).rejects.toThrow('plugin slow load timed out');
      await vi.advanceTimersByTimeAsync(15_001);
      await rejected;
      expect(host.closed()).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('terminates a drawing call that never answers', async () => {
    vi.useFakeTimers();
    try {
      const { host } = connectHost(() => {}, () => DOC_URL);
      const rejected = expect(host.draw({ frame: 0, comp: { width: 10, height: 10, duration: 1, fps: 30 }, layers: [], items: [] })).rejects.toThrow('draw call timed out');
      await vi.advanceTimersByTimeAsync(30_001);
      await rejected;
      expect(host.closed()).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('terminates unanswered checks, tools, whole frames and vector exports', async () => {
    vi.useFakeTimers();
    try {
      const cases = [
        { kind: 'check', ms: 30_001, start: (host: PluginHost) => host.runCheck('slow', { doc: doc().doc, compId: 'root', comp: {}, samples: [], step: 1 } as unknown as CheckContext) },
        { kind: 'tool', ms: 120_001, start: (host: PluginHost) => host.runTool('slow', {}, toolCtx(doc().doc)) },
        { kind: 'render', ms: 30_001, start: (host: PluginHost) => host.renderFrame({ compId: 'root', t: 0, scale: 1, width: 10, height: 10 }) },
        { kind: 'export', ms: 30_001, start: (host: PluginHost) => host.exportOf('slow', {}) },
      ];
      for (const test of cases) {
        const { host } = connectHost(() => {}, () => DOC_URL);
        const rejected = expect(test.start(host)).rejects.toThrow(`${test.kind} call timed out`);
        await vi.advanceTimersByTimeAsync(test.ms);
        await rejected;
        expect(host.closed()).toBe(true);
      }
    } finally { vi.useRealTimers(); }
  });
  it('tells the page what a plugin declares, without its code', async () => {
    const { host } = pair(new Map([['blob:stars', plugin()]]));
    const decls = await host.ensure([{ id: 'stars', url: 'blob:stars' }]);
    const d = decls.get('stars')!;
    expect(d.meta?.name).toBe('stars');
    expect(d.tools.map((t) => t.name)).toEqual(['sky.stars']);
    expect(d.tools[0]).not.toHaveProperty('run');
    expect(d.checks.map((c) => c.name)).toEqual(['sky.cover']);
    expect(d.nodes[0].type).toBe('sky.moon');
    expect(d.nodes[0]).not.toHaveProperty('render');
    expect(d.nodes[0].hasPath).toBe(true);
    // the same url again: nothing reloaded
    const again = await host.ensure([{ id: 'stars', url: 'blob:stars' }]);
    expect(again.get('stars')).toBe(d);
  });

  it('runs a tool with its reaches bridged to the page', async () => {
    const { host } = pair(new Map([['blob:stars', plugin()]]));
    const reg = new Registry();
    const { doc: d } = doc();
    d.assets.stars = { type: 'module', src: 'plugins/stars.js' };
    d.plugins = ['stars'];
    d.assets.moon = { type: 'image', src: 'assets/moon.png' };
    await attachIsolated(reg, host, d, () => 'blob:stars');
    const entry = reg.tool('sky.stars');
    expect(entry.from).toBe('stars');
    const ctx = toolCtx(d);
    const progress = vi.fn();
    ctx.progress = progress;
    const out = toolOutput(await entry.tool.run({ count: 12 }, ctx));
    expect(out.text).toBe('12 stars over https://tramme.test/p1/assets/moon.png');
    expect(out.ops).toHaveLength(1);
    expect(ctx.wrote).toEqual([['assets/stars.json', '{"count":12,"read":"night"}']]);
    expect(progress).toHaveBeenCalledWith(1, 2, 'placing');
  });
  it('runs each project plugin tool in a worker containing only that plugin', async () => {
    const a: PluginModule = { tools: [{ name: 'a.tool', description: 'A', run: () => 'A' }] };
    const b: PluginModule = { tools: [{ name: 'b.tool', description: 'B', run: () => 'B' }] };
    const shared = pair(new Map([['blob:a', a], ['blob:b', b]])).host;
    const imports: string[] = [];
    const dedicated = new Map([
      ['a', pair(new Map([['blob:a', a]]), (url) => imports.push(url)).host],
      ['b', pair(new Map([['blob:b', b]]), (url) => imports.push(url)).host],
    ]);
    const { doc: d } = doc();
    d.plugins = ['a', 'b'];
    d.assets.a = { type: 'module', src: 'plugins/a.js' };
    d.assets.b = { type: 'module', src: 'plugins/b.js' };
    const reg = new Registry();
    await attachIsolated(reg, shared, d, (id) => `blob:${id}`, undefined, (id) => dedicated.get(id)!);
    expect(toolOutput(await reg.tool('a.tool').tool.run({}, toolCtx(d))).text).toBe('A');
    expect(toolOutput(await reg.tool('b.tool').tool.run({}, toolCtx(d))).text).toBe('B');
    expect(imports.sort()).toEqual(['blob:a', 'blob:b']);
  });

  it('keeps a plugin that the sandbox cannot load out of the vocabulary', async () => {
    const { host } = pair(new Map());
    const reg = new Registry();
    const { doc: d } = doc();
    d.plugins = ['ghost'];
    d.assets.ghost = { type: 'module', src: 'plugins/ghost.js' };
    await expect(attachIsolated(reg, host, d, () => 'blob:ghost')).rejects.toThrow(/ghost/);
    expect(reg.hasTool('sky.stars')).toBe(false);
  });

  it('gives a check plain samples, and returns its issues', async () => {
    const { host } = pair(new Map([['blob:stars', plugin()]]));
    const reg = new Registry();
    const { doc: d } = doc();
    d.plugins = ['stars'];
    d.assets.stars = { type: 'module', src: 'plugins/stars.js' };
    await attachIsolated(reg, host, d, () => 'blob:stars');
    const node = { type: 'sky.moon', title: 'Moon', category: 'Shapes', props: {}, render: { canvas2d: () => {} } } as never;
    const check = reg.listChecks().find((c) => c.check.name === 'sky.cover')!.check;
    const ctx = {
      doc: d, compId: d.root, comp: d.compositions[d.root], registry: reg, evaluator: undefined as never,
      samples: [{ t: 0, layers: [{ id: 'moon', layer: {} as never, node, props: {}, opacity: 0.9, box: null }] }],
      step: 0.25, data: () => undefined,
    } as CheckContext;
    // the node's code never crossed: the check's own guard says so
    expect(await check.run(ctx)).toEqual([]);
    ctx.samples[0].layers[0].id = 'darkness';
    expect(await check.run(ctx)).toEqual([{ check: 'sky.cover', severity: 'info', message: 'the sky is empty' }]);
  });

  it('stops a tool whose turn was stopped', async () => {
    const waiting: PluginModule = {
      tools: [{ name: 'sky.wait', description: 'waits', async run(_i: unknown, ctx: ToolContext) { await ctx.readText('never'); return 'done'; } }],
    };
    const { host } = pair(new Map([['blob:wait', waiting]]));
    await host.ensure([{ id: 'wait', url: 'blob:wait' }]);
    const controller = new AbortController();
    const ctx = toolCtx(doc().doc, { readText: () => new Promise<string | null>(() => {}), signal: controller.signal });
    const p = host.runTool('sky.wait', {}, ctx);
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await expect(p).rejects.toThrow(/aborted/);
  });

  it('loads a plugin again when its url changed (an edited file), and not before', async () => {
    const mod = plugin();
    let imports = 0;
    const { host } = pair(new Map([
      ['blob:stars?v=1', mod],
      ['blob:stars?v=2', { ...mod, tools: [{ ...mod.tools![0], name: 'sky.stars2' }] }],
    ]), (url) => { imports++; void url; });
    const first = await host.ensure([{ id: 'stars', url: 'blob:stars?v=1' }]);
    expect(first.get('stars')?.tools[0].name).toBe('sky.stars');
    await host.ensure([{ id: 'stars', url: 'blob:stars?v=1' }]);
    expect(imports).toBe(1);
    const second = await host.ensure([{ id: 'stars', url: 'blob:stars?v=2' }]);
    expect(imports).toBe(2);
    expect(second.get('stars')?.tools[0].name).toBe('sky.stars2');
  });

  it('waits for a load under way when asked again meanwhile (a turn resumed as the project opens)', async () => {
    let imports = 0;
    const { host } = pair(new Map([['blob:stars', plugin()]]), () => { imports++; });
    const { doc: d } = doc();
    d.plugins = ['stars'];
    d.assets.stars = { type: 'module', src: 'plugins/stars.js' };
    const reg = new Registry();
    // the preview's start and a reload, both before the sandbox answered
    await Promise.all([attachIsolated(reg, host, d, () => 'blob:stars'), attachIsolated(new Registry(), host, d, () => 'blob:stars')]);
    expect(reg.tool('sky.stars').from).toBe('stars');
    expect(imports).toBe(1);
  });

  it('says why a plugin did not load, tries it again on the next call, and keeps the others', async () => {
    const fixtures = new Map<string, PluginModule>([['blob:stars', plugin()]]);
    const { host } = pair(fixtures);
    await expect(host.ensure([{ id: 'late', url: 'blob:late' }])).rejects.toThrow('plugin late: no such module: blob:late');
    fixtures.set('blob:late', { tools: [{ name: 'late.tool', description: 'late', run: () => 'ok' }] });
    expect((await host.ensure([{ id: 'late', url: 'blob:late' }])).get('late')?.tools[0].name).toBe('late.tool');
    // one broken plugin beside a sound one: the sound one is attached, the broken one named
    const { doc: d } = doc();
    d.plugins = ['ghost', 'stars'];
    d.assets.ghost = { type: 'module', src: 'plugins/ghost.js' };
    d.assets.stars = { type: 'module', src: 'plugins/stars.js' };
    const reg = new Registry();
    await expect(attachIsolated(reg, host, d, (id) => `blob:${id}`)).rejects.toThrow(/plugin ghost: no such module/);
    expect(reg.hasTool('sky.stars')).toBe(true);
    // A failed load stays visible and can be retried after its source is repaired.
    await expect(attachIsolated(reg, host, d, (id) => `blob:${id}`)).rejects.toThrow(/plugin ghost: no such module/);
    fixtures.set('blob:ghost', { tools: [{ name: 'ghost.tool', description: 'repaired', run: () => 'ok' }] });
    await expect(attachIsolated(reg, host, d, (id) => `blob:${id}`)).resolves.toBeUndefined();
    expect(reg.hasTool('ghost.tool')).toBe(true);
  });

  it('refuses what waits when the sandbox stops, with the reason', async () => {
    const side = startWorkerSide({ post: () => {}, importModule: () => new Promise(() => {}) });
    const { host } = connectHost((m) => side.receive(m), () => DOC_URL);
    const p = host.ensure([{ id: 'stars', url: 'blob:stars' }]);
    expect(host.closed()).toBe(false);
    host.dispose('Uncaught SyntaxError');
    await expect(p).rejects.toThrow('the plugin sandbox stopped: Uncaught SyntaxError');
    expect(host.closed()).toBe(true);
  });

  it('narrows the realm it runs in: own origin only, no sockets', async () => {
    const calls: string[] = [];
    const realm: { fetch?: typeof fetch; WebSocket?: unknown; location?: { href: string } } = {
      fetch: ((input: RequestInfo | URL) => { calls.push(String(input)); return Promise.resolve(new Response('ok')); }) as typeof fetch,
      WebSocket: class {},
      location: { href: 'https://tramme.test/plugin-worker.js' },
    };
    guardRealm(realm, 'https://tramme.test');
    await (realm.fetch as typeof fetch)('https://tramme.test/api/config');
    await expect((realm.fetch as typeof fetch)('https://evil.test/x')).rejects.toThrow(/evil\.test/);
    expect(realm.WebSocket).toBeUndefined();
    expect(calls).toEqual(['https://tramme.test/api/config']);
  });

  it('strips the tools and checks from what the page registers', () => {
    const filtered = filterModule(plugin());
    expect(filtered.tools).toBeUndefined();
    expect(filtered.checks).toBeUndefined();
    expect(filtered.nodes).toHaveLength(1);
    expect(filtered.meta?.name).toBe('stars');
    // the node is wrapped: its draw belongs to the sandbox; its schema and simulation stay; its geometry is served from the sandbox
    const n = filtered.nodes![0];
    expect(n.render.gl).toBeUndefined();
    expect(typeof (n.render as { canvas2d?: unknown }).canvas2d).toBe('function');
    expect(n.simulate).toBeDefined();
    expect(n.props).toBeDefined();
    expect(typeof n.path).toBe('function');
    expect(typeof n.handles).toBe('function');
    expect(typeof n.export?.svg).toBe('function');
  });
});

describe('the sandboxed drawing', () => {
  beforeEach(() => resetSandbox());

  it('waits for a supplied font before drawing the first frame', async () => {
    const oldSelf = (globalThis as any).self, oldFace = (globalThis as any).FontFace;
    let finish!: () => void;
    const added: unknown[] = [];
    (globalThis as any).self = { fonts: { add: (face: unknown) => added.push(face) } };
    (globalThis as any).FontFace = class {
      constructor(_family: string, _data: ArrayBuffer) {}
      load() { return new Promise((resolve) => { finish = () => resolve(this); }); }
    };
    try {
      const draw = makeSandboxDraw(new Map());
      draw.setDoc({ doc: { assets: {} }, docUrl: DOC_URL, images: {}, json: {}, fonts: [{ url: `${DOC_URL}/font`, family: 'Test', data: new ArrayBuffer(4) }] });
      let settled = false;
      const frame = draw.draw({ frame: 0, comp: { width: 10, height: 10, duration: 1, fps: 30 }, layers: [], items: [] }).then((result) => { settled = true; return result; });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);
      finish();
      expect((await frame).results).toEqual([]);
      expect(added).toHaveLength(1);
    } finally { (globalThis as any).self = oldSelf; (globalThis as any).FontFace = oldFace; }
  });

  it('refuses the frame when a supplied font cannot load', async () => {
    const oldSelf = (globalThis as any).self, oldFace = (globalThis as any).FontFace;
    (globalThis as any).self = { fonts: { add() {} } };
    (globalThis as any).FontFace = class { load() { return Promise.reject(new Error('bad font')); } };
    try {
      const draw = makeSandboxDraw(new Map());
      draw.setDoc({ doc: { assets: {} }, docUrl: DOC_URL, images: {}, json: {}, fonts: [{ url: `${DOC_URL}/bad`, family: 'Bad', data: new ArrayBuffer(4) }] });
      await expect(draw.draw({ frame: 0, comp: { width: 10, height: 10, duration: 1, fps: 30 }, layers: [], items: [] })).rejects.toThrow('bad font');
    } finally { (globalThis as any).self = oldSelf; (globalThis as any).FontFace = oldFace; }
  });

  it('draws a frame in the sandbox and hands the pictures to the page', async () => {
    const docs: SandboxDoc[] = [], payloads: DrawPayload[] = [];
    const bitmap = { width: 20, height: 20 } as unknown as ImageBitmap;
    const sandbox: SandboxDrawSide = {
      setDoc: (d) => { docs.push(d); },
      draw: async (p) => {
        payloads.push(p);
        return {
          results: p.items.map((i): DrawResult => ({ id: i.id, ok: true, bitmap, area: { x: -10, y: -10, w: 20, h: 20 }, path: 'M 0 0 L 10 10', handles: [{ prop: 'radius', at: [1, 2] }] })),
          transfer: [bitmap],
        };
      },
      exportOf: async () => ({ err: 'not this test' }),
      renderFrame: async () => ({ err: 'not this test' }),
    };
    const { host } = pair(new Map([['blob:stars', plugin()]]), undefined, () => sandbox);
    await host.ensure([{ id: 'stars', url: 'blob:stars' }]);
    host.setDoc({ doc: { assets: { moon: { type: 'image', src: 'assets/moon.png' } } }, docUrl: DOC_URL, images: {}, json: {}, fonts: [] });
    const results = await host.draw({ frame: 3, comp: { width: 100, height: 100, duration: 2, fps: 30 }, layers: [{ id: 'moon', props: {}, transform: { anchor: [0, 0], position: [50, 50], scale: [1, 1], rotation: 0, opacity: 1 }, in: 0, out: 2 }], items: [{ id: 'moon', type: 'sky.moon', props: { radius: 5 }, t: 0.1, frame: 3 }] });
    expect(results[0]).toMatchObject({ id: 'moon', ok: true, area: { w: 20 }, path: 'M 0 0 L 10 10' });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].items[0].type).toBe('sky.moon');
    expect(docs).toHaveLength(1);
  });

  it('hands a node\'s vector export across', async () => {
    const sandbox: SandboxDrawSide = {
      setDoc: () => {},
      draw: async () => ({ results: [] }),
      exportOf: async (type, props) => {
        const mod = plugin();
        const node = type === 'sky.moon' ? mod.nodes![0] : undefined;
        if (!node?.export) return { err: `${type} has no vector export` };
        return { svg: node.export.svg?.(props), lottie: node.export.lottie?.(props) };
      },
      renderFrame: async (p) => {
        if (!p.videos || !p.videos.clip) return { err: 'no video frame shipped' };
        const b = { width: 100 } as unknown as ImageBitmap;
        return { bitmap: b, transfer: [b] };
      },
    };
    const { host } = pair(new Map([['blob:stars', plugin()]]), undefined, () => sandbox);
    await host.ensure([{ id: 'stars', url: 'blob:stars' }]);
    const r = await host.exportOf('sky.moon', { radius: 7 });
    expect(r.svg).toBe('<circle r="7"/>');
    await expect(host.exportOf('sky.other', {})).rejects.toThrow(/sky\.other/);
  });

  it('renders a whole frame in the sandbox and hands the picture back', async () => {
    const frames: unknown[] = [];
    const bitmap = { width: 96, height: 48 } as unknown as ImageBitmap;
    const { host } = pair(new Map([['blob:stars', plugin()]]), undefined, () => ({
      setDoc: () => {},
      draw: async () => ({ results: [] }),
      exportOf: async () => ({}),
      renderFrame: async (p) => { frames.push(p); return { bitmap, transfer: [bitmap] }; },
    }));
    host.setDoc({ doc: { assets: {} }, docUrl: DOC_URL, images: {}, json: {}, fonts: [] });
    const pic = await host.renderFrame({ compId: 'root', t: 0.5, scale: 0.5, width: 192, height: 96, videos: { clip: {} } });
    expect(pic.bitmap).toBe(bitmap);
    expect(frames).toHaveLength(1);
    const p = frames[0] as { compId: string; t: number; videos: Record<string, unknown> };
    expect(p.compId).toBe('root');
    expect(p.videos.clip).toEqual({});
    // the video frames shipped are bitmaps the page closes once the picture is back (a canvas element would not cross postMessage)
    let closed = 0;
    await host.renderFrame({ compId: 'root', t: 0, scale: 1, width: 192, height: 96, videos: { clip: { close: () => { closed++; } } } });
    expect(closed).toBe(1);
    // without the sandbox: a clear error
    const bare = pair(new Map());
    await expect(bare.host.renderFrame({ compId: 'root', t: 0, scale: 1, width: 100, height: 100 })).rejects.toThrow(/cannot render/);
  });

  it('the wrapper defers, then draws the picture over its bounds; a later frame keeps the last one', async () => {
    const drawn: unknown[][] = [];
    const ctx = { drawImage: (...a: unknown[]) => drawn.push(a) } as unknown as CanvasRenderingContext2D;
    const deferred: Promise<unknown>[] = [];
    let resolveDraw: (r: DrawResult[]) => void = () => {};
    const fakeHost = {
      ensure: async () => new Map(),
      runTool: async () => ({}),
      runCheck: async () => [],
      setDoc: () => {},
      draw: () => new Promise<DrawResult[]>((res) => { resolveDraw = res; }),
      dispose: () => {},
    } as unknown as PluginHost;
    bindSandbox({ host: () => fakeHost, context: () => ({ doc: doc().doc, docUrl: DOC_URL, loaded: () => null }) });
    const node = sandboxNode(plugin().nodes![0]);
    const layer = { layerId: 'moon', t: 0.1, frame: 3, fps: 30, width: 100, height: 100, duration: 2, defer: (p: Promise<unknown>) => deferred.push(p), state: () => undefined } as unknown as Host;
    // first pass: nothing is drawn, the draw is deferred (renderComplete will wait for it)
    node.render.canvas2d!(ctx, { radius: 5 }, layer);
    expect(drawn).toHaveLength(0);
    expect(deferred).toHaveLength(1);
    resolveDraw([{ id: 'moon', ok: true, bitmap: { width: 20 } as unknown as CanvasImageSource, area: { x: -10, y: -10, w: 20, h: 20 } }]);
    await deferred[0];
    // second pass at the same frame: the picture lands over its bounds
    node.render.canvas2d!(ctx, { radius: 5 }, layer);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].slice(1)).toEqual([-10, -10, 20, 20]);
    // a later frame: the last picture stands in while the fresh one is in flight
    (layer as { frame: number }).frame = 4;
    node.render.canvas2d!(ctx, { radius: 5 }, layer);
    expect(drawn).toHaveLength(2);
    expect(deferred).toHaveLength(2);
  });

  it('a failing draw reads as a failed node', async () => {
    const ctx = { drawImage: () => {} } as unknown as CanvasRenderingContext2D;
    let resolveDraw: (r: DrawResult[]) => void = () => {};
    const fakeHost = {
      ensure: async () => new Map(),
      runTool: async () => ({}),
      runCheck: async () => [],
      setDoc: () => {},
      draw: () => new Promise<DrawResult[]>((res) => { resolveDraw = res; }),
      dispose: () => {},
    } as unknown as PluginHost;
    bindSandbox({ host: () => fakeHost, context: () => ({ doc: doc().doc, docUrl: DOC_URL, loaded: () => null }) });
    const node = sandboxNode(plugin().nodes![0]);
    const layer = { layerId: 'moon', t: 0, frame: 1, fps: 30, width: 100, height: 100, duration: 2, defer: () => {} } as unknown as Host;
    node.render.canvas2d!(ctx, {}, layer);
    resolveDraw([{ id: 'moon', ok: false, err: 'boom in the sandbox' }]);
    await new Promise((r) => setTimeout(r, 5));
    expect(() => node.render.canvas2d!(ctx, {}, layer)).toThrow(/boom in the sandbox/);
  });

  it('serves the outline and the handles the sandbox shipped with the frame', async () => {
    vi.stubGlobal('Path2D', class { d?: string; constructor(d?: string) { this.d = d; } });
    const drawn: unknown[][] = [];
    const ctx = { drawImage: (...a: unknown[]) => drawn.push(a) } as unknown as CanvasRenderingContext2D;
    let resolveDraw: (r: DrawResult[]) => void = () => {};
    const fakeHost = {
      ensure: async () => new Map(),
      runTool: async () => ({}),
      runCheck: async () => [],
      setDoc: () => {},
      draw: () => new Promise<DrawResult[]>((res) => { resolveDraw = res; }),
      exportOf: async () => ({ svg: '<circle r="5"/>' }),
      renderFrame: async () => ({ bitmap: {} }),
      dispose: () => {},
    } as unknown as PluginHost;
    bindSandbox({ host: () => fakeHost, context: () => ({ doc: doc().doc, docUrl: DOC_URL, loaded: () => null }) });
    const node = sandboxNode(plugin().nodes![0]);
    const layer = { layerId: 'moon', t: 0.1, frame: 3, fps: 30, width: 100, height: 100, duration: 2, defer: () => {}, state: () => undefined } as unknown as Host;
    // before the first frame: no outline, no handles
    expect(node.path!({ radius: 5 }, layer)).toBeNull();
    expect(node.handles!({ radius: 5 })).toEqual([]);
    node.render.canvas2d!(ctx, { radius: 5 }, layer);
    resolveDraw([{ id: 'moon', ok: true, bitmap: {} as unknown as CanvasImageSource, area: { x: -10, y: -10, w: 20, h: 20 }, path: 'M 0 0 L 10 10', handles: [{ prop: 'radius', at: [1, 2] }] }]);
    await new Promise((r) => setTimeout(r, 5));
    // the page reads the geometry the sandbox shipped, as data
    const outline = node.path!({ radius: 5 }, layer) as unknown as { d?: string };
    expect(outline.d).toBe('M 0 0 L 10 10');
    expect(node.handles!({ radius: 5 })).toEqual([{ prop: 'radius', at: [1, 2] }]);
    vi.unstubAllGlobals();
  });

  it('primes a node\'s vector export from the sandbox before the page reads it', async () => {
    const exported: unknown[] = [];
    const fakeHost = {
      ensure: async () => new Map(),
      runTool: async () => ({}),
      runCheck: async () => [],
      setDoc: () => {},
      draw: async () => [],
      exportOf: async (_type: string, props: unknown) => { exported.push(props); return { svg: `<circle r="${(props as { radius: number }).radius}"/>`, lottie: [{ radius: (props as { radius: number }).radius }] }; },
      dispose: () => {},
    } as unknown as PluginHost;
    bindSandbox({ host: () => fakeHost, context: () => ({ doc: doc().doc, docUrl: DOC_URL, loaded: () => null }) });
    const { doc: d } = doc();
    d.compositions[d.root].layers.moon = { type: 'sky.moon', props: { radius: 5 } } as never;
    d.compositions[d.root].order = ['moon'];
    const reg = new Registry().register({ ...sandboxNode(plugin().nodes![0]) });
    await primeSandboxExports(d, reg, 0);
    expect(exported).toEqual([{ radius: 5 }]);
    expect(reg.node('sky.moon').export!.svg!({ radius: 5 })).toBe('<circle r="5"/>');
    expect(reg.node('sky.moon').export!.lottie!({ radius: 5 })).toEqual([{ radius: 5 }]);
  });
});

describe('the recording path', () => {
  it('writes the commands as SVG path data', () => {
    const p = new RecordingPath2D();
    p.moveTo(10, 10.005);
    p.lineTo(20, 10);
    p.bezierCurveTo(30, 10, 40, 20, 50, 20);
    p.quadraticCurveTo(60, 20, 70, 20);
    p.rect(0, 0, 5, 5);
    p.closePath();
    const d = p.toString();
    expect(d).toContain('M 10 10');
    expect(d).toContain('L 20 10');
    expect(d).toContain('C 30 10 40 20 50 20');
    expect(d).toContain('Q 60 20 70 20');
    expect(d).toContain('R 0 0 5 5');
    expect(d).toContain('Z');
  });

  it('turns arcs into cubic beziers a real Path2D can parse', () => {
    const p = new RecordingPath2D();
    p.moveTo(100, 0);
    p.arc(0, 0, 100, 0, Math.PI / 2);
    const d = p.toString();
    expect(d).toContain('C');
    expect(d.startsWith('M 100 0')).toBe(true);
    // the sweep ends on the quarter's end point (0, 100)
    expect(d.trimEnd().endsWith('0 100')).toBe(true);
    // a full circle: two arcs' worth of beziers
    const c = new RecordingPath2D();
    c.arc(0, 0, 10, 0, Math.PI * 2);
    expect(c.toString().split('C').length - 1).toBeGreaterThanOrEqual(4);
  });

  it('joins paths and copies one built from data', () => {
    const a = new RecordingPath2D();
    a.moveTo(0, 0);
    a.lineTo(1, 1);
    const b = new RecordingPath2D('M 5 5 L 6 6');
    a.addPath(b);
    expect(a.toString()).toContain('M 5 5 L 6 6');
    const c = new RecordingPath2D(a);
    expect(c.toString()).toBe(a.toString());
  });

  it('builds the page registry from declarations alone: schemas and wrappers, no plugin code', () => {
    const decl = {
      id: 'stars', meta: { name: 'stars', api: 1 }, tools: [], checks: [],
      nodes: [{ type: 'sky.moon', title: 'Moon', category: 'Shapes', props: { radius: { type: 'number', default: 10 } }, hasPath: true, hasHandles: true, hasExport: true }],
      effects: [{ type: 'sky.glow', title: 'Glow', category: 'Finish', stage: 'finish' as const, props: {} }],
      modifiers: [{ type: 'sky.wobble', title: 'Wobble', params: {} }],
      tours: [{ id: 'stars.tour', steps: [] }],
      messages: { fr: { 'sky.hello': 'bonjour' } },
    };
    const mod = declarationsModule(decl as never, 'stars');
    const reg = new Registry().use(mod as never, 'stars');
    const n = reg.node('sky.moon');
    expect(n.props).toBeDefined();
    expect(typeof (n.render as { canvas2d?: unknown }).canvas2d).toBe('function');
    expect(typeof n.path).toBe('function');
    expect(typeof n.handles).toBe('function');
    expect(n.export).toBeDefined();
    expect(n.simulate).toBeUndefined();
    expect(reg.hasEffect('sky.glow')).toBe(true);
    expect(reg.modifier('sky.wobble')).toBeDefined();
    expect(mod.tours).toEqual([{ id: 'stars.tour', steps: [] }]);
    expect(mod.messages).toEqual({ fr: { 'sky.hello': 'bonjour' } });
    // the declarations the sandbox reported are remembered for the page
    noteSandboxDeclaration(decl as never);
    expect(sandboxDeclaration('stars')?.meta?.name).toBe('stars');
    resetSandbox();
    expect(sandboxDeclaration('stars')).toBeNull();
  });
});
