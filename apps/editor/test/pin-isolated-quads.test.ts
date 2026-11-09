import { expect, it, vi } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import type { ToolContext, ToolOutput } from '@tramme/core';

const sampled = vi.hoisted(() => vi.fn(async (_ctx: unknown, _id: string, times: number[]) => times.map((t) => [
  [t * 10, 0], [t * 10 + 10, 0], [t * 10 + 10, 10], [t * 10, 10],
])));
vi.mock('../src/isolated-quads.ts', () => ({ sampleQuads: sampled }));
const { PIN_TOOLS } = await import('../src/pin.ts');

it('keys a pin from the isolated target corners', async () => {
  const project = newProject({ name: 'Pin', width: 100, height: 100, fps: 30, duration: 1 });
  const c = project.doc.compositions[project.doc.root];
  c.layers.target = { type: 'shape.rect', props: { size: { $expr: '[10, 10]' } } } as never;
  c.layers.image = { type: 'shape.rect', props: { size: [10, 10] } } as never;
  const ctx = { doc: project.doc, compId: project.doc.root, registry: builtinRegistry() } as ToolContext;
  const result = await PIN_TOOLS[0].run({ layer: 'image', onto: 'target', from: 0, to: 0.2 }, ctx) as ToolOutput;
  expect(sampled).toHaveBeenCalledWith(ctx, 'target', [0, 0.1, 0.1999]);
  expect(result.ops?.[0]).toMatchObject({ value: [{ type: 'fx.pin', props: { tl: { $k: [
    { t: 0, v: [0, 0] }, { t: 0.1, v: [1, 0] }, { t: 0.2, v: [2, 0] },
  ] } } }] });
});
