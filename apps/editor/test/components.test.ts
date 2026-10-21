import { describe, expect, it } from 'vitest';
import { applyOps, toolOutput, validate, type ToolContext, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { COMPONENT_TOOLS } from '../src/components.ts';

const tool = (name: string) => COMPONENT_TOOLS.find((x) => x.name === name)!;

function scene(): TrammeDoc {
  return {
    schema: 'tramme/1', meta: { title: 'cards' }, tokens: { sea: { type: 'color', value: '#0080FF' } }, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 1080, height: 1080, fps: 30, duration: 3, order: ['plate', 'label'], layers: {
      plate: { type: 'shape.rect', transform: { position: [300, 300] }, props: { size: [200, 120], fill: '#FF0000' } },
      label: { type: 'shape.ellipse', transform: { position: [300, 300] }, props: { size: [40, 40], fill: '#FFFFFF' } },
    } } },
  };
}

const ctxOf = (doc: TrammeDoc, selection: string[] = []): ToolContext => ({ doc, compId: 'main', time: 0, selection, registry: builtinRegistry() } as unknown as ToolContext);

describe('the components tools', () => {
  it('make a component of the selection, then place many of it, then detach one placed alone', async () => {
    let doc = scene();
    const made = toolOutput(await tool('define_component').run({ name: 'Card', params: [{ name: 'color', targets: ['plate.fill'] }] }, ctxOf(doc, ['plate', 'label'])));
    doc = applyOps(doc, made.ops!).doc;
    expect(validate(doc, builtinRegistry())).toEqual([]);
    const card = doc.compositions.card;
    // the frame is where they are drawn, padded
    expect([card.width, card.height]).toEqual([208, 128]);
    expect(doc.compositions.main.order).toEqual(['card']);
    expect(doc.compositions.main.layers.card.transform!.position).toEqual([300, 300]);

    const many = toolOutput(await tool('instantiate').run({ component: 'card', count: 6, layout: 'grid', rules: { color: { $palette: 'order' } }, time: { mode: 'distance', amount: 0.5 } }, ctxOf(doc)));
    doc = applyOps(doc, many.ops!).doc;
    expect(validate(doc, builtinRegistry())).toEqual([]);
    const grid = Object.values(doc.compositions.main.layers).find((l) => l.distribute)!;
    expect(grid.distribute!.layout).toEqual({ type: 'grid', spacing: [229, 141] });

    const one = toolOutput(await tool('instantiate').run({ component: 'card', params: '{"color": "#00FF00"}', position: [800, 800] }, ctxOf(doc)));
    doc = applyOps(doc, one.ops!).doc;
    expect(validate(doc, builtinRegistry())).toEqual([]);
    const id = doc.compositions.main.order.at(-1)!;
    const flat = toolOutput(await tool('detach').run({ layer: id }, ctxOf(doc)));
    doc = applyOps(doc, flat.ops!).doc;
    expect(validate(doc, builtinRegistry())).toEqual([]);
    expect(doc.compositions.main.layers[id].type).toBe('group');
  });

  it('says why it cannot', async () => {
    const doc = scene();
    await expect(Promise.resolve().then(() => tool('instantiate').run({ component: 'nope' }, ctxOf(doc)))).rejects.toThrow(/no component/);
    await expect(Promise.resolve().then(() => tool('define_component').run({ name: 'x' }, ctxOf(doc)))).rejects.toThrow(/select/);
  });
});

describe('the library of components', () => {
  it('packs a component with what it holds and needs, and brings it into another project under free ids', async () => {
    const { packComponent, unpackComponent } = await import('../src/components.ts');
    const doc = scene();
    doc.tokens.ink = { type: 'color', value: '@sea' };
    doc.styles = { pop: { props: { 'transform.opacity': { $k: [{ t: 0, v: 0 }, { t: 0.3, v: 1 }] } } } };
    doc.compositions.dot = { name: 'Dot', width: 10, height: 10, fps: 30, duration: 1, order: ['d'], layers: { d: { type: 'shape.ellipse', props: { size: [10, 10], fill: '@ink' }, styles: [{ style: 'pop' }] } } };
    doc.compositions.card = { name: 'Card', width: 200, height: 100, fps: 30, duration: 3, params: { color: { type: 'paint', targets: ['p.fill'] } }, order: ['p', 'dot'], layers: { p: { type: 'shape.rect', props: { size: [200, 100] } }, dot: { type: 'comp', props: { comp: 'dot' } } } };
    const packed = packComponent(doc, 'card');
    if ('error' in packed) throw new Error(packed.error);
    expect(Object.keys(packed.compositions)).toEqual(['card', 'dot']);
    expect(Object.keys(packed.tokens).sort()).toEqual(['ink', 'sea']);
    expect(Object.keys(packed.styles)).toEqual(['pop']);
    // another project, which already has a "dot"
    const other = scene();
    other.compositions.dot = { name: 'Mine', width: 5, height: 5, fps: 30, duration: 1, order: [], layers: {} };
    const { ops, root } = unpackComponent(other, JSON.parse(JSON.stringify(packed)));
    const out = applyOps(other, ops).doc;
    expect(validate(out, builtinRegistry())).toEqual([]);
    expect(root).toBe('card');
    expect(out.compositions.card.layers.dot.props!.comp).toBe('dot2');
    expect(out.compositions.dot.name).toBe('Mine');
    // a component showing a file of its project is not kept
    doc.assets.photo = { type: 'image', src: 'p.png' };
    doc.compositions.card.layers.p = { type: 'image', props: { image: 'photo' } } as never;
    expect(packComponent(doc, 'card')).toHaveProperty('error');
  });
});
