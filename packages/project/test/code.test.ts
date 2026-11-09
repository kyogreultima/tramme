// What code an archive would run, counted without running anything: the
// inventory the import asks about.

import { describe, expect, it } from 'vitest';
import type { TrammeDoc } from '@tramme/core';
import { newProject } from '../src/format.ts';
import { codeInventory, containsExpression } from '../src/code.ts';

const doc = (): TrammeDoc => {
  const { doc } = newProject({ name: 'Test', width: 100, height: 100, fps: 30, duration: 2 });
  return doc;
};

describe('codeInventory', () => {
  it('finds no code in a fresh project', () => {
    const inv = codeInventory(doc(), new Map());
    expect(inv.plugins).toEqual([]);
    expect(inv.expressions).toBe(0);
    expect(inv.addresses).toEqual([]);
  });

  it('inventories the plugins with their file, size and kinds', () => {
    const d = doc();
    d.assets.mod = { type: 'module', src: 'plugins/stars.js' };
    d.plugins = ['mod'];
    const source = `export const meta = { name: 'stars' };\nexport const nodes = [];\nexport const tools = [];\nconst checks = 1; (a binding without export is not a kind)`;
    const files = new Map([['plugins/stars.js', new TextEncoder().encode(source)]]);
    const inv = codeInventory(d, files);
    expect(inv.plugins).toEqual([{ id: 'mod', path: 'plugins/stars.js', size: files.get('plugins/stars.js')!.byteLength, kinds: ['nodes', 'tools'] }]);
  });

  it('keeps a plugin whose file or src is off', () => {
    const d = doc();
    d.assets.mod = { type: 'module', src: '../outside.js' };
    d.plugins = ['mod', 'ghost'];
    const inv = codeInventory(d, new Map());
    expect(inv.plugins).toEqual([
      { id: 'mod', path: null, size: null, kinds: [] },
      { id: 'ghost', path: null, size: null, kinds: [] },
    ]);
  });

  it('counts the expressions and gives the first addresses', () => {
    const d = doc();
    const c = d.compositions[d.root];
    const id = 'a';
    c.layers[id] = {
      type: 'shape.rect',
      transform: { position: { $expr: 'wiggle(2, 10)' }, rotation: { $k: [{ t: 0, v: 0 }, { t: 1, v: 90 }], $expr: 'time * 90' } },
      props: {},
    } as never;
    c.order = [id];
    const inv = codeInventory(d, new Map());
    expect(inv.expressions).toBe(2);
    expect(inv.addresses).toEqual([
      `/compositions/${d.root}/layers/a/transform/position`,
      `/compositions/${d.root}/layers/a/transform/rotation`,
    ]);
  });

  it('reads the expressions of the composition settings and effects too', () => {
    const d = doc();
    const c = d.compositions[d.root];
    c.background = { $expr: '@ink' } as never;
    c.effects = [{ id: 'e1', type: 'look.vignette', props: { amount: { $expr: 'time' } } }] as never;
    const inv = codeInventory(d, new Map());
    expect(inv.expressions).toBe(2);
    expect(inv.addresses[0]).toBe(`/compositions/${d.root}/background`);
  });

  it('detects nested expressions that also need the isolated renderer', () => {
    const d = doc();
    expect(containsExpression(d)).toBe(false);
    d.compositions[d.root].layers.nested = {
      type: 'comp', transform: {}, props: { comp: 'other' },
      distribute: { params: { spin: { $expr: 'time * 45' } } },
    } as never;
    expect(containsExpression(d)).toBe(true);
  });
});
