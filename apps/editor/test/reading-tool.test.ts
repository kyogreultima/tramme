import { beforeEach, describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import { parseReading, type Reading, type ToolContext, type ToolOutput, type TrammeDoc } from '@tramme/core';
import { jsonIn, READING_TOOLS, readingId, readingPath, sceneFrom, setReadingHost } from '../src/reading/tool.ts';
import { builtScenes, filmTexts, movesIn } from '../src/reading/built.ts';
import { FILM_PLAN_PATH, FILM_PLAN_TOOLS, planIssues, type FilmPlan } from '../src/filmplan.ts';
import { answer, askReading, question } from '../src/confirm.ts';
import { CRITIC_TOOLS, resetCritic, setCriticHost } from '../src/critic/tool.ts';

const registry = builtinRegistry();
const kf = (t: number, s: number[]) => ({ t, s, o: { x: [0.3], y: [0] }, i: { x: [0.2], y: [1] } });
const ks = (more: Record<string, unknown> = {}) => ({ o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [960, 540, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] }, ...more });
/** a Lottie of two scenes of 2 s: a title rising, then a logo popping */
const LOTTIE = {
  v: '5.7.0', fr: 30, ip: 0, op: 120, w: 1920, h: 1080, assets: [],
  layers: [
    { ind: 1, ty: 5, nm: 'Title', ip: 0, op: 60, ks: ks({ p: { a: 1, k: [kf(0, [960, 640, 0]), kf(15, [960, 540, 0])] } }), t: { d: { k: [{ t: 0, s: { s: 96, t: 'SHIP FASTER WITH LUMORA', fc: [1, 1, 1] } }] }, a: [] } },
    { ind: 2, ty: 4, nm: 'Brand logo', ip: 60, op: 120, ks: ks({ s: { a: 1, k: [kf(60, [0, 0, 100]), kf(68, [110, 110, 100]), kf(74, [100, 100, 100])] } }), shapes: [{ ty: 'gr', it: [{ ty: 'rc', s: { a: 0, k: [300, 300] } }, { ty: 'fl', c: { a: 0, k: [1, 0.4, 0.1, 1] } }] }] },
  ],
};

function project(): TrammeDoc {
  const { doc } = newProject({ name: 'Mine', width: 1920, height: 1080, fps: 30, duration: 4 });
  doc.assets.ref = { type: 'json', src: 'assets/promo.json', name: 'Lumora promo' };
  doc.assets['acme-logo'] = { type: 'image', src: 'assets/acme-logo.png', name: 'Acme logo' };
  return doc;
}

function ctxOf(doc: TrammeDoc, files: Map<string, string>): ToolContext {
  return {
    doc, compId: doc.root, time: 0, selection: [], registry,
    readText: async (p: string) => files.get(p) ?? null,
    writeFile: async (p: string, data: string | Blob) => { files.set(p, typeof data === 'string' ? data : ''); return p; },
    assetUrl: () => '', fileUrl: () => '', files: async () => [], signal: new AbortController().signal,
  } as unknown as ToolContext;
}

const read = READING_TOOLS[0];
const run = (input: object, ctx: ToolContext) => read.run(input as never, ctx) as Promise<ToolOutput>;

describe('reading a reference', () => {
  let asked: Reading | null = null;
  beforeEach(() => {
    asked = null;
    setReadingHost({
      typefaces: async () => ['Inter Tight', 'Archivo'],
      accepted: () => false,
      ask: async (r) => { asked = r; return { ...r, scenes: r.scenes.map((s, i) => (i === 0 ? { ...s, what: 'A title rises into the middle.' } : s)) }; },
    });
  });

  it('reads a Lottie exactly, marks it as a reference, proposes the user\'s logo and saves the reading the user corrected', async () => {
    const doc = project(), files = new Map([['assets/promo.json', JSON.stringify(LOTTIE)]]);
    const out = await run({ asset: 'ref' }, ctxOf(doc, files));
    const saved = parseReading(files.get(readingPath('ref')))!;
    expect(saved.accepted).toBe(true);
    expect(saved.scenes.map((s) => s.what)[0]).toBe('A title rises into the middle.');
    expect(saved.scenes[1].slots[0]).toMatchObject({ role: 'logo', asset: 'acme-logo', fill: 'asset' });
    expect(saved.type.nearest).toEqual(['Inter Tight', 'Archivo']);
    expect(saved.texts).toEqual(['SHIP FASTER WITH LUMORA']);
    expect(asked!.scenes).toHaveLength(2);
    expect(out.ops).toEqual([
      { op: 'add', path: '/assets/ref/reference', value: true },
      { op: 'add', path: `/assets/${readingId('ref')}`, value: { type: 'json', src: readingPath('ref'), name: 'Reading · Lumora promo' } },
    ]);
    expect(out.text).toContain('and accepted');
    expect(out.text).toContain('Nearest typefaces: Inter Tight');
    expect(out.text).toContain('"SHIP FASTER WITH LUMORA"');
    expect(out.text).toContain(`film-plan with reference "${readingId('ref')}"`);
  });

  it('goes on without the outline when readings are accepted in advance', async () => {
    setReadingHost({ accepted: () => true, ask: async () => { throw new Error('never asked'); } });
    const files = new Map([['assets/promo.json', JSON.stringify(LOTTIE)]]);
    await run({}, ctxOf({ ...project(), assets: { ...project().assets, ref: { ...project().assets.ref, reference: true } } }, files));
    expect(parseReading(files.get(readingPath('ref')))!.accepted).toBe(true);
  });

  it('says so when the user declines the reading, and saves it unaccepted', async () => {
    setReadingHost({ ask: async () => null });
    const files = new Map([['assets/promo.json', JSON.stringify(LOTTIE)]]);
    const out = await run({ asset: 'ref' }, ctxOf(project(), files));
    expect(out.text).toContain('did not accept');
    expect(parseReading(files.get(readingPath('ref')))!.accepted).toBeUndefined();
  });

  it('refuses a reference a layer shows, and what is no reference', async () => {
    const doc = project();
    doc.assets.clip = { type: 'video', src: 'assets/clip.mp4' };
    doc.compositions[doc.root].layers.v = { type: 'video', props: { video: 'clip' } } as never;
    await expect(run({ asset: 'clip' }, ctxOf(doc, new Map()))).rejects.toThrow(/is shown by/);
    await expect(run({ asset: 'acme-logo' }, ctxOf(doc, new Map()))).rejects.toThrow(/a reference is a video, a gif or a Lottie/);
    await expect(run({}, ctxOf(doc, new Map()))).rejects.toThrow(/name the reference/);
  });
});

describe('the model\'s answer about a shot', () => {
  it('finds the JSON in an answer', () => {
    expect(jsonIn('Here: {"a": {"b": 1}} done')).toEqual({ a: { b: 1 } });
    expect(jsonIn('no json')).toBeNull();
    expect(jsonIn('{broken')).toBeNull();
  });

  it('keeps the measured times, leaves out the slots and moves it gets wrong, adds the measured camera', () => {
    const s = sceneFrom({ id: 's2', start: 2, end: 4 }, {
      kind: 'interface', what: 'A screen slides in.', transition: 'whip', text: 'word-by-word', ground: 'flat black',
      slots: [
        { id: 'Phone Screen', role: 'screenshot', box: [0.2, 0.1, 0.6, 1.4], enter: 'slide', at: 9 },
        { id: 'bad', role: 'banner', box: [0, 0, 1, 1], enter: 'fade', at: 0 },
      ],
      moves: [{ subject: 'phone-screen', kind: 'rise', start: 0.5, end: 1.5 }, { subject: 'ghost', kind: 'scale', start: 0, end: 1 }],
    }, { subject: 'camera', kind: 'push-in', start: 0, end: 2, direction: 'in', speed: 40 });
    expect(s).toMatchObject({ id: 's2', start: 2, end: 4, kind: 'interface', transition: 'whip', text: 'word-by-word', ground: 'flat black' });
    expect(s.slots).toEqual([{ id: 'phone-screen', role: 'screenshot', box: [0.2, 0.1, 0.6, 1], enter: 'slide', at: 2 }]);
    expect(s.moves.map((m) => `${m.subject} ${m.kind}`)).toEqual(['camera push-in', 'phone-screen rise']);
    expect(sceneFrom({ id: 's1', start: 0, end: 1 }, undefined, null)).toMatchObject({ kind: 'type', transition: 'cut', text: 'none', slots: [], moves: [] });
  });
});

const READING: Reading = {
  version: 1, kind: 'reference-reading', source: 'ref', name: 'Lumora promo', from: 'video', duration: 4, width: 1920, height: 1080,
  beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], bars: [0, 2],
  scenes: [
    { id: 's1', start: 0, end: 2, kind: 'type', what: 'A title rises.', slots: [{ id: 'title', role: 'headline', box: [0.1, 0.4, 0.8, 0.2], enter: 'rise', at: 0.1, words: 4, fill: 'words' }], moves: [], transition: 'cut', text: 'held' },
    { id: 's2', start: 2, end: 4, onBeat: { bar: 1, beat: 0 }, kind: 'interface', what: 'The logo pops while the camera pushes in.', ground: 'paper white', slots: [{ id: 'mark', role: 'logo', box: [0.42, 0.36, 0.16, 0.28], enter: 'pop', at: 0, asset: 'acme-logo', fill: 'asset' }], moves: [{ subject: 'camera', kind: 'push-in', start: 0, end: 2 }], transition: 'whip', text: 'none' },
  ],
  palette: ['#111111', '#F2F0EA'], type: { description: 'condensed grotesque, heavy, capitals', nearest: ['Archivo'] }, texts: ['SHIP FASTER WITH LUMORA'], accepted: true,
};

describe('the film plan from a reading', () => {
  const plan = FILM_PLAN_TOOLS[0];
  const withReading = (r: Reading, music?: { beats: number[]; downbeats: number[] }) => {
    const doc = project();
    doc.assets[readingId('ref')] = { type: 'json', src: readingPath('ref') };
    const files = new Map([[readingPath('ref'), JSON.stringify(r)]]);
    if (music) {
      doc.assets.song = { type: 'audio', src: 'assets/song.mp3' };
      doc.assets['analysis-song'] = { type: 'json', src: 'assets/analysis/song-analysis.json' };
      files.set('assets/analysis/song-analysis.json', JSON.stringify(music));
    }
    return { ctx: ctxOf(doc, files), files };
  };

  it('follows the reading scene by scene, its direction from the reference, the ideas given kept', async () => {
    const { ctx, files } = withReading(READING);
    const out = await plan.run({ reference: readingId('ref'), idea: 'Acme bills itself.', scenes: [{ name: 'Opening', kind: 'type', idea: 'Acme in big type.' }, { name: 'Mark', kind: 'interface', idea: 'The Acme mark.' }] } as never, ctx) as ToolOutput;
    const saved = JSON.parse(files.get(FILM_PLAN_PATH)!) as FilmPlan;
    expect(saved.reference).toBe(readingId('ref'));
    expect(saved.scenes.map((s) => [s.name, s.follows, s.seconds, s.idea])).toEqual([['Opening', 's1', 2, 'Acme in big type.'], ['Mark', 's2', 2, 'The Acme mark.']]);
    expect(saved.scenes[1].reference).toContain('slot mark: logo');
    expect(saved.scenes[1].reference).toContain('asset "acme-logo"');
    expect(saved.directions[0].palette).toContain('#111111');
    expect(saved.directions[0].type).toContain('Archivo');
    expect(saved.kinds).toEqual(['type', 'interface']);
    expect(out.text).toContain('Made the same way as the reference');
    expect(out.text).not.toContain('To fix');
  });

  it('times the cuts on the user\'s music', async () => {
    // 100 bpm: a bar every 2.4 s
    const beats = Array.from({ length: 12 }, (_, i) => +(i * 0.6).toFixed(2));
    const { ctx, files } = withReading(READING, { beats, downbeats: beats.filter((_, i) => i % 4 === 0) });
    await plan.run({ reference: readingId('ref'), idea: 'x' } as never, ctx);
    expect((JSON.parse(files.get(FILM_PLAN_PATH)!) as FilmPlan).scenes.map((s) => s.seconds)).toEqual([2.4, 2]);
  });

  it('waits for the reading to be accepted', async () => {
    const { ctx } = withReading({ ...READING, accepted: undefined });
    await expect(plan.run({ reference: readingId('ref'), idea: 'x' } as never, ctx)).rejects.toThrow(/not accepted/);
  });

  it('checks only the kinds of a plan made from a reference, not its variety', () => {
    const scenes = [{ id: 'a', name: 'A', kind: 'type' as const, idea: '' }, { id: 'b', name: 'B', kind: 'type' as const, idea: '' }];
    expect(planIssues({ kinds: ['type'], scenes, reference: 'r' })).toEqual([]);
    expect(planIssues({ kinds: ['type'], scenes }).length).toBeGreaterThan(0);
  });
});

describe('the user\'s film as the checks see it', () => {
  function film(): { doc: TrammeDoc; plan: FilmPlan } {
    const doc = project();
    const root = doc.compositions[doc.root];
    root.layers = {}; root.order = [];
    doc.compositions.one = { name: 'One', width: 1920, height: 1080, fps: 30, duration: 2, order: ['title'], layers: {
      title: { type: 'text', props: { text: 'Bill in one click', size: 120, align: 'center', baseline: 'middle' }, transform: { position: [960, 540] } },
    } } as never;
    doc.compositions.two = { name: 'Two', width: 1920, height: 1080, fps: 30, duration: 2, order: ['logo'], camera: { zoom: { $k: [{ t: 0, v: 1 }, { t: 2, v: 1.2 }] } }, layers: {
      logo: { type: 'image', props: { image: 'acme-logo', size: [300, 300] }, transform: { position: [810, 390], scale: { $k: [{ t: 0, v: [0, 0] }, { t: 0.3, v: [1, 1] }] } } },
    } } as never;
    root.layers.c1 = { type: 'comp', in: 0, out: 2, props: { comp: 'one' } } as never;
    root.layers.c2 = { type: 'comp', in: 2, out: 4, props: { comp: 'two' }, effects: [{ id: 't', type: 'fx.transition', props: { kind: 'whip' } }] } as never;
    root.order = ['c1', 'c2'];
    const plan: FilmPlan = { version: 1, kind: 'film-plan', updated: '', idea: 'x', kinds: ['type', 'interface'], directions: [], reference: 'r', scenes: [
      { id: 'a', name: 'A', kind: 'type', idea: '', comp: 'one', seconds: 2, follows: 's1' },
      { id: 'b', name: 'B', kind: 'interface', idea: '', comp: 'two', seconds: 2, follows: 's2' },
    ] };
    return { doc, plan };
  }

  it('finds where each scene plays, where its slots landed, its moves and its transition', () => {
    const { doc, plan } = film();
    const built = builtScenes(doc, registry, plan, READING);
    expect(built.map((b) => [b.follows, b.start, b.end, b.transition])).toEqual([['s1', 0, 2, 'cut'], ['s2', 2, 4, 'whip']]);
    expect(built[0].slots.title).not.toBeNull();
    const mark = built[1].slots.mark!;
    expect(mark[0]).toBeCloseTo(810 / 1920 - 150 / 1920, 1);
    expect(built[1].moves).toEqual(expect.arrayContaining(['push-in', 'scale']));
    expect(filmTexts(doc)).toEqual(['Bill in one click']);
  });

  it('reads the moves of a composition: a camera zoom, a slide, a rotation', () => {
    const comp = { width: 100, height: 100, fps: 30, duration: 2, order: ['a'], layers: { a: { type: 'shape.rect', transform: { position: { $k: [{ t: 0, v: [0, 0] }, { t: 1, v: [50, 0] }] }, rotation: { $k: [{ t: 0, v: 0 }, { t: 1, v: 90 }] } } } } } as never;
    expect(movesIn(comp).sort()).toEqual(['rotate', 'slide']);
  });
});

describe('the critic of a film made from a reference', () => {
  const usage = { requests: 1, input: 1000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 100 };
  const calls: { text: string; images: number }[] = [];
  beforeEach(() => {
    calls.length = 0; resetCritic();
    setCriticHost({
      via: () => ({ route: 'server', model: 'claude-opus-5-5' }), rounds: () => 2,
      gather: async () => ({ target: null, strips: [{ url: 'data:image/jpeg;base64,AAAA', caption: 'strip' }], plan: 'Idea: x', facts: 'Format.', moments: [], issues: [] }) as never,
      likeness: async () => null, rhythm: async () => { throw new Error('no frames'); },
      consult: async (req) => { calls.push({ text: req.text, images: req.images.length }); return { text: JSON.stringify({ verdict: 'done', score: 9, fixes: [] }), usage }; },
      reference: async () => ({ issues: [{ line: 's2: lasts 3.00 s, the reference\'s 2.00 s', blocking: true }, { line: 's1: the reference\'s rise is not made', blocking: false }], pairs: [{ url: 'data:image/jpeg;base64,CCCC', caption: 's1: the reference (left), the film (right)' }] }),
    });
  });

  it('measures the film against its reading and shows the critic the pairs', async () => {
    const doc = project(), files = new Map([[FILM_PLAN_PATH, JSON.stringify({ version: 1, kind: 'film-plan', updated: '', idea: 'x', kinds: ['type'], directions: [], scenes: [], reference: 'r' })]]);
    const critique = CRITIC_TOOLS.find((t) => t.name === 'critique')!;
    const out = await critique.run({} as never, ctxOf(doc, files)) as ToolOutput;
    expect(out.text).toContain('[reference] s2: lasts 3.00 s');
    expect(out.text).toContain('Verdict: not yet');
    expect(calls[0].images).toBe(2);
    expect(calls[0].text).toContain('the same video as a reference');
    expect(calls[0].text).toContain('s1: the reference\'s rise is not made');
  });
});

describe('the outline asked of the user', () => {
  it('resolves with the reading as the user leaves it, or null when declined', async () => {
    const kept = askReading(READING, [], []);
    expect(question.value?.outline?.reading).toBe(READING);
    question.value!.keep!({ ...READING, name: 'edited' });
    expect((await kept)!.name).toBe('edited');
    const declined = askReading(READING, [], []);
    answer(false);
    expect(await declined).toBeNull();
  });
});

describe('the film against its reading', () => {
  it('finds a name of the reference in the film, the reading named after it never counting as the user\'s words', async () => {
    const { againstReference } = await import('../src/reading/check.ts');
    const doc = project();
    doc.assets.ref = { ...doc.assets.ref, reference: true };
    doc.assets[readingId('ref')] = { type: 'json', src: readingPath('ref'), name: 'Reading · Lumora promo' };
    doc.compositions[doc.root].layers.t = { type: 'text', props: { text: 'Lumora inside' } } as never;
    doc.compositions[doc.root].order.push('t');
    const files = new Map([[readingPath('ref'), JSON.stringify({ ...READING, from: 'lottie', scenes: [{ ...READING.scenes[0], end: 4, slots: [] }], beats: undefined, bars: undefined })]]);
    const plan: FilmPlan = { version: 1, kind: 'film-plan', updated: '', idea: 'x', kinds: ['type'], directions: [], reference: readingId('ref'), scenes: [{ id: 'a', name: 'A', kind: 'type', idea: '', seconds: 4, follows: 's1' }] };
    const out = await againstReference(ctxOf(doc, files), plan);
    expect(out!.issues).toContainEqual({ line: 'the film shows "LUMORA", a name of the reference', blocking: true });
    expect(out!.pairs).toEqual([]);
  });
});

describe('a reference given as a link', () => {
  it('tells a video, a gif and a Lottie from a page, by type or by extension', async () => {
    const { kindOfLink } = await import('../src/reading/tool.ts');
    expect(kindOfLink('video/mp4', 'https://x.test/a')).toBe('video');
    expect(kindOfLink('', 'https://x.test/promo.webm?dl=1')).toBe('video');
    expect(kindOfLink('image/gif', 'https://x.test/a')).toBe('gif');
    expect(kindOfLink('application/octet-stream', 'https://x.test/loop.gif')).toBe('gif');
    expect(kindOfLink('application/json; charset=utf-8', 'https://x.test/anim')).toBe('lottie');
    expect(kindOfLink('text/html', 'https://www.youtube.test/watch?v=1')).toBeNull();
  });

  it('keeps the linked Lottie in the project as the reference and reads it', async () => {
    setReadingHost({ accepted: () => true, typefaces: async () => [] });
    const fetched: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string) => { fetched.push(u); return new Response(JSON.stringify(LOTTIE), { headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
    try {
      const files = new Map<string, string>(), doc = project();
      const out = await run({ url: 'https://cdn.test/files/Brand%20Intro.json' }, ctxOf(doc, files));
      expect(fetched).toEqual(['https://cdn.test/files/Brand%20Intro.json']);
      expect(out.ops![0]).toEqual({ op: 'add', path: '/assets/brand-intro', value: { type: 'json', src: 'assets/references/brand-intro.json', name: 'Brand Intro.json', reference: true } });
      expect(parseReading(files.get(readingPath('brand-intro')))!.scenes).toHaveLength(2);
    } finally { globalThis.fetch = real; }
  });

  it('says plainly when the link is a page or cannot be read from here', async () => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch;
      await expect(run({ url: 'https://video.test/watch?v=1' }, ctxOf(project(), new Map()))).rejects.toThrow(/no video, gif or Lottie file/);
      globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
      await expect(run({ url: 'https://cdn.test/a.mp4' }, ctxOf(project(), new Map()))).rejects.toThrow(/download the file and drop it/);
    } finally { globalThis.fetch = real; }
  });
});

describe('a plan from a reading written again', () => {
  it('keeps the reading\'s scene each scene follows, by order', async () => {
    const doc = project();
    doc.assets[readingId('ref')] = { type: 'json', src: readingPath('ref') };
    const files = new Map([[readingPath('ref'), JSON.stringify(READING)]]);
    const plan = FILM_PLAN_TOOLS[0];
    await plan.run({ reference: readingId('ref'), idea: 'x' } as never, ctxOf(doc, files));
    await plan.run({ scenes: [{ name: 'One', kind: 'type', idea: 'new one' }, { name: 'Two', kind: 'interface', idea: 'new two' }] } as never, ctxOf(doc, files));
    const saved = JSON.parse(files.get(FILM_PLAN_PATH)!) as FilmPlan;
    expect(saved.scenes.map((s) => [s.name, s.follows, s.seconds])).toEqual([['One', 's1', 2], ['Two', 's2', 2]]);
    expect(saved.reference).toBe(readingId('ref'));
  });
});
