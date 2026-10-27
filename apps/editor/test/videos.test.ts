// The clips' tool: the proportions and placement it chooses, the layer it
// makes, a clip made again at another length, a still read where the clip
// starts, and the seconds it counts against the turn's allowance.

import { describe, expect, it, vi } from 'vitest';
import { applyOps, validate, type ToolContext, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';

vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {} });
vi.stubGlobal('document', { hidden: true, hasFocus: () => false, documentElement: { dataset: {} }, querySelector: () => null });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('addEventListener', () => {});
vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))));
vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 100, height: 50, close: () => {} })));
vi.stubGlobal('OffscreenCanvas', class {
  width: number; height: number;
  constructor(w: number, h: number) { this.width = Math.round(w); this.height = Math.round(h); }
  getContext() { return { drawImage: () => {} }; }
  async convertToBlob() { return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }); }
});
vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('no video decode in the test'); });

vi.mock('../src/confirm.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/confirm.ts')>();
  return { ...actual, payFor: vi.fn(async () => {}) };
});

const videos = await import('../src/videos.ts');
const vocabulary = await import('../src/vocabulary.ts');
const confirm = await import('../src/confirm.ts');
const { api } = await import('../src/api.ts');

const reg = vocabulary.editorRegistry();
const FRAME = `data:image/png;base64,${btoa(String.fromCharCode(1, 2, 3))}`;
const MP4 = new Blob([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], { type: 'video/mp4' });
const made = { blob: MP4, provider: 'hydracept', model: 'veo-3.1-fast-generate-001' };

/** a project and the files its tools write into */
function project(duration = 10) {
  const { doc } = newProject({ name: 'Clips', width: 1080, height: 1920, fps: 30, duration });
  return { doc, files: new Map<string, unknown>() };
}

/** a context that records what the tool writes, hands back the record it reads, and says where a still was read */
function context(doc: TrammeDoc, files: Map<string, unknown>, o: { time?: number; renderStill?: (at: number) => Promise<string> } = {}): ToolContext & { stills: number[] } {
  const stills: number[] = [];
  return {
    doc, compId: doc.root, time: o.time ?? 0, selection: [], registry: reg, signal: new AbortController().signal,
    writeFile: async (path: string, data: Blob | string) => { files.set(path, typeof data === 'string' ? data : new Uint8Array(await data.arrayBuffer())); return path; },
    readText: async (path: string) => typeof files.get(path) === 'string' ? files.get(path) as string : null,
    renderStill: async (at: number) => { stills.push(at); return o.renderStill ? o.renderStill(at) : FRAME; },
    assetUrl: (id: string) => `data:application/octet-stream,${encodeURIComponent(id)}`,
    stills,
  } as unknown as ToolContext & { stills: number[] };
}

function record(doc: TrammeDoc, files: Map<string, unknown>, data: Record<string, unknown>) {
  doc.assets['video-boat'] = { type: 'video', src: 'assets/videos/boat.mp4', name: 'boat' };
  doc.compositions[doc.root].layers['clip-1'] = { type: 'video', name: 'boat', in: 2, out: 6, transform: { position: [540, 960] }, props: { video: 'video-boat', size: [1080, 1920], fit: 'cover' } };
  doc.compositions[doc.root].order = ['clip-1'];
  files.set('assets/videos/boat.video.json', JSON.stringify(data));
}

describe('clips', () => {
  it('asks the proportions the composition calls for: wide or tall', () => {
    expect(videos.clipRatio(1920, 1080)).toBe('16:9');
    expect(videos.clipRatio(1080, 1920)).toBe('9:16');
    expect(videos.clipRatio(1000, 1000)).toBe('16:9');
  });

  it('places a clip from the playhead so all of it shows, and keeps an explicit start', () => {
    expect(videos.clipPlacement(8, 10, undefined, 0)).toEqual({ at: 0, out: 8 });
    expect(videos.clipPlacement(8, 10, undefined, 5)).toEqual({ at: 2, out: 10 });
    expect(videos.clipPlacement(8, 10, 5, 5)).toEqual({ at: 5, out: 10 });
    expect(videos.clipPlacement(8, 5, undefined, 0)).toEqual({ at: 0, out: 5 });
    // past the end: a sliver at the last frame, never an invalid span
    expect(videos.clipPlacement(8, 10, 20, 0)).toEqual({ at: 9.9, out: 10 });
  });

  it('is a tool of the / menu and of the assistant, with the lengths Veo takes', () => {
    const tool = vocabulary.editorRegistry().tool('generate-video').tool;
    const props = (tool.input?.properties ?? {}) as Record<string, { enum?: unknown[]; format?: string }>;
    expect(props.duration?.enum).toEqual([4, 6, 8]);
    expect(props.provider?.enum).toEqual(['hydracept']);
    expect(props.again?.format).toBe('asset');
  });

  it('reads a still where the clip starts, places the layer, and counts its seconds', async () => {
    const { doc, files } = project();
    const ctx = context(doc, files, { time: 0 });
    const generate = vi.spyOn(api, 'generateVideo').mockResolvedValue(made);
    const out = await reg.tool('generate-video').tool.run({ prompt: 'a boat', name: 'boat', at: 5, duration: 4, source: 'frame' }, ctx) as { ops: never[]; images?: unknown[] };
    const next = applyOps(doc, out.ops).doc;
    const layer = Object.values(next.compositions[next.root].layers).find((l) => l.type === 'video')!;
    expect([layer.in, layer.out]).toEqual([5, 9]);
    expect(ctx.stills).toEqual([5]);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ duration: 4, source: expect.stringMatching(/^data:image\/png/) }), expect.anything());
    expect(vi.mocked(confirm.payFor)).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(String), expect.any(String), 4);
    const saved = JSON.parse(files.get('assets/videos/boat.video.json') as string);
    expect(saved.sourceAt).toBe(5);
    expect(validate(next, reg)).toEqual([]);
  });

  it('reads a still where the clip was moved back to, not at the playhead', async () => {
    const { doc, files } = project();
    const ctx = context(doc, files, { time: 9 });
    vi.spyOn(api, 'generateVideo').mockResolvedValue(made);
    const out = await reg.tool('generate-video').tool.run({ prompt: 'a boat', name: 'boat', duration: 4, source: 'frame' }, ctx) as { ops: never[] };
    const next = applyOps(doc, out.ops).doc;
    const layer = Object.values(next.compositions[next.root].layers).find((l) => l.type === 'video')!;
    expect([layer.in, layer.out]).toEqual([6, 10]);
    expect(ctx.stills).toEqual([6]);
  });

  it('makes a clip again at another length and fits the layers that were not trimmed', async () => {
    const { doc, files } = project();
    record(doc, files, { prompt: 'a boat', provider: 'hydracept', model: 'veo-3.1-fast-generate-001', ratio: '9:16', duration: 4, fit: 'cover' });
    const ctx = context(doc, files);
    const generate = vi.spyOn(api, 'generateVideo').mockResolvedValue(made);
    const out = await reg.tool('generate-video').tool.run({ again: 'video-boat', duration: 8 }, ctx) as { ops: never[]; text: string };
    const next = applyOps(doc, out.ops).doc;
    const layer = next.compositions[next.root].layers['clip-1'];
    expect([layer.in, layer.out]).toEqual([2, 10]);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ duration: 8 }), expect.anything());
    expect(vi.mocked(confirm.payFor)).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(String), expect.any(String), 8);
    expect(out.text).toMatch(/follow the new 8 s length/);
    expect(out.text).not.toMatch(/every layer/);
    const saved = JSON.parse(files.get('assets/videos/boat.video.json') as string);
    expect(saved.duration).toBe(8);
    expect(saved.at).toBe(2);
    expect(validate(next, reg)).toEqual([]);
  });

  it('keeps a deliberate trim when the clip is made again longer', async () => {
    const { doc, files } = project();
    record(doc, files, { prompt: 'a boat', provider: 'hydracept', model: 'veo-3.1-fast-generate-001', ratio: '9:16', duration: 4, fit: 'cover' });
    doc.compositions[doc.root].layers['clip-1'].out = 4;
    const ctx = context(doc, files);
    vi.spyOn(api, 'generateVideo').mockResolvedValue(made);
    const out = await reg.tool('generate-video').tool.run({ again: 'video-boat', duration: 8 }, ctx) as { ops: never[]; text: string };
    const next = applyOps(doc, out.ops).doc;
    expect(next.compositions[next.root].layers['clip-1'].out).toBe(4);
    expect(out.text).toMatch(/keep their trim/);
  });

  it('a null length falls back to the record or the setting, never to 4', async () => {
    const { doc, files } = project();
    const ctx = context(doc, files);
    const generate = vi.spyOn(api, 'generateVideo').mockResolvedValue(made);
    await reg.tool('generate-video').tool.run({ prompt: 'a boat', name: 'boat', duration: null }, ctx);
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 8 }), expect.anything());

    const second = project();
    record(second.doc, second.files, { prompt: 'a boat', provider: 'hydracept', model: 'veo-3.1-fast-generate-001', ratio: '9:16', duration: 6, fit: 'cover' });
    const ctx2 = context(second.doc, second.files);
    vi.spyOn(api, 'generateVideo').mockResolvedValue(made);
    await reg.tool('generate-video').tool.run({ again: 'video-boat', duration: null }, ctx2);
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 6 }), expect.anything());
  });
});
