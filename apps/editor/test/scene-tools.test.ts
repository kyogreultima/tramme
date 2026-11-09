import { describe, expect, it } from 'vitest';
import { applyOps, validate, type ToolContext, type ToolOutput, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import { isSceneTextPath, SCENE_TOOLS } from '../src/scene-tools.ts';

const [write, edit, check] = SCENE_TOOLS;
const MANIFEST = JSON.stringify({ duration: 3, size: [1920, 1080], entry: 'index.html', parameters: {} });

function project(files: Record<string, string> = {}, doc: TrammeDoc = newProject({ name: 'S', width: 320, height: 180, fps: 10, duration: 2 }).doc) {
  const store = new Map(Object.entries(files)), writes: string[] = [];
  const ctx = {
    doc,
    readText: async (path: string) => store.get(path) ?? null,
    folderFiles: async (folder: string) => [...store.keys()].filter((k) => k.startsWith(folder + '/')).map((path) => ({ path, size: 1 })),
    writeFile: async (path: string, data: string) => { store.set(path, data); writes.push(path); return path; },
  } as unknown as ToolContext;
  const run = (tool: typeof write, input: unknown) => tool.run(input as never, ctx) as Promise<ToolOutput>;
  return { store, writes, run, doc };
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

  it('brings the layers showing a scene up to date with its parameters, and drops values the scene no longer declares', async () => {
    const doc = newProject({ name: 'S', width: 320, height: 180, fps: 10, duration: 2 }).doc;
    doc.compositions.main.layers.scene = { type: 'webscene', name: 's', transform: { position: [160, 90] }, props: { folder: 'scenes/title', frames: [], fps: 10, size: [320, 180] }, params: { size: 3, gone: 1 } } as never;
    doc.compositions.main.layers.other = { type: 'webscene', name: 'o', transform: { position: [0, 0] }, props: { folder: 'scenes/other', frames: [], fps: 10, size: [320, 180] } } as never;
    doc.compositions.main.order = ['scene', 'other'];
    const manifest = JSON.stringify({ duration: 3, size: [1920, 1080], entry: 'index.html', parameters: { size: { type: 'number', default: 10 } } });
    const p = project({}, doc);
    const out = await p.run(write, { id: 'title', files: [{ path: 'scene.json', content: manifest }, { path: 'index.html', content: '<p>x</p>' }] });
    const { doc: next } = applyOps(doc, out.ops!);
    const layer = next.compositions.main.layers.scene as unknown as { props: Record<string, unknown>; params: Record<string, unknown> };
    expect(layer.props.parameters).toEqual({ size: { type: 'number', default: 10 } });
    expect(layer.params).toEqual({ size: 3 });
    expect((next.compositions.main.layers.other as unknown as { props: Record<string, unknown> }).props.parameters).toBeUndefined();
    expect(validate(next, builtinRegistry())).toEqual([]);
    const again = project(Object.fromEntries(p.store), next);
    expect((await again.run(check, { id: 'title' })).ops).toEqual([]);
  });
  it('runs the seek lint on the scene\'s page and the local scripts it names', async () => {
    const p = project();
    const manifest = JSON.stringify({ duration: 1, size: [320, 180], entry: 'index.html', parameters: {} });
    const out = await p.run(write, { id: 'bad', files: [
      { path: 'scene.json', content: manifest },
      { path: 'index.html', content: '<script src="lib/anim.js"></script><script>const n = Math.random();</script>' },
      { path: 'lib/anim.js', content: 'const t = Date.now();' },
    ] });
    expect(out.text).toContain('seek lint found problems');
    expect(out.text).toMatch(/scenes\/bad\/index\.html:1: .*Math\.random/);
    expect(out.text).toMatch(/scenes\/bad\/lib\/anim\.js:1: .*Date\.now/);
    const checked = await p.run(check, { id: 'bad' });
    expect(checked.text).toContain('has problems');
    expect(checked.text).toContain('Date.now');
    await p.run(edit, { id: 'bad', file: 'lib/anim.js', find: 'Date.now()', replace: '0' });
    const fixed = await p.run(edit, { id: 'bad', file: 'index.html', find: 'Math.random()', replace: '1' });
    expect(fixed.text).not.toContain('seek lint');
    expect((await p.run(check, { id: 'bad' })).text).toContain('well formed');
  });
  describe('as a take', () => {
    const manifest = JSON.stringify({ duration: 3, size: [1920, 1080], entry: 'index.html', parameters: {} });
    function shown() {
      const doc = newProject({ name: 'S', width: 320, height: 180, fps: 10, duration: 2 }).doc;
      doc.compositions.main.layers.scene = { type: 'webscene', name: 's', transform: { position: [160, 90] }, props: { folder: 'scenes/title', frames: [], fps: 10, size: [320, 180] } } as never;
      doc.compositions.main.order = ['scene'];
      return doc;
    }
    const files = { 'scenes/title/scene.json': manifest, 'scenes/title/index.html': '<h1>Old</h1>', 'scenes/title/style.css': 'h1{}' };
    const folderOf = (d: TrammeDoc) => (d.compositions.main.layers.scene.props as { folder: string }).folder;

    it('changes a scene that a layer shows in a new folder, and the layer is pointed at it', async () => {
      const doc = shown(), p = project(files, doc);
      const out = await p.run(edit, { id: 'title', file: 'index.html', find: 'Old', replace: 'New' });
      expect(p.store.get('scenes/title/index.html')).toBe('<h1>Old</h1>');
      expect(p.store.get('scenes/title-v2/index.html')).toBe('<h1>New</h1>');
      expect(p.store.get('scenes/title-v2/style.css')).toBe('h1{}');
      expect(p.store.get('scenes/title-v2/scene.json')).toBe(manifest);
      expect(out.text).toContain('Made as a take');
      expect(out.label).toBe('Scene title-v2');
      const { doc: after } = applyOps(doc, out.ops!);
      expect(folderOf(after)).toBe('scenes/title-v2');
      expect(validate(after, builtinRegistry())).toEqual([]);
      // the next change is a take of the take, not of the original
      const again = project(Object.fromEntries(p.store), after);
      await again.run(edit, { id: 'title-v2', file: 'index.html', find: 'New', replace: 'Newer' });
      expect(again.store.get('scenes/title-v3/index.html')).toBe('<h1>Newer</h1>');
      expect(again.store.get('scenes/title-v2/index.html')).toBe('<h1>New</h1>');
    });

    it('writes a whole scene as a take as well, keeping the files it does not name', async () => {
      const doc = shown(), p = project(files, doc);
      const out = await p.run(write, { id: 'title', files: [{ path: 'index.html', content: '<h1>Rewritten</h1>' }] });
      expect(p.store.get('scenes/title-v2/index.html')).toBe('<h1>Rewritten</h1>');
      expect(p.store.get('scenes/title-v2/style.css')).toBe('h1{}');
      expect(p.store.get('scenes/title/index.html')).toBe('<h1>Old</h1>');
      expect(folderOf(applyOps(doc, out.ops!).doc)).toBe('scenes/title-v2');
    });

    it('changes in place when asked, when nobody shows the scene, or when its folder holds more than text', async () => {
      const inPlace = project(files, shown());
      await inPlace.run(edit, { id: 'title', file: 'index.html', find: 'Old', replace: 'New', take: false });
      expect(inPlace.store.get('scenes/title/index.html')).toBe('<h1>New</h1>');
      expect([...inPlace.store.keys()].some((k) => k.startsWith('scenes/title-v'))).toBe(false);
      const unseen = project(files);
      await unseen.run(edit, { id: 'title', file: 'index.html', find: 'Old', replace: 'New' });
      expect(unseen.store.get('scenes/title/index.html')).toBe('<h1>New</h1>');
      const binary = project({ ...files, 'scenes/title/logo.png': 'png' }, shown());
      const out = await binary.run(edit, { id: 'title', file: 'index.html', find: 'Old', replace: 'New' });
      expect(binary.store.get('scenes/title/index.html')).toBe('<h1>New</h1>');
      expect(out.text).not.toContain('take');
    });
  });
});
