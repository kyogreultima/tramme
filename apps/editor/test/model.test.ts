import { describe, expect, it } from 'vitest';
import type { Composition, TrammeDoc } from '@tramme/core';
import { applyOps as apply } from '@tramme/core';
import { carriedStart, contentEnd, crossfadeOps, cutEndOps, describeOp, fitCompOps, isToolAsset, mediaAssetsOf, splitLayerOps, trimInOps, wholeFile } from '../src/model.ts';
import { passes } from '../src/ai/server.ts';
import EN from '../src/i18n/en.json' with { type: 'json' };
import FR from '../src/i18n/fr.json' with { type: 'json' };

const comp = (layers: Composition['layers']): Composition => ({ name: 'Main', width: 1920, height: 1080, fps: 30, duration: 60, layers, order: Object.keys(layers) });

describe('where the content of a composition ends', () => {
  it('is the out point of its last layer', () => {
    expect(contentEnd(comp({ a: { type: 'text', out: 12 }, b: { type: 'image', in: 10, out: 20 } }))).toBe(20);
  });
  it('is the whole composition when a layer runs to its end', () => {
    expect(contentEnd(comp({ a: { type: 'text', out: 12 }, bg: { type: 'shape.rect' } }))).toBe(60);
  });
});

/** a document with one composition, short (5 s) as a new project's, and a second one inside */
const short = (): TrammeDoc => ({ version: 1, root: 'main', assets: {}, tokens: {}, compositions: {
  main: { name: 'Main', width: 1920, height: 1080, fps: 30, duration: 5, layers: {}, order: [] },
  inner: { name: 'Inner', width: 1920, height: 1080, fps: 30, duration: 8, layers: {}, order: [] },
} } as unknown as TrammeDoc);

describe('a composition lengthened to hold what is added', () => {
  it('reaches the end asked when it is shorter', () => {
    const doc = short();
    expect(fitCompOps(doc, 'main', 753.17)).toEqual([{ op: 'replace', path: '/compositions/main/duration', value: 753.17 }]);
    expect(apply(doc, fitCompOps(doc, 'main', 753.17)).doc.compositions.main.duration).toBe(753.17);
  });
  it('is left as it is when it holds the end already, or exactly', () => {
    expect(fitCompOps(short(), 'main', 3)).toEqual([]);
    expect(fitCompOps(short(), 'main', 5)).toEqual([]);
  });
  it('touches only the composition named', () => {
    const doc = apply(short(), fitCompOps(short(), 'inner', 20)).doc;
    expect(doc.compositions.inner.duration).toBe(20);
    expect(doc.compositions.main.duration).toBe(5);
  });
  it('rounds the end to the thousandth of a frame (no float noise in the document)', () => {
    expect(fitCompOps(short(), 'main', 0.1 + 0.2 + 10)).toEqual([{ op: 'replace', path: '/compositions/main/duration', value: 10.3 }]);
  });
  it('asks nothing for an end that is not a length', () => {
    for (const end of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) expect(fitCompOps(short(), 'main', end), String(end)).toEqual([]);
  });
});

describe('a media layer as long as its file', () => {
  const video = { type: 'video', name: 'Talk', transform: { position: [960, 540] }, props: { video: 'talk', size: [1920, 1080], fit: 'cover' } } as never;
  it('plays a 12-minute video whole in a 5-second composition', () => {
    const doc = short();
    const { layer, ops } = wholeFile(doc, 'main', video, 753.17);
    expect(layer).toMatchObject({ in: 0, out: 753.17, props: { video: 'talk' } });
    expect(ops).toEqual([{ op: 'replace', path: '/compositions/main/duration', value: 753.17 }]);
  });
  it('ends with a short file, the composition kept', () => {
    const { layer, ops } = wholeFile(short(), 'main', video, 2.5);
    expect(layer).toMatchObject({ in: 0, out: 2.5 });
    expect(ops).toEqual([]);
  });
  it('starts where the layer starts', () => {
    const { layer, ops } = wholeFile(short(), 'main', { ...(video as object), in: 4 } as never, 10);
    expect(layer).toMatchObject({ in: 4, out: 14 });
    expect(ops).toEqual([{ op: 'replace', path: '/compositions/main/duration', value: 14 }]);
  });
  it('keeps the layer as it was when the file length is unknown', () => {
    const { layer, ops } = wholeFile(short(), 'main', video, 0);
    expect(layer).toBe(video);
    expect(ops).toEqual([]);
  });
  it('never changes the layer given', () => {
    const given = structuredClone(video);
    wholeFile(short(), 'main', given, 60);
    expect(given).toEqual(video);
  });
});

describe('the end of a video cut in its file', () => {
  /** a 5 s project with a video of 753.17 s, its layer 0 to 5 s, played from the file's start (or from start) */
  const withClip = (start?: number) => {
    const doc = short();
    doc.compositions.main.layers.clip = { type: 'video', in: 0, out: 5, props: { video: 'talk', ...(start !== undefined ? { start } : {}) } } as never;
    doc.compositions.main.order = ['clip'];
    return doc;
  };
  const end = (ops: ReturnType<typeof cutEndOps>) => apply(withClip(), ops).doc.compositions.main;

  it('stretched past the project, takes it along: what was taken is seen', () => {
    const ops = cutEndOps(withClip(), 'main', 'clip', 253, 753.17, 30);
    expect(ops).toEqual([
      { op: 'add', path: '/compositions/main/layers/clip/out', value: 253 },
      { op: 'replace', path: '/compositions/main/duration', value: 253 },
    ]);
    expect(end(ops)).toMatchObject({ duration: 253, layers: { clip: { out: 253 } } });
  });
  it('shortened inside the project, leaves its length', () => {
    expect(cutEndOps(withClip(), 'main', 'clip', 3, 753.17, 30)).toEqual([{ op: 'add', path: '/compositions/main/layers/clip/out', value: 3 }]);
  });
  it('stops at the end of the file', () => {
    const ops = cutEndOps(withClip(), 'main', 'clip', 900, 753.17, 30);
    expect(end(ops)).toMatchObject({ duration: 753.17, layers: { clip: { out: 753.17 } } });
  });
  it('keeps at least one frame', () => {
    expect(cutEndOps(withClip(), 'main', 'clip', 0, 753.17, 30)).toEqual([{ op: 'add', path: '/compositions/main/layers/clip/out', value: 0.0333 }]);
  });
  it('counts from where the layer plays in its file', () => {
    // the file played from 100 s: its end at 160 s in the file is 60 s of layer
    const doc = withClip(100);
    expect(apply(doc, cutEndOps(doc, 'main', 'clip', 160, 753.17, 30)).doc.compositions.main).toMatchObject({ duration: 60, layers: { clip: { out: 60 } } });
  });
  it('asks nothing when the end does not move', () => {
    expect(cutEndOps(withClip(), 'main', 'clip', 5, 753.17, 30)).toEqual([]);
  });
});

describe('a proposal line', () => {
  const doc = { assets: { refkit: { type: 'module', src: 'plugins/refkit.js', name: 'Reference kit' } }, plugins: ['charts'] } as unknown as TrammeDoc;
  it('names a file instead of showing its JSON', () => {
    const line = describeOp(doc, { op: 'add', path: '/assets/kit2', value: { type: 'module', src: 'plugins/kit2.js', name: 'Kit 2' } });
    expect(line).toContain('Kit 2');
    expect(line).not.toContain('{');
    expect(describeOp(doc, { op: 'replace', path: '/assets/refkit/src', value: 'plugins/x.js' })).toContain('Reference kit');
  });
  it('tells the plugins in use once the change is made', () => {
    expect(describeOp(doc, { op: 'add', path: '/plugins/-', value: 'refkit' })).toContain('charts, Reference kit');
    expect(describeOp(doc, { op: 'replace', path: '/plugins', value: ['refkit'] })).toContain('Reference kit');
    expect(describeOp(doc, { op: 'remove', path: '/plugins/0' })).not.toContain('charts');
  });
});

describe('a failure worth a new attempt', () => {
  it('is the network or a busy server', () => {
    for (const m of ['Failed to fetch', 'companion: HTTP 503', 'Overloaded', 'read ECONNRESET', 'stream ended before the answer', 'rate_limit_error: rate limit, retry soon', EN.ai.companionCut, FR.ai.companionCut]) expect(passes(m), m).toBe(true);
  });
  it('is never a quota, a plan or a key', () => {
    for (const m of ['You exceeded your current quota, please check your plan and billing details', 'Claude AI usage limit reached|1760000000', 'invalid x-api-key', 'HTTP 401', 'Please run /login', "You've hit your session limit · resets 3:40am (Africa/Porto-Novo)", 'a property is missing']) expect(passes(m), m).toBe(false);
  });
});

const applyOps = (doc: TrammeDoc, ops: Parameters<typeof apply>[1]) => apply(doc, ops).doc;

describe('a clip cut at the playhead', () => {
  const doc = (layers: Composition['layers'], children?: Record<string, string[]>) => {
    const c = comp(layers);
    if (children) { for (const [g, ch] of Object.entries(children)) c.layers[g].children = ch; c.order = c.order.filter((id) => !Object.values(children).flat().includes(id)); }
    return { version: 1, root: 'main', compositions: { main: c }, assets: {}, tokens: {} } as unknown as TrammeDoc;
  };
  it('keeps what a video, a sound or a composition plays in place', () => {
    expect(carriedStart({ type: 'video', props: { start: 2 } }, 3)).toBe(5);
    expect(carriedStart({ type: 'audio', props: { rate: 2 } }, 3)).toBe(6);
    expect(carriedStart({ type: 'comp', props: { start: 1, speed: 0.5 } }, 4)).toBe(3);
    expect(carriedStart({ type: 'comp', props: { remap: 2 } }, 4)).toBeNull();
    expect(carriedStart({ type: 'video', props: { start: { $k: [{ t: 0, v: 0 }] } } }, 1)).toBeNull();
    expect(carriedStart({ type: 'text', props: {} }, 1)).toBeNull();
  });
  it('trims the head of a video in its file', () => {
    const d = applyOps(doc({ v: { type: 'video', in: 2, out: 10, props: { video: 'a', start: 1 } } }), trimInOps(doc({ v: { type: 'video', in: 2, out: 10, props: { video: 'a', start: 1 } } }), 'main', 'v', 5));
    expect(d.compositions.main.layers.v).toMatchObject({ in: 5, out: 10, props: { start: 4 } });
  });
  it('splits a clip in two that play on as one', () => {
    const d0 = doc({ v: { type: 'video', in: 2, out: 10, props: { video: 'a', start: 1 } }, t: { type: 'text' } });
    const r = splitLayerOps(d0, 'main', 'v', 6)!;
    const d = applyOps(d0, r.ops), c = d.compositions.main;
    expect(r.id).toBe('v-2');
    expect(c.layers.v).toMatchObject({ in: 2, out: 6, props: { start: 1 } });
    expect(c.layers['v-2']).toMatchObject({ in: 6, out: 10, props: { video: 'a', start: 5 } });
    expect(c.order).toEqual(['v', 'v-2', 't']);
  });
  it('places the second part inside the same group, and refuses outside the clip or on a group', () => {
    const d0 = doc({ g: { type: 'group' }, a: { type: 'text', in: 0, out: 4 }, b: { type: 'text' } }, { g: ['a', 'b'] });
    const d = applyOps(d0, splitLayerOps(d0, 'main', 'a', 1)!.ops);
    expect(d.compositions.main.layers.g.children).toEqual(['a', 'a-2', 'b']);
    expect(d.compositions.main.order).toEqual(['g']);
    expect(splitLayerOps(d0, 'main', 'a', 4)).toBeNull();
    expect(splitLayerOps(d0, 'main', 'g', 1)).toBeNull();
  });
  it('cross-fades two clips that meet: the earlier one gives way, whichever is asked', () => {
    const keys = (d: TrammeDoc, id: string) => (d.compositions.main.layers[id].transform?.opacity as { $k: { t: number; v: number }[] }).$k.map((k) => [k.t, k.v]);
    // a before b, overlapping from 4 to 6 s: a fades out, b fades in, around 5 s
    const d0 = doc({ a: { type: 'video', in: 0, out: 6 }, b: { type: 'video', in: 4, out: 10 } });
    const fromA = applyOps(d0, crossfadeOps(d0, 'main', 'a', 0.5)!.ops);
    expect(keys(fromA, 'a')).toEqual([[4.5, 1], [5.5, 0]]);
    expect(keys(fromA, 'b')).toEqual([[4.5, 0], [5.5, 1]]);
    // the later clip lower in the stack: the same hand-over
    const d1 = doc({ b: { type: 'video', in: 4, out: 10 }, a: { type: 'video', in: 0, out: 6 } });
    const fromB = applyOps(d1, crossfadeOps(d1, 'main', 'b', 0.5)!.ops);
    expect(keys(fromB, 'a')).toEqual([[4.5, 1], [5.5, 0]]);
    expect(keys(fromB, 'b')).toEqual([[4.5, 0], [5.5, 1]]);
  });
  it('reads the media of the selected layers, a 3D model included, and tells the tools\' own files apart', () => {
    const d0 = doc({ m: { type: 'model.3d', props: { source: 'beetle' } }, p: { type: 'image', props: { image: 'photo-cut' } }, t: { type: 'text' } });
    d0.assets = { beetle: { type: 'model', src: 'assets/chat/beetle.glb' }, 'photo-cut': { type: 'image', src: 'assets/cutout/photo.png' } };
    expect(mediaAssetsOf(d0, 'main', ['m', 't'], ['model'])).toEqual(['beetle']);
    // a selected cut-out is a choice: it is read like any picture
    expect(mediaAssetsOf(d0, 'main', ['p'], ['image'])).toEqual(['photo-cut']);
    // a tool's file, by its name or by where it was written (an id cut to 64 characters loses its suffix)
    expect(isToolAsset('depth-photo')).toBe(true);
    expect(isToolAsset('a-very-long-name', { src: 'assets/cutout/a-very-long-name.png' })).toBe(true);
    expect(isToolAsset('photo', { src: 'assets/photo.png' })).toBe(false);
  });
  it('refuses a cross-fade when one clip holds the other', () => {
    expect(crossfadeOps(doc({ a: { type: 'video', in: 4, out: 6 }, b: { type: 'video', in: 0, out: 10 } }), 'main', 'a', 0.5)).toBeNull();
    expect(crossfadeOps(doc({ a: { type: 'video', in: 0, out: 10 }, b: { type: 'video', in: 4, out: 6 } }), 'main', 'a', 0.5)).toBeNull();
  });
});
