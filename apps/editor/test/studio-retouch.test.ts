// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Placed } from '../src/retouch.ts';

await import('../src/ai/index.ts');
const st = await import('../src/studio.ts');
const queueMod = await import('../src/ai/queue.ts');
const { newProject } = await import('@tramme/project');
const { load, S } = await import('../src/state.ts');
const { setPrefs } = await import('../src/settings.ts');

const project = newProject({ name: 'T', width: 1000, height: 500, fps: 30, duration: 10 });
load(project.doc, project.manifest, '', '');

const FRAME = { w: 1000, h: 500 };
const placed = (id: string, x: number, y: number, w: number, h: number): Placed => ({ id, name: id.toUpperCase(), type: 'shape.rect', box: { x, y, w, h }, opacity: 1 });
const point = (x = 0.5, y = 0.5) => ({ kind: 'point' as const, at: [x, y] as [number, number] });

beforeEach(() => {
  st.resetRetouch();
  queueMod.queue.value = [];
  S.time.value = 3;
  setPrefs({ areaConfirm: 'always' });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('several pins at once', () => {
  it('gathers pins, each with its own id, and takes one away', () => {
    st.addPin(point(0.1, 0.1));
    st.addPin({ kind: 'path', points: [[0.1, 0.1], [0.9, 0.9]] });
    expect(st.studio.pins.value.map((p) => p.kind)).toEqual(['point', 'path']);
    const [a, b] = st.studio.pins.value;
    expect(a.id).not.toBe(b.id);
    st.removePin(a.id);
    expect(st.studio.pins.value.map((p) => p.id)).toEqual([b.id]);
  });

  it('puts them in the anchor of the next note, and lets go of them once it is sent', () => {
    st.addPin(point());
    expect(st.anchor().pins).toHaveLength(1);
    st.noteSent();
    expect(st.anchor().pins).toBeUndefined();
  });
});

describe('the list of retouches', () => {
  it('takes the words and the pins drawn so far, with the moment and the scene, and starts a new draft', () => {
    st.addPin(point());
    expect(st.addRetouch('make it bigger')).toBe(true);
    expect(st.studio.pins.value).toEqual([]);
    const [r] = st.studio.retouches.value;
    expect(r).toMatchObject({ text: 'make it bigger', time: 3 });
    expect(r.pins).toHaveLength(1);
  });

  it('refuses nothing to say and nothing pinned, but takes pins alone and words alone', () => {
    expect(st.addRetouch('   ')).toBe(false);
    expect(st.addRetouch('a general note')).toBe(true);
    st.addPin(point());
    expect(st.addRetouch('')).toBe(true);
    expect(st.studio.retouches.value).toHaveLength(2);
  });

  it('moves an item up or down, never past the ends, and removes it', () => {
    for (const w of ['one', 'two', 'three']) st.addRetouch(w);
    const [a, b, c] = st.studio.retouches.value;
    st.moveRetouch(c.id, -1);
    expect(st.studio.retouches.value.map((r) => r.text)).toEqual(['one', 'three', 'two']);
    st.moveRetouch(a.id, -1);
    expect(st.studio.retouches.value.map((r) => r.text)).toEqual(['one', 'three', 'two']);
    st.removeRetouch(b.id);
    expect(st.studio.retouches.value.map((r) => r.text)).toEqual(['one', 'three']);
  });

  it('gives an item back to be edited: its pins return, its words are returned, it leaves the list', () => {
    st.addPin(point());
    st.addRetouch('first');
    const [r] = st.studio.retouches.value;
    expect(st.editRetouch(r.id)).toBe('first');
    expect(st.studio.retouches.value).toEqual([]);
    expect(st.studio.pins.value).toHaveLength(1);
  });

  it('is sent as one turn: each item with its own pins, numbered across the list, at its own moment', async () => {
    const flush = vi.spyOn(queueMod, 'flushQueue').mockResolvedValue(undefined);
    st.addPin(point(0.2, 0.2));
    st.addPin({ kind: 'path', points: [[0.1, 0.9], [0.8, 0.2]] });
    st.addRetouch('move 1 along 2');
    S.time.value = 5;
    st.addPin(point(0.7, 0.7));
    st.addRetouch('recolour');
    await st.sendRetouches();
    expect(queueMod.queue.value.map((q) => q.text)).toEqual(['move 1 along 2', 'recolour']);
    expect(queueMod.queue.value.map((q) => q.at)).toEqual([3, 5]);
    expect(queueMod.queue.value.map((q) => q.anchor?.pins?.length)).toEqual([2, 1]);
    expect(flush).toHaveBeenCalledOnce();
    expect(st.studio.retouches.value).toEqual([]);
  });

  it('sends nothing when the list is empty', async () => {
    const flush = vi.spyOn(queueMod, 'flushQueue').mockResolvedValue(undefined);
    await st.sendRetouches();
    expect(flush).not.toHaveBeenCalled();
  });
});

describe('a stroke drawn on the picture', () => {
  const stroke = (xs: [number, number][]) => xs;

  it('as a path becomes a pin with the layer it starts on', () => {
    st.strokeDone('path', stroke([[0.1, 0.5], [0.4, 0.4], [0.9, 0.2]]), [placed('ball', 50, 200, 100, 100)], FRAME, { id: 'ball', name: 'Ball', type: 'shape.ellipse' });
    const [p] = st.studio.pins.value;
    expect(p).toMatchObject({ kind: 'path', under: { id: 'ball' } });
  });

  it('as an area proposes layers and waits for the user (always)', () => {
    const layers = [placed('a', 100, 100, 100, 100), placed('b', 300, 100, 100, 100), placed('far', 800, 300, 100, 100)];
    st.strokeDone('area', [[0.05, 0.1], [0.5, 0.1], [0.5, 0.6], [0.05, 0.6], [0.06, 0.12]], layers, FRAME, null);
    expect(st.studio.pins.value).toEqual([]);
    expect(st.studio.review.value?.candidates.map((c) => [c.id, c.on])).toEqual([['a', true], ['b', true]]);
  });

  it('lets the user drop a layer, add another, and confirm: only the chosen ones become the pin', () => {
    const layers = [placed('a', 100, 100, 100, 100), placed('b', 300, 100, 100, 100)];
    st.strokeDone('area', [[0.05, 0.1], [0.5, 0.1], [0.5, 0.6], [0.05, 0.6], [0.06, 0.12]], layers, FRAME, null);
    st.toggleReview({ id: 'a', name: 'A', type: 'shape.rect' });
    st.toggleReview({ id: 'z', name: 'Z', type: 'text' });
    st.confirmReview('layers');
    const [p] = st.studio.pins.value;
    expect(p.kind === 'area' && p.layers.map((l) => l.id)).toEqual(['b', 'z']);
    expect(st.studio.review.value).toBeNull();
  });

  it('can be used as a hint, with no layer chosen, or set aside', () => {
    const layers = [placed('a', 100, 100, 100, 100)];
    const loop: [number, number][] = [[0.05, 0.1], [0.5, 0.1], [0.5, 0.6], [0.05, 0.6], [0.06, 0.12]];
    st.strokeDone('area', loop, layers, FRAME, null);
    st.confirmReview('hint');
    expect(st.studio.pins.value[0]).toMatchObject({ kind: 'area', layers: [] });
    st.resetRetouch();
    st.strokeDone('area', loop, layers, FRAME, null);
    st.cancelReview();
    expect(st.studio.pins.value).toEqual([]);
    expect(st.studio.review.value).toBeNull();
  });

  it('is taken without asking when the setting says never', () => {
    setPrefs({ areaConfirm: 'never' });
    st.strokeDone('area', [[0.05, 0.1], [0.5, 0.1], [0.5, 0.6], [0.05, 0.6], [0.06, 0.12]], [placed('a', 100, 100, 100, 100)], FRAME, null);
    expect(st.studio.review.value).toBeNull();
    expect(st.studio.pins.value[0]).toMatchObject({ kind: 'area', layers: [{ id: 'a' }] });
  });

  it('is taken without asking for up to three layers when the setting says many, asked for more', () => {
    setPrefs({ areaConfirm: 'many' });
    const few = [placed('a', 100, 100, 50, 50), placed('b', 200, 100, 50, 50)];
    st.strokeDone('area', [[0.05, 0.1], [0.6, 0.1], [0.6, 0.6], [0.05, 0.6], [0.06, 0.12]], few, FRAME, null);
    expect(st.studio.review.value).toBeNull();
    expect(st.studio.pins.value).toHaveLength(1);
    st.resetRetouch();
    const more = [100, 160, 220, 280].map((x, i) => placed(`l${i}`, x, 100, 40, 40));
    st.strokeDone('area', [[0.05, 0.1], [0.7, 0.1], [0.7, 0.6], [0.05, 0.6], [0.06, 0.12]], more, FRAME, null);
    expect(st.studio.review.value?.candidates).toHaveLength(4);
  });

  it('says it is too wide when more than eight layers qualify, and still lets the user use it as a hint', () => {
    setPrefs({ areaConfirm: 'never' });
    const many = Array.from({ length: 12 }, (_, i) => placed(`l${i}`, 20 + i * 30, 100, 20, 20));
    st.strokeDone('area', [[0.01, 0.1], [0.95, 0.1], [0.95, 0.9], [0.01, 0.9], [0.02, 0.12]], many, FRAME, null);
    expect(st.studio.review.value).toMatchObject({ tooMany: true, count: 12, candidates: [] });
    st.confirmReview('hint');
    expect(st.studio.pins.value[0]).toMatchObject({ kind: 'area', layers: [] });
  });
});
