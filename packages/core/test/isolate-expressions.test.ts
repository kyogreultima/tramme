// A trusted page that hosts a sandbox refuses every expression by default:
// an evaluator built there without an explicit permission fails closed.

import { describe, expect, it } from 'vitest';
import { Evaluator, isolateExpressions } from '../src/index.ts';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';

describe('isolated expressions', () => {
  it('refuses an expression once the page isolates them, unless the evaluator is told otherwise', () => {
    const doc = newProject({ name: 'X', width: 10, height: 10, fps: 1, duration: 1 }).doc;
    doc.compositions.main.layers.box = { type: 'shape.rect', props: { radius: { $expr: '1 + 2' } } } as never;
    doc.compositions.main.order = ['box'];
    expect(new Evaluator(doc, builtinRegistry()).value('box.radius', 0, 'main')).toBe(3);
    isolateExpressions();
    expect(() => new Evaluator(doc, builtinRegistry()).value('box.radius', 0, 'main')).toThrow(/isolated from this page/);
    expect(new Evaluator(doc, builtinRegistry(), { allowExpressions: true }).value('box.radius', 0, 'main')).toBe(3);
  });
});
