import { beforeEach, describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { builtinRegistry } from '@tramme/nodes';
import type { QualityIssue, TrammeDoc } from '@tramme/core';
import { factsOf, momentsOf, stripPictures } from '../src/critic/evidence.ts';
import { doneIssues } from '../src/critic/done.ts';
import { CRITIC_TOOLS as criticTools, consultsOf, resetCritic, setCriticHost } from '../src/critic/tool.ts';

const registry = builtinRegistry();

/** a film of three scene compositions of 3 s each, one after another, each with a full-frame plate entering at `entrances[i]` */
function film(entrances = [0.5, 0.5, 0.5], size: [number, number] = [1920, 1080]): TrammeDoc {
  const { doc } = newProject({ name: 'F', width: size[0], height: size[1], fps: 30, duration: 9 });
  const root = doc.compositions[doc.root];
  root.layers = {}; root.order = [];
  entrances.forEach((at, i) => {
    const id = `s${i + 1}`;
    doc.compositions[id] = { name: `Scene ${i + 1}`, width: size[0], height: size[1], fps: 30, duration: 3, layers: { plate: { type: 'shape.rect', name: `Plate ${i + 1}`, in: at, props: { size, fill: '#335577' }, transform: { position: [size[0] / 2, size[1] / 2] } } }, order: ['plate'] } as never;
    root.layers[`c${i + 1}`] = { type: 'comp', name: `Scene ${i + 1}`, in: i * 3, out: i * 3 + 3, props: { comp: id } } as never;
    root.order.push(`c${i + 1}`);
  });
  return doc;
}

describe('the moments worth looking at', () => {
  it('gives each cut between scenes, centred on it, and each scene\'s first big entrance', () => {
    const m = momentsOf(film(), 'main', registry);
    expect(m.filter((x) => x.why.startsWith('cut')).map((x) => x.t)).toEqual([3, 6]);
    expect(m.find((x) => x.t === 3)!.why).toBe('cut from Scene 1 to Scene 2');
    const entrances = m.filter((x) => x.why.endsWith('enters'));
    expect(entrances.map((x) => x.t)).toEqual([0.5, 3.5, 6.5]);
    expect(entrances[1]).toMatchObject({ scene: 'Scene 2', why: 'Plate 2 enters' });
    expect(m.map((x) => x.t)).toEqual([...m.map((x) => x.t)].sort((a, b) => a - b));
  });

  it('leaves out an entrance too small to see', () => {
    const doc = film();
    doc.compositions.s2.layers.plate.props = { size: [100, 100], fill: '#fff' };
    expect(momentsOf(doc, 'main', registry).some((x) => x.why === 'Plate 2 enters')).toBe(false);
  });

  it('caps fifteen candidates at twelve, both cuts kept', () => {
    const doc = film();
    // thirteen hero markers: with the cuts and the entrances, more than twelve moments
    doc.compositions.main.markers = Array.from({ length: 13 }, (_, i) => ({ id: `h${i}`, t: 0.9 + i * 0.65, label: `Hero ${i}`, kind: 'hero' }));
    const m = momentsOf(doc, 'main', registry);
    expect(m).toHaveLength(12);
    expect(m.filter((x) => x.why.startsWith('cut')).map((x) => x.t)).toEqual([3, 6]);
  });

  it('merges two moments closer than 0.4 s, keeping the cut', () => {
    const doc = film([0.5, 0.2, 0.5]);
    const m = momentsOf(doc, 'main', registry);
    // scene 2's plate enters at 3.2, 0.2 s after the cut at 3: one moment, the cut
    expect(m.filter((x) => Math.abs(x.t - 3) < 0.4).map((x) => x.why)).toEqual(['cut from Scene 1 to Scene 2']);
  });

  it('keeps a hero marker', () => {
    const doc = film();
    doc.compositions.main.markers = [{ id: 'h', t: 4.4, label: 'The price', kind: 'hero' }, { id: 'k', t: 5, label: 'plain' }];
    const m = momentsOf(doc, 'main', registry);
    expect(m).toContainEqual({ t: 4.4, why: 'hero: The price', scene: 'Scene 2' });
    expect(m.some((x) => x.t === 5)).toBe(false);
  });

  it('gives only the scene boundaries when nothing in the film enters', () => {
    const doc = film();
    for (const c of ['s1', 's2', 's3']) { doc.compositions[c].layers = {}; doc.compositions[c].order = []; }
    expect(momentsOf(doc, 'main', registry).map((x) => x.t)).toEqual([3, 6]);
  });

  it('takes the middle of each coverage gap in a talking video, and its illustrations\' entrances, not its captions', () => {
    const { doc } = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 60 });
    const c = doc.compositions[doc.root];
    c.layers = {
      talk: { type: 'video', name: 'Talk', in: 0, out: 60, props: {} },
      art: { type: 'shape.rect', name: 'Chart', in: 12, out: 18, props: { size: [800, 600], fill: '#fff' }, transform: { position: [960, 540] } },
      cap: { type: 'text', name: 'Caption', in: 30, out: 31, props: { text: 'hello' } },
    } as never;
    c.order = ['talk', 'art', 'cap'];
    const gap: QualityIssue = { check: 'coverage', severity: 'warning', t: 20, rank: 24, layers: [], message: 'bare for 24 s' };
    const m = momentsOf(doc, 'main', registry, [gap]);
    expect(m).toContainEqual(expect.objectContaining({ t: 32, why: 'the speaker alone for 24 s' }));
    expect(m.some((x) => x.why === 'Chart enters')).toBe(true);
    expect(m.some((x) => /Caption/.test(x.why))).toBe(false);
  });
});

describe('what the critic is told', () => {
  it('says the format, the length, the scenes with their times and kinds, and the sound', () => {
    const doc = film();
    doc.compositions.main.layers.music = { type: 'audio', props: {} } as never;
    const plan = { version: 1, kind: 'film-plan', updated: '', idea: 'x', kinds: ['type', 'object'], scenes: [{ id: 'a', name: 'Scene 1', kind: 'type', idea: '' }, { id: 'b', name: 'Scene 2', kind: 'object', idea: '' }], directions: [] } as never;
    const facts = factsOf(doc, 'main', plan);
    expect(facts).toContain('1920 x 1080');
    expect(facts).toContain('9 s');
    expect(facts).toContain('Scene 2 3.0-6.0 s (object)');
    expect(facts).toContain('Scene 3 6.0-9.0 s');
    expect(facts).toContain('1 sound layer');
  });

  it('puts the strips three to a picture, four pictures at most', () => {
    const groups = stripPictures(Array.from({ length: 12 }, (_, i) => i));
    expect(groups.map((g) => g.length)).toEqual([3, 3, 3, 3]);
    expect(stripPictures([1, 2, 3, 4])).toEqual([[1, 2, 3], [4]]);
    expect(stripPictures(Array.from({ length: 20 }, (_, i) => i))).toHaveLength(4);
  });
});

/** two scenes of 4 s as compositions, overlapping by 0.4 s: each has a picture, its words in two sizes, a hero marker, a music layer, nothing provisional */
function good(): TrammeDoc {
  const { doc } = newProject({ name: 'G', width: 1920, height: 1080, fps: 30, duration: 8 });
  doc.assets.pic = { type: 'image', src: 'assets/pic.png', name: 'Pic' } as never;
  doc.assets.snd = { type: 'audio', src: 'assets/snd.mp3', name: 'Snd' } as never;
  const root = doc.compositions[doc.root];
  const scene = (name: string) => ({ name, width: 1920, height: 1080, fps: 30, duration: 4, layers: {
    pic: { type: 'image', name: 'Picture', props: { image: 'pic', size: [1200, 800] } },
    title: { type: 'text', name: 'Title', props: { text: 'A clear idea', size: 96 } },
    sub: { type: 'text', name: 'Sub', props: { text: 'told in a line', size: 40 } },
    note: { type: 'text', name: 'Note', props: { text: 'and a detail', size: 40 } },
  }, order: ['pic', 'title', 'sub', 'note'] });
  doc.compositions.s1 = scene('Scene 1') as never;
  doc.compositions.s2 = scene('Scene 2') as never;
  root.layers = {
    c1: { type: 'comp', name: 'Scene 1', in: 0, out: 4, props: { comp: 's1' } },
    c2: { type: 'comp', name: 'Scene 2', in: 3.6, out: 8, props: { comp: 's2' } },
    music: { type: 'audio', name: 'Music', props: { audio: 'snd' } },
  } as never;
  root.order = ['c1', 'c2', 'music'];
  root.markers = [{ id: 'h', t: 5, label: 'The point', kind: 'hero' }];
  return doc;
}

describe('what done means, measured', () => {
  const ids = (doc: TrammeDoc, issues: QualityIssue[] = [], plan = null as never) => [...new Set(doneIssues(doc, 'main', registry, plan, issues).map((i) => i.id))];
  const issue = (check: string, severity: 'warning' | 'info', extra: Partial<QualityIssue> = {}): QualityIssue => ({ check, severity, t: 5, rank: 1, layers: [], message: `${check}`, ...extra });

  it('passes a film that has all of it', () => {
    expect(doneIssues(good(), 'main', registry, null, [])).toEqual([]);
  });

  it('material: a scene of flat shapes and words only', () => {
    const doc = good();
    doc.compositions.s2.layers = { bg: { type: 'shape.rect', props: { size: [1920, 1080], fill: '#112233' } }, title: { type: 'text', props: { text: 'Words', size: 96 } }, a: { type: 'text', props: { text: 'a', size: 40 } }, b: { type: 'text', props: { text: 'b', size: 40 } } } as never;
    const found = doneIssues(doc, 'main', registry, null, []);
    expect(found.filter((i) => i.id === 'material')).toEqual([expect.objectContaining({ scene: 'Scene 2' })]);
    // a gradient is material, a solid rectangle is not
    doc.compositions.s2.layers.bg = { type: 'shape.rect', props: { size: [1920, 1080], fill: { type: 'linear', stops: [] } } } as never;
    expect(ids(doc)).not.toContain('material');
  });

  it('material: a scene of an image and a title is enough', () => {
    const doc = good();
    doc.compositions.s2.layers = { pic: { type: 'image', props: { image: 'pic' } }, title: { type: 'text', props: { text: 'Title', size: 96 } } } as never;
    expect(ids(doc)).not.toContain('material');
  });

  it('hierarchy: texts all in one size, and a scene of three texts in one size', () => {
    const doc = good();
    for (const c of ['s1', 's2']) for (const t of ['title', 'sub', 'note']) (doc.compositions[c].layers[t].props as Record<string, unknown>).size = 50;
    expect(ids(doc)).toContain('hierarchy');
    // two sizes in the film, but one scene says everything in one
    const doc2 = good();
    for (const t of ['title', 'sub', 'note']) (doc2.compositions.s2.layers[t].props as Record<string, unknown>).size = 50;
    expect(doneIssues(doc2, 'main', registry, null, []).filter((i) => i.id === 'hierarchy')).toEqual([expect.objectContaining({ scene: 'Scene 2' })]);
  });

  it('coverage: the check\'s warnings over 20 s, a talking video with a 24 s bare stretch', () => {
    expect(ids(good(), [issue('coverage', 'warning', { t: 10, rank: 24 })])).toEqual(['coverage']);
    expect(ids(good(), [issue('coverage', 'info', { t: 10, rank: 14 })])).toEqual([]);
  });

  it('hero: no scene of the plan and no marker is the one that must be seen', () => {
    const doc = good();
    doc.compositions.main.markers = [];
    expect(ids(doc)).toEqual(['hero']);
    const plan = { version: 1, kind: 'film-plan', updated: '', idea: '', kinds: [], scenes: [{ id: 'a', name: 'Scene 1', kind: 'type', idea: '', hero: true }], directions: [] } as never;
    expect(ids(doc, [], plan)).toEqual([]);
  });

  it('ending: a last scene with no words and no picture, or one that lasts under 1.5 s', () => {
    const doc = good();
    doc.compositions.s2.layers = { fx: { type: 'shader', props: {} }, t1: { type: 'text', props: { text: 'x', size: 96 } } } as never;
    expect(ids(doc)).toEqual([]);
    delete doc.compositions.s2.layers.t1;
    expect(ids(doc)).toContain('ending');
    const short = good();
    short.compositions.main.layers.c2.in = 6.8;
    expect(ids(short)).toContain('ending');
  });

  it('transitions: two scenes meeting in a hard cut, with no overlap, no transition effect and no beat', () => {
    const doc = good();
    doc.compositions.main.layers.c1.out = 3.6;
    expect(doneIssues(doc, 'main', registry, null, []).filter((i) => i.id === 'transitions')).toEqual([expect.objectContaining({ scene: 'Scene 2' })]);
    // a transition effect on the incoming scene settles it, so does a cut on a beat
    const withFx = good();
    withFx.compositions.main.layers.c1.out = 3.6;
    (withFx.compositions.main.layers.c2 as { effects?: unknown[] }).effects = [{ id: 't', type: 'fx.transition', props: {} }];
    expect(ids(withFx)).not.toContain('transitions');
    const onBeat = good();
    onBeat.compositions.main.layers.c1.out = 3.6;
    const beats = { data: (id: string) => (id === 'analysis-snd' ? { beats: [1, 2, 3.62, 5] } : undefined), analysisIds: ['analysis-snd'] };
    expect(doneIssues(onBeat, 'main', registry, null, [], beats).filter((i) => i.id === 'transitions')).toEqual([]);
  });

  it('transitions: a film of one scene has none to ask for', () => {
    const { doc } = newProject({ name: 'One', width: 1920, height: 1080, fps: 30, duration: 8 });
    expect(ids(doc)).not.toContain('transitions');
  });

  it('sound: no sound layer at all, or a warning of the sound checks', () => {
    const doc = good();
    delete doc.compositions.main.layers.music;
    expect(ids(doc)).toEqual(['sound']);
    expect(ids(good(), [issue('sound', 'warning')])).toEqual(['sound']);
  });

  it('provisional: a placeholder text, a picture with no file, a layer named placeholder', () => {
    const doc = good();
    (doc.compositions.s1.layers.sub.props as Record<string, unknown>).text = 'Prix : [à venir]';
    expect(ids(doc)).toEqual(['provisional']);
    const doc2 = good();
    (doc2.compositions.s1.layers.pic.props as Record<string, unknown>).image = null;
    expect(ids(doc2)).toEqual(['provisional']);
    const doc3 = good();
    doc3.compositions.s1.layers.pic.name = 'Placeholder';
    expect(ids(doc3)).toEqual(['provisional']);
    const doc4 = good();
    (doc4.compositions.s1.layers.sub.props as Record<string, unknown>).text = 'Lorem ipsum dolor';
    expect(ids(doc4)).toEqual(['provisional']);
  });

  it('readable: the small-text and text-time warnings', () => {
    expect(ids(good(), [issue('text-size', 'warning')])).toEqual(['readable']);
    expect(ids(good(), [issue('text-time', 'warning')])).toEqual(['readable']);
    expect(ids(good(), [issue('text-size', 'info')])).toEqual([]);
  });
});

describe('the critique tool', () => {
  const usage = { requests: 1, input: 1000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 100 };
  const EVIDENCE = { strips: [{ url: 'data:image/jpeg;base64,AAAA', caption: 'Strips 1. cut (3.0 s)' }], target: 'data:image/jpeg;base64,BBBB', plan: 'Idea: x', facts: 'Format 1920 x 1080.', moments: [], issues: [] };
  const answer = (verdict: object) => JSON.stringify(verdict);
  const calls: { text: string; images: number }[] = [];
  let reply = answer({ verdict: 'done', score: 9, fixes: [] });
  let failing = false;

  const ctxOf = (doc: TrammeDoc) => ({ doc, compId: 'main', time: 0, selection: [], registry, readText: async () => null, files: async () => [], assetUrl: () => '', fileUrl: () => '', signal: new AbortController().signal }) as never;
  const critique = criticTools.find((t) => t.name === 'critique')!;
  const run = (doc: TrammeDoc, input: object = {}) => critique.run(input as never, ctxOf(doc)) as Promise<{ text?: string; notice?: string }>;

  beforeEach(() => {
    calls.length = 0; reply = answer({ verdict: 'done', score: 9, fixes: [] }); failing = false;
    resetCritic();
    setCriticHost({
      via: () => ({ route: 'server', model: 'claude-opus-5-5' }),
      rounds: () => 2,
      gather: async () => EVIDENCE,
      likeness: async () => null,
      consult: async (req) => { if (failing) throw new Error('overloaded'); calls.push({ text: req.text, images: req.images.length }); return { text: reply, usage }; },
    });
  });

  it('says done when nothing is missing by measure and the critic says done', async () => {
    const out = await run(good());
    expect(out.text).toContain('Verdict: done');
    expect(out.text).toContain('Score 9/10');
    expect(calls).toHaveLength(1);
    // the target first, then the strips; the facts and the plan are in the text
    expect(calls[0].images).toBe(2);
    expect(calls[0].text).toContain('Format 1920 x 1080.');
    expect(calls[0].text).toContain('Idea: x');
  });

  it('says not yet while something is missing by measure, whatever the critic says, the measured line first', async () => {
    const doc = good();
    delete doc.compositions.main.layers.music;
    const out = await run(doc);
    expect(out.text).toContain('Verdict: not yet');
    expect(out.text!.indexOf('the film has no sound')).toBeGreaterThan(-1);
    expect(out.text!.indexOf('the film has no sound')).toBeLessThan(out.text!.indexOf('Verdict'));
    expect(out.text).toMatch(/not to be argued with/i);
  });

  it('lists the three fixes the critic gives, with their scene, what and why', async () => {
    reply = answer({ verdict: 'not yet', score: 5, fixes: [{ scene: 'Price', what: 'push onto the figure', why: 'it is the point' }] });
    const out = await run(good());
    expect(out.text).toContain('Price: push onto the figure');
    expect(out.text).toContain('it is the point');
  });

  it('asks for takes when a scene is named a second time in the turn', async () => {
    reply = answer({ verdict: 'not yet', score: 5, fixes: [{ scene: 'Price', what: 'a', why: 'b' }] });
    expect((await run(good())).text).not.toContain('failed twice');
    const second = await run(good());
    expect(second.text).toContain('Price failed twice');
    expect(second.text).toContain('scene-takes');
  });

  it('makes no consult once the rounds are used, and says what is left to raise in the summary', async () => {
    setCriticHost({ rounds: () => 1 });
    await run(good());
    const out = await run(good());
    expect(calls).toHaveLength(1);
    expect(out.text).toMatch(/rounds are used/);
    expect(out.text).toMatch(/summary/);
  });

  it('makes no consult with zero rounds, and gives only the measured issues', async () => {
    setCriticHost({ rounds: () => 0 });
    const doc = good();
    delete doc.compositions.main.layers.music;
    const out = await run(doc);
    expect(calls).toHaveLength(0);
    expect(out.text).toContain('the film has no sound');
    expect(out.text).toMatch(/critic is off/i);
  });

  it('makes no consult with a model that cannot see, and says why', async () => {
    setCriticHost({ via: () => ({ route: 'local', model: 'local:llama3.1:8b' }) });
    const out = await run(good());
    expect(calls).toHaveLength(0);
    expect(out.text).toMatch(/needs a model that sees pictures/);
  });

  it('reports a consult that fails and does not count the round', async () => {
    setCriticHost({ rounds: () => 1 });
    failing = true;
    const out = await run(good());
    expect(out.text).toContain('overloaded');
    failing = false;
    await run(good());
    expect(calls).toHaveLength(1);
  });

  it('reports a critic that answers in prose as not yet, with its words', async () => {
    reply = 'Looks fine to me, done.';
    const out = await run(good());
    expect(out.text).toContain('Verdict: not yet');
    expect(out.text).toContain('Looks fine to me, done.');
  });

  it('adds what the consults cost to the turn, apart: two consults, n: 2', async () => {
    await run(good());
    await run(good());
    expect(consultsOf()).toMatchObject({ n: 2, input: 2000, output: 200, model: 'claude-opus-5-5' });
    resetCritic();
    expect(consultsOf()).toBeUndefined();
  });

  it('says there is no route when none is available', async () => {
    setCriticHost({ via: () => null });
    await expect(run(good())).rejects.toThrow(/no assistant/i);
  });
});

describe('takes of a scene', () => {
  const takesTool = criticTools.find((t) => t.name === 'scene-takes')!;
  const ctxOf2 = (doc: TrammeDoc) => ({ doc, compId: 'main', time: 0, selection: [], registry, readText: async () => null, files: async () => [], assetUrl: () => '', fileUrl: () => '', signal: new AbortController().signal }) as never;
  const apply = (doc: TrammeDoc, ops: { op: string; path: string; value?: unknown }[]): TrammeDoc => {
    const next = JSON.parse(JSON.stringify(doc)) as TrammeDoc;
    for (const o of ops) {
      const parts = o.path.split('/').filter(Boolean).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
      let c = next as unknown as Record<string, unknown>;
      for (const p of parts.slice(0, -1)) c = c[p] as Record<string, unknown>;
      if (o.op === 'remove') delete c[parts.at(-1)!]; else c[parts.at(-1)!] = o.value;
    }
    return next;
  };
  const run = async (doc: TrammeDoc, input: object) => takesTool.run(input as never, ctxOf2(doc)) as Promise<{ ops?: { op: string; path: string; value?: unknown }[]; text?: string }>;

  it('make: 2 copies the scene into a take, and the root still plays the original', async () => {
    const doc = good();
    const out = await run(doc, { scene: 'Scene 2', make: 2 });
    const next = apply(doc, out.ops!);
    expect(Object.keys(next.compositions).filter((c) => c.startsWith('s2'))).toEqual(['s2', 's2~take2']);
    expect(Object.values(next.compositions['s2~take2'].layers).map((l) => l.type)).toEqual(Object.values(doc.compositions.s2.layers).map((l) => l.type));
    expect(next.compositions['s2~take2'].name).toBe('Scene 2 (take 2)');
    expect((next.compositions.main.layers.c2.props as { comp: string }).comp).toBe('s2');
    expect(out.text).toMatch(/built differently/);
  });

  it('make: 3 gives two takes', async () => {
    const out = await run(good(), { scene: 'Scene 1', make: 3 });
    expect(out.ops!.filter((o) => o.op === 'add' && /take/.test(o.path)).length).toBe(2);
  });

  it('keep: a take makes the root play it, removes the original and the other takes, and leaves no dangling reference', async () => {
    const doc = apply(good(), (await run(good(), { scene: 'Scene 2', make: 3 })).ops!);
    const out = await run(doc, { scene: 'Scene 2', keep: 's2~take2' });
    const next = apply(doc, out.ops!);
    expect((next.compositions.main.layers.c2.props as { comp: string }).comp).toBe('s2~take2');
    expect(Object.keys(next.compositions).filter((c) => c.startsWith('s2'))).toEqual(['s2~take2']);
    const comps = Object.values(next.compositions).flatMap((c) => Object.values(c.layers).filter((l) => l.type === 'comp').map((l) => (l.props as { comp: string }).comp));
    expect(comps.every((c) => c in next.compositions)).toBe(true);
  });

  it('keep: the original removes the takes only', async () => {
    const doc = apply(good(), (await run(good(), { scene: 'Scene 2', make: 2 })).ops!);
    const next = apply(doc, (await run(doc, { scene: 'Scene 2', keep: 's2' })).ops!);
    expect(Object.keys(next.compositions).filter((c) => c.startsWith('s2'))).toEqual(['s2']);
  });

  it('keep: something that is not a take of that scene, or a take the user removed, is an error naming it', async () => {
    const doc = good();
    await expect(run(doc, { scene: 'Scene 2', keep: 's1' })).rejects.toThrow(/s1/);
    await expect(run(doc, { scene: 'Scene 2', keep: 's2~take2' })).rejects.toThrow(/s2~take2/);
    await expect(run(doc, { scene: 'Nowhere', make: 2 })).rejects.toThrow(/Nowhere/);
  });

  it('critique with takes sends one consult with each take\'s strip, labelled, and counts one round', async () => {
    const seen: { text: string; images: number }[] = [];
    resetCritic();
    const strip = (id: string) => ({ ...{ strips: [{ url: 'data:image/jpeg;base64,AAAA', caption: `strips of ${id}` }], target: null, plan: null, facts: 'Format.', moments: [], issues: [] } });
    setCriticHost({
      via: () => ({ route: 'server', model: 'claude-opus-5-5' }), rounds: () => 1, likeness: async () => null,
      gather: async (_c, comp) => strip(comp),
      consult: async (req) => { seen.push({ text: req.text, images: req.images.length }); return { text: JSON.stringify({ verdict: 'not yet', score: 6, fixes: [{ what: 's2~take2 is best', why: 'closer' }] }), usage: { requests: 1, input: 1, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 1 } }; },
    });
    const doc = apply(good(), (await run(good(), { scene: 'Scene 2', make: 2 })).ops!);
    const out = await criticTools.find((t) => t.name === 'critique')!.run({ takes: ['s2', 's2~take2'] } as never, ctxOf2(doc)) as { text: string };
    expect(seen).toHaveLength(1);
    expect(seen[0].images).toBe(2);
    expect(seen[0].text).toContain('Take "s2"');
    expect(seen[0].text).toContain('Take "s2~take2"');
    expect(out.text).toContain('s2~take2 is best');
    expect(consultsOf()?.n).toBe(1);
  });
});

describe('the faults the critic is told to name', () => {
  it('are the titles of the catalogue\'s faults, in under 1 500 characters', async () => {
    const { readFileSync } = await import('node:fs');
    const { faultTitles } = await import('../src/critic/tool.ts');
    const refs = JSON.parse(readFileSync('apps/editor/data/references.json', 'utf8'));
    const titles = faultTitles(refs);
    expect(titles.length).toBeGreaterThanOrEqual(20);
    expect(titles.join('\n- ').length).toBeLessThan(1500);
    expect(titles).toContain('The empty scene');
  });

  it('ride in the system text of the consult', async () => {
    let system = '';
    resetCritic();
    setCriticHost({ via: () => ({ route: 'server', model: 'claude-opus-5-5' }), rounds: () => 2, faults: async () => ['The empty scene'], gather: async () => ({ strips: [], target: null, plan: null, facts: '', moments: [], issues: [] }), likeness: async () => null, consult: async (req) => { system = req.system; return { text: '{"verdict":"done","fixes":[]}', usage: { requests: 1, input: 1, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 1 } }; } });
    const doc = good();
    await (criticTools.find((t) => t.name === 'critique')!.run({} as never, { doc, compId: 'main', time: 0, selection: [], registry, readText: async () => null, files: async () => [], assetUrl: () => '', fileUrl: () => '', signal: new AbortController().signal } as never));
    expect(system).toContain('Faults to name when you see them:\n- The empty scene');
  });
});

describe('a scene that does not run from its start at normal speed', () => {
  it('has its entrances placed where they happen in the film: from its start point, at its speed', () => {
    const doc = film([2, 0.5, 0.5]);
    // scene 1 plays its composition from 1 s in, twice as fast: its plate (in 2 s of its own time) enters 0.5 s after the scene starts
    (doc.compositions.main.layers.c1.props as Record<string, unknown>).start = 1;
    (doc.compositions.main.layers.c1.props as Record<string, unknown>).speed = 2;
    const m = momentsOf(doc, 'main', registry);
    expect(m.find((x) => x.why === 'Plate 1 enters')?.t).toBeCloseTo(0.5, 6);
  });

  it('leaves out an entrance that comes before the scene shows its composition', () => {
    const doc = film([0.5, 0.5, 0.5]);
    (doc.compositions.main.layers.c1.props as Record<string, unknown>).start = 1;
    expect(momentsOf(doc, 'main', registry).some((x) => x.why === 'Plate 1 enters')).toBe(false);
  });
});
