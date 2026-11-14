import { describe, expect, it } from 'vitest';
import { assignSlots, contentIssues, dropScene, mergeScenes, gridPlace, gridTime, paceOf, parseReading, readingIssues, readingText, retime, scenesFromCuts, structureIssues, validate, type BuiltScene, type Reading, type ReadingScene } from '../src/index.ts';
import { makeDoc, registry } from './fixtures.ts';

// a music at 120 bpm in 4/4: a beat every 0.5 s, a bar every 2 s
const beats = Array.from({ length: 33 }, (_, i) => i * 0.5);
const bars = beats.filter((_, i) => i % 4 === 0);

const scene = (id: string, start: number, end: number, more: Partial<ReadingScene> = {}): ReadingScene => ({
  id, start, end, kind: 'type', what: 'a title set large', slots: [], moves: [], transition: 'cut', text: 'none', ...more,
});

const reading = (scenes: ReadingScene[], more: Partial<Reading> = {}): Reading => ({
  version: 1, kind: 'reference-reading', source: 'ref', name: 'Ref', from: 'video', duration: scenes.at(-1)!.end, width: 1920, height: 1080,
  scenes, palette: ['#101010', '#F2F0EA'], type: { description: 'condensed grotesque, heavy, capitals' }, texts: [], ...more,
});

describe('the music grid of a reference', () => {
  it('places a time on its bar and beat, within a tolerance', () => {
    expect(gridPlace(2.5, beats, bars)).toEqual({ bar: 1, beat: 1 });
    expect(gridPlace(4.03, beats, bars)).toEqual({ bar: 2, beat: 0 });
    expect(gridPlace(4.25, beats, bars)).toBeUndefined();
    expect(gridPlace(1, [], [])).toBeUndefined();
  });

  it('finds the time of a place on another music', () => {
    // 100 bpm: a beat every 0.6 s, a bar every 2.4 s
    const b2 = Array.from({ length: 30 }, (_, i) => +(i * 0.6).toFixed(2)), bars2 = b2.filter((_, i) => i % 4 === 0);
    expect(gridTime({ bar: 1, beat: 1 }, b2, bars2)).toBeCloseTo(3);
    expect(gridTime({ bar: 40, beat: 0 }, b2, bars2)).toBeUndefined();
  });

  it('makes the scenes of a video from its cuts, each on the beat it falls on', () => {
    const s = scenesFromCuts([2.01, 3.3, 6], 8, { beats, bars });
    expect(s.map((x) => [x.start, x.end])).toEqual([[0, 2.01], [2.01, 3.3], [3.3, 6], [6, 8]]);
    expect(s[1].onBeat).toEqual({ bar: 1, beat: 0 });
    expect(s[2].onBeat).toBeUndefined();
    expect(s[3].onBeat).toEqual({ bar: 3, beat: 0 });
    expect(s[0].onBeat).toBeUndefined();
  });

  it('measures the pace', () => {
    expect(paceOf([scene('a', 0, 1), scene('b', 1, 4)])).toEqual({ cuts: 1, perSecond: 0.25, mean: 2, shortest: 1, longest: 3 });
  });

  it('retimes the cuts on the beats onto the same places of another music, the others keeping their length', () => {
    const b2 = Array.from({ length: 40 }, (_, i) => +(i * 0.6).toFixed(2)), bars2 = b2.filter((_, i) => i % 4 === 0);
    const r = reading([scene('a', 0, 2), scene('b', 2, 3.3, { onBeat: { bar: 1, beat: 0 } }), scene('c', 3.3, 6)]);
    expect(retime(r, { beats: b2, bars: bars2 })).toEqual([{ id: 'a', start: 0, end: 2.4 }, { id: 'b', start: 2.4, end: 3.7 }, { id: 'c', start: 3.7, end: 6.4 }]);
    // with no music of the user's, the reference's timing
    expect(retime(r)).toEqual([{ id: 'a', start: 0, end: 2 }, { id: 'b', start: 2, end: 3.3 }, { id: 'c', start: 3.3, end: 6 }]);
  });
});

describe('the file of a reading', () => {
  it('parses a reading and refuses what is not one', () => {
    const r = reading([scene('a', 0, 2)]);
    expect(parseReading(JSON.stringify(r))).toEqual(r);
    expect(parseReading('{"kind":"film-plan"}')).toBeNull();
    expect(parseReading('not json')).toBeNull();
  });

  it('says when its times do not follow each other, and a move of a slot that is not there', () => {
    const r = reading([scene('a', 0, 2), scene('b', 2.5, 4, { moves: [{ subject: 'logo', kind: 'scale', start: 0, end: 1 }] })]);
    const lines = readingIssues(r);
    expect(lines.some((l) => /b: starts at 2.5/.test(l))).toBe(true);
    expect(lines.some((l) => /no slot/.test(l))).toBe(true);
    expect(readingIssues({ kind: 'reference-reading' }).length).toBeGreaterThan(0);
    expect(readingIssues(reading([scene('a', 0, 2), scene('b', 2, 4)]))).toEqual([]);
  });

  it('reads as text for the model, with the slots and the asset proposed for each', () => {
    const r = reading([scene('a', 0, 2, { onBeat: undefined, slots: [{ id: 'logo', role: 'logo', box: [0.4, 0.4, 0.2, 0.2], enter: 'scale', at: 0.2, asset: 'mark' }], moves: [{ subject: 'camera', kind: 'push-in', start: 0, end: 2 }] })], { tempo: 120 });
    const text = readingText(r);
    expect(text).toContain('120 bpm');
    expect(text).toContain('slot logo: logo at x 0.40 y 0.40 w 0.20 h 0.20, enters by scale at 0.20 s → asset "mark"');
    expect(text).toContain('move: camera push-in 0.00–2.00 s');
  });
});

describe('the user\'s assets in the slots', () => {
  const slot = (id: string, role: ReadingScene['slots'][number]['role']) => ({ id, role, box: [0, 0, 0.5, 0.5] as [number, number, number, number], enter: 'fade' as const, at: 0 });
  const r = reading([
    scene('a', 0, 2, { slots: [slot('mark', 'logo'), slot('title', 'headline')] }),
    scene('b', 2, 4, { slots: [slot('phone', 'screenshot'), slot('pic', 'photo')] }),
    scene('c', 4, 6, { slots: [slot('pic2', 'photo'), slot('end', 'logo'), slot('chart', 'figure')] }),
  ]);

  it('puts the logo in every logo slot, a screen in the screen, each other picture once while another is unused', () => {
    const assets = [
      { id: 'brand-logo', type: 'image', name: 'Acme logo' },
      { id: 'app', type: 'image', name: 'dashboard capture' },
      { id: 'p1', type: 'image', name: 'office' },
      { id: 'p2', type: 'image', name: 'street' },
    ];
    const out = assignSlots(r, assets);
    const of = (s: number, i: number) => out.scenes[s].slots[i];
    expect(of(0, 0).asset).toBe('brand-logo');
    expect(of(0, 1).fill).toBe('words');
    expect(of(1, 0).asset).toBe('app');
    expect([of(1, 1).asset, of(2, 0).asset].sort()).toEqual(['p1', 'p2']);
    expect(of(2, 1).asset).toBe('brand-logo');
    expect(of(2, 2).fill).toBe('build');
    expect(out.missing).toEqual([]);
  });

  it('names the slots nothing fits, and keeps an asset the user chose', () => {
    const chosen = { ...r, scenes: r.scenes.map((s) => (s.id === 'b' ? { ...s, slots: s.slots.map((sl) => (sl.id === 'pic' ? { ...sl, asset: 'mine' } : sl)) } : s)) };
    const out = assignSlots(chosen, [{ id: 'mine', type: 'image', name: 'x' }]);
    expect(out.scenes[1].slots[1].asset).toBe('mine');
    expect(out.missing.map((m) => m.slot)).toEqual(['mark', 'end']);
    // a picture shaped like a screen goes in the screen
    expect(out.scenes[1].slots[0].asset).toBe('mine');
  });

  it('takes a picture shaped like a screen for a screen when its name says nothing', () => {
    const out = assignSlots(reading([scene('a', 0, 2, { slots: [slot('s', 'screenshot'), slot('p', 'photo')] })]), [
      { id: 'square', type: 'image', name: 'IMG_1', width: 1000, height: 1000 },
      { id: 'wide', type: 'image', name: 'IMG_2', width: 1920, height: 1080 },
    ]);
    expect(out.scenes[0].slots[0].asset).toBe('wide');
    expect(out.scenes[0].slots[1].asset).toBe('square');
  });
});

describe('the checks against the reference', () => {
  const r = reading([
    scene('a', 0, 2, { slots: [{ id: 'title', role: 'headline', box: [0.1, 0.4, 0.8, 0.2], enter: 'rise', at: 0.2, words: 3 }], moves: [{ subject: 'camera', kind: 'push-in', start: 0, end: 2 }] }),
    scene('b', 2, 4, { onBeat: { bar: 1, beat: 0 }, transition: 'whip', slots: [{ id: 'pic', role: 'photo', box: [0, 0, 1, 1], enter: 'none', at: 0 }] }),
  ]);
  const good: BuiltScene[] = [
    { follows: 'a', start: 0, end: 2, slots: { title: [0.12, 0.41, 0.78, 0.2] }, moves: ['push-in'] },
    { follows: 'b', start: 2, end: 4, slots: { pic: [0, 0, 1, 1] }, moves: [], transition: 'whip' },
  ];

  it('finds nothing when the film follows the reading', () => {
    expect(structureIssues(r, good)).toEqual([]);
  });

  it('names a scene missing, a length off, a cut off its beat, a slot moved or empty, a move not made, another transition', () => {
    const bad: BuiltScene[] = [
      { follows: 'a', start: 0, end: 2.6, slots: { title: [0.1, 0.05, 0.8, 0.2] }, moves: ['rotate'] },
      { follows: 'b', start: 2.6, end: 4.6, slots: { pic: null }, moves: [], transition: 'fade' },
      { follows: 'z', start: 4.6, end: 5, slots: {}, moves: [] },
    ];
    const found = structureIssues(r, bad), lines = found.map((i) => i.line);
    expect(found.filter((i) => i.blocking).map((i) => i.line.split(':')[0])).toEqual(['a', 'b', 'b, pic', '1 scene(s) of the film follow no scene of the reference']);
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringMatching(/^a: lasts 2.60 s/),
      expect.stringMatching(/^a, title: the headline sits at/),
      expect.stringMatching(/^a: the reference's push-in of camera is not made/),
      expect.stringMatching(/^b: starts at 2.60 s, its cut is on bar 2 beat 1/),
      expect.stringMatching(/^b, pic: the photo slot is empty/),
      expect.stringMatching(/^b: comes by fade, the reference's by whip/),
      expect.stringMatching(/follow no scene of the reference: z/),
    ]));
    expect(structureIssues(r, [good[0]])).toContainEqual({ line: 'b: no scene of the film follows it', blocking: true });
  });

  it('checks the cuts against the user\'s timing when the film has its own music', () => {
    const timing = [{ id: 'a', start: 0, end: 2.4 }, { id: 'b', start: 2.4, end: 4.4 }];
    const built = [{ ...good[0], end: 2.4 }, { ...good[1], start: 2.4, end: 4.4 }];
    expect(structureIssues(r, built, timing)).toEqual([]);
  });

  it('finds the reference\'s words in the film, but not the user\'s own', () => {
    const lines = contentIssues(['Meet Lumora, the fastest way to ship', 'Try Lumora 2 today'], ['Fastest way to ship your invoices', 'Lumora inside'], 'Acme invoices: the way to ship invoices');
    expect(lines).toContain('the film says "fastest way to", words of the reference');
    expect(lines).toContain('the film shows "Lumora", a name of the reference');
    expect(lines.some((l) => /"way to ship"/.test(l))).toBe(false);
    expect(contentIssues(['Meet Lumora'], ['Acme, the way to bill'], 'Acme')).toEqual([]);
  });
});

describe('a reference asset in the document', () => {
  it('is never shown by a layer, and is a video, a gif or a Lottie', () => {
    const doc = makeDoc();
    doc.assets.ref = { type: 'image', src: 'assets/references/ref.gif', reference: true };
    doc.assets.font = { type: 'font', src: 'x.woff2', reference: true };
    const first = Object.values(doc.compositions[doc.root].layers).find((l) => l.type === 'box')!;
    first.props = { ...first.props, image: 'ref' };
    const issues = validate(doc, registry()).map((i) => i.message);
    expect(issues.some((m) => /"ref" is a reference/.test(m))).toBe(true);
    expect(issues.some((m) => /a reference is a video, a gif or a Lottie/.test(m))).toBe(true);
  });
});

describe('the outline the user corrects', () => {
  const slot = (id: string, at: number) => ({ id, role: 'photo' as const, box: [0, 0, 1, 1] as [number, number, number, number], enter: 'fade' as const, at });
  const r = reading([
    scene('a', 0, 2, { slots: [slot('pic', 0.2)], what: 'A photo fills the frame.' }),
    scene('b', 2, 3, { slots: [slot('pic', 0.1)], moves: [{ subject: 'pic', kind: 'scale', start: 0.2, end: 0.9 }], what: 'Another photo scales up.' }),
    scene('c', 3, 5),
  ]);

  it('merges a scene with the next, its slots and moves timed from the first\'s start', () => {
    const m = mergeScenes(r, 'a');
    expect(m.scenes.map((s) => [s.id, s.start, s.end])).toEqual([['a', 0, 3], ['c', 3, 5]]);
    expect(m.scenes[0].slots.map((s) => [s.id, s.at])).toEqual([['pic', 0.2], ['pic-b', 2.1]]);
    expect(m.scenes[0].moves).toEqual([{ subject: 'pic-b', kind: 'scale', start: 2.2, end: 2.9 }]);
    expect(m.scenes[0].what).toBe('A photo fills the frame. Then another photo scales up.');
    expect(readingIssues(m)).toEqual([]);
    expect(mergeScenes(r, 'c')).toBe(r);
  });

  it('removes a scene, the later ones coming earlier', () => {
    const d = dropScene(r, 'b');
    expect(d.scenes.map((s) => [s.id, s.start, s.end])).toEqual([['a', 0, 2], ['c', 2, 4]]);
    expect(d.duration).toBe(4);
    expect(readingIssues(d)).toEqual([]);
  });
});
