// The import's guard of trust: an archive carrying code (plugins,
// expressions) is asked about before any of it runs; a refusal writes
// nothing to storage and loads no plugin.

import { describe, expect, it, vi } from 'vitest';
import { stringifyDoc, type TrammeDoc } from '@tramme/core';
import { newProject, packProject, type CodeInventory, type Manifest } from '@tramme/project';
import { ImportError, readArchive } from '../src/importer.ts';
import type { PluginHost } from '../src/plugins/host.ts';

// the api below the importer: its calls recorded, nothing stored
const calls = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock('../src/api.ts', () => ({
  api: {
    create: async (o: Record<string, unknown>) => { calls.list.push('create'); return { id: 'p1', name: 'x', created: '', ...o } as Manifest; },
    write: async () => { calls.list.push('write'); },
    writeAny: async () => { calls.list.push('writeAny'); },
    update: async (_id: string, o: unknown) => o,
    remove: async () => { calls.list.push('remove'); },
  },
}));
// files.ts reads the project id from the editor's state; the guard runs before any of it
vi.mock('../src/state.ts', () => ({
  S: { project: { peek: () => ({ id: 'p1' }) } },
  toast: () => {},
}));

const PLUGIN = `globalThis.__trammePluginLoaded = true;
export const nodes = [];
`;

/** a project archive: its document as given, its plugins as files */
const archiveOf = (doc: TrammeDoc, plugins: Record<string, string> = {}): Uint8Array => {
  const files = new Map<string, Uint8Array>();
  files.set('tramme.json', new TextEncoder().encode(JSON.stringify({ format: 'tramme-project/1', id: 'imported-test', name: 'Imported test', created: '2026-01-01', modified: '2026-01-01' })));
  files.set('document.tramme.json', new TextEncoder().encode(stringifyDoc(doc)));
  for (const [p, src] of Object.entries(plugins)) files.set(p, new TextEncoder().encode(src));
  return packProject(files);
};

/** a document with one animated property, its expression as given */
const withCode = (expr: unknown, plugins: string[] = []): TrammeDoc => {
  const { doc } = newProject({ name: 'Imported test', width: 100, height: 100, fps: 30, duration: 2 });
  for (const id of plugins) doc.assets[id] = { type: 'module', src: `plugins/${id}.js` };
  doc.plugins = plugins;
  const c = doc.compositions[doc.root];
  c.layers.a = { type: 'shape.rect', transform: { position: expr as never } } as never;
  c.order = ['a'];
  return doc;
};

describe('readArchive', () => {
  it('imports without asking when the project carries no code', async () => {
    const ask = vi.fn();
    const { doc } = await readArchive(archiveOf(withCode([50, 50])), ask);
    expect(ask).not.toHaveBeenCalled();
    expect(doc.plugins).toEqual([]);
  });

  it('refuses and loads no plugin when the ask says no', async () => {
    const data = archiveOf(withCode({ $expr: 'time' }, ['stars']), { 'plugins/stars.js': PLUGIN });
    const err = await readArchive(data, async () => false).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.message).not.toMatch(/plugin/);
    expect((globalThis as Record<string, unknown>).__trammePluginLoaded).toBeUndefined();
    expect(calls.list).toEqual([]);
  });

  it('accepts expressions when the ask says yes', async () => {
    const ask = vi.fn(async (_inv: CodeInventory) => true);
    const { doc } = await readArchive(archiveOf(withCode({ $expr: 'time' })), ask);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0].expressions).toBe(1);
    expect(doc.compositions[doc.root].layers.a).toBeDefined();
  });

  it('counts the plugins in what it shows the ask', async () => {
    const ask = vi.fn(async (_inv: CodeInventory) => false);
    await readArchive(archiveOf(withCode([50, 50], ['stars']), { 'plugins/stars.js': PLUGIN }), ask).catch(() => {});
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0].plugins).toEqual([{ id: 'stars', path: 'plugins/stars.js', size: PLUGIN.length, kinds: ['nodes'] }]);
  });

  it('refuses an accepted plugin when no isolated worker is available', async () => {
    const oldWorker = globalThis.Worker;
    try {
      (globalThis as { Worker?: typeof Worker }).Worker = undefined;
      const data = archiveOf(withCode([50, 50], ['stars']), { 'plugins/stars.js': PLUGIN });
      const err = await readArchive(data, async () => true).catch((e) => e);
      expect(err).toBeInstanceOf(ImportError);
      expect(err.message).toMatch(/isolated worker/i);
      expect((globalThis as Record<string, unknown>).__trammePluginLoaded).toBeUndefined();
    } finally { (globalThis as { Worker?: typeof Worker }).Worker = oldWorker; }
  });

  it('validates a plugin in the sandbox: the page never imports it, even when accepted', async () => {
    const decls = new Map([['stars', {
      id: 'stars', meta: { name: 'stars', api: 1 }, tools: [], checks: [],
      nodes: [{ type: 'sky.moon', title: 'Moon', category: 'Shapes', props: { radius: { type: 'number', default: 10 } }, hasPath: true }],
      effects: [], modifiers: [],
    }]]);
    const sandbox = {
      ensure: async (list: { id: string }[]) => { expect(list.map((p) => p.id)).toEqual(['stars']); return decls; },
      runTool: async () => ({}), runCheck: async () => [], setDoc: () => {}, draw: async () => [], dispose: () => {},
    } as unknown as PluginHost;
    const d = withCode([50, 50], ['stars']);
    d.compositions[d.root].layers.a = { type: 'sky.moon', props: { radius: 5 } } as never;
    const { doc } = await readArchive(archiveOf(d, { 'plugins/stars.js': PLUGIN }), async () => true, { sandbox });
    // accepted and validated against the sandbox's declarations: the module's code never ran on the page
    expect((globalThis as Record<string, unknown>).__trammePluginLoaded).toBeUndefined();
    expect(doc.compositions[doc.root].layers.a).toBeDefined();
  });

  it('refuses a document that fails the sandbox validation', async () => {
    const decls = new Map([['stars', {
      id: 'stars', tools: [], checks: [],
      nodes: [{ type: 'sky.moon', title: 'Moon', category: 'Shapes', props: { radius: { type: 'number', default: 10 } } }],
      effects: [], modifiers: [],
    }]]);
    const sandbox = {
      ensure: async () => decls, runTool: async () => ({}), runCheck: async () => [], setDoc: () => {}, draw: async () => [], dispose: () => {},
    } as unknown as PluginHost;
    const d = withCode([50, 50], ['stars']);
    d.compositions[d.root].layers.a = { type: 'sky.moon', props: { radius: 'big' } } as never;
    const err = await readArchive(archiveOf(d, { 'plugins/stars.js': PLUGIN }), async () => true, { sandbox }).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.issues.some((i: { path: string }) => i.path.includes('radius'))).toBe(true);
  });
});
