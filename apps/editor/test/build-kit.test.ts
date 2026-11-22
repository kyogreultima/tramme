import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { applyOps, validate, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { makeKit, type BuildData } from '../src/build-kit.ts';
import { buildOps, changedSince, hashOf, outputIssue, readRecord, BUILDER, recordPathOf, touchedComp } from '../src/build.ts';
import { connectHost } from '../src/plugins/host.ts';
import { startWorkerSide } from '../src/plugins/worker-side.ts';

const data = (over: Partial<BuildData> = {}): BuildData => ({
  comp: { id: 'scene', width: 1920, height: 1080, fps: 30, duration: 4 },
  tokens: ['out', 'ink'], assets: { display: { type: 'font', family: 'Display Sans' }, logo: { type: 'image', name: 'Logo' } }, taken: [], ...over,
});

describe('the scene builder kit', () => {
  it('splits one options object into the transform, the layer and the props, with unique ids that avoid the taken ones', () => {
    const { kit, finish } = makeKit(data({ taken: ['title'] }));
    const a = kit.text('Title', { position: [960, 540], scale: 2, in: 1.2345, size: 90, color: '@ink', font: 'display' });
    const b = kit.text('Title', { opacity: 0.5 });
    const out = finish();
    expect([a, b]).toEqual(['title-2', 'title-3']);
    expect(out.layers[a]).toEqual({ type: 'text', name: 'Title', transform: { position: [960, 540], scale: [2, 2] }, in: 1.235, props: { baseline: 'middle', size: 90, color: '@ink', font: 'display', text: 'Title' } });
    expect(out.order).toEqual([a, b]);
  });

  it('makes a scale given as numbers both axes, fixed or keyed', () => {
    const { kit, finish } = makeKit(data());
    const a = kit.rect({ scale: kit.key([0, 0.5, '@out'], [1, 1]) }), b = kit.rect({ scale: { $v: 2, $mod: [] } });
    const out = finish();
    expect(out.layers[a].transform!.scale).toEqual({ $k: [{ t: 0, v: [0.5, 0.5], ease: '@out' }, { t: 1, v: [1, 1] }] });
    expect(out.layers[b].transform!.scale).toEqual({ $v: [2, 2], $mod: [] });
  });

  it('groups layers: they leave the root for the group, bottom first', () => {
    const { kit, finish } = makeKit(data());
    const a = kit.rect({ size: [10, 10] }), b = kit.ellipse({ size: [10, 10] }), c = kit.rect({ name: 'Top' });
    const g = kit.group([a, b], { name: 'Card', position: [100, 100] });
    const out = finish();
    expect(out.order).toEqual([c, g]);
    expect(out.layers[g]).toMatchObject({ type: 'group', children: [a, b], transform: { position: [100, 100] } });
    expect(() => kit.group(['nothing'])).toThrow(/no layer "nothing"/);
  });

  it('puts every key of a stepped list between two frames, the last value of one instant winning', () => {
    const { kit } = makeKit(data());
    // 40 characters a second at 30 fps: two letters can share a frame
    const typed = kit.typing('abc', 1, 40);
    const times = typed.text.$k.map((k) => k.t);
    for (const t of times) expect((t * 30) % 1).toBeCloseTo(0.5, 2);
    expect(new Set(times).size).toBe(times.length);
    expect(typed.text.$k.at(-1)!.v).toBe('abc');
    expect(typed.end).toBeCloseTo(1.075);
    // without a step, the times are the given ones
    expect(kit.key([0.2, 0, '@out'], [0.6, 1]).$k).toEqual([{ t: 0.2, v: 0, ease: '@out' }, { t: 0.6, v: 1 }]);
  });

  it('gives an entrance and its exit as keyframes to spread, with the document\'s ease token or the house curve', () => {
    const { kit, finish } = makeKit(data());
    const id = kit.image('logo', { size: [200, 200], ...kit.enter(1, { at: [500, 400], dy: 30, from: 0.8, exit: { t: 3, dy: -20 } }) });
    const l = finish().layers[id];
    expect(l.name).toBe('Logo');
    expect((l.transform!.position as { $k: { v: unknown }[] }).$k.map((k) => k.v)).toEqual([[500, 430], [500, 400], [500, 400], [500, 380]]);
    expect((l.transform!.opacity as { $k: { ease?: unknown }[] }).$k[0].ease).toBe('@out');
    expect((l.transform!.opacity as { $k: { ease?: unknown }[] }).$k[2].ease).toEqual([0.7, 0, 0.84, 0]);
    expect(l.effects).toEqual([{ id: 'enter-blur', type: 'fx.blur', props: { radius: expect.objectContaining({ $k: expect.any(Array) }) } }]);
  });

  it('keeps a landed layer drifting until its next beat, then leaves from where it drifted', () => {
    const { kit, finish } = makeKit(data());
    const id = kit.rect({ ...kit.enter(1, { at: [100, 100], dy: 20, drift: { until: 3, dy: -10, scale: 1.04 }, exit: { t: 3.5, dy: -30, to: 0.9 } }) });
    const tr = finish().layers[id].transform!;
    expect((tr.position as { $k: { t: number; v: unknown }[] }).$k.map((k) => [k.t, k.v])).toEqual([[1, [100, 120]], [1.35, [100, 100]], [3, [100, 90]], [3.5, [100, 90]], [3.7, [100, 60]]]);
    expect((tr.scale as { $k: { v: number[] }[] }).$k.map((k) => k.v[0])).toEqual([1, 1, 1.04, 1.04, expect.closeTo(0.936, 5)]);
  });

  it('measures with the font asset\'s family, the widest line', () => {
    const seen: string[] = [];
    const { kit } = makeKit(data(), (text, family, size) => { seen.push(family); return text.length * size; });
    expect(kit.measure('ab\nabcd', { font: 'display', size: 10 })).toBe(40);
    expect(kit.measure('x', { size: 10 })).toBe(10);
    expect(seen).toEqual(['Display Sans', 'Display Sans', 'sans-serif']);
  });
});

const project = (): TrammeDoc => newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 4 }).doc;

describe('a build put into a composition', () => {
  it('replaces its own layers, keeps the others in place, refuses nothing the validator would', () => {
    let doc = project();
    const root = doc.root;
    doc.compositions[root].layers.music = { type: 'audio', props: { audio: null } } as never;
    doc.compositions[root].order.push('music');
    const first = makeKit(data({ comp: { id: root, width: 1920, height: 1080, fps: 30, duration: 4 }, taken: ['music'] }));
    first.kit.text('Hello', { position: [960, 540], size: 80 });
    first.kit.set({ duration: 3 });
    const one = buildOps(doc, root, first.finish(), null, 'assets/builds/hello.js');
    doc = applyOps(doc, one.ops).doc;
    expect(validate(doc, builtinRegistry())).toEqual([]);
    expect(doc.compositions[root].order).toEqual(['music', 'hello']);
    expect(doc.compositions[root].duration).toBe(3);
    expect(changedSince(doc, one.record)).toEqual([]);

    // built again: its old text goes, its new layers take its place, the sound stays
    const again = makeKit(data({ comp: { id: root, width: 1920, height: 1080, fps: 30, duration: 3 }, taken: ['music'] }));
    const a = again.kit.rect({ name: 'Card', size: [400, 200] }), b = again.kit.text('Bye', {});
    again.kit.group([a, b], { name: 'Box' });
    const two = buildOps(doc, root, again.finish(), one.record, 'assets/builds/hello.js');
    doc = applyOps(doc, two.ops).doc;
    expect(validate(doc, builtinRegistry())).toEqual([]);
    expect(Object.keys(doc.compositions[root].layers).sort()).toEqual(['box', 'bye', 'card', 'music']);
    expect(doc.compositions[root].order).toEqual(['music', 'box']);

    // a layer of the build changed by hand is said
    doc.compositions[root].layers.bye.props!.text = 'Hand';
    expect(changedSince(doc, two.record)).toEqual(['bye']);
  });

  it('brings back to the root a layer of someone else\'s that sat in one of its groups, and makes a missing composition', () => {
    let doc = project();
    const root = doc.root;
    const k1 = makeKit(data({ comp: { id: root, width: 1920, height: 1080, fps: 30, duration: 4 } }));
    const g = k1.kit.group([k1.kit.rect({ name: 'A' })], { name: 'G' });
    const one = buildOps(doc, root, k1.finish(), null, 'assets/builds/g.js');
    doc = applyOps(doc, one.ops).doc;
    doc.compositions[root].layers.mine = { type: 'shape.rect', props: {} } as never;
    doc.compositions[root].layers[g].children!.push('mine');
    const k2 = makeKit(data({ comp: { id: root, width: 1920, height: 1080, fps: 30, duration: 4 }, taken: ['mine'] }));
    k2.kit.rect({ name: 'B' });
    doc = applyOps(doc, buildOps(doc, root, k2.finish(), one.record, 'assets/builds/g.js').ops).doc;
    expect(validate(doc, builtinRegistry())).toEqual([]);
    expect(doc.compositions[root].order).toEqual(['b', 'mine']);

    const k3 = makeKit(data());
    k3.kit.rect({ name: 'C' });
    k3.kit.set({ duration: 2 });
    doc = applyOps(doc, buildOps(doc, 'scene', k3.finish(), null, 'assets/builds/scene.js').ops).doc;
    expect(doc.compositions.scene).toMatchObject({ width: 1920, height: 1080, fps: 30, duration: 2, order: ['c'] });
    expect(validate(doc, builtinRegistry())).toEqual([]);
  });

  it('reads the checks in the one composition a batch changes', () => {
    expect(touchedComp([{ op: 'add', path: '/compositions/s2/layers/a', value: {} }, { op: 'replace', path: '/compositions/s2/order', value: [] }])).toBe('s2');
    expect(touchedComp([{ op: 'add', path: '/compositions/a~1b/layers/x', value: {} }])).toBe('a/b');
    expect(touchedComp([{ op: 'add', path: '/compositions/s1/layers/a', value: {} }, { op: 'add', path: '/compositions/s2/layers/a', value: {} }])).toBeUndefined();
    expect(touchedComp([{ op: 'add', path: '/tokens/ink', value: {} }])).toBeUndefined();
  });

  it('names its files and checks what comes back', () => {
    expect(BUILDER.test('assets/builds/opening.js')).toBe(true);
    expect(BUILDER.test('assets/builds/../x.js')).toBe(false);
    expect(BUILDER.test('plugins/opening.js')).toBe(false);
    expect(recordPathOf('assets/builds/opening.js')).toBe('assets/builds/opening.json');
    expect(readRecord('not json')).toBeNull();
    expect(readRecord(JSON.stringify({ version: 1, kind: 'build', script: 's', comp: 'c', hashes: { a: hashOf(1) } }))?.comp).toBe('c');
    expect(outputIssue({ layers: {}, order: [], set: {} })).toMatch(/made no layer/);
    expect(outputIssue(null)).toMatch(/no layers/);
  });
});

describe('a builder run in the sandbox', () => {
  const pair = () => {
    const side = startWorkerSide({ post: (m) => queueMicrotask(() => receive(m)), importModule: (url) => import(/* @vite-ignore */ url) });
    const { host, receive } = connectHost((m) => queueMicrotask(() => side.receive(m)), () => 'https://tramme.test/p1/document.tramme.json');
    return host;
  };

  it('runs the script\'s default export with the kit and gives back plain layers', async () => {
    const out = await pair().build(`export default function (k) { k.text('Hi ' + k.width, { position: [k.cx, k.cy] }); k.set({ duration: 2 }); }`, data()) as { order: string[]; set: unknown };
    expect(out.order).toEqual(['hi-1920']);
    expect(out.set).toEqual({ duration: 2 });
  });

  it('says what a failing script did wrong', async () => {
    await expect(pair().build(`export default function (k) { k.group(['ghost']); }`, data())).rejects.toThrow(/no layer "ghost"/);
    await expect(pair().build(`export const x = 1;`, data())).rejects.toThrow(/exports no function/);
  });
});
