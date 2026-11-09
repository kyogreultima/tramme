import { expect, it, vi } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import type { ToolContext, ToolOutput, Track } from '@tramme/core';

const sampled = vi.hoisted(() => vi.fn(async (_ctx: unknown, _id: string, compTimes: number[], fileTimes: number[]) => ({
  clock: { start: 0.5 }, fileTimes: compTimes.map((t) => t - 1 + 0.5), moments: fileTimes.map(() => [2.2]),
})));
vi.mock('../src/isolated-clock.ts', () => ({ sampleLayerClock: sampled }));
const { TRACKING_TOOLS, trackClockWindow } = await import('../src/tracking.ts');

it('samples the start, end and current file times before tracking', async () => {
  const project = newProject({ name: 'Track', width: 1080, height: 1920, fps: 30, duration: 6 });
  const doc = project.doc;
  doc.compositions[doc.root].layers.video = { type: 'video', in: 1, out: 5, props: { video: 'clip', rate: { $expr: '2' } } } as never;
  const ctx = { doc, compId: doc.root, time: 2, registry: builtinRegistry() } as ToolContext;
  expect(await trackClockWindow(ctx, 'video', 1, 5)).toMatchObject({ t0: 1.5, lo: 0.5, hi: 4.5 });
  expect(sampled).toHaveBeenCalledWith(ctx, 'video', [2, 1, 5], []);
});

it('places a callout using the isolated video clock', async () => {
  const project = newProject({ name: 'Track', width: 1080, height: 1920, fps: 30, duration: 6 });
  const doc = project.doc, c = doc.compositions[doc.root];
  doc.assets.clip = { type: 'video', src: 'assets/clip.mp4' };
  doc.assets['track-clip-car'] = { type: 'json', src: 'assets/car.json' };
  c.layers.video = { type: 'video', in: 1, out: 5, props: { video: 'clip', rate: { $expr: '2' } } } as never;
  c.order.push('video');
  const track: Track = { version: 1, kind: 'track', source: 'clip', name: 'car', width: 1920, height: 1080,
    frames: [{ t: 0.5, box: [0.1, 0.1, 0.2, 0.2] }, { t: 1, box: [0.2, 0.2, 0.2, 0.2] }] };
  const ctx = { doc, compId: doc.root, time: 2, selection: [], registry: builtinRegistry(), signal: new AbortController().signal,
    assetUrl: () => `data:application/json,${encodeURIComponent(JSON.stringify(track))}` } as unknown as ToolContext;
  const result = await TRACKING_TOOLS.find((tool) => tool.name === 'callout')!.run({}, ctx) as ToolOutput;
  expect(result.ops?.[0]).toMatchObject({ value: { in: 2.2, out: 2.7 } });
  expect(sampled).toHaveBeenCalledWith(ctx, 'video', [], [0.5, 1]);
});
