import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { applyOps, validate, type Subjects, type ToolContext, type ToolOutput, type Transcript, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { brandOf, candidatesOf, centroidOf, focusTrack, jumpy, keywordAt, momentsOf, pushIn, shortsOf, SHORTS_TOOLS, titleSpan } from '../src/shorts.ts';

const shorts = SHORTS_TOOLS[0];
const run = (input: unknown, ctx: ToolContext) => shorts.run(input as never, ctx) as Promise<ToolOutput>;

const wordsOf = (lines: [number, string][]): Transcript => {
  const words: Transcript['words'] = [];
  for (const [s, line] of lines) for (const [i, w] of line.split(' ').entries()) words.push({ w, s: s + i * 0.3, e: s + i * 0.3 + 0.28 });
  return { version: 1, duration: words[words.length - 1].e, language: 'en', words };
};

describe('candidates', () => {
  it('packs sentences between min and max, cut on long pauses', () => {
    const lines: [number, string][] = [];
    for (let i = 0; i < 20; i++) lines.push([i * 3.2, `Sentence number ${i} says its thing.`]);
    const cands = candidatesOf(wordsOf(lines), { min: 15, max: 45 });
    expect(cands.length).toBeGreaterThanOrEqual(3);
    // every passage but the last (the transcript ends mid-window) holds its span
    for (const c of cands.slice(0, -1)) {
      expect(c.to - c.from).toBeGreaterThanOrEqual(14);
      expect(c.to - c.from).toBeLessThanOrEqual(46);
    }
    for (const c of cands) {
      expect(c.from).toBeGreaterThanOrEqual(0);
      expect(c.text).toContain('Sentence');
    }
  });

  it('never spans a long pause: dead air is not what a short is made of', () => {
    const t = wordsOf([[0, 'A first lone sentence.'], [40, 'Much later another one arrives.'], [43, 'And it finishes the idea here.']]);
    const cands = candidatesOf(t, { min: 5, max: 45 });
    expect(cands).toHaveLength(2);
    expect(cands[0].to).toBeLessThan(5);
    expect(cands[1].from).toBeGreaterThan(39);
  });
});

function doc(): TrammeDoc {
  const { doc } = newProject({ name: 'Talk', width: 1920, height: 1080, fps: 30, duration: 60 });
  doc.assets.talk = { type: 'video', src: 'assets/video/talk.mp4' };
  doc.assets['transcription-talk'] = { type: 'json', src: 'assets/transcripts/talk.json' };
  return doc;
}

const transcript = wordsOf([[2, 'This is the big idea and it lands here.'], [5, 'Here comes the proof of it, plainly.'], [8, 'And that is the whole point.'], [9.9, 'Good.']]);

// someone at x 0.2 of the picture, then at x 0.8, held between the analysed frames
const subjects: Subjects = {
  version: 1, kind: 'subjects', width: 2, height: 2,
  frames: [
    { t: 0, boxes: [{ x: 0.1, y: 0.2, w: 0.2, h: 0.4, label: 'person', score: 0.9 }] },
    { t: 1, boxes: [{ x: 0.15, y: 0.3, w: 0.1, h: 0.2, label: 'person', score: 0.95 }] },
    { t: 2, boxes: [] },
    { t: 3, boxes: [{ x: 0.7, y: 0.2, w: 0.2, h: 0.4, label: 'person', score: 0.8 }, { x: 0.1, y: 0, w: 0.1, h: 0.2, label: 'person', score: 0.9 }] },
    { t: 3.5, boxes: [{ x: 0.72, y: 0.2, w: 0.2, h: 0.4, label: 'person', score: 0.8 }] },
  ],
};

describe('the frame follows the subject', () => {
  it('the biggest person drives the focus, held when nobody is found, small drifts ignored', () => {
    const track = focusTrack(subjects, 0, 4);
    expect(track.map((k) => k.t)).toEqual([0, 3]);
    expect(track[0].v).toEqual([0.2, 0.4]);
    expect(track[1].v[0]).toBeCloseTo(0.8);
    expect(track[1].v[1]).toBeCloseTo(0.4);
  });

  it('the window of the passage is respected', () => {
    expect(focusTrack(subjects, 2.5, 4).map((k) => k.t)).toEqual([3]);
  });

  it('the build animates the focus when a subjects analysis exists', async () => {
    const d = doc();
    d.assets['subjects-talk'] = { type: 'json', src: 'subjects-talk.json' };
    const read = new Map([['subjects-talk.json', JSON.stringify(subjects)]]);
    const out = await run({ asset: 'talk', plan: [{ from: 0, to: 4, title: 'Framed' }] }, ctxOf(d, new Map(), read));
    const next = applyOps(d, out.ops!).doc;
    expect(validate(next, builtinRegistry())).toEqual([]);
    const video = Object.values(next.compositions['short-framed'].layers).find((l) => l.type === 'video');
    const keys = (video?.props?.focus as { $k: { t: number; v: number[] }[] }).$k;
    expect(keys.map((k) => k.t)).toEqual([0, 3]);
    expect(keys[1].v[0]).toBeCloseTo(0.8);
  });
});

const ctxOf = (d: TrammeDoc, written: Map<string, string> = new Map(), read: Map<string, string> = new Map()): ToolContext =>
  ({
    doc: d, compId: d.root, registry: builtinRegistry(), time: 0, selection: [],
    transcript: async (id: string) => {
      if (id !== 'transcription-talk') throw new Error(`no transcript ${id}`);
      return transcript;
    },
    writeFile: async (p: string, data: string | Blob) => {
      written.set(p, typeof data === 'string' ? data : '');
      return p;
    },
    readText: async (p: string) => read.get(p) ?? null,
    assetUrl: () => '', signal: new AbortController().signal,
  }) as unknown as ToolContext;

describe('the shorts tool', () => {
  it('lists the candidates with their times and what is said', async () => {
    const out = await run({ asset: 'talk', min: 2 }, ctxOf(doc()));
    expect(out.text).toContain('passage(s) that stand alone');
    expect(out.text).toMatch(/\[\d+\.\d–\d+\.\d s/);
  });

  it('refuses an asset without a transcript, with the way out', async () => {
    const d = doc();
    delete d.assets['transcription-talk'];
    await expect(run({ asset: 'talk' }, ctxOf(d))).rejects.toThrow(/get_transcript/);
  });

  it('builds one composition per passage: framed video, remapped transcript, captions, title', async () => {
    const d = doc(), written = new Map<string, string>();
    const out = await run({ asset: 'talk', plan: [{ from: 2, to: 10, title: 'The big idea' }] }, ctxOf(d, written));
    const next = applyOps(d, out.ops!).doc;
    expect(validate(next, builtinRegistry())).toEqual([]);
    const c = next.compositions['short-the-big-idea'];
    expect(c).toMatchObject({ width: 1080, height: 1920, fps: 30 });
    expect(c.duration).toBeCloseTo(8);
    const video = Object.values(c.layers).find((l) => l.type === 'video');
    expect(video?.props).toMatchObject({ video: 'talk', start: 2, fit: 'cover', size: [1080, 1920] });
    const captions = Object.values(c.layers).find((l) => l.type === 'captions');
    expect(String(captions?.props?.transcript)).toBe('transcription-talk-short1');
    expect(Object.values(c.layers).filter((l) => l.type === 'text').length).toBeGreaterThanOrEqual(1);
    // the captions and the title above the footage
    const idOf = (type: string) => Object.keys(c.layers).find((id) => c.layers[id].type === type)!;
    expect(c.order.indexOf(idOf('captions'))).toBeGreaterThan(c.order.indexOf(idOf('video')));
    // the transcript of the short starts at 0 and is a file of the project
    const sid = Object.keys(next.assets).find((id) => id.startsWith('transcription-talk-short'));
    expect(next.assets[sid!].src).toBe('assets/transcripts/talk-short-1.json');
    const remapped = JSON.parse(written.get('assets/transcripts/talk-short-1.json')!) as Transcript;
    expect(remapped.words[0].s).toBeCloseTo(0, 1);
    expect(remapped.duration).toBeCloseTo(8, 1);
  });

  it('keeps two shorts apart, each with its own transcript', async () => {
    const d = doc();
    const out = await run({ asset: 'talk', plan: [{ from: 2, to: 8, title: 'One' }, { from: 8, to: 9.5, title: 'Too short' }] }, ctxOf(d));
    const next = applyOps(d, out.ops!).doc;
    expect(validate(next, builtinRegistry())).toEqual([]);
    // the second passage is under 2 s: skipped, only the first stands
    expect(Object.keys(next.compositions).filter((id) => id.startsWith('short-'))).toHaveLength(1);
    expect(out.text).toContain('1 short(s) built');
  });

  it('lists the built shorts for the batch (export queue, contact sheet)', async () => {
    const d = doc();
    const out = await run({ asset: 'talk', plan: [{ from: 2, to: 8, title: 'One thing' }, { from: 8, to: 10, title: 'Another' }] }, ctxOf(d));
    const next = applyOps(d, out.ops!).doc;
    expect(shortsOf(next).map((s) => s.name)).toEqual(['One thing', 'Another']);
    expect(shortsOf(d)).toEqual([]); // the ops are a proposal: the document is untouched
  });
});

describe('the hook', () => {
  it('the title lands no later than the first word and holds to the first sentence, capped', () => {
    const t = wordsOf([[0.5, 'Everything changed when this happened.'], [3, 'Let me explain how.']]);
    const span = titleSpan(t);
    expect(span.at).toBeLessThanOrEqual(0.5);
    expect(span.at).toBeGreaterThan(0);
    // the first sentence ends at 0.5 + 5 words' span: held past it, capped at 3.5 s
    expect(span.duration).toBeGreaterThan(1.2);
    expect(span.duration).toBeLessThanOrEqual(3.5);
    // speech already at 0: the title is there from the first frame
    expect(titleSpan(wordsOf([[0, 'No air before this one.']])).at).toBe(0);
  });

  it('the keyword pops when it is said, and says so when it is not', async () => {
    const t = wordsOf([[2, 'This is the big idea and it lands here.']]);
    expect(keywordAt(t, 'big')).toBeCloseTo(2.9);
    expect(keywordAt(t, 'idea')).toBeCloseTo(3.2);
    expect(keywordAt(t, 'silence')).toBeNull();
    const d = doc();
    const out = await run({ asset: 'talk', plan: [{ from: 2, to: 10, title: 'The big idea', keyword: 'idea' }] }, ctxOf(d));
    const next = applyOps(d, out.ops!).doc;
    expect(validate(next, builtinRegistry())).toEqual([]);
    const c = next.compositions['short-the-big-idea'];
    const kw = Object.values(c.layers).find((l) => l.type === 'text' && String(l.name).includes('Keyword'));
    // said 3.2 s into the file, 2 s into the passage
    expect(kw?.in).toBeCloseTo(3.2 - 2, 1);
    // a keyword not said: nothing placed, the answer says it
    const miss = await run({ asset: 'talk', plan: [{ from: 2, to: 10, title: 'The big idea', keyword: 'elephant' }] }, ctxOf(doc()));
    expect(miss.text).toContain('not said in their passage');
    expect(miss.text).toContain('elephant');
    const c2 = applyOps(doc(), miss.ops!).doc.compositions['short-the-big-idea'];
    expect(Object.values(c2.layers).filter((l) => l.type === 'text' && String(l.name).includes('Keyword'))).toHaveLength(0);
  });

  it('the brand brings the progress bar and the end card, and the end card lengthens the short', async () => {
    const d = doc();
    d.tokens.plate = { type: 'color', value: '#0B132B' };
    d.tokens.ink = { type: 'color', value: '#FFFFFF' };
    expect(brandOf(d)).toEqual({ plate: '#0B132B', ink: '#FFFFFF' });
    const out = await run({ asset: 'talk', plan: [{ from: 2, to: 10, title: 'Branded' }] }, ctxOf(d));
    const next = applyOps(d, out.ops!).doc;
    expect(validate(next, builtinRegistry())).toEqual([]);
    const c = next.compositions['short-branded'];
    expect(c.duration).toBeCloseTo(10.5); // 8 s of passage + 2.5 s of card
    expect(Object.values(c.layers).some((l) => String(l.name).includes('Progress bar'))).toBe(true);
    expect(Object.values(c.layers).some((l) => String(l.name).includes('End card'))).toBe(true);
    // no brand: neither appears, and the short keeps the passage's length
    expect(brandOf(doc())).toBeNull();
    const plain = applyOps(doc(), (await run({ asset: 'talk', plan: [{ from: 2, to: 10, title: 'Plain' }] }, ctxOf(doc()))).ops!).doc;
    const pc = plain.compositions['short-plain'];
    expect(pc.duration).toBeCloseTo(8);
    expect(Object.values(pc.layers).some((l) => String(l.name).includes('Progress bar'))).toBe(false);
  });
});

describe('the zoom and the fallbacks of the frame', () => {
  const person = (t: number, x: number, h: number) => ({ t, boxes: [{ x, y: 0.3, w: h * 0.5, h, label: 'person', score: 0.9 }] });
  it('a person small in the frame gains a gentle push-in, never over 1.25', () => {
    const small: Subjects = { version: 1, kind: 'subjects', width: 2, height: 2, frames: [person(0, 0.4, 0.2), person(1, 0.4, 0.22), person(2, 0.41, 0.2)] };
    expect(pushIn(small, 0, 3)).toBe(1.25);
    const mid: Subjects = { ...small, frames: [person(0, 0.4, 0.32), person(1, 0.4, 0.3)] };
    expect(pushIn(mid, 0, 3)).toBeCloseTo(1.25, 2);
    expect(pushIn(subjects, 0, 4)).toBeNull();
  });

  it('the boxes jump when the person is lost often or leaps across the picture', () => {
    expect(jumpy(subjects, 0, 4)).toBe(false);
    const lost: Subjects = { ...subjects, frames: [person(0, 0.4, 0.4), { t: 1, boxes: [] }, { t: 2, boxes: [] }, person(3, 0.4, 0.4)] };
    expect(jumpy(lost, 0, 4)).toBe(true);
    const leaping: Subjects = { ...subjects, frames: [person(0, 0.1, 0.4), person(1, 0.7, 0.4), person(2, 0.1, 0.4), person(3, 0.7, 0.4)] };
    expect(jumpy(leaping, 0, 4)).toBe(true);
  });

  it('reads where the white of a mask is', () => {
    const w = 10, h = 10, px = new Uint8ClampedArray(w * h * 4);
    for (let y = 2; y < 4; y++) for (let x = 6; x < 8; x++) { const i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = 255; }
    const c = centroidOf(px, w, h)!;
    expect(c[0]).toBeCloseTo(0.7, 6);
    expect(c[1]).toBeCloseTo(0.3, 6);
    expect(centroidOf(new Uint8ClampedArray(w * h * 4), w, h)).toBeNull();
  });
});

describe('candidates without speech', () => {
  /** a sound of 120 s: quiet, a louder section from 60 s, a peak around 95 s */
  const analysis = () => {
    const rate = 50, n = 120 * rate;
    const rms = Array.from({ length: n }, (_, i) => (i < 60 * rate ? 0.2 : 0.7) + (Math.abs(i / rate - 95) < 3 ? 0.3 : 0));
    return { version: 1, kind: 'audio-analysis', duration: 120, rate, envelope: { rms, low: rms, mid: rms, high: rms }, onsets: [], tempo: 120, beats: [], downbeats: [40, 42, 78, 80], sections: [{ t: 0, level: 0.2 }, { t: 60, level: 0.7 }] } as never;
  };
  const shots = { duration: 120, cuts: [41.2, 70, 72, 74, 101] };

  it('finds the build-up and the loudest moment, snapped to cuts and bar lines, described in words', () => {
    const m = momentsOf(analysis(), shots, { min: 15, max: 45 });
    expect(m.length).toBeGreaterThanOrEqual(2);
    const build = m.find((c) => /build-up/.test(c.text))!;
    // the change lands two thirds in, the start on the nearest cut or bar line
    expect(build.from).toBe(40); // 40.5 asked: the bar line at 40 is nearer than the cut at 41.2
    expect(build.to).toBeGreaterThan(60);
    expect(m.some((c) => /loudest moment around 9\d/.test(c.text))).toBe(true);
    expect(m.every((c) => c.words === 0 && /cut|one shot/.test(c.text))).toBe(true);
    // no two candidates overlap by more than half
    for (const a of m) for (const b of m) if (a !== b) expect(Math.min(a.to, b.to) - Math.max(a.from, b.from)).toBeLessThanOrEqual(0.5 * (a.to - a.from) + 1e-6);
  });

  it('works from the cuts alone, and from nothing gives nothing', () => {
    expect(momentsOf(null, shots).length).toBeGreaterThan(0);
    expect(momentsOf(null, null)).toEqual([]);
  });

  it('the tool lists them for a video without a transcript, then builds without captions', async () => {
    const d = doc();
    delete d.assets['transcription-talk'];
    d.assets['analysis-talk'] = { type: 'json', src: 'analysis-talk.json' };
    d.assets['shots-talk'] = { type: 'json', src: 'shots-talk.json' };
    const read = new Map([['analysis-talk.json', JSON.stringify(analysis())], ['shots-talk.json', JSON.stringify(shots)]]);
    const out = await run({ asset: 'talk' }, ctxOf(d, new Map(), read));
    expect(out.text).toMatch(/nobody speaks/);
    const built = await run({ asset: 'talk', plan: [{ from: 41.2, to: 70, title: 'The drop' }] }, ctxOf(d, new Map(), read));
    const next = applyOps(d, built.ops!).doc;
    expect(validate(next, builtinRegistry())).toEqual([]);
    const c = next.compositions['short-the-drop'];
    expect(Object.values(c.layers).some((l) => l.type === 'captions')).toBe(false);
    expect(Object.values(c.layers).some((l) => l.type === 'video')).toBe(true);
  });
});
