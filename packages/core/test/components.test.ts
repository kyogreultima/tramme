import { describe, expect, it } from 'vitest';
import { applyOps, BUILTIN_CHECKS, defineComponentPlan, detachPlan, Evaluator, runChecks, validate, type Instance, type NodeType, type TrammeDoc } from '../src/index.ts';
import { registry as baseRegistry } from './fixtures.ts';

const compNode: NodeType = {
  type: 'comp', title: 'Composition', category: 'test',
  props: {
    comp: { type: 'comp', default: null, nullable: true, animatable: false },
    start: { type: 'number', default: 0 }, speed: { type: 'number', default: 1 },
    loop: { type: 'bool', default: false }, remap: { type: 'number', default: null, nullable: true }, crop: { type: 'bool', default: true },
  },
  render: { canvas2d() {} },
};
const registry = () => baseRegistry().register(compNode);

/** a card component (colour and title exposed) and a scene holding two instances of it */
function doc(): TrammeDoc {
  return {
    schema: 'tramme/1', meta: { title: 'components' }, tokens: { brand: { type: 'color', value: '#FF0000' } }, assets: {}, root: 'main',
    styles: {
      pop: { props: { 'transform.scale': { $k: [{ t: 0, v: [0, 0] }, { t: 1, v: [1, 1] }] } } },
      ink: { props: { fill: '#111111', radius: 8 } },
    },
    compositions: {
      card: {
        name: 'Card', width: 200, height: 100, fps: 30, duration: 5,
        params: {
          color: { type: 'color', targets: ['bg.fill'], default: '#FFFFFF' },
          title: { type: 'string', targets: ['label.label'] },
          size: { type: 'vec2', targets: ['bg.size', 'label.size'] },
        },
        layers: {
          bg: { type: 'box', props: { size: [200, 100], fill: '#000000', radius: 4 } },
          label: { type: 'box', props: { label: 'Card', radius: { $link: 'bg.radius' } } },
        },
        order: ['bg', 'label'],
      },
      main: {
        name: 'Main', width: 1000, height: 1000, fps: 30, duration: 5,
        layers: {
          one: { type: 'comp', props: { comp: 'card' }, params: { color: '@brand', title: 'One' } },
          two: { type: 'comp', props: { comp: 'card' }, params: { title: { $k: [{ t: 0, v: 'A' }, { t: 1, v: 'B', ease: 'hold' }] } }, overrides: { 'bg.radius': 20 } },
          plain: { type: 'comp', props: { comp: 'card' } },
        },
        order: ['one', 'two', 'plain'],
      },
    },
  };
}

const instanceOf = (ev: Evaluator, id: string, t: number) => ev.layerAt(id, t, 'main').props.$instance as Instance;

describe('parametric components', () => {
  it('an instance reads the component through its parameters, the default where it gives none', () => {
    const ev = new Evaluator(doc(), registry());
    const one = ev.frame(0, 'card', instanceOf(ev, 'one', 0));
    expect(one.layers[0].props.fill).toBe('#FF0000');
    expect(one.layers[1].props.label).toBe('One');
    // size has neither value nor default: the component's own
    expect(one.layers[0].props.size).toEqual([200, 100]);
    const plain = ev.frame(0, 'card', instanceOf(ev, 'plain', 0));
    expect(plain.layers[0].props.fill).toBe('#FFFFFF');
    expect(plain.layers[1].props.label).toBe('Card');
    // the component itself, read alone, is unchanged by the instances read before
    expect(ev.frame(0, 'card').layers[0].props.fill).toBe('#000000');
  });

  it('parameters animate in the holding composition; overrides reach any property, links follow them', () => {
    const ev = new Evaluator(doc(), registry());
    expect(ev.frame(0, 'card', instanceOf(ev, 'two', 0)).layers[1].props.label).toBe('A');
    const later = ev.frame(0, 'card', instanceOf(ev, 'two', 2));
    expect(later.layers[1].props.label).toBe('B');
    expect(later.layers[0].props.radius).toBe(20);
    // label.radius links bg.radius: it reads the override too
    expect(later.layers[1].props.radius).toBe(20);
    expect(ev.frame(0, 'card', instanceOf(ev, 'one', 0)).layers[1].props.radius).toBe(4);
  });

  it('a value given to a vec2 parameter lands on every target', () => {
    const d = doc();
    d.compositions.main.layers.one.params!.size = [50, 60];
    const ev = new Evaluator(d, registry());
    const f = ev.frame(0, 'card', instanceOf(ev, 'one', 0));
    expect(f.layers.map((l) => l.props.size)).toEqual([[50, 60], [50, 60]]);
  });

  it('validation: unknown parameter, wrong type, missing target, a component holding itself', () => {
    expect(validate(doc(), registry())).toEqual([]);
    const d = doc();
    d.compositions.main.layers.one.params!.colour = '#000';
    d.compositions.main.layers.two.params!.title = 3;
    d.compositions.main.layers.two.overrides!['bg.nope'] = 1;
    d.compositions.card.params!.ghost = { type: 'number', targets: ['missing.radius'] };
    d.compositions.card.params!.wrong = { type: 'number', targets: ['bg.fill'] };
    d.compositions.card.params!.odd = { type: 'shape', targets: ['bg.radius'] };
    d.compositions.main.layers.bg = { type: 'box', params: { x: 1 } };
    d.compositions.main.order.push('bg');
    const paths = validate(d, registry()).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining([
      '/compositions/main/layers/one/params/colour',
      '/compositions/main/layers/two/params/title',
      '/compositions/main/layers/two/overrides/bg.nope',
      '/compositions/card/params/ghost/targets/0',
      '/compositions/card/params/wrong/targets/0',
      '/compositions/card/params/odd/type',
      '/compositions/main/layers/bg/type',
    ]));
    const loop = doc();
    loop.compositions.card.layers.self = { type: 'comp', props: { comp: 'card' } };
    loop.compositions.card.order.push('self');
    expect(validate(loop, registry()).some((i) => /loop/.test(i.message))).toBe(true);
  });

  it('a link reads an instance parameter by its address', () => {
    const d = doc();
    d.compositions.main.layers.tag = { type: 'box', props: { label: { $link: 'one.params.title' } } };
    d.compositions.main.order.push('tag');
    expect(validate(d, registry())).toEqual([]);
    expect(new Evaluator(d, registry()).layerAt('tag', 0, 'main').props.label).toBe('One');
  });
});

describe('styles and animations', () => {
  const styled = () => {
    const d = doc();
    d.compositions.main.layers.dot = { type: 'box', props: { fill: '#FFFFFF', radius: 2 }, styles: [{ style: 'ink' }, { style: 'pop', at: 2 }] };
    d.compositions.main.order.push('dot');
    return d;
  };

  it('a style sets its properties over the layer\'s own, an animation moved to where it is used', () => {
    const ev = new Evaluator(styled(), registry());
    const at = (t: number) => ev.layerAt('dot', t, 'main');
    expect(at(0).props.fill).toBe('#111111');
    expect(at(0).props.radius).toBe(8);
    expect(at(2).transform.scale).toEqual([0, 0]);
    expect(at(2.5).transform.scale).toEqual([0.5, 0.5]);
    expect(at(4).transform.scale).toEqual([1, 1]);
  });

  it('a style applied to another property by its map; validation of styles', () => {
    const d = styled();
    d.compositions.main.layers.dot.styles = [{ style: 'pop', map: { 'transform.scale': 'size' } }];
    const ev = new Evaluator(d, registry());
    expect(ev.layerAt('dot', 0.5, 'main').props.size).toEqual([0.5, 0.5]);
    expect(validate(d, registry())).toEqual([]);
    d.compositions.main.layers.dot.styles = [{ style: 'nope' }, { style: 'ink', map: { stroke: 'fill' } }];
    d.styles!.ink.props.radius = 'round';
    d.compositions.main.layers.grp = { type: 'group', children: [], styles: [{ style: 'ink' }] };
    d.compositions.main.order.push('grp');
    const paths = validate(d, registry()).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining([
      '/compositions/main/layers/dot/styles/0/style',
      '/compositions/main/layers/dot/styles/1/map/stroke',
      '/styles/ink/props/radius',
      '/compositions/main/layers/grp/styles/0',
    ]));
  });
});


describe('detach', () => {
  const rect: NodeType = { type: 'shape.rect', title: 'Rect', category: 'test', props: { size: { type: 'vec2', default: [1, 1] }, fill: { type: 'paint', default: '#FFFFFF', nullable: true } }, path: () => null, render: { canvas2d() {} } };
  const reg = () => registry().register(rect);

  it('turns an instance into plain layers with its parameters and overrides written in, in the composition\'s time', () => {
    const d = doc();
    d.compositions.main.layers.two.in = 1;
    d.compositions.card.layers.bg.transform = { position: { $k: [{ t: 0, v: [0, 0] }, { t: 1, v: [10, 0] }] } };
    const plan = detachPlan(d, reg(), 'main', 'two');
    if ('error' in plan) throw new Error(plan.error);
    const out = applyOps(d, plan.ops).doc, main = out.compositions.main;
    expect(validate(out, reg())).toEqual([]);
    const g = main.layers.two;
    expect(g.type).toBe('group');
    expect(g.in).toBe(1);
    // the component's ids kept where free; the frame that crops it, then the content
    expect(main.layers.bg.props!.radius).toBe(20);
    expect(main.layers.label.props!.label).toEqual({ $k: [{ t: 0, v: 'A' }, { t: 1, v: 'B', ease: 'hold' }] });
    expect(main.layers.bg.props!.fill).toEqual({ $v: '#FFFFFF' });
    expect(main.layers.bg.transform!.position).toEqual({ $k: [{ t: 1, v: [0, 0] }, { t: 2, v: [10, 0] }] });
    expect([main.layers.bg.in, main.layers.bg.out]).toEqual([1, 6]);
    // a second instance: the ids taken, its own
    const again = detachPlan(out, reg(), 'main', 'one');
    if ('error' in again) throw new Error(again.error);
    const both = applyOps(out, again.ops).doc;
    expect(validate(both, reg())).toEqual([]);
    expect(both.compositions.main.layers['one-label'].props!.label).toBe('One');
    // the link to the plate renamed with it
    expect(both.compositions.main.layers['one-label'].props!.radius).toEqual({ $link: 'one-bg.radius' });
  });

  it('refuses what would not draw the same', () => {
    const d = doc();
    expect(detachPlan(d, reg(), 'main', 'missing')).toEqual({ error: 'not-instance' });
    d.compositions.main.layers.one.props!.speed = 2;
    expect(detachPlan(d, reg(), 'main', 'one')).toEqual({ error: 'timing' });
    d.compositions.main.layers.two.in = 1;
    d.compositions.card.layers.bg.props!.radius = { $expr: 't * 2' };
    expect(detachPlan(d, reg(), 'main', 'two')).toEqual({ error: 'time' });
    expect(detachPlan(d, reg(), 'main', 'plain')).not.toHaveProperty('error');
    d.compositions.card.layers.bg.props!.radius = { $expr: 'comp.width / 10' };
    expect(detachPlan(d, reg(), 'main', 'plain')).toEqual({ error: 'time' });
  });
});

describe('distribution', () => {
  const placed = (d: TrammeDoc, t = 0) => new Evaluator(d, registry(), { data: (id) => (id === 'people' ? [{ name: 'Ada' }, { name: 'Alan' }, { name: 'Grace' }] : undefined) }).layerAt('many', t, 'main').props.$instances as ({ instance: Instance; at: [number, number]; rotation: number })[];
  const withMany = (distribute: TrammeDoc['compositions'][string]['layers'][string]['distribute']) => {
    const d = doc();
    d.compositions.main.layers.many = { type: 'comp', props: { comp: 'card' }, params: { title: 'Same' }, distribute };
    d.compositions.main.order.push('many');
    return d;
  };

  it('places N instances by a layout: a grid, a list, a circle, a path', () => {
    const grid = placed(withMany({ count: 5, layout: { type: 'grid', columns: 3, spacing: [10, 20] } }));
    expect(grid.map((p) => p.at)).toEqual([[-10, -10], [0, -10], [10, -10], [-10, 10], [0, 10]]);
    expect(placed(withMany({ count: 3, layout: { type: 'list', direction: 'vertical', spacing: 5 } })).map((p) => p.at)).toEqual([[0, -5], [0, 0], [0, 5]]);
    const ring = placed(withMany({ count: 4, layout: { type: 'circle', radius: 100, rotate: true } }));
    expect(ring[0].at[0]).toBeCloseTo(0, 9);
    expect(ring[0].at[1]).toBeCloseTo(-100, 9);
    expect(ring[1].at[0]).toBeCloseTo(100, 9);
    expect(ring.map((p) => p.rotation)).toEqual([0, 90, 180, 270]);
    const line = placed(withMany({ count: 3, layout: { type: 'path', path: { v: [[0, 0], [100, 0]] }, rotate: true } }));
    expect(line.map((p) => p.at)).toEqual([[0, 0], [50, 0], [100, 0]]);
    expect(line[1].rotation).toBe(0);
  });

  it('gives each parameter by its rule: an expression of index and count, the palette, a row of data', () => {
    const d = withMany({ rows: 'people', layout: { type: 'list' }, params: { title: { $expr: 'row.name + " " + (index + 1) + "/" + count' }, color: { $palette: 'order', colors: ['#000000', '#FFFFFF'] } } });
    d.assets.people = { type: 'json', src: 'people.json' };
    expect(validate(d, registry())).toEqual([]);
    const ev = new Evaluator(d, registry(), { data: (id) => (id === 'people' ? [{ name: 'Ada' }, { name: 'Alan' }, { name: 'Grace' }] : undefined) });
    const list = ev.layerAt('many', 0, 'main').props.$instances as { instance: Instance }[];
    const read = (k: number) => ev.frame(0, 'card', list[k].instance).layers;
    expect(list).toHaveLength(3);
    expect(read(0)[1].props.label).toBe('Ada 1/3');
    expect(read(2)[1].props.label).toBe('Grace 3/3');
    expect(read(0)[0].props.fill).toBe('#000000');
    expect(read(1)[0].props.fill).toBe('#FFFFFF');
    expect(read(2)[0].props.fill).toBe('#000000');
  });

  it('the palette at random draws from the colour tokens, the same at every frame', () => {
    const d = withMany({ count: 20, layout: { type: 'grid' }, params: { color: { $palette: 'random', seed: 3 } } });
    d.tokens.sea = { type: 'color', value: '#0000FF' };
    const ev = new Evaluator(d, registry());
    const fills = (t: number) => (ev.layerAt('many', t, 'main').props.$instances as { instance: Instance }[]).map((x) => ev.frame(t, 'card', x.instance).layers[0].props.fill);
    expect(new Set(fills(0))).toEqual(new Set(['#FF0000', '#0000FF']));
    expect(fills(1)).toEqual(fills(0));
  });

  it('each instance has its rank and count: the stagger and expressions inside the component read them', () => {
    const d = withMany({ count: 4, layout: { type: 'list' } });
    d.compositions.card.layers.bg.props!.radius = { $k: [{ t: 0, v: 0 }, { t: 1, v: 10 }], $mod: [{ type: 'stagger', delay: 0.5 }] };
    d.compositions.card.layers.bg.props!.label = { $expr: '`${index}/${count}`' };
    const ev = new Evaluator(d, registry());
    const list = ev.layerAt('many', 0, 'main').props.$instances as { instance: Instance }[];
    const at = (k: number) => ev.frame(1, 'card', list[k].instance).layers[0].props;
    expect(list.map((_, k) => at(k).label)).toEqual(['0/4', '1/4', '2/4', '3/4']);
    expect(list.map((_, k) => at(k).radius)).toEqual([10, 5, 0, 0]);
  });

  it('points of another layer: its path\'s vertices where they are', () => {
    const d = withMany({ layout: { type: 'points', layer: 'shape' } });
    registry();
    d.compositions.main.layers.shape = { type: 'pathy', transform: { position: [100, 0] }, props: { path: { v: [[0, 0], [10, 10]] } } } as never;
    d.compositions.main.layers.many.transform = { position: [50, 0] };
    d.compositions.main.order.push('shape');
    const pathy: NodeType = { type: 'pathy', title: 'P', category: 'test', props: { path: { type: 'path', default: { v: [] } } }, render: { canvas2d() {} } };
    const ev = new Evaluator(d, registry().register(pathy));
    const list = ev.layerAt('many', 0, 'main').props.$instances as { at: [number, number] }[];
    expect(list.map((x) => x.at)).toEqual([[50, 0], [60, 10]]);
    expect(validate(d, registry().register(pathy))).toEqual([]);
  });

  it('validation of a distribution; detach refuses it', () => {
    const d = withMany({ rows: 'photo', layout: { type: 'points', layer: 'nope' }, params: { ghost: 1, title: 3, color: { $palette: 'order' }, size: { $palette: 'order' } } });
    const paths = validate(d, registry()).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining([
      '/compositions/main/layers/many/distribute/rows',
      '/compositions/main/layers/many/distribute/layout/layer',
      '/compositions/main/layers/many/distribute/params/ghost',
      '/compositions/main/layers/many/distribute/params/title',
      '/compositions/main/layers/many/distribute/params/size',
    ]));
    expect(paths).not.toContain('/compositions/main/layers/many/distribute/params/color');
    expect(detachPlan(d, registry(), 'main', 'many')).toEqual({ error: 'distributed' });
  });
});

describe('defining a component from layers', () => {
  const scene = (): TrammeDoc => ({
    schema: 'tramme/1', meta: { title: 'scene' }, tokens: {}, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 1000, height: 500, fps: 30, duration: 4, order: ['bg', 'plate', 'title', 'top'], layers: {
      bg: { type: 'box', props: { size: [1000, 500] } },
      plate: { type: 'box', transform: { position: { $k: [{ t: 1, v: [200, 100] }, { t: 2, v: [300, 100] }] } }, props: { size: [100, 50], fill: '#FF0000' } },
      title: { type: 'box', in: 1, transform: { position: [210, 100] }, props: { label: 'Hello' } },
      top: { type: 'box' },
    } } },
  });

  it('moves the layers into a component, an instance in their place that reads the same', () => {
    const d = scene();
    const plan = defineComponentPlan(d, registry(), 'main', ['title', 'plate'], { id: 'card', box: { x: 150, y: 50, w: 200, h: 100 }, params: { title: { targets: ['title.label'] }, color: { targets: ['plate.fill'], default: '#00FF00' } } });
    if ('error' in plan) throw new Error(plan.error);
    const out = applyOps(d, plan.ops).doc;
    expect(validate(out, registry())).toEqual([]);
    expect(out.compositions.main.order).toEqual(['bg', plan.instance, 'top']);
    expect(out.compositions.card.params).toEqual({ title: { type: 'string', targets: ['title.label'] }, color: { type: 'paint', targets: ['plate.fill'], default: '#00FF00' } });
    const inst = out.compositions.main.layers[plan.instance];
    expect(inst.transform!.position).toEqual([250, 100]);
    // the plate where it was: the content moved back by the box
    const ev = new Evaluator(out, registry());
    const f = ev.frame(1.5, 'card');
    expect(f.layers[0].transform.position).toEqual([-150, -50]);
    expect(f.layers[0].children.map((l) => l.id)).toEqual(['plate', 'title']);
    expect(f.layers[0].children[0].transform.position).toEqual([250, 100]);
  });

  it('refuses layers that are not siblings, or that read the composition', () => {
    const d = scene();
    d.compositions.main.layers.g = { type: 'group', children: ['top'] };
    d.compositions.main.order = ['bg', 'plate', 'title', 'g'];
    expect(defineComponentPlan(d, registry(), 'main', ['title', 'top'], { id: 'x' })).toHaveProperty('error');
    d.compositions.main.layers.title.props!.label = { $expr: 'String(comp.width)' };
    expect(defineComponentPlan(d, registry(), 'main', ['title'], { id: 'x' })).toHaveProperty('error');
    expect(defineComponentPlan(d, registry(), 'main', ['plate'], { id: 'main' })).toHaveProperty('error');
  });
});

describe('the repeated check', () => {
  const scene = (extra: Record<string, unknown> = {}): TrammeDoc => ({
    schema: 'tramme/1', meta: { title: 'cards' }, tokens: {}, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 1000, height: 500, fps: 30, duration: 2, order: ['a', 'b', 'c', 'other'], layers: {
      a: { type: 'box', in: 0, transform: { position: [100, 100], opacity: { $k: [{ t: 0, v: 0 }, { t: 0.4, v: 1 }] } }, props: { size: [80, 40], fill: '#FF0000', label: 'One' } },
      b: { type: 'box', in: 0.1, transform: { position: [300, 100], opacity: { $k: [{ t: 0.1, v: 0 }, { t: 0.5, v: 1 }] } }, props: { size: [80, 40], fill: '#FF0000', label: 'Two' } },
      c: { type: 'box', in: 0.2, transform: { position: [500, 100], opacity: { $k: [{ t: 0.2, v: 0 }, { t: 0.6, v: 1 }] } }, props: { size: [80, 40], fill: '#00FF00', label: 'Three' } },
      other: { type: 'box', props: { size: [10, 10], radius: 3 } },
      ...extra,
    } } },
  });
  const run = async (d: TrammeDoc) => (await runChecks(d, registry().registerCheck(...BUILTIN_CHECKS), 'main', { only: ['repeated'] }));

  it('finds layers written nearly the same, their keyframes counted from their own start', async () => {
    const found = await run(scene());
    expect(found).toHaveLength(1);
    expect(found[0].layers).toEqual(['a', 'b', 'c']);
    expect(found[0].message).toMatch(/define_component/);
  });

  it('leaves alone what differs in structure or in many values', async () => {
    const d = scene();
    d.compositions.main.layers.c.props = { size: [10, 90], fill: '#0000FF', label: 'X', radius: 9, mode: 'b' };
    expect(await run(d)).toEqual([]);
  });
});
