import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import type { Composition, Layer, NodeType, TrammeDoc } from '@tramme/core';
import { formLines, formOf } from '../src/forms.ts';
import type { FilmPlan, PictureKind } from '../src/filmplan.ts';

/** a node of a pack, sized by its `size` (the packs load into the editor's registry at run time) */
const sized = (type: string): NodeType => ({
  type, title: type, category: 'Test', props: { size: { type: 'vec2', default: [600, 600], label: 'Size' } },
  bounds: ({ size: [w, h] }: { size: [number, number] }) => ({ x: -w / 2, y: -h / 2, w, h }), render: {},
});
const registry = builtinRegistry().register(...['ui.device', 'chart.bar', 'solid.3d', 'map.route', 'diagram.balance'].map(sized));

const W = 1920, H = 1080;
/** layers sit at the centre of the frame unless they say otherwise */
const centred = (layers: Record<string, Layer>) => Object.fromEntries(Object.entries(layers).map(([id, l]) => [id, { transform: { position: [W / 2, H / 2] }, ...l } as Layer]));
const comp = (layers: Record<string, Layer>, o: Partial<Composition> = {}): Composition => ({ name: 'Scene', width: W, height: H, fps: 30, duration: 4, layers: centred(layers), order: Object.keys(layers), ...o });
const docOf = (compositions: Record<string, Composition>, root = 'main'): TrammeDoc => ({ version: 1, root, compositions, assets: {}, tokens: {} } as unknown as TrammeDoc);
const one = (layers: Record<string, Layer>) => docOf({ main: comp(layers) });
const kindOf = (layers: Record<string, Layer>) => formOf(one(layers), 'main', { registry });

const text = (size: number, extra: Partial<Layer> = {}): Layer => ({ type: 'text', props: { text: 'Hello', size }, ...extra });
const ground: Layer = { type: 'shape.rect', props: { size: [W, H] } };
const image = (w: number, h: number): Layer => ({ type: 'image', props: { size: [w, h] } });

describe('the form a scene is built in', () => {
  it('reads an interface from its ui parts, naming them', () => {
    const f = kindOf({ ground, phone: { type: 'ui.device', props: { size: [500, 900] } } });
    expect(f.kind).toBe('interface');
    expect(f.why).toContain('ui.device');
  });

  it('reads data, 3d, a map and a diagram from their layers', () => {
    expect(kindOf({ c: { type: 'chart.bar', props: {} } }).kind).toBe('data');
    expect(kindOf({ c: { type: 'text.counter', props: { size: 200 } } }).kind).toBe('data');
    expect(kindOf({ c: { type: 'solid.3d', props: {} } }).kind).toBe('3d');
    expect(kindOf({ c: { type: 'model.3d', props: {} } }).kind).toBe('3d');
    expect(kindOf({ c: { type: 'map.route', props: {} } }).kind).toBe('map');
    expect(kindOf({ c: { type: 'diagram.balance', props: {} } }).kind).toBe('diagram');
  });

  it('reads type from large text on a ground, and not from small text', () => {
    expect(kindOf({ ground, headline: text(200) }).kind).toBe('type');
    expect(kindOf({ ground, caption: text(40) }).kind).toBeNull();
  });

  it('reads a photo when a picture covers half the frame, an object when it covers less', () => {
    expect(kindOf({ big: image(W, H) }).kind).toBe('photo');
    expect(kindOf({ small: image(500, 500) }).kind).toBe('object');
    expect(kindOf({ big: image(W, H), caption: text(40) }).kind).toBe('photo');
  });

  it('is null for an empty composition', () => {
    expect(kindOf({}).kind).toBeNull();
  });

  it('reads through nested groups and compositions, the largest area winning', () => {
    const doc = docOf({
      main: comp({ stack: { type: 'group', children: ['inner'] }, inner: { type: 'group', transform: {}, children: ['deep'] }, deep: { type: 'comp', transform: {}, props: { comp: 'part' } }, small: image(300, 300) }, { order: ['stack', 'small'] }),
      part: comp({ chart: { type: 'chart.bar', props: { size: [1200, 800] } } }),
    });
    const f = formOf(doc, 'main', { registry });
    expect(f.kind).toBe('data');
  });
});

describe('the forms of a film, in the check', () => {
  const scene = (i: number, kind: 'ui' | 'type'): [string, Composition] => [`film-0${i}`, comp(kind === 'ui' ? { phone: { type: 'ui.device', props: { size: [500, 900] } } } : { ground, headline: text(200) })];
  const film = (kinds: ('ui' | 'type')[]) => docOf({
    main: comp(Object.fromEntries(kinds.map((_, i) => [`scene-0${i + 1}`, { type: 'comp', name: `Scene ${i + 1}`, in: i * 4, out: (i + 1) * 4, props: { comp: `film-0${i + 1}` } } as Layer])), { duration: kinds.length * 4 }),
    ...Object.fromEntries(kinds.map((k, i) => scene(i + 1, k))),
  });
  const plan = (o: Partial<FilmPlan> = {}): FilmPlan => ({ version: 1, kind: 'film-plan', updated: '', idea: 'x', kinds: ['interface', 'type', 'object'], scenes: [], directions: [], ...o });
  const planned = (...kinds: PictureKind[]) => kinds.map((kind, i) => ({ id: `scene-${i + 1}`, name: `Scene ${i + 1}`, kind, idea: 'i' }));

  it('names the scenes built one form after another, and points at the film plan', () => {
    const lines = formLines(film(['ui', 'ui', 'ui', 'type']), 'main', null, registry);
    expect(lines).toHaveLength(1);
    for (const n of ['Scene 1', 'Scene 2', 'Scene 3']) expect(lines[0]).toContain(n);
    expect(lines[0]).not.toContain('Scene 4');
    expect(lines[0]).toContain('interface (ui.device)');
    expect(lines[0]).toContain('film plan');
  });

  it('says when a scene is planned in one kind and built in another', () => {
    const lines = formLines(film(['ui', 'ui', 'type', 'ui']), 'main', plan({ scenes: planned('interface', 'object', 'type', 'interface') }), registry);
    expect(lines.some((l) => l.includes('Scene 2') && l.includes('planned as object') && l.includes('built as interface'))).toBe(true);
  });

  it('repeats the issues of the plan', () => {
    const lines = formLines(film(['ui', 'type']), 'main', plan({ kinds: ['interface'], scenes: planned('interface', 'interface') }), registry);
    expect(lines.some((l) => l.includes('Scene 1') && l.includes('Scene 2') && l.includes('both interface'))).toBe(true);
  });

  it('gives no line for a single scene or for scenes in different forms', () => {
    expect(formLines(film(['ui']), 'main', plan({ kinds: ['interface'], scenes: planned('interface', 'interface') }), registry)).toEqual([]);
    expect(formLines(film(['ui', 'type', 'ui']), 'main', null, registry)).toEqual([]);
  });
});
