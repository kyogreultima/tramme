import { describe, expect, it } from 'vitest';
import { applyOps, History, type Composition, type TrammeDoc } from '@tramme/core';
import { commandFor, editPlan, type EditEnv } from '../src/ui/timeline/shortcuts.ts';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('the editing keys', () => {
  it('Ctrl+B is a split, Q and W trim to the playhead, L links', () => {
    expect(commandFor(key('b', { ctrlKey: true }))).toBe('split');
    expect(commandFor(key('B', { metaKey: true }))).toBe('split');
    expect(commandFor(key('q'))).toBe('trimIn');
    expect(commandFor(key('w'))).toBe('trimOut');
    expect(commandFor(key('l'))).toBe('link');
    expect(commandFor(key('l', { ctrlKey: true, shiftKey: true }))).toBe('unlink');
  });

  it('Shift+Delete is a ripple delete, Ctrl+C and Ctrl+V copy and paste, Ctrl+Alt+V pastes the attributes', () => {
    expect(commandFor(key('Delete', { shiftKey: true }))).toBe('rippleDelete');
    expect(commandFor(key('Backspace', { shiftKey: true }))).toBe('rippleDelete');
    expect(commandFor(key('c', { ctrlKey: true }))).toBe('copy');
    expect(commandFor(key('v', { ctrlKey: true }))).toBe('paste');
    expect(commandFor(key('v', { ctrlKey: true, altKey: true }))).toBe('pasteAttributes');
  });

  it('a key with other modifiers than its own is nothing', () => {
    expect(commandFor(key('b'))).toBeNull();
    expect(commandFor(key('b', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(commandFor(key('q', { ctrlKey: true }))).toBeNull();
    expect(commandFor(key('Delete'))).toBeNull();
  });
});

const seq = (magnetic = false): Composition => ({
  name: 'Seq', kind: 'sequence', width: 640, height: 360, fps: 30, duration: 12, background: null,
  tracks: [{ id: 'V1', kind: 'video', magnetic }, { id: 'V2', kind: 'video' }, { id: 'A1', kind: 'audio' }],
  order: ['a', 'b', 'c'],
  layers: {
    a: { type: 'video', track: 'V1', in: 0, out: 3, props: { video: 'one' } },
    b: { type: 'video', track: 'V1', in: 3, out: 6, props: { video: 'two' } },
    c: { type: 'video', track: 'V1', in: 6, out: 9, props: { video: 'three' } },
  },
});
const docOf = (c: Composition) => ({ schema: 'tramme/1', meta: { title: 't' }, tokens: {}, assets: {}, root: 'main', compositions: { main: c } }) as TrammeDoc;
const env = (c: Composition, over: Partial<EditEnv> = {}): EditEnv => ({ doc: docOf(c), compId: 'main', selection: [], time: 4, clipboard: null, ...over });

describe('what a key does to the document', () => {
  it('split with nothing selected cuts every unlocked clip under the playhead in one go', () => {
    const c = seq();
    c.layers.t = { type: 'video', track: 'V2', in: 3.5, out: 5, props: { video: 'q' } }; c.order.push('t');
    const plan = editPlan('split', env(c))!;
    expect(plan.select?.sort()).toEqual(['b-2', 't-2']);
    const d = applyOps(docOf(c), plan.ops).doc.compositions.main;
    expect([d.layers.b.out, d.layers['b-2'].in, d.layers.t.out, d.layers['t-2'].in]).toEqual([4, 4, 4, 4]);
  });

  it('undoing a split puts the order and every layer back in one step', () => {
    const c = seq(), doc = docOf(c), h = new History(doc);
    const plan = editPlan('split', env(c, { selection: ['b'] }))!;
    h.apply({ label: 'split', ops: plan.ops, source: 'user' });
    expect(Object.keys(h.doc.compositions.main.layers)).toContain('b-2');
    h.undo();
    expect(h.doc.compositions.main).toEqual(c);
  });

  it('trim to the playhead ripples on a magnetic track, only trims on a free one', () => {
    const free = applyOps(docOf(seq()), editPlan('trimOut', env(seq(), { selection: ['b'] }))!.ops).doc.compositions.main;
    expect([free.layers.b.out, free.layers.c.in]).toEqual([4, 6]);
    const mag = applyOps(docOf(seq(true)), editPlan('trimOut', env(seq(true), { selection: ['b'] }))!.ops).doc.compositions.main;
    expect([mag.layers.b.out, mag.layers.c.in]).toEqual([4, 4]);
    const head = applyOps(docOf(seq()), editPlan('trimIn', env(seq(), { selection: ['b'] }))!.ops).doc.compositions.main;
    expect([head.layers.b.in, head.layers.b.props!.start]).toEqual([4, 1]);
  });

  it('nothing happens when the playhead is not inside the clip', () => {
    expect(editPlan('trimOut', env(seq(), { selection: ['a'] }))).toBeNull();
    expect(editPlan('split', env(seq(), { selection: ['a'] }))).toBeNull();
  });

  it('shift+delete removes the selection and closes up behind it', () => {
    const d = applyOps(docOf(seq()), editPlan('rippleDelete', env(seq(), { selection: ['b'] }))!.ops).doc.compositions.main;
    expect([d.layers.b, d.layers.c.in]).toEqual([undefined, 3]);
  });

  it('copy remembers the clips, paste puts them at the playhead, attributes copy the look', () => {
    const c = seq();
    c.layers.a.effects = [{ id: 'blur', type: 'fx.blur', props: { radius: 3 } }];
    const copy = editPlan('copy', env(c, { selection: ['a'] }))!;
    expect(copy.copied?.ids).toEqual(['a']);
    const paste = editPlan('paste', env(c, { time: 9, clipboard: copy.copied! }))!;
    const d = applyOps(docOf(c), paste.ops).doc.compositions.main;
    const added = Object.keys(d.layers).filter((k) => !['a', 'b', 'c'].includes(k));
    expect(added).toHaveLength(1);
    expect([d.layers[added[0]].in, d.layers[added[0]].out, d.layers[added[0]].track]).toEqual([9, 12, 'V1']);
    const look = editPlan('pasteAttributes', env(c, { selection: ['b'], clipboard: copy.copied! }))!;
    expect(applyOps(docOf(c), look.ops).doc.compositions.main.layers.b.effects).toHaveLength(1);
  });

  it('a link joins the selection, an unlink frees it', () => {
    const c = seq();
    const linked = applyOps(docOf(c), editPlan('link', env(c, { selection: ['a', 'b'] }))!.ops).doc.compositions.main;
    expect(linked.layers.a.link).toBe(linked.layers.b.link);
    expect(editPlan('link', env(c, { selection: ['a'] }))).toBeNull();
    const freed = applyOps(docOf(linked), editPlan('unlink', env(linked, { selection: ['a'] }))!.ops).doc.compositions.main;
    expect([freed.layers.a.link, freed.layers.b.link]).toEqual([undefined, undefined]);
  });

  it('a clip on a locked track refuses every edit', () => {
    const c = seq(); c.tracks![0].locked = true;
    expect(editPlan('split', env(c, { selection: ['b'] }))).toBeNull();
    expect(editPlan('rippleDelete', env(c, { selection: ['b'] }))).toBeNull();
    expect(editPlan('trimOut', env(c, { selection: ['b'] }))).toBeNull();
  });
});
