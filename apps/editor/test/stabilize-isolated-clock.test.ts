import { expect, it, vi } from 'vitest';
import type { ToolContext } from '@tramme/core';

const sampled = vi.hoisted(() => vi.fn(async () => ({ clock: {}, fileTimes: [3, 1], moments: [] })));
vi.mock('../src/isolated-clock.ts', () => ({ sampleLayerClock: sampled }));
const { stabilizeFileSpan } = await import('../src/stabilize.ts');

it('gets the file span for stabilization from the isolated layer clock', async () => {
  const ctx = { compId: 'main' } as ToolContext;
  expect(await stabilizeFileSpan(ctx, 'video', 1, 5)).toEqual([1, 3]);
  expect(sampled).toHaveBeenCalledWith(ctx, 'video', [1, 5], []);
});
