// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { addAdjustmentOps, applyOps, linkOps, rippleDeleteOps, rippleTrimOps, rollOps, slideOps, slipOps, type Composition, type ToolContext, type ToolType, type TrammeDoc } from '@tramme/core';

const { MONTAGE_TOOLS } = await import('../src/montage-tools.ts');
const { editorRegistry } = await import('../src/vocabulary.ts');

const seq = (): Composition => ({
  name: 'Seq', kind: 'sequence', width: 640, height: 360, fps: 30, duration: 12, background: null,
  tracks: [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }],
  order: ['a', 'b', 'c'],
  layers: {
    a: { type: 'video', track: 'V1', in: 0, out: 3, props: { video: 'one' } },
    b: { type: 'video', track: 'V1', in: 3, out: 6, props: { video: 'two', start: 1 } },
    c: { type: 'video', track: 'V1', in: 6, out: 9, props: { video: 'three' } },
  },
});
const doc = (c: Composition): TrammeDoc => ({ schema: 'tramme/1', meta: { title: 't' }, tokens: {}, assets: { pic: { type: 'image', src: 'pic.png', name: 'Pic' } }, root: 'main', compositions: { main: c } }) as TrammeDoc;
const ctx = (c: Composition, over: Partial<ToolContext> = {}): ToolContext => ({ doc: doc(c), compId: 'main', time: 4, selection: [], registry: editorRegistry(), assetUrl: (id: string) => `http://x/${id}`, signal: new AbortController().signal, ...over }) as unknown as ToolContext;
const tool = (name: string) => MONTAGE_TOOLS.find((x) => x.name === name) as ToolType;
const run = async (name: string, args: Record<string, unknown>, c: ToolContext) => tool(name).run(args, c) as unknown as Promise<{ ops: unknown[]; text: string }>;

describe('the editing tools of the assistant', () => {
  it('are named for what they do, and part of the vocabulary of the editor', () => {
    expect(MONTAGE_TOOLS.map((x) => x.name)).toEqual(['ripple_delete', 'insert_clip', 'overwrite_clip', 'ripple_trim', 'roll', 'slip', 'slide', 'detach_audio', 'link', 'sync_clips', 'add_adjustment', 'match_look', 'publish']);
    const reg = editorRegistry();
    for (const x of MONTAGE_TOOLS) expect(reg.hasTool(x.name), x.name).toBe(true);
    for (const x of MONTAGE_TOOLS) { expect(x.ai?.when, x.name).toBeTruthy(); expect(x.description.length, x.name).toBeGreaterThan(40); }
  });

  it('ripple_delete on two ids gives the same operations as rippleDeleteOps', async () => {
    const c = seq(), r = await run('ripple_delete', { clips: ['a', 'b'] }, ctx(c));
    expect(r.ops).toEqual(rippleDeleteOps(doc(c), 'main', ['a', 'b']));
    expect((await run('ripple_delete', {}, ctx(c, { selection: ['b'] }))).ops).toEqual(rippleDeleteOps(doc(c), 'main', ['b']));
  });

  it('the trims, the roll, the slip and the slide are the core operations', async () => {
    const c = seq(), d = doc(c);
    expect((await run('ripple_trim', { clip: 'a', edge: 'out', to: 2 }, ctx(c))).ops).toEqual(rippleTrimOps(d, 'main', 'a', 'out', 2, () => undefined));
    expect((await run('roll', { left: 'a', right: 'b', to: 4 }, ctx(c))).ops).toEqual(rollOps(d, 'main', 'a', 'b', 4));
    expect((await run('slip', { clip: 'b', by: 0.5 }, ctx(c))).ops).toEqual(slipOps(d, 'main', 'b', 0.5));
    expect((await run('slide', { clip: 'b', by: 1 }, ctx(c))).ops).toEqual(slideOps(d, 'main', 'b', 1));
  });

  it('link joins the clips given, and with unlink frees them', async () => {
    const c = seq(), linked = await run('link', { clips: ['a', 'b'] }, ctx(c));
    expect(linked.ops).toEqual(linkOps(doc(c), 'main', ['a', 'b']));
    const after = applyOps(doc(c), linked.ops as never).doc.compositions.main;
    expect((await run('link', { clips: ['a'], unlink: true }, ctx(after))).ops).toHaveLength(2);
  });

  it('add_adjustment puts an adjustment clip on a new track above', async () => {
    const c = seq(), r = await run('add_adjustment', { at: 2, length: 3 }, ctx(c));
    expect(r.ops).toEqual(addAdjustmentOps(doc(c), 'main', null, 2, 3)!.ops);
  });

  it('a tool refused by a locked track says so, as the reason', async () => {
    const c = seq(); c.tracks![0].locked = true;
    await expect(run('ripple_delete', { clips: ['b'] }, ctx(c))).rejects.toThrow(/locked track/);
    await expect(run('slip', { clip: 'b', by: 1 }, ctx(c))).rejects.toThrow(/locked track/);
    await expect(run('ripple_delete', { clips: ['nope'] }, ctx(seq()))).rejects.toThrow(/no such clip/);
  });

  it('insert_clip and overwrite_clip place a picture of the project on a track, a composition without tracks made a sequence', async () => {
    const c = seq(), r = await run('insert_clip', { asset: 'pic', track: 'V1', at: 4.5 }, ctx(c));
    const next = applyOps(doc(c), r.ops as never).doc.compositions.main;
    const added = Object.keys(next.layers).filter((k) => !['a', 'b', 'c', 'b-2'].includes(k));
    expect(added).toHaveLength(1);
    expect([next.layers[added[0]].in, next.layers[added[0]].out, next.layers[added[0]].track]).toEqual([4.5, 9.5, 'V1']);
    const plain = seq(); delete plain.tracks; delete plain.kind; for (const l of Object.values(plain.layers)) delete l.track;
    const o = await run('overwrite_clip', { asset: 'pic', at: 10 }, ctx(plain));
    const made = applyOps(doc(plain), o.ops as never).doc.compositions.main;
    expect(made.kind).toBe('sequence');
    expect(Object.values(made.layers).some((l) => l.type === 'image' && l.in === 10)).toBe(true);
    await expect(run('insert_clip', { asset: 'nope' }, ctx(c))).rejects.toThrow(/expected/);
  });

  it('publish says what stands between the film and a format, and fixes what operations can', async () => {
    const c = seq(), said = await run('publish', { preset: 'short' }, ctx(c));
    expect(said.text).toMatch(/Not ready for short/);
    expect(said.text).toMatch(/aspect/);
    const fixed = await run('publish', { preset: 'landscape', fix: true }, ctx(c));
    const next = applyOps(doc(c), fixed.ops as never).doc.compositions.main;
    expect([next.width, next.height, next.sound?.loudness]).toEqual([1920, 1080, -14]);
    await expect(run('publish', { preset: 'nope' }, ctx(c))).rejects.toThrow(/unknown format/);
  });
});
