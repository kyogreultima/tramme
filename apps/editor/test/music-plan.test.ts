// Copy to apps/editor/test/music-plan.test.ts after iteration-6 gate/commit.
import { expect, it } from 'vitest';
import { musicCutPlan } from '../src/music-plan.ts';
import { newProject } from '@tramme/project';
import { builtinRegistry } from '@tramme/nodes';
import { filmMusicPlan, musicPlanTool } from '../src/sound.ts';
import type { ToolContext } from '@tramme/core';

it('chooses a tempo that puts six even cuts on the requested beat grid', () => {
  const plan = musicCutPlan(15, 30, [2, 4, 6, 8, 10, 12].map((t) => ({ t, kind: 'cut' as const })));
  expect(plan.tempo).toBeGreaterThanOrEqual(60);
  expect(plan.tempo).toBeLessThanOrEqual(180);
  expect(plan.aligned).toBe(6);
  expect(plan.cuts).toEqual([2, 4, 6, 8, 10, 12]);
});

it('includes markers and hero cues in the film reading without claiming they are cuts', () => {
  const plan = musicCutPlan(18, 30, [{ t: 3, kind: 'cut' }, { t: 7, kind: 'marker' }, { t: 12, kind: 'hero' }]);
  expect(plan.cuts).toEqual([3]);
  expect(plan.markers).toEqual([7]);
  expect(plan.heroes).toEqual([12]);
  expect(plan.duration).toBe(18);
});

it('does not invent picture evidence or a composition sound tempo for an empty film', () => {
  const plan = musicCutPlan(20, 24, []);
  expect(plan.cuts).toEqual([]);
  expect(plan.aligned).toBe(0);
  expect(plan.tempo).toBeNull();
});

it('rejects impossible duration and non-finite moments before a paid provider request', () => {
  expect(() => musicCutPlan(2, 30, [])).toThrow();
  expect(() => musicCutPlan(601, 30, [])).toThrow();
  expect(() => musicCutPlan(20, 30, [{ t: NaN, kind: 'cut' }])).toThrow();
});

it('reads real sequence cuts and markers through the editor tool without a provider call', async () => {
  const { doc } = newProject({ name: 'Six cuts', width: 640, height: 360, fps: 30, duration: 15 });
  const c = doc.compositions.main;
  c.kind = 'sequence';
  c.layers = Object.fromEntries([0, 2, 4, 6, 8, 10, 12].map((time, i) => [`shot${i}`, { type: 'video' as const, in: time, out: i === 6 ? 15 : time + 2, props: {} }]));
  c.order = Object.keys(c.layers);
  c.markers = [{ id: 'hit', t: 7, kind: 'cue' }];
  const ctx = { doc, compId: 'main', time: 0, selection: [], registry: builtinRegistry(), signal: new AbortController().signal } as unknown as ToolContext;
  const plan = await filmMusicPlan(ctx);
  expect(plan.cuts).toEqual([2, 4, 6, 8, 10, 12]);
  expect(plan.markers).toEqual([7]);
  expect(plan.aligned).toBe(6);
  const result = await musicPlanTool.run({}, ctx) as { text: string };
  expect(JSON.parse(result.text)).toEqual(plan);
});
