import { expect, it, vi } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import type { ToolContext } from '@tramme/core';

const sampled = vi.hoisted(() => vi.fn(async (_ctx: unknown, _id: string, times: number[]) => times.map(() => [
  { id: 'phone', name: 'Phone', type: 'ui.device', opacity: 1, box: { x: 10, y: 10, w: 80, h: 80 } },
])));
vi.mock('../src/isolated-placed.ts', () => ({ samplePlacedTimes: sampled }));
const { prefs } = await import('../src/settings.ts');
const { formLinesForReview } = await import('../src/forms.ts');

it('classifies isolated scene forms from worker placements', async () => {
  const project = newProject({ name: 'Forms', width: 100, height: 100, fps: 30, duration: 4 });
  const c = project.doc.compositions[project.doc.root];
  c.markers = [{ id: 'a', t: 0, kind: 'scene', label: 'First' }, { id: 'b', t: 2, kind: 'scene', label: 'Second' }];
  c.layers.phone = { type: 'ui.device', props: { size: { $expr: '[80, 80]' } } } as never;
  const previous = prefs.peek();
  try {
    prefs.value = { ...previous, sandboxPreview: true };
    const ctx = { doc: project.doc, compId: project.doc.root, registry: builtinRegistry() } as ToolContext;
    const lines = await formLinesForReview(ctx, null);
    expect(sampled).toHaveBeenCalledWith(ctx, project.doc.root, [1, 3]);
    expect(lines[0]).toContain('"First" and "Second" are all built as interface');
  } finally { prefs.value = previous; }
});
