import { afterEach, describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';
import { AssetStore, viewBoxSize, withSize } from '../src/assets.ts';

afterEach(() => vi.unstubAllGlobals());

describe('model bytes for an isolated project', () => {
  const asset = (src: string) => ({ type: 'model' as const, src });
  const store = (src: string) => {
    const doc = newProject({ name: 'Model', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    doc.assets.mesh = asset(src);
    const loaded = new AssetStore(doc, 'https://example.test/projects/a/document.tramme.json');
    loaded.sandboxModules = true;
    return loaded;
  };
  const load = (s: AssetStore, src: string) => (s as unknown as { load(id: string, a: ReturnType<typeof asset>): Promise<unknown> }).load('mesh', asset(src));

  it('reads a project model as bytes and refuses a private URL before fetch', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetcher);
    await expect(load(store('../../private/keys.glb'), '../../private/keys.glb')).rejects.toThrow('asset must belong to this project');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(load(store('assets/mesh.glb'), 'assets/mesh.glb')).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('cancels an oversized streamed model', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(33 * 1024 * 1024)); },
      cancel() { cancelled = true; },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)));
    await expect(load(store('assets/huge.glb'), 'assets/huge.glb')).rejects.toThrow('model exceeds 32 MB');
    expect(cancelled).toBe(true);
  });
});

describe('isolated asset paths', () => {
  it('refuses a JSON asset outside the project before requesting it', async () => {
    const doc = newProject({ name: 'JSON', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    doc.assets.data = { type: 'json', src: '/api/private' };
    const loaded = new AssetStore(doc, 'https://example.test/projects/a/document.tramme.json');
    loaded.sandboxModules = true;
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect((loaded as unknown as { load(id: string, a: typeof doc.assets.data): Promise<unknown> }).load('data', doc.assets.data)).rejects.toThrow('asset must belong to this project');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('an SVG without a size of its own', () => {
  it('takes the proportions of its viewBox', () => {
    expect(viewBoxSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect/></svg>')).toEqual([24, 24]);
    expect(viewBoxSize('<?xml version="1.0"?>\n<svg width="100%" viewBox="-10 -5, 320,80">')).toEqual([320, 80]);
    expect(viewBoxSize("<svg viewBox='0 0 1.5e2 50'>")).toEqual([150, 50]);
  });

  it('is square when it says nothing of them', () => {
    expect(viewBoxSize('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')).toEqual([1, 1]);
    expect(viewBoxSize('<svg viewBox="0 0 0 10">')).toEqual([1, 1]);
  });

  it('is given a size of its own, in place of the one it had', () => {
    expect(withSize('<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 48 24"><rect width="24" height="24"/></svg>', 2048, 1024))
      .toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24" width="2048" height="1024"><rect width="24" height="24"/></svg>');
  });
});
