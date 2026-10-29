import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { builtinRegistry } from '@tramme/nodes';
import type { QualityIssue, TrammeDoc } from '@tramme/core';
import { factsOf, momentsOf, stripPictures } from '../src/critic/evidence.ts';

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
