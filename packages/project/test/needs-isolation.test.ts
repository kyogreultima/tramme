// Which projects run in their sandbox: those that carry code (a plugin, a
// module, an expression anywhere), in the editor and the CLI alike.

import { describe, expect, it } from 'vitest';
import { needsIsolation, newProject } from '../src/index.ts';

describe('needsIsolation', () => {
  it('selects a project by the code it carries', () => {
    const plain = newProject({ name: 'P', width: 10, height: 10, fps: 1, duration: 1 }).doc;
    expect(needsIsolation(plain)).toBe(false);
    const expression = structuredClone(plain);
    expression.compositions.main.layers.a = { type: 'shape.rect', props: { size: { $k: [{ t: 0, v: { $expr: '[1, 1]' } }] } } } as never;
    expect(needsIsolation(expression)).toBe(true);
    const module = structuredClone(plain);
    module.assets.code = { type: 'module', src: 'plugins/code.js' };
    expect(needsIsolation(module)).toBe(true);
    const plugin = structuredClone(plain);
    plugin.plugins = ['stars'];
    expect(needsIsolation(plugin)).toBe(true);
  });
});
