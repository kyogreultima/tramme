import { afterEach, describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';
import { AssetStore, viewBoxSize, withSize } from '../src/assets.ts';
import { VideoFrames, assertVideoDimensions } from '../src/video.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
  it('never imports any module asset into the trusted page', async () => {
    const doc = newProject({ name: 'Module asset', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    doc.assets.unused = { type: 'module', src: 'plugins/unused.js' };
    const loaded = new AssetStore(doc, 'https://example.test/projects/a/document.tramme.json');
    loaded.sandboxModules = true;
    vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } });
    await loaded.sync(doc);
    expect(loaded.has('unused')).toBe(false);
  });

  it('bounds video dimensions before decoder creation and disposes an unloaded video', async () => {
    expect(() => assertVideoDimensions(1920, 1080, 16 * 1024 * 1024)).not.toThrow();
    expect(() => assertVideoDimensions(9000, 100, 16 * 1024 * 1024)).toThrow('video exceeds 8192');
    expect(() => assertVideoDimensions(5000, 5000, 16 * 1024 * 1024)).toThrow('16 million pixels');
    const doc = newProject({ name: 'Video', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    doc.assets.clip = { type: 'video', src: 'assets/clip.mp4' };
    const loaded = new AssetStore(doc, 'https://example.test/projects/a/document.tramme.json');
    loaded.sandboxModules = true;
    const dispose = vi.fn();
    const open = vi.spyOn(VideoFrames, 'open').mockResolvedValue({ dispose } as unknown as VideoFrames);
    vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } });
    await loaded.sync(doc);
    expect(open).toHaveBeenCalledWith('https://example.test/projects/a/assets/clip.mp4', { cache: false, maxPixels: 16 * 1024 * 1024 });
    const removed = structuredClone(doc);
    delete removed.assets.clip;
    await loaded.sync(removed);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('refuses an excessive asset inventory before loading any file', async () => {
    const doc = newProject({ name: 'Asset flood', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    for (let i = 0; i < 4097; i++) doc.assets[`asset-${i}`] = { type: 'json', src: `assets/${i}.json` };
    const loaded = new AssetStore(doc, 'https://example.test/projects/a/document.tramme.json');
    loaded.sandboxModules = true;
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(loaded.sync(doc)).rejects.toThrow('exceeds 4096 assets');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['font', 'font', 16, 'font exceeds 16 MB'],
    ['json', 'json', 8, 'JSON exceeds 8 MB'],
    ['lut', 'cube', 8, 'LUT exceeds 8 MB'],
  ] as const)('cancels an oversized %s before decoding it', async (type, ext, megabytes, message) => {
    const doc = newProject({ name: 'Oversized asset', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    doc.assets.data = { type, src: `assets/huge.${ext}` };
    const loaded = new AssetStore(doc, 'https://example.test/projects/a/document.tramme.json');
    loaded.sandboxModules = true;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array((megabytes + 1) * 1024 * 1024)); },
      cancel() { cancelled = true; },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)));
    await expect((loaded as unknown as { load(id: string, a: typeof doc.assets.data): Promise<unknown> }).load('data', doc.assets.data)).rejects.toThrow(message);
    expect(cancelled).toBe(true);
  });

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

  it('bounds concurrent asset loads to eight', async () => {
    const doc = newProject({ name: 'Many assets', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    for (let i = 0; i < 20; i++) doc.assets[`data-${i}`] = { type: 'json', src: `assets/${i}.json` };
    const loaded = new AssetStore(doc, 'https://example.test/projects/a/document.tramme.json');
    loaded.sandboxModules = true;
    let active = 0, maximum = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }));
    vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } });
    await loaded.sync(doc);
    expect(maximum).toBe(8);
  });

  it('refuses an oversized image before creating its bitmap', async () => {
    const doc = newProject({ name: 'Large image', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    doc.assets.image = { type: 'image', src: 'assets/huge.png' };
    const loaded = new AssetStore(doc, 'https://example.test/projects/a/document.tramme.json');
    loaded.sandboxModules = true;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })));
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 6000; naturalHeight = 6000; async decode() {} });
    const bitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', bitmap);
    await expect((loaded as unknown as { load(id: string, a: typeof doc.assets.image): Promise<unknown> }).load('image', doc.assets.image)).rejects.toThrow('16 million pixels');
    expect(bitmap).not.toHaveBeenCalled();
  });

  it('cancels an oversized image response before creating a decoder', async () => {
    const doc = newProject({ name: 'Large image file', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    doc.assets.image = { type: 'image', src: 'assets/huge.png' };
    const loaded = new AssetStore(doc, 'https://example.test/projects/a/document.tramme.json');
    loaded.sandboxModules = true;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(33 * 1024 * 1024)); },
      cancel() { cancelled = true; },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)));
    const decoder = vi.fn();
    vi.stubGlobal('Image', decoder);
    await expect((loaded as unknown as { load(id: string, a: typeof doc.assets.image): Promise<unknown> }).load('image', doc.assets.image)).rejects.toThrow('image exceeds 32 MB');
    expect(cancelled).toBe(true);
    expect(decoder).not.toHaveBeenCalled();
  });

  it('caps retained decoded images across one isolated project', async () => {
    const doc = newProject({ name: 'Many images', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    for (let i = 0; i < 5; i++) doc.assets[`image-${i}`] = { type: 'image', src: `assets/${i}.png` };
    const loaded = new AssetStore(doc, 'https://example.test/projects/a/document.tramme.json');
    loaded.sandboxModules = true;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })));
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 4000; naturalHeight = 4000; async decode() {} });
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 4000, close })));
    vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } });
    await expect(loaded.sync(doc)).rejects.toThrow('images exceed 256 MB');
    expect(close).toHaveBeenCalledTimes(1);
    expect([...Array(4)].every((_, i) => loaded.has(`image-${i}`))).toBe(true);
  });

  it('releases decoded images when an asset changes or leaves the project', async () => {
    const doc = newProject({ name: 'Replace image', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    doc.assets.image = { type: 'image', src: 'assets/first.png' };
    const loaded = new AssetStore(doc, 'https://example.test/projects/a/document.tramme.json');
    loaded.sandboxModules = true;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })));
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 1; naturalHeight = 1; async decode() {} });
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close })));
    vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } });
    await loaded.sync(doc);
    const changed = structuredClone(doc);
    changed.assets.image = { type: 'image', src: 'assets/second.png' };
    await loaded.sync(changed);
    expect(close).toHaveBeenCalledTimes(1);
    const removed = structuredClone(changed);
    delete removed.assets.image;
    await loaded.sync(removed);
    expect(close).toHaveBeenCalledTimes(2);
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
