import { describe, expect, it } from 'vitest';
import { applyOps, detachPlan, Evaluator, validate, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import { placeTemplate, TEMPLATES } from '../src/templates.ts';

/** a project made from a video, its transcript beside it */
function videoProject(width: number, height: number): TrammeDoc {
  const { doc } = newProject({ name: 'Video', width, height, fps: 30, duration: 12 });
  doc.assets.talk = { type: 'video', src: 'assets/video/talk.mp4' };
  doc.assets['transcription-talk'] = { type: 'json', src: 'assets/transcripts/talk.json' };
  doc.compositions.main.layers.video = { type: 'video', transform: { position: [width / 2, height / 2] }, props: { video: 'talk', size: [width, height], fit: 'cover' } } as never;
  doc.compositions.main.order = ['video'];
  return doc;
}

describe('dressing templates', () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
    it(`each one gives a valid document (${w}×${h}), added above the video`, () => {
      let doc = videoProject(w, h);
      for (const [name, tpl] of Object.entries(TEMPLATES)) {
        const { ops } = tpl.build(doc, 'main', { at: 2, duration: 3, text: 'The title', subtitle: 'One line', transcript: 'transcription-talk' });
        doc = applyOps(doc, ops).doc;
        expect(validate(doc, builtinRegistry()), name).toEqual([]);
      }
      const c = doc.compositions.main;
      expect(c.order[0]).toBe('video');
      expect(c.order.length).toBeGreaterThan(Object.keys(TEMPLATES).length);
      expect(new Set(c.order).size).toBe(c.order.length);
    });
  }

  it('captions need a transcript', () => {
    expect(() => TEMPLATES.captions.build(videoProject(1920, 1080), 'main', { at: 0 })).toThrow(/transcription/);
  });

  it('places a dressing as an instance of a component of its look: two uses, one component, their own words', () => {
    let doc = videoProject(1080, 1920);
    for (const [at, text] of [[1, 'Fast'], [4, 'Simple']] as const) doc = applyOps(doc, placeTemplate(doc, 'main', 'keyword', { at, text }).ops).doc;
    expect(validate(doc, builtinRegistry())).toEqual([]);
    const comps = Object.keys(doc.compositions).filter((id) => id.startsWith('tpl-keyword-'));
    expect(comps).toHaveLength(1);
    const c = doc.compositions.main, uses = c.order.filter((id) => c.layers[id].type === 'comp');
    expect(uses.map((id) => [c.layers[id].in, c.layers[id].params?.text])).toEqual([[1, 'FAST'], [4, 'SIMPLE']]);
    // read through its instance, the second keyword shows its own word, popping in from its own start
    const ev = new Evaluator(doc, builtinRegistry());
    const second = ev.layerAt(uses[1], 4.1, 'main');
    const inner = ev.frame(0.1, comps[0], second.props.$instance as never).layers[0];
    expect(inner.props.text).toBe('SIMPLE');
    // the keyword wiggles (a modifier reading the time): moved to its place, it would not wiggle the same, so it stays an instance
    expect(detachPlan(doc, builtinRegistry(), 'main', uses[1])).toEqual({ error: 'time' });
    // another look (a lower third): its own component, which detaches into the layers the template wrote
    doc = applyOps(doc, placeTemplate(doc, 'main', 'lower-third', { at: 6, text: 'Ada', subtitle: 'Engineer' }).ops).doc;
    expect(Object.keys(doc.compositions).filter((id) => id.startsWith('tpl-'))).toHaveLength(2);
    expect(validate(doc, builtinRegistry())).toEqual([]);
    const third = doc.compositions.main.order.at(-1)!;
    const plan = detachPlan(doc, builtinRegistry(), 'main', third);
    if ('error' in plan) throw new Error(plan.error);
    const flat = applyOps(doc, plan.ops).doc;
    expect(validate(flat, builtinRegistry())).toEqual([]);
    expect(Object.values(flat.compositions.main.layers).filter((l) => l.type === 'text').map((l) => l.props?.text)).toEqual(['Ada', 'Engineer']);
  });
});
