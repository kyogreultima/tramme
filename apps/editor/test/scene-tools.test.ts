import { describe, expect, it } from 'vitest';
import type { ToolContext, ToolOutput } from '@tramme/core';
import { isSceneTextPath, SCENE_TOOLS } from '../src/scene-tools.ts';

const [write, edit, check] = SCENE_TOOLS;
const MANIFEST = JSON.stringify({ duration: 3, size: [1920, 1080], entry: 'index.html', parameters: {} });

function project(files: Record<string, string> = {}) {
  const store = new Map(Object.entries(files)), writes: string[] = [];
  const ctx = {
    readText: async (path: string) => store.get(path) ?? null,
    writeFile: async (path: string, data: string) => { store.set(path, data); writes.push(path); return path; },
  } as unknown as ToolContext;
  const run = (tool: typeof write, input: unknown) => tool.run(input as never, ctx) as Promise<ToolOutput>;
  return { store, writes, run };
}

describe('the assistant\'s web scene tools', () => {
  it('writes a scene whole and checks it', async () => {
    const p = project();
    await p.run(write, { id: 'title', files: [{ path: 'scene.json', content: MANIFEST }, { path: 'index.html', content: '<h1>Hello</h1>' }] });
    expect(p.writes).toEqual(['scenes/title/scene.json', 'scenes/title/index.html']);
    expect((await p.run(check, { id: 'title' })).text).toContain('well formed');
  });

  it('writes nothing when the manifest is wrong or its entry is missing', async () => {
    const p = project();
    await expect(p.run(write, { id: 'title', files: [{ path: 'scene.json', content: '{"duration":-1}' }] })).rejects.toThrow(/nothing written/);
    await expect(p.run(write, { id: 'title', files: [{ path: 'scene.json', content: MANIFEST }] })).rejects.toThrow(/entry "index.html" is missing/);
    expect(p.writes).toEqual([]);
  });

  it('"fix the title of scene 3" changes that scene\'s one file and nothing else', async () => {
    const files: Record<string, string> = {};
    for (const id of ['scene-1', 'scene-2', 'scene-3']) { files[`scenes/${id}/scene.json`] = MANIFEST; files[`scenes/${id}/index.html`] = `<h1>Title of ${id}</h1>`; files[`scenes/${id}/style.css`] = 'h1{color:red}'; }
    const p = project(files), before = new Map(p.store);
    await p.run(edit, { id: 'scene-3', file: 'index.html', find: 'Title of scene-3', replace: 'A better title' });
    expect(p.writes).toEqual(['scenes/scene-3/index.html']);
    for (const [path, body] of before) if (path !== 'scenes/scene-3/index.html') expect(p.store.get(path)).toBe(body);
    expect(p.store.get('scenes/scene-3/index.html')).toBe('<h1>A better title</h1>');
  });

  it('refuses an ambiguous or missing text, and a manifest edit that breaks the scene', async () => {
    const p = project({ 'scenes/a/scene.json': MANIFEST, 'scenes/a/index.html': '<i>x</i><i>x</i>' });
    await expect(p.run(edit, { id: 'a', file: 'index.html', find: 'x', replace: 'y' })).rejects.toThrow(/occurs 2 times/);
    await expect(p.run(edit, { id: 'a', file: 'index.html', find: 'z', replace: 'y' })).rejects.toThrow(/occurs 0 times/);
    await expect(p.run(edit, { id: 'a', file: 'missing.html', find: 'z', replace: 'y' })).rejects.toThrow(/not found/);
    await expect(p.run(edit, { id: 'a', file: 'scene.json', find: '"duration":3', replace: '"duration":-3' })).rejects.toThrow(/not changed/);
    expect(p.writes).toEqual([]);
  });

  it('keeps every write inside the scene folder and to text files', async () => {
    const p = project();
    for (const [id, path] of [['../x', 'a.html'], ['a', '../b/index.html'], ['a', '/etc/x.html'], ['a', 'a\b.html'], ['a', 'logo.png'], ['a', 'a%2e.html'], ['A', 'a.html'], ['a', 'x//y.html']])
      await expect(p.run(write, { id, files: [{ path, content: 'x' }] })).rejects.toThrow();
    expect(p.writes).toEqual([]);
  });

  it('is the only extra place the tool context reaches besides assets and plugins', () => {
    expect(isSceneTextPath('scenes/title/index.html')).toBe(true);
    for (const path of ['scenes/title/logo.png', 'scenes/Title/index.html', 'scenes/index.html', 'plugins/x.js', 'document.tramme.json', 'scenes/a/../../document.tramme.json']) expect(isSceneTextPath(path)).toBe(false);
  });
});
