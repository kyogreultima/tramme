import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { builtinRegistry } from '@tramme/nodes';
import type { QualityIssue, TrammeDoc } from '@tramme/core';
import { factsOf, momentsOf, stripPictures } from '../src/critic/evidence.ts';
import { doneIssues } from '../src/critic/done.ts';

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

describe('what done means, measured', () => {
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
