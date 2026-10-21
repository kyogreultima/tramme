// The installed plugins in a project (docs/installed-plugins-roadmap.md,
// steps 3 and 4): attached through the sandbox with the project's own names
// winning, and copied into the project with the change that first draws
// with them, in the same step.

import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';
import { Registry, type PluginModule, type TrammeDoc } from '@tramme/core';
import { connectHost } from '../src/plugins/host.ts';
import { startWorkerSide } from '../src/plugins/worker-side.ts';
import { attachInstalled } from '../src/plugins/vocabulary.ts';
import { copiesFor, counted, installedTypes, offIn, permitted, stopped, STRIKES, typesOf, type Installed } from '../src/installed.ts';
import type { ToolContext } from '@tramme/core';

const host = (fixtures: Map<string, PluginModule>) => {
  const side = startWorkerSide({ post: (m) => queueMicrotask(() => receive(m)), importModule: async (url) => fixtures.get(url)! });
  const { host, receive } = connectHost((m) => queueMicrotask(() => side.receive(m)), () => 'https://tramme.test/p1/document.tramme.json');
  return host;
};

const dots: PluginModule = {
  meta: { id: 'me/dots', name: 'Dots', version: '1.2.0' },
  nodes: [{ type: 'dots.dot', title: 'Dot', category: 'Dots', props: { radius: { type: 'number', default: 10 } }, render: { canvas2d: () => {} }, bounds: () => null }],
  tools: [{ name: 'dots-count', description: 'counts', run: () => 'mine' }, { name: 'shared', description: 'the installed one', run: () => 'installed' }],
  kits: [{ name: 'pink', description: 'pink', tokens: { accent: { type: 'color', value: '#ff3366' } } as never }],
  presets: [{ name: 'big-dot', layer: { type: 'dots.dot', props: { radius: 100 } } as never }],
  prompts: [{ name: 'dotify', description: 'dots everywhere', prompt: 'add dots' }],
};

const plugin = (over: Partial<Installed> = {}): Installed => ({
  file: 'dots.js', code: 'export const nodes = []', size: 10, modified: '', files: new Map([['fonts/a.woff2', new Uint8Array([1, 2])]]), enabled: true,
  manifest: { id: 'me/dots', name: 'Dots', version: '1.2.0', api: 1, permissions: { network: [], providers: [], files: [] }, kinds: ['nodes'] }, ...over,
});

describe('installed plugins in a project', () => {
  it('bring their tools, workflows, kits, presets and nodes, never a name the project has', async () => {
    const reg = new Registry();
    reg.use({ tools: [{ name: 'shared', description: 'the project one', run: () => 'project' }] }, 'own');
    const keys: string[] = [];
    await attachInstalled(reg, host(new Map([['blob:dots', dots]])), [{ id: 'installed:dots.js', url: 'blob:dots', name: 'Dots' }], { brought: (_id, k) => { keys.push(k); } });
    expect(reg.tool('dots-count').from).toBe('installed:dots.js');
    expect(reg.tool('shared').from).toBe('own');
    expect(reg.hasNode('dots.dot')).toBe(true);
    expect(reg.listKits().map((k) => k.kit.name)).toContain('pink');
    expect(reg.listPresets().map((p) => p.preset.name)).toContain('big-dot');
    expect(reg.listPrompts().map((p) => p.prompt.name)).toContain('dotify');
    expect(keys).toEqual(['node:dots.dot']);
  });

  it('are copied into the project with the change that first draws with them', () => {
    const { doc } = newProject({ name: 'T', width: 100, height: 100, fps: 30, duration: 1 });
    installedTypes.clear();
    installedTypes.set('node:dots.dot', plugin());
    const c = doc.root;
    const add = [{ op: 'add' as const, path: `/compositions/${c}/layers/d`, value: { type: 'dots.dot', props: {} } }];
    const out = copiesFor(doc, add)!;
    expect(out.names).toEqual(['Dots']);
    expect(out.files.map(([p]) => p)).toEqual(['plugins/dots.js', 'plugins/fonts/a.woff2']);
    expect(out.ops.slice(1)).toEqual([
      { op: 'add', path: '/assets/dots', value: { type: 'module', src: 'plugins/dots.js', name: 'Dots' } },
      { op: 'add', path: '/plugins', value: ['dots'] },
      { op: 'add', path: '/meta/installedCopies', value: { 'me/dots': '1.2.0' } },
    ]);
    // once copied, nothing more: the project's copy is the one used
    const copied: TrammeDoc = { ...doc, plugins: ['dots'] };
    expect(copiesFor(copied, add)).toBeNull();
    // a change that draws with nothing installed needs no copy
    expect(copiesFor(doc, [{ op: 'add', path: `/compositions/${c}/layers/r`, value: { type: 'shape.rect', props: {} } }])).toBeNull();
  });

  it('read the types a document draws with, modifiers included, and the plugins a project turned off', () => {
    const { doc } = newProject({ name: 'T', width: 100, height: 100, fps: 30, duration: 1 });
    doc.compositions[doc.root].layers.a = { type: 'text', props: { size: { $v: 10, $mod: [{ type: 'dots.wobble' }] } }, effects: [{ id: 'e', type: 'fx.blur' }] } as never;
    expect([...typesOf(doc)].sort()).toEqual(['effect:fx.blur', 'modifier:dots.wobble', 'node:text']);
    expect(offIn({ ...doc, meta: { ...doc.meta, pluginsOff: ['me/dots', 3] } })).toEqual(['me/dots']);
  });

  it('reach only what they declared, and stop after failing again and again', async () => {
    vi.stubGlobal('location', new URL('https://tramme.test/p/x'));
    const wrote: string[] = [];
    const ctx = { writeFile: async (p: string) => { wrote.push(p); return p; } } as unknown as ToolContext;
    const p = plugin({ manifest: { ...plugin().manifest, permissions: { network: ['https://api.example.com/v1'], providers: ['generate'], files: ['data'] } } });
    const c = permitted(ctx, p);
    await c.writeFile('assets/a.json', '{}');
    await c.writeFile('data/b.json', '{}');
    await expect(c.writeFile('plugins/evil.js', '')).rejects.toThrow(/assets\/ and the paths it declared/);
    await expect(c.writeFile('database.json', '')).rejects.toThrow();
    expect(wrote).toEqual(['assets/a.json', 'data/b.json']);
    await expect(c.fetch!('https://elsewhere.test/x')).rejects.toThrow(/did not declare https:\/\/elsewhere.test/);
    await expect(c.fetch!('/api/claude/messages')).rejects.toThrow(/provider route "claude"/);
    await expect(permitted(ctx, plugin()).fetch!('https://api.example.com/')).rejects.toThrow(/meta.permissions.network/);

    const stops: string[] = [];
    const fail = () => counted(p, () => Promise.reject(new Error('boom')), (x) => stops.push(x.manifest.name));
    for (let i = 0; i < STRIKES - 1; i++) await expect(fail()).rejects.toThrow('boom');
    // a success in between starts the count again
    await counted(p, async () => 1);
    for (let i = 0; i < STRIKES - 1; i++) await expect(fail()).rejects.toThrow('boom');
    expect(stopped.peek().has('me/dots')).toBe(false);
    await expect(fail()).rejects.toThrow('boom');
    expect(stopped.peek().has('me/dots')).toBe(true);
    expect(stops).toEqual(['Dots']);
  });

  it('ask the page for their requests, which answers through the permitted context', async () => {
    const mod: PluginModule = { tools: [{ name: 'weather', description: 'reads the weather', async run(_i, ctx) { const r = await ctx.fetch!('https://api.example.com/today'); return `${r.status} ${await r.text()}`; } }] };
    const reg = new Registry(), asked: string[] = [];
    await attachInstalled(reg, host(new Map([['blob:w', mod]])), [{ id: 'installed:w.js', url: 'blob:w', name: 'W' }], {
      context: (_id, ctx) => ({ ...ctx, fetch: async (url) => { asked.push(url); return new Response('sunny', { status: 200 }); } }),
    });
    const { doc } = newProject({ name: 'T', width: 100, height: 100, fps: 30, duration: 1 });
    const ctx = { doc, compId: doc.root, time: 0, selection: [], registry: reg, signal: new AbortController().signal } as unknown as ToolContext;
    expect(await reg.tool('weather').tool.run({}, ctx)).toEqual({ text: '200 sunny' });
    expect(asked).toEqual(['https://api.example.com/today']);
  });
});
