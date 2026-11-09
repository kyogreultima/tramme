import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { builtinRegistry } from '@tramme/nodes';
import { editorEvaluator } from '../src/evaluator.ts';
import { prefs } from '../src/settings.ts';

describe('trusted editor evaluation', () => {
  it('does not run project expressions when isolated preview is selected', () => {
    const doc = newProject({ name: 'Expression', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    doc.compositions.main.layers.rect = {
      type: 'shape.rect', transform: {}, props: {
        size: [64, 64], fill: { $expr: `({}).constructor.constructor('globalThis.__editorLeak = true; return "#ff0000"')()` },
      },
    } as never;
    doc.compositions.main.order = ['rect'];
    const previous = prefs.peek();
    prefs.value = { ...previous, sandboxPreview: true };
    try {
      const evaluator = editorEvaluator(doc, builtinRegistry());
      expect(() => evaluator.value('rect.fill', 0)).toThrow('expression evaluation is isolated from this page');
      expect((globalThis as any).__editorLeak).toBeUndefined();
    } finally { prefs.value = previous; }
  });
});
