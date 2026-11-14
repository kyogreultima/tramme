import { describe, expect, it } from 'vitest';
import { applyOps, validate, type ToolContext, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { editorRegistry } from '../src/vocabulary.ts';

const reg = editorRegistry();
const project = () => newProject({ name: 'Cuts', width: 1080, height: 1920, fps: 30, duration: 30 }).doc;
const ctxOf = (doc: TrammeDoc, transcript: unknown, time = 0): ToolContext =>
  ({ doc, compId: doc.root, time, selection: [], registry: reg, transcript: async () => transcript } as unknown as ToolContext);

/** run a tool of the vocabulary and apply its operations */
async function use(doc: TrammeDoc, transcript: unknown, name: string, input: Record<string, unknown>): Promise<TrammeDoc> {
  const out = (await reg.tool(name).tool.run(input, ctxOf(doc, transcript))) as { ops: never[] };
  return applyOps(doc, out.ops).doc;
}

describe('silences', () => {
  it('split a talking video into the spans where something is said', async () => {
    let doc = project();
    doc = { ...doc, assets: { ...doc.assets, talk: { type: 'video', src: 'assets/talk.mp4' } } };
    doc = applyOps(doc, [
      { op: 'add', path: '/compositions/main/layers/talk', value: { type: 'video', name: 'Talk', in: 0, out: 20, props: { video: 'talk', size: [1080, 1920], fit: 'cover', start: 5 } } },
      { op: 'add', path: '/compositions/main/layers/caption', value: { type: 'text', in: 2, out: 5, props: { text: 'Hello', size: 60 } } },
      { op: 'replace', path: '/compositions/main/order', value: ['talk', 'caption'] },
    ]).doc;
    // the layer shows the file 5 s to 25 s; words at 5-7, one 1.4 s hesitation, then words filling the tail to 25
    const transcript = { version: 1, duration: 25, words: [
      { w: 'So,', s: 5, e: 7 }, { w: 'well,', s: 8.4, e: 9 }, { w: 'here', s: 9, e: 10 }, { w: 'is', s: 10, e: 10.4 }, { w: 'the', s: 10.4, e: 10.7 }, { w: 'thing.', s: 10.7, e: 24 }, { w: 'More.', s: 24, e: 25 },
    ] };
    doc = await use(doc, transcript, 'silences', { video: 'talk', min: 0.5, keep: 0.12 });
    const c = doc.compositions.main;
    const spans = c.order.filter((id) => c.layers[id].props?.video === 'talk');
    expect(spans).toHaveLength(2);
    // the first span keeps the layer: it ends 0.12 s after the last word; the second picks the file up 0.12 s before the next one
    const [a, b] = spans;
    expect(c.layers[a].out).toBeCloseTo(2.12, 2);
    expect(c.layers[b].in as number).toBeCloseTo(c.layers[a].out as number, 2);
    expect((c.layers[b].props as { start: number }).start).toBeCloseTo(8.28, 2);
    // the caption after the cut is left alone
    expect(c.layers.caption.out).toBe(5);
    expect(validate(doc, reg)).toEqual([]);
  });

  it('cut only inside the part of the file the layer shows, the transcript running past it on both sides', async () => {
    let doc = project();
    doc = { ...doc, assets: { ...doc.assets, talk: { type: 'video', src: 'assets/talk.mp4' } } };
    doc = applyOps(doc, [
      { op: 'add', path: '/compositions/main/layers/talk', value: { type: 'video', in: 0, out: 10, props: { video: 'talk', size: [1080, 1920], start: 80 } } },
      { op: 'replace', path: '/compositions/main/order', value: ['talk'] },
    ]).doc;
    // the whole file transcribed: words long before 80 s and after 90 s, with gaps there too; inside, one 2 s gap at 84-86
    const transcript = { version: 1, duration: 200, words: [
      { w: 'early', s: 10, e: 11 }, { w: 'words', s: 30, e: 31 }, { w: 'before', s: 78, e: 80.5 },
      { w: 'inside', s: 80.5, e: 84 }, { w: 'again', s: 86, e: 90.5 }, { w: 'after', s: 120, e: 121 },
    ] };
    doc = await use(doc, transcript, 'silences', { video: 'talk', min: 0.5, keep: 0.12 });
    expect(validate(doc, reg)).toEqual([]);
    const c = doc.compositions.main, spans = c.order.filter((id) => c.layers[id].props?.video === 'talk');
    expect(spans).toHaveLength(2);
    for (const id of spans) expect((c.layers[id].out as number) > (c.layers[id].in ?? 0)).toBe(true);
    // the file from 80 s: the first span to the cut in the 84-86 gap, the second from it to 90 s
    expect((c.layers[spans[0]].props as { start: number }).start).toBe(80);
    // the 2 s gap loses all but 0.12 s on each side: 1.76 s shorter
    expect((c.layers[spans[1]].props as { start: number }).start).toBeCloseTo(85.88, 2);
    expect(c.layers[spans[1]].out as number).toBeCloseTo(10 - 1.76, 2);
  });

  it('refuse what it cannot cut', async () => {
    await expect(use(project(), { version: 1, duration: 10, words: [{ w: 'one', s: 0, e: 1 }] }, 'silences', {})).rejects.toThrow(/no video/);
    let doc = project();
    doc = { ...doc, assets: { ...doc.assets, talk: { type: 'video', src: 'assets/talk.mp4' } } };
    doc = applyOps(doc, [
      { op: 'add', path: '/compositions/main/layers/talk', value: { type: 'video', in: 0, out: 6, props: { video: 'talk', size: [1080, 1920] } } },
      { op: 'replace', path: '/compositions/main/order', value: ['talk'] },
    ]).doc;
    await expect(use(doc, { version: 1, duration: 10, words: [{ w: 'one', s: 0, e: 1 }] }, 'silences', { video: 'talk' })).rejects.toThrow(/too few words/);
    const tight = { version: 1, duration: 10, words: [{ w: 'a', s: 0, e: 2 }, { w: 'b', s: 2.1, e: 4 }, { w: 'c', s: 4.2, e: 6 }] };
    await expect(use(doc, tight, 'silences', { video: 'talk' })).rejects.toThrow(/no silence worth cutting/);
  });
});
