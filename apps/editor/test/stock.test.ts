// The free libraries: what is asked of each, what is dropped for its licence,
// what is kept in the project with its record. Their answers are stubbed with
// the shapes the real APIs give (trimmed to a few results).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOps, validate, type ToolContext, type ToolOutput, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';

vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {} });
vi.stubGlobal('document', { hidden: true, hasFocus: () => false, documentElement: { dataset: {} }, querySelector: () => null });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('addEventListener', () => {});

// the contact sheet is the browser's canvas
vi.mock('../src/review.ts', async (original) => ({ ...(await original<typeof import('../src/review.ts')>()), sheetOf: () => 'data:image/jpeg;base64,sheet' }));

const { api } = await import('../src/api.ts');
const { STOCK_TOOLS, searchStock, allowedLicense } = await import('../src/stock.ts');
const { packGlb } = await import('../src/glb.ts');
const { SOUND_TOOLS } = await import('../src/sound.ts');
const { editorRegistry } = await import('../src/vocabulary.ts');

const tool = STOCK_TOOLS[0];
const reg = editorRegistry();
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ── what the libraries answer ────────────────────────────────
const PH_LIST = {
  concrete_floor_02: { name: 'Concrete Floor 02', categories: ['floor', 'concrete'], tags: ['rough'], authors: { 'Charlotte Baglioni': 'All' }, max_resolution: [8192, 8192] },
  brick_wall_01: { name: 'Brick Wall 01', categories: ['wall', 'brick'], tags: [], authors: { Rob: 'All' } },
  lythwood_room: { name: 'Lythwood Room', categories: ['indoor'], tags: ['room', 'warm'], authors: { Greg: 'All' } },
  alarm_clock_01: { name: 'Alarm Clock 01', categories: ['household'], tags: ['clock'], authors: { Kirill: 'All' } },
};
const file = (url: string) => ({ url, size: 1 });
const PH_FILES: Record<string, unknown> = {
  concrete_floor_02: { Diffuse: { '1k': { jpg: file('https://dl.polyhaven.org/concrete_diff_1k.jpg') }, '2k': { jpg: file('https://dl.polyhaven.org/concrete_diff_2k.jpg') } }, nor_gl: { '1k': { jpg: file('https://dl.polyhaven.org/concrete_nor_1k.jpg') } }, Rough: { '1k': { jpg: file('https://dl.polyhaven.org/concrete_rough_1k.jpg') } } },
  lythwood_room: { tonemapped: file('https://dl.polyhaven.org/lythwood_room.jpg'), hdri: { '1k': { hdr: file('https://dl.polyhaven.org/lythwood_room_1k.hdr') } } },
  alarm_clock_01: { gltf: { '1k': { gltf: { url: 'https://dl.polyhaven.org/alarm_clock_01_1k.gltf', include: { 'alarm_clock_01.bin': file('https://dl.polyhaven.org/alarm_clock_01.bin'), 'textures/alarm_clock_01_diff_1k.jpg': file('https://dl.polyhaven.org/diff.jpg') } } } } },
};
const GLTF = { asset: { version: '2.0' }, buffers: [{ uri: 'alarm_clock_01.bin', byteLength: 8 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }], images: [{ uri: 'textures/x.jpg' }], textures: [{ source: 0 }], materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 0, 0, 1] } }] };
const ACG = { foundAssets: [{ assetId: 'Concrete048', displayName: 'Concrete 048', previewImage: { '256-PNG': 'https://acg-media.example/Concrete048.png' }, downloadFolders: { default: { downloadFiletypeCategories: { zip: { downloads: [{ attribute: '1K-JPG', fileName: 'Concrete048_1K-JPG.zip' }, { attribute: '2K-JPG', fileName: 'Concrete048_2K-JPG.zip' }] } } } } }] };
const OV = { results: [
  { id: 'ov-1', title: 'Ramen', url: 'https://img.example/ramen.jpg', thumbnail: 'https://img.example/ramen-t.jpg', creator: 'Aiko', license: 'cc0', foreign_landing_url: 'https://openverse.org/image/ov-1', width: 2000, height: 1500 },
  { id: 'ov-2', title: 'Bowl', url: 'https://img.example/bowl.jpg', creator: 'Ben', license: 'by', foreign_landing_url: 'https://openverse.org/image/ov-2' },
  { id: 'ov-3', title: 'Share alike', url: 'https://img.example/sa.jpg', creator: 'Cy', license: 'by-sa', foreign_landing_url: 'https://openverse.org/image/ov-3' },
  { id: 'ov-4', title: 'No commercial', url: 'https://img.example/nc.jpg', creator: 'Di', license: 'by-nc', foreign_landing_url: 'https://openverse.org/image/ov-4' },
] };
const PX_PHOTOS = { photos: [{ id: 101, width: 4000, height: 3000, url: 'https://www.pexels.com/photo/101/', photographer: 'Pia', alt: 'A bowl of ramen', src: { original: 'https://px.example/101-o.jpg', large2x: 'https://px.example/101-l.jpg', medium: 'https://px.example/101-m.jpg' } }] };
const PX_VIDEOS = { videos: [{ id: 202, width: 1920, height: 1080, url: 'https://www.pexels.com/video/202/', image: 'https://px.example/202.jpg', duration: 12, user: { name: 'Vik' }, video_files: [{ link: 'https://px.example/202-4k.mp4', width: 3840, file_type: 'video/mp4' }, { link: 'https://px.example/202-hd.mp4', width: 1920, file_type: 'video/mp4' }] }] };

const asked: string[] = [];
let refused: string[] = [];
beforeEach(() => {
  asked.length = 0; refused = [];
  vi.stubGlobal('createImageBitmap', async () => ({ width: 10, height: 10, close() {} }));
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    asked.push(url);
    if (refused.some((r) => url.includes(r))) return new Response('no', { status: 503 });
    const ph = /^https:\/\/api\.polyhaven\.com\/assets\?type=(\w+)/.exec(url);
    if (ph) return jsonRes(Object.fromEntries(Object.entries(PH_LIST).filter(([id]) => (ph[1] === 'textures' ? /concrete|brick/ : ph[1] === 'hdris' ? /lythwood/ : /alarm/).test(id))));
    const files = /^https:\/\/api\.polyhaven\.com\/files\/(\w+)/.exec(url);
    if (files) return jsonRes(PH_FILES[files[1]]);
    if (url.startsWith('https://api.openverse.org/v1/images/')) return jsonRes(OV);
    if (url.startsWith('https://api.openverse.org/v1/audio/')) return jsonRes({ results: [] });
    if (url === 'https://dl.polyhaven.org/alarm_clock_01_1k.gltf') return jsonRes(GLTF);
    if (url === 'https://dl.polyhaven.org/alarm_clock_01.bin') return new Response(new Uint8Array(8));
    return new Response(new Blob(['bytes'], { type: url.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg' }));
  });
  vi.spyOn(api, 'stockAmbient').mockImplementation(async () => jsonRes(ACG));
  vi.spyOn(api, 'stockPexels').mockImplementation(async (kind) => (kind === 'photos' ? PX_PHOTOS : PX_VIDEOS));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const signal = () => new AbortController().signal;
const project = (): TrammeDoc => newProject({ name: 'Stock', width: 1920, height: 1080, fps: 30, duration: 20 }).doc;
function world(doc = project()) {
  const files = new Map<string, Blob | string>();
  const ctx = { doc, compId: doc.root, time: 0, selection: [], registry: reg, signal: signal(), writeFile: async (p: string, d: Blob | string) => { files.set(p, d); return p; }, readText: async () => null } as unknown as ToolContext;
  const run = async (input: Record<string, unknown>, c = ctx) => (await tool.run(input as never, c)) as ToolOutput;
  return { files, ctx, run };
}

describe('the licences', () => {
  it('allow what may be used, shown and changed', () => {
    expect(['cc0', 'pdm', 'by', 'CC BY'].map(allowedLicense)).toEqual(['CC0', 'PDM', 'CC BY', 'CC BY']);
    for (const bad of ['by-sa', 'by-nd', 'by-nc', 'by-nc-sa', '', undefined]) expect(allowedLicense(bad), String(bad)).toBeNull();
  });
});

describe('the search', () => {
  it('asks Poly Haven and ambientCG for a texture, every hit with its licence and its colour map', async () => {
    const { hits, failed } = await searchStock('texture', 'concrete', 6, signal());
    expect(asked.some((u) => u.startsWith('https://api.polyhaven.com/assets?type=textures'))).toBe(true);
    expect(api.stockAmbient).toHaveBeenCalledWith('search', { q: 'concrete', limit: '6' }, expect.anything());
    expect(failed).toEqual([]);
    expect(hits.map((h) => `${h.source}:${h.id}`)).toEqual(['polyhaven:concrete_floor_02', 'ambientcg:Concrete048']);
    for (const h of hits) { expect(h.license).toBe('CC0'); expect(h.files.some((f) => f.role === 'color')).toBe(true); }
    expect(hits[0].files.find((f) => f.role === 'color')!.url).toContain('concrete_diff_2k');
    expect(hits[1].files[0].url).toContain('Concrete048_1K-JPG.zip');
  });

  it('asks Openverse for the licences allowed and Pexels for photos, and drops share-alike and non-commercial results', async () => {
    const { hits } = await searchStock('photo', 'ramen bowl', 8, signal());
    const ov = asked.find((u) => u.startsWith('https://api.openverse.org/v1/images/'))!;
    expect(new URL(ov).searchParams.get('license')).toBe('cc0,pdm,by');
    expect(api.stockPexels).toHaveBeenCalledWith('photos', 'ramen bowl', 8, expect.anything());
    expect(hits.map((h) => h.id)).toEqual(['101', 'ov-1', 'ov-2']);
    expect(hits.map((h) => h.license)).toEqual(['Pexels', 'CC0', 'CC BY']);
  });

  it('still answers with the others when one library does not', async () => {
    vi.spyOn(api, 'stockPexels').mockRejectedValue(new Error('no pexels key'));
    const { hits, failed } = await searchStock('photo', 'ramen', 8, signal());
    expect(failed).toEqual(['pexels']);
    expect(hits.map((h) => h.source)).toEqual(['openverse', 'openverse']);
    refused = ['api.openverse.org'];
    const none = await searchStock('photo', 'ramen', 8, signal());
    expect(none.hits).toEqual([]);
    expect(none.failed).toEqual(['pexels', 'openverse']);
  });

  it('keeps the tonemapped picture of an environment, and the glTF and its buffers for a model', async () => {
    const env = (await searchStock('hdri', 'room', 4, signal())).hits[0];
    expect(env.files).toEqual([{ url: 'https://dl.polyhaven.org/lythwood_room.jpg', type: 'image/jpeg', role: 'env' }]);
    const model = (await searchStock('model', 'clock', 4, signal())).hits[0];
    expect(model.files.map((f) => `${f.role}:${f.name}`)).toEqual(['model:alarm_clock_01.gltf', 'buffer:alarm_clock_01.bin']);
  });

  it('asks Pexels for clips and takes the widest mp4 up to full HD', async () => {
    const [clip] = (await searchStock('clip', 'city', 4, signal())).hits;
    expect(api.stockPexels).toHaveBeenCalledWith('videos', 'city', 4, expect.anything());
    expect(clip).toMatchObject({ id: '202', seconds: 12, files: [{ url: 'https://px.example/202-hd.mp4' }] });
  });
});

describe('the stock tool', () => {
  it('lists one line per hit with one contact sheet, and proposes nothing', async () => {
    const out = await world().run({ kind: 'photo', query: 'ramen bowl' });
    expect(out.ops ?? []).toEqual([]);
    expect(out.images).toHaveLength(1);
    const lines = out.text!.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('pexels:101');
    expect(lines[0]).toContain('Pia');
    expect(lines[0]).toContain('Pexels');
    expect(lines[0]).toContain('4000×3000');
  });

  it('names the library that failed, and what to try when none is left', async () => {
    vi.spyOn(api, 'stockPexels').mockRejectedValue(new Error('x'));
    expect((await world().run({ kind: 'photo', query: 'ramen' })).text).toMatch(/pexels did not answer \(the others did\)/);
    refused = ['api.openverse.org'];
    const none = await world().run({ kind: 'photo', query: 'ramen' });
    expect(none.images ?? []).toEqual([]);
    expect(none.text).toMatch(/pexels, openverse did not answer/);
    expect(none.text).toMatch(/generate-image/);
    expect(none.text).toMatch(/surface/);
  });

  it('says the licence filter left nothing, never showing a share-alike result', async () => {
    vi.spyOn(api, 'stockPexels').mockResolvedValue({ photos: [] });
    vi.stubGlobal('fetch', async () => jsonRes({ results: [OV.results[2], OV.results[3]] }));
    const out = await world().run({ kind: 'photo', query: 'ramen' });
    expect(out.text).toMatch(/licences allowed/);
    expect(out.text).not.toContain('Share alike');
  });

  it('keeps a photo with its file and its record, and places it', async () => {
    const w = world();
    await w.run({ kind: 'photo', query: 'ramen bowl' });
    const out = await w.run({ kind: 'photo', use: 'pexels:101', background: true });
    expect([...w.files.keys()].sort()).toEqual(['assets/stock/stock-pexels-101.jpg', 'assets/stock/stock-pexels-101.json']);
    expect(JSON.parse(w.files.get('assets/stock/stock-pexels-101.json') as string)).toMatchObject({ source: 'pexels', id: '101', title: 'A bowl of ramen', author: 'Pia', license: 'Pexels', landing: 'https://www.pexels.com/photo/101/', url: 'https://px.example/101-l.jpg' });
    const applied = applyOps(w.ctx.doc, out.ops!).doc;
    expect(applied.assets['image-stock-pexels-101']).toMatchObject({ type: 'image', src: 'assets/stock/stock-pexels-101.jpg' });
    const c = applied.compositions[applied.root];
    expect(Object.values(c.layers).some((l) => l.type === 'image' && l.props?.image === 'image-stock-pexels-101')).toBe(true);
    expect(c.order[0]).toBeDefined();
    expect(validate(applied, reg)).toEqual([]);
  });

  it('adds nothing the second time', async () => {
    const w = world();
    await w.run({ kind: 'photo', query: 'ramen bowl' });
    const first = await w.run({ kind: 'photo', use: 'pexels:101' });
    const doc = applyOps(w.ctx.doc, first.ops!).doc;
    const again = await w.run({ kind: 'photo', use: 'pexels:101' }, { ...w.ctx, doc });
    expect(again.ops ?? []).toEqual([]);
    expect(again.text).toMatch(/already in the project/);
    expect(asked.filter((u) => u.includes('101-l.jpg'))).toHaveLength(1);
  });

  it('keeps a clip as a video asset and layer, as long as the clip', async () => {
    const w = world();
    await w.run({ kind: 'clip', query: 'city' });
    const out = await w.run({ kind: 'clip', use: 'pexels:202', at: 2 });
    const applied = applyOps(w.ctx.doc, out.ops!).doc;
    expect(applied.assets['video-stock-pexels-202']).toMatchObject({ type: 'video', src: 'assets/stock/stock-pexels-202.mp4' });
    const layer = Object.values(applied.compositions[applied.root].layers).find((l) => l.type === 'video')!;
    expect(layer).toMatchObject({ in: 2, out: 14 });
  });

  it('keeps the colour map of an ambientCG material out of its zip', async () => {
    const { zipSync } = await import('fflate');
    const zip = zipSync({ 'Concrete048_1K-JPG_Color.jpg': new Uint8Array([1, 2, 3]), 'Concrete048_1K-JPG_NormalGL.jpg': new Uint8Array([4]) });
    // the zip comes through the server's route, which `reach` asks like any other address
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', async (u: string) => (String(u).includes('/api/stock/ambientcg/zip') ? new Response(zip) : base(u)));
    const w = world();
    await w.run({ kind: 'texture', query: 'concrete' });
    const out = await w.run({ kind: 'texture', use: 'ambientcg:Concrete048' });
    const saved = w.files.get('assets/stock/stock-ambientcg-concrete048.jpg') as Blob;
    expect(saved).toBeDefined();
    expect([...new Uint8Array(await saved.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(out.ops!.length).toBeGreaterThan(0);
  });

  it('keeps an environment as a picture that is not placed, its record marking it', async () => {
    const w = world();
    await w.run({ kind: 'hdri', query: 'room' });
    const out = await w.run({ kind: 'hdri', use: 'polyhaven:lythwood_room' });
    expect(JSON.parse(w.files.get('assets/stock/stock-polyhaven-lythwood_room.json') as string)).toMatchObject({ env: true, license: 'CC0' });
    expect((out.ops ?? []).filter((o) => (o as { path: string }).path.includes('/layers/'))).toEqual([]);
    expect(applyOps(w.ctx.doc, out.ops!).doc.assets['image-stock-polyhaven-lythwood_room']).toBeDefined();
  });

  it('keeps a model as one .glb with a model asset and layer', async () => {
    const w = world();
    await w.run({ kind: 'model', query: 'clock' });
    const out = await w.run({ kind: 'model', use: 'polyhaven:alarm_clock_01' });
    const glb = w.files.get('assets/stock/stock-polyhaven-alarm_clock_01.glb') as Blob;
    const bytes = new Uint8Array(await glb.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('glTF');
    const applied = applyOps(w.ctx.doc, out.ops!).doc;
    expect(applied.assets['model-stock-polyhaven-alarm_clock_01']).toMatchObject({ type: 'model', src: 'assets/stock/stock-polyhaven-alarm_clock_01.glb' });
    expect(Object.values(applied.compositions[applied.root].layers).some((l) => l.type === 'model.3d' && l.props?.source === 'model-stock-polyhaven-alarm_clock_01')).toBe(true);
    expect(validate(applied, reg)).toEqual([]);
  });

  it('refuses a result no search showed', async () => {
    await expect(world().run({ kind: 'photo', use: 'pexels:999' })).rejects.toThrow(/no result "pexels:999"/);
  });
});

describe('packing a glTF', () => {
  it('makes one .glb of two buffers, its textures left out, its materials kept as colours', () => {
    const gltf = { asset: { version: '2.0' }, buffers: [{ uri: 'a.bin', byteLength: 6 }, { uri: 'b.bin', byteLength: 4 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 6 }, { buffer: 1, byteOffset: 0, byteLength: 4 }], images: [{ uri: 'x.jpg' }], textures: [{ source: 0 }], materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 0, 0, 1] } }] };
    const out = packGlb(gltf, { 'a.bin': new Uint8Array([1, 2, 3, 4, 5, 6]).buffer, 'b.bin': new Uint8Array([7, 8, 9, 10]).buffer });
    const view = new DataView(out);
    expect(new TextDecoder().decode(new Uint8Array(out, 0, 4))).toBe('glTF');
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(out.byteLength);
    const jsonLen = view.getUint32(12, true);
    expect(view.getUint32(16, true)).toBe(0x4e4f534a);
    const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(out, 20, jsonLen)));
    expect(doc.buffers).toEqual([{ byteLength: 12 }]);
    expect(doc.bufferViews.map((v: { buffer: number; byteOffset: number }) => [v.buffer, v.byteOffset])).toEqual([[0, 0], [0, 8]]);
    expect(doc.images).toBeUndefined();
    expect(doc.materials[0].pbrMetallicRoughness).toEqual({ baseColorFactor: [1, 0, 0, 1] });
    const bin = 20 + jsonLen;
    expect(view.getUint32(bin, true)).toBe(12);
    expect(view.getUint32(bin + 4, true)).toBe(0x004e4942);
    expect([...new Uint8Array(out, bin + 8, 12)]).toEqual([1, 2, 3, 4, 5, 6, 0, 0, 7, 8, 9, 10]);
  });

  it('names a buffer that is missing', () => {
    expect(() => packGlb({ buffers: [{ uri: 'a.bin', byteLength: 4 }] }, {})).toThrow(/a\.bin/);
  });
});

describe('the sound search, through the shared Openverse call', () => {
  it('still asks Openverse for CC0 recordings from Freesound', async () => {
    const find = SOUND_TOOLS.find((x) => x.name === 'sound-find')!;
    await find.run({ query: 'wood tap' } as never, { signal: signal() } as unknown as ToolContext);
    const url = new URL(asked.find((u) => u.startsWith('https://api.openverse.org/v1/audio/'))!);
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'wood tap', license: 'cc0', source: 'freesound', page_size: '20' });
  });
});
