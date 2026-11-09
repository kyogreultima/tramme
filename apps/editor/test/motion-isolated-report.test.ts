// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import type { ToolContext } from '@tramme/core';

const sampled = vi.hoisted(() => vi.fn(async () => ({ figures: [{ address: 'box.radius', figures: {
  span: 0.5, change: 5, travel: 5, peak: 10, peakAt: 0.25, evenness: 1, turns: 0, overshoot: 0,
} }] })));
vi.mock('../src/plugins/index.ts', async (original) => ({ ...await original(), pluginHost: () => ({ motionReport: sampled }) }));
vi.mock('../src/plugins/sandbox-draw.ts', async (original) => ({ ...await original(), ensureDeclared: async () => {}, ensureSandboxDoc: () => {}, moduleItemsOf: () => [] }));

const { S } = await import('../src/state.ts');
const { prefs } = await import('../src/settings.ts');
const { preview } = await import('../src/preview.ts');
const { motionReportOf } = await import('../src/review.ts');

it('reads motion figures from the isolated project worker', async () => {
  const project = newProject({ name: 'Motion', width: 64, height: 64, fps: 30, duration: 2 });
  project.doc.compositions[project.doc.root].layers.box = { type: 'shape.rect', props: { radius: { $expr: 't * 10' } } } as never;
  const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), prefs: prefs.peek(), renderer: preview.renderer };
  try {
    S.project.value = project.manifest;
    S.docUrl.value = 'https://tramme.test/projects/motion/document.tramme.json';
    prefs.value = { ...prefs.peek(), sandboxPreview: true };
    preview.renderer = { assets: { get: () => null } } as never;
    const ctx = { doc: project.doc, compId: project.doc.root, registry: builtinRegistry() } as ToolContext;
    expect((await motionReportOf(ctx, 0, 0.5)).figures[0].address).toBe('box.radius');
    expect(sampled).toHaveBeenCalledWith(project.doc.root, 0, 0.5);
  } finally {
    S.project.value = previous.project;
    S.docUrl.value = previous.docUrl;
    prefs.value = previous.prefs;
    preview.renderer = previous.renderer;
  }
});
