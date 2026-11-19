import { expect, it, vi } from 'vitest';
import { applyOps, type ToolContext } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import { GRADE_TOOLS } from '../src/grade-tools.ts';

const [scopes, look] = GRADE_TOOLS;

function fixture() {
  const { doc } = newProject({ name: 'Grade', width: 1280, height: 720, fps: 30, duration: 4 });
  const compId = doc.root, comp = doc.compositions[compId];
  doc.assets.media = { type: 'video', src: 'assets/clip.mp4' };
  comp.layers.clip = { type: 'video', props: { video: 'media' }, effects: [{ id: 'base', type: 'fx.grade', props: { source: 'applelog', tint: -0.1 } }] };
  comp.order = ['clip'];
  const renderStill = vi.fn();
  const ctx = { doc, compId, time: 2, selection: ['clip'], registry: builtinRegistry(), renderStill } as unknown as ToolContext;
  return { doc, compId, renderStill, ctx };
}

it('appends a dosed look after the camera correction as editable effects', async () => {
  const { doc, compId, ctx } = fixture();
  const result = await look.run({ look: 'look-warm-film', amount: 0.25 }, ctx);
  const { doc: next } = applyOps(doc, result && typeof result !== 'string' ? result.ops! : []);
  expect(next.compositions[compId].layers.clip.effects).toEqual([
    { id: 'base', type: 'fx.grade', props: { source: 'applelog', tint: -0.1 } },
    expect.objectContaining({ type: 'fx.grade', props: expect.objectContaining({ strength: 0.25 }) }),
    expect.objectContaining({ type: 'fx.film', props: expect.objectContaining({ halation: 0.1, bloom: 0.025, grain: 0.075 }) }),
  ]);
});

it('lists shipped looks and uses a reversible proposal only when applying one', async () => {
  const { ctx } = fixture();
  expect(await look.run({}, ctx)).toMatchObject({ text: expect.stringContaining('look-natural') });
  expect(await look.run({ look: 'look-natural', amount: 0 }, ctx)).not.toHaveProperty('ops');
});

it('rejects a patch outside the image before rendering the scopes', async () => {
  const { ctx, renderStill } = fixture();
  await expect(scopes.run({ neutral: [95, 10, 10, 20] }, ctx)).rejects.toThrow('inside the frame');
  expect(renderStill).not.toHaveBeenCalled();
});
