import { expect, it, vi } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import type { ToolContext } from '@tramme/core';

const sampled = vi.hoisted(() => vi.fn(async () => ({ clock: {}, fileTimes: [], moments: [[1.25]] })));
vi.mock('../src/isolated-clock.ts', () => ({ sampleLayerClock: sampled }));
const { momentsOf } = await import('../src/sound.ts');

it('places audio-analysis beats using the sampled project layer clock', async () => {
  const project = newProject({ name: 'Music', width: 64, height: 64, fps: 20, duration: 3 });
  const doc = project.doc, c = doc.compositions[doc.root];
  doc.assets.music = { type: 'audio', src: 'assets/music.wav' };
  doc.assets['analysis-music'] = { type: 'json', src: 'assets/analysis.json' };
  c.layers.bed = { type: 'audio', props: { audio: 'music', rate: { $expr: '2' } } } as never;
  c.order.push('bed');
  const analysis = { version: 1, kind: 'audio-analysis', source: 'music', duration: 3, rate: 50,
    envelope: { rms: [], low: [], mid: [], high: [] }, tempo: 120, beats: [2], downbeats: [], onsets: [], sections: [] };
  const ctx = { doc, compId: doc.root, registry: builtinRegistry(), time: 0, selection: [], signal: new AbortController().signal,
    assetUrl: () => `data:application/json,${encodeURIComponent(JSON.stringify(analysis))}` } as unknown as ToolContext;
  expect((await momentsOf(ctx, undefined, 'beats', undefined)).map((m) => m.t)).toEqual([1.25]);
  expect(sampled).toHaveBeenCalledWith(ctx, 'bed', [], [2]);
});
