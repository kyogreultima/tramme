import { describe, expect, it } from 'vitest';
import { readingIssues, sampleKeyframes } from '@tramme/core';
import { fromLottie, readingFromLottie } from '../src/index.ts';

const kf = (t: number, s: number[]) => ({ t, s, o: { x: [0.3], y: [0] }, i: { x: [0.2], y: [1] } });
const ks = (more: Record<string, unknown> = {}) => ({ o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [960, 540, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] }, ...more });
const text = (t: string, size: number) => ({ d: { k: [{ t: 0, s: { s: size, f: 'Inter-Black', t, fc: [0.96, 0.94, 0.9], j: 2 } }] }, a: [] });

// two scenes of 2 s at 30 fps, one after the other: a title rising on a dark ground, then a logo popping while the camera pushes in
const lottie = {
  v: '5.7.0', fr: 30, ip: 0, op: 120, w: 1920, h: 1080,
  fonts: { list: [{ fName: 'Inter-Black', fFamily: 'Inter', fStyle: 'Black' }] },
  assets: [],
  layers: [
    { ind: 1, ty: 5, nm: 'Title', ip: 0, op: 60, ks: ks({ p: { a: 1, k: [kf(0, [960, 640, 0]), kf(15, [960, 540, 0])] }, o: { a: 1, k: [kf(0, [0]), kf(12, [100])] } }), t: text('SHIP FASTER WITH LUMORA', 96) },
    { ind: 2, ty: 1, nm: 'Ground', ip: 0, op: 60, sw: 1920, sh: 1080, sc: '#111111', ks: ks({ p: { a: 0, k: [0, 0, 0] } }) },
    { ind: 3, ty: 3, nm: 'Camera', ip: 60, op: 120, ks: ks({ s: { a: 1, k: [kf(60, [100, 100, 100]), kf(120, [115, 115, 100])] } }) },
    { ind: 4, ty: 4, nm: 'Brand logo', parent: 3, ip: 60, op: 120, ks: ks({ s: { a: 1, k: [kf(60, [0, 0, 100]), kf(68, [110, 110, 100]), kf(74, [100, 100, 100])] } }),
      shapes: [{ ty: 'gr', it: [{ ty: 'rc', s: { a: 0, k: [300, 300] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 40 } }, { ty: 'fl', c: { a: 0, k: [1, 0.4, 0.1, 1] }, o: { a: 0, k: 100 } }] }] },
    { ind: 5, ty: 1, nm: 'Paper', ip: 60, op: 120, sw: 1920, sh: 1080, sc: '#F2F0EA', ks: ks({ p: { a: 0, k: [0, 0, 0] } }) },
  ],
};

it('skips placeholders whose out frame equals their in frame', () => {
  const source = { ...lottie, layers: [{ ind: 1, ty: 4, nm: 'Card', ip: 0, op: 0, ks: ks(), shapes: [] }, { ind: 2, ty: 1, nm: 'Visible', ip: 0, op: 30, sw: 50, sh: 50, sc: '#ffffff', ks: ks() }] };
  const { doc } = fromLottie(source);
  expect(Object.values(doc.compositions.main.layers).some((x) => x.name === 'Card')).toBe(false);
});

it('keeps a zero-length parent as a transform source', () => {
  const source = { ...lottie, layers: [
    { ind: 1, ty: 4, nm: 'Parent', ip: 0, op: 0, ks: ks({ p: { a: 0, k: [200, 150] } }), shapes: [] },
    { ind: 2, ty: 1, nm: 'Visible', parent: 1, ip: 0, op: 30, sw: 50, sh: 50, sc: '#ffffff', ks: ks() },
  ] };
  const { doc } = fromLottie(source);
  expect(doc.compositions.main.layers.Parent.transform?.position).toEqual([200, 150]);
  expect(Object.values(doc.compositions.main.layers).some((x) => x.children?.includes('Visible'))).toBe(true);
});

it('combines position axes animated separately when only one is animated', () => {
  const source = { ...lottie, layers: [{ ind: 1, ty: 4, nm: 'Card', ip: 0, op: 60, ks: ks({ p: { s: true, x: { a: 0, k: 200 }, y: { a: 1, k: [kf(0, [100]), kf(30, [300])] } } }), shapes: [] }] };
  const { doc } = fromLottie(source);
  const position = doc.compositions.main.layers.Card.transform!.position as { $k: { t: number; v: number[] }[] };
  expect(sampleKeyframes('vec2', position.$k, 0, {})).toEqual([200, 100]);
  expect(sampleKeyframes('vec2', position.$k, 1, {})).toEqual([200, 300]);
});

it('preserves independent holds and easing on separate position axes', () => {
  const p = { s: true, x: { a: 1, k: [{ t: 0, s: [100], h: 1 }, { t: 25, s: [300] }] }, y: { a: 1, k: [{ t: 0, s: [100] }, { t: 25, s: [300] }] } };
  const source = { ...lottie, fr: 25, layers: [{ ind: 1, ty: 4, nm: 'Card', ip: 0, op: 50, ks: ks({ p }), shapes: [] }] };
  const { doc } = fromLottie(source);
  const position = doc.compositions.main.layers.Card.transform!.position as { $k: { t: number; v: number[] }[] };
  expect(sampleKeyframes('vec2', position.$k, 0.48, {})).toEqual([100, 196]);
  expect(sampleKeyframes('vec2', position.$k, 1, {})).toEqual([300, 300]);
});

describe('the reading of a Lottie reference', () => {
  const r = readingFromLottie(lottie, 'ref', 'Lumora promo');

  it('is a valid reading of the film\'s length and format', () => {
    expect(readingIssues(r)).toEqual([]);
    expect(r).toMatchObject({ from: 'lottie', duration: 4, width: 1920, height: 1080, source: 'ref', name: 'Lumora promo' });
  });

  it('cuts it where most of its layers change', () => {
    expect(r.scenes.map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 4]]);
  });

  it('reads the title, its place, its words and its entrance', () => {
    const [title] = r.scenes[0].slots;
    expect(title).toMatchObject({ role: 'headline', enter: 'rise', at: 0, words: 4 });
    expect(title.box[1]).toBeGreaterThan(0.45);
    expect(title.box[1]).toBeLessThan(0.65);
    expect(r.scenes[0].kind).toBe('type');
    expect(r.scenes[0].text).toBe('held');
  });

  it('reads the logo popping and the camera pushing in, the full-frame grounds left out', () => {
    const s = r.scenes[1];
    expect(s.slots.map((x) => x.role)).toEqual(['logo']);
    expect(s.slots[0].enter).toBe('pop');
    expect(s.moves).toContainEqual(expect.objectContaining({ subject: 'camera', kind: 'push-in', start: 0, end: 2 }));
  });

  it('keeps its colours, its type and the words it shows', () => {
    expect(r.palette).toEqual(expect.arrayContaining(['#111111', '#F2F0EA', '#FF661A']));
    expect(r.type).toMatchObject({ weight: 'heavy', case: 'upper', serif: false });
    expect(r.type.description).toContain('Inter');
    expect(r.texts).toEqual(['SHIP FASTER WITH LUMORA']);
  });

  it('makes precomps laid one after the other its scenes', () => {
    const pre = { ...lottie, layers: [
      { ind: 1, ty: 0, nm: 'Intro', refId: 'a', ip: 0, op: 45, w: 1920, h: 1080, ks: ks() },
      { ind: 2, ty: 0, nm: 'Outro', refId: 'b', ip: 45, op: 120, w: 1920, h: 1080, ks: ks() },
    ] };
    expect(readingFromLottie(pre, 'ref', 'x').scenes.map((s) => s.end)).toEqual([1.5, 4]);
  });
});
