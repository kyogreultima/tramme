import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';
import type { PluginModule } from '@tramme/core';
import { blitSandboxFrame, ensureSandboxDoc, moduleItemsOf, renderSandboxFrame, resetSandbox, VIDEO_FRAME_BUDGET } from '../src/plugins/sandbox-draw.ts';
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
    let m = [1, 0, 0, 1, 0, 0];
    return {
      canvas: this, globalAlpha: 1,
      setTransform: (...args: number[]) => { m = args.length === 6 ? args : [1, 0, 0, 1, 0, 0]; paint.push({ canvas: this, op: 'transform', args }); },
      getTransform: () => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }),
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

  /**
   * Videos as the page holds them (VideoFrames): every time inside one picture of a `fps` file gives that
   * picture's one object, quickPicture makes a smaller one; the payloads sent to the sandbox are kept
   */
  const filesRig = (doc: ReturnType<typeof project>, size: [number, number], fps = 30) => {
    const side = makeSandboxDraw(new Map());
    side.setDoc({ doc, docUrl: 'https://tramme.test/doc.json', images: {}, json: {}, fonts: [] });
    const pictures = new Map<string, { width: number; height: number }>(), shrunk: [number, number][] = [], asked: [number, string][] = [];
    const file = (id: string) => ({
      width: size[0], height: size[1],
      request: async (t: number, kind = 'shown') => { asked.push([+t.toFixed(4), kind]); },
      frameAt: (t: number) => {
        const key = `${id}#${Math.floor(t * fps + 1e-6)}`;
        if (!pictures.has(key)) pictures.set(key, { width: size[0], height: size[1] });
        return { image: pictures.get(key)!, exact: false };
      },
      quickPicture: (_: unknown, w: number, h: number) => { shrunk.push([w, h]); return { width: w, height: h }; },
    });
    const files = new Map<string, ReturnType<typeof file>>();
    const renderer = { doc, comp: doc.compositions[doc.root], assets: { has: () => true, get: (id: string) => { if (!files.has(id)) files.set(id, file(id)); return files.get(id); } } } as unknown as Renderer;
    const sent: Record<string, { source: { width: number; height: number } }>[] = [];
    const host = { renderFrame: async (p: Parameters<typeof side.renderFrame>[0]) => { sent.push((p.videos ?? {}) as never); const { transfer: _, ...answer } = await side.renderFrame(p); return answer; } } as unknown as PluginHost;
    /** the distinct bitmaps of the largest payload, and their bytes */
    const largest = () => {
      const most = sent.reduce((a, v) => (Object.keys(v).length > Object.keys(a).length ? v : a), {} as (typeof sent)[number]);
      const bitmaps = new Set(Object.values(most));
      return { keys: Object.keys(most).length, bitmaps, bytes: [...bitmaps].reduce((n, b) => n + b.source.width * b.source.height * 4, 0) };
    };
    return { host, renderer, sent, shrunk, asked, largest };
  };
  const videoLayers = (doc: ReturnType<typeof project>, count: number, props: Record<string, unknown> = {}) => {
    const main = doc.compositions[doc.root];
    main.order = [];
    for (let i = 0; i < count; i++) {
      doc.assets[`footage${i}`] = { type: 'video', src: `assets/footage${i}.mp4` };
      main.layers[`video${i}`] = { type: 'video', props: { video: `footage${i}`, ...props } };
      main.order.push(`video${i}`);
    }
  };

  it('sends one copy of a video frame that several motion-blur samples share', async () => {
    const doc = project();
    doc.compositions[doc.root].motionBlur = { samples: 8, shutter: 0.5 };
    videoLayers(doc, 1);
    const { host, renderer, largest } = filesRig(doc, [3840, 2160]);
    for (let f = 0; f < 4; f++) expect((await renderSandboxFrame(host, renderer, frameOf(doc, 10 + f / 24), { export: true })).err).toBeUndefined();
    // the eight samples name eight times, but they fall in one or two pictures of the file: one bitmap per picture crosses
    const { keys, bitmaps } = largest();
    expect(keys).toBeGreaterThan(4);
    expect(bitmaps.size).toBeLessThanOrEqual(2);
  });

  it('keeps decoded pictures alive until the sandbox bitmaps are made', async () => {
    class DecodedFrame {
      displayWidth = 3840;
      displayHeight = 2160;
      closed = false;
      clone() { return new DecodedFrame(); }
      close() { this.closed = true; }
    }
    vi.stubGlobal('VideoFrame', DecodedFrame);
    vi.stubGlobal('createImageBitmap', async (source: DecodedFrame) => {
      if (source.closed) throw new Error('decoder already closed this frame');
      return { width: source.displayWidth, height: source.displayHeight };
    });
    const doc = project();
    const first = new DecodedFrame(), second = new DecodedFrame();
    const renderer = { assets: { get: () => ({
      width: 3840, height: 2160,
      request: async (t: number) => {
        if (t === 2) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          first.close();
        }
      },
      frameAt: (t: number) => ({ image: t === 1 ? first : second }),
    }) } } as unknown as Renderer;
    let sent: Record<string, ImageBitmap> = {};
    const host = { renderFrame: async (payload: { videos: typeof sent }) => {
      sent = payload.videos;
      return Object.keys(sent).length ? {} : { need: [{ id: 'clip', t: 1 }, { id: 'clip', t: 2 }] };
    } } as unknown as PluginHost;
    await renderSandboxFrame(host, renderer, frameOf(doc, 1), { export: true });
    expect(sent[videoKey('clip', 1)]?.width).toBe(3840);
    expect(sent[videoKey('clip', 2)]?.width).toBe(3840);
  });

  it('sends an export\'s video frames at the size they land on, not the file\'s', async () => {
    const doc = project();
    doc.compositions[doc.root].motionBlur = { samples: 1, shutter: 0 };
    videoLayers(doc, 1);
    const { host, renderer, shrunk, largest } = filesRig(doc, [3840, 2160]);
    for (let f = 0; f < 3; f++) expect((await renderSandboxFrame(host, renderer, { ...frameOf(doc, 1 + f / 24), scale: 1 }, { export: true })).err).toBeUndefined();
    expect(shrunk.at(-1)).toEqual([1920, 1080]);
    expect(largest().bytes).toBe(1920 * 1080 * 4);
  });

  it('recalculates the landing size when a moving preview switches to export', async () => {
    const doc = project();
    doc.compositions[doc.root].motionBlur = { samples: 1, shutter: 0 };
    videoLayers(doc, 1);
    const { host, renderer, shrunk } = filesRig(doc, [3840, 2160]);
    for (let f = 0; f < 2; f++) {
      expect((await renderSandboxFrame(host, renderer, frameOf(doc, 1 + f / 24), { playing: true })).err).toBeUndefined();
    }
    expect(shrunk.at(-1)).toEqual([528, 297]);
    const frame = { ...frameOf(doc, 1 + 2 / 24), scale: 1 };
    expect((await renderSandboxFrame(host, renderer, frame, { export: true })).err).toBeUndefined();
    expect(shrunk.at(-1)).toEqual([1920, 1080]);
  });

  it('sends a stretched picture at its rendered width and height', async () => {
    const doc = project();
    doc.compositions[doc.root].motionBlur = { samples: 1, shutter: 0 };
    videoLayers(doc, 1, { fit: 'fill', size: [640, 640] });
    const { host, renderer, shrunk } = filesRig(doc, [3840, 2160]);
    const frame = { ...frameOf(doc, 1), scale: 1 };
    expect((await renderSandboxFrame(host, renderer, frame, { export: true })).err).toBeUndefined();
    expect(shrunk).toEqual([[640, 640]]);
  });

  it('plays a 4K video through the sandbox as a small picture drawn over the file\'s own rectangle, the next frames decoding ahead', async () => {
    const doc = project();
    doc.compositions[doc.root].motionBlur = { samples: 1, shutter: 0 };
    videoLayers(doc, 1, { fit: 'contain' });
    const { host, renderer, shrunk, asked } = filesRig(doc, [3840, 2160]);
    for (let f = 0; f < 3; f++) expect((await renderSandboxFrame(host, renderer, { ...frameOf(doc, 1 + f / 24), scale: 0.25 }, { playing: true })).err).toBeUndefined();
    // shown at a quarter of 1920 (480 px), with a tenth to spare
    expect(shrunk.at(-1)).toEqual([528, 297]);
    // the video layer still draws over the file's whole frame (1920 × 1080 in the composition), not the small picture's
    expect(draws.at(-1)!.slice(3, 5)).toEqual([1920, 1080]);
    expect(asked.some(([t, kind]) => kind === 'ahead' && t > 1 + 2 / 24)).toBe(true);
  });

  // the cases that reach the sandbox's limit: they all cross within the budget, every layer drawn
  for (const [what, files, size, comp, props, blur] of [
    ['a fast clip whose blur samples each fall in another picture', 1, [3840, 2160], [3840, 2160], { rate: 8 }, { samples: 16, shutter: 1 }],
    ['ten 4K layers at once in a 4K film', 10, [3840, 2160], [3840, 2160], {}, { samples: 1, shutter: 0 }],
    ['8K footage, three layers with blur', 3, [7680, 4320], [3840, 2160], {}, { samples: 8, shutter: 0.5 }],
  ] as const) {
    it(`exports ${what} without passing the sandbox's limit`, async () => {
      const doc = newProject({ name: 'Heavy', width: comp[0], height: comp[1], fps: 24, duration: 30 }).doc;
      doc.compositions[doc.root].motionBlur = { ...blur };
      videoLayers(doc, files, { ...props, size: [comp[0], comp[1]] });
      const { host, renderer, largest } = filesRig(doc, [size[0], size[1]]);
      for (let f = 0; f < 3; f++) {
        draws.length = 0;
        const answer = await renderSandboxFrame(host, renderer, { compId: doc.root, t: 1 + f / 24, scale: 1, width: comp[0], height: comp[1] }, { export: true });
        expect(answer.err).toBeUndefined();
        expect(draws.length).toBeGreaterThanOrEqual(files);
      }
      expect(largest().bytes).toBeLessThanOrEqual(VIDEO_FRAME_BUDGET);
    });
  }

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
    class BitmapSurface extends Surface {
      initialized = false;
      override getContext() { this.initialized = true; return super.getContext(); }
    }
    vi.stubGlobal('OffscreenCanvas', BitmapSurface);
    vi.stubGlobal('createImageBitmap', async (source: unknown) => {
      if (source instanceof BitmapSurface && source.width === 1 && !source.initialized) throw new Error('missing canvas context');
      return { source };
    });
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
