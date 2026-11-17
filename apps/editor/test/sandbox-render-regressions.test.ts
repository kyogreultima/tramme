import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';
import type { PluginModule } from '@tramme/core';
import { blitSandboxFrame, ensureSandboxDoc, moduleItemsOf, renderSandboxFrame, resetSandbox } from '../src/plugins/sandbox-draw.ts';
import { videoKey } from '../src/plugins/protocol.ts';
import type { Renderer } from '@tramme/render';
import { makeSandboxDraw } from '../src/plugins/worker-draw.ts';
import type { PluginHost } from '../src/plugins/host.ts';

// Exercise the real evaluator and Canvas2D nodes; only the GPU and browser
// surfaces are replaced so their draw calls can be inspected in Node.
const gpu = vi.hoisted(() => ({ contexts: 0, samples: 0 }));
vi.mock('@tramme/render/src/compositor.ts', () => ({
  Compositor: class {
    constructor() { gpu.contexts++; }
    begin() {} add() { gpu.samples++; } finish() {} resize() {}
  },
}));

const draws: unknown[][] = [];
const paint: { canvas: Surface; op: string; args: number[] }[] = [];
class Surface {
  width: number;
  height: number;
  constructor(width: number, height: number) { this.width = width; this.height = height; }
  getContext() {
    return {
      canvas: this, globalAlpha: 1,
      setTransform: (...args: number[]) => paint.push({ canvas: this, op: 'transform', args }),
      clearRect: (...args: number[]) => paint.push({ canvas: this, op: 'clear', args }),
      save() {}, restore() {}, transform() {},
      translate() {}, beginPath() {}, rect() {}, clip() {},
      fillRect: (...args: number[]) => paint.push({ canvas: this, op: 'fill', args }),
      drawImage: (...args: unknown[]) => draws.push(args),
    };
  }
}

beforeEach(() => {
  resetSandbox();
  draws.length = 0;
  paint.length = 0;
  gpu.contexts = 0;
  gpu.samples = 0;
  vi.stubGlobal('self', { fonts: { add() {} } });
  vi.stubGlobal('OffscreenCanvas', Surface);
  vi.stubGlobal('DOMMatrix', class {
    a: number; b: number; c: number; d: number; e: number; f: number;
    constructor(m: number[]) { [this.a, this.b, this.c, this.d, this.e, this.f] = m; }
  });
  vi.stubGlobal('createImageBitmap', async (source: unknown) => ({ source }));
});
afterEach(() => vi.unstubAllGlobals());

const project = () => newProject({ name: 'Video regression', width: 1920, height: 1080, fps: 24, duration: 30 }).doc;

describe('sandbox document assets', () => {
  it('loads Free code modules alongside plugin modules for isolated rendering', () => {
    const doc = project();
    doc.assets.code = { type: 'module', src: 'code/draw.js' };
    doc.assets.plugin = { type: 'module', src: 'plugins/effect.js' };
    doc.assets.reference = { type: 'image', src: 'assets/reference.png' };
    doc.plugins = ['plugin'];
    expect(moduleItemsOf(doc, 'https://tramme.test/project/document.tramme.json')).toEqual([
      { id: 'code', url: 'https://tramme.test/project/code/draw.js' },
      { id: 'plugin', url: 'https://tramme.test/project/plugins/effect.js' },
    ]);
  });

  it('copies loaded model bytes into the worker and refreshes them after an edit', async () => {
    const doc = project();
    doc.assets.mesh = { type: 'model', src: 'assets/mesh.glb' };
    const received: ArrayBuffer[] = [];
    const mod: PluginModule = { nodes: [{
      type: 'test.model-bytes', title: 'Model bytes', category: 'Test', props: {},
      render: { canvas2d: (_ctx, _props, host) => { received.push(host.asset<ArrayBuffer>('mesh')); } },
    }] };
    const side = makeSandboxDraw(new Map([['model-bytes', mod]]));
    const host = { setDoc: (d) => side.setDoc(d) } as PluginHost;
    const first = new Uint8Array([1, 2]).buffer;
    ensureSandboxDoc(host, { doc, docUrl: 'https://tramme.test/doc.json', loaded: () => first });
    const payload = { frame: 0, comp: { width: 1920, height: 1080, fps: 24, duration: 30 }, layers: [], items: [{ id: 'mesh', type: 'test.model-bytes', props: {}, t: 0, frame: 0 }] };
    expect((await side.draw(payload)).results[0]).toMatchObject({ ok: true });
    expect(received.at(-1)).toBe(first);
    const second = new Uint8Array([3, 4]).buffer;
    ensureSandboxDoc(host, { doc, docUrl: 'https://tramme.test/doc.json', loaded: () => second });
    expect((await side.draw(payload)).results[0]).toMatchObject({ ok: true });
    expect(received.at(-1)).toBe(second);
  });

  const picture = { width: 200, height: 100 };
  const pictureNode: PluginModule = { nodes: [{
    type: 'test.picture', title: 'Picture', category: 'Test', props: {},
    render: { canvas2d: (ctx, _props, host) => ctx.drawImage(host.asset('reference'), 0, 0) },
  }] };

  const drawPicture = async (side: ReturnType<typeof makeSandboxDraw>) => {
    const result = await side.draw({ frame: 0, comp: { width: 1920, height: 1080, fps: 24, duration: 30 }, layers: [], items: [{ id: 'picture', type: 'test.picture', props: {}, t: 0, frame: 0 }] });
    expect(result.results[0]).toMatchObject({ ok: true });
    expect(draws.at(-1)?.[0]).toBe(picture);
  };
  const setup = () => {
    const doc = project();
    doc.assets.reference = { type: 'image', src: 'assets/reference.png' };
    const side = makeSandboxDraw(new Map([['pictures', pictureNode]]));
    const host = { setDoc: (d) => side.setDoc(d) } as PluginHost;
    return { doc, side, host };
  };

  it('keeps an unchanged image available after a document edit', async () => {
    const { doc, side, host } = setup();
    ensureSandboxDoc(host, { doc, docUrl: 'https://tramme.test/doc.json', loaded: () => picture });
    ensureSandboxDoc(host, { doc: { ...doc, meta: { ...doc.meta, title: 'Edited' } }, docUrl: 'https://tramme.test/doc.json', loaded: () => picture });
    await drawPicture(side);
  });

  it('retries assets that finish loading without a document edit', async () => {
    const { doc, side, host } = setup();
    ensureSandboxDoc(host, { doc, docUrl: 'https://tramme.test/doc.json', loaded: () => null });
    ensureSandboxDoc(host, { doc, docUrl: 'https://tramme.test/doc.json', loaded: () => picture });
    await drawPicture(side);
  });

  it('ships shared assets again after a project reset', async () => {
    const { doc, side, host } = setup();
    ensureSandboxDoc(host, { doc, docUrl: 'https://tramme.test/doc.json', loaded: () => picture });
    resetSandbox();
    ensureSandboxDoc(host, { doc, docUrl: 'https://tramme.test/doc.json', loaded: () => picture });
    await drawPicture(side);
  });

  it('initializes a new host even when it receives the same document', async () => {
    const { doc, host } = setup();
    ensureSandboxDoc(host, { doc, docUrl: 'https://tramme.test/doc.json', loaded: () => picture });
    const side = makeSandboxDraw(new Map([['pictures', pictureNode]]));
    ensureSandboxDoc({ setDoc: (d) => side.setDoc(d) } as PluginHost, { doc, docUrl: 'https://tramme.test/doc.json', loaded: () => picture });
    await drawPicture(side);
  });
});

describe('sandbox web scenes', () => {
  it('a web scene not captured yet leaves its place empty instead of failing the frame', async () => {
    const doc = project();
    const main = doc.compositions[doc.root];
    main.layers.scene = { type: 'webscene', props: {} };
    main.layers.hero = { type: 'test.paint', props: { size: 80 } };
    main.order = ['scene', 'hero'];
    const mod: PluginModule = { nodes: [{ type: 'test.paint', title: 'Paint', category: 'Test', props: { size: { type: 'number', default: 80 } }, render: { canvas2d: (ctx, p) => ctx.fillRect(10, 10, p.size, p.size) } }] };
    const side = makeSandboxDraw(new Map([['paint', mod]]));
    side.setDoc({ doc, docUrl: 'https://tramme.test/doc.json', images: {}, json: {}, fonts: [] });
    const result = await side.renderFrame({ compId: doc.root, t: 0, scale: 0.5, width: 1920, height: 1080 });
    expect(result.err).toBeUndefined();
    expect(paint.some((p) => p.op === 'fill' && p.args[2] === 80)).toBe(true);
  });
});

describe('sandbox video rendering', () => {
  it('draws a transparent nested composition over the existing picture without clearing or resetting its transform', async () => {
    const doc = project();
    const main = doc.compositions[doc.root];
    main.motionBlur = { samples: 1, shutter: 0.5 };
    main.layers.hero = { type: 'test.paint', props: { size: 80 } };
    main.layers.hud = { type: 'comp', props: { comp: 'hud' }, transform: { position: [500, 300] } };
    main.order = ['hero', 'hud'];
    doc.compositions.hud = { name: 'Transparent HUD', width: 320, height: 180, fps: 24, duration: 30, background: null, layers: { label: { type: 'test.paint', props: { size: 20 } } }, order: ['label'] };
    const mod: PluginModule = { nodes: [{ type: 'test.paint', title: 'Paint', category: 'Test', props: { size: { type: 'number', default: 80 } }, render: { canvas2d: (ctx, p) => ctx.fillRect(10, 10, p.size, p.size) } }] };
    const side = makeSandboxDraw(new Map([['paint', mod]]));
    side.setDoc({ doc, docUrl: 'https://tramme.test/doc.json', images: {}, json: {}, fonts: [] });
    const result = await side.renderFrame({ compId: doc.root, t: 1, scale: 0.5, width: 1920, height: 1080 });
    expect(result.err).toBeUndefined();
    const hero = paint.findIndex((p) => p.op === 'fill' && p.args[2] === 80);
    const label = paint.findIndex((p) => p.op === 'fill' && p.args[2] === 20);
    expect(hero).toBeGreaterThanOrEqual(0);
    expect(label).toBeGreaterThan(hero);
    expect(paint.slice(hero + 1, label).filter((p) => p.canvas === paint[hero].canvas && (p.op === 'clear' || p.op === 'transform'))).toEqual([]);
  });

  /** the page's side over the worker's: renderFrame answered by makeSandboxDraw, video frames decoded by a stand-in renderer that records them */
  const videoRig = (doc: ReturnType<typeof project>, mod?: PluginModule) => {
    const side = makeSandboxDraw(new Map(mod ? [['plugin', mod]] : []));
    side.setDoc({ doc, docUrl: 'https://tramme.test/doc.json', images: {}, json: {}, fonts: [] });
    const calls: number[] = [], decoded: [string, number][] = [];
    const host = { renderFrame: async (p: Parameters<typeof side.renderFrame>[0]) => { calls.push(p.t); const { transfer: _, ...answer } = await side.renderFrame(p); return answer; } } as unknown as PluginHost;
    const renderer = { assets: { get: (id: string) => ({ request: async (t: number) => { decoded.push([id, +t.toFixed(4)]); }, frameAt: () => ({ image: { width: 960, height: 540 } }) }) } } as unknown as Renderer;
    return { host, renderer, calls, decoded };
  };
  const frameOf = (doc: ReturnType<typeof project>, t: number) => ({ compId: doc.root, t, scale: 0.25, width: 1920, height: 1080 });

  it('decodes only the video frames a frame draws, at the layer\'s own time in the file', async () => {
    const doc = project();
    doc.compositions[doc.root].motionBlur = { samples: 1, shutter: 0 };
    doc.assets.footage = { type: 'video', src: 'assets/footage.mp4' };
    doc.assets.unused = { type: 'video', src: 'assets/unused.mp4' };
    doc.compositions[doc.root].layers.video = { type: 'video', in: 1, props: { video: 'footage', start: 0.5 } };
    doc.compositions[doc.root].order = ['video'];
    const { host, renderer, decoded } = videoRig(doc);
    const answer = await renderSandboxFrame(host, renderer, frameOf(doc, 2));
    expect(answer.err).toBeUndefined();
    expect(answer.bitmap).toBeTruthy();
    // the layer starts at 1 s and plays the file from 0.5 s: at 2 s it shows the file's 1.5 s, and the unused video is never decoded
    expect(decoded).toEqual([['footage', 1.5]]);
  });

  it('decodes the next frame\'s video ahead, so a played film asks the sandbox once a frame', async () => {
    const doc = project();
    doc.compositions[doc.root].motionBlur = { samples: 1, shutter: 0 };
    doc.assets.footage = { type: 'video', src: 'assets/footage.mp4' };
    doc.compositions[doc.root].layers.video = { type: 'video', props: { video: 'footage', rate: 2 } };
    doc.compositions[doc.root].order = ['video'];
    const { host, renderer, calls } = videoRig(doc);
    for (let f = 0; f < 6; f++) expect((await renderSandboxFrame(host, renderer, frameOf(doc, f / 24))).err).toBeUndefined();
    // the first two frames learn the pace (twice the composition's: rate 2), each one after is asked once
    expect(calls.length).toBe(2 + 2 + 4);
  });

  it('gives a plugin node that computes an asset id the video frame it asks for', async () => {
    const doc = project();
    doc.assets.clip = { type: 'video', src: 'clip.mp4' };
    doc.compositions[doc.root].layers.custom = { type: 'test.lookup', props: {} };
    doc.compositions[doc.root].order = ['custom'];
    const seen: unknown[] = [];
    const mod: PluginModule = { nodes: [{ type: 'test.lookup', title: 'Lookup', category: 'Test', props: {}, render: { canvas2d: (_ctx, _p, h) => { seen.push(h.asset<{ frameAt(t: number): { image: unknown } }>(['cl', 'ip'].join('')).frameAt(0.25).image); } } }] };
    const { host, renderer, decoded } = videoRig(doc, mod);
    expect((await renderSandboxFrame(host, renderer, frameOf(doc, 1))).err).toBeUndefined();
    expect(decoded).toEqual([['clip', 0.25]]);
    expect(seen.at(-1)).toBeTruthy();
  });

  it('draws a frame whose video cannot be decoded without it, rather than failing', async () => {
    const doc = project();
    doc.assets.footage = { type: 'video', src: 'assets/footage.mp4' };
    doc.compositions[doc.root].layers.video = { type: 'video', props: { video: 'footage' } };
    doc.compositions[doc.root].order = ['video'];
    const { host } = videoRig(doc);
    const broken = { assets: { get: () => null } } as unknown as Renderer;
    const answer = await renderSandboxFrame(host, broken, frameOf(doc, 1));
    expect(answer.err).toBeUndefined();
    expect(answer.bitmap).toBeTruthy();
  });

  it('uses one subframe for playback even when the document requests motion blur', async () => {
    const doc = project();
    doc.compositions[doc.root].motionBlur = { samples: 8, shutter: 0.5 };
    const side = makeSandboxDraw(new Map());
    side.setDoc({ doc, docUrl: 'https://tramme.test/doc.json', images: {}, json: {}, fonts: [] });
    const result = await side.renderFrame({ compId: doc.root, t: 1, scale: 0.25, width: 1920, height: 1080, samples: 1 } as Parameters<typeof side.renderFrame>[0]);
    expect(result.err).toBeUndefined();
    expect(gpu.samples).toBe(1);
  });

  it('keeps a film without motion blur sharp when the preview asks for a few samples', async () => {
    const doc = project();
    doc.compositions[doc.root].motionBlur = { samples: 1, shutter: 0.5 };
    const side = makeSandboxDraw(new Map());
    side.setDoc({ doc, docUrl: 'https://tramme.test/doc.json', images: {}, json: {}, fonts: [] });
    // the "limited" blur preference asks for 4: the composition's 1 wins
    const result = await side.renderFrame({ compId: doc.root, t: 1, scale: 0.25, width: 1920, height: 1080, samples: 4 });
    expect(result.err).toBeUndefined();
    expect(gpu.samples).toBe(1);
  });

  it('releases decoded frames after the worker has used them', async () => {
    const doc = project();
    const side = makeSandboxDraw(new Map());
    side.setDoc({ doc, docUrl: 'https://tramme.test/doc.json', images: {}, json: {}, fonts: [] });
    const close = vi.fn();
    await side.renderFrame({ compId: doc.root, t: 0, scale: 0.25, width: 1920, height: 1080, videos: { unused: { width: 1920, height: 1080, close } } });
    expect(close).toHaveBeenCalledOnce();
  });

  it('releases the output bitmap after presenting it', () => {
    const close = vi.fn();
    const r = { compositor: { begin() {}, add() {}, finish() {} }, scale: 1 } as unknown as Renderer;
    blitSandboxFrame(r, { close }, 0, true);
    expect(close).toHaveBeenCalledOnce();
  });

  it('reuses the GPU context across repeated frames and size changes', async () => {
    const doc = project();
    const side = makeSandboxDraw(new Map());
    side.setDoc({ doc, docUrl: 'https://tramme.test/doc.json', images: {}, json: {}, fonts: [] });
    for (let frame = 0; frame < 20; frame++) {
      const result = await side.renderFrame({ compId: doc.root, t: frame / 24, scale: frame < 10 ? 0.25 : 0.5, width: 1920, height: 1080 });
      expect(result.err).toBeUndefined();
      expect((result.bitmap as { source: Surface }).source).toMatchObject(frame < 10 ? { width: 480, height: 270 } : { width: 960, height: 540 });
    }
    expect(gpu.contexts).toBe(1);
  });

  it('draws a shipped frame through the built-in video node', async () => {
    const doc = project();
    doc.assets.footage = { type: 'video', src: 'assets/footage.mp4' };
    doc.compositions[doc.root].layers.video = { type: 'video', props: { video: 'footage', size: [1920, 1080], fit: 'cover' } };
    doc.compositions[doc.root].order = ['video'];
    doc.compositions[doc.root].motionBlur = { samples: 1, shutter: 0 };
    const side = makeSandboxDraw(new Map());
    side.setDoc({ doc, docUrl: 'https://tramme.test/doc.json', images: {}, json: {}, fonts: [] });
    const frame = { width: 1920, height: 1080 };
    const result = await side.renderFrame({ compId: doc.root, t: 2, scale: 0.25, width: 1920, height: 1080, videos: { [videoKey('footage', 2)]: frame } });
    expect(result.err).toBeUndefined();
    expect(draws.find(([image]) => image === frame)).toEqual([frame, -960, -540, 1920, 1080]);
  });
});
