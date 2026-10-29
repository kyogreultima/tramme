import { describe, expect, it } from 'vitest';
import { applyOps, layerQuad, validate, Evaluator, type Layer, type ToolContext, type ToolOutput, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import { PIN_TOOLS } from '../src/pin.ts';

const reg = builtinRegistry();
const tool = PIN_TOOLS[0];
function project(): TrammeDoc {
  const doc = newProject({ name: 'Pin', width: 1920, height: 1080, fps: 30, duration: 8 }).doc;
  const c = doc.compositions[doc.root];
  c.layers = {
    shot: { type: 'shape.rect', props: { size: [400, 300] }, transform: { position: [960, 540] } } as Layer,
    card: { type: 'shape.rect', in: 1, out: 2, props: { size: [200, 120] }, transform: { position: { $k: [{ t: 1, v: [300, 300] }, { t: 2, v: [700, 400] }] }, rotationY: 30 } } as Layer,
  };
  c.order = ['shot', 'card'];
  return doc;
}
const run = (doc: TrammeDoc, input: Record<string, unknown>) => tool.run(input as never, { doc, compId: doc.root, time: 0, selection: [], registry: reg } as unknown as ToolContext) as Promise<ToolOutput>;

describe('the pin tool', () => {
  it('pins a layer on four corners with one effect', async () => {
    const corners = [[100, 100], [500, 120], [480, 400], [90, 380]];
    const doc = project(), out = await run(doc, { layer: 'shot', corners });
    const applied = applyOps(doc, out.ops!).doc;
    const fx = applied.compositions[applied.root].layers.shot.effects!;
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ type: 'fx.pin', props: { tl: corners[0], tr: corners[1], br: corners[2], bl: corners[3] } });
    expect(validate(applied, reg)).toEqual([]);
  });

  it('pins a layer onto another: eleven keys a corner over a second, the first at the card\'s own quad', async () => {
    const doc = project(), out = await run(doc, { layer: 'shot', onto: 'card' });
    const applied = applyOps(doc, out.ops!).doc;
    const pin = applied.compositions[applied.root].layers.shot.effects![0];
    const tl = (pin.props as Record<string, { $k: { t: number; v: number[] }[] }>).tl.$k;
    expect(tl).toHaveLength(11);
    expect(tl[0].t).toBeCloseTo(1, 6);
    expect(tl[10].t).toBeCloseTo(2, 6);
    // the first values are the card's quad at its in point
    const ev = new Evaluator(applied, reg);
    const card = ev.frame(1, applied.root).layers.find((l) => l.id === 'card')!;
    const quad = layerQuad(card, { x: -100, y: -60, w: 200, h: 120 }, [1, 0, 0, 1, 0, 0], 1000);
    expect(tl[0].v[0]).toBeCloseTo(quad[0][0], 1);
    expect(tl[0].v[1]).toBeCloseTo(quad[0][1], 1);
    expect(validate(applied, reg)).toEqual([]);
  });

  it('refuses a layer pinned onto itself, and a layer that is not there', async () => {
    await expect(run(project(), { layer: 'shot', onto: 'shot' })).rejects.toThrow(/itself/);
    await expect(run(project(), { layer: 'nope', corners: [[0, 0], [1, 0], [1, 1], [0, 1]] })).rejects.toThrow(/nope/);
    await expect(run(project(), { layer: 'shot' })).rejects.toThrow(/corners|onto/);
  });
});
