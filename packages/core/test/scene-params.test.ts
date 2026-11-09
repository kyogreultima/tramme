import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { Evaluator, validate, type TrammeDoc } from '../src/index.ts';
import { newProject } from '@tramme/project';

function docWith(params: Record<string, unknown>, parameters: Record<string, unknown> = {
  title: { type: 'string', default: 'Hello' }, size: { type: 'number', default: 10 }, on: { type: 'boolean', default: false }, ink: { type: 'color', default: '#112233' },
}): TrammeDoc {
  const { doc } = newProject({ name: 'S', width: 320, height: 180, fps: 10, duration: 2 });
  doc.compositions.main.layers.scene = { type: 'webscene', name: 's', transform: { position: [160, 90] }, props: { folder: 'scenes/title', frames: [], fps: 10, size: [320, 180], parameters }, params } as never;
  doc.compositions.main.order = ['scene'];
  return doc;
}
const registry = builtinRegistry();
const at = (doc: TrammeDoc, t: number) => new Evaluator(doc, registry).layerAt('scene', t).props.$params;

describe('web scene parameters', () => {
  it('read the scene\'s defaults until the layer sets a value', () => {
    expect(at(docWith({}), 0)).toEqual({ title: 'Hello', size: 10, on: false, ink: '#112233' });
  });

  it('are animated like any property', () => {
    const doc = docWith({ size: { $k: [{ t: 0, v: 10 }, { t: 1, v: 30 }] }, title: 'Fixed' });
    expect(validate(doc, registry)).toEqual([]);
    const half = at(doc, 0.5) as Record<string, number>;
    expect(half.size).toBeGreaterThan(10);
    expect(half.size).toBeLessThan(30);
    expect(at(doc, 1)).toMatchObject({ size: 30, title: 'Fixed' });
    expect(at(doc, 0)).toMatchObject({ size: 10 });
  });

  it('are checked against what the scene declares', () => {
    expect(validate(docWith({ nope: 1 }), registry).map((i) => i.message)).toEqual(['the scene declares no parameter "nope" (props.parameters)']);
    expect(validate(docWith({ size: 'wide' }), registry)).not.toEqual([]);
    expect(validate(docWith({ size: 4 }, { size: { type: 'number', default: 'x' } }), registry).map((i) => i.message)[0]).toContain('declares no parameter');
  });
});
