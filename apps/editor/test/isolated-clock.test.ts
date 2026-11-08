// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import type { ToolContext } from '@tramme/core';

const sampled = vi.hoisted(() => vi.fn(async (_layer: string, _comp: string, times: number[], file: number[]) => ({
  clock: { start: 1, rate: 2 }, fileTimes: times.map((t) => 1 + 2 * t), moments: file.map((t) => [(t - 1) / 2]),
})));
vi.mock('../src/plugins/index.ts', async (original) => ({ ...await original(), pluginHost: () => ({ sampleClock: sampled }) }));
vi.mock('../src/plugins/sandbox-draw.ts', async (original) => ({ ...await original(), ensureDeclared: async () => {}, ensureSandboxDoc: () => {}, moduleItemsOf: () => [] }));

const { S } = await import('../src/state.ts');
const { prefs } = await import('../src/settings.ts');
const { preview } = await import('../src/preview.ts');
const { sampleLayerClock } = await import('../src/isolated-clock.ts');

it('gets file and composition times from the isolated project worker', async () => {
  const project = newProject({ name: 'Clock', width: 64, height: 64, fps: 30, duration: 2 });
  project.doc.compositions[project.doc.root].layers.bed = { type: 'audio', props: { audio: 'music', rate: { $expr: '2' } } } as never;
  const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), prefs: prefs.peek(), renderer: preview.renderer };
  try {
    S.project.value = project.manifest;
    S.docUrl.value = 'https://tramme.test/projects/clock/document.tramme.json';
    prefs.value = { ...prefs.peek(), sandboxPreview: true };
    preview.renderer = { assets: { get: () => null } } as never;
    const ctx = { doc: project.doc, compId: project.doc.root, registry: builtinRegistry() } as ToolContext;
    const result = await sampleLayerClock(ctx, 'bed', [0, 0.5], [2]);
    expect(result).toEqual({ clock: { start: 1, rate: 2 }, fileTimes: [1, 2], moments: [[0.5]] });
    expect(sampled).toHaveBeenCalledWith('bed', project.doc.root, [0, 0.5], [2]);
  } finally {
    S.project.value = previous.project;
    S.docUrl.value = previous.docUrl;
    prefs.value = previous.prefs;
    preview.renderer = previous.renderer;
  }
});
