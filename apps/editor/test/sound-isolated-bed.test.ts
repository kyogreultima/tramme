import { expect, it, vi } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import type { ToolContext } from '@tramme/core';
import { shapeOps } from '../src/sound.ts';

it('shapes an isolated bed from worker samples without evaluating its expression in the page', async () => {
  const doc = newProject({ name: 'Bed', width: 640, height: 360, fps: 30, duration: 10 }).doc;
  const comp = doc.compositions[doc.root];
  comp.layers.bed = { type: 'audio', props: { audio: 'music', gain: { $: 'globalThis.__unsafe = true; -6' } } } as never;
  const ctx = { doc, compId: doc.root, registry: builtinRegistry() } as ToolContext;
  const sample = vi.fn(async (addresses: string[], times: number[]) => {
    expect(addresses).toEqual(['bed.gain']);
    expect(times).toEqual([5.6, 5.95, 6, 6.35]);
    return [[-6, -6, -6, -6]];
  });
  const ops = await shapeOps(ctx, ['bed'], 'gain', [{
    from: 5.6, to: 6.35,
    keys: (base) => [{ t: 5.95, v: base(5.6) - 24 }, { t: 6, v: base(5.6) - 24 }],
  }], 0, sample);
  expect(sample).toHaveBeenCalledOnce();
  expect(ops[0]).toMatchObject({ path: '/compositions/main/layers/bed/props/gain', value: { $k: [
    { t: 5.6, v: -6 }, { t: 5.95, v: -30 }, { t: 6, v: -30 }, { t: 6.35, v: -6 },
  ] } });
  expect((globalThis as { __unsafe?: boolean }).__unsafe).toBeUndefined();
});
